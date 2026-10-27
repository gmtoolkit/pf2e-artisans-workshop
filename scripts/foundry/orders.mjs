/**
 * The order lifecycle (DESIGN.md 4.2.3, 6.2) on this client: filing a request, accepting, starting, a crafter's work
 * days, settling (`rolls.mjs`), finishing onto the pickup shelf, pausing, retrying, cancelling with refunds, and undo.
 * The rules are M1's and `scripts/logic/orders.mjs`; money moves through M2's lock-first coin moves and claims.
 *
 * Every function is a user's own action, so it runs on that user's client without a responsible-client guard (5.6),
 * and checks only what that user may do (4.2.4: the crafter's steps belong to the crafter's owners, a cancel to the
 * requester's or the crafter's, a GM may do any). They return `{ok, reason?, ...}`; `reason` codes are mapped to notices
 * by the window (`scripts/ui/labels.mjs`).
 *
 * Every transition's request takes the lock page of its log slot (`logLockId`, As built in M4), so of two transitions
 * planned from the same copy of an order only the first lands (the other comes back "taken" or "conflict"), and none
 * runs on an order its log says is closed (`closedAs`), whatever a late write left in its `status`. The transitions
 * that move the order's money (start, retry, settle, finish, cancel) also take its return slot (`returnSlotLockId`), as
 * a take-back and a give-back of the fund's share do, so none of those lands with a transition planned from the same
 * copy (review fix of M4.1).
 *
 * The one hook-driven write here is the order repair (6.12, As built in M4), on the crafter's responsible client: a
 * settled check a late reroll overwrote, a closed order's status a late work day or first roll moved, and (M6) a setup
 * that day records written by a wizard runner who does not own the crafter completed, which moves to `check`.
 *
 * As built in M6: an order's "Work a day" is the day resolver for one day of the crafter's (`resolveDays`,
 * `scripts/foundry/downtime.mjs`), and starting an order makes it the crafter's downtime activity (4.2.3).
 *
 * As built in M9: a tattoo or graft (6.14) is filed for its subject, who receives it; the start freezes the tattoo
 * process and a fulu's tradition on the order, and a graft rolls Medicine; a retry needs the subject's consent still.
 */
import { MODULE_ID } from "../constants.mjs";
import { batchMax, splitIntoBatches } from "../logic/batches.mjs";
import { makeClaim } from "../logic/claims.mjs";
import {
    cancelOrder, committedFromRows, expendedFromRows, pauseOrder, resumeOrder, retryOrder, startOrder,
} from "../logic/craft.mjs";
import { returnSlotLockId } from "../logic/funds.mjs";
import { allPass } from "../logic/gates.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { PC_VERSION } from "../logic/downtime.mjs";
import {
    MONEYLESS, TARGETED, WITH_SUBJECT, acceptOrder, closedAs, closedRepair, lastEntry, leftAfterSpend, makeOrder, refundClaims, releaseOrder,
    settlementRepair, setupRepair, transitionChange, undoPlan, withdrawableCp,
} from "../logic/orders.mjs";
import { consentOf, fuluTradition, selfSubject, subjectProcess, subjectTypeOf } from "../logic/crafts.mjs";
import { remainingCp } from "../logic/progress.mjs";
import { seqFor } from "../logic/rows.mjs";
import { allocationsByContributor } from "../logic/split.mjs";
import { FORMULA_ORDER_ROUTES } from "../logic/formula-jobs.mjs";
import { planSpend } from "../logic/coins.mjs";
import { materialsCp } from "../logic/materials.mjs";
import { spellSupply } from "../logic/pledges.mjs";
import { postCard } from "../ui/chat.mjs";
import { givingBack, heldLines } from "./custody.mjs";
import { resolveDays } from "./downtime.mjs";
import { applyIfResponsible, knownState } from "./formulas.mjs";
import { craftTypeOn, madeDespite, makeQuest, rushedInAttempt } from "../logic/variants.mjs";
import { inheritedDamage, noteItemDamage, retryPatch } from "./deconstruct.mjs";
import { today } from "./downtime.mjs";
import { rushFlatCheck } from "./variants.mjs";
import { freeStacks, lockedWrite, moveCoins, pledge, reverseRows, withdraw } from "./money.mjs";
import { finishOutputs } from "./outputs.mjs";
import { crafterFacts, gatesFor, productFacts, skillFor, snapshotOf } from "./products.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { rollCraft, settleOrder } from "./rolls.mjs";
import { members } from "./roster.mjs";
import { rulesFromSettings, setting } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { newId, read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/** The order, or a refusal: none, or one its log says is closed (`closedAs`), whatever its `status` says. */
function orderOrRefuse(id) {
    if (!canWrite()) return { refusal: refuse("not-ready") };
    const order = read(`orders.${id}`);
    if (!order) return { refusal: refuse("no-order") };
    const closed = closedAs(order);
    return closed ? { refusal: refuse("state", { status: closed }) } : { order };
}

/** An actor by UUID, or null. */
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid) : null);

/** Whether this user may act for the actor (its owner, or a GM). */
export const owns = (uuid) => actorOf(uuid)?.isOwner === true;

