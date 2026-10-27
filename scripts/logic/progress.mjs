/**
 * Work totals of an order, derived from its day records (DESIGN.md 4.2.1, 4.8, 6.2.2, 6.2.3). Nothing
 * here is stored: setup days done, the cost reduction earned and what is left to pay are recomputed from the
 * day records of the order's current attempt, so a day resolved twice (one keyed record) counts once.
 *
 * A day record is `{actor, day, order, attempt, kind: "setup" | "extra" | "setup-hours" | ..., crafterCp?,
 * helpers?: {[actorId]: cp}}`. `days` may hold the day records and the per-order variant records together.
 */
import { DEGREE } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { helperForfeits, helperPresent, helperRate } from "./communal.mjs";
import { incomePerDay } from "./income.mjs";

/**
 * The records of `kind` for the order's current attempt, one per actor and day: should two records for the
 * same actor, day and kind ever be passed, the first counts.
 */
export function recordsOf(order, days, kind) {
    const seen = new Set();
    return days.filter((d) => {
        if (d.order !== order.id || d.attempt !== order.attempt || d.kind !== kind) return false;
        const key = `${d.actor}|${d.day}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Setup days done in the current attempt (a Deconstruct follow-on credit is one of them, 6.16.5). */
export function setupDaysDone(order, days) {
    return recordsOf(order, days, "setup").length;
}

/**
 * Whether the setup is complete, which moves the order from `setup` to `check` (4.2.3): enough setup days,
 * and for a sub-day Complex Crafting setup its `setup-hours` record (6.16.1).
 */
export function setupComplete(order, days) {
    const hoursDone = order.setup.hours === 0 || recordsOf(order, days, "setup-hours").length > 0;
    return setupDaysDone(order, days) >= order.setup.days && hoursDone;
}

/**
 * The crafter's reduction for one extra day (6.2.3), at the Income Earned entry for the crafter's level
 * (level + 1 after a critical success) and Crafting rank. By default the level and rank are the crafter's on
 * that day, so a level-up raises the rate; with `recomputeRateOnLevelUp` off they stay those of the roll.
 * The degree stays the check's. `rateLevel`, from the registry, replaces the level (Monster Crafting).
 *
 * @param {{degree: number, level: number, rank: number}} check   the order's check
 * @param {{level: number, rank: number}} crafterToday
 * @param {number|null} [rateLevel]
 */
export function crafterRate(check, crafterToday, rateLevel = null, rules = DEFAULT_RULES) {
    const current = rules.recomputeRateOnLevelUp ? crafterToday : check;
    const level = rateLevel ?? current.level;
    const degree = check.degree === DEGREE.critSuccess ? DEGREE.critSuccess : DEGREE.success;
    return incomePerDay(level, current.rank, degree);
}

/**
 * The content of the crafter's day record for `day` when their activity is this order (6.2.3): the
 * crafter's reduction and each present helper's. Pure and deterministic, so any client resolving the day
 * writes the same record. Null when the order is not past its check. While the check is recorded but not
 * settled the record is written at the recorded degree; it counts only once the check settles as a success.
 *
 * @param {object} order   with `id`, `attempt`, `status`, `check` and `helpers` ({[actorId]: {level, rank, degree, joinedDay, leftDay}})
 * @param {number} day
 * @param {object} p
 * @param {{level: number, rank: number}} p.crafter   the crafter on that day
 * @param {number|null} [p.rateLevel]
 */
export function extraDayRecord(order, day, { crafter, rateLevel = null }, rules = DEFAULT_RULES) {
    if (order.status !== "rolled" && order.status !== "finishing") return null;
    const helpers = Object.entries(order.helpers ?? {}).filter(([, h]) => helperPresent(h, day));
    return {
        order: order.id,
        attempt: order.attempt,
        kind: "extra",
        day,
        crafterCp: crafterRate(order.check, crafter, rateLevel, rules),
        helpers: Object.fromEntries(helpers.map(([id, h]) => [id, helperRate(h, rules)])),
    };
}

/**
 * The cost reduction the order has earned (6.2.3): every extra day of the current attempt, the crafter's
 * share and each helper's, once the check has settled as a success. A helper who left forfeits everything
 * they contributed, by default (6.7). A helper whose entry is no longer on the order is treated as one who
 * left: forfeited while leaving is retroactive, kept otherwise.
 */
export function reductionCp(order, days, rules = DEFAULT_RULES) {
    if (!(order.check?.settled && order.check.degree >= DEGREE.success)) return 0;
    return recordsOf(order, days, "extra").reduce((sum, d) => sum + dayReductionCp(order, d, rules), 0);
}

/**
 * What one extra-day record takes off (6.2.3): the crafter's share and each helper's that is not forfeited (6.7). It
 * counts only once the check has settled as a success, which `reductionCp` checks; this is the day's own amount.
 */
export function dayReductionCp(order, record, rules = DEFAULT_RULES) {
    const forfeited = (id) => {
        const helper = order.helpers?.[id];
        return helper ? helperForfeits(helper, rules) : rules.communal.helperLeaveRetroactive;
    };
    const helpers = Object.entries(record.helpers ?? {}).reduce((s, [id, cp]) => s + (forfeited(id) ? 0 : cp), 0);
    return (record.crafterCp ?? 0) + helpers;
}

/**
 * What is left to pay to finish (6.2.3). Never below zero, so the total never drops below the up-front half
 * (Player Core p.237, crafting example).
 */
export function remainingCp(order, days, rules = DEFAULT_RULES) {
    return Math.max(0, order.priceCp - order.upfrontCp - reductionCp(order, days, rules));
}

/** What the Craft costs in all: the up-front half plus what is left. */
export function totalCostCp(order, days, rules = DEFAULT_RULES) {
    return order.upfrontCp + remainingCp(order, days, rules);
}

/** Extra days still needed to bring `remaining` to zero at `perDay` a day; Infinity at no reduction. */
export function daysToZero(remaining, perDay) {
    if (remaining <= 0) return 0;
    return perDay > 0 ? Math.ceil(remaining / perDay) : Infinity;
}

/** The last day worked on the order in its current attempt, or null. */
export function lastDayWorked(order, days) {
    const worked = [...recordsOf(order, days, "setup"), ...recordsOf(order, days, "extra")].map((d) => d.day);
    return worked.length ? Math.max(...worked) : null;
}
