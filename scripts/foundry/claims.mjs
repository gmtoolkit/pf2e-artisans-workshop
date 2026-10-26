/**
 * Claims (DESIGN.md 5.5): what lands on an actor its acting user does not own is recorded in the ledger (or,
 * for a finished item, put on the pickup shelf in the strongbox), and the target's responsible client applies
 * it with one lock-first move. Nothing is lost while a player is away: the sweep at `ready`, when a user
 * connects or disconnects, and when the ledger's claims change applies every claim this tab is responsible
 * for.
 *
 * M2 applies refunds, wages and deliveries; later milestones add appliers for the other kinds of 5.5 with
 * `registerClaimKind`.
 */
import { MODULE_ID } from "../constants.mjs";
import { claimRowInput, makeClaim, openClaims } from "../logic/claims.mjs";
import { stampTime } from "../logic/core.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { lockFirstBatch, recreateLockId } from "../logic/lock-first.mjs";
import { makeRow } from "../logic/rows.mjs";
import { PENDING_GRACE_MS } from "../logic/reconcile.mjs";
import { runLockFirst } from "./batch.mjs";
import { withCoinMutex } from "./lease.mjs";
import { mint, noteStopped, payout } from "./money.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { setting } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { exists, read, records, serverNow, stampNow, write } from "./store.mjs";

/** Appliers by claim kind: `(claim, actor) => Promise<{ok, outcome}>`. */
const APPLIERS = new Map([
    ["refund", (claim, actor) => payout({ actor, row: claimRowInput(claim), ledger: resolved(claim) })],
    ["wage", (claim, actor) => mint({ actor, row: claimRowInput(claim), ledger: resolved(claim) })],
]);

/** Add the applier of a claim kind (later milestones: formula, expiry, invest, exposure, coating-spend). */
export function registerClaimKind(kind, applier) {
    APPLIERS.set(kind, applier);
}

/** The ledger change that marks a claim applied, written with its row's lock (the fast-path check). */
const resolved = (claim) => ({ set: { [`claims.${claim.id}.resolved`]: stampNow() } });

/** Record claims in the ledger (`makeClaim` input objects). Writing one twice writes the same key. */
export async function createClaims(inputs) {
    const stamp = stampNow();
    const claims = inputs.map((input) => makeClaim(input, stamp)).filter((claim) => !exists(`claims.${claim.id}`));
    if (!claims.length) return [];
    await write({ set: Object.fromEntries(claims.map((claim) => [`claims.${claim.id}`, claim])) });
    return claims;
}

/**
 * Apply one claim to its (local) target actor. A row someone already wrote for the same key resolves it, unless the
 * move that wrote it resolved the claim already (with its lock), whose resolution stands.
 */
export async function applyClaim(claim, actor) {
    const applier = APPLIERS.get(claim.kind);
    if (!applier) return { ok: false, reason: "unsupported" };
    const result = await applier(claim, actor);
    if (result.outcome === "already" && !read(`claims.${claim.id}.resolved`)) await write(resolved(claim));
    return result;
}

/** The idempotency key of a shelf item's delivery: the key its creator gave it, else one from its id. */
export const shelfKey = (item) => item.flags?.[MODULE_ID]?.shelf?.claimKey ?? idemKey("deliver", item.id);

/** The item data a delivered item is created from: the shelf item without its shelf flag or strongbox container. */
function deliveredSource(item, rowId) {
    const source = item.toObject();
    delete source._id;
    delete source.flags[MODULE_ID].shelf;
    source.flags[MODULE_ID].delivered = { row: rowId };
    if (source.system?.containerId) source.system.containerId = null;   // a strongbox container is not the recipient's
    return source;
}

/**
 * Deliver a shelf item to its recipient (5.5). The lock names the `delivered` row and the shelf item (as every
 * strongbox item a move deletes); the row carries the item's source snapshot; then the shelf item is deleted and
 * the item created on the recipient, flagged with the row so reconciliation can tell whether it arrived.
 *
 * The item is looked up again inside the mutex: a sweep (or the relay) that started earlier may hold an item
 * another delivery has since taken, and pf2e would quietly drop its deletion from the request.
 */
export function deliver(item, recipient) {
    return withCoinMutex(game.user.id, async () => {
        if (!canWrite()) return { ok: false, reason: "not-ready" };
        const idem = shelfKey(item);
        if (exists(`rows.${hashId(idem)}`)) return { ok: true, outcome: "already" };   // fast path
        const current = shared().strongbox?.items.get(item.id);
        if (!current?.flags?.[MODULE_ID]?.shelf) return { ok: false, reason: "gone" };
        const shelf = current.flags[MODULE_ID].shelf;
        const source = deliveredSource(current, hashId(idem));
        const row = makeRow({ kind: "delivered", idem, cp: 0, actor: recipient.uuid, order: shelf.order ?? null,
            items: [{ uuid: current._stats?.compendiumSource ?? null, name: current.name, qty: current.quantity, source }] }, stampNow());
        const batch = lockFirstBatch({
            rowIds: [row.id], lockIds: [row.id, current.id], ledger: { set: { [`rows.${row.id}`]: row } },
            debits: [{ target: "strongbox", plan: { deletes: [current.id] } }], items: [{ target: recipient.uuid, data: [source] }],
        });
        const result = await runLockFirst(batch);
        return { ok: result.outcome === "ok", outcome: result.outcome, reason: result.reason, rows: [row] };
    });
}

