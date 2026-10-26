/**
 * View models of the Workshop window (DESIGN.md 10.3, 10.1): what the Queue and Funds tabs show, computed from the
 * ledger's plain records. Pure: names, gates and the viewer come in as data or callbacks, and nothing here names an
 * i18n key; the window maps the codes (statuses, gate reasons, row kinds) to keys (`scripts/ui/labels.mjs`).
 */
import { COIN_RATE } from "../data/coins.mjs";
import { DEGREE, compareRows, liveRows } from "./core.mjs";
import { committedFromRows } from "./craft.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { incomePerDay } from "./income.mjs";
import { materialsCp } from "./materials.mjs";
import { CLOSED, escrowCp, orderActions, reversalKeepsCommitted, withdrawableCp } from "./orders.mjs";
import { crafterRate, daysToZero, recordsOf, reductionCp, remainingCp, setupDaysDone } from "./progress.mjs";
import { memberBalances } from "./reconcile.mjs";
import { allocationsByContributor } from "./split.mjs";

/* -------------------------------------------- */
/*  Money                                        */
/* -------------------------------------------- */

/**
 * An amount as the coins a person reads (10.3: "1,045 gp 3 sp"): gold (platinum counted as gold), silver and copper,
 * leaving out zeros; "0 gp" for nothing. Negative amounts keep their sign on the first part.
 * @returns {{unit: "gp"|"sp"|"cp", n: number}[]}
 */
export function coinParts(cp) {
    if (!Number.isSafeInteger(cp)) throw new RangeError(`not whole copper: ${cp}`);
    const sign = cp < 0 ? -1 : 1;
    let left = Math.abs(cp);
    const parts = [];
    for (const unit of ["gp", "sp", "cp"]) {
        const n = Math.floor(left / COIN_RATE[unit]);
        left -= n * COIN_RATE[unit];
        if (n) parts.push({ unit, n });
    }
    if (!parts.length) return [{ unit: "gp", n: 0 }];
    parts[0].n *= sign;
    return parts;
}

/** A whole-number percentage of `part` in `whole`, 0-100; 100 when the whole is nothing. */
export const percent = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 100);

/* -------------------------------------------- */
/*  Orders                                       */
/* -------------------------------------------- */

/** The up-front half and Price an order would have before start, from its snapshot (6.2.2: half, rounded up). */
export function estimateOf(order) {
    if (Number.isInteger(order.priceCp)) return { priceCp: order.priceCp, upfrontCp: order.upfrontCp, frozen: true };
    const snap = order.product?.snapshot ?? {};
    const priceCp = Math.round(((snap.priceCp ?? 0) * order.quantity) / Math.max(1, snap.per ?? 1));
    return { priceCp, upfrontCp: Math.ceil(priceCp / 2), frozen: false };
}

/**
 * The progress bar of an order (10.3): one bar measured against the Price, the up-front half paid (solid), the
 * reduction earned (hatched) and what is left (empty); before start, the escrow against the up-front half. Segment
 * widths are percentages that add up to 100.
 *
 * @returns {{phase: "funding"|"crafting"|"done", segments: {kind: string, pct: number}[], pct: number,
 *   paidCp: number, earnedCp: number, remainingCp: number, escrowCp: number, upfrontCp: number, priceCp: number}}
 */
export function orderProgress(order, { rows = [], days = [], rules = DEFAULT_RULES } = {}) {
    // Earmarked material stock counts toward the up-front half at its Price, as G8 counts it (6.6, M5).
    const escrow = escrowCp(rows) + materialsCp(order);
    const { priceCp, upfrontCp, frozen } = estimateOf(order);
    if (!frozen || order.status === "accepted" || order.status === "requested") {
        const pct = percent(escrow, upfrontCp);
        return { phase: "funding", segments: [{ kind: "escrow", pct }, { kind: "empty", pct: 100 - pct }], pct,
            paidCp: 0, earnedCp: 0, remainingCp: Math.max(0, upfrontCp - escrow), escrowCp: escrow, upfrontCp, priceCp };
    }
    if (order.status === "complete") {
        return { phase: "done", segments: [{ kind: "paid", pct: 100 }], pct: 100, paidCp: priceCp, earnedCp: 0, remainingCp: 0,
            escrowCp: escrow, upfrontCp, priceCp };
    }
    const earned = Math.min(reductionCp(order, days, rules), Math.max(0, priceCp - upfrontCp));
    const remaining = remainingCp(order, days, rules);
    const paidPct = percent(upfrontCp, priceCp);
    const earnedPct = Math.min(100 - paidPct, percent(earned, priceCp));
    return {
        phase: "crafting",
        segments: [{ kind: "paid", pct: paidPct }, { kind: "earned", pct: earnedPct }, { kind: "empty", pct: 100 - paidPct - earnedPct }],
        pct: paidPct + earnedPct, paidCp: upfrontCp, earnedCp: earned, remainingCp: remaining, escrowCp: escrow, upfrontCp, priceCp,
    };
}

