/**
 * Casting pledges on this client (DESIGN.md 6.9, M5): a caster's owner pledges castings of one of the caster's spells to
 * an order for a scroll, wand, staff or spellheart, marks them cast when the caster has cast them on the order's day, or
 * withdraws them; anyone with a character can buy a casting at the spellcasting-service price (Player Core p.295).
 * Each pledge is `orders.<id>.pledges.<pledgeId>`, written by the caster's owner only (4.2.4), so two casters never
 * write the same key. G9 (6.5) counts the fulfilled castings when the order starts.
 *
 * Marking a pledge cast does not spend the slot through pf2e (OQ-15 stays open: pf2e has no public call that expends a
 * prepared slot without casting); the caster's owner confirms it, as the checklist does. A scroll's spell cost is the
 * caster's, a `purchase` row from the payer's purse when it is given; a wand's is not paid (GM Core p.282).
 */
import { planPurseDebit } from "../logic/coins.mjs";
import { idemKey } from "../logic/ids.mjs";
import { purseLockIds } from "../logic/lock-first.mjs";
import { closedAs } from "../logic/orders.mjs";
import { castingServiceCp, livePledges, makePledge, pledgeProblem, pledgeTransition, spellSupply } from "../logic/pledges.mjs";
import { freeStacks, moveCoins } from "./money.mjs";
import { productFacts } from "./products.mjs";
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

/**
 * Pledge castings of a caster's spell to an order (6.9). The user must own the caster, and the spell must be one of the
 * caster's own spell items. Refusals: `not-ready`, `no-order`, `state`, `not-spell-item`, `not-owner`, `no-spell`, and
 * the rule codes of `pledgeProblem` (`unscribable`, `spell-rank`, `same-spell`, `one-casting`, `scroll-castings`,
 * `castings`).
 */
export async function pledgeCasting(orderId, { caster, spell, castings = 1 }) {
    const { order, supply, refusal } = await openOrder(orderId);
    if (refusal) return refusal;
    const actor = actorOf(caster);
    if (!actor?.isOwner) return refuse("not-owner");
    const item = actorOf(spell);
    if (supply.kind === "scroll" || supply.kind === "wand") {
        if (item?.type !== "spell" || item.parent !== actor) return refuse("no-spell");
    }
    const facts = item?.type === "spell" ? spellFacts(item) : null;
    const problem = pledgeProblem({ supply, spell: facts, castings, existing: livePledges(order) });
    if (problem) return refuse(problem.reason, problem.data ?? {});
    const pledge = makePledge({ id: newId(), caster: actor.uuid, spell: facts, rank: supply.rank ?? facts?.rank ?? null, castings }, stampNow());
    await write({ set: { [`orders.${orderId}.pledges.${pledge.id}`]: pledge } });
    return { ok: true, pledge: pledge.id };
}

/**
 * Mark a pledge cast (6.9): the caster's owners. A scroll's spell cost (`costCp`) is paid from the payer's purse as a
 * `purchase` row in the same move.
 */
export async function fulfilPledge(orderId, pledgeId, { costCp = 0 } = {}) {
    const { order, supply, refusal } = await openOrder(orderId);
    if (refusal) return refusal;
    const pledge = order.pledges?.[pledgeId];
    if (!pledge) return refuse("no-pledge");
    if (!actorOf(pledge.caster)?.isOwner) return refuse("not-owner");
    const step = pledgeTransition(pledge, "fulfil");
    if (!step.ok) return step;
    const set = { [`orders.${orderId}.pledges.${pledgeId}.status`]: "fulfilled", [`orders.${orderId}.pledges.${pledgeId}.costCp`]: costCp };
    if (!(costCp > 0) || supply.kind === "wand") {
        await write({ set });
        return { ok: true };
    }
    const payer = actorOf(pledge.payer ?? pledge.caster);
    if (!payer?.isOwner) return refuse("not-owner");
    const row = { kind: "purchase", how: { via: "purse" }, idem: idemKey("purchase", "casting", orderId, pledgeId), cp: costCp, actor: payer.uuid, order: orderId };
    return moveCoins(() => {
        const stacks = freeStacks(payer);
        const plan = planPurseDebit(stacks, costCp);
        if (!plan) return { refuse: "purse-short" };
        return { rows: [row], debits: [{ target: payer.uuid, plan }], locks: purseLockIds(stacks, plan), ledger: { set } };
    }, {}, [row]);
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
 * Buy castings at the spellcasting-service price (Player Core p.295) from a character's purse: a fulfilled pledge with no
 * caster, and a `purchase` row of the service price per casting at the item's rank (a staff's or spellheart's at the
 * spell's own rank), in one move. `spell` is a compendium spell's UUID. Spellcasting services are uncommon, so this is
 * the table's call: the module records it.
 */
export async function buyCasting(orderId, { payer, spell, castings = 1 }) {
    const { order, supply, refusal } = await openOrder(orderId);
    if (refusal) return refusal;
    const purse = actorOf(payer);
    if (!purse?.isOwner) return refuse("not-owner");
    const doc = typeof spell === "string" ? await fromUuid(spell).catch(() => null) : null;
    if (doc?.type !== "spell") return refuse("no-spell");
    const facts = { ...spellFacts(doc), source: doc.uuid };
    const problem = pledgeProblem({ supply, spell: facts, castings, existing: livePledges(order) });
    if (problem) return refuse(problem.reason, problem.data ?? {});
    const rank = supply.rank ?? facts.rank;
    const cost = castingServiceCp(rank) * castings;
    const pledge = makePledge({ id: newId(), caster: null, spell: facts, rank, castings, payer: purse.uuid, service: true, costCp: cost }, stampNow());
    const row = { kind: "purchase", how: { via: "purse" }, idem: idemKey("purchase", "casting", orderId, pledge.id), cp: cost, actor: purse.uuid, order: orderId };
    return moveCoins(() => {
        const stacks = freeStacks(purse);
        const plan = planPurseDebit(stacks, cost);
        if (!plan) return { refuse: "purse-short" };
        return { rows: [row], debits: [{ target: purse.uuid, plan }], locks: purseLockIds(stacks, plan),
            ledger: { set: { [`orders.${orderId}.pledges.${pledge.id}`]: pledge } } };
    }, {}, [row]);
}
