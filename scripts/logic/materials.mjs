/**
 * Precious materials (DESIGN.md 6.6, GM Core pp.252-253): who can craft with them, the level caps of each
 * grade, and how much of the up-front materials must be the material itself.
 */
import {
    COMMON_PRECIOUS_MATERIALS, PRECIOUS_GRADE, PRECIOUS_MATERIALS_PER_ITEM, PRECIOUS_MIN_RANK, STOCK_SUFFIXES,
} from "../data/materials.mjs";
import { requireCp } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

/** The share of the up-front materials that must be the material, rounded up to whole copper. */
export function materialShareCp(upfrontCp, grade) {
    return Math.ceil((requireCp(upfrontCp, "upfrontCp") * PRECIOUS_GRADE[grade].upfrontPct) / 100);
}

/**
 * Check a Craft that uses precious materials (gate G8's material part). Every failed condition is reported.
 *
 * @param {object} p
 * @param {{level: number, rank: number}} p.crafter      level and Crafting rank
 * @param {{level: number, magical: boolean}} p.item     the prepared item; `magical` also for a rune
 * @param {{type: string, grade: "low"|"standard"|"high", level: number, rarity: string, validForItem?: boolean}[]} p.materials
 *        the precious materials in the item, from the prepared item (pf2e materials data) and the registry
 * @param {number} p.upfrontCp   the order's up-front half (for a grade upgrade: the upgrade's)
 * @param {number} [p.stockCp]   earmarked stock of the material (ingots, chunks, lumber), at Price
 * @param {number} [p.coinCp]    coins in the order's escrow, which may stand in for a common material
 * @returns {{ok: boolean, problems: {reason: string, data?: object}[], requiredCp: number}}
 */
export function preciousCheck({ crafter, item, materials = [], upfrontCp, stockCp = 0, coinCp = 0 }, rules = DEFAULT_RULES) {
    if (materials.length === 0) return { ok: true, problems: [], requiredCp: 0 };
    const problems = [];
    if (materials.length > PRECIOUS_MATERIALS_PER_ITEM) problems.push({ reason: "one-material" });
    const [material] = materials;
    const grade = PRECIOUS_GRADE[material.grade];
    if (!grade) throw new RangeError(`unknown grade ${material.grade}`);

    if (crafter.rank < PRECIOUS_MIN_RANK) problems.push({ reason: "expert-needed" });
    if (crafter.rank < grade.rank) problems.push({ reason: "grade-rank", data: { grade: material.grade, rank: grade.rank } });
    if (crafter.level < material.level) problems.push({ reason: "material-level", data: { level: material.level } });
    if (item.magical && grade.maxMagicLevel != null && item.level > grade.maxMagicLevel) {
        problems.push({ reason: "grade-item-level", data: { grade: material.grade, max: grade.maxMagicLevel } });
    }
    if (material.validForItem === false) problems.push({ reason: "invalid-for-item", data: { type: material.type } });

    // Coin buys a common material in a settlement; rarer materials need stock (Player Core p.237).
    const requiredCp = materialShareCp(upfrontCp, material.grade);
    const coinCounts = rules.preciousCoinForCommon && material.rarity === "common";
    const availableCp = stockCp + (coinCounts ? coinCp : 0);
    if (availableCp < requiredCp) {
        problems.push({ reason: "material-share", data: { requiredCp, availableCp, stockOnly: !coinCounts, type: material.type } });
    }
    return { ok: problems.length === 0, problems, requiredCp };
}

/**
 * Why an item of a precious material cannot hold a rune of `level`, or null (GM Core p.253: a low-grade item holds runes
 * of up to 8th level, a standard-grade one up to 15th; DESIGN.md 6.6 "Magic item and rune level caps"): `grade-rune-level`
 * with the grade and its cap. An item of no precious material, or of high grade, holds any.
 *
 * @param {{type?: string|null, grade?: string|null}} material   the item's `system.material`
 * @param {number} level   the rune's level
 */
export function runeLevelProblem(material, level) {
    const max = material?.type ? PRECIOUS_GRADE[material.grade]?.maxMagicLevel : null;
    if (max === null || max === undefined || level <= max) return null;
    return { reason: "grade-rune-level", data: { grade: material.grade, max } };
}

/* -------------------------------------------- */
/*  Stock lines (M5)                             */
/* -------------------------------------------- */

/** The rarity a material's share rule reads (6.6): common for cold iron and silver, otherwise uncommon or rarer. */
export const materialRarity = (type) => (COMMON_PRECIOUS_MATERIALS.includes(type) ? "common" : "uncommon");

/**
 * The precious material a stock item is (an adamantine chunk, a cold iron ingot, duskwood lumber), from its slug and its
 * `precious` trait, or null when it is not stock.
 * @param {{slug?: string|null, traits?: string[]}} item
 */
export function stockMaterial(item) {
    if (!(item.traits ?? []).includes("precious") || typeof item.slug !== "string") return null;
    const suffix = STOCK_SUFFIXES.find((s) => item.slug.endsWith(s));
    return suffix ? item.slug.slice(0, -suffix.length) : null;
}

/**
 * The live material lines of an order (`orders.<id>.materials`, 4.2.1): items earmarked in the strongbox and counted at
 * their Price toward the up-front materials (Player Core p.267). Consumed lines (`used`) and returned ones are left out.
 */
export function materialLines(order) {
    return Object.values(order?.materials ?? {}).filter((line) => line && !line.used && !line.returned && Number.isSafeInteger(line.valueCp));
}

/** What an order's earmarked material items are worth, at Price. */
export const materialsCp = (order) => materialLines(order).reduce((sum, line) => sum + line.valueCp, 0);

/** The value of an order's earmarked stock of one precious material type. */
export const stockCpOf = (order, type) =>
    materialLines(order).filter((line) => line.material === type).reduce((sum, line) => sum + line.valueCp, 0);

/**
 * The precious-material check of an order (G8's material part, 6.6) from what the product is made of and the stock
 * earmarked to it. Null for a product of no precious material.
 *
 * @param {object} p
 * @param {{level: number, magical: boolean, material?: {type: string|null, grade: string|null}}} p.product  the prepared item
 * @param {{level: number, rank: number}} p.crafter
 * @param {object} p.order
 * @param {number} p.upfrontCp
 * @param {number} p.coinCp     the order's coin escrow
 */
export function orderPrecious({ product, crafter, order, upfrontCp, coinCp }, rules = DEFAULT_RULES) {
    const type = product.material?.type;
    const grade = product.material?.grade;
    if (!type || !grade || !PRECIOUS_GRADE[grade]) return null;
    return preciousCheck({
        crafter, item: { level: product.level, magical: product.magical },
        materials: [{ type, grade, level: product.level, rarity: materialRarity(type) }],
        upfrontCp, stockCp: stockCpOf(order, type), coinCp: Math.max(0, coinCp),
    }, rules);
}
