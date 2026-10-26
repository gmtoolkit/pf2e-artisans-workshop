/**
 * Precious materials (DESIGN.md 6.6, GM Core pp.252-253): who can craft with them, the level caps of each
 * grade, and how much of the up-front materials must be the material itself.
 */
import { PRECIOUS_GRADE, PRECIOUS_MATERIALS_PER_ITEM, PRECIOUS_MIN_RANK } from "../data/materials.mjs";
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
        problems.push({ reason: "material-share", data: { requiredCp, availableCp, stockOnly: !coinCounts } });
    }
    return { ok: problems.length === 0, problems, requiredCp };
}
