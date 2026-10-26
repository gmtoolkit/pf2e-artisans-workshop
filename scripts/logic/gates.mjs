/**
 * Eligibility gates (DESIGN.md 6.5): the rules requirements that decide whether a Craft can start (P1).
 * Each gate is `{id, ok, reason, data, unlock}`: `reason` is a stable code for why it fails, `unlock` a code
 * for what would open it, and `data` their numbers; all null when it passes. The interface maps the codes
 * to i18n keys. Callers extract the facts from documents; nothing here reads them.
 */
import { FEAT, RANK, ROUTES_WITH_FORMULA, asSet, hasTrait, isMagical, requireCp } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

/** Item level from which master proficiency is needed. Player Core p.237. */
export const MASTER_ITEM_LEVEL = 9;

/** Craft types that work on an item the crafter must hold throughout (GM Core p.225). */
const TARGET_TYPES = new Set(["upgrade", "rune-etch", "rune-transfer"]);
/** Craft types with a subject who must consent and stay (Secrets of Magic p.164; Howl of the Wild p.97). */
const SUBJECT_TYPES = new Set(["tattoo", "graft"]);

const pass = (id) => ({ id, ok: true, reason: null, data: null, unlock: null });
const fail = (id, reason, data = {}, unlock = null) => ({ id, ok: false, reason, data, unlock });

/** Whether every gate passes. */
export const allPass = (gates) => gates.every((gate) => gate.ok);

/** What kind of item this is, for the feat and tool gates. */
export function itemKinds(item, craftType = "item") {
    return {
        alchemical: hasTrait(item, "alchemical"),
        magical: isMagical(item),
        talisman: hasTrait(item, "talisman"),
        tattoo: craftType === "tattoo" || hasTrait(item, "tattoo"),
        graft: craftType === "graft" || hasTrait(item, "graft"),
        snare: hasTrait(item, "snare"),
        gadget: hasTrait(item, "gadget"),
    };
}

/** The Crafting (or substitute skill) rank an item level needs: master from 9, legendary from the setting. */
export function requiredRank(itemLevel, rules = DEFAULT_RULES) {
    if (itemLevel >= rules.legendaryItemLevel) return RANK.legendary;
    if (itemLevel >= MASTER_ITEM_LEVEL) return RANK.master;
    return RANK.trained;
}

/**
 * The crafting feats (and for grafts, the Medicine rank) the crafter lacks for this item (G4):
 * - gadget: none (Guns & Gears (Remastered) p.66);
 * - tattoo: Tattoo Artist; under the Secrets of Magic process, Magical Crafting with Specialty Crafting
 *   (artistry) also works;
 * - graft: Graft Technician and expert Medicine;
 * - snare: Snare Crafting, and Magical Crafting for a magical snare while that setting is on (OQ-14);
 * - talisman: Magical Crafting, or a registry unlock for talismans (Talisman Dabbler);
 * - otherwise Alchemical Crafting for alchemical items and Magical Crafting for magical ones; both for both.
 *
 * @param {{feats: string[], unlocks?: string[], ranks?: Record<string, number>}} crafter
 * @returns {{feats: string[], ranks: Record<string, number>}} empty when nothing is missing
 */
export function missingCraftingFeats(item, crafter, craftType = "item", rules = DEFAULT_RULES) {
    const kinds = itemKinds(item, craftType);
    const feats = asSet(crafter.feats);
    const missing = { feats: [], ranks: {} };
    const need = (slug) => {
        if (!feats.has(slug)) missing.feats.push(slug);
    };
    if (kinds.gadget) return missing;
    if (kinds.tattoo) {
        const viaArtistry = rules.tattooProcess === "secrets-of-magic" &&
            feats.has(FEAT.magicalCrafting) && feats.has(FEAT.specialtyCraftingArtistry);
        if (!viaArtistry) need(FEAT.tattooArtist);
        return missing;
    }
    if (kinds.graft) {
        need(FEAT.graftTechnician);
        if ((crafter.ranks?.medicine ?? RANK.untrained) < RANK.expert) missing.ranks.medicine = RANK.expert;
        return missing;
    }
    if (kinds.snare) {
        need(FEAT.snareCrafting);
        if (kinds.magical && rules.magicalSnaresNeedMagicalCrafting) need(FEAT.magicalCrafting);
        return missing;
    }
    if (kinds.alchemical) need(FEAT.alchemicalCrafting);
    if (kinds.talisman) {
        if (!asSet(crafter.unlocks).has("talisman")) need(FEAT.magicalCrafting);
    } else if (kinds.magical) {
        need(FEAT.magicalCrafting);
    }
    return missing;
}

