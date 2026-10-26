/**
 * Difficulty classes (DESIGN.md 6.1). Numbers only: the module ships no rules text (P9).
 */

/** Lowest and highest level the level-based DC table covers. */
export const DC_LEVEL_MIN = -1;
export const DC_LEVEL_MAX = 25;

/**
 * Level-based DCs for levels -1..25; index = level + 1.
 * GM Core p.52 (Level-Based DCs); identical to pf2e `src/module/dc.ts` `dcByLevel`.
 */
export const DC_BY_LEVEL = Object.freeze([
    13, 14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30,
    31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50,
]);

/** DC adjustments. GM Core p.52 (Adjusting Difficulty); pf2e `src/module/dc.ts` `dcAdjustments`. */
export const DC_ADJUSTMENT = Object.freeze({
    incrediblyEasy: -10,
    veryEasy: -5,
    easy: -2,
    normal: 0,
    hard: 2,
    veryHard: 5,
    incrediblyHard: 10,
});

/**
 * Rarity adjustments: uncommon is hard, rare very hard, unique incredibly hard. GM Core pp.52-53;
 * pf2e `src/module/dc.ts` `rarityToDCAdjustment`.
 */
export const RARITY_DC_ADJUSTMENT = Object.freeze({
    common: DC_ADJUSTMENT.normal,
    uncommon: DC_ADJUSTMENT.hard,
    rare: DC_ADJUSTMENT.veryHard,
    unique: DC_ADJUSTMENT.incrediblyHard,
});