/** The order's ledger rows. */
export const orderRows = (id) => records("rows").filter((row) => row.order === id);

/** The order's day records (setup and extra days of every attempt). */
export const orderDays = (id) => records("days").filter((day) => day.order === id);

/** The viewer this user is, for the pure permission rules. */
export function viewer() {
    return {
        userId: game.user.id, isGM: game.user.isGM, owns,
        // One of the user's own characters: their assigned one, or one they own by name; for a GM, only actors no
        // player owns (a GM creating every character owns them all by name, and is not a party to every order).
        isMine: (uuid) => {
            const actor = actorOf(uuid);
            if (!actor) return false;
            if (game.user.character === actor) return true;
            const named = actor.ownership?.[game.user.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            return named && (!game.user.isGM || !actor.hasPlayerOwner);
        },
        hasCharacter: game.user.isGM || members().some((actor) => actor.isOwner),
    };
}

/** The member actors this user acts for: their own characters, or every member for a GM. */
export function actingChoices() {
    return members().filter((actor) => actor.isOwner);
}

/** Write a transition that posts no rows (the order's fields and its log entry) behind its log slot's lock. */
function writeTransition(order, event, patch) {
    const change = transitionChange(order, event, patch, {}, stampNow());
    return lockedWrite([change.lock], [], { set: change.set, replace: change.replace });
}

/* -------------------------------------------- */
/*  Filing                                       */
/* -------------------------------------------- */

/**
 * File a request (4.2.3): one order per batch (6.3), each with its product snapshot. A quantity above one batch splits
 * into several orders. Naming a crafter this user owns takes the orders at once.
 *
 * @param {object} p
 * @param {string} p.uuid          the product's compendium UUID
 * @param {number} [p.quantity]
 * @param {string} p.requester     the requesting character's UUID (this user's)
 * @param {{kind: "actor"|"strongbox", uuid?: string}} [p.recipient]  the requester by default
 * @param {string|null} [p.crafter]
 * @param {string} [p.note]
 * @param {boolean} [p.gift]
 * @param {string|null} [p.target]   the item worked on (an etching, an upgrade, a transfer); M9: a tattoo's or graft's
 *   subject (an actor UUID, the requester by default), who receives it
 * @param {object} [p.variant]       M9: `replaces`, a tattoo or graft the subject has that this one upgrades
 * @returns {Promise<{ok: boolean, reason?: string, orders?: string[]}>}
 */
export async function requestOrder({ uuid, quantity = 1, requester, recipient = null, crafter = null, note = "", gift = false,
    craftType = null, productType = "item", route = null, target = null, variant = {} }) {
    if (!canWrite()) return refuse("not-ready");
    if (!owns(requester)) return refuse("not-owner");
    if (crafter && !owns(crafter)) return refuse("not-owner");
    if (!Number.isInteger(quantity) || quantity < 1) return refuse("quantity");
    const product = await productFacts(uuid);
    if (!product) return refuse("no-product");
    if (!(product.priceCp > 0)) return refuse("no-price");
    if (productType === "formula" && !FORMULA_ORDER_ROUTES.includes(route)) return refuse("no-route");
    const rules = rulesFromSettings();
    // M9a (6.16): a Deconstruct, a Grow or a quest exists only while its variant is on; so do adjustments, the special flag
    // and a bestowed gift, which are dropped from a request made while theirs is off.
    if (craftType && !craftTypeOn(craftType, rules)) return refuse("variant-off");
    variant = variantInput(craftType, variant, rules);
    if (craftType === "deconstruct") {
        const item = typeof target === "string" ? fromUuidSync(target, { strict: false }) : null;
        if (!item?.isOfType?.("physical") || !item.parent) return refuse("no-target");
        if (quantity !== 1) return refuse("quantity");
        recipient = { kind: "actor", uuid: item.parent === shared().strongbox ? requester : item.parent.uuid };
        // The damage an earlier Deconstruct's critical failure left on the item comes with it (review fix of M9a).
        variant.deconstruct = { ...variant.deconstruct, ...inheritedDamage(item) };
    }
    // M9 (6.14): a tattoo or graft is made on its subject, who receives it: one at a time, never for the strongbox.
    const tattoos = setting("features.tattoos") !== false;
    const subjectType = !tattoos ? null : productType === "item" && !craftType ? subjectTypeOf(product) : WITH_SUBJECT.includes(craftType) ? craftType : null;
    if (!tattoos && WITH_SUBJECT.includes(craftType)) return refuse("off");
    if (subjectType) {
        // The subject is the one named, else the recipient named, else the requester.
        target ??= recipient?.kind === "actor" && recipient.uuid ? recipient.uuid : requester;
        if (!actorOf(target)) return refuse("no-actor");
        if (recipient && (recipient.kind !== "actor" || recipient.uuid !== target)) return refuse("subject-recipient");
        recipient = { kind: "actor", uuid: target };
    }
    const to = recipient ?? { kind: "actor", uuid: requester };
    // A formula job for a book that has the formula, or will once a claim is applied, would teach nothing (5.5).
    const already = productType === "formula" ? knownState(actorOf(to.uuid), uuid) : null;
    if (already) return refuse(already);
    // M5: a scroll, wand, staff or spellheart is a spell-supplied item (6.9); a formula, an upgrade, an etching and a
    // transfer are one each. M9: so is a tattoo or a graft (6.14).
    const type = craftType ?? subjectType ?? (spellSupply(product) ? "spell-item" : "item");
    const single = productType === "formula" || TARGETED.includes(type) || WITH_SUBJECT.includes(type) || type === "deconstruct" || type === "quest" ||
        !!variant.adjustments?.length;
    const max = single ? 1 : crafter
        ? (await gatesFor({ id: "probe", quantity: 1, craftType: type }, crafterFacts(actorOf(crafter)), product, [], rules)).plan.batchMax
        : batchMax({ ...product }, { pledgedCastings: 4 }, rules);
    if (single && quantity !== 1) return refuse("quantity");
    const stamp = stampNow();
    const party = game.actors.party?.id ?? null;
    const made = splitIntoBatches(quantity, Math.max(1, max)).map((qty) => makeOrder({
        id: newId(), party, requester, recipient: to, product: { uuid, snapshot: snapshotOf(product) }, quantity: qty,
        crafter, note, visibility: gift ? "gift" : "public", craftType: type, productType, route, target, variant,
    }, stamp));
    await write({ set: Object.fromEntries(made.map((order) => [`orders.${order.id}`, order])) });
    for (const order of made) await postCard("request", order);
    return { ok: true, orders: made.map((order) => order.id) };
}

/**
 * The variant fields a request may carry (M9a, 6.16), each only while its variant is on: a Deconstruct's purpose (raw by
 * default), a quest (one moderate encounter by default, configured before the start), an item's adjustments, the special
 * flag (Critical Crafting) and a bestowed gift's giver. Anything else in `variant` (M5's transfer, M9's replaced tattoo)
 * passes through.
 */
function variantInput(craftType, variant = {}, rules) {
    const v = rules.variants;
    const { deconstruct, quest, adjustments, special, bestow, ...rest } = variant ?? {};
    const out = { ...rest };
    if (craftType === "deconstruct") {
        out.deconstruct = { purpose: deconstruct?.purpose === "similar" ? "similar" : "raw", similarTo: deconstruct?.similarTo ?? null, damaged: false,
            lossPct: 0, followOn: null };
    }
    if (craftType === "quest") {
        out.quest = quest?.components ? quest : makeQuest({ encounters: Math.max(1, Number(quest?.encounters) || 1), threats: quest?.threats ?? [],
            labels: quest?.labels ?? [], differentLocations: quest?.differentLocations !== false });
    }
    if (v.adjustments && Array.isArray(adjustments) && adjustments.length && (!craftType || craftType === "item")) out.adjustments = [...adjustments];
    if (v.criticalCrafting && special === true) out.special = true;
    if (v.gifts && bestow) out.bestow = { giver: String(bestow.giver ?? "") };
    return out;
}

/** Accept a requested order as `crafter` (a character this user owns). */
export async function accept(id, crafter) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    if (!owns(crafter)) return refuse("not-owner");
    const result = acceptOrder(order, crafter);
    if (!result.ok) return result;
    const written = await writeTransition(order, "accept", result.patch);
    if (!written.ok) return written;
    await postCard("accepted", read(`orders.${id}`));
    return { ok: true };
}

