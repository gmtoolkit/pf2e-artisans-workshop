/**
 * Lookups over the rules registry (DESIGN.md 6.11; the table and its schema are in `scripts/data/registry.mjs`).
 *
 * A character is described by the registry keys it holds (`heldKeys`): its feats, class features and equipped
 * gear that have an entry, a choice feat as `<key>:<choice>`. A Craft is described by a set of options
 * (`craftOptions`): the product's roll options plus the context options the registry's predicates read. Every
 * lookup takes those two and returns plain values for the M1 rules (`batchMax`, `craftRoute`, the gates,
 * `crafterRate`, `wagePerDay`) and for the roll wrapper. Nothing here reads a document.
 */
import { REGISTRY, SPECIALTY_DEFAULTS } from "../data/registry.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

/** Registry keys by compendium UUID. */
const BY_UUID = new Map(Object.entries(REGISTRY).map(([key, entry]) => [entry.uuid, key]));
/** Registry keys by pf2e slug (a key without its `@` suffix); a slug two entries share maps to both. */
const BY_SLUG = new Map();
for (const key of Object.keys(REGISTRY)) {
    const slug = key.split("@")[0];
    BY_SLUG.set(slug, [...(BY_SLUG.get(slug) ?? []), key]);
}

/** A held key as its registry key and its choice: `specialty-crafting:alchemy` is `{key, choice: "alchemy"}`. */
export function parseHeld(held) {
    const [key, choice = null] = held.split(":");
    return { key, choice };
}

/** The entry of a registry key or held key, or null. */
export function registryEntry(held) {
    return REGISTRY[parseHeld(held).key] ?? null;
}

/** The registry key of a compendium source UUID, or null. */
export function keyOfUuid(uuid) {
    return BY_UUID.get(uuid) ?? null;
}

/**
 * The registry keys a character holds, sorted, from plain data about its items: `{sourceId, slug, selections}`,
 * where `sourceId` is the compendium source UUID (`_stats.compendiumSource`) and `selections` its ChoiceSet
 * selections (`flags.pf2e.rulesSelections`). An item matches by source UUID first; without one (a granted copy,
 * a homebrew copy), by slug when exactly one entry has that slug. A choice entry whose item has no selection yet
 * is held without its choice.
 */
export function heldKeys(items) {
    const keys = new Set();
    for (const item of items) {
        const bySlug = BY_SLUG.get(item.slug) ?? [];
        const key = keyOfUuid(item.sourceId) ?? (bySlug.length === 1 ? bySlug[0] : null);
        if (!key) continue;
        const flag = REGISTRY[key].choice;
        const choice = flag ? item.selections?.[flag] : null;
        keys.add(typeof choice === "string" && choice ? `${key}:${choice}` : key);
    }
    return [...keys].sort();
}

/**
 * Roll options of an item from plain facts, as pf2e's `getRollOptions("item")` names them (verified live on an
 * unsaved copy of a compendium consumable): `item:type:`, `item:id:`, `item:slug:`, `item:trait:`, `item:rarity:`,
 * `item:level:`, `item:category:`, plus `item:tag:` for other tags and `item:usage:` for the usage. Foundry callers
 * pass `item.getRollOptions("item")` instead.
 *
 * @param {{type?: string, id?: string, slug?: string, traits?: string[], rarity?: string, level?: number,
 *   category?: string, otherTags?: string[], usage?: string}} item
 */
export function itemOptions(item) {
    const options = new Set();
    const add = (prefix, value) => {
        if (value !== undefined && value !== null && value !== "") options.add(`item:${prefix}:${value}`);
    };
    add("type", item.type);
    add("id", item.id);
    add("slug", item.slug);
    for (const trait of item.traits ?? []) add("trait", trait);
    add("rarity", item.rarity ?? "common");
    add("level", item.level);
    add("category", item.category);
    for (const tag of item.otherTags ?? []) add("tag", tag);
    add("usage", item.usage);
    return options;
}

