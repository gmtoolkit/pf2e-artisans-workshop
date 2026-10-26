/**
 * Fund accounting (DESIGN.md 4.6, 4.7, As built in M4.1; DECISIONS.md 2026-10-26): the strongbox holds the party fund,
 * split into money nobody has claimed yet (unallocated) and money earmarked for orders, each amount with its source
 * (the party fund, or the member whose purse paid it), and what each order has spent. Pure: rows and orders in, numbers
 * out; the window maps them to words.
 *
 * Every amount here is a sum of the rows' signed `alloc`, so the identity the Funds tab states holds by construction:
 * the coins the ledger expects in the strongbox (the sum of `box`) are the unallocated fund plus what is earmarked for
 * orders and gardens. The kinds M4 writes all move `box` and `alloc` together; reconciliation (4.7) reports any
 * difference between that expectation and the coins counted.
 *
 * Funding an order from the party fund moves no coins: it is a pair of `allocate` rows, fund -n and order +n, both with
 * `actor` null (the fund is the source), written behind the fund slot's lock page (`fundSlotLockId`) so that two members
 * earmarking the same unallocated money at once cannot both land. Funding from a purse is a `pledge` (coins move).
 */
import { COIN_RATE, DENOMINATIONS, MINT_DENOMINATIONS } from "../data/coins.mjs";
import { compareRows, liveRows, requireCp } from "./core.mjs";
import { committedFromRows, expendedFromRows } from "./craft.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { hashId, idemKey } from "./ids.mjs";
import { CLOSED, escrowCp, lastEntry, withdrawableCp } from "./orders.mjs";
import { remainingCp } from "./progress.mjs";
import { allocationsByContributor } from "./split.mjs";

/** Rows of the party fund itself: linked to no order and no garden. */
export const isFundRow = (row) => !row.order && !row.garden;

/** Kinds that spend an order's earmarked money (4.6): materials used or ruined, and the finishing payment. */
export const SPEND_KINDS = Object.freeze(["expend", "ruin", "remainder", "plant"]);

/** The unallocated party fund: the sum of `alloc` over the fund's own rows. */
export function unallocatedCp(rows) {
    return rows.filter(isFundRow).reduce((sum, row) => sum + (row.alloc ?? 0), 0);
}

/* -------------------------------------------- */
/*  Earmarking and its locks                     */
/* -------------------------------------------- */

/**
 * The lock page every write takes that takes money out of the unallocated fund: earmarking it for an order, a
 * withdrawal from the fund, the reversal of a deposit. Its slot is the number of fund rows that took money out so far
 * (`alloc` below 0, reversed or not: rows are append-only), so two such writes planned from the same copy of the ledger
 * name the same page and only the first lands; one planned from a copy that missed a debit names a page that exists.
 * Money coming in (a deposit, a share returned) takes no slot and does not move it.
 */
export function fundSlotLockId(rows) {
    const debits = rows.filter((row) => isFundRow(row) && (row.alloc ?? 0) < 0).length;
    return hashId(idemKey("fund-slot", debits));
}

/**
 * The order's return slot (review fix of M4.1): the lock page taken by every write that takes money off an order outside
 * a transition (the fund's share given back, a member's take-back, the reversal of a pledge) and by every transition that
 * moves the order's money (start, retry, settle, finish, cancel). Its slot is the order's last log seq and the number
 * of the order's rows that took money off it so far (`alloc` below 0), so two of these planned from the same copy of the
 * order name the same page and only the first lands: a give-back and a cancel, say, cannot both return the fund's
 * share. Every transition moves the seq and every take-off adds a row, so taking the page never blocks a later one.
 */
export function returnSlotLockId(order, orderRows) {
    const seq = lastEntry(order)?.seq ?? 0;
    const takenOff = orderRows.filter((row) => row.order === order.id && (row.alloc ?? 0) < 0).length;
    return hashId(idemKey("fund-return-slot", order.id, seq, takenOff));
}

/**
 * The two `allocate` rows (`makeRow` inputs) that earmark `cp` of the unallocated fund for an order: the fund's side
 * (-cp) and the order's (+cp), both with the party fund (`actor` null) as the source. `back` gives a share back to the
 * fund instead. `nonce` is generated once when the user confirms, so a retried confirmation writes the same rows.
 */