/** Give an accepted order back to the queue. */
export async function release(id) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    if (!owns(order.crafter)) return refuse("not-owner");
    const result = releaseOrder(order);
    if (!result.ok) return result;
    const written = await writeTransition(order, "release", result.patch);
    return written.ok ? { ok: true } : written;
}

/* -------------------------------------------- */
/*  Funding                                      */
/* -------------------------------------------- */

/**
 * Pledge `cp` from `actor` (a character this user owns) to an order: coins into the strongbox (4.6 `pledge`). M9a: a
 * Deconstruct or a quest moves no money (`MONEYLESS`), so it takes none: its completion would leave the coins allocated to a
 * closed order with no refund (review fix of M9a).
 */
export async function pledgeTo(id, actorUuid, cp) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    if (MONEYLESS.includes(order.craftType)) return refuse("moneyless");
    if (["complete", "cancelled", "archived", "rolled"].includes(order.status)) return refuse("state", { status: order.status });
    return pledge({ actor, cp, order: id, nonce: newId() });
}

/** Take back an unspent, uncommitted share of an order (4.6 `withdraw`). */
export async function withdrawFrom(id, actorUuid, cp) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const rows = orderRows(id);
    const max = withdrawableCp(order, rows, actorUuid);
    if (!(cp > 0) || cp > max) return refuse("too-much", { maxCp: max });
    // The order's return slot: a cancel, a finish or another take-off planned from the same copy cannot also land.
    return withdraw({ actor, cp, order: id, nonce: newId(), locks: [returnSlotLockId(order, rows)] });
}

/* -------------------------------------------- */
/*  Starting and working                         */
/* -------------------------------------------- */

