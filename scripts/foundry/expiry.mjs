/**
 * Party-wide expiry on this client (DESIGN.md 4.12, 7.7, M7). The system deletes temporary items only on the actor that
 * rests, so an infused item handed to an ally would outlive its creator's next daily preparations; the module stamps
 * what a preparation makes (`flags.MOD.expiry`, `scripts/foundry/morning.mjs`) and marks it inert, wherever it is, once
 * its creator's cycle moves on, 24 hours pass (Advanced Alchemy), or the wizard logs the next day.
 *
 * - **The cycle.** A creator's `pcs.<actorId>.prepCycle` goes up when the creator makes daily preparations (at a rest, 7.8;
 *   on a downtime day only with preparation, 7.2), behind the lock page `cycle:<actorId>:<from>` so two devices raise
 *   it once, with one expiry claim (`kind: "expiry"`, 5.5) whose applier, the creator's responsible client, covers the
 *   strongbox and the pickup shelf.
 * - **Holders.** Every client looks at the actors it is responsible for (5.6) when the ledger's `pcs`, `claims` or logged
 *   days change, when world time moves (the `at` deadlines), when a stamped item arrives, and at the catch-up sweep, and
 *   marks what expired. Idempotent: an inert item is never marked twice (P5).
 * - **Inert** (`expiry.action`, 14.2): `flags.MOD.inert = true` and the "(inert)" name, the original name kept in
 *   `flags.MOD.inertFrom`; or, under the other setting, the item is deleted. A `preCreateChatMessage` guard cancels a
 *   chat message that uses or strikes with an inert item and says why (OQ-19: pf2e takes the consumable's quantity before
 *   the message, so the guard stops the effect's card, not the count).
 * - **Exceptions**: an item whose stamp is `exempt` (Food Preservation's designation) never expires here while its
 *   creator still holds the designation (`flags.MOD.morning.preserved`); one pushed past the cap spoils at once, and is
 *   made temporary again so the holder's next rest deletes it. Affliction effects already running (8.10.10) are M8a's.
 */
