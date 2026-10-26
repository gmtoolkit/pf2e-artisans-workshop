/**
 * The GM relay (DESIGN.md 5.7): an accelerator over core `CONFIG.queries`, never a requirement. A connected GM
 * already applies claims for offline owners through the ordinary sweep (the active GM is the fallback
 * responsible user); the relay lets a client ask for that now and wait for the answer.
 *
 * - Query `pf2e-artisans-workshop.relay`, registered at `init`. Sending one needs `QUERY_USER` (default role
 *   Player). Operations: `ping` (version check) and `applyClaims({actorUuid})`; any other answers
 *   "unsupported" (`expireFor` comes with M7).
 * - The server forwards a user query to every socket of that user and settles it with the first answer
 *   (Foundry 14.368 `dist/components/activity.mjs`). Only the GM tab holding the lease answers; the others stay
 *   silent, so a GM in two tabs applies a claim once.
 * - With no socket to forward to, the server never answers, so the client gives up after its own timeout.
 * - `applyClaims` checks each claim against stored state (`relayDecision`) and declines when an owner of the
 *   target is connected (that owner's client applies it, so a purse never has two writers). It applies with the
 *   same lock-first batches as an owner's client.
 */
import { MODULE_ID } from "../constants.mjs";
import { openClaims, relayDecision } from "../logic/claims.mjs";
import { SCHEMA_VERSION } from "../logic/migrations.mjs";
import { applyClaim, deliver, shelfItemsFor } from "./claims.mjs";
import { holdsLease } from "./lease.mjs";
import { ownerConnected } from "./responsible.mjs";
import { canWrite } from "./state.mjs";
import { read } from "./store.mjs";

export const RELAY = "pf2e-artisans-workshop.relay";

/** Register the query handler, at `init`. */
export function registerRelay() {
    CONFIG.queries[RELAY] = handleRelay;
}

/**
 * The handler, on the GM's client: `(data, {user})`, `user` being the querying user.
 * @returns {Promise<object>}
 */
export function handleRelay(data, { user }) {
    if (!holdsLease()) return new Promise(() => {});   // another tab of this user answers
    switch (data?.op) {
        case "ping":
            return Promise.resolve({ ok: true, version: game.modules.get(MODULE_ID).version, schema: SCHEMA_VERSION });
        case "applyClaims":
            return applyFor(data.actorUuid, user);
        default:
            return Promise.resolve({ ok: false, reason: "unsupported" });
    }
}

/** Apply the open claims and shelf items for one actor on behalf of `user`. */
async function applyFor(actorUuid, user) {
    if (!game.user.isGM) return { ok: false, reason: "not-gm" };
    if (!canWrite()) return { ok: false, reason: "not-ready" };
    const actor = typeof actorUuid === "string" ? fromUuidSync(actorUuid) : null;
    if (!actor) return { ok: false, reason: "unknown-actor" };
    const request = {
        actorUuid, userId: user.id, ownerConnected: ownerConnected(actor),
        ownedUuids: new Set(game.actors.filter((a) => a.testUserPermission(user, "OWNER")).map((a) => a.uuid)),
    };
    const results = [];
    for (const claim of openClaims(read("claims"), actorUuid)) {
        const decision = relayDecision(claim, request);
        results.push({ id: claim.id, ...(decision.ok ? await applyClaim(claim, actor) : decision) });
    }
    for (const item of shelfItemsFor(actorUuid)) {
        const shelf = item.flags[MODULE_ID].shelf;
        const decision = relayDecision({ actor: shelf.for, parties: [shelf.from] }, request);   // the crafter's side may ask
        results.push({ id: item.id, ...(decision.ok ? await deliver(item, actor) : decision) });
    }
    return { ok: true, results: results.map(({ id, ok, outcome, reason }) => ({ id, ok, outcome, reason })) };
}

/** Wait for `promise`, or give up after `ms`. */
function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ask the active GM to apply an actor's claims now (for example to show "delivered"). Never required: with no
 * GM, or on any failure, the claims stay pending until an owner's client applies them.
 */
export async function requestApplyNow(actorUuid, { timeout = 10000 } = {}) {
    const gm = game.users.activeGM;
    if (!gm) return { ok: false, reason: "no-gm" };
    const data = { op: "applyClaims", actorUuid };
    try {
        // A query to oneself is not short-circuited by core, so the GM's own client calls the handler.
        if (gm.isSelf) return holdsLease() ? await handleRelay(data, { user: game.user }) : { ok: false, reason: "other-tab" };
        return await withTimeout(gm.query(RELAY, data, { timeout }), timeout + 1000);
    } catch (error) {
        console.warn(`${MODULE_ID} | relay failed`, error);
        return { ok: false, reason: "failed" };
    }
}

/** Ask the active GM's client which module version and schema it runs. */
export async function pingGM({ timeout = 5000 } = {}) {
    const gm = game.users.activeGM;
    if (!gm || gm.isSelf) return null;
    try {
        return await withTimeout(gm.query(RELAY, { op: "ping" }, { timeout }), timeout + 1000);
    } catch {
        return null;
    }
}
