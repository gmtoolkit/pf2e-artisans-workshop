/**
 * The rules registry (DESIGN.md 6.11): every feat, class feature and item that changes the Craft activity,
 * formulas, daily preparation or Earn Income beyond what the pf2e system's own rule elements already do. Numbers,
 * slugs, compendium UUIDs and predicates only: names and descriptions are read from the compendium at runtime (P9).
 * The lookups that read this table are pure functions in `scripts/logic/registry.mjs`.
 *
 * Seeded from the research catalogues of feats and gear (2026-10-25) after checking every entry against the
 * pf2e 8.6.1 compendium source: the UUID resolves, the slug is the one pf2e computes, the publication's remaster
 * flag matches, and every rule element the entry relies on has the shape below. `tools/validate-registry.mjs`
 * repeats those checks against any pf2e checkout.
 *
 * Keys are pf2e slugs (`system.slug`, else the item name sluggified as pf2e does). Two compendium items share
 * one slug only once in 8.6.1: the alchemist's Advanced Alchemy class feature keeps `advanced-alchemy` and the
 * archetype feat is keyed `advanced-alchemy@archetype`. A character's items are matched by compendium source
 * UUID first and by slug second, since granted copies keep the slug.
 *
 * Entry: `{uuid, type, book, remaster, tier, choice?, effects, relies?, verified}`.
 * - `type`: the pf2e document type (class features are `feat`).
 * - `book`: the publication title, for the legacy badge and the listing; `remaster` its remaster flag.
 * - `tier` (6.11): 1 core crafting and the common class and archetype features, fully automated (by the system's
 *   rule elements or by `effects`); 2 automated where it touches time, cost, DC, batch, gates or formulas, and
 *   otherwise shown as a note, which is an entry with no effects; 3 other classes' daily item preparation
 *   (stubs until M7); 4 legacy-only content (stubs, except the corrections below).
 * - `choice`: the ChoiceSet flag whose selection makes the held key `<slug>:<choice>`
 *   (`specialty-crafting:blacksmithing`).
 * - `relies`: rule elements on the compendium item that the module relies on, `{key, match}`; the validation
 *   script fails when no rule of that key contains `match`.
 *
 * Predicates (`when`, `filter`, `access`) are `{all?, any?, not?}` over option strings: an item's roll options
 * (`item:trait:alchemical`, `item:type:consumable`, `item:slug:...`, `item:level:3`, `item:rarity:common`,
 * `item:category:potion`, `item:tag:alchemical-tool`, `item:usage:...`, as pf2e's `getRollOptions("item")` and the
 * pure `itemOptions` give them) plus the module's context options for a Craft: `craft-type:<type>`,
 * `route:<route>`, `material:monster`, `specialty:<trade>` for each trade the Craft falls under, and
 * `specialty:own` when one of them is a Specialty Crafting choice of the crafter. `{choice}` in a predicate or in
 * an option stands for the holder's choice.
 *
 * Effect kinds built in M3 (fields as used below):
 * - `craftUnlock {category}`: the G4 feat gate opens for items with that trait (Talisman Dabbler: talismans; the
 *   witch's Cauldron: oils and potions without Magical Crafting);
 *   `craftUnlock {access}`: access to uncommon items matching `access` (G5).
 * - `formulaAllowance {on: "gain"|"level"|"rank", count, maxLevel, minLevel?, rarity?, filter?, uuids?, levels?,
 *   skill?, ranks?}`: formula picks owed. `maxLevel`/`minLevel` are numbers or "level" (the character's level at
 *   that point); `levels` limits a per-level allowance to those levels; `ranks` lists the ranks in `skill` that
 *   each owe the picks.
 * - `virtualFormulaList {filter?, uuids?, rarity?, maxLevel?, minLevel?, books?}`: formulas known without a book.
 * - `setupDays {days, when?}`: a setup length that replaces the normal one (the shortest of several applies).
 * - `rateLevel {add}` or `{source: "monster"}`: the level used for each extra day's reduction.
 * - `degreeShift {from, to, when}`: a degree the roll's options turn into another (checked against the roll).
 * - `batchSize {multiply, when}`: batch limit multiplier.
 * - `rollOptions {options, when?}`: options the roll wrapper adds to the roll.
 * - `modifier {slug, type, value, atRank?, when?}`: a check modifier the module applies where no rule element
 *   exists; `atRank {skill, rank, value}` raises it from that rank.
 * - `skillSubstitution {skill, when}`: another skill the Craft may use.
 * - `toolSubstitution {tools, requires?, when?}`: tool ids this counts as, or waives (G7); `requires` names tool ids
 *   the crafter must also have.
 * - `earnIncome {doubleFailure}`: Experienced Professional's failure pay (6.10).
 * - `correction {consumable}`: a known data bug (talismans without the consumable trait batch as consumables).
 * - `correction {pool, slots?, craftable?, gate?, bug}` (M7): pf2e data for a daily-preparation source that disagrees with
 *   the rules text (7.1). `slots {byRank, skill}` reads the source's count from a rank, `slots {add, unless}` changes it
 *   unless the preparation is made in that context (`wilderness`); `craftable` is a predicate ANDed into what the source
 *   makes; `gate {when, skill, rank}` lets the source make items matching `when` only from that rank. `bug` is the
 *   `CraftingAbility` rule (a partial match) the correction answers: the validation script reports the correction once
 *   pf2e's rule no longer looks like that.
 * - `repairHp {success, critSuccess}` (M5): Hit Points a Repair restores are `n + n × rank` on that degree instead of the
 *   Player Core numbers (the Crafter's Eyepiece, which the system's repair macro ignores; 6.13, 6.15 gap 12).
 * - `variantOnly {variant}`: the entry counts only while that variant rule is on.
 * Effect kinds built in M7 (7.1, 7.4, 7.7, 7.10):
 * - `dcStamp {pool, dcs}`: temporary items from that crafting pool take the highest of the creator's DCs named (`class`,
 *   `spell`) and their own (Talisman Dabbler, 7.4).
 * - `dailyGap {flow}`: a daily-preparation feature with no rule element (7.10): `note` (the player ticks it off for the day),
 *   `designate` (Food Preservation), `dailies` (pf2e-dailies automates it; "not automated" without it, 7.9).
 * - `vialSource {regain}`: a source of versatile vials, and whether it regains vials during the day (7.3, 8.7).
 * - `expiryRule {rule, when}`: an exception to party-wide expiry (7.7): `designate`, items matching `when` the holder may
 *   designate to outlast the next preparations.
 * Effect kinds built in M8 (8.3-8.8):
 * - `additive {when, vials?, toggle?, combine?}`: an additive feat (Player Core 2's additive trait); Quick Alchemy items
 *   matching `when` may take it (one per item, one per round); `vials` is the extra versatile vials it costs; `toggle`
 *   `{domain, option}` the pf2e roll option a Strike with the item turns on (OQ-27: the system's own toggles); `combine
 *   {when, level?, merge?}` asks for a second item matching `when`, with `level: "first"` at most the first item's level,
 *   and with `merge` made part of the first item (Combine Elixirs; without it the second stays apart: Balm Bomb's healing
 *   elixir, which an ally gains on a hit).
 * - `expiryRule {rule: "enduring", when}`: Quick Alchemy items matching `when` stay potent until the end of the creator's
 *   next turn (Enduring Alchemy); `expiryRule {rule: "uncapped", when, maxLevel?}`: effects of the creator's own items
 *   matching `when` may outlast Quick Alchemy's 10 minutes (Eternal Elixir, at most half the creator's level; Persistent
 *   Mutagen, whose once a day the module does not count).
 * - `brew {count}`: items one Quick Alchemy action makes (Double Brew).
 * - `splash {intDamage?, bonusInt?, greater?, cone?, primaryOnly?}`: the splash numbers a bomb shows (8.8): splash damage
 *   equal to Intelligence (the bomber's field discovery), plus Intelligence as a status bonus with a 10-foot radius
 *   (Expanded Splash), the greater field discovery's radius, Directional Bombs' cone, the bomber's primary-target option.
 * - `fieldVial {option, choices}`: the pf2e toggle that sets a versatile vial's damage type (the bomber's field vials).
 * - `vialMaterial {option, materials}`: the pf2e toggle that makes a thrown vial a precious material (Advanced Vials).
 * - `gather {per10}`: vials regained per 10 minutes of gathering reagents (Alchemical Expertise, 8.7).
 * - `quickVial {quickened}`: an extra action that may only make a quick vial, once a turn (Abundant Vials, 8.5).
 * - `quickBomber`: draw or make a bomb and Strike with it in one action (Quick Bomber, 8.4).
 * Effect kinds built in M8a (8.10.4-8.10.6):
 * - `afflictionModifier {mod, as, when?}`: a feat that changes a poison's affliction (8.10.6), applied for the character who
 *   holds it `as` the poison's `creator` (Tenacious Toxins, Powerful Alchemy's DC stamp, the toxicologist's acid for infused
 *   poisons against poison-immune creatures, the legacy Potent Poisoner), its `deliverer` (Pinpoint Poisoner, Blowgun
 *   Poisoner, Sticky Poison, Double Poison), the `victim` (Acquired Tolerance's reroll), or carried as the poison's
 *   `additive` (Pernicious Poison, Combustible Poison).
 * The other kinds of 6.11 (`materialSource`, `gate`, `conflict`, `delivery`) arrive with the milestones that read them.
 */

/** Freeze a JSON-compatible value all the way down. */
function deepFreeze(value) {
    if (value && typeof value === "object") {
        for (const inner of Object.values(value)) deepFreeze(inner);
        Object.freeze(value);
    }
    return value;
}

/** The pf2e release every entry was last checked against. */
export const REGISTRY_VERIFIED = "pf2e-8.6.1";

/**
 * The trades a Craft falls under without the crafter choosing one (the order's `specialty` adds another):
 * Specialty Crafting's alchemy covers alchemical items, and its artistry covers tattoos (Secrets of Magic p.164's
 * tattooing specialty).
 */
export const SPECIALTY_DEFAULTS = deepFreeze({
    alchemy: { all: ["item:trait:alchemical"] },
    artistry: { any: ["item:trait:tattoo", "craft-type:tattoo"] },
});

