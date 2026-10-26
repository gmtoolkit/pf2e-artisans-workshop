/**
 * Precious material grades (DESIGN.md 6.6). Numbers only (P9).
 */

/**
 * By grade: the Crafting rank needed to craft with it, the highest level of magic item (and of the runes
 * it can hold) it allows (null: any), and the least share of the initial raw materials, in percent, that
 * must be the material itself. GM Core p.253 (Crafting with Precious Materials). Only an expert or better
 * crafter can make any precious-material item at all.
 */
export const PRECIOUS_GRADE = Object.freeze({
    low: Object.freeze({ rank: 2, maxMagicLevel: 8, upfrontPct: 10 }),
    standard: Object.freeze({ rank: 3, maxMagicLevel: 15, upfrontPct: 25 }),
    high: Object.freeze({ rank: 4, maxMagicLevel: null, upfrontPct: 100 }),
});

/** At most this many precious materials in one item. GM Core p.252. */
export const PRECIOUS_MATERIALS_PER_ITEM = 1;

/** Least Crafting rank to craft any item with a precious material (expert). GM Core p.253. */
export const PRECIOUS_MIN_RANK = 2;

/**
 * Precious materials that are common (GM Core p.253): coin may stand in for their share of the up-front materials
 * while `rules.preciousCoinForCommon` is on; every other material needs stock items (Player Core p.237).
 */
export const COMMON_PRECIOUS_MATERIALS = Object.freeze(["cold-iron", "silver"]);

/**
 * The words pf2e's slugs end with for precious material stock (an adamantine chunk, a duskwood branch, a djezet alloy
 * ingot): the material is the slug before them. Longest first.
 */
export const STOCK_SUFFIXES = Object.freeze(["-alloy-ingot", "-ingot", "-chunk", "-lumber", "-branch"]);