/**
 * What one extra day takes off the remainder (6.2.3): the settled check's rate, or before the check the rate a success
 * would give the crafter as they are now. Null without a crafter.
 */
export function perDayCp(order, crafterToday, rules = DEFAULT_RULES) {
    if (!crafterToday) return null;
    if (order.check?.degree >= DEGREE.success) return crafterRate(order.check, crafterToday, null, rules);
    return incomePerDay(crafterToday.level, crafterToday.rank, DEGREE.success);
}

/** Why an accepted order cannot start: its failing gates as `{id, reason, data, unlock}` (6.5). Empty when none. */
export const blockers = (gates = []) => gates.filter((gate) => !gate.ok).map(({ id, reason, data, unlock }) => ({ id, reason, data, unlock }));

/**
 * One order as the Queue shows it.
 *
 * @param {object} order
 * @param {object} p
 * @param {object[]} p.rows       the order's ledger rows
 * @param {object[]} p.days       the order's day records
 * @param {object[]|null} [p.gates]  the crafter's gates for an accepted order (6.5)
 * @param {{level: number, rank: number}|null} [p.crafterToday]
 * @param {{userId: string, isGM: boolean, owns: function, isMine?: function, hasCharacter: boolean}} p.viewer  `owns`: may act
 *        for the actor (a GM owns every one); `isMine`: one of the user's own characters, for highlighting
 * @param {(uuid: string|null) => string|null} p.nameOf
 * @param {number} [p.no]         the order's number in the queue
 */
export function orderView(order, { rows = [], days = [], gates = null, crafterToday = null, viewer, nameOf, no = null, rules = DEFAULT_RULES }) {
    const progress = orderProgress(order, { rows, days, rules });
    const perDay = perDayCp(order, crafterToday, rules);
    const extraDays = recordsOf(order, days, "extra").length;
    const remaining = progress.phase === "funding" ? Math.max(0, progress.priceCp - progress.upfrontCp) : progress.remainingCp;
    const toZero = perDay === null ? null : daysToZero(remaining, perDay);
    const blocked = order.status === "accepted" ? blockers(gates ?? []) : [];
    const isMine = viewer.isMine ?? viewer.owns;
    const contributors = allocationsByContributor(rows).map((a) => ({ ...a, name: a.actor ? nameOf(a.actor) : null, mine: !!a.actor && isMine(a.actor) }));
    const recipientUuid = order.recipient?.kind === "actor" ? order.recipient.uuid : null;
    const giftHidden = order.visibility === "gift" && !!recipientUuid && viewer.owns(recipientUuid) &&
        !viewer.owns(order.requester) && !(order.crafter && viewer.owns(order.crafter)) && !viewer.isGM;
    const ownWithdrawable = Math.max(0, ...contributors.filter((c) => c.mine).map((c) => withdrawableCp(order, rows, c.actor)));
    const mine = [order.requester, recipientUuid, order.crafter].some((uuid) => uuid && isMine(uuid)) || contributors.some((c) => c.mine);
    const snap = order.product?.snapshot ?? {};
    return {
        id: order.id, no, status: order.status, mine, gift: order.visibility === "gift", giftHidden,
        name: giftHidden ? null : snap.name ?? null, img: giftHidden ? null : snap.img ?? null, level: snap.level ?? null,
        rarity: snap.rarity ?? "common", quantity: order.quantity,
        requester: nameOf(order.requester), crafter: order.crafter ? nameOf(order.crafter) : null, crafterUuid: order.crafter,
        recipient: recipientUuid ? nameOf(recipientUuid) : null, toStrongbox: order.recipient?.kind === "strongbox",
        route: order.route, dc: order.dc?.final ?? null, notes: order.notes ?? "",
        setup: order.setup ? { done: setupDaysDone(order, days), days: order.setup.days } : null,
        check: order.check ? { degree: order.check.degree, settled: !!order.check.settled, rerolled: !!order.check.rerolled, warn: !!order.check.warn } : null,
        conflict: order.conflict && order.conflict.attempt === order.attempt ? { degree: order.conflict.degree } : null,
        resumeTo: order.resumeTo ?? null,
        progress, perDayCp: perDay, daysToZero: toZero, extraDays, finishCp: progress.remainingCp,
        blocked, contributors, committedCp: committedFromRows(rows),
        actions: orderActions(order, viewer, { withdrawable: ownWithdrawable, gatesPass: gates ? blocked.length === 0 : false }),
        withdrawableCp: ownWithdrawable,
        closed: CLOSED.includes(order.status),
    };
}

