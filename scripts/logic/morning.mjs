/**
 * The Morning tab's rules (DESIGN.md 4.11, 7.1-7.10, M7). Pure: daily sources and their merged pools, counts by level,
 * versatile vials and their material buckets, loadouts by family and their resolution to the best grade a pool allows,
 * standing orders and what is delivered after a preparation, the talisman picker, the gap registry entries, and what a
 * rest starts. The Foundry side is `scripts/foundry/morning.mjs`; the window is `scripts/ui/morning.mjs`.
 *
 * The system is the engine (P6): a pool is a pf2e `CraftingAbility` with `isDailyPrep`; pf2e merges same-slug entries
 * itself (the highest slot count, the highest item level, the union of what they craft, as Player Core 2 p.173 says for
 * Advanced Alchemy from several sources). The Morning tab shows each source's own numbers beside the merged ones so the
 * player can see which source wins (`mergeSources` is the same rule, checked against pf2e's result).
 */
import { heldEffects, holds, testPredicate } from "./registry.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { familyKey } from "./families.mjs";

export const LOADOUT_VERSION = 1;
export const STANDING_VERSION = 1;

/** Pools that make talismans from a virtual list, with no formula book (7.4). */
export const TALISMAN_POOLS = Object.freeze(["talisman-dabbler", "talisman-esoterica"]);

/** The most of one entry a loadout or a standing order asks for (pf2e clamps a prepared quantity at 50 batches). */
export const MAX_QTY = 50;

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/* -------------------------------------------- */
/*  Sources and pools (7.1)                      */
/* -------------------------------------------- */

/**
 * The merged numbers of a pool's sources, as pf2e merges same-slug `CraftingAbility` rule elements: the highest slot
 * count (null only while every source is resource-based), the highest item level, the largest batch; and which source
 * gives each. Sources are `{key, name, maxSlots, maxItemLevel, batchSize}`.
 */
export function mergeSources(sources) {
    const out = { maxSlots: null, maxItemLevel: 0, batchSize: 1, winners: { maxSlots: null, maxItemLevel: null } };
    for (const source of sources) {
        if (Number.isInteger(source.maxSlots) && (out.maxSlots === null || source.maxSlots > out.maxSlots)) {
            out.maxSlots = source.maxSlots;
            out.winners.maxSlots = source.key;
        }
        if (Number.isInteger(source.maxItemLevel) && (out.winners.maxItemLevel === null || source.maxItemLevel > out.maxItemLevel)) {
            out.maxItemLevel = source.maxItemLevel;
            out.winners.maxItemLevel = source.key;
        }
        if (Number.isInteger(source.batchSize) && source.batchSize > out.batchSize) out.batchSize = source.batchSize;
    }
    return out;
}

/* -------------------------------------------- */
/*  Corrections of pf2e's data (6.11, 7.1)       */
/* -------------------------------------------- */

/**
 * The registry's corrections of a daily pool (6.11 `correction` with a `pool`): pf2e data that disagrees with the rules
 * text about a source's slot count or what it makes. Each `{key, effect}` applies to the source whose registry key is `key`.
 */
export function poolCorrections(held, pool, rules = DEFAULT_RULES) {
    return heldEffects(held, "correction", rules).filter(({ effect }) => effect.pool === pool);
}

/**
 * A source's own slot count corrected (7.1): `slots.byRank` reads the count from the rank in `slots.skill` (Lethargy
 * Poisoner: one dose, two at master, three at legendary in Crafting); `slots.add` changes it unless the preparation is
 * made in the context `slots.unless` names (Herbalist: two fewer outside the wilderness). A source without a count of its
 * own keeps none.
 *
 * @param {number|null} maxSlots   the source's count as pf2e resolves it
 * @param {object[]} effects        its `correction` effects
 * @param {{ranks?: Record<string, number>, context?: Record<string, boolean>}} [p]
 */
