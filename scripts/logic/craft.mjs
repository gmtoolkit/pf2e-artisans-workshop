/**
 * Craft math (DESIGN.md 6.2): pricing a Craft, its setup, the plan an order freezes at start, and the
 * money each step of the order moves.
 *
 * Steps that move money return `{ patch, rows }`: the order fields to write and the ledger rows to post,
 * each `{ kind, cp }` with `cp` the unsigned amount (4.6). Zero-copper rows are left out, so free crafting
 * moves nothing. Nothing here writes; M2 turns the result into a lock-first batch (5.4).
 */
import { isComplexCraftSetup, complexSetup } from "./complex.mjs";
import { DEGREE, ROUTES_WITH_FORMULA, liveRows, requireCp, requireDegree, requireInteger } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { madeDespite, moneyDegree } from "./variants.mjs";

/** Days of setup without and with the formula. Player Core p.237. */
const SETUP_DAYS = { withFormula: 1, without: 2 };
/** Setups that are not a Craft setup: rune transfer (GM Core p.225), Grow (TV-R p.165), Deconstruct (TV-R p.162). */
const FIXED_SETUP_DAYS = { "rune-transfer": 1, grow: 4, deconstruct: 1 };
/** Share of the committed materials a critical failure ruins, in percent. Player Core p.237. */
const CRIT_FAIL_RUIN_PCT = 10;

/* -------------------------------------------- */
/*  Planning                                     */
/* -------------------------------------------- */

/**
 * Price and up-front materials for `quantity` items (6.2.2).
 *
 * The Price is the prepared item's (runes, precious material, shoddy and the recipient's size included),
 * for `per` items, scaled to the quantity and rounded to whole copper. The up-front half is rounded up: the
 * crafter supplies at least half (Player Core p.237), where the system floors. With the system's
 * free-crafting toggle on, nothing is paid; `listPriceCp` keeps the Price for display.
 *
 * @returns {{ok: true, priceCp: number, upfrontCp: number, listPriceCp: number, free: boolean}
 *          | {ok: false, reason: "no-price"}}
 */
export function craftCost({ unitPriceCp, per = 1, quantity, free = false }) {
    requireInteger(quantity, "quantity");
    const listPriceCp = Math.round((unitPriceCp * quantity) / Math.max(1, per));
    if (!(listPriceCp > 0)) return { ok: false, reason: "no-price" };   // G12: no Price, no Craft
    if (free) return { ok: true, priceCp: 0, upfrontCp: 0, listPriceCp, free: true };
    return { ok: true, priceCp: listPriceCp, upfrontCp: Math.ceil(listPriceCp / 2), listPriceCp, free: false };
}

/**
 * Setup needed before the check, `{days, hours}` plus `complex` under Complex Crafting (6.2.2):
 * 1. a registry override (the Reverse Engineering feat, the Inventor setting; formula jobs pass theirs);
 * 2. the fixed setups that are not Craft setups: rune transfer 1 day, Grow 4, Deconstruct 1;
 * 3. Complex Crafting's Table 5-1, when that variant is on and the order is a Craft of an item (6.16.1);
 * 4. otherwise 1 day with the formula, 2 without (Player Core p.237).
 *
 * @param {object} p
 * @param {string|null} p.route            the order's formula route (4.3)
 * @param {string} [p.craftType]
 * @param {string} [p.productType]         "item" or "formula"
 * @param {number|null} [p.override]       registry setup days
 * @param {object} [p.complex]             complexSetup's input, without `route`
 */
export function setupPlan({ route, craftType = "item", productType = "item", override = null, complex = null }, rules = DEFAULT_RULES) {
    if (override != null) return { days: requireInteger(override, "override"), hours: 0 };
    if (craftType in FIXED_SETUP_DAYS) return { days: FIXED_SETUP_DAYS[craftType], hours: 0 };
    if (rules.variants.complexCrafting && complex && isComplexCraftSetup(craftType, productType)) {
        const c = complexSetup({ ...complex, route });
        return { days: c.days, hours: c.hours, complex: { rush: c.rush, band: c.band, quick: c.quick } };
    }
    return { days: ROUTES_WITH_FORMULA.includes(route) ? SETUP_DAYS.withFormula : SETUP_DAYS.without, hours: 0 };
}

