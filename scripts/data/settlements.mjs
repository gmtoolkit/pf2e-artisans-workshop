/**
 * Earn Income task levels by settlement size (DESIGN.md 6.10). Numbers only (P9).
 */

/**
 * The usual range of the highest task level in a settlement, as [lowest, highest], for a settlement whose
 * level is not known. GM Core p.53 (Earn Income): village 0-1, town 2-4, city 5-7, metropolis or capital
 * 8-10. The GM's settlement profiles start from the highest value of each range.
 */
export const SETTLEMENT_TASK_LEVELS = Object.freeze({
    village: Object.freeze([0, 1]),
    town: Object.freeze([2, 4]),
    city: Object.freeze([5, 7]),
    metropolis: Object.freeze([8, 10]),
});

/** Task levels the Income Earned table covers. Player Core p.228. */
export const TASK_LEVEL_MIN = 0;
export const TASK_LEVEL_MAX = 20;