export function correctedSlots(maxSlots, effects, { ranks = {}, context = {} } = {}) {
    if (!Number.isInteger(maxSlots)) return maxSlots;
    let out = maxSlots;
    for (const { slots } of effects) {
        if (!slots) continue;
        if (Array.isArray(slots.byRank) && slots.byRank.length) {
            const rank = Math.max(0, Math.min(slots.byRank.length - 1, ranks[slots.skill] ?? 0));
            out = slots.byRank[rank];
        }
        if (Number.isInteger(slots.add) && !(slots.unless && context[slots.unless] === true)) out = Math.max(0, out + slots.add);
    }
    return out;
}

/** Whether a source's `correction` effects let it make an item with these options (`craftable` narrows, `gate` needs a rank). */
function correctionAllows(effects, options, ranks) {
    return effects.every((effect) => {
        if (effect.craftable && !testPredicate(effect.craftable, options)) return false;
        if (effect.gate && testPredicate(effect.gate.when, options) && (ranks[effect.gate.skill] ?? 0) < effect.gate.rank) return false;
        return true;
    });
}

/**
 * A daily pool with the registry's corrections applied (7.1). Each source's slot count is corrected (`correctedSlots`) and
 * the pool's count lowered by as much as that lowers the merge (the highest source, as pf2e merges and Player Core 2 p.173
 * says), so a count pf2e adds on top of its sources (an active effect) stays. What the pool makes is narrowed only when a
 * correction narrows a source: then an item needs a source whose own predicate (`accepts`) and corrections both allow it.
 *
 * @param {{maxSlots: number|null, sources: {registryKey?: string|null, maxSlots: number|null, accepts?: (options: Set<string>) => boolean}[]}} pool
 * @param {{key: string, effect: object}[]} corrections   `poolCorrections`
 * @param {{ranks?: Record<string, number>, context?: Record<string, boolean>}} [p]
 * @returns {{maxSlots: number|null, systemMaxSlots: number|null, corrected: boolean, narrows: boolean, contexts: string[],
 *   sources: object[], accepts: (options: Set<string>) => boolean}}
 */
export function correctPool({ maxSlots, sources }, corrections, { ranks = {}, context = {} } = {}) {
    const fixed = sources.map((source) => {
        const effects = corrections.filter((c) => c.key === source.registryKey).map((c) => c.effect);
        return { ...source, effects, correctedSlots: correctedSlots(source.maxSlots, effects, { ranks, context }) };
    });
    const highest = (key) => {
        const counts = fixed.map((s) => s[key]).filter(Number.isInteger);
        return counts.length ? Math.max(...counts) : null;
    };
    const raw = highest("maxSlots");
    const lowered = highest("correctedSlots");
    const max = Number.isInteger(maxSlots) && Number.isInteger(raw) && Number.isInteger(lowered) ? Math.max(0, maxSlots - (raw - lowered)) : maxSlots;
    const narrows = fixed.some((s) => s.effects.some((e) => e.craftable || e.gate));
    const contexts = [...new Set(fixed.flatMap((s) => s.effects.map((e) => e.slots?.unless).filter(Boolean)))];
    const accepts = (options) => !narrows || fixed.some((s) => (s.accepts?.(options) ?? false) && correctionAllows(s.effects, options, ranks));
    return { maxSlots: max, systemMaxSlots: maxSlots, corrected: max !== maxSlots, narrows, contexts, sources: fixed, accepts };
}

/** Prepared items counted by item level, lowest first: `[{level, count}]` (each entry counts its quantity). */
export function countsByLevel(prepared) {
    const counts = new Map();
    for (const p of prepared) counts.set(p.level, (counts.get(p.level) ?? 0) + (p.quantity ?? 0));
    return [...counts].sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ level, count }));
}

/**
 * A pool as the Morning tab shows it: slots used (batches) and free, whether it asks for more than it has, and its
 * prepared items by level.
 *
 * @param {{maxSlots: number|null, prepared: {level: number, quantity: number, batches: number, expended?: boolean}[]}} pool
 */
export function poolView(pool) {
    const used = pool.prepared.reduce((sum, p) => sum + (p.batches ?? 0), 0);
    const max = Number.isInteger(pool.maxSlots) ? pool.maxSlots : null;
    return {
        used, max, free: max === null ? null : Math.max(0, max - used), insufficient: max !== null && used > max,
        byLevel: countsByLevel(pool.prepared), made: pool.prepared.length > 0 && pool.prepared.every((p) => p.expended),
    };
}

