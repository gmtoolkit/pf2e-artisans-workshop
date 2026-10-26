/**
 * Formula routes and acquisition jobs (DESIGN.md 4.3, 6.8): how a crafter can Craft an item with or without
 * its formula, and the ways to get the formula (buy, copy, invent, reverse-engineer), with their cost,
 * time and check.
 */
import {
    FORMULA_COPY_MINUTES,
    FORMULA_PRICE,
    FORMULA_PRICE_MAX_LEVEL,
    REVERSE_ENGINEERING_BONUS,
    SCHEMATIC_SCANNER_MINUTES,
} from "../data/formulas.mjs";
import { FEAT, asSet, clamp, requireInteger } from "./core.mjs";
import { craftCost, setupPlan } from "./craft.mjs";
import { craftDC } from "./dc.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

/** Setup days of a Craft without and with the formula (Player Core p.237), and of crafting a formula copy. */
const SETUP = { withFormula: 1, without: 2, reverseEngineeringFeat: 1, craftCopy: 1 };

/** Provenance recorded when each route adds a formula to a book (4.13). */
export const PROVENANCE = Object.freeze({
    buy: "bought",
    "copy-npc": "copied-npc",
    "copy-ally": "copied-ally",
    invent: "invented",
    "reverse-engineer": "reverse-engineered",
    scanner: "reverse-engineered",
    "craft-copy": "copied-ally",
});

/**
 * A formula's Price by item level (Player Core p.294, Table 6-13). Levels above 20 use the level-20 Price,
 * the last the table lists; levels below 0 the level-0 one.
 */
export function formulaPrice(level) {
    requireInteger(level, "level");
    return FORMULA_PRICE[clamp(level, 0, FORMULA_PRICE_MAX_LEVEL)];
}

/**
 * What buying a formula costs: its Price, plus the uncommon or rare surcharge setting in percent (default
 * 0; GM Core p.48 suggests 10-100% and 25-500%), rounded up. Unique formulas take the rare surcharge.
 */
export function buyPriceCp({ level, rarity = "common" }, rules = DEFAULT_RULES) {
    const base = formulaPrice(level);
    const pct = rarity === "common" ? 0 : rarity === "uncommon" ? rules.formulaSurchargeUncommon : rules.formulaSurchargeRare;
    return base + Math.ceil((base * pct) / 100);
}

/**
 * The route a Craft of the item would take (4.3): the formula itself (`known`), another grade of its family
 * (`family`, 6.4), a feature's knowledge without a book (`virtual`), or no formula (`none`): open to common
 * items, and to rarer ones the crafter has access to through a registry grant unless `uncommonNeedsFormula`
 * is on. Null when the Craft needs a formula job first.
 */
export function craftRoute({ known = false, family = false, virtual = false, rarity = "common", accessGrant = false }, rules = DEFAULT_RULES) {
    if (known) return "known";
    if (family) return "family";
    if (virtual) return "virtual";
    if (rarity === "common" || (accessGrant && !rules.uncommonNeedsFormula)) return "none";
    return null;
}

/**
 * The ways to obtain a formula the crafter lacks (4.3, 6.8), each `{route, costCp, minutes | setupDays,
 * check, needs}`. `check` is "craft" for the Craft-like jobs; `needs` lists checklist confirmations
 * ("seller": someone sells it, for an uncommon or rarer formula; "ally-confirms": the ally's owner agrees).
 *
 * @param {object} p
 * @param {{level: number, rarity?: string, noReverseEngineer?: boolean}} p.item   `noReverseEngineer`: registry (fulus)
 * @param {string[]} [p.feats]           the crafter's registry feat slugs
 * @param {boolean} [p.possessesItem]    the item is on the crafter or earmarked to them
 * @param {boolean} [p.allyHasFormula]   an ally's roster lists the formula
 * @param {boolean} [p.hasScanner]       the crafter holds a schematic scanner
 */