/**
 * Start an accepted order (4.2.3): every gate must pass (P1); the plan is frozen (Price, up-front half, DC, setup,
 * route), a new attempt opens and the up-front half is committed. M9a: a Deconstruct of an item an earlier one damaged starts
 * once it was repaired, or with `acceptLoss` (5% of its value lost, 6.16.5), as a retry does.
 */
export async function start(id, { acceptLoss = false } = {}) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    const crafter = actorOf(order.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    const damage = order.craftType === "deconstruct" && order.status === "accepted" ? retryPatch(order, { acceptLoss: acceptLoss === true }) : { ok: true, variant: null };
    if (!damage.ok) return damage;
    const product = await productFacts(order.product.uuid);
    if (!product) return refuse("no-product");
    const rules = rulesFromSettings();
    const rows = orderRows(id);
    const { gates, plan } = await gatesFor(order, crafterFacts(crafter), product, rows, rules);
    if (!allPass(gates)) return refuse("gates", { gates: gates.filter((gate) => !gate.ok) });
    const result = startOrder(order, plan);
    if (!result.ok) return result;
    const patch = { ...result.patch, route: plan.route, skill: skillFor(order, rules), product: { ...order.product, snapshot: { ...order.product.snapshot, priceCp: product.priceCp, per: product.per } } };
    // M9: the tattoo process and a fulu's tradition are frozen with the plan, so a settings change mid-Craft changes nothing.
    const frozen = startFreeze(order, product, crafter, rules);
    if (frozen) patch.variant = { ...(patch.variant ?? order.variant ?? {}), ...frozen };
    // M9a: a quest gathers its components first (6.16.9); a Grow order counts its seasons from today (6.16.6); a quest's
    // equivalent cost is kept for the Funds tab.
    if (order.craftType === "quest") Object.assign(patch, { status: "gathering", quest: plan.quest ?? null });
    if (order.craftType === "grow") patch.variant = { ...(patch.variant ?? order.variant ?? {}), grow: { mode: "tended", since: null, startDay: today().day } };
    // M9a (6.16.2): whether the plan priced the item with its adjustments is frozen with the Price, so the finish makes what
    // was paid for whatever the setting says by then (review fix of M9a).
    if (order.variant?.adjustments?.length) patch.variant = { ...(patch.variant ?? order.variant ?? {}), adjusted: !!plan.change?.parts?.length };
    if (damage.variant) patch.variant = { ...(patch.variant ?? order.variant ?? {}), deconstruct: damage.variant.deconstruct };
    // Earmarked material items count toward the up-front half at their Price (M5, 6.6): the coins commit the rest.
    const commit = result.rows.map((row) => ({ kind: "commit", idem: idemKey("commit", id, patch.attempt, seqFor(rows, idemKey("commit", id, patch.attempt))),
        cp: Math.max(0, row.cp - materialsCp(order)), order: id })).filter((row) => row.cp > 0);
    const change = transitionChange(order, "start", patch, { rows: commit.map((row) => hashId(row.idem)) }, stampNow());
    // The crafter's downtime activity becomes this order (4.2.3, M6): the days the crafter resolves go to it by default.
    // A quest is earned through encounters, not downtime days (6.16.9): it leaves the crafter's activity alone.
    const activity = order.craftType === "quest" ? {} : { [`pcs.${crafter.id}.activity`]: { kind: "craft", ref: id } };
    const status = { [`pcs.${crafter.id}.id`]: crafter.id, [`pcs.${crafter.id}.v`]: PC_VERSION };
    const posted = await lockedWrite([change.lock, returnSlotLockId(order, rows)], commit,
        { set: { ...change.set, ...status }, replace: { ...change.replace, ...activity } });
    if (!posted.ok) return posted;
    if (damage.variant) await noteItemDamage(read(`orders.${id}`));
    await postCard("started", read(`orders.${id}`));
    return { ok: true };
}

/**
 * What a start freezes on an M9 order's `variant`, or null: a tattoo's process (6.14) and a fulu's tradition (Secrets of
 * Magic p.158: its creator's, the crafter's only one or the one chosen).
 */
function startFreeze(order, product, crafter, rules) {
    const out = {};
    if (order.craftType === "tattoo") out.process = subjectProcess("tattoo", rules, order.variant?.process ?? null).process;
    if (product.traits.includes("fulu")) {
        const tradition = fuluTradition({ chosen: order.variant?.tradition ?? null, traditions: crafterFacts(crafter).traditions });
        if (tradition) out.tradition = tradition;
    }
    return Object.keys(out).length ? out : null;
}

/** Why a work day planned nothing, as a refusal: the planner's stop (`planDays`). */
const WORK_STOPS = Object.freeze({ "paid-off": "paid-off", locked: "helper-locked", sitting: "subject" });

/**
 * The crafter works one day on the order: "Work a day" (M4), now the day resolver for one day (M6, 9.1): the crafter's
 * next open day (their first pending day while in downtime, else the next day), a setup day, which moves the order to
 * `check` once the setup is complete, or an extra day that brings the remainder down. An order whose check is recorded but
 * not settled is settled first (4.2.3: settlement comes with the order's next day); when that leaves nothing to take off,
 * the settlement is the step and no day is logged (`kind` null). Refused besides the usual: `paid-off` (nothing left to
 * take off: finish it), `helper-locked` (the crafter is helping on another order, 6.7), `taken`.
 */