export function earmarkInputs({ orderId, cp, nonce, back = false }) {
    requireCp(cp, "cp");
    const stem = back ? "unearmark" : "earmark";
    return [
        { kind: "allocate", how: { side: "fund", back }, idem: idemKey(stem, orderId, nonce, "fund"), cp, actor: null, order: null },
        { kind: "allocate", how: { side: "order", back }, idem: idemKey(stem, orderId, nonce, "order"), cp, actor: null, order: orderId },
    ];
}

/**
 * What of an order's party-fund share can go back to the unallocated fund: on an open order, the share less what the
 * crafter has committed (`withdrawableCp` for the fund); on a closed one, all of it. A cancel or a finish gives the fund's
 * share back in its own request, so a closed order holds one only when an earmark planned before the close landed after
 * it; giving that back is the only way it leaves the order.
 */
export function fundReturnableCp(order, orderRows) {
    if (!CLOSED.includes(order.status)) return withdrawableCp(order, orderRows, null);
    return Math.max(0, allocationsByContributor(orderRows).find((a) => a.actor === null)?.cp ?? 0);
}

/* -------------------------------------------- */
/*  What an order still needs                    */
/* -------------------------------------------- */

/** The up-front half and Price an order would have before start, from its snapshot (6.2.2: half, rounded up). */
export function estimateOf(order) {
    if (Number.isInteger(order.priceCp)) return { priceCp: order.priceCp, upfrontCp: order.upfrontCp, frozen: true };
    const snap = order.product?.snapshot ?? {};
    const priceCp = Math.round(((snap.priceCp ?? 0) * order.quantity) / Math.max(1, snap.per ?? 1));
    return { priceCp, upfrontCp: Math.ceil(priceCp / 2), frozen: false };
}

/**
 * What the order needs earmarked for its next step and how much of that is missing ("Fill the shortfall"):
 * - `upfront`, before start: the up-front half (G8);
 * - `retry`, after a failed attempt: the up-front half less what earlier attempts already expended (6.2.2 `retryOrder`);
 * - `finish`, once started: what is still committed plus what is left to pay if the crafter finished now (6.2.3);
 * - `closed`: nothing.
 * @returns {{phase: "upfront"|"retry"|"finish"|"closed", needCp: number, holdsCp: number, shortCp: number}}
 */
export function shortfallOf(order, orderRows, orderDays = [], rules = DEFAULT_RULES) {
    const holdsCp = escrowCp(orderRows);
    const result = (phase, needCp) => ({ phase, needCp, holdsCp, shortCp: Math.max(0, needCp - holdsCp) });
    if (CLOSED.includes(order.status)) return { phase: "closed", needCp: 0, holdsCp, shortCp: 0 };
    const estimate = estimateOf(order);
    if (!estimate.frozen || order.status === "requested" || order.status === "accepted") return result("upfront", estimate.upfrontCp);
    if (order.status === "failed") return result("retry", Math.max(0, order.upfrontCp - expendedFromRows(orderRows)));
    return result("finish", Math.max(0, committedFromRows(orderRows)) + remainingCp(order, orderDays, rules));
}

/* -------------------------------------------- */
/*  The Funds tab's accounts                     */
/* -------------------------------------------- */

/** Amounts by source, earliest source first: `{actor, cp}` with `actor` null for the party fund. */
function bySource(rows, amountOf) {
    const out = new Map();
    for (const row of [...rows].sort(compareRows)) {
        const cp = amountOf(row);
        if (!cp) continue;
        const actor = row.actor ?? null;
        out.set(actor, (out.get(actor) ?? 0) + cp);
    }
    return [...out].filter(([, cp]) => cp !== 0).map(([actor, cp]) => ({ actor, cp }));
}

/** What an order has spent, by source (live `expend`, `ruin` and `remainder` rows; `plant` for gardens). */
export function spentBySource(orderRows) {
    return bySource(liveRows(orderRows).filter((row) => SPEND_KINDS.includes(row.kind)), (row) => row.cp ?? 0);
}

/**
 * The Funds tab's accounts (10.1, As built in M4.1): the coins the ledger expects in the strongbox, the unallocated
 * party fund, and per order the money earmarked for it by source and what it has spent by source. An order is listed
 * while it holds money or once it has spent some; a closed order that still holds money is waiting for its refunds to be
 * collected (6.2.4). `balanced` is the identity: expected = unallocated + earmarked (+ gardens, 6.16.7).
 *
 * @param {object[]} rows  every ledger row
 * @param {Record<string, object>} [orders]  orders by id
 */
