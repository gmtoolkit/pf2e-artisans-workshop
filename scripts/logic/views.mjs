/**
 * View models of the Workshop window (DESIGN.md 10.3, 10.1): what the Queue and Funds tabs show, computed from the
 * ledger's plain records. Pure: names, gates and the viewer come in as data or callbacks, and nothing here names an
 * i18n key; the window maps the codes (statuses, gate reasons, row kinds) to keys (`scripts/ui/labels.mjs`).
 */
import { COIN_RATE } from "../data/coins.mjs";
import { DEGREE, compareRows, liveRows } from "./core.mjs";
import { committedFromRows } from "./craft.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { estimateOf, fundAccounts, fundReturnableCp, shortfallOf, spentBySource, stockBySource } from "./funds.mjs";
import { incomePerDay } from "./income.mjs";
import { materialsCp } from "./materials.mjs";
import { CLOSED, TARGETED, escrowCp, orderActions, reversalKeepsCommitted, withdrawableCp } from "./orders.mjs";
import {
    crafterRate, dayReductionCp, daysToZero, recordsOf, reductionCp, remainingCp, setupDaysDone,
} from "./progress.mjs";
import { memberBalances } from "./reconcile.mjs";
import { allocationsByContributor, splitProRata } from "./split.mjs";

export { estimateOf };

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

/**
 * The progress bar of an order (10.3): one bar measured against the Price, the up-front half paid (solid), the
 * reduction earned (hatched) and what is left (empty); before start, the escrow against the up-front half. Segment
 * widths are percentages that add up to 100. Before start, `plan` is the order's plan as G8 judges it (`estimateOf`, M5
 * on M4.1), so the bar measures against the half the order will commit.
 *
 * @returns {{phase: "funding"|"crafting"|"done", segments: {kind: string, pct: number}[], pct: number,
 *   paidCp: number, earnedCp: number, remainingCp: number, escrowCp: number, upfrontCp: number, priceCp: number}}
 */
