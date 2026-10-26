/**
 * Reconciliation (DESIGN.md 4.7, 5.4) and the balances the purge offers to return (5.9). Pure.
 *
 * - Expected strongbox coins are the sum of `box` over every row; actual coins are summed over every coin
 *   stack, however the loot sheet groups them. A difference means coins moved by hand, or a batch stopped
 *   part-way: rows still `pending` say which, and so do strongbox stacks that are locked but still there.
 * - Each member's balance is what they still have allocated to orders and gardens, plus their pro-rata share
 *   of the party fund.
 */
import { holdingsOf, valueCp } from "./coins.mjs";
import { compareRows, liveRows, stampTime } from "./core.mjs";
import { compareIds, hashId } from "./ids.mjs";
import { expectedBoxCp } from "./rows.mjs";
import { allocationsByContributor, splitProRata } from "./split.mjs";

/**
 * A pending row younger than this may belong to a batch still in flight on another client, so nothing acts
 * on it yet (re-creating a delivery, reporting it to its author).
 */
export const PENDING_GRACE_MS = 60 * 1000;

/**
 * The reconciliation report.
 * @param {object} p
 * @param {object[]} p.rows      every live ledger row
 * @param {object[]} p.stacks    the strongbox's coin stacks `{id, denomination, quantity}`
 * @param {number} p.now         the moment on the server's clock (`serverNow`), compared with `stampTime`
 * @param {Set<string>} [p.lockedIds]  ids that have a lock page in the ledger
 * @returns {{expectedCp: number, actualCp: number, differenceCp: number, pending: object[], stalled: object[],
 *            lockedStacks: string[]}}  `stalled`: pending rows older than PENDING_GRACE_MS; `lockedStacks`:
 *            strongbox stacks a batch locked to spend but that are still there (it stopped part-way)
 */
export function reconcile({ rows, stacks, now, lockedIds = new Set() }) {
    const expectedCp = expectedBoxCp(rows);
    const actualCp = valueCp(holdingsOf(stacks));
    const pending = rows.filter((row) => row.state === "pending").sort(compareRows);
    const stalled = pending.filter((row) => now - stampTime(row.at) >= PENDING_GRACE_MS);
    const lockedStacks = stacks.filter((stack) => lockedIds.has(stack.id)).map((stack) => stack.id);
    return { expectedCp, actualCp, differenceCp: actualCp - expectedCp, pending, stalled, lockedStacks };
}

/**
 * The `makeRow` input of a GM's `adjust` row that books a reconciliation difference (4.7): the strongbox and
 * the party fund change by the difference, so expected and actual agree again. Positive when there are more
 * coins than the rows explain.
 */
export function adjustRowInput(differenceCp, nonce, note = null) {
    if (!Number.isSafeInteger(differenceCp) || differenceCp === 0) throw new RangeError("nothing to adjust");
    return {
        kind: "adjust", idem: `adjust:${nonce}`, cp: Math.abs(differenceCp),
        signed: { box: differenceCp, purse: 0, alloc: differenceCp }, note,
    };
}

/**
 * The nonce of the `adjust` row that books a difference, from the state it corrects: the expected and actual
 * coins and the ids of every row so far. Two GMs, or one double click, booking the same difference write one row
 * (P5); once that row exists, a later difference gets a nonce of its own.
 */
export function adjustNonce({ expectedCp, actualCp }, rows) {
    return hashId([expectedCp, actualCp, ...rows.map((row) => row.id).sort(compareIds)].join(","));
}

const fundRow = (row) => !row.order && !row.garden;

/** Fund rows that change a member's claim on the fund: what they put in, took back, or were refunded from it. */
const FUND_SHARE_KINDS = Object.freeze(["deposit", "withdraw", "refund"]);

/** What an order's or garden's rows are linked to. */
const linkOf = (row) => (row.order ? { order: row.order, garden: null } : { order: null, garden: row.garden });

/**
 * What the strongbox holds for each member (5.9 step 1), from the rows, one entry per member and allocation:
 * - for each order and garden, every contributor's remaining allocation (`allocationsByContributor`); fund
 *   money allocated to them goes back to the fund;
 * - the party fund split pro rata over the members' net deposits (deposits less withdrawals and refunds from the
 *   fund); what is left over (income, adjustments, more than anyone deposited) belongs to nobody in particular.
 *
 * @returns {{byAllocation: {actor: string, order: string|null, garden: string|null, cp: number}[],
 *            byActor: {actor: string, cp: number}[], unassignedCp: number}}
 *          `byAllocation`: what each member has in each order (`order`) or garden (`garden`), or as a share of
 *          the fund (both null); `byActor`: each member's total. Members by actor UUID.
 */
export function memberBalances(allRows) {
    const rows = [...allRows].sort(compareRows);   // earliest contribution first, the same on every client
    const byAllocation = [];

    let fundCp = rows.filter(fundRow).reduce((sum, row) => sum + (row.alloc ?? 0), 0);
    const groups = Map.groupBy(rows.filter((row) => !fundRow(row)), (row) => (row.order ? `o:${row.order}` : `g:${row.garden}`));
    for (const groupRows of groups.values()) {
        const link = linkOf(groupRows[0]);
        for (const { actor, cp } of allocationsByContributor(groupRows)) {
            if (actor === null) fundCp += cp;
            else byAllocation.push({ actor, ...link, cp });
        }
    }

    const deposits = new Map();
    for (const row of liveRows(rows).filter((r) => fundRow(r) && r.actor && FUND_SHARE_KINDS.includes(r.kind))) {
        deposits.set(row.actor, (deposits.get(row.actor) ?? 0) + row.alloc);
    }
    const depositors = [...deposits].filter(([, cp]) => cp > 0).map(([key, cp]) => ({ key, cp }));
    const shareable = Math.max(0, Math.min(fundCp, depositors.reduce((sum, d) => sum + d.cp, 0)));
    for (const { key, cp } of splitProRata(shareable, depositors)) {
        if (cp > 0) byAllocation.push({ actor: key, order: null, garden: null, cp });
    }

    const totals = new Map();
    for (const { actor, cp } of byAllocation) totals.set(actor, (totals.get(actor) ?? 0) + cp);
    const groupOf = (entry) => entry.order ?? entry.garden ?? "";
    return {
        byAllocation: byAllocation.sort((a, b) => compareIds(a.actor, b.actor) || compareIds(groupOf(a), groupOf(b))),
        byActor: [...totals].map(([actor, cp]) => ({ actor, cp })).sort((a, b) => compareIds(a.actor, b.actor)),
        unassignedCp: fundCp - shareable,
    };
}
