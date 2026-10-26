/**
 * Sending lock-first moves (DESIGN.md 5.4): the descriptors of `scripts/logic/lock-first.mjs` become Foundry
 * operations, each request goes out as one `foundry.documents.modifyBatch` call, and the result says what happened.
 *
 * What Foundry 14.368 does with a request (`client/data/client-backend.mjs` `modifyDocumentBatch`, the server's
 * handler in `dist/database/backend/server-backend.mjs`):
 * - the client first runs each operation through its document class as a dry run: pre-hooks, and pf2e's
 *   `ItemPF2e.deleteDocuments`, which drops the ids of items the actor no longer holds on this client. An
 *   operation left empty is not sent; the rest go at once;
 * - the server dry-runs every operation; if any fails it applies nothing and answers with the dry-run results;
 * - otherwise it applies them in order and stops at the first error, keeping what it applied;
 * - the client shows each error as a notification (the server's own text) and returns one result per operation
 *   that succeeded. When the server refused at its dry run, it processes the dry-run results that passed as if
 *   they had happened: created and deleted documents appear and vanish on this client only, and their hooks
 *   carry `options.dryRun`; an update is not committed (`DataModel#updateSource` returns early on a dry run).
 *
 * So before sending, `preflight` checks this client's copies, and stops a request whose lock page already exists
 * or whose items are already gone; after sending, the result counts only what the server applied, and notices
 * when the client changed an operation on the way out.
 */
import { MODULE_ID } from "../constants.mjs";
import { coinItemData } from "./coins.mjs";
import { markStale, shared } from "./state.mjs";
import { ledgerChange, stampNow } from "./store.mjs";

/**
 * How long to wait for the server's answer. A connection that drops and comes back within Foundry's five
 * seconds loses the answer without a reload (socket.io drops its acknowledgement), so without a limit the move
 * would wait for ever, holding the user's coin mutex.
 */
export const BATCH_TIMEOUT_MS = 30 * 1000;

let inBatch = false;
let refused = false;

/** The hooks whose `options.dryRun` reveals a request the server refused at its dry run. */
const WATCHED = ["JournalEntry", "JournalEntryPage", "Actor", "Item"];

/** Register the dry-run watcher once, at `init`. */
export function registerBatchWatcher() {
    for (const name of WATCHED) {
        Hooks.on(`create${name}`, (doc, options, userId) => notice("create", doc, options, userId));
        Hooks.on(`update${name}`, (doc, _changed, options, userId) => notice("update", doc, options, userId));
        Hooks.on(`delete${name}`, (doc, options, userId) => notice("delete", doc, options, userId));
    }
}

/**
 * A dry-run result processed on this client, during one of our requests or on a shared document: the server
 * refused that request. A created or deleted document now exists, or is gone, on this client only, so the
 * client goes stale (`state.mjs`); an update leaves nothing behind.
 */
function notice(kind, doc, options, userId) {
    if (!options?.dryRun || userId !== game.user.id) return;
    const { ledger, strongbox } = shared();
    const touchesShared = [doc, doc.parent].some((d) => d && (d === ledger || d === strongbox));
    if (!inBatch && !touchesShared) return;
    refused = true;
    if (kind !== "update") markStale();
}

/** The actor a descriptor targets: the strongbox, or an actor by UUID. */
function actorFor(target, strongbox) {
    const actor = target === "strongbox" ? strongbox : fromUuidSync(target);
    if (!actor) throw new Error(`${MODULE_ID} | no actor ${target}`);
    return actor;
}

/** A lock page: empty, named by its own id; its existence is the lock (5.1). */
function lockPage(id, stamp) {
    return { _id: id, name: id, type: "text", flags: { [MODULE_ID]: { lock: stamp } } };
}

/** Foundry operations for the descriptors, in the same order. Throws if a target cannot be found. */
export function toOperations(descriptors, { ledger, strongbox }) {
    const stamp = stampNow();
    return descriptors.map((d) => {
        switch (d.op) {
            case "lock":
                return { action: "create", documentName: "JournalEntryPage", parent: ledger, keepId: true,
                    data: d.ids.map((id) => lockPage(id, stamp)) };
            case "ledger":
                return { action: "update", documentName: "JournalEntry", diff: false,
                    updates: [{ _id: ledger.id, ...ledgerChange(d.change) }] };
            case "deleteItems":
                return { action: "delete", documentName: "Item", parent: actorFor(d.target, strongbox), ids: [...d.ids] };
            case "updateCoins":
                return { action: "update", documentName: "Item", parent: actorFor(d.target, strongbox),
                    updates: d.updates.map(({ id, quantity }) => ({ _id: id, "system.quantity": quantity })) };
            case "createCoins":
                return { action: "create", documentName: "Item", parent: actorFor(d.target, strongbox),
                    data: d.coins.map(({ denomination, quantity }) => coinItemData(denomination, quantity, d.lot)) };
            case "createItems":
                return { action: "create", documentName: "Item", parent: actorFor(d.target, strongbox), data: d.data };
            default:
                throw new Error(`${MODULE_ID} | unknown batch descriptor ${d.op}`);
        }
    });
}

/** How many documents an operation names. The client's dry run can shrink it on the way out. */
const sizeOf = (op) => (op.data ?? op.updates ?? op.ids ?? []).length;

/**
 * Why this client should not send `operations`, judged from its own copies, or null: "locked" when a lock page
 * the request creates exists already (another move holds it), "gone" when an item it deletes or updates is no
 * longer there (Foundry would send the request without it, or throw).
 */
