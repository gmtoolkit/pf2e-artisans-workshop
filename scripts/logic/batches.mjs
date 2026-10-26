/**
 * Batch sizes (DESIGN.md 4.4, 6.3): several identical items from one Craft, one check, all materials up
 * front. The daily reduction does not grow with the batch.
 */
import { hasTrait, isMagical, requireInteger } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

/** Most scrolls one Craft makes: one casting each, all the same spell. GM Core p.262. */
const SCROLL_BATCH = 4;
/** Consumables batch in fours. Player Core p.237 (Consumables and Ammunition). */
const CONSUMABLE_BATCH = 4;

/**
 * Whether the item batches as a consumable: the consumable trait, or the registry correction for the four
 * talismans whose data lacks it (`item.consumableFix`). Complex Crafting's setup column uses the same test.
 */
export function isConsumableForBatch(item) {
    return hasTrait(item, "consumable") || item.consumableFix === true;
}

/**
 * The largest quantity one Craft may make.
 *
 * @param {object} item
 * @param {string[]} item.traits
 * @param {number} [item.per]          `price.per`: ammunition is priced (and batched) per 10
 * @param {string} [item.type]         pf2e item type; "ammo" for ammunition
 * @param {"scroll"|"wand"|null} [item.spellcasting]  from `CONFIG.PF2E.spellcastingItems`
 * @param {boolean} [item.consumableFix]  the registry's correction (`consumableFix` in registry.mjs)
 * @param {object} [options]
 * @param {number} [options.multiplier]       the registry's batch multiplier for the crafter and item
 *                                            (`batchMultiplier`: 2 for Efficient Alchemy on alchemical consumables)
 * @param {number} [options.pledgedCastings]  castings pledged for a scroll order (6.9)
 * @param {object} [rules]
 */
export function batchMax(item, { multiplier = 1, pledgedCastings = 0 } = {}, rules = DEFAULT_RULES) {
    const per = Math.max(1, item.per ?? 1);
    const consumable = isConsumableForBatch(item);
    let max = consumable ? Math.max(CONSUMABLE_BATCH, per) : per;          // matches pf2e getFormulas
    if (item.type === "ammo" && !isMagical(item)) max = per;              // mundane ammunition: per 10
    max *= requireInteger(multiplier, "multiplier");                      // Efficient Alchemy: twice as many
    if (item.spellcasting === "scroll") max = Math.min(SCROLL_BATCH, pledgedCastings);
    if (item.spellcasting === "wand") max = 1;                            // GM Core p.282
    if (hasTrait(item, "snare")) max = rules.snareDowntimeBatch;          // OQ-14
    return max;
}

/**
 * A request for more than one batch, split into sequential orders of at most `max` each, largest first
 * (one crafter does one downtime activity a day, GM Core p.46).
 */
export function splitIntoBatches(quantity, max) {
    requireInteger(quantity, "quantity");
    requireInteger(max, "max");
    if (quantity < 1 || max < 1) return [];
    const batches = Array(Math.floor(quantity / max)).fill(max);
    if (quantity % max) batches.push(quantity % max);
    return batches;
}