/**
 * Versatile vials (7.3): the `versatile-vials` resource is authoritative (pf2e reads it from the vial item's quantity and
 * writes it back through `updateResource`). `inventory` is what the vial items hold together; a difference means a
 * second stack or a vial moved by hand, which the tab points out.
 */
export function vialState({ value = 0, max = 0, inventory = 0, level = null } = {}) {
    return { value, max, inventory, level, consistent: inventory === value, missing: Math.max(0, max - value) };
}

/**
 * Advanced Vials' material buckets (7.3, OQ-22) kept in step with the resource: a total above the vials loses the
 * difference from plain first, then the other buckets in key order; a total below gains plain vials.
 *
 * @param {Record<string, number>} buckets
 * @param {number} value  the vials there are
 */
export function normalizeBuckets(buckets, value) {
    const out = Object.fromEntries(Object.entries(buckets ?? {}).filter(([, n]) => Number.isInteger(n) && n > 0));
    let total = Object.values(out).reduce((a, b) => a + b, 0);
    const order = ["plain", ...Object.keys(out).filter((k) => k !== "plain").sort()];
    for (const key of order) {
        if (total <= value) break;
        const take = Math.min(out[key] ?? 0, total - value);
        if (!take) continue;
        out[key] -= take;
        total -= take;
        if (out[key] === 0) delete out[key];
    }
    if (total < value) out.plain = (out.plain ?? 0) + (value - total);
    return out;
}

/* -------------------------------------------- */
/*  Talismans (7.4)                              */
/* -------------------------------------------- */

/**
 * The talisman picker of a talisman pool: the items its virtual list gives (Talisman Dabbler: common talismans of the
 * character's level or lower; Talisman Esoterica: the common GM Core ones) that the pool can make today, at most its
 * `maxItemLevel` (half the character's level), best first. Nothing is written to the formula book: Talisman Dabbler
 * remembers these formulas without one (Player Core 2).
 *
 * @param {{uuid: string, name: string, level: number}[]} items
 * @param {{maxItemLevel: number, canCraft?: (item: object) => boolean}} pool
 */