/**
 * The tool a Craft needs in downtime (G7): an alchemist's lab for alchemical items, otherwise an artisan's
 * toolkit; a snare toolkit for snares, which counts as an artisan's toolkit while `snareToolkitIsArtisans`
 * is on, since no snare toolkit item exists (OQ-14). Workshops such as a smithy are checklist items.
 */
export function requiredTool(item, rules = DEFAULT_RULES) {
    if (hasTrait(item, "snare")) return rules.snareToolkitIsArtisans ? "artisans-toolkit" : "snare-toolkit";
    if (hasTrait(item, "alchemical")) return "alchemists-lab";
    return "artisans-toolkit";
}

/* -------------------------------------------- */
/*  The gates                                    */
/* -------------------------------------------- */

const rankIn = (crafter, skill) => crafter.ranks?.[skill] ?? RANK.untrained;

/** G1: trained in Crafting, or in the registry's substitute skill for this item. Player Core p.237. */
export function gateTrained(crafter, skill = "crafting") {
    return rankIn(crafter, skill) >= RANK.trained ? pass("G1") : fail("G1", "untrained", { skill }, "train");
}

/** G2: the item's level is at most the crafter's. Player Core p.237. */
export function gateLevel(crafter, item) {
    return item.level <= crafter.level ? pass("G2") : fail("G2", "item-level", { level: item.level }, "level");
}

/** G3: master from item level 9, legendary from `legendaryItemLevel` (17, or 16 by setting). */
export function gateProficiency(crafter, item, skill = "crafting", rules = DEFAULT_RULES) {
    const rank = requiredRank(item.level, rules);
    return rankIn(crafter, skill) >= rank ? pass("G3") : fail("G3", "rank", { skill, rank }, "rank");
}

/** G4: the crafting feats for this kind of item. */
export function gateFeats(crafter, item, craftType = "item", rules = DEFAULT_RULES, extraFeats = []) {
    const missing = missingCraftingFeats(item, crafter, craftType, rules);
    for (const slug of extraFeats) if (!asSet(crafter.feats).has(slug)) missing.feats.push(slug);
    const ok = missing.feats.length === 0 && Object.keys(missing.ranks).length === 0;
    return ok ? pass("G4") : fail("G4", "feats", missing, "feats");
}

/**
 * G5: common, or the crafter has access: the formula (known, by family or virtual) or a registry access
 * grant. With `uncommonNeedsFormula` on, only the formula (GM Core p.223; OQ-37).
 */
export function gateAccess(item, route, accessGrant = false, rules = DEFAULT_RULES) {
    const rarity = item.rarity ?? "common";
    if (rarity === "common") return pass("G5");
    if (ROUTES_WITH_FORMULA.includes(route) || (accessGrant && !rules.uncommonNeedsFormula)) return pass("G5");
    return fail("G5", rules.uncommonNeedsFormula ? "needs-formula" : "no-access", { rarity }, "formula");
}

/**
 * G6: a Craft route exists (known, family, virtual or none). Without one, `acquisition` lists the formula
 * jobs that would open it (6.8).
 */
export function gateRoute(route, acquisition = []) {
    return route ? pass("G6") : fail("G6", "no-route", { routes: acquisition }, "formula");
}

/**
 * G7: the tool is on the crafter or in the strongbox (`available`), or a registry substitution waives it
 * (`substitutes`: Scrounger, Improvise Tool, cookware for alchemical food).
 */
export function gateTools(item, { available = [], substitutes = [] } = {}, rules = DEFAULT_RULES) {
    const tool = requiredTool(item, rules);
    const ok = asSet(available).has(tool) || asSet(substitutes).has(tool);
    return ok ? pass("G7") : fail("G7", "tool", { tool }, "tool");
}

/**
 * G8: the escrow (coins plus earmarked items at Price) covers the up-front half, and the material rules pass.
 * Both amounts are required whole copper, so a missing up-front amount throws instead of passing.
 */
export function gateMaterials(escrowCp, upfrontCp, precious = null) {
    requireCp(escrowCp, "escrowCp");
    requireCp(upfrontCp, "upfrontCp");
    if (escrowCp < upfrontCp) return fail("G8", "underfunded", { shortCp: upfrontCp - escrowCp }, "fund");
    if (precious && !precious.ok) return fail("G8", "precious", { problems: precious.problems }, "materials");
    return pass("G8");
}

