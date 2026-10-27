/**
 * Converting magic items: Deconstruct (DESIGN.md 6.16.5, Treasure Vault (Remastered) p.162, M9a) on this client: the
 * purpose chosen before the start, the checklist items the crafter confirms (the workshop; for a later order, that its
 * product is similar), the follow-on order a similar Deconstruct's day also sets up, the settlement that turns the item
 * into components (or damages it), and a retry of a damaged item. Its order runs on the Craft machine with no money: one
 * day of setup, then the check; the credit lives on the item (`flags.MOD.components`) and a later order takes it as a
 * material line (`custody.mjs`, purpose "material").
 *
 * Who writes what (4.2.4): the crafter's owner chooses the purpose (the requester too, before the start), confirms the
 * checklist and settles; the settlement changes the item where it is, on the crafter (the settling user owns it) or in the
 * strongbox (every player owns it), in one request behind the order's log slot, so it lands once or not at all.
 */
import { MODULE_ID } from "../constants.mjs";
import { DEGREE } from "../logic/core.mjs";
import { closedAs, lastEntry, settlementRecord, transitionChange } from "../logic/orders.mjs";
import { componentsExpired, componentsRecord, followOnCredit } from "../logic/variants.mjs";
import { compareRows } from "../logic/core.mjs";
import { runRequest } from "./batch.mjs";
import { today } from "./downtime.mjs";
import { liveItemFacts, targetOf } from "./products.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { read, records, stampNow, write } from "./store.mjs";
import { variantOn, whisperTo } from "./variants.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const owns = (uuid) => actorOf(uuid)?.isOwner === true;

/** Checklist items a crafter confirms (P1): the workshop (Deconstruct, D6), Grow's tools, a product similar to components. */
export const CHECKLIST_KEYS = Object.freeze(["workshop", "grow-tools", "similar"]);

/** The order, or a refusal. */
function orderFor(id) {
    if (!canWrite()) return { refusal: refuse("not-ready") };
    const order = read(`orders.${id}`);
    if (!order) return { refusal: refuse("no-order") };
    const closed = closedAs(order);
    return closed ? { refusal: refuse("state", { status: closed }) } : { order };
}

/** States in which a checklist item may change: before an attempt commits (the start, or a retry after a failure). */
const CHECKLIST_OPEN = Object.freeze(["requested", "accepted", "failed"]);

/**
 * Confirm a checklist item of an order, or take it back (P1: the crafter confirms the narrative requirements): the
 * workshop a Deconstruct needs, the tools a Grow uses, or that the product is similar to the components it takes. The
 * crafter's owner, before an attempt commits (the start, or a retry): a `similar` confirmation changes what a components line
 * counts for, and the coins committed at the start were reckoned against it, so it is frozen with them (review fix of M9a).
 * Refused: `variant-off`, `not-owner`, `state`, `key`.
 */
export async function confirmChecklist(orderId, key, on = true) {
    const { order, refusal } = orderFor(orderId);
    if (refusal) return refusal;
    if (!CHECKLIST_KEYS.includes(key)) return refuse("key");
    const variant = key === "grow-tools" ? "grow" : "deconstruct";
    if (!variantOn(variant)) return refuse("variant-off");
    if (!order.crafter || !owns(order.crafter)) return refuse("not-owner");
    if (!CHECKLIST_OPEN.includes(order.status)) return refuse("state", { status: order.status });
    const path = `orders.${orderId}.checklist.${key}`;
    if (on) await write({ replace: { [path]: { confirmedBy: game.user.id, ...stampNow() } } });
    else await write({ del: [path] });
    return { ok: true, on: !!on };
}

/**
 * Choose what a Deconstruct is for (6.16.5): a new similar item (with what it should be like: a family, a category, a
 * note) or raw materials for any item. Before the start; frozen with it. The crafter's or the requester's owner. Refused:
 * `off`, `state`, `not-owner`, `purpose`.
 */