/** The filters of the Queue (10.3): scope, status, crafter, recipient and a search text. */
export const DEFAULT_FILTERS = Object.freeze({ scope: "all", status: "any", crafter: "any", recipient: "any", search: "" });

/**
 * Whether an order view passes the filters. `scope` is "all", "mine", "open" (not closed) or "blocked" (accepted with a
 * failing gate); `crafter` an actor UUID, "none" or "any"; `recipient` an actor UUID, "strongbox" or "any".
 */
export function passesFilters(view, order, filters = DEFAULT_FILTERS) {
    const f = { ...DEFAULT_FILTERS, ...filters };
    if (f.scope === "mine" && !view.mine) return false;
    if (f.scope === "open" && view.closed) return false;
    if (f.scope === "blocked" && !view.blocked.length) return false;
    if (f.status !== "any" && order.status !== f.status) return false;
    if (f.crafter === "none" && order.crafter) return false;
    if (f.crafter !== "any" && f.crafter !== "none" && order.crafter !== f.crafter) return false;
    if (f.recipient === "strongbox" && order.recipient?.kind !== "strongbox") return false;
    if (f.recipient !== "any" && f.recipient !== "strongbox" && order.recipient?.uuid !== f.recipient) return false;
    const text = f.search.trim().toLowerCase();
    if (text && !(view.name ?? "").toLowerCase().includes(text)) return false;
    return true;
}

/**
 * The Queue's orders in display order (10.3): open orders first, oldest first; closed ones after, newest first. Each
 * order's number is its place among all orders by filing time, so it does not change with the filters.
 * @returns {{order: object, no: number}[]}
 */
export function queueOrder(orders) {
    const byFiling = [...orders].sort((a, b) => compareRows({ id: a.id, at: a.created ?? a.at }, { id: b.id, at: b.created ?? b.at }));
    const numbered = byFiling.map((order, i) => ({ order, no: i + 1 }));
    const open = numbered.filter(({ order }) => !CLOSED.includes(order.status));
    const closed = numbered.filter(({ order }) => CLOSED.includes(order.status)).reverse();
    return [...open, ...closed];
}

/** A short summary of the queue for the party header (10.2, 10.3): counts by phase. */
export function queueSummary(orders) {
    const count = (states) => orders.filter((o) => states.includes(o.status)).length;
    return {
        open: orders.filter((o) => !CLOSED.includes(o.status)).length,
        requested: count(["requested"]), accepted: count(["accepted"]),
        working: count(["setup", "check", "rolled", "finishing", "paused", "gathering"]), failed: count(["failed"]),
        complete: count(["complete"]),
    };
}

/* -------------------------------------------- */
/*  Funds                                        */
/* -------------------------------------------- */

/** Row kinds a user can reverse in the Funds tab (4.6): purely financial ones. */
export const REVERSIBLE_KINDS = Object.freeze(["pledge", "deposit", "withdraw", "purchase", "income", "expense", "adjust"]);

/**
 * Whether `viewer` may reverse a row (4.6): a financial row that counts (applied, not reversed, not itself a reversal),
 * written by them or by anyone when they are a GM (an `adjust` only by a GM); its coins can still move back (the
 * purse is theirs to write, a pledge's order keeps what it has committed, the contributor still has the amount
 * allocated). `orders` by id.
 */
