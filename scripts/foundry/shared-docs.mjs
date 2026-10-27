/**
 * The shared documents (DESIGN.md 5.1, 5.2): the Workshop ledger (a JournalEntry) and the strongbox (a pf2e
 * loot actor), both with default ownership OWNER so every player can write them.
 *
 * - Players cannot create them: creating a journal needs `JOURNAL_CREATE` (default Trusted) and an actor
 *   `ACTOR_CREATE` (default Assistant). Only the active GM's client creates them, when the master switch is
 *   turned on (by any GM) or when it finds one missing, so two GMs never both create them.
 * - pf2e's `ActorPF2e.createDocuments` forces every new loot actor to LIMITED whatever the caller passes, so
 *   the strongbox gets OWNER from a follow-up update. The active GM's client checks both defaults once per
 *   session and repairs them, saying so; a GM who restricts them on purpose keeps that until the next session.
 * - A client may write them only if its user owns both: the default, and no lower level set for that user.
 * - Each carries `flags.MOD.role` ("ledger" or "strongbox") and `flags.MOD.schema`; their ids are kept in the
 *   world setting `docs`. Clients look them up by role; if two exist (two GMs racing), the oldest by
 *   `_stats.createdTime` is used and GMs are told.
 * - M12b (5.3.3): the Crafting Log, a third document, holds what archiving moves out of the ledger. Only a GM writes it (the
 *   archive write is the one thing that waits for a GM), every player reads it (OBSERVER), for the Funds tab's history. The
 *   active GM creates it with the others, and in a world that had them before M12b, at its next check. It is not part of
 *   "ready": nothing but the archive needs it.
 */
import { MODULE_ID } from "../constants.mjs";
import { compareIds } from "../logic/ids.mjs";
import { SCHEMA_VERSION } from "../logic/migrations.mjs";
import { holdsLease } from "./lease.mjs";
import { isEnabled, setting } from "./settings.mjs";
import { sharedOwnership, writable } from "./state.mjs";

const ownerLevel = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

/** A document's role flag, read directly (`getFlag` throws while the module's scope is inactive). */
export const roleOf = (doc) => doc?.flags?.[MODULE_ID]?.role ?? null;

/** Oldest first: creation time, then id. */
const oldestFirst = (a, b) => (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0) || compareIds(a.id, b.id);

/** The documents of `collection` with `role`, oldest first. */
function withRole(collection, role) {
    return collection.filter((doc) => roleOf(doc) === role).sort(oldestFirst);
}

/**
 * Find the shared documents. `ready` is false when one is missing, not owned by every player, or not owned by
 * this user.
 * @returns {{ledger: JournalEntry|null, strongbox: Actor|null, ready: boolean, duplicates: Document[]}}
 */
export function locateShared() {
    const ledgers = withRole(game.journal, "ledger");
    const strongboxes = withRole(game.actors, "strongbox");
    const ledger = ledgers[0] ?? null;
    const strongbox = strongboxes[0] ?? null;
    const ready = writable(ledger) && writable(strongbox);
    return { ledger, strongbox, ready, duplicates: [...ledgers.slice(1), ...strongboxes.slice(1)] };
}

/**
 * The Crafting Log (M12b, 5.3.3): the oldest journal with the archive role, or null. GM-owned, readable by every player.
 * @returns {JournalEntry|null}
 */
export function locateArchive() {
    return withRole(game.journal, "archive")[0] ?? null;
}

/** The flags every shared document is created with. */
const createFlags = (role) => ({ [MODULE_ID]: { role, schema: SCHEMA_VERSION } });

/** The "module data" folder for the ledger, created if missing. */
async function ledgerFolder() {
    const existing = game.folders.find((f) => f.type === "JournalEntry" && roleOf(f) === "folder");
    if (existing) return existing;
    return Folder.implementation.create({
        name: game.i18n.localize("pf2e-artisans-workshop.Documents.FolderName"), type: "JournalEntry",
        flags: { [MODULE_ID]: { role: "folder" } },
    });
}