/** Whether a predicate `{all?, any?, not?}` holds for a set of options. An empty predicate holds. */
export function testPredicate(predicate, options) {
    if (!predicate) return true;
    const has = (option) => options.has(option);
    return (predicate.all ?? []).every(has) &&
        (!predicate.any?.length || predicate.any.some(has)) &&
        !(predicate.not ?? []).some(has);
}

/** `{choice}` in a predicate or an option list replaced by the holder's choice. */
function withChoice(value, choice) {
    if (typeof value === "string") return value.replaceAll("{choice}", choice ?? "");
    if (Array.isArray(value)) return value.map((v) => withChoice(v, choice));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withChoice(v, choice)]));
    return value;
}

/**
 * Every effect of `kind` that the held keys carry, each `{key, choice, effect}` with `{choice}` filled in. An entry
 * with a `variantOnly` effect counts only while that variant rule is on (Quick Setup needs Complex Crafting).
 */
export function heldEffects(held, kind, rules = DEFAULT_RULES) {
    const out = [];
    for (const h of held) {
        const { key, choice } = parseHeld(h);
        const entry = REGISTRY[key];
        if (!entry || !variantsOn(entry, rules)) continue;
        for (const effect of entry.effects) {
            if (effect.kind === kind) out.push({ key, choice, effect: withChoice(effect, choice) });
        }
    }
    return out;
}

const variantsOn = (entry, rules) =>
    entry.effects.every((effect) => effect.kind !== "variantOnly" || rules.variants?.[effect.variant] === true);

/** Whether the held keys include `key` (with any choice), counting `variantOnly` (Quick Setup under Complex Crafting). */
export function holds(held, key, rules = DEFAULT_RULES) {
    return held.some((h) => parseHeld(h).key === key && variantsOn(REGISTRY[key] ?? { effects: [] }, rules));
}

/* -------------------------------------------- */
/*  The options of a Craft                       */
/* -------------------------------------------- */

/**
 * The options the registry's predicates read for a Craft: the product's roll options, `craft-type:<type>`,
 * `route:<route>`, `material:<source>` (`monster` for Monster Crafting), and `specialty:<trade>` for each trade
 * the Craft falls under: the one chosen on the order (`specialty`) and those whose `SPECIALTY_DEFAULTS` predicate
 * matches. `specialty:own` is added when one of those trades is a Specialty Crafting choice the crafter holds.
 *
 * @param {object} p
 * @param {Iterable<string>} p.item      the product's roll options
 * @param {string[]} [p.held]
 * @param {string} [p.craftType]
 * @param {string|null} [p.route]
 * @param {string|null} [p.specialty]   the trade the crafter chose for this order
 * @param {string|null} [p.material]
 */
export function craftOptions({ item, held = [], craftType = "item", route = null, specialty = null, material = null }) {
    const options = new Set(item);
    options.add(`craft-type:${craftType}`);
    if (route) options.add(`route:${route}`);
    if (material) options.add(`material:${material}`);
    const trades = new Set(specialty ? [specialty] : []);
    for (const [trade, predicate] of Object.entries(SPECIALTY_DEFAULTS)) {
        if (testPredicate(predicate, options)) trades.add(trade);
    }
    for (const trade of trades) options.add(`specialty:${trade}`);
    const own = held.some((h) => {
        const { key, choice } = parseHeld(h);
        return key === "specialty-crafting" && trades.has(choice);
    });
    if (own) options.add("specialty:own");
    return options;
}

/* -------------------------------------------- */
/*  Gates and routes                             */
/* -------------------------------------------- */

/**
 * Item traits the G4 feat gate opens for the crafter (`crafter.unlocks`): `talisman` for Talisman Dabbler, `oil` and
 * `potion` for the witch's Cauldron.
 */
export function unlocks(held, rules = DEFAULT_RULES) {
    return [...new Set(heldEffects(held, "craftUnlock", rules).map(({ effect }) => effect.category).filter(Boolean))].sort();
}

