/**
 * Purge all data (DESIGN.md 5.9): GM only, from the module's settings, behind a typed confirmation (the
 * world's title). It is not part of the public API.
 *
 * 1. The dialog shows what each member has in the strongbox (`memberBalances`) and what else it holds.
 * 2. The GM picks what happens to the coins and items first:
 *    - "refunds": a refund claim per member and allocation (each order, each garden, their share of the fund),
 *      keyed `purge-refund:<allocation>:<actor>` so a second run issues none twice, and carrying its order or
 *      garden so the refund pays that allocation back; less what an open refund claim of a cancel or a finish
 *      already owes for it (`unclaimedAllocations`), so nobody is paid twice. The owners' clients apply them as
 *      usual (or this GM's, for offline owners). The purge stops there while anything is owed or any refund claim
 *      is open; the GM runs it again once they are collected.
 *    - "party": everything in the strongbox moves to the pf2e party actor's stash.
 *    - "keep": nothing moves.
 * 3. Then it turns the master switch off, so every client stops writing (and none re-creates what is about to
 *    be deleted), moves the strongbox's contents if asked, and removes `flags.MOD` from actors and their items,
 *    world items, users, journal entries and their pages, folders and (optionally) chat messages.
 * 4. It deletes the ledger, the strongbox if it is empty (otherwise it stays an ordinary loot actor a GM can
 *    share out by hand, 5.8), and the module-data folder if empty, and resets the world settings.
 * 5. Crafted items, formula books and system data are left as they are.
 */
import { MODULE_ID } from "../constants.mjs";
import { idemKey } from "../logic/ids.mjs";
import { openClaims } from "../logic/claims.mjs";
import { memberBalances, unclaimedAllocations } from "../logic/reconcile.mjs";
import { runRequest } from "./batch.mjs";
import { createClaims } from "./claims.mjs";
import { internal } from "./guards.mjs";
import { locateArchive } from "./shared-docs.mjs";
import { withCoinMutex } from "./lease.mjs";
import { shared } from "./state.mjs";
import { read, records } from "./store.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/**
 * How long the purge waits after turning the switch off before it moves or deletes anything: every client
 * re-checks a quarter of a second after the change, and a move it had already started finishes in this time.
 */
export const PURGE_SETTLE_MS = 2000;

/** The settings button needs an ApplicationV2 class; this one opens the purge dialog instead of a window. */
export class PurgeMenu extends ApplicationV2 {
    async render() {
        await openPurge();
        return this;
    }
}

/** What the strongbox holds, for the dialog and the refunds. */
function summary() {
    const { strongbox } = shared();
    const { byActor, byAllocation, unassignedCp } = memberBalances(records("rows"));
    const items = strongbox ? [...strongbox.items] : [];
    const flagged = (key) => items.filter((i) => i.flags?.[MODULE_ID]?.[key]).length;
    const open = openClaims(read("claims"));
    return {
        balances: byActor.map(({ actor, cp }) => ({ name: fromUuidSync(actor)?.name ?? actor, actor, cp })),
        byActor, byAllocation, unassignedCp,
        unclaimed: unclaimedAllocations(byAllocation, open), refundsOpen: open.filter((claim) => claim.kind === "refund").length,
        shelf: flagged("shelf"), earmarked: flagged("earmark"), items: items.length,
        claims: open.length,
    };
}

const loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const escape = (text) => foundry.utils.escapeHTML(String(text));