import { MODULE_ID } from "../constants.mjs";
import { pcStatusOf } from "../logic/downtime.mjs";
import { actorIdOf, expiryReason } from "../logic/expiry.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { makeClaim } from "../logic/claims.mjs";
import { runRequest } from "./batch.mjs";
import { registerClaimKind } from "./claims.mjs";
import { today } from "./downtime.mjs";
import { isElected, isResponsibleFor } from "./responsible.mjs";
import { setting } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { read, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/** Whether party-wide expiry is on (14.1 `features.expiry`). */
export const expiryOn = () => setting("features.expiry") !== false;

/** An item's expiry stamp, or null. */
export const stampOf = (item) => item?.flags?.[MODULE_ID]?.expiry ?? null;

/** Whether an item is inert (7.7). */
export const isInert = (item) => item?.flags?.[MODULE_ID]?.inert === true;

/** A creator's preparation cycle now (`pcs.<actorId>.prepCycle`), or null for a creator that is not an actor of this world. */
export function cycleOf(creatorUuid) {
    const id = actorIdOf(creatorUuid);
    return id ? pcStatusOf(read("pcs") ?? {}, id).prepCycle : null;
}

/** World time and the highest logged day, which the `at` and `atDay` deadlines are read against. */
function nowFacts() {
    let loggedDay;
    try {
        loggedDay = today().manualDay ?? null;
    } catch {
        loggedDay = null;
    }
    return { worldTime: game.time.worldTime ?? 0, loggedDay };
}

/**
 * The ids of a creator's Food Preservation designations that stand (`flags.MOD.morning.preserved`, 7.7), or null when the
 * creator cannot be read (its preserved foods stay preserved).
 */
export function designationsOf(creatorUuid) {
    const creator = typeof creatorUuid === "string" ? fromUuidSync(creatorUuid, { strict: false }) : null;
    if (!creator) return null;
    const list = creator.flags?.[MODULE_ID]?.morning?.preserved;
    return new Set(Array.isArray(list) ? list.map((d) => d?.id).filter(Boolean) : []);
}

/** Why `item` has expired now, or null. */
export function expiredWhy(item, now = nowFacts()) {
    const stamp = stampOf(item);
    if (!stamp) return null;
    return expiryReason(stamp, { creatorCycle: cycleOf(stamp.creator), worldTime: now.worldTime, loggedDay: now.loggedDay, inert: isInert(item),
        designations: stamp.exempt?.id ? designationsOf(stamp.creator) : null });
}

/** The name an inert item takes, without stacking the suffix. */
function inertName(item) {
    const original = item.flags?.[MODULE_ID]?.inertFrom?.name ?? item.name;
    return game.i18n.format("pf2e-artisans-workshop.Expiry.InertName", { name: original });
}

/**
 * Mark expired items of one actor inert (or delete them, `expiry.action`), in one update each way. Returns what was
 * marked, `[{id, name, reason, creator}]`.
 */
export async function expireItems(actor, items, now = nowFacts()) {
    const due = [];
    for (const item of items) {
        const reason = expiredWhy(item, now);
        if (reason) due.push({ item, reason });
    }
    if (!due.length) return [];
    const marked = due.map(({ item, reason }) => ({ id: item.id, name: item.name, reason, creator: stampOf(item)?.creator ?? null }));
    if (setting("expiry.action") === "delete") {
        await actor.deleteEmbeddedDocuments("Item", due.map(({ item }) => item.id));
        return marked;
    }
    const at = stampNow().at;
    await actor.updateEmbeddedDocuments("Item", due.map(({ item, reason }) => ({
        _id: item.id, name: inertName(item),
        [`flags.${MODULE_ID}.inert`]: true,
        [`flags.${MODULE_ID}.inertFrom`]: { name: item.flags?.[MODULE_ID]?.inertFrom?.name ?? item.name, reason, at },
        // A preserved food was made permanent so a rest would not delete it; spoiled, it is temporary again (7.7).
        ...(item.system?.temporary === false && stampOf(item)?.exempt ? { "system.temporary": true } : {}),
    })));
    return marked;
}

/** The physical items of an actor that carry a stamp and are not inert yet. */
const stampedItems = (actor) => (actor?.items ?? []).filter((item) => stampOf(item) && !isInert(item));

/**
 * The strongbox's stamped items this tab marks: those whose creator it is responsible for (7.7: the creator's client
 * covers the strongbox and the shelf), and, for a creator that is gone, the elected client.
 */
function strongboxShare(strongbox) {
    return stampedItems(strongbox).filter((item) => {
        const creator = fromUuidSync(stampOf(item).creator, { strict: false });
        return creator ? isResponsibleFor(creator) : isElected();
    });
}

/** The sweep running on this client, and whether another was asked for meanwhile. */
let sweeping = null;
let sweepAgain = false;

/**
 * Mark everything that expired among the actors this tab is responsible for, and the strongbox's share (P5: idempotent,
 * so the catch-up sweep can always run it). Posts one Expiry card per holder that lost something.
 *
 * Single-flight on this client: a sweep asked for while one runs (the timer, the catch-up sweep, the expiry claim, all
 * started by one cycle raise) runs once more after it, never beside it. Foundry changes a local document only when the
 * server answers, so two passes at once would both see an item as live and mark it twice (two Expiry cards; under
 * `delete`, a second delete of an item already gone). Resolves with everything marked by the passes it waited for.
 * @returns {Promise<{holder: string, items: object[]}[]>}
 */
export function expirySweep() {
    if (sweeping) {
        sweepAgain = true;
        return sweeping;
    }
    sweeping = (async () => {
        const out = [];
        try {
            do {
                sweepAgain = false;
                out.push(...await sweepOnce());
            } while (sweepAgain);
            return out;
        } finally {
            sweeping = null;
        }
    })();
    return sweeping;
}

/** One pass of the sweep (`expirySweep`). */
async function sweepOnce() {
    if (!canWrite() || !expiryOn()) return [];
    const now = nowFacts();
    const out = [];
    const strongbox = shared().strongbox;
    for (const actor of game.actors ?? []) {
        if (actor === strongbox) continue;
        const items = stampedItems(actor);
        if (!items.length || !isResponsibleFor(actor)) continue;
        const marked = await expireItems(actor, items, now);
        if (marked.length) out.push({ holder: actor, items: marked });
    }
    if (strongbox) {
        const marked = await expireItems(strongbox, strongboxShare(strongbox), now);
        if (marked.length) out.push({ holder: strongbox, items: marked });
    }
    for (const { holder, items } of out) {
        Hooks.callAll("pf2e-artisans-workshop.itemsExpired", Object.freeze({ holder, items }));
    }
    return out.map(({ holder, items }) => ({ holder: holder.uuid, items }));
}

/** Run the sweep once changes stop for a moment (world time moves in many small steps). */
let timer = null;
export function scheduleExpiry(ms = 400) {
    clearTimeout(timer);
    timer = setTimeout(() => {
        expirySweep().catch((error) => console.error(`${MODULE_ID} | expiry sweep failed`, error));
    }, ms);
}

/* -------------------------------------------- */
/*  The preparation cycle                        */
/* -------------------------------------------- */

/** The status fields written with every change, so the record is never a stub (5.3.3). */
const statusBase = (actorId, stamp) => ({ [`pcs.${actorId}.id`]: actorId, [`pcs.${actorId}.v`]: 1, [`pcs.${actorId}.by`]: stamp.by,
    [`pcs.${actorId}.at`]: stamp.at });

/** The lock page that lets one client raise a creator's cycle from `from` (7.7). */
export const cycleLockId = (actorId, from) => hashId(idemKey("cycle", actorId, String(from)));

/**
 * Begin a new preparation cycle for `actor` (7.7): `prepCycle` goes up by one, behind the lock page of the cycle it
 * leaves, with one expiry claim for the creator's responsible client. `key` names what caused it (a rest's chat message,
 * a "prepare for a new day"); the same key raises the cycle once (`pcs.<actorId>.cycleKey`). The client that raises it
 * runs the expiry sweep at once.
 *
 * @returns {Promise<{ok: boolean, outcome?: string, cycle?: number, reason?: string}>}
 */
export async function beginCycle(actor, { key = null, reason = "rest" } = {}) {
    if (!canWrite()) return refuse("not-ready");
    if (!actor) return refuse("no-actor");
    const status = pcStatusOf(read("pcs") ?? {}, actor.id);
    if (key && status.cycleKey === key) return { ok: true, outcome: "already", cycle: status.prepCycle };
    const from = Number.isInteger(status.prepCycle) ? status.prepCycle : 0;
    const to = from + 1;
    const stamp = stampNow();
    const claim = makeClaim({ kind: "expiry", idem: idemKey("expiry", actor.uuid, String(to)), actor: actor.uuid, parties: [actor.uuid], cycle: to, reason }, stamp);
    const set = {
        ...statusBase(actor.id, stamp), [`pcs.${actor.id}.prepCycle`]: to, [`pcs.${actor.id}.cycleAt`]: stamp.at,
        [`pcs.${actor.id}.cycleKey`]: key ?? claim.id, [`claims.${claim.id}`]: claim,
    };
    const result = await runRequest([{ op: "lock", ids: [cycleLockId(actor.id, from)] }, { op: "ledger", change: { set } }]);
    if (result.outcome === "refused") return { ok: true, outcome: "already", cycle: pcStatusOf(read("pcs") ?? {}, actor.id).prepCycle };
    if (result.outcome !== "ok") return refuse(result.reason ?? "error", { outcome: result.outcome });
    scheduleExpiry(0);
    return { ok: true, outcome: "ok", cycle: to, claim: claim.id };
}

/**
 * The expiry claim's applier (5.5), on the creator's responsible client: the sweep, whose share of the strongbox and the
 * shelf is the creator's on this client (holders' own clients mark what they hold), then the claim is resolved. It runs
 * the single-flight sweep rather than marking on its own, so it never marks an item a sweep running beside it marks too.
 */
async function applyExpiryClaim(claim) {
    await expirySweep();
    await write({ set: { [`claims.${claim.id}.resolved`]: stampNow() } });
    return { ok: true, outcome: "ok" };
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

/** Whether a chat message uses or strikes with an inert item (its pf2e origin). */
function inertOrigin(message) {
    const uuid = message?.flags?.pf2e?.origin?.uuid ?? message?._source?.flags?.pf2e?.origin?.uuid ?? null;
    if (!uuid || uuid.startsWith("Compendium.")) return null;
    const item = fromUuidSync(uuid, { strict: false });
    return item && isInert(item) ? item : null;
}

/** Hooks at `init`: the claim applier, the deadlines, holders' changes, and the chat guard. */
export function registerExpiryHooks() {
    registerClaimKind("expiry", (claim) => applyExpiryClaim(claim));
    Hooks.on("updateWorldTime", () => {
        if (expiryOn()) scheduleExpiry(1000);
    });
    Hooks.on("updateJournalEntry", (doc, changed) => {
        if (doc !== shared().ledger) return;
        const flags = changed.flags?.[MODULE_ID] ?? {};
        if ("pcs" in flags || "claims" in flags || "manual" in (flags.meta ?? {})) scheduleExpiry();
    });
    Hooks.on("createItem", (item) => {
        if (stampOf(item) && !isInert(item)) scheduleExpiry();
    });
    // A creator's Food Preservation designations changed: a food pushed past the cap spoils wherever it is (7.7).
    Hooks.on("updateActor", (actor, changed) => {
        if (changed?.flags?.[MODULE_ID]?.morning && "preserved" in changed.flags[MODULE_ID].morning && expiryOn()) scheduleExpiry();
    });
    // OQ-19: cancel a message that uses or strikes with an inert item, on the client creating it.
    Hooks.on("preCreateChatMessage", (message) => {
        const item = inertOrigin(message);
        if (!item) return true;
        ui.notifications.warn("pf2e-artisans-workshop.Expiry.Used", { format: { item: item.name } });
        return false;
    });
}

/** For tests only. */
export function resetExpiry() {
    clearTimeout(timer);
    timer = null;
    sweeping = null;
    sweepAgain = false;
}
