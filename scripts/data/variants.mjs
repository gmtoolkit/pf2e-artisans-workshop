/**
 * Treasure Vault (Remastered) crafting variants (DESIGN.md 6.16): numbers only (P9). Every table is cited by book and page;
 * event names, critical examples and quest text stay in the book. Table 5-1 (Complex Crafting setup) is in
 * `complex-crafting.mjs`, which M1 built.
 */

/**
 * The three groups of variants the chapter defines (TV-R p.157): the crafting alternate rules, nature crafting and
 * story-based crafting. The book advises adding one subsection at a time; Settings says so when more than one group is
 * on (6.16, "One group at a time"). Keys are the `variants` keys of `DEFAULT_RULES`.
 */
export const VARIANT_GROUPS = Object.freeze({
    alternate: Object.freeze(["complexCrafting", "adjustments", "events", "criticalCrafting", "deconstruct"]),
    nature: Object.freeze(["grow", "gardens", "gifts"]),
    story: Object.freeze(["quests"]),
});

/** Rushed finishing (TV-R p.158): each rushed day reduces the remainder by this many times the Income Earned amount. */
export const RUSH_FINISH_MULTIPLIER = 2;
/** Rushed finishing's flat check (TV-R p.158): DC = this + the item's level − the crafter's Crafting proficiency bonus. */
export const RUSH_FLAT_BASE = 10;

/** Crafting downtime events (TV-R p.159, Table 5-2): a d20; 1-3 select an event from the GM Core, 4-20 the table's own. */
export const EVENT_DIE = 20;
export const EVENT_GM_CORE_MAX = 3;

/**
 * Deconstruct (TV-R p.162): the share of the deconstructed item's cost that can be applied to a new item, in percent, by
 * purpose and degree of success (2 success, 3 critical success).
 */
export const DECONSTRUCT_PCT = Object.freeze({
    similar: Object.freeze({ 2: 75, 3: 80 }),
    raw: Object.freeze({ 2: 50, 3: 55 }),
});
/** Deconstruct (TV-R p.162): a damaged item deconstructed again without repair loses this share of its value, in percent. */
export const DECONSTRUCT_LOSS_PCT = 5;
/** Share of a components line a critical failure of the Craft ruins, with the rest of the materials (Player Core p.237). */
export const COMPONENTS_RUIN_PCT = 10;

/** Grow (TV-R p.165): days at work before the check, with or without a formula, never rushed. */
export const GROW_SETUP_DAYS = 4;

/**
 * GM Core p.133, Table 2-19 (Permanent Magic Item Price): the top of each level's price range, levels 1-20, in cp.
 * A garden of wonder costs the top of the range for a permanent item 2 levels above its consumable (TV-R p.167).
 */
export const PERMANENT_PRICE_MAX = Object.freeze([
    2000, 3500, 6000, 10000, 16000, 25000, 36000, 50000, 70000, 100000,
    140000, 200000, 300000, 450000, 650000, 1000000, 1500000, 2400000, 4000000, 7000000,
]);
/** Gardens of Wonder (TV-R p.167): the seed cost is that of a permanent item this many levels above the product. */
export const GARDEN_LEVELS_ABOVE = 2;
/** Gardens of Wonder (TV-R p.167): at most half the party's PCs (rounded down) in gardens. */
export const GARDEN_PCS_PER_GARDEN = 2;

/** Crafting quests (TV-R p.172): each required encounter takes this share of the Price off, in percent... */
export const QUEST_REDUCTION_PCT = 10;
/** ...never below this share of it (TV-R p.172). */
export const QUEST_FLOOR_PCT = 50;
/** Crafting quests (TV-R p.172): a quest of at least this many encounters in different locations needs no assembly check. */
export const QUEST_FREE_ASSEMBLY = 3;
/** Crafting quests (TV-R p.172): encounters between low and severe threat. */
export const QUEST_THREATS = Object.freeze(["low", "moderate", "severe"]);

/**
 * TV-R p.171 Table 5-3 (Treasure by Encounter, reprinting GM Core p.81): treasure per encounter for party levels 1-20,
 * in cp, as [low, moderate, severe, extreme].
 */
export const TREASURE_BY_ENCOUNTER = Object.freeze([
    [1300, 1800, 2600, 3500], [2300, 3000, 4500, 6000], [3800, 5000, 7500, 10000], [6500, 8500, 13000, 17000],
    [10000, 13500, 20000, 27000], [15000, 20000, 30000, 40000], [22000, 29000, 44000, 58000], [30000, 40000, 60000, 80000],
    [43000, 57000, 86000, 114000], [60000, 80000, 120000, 160000], [86500, 115000, 172500, 230000], [125000, 165000, 247500, 330000],
    [187500, 250000, 375000, 500000], [275000, 365000, 550000, 730000], [410000, 545000, 820000, 1090000],
    [620000, 825000, 1240000, 1650000], [960000, 1280000, 1920000, 2560000], [1560000, 2080000, 3120000, 4160000],
    [2660000, 3550000, 5325000, 7100000], [3680000, 4900000, 7350000, 9800000],
].map((row) => Object.freeze(row)));
/** The threat columns of Table 5-3. */
export const THREAT_COLUMN = Object.freeze({ low: 0, moderate: 1, severe: 2, extreme: 3 });

/** Critical Crafting (TV-R p.162): the crafter's curse, a status penalty to Crafting checks; the size the table enters by default. */
export const CURSE_PENALTY_DEFAULT = 1;

/**
 * Compendium items the variants name, for names and chat links (P9: their text is never copied): the Deconstruct and Grow
 * actions and the Quick Setup feat (all `publication.remaster: true`, no rule elements; pf2e-8.6.1), and the GM Screen
 * journal's "Downtime Events" page, which crafting events 1-3 point to (6.16.3).
 */
export const VARIANT_UUIDS = Object.freeze({
    deconstruct: "Compendium.pf2e.actionspf2e.Item.ZUAaBIAntZhFQixm",
    grow: "Compendium.pf2e.actionspf2e.Item.5tOovJGK2TQIBHUZ",
    quickSetup: "Compendium.pf2e.feats-srd.Item.bcEI0iIFhZXqjoaR",
    downtimeEvents: "Compendium.pf2e.journals.JournalEntry.S55aqwWIzpQRFhcq.JournalEntryPage.or9dAZfXyd01A8dS",
});
