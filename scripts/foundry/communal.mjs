/**
 * Communal Crafting helpers on this client (DESIGN.md 6.7, M6): joining an order as a helper, the crafter accepting a
 * helper who brings the feat, leaving, and who may help with what. The rules are `scripts/logic/communal.mjs`; the helper's
 * check is rolled and recorded by the roll wrapper (`rollHelper`, `scripts/foundry/rolls.mjs`); a helper's share of each
 * extra day is in the crafter's day record (6.2.3).
 *
 * Each helper writes only their own entry (`orders.<id>.helpers.<actorId>`, 4.2.4) and their own status (their activity
 * becomes `help:<orderId>`, and `lockedBy` the order: helpers are locked from joining to the end of the Craft). The
 * crafter's owner writes only the acceptance of a helper (`accepted`), a key of its own.
 *
 * Settings (14.2 `rules.communal.*`, the author's defaults of 2026-10-25): helpers roll against the item's Craft DC; their
 * degree picks the Income Earned entry at (their level - 1) and their rank, a critical success one row up and a failure
 * the failure column; one who leaves forfeits what they gave; no cap; the feat is needed unless the GM counts helpers
 * without it.
 */
import { FEAT, RANK, asSet } from "../logic/core.mjs";
import { helperEligibility, joinHelper, leaveHelper, relevantSkills } from "../logic/communal.mjs";
import { helperLockOf, PC_VERSION } from "../logic/downtime.mjs";
import { closedAs } from "../logic/orders.mjs";
import { nextDayOf, statusOf } from "./downtime.mjs";
import { featKeysOf, ranksOf } from "./registry.mjs";
import { rollHelper } from "./rolls.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite } from "./state.mjs";
import { read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid) : null);

/** The registry feat keys of an actor: its own when this user may read it, else its roster snapshot's (4.10). */
function featsOf(actor) {
    if (!actor) return [];
    if (actor.isOwner || game.user.isGM) return featKeysOf(actor);
    return read(`roster.${actor.id}`)?.feats ?? [];
}

/** The skills a helper may roll for the order's item (6.7): Crafting, the trait mapping, and the crafter's marks. */
export function relevantFor(order) {
    const snapshot = order.product?.snapshot ?? {};
    return relevantSkills({ traits: snapshot.traits ?? [], type: snapshot.type ?? null }, order.variant?.relevantSkills ?? []);
}

/**
 * Whether `actor` may help on the order with `skill`, and why not (6.7 `helperEligibility`): the feat (the crafter's, or
 * the helper's with the crafter's acceptance, or the GM's setting), a PC trained in a relevant skill, not locked as a
 * helper elsewhere, within the cap.
 * @returns {{ok: boolean, reasons: string[], needsAcceptance: boolean}}
 */
export function eligibility(order, actor, skill) {
    const rules = rulesFromSettings();
    const crafter = actorOf(order.crafter);
    const crafterHasFeat = asSet(featsOf(crafter)).has(FEAT.communalCrafting);
    const helperFeats = featsOf(actor);
    const lock = helperLockOf(records("orders"), actor.id);
    const others = Object.entries(order.helpers ?? {}).filter(([id, h]) => id !== actor.id && h.leftDay == null).length;
    const result = helperEligibility({
        helper: { isPC: actor.type === "character", feats: helperFeats, ranks: ranksOf(actor) },
        skill, crafterHasFeat, accepted: true, relevant: relevantFor(order), lockedElsewhere: !!lock && lock !== order.id, otherHelpers: others,
    }, rules);
    const needsAcceptance = !crafterHasFeat && !rules.communal.countHelpersWithoutFeat && asSet(helperFeats).has(FEAT.communalCrafting);
    return { ...result, needsAcceptance };
}

/** The skills `actor` could help with on the order: relevant ones they are trained in (an empty list if none). */
export function helpSkills(order, actor) {
    const ranks = ranksOf(actor);
    return [...relevantFor(order)].filter((skill) => (ranks[skill] ?? RANK.untrained) >= RANK.trained).sort();
}

