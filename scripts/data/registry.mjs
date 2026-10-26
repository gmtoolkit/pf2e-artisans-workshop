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
 * - `variantOnly {variant}`: the entry counts only while that variant rule is on.
 * The other kinds of 6.11 (`dcStamp`, `dailyGap`, `vialSource`, `additive`, `expiryRule`, `materialSource`,
 * `gate`, `conflict`, `afflictionModifier`, `delivery`) arrive with the milestones that read them.
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
    "acupuncturist": {
        uuid: "Compendium.pf2e.feats-srd.Item.SC95hfEEHQs7E9cG", type: "feat", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
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
        effects: [],
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
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "annotate-composition": {
        uuid: "Compendium.pf2e.feats-srd.Item.PIVC14saumGNKWbo", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
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
    "bomber": {
        uuid: "Compendium.pf2e.classfeatures.Item.7JbiaZ8bxODM5mzS", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 2, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical", "item:trait:bomb"] } },
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
    "bountiful-cauldron": {
        uuid: "Compendium.pf2e.equipment-srd.Item.MBF9bZCwkJp2RZoN", type: "equipment", book: "Pathfinder #147: Tomorrow Must Burn", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "brastlewark-snare-engineering": {
        uuid: "Compendium.pf2e.feats-srd.Item.OuEIsBtQD1Fgx6Gz", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "broad-snare": {
        uuid: "Compendium.pf2e.feats-srd.Item.VXIfIC7mFHx1Tl7C", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 3,
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
        effects: [],
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
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "city-scavenger": {
        uuid: "Compendium.pf2e.feats-srd.Item.g388ImzpenYBoiEF", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 2,
        effects: [],
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
    "contingency-gadgets": {
        uuid: "Compendium.pf2e.feats-srd.Item.4st3fSYSrJrxwHOP", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [],
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
    "cytillesh-toolkit": {
        uuid: "Compendium.pf2e.equipment-srd.Item.u6pDaIxMIimhQx7X", type: "equipment", book: "Pathfinder Monster Core", remaster: true, tier: 2,
        effects: [
            { kind: "toolSubstitution", tools: ["healers-toolkit"] },
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
    "double-double": {
        uuid: "Compendium.pf2e.feats-srd.Item.wwnhnV3balaVdMu5", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "dreamers-calling": {
        uuid: "Compendium.pf2e.classfeatures.Item.HnUzQqmAphx9nXDt", type: "feat", book: "Pathfinder Revenge of the Runelords Player's Guide", remaster: true, tier: 2,
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
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "elaborate-talisman-esoterica": {
        uuid: "Compendium.pf2e.feats-srd.Item.VO8HbMQ79NULE4FQ", type: "feat", book: "Pathfinder Dark Archive (Remastered)", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "embed-aeon-stone": {
        uuid: "Compendium.pf2e.feats-srd.Item.EZrxp0XxYh9rjghB", type: "feat", book: "Pathfinder Lost Omens Rival Academies", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "endemic-herbs": {
        uuid: "Compendium.pf2e.feats-srd.Item.BQzExsEZrwGsJD66", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 3,
        effects: [],
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
    "firework-technician-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.MVbNnjqQOK9d8Ki3", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [],
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
        effects: [],
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
        effects: [],
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
    "herbal-forager": {
        uuid: "Compendium.pf2e.feats-srd.Item.0EsMqnrmTEQBG65e", type: "feat", book: "Pathfinder Howl of the Wild", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "herbalist-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.5CRt5Dy9eLv5LpRF", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [
            { kind: "skillSubstitution", skill: "nature", when: { all: ["item:trait:alchemical", "item:trait:consumable", "item:trait:healing"] } },
            { kind: "toolSubstitution", tools: ["alchemists-lab"], requires: ["healers-toolkit"], when: { all: ["item:trait:alchemical", "item:trait:consumable", "item:trait:healing"] } },
        ],
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
        effects: [],
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
    "legions-aim": {
        uuid: "Compendium.pf2e.feats-srd.Item.2FqgPiW7B0w9jzXd", type: "feat", book: "Pathfinder Lost Omens Hellfire Dispatches", remaster: true, tier: 2,
        effects: [
            { kind: "craftUnlock", access: { all: ["item:trait:alchemical", "item:trait:bomb", "item:rarity:uncommon"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "lethargy-poisoner": {
        uuid: "Compendium.pf2e.feats-srd.Item.HlSwpxreIfsglTJ8", type: "feat", book: "Pathfinder Battlecry!", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "lightning-snares": {
        uuid: "Compendium.pf2e.feats-srd.Item.4OEZrIefIuIjUDzE", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "living-god": {
        uuid: "Compendium.pf2e.feats-srd.Item.1eXHDDOLZATKpWjL", type: "feat", book: "Pathfinder Lost Omens Divine Mysteries", remaster: true, tier: 2,
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
    "merciful-charm": {
        uuid: "Compendium.pf2e.equipment-srd.Item.C8kQuf7gqpjEDmib", type: "consumable", book: "Pathfinder #176: Lost Mammoth Valley", remaster: false, tier: 4,
        effects: [
            { kind: "correction", consumable: true },
        ],
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
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "nosois-mask": {
        uuid: "Compendium.pf2e.feats-srd.Item.wEtN2NkqW4z4GUON", type: "feat", book: "Pathfinder Lost Omens Ancestry Guide", remaster: false, tier: 4,
        effects: [],
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
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "poisoner-dedication": {
        uuid: "Compendium.pf2e.feats-srd.Item.y7DDs03GtDnmhxFp", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 2,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "powerful-alchemy": {
        uuid: "Compendium.pf2e.classfeatures.Item.7JK2a1D3VeWDcObo", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [],
        relies: [
            { key: "AdjustModifier", match: { selector: "inline-dc", predicate: ["item:trait:infused"], mode: "upgrade" } },
        ],
        verified: "pf2e-8.6.1",
    },
    "practical-magic": {
        uuid: "Compendium.pf2e.feats-srd.Item.3jJw8NKK9oM77qVZ", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
        effects: [
            { kind: "virtualFormulaList", filter: { all: ["item:trait:catalyst"] }, rarity: ["common"], maxLevel: "level" },
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
        effects: [],
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
    "repurposed-parts": {
        uuid: "Compendium.pf2e.feats-srd.Item.UJcQgQpZRqXBw0Nb", type: "feat", book: "Pathfinder Guns & Gears", remaster: true, tier: 3,
        effects: [],
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
        effects: [],
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
            { kind: "formulaAllowance", on: "level", levels: [4, 6, 8, 10, 12, 14, 16, 18, 20], count: 1, maxLevel: "level", filter: { any: ["item:usage:etched-onto-a-weapon", "item:usage:etched-onto-armor"], not: ["item:slug:weapon-potency-1", "item:slug:weapon-potency-2", "item:slug:weapon-potency-3", "item:slug:striking", "item:slug:striking-greater", "item:slug:striking-major", "item:slug:armor-potency-1", "item:slug:armor-potency-2", "item:slug:armor-potency-3", "item:slug:resilient", "item:slug:resilient-greater", "item:slug:resilient-major", "item:slug:reinforcing-rune-minor", "item:slug:reinforcing-rune-lesser", "item:slug:reinforcing-rune-moderate", "item:slug:reinforcing-rune-greater", "item:slug:reinforcing-rune-major", "item:slug:reinforcing-rune-supreme"] } },
        ],
        verified: "pf2e-8.6.1",
    },
    "runic-tattoo": {
        uuid: "Compendium.pf2e.feats-srd.Item.r3fOPLERrcog5X6J", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 3,
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
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "scroll-esoterica": {
        uuid: "Compendium.pf2e.feats-srd.Item.OqObuRB8oVSAEKFR", type: "feat", book: "Pathfinder Dark Archive (Remastered)", remaster: true, tier: 3,
        effects: [],
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
    "skilled-herbalist": {
        uuid: "Compendium.pf2e.feats-srd.Item.zR2jp5tcb8GjnR3v", type: "feat", book: "Pathfinder Howl of the Wild", remaster: true, tier: 2,
        effects: [
            { kind: "skillSubstitution", skill: "nature", when: { all: ["item:trait:alchemical", "item:trait:healing"] } },
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
    "staff-nexus": {
        uuid: "Compendium.pf2e.classfeatures.Item.Klb35AwlkNrq1gpB", type: "feat", book: "Pathfinder Player Core", remaster: true, tier: 3,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "strikers-scroll": {
        uuid: "Compendium.pf2e.feats-srd.Item.Gz9NQBjSDRQP8YTY", type: "feat", book: "Pathfinder Impossible Magic", remaster: true, tier: 2,
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
        effects: [],
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
    "torags-silver-anvil": {
        uuid: "Compendium.pf2e.equipment-srd.Item.Kmrkm1sHKkGXiJlr", type: "weapon", book: "Pathfinder Lost Omens Gods & Magic", remaster: false, tier: 4,
        effects: [],
        verified: "pf2e-8.6.1",
    },
    "toxicologist": {
        uuid: "Compendium.pf2e.classfeatures.Item.P9quO9XZi3OWFe1k", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [
            { kind: "formulaAllowance", on: "gain", count: 2, maxLevel: 1, rarity: ["common"], filter: { all: ["item:trait:alchemical", "item:trait:poison"] } },
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
    "tsukumogami-poppet": {
        uuid: "Compendium.pf2e.heritages.Item.cKgxEWnRVazFPi3M", type: "heritage", book: "Pathfinder Lost Omens Tian Xia Character Guide", remaster: true, tier: 2,
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
    "versatile-vials": {
        uuid: "Compendium.pf2e.classfeatures.Item.PBQh0amk1FlomV0r", type: "feat", book: "Pathfinder Player Core 2", remaster: true, tier: 1,
        effects: [],
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
        effects: [],
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
});
