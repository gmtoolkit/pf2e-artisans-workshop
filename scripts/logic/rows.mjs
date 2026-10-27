/**
 * Stored ledger rows (DESIGN.md 4.6): the signed `box`, `purse` and `alloc` of each kind, the row id as the
 * hash of its idempotency key, reversals, the correction sequence and the expected strongbox balance.
 *
 * The rules engine (M1) describes the rows a step would post as `{kind, cp}`, `cp` unsigned. `makeRow` turns
 * one into the stored shape; stored rows keep `cp` as well, which `committedFromRows` and the other M1
 * derivations read.
 */
import { liveRows, requireCp } from "./core.mjs";
import { hashId } from "./ids.mjs";

/** The version of the row shape (4.14: every row type carries `v`). */
export const ROW_VERSION = 1;

/**
 * Signs of `box` (strongbox coins), `purse` (the counterparty's purse) and `alloc` (the order's, garden's or
 * party fund's allocation) per kind, multiplied by the unsigned `cp` (4.6 table).
 */
const SIGNS = Object.freeze({
    pledge: [1, -1, 1],
    deposit: [1, -1, 1],
    withdraw: [-1, 1, -1],
    commit: [0, 0, 0],
    expend: [-1, 0, -1],
    release: [0, 0, 0],
    ruin: [-1, 0, -1],
    remainder: [-1, 0, -1],
    refund: [-1, 1, -1],
    wage: [0, 1, 0],
    expense: [-1, 0, -1],
    plant: [-1, 0, -1],
    delivered: [0, 0, 0],
    shelved: [0, 0, 0],
    "material-in": [0, 0, 1],
    "material-out": [0, 0, -1],
    // M5: an item handed over to the strongbox for an order (a target to etch or upgrade, an item to reverse-engineer)
    // and given back. Items only: what they are worth is not escrow (`custody-in`/`custody-out`, 0, 0, 0).
    "custody-in": [0, 0, 0],
    "custody-out": [0, 0, 0],
});

/**
 * Kinds whose signs depend on the movement: `allocate` is +n on the order and -n on the fund (`side`), or the
 * other way with `back` (an allocation returned to the fund: a cancelled order's share of a contributor whose actor is
 * gone, 6.2.4);
 * `purchase` and `income` move coins through the purse or the strongbox (`via`). Income paid into a purse
 * allocates nothing: the party fund only holds what is in the strongbox. A purchase paid from the strongbox takes its
 * coins out of the allocation that held them, the party fund's or an order's (As built in M5 on M4.1), so the strongbox
 * stays the unallocated fund plus what is earmarked (4.7).
 */
const VARIABLE = Object.freeze({
    allocate: ({ side, back = false }) => {
        const sign = side === "fund" ? -1 : side === "order" ? 1 : null;
        return sign === null ? null : [0, 0, back ? -sign : sign];
    },
    purchase: ({ via }) => (via === "box" ? [-1, 0, -1] : via === "purse" ? [0, -1, 0] : null),
    income: ({ via }) => (via === "box" ? [1, 0, 1] : via === "purse" ? [0, 1, 0] : null),
});

/** Kinds that carry explicit signed amounts: GM corrections and archive summaries. */
const EXPLICIT = new Set(["adjust", "carry"]);

/** Every kind a row may have. */
export const ROW_KINDS = Object.freeze([...Object.keys(SIGNS), ...Object.keys(VARIABLE), ...EXPLICIT, "reversal"]);

/**
 * Kinds that move nothing, neither coins nor items: bookkeeping between allocations, markers the derivations
 * read, and corrections of the expected balance. They are written by a plain key-path write; every other kind
 * moves coins or items (`material-in`, `material-out`, `delivered` and `shelved` record item movements; `shelved` is a
 * finished order's items put on the pickup shelf, M4) and is written by a
 * lock-first batch together with what it moves (4.1, 5.4).
 */
export const BOOKKEEPING_KINDS = Object.freeze(["commit", "release", "allocate", "adjust", "carry"]);

