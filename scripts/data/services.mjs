/**
 * Prices of services and of living during downtime (DESIGN.md 6.1, 6.9, 6.10). Numbers only (P9).
 */

/**
 * Spellcasting services by spell rank 1..9 (index = rank - 1), in cp, before the spell's own cost.
 * Player Core p.295 (Spellcasting Services).
 */
export const SPELLCASTING_SERVICE = Object.freeze([300, 700, 1800, 4000, 8000, 16000, 36000, 72000, 180000]);

/**
 * Cost of living by standard and period, in cp. Player Core p.295, Table 6-16. Subsisting costs nothing
 * (Player Core p.295); that is an activity, not a standard of living.
 */
export const COST_OF_LIVING = Object.freeze({
    subsistence: Object.freeze({ week: 40, month: 200, year: 2400 }),
    comfortable: Object.freeze({ week: 100, month: 400, year: 5200 }),
    fine: Object.freeze({ week: 3000, month: 13000, year: 160000 }),
    extravagant: Object.freeze({ week: 10000, month: 43000, year: 520000 }),
});