export async function workDay(id) {
    const found = orderOrRefuse(id);
    if (found.refusal) return found.refusal;
    const order = found.order;
    const crafter = actorOf(order.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    if (!["setup", "rolled", "finishing"].includes(order.status)) return refuse("state", { status: order.status });
    const wasRolled = order.status === "rolled";   // `read` hands out the stored object, which the settlement updates
    const result = await resolveDays({ actor: crafter, activity: { kind: "craft", ref: id }, count: 1, mode: "work" });
    if (!result.ok) return result;
    const record = result.records?.[0];
    const status = read(`orders.${id}.status`);
    // The day settled the check (4.2.3): to finishing, or straight to complete (a Deconstruct) or failed (M9a live pass: not
    // "the order is Complete, so that cannot be done now" after the click did what it should).
    if (!record && wasRolled && status !== "rolled" && read(`orders.${id}.check.settled`) === true) return { ok: true, day: null, kind: null, status, settled: true };
    if (!record) return refuse(WORK_STOPS[result.stop?.reason] ?? "state", { status });
    return { ok: true, day: record.day, kind: record.kind, status };
}

/** Roll the Craft check through the roll wrapper (6.12). */
export async function roll(id, options = {}) {
    const order = read(`orders.${id}`);
    if (!order) return refuse("no-order");
    return rollCraft(id, options);
}

/** Settle the recorded check (4.2.3): `rolls.mjs` posts the money rows and the settlement record. */
export async function settle(id) {
    const order = read(`orders.${id}`);
    if (!order) return refuse("no-order");
    if (!owns(order.crafter)) return refuse("not-owner");
    return settleOrder(id);
}

/** Pause an order in setup or finishing. */
export async function pause(id) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    if (!owns(order.crafter)) return refuse("not-owner");
    const result = pauseOrder(order);
    if (!result.ok) return result;
    const written = await writeTransition(order, "pause", result.patch);
    return written.ok ? { ok: true } : written;
}

/** Resume a paused order (6.2.5). */
export async function resume(id) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    if (!owns(order.crafter)) return refuse("not-owner");
    const result = resumeOrder(order, rulesFromSettings());
    if (!result.ok) return result;
    const written = await writeTransition(order, "resume", result.patch);
    return written.ok ? { ok: true } : written;
}

/**
 * Retry a failed order from scratch: a new attempt and a new commit (4.2.3, 6.2.4). M9a: a damaged item's Deconstruct is
 * retried once it was repaired, or with `acceptLoss` (5% of its value lost for this retry, 6.16.5).
 */
export async function retry(id, { acceptLoss = false } = {}) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    if (!owns(order.crafter)) return refuse("not-owner");
    const rows = orderRows(id);
    // M9 (6.14): a tattoo or graft is retried on a subject who still consents (the consent may be withdrawn after a failure).
    if (WITH_SUBJECT.includes(order.craftType) && !selfSubject(order) && !consentOf(order)?.consented) return refuse("no-consent");
    // M9a: a quest whose assembly destroyed the item is over (6.16.9); a damaged item is repaired first or deconstructed
    // again at a loss (6.16.5).
    if (order.craftType === "quest") return refuse("state", { status: order.status });
    const damage = order.craftType === "deconstruct" ? retryPatch(order, { acceptLoss: acceptLoss === true }) : { ok: true, variant: null };
    if (!damage.ok) return damage;
    const result = retryOrder(order, { expendedCp: expendedFromRows(rows) });
    if (!result.ok) return result;
    if (damage.variant) result.patch.variant = damage.variant;
    const escrow = rows.reduce((sum, row) => sum + (row.alloc ?? 0), 0);
    const need = Math.max(0, result.rows.reduce((sum, row) => sum + row.cp, 0) - materialsCp(order));
    if (escrow < need) return refuse("underfunded", { shortCp: need - escrow });
    const attempt = result.patch.attempt;
    const commit = need > 0 ? [{ kind: "commit", idem: idemKey("commit", id, attempt, seqFor(rows, idemKey("commit", id, attempt))), cp: need, order: id }] : [];
    const change = transitionChange(order, "retry", result.patch, { rows: commit.map((row) => hashId(row.idem)) }, stampNow());
    const posted = await lockedWrite([change.lock, returnSlotLockId(order, rows)], commit, { set: change.set, replace: change.replace });
    if (posted.ok && damage.variant) await noteItemDamage(read(`orders.${id}`));
    return posted.ok ? { ok: true } : posted;
}

/* -------------------------------------------- */
/*  Finishing, cancelling, undo                  */
/* -------------------------------------------- */

