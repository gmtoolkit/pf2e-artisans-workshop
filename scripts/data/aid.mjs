/**
 * Aid on a check (DESIGN.md 6.7, "Aid without the feat"). Numbers only (P9).
 */

/** The typical DC to Aid. Player Core p.416 (the legacy Core Rulebook used 20). */
export const AID_TYPICAL_DC = 15;

/**
 * Circumstance modifier an Aid grants, by the aider's degree of success 0..3 (critical failure ..
 * critical success). A critical success depends on the aider's rank: `AID_CRIT_BY_RANK[rank]`, rank 0..4.
 * Player Core p.416.
 */
export const AID_MODIFIER = Object.freeze([-1, 0, 1, null]);
export const AID_CRIT_BY_RANK = Object.freeze([2, 2, 2, 3, 4]);
