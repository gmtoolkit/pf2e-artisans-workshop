/**
 * DCs (DESIGN.md 6.2.1): level-based DCs, the rarity adjustment and the Craft DC an order freezes at start.
 */
import { COMPLEX_RUSH_DC } from "../data/complex-crafting.mjs";
import { DC_ADJUSTMENT, DC_BY_LEVEL, DC_LEVEL_MAX, DC_LEVEL_MIN, RARITY_DC_ADJUSTMENT } from "../data/dc.mjs";
import { clamp, requireInteger } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

/**
 * The level-based DC. Levels outside -1..25 use the nearest end of the table. Under Proficiency without
 * Level the level itself comes off again (never for level -1), as pf2e `calculateDC` does (GM Core p.85).
 */
export function levelDC(level, { pwol = false } = {}) {
    requireInteger(level, "level");
    const base = DC_BY_LEVEL[clamp(level, DC_LEVEL_MIN, DC_LEVEL_MAX) - DC_LEVEL_MIN];
    return pwol ? base - Math.max(level, 0) : base;
}

/** The DC adjustment for a rarity: +0, +2, +5 or +10. GM Core p.53. */
export function rarityAdjustment(rarity = "common") {
    const adjustment = RARITY_DC_ADJUSTMENT[rarity];
    if (adjustment === undefined) throw new RangeError(`unknown rarity ${rarity}`);
    return adjustment;
}

/**
 * The Craft DC, as the breakdown an order freezes at start (`order.dc`, DESIGN.md 4.2.1):
 * - `level`: the item level the DC is for (an upgrade uses the new level);
 * - `rarity`: the rarity adjustment in DC points;
 * - `repeat`: -2 when the optional easy DC for an item made before applies (GM Core p.53), else 0;
 * - `adjust`: everything else: registry adjustments and the +5 per day of a rushed Complex Crafting
 *   setup (6.16.1);
 * - `pwol`: whether Proficiency without Level was on;
 * - `final`: the DC the check is rolled against.
 *
 * @param {object} p
 * @param {number} p.level            item level
 * @param {string} [p.rarity]         "common" .. "unique"
 * @param {boolean} [p.pwol]          Proficiency without Level
 * @param {boolean} [p.madeBefore]    the crafter has crafted this exact item (same source UUID) before
 * @param {number} [p.adjust]         registry and other adjustments, in DC points
 * @param {number} [p.rush]           Complex Crafting setup days rushed
 * @param {object} [rules]
 */
export function craftDC({ level, rarity = "common", pwol = false, madeBefore = false, adjust = 0, rush = 0 }, rules = DEFAULT_RULES) {
    const parts = {
        level,
        rarity: rarityAdjustment(rarity),
        repeat: rules.easyDcForRepeat && madeBefore ? DC_ADJUSTMENT.easy : 0,
        adjust: adjust + COMPLEX_RUSH_DC * requireInteger(rush, "rush"),
        pwol,
    };
    return { ...parts, final: levelDC(level, { pwol }) + parts.rarity + parts.repeat + parts.adjust };
}
