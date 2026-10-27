/**
 * Casting pledges on this client (DESIGN.md 6.9, M5): a caster's owner pledges castings of one of the caster's spells to
 * an order for a scroll, wand, staff or spellheart, marks them cast when the caster has cast them on the order's day, or
 * withdraws them; anyone with a character can buy a casting at the spellcasting-service price (Player Core p.295).
 * Each pledge is `orders.<id>.pledges.<pledgeId>`, written by the caster's owner only (4.2.4), so two casters never
 * write the same key. G9 (6.5) counts the fulfilled castings when the order starts.
 *
 * Marking a pledge cast does not spend the slot through pf2e (OQ-15 stays open: pf2e has no public call that expends a
 * prepared slot without casting); the caster's owner confirms it, as the checklist does. A scroll's spell cost is the
 * caster's to pay, a `purchase` for the order when it is given; a wand's is not paid (GM Core p.282).
 *
 * As built in M5 on M4.1: a spell's cost and a bought casting are paid from the source the user picks (`payPurchase`):
 * a character's purse, or the party fund, whose money is earmarked for the order and spent by it in one move, so the
 * order lists it as spent by the party fund. The casting record keeps where it came from (`paidFrom`, `payer`).
 *
 * As built in M9: an item that lists its spells (a staff or coda, a spellheart, an item whose Craft Requirements link
 * spells; `spellNeedsOf`) takes one pledge per listed casting, which names its entry (`entry`); a specialty wand takes one
 * casting of a spell of its rank, as a wand does, and its spell's cost is not paid either.
 */
import { idemKey } from "../logic/ids.mjs";
import { closedAs } from "../logic/orders.mjs";
import { castingsPriceCp, entryFor, livePledges, makePledge, pledgeProblem, pledgeTransition, spellSupply } from "../logic/pledges.mjs";
import { productFacts } from "./products.mjs";
import { payPurchase } from "./purchases.mjs";
import { canWrite } from "./state.mjs";
import { newId, read, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);

/** The order and its spell supply, or a refusal: no order, a closed or rolled one, or one that needs no spells. */
async function openOrder(id) {
    if (!canWrite()) return { refusal: refuse("not-ready") };
    const order = read(`orders.${id}`);
    if (!order) return { refusal: refuse("no-order") };
    const status = closedAs(order) ?? order.status;
    if (["complete", "cancelled", "archived", "rolled"].includes(status)) return { refusal: refuse("state", { status }) };
    const product = await productFacts(order.product?.uuid);
    const supply = product ? spellSupply(product) : null;
    if (!supply) return { refusal: refuse("not-spell-item") };
    return { order, supply };
}

/** Plain facts about a spell item for a pledge (6.9): where it lives, its compendium source, rank, traits and kind. */
export function spellFacts(spell) {
    const category = spell.isRitual ? "ritual" : spell.isFocusSpell ? "focus" : spell.isCantrip ? "cantrip" : "spell";
    return {
        uuid: spell.uuid, source: spell.sourceId ?? spell._stats?.compendiumSource ?? null, name: spell.name, img: spell.img ?? null,
        rank: spell.baseRank ?? spell.system?.level?.value ?? 1, traits: [...(spell.traits ?? spell.system?.traits?.value ?? [])], category,
    };
}

/** The rank a pledge records: a listed casting's (a cantrip's 0), else the item's, else the spell's own. */
const pledgeRank = (supply, entry, facts) => (entry ? entry.rank ?? facts?.rank ?? null : supply.rank ?? facts?.rank ?? null);

/**
 * Pledge castings of a caster's spell to an order (6.9). The user must own the caster, and the spell must be one of the
 * caster's own spell items. Refusals: `not-ready`, `no-order`, `state`, `not-spell-item`, `not-owner`, `no-spell`, and
 * the rule codes of `pledgeProblem` (`unscribable`, `spell-rank`, `same-spell`, `one-casting`, `scroll-castings`,
 * `castings`; M9: `not-on-list`, `covered`, `any-castings`). M9: for an item that lists its spells, `entry` names the
 * listed casting it supplies (the first open one the spell matches when none is named).
 */
export async function pledgeCasting(orderId, { caster, spell, castings = 1, entry = null }) {
    const { order, supply, refusal } = await openOrder(orderId);
    if (refusal) return refusal;
    const actor = actorOf(caster);
    if (!actor?.isOwner) return refuse("not-owner");
    const item = actorOf(spell);
    if (supply.kind === "scroll" || supply.kind === "wand" || supply.kind === "wand-special" || supply.entries.length) {
        if (item?.type !== "spell" || item.parent !== actor) return refuse("no-spell");
    }
    const facts = item?.type === "spell" ? spellFacts(item) : null;
    const existing = livePledges(order);
    const problem = pledgeProblem({ supply, spell: facts, castings, existing, entry });
    if (problem) return refuse(problem.reason, problem.data ?? {});
    const listed = facts ? entryFor(supply, facts, existing, entry) : null;
    const pledge = makePledge({ id: newId(), caster: actor.uuid, spell: facts, rank: pledgeRank(supply, listed, facts), castings,
        entry: listed?.key ?? null }, stampNow());
    await write({ set: { [`orders.${orderId}.pledges.${pledge.id}`]: pledge } });
    return { ok: true, pledge: pledge.id };
}