export async function setPurpose(orderId, purpose, similarTo = null) {
    if (!variantOn("deconstruct")) return refuse("variant-off");
    const { order, refusal } = orderFor(orderId);
    if (refusal) return refusal;
    if (order.craftType !== "deconstruct") return refuse("state", { status: order.status });
    if (!["requested", "accepted"].includes(order.status)) return refuse("state", { status: order.status });
    if (!(game.user.isGM || owns(order.requester) || (order.crafter && owns(order.crafter)))) return refuse("not-owner");
    if (purpose !== "similar" && purpose !== "raw") return refuse("purpose");
    const set = { [`orders.${orderId}.variant.deconstruct.purpose`]: purpose };
    if (purpose === "raw") set[`orders.${orderId}.variant.deconstruct.followOn`] = null;
    await write({ set, replace: { [`orders.${orderId}.variant.deconstruct.similarTo`]: purpose === "similar" ? { note: String(similarTo?.note ?? "") } : null } });
    return { ok: true };
}

/**
 * Name the order a similar Deconstruct's day also counts toward (6.16.5, TV-R p.162): one of the crafter's own open orders
 * whose product the crafter has confirmed as similar (`checklist.similar`). Only with purpose `similar`; refused as `raw`
 * otherwise, `not-similar` for an order not confirmed, `not-owner`, `off`, `state`.
 */
export async function chooseFollowOn(orderId, followOnId) {
    if (!variantOn("deconstruct")) return refuse("variant-off");
    const { order, refusal } = orderFor(orderId);
    if (refusal) return refusal;
    if (order.craftType !== "deconstruct" || !["requested", "accepted", "setup", "check", "rolled"].includes(order.status)) {
        return refuse("state", { status: order.status });
    }
    if (!order.crafter || !owns(order.crafter)) return refuse("not-owner");
    if (order.variant?.deconstruct?.purpose !== "similar") return refuse("raw");
    if (followOnId) {
        const other = read(`orders.${followOnId}`);
        if (!other || closedAs(other) || other.crafter !== order.crafter || other.id === order.id) return refuse("no-order");
        if (!other.checklist?.similar) return refuse("not-similar");
    }
    await write({ set: { [`orders.${orderId}.variant.deconstruct.followOn`]: followOnId || null } });
    return { ok: true };
}

/** The flags of a deconstructed item (6.16.5): components, inert, "(components)", unequipped and uninvested. */
function componentsUpdate(item, components) {
    const name = item.flags?.[MODULE_ID]?.inertFrom?.name ?? item.name;
    const update = {
        _id: item.id, name: game.i18n.format("pf2e-artisans-workshop.Variant.Deconstruct.ComponentsName", { name }),
        [`flags.${MODULE_ID}.components`]: components, [`flags.${MODULE_ID}.inert`]: true,
        [`flags.${MODULE_ID}.inertFrom`]: { name, reason: "components", at: components.at },
    };
    if (item.system?.equipped) {
        update["system.equipped.carryType"] = "worn";
        update["system.equipped.handsHeld"] = 0;
        update["system.equipped.inSlot"] = false;
        if (item.system.equipped.invested !== undefined && item.system.equipped.invested !== null) update["system.equipped.invested"] = false;
    }
    return update;
}

/** The deconstruct day: the crafter's setup day of the current attempt (the follow-on's credit is for that day). */
function deconstructDay(order) {
    const setups = records("days").filter((d) => d.order === order.id && d.attempt === order.attempt && d.kind === "setup").sort(compareRows);
    return setups.at(-1)?.day ?? today().day;
}

/**
 * Settle a Deconstruct's check (4.2.3 `rolled (Deconstruct)`, 6.16.5): no money moves, and there is no finishing phase.
 * - Success or critical success: the item becomes components where it is (`flags.MOD.components` with the credit at its
 *   purpose and at the raw share, marked inert "(components)", unequipped and uninvested; its Bulk stays the item's) and
 *   the order completes. With purpose `similar` and a follow-on named, the follow-on gets the deconstruct day as a setup
 *   day (a `setup` variant record for its current attempt, or the one its start will create), written here because the
 *   check is rolled after the day.
 * - Failure: the day is wasted; the order fails and may be retried.
 * - Critical failure: the item is damaged (`variant.deconstruct.damaged`); a retry needs a Repair first or accepts a 5% loss.
 *   The damage is written on the item too (`flags.MOD.deconstructDamage`, `itemDamage`), so a new order for the same item
 *   inherits it and cancelling the failed one does not shed it (review fix of M9a).
 * One request behind the order's log slot: the item's update and the order's change land together or not at all.
 */