/**
 * Finish an order in `finishing` (4.2.3, 6.2.3): one lock-first move pays the remainder out of the escrow, pro rata by
 * contributor, makes what the order makes (`finishOutputs`, M5: an item on the pickup shelf, a scroll or wand with its
 * pledged spell, a formula claim for the learner, or the etched, upgraded or transferred item put back with its
 * recipient), consumes earmarked material stock and gives back what was handed over for it, refunds what is left over as
 * refund claims (6.2.4), and marks the order complete. The move is resumable like every coin move, so an apply request
 * lost on the way is sent again and the item is shelved once. Its lock request takes the order's log slot, so a cancel
 * planned from the same copy and a finish never both land. A finish that moves no coins and no items (a formula job
 * with nothing left to pay) is one write behind the same lock. A formula claim is applied at once when this tab is
 * responsible for the learner.
 */
export async function finish(id) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    if (!owns(order.crafter)) return refuse("not-owner");
    if (order.status !== "finishing") return refuse("state", { status: order.status });
    const rules = rulesFromSettings();
    const rows = orderRows(id);
    const remainder = remainingCp(order, orderDays(id), rules);
    const allocations = allocationsByContributor(rows);
    const escrow = allocations.reduce((sum, a) => sum + a.cp, 0);
    if (escrow < remainder) return refuse("underfunded", { shortCp: remainder - escrow });
    // M9a (6.16.1): a finish after a rushed day rolls the flat check first (kept on the check, so it is rolled once): a failure
    // delivers the item with a quirk to describe, a critical failure ruins it or delivers it cursed. The rushed days are in the
    // ledger at twice the reduction, so the check is rolled whatever the setting says now (review fix of M9a).
    let rush = null;
    if (rushedInAttempt(order, orderDays(id))) {
        const flat = await rushFlatCheck(order);
        if (!flat.ok) return flat;
        rush = flat.flat;
    }
    const crafterName = actorOf(order.crafter)?.name ?? "";
    // M9a (6.16.4): an item made despite a critical failure carries what the Critical Crafting record says happened (review fix
    // of M9a); a rushed finish's own curse, if any, is the one the item keeps.
    const critical = order.check?.critical;
    const made = madeDespite(critical)
        ? { curse: { from: "critical-crafting", order: id, crafter: crafterName, category: critical.category ?? null, note: critical.note ?? "" } } : {};
    const flags = rush?.outcome === "quirk" ? { ...made, quirk: { from: "rushed-finish", order: id, note: "" } }
        : rush?.outcome === "cursed" ? { curse: { from: "rushed-finish", order: id, crafter: crafterName, note: "" } } : made;
    const outputs = await finishOutputs(order, { flags, make: rush?.outcome !== "ruined" });
    if (outputs.refuse) return refuse(outputs.refuse);
    const stem = idemKey("remainder", id, order.attempt);
    const key = `${stem}:${seqFor(rows, stem)}`;
    const seq = (lastEntry(order)?.seq ?? 0) + 1;
    const claimsLedger = (stamp, refunds) => Object.fromEntries([...refunds, ...outputs.claims].map((claim) => makeClaim(claim, stamp))
        .map((claim) => [`claims.${claim.id}`, claim]));
    const moves = remainder > 0 || outputs.rows.length || outputs.items.length || outputs.itemUpdates.length || outputs.debits.length;
    let result;
    if (!moves) {
        const { claims, toFund } = refundClaims(order, leftAfterSpend(allocations, 0), seq, (uuid) => !!actorOf(uuid));
        const fundRows = returnToFund(id, toFund, seq);
        const stamp = stampNow();
        const change = transitionChange(order, "finish", { status: "complete" }, { rows: fundRows.map((row) => hashId(row.idem)) }, stamp);
        result = await lockedWrite([change.lock, returnSlotLockId(order, rows)], fundRows, { set: { ...change.set, ...claimsLedger(stamp, claims) }, replace: change.replace });
    } else {
        result = await moveCoins((strongbox) => {
            const debits = [...outputs.debits];
            let shares = [];
            if (remainder > 0) {
                const planned = planSpend(freeStacks(strongbox), allocations, remainder);
                if (!planned) return { refuse: "strongbox-short" };
                debits.unshift({ target: "strongbox", plan: planned.strongbox });
                shares = planned.shares.filter((share) => share.cp > 0);
            }
            const spendRows = shares.map((share) => ({ kind: "remainder", idem: `${key}:${share.actor ?? "fund"}`, cp: share.cp, actor: share.actor, order: id }));
            const { claims, toFund } = refundClaims(order, leftAfterSpend(allocations, remainder), seq, (uuid) => !!actorOf(uuid));
            const fundRows = returnToFund(id, toFund, seq);
            const stamp = stampNow();
            const all = [...outputs.rows, ...spendRows, ...fundRows];
            const change = transitionChange(order, "finish", { status: "complete" }, { rows: all.map((row) => hashId(row.idem)) }, stamp);
            return {
                rows: all, debits, items: outputs.items, itemUpdates: outputs.itemUpdates, locks: [change.lock, returnSlotLockId(order, rows), ...outputs.locks],
                ledger: { set: { ...change.set, ...outputs.marks, ...claimsLedger(stamp, claims) }, replace: change.replace },
            };
        }, {}, outputs.rows.slice(0, 1));
    }
    if (!result.ok || result.outcome === "already") return result;
    for (const input of outputs.claims) {
        const claim = read(`claims.${hashId(input.idem)}`);
        if (claim) await applyIfResponsible(claim);
    }
    await postCard("complete", read(`orders.${id}`));
    return result;
}