/**
 * The plan an order freezes when it starts: Price, up-front half, setup and DC (6.2.2). The quantity must
 * fit one batch (`batchMax`, 6.3); a larger request is split into several orders first.
 *
 * @param {object} p
 * @param {{priceCp: number, per?: number}} p.item   the prepared item's Price for `per` items
 * @param {number} p.quantity
 * @param {number} p.batchMax
 * @param {boolean} [p.free]
 * @param {object} p.setup     from setupPlan
 * @param {object} p.dc        from craftDC
 */
export function planCraft({ item, quantity, batchMax, free = false, setup, dc }) {
    requireInteger(batchMax, "batchMax");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > batchMax) {
        return { ok: false, reason: "quantity", data: { max: batchMax } };
    }
    const cost = craftCost({ unitPriceCp: item.priceCp, per: item.per, quantity, free });
    if (!cost.ok) return cost;
    return { ...cost, setup, dc };
}

/* -------------------------------------------- */
/*  Order steps                                  */
/* -------------------------------------------- */

/** Ledger rows from `[kind, cp]` pairs, without the zero ones. */
function rowsOf(pairs) {
    return pairs.filter(([, cp]) => cp > 0).map(([kind, cp]) => ({ kind, cp }));
}

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/**
 * Start an accepted order: freeze the plan, open a new attempt and commit the up-front half (4.2.3).
 * Gates (6.5) are the caller's to check first. A plan that `planCraft` refused is refused again here with
 * its own reason, so the order cannot start without a Price.
 */
export function startOrder(order, plan) {
    if (plan.ok === false) return refuse(plan.reason, plan.data ?? {});
    requireCp(plan.priceCp, "plan.priceCp");
    requireCp(plan.upfrontCp, "plan.upfrontCp");
    requireInteger(plan.dc.final, "plan.dc.final");
    if (order.status !== "accepted") return refuse("state", { status: order.status });
    const patch = {
        priceCp: plan.priceCp,
        upfrontCp: plan.upfrontCp,
        dc: plan.dc,
        setup: { days: plan.setup.days, hours: plan.setup.hours },
        attempt: (order.attempt ?? 0) + 1,
        check: null,
        status: "setup",
    };
    if (plan.setup.complex) patch.variant = { ...order.variant, complex: plan.setup.complex };   // frozen (6.16.1)
    return { ok: true, patch, rows: rowsOf([["commit", plan.upfrontCp]]) };
}

/**
 * Retry a failed order from scratch: a new attempt with a new commit; the frozen Price and DC stay (4.2.3).
 * The commit is the up-front half less what this order has already expended (`expendedFromRows`): that is
 * nothing unless an earlier attempt succeeded before a crafter swap, and materials already worked into the
 * item are not charged again (6.2.5).
 */
export function retryOrder(order, { expendedCp } = {}) {
    requireCp(expendedCp, "expendedCp");
    if (order.status !== "failed") return refuse("state", { status: order.status });
    return {
        ok: true,
        patch: { attempt: order.attempt + 1, check: null, status: "setup" },
        rows: rowsOf([["commit", Math.max(0, order.upfrontCp - expendedCp)]]),
    };
}

/**
 * Record the Craft check (6.12). Moves no money, so a reroll before settlement just replaces it. A check
 * that arrives after settlement is refused as a conflict: the crafter undoes the settlement first. A roll
 * made for an earlier attempt (a reroll of an old message after a retry or a crafter swap) is refused as
 * `stale-attempt`; the roll carries its attempt in its order roll option. A second roll for an attempt that
 * already has one and is not a reroll of it (a second dialog, a double click, another device) is refused as
 * `rolled`, so it never replaces the first; the same message recorded again is not a second roll.
 *
 * `settledRows` (`hasSettlementRows` over the order's rows) counts as settled too: a settlement's rows and its
 * `settled` flag land in one write, but a reroll recorded from a copy that had not seen it yet can overwrite the
 * flag and leave the rows, and the attempt must still count as settled after that.
 *
 * @param {object} check  `{degree, level, rank, attempt, unadjusted?, total?, messageId?, rerolled?}`:
 *                        `level` and `rank` are the crafter's at the roll, `attempt` the one it was made for
 * @param {{settledRows?: boolean}} [settlement]
 */