/**
 * Finish a delivery whose move stopped after its lock (4.7): if the item reached the recipient only the settle is
 * missing; otherwise re-create it from the row's snapshot, removing the shelf item if it is still there. The
 * delivery's own lock pages exist, so the re-creation takes a lock of its own, `recreate:<row id>`
 * (`recreateLockId`), and happens once; a close of the row by hand takes the same lock, so only one of the two lands.
 */
export function finishDelivery(row, recipient) {
    return withCoinMutex(game.user.id, async () => {
        if (!canWrite()) return { ok: false, reason: "not-ready" };
        if (read(`rows.${row.id}.state`) !== "pending") return { ok: true, outcome: "already" };
        const arrived = recipient.items.some((i) => i.flags?.[MODULE_ID]?.delivered?.row === row.id);
        if (arrived) {
            await write({ set: { [`rows.${row.id}.state`]: "applied" } });
            return { ok: true, outcome: "settled" };
        }
        const source = row.items?.[0]?.source;
        if (!source) return { ok: false, reason: "no-snapshot" };
        const leftover = shelfItemsFor().filter((i) => shelfKey(i) === row.idem).map((i) => i.id);
        const batch = lockFirstBatch({
            rowIds: [row.id], lockIds: [recreateLockId(row.id)],
            ledger: { set: { [`rows.${row.id}.recreated`]: stampNow() } },
            debits: leftover.length ? [{ target: "strongbox", plan: { deletes: leftover } }] : [],
            items: [{ target: recipient.uuid, data: [source] }],
        });
        const result = await runLockFirst(batch);
        return { ok: result.outcome === "ok", outcome: result.outcome, reason: result.reason };
    });
}

/** Shelf items in the strongbox waiting for `actorUuid` (all of them when null). */
export function shelfItemsFor(actorUuid = null) {
    const items = shared().strongbox?.items ?? [];
    return items.filter((i) => {
        const shelf = i.flags?.[MODULE_ID]?.shelf;
        return shelf && (actorUuid === null || shelf.for === actorUuid);
    });
}

/** Ids of the claims and shelf items this client has already told its user about (auto-claim off). */
const announced = new Set();
/** Ids of the claims, shelf items and rows that failed on this client this session: not retried until reload. */
const failed = new Set();

/**
 * Run one sweep item, on its own: a claim or shelf item that throws, or that this client cannot build a move
 * for, is logged and left alone for the rest of the session, so it cannot hold up the others.
 * @returns {Promise<object|null>}  the item's result, or null when it was skipped or failed
 */
async function attempt(key, run) {
    if (failed.has(key)) return null;
    try {
        const result = await run();
        if (result?.outcome === "error") failed.add(key);
        return result;
    } catch (error) {
        failed.add(key);
        console.error(`${MODULE_ID} | ${key} could not be applied; it is left until this client reloads`, error);
        return null;
    }
}

/**
 * Apply every open claim and shelf item whose target this tab is responsible for. With the user's auto-claim
 * setting off, tell them once instead; the interface (M4) offers "Take it".
 * @returns {Promise<number>}  how many were applied
 */
export async function sweepClaims({ force = false } = {}) {
    if (!canWrite()) return 0;
    const auto = force || setting("claims.auto") !== false;
    let applied = 0;
    const waiting = new Map();
    const work = [
        ...openClaims(read("claims")).map((claim) => ({ key: claim.id, uuid: claim.actor, run: (actor) => applyClaim(claim, actor) })),
        ...shelfItemsFor().map((item) => ({ key: item.id, uuid: item.flags[MODULE_ID].shelf.for, run: (actor) => deliver(item, actor) })),
    ];
    for (const { key, uuid, run } of work) {
        const result = await attempt(key, async () => {
            const actor = fromUuidSync(uuid);
            if (!actor || !isResponsibleFor(actor)) return null;
            if (auto) return run(actor);
            if (!announced.has(key)) waiting.set(actor.name, (waiting.get(actor.name) ?? 0) + 1);
            announced.add(key);
            return null;
        });
        if (result?.ok) applied += 1;
    }
    for (const [name, count] of waiting) {
        ui.notifications.info("pf2e-artisans-workshop.Claims.Waiting", { format: { actor: name, count: String(count) } });
    }
    return applied;
}

/**
 * Re-create lost deliveries for the recipients this tab is responsible for (pending rows past the grace time). A
 * re-creation that fails on this client is left until it reloads (`attempt`), and nothing else re-creates it while
 * this client is the recipient's responsible one, so the row is noted as stopped (reason "error"): every client then
 * reads it as needing a hand, and its author is told (`reportOwnPending`). After a reload it is tried again, and a
 * close by hand takes the lock that takes, so only one of the two lands.
 */
export async function sweepDeliveries() {
    if (!canWrite()) return 0;
    let finished = 0;
    const now = serverNow();
    for (const row of records("rows")) {
        if (row.kind !== "delivered" || row.state !== "pending" || now - stampTime(row.at) < PENDING_GRACE_MS) continue;
        const result = await attempt(row.id, async () => {
            const recipient = fromUuidSync(row.actor);
            return recipient && isResponsibleFor(recipient) ? finishDelivery(row, recipient) : null;
        });
        if (result?.ok) finished += 1;
        else if (failed.has(row.id) && !row.stopped) await noteStopped([row], { applied: 0, total: null, reason: "error" });
    }
    return finished;
}

/** For tests only. */
export function resetClaims() {
    announced.clear();
    failed.clear();
}
