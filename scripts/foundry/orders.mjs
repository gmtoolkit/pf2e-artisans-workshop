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
 * runs on an order its log says is closed (`closedAs`), whatever a late write left in its `status`.
 *
 * The one hook-driven write here is the order repair (6.12, As built in M4), on the crafter's responsible client: a
 * settled check a late reroll overwrote, and a closed order's status a late work day or first roll moved.
 */
import { MODULE_ID } from "../constants.mjs";
import { batchMax, splitIntoBatches } from "../logic/batches.mjs";
import { makeClaim } from "../logic/claims.mjs";
import {
    cancelOrder, committedFromRows, expendedFromRows, pauseOrder, resumeOrder, retryOrder, startOrder,
} from "../logic/craft.mjs";
import { allPass } from "../logic/gates.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import {
    acceptOrder, closedAs, closedRepair, lastEntry, leftAfterSpend, makeOrder, nextWorkDay, refundClaims, releaseOrder,
    settlementRepair, transitionChange, undoPlan, withdrawableCp, workDayRecord,
} from "../logic/orders.mjs";
import { remainingCp } from "../logic/progress.mjs";
import { seqFor } from "../logic/rows.mjs";
import { allocationsByContributor } from "../logic/split.mjs";
import { planSpend } from "../logic/coins.mjs";
import { postCard } from "../ui/chat.mjs";
import { freeStacks, lockedWrite, moveCoins, pledge, reverseRows, withdraw } from "./money.mjs";
import { crafterFacts, gatesFor, productFacts, snapshotOf } from "./products.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { rollCraft, settleOrder } from "./rolls.mjs";
import { members } from "./roster.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite } from "./state.mjs";
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
 * @returns {Promise<{ok: boolean, reason?: string, orders?: string[]}>}
 */
export async function requestOrder({ uuid, quantity = 1, requester, recipient = null, crafter = null, note = "", gift = false }) {
    if (!canWrite()) return refuse("not-ready");
    if (!owns(requester)) return refuse("not-owner");
    if (crafter && !owns(crafter)) return refuse("not-owner");
    if (!Number.isInteger(quantity) || quantity < 1) return refuse("quantity");
    const product = await productFacts(uuid);
    if (!product) return refuse("no-product");
    if (!(product.priceCp > 0)) return refuse("no-price");
    const rules = rulesFromSettings();
    const target = recipient ?? { kind: "actor", uuid: requester };
    const max = crafter
        ? (await gatesFor({ id: "probe", quantity: 1 }, crafterFacts(actorOf(crafter)), product, [], rules)).plan.batchMax
        : batchMax({ ...product }, {}, rules);
    const stamp = stampNow();
    const party = game.actors.party?.id ?? null;
    const made = splitIntoBatches(quantity, Math.max(1, max)).map((qty) => makeOrder({
        id: newId(), party, requester, recipient: target, product: { uuid, snapshot: snapshotOf(product) }, quantity: qty,
        crafter, note, visibility: gift ? "gift" : "public",
    }, stamp));
    await write({ set: Object.fromEntries(made.map((order) => [`orders.${order.id}`, order])) });
    for (const order of made) await postCard("request", order);
    return { ok: true, orders: made.map((order) => order.id) };
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

/** Pledge `cp` from `actor` (a character this user owns) to an order: coins into the strongbox (4.6 `pledge`). */
export async function pledgeTo(id, actorUuid, cp) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    if (["complete", "cancelled", "archived", "rolled"].includes(order.status)) return refuse("state", { status: order.status });
    return pledge({ actor, cp, order: id, nonce: newId() });
}

/** Take back an unspent, uncommitted share of an order (4.6 `withdraw`). */
export async function withdrawFrom(id, actorUuid, cp) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const max = withdrawableCp(order, orderRows(id), actorUuid);
    if (!(cp > 0) || cp > max) return refuse("too-much", { maxCp: max });
    return withdraw({ actor, cp, order: id, nonce: newId() });
}

/* -------------------------------------------- */
/*  Starting and working                         */
/* -------------------------------------------- */

/**
 * Start an accepted order (4.2.3): every gate must pass (P1); the plan is frozen (Price, up-front half, DC, setup,
 * route), a new attempt opens and the up-front half is committed.
 */