/**
 * G9: every parsed Craft Requirement is confirmed on the checklist, and spells the item needs are supplied
 * by fulfilled pledges (6.9). Craft Anything waives the narrative requirements and the spells, but never an
 * added cost (Player Core, Craft Anything).
 *
 * @param {{key: string, kind: "narrative"|"cost", confirmed: boolean}[]} requirements
 */
export function gateRequirements(crafter, requirements = [], { spellsNeeded = false, spellsSupplied = false } = {}) {
    const craftAnything = asSet(crafter.feats).has(FEAT.craftAnything);
    const open = requirements.filter((r) => !r.confirmed && !(craftAnything && r.kind !== "cost")).map((r) => r.key);
    const spellsOpen = spellsNeeded && !spellsSupplied && !craftAnything;
    if (open.length === 0 && !spellsOpen) return pass("G9");
    return fail("G9", spellsOpen && !open.length ? "spells" : "checklist", { keys: open, spells: spellsOpen }, "checklist");
}

/**
 * G10: an upgraded, etched or transferred item stays with the crafter for the whole job; a tattoo or graft
 * subject has consented and is locked to the order.
 */
export function gateCustody(craftType, { targetHeld = false, subjectConsented = false, subjectLocked = false } = {}) {
    if (TARGET_TYPES.has(craftType) && !targetHeld) return fail("G10", "target-not-held", {}, "custody");
    if (SUBJECT_TYPES.has(craftType)) {
        if (!subjectConsented) return fail("G10", "no-consent", {}, "custody");
        if (!subjectLocked) return fail("G10", "subject-not-locked", {}, "custody");
    }
    return pass("G10");
}

/** G11: the crafter is not locked as a helper or subject on another order. */
export function gateAvailable(crafter, orderId) {
    const other = crafter.lockedBy;
    return !other || other === orderId ? pass("G11") : fail("G11", "locked", { order: other }, "release");
}

/**
 * Why a rune cannot be etched onto its target, or null (GM Core pp.224-225): one rune at a time; shields
 * take only reinforcing runes; specific items and staves only fundamental runes; property runes up to the
 * potency rune's value, plus one on orichalcum.
 *
 * @param {{kind: "fundamental"|"reinforcing"|"property", target: {etching?: boolean, isShield?: boolean,
 *   isSpecific?: boolean, isStaff?: boolean, potency?: number, propertyRunes?: number, orichalcum?: boolean}}} rune
 */
export function runeProblem({ kind, target }) {
    const property = kind === "property";
    if (target.etching) return { reason: "one-rune-at-a-time" };
    if (target.isShield && kind !== "reinforcing") return { reason: "shield-reinforcing-only" };
    if (target.isSpecific && property) return { reason: "specific-fundamental-only" };
    if (target.isStaff && property) return { reason: "staff-fundamental-only" };
    if (property) {
        const slots = (target.potency ?? 0) + (target.orichalcum ? 1 : 0);
        if ((target.propertyRunes ?? 0) + 1 > slots) return { reason: "property-slots", data: { slots } };
    }
    return null;
}

/** G12: no artifacts, no Craft without a Price, and the rune rules for an etching. GM Core pp.223-225. */
export function gateProduct(item, craftType = "item", rune = null) {
    if (item.isArtifact) return fail("G12", "artifact");
    if (!(item.priceCp > 0)) return fail("G12", "no-price");
    const problem = craftType === "rune-etch" && rune ? runeProblem(rune) : null;
    return problem ? fail("G12", problem.reason, problem.data ?? {}) : pass("G12");
}

/* -------------------------------------------- */
/*  Gate sets                                    */
/* -------------------------------------------- */