export const REGISTRY = deepFreeze({
    "abadar-moderate-boon": {
        uuid: "Compendium.pf2e.boons-and-curses.Item.DfXlr5qqbcjJN3gh", type: "feat", book: "Pathfinder Lost Omens Gods & Magic", remaster: false, tier: 4,
        // pf2e turns an Earn Income critical failure into a failure (relies). Its double pay on a success needs an `earnIncome`
        // `doubleSuccess` field that `earnIncomeFlags` and `wagePerDay` honour (follow-up); until then a note.
        effects: [],
        relies: [
            { key: "AdjustDegreeOfSuccess", match: { selector: "skill-check", predicate: ["action:earn-income"], adjustment: { criticalFailure: "one-degree-better" } } },
        ],
        verified: "pf2e-8.6.1",
    },
    "abundant-vials": {
        uuid: "Compendium.pf2e.classfeatures.Item.tVxAFMBen8D516BQ", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "quickVial", quickened: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "acquired-tolerance": {
        uuid: "Compendium.pf2e.feats-srd.Item.nx2nB10rypAuspAa", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "afflictionModifier", mod: "acquired-tolerance", as: "victim" },
        ],
        verified: "pf2e-8.6.1",
    },
    "acupuncturist": {
        uuid: "Compendium.pf2e.feats-srd.Item.SC95hfEEHQs7E9cG", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "addiction-suppressant-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.ZOOrK4yEW6rFpPJ1", type: "consumable", book: "Pathfinder Lost Omens Legends", remaster: false, tier: 4,
        // Note: made for one drug, from a dose of it, and above its level; outside the Craft Requirements paragraph, so G9's
        // checklist misses it. A `gate` effect once that kind is built.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "addiction-suppressant-lesser": {
        uuid: "Compendium.pf2e.equipment-srd.Item.SNMggNsvgPoAYjpU", type: "consumable", book: "Pathfinder Lost Omens Legends", remaster: false, tier: 4,
        // Note: as addiction-suppressant-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "addiction-suppressant-major": {
        uuid: "Compendium.pf2e.equipment-srd.Item.esDSCEI1cf8Op93I", type: "consumable", book: "Pathfinder Lost Omens Legends", remaster: false, tier: 4,
        // Note: as addiction-suppressant-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "addiction-suppressant-moderate": {
        uuid: "Compendium.pf2e.equipment-srd.Item.cWYa0i1BqhbEruD6", type: "consumable", book: "Pathfinder Lost Omens Legends", remaster: false, tier: 4,
        // Note: as addiction-suppressant-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "additional-servings": {
        uuid: "Compendium.pf2e.feats-srd.Item.243yFdMntCMPLLrp", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "advanced-alchemy": {
        uuid: "Compendium.pf2e.classfeatures.Item.Pe0zmIqyTBc2Td0I", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [],
        relies: [
            { key: "CraftingAbility", match: { slug: "advanced-alchemy", isDailyPrep: true } },
        ],
        verified: "pf2e-8.6.1",
    },
    "advanced-alchemy@archetype": {
        uuid: "Compendium.pf2e.feats-srd.Item.NlEZ0piDxg9buXCL", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            // pf2e lets it make any alchemical item; the feat makes "alchemical consumables".
            { kind: "correction", pool: "advanced-alchemy", craftable: { all: ["item:trait:consumable"] }, bug: { slug: "advanced-alchemy", craftableItems: ["item:trait:alchemical"] } },
        ],
        relies: [
            { key: "CraftingAbility", match: { slug: "advanced-alchemy", isDailyPrep: true } },
        ],
        verified: "pf2e-8.6.1",
    },
    "advanced-efficient-alchemy": {
        uuid: "Compendium.pf2e.feats-srd.Item.bGCQg3XAF0twCU9w", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "advanced-herbalism": {
        uuid: "Compendium.pf2e.feats-srd.Item.ds4YR09PHgWMu3Fb", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "advanced-poisoncraft": {
        uuid: "Compendium.pf2e.feats-srd.Item.zeyo67DmTH0xMFa6", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "advanced-vials-bomber": {
        uuid: "Compendium.pf2e.classfeatures.Item.5FnyPYPaRbJthT3I", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "vialMaterial", option: "bomber-advanced-vials", materials: ["adamantine", "cold-iron", "dawnsilver"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "adventurous-outfitter": {
        uuid: "Compendium.pf2e.feats-srd.Item.A3j9m1aKDb9nErrM", type: "feat", book: "Pathfinder Adventure Path: Hell's Destiny", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "aeon-stone-formulating": {
        uuid: "Compendium.pf2e.equipment-srd.Item.upwbVWWYP6QED8wC", type: "equipment", book: "Pathfinder #213: Thirst for Blood", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "ageless-patience": {
        uuid: "Compendium.pf2e.feats-srd.Item.k8nWKHLYvAKMuwLd", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "alchemical-assessment": {
        uuid: "Compendium.pf2e.feats-srd.Item.ypir96PNY6LBSIWT", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "alchemical-crafting": {
        uuid: "Compendium.pf2e.feats-srd.Item.is3Oz9wt11lNq62K", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 4, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemical-discoveries": {
        uuid: "Compendium.pf2e.feats-srd.Item.0FNLI8APwj9NsBDa", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "formulaAllowance", on: "level", count: 1, maxLevel: "level", rarity: ["common"], filter: { all: ["item:trait:alchemical"], any: ["item:trait:elixir", "item:tag:alchemical-tool"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemical-expertise": {
        uuid: "Compendium.pf2e.classfeatures.Item.3e1PlMXmlSwKoc6d", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "gather", per10: 3 },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemical-scholar": {
        uuid: "Compendium.pf2e.feats-srd.Item.nyNsIePvpovlDAws", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 1, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical"] } },
            { kind: "formulaAllowance", on: "level", count: 1, maxLevel: "level", minLevel: "level", rarity: ["common"], filter: { all: ["item:trait:alchemical"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemical-sciences-methodology": {
        uuid: "Compendium.pf2e.classfeatures.Item.ln2Y1a4SxlU9sizX", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 2, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical"], any: ["item:trait:elixir", "item:tag:alchemical-tool"] } },
            { kind: "formulaAllowance", on: "level", count: 1, maxLevel: "level", rarity: ["common"], filter: { all: ["item:trait:alchemical"], any: ["item:trait:elixir", "item:tag:alchemical-tool"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemist-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.CJMkxlxHiHZQYDCz", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 4, maxLevel: "level", rarity: ["common"], filter: { all: ["item:trait:alchemical"] } },
            { kind: "vialSource", regain: false },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemist-goggles": {
        uuid: "Compendium.pf2e.equipment-srd.Item.7JVgLiNTAs4clEW8", type: "equipment", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["item:trait:alchemical", "action:craft"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemist-goggles-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.8XZqdeZStFAM4XnH", type: "equipment", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["item:trait:alchemical", "action:craft"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemist-goggles-major": {
        uuid: "Compendium.pf2e.equipment-srd.Item.bnmfBLXOBd3ah6GK", type: "equipment", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["item:trait:alchemical", "action:craft"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemists-haversack": {
        uuid: "Compendium.pf2e.equipment-srd.Item.5uFUIRw4YUIn0OR7", type: "backpack", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["item:trait:alchemical"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemists-lab": {
        uuid: "Compendium.pf2e.equipment-srd.Item.k6xZkDUpF7E1Totd", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "toolSubstitution", tools: ["alchemists-lab"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemists-lab-expanded": {
        uuid: "Compendium.pf2e.equipment-srd.Item.uhka9LHEP3wDKytG", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "toolSubstitution", tools: ["alchemists-lab"] },
            { kind: "rollOptions", options: ["alchemical"], when: { all: ["item:trait:alchemical"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["alchemical", "action:craft"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "alchemy": {
        uuid: "Compendium.pf2e.classfeatures.Item.w3aS3tsvH2Ub6XMn", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "alter-admixture": {
        uuid: "Compendium.pf2e.feats-srd.Item.1cjjQL0z4ZVrrSAV", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "animal-pheromones-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.GxVwATDdSGbZbx9B", type: "consumable", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        // Note: one formula covers every animal kind with a common member; a kind without one needs its own formula. The kinds
        // are not compendium items, so the family route (6.4) and G5 cannot tell them apart.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "animal-pheromones-lesser": {
        uuid: "Compendium.pf2e.equipment-srd.Item.HHsMAKU0fPgYWspm", type: "consumable", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        // Note: as animal-pheromones-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "animal-pheromones-moderate": {
        uuid: "Compendium.pf2e.equipment-srd.Item.erLH6cQYhyZB5CLM", type: "consumable", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        // Note: as animal-pheromones-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "animal-repellent-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.OjNaLZI13rWlyqmM", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: the first formula covers every common animal kind; a kind with no common member needs its own formula. The kinds
        // are not compendium items, so the family route (6.4) and G5 cannot tell them apart.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "animal-repellent-lesser": {
        uuid: "Compendium.pf2e.equipment-srd.Item.YVLwV9IGzNqIzbmV", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as animal-repellent-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "animal-repellent-major": {
        uuid: "Compendium.pf2e.equipment-srd.Item.PxrYRcawI6a3lRcf", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as animal-repellent-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "animal-repellent-minor": {
        uuid: "Compendium.pf2e.equipment-srd.Item.7V5fKnnvW7DUgbAd", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as animal-repellent-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "animal-repellent-moderate": {
        uuid: "Compendium.pf2e.equipment-srd.Item.OHxRdRv4ZLBGPQi6", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as animal-repellent-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "annotate-composition": {
        uuid: "Compendium.pf2e.feats-srd.Item.PIVC14saumGNKWbo", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "apothecarys-garden": {
        uuid: "Compendium.pf2e.adventure-specific-actions.Item.a6hGyGd4nR8tS2wE", type: "action", book: "Pathfinder GM Core", remaster: true, tier: 3,
        // Relic gift: herbs harvested at daily preparations that wither a day later (7.10's shape, like Herbal Forager).
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "arodens-hearthstone": {
        uuid: "Compendium.pf2e.equipment-srd.Item.1ZOTwnqA9ccfdrey", type: "equipment", book: "Pathfinder #156: The Apocalypse Prophet", remaster: false, tier: 4,
        // Note: its activation (legendary Crafting) crafts a weapon or armor for a quarter of the Price and no extra days, a
        // route the planner does not model.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "arodens-innovation": {
        uuid: "Compendium.pf2e.feats-srd.Item.S7g69b0VW1nUJsCs", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 2,
        // Note: a general feat of 3rd level or lower picked at each daily preparation (a crafting skill feat among them) is held
        // for the day. No rule element records the pick, so the gates and the registry do not see it.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "artisanal-crafter": {
        uuid: "Compendium.pf2e.feats-srd.Item.5myj1WCLzifR2ev6", type: "feat", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "artisans-toolkit": {
        uuid: "Compendium.pf2e.equipment-srd.Item.y34yjumCFakrbtdw", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "toolSubstitution", tools: ["artisans-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "artisans-toolkit-sterling": {
        uuid: "Compendium.pf2e.equipment-srd.Item.0QgniSjpzksm5riV", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "toolSubstitution", tools: ["artisans-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "artistic-flourish": {
        uuid: "Compendium.pf2e.spells-srd.Item.eb4FXf62NYArTqek", type: "spell", book: "Pathfinder Player Core", remaster: true, tier: 2,
        // Note: a flourished tool gives an item bonus by the caster's Crafting rank, with no rule element or spell effect. It lasts
        // 10 minutes: a Repair check, never a downtime Craft or Earn Income check (activated bonuses, 6.10).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "artistic-perfection": {
        uuid: "Compendium.pf2e.adventure-specific-actions.Item.HZz6x19bNbeCVQsN", type: "action", book: "Pathfinder Treasure Vault", remaster: true, tier: 2,
        // Note: a success with the chosen skill (Crafting or Performance) becomes a critical success; a `degreeShift` 2 -> 3 once
        // something records the choice.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "as-on-the-board-so-on-the-battlefield": {
        uuid: "Compendium.pf2e.feats-srd.Item.UhIQ1lgwwtoeHFmf", type: "feat", book: "Pathfinder Adventure Path: Hell's Destiny", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "assured-runic-crafter": {
        uuid: "Compendium.pf2e.classfeatures.Item.p5FAn20HQcWNdS0A", type: "feat", book: "", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "axe-of-the-dwarven-lords": {
        uuid: "Compendium.pf2e.equipment-srd.Item.tPwYYwxNqdGQp2nW", type: "weapon", book: "Pathfinder Gamemastery Guide", remaster: false, tier: 4,
        effects: [
            { kind: "rollOptions", options: ["snare"], when: { all: ["item:trait:snare"] } },
            { kind: "rollOptions", options: ["weapon"], when: { all: ["item:type:weapon"] } },
            { kind: "rollOptions", options: ["armor"], when: { all: ["item:type:armor"] } },
            { kind: "rollOptions", options: ["jewelry"], when: { all: ["specialty:jewelry"] } },
            { kind: "rollOptions", options: ["metalworking"], when: { all: ["specialty:metalworking"] } },
            { kind: "rollOptions", options: ["stonemasonry"], when: { all: ["specialty:stonemasonry"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:craft", { or: ["armor", "jewelry", "metalworking", "stonemasonry", "snare", "trap", "weapon"] }] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "azlanti-diamond": {
        uuid: "Compendium.pf2e.equipment-srd.Item.SmTUq7RUlZAQQHzD", type: "weapon", book: "The Dead God's Hand", remaster: true, tier: 2,
        // Note: an item bonus to Crafting by the wielder's level with no rule element (a `modifier` that scales by level), and a
        // specific item that still takes property runes, free to etch, and normal fundamental upgrades: G12 and the etch Price
        // need an exception for it.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "balm-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.t3BjX2tF2WbHM6Fg", type: "feat", book: "Pathfinder Lost Omens Cheliax, Infernal Inheritance", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:bomb"] }, vials: 1,
                combine: { when: { all: ["item:trait:elixir", "item:trait:healing", "item:rarity:common"] } } },
        ],
        verified: "pf2e-8.6.1",
    },
    "bane-ammunition-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.qZvCxp4noVqYGkT0", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: each creature type is its own formula; the types are not compendium items, so a known formula reads as covering
        // all of them.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "bane-ammunition-lesser": {
        uuid: "Compendium.pf2e.equipment-srd.Item.arNOPU7h8nNbnZ1N", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as bane-ammunition-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "bane-ammunition-moderate": {
        uuid: "Compendium.pf2e.equipment-srd.Item.RL2VI9IGuOtXsEX6", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as bane-ammunition-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "bargain-hunter": {
        uuid: "Compendium.pf2e.feats-srd.Item.5nc5ridFBfYpn2Om", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "barricade-snare": {
        uuid: "Compendium.pf2e.feats-srd.Item.q5nSrvVggjSBcc0f", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "basic-crafters-book": {
        uuid: "Compendium.pf2e.equipment-srd.Item.w4Hd6nunVVqw3GWj", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [
            { kind: "virtualFormulaList", rarity: ["common"], maxLevel: 0, minLevel: 0, books: ["Pathfinder Player Core"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "basic-scroll-cache": {
        uuid: "Compendium.pf2e.feats-srd.Item.ROAUR1GhC19Pjk9C", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "battleforger": {
        uuid: "Compendium.pf2e.feats-srd.Item.mnH68QcFRtkMbNE0", type: "feat", book: "Pathfinder Lost Omens Character Guide", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "bellflower-toolbelt": {
        uuid: "Compendium.pf2e.equipment-srd.Item.ifsBwfIhd6UcoUCI", type: "equipment", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["artisans-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "blazing-mutagen": {
        uuid: "Compendium.pf2e.feats-srd.Item.pp04AVdROQXSeaA8", type: "feat", book: "Pathfinder Lost Omens Cheliax, Infernal Inheritance", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:mutagen"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "blessed-ampoule": {
        uuid: "Compendium.pf2e.equipment-srd.Item.skMIwUIMjWzgkZ5B", type: "consumable", book: "Pathfinder #176: Lost Mammoth Valley", remaster: false, tier: 4,
        effects: [
            { kind: "correction", consumable: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "blessed-blood-nephilim": {
        uuid: "Compendium.pf2e.feats-srd.Item.BuaOQzmRNgIhGsfN", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "blowgun-poisoner": {
        uuid: "Compendium.pf2e.feats-srd.Item.QZ00D2xdJnbWFzml", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "afflictionModifier", mod: "blowgun-poisoner", as: "deliverer" },
        ],
        verified: "pf2e-8.6.1",
    },
    "bomber": {
        uuid: "Compendium.pf2e.classfeatures.Item.7JbiaZ8bxODM5mzS", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 2, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical", "item:trait:bomb"] } },
            // M8 (8.5, 8.8): the field vials' damage types (pf2e's own toggle), and the field benefit's primary-target-only splash.
            { kind: "fieldVial", option: "bomber-field-vials", choices: ["cold", "electricity", "fire"] },
            { kind: "splash", primaryOnly: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "bookkeepers-calling": {
        uuid: "Compendium.pf2e.classfeatures.Item.LoTFGTJCAGJFUFYs", type: "feat", book: "Pathfinder War of Immortals", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "born-of-item": {
        uuid: "Compendium.pf2e.heritages.Item.kHvlHDq5hs2JDG0Y", type: "heritage", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "borrow-time": {
        uuid: "Compendium.pf2e.spells-srd.Item.mlK8r1P2eszyfkGz", type: "spell", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        // Note: Crafting days worked inside the ritual's bubble should not advance the world day. The slug is shared with the
        // chronoskimmer feat Borrow Time, which the slug fallback of `heldKeys` also matches (6.11 follow-up).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "bountiful-cauldron": {
        uuid: "Compendium.pf2e.equipment-srd.Item.MBF9bZCwkJp2RZoN", type: "equipment", book: "Pathfinder #147: Tomorrow Must Burn", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "brain-cylinder": {
        uuid: "Compendium.pf2e.equipment-srd.Item.pRjJ2aBDpCH1NKRz", type: "equipment", book: "Pathfinder Adventure: Malevolence", remaster: false, tier: 4,
        // Note: higher-level cylinders may be crafted; the module crafts only the listed level.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "brastlewark-snare-engineering": {
        uuid: "Compendium.pf2e.feats-srd.Item.OuEIsBtQD1Fgx6Gz", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "brigh-moderate-boon": {
        uuid: "Compendium.pf2e.boons-and-curses.Item.pEtqyTx6Oa0OqNKl", type: "feat", book: "Pathfinder Lost Omens Gods & Magic", remaster: false, tier: 4,
        // Grants Inventor; its Crafting checks are one degree better. The invent route has no roll option of its own, so the boon
        // adds one there and the degree shifts key on it.
        effects: [
            { kind: "rollOptions", options: ["brigh-moderate-boon"], when: { all: ["route:invent"] } },
            { kind: "degreeShift", from: 0, to: 1, when: { all: ["brigh-moderate-boon"] } },
            { kind: "degreeShift", from: 1, to: 2, when: { all: ["brigh-moderate-boon"] } },
            { kind: "degreeShift", from: 2, to: 3, when: { all: ["brigh-moderate-boon"] } },
        ],
        relies: [
            { key: "GrantItem", match: { uuid: "Compendium.pf2e.feats-srd.Item.Inventor" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "broad-snare": {
        uuid: "Compendium.pf2e.feats-srd.Item.VXIfIC7mFHx1Tl7C", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 3,
        effects: [
            { kind: "quickDeploy", mark: "broad", cost: 2 },
        ],
        verified: "pf2e-8.6.1",
    },
    "broken-tusk-pendant": {
        uuid: "Compendium.pf2e.equipment-srd.Item.c9GaJKCxxqXKZokZ", type: "equipment", book: "Pathfinder #175: Broken Tusk Moon", remaster: false, tier: 4,
        // Note: one made for its own crafter has no magic; only a gift works (the order's recipient is not the crafter).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "broken-tusk-pendant-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.hEIqSfSNBWwEkldc", type: "equipment", book: "Pathfinder #175: Broken Tusk Moon", remaster: false, tier: 4,
        // Note: as broken-tusk-pendant.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "build-workshop-crafting": {
        uuid: "Compendium.pf2e.adventure-specific-actions.Item.rI9qKyONeMPtajZ8", type: "action", book: "Pathfinder #146: Cult of Cinders", remaster: false, tier: 4,
        // Note: Crafting checks made in the citadel's workshop get a circumstance bonus, more for its chosen trade; a site the
        // module cannot see.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "butterfly-bender": {
        uuid: "Compendium.pf2e.spells-srd.Item.wneYzMFUWreyqWHD", type: "spell", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        // Note: one ritual outcome is an Earn Income task above the settlement's cap, and losing it makes the next Earn Income
        // result one degree worse; GM-applied.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "cadre": {
        uuid: "Compendium.pf2e.feats-srd.Item.NT1U4UF1WqIkR5tA", type: "feat", book: "Pathfinder Battlecry!", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "carver-cutter": {
        uuid: "Compendium.pf2e.equipment-srd.Item.0liiZqvhcM69tKl9", type: "weapon", book: "Pathfinder Rage of Elements", remaster: true, tier: 2,
        effects: [
            { kind: "rollOptions", options: ["action:craft:woodworking"], when: { all: ["specialty:woodworking"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:craft:woodworking"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "carver-cutter-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.MNx8UznusoyRy06k", type: "weapon", book: "Pathfinder Rage of Elements", remaster: true, tier: 2,
        effects: [
            { kind: "rollOptions", options: ["action:craft:woodworking"], when: { all: ["specialty:woodworking"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:craft:woodworking"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "carver-cutter-major": {
        uuid: "Compendium.pf2e.equipment-srd.Item.O5PgCWNhFtTFL7S5", type: "weapon", book: "Pathfinder Rage of Elements", remaster: true, tier: 2,
        effects: [
            { kind: "rollOptions", options: ["action:craft:woodworking"], when: { all: ["specialty:woodworking"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:craft:woodworking"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "carver-cutter-true": {
        uuid: "Compendium.pf2e.equipment-srd.Item.ePmUVkh4NgM4eGdR", type: "weapon", book: "Pathfinder Rage of Elements", remaster: true, tier: 2,
        effects: [
            { kind: "rollOptions", options: ["action:craft:woodworking"], when: { all: ["specialty:woodworking"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:craft:woodworking"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "cauldron": {
        uuid: "Compendium.pf2e.feats-srd.Item.zUtdBd3IbM7UX0AD", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [
            { kind: "craftUnlock", category: "potion" },
            { kind: "craftUnlock", category: "oil" },
            { kind: "formulaAllowance", on: "gain", count: 4, maxLevel: 1, rarity: ["common"], filter: { any: ["item:trait:oil", "item:trait:potion"] } },
            { kind: "formulaAllowance", on: "level", levels: [4, 6, 8, 10, 12, 14, 16, 18, 20], count: 1, maxLevel: "level", rarity: ["common"], filter: { any: ["item:trait:oil", "item:trait:potion"] } },
        ],
        relies: [
            { key: "CraftingAbility", match: { slug: "cauldron", isDailyPrep: true, craftableItems: [{ or: ["item:trait:oil", "item:trait:potion"] }] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "celebrity-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.MNArjo5Z5LUYITQm", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "ceremonial-knife": {
        uuid: "Compendium.pf2e.feats-srd.Item.78pkCdFaY8hI07Lj", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "dailies" },
        ],
        verified: "pf2e-8.6.1",
    },
    "chirurgeon": {
        uuid: "Compendium.pf2e.classfeatures.Item.eNZnx4LISDNftbx2", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 2, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical", "item:trait:elixir", "item:trait:healing"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "chrysanthemum-leshy": {
        uuid: "Compendium.pf2e.heritages.Item.CpjsxaXYjlkCI5nc", type: "heritage", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "city-scavenger": {
        uuid: "Compendium.pf2e.feats-srd.Item.g388ImzpenYBoiEF", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "cobble-together": {
        uuid: "Compendium.pf2e.actionspf2e.Item.PE1jm9lBveujj2md", type: "action", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        // Note: a 10-minute Craft of a temporary common item of half the crafter's level; no route for it yet (Magical Scrounger,
        // 7.10, builds on it).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "combine-elixirs": {
        uuid: "Compendium.pf2e.feats-srd.Item.jSkJIWPfSZZzvYzq", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:elixir"] }, vials: 1, combine: { when: { all: ["item:trait:elixir"] }, level: "first", merge: true } },
        ],
        verified: "pf2e-8.6.1",
    },
    "combustible-poison": {
        uuid: "Compendium.pf2e.feats-srd.Item.Pcv6IF8V1yT9tYrN", type: "feat", book: "Pathfinder Lost Omens Cheliax, Infernal Inheritance", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:poison"] } },
            { kind: "afflictionModifier", mod: "combustible-poison", as: "additive" },
        ],
        verified: "pf2e-8.6.1",
    },
    "communal-crafting": {
        uuid: "Compendium.pf2e.feats-srd.Item.lUXVmSFJbaPos5pY", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "complete-reconfiguration": {
        uuid: "Compendium.pf2e.classfeatures.Item.j0klWHkH3AxUAgok", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "consult-the-stars": {
        uuid: "Compendium.pf2e.feats-srd.Item.NySPRgD0FjZY2QGs", type: "feat", book: "Pathfinder Lost Omens Ancestry Guide", remaster: false, tier: 4,
        // Note: trained in a Charisma, Intelligence or Wisdom skill (Crafting or a Lore among them) until the next preparations,
        // with no rule element: G1 and Earn Income refuse an untrained character unless the rank is set by hand.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "contingency-gadgets": {
        uuid: "Compendium.pf2e.feats-srd.Item.4st3fSYSrJrxwHOP", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "cookware": {
        uuid: "Compendium.pf2e.equipment-srd.Item.Yf7maiRDmmHAyF82", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["cookware"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "cooperative-crafting": {
        uuid: "Compendium.pf2e.feats-srd.Item.K3Pgj5z9OpLFzxgt", type: "feat", book: "Pathfinder Lost Omens Highhelm", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "craft-anything": {
        uuid: "Compendium.pf2e.feats-srd.Item.v62QzTwHOT3t86cL", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "craft-disharmonic-instrument": {
        uuid: "Compendium.pf2e.actionspf2e.Item.iBf9uGn5LOHkWpZ6", type: "action", book: "Pathfinder Lost Omens Monsters of Myth", remaster: false, tier: 4,
        // Note: a special Craft with its own materials, fixed cost and time and its own degrees.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "craft-facsimile": {
        uuid: "Compendium.pf2e.feats-srd.Item.xLD9EmkEmT8hgwv7", type: "feat", book: "Pathfinder Lost Omens Pathfinder Society Guide", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "craft-philosophers-stone": {
        uuid: "Compendium.pf2e.feats-srd.Item.zOK6IFSz3DIBRjEw", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "crafters-eyepiece": {
        uuid: "Compendium.pf2e.equipment-srd.Item.RgNBGpBc9G2yw1C2", type: "equipment", book: "Pathfinder GM Core", remaster: true, tier: 2,
        effects: [
            { kind: "repairHp", success: 10, critSuccess: 15 },
        ],
        verified: "pf2e-8.6.1",
    },
    "crafters-eyepiece-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.JSYtBZ7XblyAEFoV", type: "equipment", book: "Pathfinder GM Core", remaster: true, tier: 2,
        effects: [
            { kind: "repairHp", success: 10, critSuccess: 15 },
        ],
        verified: "pf2e-8.6.1",
    },
    "crafters-workshop": {
        uuid: "Compendium.pf2e.pathfinder-society-boons.Item.gdkQ04RgMJZ0QxbZ", type: "feat", book: "", remaster: false, tier: 4,
        // PFS boon (its publication title is empty): 1 day of setup. Reverse engineering keeps its own (the boon makes new items).
        effects: [
            { kind: "setupDays", days: 1, when: { not: ["craft-type:grow", "craft-type:deconstruct", "craft-type:quest", "route:reverse-engineer"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "create-familiar-fulu": {
        uuid: "Compendium.pf2e.actionspf2e.Item.NT1rtY5DFJGsR5QR", type: "action", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        // A fulu made without cost or check once a day, lasting until the next preparations (7.10's shape).
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "creative-spark": {
        uuid: "Compendium.pf2e.adventure-specific-actions.Item.bweyCSaXUjmcSTAO", type: "action", book: "Pathfinder Lost Omens Highhelm", remaster: false, tier: 4,
        // Note: pf2e applies its Crafting bonus behind its own toggle; the once-a-day degree shift and the forge waiver are not
        // automated.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "curse-breaker": {
        uuid: "Compendium.pf2e.pathfinder-society-boons.Item.oOB1uKvoBMGj7ykZ", type: "feat", book: "", remaster: false, tier: 4,
        // Note: PFS boon; uncursing an item is a Craft-like job with another skill and 2 setup days, which no craft type models.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "cytillesh-toolkit": {
        uuid: "Compendium.pf2e.equipment-srd.Item.u6pDaIxMIimhQx7X", type: "equipment", book: "Pathfinder Monster Core", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["healers-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "debilitating-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.sv4LeEbkOJyLen10", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:bomb"] }, toggle: { domain: "alchemical-bomb-base-attack-roll", option: "debilitating-bomb" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "decree-of-prosperity": {
        uuid: "Compendium.pf2e.feats-srd.Item.O31zB7jxaW2487Q8", type: "feat", book: "Pathfinder War of Immortals", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "deeper-dabbler": {
        uuid: "Compendium.pf2e.feats-srd.Item.PTXZ2C3AV8tZf0iX", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "demilich-eye-gem": {
        uuid: "Compendium.pf2e.equipment-srd.Item.Q4o8pEdxSY0bnJQZ", type: "equipment", book: "Pathfinder Bestiary", remaster: false, tier: 4,
        // Note: its Craft Requirements forbid crafting it, though it has a Price, so G12 does not stop it: a `gate` once built.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "directional-bombs": {
        uuid: "Compendium.pf2e.feats-srd.Item.ozvYhY4hG1deXly8", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "splash", cone: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "double-brew": {
        uuid: "Compendium.pf2e.classfeatures.Item.76cwNLJEm4Yetnee", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "brew", count: 2 },
        ],
        verified: "pf2e-8.6.1",
    },
    "double-double": {
        uuid: "Compendium.pf2e.feats-srd.Item.wwnhnV3balaVdMu5", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "double-poison": {
        uuid: "Compendium.pf2e.feats-srd.Item.FlZ5knPmyq4CEhl7", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "afflictionModifier", mod: "double-poison", as: "deliverer" },
        ],
        verified: "pf2e-8.6.1",
    },
    "dreamers-calling": {
        uuid: "Compendium.pf2e.classfeatures.Item.HnUzQqmAphx9nXDt", type: "feat", book: "Pathfinder Revenge of the Runelords Player's Guide", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "effect-curse-of-turbulent-moments": {
        uuid: "Compendium.pf2e.feat-effects.Item.oSzUv21eN9VS9TC1", type: "effect", book: "Pathfinder Dark Archive", remaster: false, tier: 4,
        // Note: from the moderate curse, afflictions on the oracle run at half their intervals; an `afflictionModifier` as the
        // victim once a mod for it exists.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "effect-nymph-queens-inspiration": {
        uuid: "Compendium.pf2e.bestiary-effects.Item.iSyyR4QVOaY6mxtg", type: "effect", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "efficient-alchemy-alchemist": {
        uuid: "Compendium.pf2e.feats-srd.Item.c7jNms3ZQ8eaMUqv", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "batchSize", multiply: 2, when: { all: ["item:trait:alchemical", "item:trait:consumable"] } },
        ],
        relies: [
            { key: "ActiveEffectLike", match: { path: "system.crafting.entries.advancedAlchemy.maxSlots" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "efficient-alchemy-paragon": {
        uuid: "Compendium.pf2e.feats-srd.Item.2FBZ0apnmZ7b61ct", type: "feat", book: "Pathfinder #150: Broken Promises", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elaborate-scroll-esoterica": {
        uuid: "Compendium.pf2e.feats-srd.Item.nWd7m0yRcIEVUy7O", type: "feat", book: "Pathfinder Dark Archive (Remastered)", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "dailies" },
        ],
        verified: "pf2e-8.6.1",
    },
    "elaborate-talisman-esoterica": {
        uuid: "Compendium.pf2e.feats-srd.Item.VO8HbMQ79NULE4FQ", type: "feat", book: "Pathfinder Dark Archive (Remastered)", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-greater-acid": {
        uuid: "Compendium.pf2e.equipment-srd.Item.q2TpCwdlLGdcasKD", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: each damage type is its own formula, and its three grades are one family (6.4); the name-derived key keeps
        // "(Greater, Acid)" whole, so each item is a family of one. A `formulaFamily` override (`elemental ammunition (acid)`)
        // or a grade rule in families.mjs that reads "(Grade, Type)" (follow-up).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-greater-cold": {
        uuid: "Compendium.pf2e.equipment-srd.Item.98t5XqMj2wRKjGsI", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-greater-electricity": {
        uuid: "Compendium.pf2e.equipment-srd.Item.xsuxsWD8OT11adpI", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-greater-fire": {
        uuid: "Compendium.pf2e.equipment-srd.Item.mwT86aIYuKy9mWHY", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-greater-poison": {
        uuid: "Compendium.pf2e.equipment-srd.Item.oS43VwmYZlSLxx1G", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-lesser-acid": {
        uuid: "Compendium.pf2e.equipment-srd.Item.zHzAZRDVtl2NFqyh", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-lesser-cold": {
        uuid: "Compendium.pf2e.equipment-srd.Item.WnNvHEYObRivN1wI", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-lesser-electricity": {
        uuid: "Compendium.pf2e.equipment-srd.Item.IhRPEmA2JlYNiCPK", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-lesser-fire": {
        uuid: "Compendium.pf2e.equipment-srd.Item.CGmJzsdRb5aJ4eFn", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-lesser-poison": {
        uuid: "Compendium.pf2e.equipment-srd.Item.EVaMsTsWhdPkCtrg", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-moderate-acid": {
        uuid: "Compendium.pf2e.equipment-srd.Item.2pB7AsbE0c7HvoZZ", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-moderate-cold": {
        uuid: "Compendium.pf2e.equipment-srd.Item.zG5ErG09BZiVIGcP", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-moderate-electricity": {
        uuid: "Compendium.pf2e.equipment-srd.Item.39kmT1vcfywtQtg9", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-moderate-fire": {
        uuid: "Compendium.pf2e.equipment-srd.Item.xUMgX1vrP4EfLlw2", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elemental-ammunition-moderate-poison": {
        uuid: "Compendium.pf2e.equipment-srd.Item.xZ9fSlTKVpKOCOQm", type: "ammo", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as elemental-ammunition-greater-acid.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elements-of-creation": {
        uuid: "Compendium.pf2e.adventure-specific-actions.Item.URZRO1ROM9VOS1nN", type: "action", book: "Pathfinder Lost Omens Highhelm", remaster: false, tier: 4,
        // Its Crafting rules predicate `creative-spark`, the toggle of Creative Spark (its prerequisite), so no `rollOptions`
        // effect is needed; listed here because the validator fails an ignored item with a bare Crafting option.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "embed-aeon-stone": {
        uuid: "Compendium.pf2e.feats-srd.Item.EZrxp0XxYh9rjghB", type: "feat", book: "Pathfinder Lost Omens Rival Academies", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "empathic-cords": {
        uuid: "Compendium.pf2e.equipment-srd.Item.o7JdR8SFXIf5dLIW", type: "equipment", book: "Pathfinder Special: Fumbus!", remaster: false, tier: 4,
        // Note: one Craft at the listed Price makes both cords of the pair; pf2e has one item for the pair.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "endemic-herbs": {
        uuid: "Compendium.pf2e.feats-srd.Item.BQzExsEZrwGsJD66", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "enduring-alchemy": {
        uuid: "Compendium.pf2e.feats-srd.Item.jBeuyq0Aged45YAc", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "expiryRule", rule: "enduring", when: { any: ["item:trait:elixir", "item:tag:alchemical-tool"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "energy-resistant": {
        uuid: "Compendium.pf2e.equipment-srd.Item.Lw3B9DpnyrpXD9Di", type: "equipment", book: "Pathfinder GM Core", remaster: true, tier: 2,
        // Note: the crafter picks the energy type. pf2e's property keys are per type (acidResistant, coldResistant,
        // electricityResistant, fireResistant), so the etching is refused as rune-unsupported and the replaced rune's Price is
        // not found. A `runeChoice {choices}` that maps the pick to the key, and the key back to this item (follow-up).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "energy-resistant-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.9CAWAKkZE7dr4FlJ", type: "equipment", book: "Pathfinder GM Core", remaster: true, tier: 2,
        // Note: as energy-resistant, with the greater keys (greaterAcidResistant and the rest).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "eternal-elixir": {
        uuid: "Compendium.pf2e.feats-srd.Item.giOEclnMp8txkRSU", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "expiryRule", rule: "uncapped", when: { all: ["item:trait:elixir"] }, maxLevel: "half" },
        ],
        verified: "pf2e-8.6.1",
    },
    "expanded-splash": {
        uuid: "Compendium.pf2e.feats-srd.Item.gyVcJfZTmBytLsXq", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "splash", bonusInt: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "experienced-professional": {
        uuid: "Compendium.pf2e.feats-srd.Item.sMm0UfYxEPpq2Yzd", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "earnIncome", doubleFailure: true },
        ],
        relies: [
            { key: "AdjustDegreeOfSuccess", match: { selector: "lore-skill-check", predicate: ["action:earn-income"], adjustment: { criticalFailure: "one-degree-better" } } },
        ],
        verified: "pf2e-8.6.1",
    },
    "experienced-smuggler": {
        uuid: "Compendium.pf2e.feats-srd.Item.t3btih0O5RUwWynt", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "expert-fireworks-crafter": {
        uuid: "Compendium.pf2e.feats-srd.Item.dDFQJem5K9Jzxgda", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "expert-scroll-cache": {
        uuid: "Compendium.pf2e.feats-srd.Item.UrOj9TROtn8nuxPf", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "exploitative-wealth": {
        uuid: "Compendium.pf2e.equipment-srd.Item.QZENjzvPNlwHwEUv", type: "equipment", book: "Pathfinder Lost Omens Cheliax, Infernal Inheritance", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "exploitive-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.hr9maYUbtrNxpBPw", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:bomb"] }, toggle: { domain: "attack-roll", option: "exploitive-bomb" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "extra-alchemy": {
        uuid: "Compendium.pf2e.familiar-abilities.Item.ModT5b0jvnaitzJH", type: "action", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        // Note: the extra Advanced Alchemy slot comes from Effect: Extra Alchemy (feat-effects vSUyph3Z6wKl2l6Q) on the
        // alchemist, which correctPool keeps. The ability sits on the familiar, so the master's held keys never include it.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "fabricated-connections": {
        uuid: "Compendium.pf2e.feats-srd.Item.e6s2nIvlTycuzlR9", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "feast-planner": {
        uuid: "Compendium.pf2e.feats-srd.Item.SuIRAnpe0RvNrx6I", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "fermenting-liquors": {
        uuid: "Compendium.pf2e.feats-srd.Item.vEpM7qYZmBiwBiNT", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "field-discovery-bomber": {
        uuid: "Compendium.pf2e.classfeatures.Item.8QAFgy9U8PxEa7Dw", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "splash", intDamage: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "fine-living": {
        uuid: "Compendium.pf2e.kingmaker-features.Item.CtNmx1wUgHDikQqI", type: "campaignFeature", book: "Pathfinder Kingmaker", remaster: false, tier: 4,
        // Note: a circumstance bonus to Craft and Earn Income checks in the kingdom; no rule element, and the kingdom holds it,
        // not a character.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "firework-technician-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.MVbNnjqQOK9d8Ki3", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [
            { kind: "vialSource", regain: true },
            // G5: the uncommon sparkler is open to those who can Craft fireworks (its Access line).
            { kind: "craftUnlock", access: { all: ["item:slug:sparkler"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "flawless-celestial-shawl": {
        uuid: "Compendium.pf2e.equipment-srd.Item.iyXC3tIX3VmjCx6G", type: "equipment", book: "Pathfinder Monster Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["artisans-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "food-preservation": {
        uuid: "Compendium.pf2e.feats-srd.Item.SeTlSDlaFudKg86x", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "designate" },
            { kind: "expiryRule", rule: "designate", when: { all: ["item:tag:alchemical-food"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "foolproof-instructions": {
        uuid: "Compendium.pf2e.feats-srd.Item.agWNAYqgyV58jlxm", type: "feat", book: "Pathfinder Lost Omens Pathfinder Society Guide", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "formula-book": {
        uuid: "Compendium.pf2e.classfeatures.Item.XPPG7nN9pxt0sjMg", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 2, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical"] } },
            { kind: "formulaAllowance", on: "level", count: 2, maxLevel: "level", rarity: ["common"], filter: { all: ["item:trait:alchemical"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "fortune-cord": {
        uuid: "Compendium.pf2e.equipment-srd.Item.cuWnhVyMCHqOA2Hl", type: "equipment", book: "Pathfinder Season of Ghosts Hardcover Compilation", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "FlatModifier", match: { selector: "skill-check", predicate: ["action:earn-income"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "fused-staff": {
        uuid: "Compendium.pf2e.feats-srd.Item.enxzAkPICXT4sSFU", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "gadget-specialist": {
        uuid: "Compendium.pf2e.feats-srd.Item.DQN7YC7s7T0pL6Aa", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 3, maxLevel: "level", rarity: ["common", "uncommon"], filter: { all: ["item:trait:gadget"] } },
            { kind: "formulaAllowance", on: "rank", skill: "crafting", ranks: [3, 4], count: 3, maxLevel: "level", rarity: ["common", "uncommon"], filter: { all: ["item:trait:gadget"] } },
        ],
        relies: [
            { key: "CraftingAbility", match: { slug: "gadget-specialist", isDailyPrep: true, craftableItems: ["item:trait:gadget"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "giant-snare": {
        uuid: "Compendium.pf2e.feats-srd.Item.SgXvw6rzk2lhTpXL", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [
            { kind: "quickDeploy", mark: "giant", cost: 2 },
        ],
        verified: "pf2e-8.6.1",
    },
    "gingerbread-house": {
        uuid: "Compendium.pf2e.equipment-srd.Item.KaMBXc0Yqn2rAUec", type: "equipment", book: "Pathfinder #182: Graveclaw", remaster: false, tier: 4,
        // Note: crafted with Cooking Lore instead of Crafting. The rule is on the product, and `craftSkills` reads only the
        // crafter's keys: a product-side `skillSubstitution` (follow-up).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "glitter-crystals": {
        uuid: "Compendium.pf2e.feats-srd.Item.sYOaZoPqNBnppY51", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { any: ["item:trait:healing", "item:tag:alchemical-food"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "golden-league-xun-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.jTOxxy19o2VRJTbH", type: "feat", book: "Pathfinder #167: Ready? Fight!", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "graft-technician": {
        uuid: "Compendium.pf2e.feats-srd.Item.9OaF7Lkrtvusg5AA", type: "feat", book: "Pathfinder Howl of the Wild", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 4, maxLevel: 3, rarity: ["common"], filter: { all: ["item:trait:graft"] } },
            { kind: "skillSubstitution", skill: "medicine", when: { all: ["craft-type:graft"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "medicine", predicate: ["action:implant-graft"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "grand-scroll-esoterica": {
        uuid: "Compendium.pf2e.feats-srd.Item.LHjPTV5vP3MOsPPJ", type: "feat", book: "Pathfinder Dark Archive (Remastered)", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "gravelands-herbalist": {
        uuid: "Compendium.pf2e.feats-srd.Item.M9WIUEPY6IoRtgWN", type: "feat", book: "Pathfinder Lost Omens Knights of Lastwall", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "greater-field-discovery-bomber": {
        uuid: "Compendium.pf2e.classfeatures.Item.RGs4uR3CAvgbtBAA", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "splash", greater: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "guiding-chisel": {
        uuid: "Compendium.pf2e.equipment-srd.Item.TGCzwDIrAqo3HUhr", type: "equipment", book: "Pathfinder #148: Fires of the Haunted City", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "handy-with-your-paws": {
        uuid: "Compendium.pf2e.feats-srd.Item.1newzNV5nkLvZ9KE", type: "feat", book: "Pathfinder #153: Life's Long Shadows", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "hat-of-many-minds": {
        uuid: "Compendium.pf2e.equipment-srd.Item.Hu9n7JNutzFarHe7", type: "equipment", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "FlatModifier", match: { selector: "skill-check", predicate: ["action:earn-income"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "haunting-memories": {
        uuid: "Compendium.pf2e.feats-srd.Item.aprpqUlRpRVXwAJv", type: "feat", book: "Pathfinder Lost Omens Shining Kingdoms", remaster: true, tier: 2,
        // Note: each daily preparation raises one skill (Crafting to master among them, G3) and gives a skill feat for the day,
        // with no rule element; the rank must be set by hand.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "healers-toolkit": {
        uuid: "Compendium.pf2e.equipment-srd.Item.s1vB3HdXjMigYAnY", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["healers-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "healers-toolkit-expanded": {
        uuid: "Compendium.pf2e.equipment-srd.Item.SGkOHFyBbzWdBk8D", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["healers-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "healing-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.xXHwktc9SymSY8d6", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { any: ["item:slug:elixir-of-life-minor", "item:slug:elixir-of-life-lesser", "item:slug:elixir-of-life-moderate", "item:slug:elixir-of-life-greater", "item:slug:elixir-of-life-major", "item:slug:elixir-of-life-true"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "herbal-forager": {
        uuid: "Compendium.pf2e.feats-srd.Item.0EsMqnrmTEQBG65e", type: "feat", book: "Pathfinder Howl of the Wild", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "herbalist-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.5CRt5Dy9eLv5LpRF", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            // pf2e always gives 4; the feat gives 2 fewer unless the daily preparations are made in the wilderness.
            { kind: "correction", pool: "advanced-alchemy", slots: { add: -2, unless: "wilderness" }, bug: { slug: "advanced-alchemy", maxSlots: 4 } },
            { kind: "skillSubstitution", skill: "nature", when: { all: ["item:trait:alchemical", "item:trait:consumable", "item:trait:healing"] } },
            { kind: "toolSubstitution", tools: ["alchemists-lab"], requires: ["healers-toolkit"], when: { all: ["item:trait:alchemical", "item:trait:consumable", "item:trait:healing"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "highhelm-stronghold-plate": {
        uuid: "Compendium.pf2e.equipment-srd.Item.SMruq5revpHcKDdt", type: "armor", book: "Pathfinder Lost Omens Highhelm", remaster: false, tier: 4,
        // Note: its requirements are headed "Crafting Requirements", which `craftRequirementsOf` does not read, so the casting
        // pledge (6.9) never asks for its wall of stone (spells-srd kOa055FIrO9Smnya, not linked). A correction naming the
        // casting, or the heading accepted (follow-up).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "horn-of-plenty": {
        uuid: "Compendium.pf2e.classfeatures.Item.gjZXHLjezR0mkMnc", type: "feat", book: "Pathfinder War of Immortals", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "ice-crafter": {
        uuid: "Compendium.pf2e.feats-srd.Item.0evTnx67DYsxWtg3", type: "feat", book: "Pathfinder Lost Omens Monsters of Myth", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "impeccable-crafting": {
        uuid: "Compendium.pf2e.feats-srd.Item.PiUe3tpv7UVtnfvS", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "rollOptions", options: ["speciality"], when: { all: ["specialty:own"] } },
            { kind: "degreeShift", from: 2, to: 3, when: { all: ["speciality"] } },
        ],
        relies: [
            { key: "Note", match: { selector: "crafting", predicate: ["action:craft", "speciality"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "imperial-dragon-potion": {
        uuid: "Compendium.pf2e.feats-srd.Item.BoLeT3uNl7iikQuI", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "impossible-snares": {
        uuid: "Compendium.pf2e.feats-srd.Item.rwTbN2A2ZO7CdKoC", type: "feat", book: "Pathfinder Advanced Player's Guide", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "improbable-elixirs": {
        uuid: "Compendium.pf2e.feats-srd.Item.nnsoFOtuHnpz2QHc", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "improvise-admixture": {
        uuid: "Compendium.pf2e.feats-srd.Item.H6SL2F11nlMfqCQC", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "improvise-tool": {
        uuid: "Compendium.pf2e.feats-srd.Item.3HChkcD1IRqv4DbA", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "virtualFormulaList", uuids: ["Compendium.pf2e.equipment-srd.Item.7fSnvJ2xoSfa6JXD", "Compendium.pf2e.equipment-srd.Item.Ti4gWILk69LPxKuU", "Compendium.pf2e.equipment-srd.Item.wob6DB1FFdWs0mbp", "Compendium.pf2e.equipment-srd.Item.44F1mfJei4GY8f2X", "Compendium.pf2e.equipment-srd.Item.3tOyV4VZEZhwnAMO", "Compendium.pf2e.equipment-srd.Item.UlIxxLm71UdRgCFE", "Compendium.pf2e.equipment-srd.Item.ML0GR2cIEdMn2hoD", "Compendium.pf2e.equipment-srd.Item.5j5KyZsGOfbrJNUZ", "Compendium.pf2e.equipment-srd.Item.oX39xqMLVB8kNrY0", "Compendium.pf2e.equipment-srd.Item.fyYnQf1NAx9fWFaS", "Compendium.pf2e.equipment-srd.Item.ccsgob2TZ7WqTrp7", "Compendium.pf2e.equipment-srd.Item.Sw7MBLASN3xK4Y44", "Compendium.pf2e.equipment-srd.Item.wrpI5z7iWB8XvflQ", "Compendium.pf2e.equipment-srd.Item.Zr4PwTEuBLE30kkn", "Compendium.pf2e.equipment-srd.Item.8Jdw4yAzWYylGePS"] },
            // Repair without a repair toolkit (4.5); never Affix a Talisman, whose service options do not name the action.
            { kind: "toolSubstitution", tools: ["repair-toolkit"], when: { all: ["action:repair"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "inexplicable-apparatus": {
        uuid: "Compendium.pf2e.equipment-srd.Item.V9iVPhIk980GT6A2", type: "equipment", book: "Pathfinder GM Core", remaster: true, tier: 2,
        effects: [
            { kind: "setupDays", days: 1, when: { not: ["craft-type:grow", "craft-type:deconstruct", "craft-type:quest"] } },
            { kind: "rateLevel", add: 1 },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: [{ or: ["action:craft", "action:earn-income", "action:repair"] }] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "infused-reagents": {
        uuid: "Compendium.pf2e.classfeatures.Item.wySB9VHOW1v3TX1L", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "innovation": {
        uuid: "Compendium.pf2e.classfeatures.Item.jIAgXe2FetAKBwt7", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "inscribed-with-elders-deeds": {
        uuid: "Compendium.pf2e.feats-srd.Item.SIsEvELAKfjZxDwx", type: "feat", book: "Pathfinder #207: The Resurrection Flood", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "instant-fortress": {
        uuid: "Compendium.pf2e.equipment-srd.Item.EXXqJp8rU6HR5Ufg", type: "equipment", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        // Note: only remake or a legendary crafter can repair it; the Repair service (6.13) offers it to anyone. A product-side
        // `gate {service: "repair", skill: "crafting", rank: 4}` once built.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "intensified-element-stance": {
        uuid: "Compendium.pf2e.feats-srd.Item.qOGD3K8VlQAAjsWy", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "inventor": {
        uuid: "Compendium.pf2e.feats-srd.Item.XR95taODq1sq82Du", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    // M9: inventors have access to uncommon gadgets (Guns & Gears, Gadgets). The class shares the Inventor feat's slug, so
    // it is keyed apart; a character's class item matches by its compendium source.
    "inventor@class": {
        uuid: "Compendium.pf2e.classes.Item.30qVs46dVNflgQNx", type: "class", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [
            { kind: "craftUnlock", access: { all: ["item:trait:gadget", "item:rarity:uncommon"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "inventor-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.JIpjpZ8VneQomkZw", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "inventors-chair": {
        uuid: "Compendium.pf2e.equipment-srd.Item.AUVNxFeognmids36", type: "equipment", book: "Pathfinder Treasure Vault", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["artisans-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "invigorating-elixir": {
        uuid: "Compendium.pf2e.feats-srd.Item.AhrF360kZt0QJIub", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:elixir", "item:trait:healing"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "ive-had-many-jobs": {
        uuid: "Compendium.pf2e.feats-srd.Item.asjDgf7Q9BWZoK5Y", type: "feat", book: "Pathfinder Season of Ghosts Hardcover Compilation", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "junk-tinker": {
        uuid: "Compendium.pf2e.feats-srd.Item.YMKtEoNwHKA713Cx", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "kinetic-activation": {
        uuid: "Compendium.pf2e.feats-srd.Item.NV9H39kbkbjhAK6X", type: "feat", book: "Pathfinder Rage of Elements", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "leaf-transformation": {
        uuid: "Compendium.pf2e.feats-srd.Item.gB5H7vnYOlq2Ycv0", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "legendary-leader": {
        uuid: "Compendium.pf2e.feats-srd.Item.TBg1eRh0lLUV4ewp", type: "feat", book: "Pathfinder Battlecry!", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "legendary-performer": {
        uuid: "Compendium.pf2e.feats-srd.Item.467qQoiy6bjWU1G8", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "legendary-professional": {
        uuid: "Compendium.pf2e.feats-srd.Item.GZba7ped7ZxYHchf", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    // M9 (6.14): a magical tattoo at least 3 levels below its tattooist gets +1 to its activated abilities' attack and DC values and
    // to its resistances, written on the created item (no rule element does it).
    "legendary-tattoo-artist": {
        uuid: "Compendium.pf2e.feats-srd.Item.VRCBTEyrcBf7auGz", type: "feat", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        effects: [
            { kind: "crafterMark", mark: "activated", by: 1, below: 3, when: { all: ["item:trait:tattoo"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "legions-aim": {
        uuid: "Compendium.pf2e.feats-srd.Item.2FqgPiW7B0w9jzXd", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 2,
        effects: [
            { kind: "craftUnlock", access: { all: ["item:trait:alchemical", "item:trait:bomb", "item:rarity:uncommon"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "lethargy-poisoner": {
        uuid: "Compendium.pf2e.feats-srd.Item.HlSwpxreIfsglTJ8", type: "feat", book: "Pathfinder Battlecry!", remaster: true, tier: 3,
        effects: [
            // pf2e gives 3 doses from master; the feat gives 1, 2 at master and 3 at legendary in Crafting.
            { kind: "correction", pool: "lethargy-poisoner", slots: { skill: "crafting", byRank: [1, 1, 1, 2, 3] },
                bug: { slug: "lethargy-poisoner", maxSlots: "ternary(gte(@actor.system.skills.crafting.rank,3),3,1)" } },
            // pf2e's Stupor Poison rule carries a master-rank predicate that CraftingAbility never tests, so it offers Stupor
            // Poison at any rank; the feat allows it from expert.
            { kind: "correction", pool: "lethargy-poisoner", gate: { when: { all: ["item:slug:stupor-poison"] }, skill: "crafting", rank: 2 },
                bug: { slug: "lethargy-poisoner", craftableItems: ["item:slug:stupor-poison"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "life-of-luxury": {
        uuid: "Compendium.pf2e.kingmaker-features.Item.sMBQ8i8xN1X0rSs9", type: "campaignFeature", book: "Pathfinder Kingmaker", remaster: false, tier: 4,
        // Note: as fine-living, with a larger bonus.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "lightning-snares": {
        uuid: "Compendium.pf2e.feats-srd.Item.4OEZrIefIuIjUDzE", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "lingering-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.rO62pAX3UXXkg5Wl", type: "feat", book: "Pathfinder Lost Omens Cheliax, Infernal Inheritance", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:bomb"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "living-god": {
        uuid: "Compendium.pf2e.feats-srd.Item.1eXHDDOLZATKpWjL", type: "feat", book: "Pathfinder Lost Omens Divine Mysteries", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "lucky-copper": {
        uuid: "Compendium.pf2e.equipment-srd.Item.awtacA9swoKxH8fY", type: "equipment", book: "Pathfinder Adventures: Troubles in Grayce", remaster: true, tier: 2,
        // Note: its Craft Requirements make a Craft check under a misfortune effect a critical failure; no product-side degree
        // effect exists.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "lucky-gold": {
        uuid: "Compendium.pf2e.equipment-srd.Item.PFkSHCwfrQq3GrOy", type: "equipment", book: "Pathfinder Adventures: Troubles in Grayce", remaster: true, tier: 2,
        // Note: as lucky-copper.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "lucky-silver": {
        uuid: "Compendium.pf2e.equipment-srd.Item.4FnFyFOEigjTFs3W", type: "equipment", book: "Pathfinder Adventures: Troubles in Grayce", remaster: true, tier: 2,
        // Note: as lucky-copper.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "magical-crafting": {
        uuid: "Compendium.pf2e.feats-srd.Item.xWY5omyIcILNR7y1", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 4, maxLevel: 2, rarity: ["common"], filter: { any: ["item:trait:magical", "item:trait:arcane", "item:trait:divine", "item:trait:occult", "item:trait:primal"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "malleable-clay": {
        uuid: "Compendium.pf2e.equipment-srd.Item.gMjoALuwSUdTmqqZ", type: "consumable", book: "Pathfinder #176: Lost Mammoth Valley", remaster: false, tier: 4,
        effects: [
            { kind: "correction", consumable: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "mask-of-the-12th-step": {
        uuid: "Compendium.pf2e.feats-srd.Item.ADoFKzCh5z4dXg3f", type: "feat", book: "Pathfinder Lost Omens Divine Mysteries", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "mask-of-the-15th-step": {
        uuid: "Compendium.pf2e.feats-srd.Item.JIjoGVnieAhE3a5f", type: "feat", book: "Pathfinder Lost Omens Divine Mysteries", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "master-merchant": {
        uuid: "Compendium.pf2e.feats-srd.Item.e3YE4uKIyDc2uNXl", type: "feat", book: "Pathfinder Lost Omens Shining Kingdoms", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "master-of-apprentice": {
        uuid: "Compendium.pf2e.feats-srd.Item.HBosqD4ijMVTflCt", type: "feat", book: "Pathfinder Lost Omens Highhelm", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "master-scroll-cache": {
        uuid: "Compendium.pf2e.feats-srd.Item.lIg5Gzz7W70jfbk1", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "medical-researcher": {
        uuid: "Compendium.pf2e.feats-srd.Item.6GO3dtFJnsNnSwWz", type: "feat", book: "Pathfinder Lost Omens Legends", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "mega-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.mMMIHLVSr8fyvVQL", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:bomb"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "merciful-charm": {
        uuid: "Compendium.pf2e.equipment-srd.Item.C8kQuf7gqpjEDmib", type: "consumable", book: "Pathfinder #176: Lost Mammoth Valley", remaster: false, tier: 4,
        effects: [
            { kind: "correction", consumable: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "missive-mint": {
        uuid: "Compendium.pf2e.equipment-srd.Item.mYfK7M3BhB57LmAl", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: its Identify Alchemy DC is the creator's class DC with Powerful Alchemy (a DC stamp outside any daily pool), and the
        // creator may record a short message while making it (like a missive, M9).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "monster-crafting": {
        uuid: "Compendium.pf2e.feats-srd.Item.kajI2r9RmtW5xYL7", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "skillSubstitution", skill: "survival", when: { all: ["material:monster"] } },
            { kind: "rateLevel", source: "monster", when: { all: ["material:monster"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "morning-side-dishes": {
        uuid: "Compendium.pf2e.feats-srd.Item.g2qwr5maymONJAVI", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "munitions-crafter": {
        uuid: "Compendium.pf2e.feats-srd.Item.lFVqejlf52cdYrZy", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [
            { kind: "formulaAllowance", on: "gain", uuids: ["Compendium.pf2e.equipment-srd.Item.AOOQJfSkTPiSzfB9"] },
            { kind: "formulaAllowance", on: "gain", count: 4, maxLevel: 1, rarity: ["common", "uncommon"], filter: { all: ["item:trait:alchemical"], any: ["item:trait:bomb", "item:type:ammo"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "munitions-machinist": {
        uuid: "Compendium.pf2e.feats-srd.Item.lh3STEvbGnP7jVMr", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [
            { kind: "vialSource", regain: false },
        ],
        relies: [
            { key: "SpecialResource", match: { slug: "versatile-vials" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "muse": {
        uuid: "Compendium.pf2e.adventure-specific-actions.Item.YOUQFLtfYIbDPO60", type: "action", book: "Pathfinder Treasure Vault", remaster: true, tier: 2,
        // Note: an item bonus to Crafting or Performance, the holder's choice, by relic level; the module reads neither.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "mutagenist": {
        uuid: "Compendium.pf2e.classfeatures.Item.tvdb1jkjl2bRZjSp", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 2, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical", "item:trait:mutagen"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "named-artillery": {
        uuid: "Compendium.pf2e.feats-srd.Item.7WBIXGqZbAKbqEU6", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "natural-mutagen": {
        uuid: "Compendium.pf2e.feats-srd.Item.UBAARc8Zo3Gzfhul", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "naturalist": {
        uuid: "Compendium.pf2e.pathfinder-society-boons.Item.0FwLrQb5EeQDAUNW", type: "feat", book: "", remaster: false, tier: 4,
        // Note: PFS boon, bought per item; that item may be crafted with Nature, Survival or Herbalism Lore and 2 setup days. No
        // ChoiceSet names the item, so a `skillSubstitution` has nothing to key on.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "nocticula-minor-boon": {
        uuid: "Compendium.pf2e.boons-and-curses.Item.0bM6m3Gx8Th3NxXp", type: "feat", book: "Pathfinder Lost Omens Gods & Magic", remaster: false, tier: 4,
        // Note: once, a failed Crafting check under the night sky becomes a critical success.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "nosois-mask": {
        uuid: "Compendium.pf2e.feats-srd.Item.wEtN2NkqW4z4GUON", type: "feat", book: "Pathfinder Lost Omens Ancestry Guide", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "nudge-the-odds": {
        uuid: "Compendium.pf2e.spells-srd.Item.QjdvYC1QkpMaemoX", type: "spell", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        // Note: kept up at 5th rank, its effect (spell-effects lTL5VwNrZ5xiitGV, behind its own toggle) may apply to a downtime
        // Earn Income check with Games Lore, an exception to the activated-bonus guardrail (6.10).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "numbing-spice-exhalation": {
        uuid: "Compendium.pf2e.feats-srd.Item.vsibRIwbWoG37tuC", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:tag:alchemical-food"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "overloaded-ammunition": {
        uuid: "Compendium.pf2e.feats-srd.Item.UWltFMJPs5negJrx", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "pact-of-infernal-prowess": {
        uuid: "Compendium.pf2e.feats-srd.Item.ztxbGySxIEeWvsAT", type: "feat", book: "Pathfinder Dark Archive (Remastered)", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "palette-of-masterstrokes": {
        uuid: "Compendium.pf2e.equipment-srd.Item.ZCWhnOmij4AFaytj", type: "equipment", book: "Pathfinder Kingmaker", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "paradigm-cube": {
        uuid: "Compendium.pf2e.equipment-srd.Item.zZwpFG8FY0Qwgz7e", type: "equipment", book: "Pathfinder #219: Lord of the Trinity Star", remaster: true, tier: 2,
        // Note: its Craft Requirements need a mythic arcane caster with mythic Crafting proficiency, beyond G3: a `gate`.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "peerless-inventor": {
        uuid: "Compendium.pf2e.classfeatures.Item.JH6um0St37UrjLNG", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "pei-zing-adept": {
        uuid: "Compendium.pf2e.feats-srd.Item.EmIV9haKFrBRB43E", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "pernicious-poison": {
        uuid: "Compendium.pf2e.feats-srd.Item.cZED3aBrjCgO0dPC", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:poison"] } },
            { kind: "afflictionModifier", mod: "pernicious-poison", as: "additive" },
        ],
        verified: "pf2e-8.6.1",
    },
    "perpetual-infusions": {
        uuid: "Compendium.pf2e.classfeatures.Item.ZqwHAoIZrI1dGoqK", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-infusions-bomber": {
        uuid: "Compendium.pf2e.classfeatures.Item.DFQDtT1Van4fFEHi", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-infusions-chirurgeon": {
        uuid: "Compendium.pf2e.classfeatures.Item.fzvIe6FwwCuIdnjX", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-infusions-mutagenist": {
        uuid: "Compendium.pf2e.classfeatures.Item.Dug1oaVYejLmYEFt", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-infusions-toxicologist": {
        uuid: "Compendium.pf2e.classfeatures.Item.LlZ5R50z9j8jysZL", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-perfection-bomber": {
        uuid: "Compendium.pf2e.classfeatures.Item.xO90iBD8XNGyaCkz", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-perfection-chirurgeon": {
        uuid: "Compendium.pf2e.classfeatures.Item.YByJ9O7oe8wxfbqs", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-perfection-mutagenist": {
        uuid: "Compendium.pf2e.classfeatures.Item.CGetAmSbv06fW7GT", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-perfection-toxicologist": {
        uuid: "Compendium.pf2e.classfeatures.Item.3R19zS7gERhEX87F", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-potency-bomber": {
        uuid: "Compendium.pf2e.classfeatures.Item.8rEVg03QJ71ic3PP", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-potency-chirurgeon": {
        uuid: "Compendium.pf2e.classfeatures.Item.VS5vkqUQu4n7E28Y", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-potency-mutagenist": {
        uuid: "Compendium.pf2e.classfeatures.Item.mZFqRLYOQEqKA8ri", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "perpetual-potency-toxicologist": {
        uuid: "Compendium.pf2e.classfeatures.Item.JOdbVu14phvdjhaY", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "persistent-mutagen": {
        uuid: "Compendium.pf2e.feats-srd.Item.GKP2dHkgQw1o0k8g", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "expiryRule", rule: "uncapped", when: { all: ["item:trait:mutagen"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "pheromone-flare-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.p2bU2w6qbtgrBchc", type: "consumable", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        // Note: as animal-pheromones-greater: one formula covers every common animal, not the uncommon ones.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "pheromone-flare-lesser": {
        uuid: "Compendium.pf2e.equipment-srd.Item.5QuImSHXH5QTDju1", type: "consumable", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        // Note: as pheromone-flare-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "pheromone-flare-moderate": {
        uuid: "Compendium.pf2e.equipment-srd.Item.1AxZlZmCuOK3NtVs", type: "consumable", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        // Note: as pheromone-flare-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "philosophers-extractor": {
        uuid: "Compendium.pf2e.equipment-srd.Item.mH3LImCgJAkfKAA3", type: "equipment", book: "Pathfinder GM Core", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["alchemists-lab"] },
            { kind: "rollOptions", options: ["action:craft:alchemical"], when: { all: ["item:trait:alchemical"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:craft:alchemical"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "pinpoint-poisoner": {
        uuid: "Compendium.pf2e.feats-srd.Item.XtIPmZ3Ihq5NJHP2", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "afflictionModifier", mod: "pinpoint-poisoner", as: "deliverer" },
        ],
        verified: "pf2e-8.6.1",
    },
    "plentiful-snares": {
        uuid: "Compendium.pf2e.feats-srd.Item.wGaxWwJhIXbMJft1", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "poison-coat": {
        uuid: "Compendium.pf2e.feats-srd.Item.eHkMcQQ4ejRAFJAt", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "poison-weapon": {
        uuid: "Compendium.pf2e.feats-srd.Item.ALbosSUygdq4T1Yk", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "poisoned-sticks-and-stones": {
        uuid: "Compendium.pf2e.feats-srd.Item.U3YVN5oOd4mf18ry", type: "feat", book: "Pathfinder Battlecry!", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "poisoner-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.y7DDs03GtDnmhxFp", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "potent-poisoner": {
        uuid: "Compendium.pf2e.feats-srd.Item.zKL1lRcIbFblp2M2", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [
            { kind: "afflictionModifier", mod: "potent-poisoner", as: "creator" },
        ],
        verified: "pf2e-8.6.1",
    },
    "powerful-alchemy": {
        uuid: "Compendium.pf2e.classfeatures.Item.7JK2a1D3VeWDcObo", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "afflictionModifier", mod: "powerful-alchemy", as: "creator" },
        ],
        relies: [
            { key: "AdjustModifier", match: { selector: "inline-dc", predicate: ["item:trait:infused"], mode: "upgrade" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "practical-magic": {
        uuid: "Compendium.pf2e.feats-srd.Item.3jJw8NKK9oM77qVZ", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        effects: [
            { kind: "virtualFormulaList", filter: { all: ["item:trait:catalyst"] }, rarity: ["common"], maxLevel: "level" },
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "precious-munitions": {
        uuid: "Compendium.pf2e.feats-srd.Item.vxDL78Yz0dPZdAJ5", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "prepare-elemental-medicine": {
        uuid: "Compendium.pf2e.feats-srd.Item.NMbOfl885pn0Yzu9", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "preternatural-polish": {
        uuid: "Compendium.pf2e.feats-srd.Item.xuZFUOkkjHg9mrcI", type: "feat", book: "Pathfinder Claws of the Tyrant", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "quick-alchemy": {
        uuid: "Compendium.pf2e.classfeatures.Item.sPtl05wwTpqFI0lL", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "quick-alchemy@action": {
        uuid: "Compendium.pf2e.actionspf2e.Item.yzNJgwzV9XqEhKc6", type: "action", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        // The action's CraftingAbility merges with the class feature's; alchemy.mjs reads that ability. Keyed apart from the
        // class feature, which shares the slug.
        effects: [],
        relies: [
            { key: "CraftingAbility", match: { slug: "quick-alchemy", resource: "versatile-vials" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "quick-bomber": {
        uuid: "Compendium.pf2e.feats-srd.Item.xbg1scOIT7RI9Fij", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "quickBomber" },
        ],
        verified: "pf2e-8.6.1",
    },
    "quick-fix": {
        uuid: "Compendium.pf2e.feats-srd.Item.RlhvppSmQRqL2RUe", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "quick-setup": {
        uuid: "Compendium.pf2e.feats-srd.Item.bcEI0iIFhZXqjoaR", type: "feat", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 1,
        effects: [
            { kind: "variantOnly", variant: "complexCrafting" },
        ],
        verified: "pf2e-8.6.1",
    },
    "quick-snares": {
        uuid: "Compendium.pf2e.feats-srd.Item.KW6K5Zv4J7ClWkKA", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "quick-study": {
        uuid: "Compendium.pf2e.feats-srd.Item.aLJsBBZzlUK3G8MW", type: "feat", book: "Pathfinder Advanced Player's Guide", remaster: false, tier: 4,
        // Note: trained in a Lore of the holder's choice until the next preparations, with no rule element: an Earn Income job in
        // it is refused as untrained unless the rank is set by hand.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "quick-tincture": {
        uuid: "Compendium.pf2e.actionspf2e.Item.QHFMeJGzFWj2QczA", type: "action", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        // Note: a versatile-vials CraftingAbility like Quick Alchemy's (7.1); nothing in the module makes items with it yet.
        effects: [],
        relies: [
            { key: "CraftingAbility", match: { slug: "quick-tincture", resource: "versatile-vials" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "rapid-affixture": {
        uuid: "Compendium.pf2e.feats-srd.Item.x9xA8P2Vlz98He7C", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "razmiran-priest-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.uyWVFB0mHDhajYeT", type: "feat", book: "Pathfinder Lost Omens Divine Mysteries", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "reconfigure": {
        uuid: "Compendium.pf2e.classfeatures.Item.J46wcNqKXvtokBD1", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "recycled-cogwheels": {
        uuid: "Compendium.pf2e.feats-srd.Item.WmSggxmf4iAe2aRD", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "red-hands-satchel": {
        uuid: "Compendium.pf2e.equipment-srd.Item.EoDLnd7KTtVL8mGp", type: "backpack", book: "Pathfinder #206: Bring the House Down", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "regional-specialty": {
        uuid: "Compendium.pf2e.feats-srd.Item.l1I6bmdm31MPwmWU", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "repair-toolkit": {
        uuid: "Compendium.pf2e.equipment-srd.Item.vLGDUFrg4yGzpTQX", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "toolSubstitution", tools: ["repair-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "repair-toolkit-superb": {
        uuid: "Compendium.pf2e.equipment-srd.Item.aDsdYMPpVc8hOnM5", type: "equipment", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "toolSubstitution", tools: ["repair-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "repurposed-parts": {
        uuid: "Compendium.pf2e.feats-srd.Item.UJcQgQpZRqXBw0Nb", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "research-field": {
        uuid: "Compendium.pf2e.classfeatures.Item.cU2ofQLj7pg6wTSi", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "reverse-engineer": {
        uuid: "Compendium.pf2e.feats-srd.Item.Na1qfHd6AFAXoN1A", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:reverse-engineer"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "reverse-engineering": {
        uuid: "Compendium.pf2e.feats-srd.Item.f0s3WwaJN5f2UTYY", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "setupDays", days: 1, when: { all: ["route:reverse-engineer"] } },
            { kind: "modifier", slug: "reverse-engineering", type: "circumstance", value: 2, when: { all: ["route:reverse-engineer"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "ring-of-maniacal-devices": {
        uuid: "Compendium.pf2e.equipment-srd.Item.nLvP7U50hLqz26Uy", type: "equipment", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "rollOptions", options: ["snare"], when: { all: ["item:trait:snare"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: [{ or: ["action:craft", "action:repair"] }, { or: ["snare", "trap"] }] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "ring-of-maniacal-devices-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.Wkm2VYPsfGjWBtQe", type: "equipment", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "rollOptions", options: ["snare"], when: { all: ["item:trait:snare"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: [{ or: ["action:craft", "action:repair"] }, { or: ["snare", "trap"] }] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "rivethun-disciple": {
        uuid: "Compendium.pf2e.feats-srd.Item.lLZ9B0KeMDf3BNuA", type: "feat", book: "Pathfinder Lost Omens Highhelm", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "root-magic": {
        uuid: "Compendium.pf2e.feats-srd.Item.22P7IFyhrF7Fbw8B", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "dailies" },
        ],
        verified: "pf2e-8.6.1",
    },
    "rune-singer": {
        uuid: "Compendium.pf2e.feats-srd.Item.tuIvSHCAGGehBOtM", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        effects: [
            { kind: "skillSubstitution", skill: "performance", when: { any: ["craft-type:rune-etch", "craft-type:rune-transfer"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "runes": {
        uuid: "Compendium.pf2e.classfeatures.Item.nTI9tKJ2yriFFL3h", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "runescribed-disk": {
        uuid: "Compendium.pf2e.equipment-srd.Item.p070A88bOm8gi0sS", type: "consumable", book: "Pathfinder #176: Lost Mammoth Valley", remaster: false, tier: 4,
        effects: [
            { kind: "correction", consumable: true },
        ],
        verified: "pf2e-8.6.1",
    },
    "runesmith-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.q80NDr8pDhyCyyAl", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "runic-crafter": {
        uuid: "Compendium.pf2e.classfeatures.Item.SQSq8uyENctclqew", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        effects: [
            { kind: "virtualFormulaList", filter: { any: ["item:slug:weapon-potency-1", "item:slug:weapon-potency-2", "item:slug:weapon-potency-3", "item:slug:striking", "item:slug:striking-greater", "item:slug:striking-major", "item:slug:armor-potency-1", "item:slug:armor-potency-2", "item:slug:armor-potency-3", "item:slug:resilient", "item:slug:resilient-greater", "item:slug:resilient-major", "item:slug:reinforcing-rune-minor", "item:slug:reinforcing-rune-lesser", "item:slug:reinforcing-rune-moderate", "item:slug:reinforcing-rune-greater", "item:slug:reinforcing-rune-major", "item:slug:reinforcing-rune-supreme"] }, maxLevel: "level" },
            { kind: "formulaAllowance", on: "level", levels: [4, 6, 8, 10, 12, 14, 16, 18, 20], count: 1, maxLevel: "level", filter: { any: ["item:usage:etched-onto-a-weapon", "item:usage:etched-onto-armor", "item:usage:etched-onto-heavy-armor", "item:usage:etched-onto-light-armor", "item:usage:etched-onto-metal-armor", "item:usage:etched-onto-clan-dagger", "item:usage:etched-onto-lm-nonmetal-armor", "item:usage:etched-onto-med-heavy-armor", "item:usage:etched-onto-medium-heavy-metal-armor", "item:usage:etched-onto-bludgeoning-weapon", "item:usage:etched-onto-melee-weapon", "item:usage:etched-onto-slashing-melee-weapon", "item:usage:etched-onto-piercing-or-slashing-melee-weapon", "item:usage:etched-onto-piercing-or-slashing-weapon", "item:usage:etched-onto-weapon-wo-unholy-rune", "item:usage:etched-onto-weapon-wo-holy-rune", "item:usage:etched-onto-melee-weapon-monk", "item:usage:etched-onto-thrown-weapon"], not: ["item:slug:weapon-potency-1", "item:slug:weapon-potency-2", "item:slug:weapon-potency-3", "item:slug:striking", "item:slug:striking-greater", "item:slug:striking-major", "item:slug:armor-potency-1", "item:slug:armor-potency-2", "item:slug:armor-potency-3", "item:slug:resilient", "item:slug:resilient-greater", "item:slug:resilient-major", "item:slug:reinforcing-rune-minor", "item:slug:reinforcing-rune-lesser", "item:slug:reinforcing-rune-moderate", "item:slug:reinforcing-rune-greater", "item:slug:reinforcing-rune-major", "item:slug:reinforcing-rune-supreme"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "runic-tattoo": {
        uuid: "Compendium.pf2e.feats-srd.Item.r3fOPLERrcog5X6J", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "s1-08-river-kingdoms-politician": {
        uuid: "Compendium.pf2e.pathfinder-society-boons.Item.lJ1lNwGxV0IrsN2z", type: "feat", book: "", remaster: false, tier: 4,
        // Note: PFS boon: a few Earn Income tasks above the PFS level cap, which the module does not apply (6.10).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "s1-q06-secrets-of-the-jistkan-alchemists": {
        uuid: "Compendium.pf2e.pathfinder-society-boons.Item.MLn6UbZsU4PphXLE", type: "feat", book: "", remaster: false, tier: 4,
        // Note: PFS boon: twice, after the roll, an alchemical Craft's degree may be raised by one; manual and counted, so not a
        // `degreeShift`.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "schematic-scanner": {
        uuid: "Compendium.pf2e.equipment-srd.Item.0X1s1F8HmEXu3vEj", type: "equipment", book: "Pathfinder #215: To Blot Out the Sun", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "scroll-adept": {
        uuid: "Compendium.pf2e.feats-srd.Item.u5DBg0LrBUKP0JsJ", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "dailies" },
        ],
        verified: "pf2e-8.6.1",
    },
    "scroll-esoterica": {
        uuid: "Compendium.pf2e.feats-srd.Item.OqObuRB8oVSAEKFR", type: "feat", book: "Pathfinder Dark Archive (Remastered)", remaster: true, tier: 3,
        effects: [
            { kind: "dailyGap", flow: "dailies" },
        ],
        verified: "pf2e-8.6.1",
    },
    "scrounger-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.CaeCSWFWytWv8Fgu", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "toolSubstitution", tools: ["alchemists-lab", "artisans-toolkit", "snare-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "seasoned": {
        uuid: "Compendium.pf2e.feats-srd.Item.1Eceqc6zbMj2x0q9", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1,
        effects: [
            { kind: "rollOptions", options: ["item:tag:food"], when: { all: ["item:tag:alchemical-food"] } },
            { kind: "rollOptions", options: ["item:tag:drink"], when: { all: ["item:trait:tea"] } },
        ],
        relies: [
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:craft", { or: ["item:tag:food", "item:tag:drink", { and: ["feat:magical-crafting", "item:trait:potion"] }, { and: ["feat:alchemical-crafting", "item:trait:elixir"] }] }] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "shelyn-moderate-boon": {
        uuid: "Compendium.pf2e.boons-and-curses.Item.zoJjzir97Ie7tbp0", type: "feat", book: "Pathfinder Lost Omens Gods & Magic", remaster: false, tier: 4,
        // Specialty Crafting in every trade, with no rule element: its bonus on every Craft. A held Specialty Crafting's bonus is
        // also circumstance, so the two do not stack.
        effects: [
            { kind: "modifier", slug: "specialty-crafting", type: "circumstance", value: 1, atRank: { skill: "crafting", rank: 3, value: 2 }, when: { not: ["craft-type:deconstruct", "craft-type:quest"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "shelyns-grace": {
        uuid: "Compendium.pf2e.adventure-specific-actions.Item.8Ze3B6HWu2fyKETM", type: "action", book: "Pathfinder Adventure Path: Bastion of Blasphemies", remaster: true, tier: 2,
        // Note: a room's statue gives an item bonus to Crafting checks there for hours; the GM applies it.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "skilled-herbalist": {
        uuid: "Compendium.pf2e.feats-srd.Item.zR2jp5tcb8GjnR3v", type: "feat", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        effects: [
            { kind: "skillSubstitution", skill: "nature", when: { all: ["item:trait:alchemical", "item:trait:healing"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "smoke-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.ODnXQHvFoK7tIVpu", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:bomb"] }, toggle: { domain: "attack-roll", option: "smoke-bomb" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "snare-crafting": {
        uuid: "Compendium.pf2e.feats-srd.Item.DMetdzt1VJL2Y62i", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 4, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:snare"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "snare-expert": {
        uuid: "Compendium.pf2e.feats-srd.Item.BTE7BTAwnw2O5fz3", type: "feat", book: "Pathfinder Battlecry!", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "snare-genius": {
        uuid: "Compendium.pf2e.feats-srd.Item.8DIzXO1YpsU3DpJw", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "snare-setter": {
        uuid: "Compendium.pf2e.feats-srd.Item.eMmdBpbMrpIuGowo", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "craftUnlock", access: { all: ["item:trait:snare", "item:trait:kobold", "item:rarity:uncommon"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "snare-specialist": {
        uuid: "Compendium.pf2e.feats-srd.Item.0haS0qXR9xTYKoTG", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "snarecrafter-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.4MUbwilvb9dI0X59", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "formulaAllowance", on: "rank", skill: "crafting", ranks: [2, 3, 4], count: 3, maxLevel: "level", rarity: ["common"], filter: { all: ["item:trait:snare"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "soothing-powder-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.4hJDqukTYPMZv2vg", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as bane-ammunition-greater: each persistent-damage type is its own formula.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "soothing-powder-lesser": {
        uuid: "Compendium.pf2e.equipment-srd.Item.OymrUAv6RGFaI1nm", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Note: as soothing-powder-greater.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "sour-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.Q9PR9achVS7aUDDt", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:bomb"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "sparkler": {
        uuid: "Compendium.pf2e.equipment-srd.Item.hd8D1Dm6aVhMYpEL", type: "consumable", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        // Uncommon, open to those who can Craft fireworks: the access grant is on firework-technician-dedication.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "specialty-crafting": {
        uuid: "Compendium.pf2e.feats-srd.Item.QLeMH5mQgh28sa5o", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 1, choice: "specialtyCrafting",
        effects: [
            { kind: "rollOptions", options: ["{choice}"], when: { all: ["specialty:{choice}"] } },
        ],
        relies: [
            { key: "ChoiceSet", match: { flag: "specialtyCrafting" } },
            { key: "FlatModifier", match: { selector: "crafting", predicate: ["action:craft", "{item|flags.system.rulesSelections.specialtyCrafting}"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "spell-effect-garden-of-death-critical-success": {
        uuid: "Compendium.pf2e.spell-effects.Item.5xCheSMgtQhQZm00", type: "effect", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        // Its Crafting bonus predicates `dealWithGardenOfDeath`, for tending the garden, never a Craft, so the wrapper never sets
        // it; listed here because the validator fails an ignored item with a bare Crafting option.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "spell-effect-traveling-workshop": {
        uuid: "Compendium.pf2e.spell-effects.Item.qXWCvqt24iczeN8V", type: "effect", book: "Pathfinder War of Immortals", remaster: true, tier: 2,
        // On the actor only while the spell lasts, so the spell's crafting rules hang here: a lab (and a forge, a G7 checklist
        // item), Repair tools, and a day of setup counted as done (2 -> 1 without the formula; 1 -> 0 with it waits on setupPlan).
        // Not automated: no Earn Income with its rank (a `gate`), and items made vanish once they leave the crafter.
        effects: [
            { kind: "toolSubstitution", tools: ["alchemists-lab"] },
            { kind: "toolSubstitution", tools: ["repair-toolkit"], when: { all: ["action:repair"] } },
            { kind: "setupDays", days: 1, when: { all: ["route:none"], not: ["craft-type:grow", "craft-type:deconstruct", "craft-type:quest"] } },
        ],
        relies: [
            { key: "ActiveEffectLike", match: { path: "system.skills.crafting.rank" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "staff-nexus": {
        uuid: "Compendium.pf2e.classfeatures.Item.Klb35AwlkNrq1gpB", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "starless-scope": {
        uuid: "Compendium.pf2e.equipment-srd.Item.TYdFnzhhTlpUdtty", type: "equipment", book: "Pathfinder Adventure: Malevolence", remaster: false, tier: 4,
        // Note: its formula lets the crafter Craft a starless-scope-lens.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "starless-scope-lens": {
        uuid: "Compendium.pf2e.equipment-srd.Item.QRtsLdNvTs2C1oI2", type: "equipment", book: "Pathfinder Adventure: Malevolence", remaster: false, tier: 4,
        // Note: crafted with the scope's formula, at a fixed DC and master rank; neither a cross-item formula route nor a product
        // DC has an effect kind.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "starstone-aspirant-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.2tF5kSGaSEmhQg1i", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 2,
        // Note: a skill picked each daily preparation may be used untrained for trained actions (Craft, G1; Earn Income with a
        // Lore). pf2e's effect (feat-effects XBJzkEhL6MidoT3o) applies only the bonus; waiving the rank needs a `gate`.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "sticky-bomb": {
        uuid: "Compendium.pf2e.feats-srd.Item.zXKfKKOxht0b0XNL", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:bomb"] }, toggle: { domain: "alchemical-bomb-base-type-damage", option: "sticky-bomb" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "sticky-poison": {
        uuid: "Compendium.pf2e.feats-srd.Item.b7isszc8C75V3okn", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "afflictionModifier", mod: "sticky-poison", as: "deliverer" },
        ],
        verified: "pf2e-8.6.1",
    },
    "storied-talent": {
        uuid: "Compendium.pf2e.pathfinder-society-boons.Item.M1flDLvjKBH9QPcx", type: "feat", book: "", remaster: false, tier: 4,
        // Note: PFS boon: Earn Income at the earner's own level instead of the PFS cap, which the module does not apply (6.10).
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "strikers-scroll": {
        uuid: "Compendium.pf2e.feats-srd.Item.Gz9NQBjSDRQP8YTY", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "sun-orchid-elixir": {
        uuid: "Compendium.pf2e.equipment-srd.Item.P9dhnMcr3lbHBn2E", type: "consumable", book: "Pathfinder Lost Omens World Guide", remaster: false, tier: 4,
        // Note: a month to brew and a unique formula; pf2e gives it no Price, so G12 refuses it until the GM prices it.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "surprise-snare": {
        uuid: "Compendium.pf2e.feats-srd.Item.wqrOVv9gnqF4nlLR", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "talisman-dabbler-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.1t5479E6bdvFs4E7", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "craftUnlock", category: "talisman" },
            { kind: "virtualFormulaList", filter: { all: ["item:trait:talisman"] }, rarity: ["common"], maxLevel: "level" },
            { kind: "dcStamp", pool: "talisman-dabbler", dcs: ["class", "spell"] },
        ],
        relies: [
            { key: "CraftingAbility", match: { slug: "talisman-dabbler", maxSlots: 2, isDailyPrep: true, craftableItems: ["item:trait:talisman"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "talisman-esoterica": {
        uuid: "Compendium.pf2e.feats-srd.Item.ygCLN0brunmBYtJR", type: "feat", book: "Pathfinder Dark Archive (Remastered)", remaster: true, tier: 2,
        effects: [
            { kind: "virtualFormulaList", filter: { all: ["item:trait:talisman"] }, rarity: ["common"], maxLevel: "level", books: ["Pathfinder GM Core"] },
        ],
        relies: [
            { key: "CraftingAbility", match: { slug: "talisman-esoterica", craftableItems: ["item:trait:talisman"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "talismanic-sage": {
        uuid: "Compendium.pf2e.feats-srd.Item.uPikeCzrTrgzEJT8", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "tattoo-artist": {
        uuid: "Compendium.pf2e.feats-srd.Item.z0HX5L7bOOrKi0dD", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 4, maxLevel: 2, rarity: ["common"], filter: { all: ["item:trait:tattoo", "item:trait:magical"] } },
            { kind: "formulaAllowance", on: "rank", skill: "crafting", ranks: [3], count: 4, maxLevel: 7, rarity: ["common"], filter: { all: ["item:trait:tattoo", "item:trait:magical"] } },
            { kind: "modifier", slug: "tattoo-artist", type: "circumstance", value: 1, atRank: { skill: "crafting", rank: 3, value: 2 }, when: { any: ["item:trait:tattoo", "craft-type:tattoo"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "tattooed-historian-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.oKjyD46NmkKx1OvO", type: "feat", book: "Pathfinder #207: The Resurrection Flood", remaster: true, tier: 2,
        // M9 (6.14): one magical tattoo per two tattooed historian feats does not count against the invest limit; pf2e
        // counts the feats in a flag of their own rule elements.
        effects: [
            { kind: "investitureExempt", per: 2, count: "flags.system.tattooedHistorian.archetypeFeatCount", when: { all: ["item:trait:tattoo"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "tears-of-the-last-azlanti": {
        uuid: "Compendium.pf2e.equipment-srd.Item.2VpuNz8EyXpvUf7P", type: "equipment", book: "Pathfinder #156: The Apocalypse Prophet", remaster: false, tier: 4,
        // Note: one bail is active a day; one makes downtime checks one degree better, another raises the Craft level cap (G2).
        // Nothing records which.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "tenacious-toxins": {
        uuid: "Compendium.pf2e.feats-srd.Item.FdP21jbjHHGpHut1", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "afflictionModifier", mod: "tenacious-toxins", as: "creator" },
        ],
        verified: "pf2e-8.6.1",
    },
    "tengu-weapon-familiarity": {
        uuid: "Compendium.pf2e.feats-srd.Item.AmFv3ClkAVRowHLI", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            // G5: uncommon tengu weapons and the four named swords (pf2e's own MartialProficiency misspells two of the slugs).
            { kind: "craftUnlock", access: { all: ["item:type:weapon", "item:rarity:uncommon"], any: ["item:trait:tengu", "item:slug:katana", "item:slug:khakkhara", "item:slug:temple-sword", "item:slug:wakizashi"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "thespians-calling": {
        uuid: "Compendium.pf2e.classfeatures.Item.CPUunLbsBjRgfS10", type: "feat", book: "Pathfinder War of Immortals", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "toolkit-of-bronze-whispers": {
        uuid: "Compendium.pf2e.equipment-srd.Item.aUohYRQ8lHzgblxi", type: "equipment", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["artisans-toolkit"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "toothwort-extract": {
        uuid: "Compendium.pf2e.equipment-srd.Item.k5A8zFQuDtGqNnk5", type: "consumable", book: "Pathfinder Lost Omens Travel Guide", remaster: false, tier: 4,
        // Note: an additive consumable for Quick Alchemy poisons that lengthens their maximum duration; `additive` is feat-shaped
        // and no affliction mod covers it.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "torags-silver-anvil": {
        uuid: "Compendium.pf2e.equipment-srd.Item.Kmrkm1sHKkGXiJlr", type: "weapon", book: "Pathfinder Lost Omens Gods & Magic", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "toxicologist": {
        uuid: "Compendium.pf2e.classfeatures.Item.P9quO9XZi3OWFe1k", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 2, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical", "item:trait:poison"] } },
            { kind: "afflictionModifier", mod: "toxicologist-acid", as: "creator", when: { all: ["item:trait:infused"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "tradecraft-tattoo": {
        uuid: "Compendium.pf2e.equipment-srd.Item.ImedbomHGVFtE3D7", type: "equipment", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "AdjustDegreeOfSuccess", match: { selector: "crafting", predicate: ["action:earn-income"], adjustment: { criticalFailure: "one-degree-better" } } },
        ],
        verified: "pf2e-8.6.1",
    },
    "tradecraft-tattoo-greater": {
        uuid: "Compendium.pf2e.equipment-srd.Item.0zBuCoOeNkIwi8bj", type: "equipment", book: "Pathfinder Treasure Vault (Remastered)", remaster: true, tier: 2,
        effects: [],
        relies: [
            { key: "AdjustDegreeOfSuccess", match: { selector: "crafting", predicate: ["action:earn-income"], adjustment: { criticalFailure: "one-degree-better" } } },
        ],
        verified: "pf2e-8.6.1",
    },
    "traveling-workshop": {
        uuid: "Compendium.pf2e.spells-srd.Item.rzcXUF5YmJYxgxEa", type: "spell", book: "Pathfinder War of Immortals", remaster: true, tier: 2,
        // Note: the focus spell is always on the animist; its crafting rules are on spell-effect-traveling-workshop, present only
        // while the spell lasts.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "tsukumogami-poppet": {
        uuid: "Compendium.pf2e.heritages.Item.cKgxEWnRVazFPi3M", type: "heritage", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "twilight-talon-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.q8xL4l04rFcc126W", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 2,
        // Note: a Lore picked at each daily preparation is trained (or better) until the next, with no rule element: an Earn
        // Income job in it is refused as untrained unless the rank is set by hand.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "ubiquitous-gadgets": {
        uuid: "Compendium.pf2e.feats-srd.Item.ny0nfGTDUE4p8TtO", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "ubiquitous-snares": {
        uuid: "Compendium.pf2e.feats-srd.Item.bX2WI5k0afqPpCfm", type: "feat", book: "Pathfinder Core Rulebook", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "unassuming-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.A1RzkLCj7mXJI1IY", type: "feat", book: "Pathfinder Lost Omens Character Guide", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "underground-bounty": {
        uuid: "Compendium.pf2e.adventure-specific-actions.Item.ZFM7vgRwRqdNOelg", type: "action", book: "Pathfinder #194: Cult of the Cave Worm", remaster: false, tier: 4,
        // Relic gift: a shard conjured at daily preparations that lasts until the next (7.10's shape).
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "unholy-skill": {
        uuid: "Compendium.pf2e.equipment-srd.Item.BHS27XtpW9icogkz", type: "equipment", book: "Pathfinder Lost Omens Cheliax, Infernal Inheritance", remaster: true, tier: 2,
        // Note: the contract's devil may take an expert Earn Income task's pay once a week; the holder's own income is unchanged.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "unstable-concoction": {
        uuid: "Compendium.pf2e.feats-srd.Item.tY3Zg0l14CdoKPpt", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "additive", when: { all: ["item:trait:consumable"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "versatile-vials": {
        uuid: "Compendium.pf2e.classfeatures.Item.PBQh0amk1FlomV0r", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "vialSource", regain: true },
        ],
        relies: [
            { key: "SpecialResource", match: { slug: "versatile-vials" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "voluminous-vials": {
        uuid: "Compendium.pf2e.feats-srd.Item.soHLtpMM9h3AE7PD", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "wandering-chef-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.9dPz3x6uLCFEB3yK", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["alchemists-lab"], requires: ["cookware"], when: { all: ["item:trait:alchemical", "item:tag:alchemical-food"] } },
            { kind: "vialSource", regain: false },
        ],
        verified: "pf2e-8.6.1",
    },
    "waning-moon-sarangay": {
        uuid: "Compendium.pf2e.heritages.Item.MNeg7vI854rB6fmz", type: "heritage", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "warren-friend": {
        uuid: "Compendium.pf2e.feats-srd.Item.jmW8aZ5JGH3m6dL6", type: "feat", book: "Pathfinder Lost Omens Ancestry Guide", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "warshard-warrior-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.GtohZQvFVZaIQD0S", type: "feat", book: "Pathfinder #219: Lord of the Trinity Star", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "web-weaver": {
        uuid: "Compendium.pf2e.feats-srd.Item.CUrxG9CzT1hSfuhP", type: "feat", book: "Pathfinder Lost Omens The Mwangi Expanse", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "weve-met-before": {
        uuid: "Compendium.pf2e.feats-srd.Item.7tyjUicN4vh5U1zU", type: "feat", book: "Pathfinder War of Immortals", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "winders-ring": {
        uuid: "Compendium.pf2e.equipment-srd.Item.bfJI3xeIWaqcYRlU", type: "equipment", book: "Pathfinder #179: Cradle of Quartz", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "wish-alchemy": {
        uuid: "Compendium.pf2e.feats-srd.Item.TsgW87kYudNr6Bfp", type: "feat", book: "Pathfinder Lost Omens Legends", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "witchs-bottle": {
        uuid: "Compendium.pf2e.feats-srd.Item.oEjRfI4ATIFxDCzL", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
    "witchs-broom": {
        uuid: "Compendium.pf2e.feats-srd.Item.3vleeliKpEIo5Bh6", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [
            { kind: "virtualFormulaList", uuids: ["Compendium.pf2e.equipment-srd.Item.1erd18HS57aCyC6r"] },
        ],
        verified: "pf2e-8.6.1",
    },
    "woodworker": {
        uuid: "Compendium.pf2e.feats-srd.Item.uofXCv2t8C2IRsr0", type: "feat", book: "Pathfinder Rage of Elements", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "worldforge": {
        uuid: "Compendium.pf2e.equipment-srd.Item.Im3tgXhR9W1CGaHo", type: "equipment", book: "Pathfinder War of Immortals", remaster: true, tier: 2,
        // Note: a mythic Crafting activity with GM-set DC and cost in which each day counts as ten and costs a Mythic Point or
        // drained; no effect kind multiplies days or gates on mythic rank.
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "zon-kuthon-moderate-boon": {
        uuid: "Compendium.pf2e.boons-and-curses.Item.QVEkEdxCnoGxMo9l", type: "feat", book: "Pathfinder Lost Omens Gods & Magic", remaster: false, tier: 4,
        // Scars that work as a scroll, formed at each daily preparation (7.10's shape).
        effects: [
            { kind: "dailyGap", flow: "note" },
        ],
        verified: "pf2e-8.6.1",
    },
});