/**
 * Rows that give an allocation back to the party fund (6.2.4): a contributor whose actor is gone, or the fund's own
 * share. Two `allocate` rows each, `back`: the order loses it, the fund gains it; no coins move.
 */
function returnToFund(orderId, toFund, seq) {
    return toFund.flatMap(({ actor, cp }) => {
        const who = actor ?? "fund";
        return [
            { kind: "allocate", how: { side: "order", back: true }, idem: idemKey("fund-return", orderId, who, seq, "order"), cp, actor, order: orderId,
                note: null },
            { kind: "allocate", how: { side: "fund", back: true }, idem: idemKey("fund-return", orderId, who, seq, "fund"), cp, actor, order: null,
                note: null },
        ];
    });
}

/**
 * Cancel an order (4.2.3, 6.2.4): what is still committed is released, every remaining allocation becomes a refund
 * claim its contributor's client collects (or goes back to the party fund when the contributor's actor is gone), and
 * the order is closed. A recorded check must be settled first. The requester's owners, the crafter's or a GM may.
 */
export async function cancel(id) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    if (!(game.user.isGM || owns(order.requester) || (order.crafter && owns(order.crafter)))) return refuse("not-owner");
    const rows = orderRows(id);
    const result = cancelOrder(order, { committedCp: committedFromRows(rows), allocations: allocationsByContributor(rows) });
    if (!result.ok) return result;
    const seq = (lastEntry(order)?.seq ?? 0) + 1;
    const { claims, toFund } = refundClaims(order, result.refunds, seq, (uuid) => !!actorOf(uuid));
    const bookkeeping = [
        ...result.rows.map((row) => ({ kind: "release", idem: idemKey("release", id, order.attempt, "cancel"), cp: row.cp, order: id })),
        ...returnToFund(id, toFund, seq),
    ];
    // M5: items handed over for the order go back to whoever handed them over; precious stock a success used is gone
    // (6.2.4: after a success the up-front materials stay spent).
    const lines = heldLines(order);
    // Stock counts toward the up-front half, so it is spent when that half is: once an attempt settled as a success.
    const succeeded = expendedFromRows(rows) > 0 || (order.settlement?.attempt === order.attempt && order.settlement?.status === "finishing");
    const given = lines.length ? givingBack({ path: `orders.${id}`, key: "order", id }, lines, { consume: succeeded, ref: `cancel-${seq}` }) : null;
    const back = given?.rows.length ? given : null;
    const stamp = stampNow();
    const all = [...bookkeeping, ...(back?.rows ?? [])];
    const change = transitionChange(order, "cancel", result.patch, { rows: all.map((row) => hashId(row.idem)) }, stamp);
    const claimRecords = claims.map((claim) => makeClaim(claim, stamp));
    const ledger = {
        set: { ...change.set, ...(back?.marks ?? {}), ...Object.fromEntries(claimRecords.map((claim) => [`claims.${claim.id}`, claim])) },
        replace: change.replace,
    };
    // Behind the log slot's lock: a finish (or a second cancel) planned from the same copy is refused, and so is this;
    // behind the return slot's: so is a give-back or a take-back planned from it, which would be paid twice.
    const locks = [change.lock, returnSlotLockId(order, rows)];
    const posted = back
        ? await moveCoins(() => ({
            rows: all, debits: back.deletes.length ? [{ target: "strongbox", plan: { deletes: back.deletes } }] : [],
            itemUpdates: back.updates.length ? [{ target: "strongbox", updates: back.updates }] : [], locks, ledger,
        }), {}, [])
        : await lockedWrite(locks, bookkeeping, ledger);
    if (!posted.ok) return posted;
    await postCard("cancelled", read(`orders.${id}`), { refunds: claims.length });
    return { ok: true, refunds: claims.length };
}

/**
 * Undo the order's last transition (4.2.3): its rows are reversed (an undone settlement mints its spent coins back into
 * the strongbox) and the order's fields go back to what they were. The user who made it, an owner of the actor it was
 * made for, or a GM. With `event`, only a last transition of that kind is undone (the check augment's "Undo
 * settlement" undoes a settlement, never a pause made after it): refused as "moved-on" otherwise.
 */
export async function undo(id, { event = null } = {}) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    const plan = undoPlan(order, viewer());
    if (!plan.ok) return plan;
    if (event && plan.entry.event !== event) return refuse("moved-on", { status: order.status });
    const all = records("rows");
    const targets = plan.entry.rows.map((rowId) => all.find((row) => row.id === rowId)).filter((row) => row && !row.reversedBy && row.kind !== "reversal");
    const change = transitionChange(order, "undo", plan.patch, { rows: targets.map((row) => hashId(`reversal:${row.id}`)) }, stampNow());
    const result = await reverseRows(targets, { set: change.set, replace: change.replace }, null, { locks: [change.lock] });
    return result.ok ? { ok: true, event: plan.entry.event } : result;
}