/**
 * The signed amounts of a row of `kind` for `cp` copper.
 * @param {string} kind
 * @param {number} cp  unsigned
 * @param {{side?: "fund"|"order", via?: "box"|"purse"}} [how]  for allocate, purchase and income
 * @returns {{box: number, purse: number, alloc: number}}
 */
export function signedAmounts(kind, cp, how = {}) {
    requireCp(cp, "cp");
    const signs = SIGNS[kind] ?? VARIABLE[kind]?.(how);
    if (!signs) throw new RangeError(`no fixed signs for a ${kind} row${VARIABLE[kind] ? " without side/via" : ""}`);
    const [box, purse, alloc] = signs.map((sign) => sign * cp + 0);   // + 0 turns -0 into 0
    return { box, purse, alloc };
}

/**
 * A stored row, `state: "pending"` until the batch that writes it reaches its end (5.4).
 *
 * @param {object} p
 * @param {string} p.kind
 * @param {string} p.idem     the idempotency key; the row id is its hash
 * @param {number} p.cp       unsigned amount
 * @param {object} [p.how]    `{side}` or `{via}` (signedAmounts)
 * @param {{box: number, purse: number, alloc: number}} [p.signed]  for `adjust` and `carry` only
 * @param {string|null} [p.actor]   the counterparty's actor UUID; null for the party fund
 * @param {{by: string, at: {world: number, real: number}}} stamp
 */
export function makeRow({ kind, idem, cp, how, signed, actor = null, order = null, job = null, garden = null,
    day = null, items = null, note = null, source = null, reverses = null }, stamp) {
    let amounts;
    requireCp(cp, "cp");
    if (EXPLICIT.has(kind)) {
        if (!signed) throw new TypeError(`${kind} rows need explicit signed amounts`);
        for (const value of Object.values(signed)) if (!Number.isSafeInteger(value)) throw new RangeError("signed amounts must be whole copper");
        amounts = { box: signed.box ?? 0, purse: signed.purse ?? 0, alloc: signed.alloc ?? 0 };
    } else {
        amounts = signedAmounts(kind, cp, how);
    }
    return {
        id: hashId(idem), v: ROW_VERSION, kind, idem, cp, ...amounts,
        actor, order, job, garden, day, items, note, source, reverses,
        author: stamp.by, at: stamp.at, state: "pending",
    };
}

/**
 * The reversal of a purely financial row (4.6): the inverse amounts, pointing at the original. Its key is
 * `reversal:<row id>`, so reversing a row twice is one row. A reversal is not itself reversible.
 */
export function reversalRow(target, stamp, note = null) {
    if (target.kind === "reversal") throw new RangeError("a reversal cannot be reversed");
    const inverse = (n) => -n + 0;
    return {
        id: hashId(`reversal:${target.id}`), v: ROW_VERSION, kind: "reversal", idem: `reversal:${target.id}`,
        cp: target.cp, box: inverse(target.box), purse: inverse(target.purse), alloc: inverse(target.alloc),
        actor: target.actor, order: target.order, job: target.job, garden: target.garden, day: target.day,
        items: null, note, source: target.source, reverses: target.id,
        author: stamp.by, at: stamp.at, state: "pending",
    };
}

/**
 * The correction sequence of a key stem (4.6): how many rows whose key starts with `<stem>:` have been
 * reversed (`liveRows` leaves them out). 0 for the first write, more after each undo; every client derives it
 * from the same rows, so two clients making the same payment agree on one key. M1's `wageSeq` is this for wages.
 */
export function seqFor(rows, stem) {
    const live = new Set(liveRows(rows));
    return rows.filter((r) => r.kind !== "reversal" && typeof r.idem === "string" && r.idem.startsWith(`${stem}:`) &&
        !live.has(r)).length;
}

/** Expected strongbox coins (4.7): the sum of `box` over all rows, reversals included (they carry the inverse). */
export function expectedBoxCp(rows) {
    return rows.reduce((sum, row) => sum + (row.box ?? 0), 0);
}
