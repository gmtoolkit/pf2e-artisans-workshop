/**
 * The Formula Codex (DESIGN.md 4.13, 6.4, 6.8, 10.1 Formulas tab, M5): what a character knows and how it came to know
 * it, the formulas its features give it without a book, the picks its features still owe it, and whether buying a
 * formula pays for itself. Pure: the Foundry side (`scripts/foundry/formulas.mjs`) passes the formula book, the
 * provenance records, the registry keys and plain facts about compendium items.
 *
 * Provenance (4.13) is `formulas.<actorId>.<hash>` = `{id, v, uuid, route, source, pickLevel, day, row, order, service,
 * by, at}`, keyed by a hash of the formula's UUID, so learning the same formula twice writes one record. A formula in
 * the book without a record reads as `unrecorded` (it was there before the module, or added on the sheet).
 */
import { DEGREE, compareRows, rarityRank } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { covers, familyBaseName, familyKey } from "./families.mjs";
import { formulaPrice } from "./formula-jobs.mjs";
import { hashId, idemKey } from "./ids.mjs";
import { incomePerDay } from "./income.mjs";
import { liveRecords } from "./keypath.mjs";
import { heldEffects, levelBound, testPredicate, virtualListCovers } from "./registry.mjs";

export const PROVENANCE_VERSION = 1;

/** Provenance routes (4.13), in the order the Codex lists their badges. */
export const PROVENANCE_ROUTES = Object.freeze([
    "granted", "bought", "copied-npc", "copied-ally", "invented", "reverse-engineered", "looted", "family", "virtual", "unrecorded",
]);

/** The record id of a formula's provenance: a hash of its UUID. */
export const provenanceId = (uuid) => hashId(idemKey("formula", uuid));

/** The ledger path of an actor's provenance record for a formula. */
export const provenancePath = (actorId, uuid) => `formulas.${actorId}.${provenanceId(uuid)}`;

/**
 * A provenance record (4.13).
 * @param {object} p
 * @param {string} p.uuid      the formula's compendium UUID
 * @param {string} p.route     one of `PROVENANCE_ROUTES`
 * @param {string|null} [p.source]   who or what it came from: an ally's or a seller's actor UUID, a registry key for a pick
 * @param {number|null} [p.pickLevel]  the level whose pick it used (`granted`)
 */
export function makeProvenance({ uuid, route, source = null, pickLevel = null, day = null, row = null, order = null, service = null }, stamp) {
    if (!PROVENANCE_ROUTES.includes(route)) throw new RangeError(`unknown provenance route ${route}`);
    if (typeof uuid !== "string" || !uuid) throw new TypeError("provenance needs the formula's UUID");
    return { id: provenanceId(uuid), v: PROVENANCE_VERSION, uuid, route, source, pickLevel, day, row, order, service, ...stamp };
}

/** The provenance records of one actor by formula UUID (`formulas.<actorId>` as stored). */
export function provenanceByUuid(records) {
    const out = new Map();
    for (const record of liveRecords(records ?? {}).sort(compareRows)) out.set(record.uuid, record);
    return out;
}

/**
 * The provenance records with the formulas still on their way to the book (5.5: claims filed but not applied, which only
 * the learner's own client applies): each such claim reads as the record it will write, unless a record exists already
 * (a claim resolved but not yet applied has written it). The picks owed and the Codex count these, so a tab that is not
 * the learner's cannot take one pick twice or buy a formula twice while the first is still on its way.
 *
 * @param {object} records    `formulas.<actorId>` as stored
 * @param {object[]} claims   the learner's formula claims not applied
 */
export function withPending(records, claims) {
    const out = { ...(records ?? {}) };
    for (const claim of claims) {
        const id = provenanceId(claim.uuid);
        if (liveRecords({ [id]: out[id] }).length) continue;
        out[id] = { id, v: PROVENANCE_VERSION, uuid: claim.uuid, route: claim.route, source: claim.source ?? null, pickLevel: claim.pickLevel ?? null,
            pending: true, at: claim.at };
    }
    return out;
}

/* -------------------------------------------- */
/*  The book, by family                          */
/* -------------------------------------------- */

/**
 * The formulas in a book, each with its facts and how it was learned (4.13): `{uuid, name, img, level, rarity, type,
 * category, family, route, source}`. A UUID the catalogue does not know (a homebrew or legacy item) keeps its UUID as its
 * name, so nothing in the book is hidden.
 *
 * @param {string[]} book            the UUIDs in `system.crafting.formulas`
 * @param {object} records           `formulas.<actorId>` as stored
 * @param {Map<string, object>} facts  compendium facts by UUID: `{name, img, level, rarity, type, category}`
 */