/** The dialog's form. Every word comes from lang/en.json (P13); names are escaped. */
function purgeContent(info) {
    const balances = info.balances.map((b) => `<li>${escape(loc("pf2e-artisans-workshop.Purge.Balance", { name: b.name, gp: (b.cp / 100).toFixed(2) }))}</li>`).join("");
    const option = (value, key, checked = false) =>
        `<label><input type="radio" name="returns" value="${value}"${checked ? " checked" : ""}> ${escape(loc(key))}</label>`;
    return [
        `<p>${escape(loc("pf2e-artisans-workshop.Purge.Intro"))}</p>`,
        balances ? `<ul>${balances}</ul>` : `<p>${escape(loc("pf2e-artisans-workshop.Purge.NoBalances"))}</p>`,
        `<p>${escape(loc("pf2e-artisans-workshop.Purge.Contents", { items: String(info.items), shelf: String(info.shelf), earmarked: String(info.earmarked) }))}</p>`,
        info.claims ? `<p>${escape(loc("pf2e-artisans-workshop.Purge.OpenClaims", { count: String(info.claims) }))}</p>` : "",
        `<fieldset><legend>${escape(loc("pf2e-artisans-workshop.Purge.Returns"))}</legend>`,
        option("refunds", "pf2e-artisans-workshop.Purge.ReturnRefunds", true),
        game.actors.party ? option("party", "pf2e-artisans-workshop.Purge.ReturnParty") : "",
        option("keep", "pf2e-artisans-workshop.Purge.ReturnKeep"),
        `</fieldset>`,
        `<label><input type="checkbox" name="chat"> ${escape(loc("pf2e-artisans-workshop.Purge.Chat"))}</label>`,
        `<label>${escape(loc("pf2e-artisans-workshop.Purge.TypeWorld", { world: game.world.title }))}<input type="text" name="confirm"></label>`,
    ].join("");
}

