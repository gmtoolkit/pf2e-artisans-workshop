/**
 * Casting pledges (DESIGN.md 6.9, M5): the spells a scroll, wand, staff or spellheart needs, supplied by a party caster
 * on the order as a requirements line. Pure: the Foundry side (`scripts/foundry/pledges.mjs`) reads the caster's spell
 * and writes `orders.<id>.pledges.<pledgeId>`.
 *
 * A pledge is `{id, v, caster, spell: {uuid, source, name, rank, traits, category}, rank, castings, payer, day, status,
 * service, costCp, by, at}`. The caster's owner creates it (only they can read the caster's spells) and marks it cast
 * (`fulfilled`) when the caster is present on the day of the casting; it can be `withdrawn` until then. A casting bought
 * at the spellcasting-service price (Player Core p.295) is a pledge with `service: true` and no caster, fulfilled at once.
 *
 * Rules: a scroll takes one casting per scroll, all the same spell at the scroll's rank, batch at most 4 (GM Core p.262);
 * a wand takes one casting (GM Core p.282); a staff takes a casting of every listed spell, which the module cannot read,
 * so its castings are the caster's own count; a spellheart takes the castings its Craft Requirements name, likewise.
 * Cantrips, focus spells and rituals cannot be put into an item. Craft Anything waives the casting (G9).
 */
import { SPELLCASTING_SERVICE } from "../data/services.mjs";
import { hasTrait, requireInteger } from "./core.mjs";

export const PLEDGE_VERSION = 1;

/** Pledge states (6.9). */
export const PLEDGE_STATUS = Object.freeze(["offered", "fulfilled", "withdrawn"]);

/** Most scrolls one Craft makes (GM Core p.262), as `batchMax` has it. */
const SCROLL_CASTINGS = 4;

/**
 * What kind of spell-supplied item a product is (6.9), or null: `{kind: "scroll"|"wand"|"staff"|"spellheart", rank}`.
 * Scrolls and wands are the base items `CONFIG.PF2E.spellcastingItems` names (`product.spellcasting`, with their rank);
 * staves and spellhearts are found by trait.
 *
 * @param {{traits: string[], spellcasting?: {kind: string, rank: number}|null, level?: number}} product
 */
export function spellSupply(product) {
    if (product?.spellcasting?.kind === "scroll" || product?.spellcasting?.kind === "wand") {
        return { kind: product.spellcasting.kind, rank: product.spellcasting.rank };
    }
    if (hasTrait(product ?? {}, "staff")) return { kind: "staff", rank: null };
    if (hasTrait(product ?? {}, "spellheart")) return { kind: "spellheart", rank: null };
    return null;
}

/** The live pledges of an order (not withdrawn), oldest first. */
export function livePledges(order) {
    return Object.values(order?.pledges ?? {}).filter((p) => p && p.status !== "withdrawn" && Number.isInteger(p.castings))
        .sort((a, b) => (a.at?.real ?? 0) - (b.at?.real ?? 0) || (a.id < b.id ? -1 : 1));
}

/** Castings an order has pledged, of the given states (offered and fulfilled by default). */
export function castingsOf(order, states = ["offered", "fulfilled"]) {
    return livePledges(order).filter((p) => states.includes(p.status)).reduce((sum, p) => sum + p.castings, 0);
}

/** Castings an order needs before it can start (G9): one per scroll, one for a wand, and at least one otherwise. */
export function castingsNeeded(supply, quantity) {
    if (!supply) return 0;
    if (supply.kind === "scroll") return requireInteger(quantity, "quantity");
    return 1;
}

/**
 * G9's spell supply (6.5): whether the item needs spells and whether fulfilled pledges supply them.
 * @returns {{spellsNeeded: boolean, spellsSupplied: boolean, needed: number, fulfilled: number}}
 */
export function spellGate(order, supply) {
    const needed = castingsNeeded(supply, order.quantity ?? 1);
    const fulfilled = castingsOf(order, ["fulfilled"]);
    return { spellsNeeded: needed > 0, spellsSupplied: fulfilled >= needed, needed, fulfilled };
}

/** Whether a spell can be put into an item: not a cantrip, a focus spell or a ritual (6.9). */
export function scribable(spell) {
    if (hasTrait(spell, "cantrip") || hasTrait(spell, "focus")) return false;
    return !["cantrip", "focus", "ritual"].includes(spell.category);
}

/**
 * Why a caster cannot pledge this casting, or null (6.9): the product needs no spells, the spell cannot go into an item,
 * its rank is above the scroll's or wand's (a spell is heightened to the item's rank, never lowered), a scroll's pledges
 * must all be the same spell, a wand takes one casting, and a scroll at most four.
 *
 * @param {object} p
 * @param {{kind: string, rank: number|null}|null} p.supply   `spellSupply`
 * @param {{uuid: string, rank: number, traits?: string[], category?: string}} p.spell  `rank`: the spell's own (base) rank
 * @param {number} p.castings
 * @param {object[]} p.existing   the order's live pledges
 */
export function pledgeProblem({ supply, spell, castings, existing = [] }) {
    if (!supply) return { reason: "not-spell-item" };
    if (!Number.isInteger(castings) || castings < 1) return { reason: "castings" };
    if (!spell) return supply.kind === "scroll" || supply.kind === "wand" ? { reason: "no-spell" } : null;
    if (!scribable(spell)) return { reason: "unscribable" };
    if ((supply.kind === "scroll" || supply.kind === "wand") && spell.rank > supply.rank) return { reason: "spell-rank", data: { rank: supply.rank } };
    const others = existing.filter((p) => p.spell?.uuid && p.spell.uuid !== spell.uuid);
    if (supply.kind === "scroll" && others.length) return { reason: "same-spell" };
    const already = existing.reduce((sum, p) => sum + p.castings, 0);
    if (supply.kind === "wand" && already + castings > 1) return { reason: "one-casting" };
    if (supply.kind === "scroll" && already + castings > SCROLL_CASTINGS) return { reason: "scroll-castings", data: { max: SCROLL_CASTINGS } };
    if (supply.kind === "wand" && others.length) return { reason: "same-spell" };
    return null;
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
export function makePledge({ id, caster = null, spell = null, rank = null, castings, payer = null, day = null, service = false, costCp = 0 }, stamp) {
    requireInteger(castings, "castings");
    return {
        id, v: PLEDGE_VERSION, caster, spell: spell ? { ...spell } : null, rank, castings, payer: payer ?? caster, day,
        status: service ? "fulfilled" : "offered", service, costCp, ...stamp,
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

/** The spell a finished scroll or wand holds: the first live pledge's (6.9). Null when none names one. */
export function pledgedSpell(order) {
    return livePledges(order).find((p) => p.spell?.uuid)?.spell ?? null;
}
