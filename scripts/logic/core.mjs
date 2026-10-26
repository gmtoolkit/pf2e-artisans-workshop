/**
 * Shared vocabulary of the rules engine (DESIGN.md 6): degrees of success, proficiency ranks, rarities and
 * a few small helpers. Everything under `scripts/logic/` is pure: plain data in, plain data out, no Foundry
 * or browser globals (DESIGN.md 15.1).
 *
 * Conventions for the whole folder:
 * - Money is integer copper (cp).
 * - Nothing returns user-facing text. A refusal is `{ ok: false, reason, data }`, where `reason` is a
 *   stable code that the interface maps to an i18n key and `data` holds its numbers.
 * - Calling a function with impossible input (a non-integer level, an unknown rarity) is a bug in the
 *   caller and throws a TypeError or RangeError.
 */

/** Degrees of success, as pf2e numbers them (`DegreeOfSuccess`). */
export const DEGREE = Object.freeze({ critFail: 0, fail: 1, success: 2, critSuccess: 3 });

/** pf2e's outcome strings (`flags.pf2e.context.outcome`) to degrees. */
export const DEGREE_FROM_OUTCOME = Object.freeze({
    criticalFailure: DEGREE.critFail,
    failure: DEGREE.fail,
    success: DEGREE.success,
    criticalSuccess: DEGREE.critSuccess,
});

/** Proficiency ranks, as pf2e numbers them. */
export const RANK = Object.freeze({ untrained: 0, trained: 1, expert: 2, master: 3, legendary: 4 });

/**
 * Registry slugs of the feats the rules read (6.11). A feat with a choice is `<slug>:<choice>`. Callers pass a
 * crafter's feats as these slugs; booleans stand in where a rule needs one feat only (Efficient Alchemy,
 * Quick Setup, Experienced Professional).
 */
export const FEAT = Object.freeze({
    alchemicalCrafting: "alchemical-crafting",
    magicalCrafting: "magical-crafting",
    snareCrafting: "snare-crafting",
    tattooArtist: "tattoo-artist",
    graftTechnician: "graft-technician",
    specialtyCraftingArtistry: "specialty-crafting:artistry",
    craftAnything: "craft-anything",
    communalCrafting: "communal-crafting",
    inventor: "inventor",
    reverseEngineering: "reverse-engineering",
    experiencedProfessional: "experienced-professional",
    efficientAlchemy: "efficient-alchemy-alchemist",
    quickSetup: "quick-setup",
});

/** Formula routes (4.3) on which the crafter has the formula: it is known, covered by its family, or granted. */
export const ROUTES_WITH_FORMULA = Object.freeze(["known", "family", "virtual"]);

/** Rarities, lowest first. */
export const RARITIES = Object.freeze(["common", "uncommon", "rare", "unique"]);

/** Traits that make an item magical, as pf2e's `PhysicalItemPF2e#isMagical` reads them. */
const MAGIC_TRAITS = new Set(["magical", "arcane", "divine", "occult", "primal"]);

export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/** Throw unless `value` is an integer: levels, ranks, days and copper amounts all are. */
export function requireInteger(value, name) {
    if (!Number.isInteger(value)) throw new TypeError(`${name} must be an integer, got ${value}`);
    return value;
}

/** Throw unless `value` is a whole, non-negative number of copper. */
export function requireCp(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be whole copper >= 0, got ${value}`);
    return value;
}

/** Throw unless `value` is a degree of success, 0 (critical failure) to 3 (critical success). */
export function requireDegree(value, name) {
    if (!Object.values(DEGREE).includes(value)) throw new RangeError(`${name} must be a degree of success 0-3, got ${value}`);
    return value;
}

/**
 * The ledger rows that still count (4.6). A `reversal` row and the row it reverses cancel each other, so
 * both are left out. A row is reversed when it is marked `reversedBy` or a `reversal` row names its `id` in
 * `reverses`; either mark is enough.
 */
export function liveRows(rows) {
    const reversed = new Set(rows.filter((row) => row.kind === "reversal" && row.reverses).map((row) => row.reverses));
    return rows.filter((row) => row.kind !== "reversal" && !row.reversedBy && !reversed.has(row.id));
}

/**
 * Rows (and other stamped records) in order of time: world time, then real time, then id in code-point order
 * (4.6). Every client sorts stored records the same way with it.
 */
export function compareRows(a, b) {
    const world = (a.at?.world ?? 0) - (b.at?.world ?? 0);
    if (world) return world;
    const real = (a.at?.real ?? 0) - (b.at?.real ?? 0);
    if (real) return real;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * When a stamp (`at`, 4.1) was made, in milliseconds on the server's own clock, which every client shares: the
 * moment the server launched the world (`at.launch`) plus the server time since then (`at.server`, Foundry's
 * `game.time.serverTime`, which counts from that launch). Every client of one launch has the same `launch`, so
 * within a launch this compares server times exactly, and across a relaunch it stays in order. A stamp without
 * both falls back to its author's own clock (`at.real`). Ages and timeouts compare this with the reader's moment
 * on the same clock (`serverNow`, `scripts/foundry/store.mjs`), so two machines' clocks never meet.
 */
export function stampTime(at) {
    return Number.isFinite(at?.launch) && Number.isFinite(at?.server) ? at.launch + at.server : at?.real ?? 0;
}

/** 0 for common up to 3 for unique. */
export function rarityRank(rarity = "common") {
    const rank = RARITIES.indexOf(rarity);
    if (rank < 0) throw new RangeError(`unknown rarity ${rarity}`);
    return rank;
}

/** Whether `item.traits` (an array or a Set of trait slugs) includes `trait`. */
export function hasTrait(item, trait) {
    const traits = item.traits ?? [];
    return Array.isArray(traits) ? traits.includes(trait) : traits.has(trait);
}

/** Whether the item is magical: the magical trait or a magic tradition, as pf2e decides. */
export function isMagical(item) {
    return [...MAGIC_TRAITS].some((trait) => hasTrait(item, trait));
}

/** A Set from an array, a Set or nothing, so callers may pass either. */
export function asSet(values) {
    return values instanceof Set ? values : new Set(values ?? []);
}