export function fundAccounts(rows, orders = {}) {
    const expectedCp = rows.reduce((sum, row) => sum + (row.box ?? 0), 0);
    const unallocated = unallocatedCp(rows);
    const gardensCp = rows.filter((row) => !row.order && row.garden).reduce((sum, row) => sum + (row.alloc ?? 0), 0);
    const list = [];
    for (const [id, orderRows] of Map.groupBy(rows.filter((row) => row.order), (row) => row.order)) {
        const order = orders[id] ?? null;
        const earmarkedCp = escrowCp(orderRows);
        const spent = spentBySource(orderRows);
        const spentCp = spent.reduce((sum, s) => sum + s.cp, 0);
        if (!earmarkedCp && !spentCp) continue;
        const open = !!order && !CLOSED.includes(order.status);
        list.push({
            id, status: order?.status ?? null, open, earmarked: allocationsByContributor(orderRows), earmarkedCp, spent, spentCp,
            refundsWaiting: !open && earmarkedCp > 0,
        });
    }
    const created = (id) => orders[id]?.created ?? orders[id]?.at ?? null;
    const filed = (a, b) => compareRows({ id: a.id, at: created(a.id) }, { id: b.id, at: created(b.id) });
    const sorted = [...list.filter((o) => o.open).sort(filed), ...list.filter((o) => !o.open).sort(filed).reverse()];
    const earmarkedCp = list.reduce((sum, o) => sum + o.earmarkedCp, 0);
    return {
        expectedCp, unallocatedCp: unallocated, earmarkedCp, gardensCp, spentCp: list.reduce((sum, o) => sum + o.spentCp, 0),
        orders: sorted,
        balanced: expectedCp === unallocated + earmarkedCp + gardensCp,
    };
}

/* -------------------------------------------- */
/*  Money typed as coins                         */
/* -------------------------------------------- */

/**
 * An amount as the four fields of a money entry (B, As built in M4.1), to pre-fill them: gold, silver and copper as
 * pf2e's `Coins.normalized()` writes them, platinum 0.
 * @returns {{pp: number, gp: number, sp: number, cp: number}}
 */
export function coinFields(amountCp) {
    let rest = requireCp(amountCp, "amountCp");
    const fields = { pp: 0, gp: 0, sp: 0, cp: 0 };
    for (const d of MINT_DENOMINATIONS) {
        fields[d] = Math.floor(rest / COIN_RATE[d]);
        rest -= fields[d] * COIN_RATE[d];
    }
    return fields;
}

/**
 * The four fields of a money entry as copper. Each field is a whole number of coins, typed or not: empty counts as 0,
 * anything else that is not digits (a sign, a decimal point, letters) is refused with the field it is in.
 * @param {{pp?: string|number, gp?: string|number, sp?: string|number, cp?: string|number}} fields
 * @returns {{ok: true, cp: number} | {ok: false, reason: "bad-number", field: string}}
 */
export function fieldsToCp(fields = {}) {
    let total = 0;
    for (const d of DENOMINATIONS) {
        const raw = fields[d];
        const text = raw === undefined || raw === null ? "" : String(raw).trim();
        if (text === "") continue;
        if (!/^\d+$/.test(text)) return { ok: false, reason: "bad-number", field: d };
        total += Number(text) * COIN_RATE[d];
        if (!Number.isSafeInteger(total)) return { ok: false, reason: "bad-number", field: d };
    }
    return { ok: true, cp: total };
}

/**
 * Whether the four fields hold an amount that can be used: whole coins (`fieldsToCp`), above zero, no more than `maxCp`
 * and no less than `minCp` where those are given.
 * @returns {{ok: true, cp: number} | {ok: false, reason: "bad-number"|"nothing"|"too-much"|"too-little", maxCp?: number,
 *          minCp?: number, field?: string}}
 */
export function checkAmount(fields, { minCp = null, maxCp = null } = {}) {
    const parsed = fieldsToCp(fields);
    if (!parsed.ok) return parsed;
    const { cp } = parsed;
    if (cp <= 0) return { ok: false, reason: "nothing" };
    if (Number.isFinite(maxCp) && cp > maxCp) return { ok: false, reason: "too-much", maxCp };
    if (Number.isFinite(minCp) && cp < minCp) return { ok: false, reason: "too-little", minCp };
    return { ok: true, cp };
}