export async function settleDeconstruct(order) {
    if (!canWrite()) return refuse("not-ready");
    if (order.status !== "rolled" || !order.check) return refuse("state", { status: order.status });
    if (order.check.settled) return refuse("settled");
    const crafter = actorOf(order.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    const degree = order.check.degree;
    const stamp = stampNow();
    const check = { ...order.check, settled: true };
    const success = degree >= DEGREE.success;
    const d = order.variant?.deconstruct ?? {};
    const patch = { check, status: success ? "complete" : "failed" };
    if (degree === DEGREE.critFail) patch.variant = { ...order.variant, deconstruct: { ...d, damaged: true, damagedAt: stamp.at } };
    patch.settlement = settlementRecord(order, { check, status: patch.status }, [], stamp);
    // A success is final (it changed the item); a failure can be undone like any settlement.
    const change = transitionChange(order, success ? "deconstruct" : "settle", patch, {}, stamp);
    const ops = [{ op: "lock", ids: [change.lock] }];
    const ledger = { set: { ...change.set }, replace: { ...change.replace } };
    let components = null;
    if (degree === DEGREE.critFail) {
        const item = targetOf(order);
        if (item?.parent) {
            const inBox = item.parent === shared().strongbox;
            ops.push({ op: "updateItems", target: inBox ? "strongbox" : item.parent.uuid,
                updates: [{ _id: item.id, [`flags.${MODULE_ID}.deconstructDamage`]: itemDamage({ ...d, damaged: true, damagedAt: stamp.at }, order.id) }] });
        }
    }
    if (success) {
        const item = targetOf(order);
        const facts = liveItemFacts(item);
        if (!facts) return refuse("no-target");
        const day = deconstructDay(order);
        components = componentsRecord({ priceCp: facts.priceCp, degree, purpose: d.purpose, similarTo: d.similarTo ?? null, lossPct: d.lossPct ?? 0,
            order: order.id, from: facts.sourceId ?? facts.uuid, day }, stamp, rulesFromSettings());
        const inBox = item.parent === shared().strongbox;
        const update = componentsUpdate(item, components);
        // Handed over for the Deconstruct (G10), the components go back to whoever handed the item over, on the shelf (5.5).
        const line = Object.values(order.custody ?? {}).find((l) => l?.purpose === "target" && !l.returned && l.itemId === item.id);
        if (inBox && line) {
            update[`flags.${MODULE_ID}.earmark`] = null;
            update[`flags.${MODULE_ID}.shelf`] = { for: line.from, from: line.from, order: order.id, claimKey: `return:${order.id}:${line.id}:components`, at: stamp.at };
            ledger.set[`orders.${order.id}.custody.${line.id}.returned`] = stamp;
        }
        ops.push({ op: "updateItems", target: inBox ? "strongbox" : item.parent.uuid, updates: [update] });
        const followOn = d.purpose === "similar" && d.followOn ? read(`orders.${d.followOn}`) : null;
        if (followOn && !closedAs(followOn) && followOn.checklist?.similar) {
            const credit = followOnCredit({ actorId: crafter.id, day, followOn, from: order.id }, stamp);
            ledger.replace[`days.${credit.id}`] = credit;
        }
    }
    ops.push({ op: "ledger", change: ledger });
    const result = await runRequest(ops);
    if (result.outcome === "refused") return refuse("taken");
    if (result.outcome !== "ok") return refuse(result.reason ?? "error", { outcome: result.outcome });
    await postResult(order, { degree, components });
    return { ok: true, outcome: "ok", status: patch.status, components };
}

/** The Deconstruct result card (10.5): the degree and the credit, or what failed. */
async function postResult(order, { degree, components }) {
    try {
        const { money } = await import("../ui/format.mjs");
        const name = order.product?.snapshot?.name ?? "";
        const key = components ? "pf2e-artisans-workshop.Variant.Deconstruct.Card.Success"
            : degree === DEGREE.critFail ? "pf2e-artisans-workshop.Variant.Deconstruct.Card.Damaged" : "pf2e-artisans-workshop.Variant.Deconstruct.Card.Failure";
        const summary = game.i18n.format(key, { item: name, credit: components ? money(components.valueCp) : "", raw: components ? money(components.rawCp) : "" });
        const content = await foundry.applications.handlebars.renderTemplate("modules/pf2e-artisans-workshop/templates/chat/morning.hbs", {
            kind: "deconstruct", heading: game.i18n.localize("pf2e-artisans-workshop.Variant.Deconstruct.Card.Heading"),
            img: order.product?.snapshot?.img ?? null, summary, lines: [], notes: [],
        });
        await ChatMessage.implementation.create({ content, whisper: whisperTo([order.crafter, order.requester]),
            speaker: ChatMessage.implementation.getSpeaker({ actor: actorOf(order.crafter) }),
            flags: { [MODULE_ID]: { card: { kind: "deconstruct", order: order.id } } } });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post a Deconstruct card`, error);
    }
}

/**
 * Whether a damaged item was repaired since it was damaged (6.16.5): a Repair service on it (`services`, 4.5), done after
 * the critical failure.
 */
export function repairedSince(order) {
    const since = order.variant?.deconstruct?.damagedAt;
    const target = order.target;
    return records("services").some((s) => s.kind === "repair" && s.status === "done" && s.target === target &&
        (!since || compareRows({ id: "", at: since }, { id: "", at: s.at }) < 0));
}

/** The damage a Deconstruct's critical failure left on an item (`flags.MOD.deconstructDamage`), or null. */
export const damageOf = (item) => item?.flags?.[MODULE_ID]?.deconstructDamage ?? null;

/** The item's damage record (6.16.5) from an order's `variant.deconstruct`: damaged or not, since when, the loss accepted so far. */
const itemDamage = (d, orderId) => ({ damaged: d.damaged === true, at: d.damagedAt ?? null, lossPct: d.lossPct ?? 0, order: orderId });

/**
 * The damage a new Deconstruct of `item` starts with (6.16.5, review fix of M9a): what the item's last critical failure left
 * (`damageOf`), so cancelling the failed order and filing a new one neither repairs it nor forgets the loss accepted so far.
 */
export function inheritedDamage(item) {
    const damage = damageOf(item);
    return damage ? { damaged: damage.damaged === true, damagedAt: damage.at ?? null, lossPct: Number(damage.lossPct) || 0 } : {};
}

/**
 * Write an order's damage state back onto its item (6.16.5) once a start or a retry cleared it (a repair, or a loss accepted),
 * so a later order for the item inherits that. Best effort: the order holds the truth for itself.
 */
export async function noteItemDamage(order) {
    const item = targetOf(order);
    if (!damageOf(item)) return;
    try {
        await item.update({ [`flags.${MODULE_ID}.deconstructDamage`]: itemDamage(order.variant?.deconstruct ?? {}, order.id) });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not note the item's damage`, error);
    }
}