/* -------------------------------------------- */
/*  A reroll after settlement (6.12)             */
/* -------------------------------------------- */

/**
 * What an order needs repaired: a settled check a late reroll overwrote, a closed order's status a late write moved, a
 * setup a runner's day records completed (M6).
 */
const repairOf = (order) => {
    const patch = { ...settlementRepair(order), ...closedRepair(order), ...setupRepair(order, orderDays(order.id)) };
    return Object.keys(patch).length ? patch : null;
};

/**
 * Repair an order (`repairOf`): put a settled check back and keep the reroll that overwrote it as the conflict
 * (`settlementRepair`), and put a closed order's status back (`closedRepair`). Deterministic, so a second client doing
 * the same writes the same keys.
 */
export async function repairSettlement(id) {
    const order = read(`orders.${id}`);
    const patch = order ? repairOf(order) : null;
    if (!patch || !canWrite()) return false;
    const replace = {};
    const set = {};
    for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === "object") replace[`orders.${id}.${key}`] = value;
        else set[`orders.${id}.${key}`] = value;
    }
    await write({ set, replace });
    return true;
}

/** Rerolls this client recorded lately, by order: kept a while, so one the settlement overwrote is kept as a conflict. */
const recentRerolls = new Map();
const REROLL_MEMORY_MS = 5 * 60 * 1000;

/** Remember a reroll this client recorded (`rolls.mjs`), and repair at once if the settlement is already here. */
export async function rememberReroll(id, check) {
    recentRerolls.set(id, { check, until: Date.now() + REROLL_MEMORY_MS });
    await repairSettlement(id);
    await keepLostReroll(id);
}

/**
 * A reroll this client recorded that a settlement written after it then replaced: the stored check is the settled
 * one, so the reroll survives only as the conflict this client writes now (6.12).
 */
async function keepLostReroll(id) {
    const memory = recentRerolls.get(id);
    if (!memory) return false;
    if (memory.until < Date.now()) {
        recentRerolls.delete(id);
        return false;
    }
    const order = read(`orders.${id}`);
    const settled = order?.settlement?.attempt === memory.check.attempt && order.attempt === memory.check.attempt;
    if (!settled) {
        // Before any settlement, a stored check that is no longer this reroll means another roll superseded it (a later
        // reroll, an undo, a new attempt): it was not lost, and must not come back as the conflict.
        if (order?.check?.messageId !== memory.check.messageId) recentRerolls.delete(id);
        return false;
    }
    if (!canWrite()) return false;
    recentRerolls.delete(id);
    const lost = order.settlement.check?.messageId !== memory.check.messageId && order.conflict?.messageId !== memory.check.messageId;
    if (!lost) return false;
    await write({ replace: { [`orders.${id}.conflict`]: { ...memory.check, ...stampNow() } } });
    return true;
}

/**
 * On a ledger change (every client): the crafter's responsible client repairs a settled order whose check a late
 * reroll overwrote and a closed order whose status a late write moved, and this client keeps a reroll of its own a
 * later settlement replaced.
 */
export async function onOrdersChanged(ids) {
    for (const id of ids) {
        const order = read(`orders.${id}`);
        if (!order) continue;
        const crafter = actorOf(order.crafter);
        if (crafter && isResponsibleFor(crafter) && repairOf(order)) await repairSettlement(id);
        if (recentRerolls.has(id)) await keepLostReroll(id);
    }
}

/**
 * The catch-up of order repairs (P5, a sweep step): every order this client's user is responsible for the crafter of is
 * repaired as `onOrdersChanged` would. The hook runs only on a client that was responsible when the change arrived; a
 * setup a wizard runner's day records completed while nobody was (no GM, the crafter's player away) is moved to `check`
 * at that player's next login (M6). Returns the orders repaired.
 */
export async function sweepOrderRepairs() {
    if (!canWrite()) return 0;
    let repaired = 0;
    for (const order of records("orders")) {
        if (!repairOf(order)) continue;
        const crafter = actorOf(order.crafter);
        if (crafter && isResponsibleFor(crafter) && await repairSettlement(order.id)) repaired += 1;
    }
    return repaired;
}

/**
 * The order hooks, at `init`: a ledger change that touches orders, or day records of orders (M6), runs the order repair
 * on the crafter's responsible client (P4) and this client's check of its own recent rerolls.
 */
export function registerOrderHooks() {
    Hooks.on("updateJournalEntry", (doc, changed) => {
        if (doc.flags?.[MODULE_ID]?.role !== "ledger") return;
        const flags = changed.flags?.[MODULE_ID] ?? {};
        const ids = new Set(Object.keys(flags.orders ?? {}));
        for (const key of Object.keys(flags.days ?? {})) {
            const order = read(`days.${key}`)?.order;
            if (typeof order === "string") ids.add(order);
        }
        if (ids.size) onOrdersChanged([...ids]).catch((error) => console.warn(`${MODULE_ID} | settlement repair failed`, error));
    });
}

/** For tests only. */
export function resetOrders() {
    recentRerolls.clear();
}

/** Every live order, as stored. */
export const allOrders = () => records("orders");
