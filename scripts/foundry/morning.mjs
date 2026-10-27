/**
 * Daily preparations on this client (DESIGN.md 4.11, 7.1-7.7, 7.10, M7): what a character prepares each morning, read
 * from the system, and preparing it through the system's own methods.
 *
 * - **Sources** (7.1): every pf2e `CraftingAbility` of the character with `isDailyPrep` is a pool (pf2e has merged
 *   same-slug sources already; each source's own numbers come from its rule element, `sourcesOf`); prepared abilities
 *   that are not daily (snares) are listed read-only; the versatile vials resource with its item and material buckets
 *   (7.3); the talisman pools' virtual lists (7.4); frequencies of the daily features the registry names; the gap
 *   registry entries (7.10).
 * - **Preparing** (`applyMorning`): each pool keeps its preparation, takes a loadout's families (7.5) or explicit
 *   entries, plus the standing orders due (7.6). Families resolve to their best grade; a grade the book lacks but its
 *   family covers is written into the book first (provenance `family`, 6.4). Prepared quantities are set with
 *   `CraftingAbility#setFormulaQuantity`, then `CharacterCrafting#performDailyCrafting` makes them; a talisman pool's
 *   virtual talismans (no formula book, Player Core 2) are made with `CraftingAbility#craft` without consuming a slot,
 *   counted against the pool's slots here. Nothing writes `system.crafting.entries` or a rule element's `prepared` array
 *   except through those methods (P6).
 * - **What a run made** (7.1): the actor's physical items before and after; new ids and quantity increases are the run's
 *   output; output that merged into a stack with another stamp is split into its own item first; then each output is
 *   stamped (`flags.MOD.expiry`, 4.12), Talisman Dabbler's talismans get the DC stamp (7.4), and the standing orders'
 *   items go to their recipients (directly when this user owns the recipient, else on the pickup shelf, 5.5).
 * - **The cycle** (7.7): a preparation belongs to the creator's current `prepCycle`, raised at the rest before it
 *   (`rest.mjs`). Preparing again in the same cycle ("prepare for a new day", a downtime day without a rest, 7.2) begins
 *   a new cycle and un-expends the pools with `CraftingAbility#updateFormulas`.
 */