/** Whether a registry access grant covers an uncommon or rarer product (G5, `accessGrant`). */
export function accessGrant(held, options, rules = DEFAULT_RULES) {
    return heldEffects(held, "craftUnlock", rules).some(({ effect }) => effect.access && testPredicate(effect.access, options));
}

/** A level bound: a number, or "level" for the character's level. */
const bound = (value, level) => (value === "level" ? level : value);

/**
 * Whether a feature gives the crafter the product's formula without a book (`virtual`, 4.3): a virtual list that
 * names the product's UUID, or whose filter, rarities, level bounds and books it meets.
 *
 * @param {object} item  `{uuid, level, rarity, book}` of the product
 * @param {Set<string>} options  the product's options
 * @param {number} level  the crafter's level
 */
export function virtualFormula(held, item, options, level, rules = DEFAULT_RULES) {
    return heldEffects(held, "virtualFormulaList", rules).some(({ effect }) => virtualListCovers(effect, item, options, level));
}

/**
 * Whether one `virtualFormulaList` effect covers a product: it names the product's UUID, or the product meets its filter,
 * rarities, level bounds and books. The Formulas tab lists each list's items with it (M5).
 */
export function virtualListCovers(effect, item, options, level) {
    if (effect.uuids) return effect.uuids.includes(item.uuid);
    if (effect.rarity && !effect.rarity.includes(item.rarity ?? "common")) return false;
    if (effect.maxLevel !== undefined && item.level > bound(effect.maxLevel, level)) return false;
    if (effect.minLevel !== undefined && item.level < bound(effect.minLevel, level)) return false;
    if (effect.books && !effect.books.includes(item.book)) return false;
    return testPredicate(effect.filter, options);
}

/** A level bound of an effect (a number, or "level" for the character's level at that point), resolved. */
export const levelBound = (value, level) => bound(value, level);

/** The registry inputs of `craftRoute` (formula-jobs.mjs): `{virtual, accessGrant}`. */
export function routeInputs(held, item, options, level, rules = DEFAULT_RULES) {
    return { virtual: virtualFormula(held, item, options, level, rules), accessGrant: accessGrant(held, options, rules) };
}

/**
 * The skills a Craft may use: Crafting first, then each registry substitute whose predicate matches (Monster
 * Crafting's Survival, the Herbalist's Nature, Graft Technician's Medicine, Rune-Singer's Performance).
 */
export function craftSkills(held, options, rules = DEFAULT_RULES) {
    const subs = heldEffects(held, "skillSubstitution", rules).filter(({ effect }) => testPredicate(effect.when, options));
    return ["crafting", ...new Set(subs.map(({ effect }) => effect.skill))];
}

/**
 * The tool ids (G7) the held gear and features provide or waive for a Craft. Unconditional substitutions first
 * (the gear that is a tool), then those that `require` one of them (cookware for alchemical food, a healer's
 * toolkit for herbal items).
 */
export function tools(held, options, rules = DEFAULT_RULES) {
    const effects = heldEffects(held, "toolSubstitution", rules).map(({ effect }) => effect)
        .filter((effect) => testPredicate(effect.when, options));
    const out = new Set(effects.filter((e) => !e.requires).flatMap((e) => e.tools));
    for (const effect of effects.filter((e) => e.requires)) {
        if (effect.requires.every((tool) => out.has(tool))) effect.tools.forEach((tool) => out.add(tool));
    }
    return [...out].sort();
}

/* -------------------------------------------- */
/*  Planning                                     */
/* -------------------------------------------- */

/** The batch multiplier for this product (Efficient Alchemy's 2 for alchemical consumables), else 1. */
export function batchMultiplier(held, options, rules = DEFAULT_RULES) {
    const matching = heldEffects(held, "batchSize", rules).filter(({ effect }) => testPredicate(effect.when, options));
    return Math.max(1, ...matching.map(({ effect }) => effect.multiply));
}

