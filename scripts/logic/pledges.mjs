/**
 * Casting pledges (DESIGN.md 6.9, M5, M9): the spells a scroll, wand, staff, spellheart or other spell-supplied item needs,
 * supplied by a party caster on the order as a requirements line. Pure: the Foundry side (`scripts/foundry/pledges.mjs`) reads the caster's spell
 * and writes `orders.<id>.pledges.<pledgeId>`.
 *
 * A pledge is `{id, v, caster, spell: {uuid, source, name, rank, traits, category}, rank, castings, payer, day, status,
 * service, costCp, by, at}`. The caster's owner creates it (only they can read the caster's spells) and marks it cast
 * (`fulfilled`) when the caster is present on the day of the casting; it can be `withdrawn` until then. A casting bought
 * at the spellcasting-service price (Player Core p.295) is a pledge with `service: true` and no caster, fulfilled at once.
 *
 * Rules: a scroll takes one casting per scroll, all the same spell at the scroll's rank, batch at most 4 (GM Core p.262);
 * a wand takes one casting (GM Core p.282). Cantrips, focus spells and rituals cannot be put into an item. Craft Anything
 * waives the casting (G9).
 *
 * As built in M9: the other spell-supplied items read what they need from their own description (`spellNeedsOf`,
 * `scripts/logic/spell-lists.mjs`): a staff or coda one casting of every listed spell at every listed rank (cantrips
 * included), a spellheart the spells it casts, a specialty wand one casting of a spell of its rank, any other item the
 * spells its Craft Requirements link. Each listed casting is an entry (`<uuid>@<rank>`), and a pledge names the entry it
 * supplies (`entry`): one casting of that spell, by its compendium source, at no lower base rank. Castings asked for
 * without a link (`any`) take any spell. G9 needs every entry covered by a fulfilled pledge, and `any` more castings.
 */
import { SPELLCASTING_SERVICE } from "../data/services.mjs";
import { hasTrait, requireInteger } from "./core.mjs";
import { entryMatches } from "./spell-lists.mjs";

export const PLEDGE_VERSION = 1;

/** Pledge states (6.9). */
export const PLEDGE_STATUS = Object.freeze(["offered", "fulfilled", "withdrawn"]);

/** Most scrolls one Craft makes (GM Core p.262), as `batchMax` has it. */
const SCROLL_CASTINGS = 4;

/**
 * What kind of spell-supplied item a product is (6.9), or null: `{kind, rank, entries, any}`. Scrolls and wands are the
 * base items `CONFIG.PF2E.spellcastingItems` names (`product.spellcasting`, with their rank); the rest (M9) carry what
 * their description asks for (`product.spellNeeds`, `spellNeedsOf`): `kind` "staff", "spellheart", "wand-special" or
 * "named". A staff or spellheart whose description was not read (`unread`) needs one casting of any spell and takes as many
 * as its casters offer, as in M5.
 *
 * @param {{traits: string[], spellcasting?: {kind: string, rank: number}|null, spellNeeds?: object|null}} product
 */
export function spellSupply(product) {
    if (product?.spellcasting?.kind === "scroll" || product?.spellcasting?.kind === "wand") {
        return { kind: product.spellcasting.kind, rank: product.spellcasting.rank, entries: [], any: 0 };
    }
    if (product?.spellNeeds) {
        const needs = product.spellNeeds;
        return { kind: needs.kind, rank: needs.rank ?? null, entries: [...(needs.entries ?? [])], any: needs.any ?? 0 };
    }
    if (hasTrait(product ?? {}, "staff")) return { kind: "staff", rank: null, entries: [], any: 1, unread: true };
    if (hasTrait(product ?? {}, "spellheart")) return { kind: "spellheart", rank: null, entries: [], any: 1, unread: true };
    return null;
}

/** Whether a kind takes one casting of one spell, as a wand does (a magic wand, a specialty wand). */
const wandLike = (supply) => supply?.kind === "wand" || supply?.kind === "wand-special";

/** Whether a spell is a cantrip (its category or trait). */
const isCantrip = (spell) => spell?.category === "cantrip" || hasTrait(spell ?? {}, "cantrip");

/** The live pledges of an order (not withdrawn), oldest first. */
export function livePledges(order) {
    return Object.values(order?.pledges ?? {}).filter((p) => p && p.status !== "withdrawn" && Number.isInteger(p.castings))
        .sort((a, b) => (a.at?.real ?? 0) - (b.at?.real ?? 0) || (a.id < b.id ? -1 : 1));
}

/** Castings an order has pledged, of the given states (offered and fulfilled by default). */
export function castingsOf(order, states = ["offered", "fulfilled"]) {
    return livePledges(order).filter((p) => states.includes(p.status)).reduce((sum, p) => sum + p.castings, 0);
}

/**
 * Castings an order needs before it can start (G9): one per scroll, one for a wand; for an item that lists its spells
 * (M9) one per entry and its `any` more; at least one otherwise.
 */