export function recordCheck(order, check, { settledRows = false } = {}) {
    requireDegree(check.degree, "check.degree");
    requireInteger(check.level, "check.level");
    requireInteger(check.rank, "check.rank");
    requireInteger(check.attempt, "check.attempt");
    if (check.attempt !== order.attempt) return refuse("stale-attempt", { attempt: check.attempt, current: order.attempt });
    if (order.check && !check.rerolled && check.messageId !== order.check.messageId) return refuse("rolled");
    if (order.check?.settled || settledRows) return refuse("settled");
    if (order.status !== "check" && order.status !== "rolled") return refuse("state", { status: order.status });
    return { ok: true, patch: { check: { ...check, settled: false }, status: "rolled" }, rows: [] };
}

/** The row kinds a settlement posts (`settleCheck`), keyed `<kind>:<orderId>:<attempt>:<seq>`. */
const SETTLEMENT_KINDS = new Set(["expend", "release", "ruin"]);

/**
 * Whether an attempt of an order has settlement rows that still count: an `expend`, `release` or `ruin` keyed for
 * that attempt, pending or applied, that has not been reversed (an undone settlement does not count).
 */
export function hasSettlementRows(rows, orderId, attempt) {
    return liveRows(rows).some((row) => SETTLEMENT_KINDS.has(row.kind) && typeof row.idem === "string" &&
        row.idem.startsWith(`${row.kind}:${orderId}:${attempt}:`));
}

/**
 * The amount 10% ruins on a critical failure, rounded up (the system floors). Player Core p.237.
 */
export function critFailRuinCp(committedCp) {
    return Math.ceil((requireCp(committedCp, "committedCp") * CRIT_FAIL_RUIN_PCT) / 100);
}

/**
 * Settle a recorded check (4.2.3, 6.2.3): on any success the committed materials are expended and the order
 * moves to finishing; a failure releases them in full; a critical failure ruins 10% and releases the rest.
 *
 * `committedCp` (required) is the order's committed, not yet expended amount, derived from its rows
 * (`committedFromRows`); it is the up-front half unless a crafter swap restarted an order whose materials
 * were already expended. `alchemical` (the product has the alchemical trait) adds the critical-failure
 * hazard notice (GM Core p.244).
 */
export function settleCheck(order, { committedCp, alchemical = false } = {}) {
    requireCp(committedCp, "committedCp");
    if (order.status !== "rolled" || !order.check) return refuse("state", { status: order.status });
    if (order.check.settled) return refuse("settled");
    const check = { ...order.check, settled: true };
    const degree = requireDegree(order.check.degree, "check.degree");
    // M9a (6.16.4): a critical failure whose Critical Crafting record makes the item anyway settles as a success would: the
    // materials go into the item, and its extra days run at the success rate (review fix of M9a).
    if (degree === DEGREE.success || degree === DEGREE.critSuccess || madeDespite(order.check.critical)) {
        return { ok: true, patch: { check, status: "finishing" }, rows: rowsOf([["expend", committedCp]]), notices: [] };
    }
    // M9a (6.16.4): under Critical Crafting's `replace`, a critical failure's special effect ruins nothing.
    if (degree === DEGREE.fail || moneyDegree(order.check) === DEGREE.fail) {
        return { ok: true, patch: { check, status: "failed" }, rows: rowsOf([["release", committedCp]]), notices: [] };
    }
    // Only a critical failure is left (requireDegree).
    const ruined = critFailRuinCp(committedCp);
    return {
        ok: true,
        patch: { check, status: "failed" },
        rows: rowsOf([["ruin", ruined], ["release", committedCp - ruined]]),
        notices: alchemical ? ["alchemical-crit-fail"] : [],
    };
}