export async function start(id) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    const crafter = actorOf(order.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    const product = await productFacts(order.product.uuid);
    if (!product) return refuse("no-product");
    const rules = rulesFromSettings();
    const rows = orderRows(id);
    const { gates, plan } = await gatesFor(order, crafterFacts(crafter), product, rows, rules);
    if (!allPass(gates)) return refuse("gates", { gates: gates.filter((gate) => !gate.ok) });
    const result = startOrder(order, plan);
    if (!result.ok) return result;
    const patch = { ...result.patch, route: plan.route, skill: order.skill ?? "crafting", product: { ...order.product, snapshot: { ...order.product.snapshot, priceCp: product.priceCp, per: product.per } } };
    const commit = result.rows.map((row) => ({ kind: "commit", idem: idemKey("commit", id, patch.attempt, seqFor(rows, idemKey("commit", id, patch.attempt))), cp: row.cp, order: id }));
    const change = transitionChange(order, "start", patch, { rows: commit.map((row) => hashId(row.idem)) }, stampNow());
    const posted = await lockedWrite([change.lock], commit, { set: change.set, replace: change.replace });
    if (!posted.ok) return posted;
    await postCard("started", read(`orders.${id}`));
    return { ok: true };
}

/** The clock's day: whole days of world time (4.8; M6 adds the day offset and logged days). */
function clockDay() {
    const days = game.time.calendar?.days ?? {};
    const secondsPerDay = (days.hoursPerDay ?? 24) * (days.minutesPerHour ?? 60) * (days.secondsPerMinute ?? 60);
    return Math.max(0, Math.floor((game.time.worldTime ?? 0) / secondsPerDay));
}

/**
 * The crafter works one day on the order (M4's stand-in for M6's day resolver, 4.8): a setup day, which moves the order
 * to `check` once the setup is complete; or an extra day that brings the remainder down. An order whose check is
 * recorded but not settled is settled first (4.2.3: settlement comes with the order's next day). The day is the clock's,
 * or the day after the crafter's last record, whichever is later, so days can be logged ahead of the clock.
 */