export function preflight(operations) {
    for (const op of operations) {
        if (op.documentName === "JournalEntryPage" && op.action === "create" && op.data.some((d) => op.parent.pages.has(d._id))) return "locked";
        if (op.documentName === "Item" && op.action !== "create") {
            const ids = op.ids ?? op.updates.map((u) => u._id);
            if (ids.some((id) => !op.parent.items.has(id))) return "gone";
        }
    }
    return null;
}

const TIMED_OUT = Symbol("timed out");

/** What `promise` resolves to, or TIMED_OUT after `ms`. */
function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Send one request, checked first with `preflight`.
 * @returns {Promise<{outcome: "ok"|"refused"|"partial"|"error"|"unknown", applied: number, reason?: string}>}
 *   "refused": nothing applied (`reason` "locked" or "gone" before sending, "dry-run" when the server refused it,
 *   "first" when its first operation failed, "emptied" when the client sent nothing); "partial": some of it
 *   applied (`reason` "stopped" at an error, or "shrunk" when the client sent less than asked); "error": this
 *   client could not send it; "unknown": no answer in time, so this client goes stale.
 */
async function send(operations) {
    const early = preflight(operations);
    if (early) return { outcome: "refused", applied: 0, reason: early };
    const sizes = operations.map(sizeOf);
    let results;
    inBatch = true;
    refused = false;
    try {
        results = await withTimeout(foundry.documents.modifyBatch(operations), BATCH_TIMEOUT_MS);
    } catch (error) {
        console.error(`${MODULE_ID} | batch not sent`, error);
        return { outcome: "error", applied: 0, reason: "client" };
    } finally {
        inBatch = false;
    }
    if (results === TIMED_OUT) {
        markStale();   // it may yet apply, and this client would never hear
        return { outcome: "unknown", applied: 0, reason: "timeout" };
    }
    if (refused) return { outcome: "refused", applied: 0, reason: "dry-run" };
    const sent = operations.filter((op) => sizeOf(op) > 0).length;
    const shrunk = operations.some((op, i) => sizeOf(op) !== sizes[i]);
    if (sent === 0) return { outcome: "refused", applied: 0, reason: "emptied" };
    if (results.length === 0) return { outcome: "refused", applied: 0, reason: "first" };
    if (shrunk) return { outcome: "partial", applied: results.length, first: results[0], reason: "shrunk" };
    if (results.length < sent) return { outcome: "partial", applied: results.length, first: results[0], reason: "stopped" };
    return { outcome: "ok", applied: results.length };
}

/**
 * Whether a request's first result is the lock pages: the server applies operations in order and the client
 * returns a result only for those that applied, so the lock is held exactly when the first result is its pages.
 */
const lockPagesIn = (documents) => (documents ?? []).some((doc) => doc?.documentName === "JournalEntryPage");

/** Outcomes of a move, from what happened to its lock request and then its apply request. */
const AFTER_LOCK = { refused: "conflict", partial: "conflict", error: "error", unknown: "unknown" };
const AFTER_APPLY = { ok: "ok", refused: "stopped", partial: "stopped", error: "stopped", unknown: "unknown" };

/**
 * Run one lock-first move (`lockFirstBatch`): the lock request and, once the lock is held, the apply request.
 *
 * @param {{lock: object[], apply: object[]}} batch
 * @param {{ledger: JournalEntry, strongbox: Actor}} [docs]  the shared documents (the purge passes its own)
 * @returns {Promise<{outcome: "ok"|"conflict"|"stopped"|"error"|"unknown", applied: number, total: number,
 *          phase?: "lock"|"apply", reason?: string}>}
 *   "ok": everything applied; "conflict": nothing applied, the lock is someone else's (or the move's items are
 *   gone); "stopped": the lock and rows are written but not everything after them, so the rows stay pending for
 *   reconciliation; "error": this client could not build or send it, nothing applied; "unknown": no answer in
 *   time, so whether it applied is unknown and this client goes stale until reloaded.
 */
export async function runLockFirst({ lock, apply }, docs = shared()) {
    let lockOps;
    let applyOps;
    try {
        lockOps = toOperations(lock, docs);
        applyOps = toOperations(apply, docs);
    } catch (error) {
        console.error(`${MODULE_ID} | batch not built`, error);
        return { outcome: "error", applied: 0, total: lock.length + apply.length, reason: "build" };
    }
    const total = lockOps.length + applyOps.length;
    const gone = preflight(applyOps);   // no lock is taken for items already gone
    if (gone) return { outcome: "conflict", applied: 0, total, phase: "lock", reason: gone };
    const first = await send(lockOps);
    if (first.outcome !== "ok") {
        // Part of the lock request applied: the lock is held only if that part is its pages.
        const outcome = first.outcome === "partial" && lockPagesIn(first.first) ? "stopped" : AFTER_LOCK[first.outcome];
        return { outcome, applied: outcome === "stopped" ? first.applied : 0, total, phase: "lock", reason: first.reason };
    }
    const second = await send(applyOps);
    const outcome = AFTER_APPLY[second.outcome];
    if (outcome !== "ok") console.warn(`${MODULE_ID} | a move stopped after its lock (${second.reason}); its rows stay pending`);
    return { outcome, applied: first.applied + second.applied, total, phase: "apply", reason: second.reason };
}

/**
 * Send one plain request (no lock), such as the purge's move to the party stash.
 * @returns {Promise<{outcome: "ok"|"refused"|"partial"|"error"|"unknown", applied: number, reason?: string}>}
 */
export async function runRequest(descriptors, docs = shared()) {
    let operations;
    try {
        operations = toOperations(descriptors, docs);
    } catch (error) {
        console.error(`${MODULE_ID} | batch not built`, error);
        return { outcome: "error", applied: 0, reason: "build" };
    }
    return send(operations);
}