export function canReverse(row, allRows, viewer, orders = {}) {
    if (!REVERSIBLE_KINDS.includes(row.kind) || row.state !== "applied") return false;
    if (!liveRows(allRows).includes(row)) return false;
    if (row.kind === "adjust" ? !viewer.isGM : !(viewer.isGM || row.author === viewer.userId)) return false;
    if ((row.purse ?? 0) !== 0 && !(row.actor && viewer.owns(row.actor))) return false;
    if (row.order) {
        const order = orders[row.order];
        if (!order || CLOSED.includes(order.status)) return false;
        const orderRows = allRows.filter((r) => r.order === row.order);
        if (!reversalKeepsCommitted(row, orderRows)) return false;
    }
    if ((row.alloc ?? 0) > 0 && row.actor) {
        const scope = allRows.filter((r) => (row.order ? r.order === row.order : !r.order && !r.garden));
        const own = scope.filter((r) => r.actor === row.actor).reduce((sum, r) => sum + (r.alloc ?? 0), 0);
        if (own < row.alloc) return false;
    }
    if (!row.order && !row.garden && (row.alloc ?? 0) > 0) {
        const fund = allRows.filter((r) => !r.order && !r.garden).reduce((sum, r) => sum + (r.alloc ?? 0), 0);
        if (fund < row.alloc) return false;
    }
    return true;
}

/**
 * The Funds tab (10.1): the strongbox's coins, the party fund, the escrow held for orders, each member's balance
 * (`memberBalances`), and the ledger, newest first, each row with its author and whether this viewer may reverse it.
 *
 * @param {object} p
 * @param {object[]} p.rows        every live ledger row
 * @param {number} p.actualCp      coins in the strongbox
 * @param {object} p.orders        orders by id
 * @param {object} p.viewer
 * @param {(uuid: string|null) => string|null} p.nameOf
 * @param {(userId: string) => string|null} p.userName
 * @param {number} [p.limit]       how many ledger rows to list
 */
export function fundsView({ rows, actualCp, orders = {}, viewer, nameOf, userName, limit = 200 }) {
    const expectedCp = rows.reduce((sum, row) => sum + (row.box ?? 0), 0);
    const fundCp = rows.filter((r) => !r.order && !r.garden).reduce((sum, r) => sum + (r.alloc ?? 0), 0);
    const escrow = rows.filter((r) => r.order && !CLOSED.includes(orders[r.order]?.status)).reduce((sum, r) => sum + (r.alloc ?? 0), 0);
    const balances = memberBalances(rows);
    const members = balances.byActor.map(({ actor, cp }) => ({
        actor, name: nameOf(actor), cp, mine: (viewer.isMine ?? viewer.owns)(actor),
        allocations: balances.byAllocation.filter((a) => a.actor === actor).map((a) => ({
            order: a.order, cp: a.cp, orderName: a.order ? orders[a.order]?.product?.snapshot?.name ?? null : null,
        })),
    }));
    const reversed = new Set(rows.filter((r) => r.kind === "reversal" && r.reverses).map((r) => r.reverses));
    const ledger = [...rows].sort((a, b) => compareRows(b, a)).slice(0, limit).map((row) => ({
        id: row.id, kind: row.kind, cp: row.cp, box: row.box ?? 0, purse: row.purse ?? 0, alloc: row.alloc ?? 0, state: row.state,
        actor: row.actor ? nameOf(row.actor) : null, order: row.order ? orders[row.order]?.product?.snapshot?.name ?? null : null,
        author: userName(row.author), mine: row.author === viewer.userId, at: row.at?.real ?? null, note: row.note ?? null,
        reversed: !!row.reversedBy || reversed.has(row.id), reversal: row.kind === "reversal",
        canReverse: canReverse(row, rows, viewer, orders),
    }));
    return { actualCp, expectedCp, differenceCp: actualCp - expectedCp, fundCp, escrowCp: escrow, members,
        unassignedCp: balances.unassignedCp, ledger, total: rows.length };
}

/**
 * What the viewer's character may take back from the party fund (4.6 `withdraw`): their net deposits (deposits less
 * withdrawals and refunds from the fund), no more than the fund holds.
 */
export function fundWithdrawableCp(rows, actorUuid) {
    const fund = rows.filter((r) => !r.order && !r.garden);
    const own = liveRows(fund).filter((r) => r.actor === actorUuid).reduce((sum, r) => sum + (r.alloc ?? 0), 0);
    const total = fund.reduce((sum, r) => sum + (r.alloc ?? 0), 0);
    return Math.max(0, Math.min(own, total));
}
