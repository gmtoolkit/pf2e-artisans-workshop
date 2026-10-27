/**
 * Complex Crafting variant setup (DESIGN.md 6.16.1). Numbers only (P9). Built in M1 because the setup plan
 * of 6.2.2 calls it; the rest of the variant (rushed finishing, the flat check) is M9a.
 */

/**
 * Days of setup by the item's level relative to the crafter's: index 0 = equal to yours, 1 = 1 or 2 below,
 * 2 = 3 or more below. Treasure Vault (Remastered) p.158, Table 5-1.
 */
export const COMPLEX_SETUP_DAYS = Object.freeze({
    consumable: Object.freeze([2, 1, 1]),
    permanent: Object.freeze([4, 3, 2]),
});

/** DC added for each day of setup rushed. Treasure Vault (Remastered) p.158. */
export const COMPLEX_RUSH_DC = 5;

/**
 * Hours a setup rushed below one day still takes. Treasure Vault (Remastered) p.158 (a consumable 4 hours;
 * a permanent item cannot go below 1 day) and p.159, Quick Setup (a consumable 2 hours, a permanent item
 * 4 hours, for items at least `QUICK_SETUP_LEVELS_BELOW` levels below the crafter).
 */
export const COMPLEX_SUBDAY_HOURS = Object.freeze({ consumable: 4, quickConsumable: 2, quickPermanent: 4 });

/**
 * Hours of sub-day setups one crafter may record on one day (review fix of M9a). Only Quick Setup's 2-hour consumable
 * setup fits into an adventuring day (Treasure Vault (Remastered) p.159); the book gives no number for how many, so a working
 * day of 8 hours bounds them (interpretation, OQ-42).
 */
export const SETUP_HOURS_PER_DAY = 8;
export const QUICK_SETUP_LEVELS_BELOW = 6;
