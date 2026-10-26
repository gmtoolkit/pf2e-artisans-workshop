/**
 * Formula families (DESIGN.md 6.4): one formula covers the other types of the same item (GM Core p.223,
 * Multiple Types), and upgrades between them.
 */
import { rarityRank } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

/**
 * A parenthesised grade in an item name: Minor, Lesser, Moderate, Greater, Major, Supreme, True, a Type
 * in Roman numerals, or a potency such as (+1). The compendium has no family field, so the family comes
 * from the name with these removed (Weapon Potency (+1) and (+2) are GM Core p.223's own example).
 */
const GRADE = /\s*\((?:minor|lesser|moderate|greater|major|supreme|true|type [ivx]+|\+\d+)\)/gi;

/**
 * The family key of an item: item type, category and the name without its grade, lower-cased; or the
 * registry's override. `name` should be the untranslated compendium name, so the key does not change with
 * the interface language.
 *
 * @param {{name: string, type: string, category?: string, familyOverride?: string}} item
 */
export function familyKey(item) {
    if (item.familyOverride) return item.familyOverride;
    const base = item.name.replace(GRADE, "").replace(/\s+/g, " ").trim().toLowerCase();
    return `${item.type}|${item.category ?? ""}|${base}`;
}

/**
 * Whether a known formula covers a target item (6.4): the same family, a type that does not need its own
 * formula (`ownFormulaPerType`: aeon stones, marvelous miniatures and the like, from the registry), no
 * higher rarity, and a higher or equal level, or any level while `familyCoversLowerGrades` is on.
 *
 * Items are `{name, type, category?, familyOverride?, level, rarity, ownFormulaPerType?}`.
 */
export function covers(known, target, rules = DEFAULT_RULES) {
    return familyKey(known) === familyKey(target) &&
        !target.ownFormulaPerType &&
        rarityRank(target.rarity) <= rarityRank(known.rarity) &&
        (target.level >= known.level || rules.familyCoversLowerGrades);
}

/**
 * The known formula that gives the target its route: the target's own formula (`known`), else the closest
 * covering one by level (`family`), else null. Known entries carry the target's fields plus `uuid`.
 *
 * @returns {{route: "known" | "family", formula: object} | null}
 */
export function formulaCoverage(knownFormulas, target, rules = DEFAULT_RULES) {
    const own = knownFormulas.find((f) => f.uuid === target.uuid);
    if (own) return { route: "known", formula: own };
    const covering = knownFormulas.filter((f) => covers(f, target, rules));
    if (!covering.length) return null;
    const distance = (f) => Math.abs(f.level - target.level);
    const formula = covering.reduce((best, f) => (distance(f) < distance(best) ? f : best));
    return { route: "family", formula };
}

/**
 * The cost of upgrading an item to a stronger type: the full Price difference, at the DC of the new level
 * (GM Core p.223). Null when the target is not dearer, which is not an upgrade.
 */
export function upgradeCostCp(fromPriceCp, toPriceCp) {
    return toPriceCp > fromPriceCp ? toPriceCp - fromPriceCp : null;
}

/** Fundamental runes Automatic Bonus Progression replaces (GM Core p.83). Reinforcing runes are not among them. */
const ABP_REPLACED_RUNES = new Set(["weapon-potency", "striking", "armor-potency", "resilient"]);

/**
 * Whether an item is hidden from craftable lists under Automatic Bonus Progression (6.4): pf2e's
 * `variants.abp` setting is a string, so any value other than "noABP" means it is on.
 *
 * @param {{fundamentalRune?: string, givesItemBonus?: boolean}} item  the rune's kind, and whether the gear gives an item bonus
 */
export function hiddenByAbp(item, abp) {
    if (abp === "noABP" || abp == null) return false;
    return ABP_REPLACED_RUNES.has(item.fundamentalRune) || item.givesItemBonus === true;
}
