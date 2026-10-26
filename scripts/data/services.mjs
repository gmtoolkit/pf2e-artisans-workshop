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

/**
 * Hit Points a Repair restores (Player Core p.236): `base + perRank × rank` of the repairer's Crafting rank, on a success
 * and on a critical success. The Crafter's Eyepiece raises both (GM Core); its numbers are its registry entry's
 * `repairHp` effect, since the system's repair macro ignores it (DESIGN.md 6.13, 6.15 gap 12).
 */
export const REPAIR_HP = Object.freeze({
    success: Object.freeze({ base: 5, perRank: 5 }),
    critSuccess: Object.freeze({ base: 10, perRank: 10 }),
});

/** Dice of damage a critical failure deals to the item being repaired, before its Hardness. Player Core p.236. */
export const REPAIR_CRIT_FAIL_DICE = "2d6";

/** Minutes a Repair, an Affix a Talisman and an Identify Alchemy take. Player Core pp.236-237; GM Core. */
export const SERVICE_MINUTES = Object.freeze({ repair: 10, affix: 10, "identify-alchemy": 10, "formula-copy": 60 });

/** Share of a rune's Price that transferring it costs, in percent. GM Core p.225. */
export const RUNE_TRANSFER_PCT = 10;

/** Talismans (or spellhearts) one host may hold; two with Talismanic Sage. GM Core (talisman trait). */
export const TALISMANS_PER_HOST = 1;
