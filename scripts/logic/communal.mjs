/**
 * Communal Crafting helpers and Aid (DESIGN.md 6.7). Player Core p.253 leaves the helper's DC, degree
 * mapping and what "the benefit is lost" means to the GM; the defaults are the author's decisions of
 * 2026-10-25 (DECISIONS.md), each a setting under `rules.communal`.
 */
import { AID_CRIT_BY_RANK, AID_MODIFIER } from "../data/aid.mjs";
import { DEGREE, FEAT, RANK, asSet, hasTrait } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { incomePerDay } from "./income.mjs";

/**
 * Skills that count as relevant to an item by its traits, beyond Crafting (Player Core p.253 names Religion
 * for divine items and Warfare Lore for weapons). The registry may extend this; the crafter can mark more
 * skills relevant on the order.
 */
export const RELEVANT_SKILL_BY_TRAIT = Object.freeze({
    divine: "religion",
    arcane: "arcana",
    occult: "occultism",
    primal: "nature",
});
/** Warfare Lore for weapons: by item type, since "weapon" is not a trait. */
const WEAPON_SKILL = "warfare-lore";

/** The skills a helper may roll for this item: Crafting, the trait mapping, and the crafter's marks. */
export function relevantSkills(item, marked = []) {
    const skills = new Set(["crafting", ...marked]);
    for (const [trait, skill] of Object.entries(RELEVANT_SKILL_BY_TRAIT)) {
        if (hasTrait(item, trait)) skills.add(skill);
    }
    if (item.type === "weapon") skills.add(WEAPON_SKILL);
    return skills;
}

/**
 * Whether a PC may help on an order (6.7). Every failed condition is reported.
 *
 * @param {object} p
 * @param {{isPC: boolean, feats: string[], ranks: Record<string, number>}} p.helper
 * @param {string} p.skill               the skill the helper will roll
 * @param {boolean} p.crafterHasFeat     the crafter has Communal Crafting
 * @param {boolean} [p.accepted]         the crafter accepted this helper (needed when only the helper has the feat)
 * @param {Set<string>|string[]} p.relevant   relevantSkills for the item
 * @param {boolean} [p.lockedElsewhere]  the helper is locked as a helper or subject on another order
 * @param {number} [p.otherHelpers]      helpers already on the order, not counting this one
 */
export function helperEligibility({ helper, skill, crafterHasFeat, accepted = false, relevant, lockedElsewhere = false, otherHelpers = 0 }, rules = DEFAULT_RULES) {
    const { communal } = rules;
    const reasons = [];
    const helperHasFeat = asSet(helper.feats).has(FEAT.communalCrafting);
    if (!(crafterHasFeat || (helperHasFeat && accepted) || communal.countHelpersWithoutFeat)) reasons.push("no-feat");
    if (!helper.isPC) reasons.push("not-pc");
    if ((helper.ranks?.[skill] ?? RANK.untrained) < RANK.trained) reasons.push("untrained");
    if (!asSet(relevant).has(skill)) reasons.push("irrelevant-skill");
    if (lockedElsewhere) reasons.push("locked");
    if (communal.helperCap > 0 && otherHelpers >= communal.helperCap) reasons.push("cap");
    return { ok: reasons.length === 0, reasons };
}

/** The DC a helper rolls against: the item's Craft DC (`rules.communal.helperDc` "item"). */
export function helperDC(order) {
    return order.dc.final;
}

/**
 * One extra day of a helper's cost reduction (6.7): the Income Earned entry at (helper level - 1) and the
 * helper's rank in the skill they rolled, by the helper's degree. A critical success uses the next row and
 * a failure the failure column, as an Earn Income check would, unless those settings are off (then a
 * critical success counts as a success and a failure as nothing). A critical failure gives nothing.
 *
 * @param {{level: number, rank: number, degree: number|null}} helper  the level and rank stored with the helper's roll
 */
export function helperRate(helper, rules = DEFAULT_RULES) {
    const { communal } = rules;
    const row = Math.max(0, helper.level - 1);
    if (helper.degree === DEGREE.critSuccess) {
        return incomePerDay(row, helper.rank, communal.helperCritUsesNextRow ? DEGREE.critSuccess : DEGREE.success);
    }
    if (helper.degree === DEGREE.success) return incomePerDay(row, helper.rank, DEGREE.success);
    if (helper.degree === DEGREE.fail && communal.helperFailUsesFailColumn) return incomePerDay(row, helper.rank, DEGREE.fail);
    return 0;
}

/** Whether a helper was with the crafter on `day`: from the day they joined to before the day they left. */
export function helperPresent(helper, day) {
    return helper.joinedDay <= day && (helper.leftDay == null || day < helper.leftDay);
}

/**
 * Whether a helper's past contributions are lost: they left before the Craft ended (`leftDay` set) and
 * leaving is retroactive (the default). With the setting off they keep what they contributed and only stop
 * contributing. Completing the order releases helpers without setting `leftDay`.
 */
export function helperForfeits(helper, rules = DEFAULT_RULES) {
    return rules.communal.helperLeaveRetroactive && helper.leftDay != null;
}

/**
 * The circumstance modifier one Aid gives the crafter's check (Player Core p.416): +1 on a success; +2 on a
 * critical success, +3 for a master aider and +4 for a legendary one; -1 on a critical failure.
 */
export function aidModifier(degree, aiderRank) {
    if (degree === DEGREE.critSuccess) return AID_CRIT_BY_RANK[Math.min(Math.max(aiderRank, 0), RANK.legendary)];
    return AID_MODIFIER[degree] ?? 0;
}