/**
 * Join an order as a helper (6.7), as the helper's owner: their entry from their next open day (or the crafter's, if
 * later, so their share starts with a day the crafter has not resolved yet), their activity `help:<orderId>` and
 * `lockedBy`. Refused: `not-ready`, `no-order`, `not-owner`, `not-eligible` (with the reasons), and `joinHelper`'s.
 */
export async function joinOrder(orderId, actorUuid, skill) {
    if (!canWrite()) return refuse("not-ready");
    const order = read(`orders.${orderId}`);
    if (!order) return refuse("no-order");
    if (closedAs(order)) return refuse("state", { status: closedAs(order) });
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const check = eligibility(order, actor, skill);
    if (!check.ok) return refuse("not-eligible", { reasons: check.reasons });
    const crafter = actorOf(order.crafter);
    const joinedDay = Math.max(nextDayOf(actor), crafter ? nextDayOf(crafter) : -Infinity);
    const result = joinHelper(order, {
        actorId: actor.id, crafterId: crafter?.id ?? null, skill, rank: ranksOf(actor)[skill] ?? 0, level: actor.level ?? 0, joinedDay,
        accepted: !check.needsAcceptance,
    });
    if (!result.ok) return result;
    const stamp = stampNow();
    await write({
        replace: { [`orders.${orderId}.helpers.${actor.id}`]: { ...result.entry, ...stamp }, [`pcs.${actor.id}.activity`]: { kind: "help", ref: orderId } },
        set: { [`pcs.${actor.id}.id`]: actor.id, [`pcs.${actor.id}.v`]: PC_VERSION, [`pcs.${actor.id}.lockedBy`]: orderId },
    });
    return { ok: true, joinedDay, accepted: result.entry.accepted };
}

/**
 * Leave an order (6.7), as the helper's owner: `leftDay` is the first day neither the helper nor the crafter has resolved
 * yet (days the crafter already resolved counted the helper, and the helper's own days up to then were locked to the
 * order, so they still count as days spent helping); what they gave is forfeited by `rules.communal.helperLeaveRetroactive`.
 * Their activity is cleared. Refused: `not-ready`, `no-order`, `not-owner`, and `leaveHelper`'s.
 */
export async function leaveOrder(orderId, actorUuid) {
    if (!canWrite()) return refuse("not-ready");
    const order = read(`orders.${orderId}`);
    if (!order) return refuse("no-order");
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const crafter = actorOf(order.crafter);
    const result = leaveHelper(order, actor.id, Math.max(nextDayOf(actor), crafter ? nextDayOf(crafter) : -Infinity));
    if (!result.ok) return result;
    const status = statusOf(actor);
    const set = { [`orders.${orderId}.helpers.${actor.id}.leftDay`]: result.leftDay };
    if (status.lockedBy === orderId) set[`pcs.${actor.id}.lockedBy`] = null;
    if (status.activity?.kind === "help" && status.activity.ref === orderId) set[`pcs.${actor.id}.activity`] = null;
    await write({ set });
    return { ok: true, leftDay: result.leftDay, forfeits: rulesFromSettings().communal.helperLeaveRetroactive };
}

/** The crafter's owner accepts a helper who brought the feat (6.7: "a crafter who accepts"). Refused: `not-helping`, `not-owner`. */
export async function acceptHelper(orderId, actorId) {
    if (!canWrite()) return refuse("not-ready");
    const order = read(`orders.${orderId}`);
    if (!order?.helpers?.[actorId] || order.helpers[actorId].leftDay != null) return refuse("not-helping");
    if (!actorOf(order.crafter)?.isOwner) return refuse("not-owner");
    if (order.helpers[actorId].accepted !== false) return { ok: true, outcome: "already" };
    await write({ set: { [`orders.${orderId}.helpers.${actorId}.accepted`]: true } });
    return { ok: true, outcome: "ok" };
}

/** Roll the helper's check (`rollHelper`). */
export function rollHelp(orderId, actorUuid, options = {}) {
    return rollHelper(orderId, actorUuid, options);
}