export function orderProgress(order, { rows = [], days = [], rules = DEFAULT_RULES, plan = null } = {}) {
    // Earmarked material stock counts toward the up-front half at its Price, as G8 counts it (6.6, M5).
    const escrow = escrowCp(rows) + materialsCp(order);
    const { priceCp, upfrontCp, frozen } = estimateOf(order, plan);
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
 * The Workshop's action that meets an unmet requirement, by the gate's reason (C, As built in M4.1; M5 on M4.1): an
 * underfunded G8 is met by funding the order ("fund"), G8's precious material by handing over stock ("stock"), G9's
 * spells by a casting offered or bought ("castings"), G10 by handing the item over ("hand-over").
 */
const REQUIREMENT_ACTIONS = Object.freeze({ underfunded: "fund", precious: "stock", spells: "castings", "target-not-held": "hand-over",
    // M9: a tattoo's or graft's subject consents (6.14); a fulu's crafter chooses its tradition.
    "no-consent": "consent", "subject-not-locked": "consent", "fulu-tradition": "tradition" });

/**
 * Which name a requirement goes by for this kind of order (M5 on M4.1), or null for its plain one: G9 is the spells cast
 * for a scroll, wand, staff or spellheart; G10 the item worked on (an etching, an upgrade, a transfer) or the item to
 * reverse-engineer; G12 the rune the item can take, or the stronger grade.
 */
export function requirementVariant(id, order = null) {
    const type = order?.craftType ?? "item";
    if (id === "G9" && type === "spell-item") return "spells";
    if (id === "G10" && TARGETED.includes(type)) return "target";
    if (id === "G10" && (type === "tattoo" || type === "graft")) return "subject";
    if (id === "G11" && (type === "tattoo" || type === "graft")) return "subject";
    if (id === "G10" && order?.product?.type === "formula") return "possession";
    if (id === "G12" && (type === "rune-etch" || type === "rune-transfer")) return "rune";
    if (id === "G12" && type === "upgrade") return "upgrade";
    return null;
}

/**
 * The requirements of an accepted order in plain words (C, As built in M4.1): how many of its gates are met, the met
 * ones (which the detail folds away as "10 of 12 met"), and the unmet ones with the action that would meet them where
 * the Workshop has one (`REQUIREMENT_ACTIONS`). `order` gives each requirement the name it goes by for the order's kind
 * (`variant`, M5 on M4.1).
 * @returns {{total: number, met: number, allMet: boolean, metList: object[], unmet: object[]}}
 */
export function requirementsView(gates = [], order = null) {
    const list = gates.map(({ id, ok, reason, data }) => ({ id, ok, reason: reason ?? null, data: data ?? null,
        action: ok ? null : REQUIREMENT_ACTIONS[reason] ?? null, variant: requirementVariant(id, order) }));
    const metList = list.filter((gate) => gate.ok);
    return { total: list.length, met: metList.length, allMet: metList.length === list.length, metList, unmet: list.filter((gate) => !gate.ok) };
}

/**
 * The work days of the order's current attempt, in order (D, As built in M4.1): each setup day ("Setup day 1 of 2"), then
 * each extra day numbered after them with what it took off ("Day 3: -8 gp 7 sp"). A day takes off its reduction (6.2.3)
 * only once the check has settled as a success (`counted`), and never more than was left to pay: a day after the
 * remainder reached zero takes off nothing.
 * @returns {{kind: "setup"|"extra", n: number, of?: number, day: number, cp?: number, counted?: boolean}[]}
 */
export function workDaysView(order, days = [], rules = DEFAULT_RULES) {
    const byDay = (a, b) => a.day - b.day || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
    const setup = recordsOf(order, days, "setup").sort(byDay);
    const extra = recordsOf(order, days, "extra").sort(byDay);
    const counted = !!(order.check?.settled && order.check.degree >= DEGREE.success);
    let left = Number.isInteger(order.priceCp) ? Math.max(0, order.priceCp - order.upfrontCp) : 0;
    const out = setup.map((d, i) => ({ kind: "setup", n: i + 1, of: Math.max(order.setup?.days ?? 0, setup.length), day: d.day }));
    extra.forEach((d, i) => {
        const cp = counted ? Math.min(left, dayReductionCp(order, d, rules)) : 0;
        left -= cp;
        out.push({ kind: "extra", n: setup.length + i + 1, day: d.day, cp, counted });
    });
    return out;
}

/**
 * What a finished order cost (D, As built in M4.1), from its live rows and day records: the up-front half spent on
 * materials, what earlier failed attempts ruined, the extra days and what they took off the Price, what was paid at the
 * finish, and the total. For a finished order `upfrontCp + stockCp + workCp + finishCp` is its Price (6.2.3).
 *
 * As built in M5 on M4.1: `stockCp` is the material stock the order used up (6.6, at Price), which covered that much
 * of the up-front half in place of coins; `purchasesCp` what was bought for it (castings, a spell's cost). Both count in
 * the total.
 */
export function costSummary(order, rows = [], days = [], rules = DEFAULT_RULES) {
    const live = liveRows(rows);
    const sum = (kind) => live.filter((row) => row.kind === kind).reduce((total, row) => total + (row.cp ?? 0), 0);
    const upfrontCp = sum("expend");
    const ruinedCp = sum("ruin");
    const finishCp = sum("remainder");
    const purchasesCp = sum("purchase");
    const stockCp = Object.values(order.materials ?? {}).filter((line) => line?.used && Number.isSafeInteger(line.valueCp))
        .reduce((total, line) => total + line.valueCp, 0);
    const workCp = Number.isInteger(order.priceCp) ? Math.min(reductionCp(order, days, rules), Math.max(0, order.priceCp - order.upfrontCp)) : 0;
    return { upfrontCp, ruinedCp, workDays: recordsOf(order, days, "extra").length, workCp, finishCp, stockCp, purchasesCp,
        totalCp: upfrontCp + ruinedCp + finishCp + stockCp + purchasesCp };
}

/** Row kinds that move items and no money (4.6): the ledger and the order's detail show no amount for them. */
const ITEM_ROW_KINDS = Object.freeze(["delivered", "material-in", "material-out", "custody-in", "custody-out"]);

/** Whether a `shelved` row records an item changed where it was, in its recipient's inventory (M5 on M4.1, 6.13). */
const changedInPlace = (row) => row.kind === "shelved" && Array.isArray(row.items) && row.items.some((item) => item?.inPlace === true);

/**
 * Where a finished order's item went (E, As built in M4.1): "delivered" into the recipient's inventory (a `delivered`
 * row that applied), "arriving" (a delivery under way, or the shelf item not here yet), "shelf" (on the pickup shelf,
 * for the recipient's owners to collect), or "strongbox" (an order for the strongbox keeps its item there). Null before
 * the order is complete.
 *
 * As built in M5 on M4.1, two finishes put nothing on the shelf: a formula job's formula goes into the recipient's book
 * by a formula claim ("book"), and an item the crafter etched, upgraded or gave a rune while holding it for themself is
 * changed where it is ("in-place", the finish's `shelved` row says so). Neither ever "arrives".
 * @param {object} order
 * @param {object[]} rows       the order's rows
 * @param {number} shelfCount   the order's items on the pickup shelf now
 * @returns {{state: "delivered"|"arriving"|"shelf"|"strongbox"|"book"|"in-place", to: string|null} | null}
 */
export function deliveryOf(order, rows = [], shelfCount = 0) {
    if (order.status !== "complete") return null;
    if (order.product?.type === "formula") return { state: "book", to: order.recipient?.uuid ?? null };
    if (order.recipient?.kind !== "actor") return { state: "strongbox", to: null };
    const live = liveRows(rows).filter((row) => row.order === order.id);
    if (live.some(changedInPlace)) return { state: "in-place", to: order.recipient.uuid };
    const delivered = live.find((row) => row.kind === "delivered");
    if (delivered) return { state: delivered.state === "applied" ? "delivered" : "arriving", to: delivered.actor ?? order.recipient.uuid };
    return { state: shelfCount > 0 ? "shelf" : "arriving", to: order.recipient.uuid };
}

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
 * @param {number} [p.shelfCount] the order's items on the pickup shelf now, for where a finished item went
 * @param {{priceCp: number, upfrontCp: number}|null} [p.plan]  before start, what the order would freeze now, as G8
 *        judges it (M5 on M4.1): the progress bar and what it still needs follow it rather than the snapshot's Price
 */
export function orderView(order, { rows = [], days = [], gates = null, crafterToday = null, viewer, nameOf, no = null, rules = DEFAULT_RULES,
    shelfCount = 0, plan = null }) {
    const progress = orderProgress(order, { rows, days, rules, plan });
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
    // The party fund's share that is not committed: any member may give it back to the unallocated fund (M4.1).
    const fundReturnable = viewer.hasCharacter ? fundReturnableCp(order, rows) : 0;
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
        blocked, contributors, committedCp: committedFromRows(rows), spent: spentBySource(rows),
        // Material stock earmarked for an open order, by who handed it over (M5 on M4.1): it stands in for coins.
        stock: CLOSED.includes(order.status) ? [] : stockBySource(order).map((s) => ({ ...s, name: s.actor ? nameOf(s.actor) : null })),
        shortfall: shortfallOf(order, rows, days, rules, plan),
        requirements: order.status === "accepted" && gates ? requirementsView(gates, order) : null,
        workDays: workDaysView(order, days, rules),
        cost: order.status === "complete" ? costSummary(order, rows, days, rules) : null,
        delivery: deliveryOf(order, rows, shelfCount),
        actions: { ...orderActions(order, viewer, { withdrawable: ownWithdrawable, gatesPass: gates ? blocked.length === 0 : false }),
            returnToFund: fundReturnable > 0 },
        withdrawableCp: ownWithdrawable, fundReturnableCp: fundReturnable,
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
 * How the Funds ledger names a row (As built in M4.1), as a `code` the window maps to a key: its kind, except that an allocation says which way it went (to an
 * order from the party fund, "earmark", or back, "unearmark"), and a finished order's item put in the strongbox rather
 * than on the shelf is "kept". The fund's side of an allocation pair is the mirror of its order's side and is not listed
 * (`mirror`); item rows (`shelved`, `delivered`) move no money (`items`). As built in M5 on M4.1, M5's item rows (an
 * item handed over and given back, stock in and out) move no money either, and an item changed where it was, in its
 * recipient's inventory, is "in-place" rather than "shelved".
 */
export function rowLabel(row) {
    if (row.kind === "allocate") {
        if (!row.order && !row.garden) return { code: "allocate", mirror: true, items: false };
        return { code: (row.alloc ?? 0) >= 0 ? "earmark" : "unearmark", mirror: false, items: false };
    }
    if (row.kind === "shelved") return { code: changedInPlace(row) ? "in-place" : row.actor ? "shelved" : "kept", mirror: false, items: true };
    return { code: row.kind, mirror: false, items: ITEM_ROW_KINDS.includes(row.kind) };
}

/** A row label's `code` and `items`, for the ledger list. */
const pick = ({ code, items }) => ({ code, items });

/**
 * Each member's balance as the fund accounts see it (review fix of M4.1): what their own purse put into orders
 * (`ownCp`), and their share of the party fund (`memberBalances`, pro rata by net deposits) split into the part still
 * unallocated and the part the fund has earmarked for orders, so the table agrees with the cards above it. The members'
 * shares count as unallocated first (money in the fund nobody deposited, `unassignedCp`, is earmarked before theirs);
 * the split is pro rata by share, so no member's unallocated part exceeds their share.
 */
function memberRows(balances, unallocatedCp) {
    const shares = balances.byActor.map(({ actor }) => ({
        key: actor,
        cp: balances.byAllocation.filter((a) => a.actor === actor && !a.order && !a.garden).reduce((sum, a) => sum + a.cp, 0),
    }));
    const shared = shares.reduce((sum, share) => sum + share.cp, 0);
    const unallocated = new Map(splitProRata(Math.max(0, Math.min(unallocatedCp, shared)), shares).map(({ key, cp }) => [key, cp]));
    return balances.byActor.map(({ actor, cp }) => {
        const fundCp = shares.find((share) => share.key === actor).cp;
        const fundUnallocatedCp = unallocated.get(actor) ?? 0;
        return { actor, cp, ownCp: cp - fundCp, fundCp, fundUnallocatedCp, fundEarmarkedCp: fundCp - fundUnallocatedCp };
    });
}

/**
 * The Funds tab (10.1): the strongbox's coins, the fund accounts (`fundAccounts`: unallocated party fund, money
 * earmarked per order by source, spent per order), each member's balance (`memberRows`), and the ledger, newest
 * first, each row with its author and whether this viewer may reverse it. The fund's side of an allocation pair is left
 * out of the ledger list, since its order's side says the same (`rowLabel`).
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
    const accounts = fundAccounts(rows, orders);
    const expectedCp = accounts.expectedCp;
    const balances = memberBalances(rows);
    const members = memberRows(balances, accounts.unallocatedCp).map((member) => ({
        ...member, name: nameOf(member.actor), mine: (viewer.isMine ?? viewer.owns)(member.actor),
        allocations: balances.byAllocation.filter((a) => a.actor === member.actor).map((a) => ({
            order: a.order, cp: a.cp, orderName: a.order ? orders[a.order]?.product?.snapshot?.name ?? null : null,
        })),
    }));
    const reversed = new Set(rows.filter((r) => r.kind === "reversal" && r.reverses).map((r) => r.reverses));
    const listed = [...rows].filter((row) => !rowLabel(row).mirror).sort((a, b) => compareRows(b, a));
    const ledger = listed.slice(0, limit).map((row) => ({
        id: row.id, kind: row.kind, ...pick(rowLabel(row)), cp: row.cp, box: row.box ?? 0,
        purse: row.purse ?? 0, alloc: row.alloc ?? 0, state: row.state,
        actor: row.actor ? nameOf(row.actor) : null, order: row.order ? orders[row.order]?.product?.snapshot?.name ?? null : null,
        author: userName(row.author), mine: row.author === viewer.userId, at: row.at?.real ?? null, note: row.note ?? null,
        reversed: !!row.reversedBy || reversed.has(row.id), reversal: row.kind === "reversal",
        canReverse: canReverse(row, rows, viewer, orders),
    }));
    return { actualCp, expectedCp, differenceCp: actualCp - expectedCp, fundCp: accounts.unallocatedCp, accounts,
        members, unassignedCp: balances.unassignedCp, ledger, total: listed.length };
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