export function castingsNeeded(supply, quantity) {
    if (!supply) return 0;
    if (supply.kind === "scroll") return requireInteger(quantity, "quantity");
    const listed = (supply.entries?.length ?? 0) + (supply.any ?? 0);
    return wandLike(supply) ? 1 : Math.max(1, listed);
}

/** The listed castings no live pledge covers yet (M9): the entries a caster may still pledge. */
export function openEntries(order, supply) {
    const taken = new Set(livePledges(order).map((p) => p.entry).filter(Boolean));
    return (supply?.entries ?? []).filter((entry) => !taken.has(entry.key));
}

/**
 * G9's spell supply (6.5): whether the item needs spells and whether fulfilled pledges supply them. For an item that lists
 * its spells (M9), each entry needs a fulfilled pledge naming it, and `any` castings come from fulfilled pledges that name
 * none; `open` lists the entries no live pledge covers.
 * @returns {{spellsNeeded: boolean, spellsSupplied: boolean, needed: number, fulfilled: number, open: object[]}}
 */
export function spellGate(order, supply) {
    const needed = castingsNeeded(supply, order.quantity ?? 1);
    const entries = supply?.entries ?? [];
    if (!entries.length) {
        const fulfilled = castingsOf(order, ["fulfilled"]);
        return { spellsNeeded: needed > 0, spellsSupplied: fulfilled >= needed, needed, fulfilled: Math.min(fulfilled, needed), open: [] };
    }
    const done = livePledges(order).filter((p) => p.status === "fulfilled");
    const keys = new Set(entries.map((entry) => entry.key));
    const covered = entries.filter((entry) => done.some((p) => p.entry === entry.key)).length;
    const loose = done.filter((p) => !keys.has(p.entry)).reduce((sum, p) => sum + p.castings, 0);
    const fulfilled = covered + Math.min(supply.any ?? 0, loose);
    return { spellsNeeded: needed > 0, spellsSupplied: fulfilled >= needed, needed, fulfilled, open: openEntries(order, supply) };
}

/** Whether a spell can be put into an item: not a cantrip, a focus spell or a ritual (6.9). */
export function scribable(spell) {
    if (hasTrait(spell, "cantrip") || hasTrait(spell, "focus")) return false;
    return !["cantrip", "focus", "ritual"].includes(spell.category);
}

/**
 * The listed casting a spell would supply (M9): the entry named, when it is open and names the spell; else the first open
 * entry that names it. Null when none does.
 */
export function entryFor(supply, spell, existing = [], key = null) {
    const taken = new Set(existing.map((p) => p.entry).filter(Boolean));
    const open = (supply?.entries ?? []).filter((entry) => !taken.has(entry.key) && entryMatches(entry, spell));
    return key ? open.find((entry) => entry.key === key) ?? null : open[0] ?? null;
}

/**
 * Why a caster cannot pledge this casting, or null (6.9): the product needs no spells, the spell cannot go into an item,
 * its rank is above the scroll's or wand's (a spell is heightened to the item's rank, never lowered), a scroll's pledges
 * must all be the same spell, a wand takes one casting, and a scroll at most four.
 *
 * As built in M9, for an item that lists its spells: a pledge names an open entry (`entry`, or the first open one the
 * spell matches), which takes one casting of that spell at no lower base rank (`not-on-list`, `covered`, `one-casting`,
 * `spell-rank`); cantrips go only into an entry for a cantrip, or into one at the spell's own rank that names a cantrip
 * (a spellheart's). Castings asked for without a link (`any`) take any spell
 * that can go into an item, up to that count (`any-castings`). A specialty wand is a wand.
 *
 * @param {object} p
 * @param {{kind: string, rank: number|null, entries?: object[], any?: number}|null} p.supply   `spellSupply`
 * @param {{uuid: string, source?: string|null, name?: string, rank: number, traits?: string[], category?: string}} p.spell
 *   `rank`: the spell's own (base) rank
 * @param {number} p.castings
 * @param {object[]} p.existing   the order's live pledges
 * @param {string|null} [p.entry] the entry the pledge names
 */