export async function workDay(id) {
    const found = orderOrRefuse(id);
    if (found.refusal) return found.refusal;
    let order = found.order;
    const crafter = actorOf(order.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    if (order.status === "rolled") {
        const settled = await settleOrder(id);
        if (!settled.ok) return settled;
        order = read(`orders.${id}`);
    }
    if (!["setup", "finishing"].includes(order.status)) return refuse("state", { status: order.status });
    const facts = { actorId: crafter.id, level: crafter.level, rank: crafter.skills?.[order.skill ?? "crafting"]?.rank ?? 0 };
    const day = nextWorkDay(clockDay(), records("days").filter((d) => d.actor === crafter.id));
    const work = workDayRecord(order, day, facts, orderDays(id), stampNow(), rulesFromSettings());
    if (!work) return refuse("state", { status: order.status });
    const set = Object.fromEntries(Object.entries(work.patch).map(([key, value]) => [`orders.${id}.${key}`, value]));
    await write({ replace: { [`days.${work.record.id}`]: work.record }, set });
    return { ok: true, day, kind: work.record.kind, status: work.patch.status ?? order.status };
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

/** Retry a failed order from scratch: a new attempt and a new commit (4.2.3, 6.2.4). */
export async function retry(id) {
    const { order, refusal } = orderOrRefuse(id);
    if (refusal) return refusal;
    if (!owns(order.crafter)) return refuse("not-owner");
    const rows = orderRows(id);
    const result = retryOrder(order, { expendedCp: expendedFromRows(rows) });
    if (!result.ok) return result;
    const escrow = rows.reduce((sum, row) => sum + (row.alloc ?? 0), 0);
    const need = result.rows.reduce((sum, row) => sum + row.cp, 0);
    if (escrow < need) return refuse("underfunded", { shortCp: need - escrow });
    const attempt = result.patch.attempt;
    const commit = result.rows.map((row) => ({ kind: "commit", idem: idemKey("commit", id, attempt, seqFor(rows, idemKey("commit", id, attempt))), cp: row.cp, order: id }));
    const change = transitionChange(order, "retry", result.patch, { rows: commit.map((row) => hashId(row.idem)) }, stampNow());
    const posted = await lockedWrite([change.lock], commit, { set: change.set, replace: change.replace });
    return posted.ok ? { ok: true } : posted;
}

/* -------------------------------------------- */
/*  Finishing, cancelling, undo                  */
/* -------------------------------------------- */

/** The item a finished order puts on the shelf: the product, its quantity, and the shelf flag for its recipient. */
async function shelfItemData(order) {
    const doc = await fromUuid(order.product.uuid);
    if (!doc) return null;
    const source = doc.toObject();
    delete source._id;
    source.system = { ...source.system, quantity: order.quantity };
    foundry.utils.setProperty(source, "_stats.compendiumSource", order.product.uuid);
    const flags = { crafted: { order: order.id, attempt: order.attempt, crafter: order.crafter } };
    if (order.recipient?.kind === "actor") {
        flags.shelf = { for: order.recipient.uuid, from: order.crafter, order: order.id,
            claimKey: idemKey("deliver", order.id, order.attempt), at: stampNow().at };
    }
    foundry.utils.setProperty(source, `flags.${MODULE_ID}`, flags);
    return source;
}

/**
 * Finish an order in `finishing` (4.2.3, 6.2.3): one lock-first move pays the remainder out of the escrow, pro rata by
 * contributor, puts the item on the pickup shelf (a `shelved` row; the recipient's client delivers it, 5.5), refunds
 * what is left over as refund claims (6.2.4), and marks the order complete. The move is resumable like every coin move,
 * so an apply request lost on the way is sent again and the item is shelved once. Its lock request takes the order's
 * log slot, so a cancel planned from the same copy and a finish never both land.
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
    const source = await shelfItemData(order);
    if (!source) return refuse("no-product");
    const shelved = {
        kind: "shelved", idem: idemKey("shelve", id, order.attempt), cp: 0, order: id,
        actor: order.recipient?.kind === "actor" ? order.recipient.uuid : null,
        items: [{ uuid: order.product.uuid, name: order.product.snapshot?.name ?? null, qty: order.quantity }],
    };
    const stem = idemKey("remainder", id, order.attempt);
    const key = `${stem}:${seqFor(rows, stem)}`;
    const seq = (lastEntry(order)?.seq ?? 0) + 1;
    const result = await moveCoins((strongbox) => {
        const debits = [];
        let shares = [];
        if (remainder > 0) {
            const planned = planSpend(freeStacks(strongbox), allocations, remainder);
            if (!planned) return { refuse: "strongbox-short" };
            debits.push({ target: "strongbox", plan: planned.strongbox });
            shares = planned.shares.filter((share) => share.cp > 0);
        }
        const spendRows = shares.map((share) => ({ kind: "remainder", idem: `${key}:${share.actor ?? "fund"}`, cp: share.cp, actor: share.actor, order: id }));
        const { claims, toFund } = refundClaims(order, leftAfterSpend(allocations, remainder), seq, (uuid) => !!actorOf(uuid));
        const fundRows = returnToFund(id, toFund, seq);
        const stamp = stampNow();
        const claimRecords = claims.map((claim) => makeClaim(claim, stamp));
        const change = transitionChange(order, "finish", { status: "complete" },
            { rows: [shelved, ...spendRows, ...fundRows].map((row) => hashId(row.idem)) }, stamp);
        return {
            rows: [shelved, ...spendRows, ...fundRows], debits, items: [{ target: "strongbox", data: [source] }], locks: [change.lock],
            ledger: { set: { ...change.set, ...Object.fromEntries(claimRecords.map((claim) => [`claims.${claim.id}`, claim])) }, replace: change.replace },
        };
    }, {}, [shelved]);
    if (result.ok && result.outcome !== "already") await postCard("complete", read(`orders.${id}`));
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
    const stamp = stampNow();
    const change = transitionChange(order, "cancel", result.patch, { rows: bookkeeping.map((row) => hashId(row.idem)) }, stamp);
    const claimRecords = claims.map((claim) => makeClaim(claim, stamp));
    const ledger = { set: { ...change.set, ...Object.fromEntries(claimRecords.map((claim) => [`claims.${claim.id}`, claim])) }, replace: change.replace };
    // Behind the log slot's lock: a finish (or a second cancel) planned from the same copy is refused, and so is this.
    const posted = await lockedWrite([change.lock], bookkeeping, ledger);
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

/** What an order needs repaired: a settled check a late reroll overwrote, a closed order's status a late write moved. */
const repairOf = (order) => {
    const patch = { ...settlementRepair(order), ...closedRepair(order) };
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
 * The order hooks, at `init`: a ledger change that touches orders runs the order repair on the crafter's responsible
 * client (P4) and this client's check of its own recent rerolls.
 */
export function registerOrderHooks() {
    Hooks.on("updateJournalEntry", (doc, changed) => {
        if (doc.flags?.[MODULE_ID]?.role !== "ledger") return;
        const ids = Object.keys(changed.flags?.[MODULE_ID]?.orders ?? {});
        if (ids.length) onOrdersChanged(ids).catch((error) => console.warn(`${MODULE_ID} | settlement repair failed`, error));
    });
}

/** For tests only. */
export function resetOrders() {
    recentRerolls.clear();
}

/** Every live order, as stored. */
export const allOrders = () => records("orders");