/**
 * Every gate for starting a Craft, G1 to G12 in order.
 *
 * @param {object} p
 * @param {{level: number, ranks: Record<string, number>, feats: string[], unlocks?: string[], lockedBy?: string|null}} p.crafter
 * @param {{level: number, rarity?: string, traits: string[], priceCp: number, isArtifact?: boolean}} p.item
 *        for an upgrade, the new level; with adjustments, the highest level among the parts
 * @param {string} [p.orderId]
 * @param {string} [p.craftType]
 * @param {string} [p.skill]              "crafting" or the registry substitute
 * @param {string|null} p.route           craftRoute (formula-jobs.mjs)
 * @param {boolean} [p.accessGrant]       a registry access grant
 * @param {object[]} [p.acquisition]      acquisitionRoutes, shown when there is no route
 * @param {object} [p.tools]              {available, substitutes}
 * @param {number} [p.escrowCp]
 * @param {number} p.upfrontCp
 * @param {object|null} [p.precious]      preciousCheck
 * @param {object[]} [p.requirements]
 * @param {object} [p.spells]             {spellsNeeded, spellsSupplied}
 * @param {object} [p.custody]
 * @param {object|null} [p.rune]
 */
export function craftGates(p, rules = DEFAULT_RULES) {
    const { crafter, item, craftType = "item", skill = "crafting" } = p;
    return [
        gateTrained(crafter, skill),
        gateLevel(crafter, item),
        gateProficiency(crafter, item, skill, rules),
        gateFeats(crafter, item, craftType, rules),
        gateAccess(item, p.route, p.accessGrant, rules),
        gateRoute(p.route, p.acquisition),
        gateTools(item, p.tools, rules),
        gateMaterials(p.escrowCp ?? 0, p.upfrontCp, p.precious),
        gateRequirements(crafter, p.requirements, p.spells),
        gateCustody(craftType, p.custody),
        gateAvailable(crafter, p.orderId),
        gateProduct(item, craftType, p.rune),
    ];
}

/**
 * Gates for reverse-engineering a formula from an item (6.5, Player Core p.294): every requirement to
 * Craft the item still applies (G1-G4, G7, G12) except access and the special Craft Requirements; G8 is
 * measured against half the formula's Price (`upfrontCp`); the item must be on the crafter or earmarked.
 */
export function reverseEngineerGates(p, rules = DEFAULT_RULES) {
    const { crafter, item, skill = "crafting" } = p;
    return [
        gateTrained(crafter, skill),
        gateLevel(crafter, item),
        gateProficiency(crafter, item, skill, rules),
        gateFeats(crafter, item, "item", rules),
        gateTools(item, p.tools, rules),
        gateMaterials(p.escrowCp ?? 0, p.upfrontCp),
        p.itemHeld ? pass("G10") : fail("G10", "target-not-held", {}, "custody"),
        gateAvailable(crafter, p.orderId),
        gateProduct(item),
    ];
}

/**
 * Gates for inventing a formula (6.8, Player Core p.257). Inventing "works just like the Craft activity", so
 * the requirements to Craft the item apply: its level, the proficiency, the crafting feat for its kind and
 * the tool (G1-G4, G7), plus the Inventor feat; common items only, or uncommon and rare while
 * `inventorRarity` is on; half the formula's Price in escrow.
 */
export function inventGates(p, rules = DEFAULT_RULES) {
    const { crafter, item } = p;
    const rarity = item.rarity ?? "common";
    const rarityOk = rarity === "common" || (rules.inventorRarity && (rarity === "uncommon" || rarity === "rare"));
    return [
        gateTrained(crafter),
        gateLevel(crafter, item),
        gateProficiency(crafter, item, "crafting", rules),
        gateFeats(crafter, item, "item", rules, [FEAT.inventor]),
        rarityOk ? pass("G5") : fail("G5", "invent-rarity", { rarity }),
        gateTools(item, p.tools, rules),
        gateMaterials(p.escrowCp ?? 0, p.upfrontCp),
        gateAvailable(crafter, p.orderId),
    ];
}

/**
 * Gates for crafting a copy of a formula the crafter knows, for someone else's book (6.8). Player Core p.294
 * covers this and reverse-engineering in one paragraph: the requirements to Craft the item apply (G1-G4,
 * G7) except access and the special Craft Requirements, which knowing the formula settles anyway; G8 is
 * measured against half the formula's Price (`upfrontCp`).
 */
export function craftCopyGates(p, rules = DEFAULT_RULES) {
    const { crafter, item } = p;
    return [
        gateTrained(crafter),
        gateLevel(crafter, item),
        gateProficiency(crafter, item, "crafting", rules),
        gateFeats(crafter, item, "item", rules),
        p.knowsFormula ? pass("G6") : fail("G6", "formula-unknown"),
        gateTools(item, p.tools, rules),
        gateMaterials(p.escrowCp ?? 0, p.upfrontCp),
        gateAvailable(crafter, p.orderId),
    ];
}