export function pledgeProblem({ supply, spell, castings, existing = [], entry = null }) {
    if (!supply) return { reason: "not-spell-item" };
    if (!Number.isInteger(castings) || castings < 1) return { reason: "castings" };
    const listed = supply.entries ?? [];
    if (listed.length && spell && (entry || !(supply.any > 0) || entryFor(supply, spell, existing))) {
        if (entry && !listed.some((e) => e.key === entry)) return { reason: "not-on-list" };
        if (entry && existing.some((p) => p.entry === entry)) return { reason: "covered" };
        if (entry && !entryMatches(listed.find((e) => e.key === entry), spell)) return { reason: "not-on-list" };
        const found = entryFor(supply, spell, existing, entry);
        if (!found) return { reason: listed.some((e) => entryMatches(e, spell)) ? "covered" : "not-on-list" };
        if (castings !== 1) return { reason: "one-casting" };
        if (spell.category === "focus" || spell.category === "ritual" || hasTrait(spell, "focus")) return { reason: "unscribable" };
        // An entry at a listed rank says whether it is a cantrip; one at the spell's own rank (a spellheart's "You cast
        // @UUID[…]") takes the spell as it is, a cantrip included.
        if (found.rank !== null && found.cantrip !== isCantrip(spell)) return { reason: "not-on-list" };
        if (!found.cantrip && found.rank !== null && spell.rank > found.rank) return { reason: "spell-rank", data: { rank: found.rank } };
        return null;
    }
    if (listed.length && !spell && !(supply.any > 0)) return { reason: "no-spell" };
    if (!spell) return supply.kind === "scroll" || wandLike(supply) ? { reason: "no-spell" } : null;
    if (!scribable(spell)) return { reason: "unscribable" };
    if ((supply.kind === "scroll" || wandLike(supply)) && supply.rank !== null && spell.rank > supply.rank) {
        return { reason: "spell-rank", data: { rank: supply.rank } };
    }
    const others = existing.filter((p) => p.spell?.uuid && p.spell.uuid !== spell.uuid);
    if (supply.kind === "scroll" && others.length) return { reason: "same-spell" };
    const already = existing.reduce((sum, p) => sum + p.castings, 0);
    if (wandLike(supply) && already + castings > 1) return { reason: "one-casting" };
    if (supply.kind === "scroll" && already + castings > SCROLL_CASTINGS) return { reason: "scroll-castings", data: { max: SCROLL_CASTINGS } };
    if (wandLike(supply) && others.length) return { reason: "same-spell" };
    if (listed.length || ["staff", "spellheart", "named"].includes(supply.kind)) {
        const keys = new Set(listed.map((e) => e.key));
        const loose = existing.filter((p) => !keys.has(p.entry)).reduce((sum, p) => sum + p.castings, 0);
        // An item whose description was not read takes the caster's own count, as in M5.
        const room = supply.unread ? Infinity : supply.any ?? 0;
        if (loose + castings > room) return { reason: "any-castings", data: { max: room } };
    }
    return null;
}

/**
 * The rank a casting is recorded and bought at (6.9): a listed casting's (0 for a cantrip, including a cantrip named at its
 * own rank), else the item's, else the spell's own.
 *
 * @param {{rank: number|null}|null} supply   `spellSupply`
 * @param {{rank: number|null}|null} entry    the listed casting the pledge supplies, or null
 * @param {{rank?: number, category?: string, traits?: string[]}|null} spell
 */
export function castingRank(supply, entry, spell) {
    if (entry) return entry.rank ?? (isCantrip(spell) ? 0 : spell?.rank ?? null);
    return supply?.rank ?? spell?.rank ?? null;
}

/**
 * A pledge record (6.9).
 * @param {object} p
 * @param {string} p.id
 * @param {string|null} p.caster    the caster's actor UUID; null for a bought casting
 * @param {object|null} p.spell     `{uuid, source, name, rank, traits, category}`: the caster's spell item, its compendium source
 * @param {number} p.rank           the rank it is cast at (the scroll's or wand's)
 * @param {number} p.castings
 * @param {string|null} [p.payer]   who pays the spell's cost (the caster, for a scroll)
 * @param {boolean} [p.service]     bought at the spellcasting-service price
 */
export function makePledge({ id, caster = null, spell = null, rank = null, castings, payer = null, day = null, service = false, costCp = 0, entry = null },
    stamp) {
    requireInteger(castings, "castings");
    return {
        id, v: PLEDGE_VERSION, caster, spell: spell ? { ...spell } : null, rank, castings, payer: payer ?? caster, day,
        status: service ? "fulfilled" : "offered", service, costCp, entry, ...stamp,
    };
}

/** What a pledge's transition writes, or a refusal: `fulfil` and `withdraw` from `offered` only. */
export function pledgeTransition(pledge, event) {
    if (!pledge) return { ok: false, reason: "no-pledge" };
    if (pledge.status !== "offered") return { ok: false, reason: "state", data: { status: pledge.status } };
    if (event === "fulfil") return { ok: true, patch: { status: "fulfilled" } };
    if (event === "withdraw") return { ok: true, patch: { status: "withdrawn" } };
    throw new RangeError(`unknown pledge event ${event}`);
}

/** The spellcasting-service price of one casting at a rank (Player Core p.295), before the spell's own cost. */
export function castingServiceCp(rank) {
    requireInteger(rank, "rank");
    if (rank < 1 || rank > SPELLCASTING_SERVICE.length) throw new RangeError(`no spellcasting service for rank ${rank}`);
    return SPELLCASTING_SERVICE[rank - 1];
}

/**
 * The spellcasting-service price of `castings` castings at `rank` (Player Core p.295), or null where no service sells
 * one (the table stops at rank 9), so a 10th-rank scroll's "Buy a casting" is refused rather than thrown (M5 review).
 */
export function castingsPriceCp(rank, castings = 1) {
    if (!Number.isInteger(rank) || rank < 1 || rank > SPELLCASTING_SERVICE.length) return null;
    return castingServiceCp(rank) * castings;
}

/** The spell a finished scroll or wand holds: the first live pledge's (6.9). Null when none names one. */
export function pledgedSpell(order) {
    return livePledges(order).find((p) => p.spell?.uuid)?.spell ?? null;
}