/**
 * Mark a pledge cast (6.9): the caster's owners. A scroll's spell cost (`costCp`) is a `purchase` for the order in the
 * same move, paid from `paidFrom` (As built in M5 on M4.1): `purse`, `payer`'s (the pledge's payer, its caster by
 * default), or `fund`, the party fund. A wand's spell cost is not paid (GM Core p.282).
 */
export async function fulfilPledge(orderId, pledgeId, { costCp = 0, paidFrom = "purse", payer = null } = {}) {
    const { order, supply, refusal } = await openOrder(orderId);
    if (refusal) return refusal;
    const pledge = order.pledges?.[pledgeId];
    if (!pledge) return refuse("no-pledge");
    if (!actorOf(pledge.caster)?.isOwner) return refuse("not-owner");
    const step = pledgeTransition(pledge, "fulfil");
    if (!step.ok) return step;
    const path = `orders.${orderId}.pledges.${pledgeId}`;
    const paid = costCp > 0 && supply.kind !== "wand" && supply.kind !== "wand-special";
    const set = { [`${path}.status`]: "fulfilled", [`${path}.costCp`]: paid ? costCp : 0 };
    if (!paid) {
        await write({ set });
        return { ok: true };
    }
    const source = paidFrom === "fund" ? "fund" : "purse";
    const purse = source === "purse" ? payer ?? pledge.payer ?? pledge.caster : null;
    Object.assign(set, { [`${path}.paidFrom`]: source, [`${path}.payer`]: purse });
    return payPurchase({ source, payer: purse, cp: costCp, idem: idemKey("purchase", "casting", orderId, pledgeId), order: orderId, ledger: { set } });
}

/** Withdraw a pledge not yet cast (6.9): the caster's owners, or a GM. */
export async function withdrawPledge(orderId, pledgeId) {
    const { order, refusal } = await openOrder(orderId);
    if (refusal) return refusal;
    const pledge = order.pledges?.[pledgeId];
    if (!pledge) return refuse("no-pledge");
    if (!(game.user.isGM || actorOf(pledge.caster)?.isOwner)) return refuse("not-owner");
    const step = pledgeTransition(pledge, "withdraw");
    if (!step.ok) return step;
    await write({ set: { [`orders.${orderId}.pledges.${pledgeId}.status`]: "withdrawn" } });
    return { ok: true };
}

/**
 * What buying castings of a compendium spell for an order would cost (the window asks for a source with the price in
 * view): `{ok, cp, rank, spell}`, or the refusals `buyCasting` gives first (`no-spell`, the rule codes of
 * `pledgeProblem`, `no-casting-service` above rank 9).
 */
export async function castingPrice(orderId, { spell, castings = 1, entry = null }) {
    const { order, supply, refusal } = await openOrder(orderId);
    if (refusal) return refusal;
    const doc = typeof spell === "string" ? await fromUuid(spell).catch(() => null) : null;
    if (doc?.type !== "spell") return refuse("no-spell");
    const facts = { ...spellFacts(doc), source: doc.uuid };
    const existing = livePledges(order);
    const problem = pledgeProblem({ supply, spell: facts, castings, existing, entry });
    if (problem) return refuse(problem.reason, problem.data ?? {});
    // M9: a listed casting is bought at its own rank; a cantrip has no spellcasting service price.
    const listed = entryFor(supply, facts, existing, entry);
    const rank = pledgeRank(supply, listed, facts);
    const cp = castingsPriceCp(rank, castings);
    if (cp === null) return refuse("no-casting-service", { rank });
    return { ok: true, cp, rank, spell: facts, order, supply, entry: listed?.key ?? null };
}

/**
 * Buy castings at the spellcasting-service price (Player Core p.295): a fulfilled pledge with no caster, and a `purchase`
 * for the order of the service price per casting at the item's rank (a staff's or spellheart's at the spell's own rank),
 * in one move, paid from `paidFrom` (As built in M5 on M4.1): `purse`, `payer`'s, or `fund`, the party fund. `spell` is
 * a compendium spell's UUID. Spellcasting services are uncommon, so this is the table's call: the module records it.
 */
export async function buyCasting(orderId, { payer = null, paidFrom = "purse", spell, castings = 1, entry = null }) {
    const source = paidFrom === "fund" ? "fund" : "purse";
    if (source === "purse" && !actorOf(payer)?.isOwner) return refuse("not-owner");
    const price = await castingPrice(orderId, { spell, castings, entry });
    if (!price.ok) return price;
    const purse = source === "purse" ? actorOf(payer).uuid : null;
    const pledge = { ...makePledge({ id: newId(), caster: null, spell: price.spell, rank: price.rank, castings, payer: purse, service: true,
        costCp: price.cp, entry: price.entry }, stampNow()), paidFrom: source };
    return payPurchase({ source, payer: purse, cp: price.cp, idem: idemKey("purchase", "casting", orderId, pledge.id), order: orderId,
        ledger: { set: { [`orders.${orderId}.pledges.${pledge.id}`]: pledge } } });
}
