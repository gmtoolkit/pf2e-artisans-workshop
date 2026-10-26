/**
 * Pro-rata splitting (DESIGN.md 4.6): when an order or a garden spends money (expend, ruin, remainder,
 * plant), one row per contributor in proportion to their remaining allocation, in whole copper.
 */
import { requireCp } from "./core.mjs";

/**
 * Split `totalCp` across `parts` in proportion to each part's `cp`, by the largest-remainder method: every
 * part gets the whole copper of its exact share, and the copper left over goes one each to the parts with
 * the largest remainders. Ties go to the earlier part, so pass the parts earliest contribution first. No part
 * ever gets more than its own `cp`, and the shares always add up to `totalCp`.
 *
 * @param {number} totalCp
 * @param {{key: *, cp: number}[]} parts
 * @returns {{key: *, cp: number}[]} in the order of `parts`
 */
export function splitProRata(totalCp, parts) {
    requireCp(totalCp, "totalCp");
    const sum = parts.reduce((total, part) => total + requireCp(part.cp, "part.cp"), 0);
    if (totalCp > sum) throw new RangeError(`cannot split ${totalCp} cp over ${sum} cp of allocations`);
    if (totalCp === 0) return parts.map(({ key }) => ({ key, cp: 0 }));

    const shares = parts.map((part, index) => {
        const exact = totalCp * part.cp;          // the share is exact / sum
        if (!Number.isSafeInteger(exact)) throw new RangeError("amounts too large to split exactly");
        return { key: part.key, cp: Math.floor(exact / sum), remainder: exact % sum, index };
    });
    let left = totalCp - shares.reduce((total, share) => total + share.cp, 0);
    const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (const share of byRemainder) {
        if (left === 0) break;
        share.cp += 1;                            // only parts with a remainder get here (see below)
        left -= 1;
    }
    // The leftover equals the sum of the remainders divided by `sum`, and each remainder is below `sum`, so
    // more parts have a remainder than there is copper left: no part with a zero remainder gets one.
    return shares.map(({ key, cp }) => ({ key, cp }));
}

/** Rows in order of time: world time, then real time, then row id (code-point order). */
function compareRows(a, b) {
    const world = (a.at?.world ?? 0) - (b.at?.world ?? 0);
    if (world) return world;
    const real = (a.at?.real ?? 0) - (b.at?.real ?? 0);
    if (real) return real;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Each contributor's remaining allocation to one order (or garden) from its ledger rows (4.6): the sum of
 * the rows' `alloc` by `actor` (null for the party fund), earliest first contribution first, leaving out
 * contributors with nothing left. This is what pro-rata spending splits over and what refunds pay back.
 *
 * @param {{id: string, actor: string|null, alloc: number, at?: {world: number, real: number}}[]} rows  the order's rows
 * @returns {{actor: string|null, cp: number}[]}
 */
export function allocationsByContributor(rows) {
    const byActor = new Map();
    for (const row of rows) {
        if (!row.alloc) continue;
        const actor = row.actor ?? null;
        const entry = byActor.get(actor) ?? { actor, cp: 0, first: null };
        entry.cp += row.alloc;
        if (row.alloc > 0 && (!entry.first || compareRows(row, entry.first) < 0)) entry.first = row;
        byActor.set(actor, entry);
    }
    return [...byActor.values()]
        .filter((entry) => entry.cp > 0)
        .sort((a, b) => compareRows(a.first, b.first))
        .map(({ actor, cp }) => ({ actor, cp }));
}