/**
 * What a retry (or the start) of a Deconstruct changes (6.16.5): a damaged item needs a Repair first (which clears the
 * damage) or the crafter accepts losing 5% of its value for this attempt (`lossPct` + 5, per attempt, interpretation OQ-45).
 * Returns the `variant` patch, or a refusal `damaged` when neither.
 */
export function retryPatch(order, { acceptLoss = false } = {}) {
    const d = order.variant?.deconstruct ?? {};
    if (!d.damaged) return { ok: true, variant: null };
    if (repairedSince(order)) return { ok: true, variant: { ...order.variant, deconstruct: { ...d, damaged: false, damagedAt: null } } };
    if (!acceptLoss) return refuse("damaged");
    return { ok: true, variant: { ...order.variant, deconstruct: { ...d, damaged: false, damagedAt: null, lossPct: (d.lossPct ?? 0) + 5 } } };
}

/** An item's components record (6.16.5), or null. */
export const componentsOf = (item) => item?.flags?.[MODULE_ID]?.components ?? null;

/** Whether components may still be used today (`deconstructExpiryDays`). */
export function componentsUsable(item) {
    const components = componentsOf(item);
    return !!components && !componentsExpired(components, today().day);
}

/** The components the user's characters hold (and the strongbox's not earmarked), for a later order to take. */
export function componentsChoices(actors) {
    const box = shared().strongbox;
    const out = [];
    for (const actor of [...actors, ...(box ? [box] : [])]) {
        for (const item of actor.items ?? []) {
            if (!componentsUsable(item) || item.flags?.[MODULE_ID]?.earmark) continue;
            out.push({ uuid: item.uuid, name: item.name, holder: actor.name, components: componentsOf(item) });
        }
    }
    return out;
}

/** The last transition of an order, for tests. */
export const lastTransition = (order) => lastEntry(order);
