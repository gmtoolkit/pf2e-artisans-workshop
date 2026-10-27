/**
 * Claims (DESIGN.md 5.5): effects on a document the acting user does not own, recorded in the ledger and
 * applied by the target's responsible client. Pure: the records, which ones a client should apply, the row a
 * claim writes when applied, and the checks the GM relay makes (5.7).
 *
 * A ledger claim is `claims.<id> = {id, v, kind, idem, actor, cp?, order?, garden?, job?, day?, parties, by, at,
 * resolved?}`: `actor` is the target actor's UUID, `parties` the UUIDs of the actors the claim came from (the
 * order's requester and crafter, a wage's job owner), `resolved = {by, at}` once applied. Its id is the hash
 * of its idempotency key, which is also the key of the row that applying it writes, so a claim and a direct
 * move for the same key share one lock page (5.4). Deliveries are shelf items in the strongbox, not ledger
 * claims (4.7).
 */
import { compareRows, requireCp } from "./core.mjs";
import { hashId } from "./ids.mjs";
import { liveRecords } from "./keypath.mjs";

export const CLAIM_VERSION = 1;

/** Claim kinds (5.5) and the row each one writes when applied, if it moves coins. */
const CLAIM_ROWS = Object.freeze({
    refund: "refund",
    wage: "wage",
    // M10 (12.2, 12.4): an extension's income into a purse the paying user does not own, minted by the owner's client.
    income: "income",
});

/** Every claim kind of 5.5 except deliveries; later milestones register their appliers. */
export const CLAIM_KINDS = Object.freeze(["refund", "wage", "formula", "expiry", "invest", "exposure", "coating-spend", "income"]);

/**
 * A claim record.
 * @param {object} p
 * @param {string} p.kind
 * @param {string} p.idem       the idempotency key: for a refund or wage, the key of the row it will write
 * @param {string} p.actor      target actor UUID
 * @param {string[]} [p.parties]
 * @param {{by: string, at: object}} stamp
 */
export function makeClaim({ kind, idem, actor, parties = [], ...fields }, stamp) {
    if (!CLAIM_KINDS.includes(kind)) throw new RangeError(`unknown claim kind ${kind}`);
    if (typeof actor !== "string" || !actor) throw new TypeError("a claim needs its target actor's UUID");
    if (kind in CLAIM_ROWS) requireCp(fields.cp, "cp");
    return { id: hashId(idem), v: CLAIM_VERSION, kind, idem, actor, parties: [...parties], ...fields, by: stamp.by, at: stamp.at };
}

/** The unresolved claims, earliest first, optionally only those targeting one actor. */
export function openClaims(claims, actorUuid = null) {
    return liveRecords(claims)
        .filter((claim) => !claim.resolved && (actorUuid === null || claim.actor === actorUuid))
        .sort(compareRows);   // earliest first
}

/**
 * The row applying a coin claim writes, as `makeRow` input: a refund moves coins strongbox to purse, a wage
 * mints them into the purse. Null for kinds that move no coins.
 */
export function claimRowInput(claim) {
    const kind = CLAIM_ROWS[claim.kind];
    if (!kind) return null;
    // M10: income is minted into the purse and names the extension it came from.
    const income = kind === "income" ? { how: { via: "purse" }, source: claim.source ?? null, note: claim.note ?? null } : {};
    return { kind, idem: claim.idem, cp: claim.cp, actor: claim.actor, order: claim.order ?? null,
        garden: claim.garden ?? null, job: claim.job ?? null, day: claim.day ?? null, ...income };
}

/**
 * Whether the GM relay may apply a claim for a requester (5.7): it exists and is open, targets the actor
 * named in the request, no owner of that actor is connected (that owner's client applies it, so a purse
 * never has two writers), and the requester made the claim or owns one of the actors it came from.
 *
 * @param {object|undefined} claim
 * @param {object} request
 * @param {string} request.actorUuid
 * @param {string} request.userId          the requesting user
 * @param {Set<string>} request.ownedUuids  actors the requesting user owns
 * @param {boolean} request.ownerConnected  a non-GM owner of the target actor is connected
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function relayDecision(claim, { actorUuid, userId, ownedUuids, ownerConnected }) {
    if (!claim) return { ok: false, reason: "unknown" };
    if (claim.actor !== actorUuid) return { ok: false, reason: "wrong-actor" };
    if (claim.resolved) return { ok: false, reason: "resolved" };
    if (ownerConnected) return { ok: false, reason: "owner-connected" };
    const party = claim.by === userId || (claim.parties ?? []).some((uuid) => ownedUuids.has(uuid));
    return party ? { ok: true } : { ok: false, reason: "not-party" };
}