/** A registry setup length for this Craft (Reverse Engineering's 1 day, the inexplicable apparatus), or null. */
export function setupOverride(held, options, rules = DEFAULT_RULES) {
    const days = heldEffects(held, "setupDays", rules).filter(({ effect }) => testPredicate(effect.when, options))
        .map(({ effect }) => effect.days);
    return days.length ? Math.min(...days) : null;
}

/**
 * The level each extra day's reduction uses (6.2.3, `crafterRate`'s `rateLevel`): the monster's level when Monster
 * Crafting applies and the order names one, else the crafter's level plus any `add` (the inexplicable apparatus).
 */
export function rateLevel(held, options, { level, monsterLevel = null }, rules = DEFAULT_RULES) {
    const effects = heldEffects(held, "rateLevel", rules).filter(({ effect }) => testPredicate(effect.when, options));
    const monster = effects.some(({ effect }) => effect.source === "monster") && Number.isInteger(monsterLevel);
    const add = Math.max(0, ...effects.map(({ effect }) => effect.add ?? 0));
    return (monster ? monsterLevel : level) + add;
}

/** Whether a product batches as a consumable through a registry correction (the four talismans without the trait). */
export function consumableFix(uuid) {
    const entry = REGISTRY[keyOfUuid(uuid)];
    return !!entry?.effects.some((effect) => effect.kind === "correction" && effect.consumable);
}

/* -------------------------------------------- */
/*  The roll                                     */
/* -------------------------------------------- */

/** The options the roll wrapper adds for the held keys (Specialty Crafting's bare trade, the expanded lab's bare trait). */
export function rollOptions(held, options, rules = DEFAULT_RULES) {
    const matching = heldEffects(held, "rollOptions", rules).filter(({ effect }) => testPredicate(effect.when, options));
    return [...new Set(matching.flatMap(({ effect }) => effect.options))].sort();
}

/**
 * Check modifiers the module applies where no rule element exists (Tattoo Artist, Reverse Engineering), each
 * `{key, uuid, slug, type, value}`; `ranks` are the crafter's ranks by skill, for `atRank`.
 */
export function modifiers(held, options, ranks = {}, rules = DEFAULT_RULES) {
    return heldEffects(held, "modifier", rules).filter(({ effect }) => testPredicate(effect.when, options))
        .map(({ key, effect }) => {
            const raised = effect.atRank && (ranks[effect.atRank.skill] ?? 0) >= effect.atRank.rank;
            return { key, uuid: REGISTRY[key].uuid, slug: effect.slug, type: effect.type, value: raised ? effect.atRank.value : effect.value };
        });
}

/** The degree after the held degree shifts that the roll's options select (Impeccable Crafting). */
export function shiftDegree(held, rollOptionSet, degree, rules = DEFAULT_RULES) {
    const shift = heldEffects(held, "degreeShift", rules)
        .find(({ effect }) => effect.from === degree && testPredicate(effect.when, rollOptionSet));
    return shift ? shift.effect.to : degree;
}

/** Earn Income flags for `wagePerDay` (6.10): `experiencedProfessional`. */
export function earnIncomeFlags(held, rules = DEFAULT_RULES) {
    return { experiencedProfessional: heldEffects(held, "earnIncome", rules).some(({ effect }) => effect.doubleFailure) };
}

/* -------------------------------------------- */
/*  Formula picks owed                           */
/* -------------------------------------------- */

/**
 * The formula picks a character is owed (6.8, Feature picks owed), each `{key, count, maxLevel, minLevel, rarity,
 * filter, uuids}` with level bounds resolved:
 * - `gained`: held keys newly gained (a feat taken at `level`): their `on: "gain"` allowances, and their
 *   `on: "rank"` allowances for ranks the character already has (`ranks`, the ranks now);
 * - `fromLevel`: the level before a level-up to `level`: every `on: "level"` allowance of a held key for each level
 *   gained (only those in its `levels`, when it lists some), bounded by that level;
 * - `rankUps`: `{skill: before}` for each skill whose rank rose to `ranks[skill]`: every `on: "rank"` allowance of a
 *   held key for each rank passed.
 *
 * @param {string[]} held
 * @param {{level: number, gained?: string[], fromLevel?: number|null, ranks?: Record<string, number>,
 *   rankUps?: Record<string, number>}} p
 */
