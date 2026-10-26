/**
 * Complex Crafting setup (DESIGN.md 6.16.1): setup days from Treasure Vault (Remastered) Table 5-1 and
 * rushing them for a higher DC. Only the setup lives here, because the setup plan of 6.2.2 calls it; the
 * rushed finish and its flat check are M9a.
 */
import {
    COMPLEX_SETUP_DAYS,
    COMPLEX_SUBDAY_HOURS,
    QUICK_SETUP_LEVELS_BELOW,
} from "../data/complex-crafting.mjs";
import { RANK, ROUTES_WITH_FORMULA, clamp, requireInteger } from "./core.mjs";

/** Craft types whose setup Table 5-1 replaces, when the product is an item rather than a formula. */
const COMPLEX_CRAFT_TYPES = new Set(["item", "upgrade", "rune-etch", "tattoo", "graft", "spell-item"]);

/** Whether Complex Crafting replaces this order's setup (6.16.1, Scope). */
export function isComplexCraftSetup(craftType, productType = "item") {
    return productType === "item" && COMPLEX_CRAFT_TYPES.has(craftType);
}

/**
 * The Complex Crafting setup.
 *
 * - Table 5-1 by the item's level relative to the crafter (equal, 1-2 below, 3+ below) and by whether it
 *   batches as a consumable; having the formula takes a day off, to at least 1 day.
 * - Rushing takes one day off per rank above trained (expert 1, master 2, legendary 3), each for +5 DC
 *   (craftDC adds that from `rush`). A permanent item without Quick Setup cannot go below 1 day, so the
 *   rush is capped there: a further rushed day would only add DC.
 * - A setup rushed to 0 days takes hours instead: a consumable 4, or with Quick Setup (an item at least 6
 *   levels below the crafter) a consumable 2 and a permanent item 4.
 *
 * @returns {{days: number, hours: number, rush: number, band: number, quick: boolean}} `rush` is the number
 *   of days actually rushed after the caps; `quick` is true only when Quick Setup set the hours.
 */
export function complexSetup({ itemLevel, crafterLevel, consumable, route, rank, quickSetup = false, rushDays = 0 }) {
    requireInteger(rushDays, "rushDays");
    const delta = crafterLevel - itemLevel;             // >= 0 once gate G2 has passed
    const band = delta <= 0 ? 0 : delta <= 2 ? 1 : 2;
    let days = COMPLEX_SETUP_DAYS[consumable ? "consumable" : "permanent"][band];
    if (ROUTES_WITH_FORMULA.includes(route)) days = Math.max(1, days - 1);
    const quick = quickSetup && delta >= QUICK_SETUP_LEVELS_BELOW;
    const floor = consumable || quick ? 0 : 1;
    const rush = clamp(rushDays, 0, Math.min(Math.max(0, rank - RANK.trained), days - floor));
    days -= rush;
    if (days >= 1) return { days, hours: 0, rush, band, quick: false };   // Quick Setup changed nothing
    const hours = !quick ? COMPLEX_SUBDAY_HOURS.consumable
        : consumable ? COMPLEX_SUBDAY_HOURS.quickConsumable : COMPLEX_SUBDAY_HOURS.quickPermanent;
    return { days: 0, hours, rush, band, quick };
}