/** Show the dialog and run what the GM chose. */
export async function openPurge() {
    if (!game.user.isGM) return;
    const content = purgeContent(summary());   // for display only: the purge reads the ledger again when it runs
    const choice = await DialogV2.wait({
        window: { title: "pf2e-artisans-workshop.Purge.Title" },
        content,
        buttons: [
            { action: "purge", label: "pf2e-artisans-workshop.Purge.Confirm", icon: "fa-solid fa-broom",
                callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
            { action: "cancel", label: "COMMON.Cancel", type: "button", default: true },
        ],
    });
    if (!choice || choice === "cancel") return;
    if (String(choice.confirm ?? "").trim() !== game.world.title) {
        ui.notifications.error("pf2e-artisans-workshop.Purge.Mismatch", { localize: true });
        return;
    }
    await runPurge({ returns: choice.returns, chat: choice.chat === true });
}

/** The idempotency key of a purge refund: one per member and allocation. */
function refundKey({ actor, order, garden }) {
    const allocation = order ? `order-${order}` : garden ? `garden-${garden}` : "fund";
    return idemKey("purge-refund", allocation, actor);
}

/**
 * Issue the refund claims of the "refunds" choice for what no open claim owes yet (`unclaimedAllocations`); report how
 * many are new and how many refunds, the purge's or a cancel's or a finish's, still wait to be collected.
 */
async function issueRefunds(unclaimed) {
    const claims = await createClaims(unclaimed.map(({ actor, order, garden, cp }) => ({
        kind: "refund", idem: refundKey({ actor, order, garden }), actor, cp, order, garden, parties: [actor],
    })));
    const waiting = openClaims(read("claims")).filter((claim) => claim.kind === "refund").length - claims.length;
    ui.notifications.info("pf2e-artisans-workshop.Purge.RefundsIssued", { format: { count: String(claims.length), waiting: String(waiting) } });
}

/**
 * The purge itself, after the confirmation. It reads the ledger now, not when the dialog opened, so a pledge or
 * withdrawal made while the GM was typing is accounted for.
 * @returns {Promise<"refunds"|"stopped"|"done">}
 */
export async function runPurge({ returns, chat = false, settleMs = PURGE_SETTLE_MS }) {
    if (!game.user.isGM) throw new Error(`${MODULE_ID} | only a GM can purge`);
    const info = summary();
    if (returns === "refunds" && (info.unclaimed.length || info.refundsOpen)) {
        await issueRefunds(info.unclaimed);
        return "refunds";
    }
    const docs = shared();
    const { ledger, strongbox } = docs;
    const archive = locateArchive();   // M12b: the Crafting Log goes with the ledger (5.3.3)
    const folderId = ledger?._source.folder ?? archive?._source.folder ?? null;
    await game.settings.set(MODULE_ID, "enabled", false);   // before anything goes: every client stops writing
    if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
    if (returns === "party" && strongbox && ledger && !(await moveToParty(docs))) {
        await game.settings.set(MODULE_ID, "enabled", true);
        ui.notifications.error("pf2e-artisans-workshop.Purge.MoveStopped", { localize: true });
        return "stopped";
    }
    await unsetFlags({ chat, skip: new Set([ledger?.id, archive?.id].filter(Boolean)) });
    if (ledger) await ledger.delete(internal());
    if (archive) await archive.delete(internal());
    if (strongbox && strongbox.items.size === 0) await strongbox.delete(internal());
    const inFolder = (doc) => doc._source.folder === folderId;
    const folder = folderId ? game.folders.get(folderId) : null;
    if (folder && !game.journal.some(inFolder) && !game.folders.some(inFolder)) await folder.delete();
    await resetSettings();
    ui.notifications.info("pf2e-artisans-workshop.Purge.Done", { localize: true });
    return "done";
}

/** A strongbox item as the party stash receives it: no module flags, and out of any strongbox container. */
function partyCopy(item) {
    const source = item.toObject();
    delete source._id;
    if (source.flags) delete source.flags[MODULE_ID];
    if (source.system?.containerId) source.system.containerId = null;
    return source;
}

/**
 * Move every strongbox item to the party stash in one request: deleted from the strongbox first, then created
 * there, so a request that stops part-way never leaves a copy in both. Anything that does not apply in full (an
 * item spent by a move that was still in flight) stops the purge before the ledger goes.
 * @returns {Promise<boolean>} whether everything moved
 */
async function moveToParty(docs) {
    const party = game.actors.party;
    const { strongbox } = docs;
    if (!party || !strongbox.items.size) return true;
    const ids = strongbox.items.map((item) => item.id);
    const data = strongbox.items.map(partyCopy);
    const result = await withCoinMutex(game.user.id, () => runRequest([
        { op: "deleteItems", target: "strongbox", ids },
        { op: "createItems", target: party.uuid, data },
    ], docs));
    if (result.outcome !== "ok") console.error(`${MODULE_ID} | the move to the party stash did not finish`, result);
    return result.outcome === "ok";
}

const hasFlags = (doc) => doc.flags?.[MODULE_ID] !== undefined;
const unset = (doc) => ({ _id: doc.id, [`flags.${MODULE_ID}`]: _del });

/** Remove the module's flags everywhere it writes them (5.9 step 3). */
async function unsetFlags({ chat, skip = new Set() }) {
    const worlds = [
        [Actor, game.actors], [Item, game.items], [User, game.users], [Folder, game.folders],
        ...(chat ? [[ChatMessage, game.messages]] : []),
    ];
    for (const [cls, collection] of worlds) {
        const updates = collection.filter(hasFlags).map(unset);
        if (updates.length) await cls.implementation.updateDocuments(updates, { diff: false });
    }
    // The ledger and the Crafting Log are deleted next, pages and all; their role flags find them until then.
    const journals = game.journal.filter((j) => hasFlags(j) && !skip.has(j.id)).map(unset);
    if (journals.length) await JournalEntry.implementation.updateDocuments(journals, { diff: false });
    for (const actor of game.actors) {
        const items = actor.items.filter(hasFlags).map(unset);
        if (items.length) await actor.updateEmbeddedDocuments("Item", items, { diff: false });
    }
    for (const journal of game.journal) {
        if (skip.has(journal.id)) continue;   // deleted next, pages and all
        const pages = journal.pages.filter(hasFlags).map(unset);
        if (pages.length) await journal.updateEmbeddedDocuments("JournalEntryPage", pages, { diff: false });
    }
}

/** Reset the module's world settings to their defaults; the hidden `dev` flag of a test world stays. */
async function resetSettings() {
    for (const config of game.settings.settings.values()) {
        if (config.namespace !== MODULE_ID || config.scope !== "world" || config.key === "dev") continue;
        await game.settings.set(MODULE_ID, config.key, config.default);
    }
}