export function formulaPicks(held, { level, gained = [], fromLevel = null, ranks = {}, rankUps = {} }, rules = DEFAULT_RULES) {
    const picks = [];
    const pick = (key, effect, at) => picks.push({
        key, count: effect.count ?? effect.uuids?.length ?? 0, maxLevel: bound(effect.maxLevel, at) ?? null,
        minLevel: bound(effect.minLevel, at) ?? null, rarity: effect.rarity ?? null, filter: effect.filter ?? null, uuids: effect.uuids ?? null,
    });
    for (const { key, effect } of heldEffects(gained, "formulaAllowance", rules)) {
        if (effect.on === "gain") pick(key, effect, level);
        if (effect.on === "rank") for (const rank of effect.ranks) if ((ranks[effect.skill] ?? 0) >= rank) pick(key, effect, level);
    }
    const already = new Set(gained.map((h) => parseHeld(h).key));
    for (const { key, effect } of heldEffects(held, "formulaAllowance", rules)) {
        if (effect.on === "level" && fromLevel !== null) {
            for (let at = fromLevel + 1; at <= level; at += 1) {
                if (!effect.levels || effect.levels.includes(at)) pick(key, effect, at);
            }
        }
        if (effect.on === "rank" && effect.skill in rankUps && !already.has(key)) {
            const before = rankUps[effect.skill];
            for (const rank of effect.ranks) if (rank > before && rank <= (ranks[effect.skill] ?? 0)) pick(key, effect, level);
        }
    }
    return picks;
}

/* -------------------------------------------- */
/*  Services (M5)                                */
/* -------------------------------------------- */

/**
 * The Hit Points a Repair restores for the held keys (6.13): the Crafter's Eyepiece's `repairHp` numbers `{success,
 * critSuccess}` (each `n + n × rank`), or null for the Player Core numbers. The eyepiece counts only worn and invested,
 * which `heldKeysOf` already requires of gear.
 */
export function repairEyepiece(held, rules = DEFAULT_RULES) {
    const effect = heldEffects(held, "repairHp", rules)[0]?.effect;
    return effect ? { success: effect.success, critSuccess: effect.critSuccess } : null;
}

/* -------------------------------------------- */
/*  Tattoos, grafts and snares (M9)              */
/* -------------------------------------------- */

/**
 * The marks a crafter puts on what they make (6.14, `crafterMark`: Legendary Tattoo Artist's +1 to a tattoo's activated
 * abilities and resistances), each `{key, mark, by, below}`, for a product whose options the effect's predicate matches.
 */
export function crafterMarks(held, options, rules = DEFAULT_RULES) {
    return heldEffects(held, "crafterMark", rules).filter(({ effect }) => testPredicate(effect.when, options))
        .map(({ key, effect }) => ({ key, mark: effect.mark, by: effect.by, below: effect.below }));
}

/**
 * The invest-limit exemptions a subject's features give (6.14, `investitureExempt`: Tattooed Historian), each `{key, per,
 * count, when}`: one exempt item per `per` of the number at the actor path `count`, for items the predicate matches.
 */
export function investitureExemptions(held, rules = DEFAULT_RULES) {
    return heldEffects(held, "investitureExempt", rules).map(({ key, effect }) => ({ key, per: effect.per, count: effect.count, when: effect.when }));
}

/** The quick-deploy marks a character's feats allow on prepared snares (7.1, `quickDeploy`: Giant Snare, Broad Snare). */
export function quickDeployMarks(held, rules = DEFAULT_RULES) {
    return [...new Set(heldEffects(held, "quickDeploy", rules).map(({ effect }) => effect.mark))].sort();
}