export function talismanChoices(items, { maxItemLevel, canCraft = () => true }) {
    return items.filter((item) => item.level <= maxItemLevel && canCraft(item))
        .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

/** Whether a talisman pick fits its pool: no more than its slots, each one offered. */
export function talismanPickProblem(chosen, { maxSlots, offered }) {
    if (Number.isInteger(maxSlots) && chosen.length > maxSlots) return refuse("too-many", { max: maxSlots });
    const unknown = chosen.find((uuid) => !offered.includes(uuid));
    return unknown ? refuse("not-offered", { uuid: unknown }) : null;
}

/** The pools whose temporary talismans get the DC stamp (7.4: Talisman Dabbler only), from the registry's `dcStamp`. */
export function dcStampPools(held, rules = DEFAULT_RULES) {
    return heldEffects(held, "dcStamp", rules).map(({ key, effect }) => ({ key, pool: effect.pool, dcs: [...(effect.dcs ?? [])] }));
}

/* -------------------------------------------- */
/*  Loadouts (4.11, 7.5)                         */
/* -------------------------------------------- */

/** One loadout entry checked: a family key, a whole quantity 1-50, and an optional pinned grade. */
function entryOf(entry) {
    if (!entry || typeof entry.family !== "string" || !entry.family) throw new TypeError("a loadout entry names its family");
    const qty = Number(entry.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new RangeError(`a loadout quantity is 1 to ${MAX_QTY}, not ${entry.qty}`);
    return { family: entry.family, qty, ...(entry.uuid ? { uuid: entry.uuid } : {}), ...(entry.name ? { name: entry.name } : {}) };
}

/**
 * A loadout (4.11): `{id, v, name, pools: {<abilitySlug>: [{family, qty, uuid?, name?}]}, talismans: {<abilitySlug>:
 * [uuid]}, talismanHosts: {<family>: hostItemId}, vialMaterials}`. Families, not items, so it resolves to the best grade
 * the pool allows on the day (7.5); `talismans` are the virtual talismans a talisman pool makes, one UUID per talisman
 * (a UUID twice is two of it).
 */
export function makeLoadout({ id, name, pools = {}, talismans = {}, talismanHosts = {}, vialMaterials = null }) {
    if (typeof id !== "string" || !id) throw new TypeError("a loadout needs its id");
    if (typeof name !== "string" || !name.trim()) throw new TypeError("a loadout needs a name");
    const out = { id, v: LOADOUT_VERSION, name: name.trim(), pools: {}, talismans: {}, talismanHosts: { ...talismanHosts }, vialMaterials };
    for (const [slug, entries] of Object.entries(pools ?? {})) {
        if (!Array.isArray(entries)) throw new TypeError(`the entries of pool ${slug} are a list`);
        out.pools[slug] = entries.map(entryOf);
    }
    // A list, not a set: two of one talisman are two picks (Talisman Dabbler and Esoterica never ask for different ones).
    for (const [slug, uuids] of Object.entries(talismans ?? {})) out.talismans[slug] = (uuids ?? []).filter((u) => typeof u === "string" && u).slice(0, MAX_QTY);
    return out;
}

/**
 * The virtual talismans of a preparation record (`flags.MOD.morning.talismans`, `[{pool, uuid, qty}]`) as picks by pool,
 * one UUID per talisman: what "keep" makes again, and what a captured loadout holds (7.4, 7.9).
 */
export function talismanPicksOf(made) {
    const out = {};
    for (const entry of Array.isArray(made) ? made : []) {
        if (typeof entry?.pool !== "string" || typeof entry.uuid !== "string" || !Number.isInteger(entry.qty) || entry.qty < 1) continue;
        (out[entry.pool] ??= []).push(...Array(Math.min(entry.qty, MAX_QTY)).fill(entry.uuid));
    }
    return out;
}

/**
 * What a pool has prepared now, as loadout entries: one per family, the quantities of its grades added, the grade kept
 * as a name only (a loadout resolves its grade again on the day, 7.5).
 *
 * @param {{uuid: string, quantity: number, item: {name: string, type: string, category?: string}}[]} prepared
 */
export function captureEntries(prepared) {
    const byFamily = new Map();
    for (const p of prepared) {
        const family = familyKey(p.item);
        const entry = byFamily.get(family) ?? { family, qty: 0, name: p.item.name };
        entry.qty = Math.min(MAX_QTY, entry.qty + (p.quantity ?? 1));
        byFamily.set(family, entry);
    }
    return [...byFamily.values()];
}

/** Route order when two grades of a family are equally good: one in the book first, then one its family covers, then virtual. */
const ROUTE_RANK = { known: 0, family: 1, virtual: 2 };

/**
 * The grade a loadout entry resolves to (7.5): the highest-level item of its family that the pool may make today (level at
 * most the pool's `maxItemLevel`, which pf2e caps at the character's level, and the pool's own predicate) and that the
 * character can use a formula for (in the book, covered by its family per 6.4, or virtual). A pinned `uuid` resolves to
 * that item only.
 *
 * @param {{family: string, qty: number, uuid?: string}} entry
 * @param {object} ctx
 * @param {object[]} ctx.items               catalogue facts `{uuid, name, type, category, level, rarity, options}`
 * @param {number} ctx.maxItemLevel
 * @param {(item: object) => boolean} ctx.canCraft     the pool's predicate
 * @param {(item: object) => string|null} ctx.routeOf   "known", "family", "virtual" or null
 * @returns {{ok: true, item: object, route: string, qty: number, family: string} | {ok: false, reason: string, data: object}}
 */
export function resolveEntry(entry, { items, maxItemLevel, canCraft, routeOf }) {
    const candidates = entry.uuid ? items.filter((item) => item.uuid === entry.uuid) : items.filter((item) => familyKey(item) === entry.family);
    if (!candidates.length) return refuse("unknown-family", { family: entry.family, name: entry.name ?? null });
    let best = null;
    for (const item of candidates) {
        if (item.level > maxItemLevel || !canCraft(item)) continue;
        const route = routeOf(item);
        if (!route) continue;
        const better = !best || item.level > best.item.level ||
            (item.level === best.item.level && (ROUTE_RANK[route] < ROUTE_RANK[best.route] ||
                (ROUTE_RANK[route] === ROUTE_RANK[best.route] && item.name.localeCompare(best.item.name) < 0)));
        if (better) best = { item, route };
    }
    if (!best) return refuse("no-grade", { family: entry.family, name: entry.name ?? candidates[0].name, maxItemLevel });
    return { ok: true, item: best.item, route: best.route, qty: entry.qty, family: entry.family };
}

/**
 * Resolve a loadout's pools against today's pools (7.5): each entry to its grade, with the batches it takes (its
 * quantity over the pool's batch size for that item, rounded up) and whether the pool has the slots. Entries of one
 * grade are added together. Pools the character does not have today are reported, not dropped silently.
 *
 * @param {Record<string, object[]>} entriesByPool   `{<slug>: [{family, qty, uuid?, standing?, recipient?}]}`
 * @param {Record<string, {maxSlots: number|null, maxItemLevel: number, canCraft: Function, batchSize: Function}>} pools
 * @param {{items: object[], routeOf: Function}} ctx
 */
export function resolvePools(entriesByPool, pools, { items, routeOf }) {
    const out = {};
    const problems = [];
    for (const [slug, entries] of Object.entries(entriesByPool ?? {})) {
        const pool = pools[slug];
        if (!pool) {
            problems.push({ pool: slug, reason: "no-pool" });
            continue;
        }
        const byUuid = new Map();
        for (const entry of entries) {
            const resolved = resolveEntry(entry, { items, maxItemLevel: pool.maxItemLevel, canCraft: pool.canCraft, routeOf });
            if (!resolved.ok) {
                problems.push({ pool: slug, reason: resolved.reason, ...resolved.data, standing: entry.standing ?? null });
                continue;
            }
            const line = byUuid.get(resolved.item.uuid) ?? { uuid: resolved.item.uuid, item: resolved.item, route: resolved.route, family: resolved.family, qty: 0, standing: [] };
            line.qty += resolved.qty;
            if (entry.standing) line.standing.push({ id: entry.standing, qty: entry.qty, recipient: entry.recipient ?? null });
            byUuid.set(resolved.item.uuid, line);
        }
        const lines = [...byUuid.values()].map((line) => {
            const batch = Math.max(1, pool.batchSize(line.item) ?? 1);
            return { ...line, qty: Math.min(line.qty, batch * MAX_QTY), batch, batches: Math.ceil(line.qty / batch) };
        });
        const batches = lines.reduce((sum, line) => sum + line.batches, 0);
        const over = Number.isInteger(pool.maxSlots) && batches > pool.maxSlots;
        if (over) problems.push({ pool: slug, reason: "slots", used: batches, max: pool.maxSlots });
        out[slug] = { lines, batches, max: pool.maxSlots ?? null, over };
    }
    return { pools: out, problems };
}

/**
 * What changes against the last preparation (7.5): formulas not prepared before (`new`), a family now made at another
 * grade (`grade`), a quantity changed (`qty`), and families dropped (`removed`). Lines for party members' standing orders
 * are marked (`request`).
 *
 * @param {Record<string, {uuid: string, quantity: number, item: object}[]>} previous   prepared formulas by pool
 * @param {Record<string, {lines: object[]}>} next   `resolvePools(...).pools`
 */
export function preparationDiff(previous, next) {
    const out = [];
    for (const [slug, pool] of Object.entries(next)) {
        const before = previous[slug] ?? [];
        const families = new Map(before.map((p) => [familyKey(p.item), p]));
        for (const line of pool.lines) {
            const old = families.get(line.family);
            const kind = !old ? "new" : old.uuid !== line.uuid ? "grade" : old.quantity !== line.qty ? "qty" : null;
            if (kind || line.standing.length) out.push({ pool: slug, uuid: line.uuid, name: line.item.name, kind: kind ?? "same", qty: line.qty,
                from: old ? { uuid: old.uuid, name: old.item.name, qty: old.quantity } : null, request: line.standing.length > 0 });
            families.delete(line.family);
        }
        for (const old of families.values()) out.push({ pool: slug, uuid: old.uuid, name: old.item.name, kind: "removed", qty: 0, from: { uuid: old.uuid, name: old.item.name, qty: old.quantity }, request: false });
    }
    return out;
}

/**
 * Where pf2e's prepared list of a pool differs from the plan's lines once the quantities are set (7.5): a line missing or
 * prepared fewer than planned (pf2e refused a new formula with its slots spent, or clamped an increase to the slots
 * left), or a formula prepared that the plan does not have. pf2e rounds a quantity up to whole batches, so more than
 * planned is not a difference.
 *
 * @param {string} pool
 * @param {{uuid: string, qty: number, item?: {name: string}}[]} lines   the plan's lines pf2e prepares (not virtual)
 * @param {{uuid: string, quantity?: number}[]} prepared                 pf2e's prepared formulas (`getPreparedCraftingFormulas`,
 *                                                                        quantities in whole batches)
 * @returns {{pool: string, uuid: string, name: string|null, planned: number, prepared: number}[]}
 */
export function preparedDifferences(pool, lines, prepared) {
    const out = [];
    const quantity = (data) => (data ? data.quantity ?? 1 : 0);
    for (const line of lines) {
        const got = quantity(prepared.find((p) => p.uuid === line.uuid));
        if (got < line.qty) out.push({ pool, uuid: line.uuid, name: line.item?.name ?? null, planned: line.qty, prepared: got });
    }
    const planned = new Set(lines.map((line) => line.uuid));
    for (const data of prepared) if (!planned.has(data.uuid)) out.push({ pool, uuid: data.uuid, name: null, planned: 0, prepared: quantity(data) });
    return out;
}

/* -------------------------------------------- */
/*  Standing orders (4.11, 7.6)                  */
/* -------------------------------------------- */

/**
 * A standing order (4.11): a recurring request ("two healing elixirs every morning") from `requester` to `crafter`,
 * delivered to `recipient`, made in `pool`, from `fromDay` until `untilDay` (inclusive; null for no end). `family` is a
 * family key; `uuid` and `name` say which item the requester had in mind (the grade is resolved on the day).
 */
export function makeStanding({ id, requester, crafter, recipient, pool, family, uuid = null, name = "", qty, fromDay, untilDay = null }, stamp) {
    for (const [field, value] of Object.entries({ id, requester, crafter, recipient, pool, family })) {
        if (typeof value !== "string" || !value) throw new TypeError(`a standing order needs its ${field}`);
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new RangeError(`a standing quantity is 1 to ${MAX_QTY}, not ${qty}`);
    if (!Number.isInteger(fromDay)) throw new TypeError("a standing order starts on a day");
    if (untilDay !== null && (!Number.isInteger(untilDay) || untilDay < fromDay)) throw new RangeError("a standing order ends on or after its first day");
    return { id, v: STANDING_VERSION, requester, crafter, recipient, pool, family, uuid, name, qty, fromDay, untilDay, active: true, last: null, ...stamp };
}

/** The standing orders a crafter fills today (7.6): active, theirs, and within their days; oldest first. */
export function standingDue(standing, { crafter, day }) {
    return standing.filter((s) => s.active && s.crafter === crafter && s.fromDay <= day && (s.untilDay === null || s.untilDay === undefined || s.untilDay >= day))
        .sort((a, b) => (a.fromDay - b.fromDay) || a.id.localeCompare(b.id));
}

/** Whether a standing order was filled in the crafter's cycle already (its `last` record). */
export const filledIn = (standing, cycle) => standing.last?.cycle === cycle;

/**
 * Add the standing orders a crafter fills to a preparation's entries (7.6): each as one more entry of its pool, marked
 * with its id and recipient; one filled this cycle already is left out.
 */
export function withStanding(entriesByPool, due, cycle) {
    const out = Object.fromEntries(Object.entries(entriesByPool ?? {}).map(([slug, entries]) => [slug, [...entries]]));
    for (const s of due) {
        if (filledIn(s, cycle)) continue;
        (out[s.pool] ??= []).push({ family: s.family, qty: s.qty, ...(s.name ? { name: s.name } : {}), standing: s.id, recipient: s.recipient });
    }
    return out;
}

/**
 * What goes to whom after a preparation (7.6): for each standing order, as many items of its resolved grade as it asked
 * for, taken from the run's outputs of that item, never more than the outputs hold. The rest stays with the crafter.
 *
 * @param {{id: string, uuid: string, quantity: number}[]} outputs   the run's new items with the compendium item each was made from
 * @param {{uuid: string, standing: {id: string, qty: number, recipient: string}[]}[]} lines   resolved lines with standing orders
 * @returns {{deliveries: {standing: string, recipient: string, item: string, qty: number}[], short: {standing: string, missing: number}[]}}
 */
export function deliveriesOf(outputs, lines) {
    const left = new Map(outputs.map((o) => [o.id, o.quantity]));
    const deliveries = [];
    const short = [];
    for (const line of lines) {
        for (const s of line.standing ?? []) {
            let need = s.qty;
            for (const output of outputs.filter((o) => o.uuid === line.uuid)) {
                const take = Math.min(need, left.get(output.id) ?? 0);
                if (!take) continue;
                deliveries.push({ standing: s.id, recipient: s.recipient, item: output.id, qty: take });
                left.set(output.id, left.get(output.id) - take);
                need -= take;
                if (!need) break;
            }
            if (need) short.push({ standing: s.id, missing: need });
        }
    }
    return { deliveries, short };
}

/* -------------------------------------------- */
/*  Gap entries and frequencies (7.1, 7.10)      */
/* -------------------------------------------- */

/**
 * The daily features the system has no rule element for (7.10), from the registry's `dailyGap` effects: each `{key,
 * flow}`. `flow` is `note` (a reminder the player ticks off for the day), `designate` (Food Preservation: choose foods
 * exempt from expiry), or `dailies` (pf2e-dailies automates it: shown as handled there while it is active, as not
 * automated otherwise, 7.9).
 */
export function gapEntries(held, { dailies = false } = {}, rules = DEFAULT_RULES) {
    return heldEffects(held, "dailyGap", rules).map(({ key, effect }) => ({
        key, flow: effect.flow ?? "note", handledBy: effect.flow === "dailies" && dailies ? "pf2e-dailies" : null,
        automated: effect.flow !== "dailies" || dailies,
    }));
}

/** The vial sources a character holds (7.3, 8.7), from the registry's `vialSource`: `{key, regain}`. */
export function vialSources(held, rules = DEFAULT_RULES) {
    return heldEffects(held, "vialSource", rules).map(({ key, effect }) => ({ key, regain: effect.regain === true }));
}

/* -------------------------------------------- */
/*  Rest and the preparation cycle (7.2, 7.7, 7.8) */
/* -------------------------------------------- */

/**
 * What a rest starts for a character (7.8): a new preparation cycle (the creator's `prepCycle` goes up, so everything it
 * made at its last preparations expires, 7.7) and one Morning prompt; a character in downtime who does not keep a
 * standing routine (7.2) gets the prompt only, and its infused items keep their own clock.
 */
export function afterRest({ inDowntime = false, standingRoutine = false } = {}) {
    return { cycle: !inDowntime || standingRoutine, prompt: true };
}

/**
 * Where a character stands in its preparation cycle (7.7, 7.8):
 * - `fresh`: a cycle began (a rest) and nothing was prepared in it yet: the Morning prompt's state;
 * - `prepared`: this cycle's preparations are made; preparing again starts a new day's cycle;
 * - `sheet`: pf2e's own daily crafting ran this cycle (from the character sheet), the Workshop did not.
 *
 * @param {{prepCycle: number, morningCycle?: number|null, dailyCraftingComplete?: boolean}} p
 */
export function cycleState({ prepCycle, morningCycle = null, dailyCraftingComplete = false }) {
    if (morningCycle === prepCycle) return "prepared";
    return dailyCraftingComplete ? "sheet" : "fresh";
}

/** Whether a character holds a registry key, for the Morning tab's feature checks (Talismanic Sage, Quick Fix...). */
export const hasKey = (held, key, rules = DEFAULT_RULES) => holds(held, key, rules);