export function codexEntries(book, records, facts) {
    const provenance = provenanceByUuid(records);
    return [...new Set(book)].map((uuid) => {
        const item = facts.get(uuid) ?? { name: uuid, level: 0, rarity: "common", type: "", category: "" };
        const record = provenance.get(uuid);
        return {
            uuid, name: item.name, img: item.img ?? null, level: item.level ?? 0, rarity: item.rarity ?? "common",
            type: item.type ?? "", category: item.category ?? "", family: familyKey(item),
            route: record?.route ?? "unrecorded", source: record?.source ?? null,
        };
    });
}

/**
 * The book grouped by family (6.4): each family's known grades and the other grades of the catalogue their formulas
 * cover (`covers`: same family, no higher rarity, a higher level or any while `familyCoversLowerGrades` is on, and not
 * an item that needs its own formula). Families sorted by name, grades by level.
 *
 * @param {object[]} entries     `codexEntries`
 * @param {object[]} catalogue   compendium facts `{uuid, name, img, level, rarity, type, category, ownFormulaPerType?}`
 * @returns {{key: string, name: string, known: object[], covered: object[]}[]}
 */
export function familiesOf(entries, catalogue, rules = DEFAULT_RULES) {
    const families = new Map();
    for (const entry of entries) {
        const family = families.get(entry.family) ?? { key: entry.family, name: familyBaseName(entry.name), known: [], covered: [] };
        family.known.push(entry);
        families.set(entry.family, family);
    }
    const known = new Set(entries.map((e) => e.uuid));
    for (const item of catalogue) {
        if (known.has(item.uuid)) continue;
        const family = families.get(familyKey(item));
        if (!family) continue;
        if (family.known.some((k) => covers(k, { ...item, ownFormulaPerType: !!item.ownFormulaPerType }, rules))) family.covered.push(item);
    }
    const byLevel = (a, b) => a.level - b.level || a.name.localeCompare(b.name);
    return [...families.values()].map((f) => ({ ...f, known: f.known.sort(byLevel), covered: f.covered.sort(byLevel) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------- */
/*  Virtual lists                                */
/* -------------------------------------------- */

/**
 * The formulas each of the character's virtual lists gives without a book (6.8 Virtual lists, 7.4): one list per held
 * `virtualFormulaList` effect, `{key, items}`, the catalogue's items it covers at the character's level. A list whose
 * items are all in the book still shows, with nothing new.
 *
 * @param {string[]} held          the character's registry keys
 * @param {object[]} catalogue     compendium facts `{uuid, level, rarity, book, options: Set|string[]}`
 * @param {number} level
 */
export function virtualLists(held, catalogue, level, rules = DEFAULT_RULES) {
    return heldEffects(held, "virtualFormulaList", rules).map(({ key, effect }) => ({
        key,
        items: catalogue.filter((item) => virtualListCovers(effect, item, new Set(item.options ?? []), level)),
    }));
}

/* -------------------------------------------- */
/*  Picks owed                                   */
/* -------------------------------------------- */

/**
 * Every formula pick the character's features have granted up to its level (6.8, Feature picks owed), one entry per
 * level and allowance: `{level, key, count, maxLevel, minLevel, rarity, filter, uuids, on}`. A feature's picks start at
 * the level it was gained (`gainedAt`, the feat's level taken or the feature's level; 1 when unknown):
 * - `on: "gain"` at that level;
 * - `on: "level"` at each later level up to the character's (only those in `levels`, when the effect lists some);
 * - `on: "rank"` at that level for every listed rank the character holds now (when a rank rose is not recorded).
 * Level bounds of "level" resolve at the level of the pick.
 *
 * @param {string[]} held
 * @param {{level: number, gainedAt?: Record<string, number>, ranks?: Record<string, number>}} p
 */
export function picksSchedule(held, { level, gainedAt = {}, ranks = {} }, rules = DEFAULT_RULES) {
    const out = [];
    const entry = (key, effect, at) => out.push({
        level: at, key, on: effect.on, count: effect.count ?? effect.uuids?.length ?? 0,
        maxLevel: effect.maxLevel === undefined ? null : levelBound(effect.maxLevel, at),
        minLevel: effect.minLevel === undefined ? null : levelBound(effect.minLevel, at),
        rarity: effect.rarity ?? null, filter: effect.filter ?? null, uuids: effect.uuids ?? null,
    });
    for (const { key, effect } of heldEffects(held, "formulaAllowance", rules)) {
        const from = Math.max(1, gainedAt[key] ?? 1);
        if (from > level) continue;
        if (effect.on === "gain") entry(key, effect, from);
        if (effect.on === "level") {
            for (let at = from + 1; at <= level; at += 1) if (!effect.levels || effect.levels.includes(at)) entry(key, effect, at);
        }
        if (effect.on === "rank") for (const rank of effect.ranks ?? []) if ((ranks[effect.skill] ?? 0) >= rank) entry(key, effect, from);
    }
    return out.sort((a, b) => a.level - b.level || a.key.localeCompare(b.key));
}

/**
 * What the schedule still owes, after the picks already taken (`granted` provenance whose `source` is the allowance's
 * key): each granted record fills the entry of its `pickLevel` first, then the earliest entry of its key with room.
 * Returns every entry with `taken` and `owed`, and the total owed.
 *
 * @param {object[]} schedule   `picksSchedule`
 * @param {object} records      `formulas.<actorId>` as stored
 */
export function picksOwed(schedule, records) {
    const entries = schedule.map((e) => ({ ...e, taken: 0, owed: e.count }));
    const granted = liveRecords(records ?? {}).filter((r) => r.route === "granted" && r.source).sort(compareRows);
    const place = (entry) => {
        entry.taken += 1;
        entry.owed -= 1;
    };
    const unplaced = [];
    for (const record of granted) {
        const exact = entries.find((e) => e.key === record.source && e.level === record.pickLevel && e.owed > 0);
        if (exact) place(exact);
        else unplaced.push(record);
    }
    for (const record of unplaced) {
        const first = entries.find((e) => e.key === record.source && e.owed > 0);
        if (first) place(first);
    }
    return { entries, owed: entries.reduce((sum, e) => sum + e.owed, 0) };
}

/**
 * Whether a compendium item may be taken for a pick (6.8): one of its named UUIDs, or an item of an allowed rarity,
 * within its level bounds, that meets its filter.
 * @param {object} pick   a `picksSchedule` entry
 * @param {{uuid: string, level: number, rarity?: string, options: Set<string>|string[]}} item
 */
export function pickFits(pick, item) {
    if (pick.uuids) return pick.uuids.includes(item.uuid);
    if (pick.rarity && !pick.rarity.includes(item.rarity ?? "common")) return false;
    if (pick.maxLevel !== null && pick.maxLevel !== undefined && item.level > pick.maxLevel) return false;
    if (pick.minLevel !== null && pick.minLevel !== undefined && item.level < pick.minLevel) return false;
    return testPredicate(pick.filter, item.options instanceof Set ? item.options : new Set(item.options ?? []));
}

/* -------------------------------------------- */
/*  Buying versus crafting without a formula     */
/* -------------------------------------------- */

/**
 * Whether buying a formula pays for itself (10.1 Formulas tab): crafting without the formula takes a second setup day
 * (Player Core p.237), and the crafter's time is worth a day of Income Earned at a success (the reduction an extra day
 * would bring). `crafts` is how many Crafts of the item it takes for the days saved to be worth the formula's Price.
 * `needed` when no Craft is possible without the formula (an uncommon item with no access, 4.3).
 *
 * @param {{level: number, rarity?: string}} item
 * @param {{level: number, rank: number}} crafter
 * @param {string|null} route   `craftRoute` for the item: "none", or null when a formula is needed
 * @returns {{formulaCp: number, daySavedCp: number, crafts: number|null, needed: boolean}}
 */
export function breakEven(item, crafter, route) {
    const formulaCp = formulaPrice(item.level);
    const daySavedCp = crafter.rank > 0 ? incomePerDay(crafter.level, crafter.rank, DEGREE.success) : 0;
    const needed = route === null;
    const crafts = needed || daySavedCp <= 0 ? null : Math.ceil(formulaCp / daySavedCp);
    return { formulaCp, daySavedCp, crafts, needed };
}

/* -------------------------------------------- */
/*  The party's formulas                         */
/* -------------------------------------------- */

/**
 * The families the party's members know, from their roster snapshots (4.10): `{key, name, members: [{id, name}],
 * levels}`, sorted by name. Players see each other's books only this way. Snapshots list UUIDs; `facts` names them.
 *
 * @param {object[]} roster   `roster.<actorId>` records
 * @param {Map<string, object>} facts  compendium facts by UUID
 */
export function partyFamilies(roster, facts) {
    const families = new Map();
    for (const snapshot of roster) {
        for (const uuid of snapshot.formulas ?? []) {
            const item = facts.get(uuid);
            if (!item) continue;
            const key = familyKey(item);
            const family = families.get(key) ?? { key, name: familyBaseName(item.name), members: [], levels: new Set(), rarity: item.rarity ?? "common" };
            if (!family.members.some((m) => m.id === snapshot.id)) family.members.push({ id: snapshot.id, name: snapshot.name });
            family.levels.add(item.level);
            if (rarityRank(item.rarity ?? "common") > rarityRank(family.rarity)) family.rarity = item.rarity;
            families.set(key, family);
        }
    }
    return [...families.values()].map((f) => ({ ...f, levels: [...f.levels].sort((a, b) => a - b) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether an ally's roster snapshot lists a formula (6.8, copy from an ally). */
export const allyKnows = (snapshot, uuid) => (snapshot?.formulas ?? []).includes(uuid);
