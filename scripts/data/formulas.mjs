/**
 * Formula prices (DESIGN.md 6.1, 6.8). Numbers only (P9).
 */

/** Highest item level the table lists. */
export const FORMULA_PRICE_MAX_LEVEL = 20;

/**
 * Formula Price by item level 0..20, in cp. Player Core p.294, Table 6-13 (identical to the legacy Core
 * Rulebook table). Rune formulas use the same table by rune level (GM Core p.225).
 */
export const FORMULA_PRICE = Object.freeze([
    50, 100, 200, 300, 500, 800, 1300, 1800, 2500, 3500, 5000,
    7000, 10000, 15000, 22500, 32500, 50000, 75000, 120000, 200000, 350000,
]);

/** Minutes to copy a bought or borrowed formula into a formula book. Player Core p.294. */
export const FORMULA_COPY_MINUTES = 60;

/**
 * Minutes a schematic scanner takes to reverse-engineer a formula from an item it scans. Schematic
 * scanner (Pathfinder #215); its registry entry is a note.
 */
export const SCHEMATIC_SCANNER_MINUTES = 10;