import { MODULE_ID } from "../constants.mjs";
import { dcStampFor } from "./affliction-defs.mjs";
import { RANK } from "../logic/core.mjs";
import { familyKey, formulaCoverage } from "../logic/families.mjs";
import { makeProvenance, provenancePath, virtualLists } from "../logic/codex.mjs";
import { ADVANCED_POOL, needsSplit, outputsOf, preservationCap, preservePlan, prepStamp, sameStamp, snapshotOf } from "../logic/expiry.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import {
    TALISMAN_POOLS, captureEntries, correctPool, countsByLevel, cycleState, dcStampPools, deliveriesOf, gapEntries, makeLoadout, makeStanding, mergeSources,
    normalizeBuckets, poolCorrections, poolView, preparationDiff, preparedDifferences, resolvePools, standingDue, talismanChoices, talismanPickProblem, talismanPicksOf, vialSources, vialState,
    withStanding,
} from "../logic/morning.mjs";
import { affixBoard, affixMinutes, dabblerDc, stampInlineChecks } from "../logic/talismans.mjs";
import { heldEffects, heldKeys, testPredicate } from "../logic/registry.mjs";
import { runRequest } from "./batch.mjs";
import { catalogue } from "./catalogue.mjs";
import { today, statusOf } from "./downtime.mjs";
import { beginCycle, isInert, scheduleExpiry, stampOf } from "./expiry.mjs";
import { appendToBook, bookOf } from "./formulas.mjs";
import { heldKeysOf, ranksOf } from "./registry.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { members } from "./roster.mjs";
import { affixTalisman, sageTreated, talismanManagerActive, unaffixTalisman } from "./services.mjs";
import { rulesFromSettings, setting } from "./settings.mjs";
import { canWrite } from "./state.mjs";
import { exists, newId, read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (value) => (typeof value === "string" ? fromUuidSync(value, { strict: false }) : value ?? null);

/** Whether the Morning features are on (14.1 `features.morning`). */
export const morningOn = () => setting("features.morning") !== false;

/** Whether pf2e-dailies is active (13): its rest wrapper and custom dailies change the rest ordering (7.8, 7.9). */
export const dailiesActive = () => game.modules.get("pf2e-dailies")?.active === true;

/** The registry key of each talisman pool's virtual list (7.4). */
export const TALISMAN_LISTS = Object.freeze({ "talisman-dabbler": "talisman-dabbler-dedication", "talisman-esoterica": "talisman-esoterica" });

/** Daily features whose frequency the Morning tab shows (7.1 Frequencies). */
export const FREQUENCY_KEYS = Object.freeze(["improvise-admixture", "fermenting-liquors", "persistent-mutagen", "alchemists-haversack"]);

/** The actor's Morning record (`flags.MOD.morning`): the cycle it last prepared in, what it made, a pf2e-dailies choice. */
export const morningOf = (actor) => actor?.flags?.[MODULE_ID]?.morning ?? {};

/** The actor's loadouts (`flags.MOD.loadouts`, 4.11), by id. */
export function loadoutsOf(actor) {
    const stored = actor?.flags?.[MODULE_ID]?.loadouts ?? {};
    return Object.fromEntries(Object.entries(stored).filter(([, l]) => l && typeof l === "object" && typeof l.name === "string"));
}

/** Physical items of an actor (what a run's snapshot compares). */
const physical = (actor) => [...(actor?.items ?? [])].filter((item) => item.isOfType?.("physical") ?? ["consumable", "equipment", "weapon", "armor", "shield", "ammo", "treasure", "backpack"].includes(item.type));

/** pf2e's abilities of an actor, as a list. */
const abilitiesOf = (actor) => [...(actor?.crafting?.abilities ?? [])];

/** A label pf2e gives as an i18n key or as text. */
const labelOf = (label) => (typeof label === "string" && game.i18n.has?.(label) ? game.i18n.localize(label) : label ?? "");

/** Whether a pool's predicates accept an item's options (pf2e `Predicate#test`). */
function poolAccepts(ability, options) {
    const set = options instanceof Set ? options : new Set(options ?? []);
    return (ability.craftableItems ?? []).some((c) => c.predicate?.test?.(set) ?? false);
}

/** The batch size a pool makes an item in (pf2e's matching craftable definition, else the pool's). */
function batchFor(ability, options) {
    const set = options instanceof Set ? options : new Set(options ?? []);
    const matching = (ability.craftableItems ?? []).find((c) => c.predicate?.test?.(set));
    return matching?.batchSize ?? ability.batchSize ?? 1;
}

/** A rule element's value resolved (`RuleElement#resolveValue`), as a whole number, or null. */
function resolved(rule, value) {
    if (value === undefined || value === null) return null;
    try {
        const n = Math.floor(Number(rule.resolveValue ? rule.resolveValue(value) : value));
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

/**
 * Whether one `CraftingAbility` rule element makes an item (its `craftableItems` predicate, or one of its batch-size
 * definitions, which pf2e merges into the pool's craftable items too).
 */
function ruleAccepts(rule, options) {
    const set = options instanceof Set ? options : new Set(options ?? []);
    const predicates = [rule.craftableItems, ...(rule.batchSizes?.other ?? []).map((other) => other?.definition)];
    return predicates.some((predicate) => predicate && (predicate.length ?? 1) > 0 && (predicate.test?.(set) ?? false));
}

/**
 * Each source of a pool, from the actor's `CraftingAbility` rule elements with its slug (7.1): the item it comes from (and
 * its registry key, for the registry's corrections), its own slot count and item level before pf2e merges them, and
 * whether it makes an item.
 */
export function sourcesOf(actor, slug) {
    return (actor?.rules ?? []).filter((rule) => rule.key === "CraftingAbility" && rule.slug === slug && !rule.ignored).map((rule) => ({
        key: rule.item?.slug ?? rule.item?.id ?? slug, name: rule.item?.name ?? slug, maxSlots: resolved(rule, rule.maxSlots),
        maxItemLevel: resolved(rule, rule.maxItemLevel) ?? actor.level ?? null, batchSize: rule.batchSizes?.default ?? null,
        registryKey: heldKeys([{ sourceId: rule.item?.sourceId ?? null, slug: rule.item?.slug ?? null, selections: {} }])[0] ?? null,
        accepts: (options) => ruleAccepts(rule, options),
    }));
}

/** Versatile vials (7.3): the resource (authoritative), the vial items, their level and material buckets. */
export function vialsOf(actor) {
    const resource = actor?.getResource?.("versatile-vials") ?? null;
    if (!resource) return null;
    const itemUuid = actor.synthetics?.resources?.versatileVials?.itemUUID ?? null;
    const items = itemUuid ? physical(actor).filter((item) => item.sourceId === itemUuid) : [];
    const inventory = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    const first = items[0] ?? null;
    const buckets = first?.flags?.[MODULE_ID]?.vialMaterials ?? null;
    return {
        ...vialState({ value: resource.value ?? 0, max: resource.max ?? 0, inventory, level: first?.level ?? null }),
        label: resource.label ?? null, item: first?.id ?? null, stacks: items.length,
        buckets: buckets ? normalizeBuckets(buckets, resource.value ?? 0) : null,
    };
}

/** The frequencies of the daily features the registry names (7.1), from the actor's items. */
function frequenciesOf(actor, held) {
    const keys = new Set(held.map((h) => h.split(":")[0]));
    return [...(actor?.items ?? [])].filter((item) => FREQUENCY_KEYS.includes(item.slug) && keys.has(item.slug) && item.frequency).map((item) => ({
        key: item.slug, name: item.name, value: item.frequency.value ?? 0, max: item.frequency.max ?? 0, per: item.frequency.per ?? null,
    }));
}

/** The highest of the actor's class DC and spell DCs (7.4 Talisman Dabbler). */
export function creatorDcs(actor) {
    const classDc = actor?.classDC?.dc?.value ?? actor?.system?.attributes?.classDC?.value ?? null;
    const spellDcs = [...(actor?.spellcasting?.regular ?? [])].map((entry) => entry?.statistic?.dc?.value).filter(Number.isInteger);
    return { classDc: Number.isInteger(classDc) ? classDc : null, spellDc: spellDcs.length ? Math.max(...spellDcs) : null };
}

/**
 * Everything the Morning tab and a preparation read about a character (7.1): its pools with their prepared formulas
 * and sources, other prepared slots, vials, talisman pools' pickers, frequencies, gap entries, its cycle and loadouts.
 * A pool the registry corrects (6.11 `correction`: Herbalist's two fewer outside the wilderness, Lethargy Poisoner's doses
 * by rank and Stupor Poison from expert, the alchemist archetype's Advanced Alchemy making consumables only) carries the
 * corrected count as `maxSlots` (pf2e's in `systemMaxSlots`) and the corrected predicate as `accepts`.
 *
 * @param {Actor} actor
 * @param {object} [rules]
 * @param {{wilderness?: boolean}} [context]   whether this preparation is made in the wilderness (Herbalist)
 */
export async function morningFacts(actor, rules = rulesFromSettings(), { wilderness = false } = {}) {
    const held = heldKeysOf(actor);
    const ranks = ranksOf(actor);
    const items = await catalogue();
    const byUuid = new Map(items.map((item) => [item.uuid, item]));
    const book = new Set(bookOf(actor));
    const known = [...book].map((uuid) => byUuid.get(uuid)).filter(Boolean);
    const lists = new Map(virtualLists(held, items, actor.level ?? 1, rules).map((list) => [list.key, list.items]));
    const stamps = new Set(dcStampPools(held, rules).map((p) => p.pool));
    const pools = [];
    const slots = [];
    for (const ability of abilitiesOf(actor)) {
        const prepared = (await ability.getPreparedCraftingFormulas?.() ?? []).map((p) => ({
            uuid: p.uuid, item: p.item, name: p.item?.name ?? p.uuid, img: p.item?.img ?? null, level: p.item?.level ?? 0,
            quantity: p.quantity ?? 0, batches: p.batches ?? 1, expended: !!p.expended,
        }));
        const base = { slug: ability.slug, label: labelOf(ability.label), ability, maxSlots: Number.isInteger(ability.maxSlots) && ability.maxSlots > 0 ? ability.maxSlots : null,
            maxItemLevel: ability.maxItemLevel ?? actor.level ?? 0, prepared };
        if (!ability.isDailyPrep) {
            if (ability.isPrepared) slots.push({ ...base, byLevel: countsByLevel(prepared) });
            continue;
        }
        const sources = sourcesOf(actor, ability.slug);
        const fix = correctPool({ maxSlots: base.maxSlots, sources }, poolCorrections(held, ability.slug, rules), { ranks, context: { wilderness } });
        const accepts = (options) => poolAccepts(ability, options) && fix.accepts(options instanceof Set ? options : new Set(options ?? []));
        const pool = { ...base, maxSlots: fix.maxSlots, systemMaxSlots: base.maxSlots };
        const talisman = TALISMAN_POOLS.includes(ability.slug);
        const listKey = TALISMAN_LISTS[ability.slug];
        const offered = talisman && lists.has(listKey)
            ? talismanChoices(lists.get(listKey), { maxItemLevel: base.maxItemLevel, canCraft: (item) => accepts(item.options) })
            : [];
        pools.push({
            ...pool, ...poolView(pool), sources: fix.sources, merged: mergeSources(sources), talisman, offered, dcStamp: stamps.has(ability.slug),
            batchSize: ability.batchSize ?? 1, resource: ability.resource ?? null, accepts, corrected: fix.corrected, contexts: fix.contexts,
        });
    }
    const status = statusOf(actor);
    const morning = morningOf(actor);
    return {
        actor, held, items, byUuid, book, known, pools, slots, vials: vialsOf(actor), vialSources: vialSources(held, rules),
        frequencies: frequenciesOf(actor, held), gaps: gapEntries(held, { dailies: dailiesActive() }, rules), status, morning,
        state: cycleState({ prepCycle: status.prepCycle, morningCycle: Number.isInteger(morning.cycle) ? morning.cycle : null,
            dailyCraftingComplete: actor.flags?.pf2e?.dailyCraftingComplete === true }),
        loadouts: loadoutsOf(actor), dcs: creatorDcs(actor), rules, wilderness,
    };
}

/**
 * How a character may come by a formula for an item in a pool (7.5): `known` (in the book), `family` (another grade in the
 * book covers it, 6.4; not for talisman pools, which need no book), `virtual` (a talisman pool's virtual list), or null.
 */
function routeOfFor(facts, pool) {
    const offered = new Set(pool.offered.map((item) => item.uuid));
    return (item) => {
        if (facts.book.has(item.uuid)) return "known";
        if (pool.talisman) return offered.has(item.uuid) ? "virtual" : null;
        return formulaCoverage(facts.known, item, facts.rules)?.route === "family" ? "family" : null;
    };
}

/** The pools as `resolvePools` reads them: the corrected count and predicate (7.1). */
function poolInputs(facts) {
    return Object.fromEntries(facts.pools.map((pool) => [pool.slug, {
        maxSlots: pool.maxSlots, maxItemLevel: pool.maxItemLevel, canCraft: (item) => pool.accepts(item.options),
        batchSize: (item) => batchFor(pool.ability, item.options),
    }]));
}

/* -------------------------------------------- */
/*  Planning a preparation                       */
/* -------------------------------------------- */

/** The standing orders a preparation fills: all due (`"due"`), none, or those named. */
function standingChosen(actor, choice, day) {
    const due = standingDue(records("standing"), { crafter: actor.uuid, day });
    if (choice === "due") return due;
    if (!Array.isArray(choice)) return [];
    return due.filter((s) => choice.includes(s.id));
}

/**
 * The plan of a preparation, without making anything (the Morning tab's preview and `applyMorning`'s first step):
 * each pool's mode (`keep` its preparation, `set` new entries), the entries resolved to grades, the virtual talismans,
 * the standing orders filled, problems, and the diff against the last preparation (7.5).
 *
 * @param {object} facts   `morningFacts`
 * @param {object} p
 * @param {Record<string, {mode: "keep"|"set"|"loadout", entries?: object[], id?: string}>} [p.pools]
 * @param {Record<string, string[]>} [p.talismans]   virtual talismans a talisman pool makes, by pool
 * @param {"due"|string[]} [p.standing]
 * @param {number} [p.cycle]
 */
export function planMorning(facts, { pools: plans = {}, talismans = {}, standing = "due", cycle = facts.status.prepCycle } = {}) {
    const entries = {};
    const modes = {};
    const picks = { ...talismans };
    const problems = [];
    let vialMaterials = null;
    for (const pool of facts.pools) {
        const plan = plans[pool.slug] ?? { mode: "keep" };
        if (plan.mode === "loadout") {
            const loadout = facts.loadouts[plan.id];
            if (!loadout) {
                problems.push({ pool: pool.slug, reason: "no-loadout" });
                continue;
            }
            if (loadout.pools?.[pool.slug]) {
                entries[pool.slug] = loadout.pools[pool.slug];
                modes[pool.slug] = "set";
            }
            if (loadout.talismans?.[pool.slug] && !picks[pool.slug]) picks[pool.slug] = loadout.talismans[pool.slug];
            if (loadout.vialMaterials) vialMaterials = loadout.vialMaterials;
        } else if (plan.mode === "set") {
            entries[pool.slug] = plan.entries ?? [];
            modes[pool.slug] = "set";
        }
        modes[pool.slug] ??= "keep";
    }
    // A pool kept as it is that asks for more than the rules allow: pf2e's own count is wrong there (a registry correction,
    // 7.1), so pf2e would make it all; the plan says no instead.
    for (const pool of facts.pools) {
        if (modes[pool.slug] === "keep" && pool.corrected && pool.insufficient) problems.push({ pool: pool.slug, reason: "slots", used: pool.used, max: pool.max, corrected: true });
    }
    const due = standingChosen(facts.actor, standing, today().day);
    const withOrders = withStanding(entries, due, cycle);
    // A pool kept as it is with standing orders added: its current preparation pinned, the orders on top.
    for (const [slug, list] of Object.entries(withOrders)) {
        if (modes[slug] === "set" || !list.length) continue;
        const pool = facts.pools.find((p) => p.slug === slug);
        if (!pool) continue;
        withOrders[slug] = [...pinned(pool), ...list];
        modes[slug] = "set";
    }
    // Virtual talismans join their pool's lines (one each).
    for (const [slug, uuids] of Object.entries(picks)) {
        const pool = facts.pools.find((p) => p.slug === slug);
        if (!pool?.talisman || !uuids?.length) continue;
        const problem = talismanPickProblem(uuids, { maxSlots: null, offered: pool.offered.map((i) => i.uuid) });
        if (problem) {
            problems.push({ pool: slug, reason: problem.reason, ...problem.data });
            continue;
        }
        const kept = modes[slug] === "set" ? withOrders[slug] ?? [] : pinned(pool);
        withOrders[slug] = [...kept, ...uuids.map((uuid) => {
            const item = facts.byUuid.get(uuid);
            return { family: item ? familyKey(item) : uuid, uuid, qty: 1, name: item?.name };
        })];
        modes[slug] = "set";
    }
    const setPools = Object.fromEntries(Object.entries(withOrders).filter(([slug]) => modes[slug] === "set"));
    const items = facts.items;
    const resolvedPools = {};
    for (const pool of facts.pools.filter((p) => setPools[p.slug])) {
        const resolve = (list) => resolvePools({ [pool.slug]: list }, poolInputs(facts), { items: itemsFor(items, list, facts), routeOf: routeOfFor(facts, pool) });
        // A party member's standing order never blocks the crafter's own preparation: one that would take the pool past its
        // slots is left out for today (7.6), and said so.
        const own = setPools[pool.slug].filter((e) => !e.standing);
        let list = own;
        let r = resolve(list);
        for (const order of setPools[pool.slug].filter((e) => e.standing)) {
            const tried = resolve([...list, order]);
            if (tried.pools[pool.slug]?.over && !r.pools[pool.slug]?.over) {
                problems.push({ pool: pool.slug, reason: "standing-slots", standing: order.standing, name: order.name ?? null });
                continue;
            }
            list = [...list, order];
            r = tried;
        }
        Object.assign(resolvedPools, r.pools);
        problems.push(...r.problems);
    }
    const previous = Object.fromEntries(facts.pools.map((pool) => [pool.slug, pool.prepared.filter((p) => p.item)]));
    return { modes, pools: resolvedPools, problems, due, diff: preparationDiff(previous, resolvedPools), cycle, vialMaterials };
}

/** A pool's current preparation as entries pinned to their grades (kept as it is, with orders or talismans added). */
function pinned(pool) {
    return pool.prepared.filter((p) => p.item).map((p) => ({ family: familyKey(p.item), uuid: p.uuid, qty: p.quantity, name: p.name }));
}

/**
 * The catalogue facts entries resolve against: the catalogue, plus a pinned grade that is not in it (a homebrew formula in
 * the book) read from the actor's prepared item; pinned entries (`uuid:` families) match by UUID.
 */
function itemsFor(items, entries, facts) {
    const extra = [];
    for (const entry of entries) {
        if (!entry.uuid || facts.byUuid.has(entry.uuid)) continue;
        const item = facts.pools.flatMap((p) => p.prepared).find((p) => p.uuid === entry.uuid)?.item;
        if (item) extra.push({ uuid: entry.uuid, name: item.name, type: item.type, category: item.category ?? null, level: item.level ?? 0, rarity: item.rarity ?? "common",
            options: [...(item.getRollOptions?.("item") ?? [])] });
    }
    return extra.length ? [...items, ...extra] : items;
}

/* -------------------------------------------- */
/*  Preparing                                    */
/* -------------------------------------------- */

/** Actors this client is preparing now: a second click waits for the first (and the sheet stamper leaves them alone). */
const applying = new Set();

/** Whether this client is in the middle of preparing `actor`. */
export const isApplying = (actor) => applying.has(actor?.id);

/** Wait until `test()` holds, at most `ms`. */
async function until(test, ms = 2000) {
    const end = Date.now() + ms;
    while (!test() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
    return test();
}

/**
 * The stamp flags (and, for Talisman Dabbler, the DC stamp's description) an output gets; for an infused output that allows a
 * save, the creator's Powerful Alchemy DC stamp when it raises the printed DC (M8a, 8.10.4).
 */
function stampUpdate(item, stamp, { dc = null, creator = null } = {}) {
    const update = { [`flags.${MODULE_ID}.expiry`]: stamp };
    if (dc !== null) {
        const text = item.system?.description?.value ?? "";
        const out = stampInlineChecks(text, dc);
        if (out.changed > 0) {
            update["system.description.value"] = out.text;
            update[`flags.${MODULE_ID}.dcStamp`] = { dc, printed: out.printed, pool: stamp.pool, by: stamp.creator };
        }
    }
    if (!update[`flags.${MODULE_ID}.dcStamp`] && creator) {
        const dcStamp = dcStampFor(creator, item);
        if (dcStamp) update[`flags.${MODULE_ID}.dcStamp`] = dcStamp;
    }
    return update;
}

/**
 * Stamp a run's outputs (7.1 steps 3-4): an output merged into a stack with another stamp is split into an item of its
 * own (one request: the copy created with its own id, the stack set back), the rest stamped in place. Returns the
 * outputs with the ids they ended up on.
 *
 * @param {Actor} actor
 * @param {{id: string, added: number, merged: boolean, before: number, pool: string|null, uuid: string|null}[]} outputs
 * @param {(output) => object} stampFor
 * @param {(output) => number|null} dcFor
 */
async function stampOutputs(actor, outputs, stampFor, dcFor) {
    const updates = [];
    const out = [];
    for (const output of outputs) {
        const item = actor.items.get(output.id);
        if (!item) continue;
        const stamp = stampFor(output);
        const extra = stampUpdate(item, stamp, { dc: dcFor(output), creator: actor });
        if (needsSplit(output, stampOf(item), stamp)) {
            const copy = item.toObject();
            copy._id = newId();
            copy.system.quantity = output.added;
            // The copy is this run's output: the stack's own module flags (its stamp, a delivery, an inert mark) stay with it.
            copy.flags = { ...(copy.flags ?? {}), [MODULE_ID]: { expiry: stamp } };
            if (extra["system.description.value"]) foundry.utils.setProperty(copy, "system.description.value", extra["system.description.value"]);
            if (extra[`flags.${MODULE_ID}.dcStamp`]) copy.flags[MODULE_ID].dcStamp = extra[`flags.${MODULE_ID}.dcStamp`];
            const split = await runRequest([
                { op: "createItems", target: actor.uuid, data: [copy] },
                { op: "updateItems", target: actor.uuid, updates: [{ _id: item.id, "system.quantity": output.before }] },
            ]);
            if (split.outcome === "ok") out.push({ ...output, id: copy._id, quantity: output.added });
            continue;
        }
        if (!sameStamp(stampOf(item), stamp) || Object.keys(extra).length > 1) updates.push({ _id: item.id, ...extra });
        out.push({ ...output, quantity: item.quantity });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    return out;
}

/**
 * Deliver a standing order's items (7.6): behind the lock page of the order in this cycle, one request moves `qty` of the
 * output to the recipient (created on it when this user owns it, else put on the pickup shelf in the strongbox for the
 * recipient's client to collect, 5.5) and records it as filled. The expiry stamp travels with the items.
 */
async function deliverStanding(actor, delivery, cycle) {
    const item = actor.items.get(delivery.item);
    const recipient = actorOf(delivery.recipient);
    if (!item || !recipient) return { ok: false, reason: "no-item", standing: delivery.standing };
    const key = idemKey("standing", delivery.standing, actor.id, String(cycle));
    if (recipient === actor) {
        await write({ set: { [`standing.${delivery.standing}.last`]: { cycle, day: today().day, qty: delivery.qty, to: actor.uuid, ...stampNow() } } });
        return { ok: true, outcome: "self", standing: delivery.standing, direct: true, recipient: actor.name, qty: delivery.qty, name: item.name };
    }
    const source = item.toObject();
    delete source._id;
    source.system.quantity = delivery.qty;
    const direct = recipient.isOwner && recipient !== actor;
    // The shelf item's own delivery key, never the lock's: `claims.deliver` locks the hash of its key as the delivered
    // row's id, and this request's lock page already holds `hashId(key)`, so the same key could never be collected.
    const claimKey = idemKey("deliver", "standing", delivery.standing, actor.id, String(cycle));
    if (!direct) foundry.utils.setProperty(source, `flags.${MODULE_ID}.shelf`, { for: recipient.uuid, from: actor.uuid, order: null, claimKey, at: stampNow().at });
    const left = item.quantity - delivery.qty;
    const stamp = stampNow();
    const result = await runRequest([
        { op: "lock", ids: [hashId(key)] },
        { op: "ledger", change: { set: { [`standing.${delivery.standing}.last`]: { cycle, day: today().day, qty: delivery.qty, to: direct ? recipient.uuid : "shelf", ...stamp } } } },
        { op: "createItems", target: direct ? recipient.uuid : "strongbox", data: [source] },
        left > 0 ? { op: "updateItems", target: actor.uuid, updates: [{ _id: item.id, "system.quantity": left }] } : { op: "deleteItems", target: actor.uuid, ids: [item.id] },
    ]);
    if (result.outcome === "refused") return { ok: true, outcome: "already", standing: delivery.standing };
    return { ok: result.outcome === "ok", outcome: result.outcome, standing: delivery.standing, direct, recipient: recipient.name, qty: delivery.qty, name: item.name };
}

/**
 * Keep the vial item's material buckets (`flags.MOD.vialMaterials`, 7.3) in step with the `versatile-vials` resource, which
 * counts: buckets a loadout names, else the ones the item has, normalized to the resource's value. Nothing is written when
 * the character has no buckets (no Advanced Vials choice yet) or they already agree; the vial item is never deleted or
 * made again.
 */
export async function syncVials(actor, materials = null) {
    const vials = vialsOf(actor);
    if (!vials?.item) return false;
    const item = actor.items.get(vials.item);
    const current = item?.flags?.[MODULE_ID]?.vialMaterials ?? null;
    const wanted = materials ?? current;
    if (!wanted) return false;
    const next = normalizeBuckets(wanted, vials.value);
    if (JSON.stringify(next) === JSON.stringify(current)) return false;
    await item.update({ [`flags.${MODULE_ID}.vialMaterials`]: _replace(next) });
    return true;
}

/** Which pool and compendium item each output came from, by the items pf2e was about to make (its own `calculateDailyCrafting` order). */
async function plannedItems(actor) {
    const out = [];
    for (const ability of abilitiesOf(actor).filter((a) => a.isDailyPrep)) {
        for (const p of await ability.getPreparedCraftingFormulas?.() ?? []) {
            if (!p.expended && p.item) out.push({ pool: ability.slug, uuid: p.uuid, slug: p.item.slug ?? null, name: p.item.name });
        }
    }
    return out;
}

/** The pool and compendium item of an output item, matched by its pf2e slug (or name) against the planned items. */
function originOf(item, planned) {
    const slug = item.slug ?? item.system?.slug ?? null;
    const match = planned.find((p) => (slug && p.slug === slug) || p.name === item.name);
    return match ? { pool: match.pool, uuid: match.uuid } : { pool: null, uuid: null };
}

/** The lock page of one attempt at a character's preparations in a cycle (7.7): two clients never both prepare it. */
export const prepLockId = (actorId, cycle, attempt) => hashId(idemKey("prep", actorId, String(cycle), String(attempt)));

/** Which attempt at this cycle's preparations comes next: a refused attempt (pf2e's, `system`) moves on to a new lock. */
function attemptOf(actor, cycle) {
    const attempt = morningOf(actor).attempt;
    return attempt?.cycle === cycle && Number.isInteger(attempt.n) ? attempt.n : 0;
}

/**
 * Make a character's daily preparations (7.1, 7.5, 7.6), on its owner's client. Refusals: `not-ready`, `off`,
 * `no-actor`, `not-owner`, `busy` (this client is preparing it already, or another client holds this cycle's lock page),
 * `prepared` (this cycle's preparations are made: pass `again` to begin a new day's cycle), `sheet` (pf2e's daily crafting
 * ran this cycle from the sheet; its items were stamped), `plan` (a pool asks for more than its slots, or an entry has no
 * grade it can make; `data.problems`; a standing order that does not fit is left out instead, as a problem with its
 * `standing` id), `system` (pf2e did not take the plan: its prepared list differs from it, `data.differences`, or its daily
 * crafting refused a pool beyond its own slots or resource).
 *
 * Every client a character's owners use may press "Make daily preparations" (a player's two devices, the GM's tab): the
 * preparation of a cycle runs behind the lock page `prep:<actorId>:<cycle>:<attempt>`, so one of them prepares and the
 * others are refused `busy`. A `system` refusal (nothing made) moves on to the next attempt, so the player can try again.
 *
 * @param {Actor|string} actorRef
 * @param {object} [p]   `planMorning`'s plan, plus `again`
 * @returns {Promise<{ok: boolean, cycle?: number, created?: object[], deliveries?: object[], reason?: string, data?: object}>}
 */
export async function applyMorning(actorRef, { pools = {}, talismans = {}, standing = "due", again = false, nonce = newId(), choice = false, wilderness = false } = {}) {
    if (!canWrite()) return refuse("not-ready");
    if (!morningOn()) return refuse("off");
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    if (applying.has(actor.id)) return refuse("busy");
    applying.add(actor.id);
    try {
        const facts = await morningFacts(actor, undefined, { wilderness });
        if (facts.state === "prepared" && !again) return refuse("prepared", { cycle: facts.status.prepCycle });
        if (facts.state === "sheet" && !again) return refuse("sheet", { cycle: facts.status.prepCycle });
        // Check the plan before anything moves: a refused plan changes nothing, not even the cycle.
        const preview = planMorning(facts, { pools, talismans, standing, cycle: facts.status.prepCycle + (facts.state === "fresh" ? 0 : 1) });
        const fatal = preview.problems.filter((p) => !p.standing);
        if (fatal.length) return refuse("plan", { problems: fatal });
        let cycle = facts.status.prepCycle;
        if (facts.state !== "fresh") {
            const begun = await beginCycle(actor, { key: `again:${nonce}`, reason: "again" });
            if (!begun.ok) return begun;
            cycle = begun.cycle;
        }
        // One client prepares a cycle: whoever creates this attempt's lock page first.
        const attempt = attemptOf(actor, cycle);
        const lock = await runRequest([{ op: "lock", ids: [prepLockId(actor.id, cycle, attempt)] }]);
        if (lock.outcome !== "ok") return refuse("busy", { cycle });
        let made = false;
        const retry = () => actor.update({ [`flags.${MODULE_ID}.morning.applying`]: null, [`flags.${MODULE_ID}.morning.attempt`]: { cycle, n: attempt + 1 } });
        try {
            return await prepareLocked(actor, { facts, again: facts.state !== "fresh", cycle, pools, talismans, standing, choice, wilderness, retry,
                making: () => { made = true; } });
        } catch (error) {
            // Nothing was made yet: the next try takes a new lock. Once pf2e's daily crafting has been asked, it may have made
            // something, so the lock stands ("Prepare for a new day" begins a new cycle).
            if (!made) await retry().catch(() => {});
            throw error;
        }
    } finally {
        applying.delete(actor.id);
    }
}

/** The preparation itself, behind this cycle's lock page (`applyMorning`). */
async function prepareLocked(actor, { facts, again, cycle, pools, talismans, standing, choice, wilderness, retry, making }) {
    if (again) {
        for (const ability of abilitiesOf(actor).filter((a) => a.isDailyPrep && a.preparedFormulaData?.some((f) => f.expended))) {
            await ability.updateFormulas(ability.preparedFormulaData.map((f) => ({ ...f, expended: false })));
        }
        facts = await morningFacts(actor, undefined, { wilderness });
    }
    await actor.update({ [`flags.${MODULE_ID}.morning.applying`]: { cycle, at: stampNow().at } });
    const plan = planMorning(facts, { pools, talismans, standing, cycle });
    // 1. Grades the book lacks but their family covers: written into the book first (6.4, provenance `family`).
    for (const [slug, pool] of Object.entries(plan.pools)) {
        if (TALISMAN_POOLS.includes(slug)) continue;
        for (const line of pool.lines.filter((l) => l.route === "family")) {
            if (await appendToBook(actor, line.uuid)) {
                const path = provenancePath(actor.id, line.uuid);
                if (!exists(path)) await write({ set: { [path]: makeProvenance({ uuid: line.uuid, route: "family", source: line.family, day: today().day }, stampNow()) } });
            }
        }
    }
    // 2. Prepared quantities through pf2e (setFormulaQuantity), for the pools whose plan changes them. pf2e refuses a new
    // formula once the slots are spent and clamps an increase to the slots left, so slots are freed first: formulas
    // the plan drops, then every decrease, then the increases and new formulas.
    const differences = [];
    for (const [slug, pool] of Object.entries(plan.pools)) {
        const ability = () => abilitiesOf(actor).find((a) => a.slug === slug);
        if (!ability()) continue;
        const system = pool.lines.filter((l) => l.route !== "virtual");
        const keep = new Set(system.map((l) => l.uuid));
        for (const p of [...(ability().preparedFormulaData ?? [])]) if (!keep.has(p.uuid)) await ability().setFormulaQuantity(p.uuid, 0);
        // pf2e's own view of the list, in whole batches: a line already prepared at its batches is left alone (pf2e makes
        // whole batches, and refuses even a same-batch increase in a full pool).
        const prepared = async () => new Map((await ability().getPreparedCraftingFormulas?.() ?? []).map((p) => [p.uuid, p]));
        const now = await prepared();
        const unchanged = (line) => now.has(line.uuid) && now.get(line.uuid).batches === Math.ceil(line.qty / (now.get(line.uuid).batchSize || 1));
        const current = (line) => now.get(line.uuid)?.quantity ?? 0;
        const changing = system.filter((line) => !unchanged(line));
        const ordered = [...changing.filter((l) => current(l) > l.qty), ...changing.filter((l) => current(l) <= l.qty)];
        for (const line of ordered) await ability().setFormulaQuantity(line.uuid, line.qty);
        differences.push(...preparedDifferences(slug, system, [...(await prepared()).values()]));
    }
    if (differences.length) {
        // pf2e did not take the plan as it is (a slot it would not free, a formula it would not prepare): nothing is made
        // from a list that is not the plan, and the player may prepare again in this cycle.
        await retry();
        return refuse("system", { differences });
    }
    // 3. Make them: pf2e's daily crafting, then the virtual talismans (no slot spent, no book).
    const planned = await plannedItems(actor);
    const before = snapshotOf(physical(actor));
    making();
    await actor.crafting.performDailyCrafting();
    if (planned.length && actor.flags?.pf2e?.dailyCraftingComplete !== true) {
        // pf2e stopped before making anything (a pool asks for more than its slots or resource, with its own warning):
        // nothing is recorded, so the player can fix the pool and prepare again in this cycle.
        await retry();
        return refuse("system");
    }
    const middle = snapshotOf(physical(actor));
    const crafted = new Map();
    for (const [slug, pool] of Object.entries(plan.pools)) {
        const ability = abilitiesOf(actor).find((a) => a.slug === slug);
        for (const line of pool.lines.filter((l) => l.route === "virtual")) {
            for (let i = 0; i < Math.ceil(line.qty / line.batch); i++) {
                const made = await ability?.craft(line.uuid, { consume: false });
                if (!made) continue;
                const entry = crafted.get(made.id) ?? { pool: slug, uuid: line.uuid, calls: 0, batch: line.batch };
                entry.calls += 1;
                crafted.set(made.id, entry);
            }
        }
    }
    // pf2e's `craft` adds to a stack without waiting for the update: wait until every quantity has landed.
    await until(() => [...crafted].every(([id, c]) => (actor.items.get(id)?.quantity ?? 0) >= (middle[id] ?? 0) + c.calls * c.batch));
    const all = outputsOf(before, physical(actor).map((item) => ({ id: item.id, quantity: item.quantity })))
        .map((o) => ({ ...o, ...(crafted.has(o.id) ? { pool: crafted.get(o.id).pool, uuid: crafted.get(o.id).uuid } : originOf(actor.items.get(o.id), planned)) }))
        .filter((o) => o.pool);
    // 4. Stamp (4.12, 7.7) and the Talisman Dabbler DC stamp (7.4).
    const day = today().day;
    const stampPools = new Set(facts.pools.filter((p) => p.dcStamp).map((p) => p.slug));
    const dc = dabblerDc(facts.dcs);
    const stamped = await stampOutputs(actor, all,
        (o) => prepStamp({ creator: actor.uuid, cycle, pool: o.pool, worldTime: game.time.worldTime, day }),
        (o) => (stampPools.has(o.pool) ? dc : null));
    const created = stamped.map((o) => ({ id: o.id, uuid: o.uuid, pool: o.pool, qty: o.added, name: actor.items.get(o.id)?.name ?? null }));
    // 5. Standing orders (7.6).
    const lines = Object.values(plan.pools).flatMap((p) => p.lines).filter((l) => l.standing.length);
    // Only this run's output is handed out, never what its stack held before (`added`, not the stack's quantity).
    const { deliveries, short } = deliveriesOf(stamped.filter((o) => o.uuid).map((o) => ({ ...o, quantity: o.added })), lines);
    const delivered = [];
    for (const delivery of deliveries) delivered.push(await deliverStanding(actor, delivery, cycle));
    // 6. Advanced Vials' material buckets kept in step with the vials the resource counts (7.3).
    await syncVials(actor, plan.vialMaterials);
    // 7. The record (with the virtual talismans made, which a kept pool makes again, 7.9), the hook and the card.
    const virtual = Object.entries(plan.pools).flatMap(([slug, pool]) => pool.lines.filter((l) => l.route === "virtual")
        .map((l) => ({ pool: slug, uuid: l.uuid, qty: l.qty })));
    await actor.update({ [`flags.${MODULE_ID}.morning`]: {
        cycle, day, at: stampNow().at, created: created.map((c) => c.id).filter((id) => actor.items.get(id)), applying: null, talismans: virtual, wilderness,
        choice: choice ? { ...(morningOf(actor).choice ?? {}), applied: stampNow().at } : morningOf(actor).choice ?? null,
        gaps: morningOf(actor).gaps ?? {},
    } });
    scheduleExpiry();
    const result = { ok: true, cycle, created, deliveries: delivered, short, problems: plan.problems, dc: stampPools.size ? dc : null };
    Hooks.callAll(`${MODULE_ID}.preparationCompleted`, Object.freeze({ actor, cycle, created }));
    // The Morning summary card (10.5), from this client only (12.3: hooks fire on the client that wrote).
    Hooks.callAll(`${MODULE_ID}.morningSummary`, Object.freeze({ actor, result }));
    return result;
}

/* -------------------------------------------- */
/*  Daily crafting from the sheet                */
/* -------------------------------------------- */

/**
 * Stamp what pf2e's own daily crafting made from the character sheet (7.7: items the system creates through a crafting
 * ability are stamped too): temporary items with no stamp whose slug is one of the daily pools' prepared formulas, with
 * the current cycle; Talisman Dabbler's get the DC stamp. Runs on the actor's responsible client once its items settle,
 * never while this client prepares it through the Workshop.
 */
export async function stampSheetCrafting(actor) {
    if (!canWrite() || !actor?.isOwner || applying.has(actor.id)) return [];
    const morning = morningOf(actor);
    if (morning.applying && Date.now() - (morning.applying.at?.real ?? 0) < 60000) return [];
    const status = statusOf(actor);
    const planned = [];
    for (const ability of abilitiesOf(actor).filter((a) => a.isDailyPrep)) {
        for (const p of await ability.getPreparedCraftingFormulas?.() ?? []) if (p.item) planned.push({ pool: ability.slug, uuid: p.uuid, slug: p.item.slug ?? null, name: p.item.name });
    }
    const day = today().day;
    const dc = dabblerDc(creatorDcs(actor));
    const stampPools = new Set(dcStampPools(heldKeysOf(actor)).map((p) => p.pool));
    const updates = [];
    for (const item of physical(actor)) {
        if (!item.system?.temporary || stampOf(item) || isInert(item)) continue;
        const origin = originOf(item, planned);
        if (!origin.pool) continue;
        const stamp = prepStamp({ creator: actor.uuid, cycle: status.prepCycle, pool: origin.pool, worldTime: game.time.worldTime, day });
        updates.push({ _id: item.id, ...stampUpdate(item, stamp, { dc: stampPools.has(origin.pool) ? dc : null }) });
    }
    if (updates.length) {
        await actor.updateEmbeddedDocuments("Item", updates);
        await actor.update({ [`flags.${MODULE_ID}.morning.sheetCycle`]: status.prepCycle });
    }
    return updates.map((u) => u._id);
}

/* -------------------------------------------- */
/*  Loadouts (4.11, 7.5)                         */
/* -------------------------------------------- */

/** Save a loadout on the character (its owner): replaced whole, so removed pools do not linger. */
export async function saveLoadout(actorRef, data) {
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    let loadout;
    try {
        loadout = makeLoadout({ id: data.id ?? newId(), ...data });
    } catch (error) {
        return refuse("bad-loadout", { message: error.message });
    }
    await actor.update({ [`flags.${MODULE_ID}.loadouts.${loadout.id}`]: _replace(loadout) });
    return { ok: true, id: loadout.id, loadout };
}

/** Delete a loadout. */
export async function deleteLoadout(actorRef, id) {
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    if (!loadoutsOf(actor)[id]) return refuse("no-loadout");
    await actor.update({ [`flags.${MODULE_ID}.loadouts.${id}`]: _del });
    return { ok: true };
}

/**
 * Save the character's current preparation as a loadout (7.5): each pool's prepared formulas by family, and the talisman
 * pools' virtual talismans of the last preparation (its record, so two of one talisman stay two, and a talisman used or
 * deleted at the rest since still counts).
 */
export async function captureLoadout(actorRef, name) {
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    const facts = await morningFacts(actor);
    const pools = {};
    const talismans = {};
    const made = talismanPicksOf(facts.morning.talismans);
    for (const pool of facts.pools) {
        const prepared = pool.prepared.filter((p) => p.item);
        if (prepared.length) pools[pool.slug] = captureEntries(prepared);
        if (pool.talisman && made[pool.slug]?.length) talismans[pool.slug] = made[pool.slug];
    }
    if (!Object.keys(pools).length && !Object.keys(talismans).length) return refuse("nothing-prepared");
    return saveLoadout(actor, { name, pools, talismans });
}

/* -------------------------------------------- */
/*  Standing orders (4.11, 7.6)                  */
/* -------------------------------------------- */

/**
 * Place a standing order (any member, as the requester's owner): `qty` of the item's family from `crafter`'s `pool` for
 * `recipient`, every preparation from today (or `fromDay`) until `untilDay`.
 */
export async function placeStanding({ requester, crafter, recipient = null, pool = "advanced-alchemy", uuid, qty = 1, fromDay = null, untilDay = null }) {
    if (!canWrite()) return refuse("not-ready");
    const who = actorOf(requester);
    if (!who?.isOwner) return refuse("not-owner");
    const maker = actorOf(crafter);
    if (!maker) return refuse("no-crafter");
    const item = (await catalogue()).find((i) => i.uuid === uuid);
    if (!item) return refuse("no-product");
    let record;
    try {
        record = makeStanding({ id: newId(), requester: who.uuid, crafter: maker.uuid, recipient: actorOf(recipient)?.uuid ?? who.uuid, pool, family: familyKey(item),
            uuid: item.uuid, name: item.name, qty: Number(qty), fromDay: Number.isInteger(fromDay) ? fromDay : today().day, untilDay }, stampNow());
    } catch (error) {
        return refuse("bad-standing", { message: error.message });
    }
    await write({ set: { [`standing.${record.id}`]: record } });
    return { ok: true, id: record.id, standing: record };
}

/** End a standing order (its requester's or crafter's owners, or a GM). */
export async function endStanding(id) {
    if (!canWrite()) return refuse("not-ready");
    const record = read(`standing.${id}`);
    if (!record) return refuse("no-standing");
    const may = game.user.isGM || actorOf(record.requester)?.isOwner || actorOf(record.crafter)?.isOwner;
    if (!may) return refuse("not-owner");
    if (!record.active) return { ok: true, outcome: "already" };
    await write({ set: { [`standing.${id}.active`]: false, [`standing.${id}.endedAt`]: stampNow().at } });
    return { ok: true };
}

/** The standing orders involving the user's characters (as requester, crafter or recipient); all for a GM. */
export function standingFor(actors = members().filter((a) => a.isOwner)) {
    const uuids = new Set(actors.map((a) => a.uuid));
    return records("standing").filter((s) => game.user.isGM || uuids.has(s.requester) || uuids.has(s.crafter) || uuids.has(s.recipient));
}

/* -------------------------------------------- */
/*  Gap entries and Food Preservation (7.10)     */
/* -------------------------------------------- */

/** Tick a gap entry off for this cycle (a `note` flow), or untick it. */
export async function markGap(actorRef, key, done = true) {
    const actor = actorOf(actorRef);
    if (!actor?.isOwner) return refuse("not-owner");
    const cycle = statusOf(actor).prepCycle;
    await actor.update({ [`flags.${MODULE_ID}.morning.gaps.${key}`]: done ? cycle : null });
    return { ok: true };
}

/** A creator's Food Preservation designations that stand (`flags.MOD.morning.preserved`), wherever the foods have gone. */
export function designationsOn(actor) {
    const list = morningOf(actor).preserved;
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === "string" && Number.isFinite(d.n)) : [];
}

/**
 * The alchemical foods a Food Preservation holder may preserve (7.7, 7.10): what its own Advanced Alchemy made at this
 * cycle's preparations ("when you use advanced alchemy to create alchemical food") that matches the rule's predicate,
 * still in its hands; foods already preserved this cycle are listed too, marked by their stamp.
 */
export function preservable(actor) {
    const rules = heldEffects(heldKeysOf(actor), "expiryRule").filter(({ effect }) => effect.rule === "designate");
    if (!rules.length) return [];
    const cycle = statusOf(actor).prepCycle;
    return physical(actor).filter((item) => {
        const stamp = stampOf(item);
        if (!stamp || stamp.creator !== actor.uuid || stamp.pool !== ADVANCED_POOL || stamp.cycle !== cycle || isInert(item)) return false;
        const options = new Set(item.getRollOptions?.("item") ?? []);
        return rules.some(({ effect }) => testPredicate(effect.when, options));
    });
}

/**
 * Preserve alchemical foods (Food Preservation, 7.7 exception): each chosen food's stamp becomes `exempt` with a
 * designation id, and it stops being temporary, so pf2e's Rest for the Night (which deletes temporary items) keeps it. The
 * designations are kept on the creator (`flags.MOD.morning.preserved`), so a food handed to someone else still counts.
 * At most the cap (by the better of Crafting and Cooking Lore, `preservationCap`) a preparation, and at most the cap at
 * once: past it the oldest spoil, which every holder's client marks inert at once (temporary again).
 */
export async function preserve(actorRef, ids) {
    const actor = actorOf(actorRef);
    if (!actor?.isOwner) return refuse("not-owner");
    const candidates = preservable(actor);
    const chosen = [...new Set(ids)];
    if (!chosen.length || chosen.some((id) => !candidates.some((item) => item.id === id))) return refuse("not-preservable");
    const fresh = chosen.filter((id) => !stampOf(actor.items.get(id))?.exempt);
    const ranks = ranksOf(actor);
    const cap = preservationCap(Math.max(ranks.crafting ?? RANK.untrained, ranks["cooking-lore"] ?? RANK.untrained));
    const cycle = statusOf(actor).prepCycle;
    const standing = designationsOn(actor);
    const plan = preservePlan(standing, fresh.length, cap, cycle);
    if (!plan.ok) return refuse(plan.reason, plan.data);
    if (!fresh.length) return { ok: true, preserved: [], spoiled: [], cap };
    const at = stampNow().at;
    let n = Math.max(0, ...standing.map((d) => d.n));
    // Designated in one go, the first named counts as the oldest: it is the one to spoil first.
    const added = fresh.map((item) => ({ id: newId(), item, n: ++n, cycle, at }));
    const spoiled = new Set(plan.spoil);
    // The designations first: a write that stops between the two leaves a designation without a food, never a food
    // whose designation is missing (which would spoil it).
    await actor.update({ [`flags.${MODULE_ID}.morning.preserved`]: [...standing.filter((d) => !spoiled.has(d.id)), ...added.map((d) => ({ id: d.id, n: d.n, cycle: d.cycle, at: d.at }))] });
    await actor.updateEmbeddedDocuments("Item", added.map((d) => ({
        _id: d.item, "system.temporary": false,
        [`flags.${MODULE_ID}.expiry.exempt`]: { key: "food-preservation", id: d.id, n: d.n, at },
    })));
    scheduleExpiry(0);
    return { ok: true, preserved: fresh, spoiled: [...spoiled], cap };
}

/* -------------------------------------------- */
/*  The affix board (7.4)                        */
/* -------------------------------------------- */

/** An item's traits as a list (pf2e keeps them as a Set on the document, a list in its source). */
const traitsOf = (item) => [...(item.traits ?? item.system?.traits?.value ?? [])];

/** Items that can host a talisman: armor, shields and weapons (bombs left out while `talismanHostsExcludeBombs` is on). */
function hostsOf(actor) {
    const excludeBombs = setting("rules.talismanHostsExcludeBombs") !== false;
    return physical(actor).filter((item) => ["armor", "shield", "weapon"].includes(item.type) && !(excludeBombs && traitsOf(item).includes("bomb")));
}

/** Whether a host is wielded or worn, which activating its talisman needs (7.4). */
function inUse(item) {
    const equipped = item.system?.equipped ?? {};
    if (item.type === "armor") return equipped.inSlot === true || item.isEquipped === true;
    return equipped.carryType === "held" || item.isEquipped === true;
}

/** Talismans and spellhearts of an actor. */
function talismansOf(actor) {
    return physical(actor).filter((item) => traitsOf(item).includes("talisman") || traitsOf(item).includes("spellheart"));
}

/** The affix board of a character (7.4, macro 18): hosts, what is on them and whether it works, and the time affixing takes. */
export function affixBoardOf(actorRef) {
    const actor = actorOf(actorRef);
    if (!actor) return null;
    const held = heldKeysOf(actor);
    const hosts = hostsOf(actor);
    const sageHost = hosts.find((h) => sageTreated(h))?.id ?? null;
    const talismans = talismansOf(actor).map((item) => ({ id: item.id, name: item.name, img: item.img ?? null, host: item.flags?.[MODULE_ID]?.affix?.host ?? null,
        temporary: !!item.system?.temporary, inert: isInert(item) }));
    const board = affixBoard({ talismans, hosts: hosts.map((h) => ({ id: h.id, name: h.name, img: h.img ?? null, type: h.type, usable: inUse(h) })), sageHost,
        talismanicSage: held.includes("talismanic-sage") || !!sageHost });
    const feats = { rapidAffixture: held.includes("rapid-affixture"), quickFix: held.includes("quick-fix"), dabbler: held.includes("talisman-dabbler-dedication") };
    return { ...board, minutes: affixMinutes(talismans.filter((t) => !t.host).length, feats), feats, manager: talismanManagerActive(), sage: held.includes("talismanic-sage") };
}

/** Affix one of the character's talismans to one of its hosts (7.4), as its owner. */
export async function affixOwn(actorRef, talismanId, hostId) {
    const actor = actorOf(actorRef);
    if (!actor?.isOwner) return refuse("not-owner");
    return affixTalisman(actor, actor.items.get(talismanId), actor.items.get(hostId));
}

/** Take one of the character's talismans off its host. */
export async function unaffixOwn(actorRef, talismanId) {
    const actor = actorOf(actorRef);
    if (!actor?.isOwner) return refuse("not-owner");
    return unaffixTalisman(actor, actor.items.get(talismanId));
}

/* -------------------------------------------- */
/*  The Morning prompt                           */
/* -------------------------------------------- */

/** Whether a character has anything to prepare each morning: a daily pool or versatile vials (7.9's condition too). */
export function hasDailySources(actor) {
    return abilitiesOf(actor).some((a) => a.isDailyPrep) || !!actor?.getResource?.("versatile-vials");
}

/**
 * The user's characters waiting to prepare (the Morning tab's badge, 7.8): a cycle began and nothing was prepared in it.
 * Only characters this client is responsible for, as the prompt goes to them.
 */
export function waitingToPrepare() {
    if (!canWrite() || !morningOn()) return [];
    return members().filter((actor) => actor.isOwner && isResponsibleFor(actor) && hasDailySources(actor)).filter((actor) => {
        const status = statusOf(actor);
        const morning = morningOf(actor);
        return status.prepCycle > 0 && cycleState({ prepCycle: status.prepCycle, morningCycle: Number.isInteger(morning.cycle) ? morning.cycle : null,
            dailyCraftingComplete: actor.flags?.pf2e?.dailyCraftingComplete === true }) === "fresh";
    });
}

/** For tests only. */
export function resetMorning() {
    applying.clear();
}