/** Set default ownership OWNER where it is not (pf2e's loot override, or a GM's edit). Returns what it repaired. */
export async function repairOwnership(docs) {
    const repaired = [];
    for (const doc of docs) {
        if (!doc || sharedOwnership(doc)) continue;
        await doc.update({ "ownership.default": ownerLevel() });
        repaired.push(doc);
    }
    return repaired;
}

/** The creation in progress on this client, so a second call waits for it instead of creating again. */
let creating = null;

/**
 * Create whichever shared document is missing, repair ownership, and record the ids. GM only; the active GM's
 * `gmMaintenance` calls it.
 */
export function createShared() {
    if (!game.user.isGM) return Promise.reject(new Error(`${MODULE_ID} | only a GM creates the shared documents`));
    creating ??= createMissing().finally(() => { creating = null; });
    return creating;
}

async function createMissing() {
    let { ledger, strongbox } = locateShared();
    if (!ledger) {
        const folder = await ledgerFolder();
        ledger = await JournalEntry.implementation.create({
            name: game.i18n.localize("pf2e-artisans-workshop.Documents.LedgerName"), folder: folder.id,
            ownership: { default: ownerLevel() }, flags: createFlags("ledger"),
        });
    }
    if (!strongbox) {
        strongbox = await Actor.implementation.create({
            name: game.i18n.localize("pf2e-artisans-workshop.Documents.StrongboxName"), type: "loot",
            ownership: { default: ownerLevel() }, flags: createFlags("strongbox"),
        });
    }
    await repairOwnership([ledger, strongbox]);
    await recordIds({ ledger, strongbox });
    await createArchive();
    return { ledger, strongbox };
}

/**
 * Create the Crafting Log if it is missing (M12b, 5.3.3): in the module's folder, default ownership OBSERVER, so every
 * player reads the archived history and only a GM writes it. GM only, from the active GM's check.
 */
async function createArchive() {
    if (locateArchive()) return null;
    const folder = await ledgerFolder();
    return JournalEntry.implementation.create({
        name: game.i18n.localize("pf2e-artisans-workshop.Documents.ArchiveName"), folder: folder.id,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: createFlags("archive"),
    });
}

/** Keep the `docs` setting pointing at the documents in use. */
async function recordIds({ ledger, strongbox }) {
    const ids = { ledger: ledger.id, strongbox: strongbox.id };
    const current = setting("docs") ?? {};
    if (current.ledger !== ids.ledger || current.strongbox !== ids.strongbox) await game.settings.set(MODULE_ID, "docs", ids);
}

/** Duplicates this GM has been told about this session. */
const warned = new Set();
/** Whether this session's ownership check is still to come. */
let repairDue = true;

/**
 * A GM's part of each check (5.2), on the tab holding the user's lease: with the master switch on, the active GM
 * creates what is missing, repairs ownership once per session (not on every check, so a GM who restricts a
 * document on purpose is not overruled at once), and keeps the `docs` setting in step; every GM hears about
 * duplicates. With the switch off, nothing is written (P10).
 */
export async function gmMaintenance() {
    if (!game.user.isGM || !isEnabled() || !holdsLease()) return;
    const found = locateShared();
    const active = game.users.activeGM?.isSelf === true;
    if (active && (!found.ledger || !found.strongbox)) {
        await createShared();
        repairDue = false;
        return;
    }
    if (active && repairDue) {
        repairDue = false;
        for (const doc of await repairOwnership([found.ledger, found.strongbox])) {
            ui.notifications.info("pf2e-artisans-workshop.Sync.OwnershipRepaired", { format: { name: doc.name } });
        }
    }
    if (active && found.ledger && found.strongbox) {
        await recordIds(found);
        // M12b: the Crafting Log, in a world whose shared documents came before it.
        if (!locateArchive()) await createArchive();
    }
    for (const doc of found.duplicates.filter((d) => !warned.has(d.uuid))) {
        warned.add(doc.uuid);
        ui.notifications.warn("pf2e-artisans-workshop.Sync.Duplicate", { format: { name: doc.name } });
    }
}

/** For tests only. */
export function resetMaintenance() {
    warned.clear();
    repairDue = true;
    creating = null;
}