export function acquisitionRoutes({ item, feats = [], possessesItem = false, allyHasFormula = false, hasScanner = false }, rules = DEFAULT_RULES) {
    const rarity = item.rarity ?? "common";
    const price = formulaPrice(item.level);
    const seller = rarity === "common" ? [] : ["seller"];
    const has = asSet(feats);
    const routes = [
        { route: "buy", costCp: buyPriceCp(item, rules), minutes: FORMULA_COPY_MINUTES, check: null, needs: seller },
        { route: "copy-npc", costCp: price, minutes: FORMULA_COPY_MINUTES, check: null, needs: seller },
    ];
    if (allyHasFormula) {
        routes.push({ route: "copy-ally", costCp: rules.allyCopyCostCp, minutes: FORMULA_COPY_MINUTES, check: null, needs: ["ally-confirms"] });
    }
    const inventable = rarity === "common" || (rules.inventorRarity && (rarity === "uncommon" || rarity === "rare"));
    if (has.has(FEAT.inventor) && inventable) {
        routes.push({ route: "invent", costCp: price, setupDays: rules.inventorSetupDays, check: "craft", needs: [] });
    }
    if (possessesItem && !item.noReverseEngineer) {
        const setupDays = has.has(FEAT.reverseEngineering) ? SETUP.reverseEngineeringFeat : SETUP.without;
        routes.push({ route: "reverse-engineer", costCp: price, setupDays, check: "craft", needs: [] });
        if (hasScanner) routes.push({ route: "scanner", costCp: 0, minutes: SCHEMATIC_SCANNER_MINUTES, check: null, needs: [] });
    }
    return routes;
}

/**
 * Every route for a crafter and an item, side by side (4.3): the Craft route if there is one, then, when
 * the crafter lacks the formula, the ways to get it. A `none` route carries the formula Price as `hintCp`,
 * the price of saving a setup day.
 */
export function formulaRoutes(p, rules = DEFAULT_RULES) {
    const route = craftRoute({ ...p, rarity: p.item.rarity }, rules);
    if (route && route !== "none") return [{ route, costCp: 0, setupDays: SETUP.withFormula, check: "craft", needs: [] }];
    const none = route === "none"
        ? [{ route, costCp: 0, setupDays: SETUP.without, check: "craft", needs: [], hintCp: formulaPrice(p.item.level) }]
        : [];
    return [...none, ...acquisitionRoutes(p, rules)];
}

/** The route for crafting a copy of a formula the crafter knows into someone else's book (6.8). */
export function craftCopyRoute(item) {
    return { route: "craft-copy", costCp: formulaPrice(item.level), setupDays: SETUP.craftCopy, check: "craft", needs: [] };
}

/**
 * The plan of a Craft-like formula job (invent, reverse-engineer, craft-copy; 6.8): the formula's Price as
 * the order's Price (half up front, extra days reduce the rest), the job's setup days, and the item's Craft
 * DC with its rarity adjustment (Player Core p.294). Reverse-engineering with the Reverse Engineering feat
 * also carries its +2 circumstance bonus for the roll wrapper (M3).
 *
 * @param {"invent"|"reverse-engineer"|"craft-copy"} route
 * @param {object} p
 * @param {{level: number, rarity?: string}} p.item
 * @param {string[]} [p.feats]
 * @param {boolean} [p.pwol]
 * @param {number} [p.dcAdjust]   registry adjustments
 */
export function formulaJobPlan(route, { item, feats = [], pwol = false, dcAdjust = 0 }, rules = DEFAULT_RULES) {
    const reverseFeat = route === "reverse-engineer" && asSet(feats).has(FEAT.reverseEngineering);
    const days = route === "invent" ? rules.inventorSetupDays
        : route === "reverse-engineer" ? (reverseFeat ? SETUP.reverseEngineeringFeat : SETUP.without)
        : route === "craft-copy" ? SETUP.craftCopy : null;
    if (days == null) throw new RangeError(`not a Craft-like formula route: ${route}`);
    const cost = craftCost({ unitPriceCp: formulaPrice(item.level), quantity: 1 });
    return {
        priceCp: cost.priceCp,
        upfrontCp: cost.upfrontCp,
        setup: setupPlan({ route: null, productType: "formula", override: days }, rules),
        dc: craftDC({ level: item.level, rarity: item.rarity, pwol, adjust: dcAdjust }, rules),
        bonus: reverseFeat ? { type: "circumstance", value: REVERSE_ENGINEERING_BONUS } : null,
    };
}