/**
 * Finish an order in `finishing` by paying what is left (`remainingCp`, from the day records): a `remainder`
 * row, then delivery (5.5). Over-funding is refunded from the remaining allocations afterwards.
 */
export function finishOrder(order, remainingCp) {
    if (order.status !== "finishing") return refuse("state", { status: order.status });
    return { ok: true, patch: { status: "complete" }, rows: rowsOf([["remainder", requireCp(remainingCp, "remainingCp")]]) };
}

/**
 * Cancel an order (6.2.4): whatever is still committed is released, and every contributor's remaining
 * allocation becomes a refund claim. After a success the expended half stays spent (it is no longer in any
 * allocation). Both inputs are required: `committedCp` is `committedFromRows` and `allocations` is
 * `allocationsByContributor`, each over the order's rows.
 *
 * A check that is recorded but not settled (`rolled`) is refused as `unsettled`: the check is settled first,
 * so a critical failure still ruins its 10% and a success still expends the materials.
 */
export function cancelOrder(order, { committedCp, allocations } = {}) {
    requireCp(committedCp, "committedCp");
    if (!Array.isArray(allocations)) throw new TypeError("allocations must be an array");
    if (["complete", "cancelled", "archived"].includes(order.status)) return refuse("state", { status: order.status });
    if (order.status === "rolled") return refuse("unsettled");
    return {
        ok: true,
        patch: { status: "cancelled" },
        rows: rowsOf([["release", committedCp]]),
        refunds: allocations.filter((a) => a.cp > 0).map((a) => ({ actor: a.actor, cp: a.cp })),
    };
}

/** Pause an order in `setup` or `finishing` (4.2.3). */
export function pauseOrder(order) {
    if (order.status !== "setup" && order.status !== "finishing") return refuse("state", { status: order.status });
    return { ok: true, patch: { status: "paused", resumeTo: order.status }, rows: [] };
}

/**
 * Resume a paused order (6.2.5). Interrupted extra days always continue where they stopped (Player Core
 * p.237). Interrupted setup days persist by default; with `setupInterruptionPersists` off, a paused setup
 * resumes as a new attempt, so its setup days start again. Its commit stays: nothing was released.
 */
export function resumeOrder(order, rules = DEFAULT_RULES) {
    if (order.status !== "paused") return refuse("state", { status: order.status });
    const patch = { status: order.resumeTo, resumeTo: null };
    if (order.resumeTo === "setup" && !rules.setupInterruptionPersists) patch.attempt = order.attempt + 1;
    return { ok: true, patch, rows: [] };
}

/**
 * Hand an active order to another crafter (6.2.5). By default the swap restarts setup and the check as a
 * new attempt, while escrow and earmarked materials carry over; no rows are posted. With
 * `crafterSwapRestarts` off, the new crafter continues the current attempt. A recorded check that is not
 * settled yet is refused as `unsettled`, as for cancelling: the swap must not throw away its outcome.
 */
export function swapCrafter(order, crafter, rules = DEFAULT_RULES) {
    if (order.status === "rolled") return refuse("unsettled");
    const active = ["setup", "check", "finishing", "paused"];
    if (!active.includes(order.status)) return refuse("state", { status: order.status });
    if (!rules.crafterSwapRestarts) return { ok: true, patch: { crafter }, rows: [] };
    return {
        ok: true,
        patch: { crafter, attempt: order.attempt + 1, check: null, status: "setup", resumeTo: null },
        rows: [],
    };
}

/**
 * What an order still has committed and not yet expended, from its rows: commits minus expends, releases
 * and ruins. A row is `{kind, cp}` (4.6); reversed rows and reversals do not count (`liveRows`), so undoing a
 * settlement brings the committed amount back.
 */
export function committedFromRows(rows) {
    const sign = { commit: 1, expend: -1, release: -1, ruin: -1 };
    return liveRows(rows).reduce((sum, row) => sum + (sign[row.kind] ?? 0) * row.cp, 0);
}

/** What an order has expended on materials over all its attempts, from its rows (`expend`, not reversed). */
export function expendedFromRows(rows) {
    return liveRows(rows).filter((row) => row.kind === "expend").reduce((sum, row) => sum + row.cp, 0);
}
