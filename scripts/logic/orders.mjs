/**
 * The order lifecycle around M1's Craft steps (DESIGN.md 4.2.2, 4.2.3, 6.2.4, 6.12): filing a request, accepting and
 * releasing it, the transition log that undo reads, what a contributor may take back, the refunds a cancel or a
 * finish owes, the settlement record that guards a settled check against a late reroll, and a crafter's day record on
 * an order, which M6's day planner (`scripts/logic/downtime.mjs`) writes for every craft day. Pure: plain data in,
 * key-path changes and refusals out. The Foundry side (`scripts/foundry/orders.mjs`) writes them.
 *
 * Transition log. Every transition of an order writes `orders.<id>.log.<seq>` = `{seq, event, from, to, prev, rows,
 * by, at}`: `prev` holds the order's fields as they were before (the ones the transition changed), `rows` the ids of
 * the ledger rows it posted. Undo (4.2.3) restores `prev` and reverses `rows`; it applies to the last entry only,
 * while the order is still where that transition left it. The request that writes an entry also takes the lock page of
 * its slot (`logLockId`), so of two transitions planned from the same copy of the order only the first lands.
 */
import { DEGREE, compareRows, liveRows, requireCp, requireInteger } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { hashId, idemKey } from "./ids.mjs";
import { isPlainObject } from "./keypath.mjs";
import { extraDayRecord, recordsOf, setupComplete } from "./progress.mjs";
import { committedFromRows } from "./craft.mjs";
import { allocationsByContributor, splitProRata } from "./split.mjs";
import { rushDay } from "./variants.mjs";

export const ORDER_VERSION = 1;
export const DAY_VERSION = 1;

/** Every order state (4.2.2). */
export const STATUSES = Object.freeze([
    "requested", "accepted", "setup", "gathering", "check", "rolled", "finishing", "paused", "failed", "complete", "cancelled", "archived",
]);
/** States that are over: nothing more happens to the order. */
export const CLOSED = Object.freeze(["complete", "cancelled", "archived"]);
/** States in which a crafter works on the order: they hold escrow that is committed or about to be. */
export const STARTED = Object.freeze(["setup", "gathering", "check", "rolled", "finishing", "paused", "failed"]);

/**
 * Transitions undo can take back (4.2.3). Finishing, cancelling and day records are not undone in M4. M9a: `made`, a settled
 * critical failure whose Critical Crafting record makes the item anyway (6.16.4).
 */
export const UNDOABLE = Object.freeze(["accept", "release", "start", "settle", "pause", "resume", "retry", "made"]);
/** Transitions that close an order: nothing happens to it after one. */
export const CLOSING = Object.freeze(["finish", "cancel"]);

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/* -------------------------------------------- */
/*  Filing                                       */
/* -------------------------------------------- */

/**
 * A new order record (4.2.1). A crafter named at filing takes it at once (`accepted`); the caller checks that the
 * filing user owns that crafter. Money fields stay null until start freezes them.
 *
 * @param {object} p
 * @param {string} p.id
 * @param {string|null} [p.party]          the pf2e Party actor id
 * @param {string} p.requester             actor UUID
 * @param {{kind: "actor"|"strongbox", uuid?: string}} p.recipient
 * @param {{uuid: string, snapshot: object}} p.product  snapshot: `{name, img, level, rarity, traits, priceCp, per}`
 * @param {number} p.quantity
 * @param {string|null} [p.crafter]        actor UUID
 * @param {string} [p.note]
 * @param {"public"|"gift"} [p.visibility]
 * @param {{by: string, at: object}} stamp
 */
export function makeOrder({ id, party = null, requester, recipient, product, quantity, crafter = null, note = "", visibility = "public",
    craftType = "item", skill = "crafting", specialty = null, productType = "item", route = null, target = null, variant = {} }, stamp) {
    requireInteger(quantity, "quantity");
    if (quantity < 1) throw new RangeError("an order makes at least one item");
    if (!product?.uuid) throw new TypeError("an order needs its product's UUID");
    if (recipient?.kind !== "actor" && recipient?.kind !== "strongbox") throw new TypeError("an order needs a recipient");
    if (!CRAFT_TYPES.includes(craftType)) throw new RangeError(`unknown craft type ${craftType}`);
    if (productType !== "item" && productType !== "formula") throw new RangeError(`unknown product type ${productType}`);
    if (productType === "formula" && (recipient.kind !== "actor" || quantity !== 1)) throw new RangeError("a formula goes into one actor's book");
    if (TARGETED.includes(craftType) && !target) throw new TypeError(`a ${craftType} order names the item it works on`);
    // M9 (6.14): a tattoo or graft names its subject, who receives it.
    if (WITH_SUBJECT.includes(craftType) && (!target || recipient.kind !== "actor" || recipient.uuid !== target || quantity !== 1)) {
        throw new TypeError(`a ${craftType} order names its subject, who receives one`);
    }
    // M9a (6.16.5, 6.16.9): a Deconstruct names the item it breaks down; a Deconstruct and a quest make one.
    if (craftType === "deconstruct" && !target) throw new TypeError("a deconstruct order names the item it breaks down");
    if ((craftType === "deconstruct" || craftType === "quest") && quantity !== 1) throw new RangeError(`a ${craftType} order is for one item`);
    return {
        id, v: ORDER_VERSION, party, requester, recipient: { kind: recipient.kind, uuid: recipient.uuid ?? null },
        product: { type: productType, uuid: product.uuid, family: product.family ?? null, snapshot: { ...product.snapshot } },
        craftType, attempt: 0, quantity, target, crafter, skill, route, specialty,
        priceCp: null, upfrontCp: null, dc: null, setup: null, variant: { ...variant }, events: {}, check: null, helpers: {}, pledges: {},
        checklist: {}, materials: {}, custody: {}, status: crafter ? "accepted" : "requested", resumeTo: null, priority: 0,
        notes: note ?? "", visibility, dependsOn: [], log: {}, settlement: null, conflict: null,
        created: stamp.at, ...stamp,
    };
}

/**
 * Craft types the order machine runs (4.2.1): M5's, M9's tattoos and grafts, and M9a's variant activities (6.16:
 * Deconstruct, Grow, crafting quests), which exist only while their variant is on (`craftTypeOn`, `variants.mjs`).
 */
export const CRAFT_TYPES = Object.freeze(["item", "upgrade", "rune-etch", "rune-transfer", "spell-item", "tattoo", "graft", "deconstruct", "grow", "quest"]);
/** Craft types that move no money (M9a): a Deconstruct breaks an item down, a quest is earned through encounters. */
export const MONEYLESS = Object.freeze(["deconstruct", "quest"]);
/** Craft types with a subject, who consents and receives the item (6.14, M9; `scripts/logic/crafts.mjs`). */
export const WITH_SUBJECT = Object.freeze(["tattoo", "graft"]);
/** Craft types that work on an item the crafter must hold for the whole job (G10, GM Core p.225). */
export const TARGETED = Object.freeze(["upgrade", "rune-etch", "rune-transfer"]);

/** Accept a requested order as its crafter (4.2.3). */
export function acceptOrder(order, crafter) {
    if (order.status !== "requested") return refuse("state", { status: order.status });
    if (typeof crafter !== "string" || !crafter) throw new TypeError("accept needs the crafter's UUID");
    return { ok: true, patch: { crafter, status: "accepted" }, rows: [] };
}

/** Give an accepted order back to the queue (4.2.3). */
export function releaseOrder(order) {
    if (order.status !== "accepted") return refuse("state", { status: order.status });
    return { ok: true, patch: { crafter: null, status: "requested" }, rows: [] };
}

/* -------------------------------------------- */
/*  The transition log                           */
/* -------------------------------------------- */

/** The order's log entries, oldest first. */
export function logEntries(order) {
    return Object.values(order.log ?? {}).filter((entry) => isPlainObject(entry) && Number.isInteger(entry.seq))
        .sort((a, b) => a.seq - b.seq);
}

/** The last log entry, or null. */
export const lastEntry = (order) => logEntries(order).at(-1) ?? null;

/**
 * The lock page id of an order's log slot `seq` (As built in M4). Every transition takes it in the request that writes
 * its log entry, and the server refuses a page that exists: of two transitions planned from the same copy of the order
 * (a cancel and a finish, two offers to craft), or one planned from a copy that had not seen the last transition yet,
 * only the first lands.
 */
export const logLockId = (orderId, seq) => hashId(idemKey("log", orderId, seq));

/**
 * The state a closing transition (`CLOSING`) left the order in, by its log, or null while the order is open. The log
 * says it even when a late write moved `status` (`closedRepair`), so every transition asks this as well.
 */
export function closedAs(order) {
    const entry = lastEntry(order);
    return entry && CLOSING.includes(entry.event) ? entry.to : null;
}

/**
 * The repair of a closed order whose `status` a late write moved: a work day or a first roll recorded from a copy that
 * had not seen the close yet (neither writes a log entry, so neither takes a log slot). The status goes back to what the
 * close left. Null when nothing needs repairing. Deterministic, so two clients repairing the same order write the same.
 */
export function closedRepair(order) {
    const closed = closedAs(order);
    return closed && order.status !== closed ? { status: closed } : null;
}

/**
 * The repair of an order whose day records completed its setup without moving its status (M6): setup days written by a
 * wizard runner who does not own the crafter (9.2, 4.2.4: the runner writes day records only). Moving it to `check` is the
 * derived transition of 4.2.3, the crafter's responsible client's to write. Null when nothing needs repairing.
 * Deterministic, so two clients repairing the same order write the same.
 */
export function setupRepair(order, days) {
    if (order.status !== "setup" || !order.setup || closedAs(order)) return null;
    return setupComplete(order, days) ? { status: "check" } : null;
}

/**
 * The key-path change that applies a transition's `patch` to an order and logs it. Plain values are set; objects
 * (a check, a DC breakdown) replace what is stored, so no key of an earlier value survives a merge. `prev` keeps what
 * the patched fields held before.
 *
 * @param {object} order
 * @param {string} event      accept, release, start, settle, pause, resume, retry, finish, cancel, work, undo
 * @param {object} patch      order fields to write
 * @param {object} [p]
 * @param {string[]} [p.rows] ledger rows the transition posts
 * @param {{by: string, at: object}} stamp
 * @returns {{set: object, replace: object, entry: object, lock: string}}  `lock`: the log slot's lock page (`logLockId`),
 *          which the request that writes the change must take
 */
export function transitionChange(order, event, patch, { rows = [] } = {}, stamp) {
    const base = `orders.${order.id}`;
    const seq = (lastEntry(order)?.seq ?? 0) + 1;
    const prev = Object.fromEntries(Object.keys(patch).map((key) => [key, order[key] ?? null]));
    const entry = { seq, event, from: order.status, to: patch.status ?? order.status, prev, rows: [...rows], ...stamp };
    const set = { [`${base}.by`]: stamp.by, [`${base}.at`]: stamp.at };
    const replace = { [`${base}.log.${seq}`]: entry };
    for (const [key, value] of Object.entries(patch)) {
        if (isPlainObject(value)) replace[`${base}.${key}`] = value;
        else set[`${base}.${key}`] = value;
    }
    return { set, replace, entry, lock: logLockId(order.id, seq) };
}

/**
 * Whether `viewer` may undo the order's last transition, and what it would restore (4.2.3): the user who made it, a
 * user who owns the actor it was made for (the crafter for a crafter's step), or a GM; only an undoable event, and
 * only while the order is still in the state that transition left it in.
 *
 * @param {object} order
 * @param {{userId: string, isGM: boolean, owns: (uuid: string|null) => boolean}} viewer
 * @returns {{ok: true, entry: object, patch: object} | {ok: false, reason: string}}
 */
export function undoPlan(order, viewer) {
    const entry = lastEntry(order);
    if (!entry || entry.event === "undo") return refuse("nothing");
    if (!UNDOABLE.includes(entry.event)) return refuse("not-undoable", { event: entry.event });
    if (order.status !== entry.to) return refuse("moved-on", { status: order.status });
    const actorOfEvent = entry.event === "accept" ? order.crafter : entry.event === "release" ? entry.prev.crafter : order.crafter;
    if (!(viewer.isGM || entry.by === viewer.userId || viewer.owns(actorOfEvent))) return refuse("not-yours");
    const patch = { ...entry.prev };
    // A start's attempt stays counted, so day records of the undone attempt never count for a later one.
    if (entry.event === "start" || entry.event === "retry") delete patch.attempt;
    if (entry.event === "settle") {
        // Back to a recorded check, unsettled. A reroll kept as a conflict is the check the crafter wanted (6.12).
        const conflict = order.conflict?.attempt === order.attempt ? order.conflict : null;
        patch.check = { ...(conflict ?? order.settlement?.check ?? order.check), settled: false };
        patch.conflict = null;
        patch.settlement = null;
        patch.status = "rolled";
    }
    return { ok: true, entry, patch };
}

/* -------------------------------------------- */
/*  Money an order holds                         */
/* -------------------------------------------- */

/** What the order's contributors still have allocated to it, in total (its escrow). */
export function escrowCp(orderRows) {
    return orderRows.reduce((sum, row) => sum + (row.alloc ?? 0), 0);
}

/**
 * What `actorUuid` may take back from an order (4.6 `withdraw`): their own remaining allocation, but no more than the
 * order holds beyond its committed amount, which the crafter is using. Nothing once the order is over: a cancel or a
 * finish refunds instead.
 */
export function withdrawableCp(order, orderRows, actorUuid) {
    if (CLOSED.includes(order.status)) return 0;
    const own = allocationsByContributor(orderRows).find((a) => a.actor === actorUuid)?.cp ?? 0;
    const free = escrowCp(orderRows) - committedFromRows(orderRows);
    return Math.max(0, Math.min(own, free));
}

/**
 * Whether the reversal of a financial row would leave its order holding less than it has committed (4.6): a pledge
 * whose coins the crafter is already using cannot be taken back that way.
 */
export function reversalKeepsCommitted(row, orderRows) {
    if (!row.order) return true;
    const after = escrowCp(orderRows) - (row.alloc ?? 0);
    return after >= committedFromRows(orderRows);
}

/**
 * Refund claims for every remaining allocation (6.2.4), as `createClaims` inputs keyed
 * `refund:<orderId>:<actor UUID>:<seq>`, `seq` the transition's log seq. Allocations of a contributor whose actor is
 * gone (`exists` false) or of the party fund are returned as `toFund`: they move back to the party fund instead.
 */
export function refundClaims(order, allocations, seq, exists = () => true) {
    const claims = [];
    const toFund = [];
    for (const { actor, cp } of allocations) {
        if (!(cp > 0)) continue;
        if (actor === null || !exists(actor)) {
            toFund.push({ actor, cp });
            continue;
        }
        claims.push({ kind: "refund", idem: idemKey("refund", order.id, actor, seq), actor, cp, order: order.id,
            parties: [order.requester, order.crafter].filter(Boolean) });
    }
    return { claims, toFund };
}

/**
 * What each contributor has left once the order spends `spentCp` pro rata (a finish's remainder, 4.6): the over-funding
 * a finish refunds. `allocations` as `allocationsByContributor` gives them, earliest first.
 */
export function leftAfterSpend(allocations, spentCp) {
    requireCp(spentCp, "spentCp");
    const shares = splitProRata(spentCp, allocations.map((a) => ({ key: a.actor, cp: a.cp })));
    return allocations.map((a, i) => ({ actor: a.actor, cp: a.cp - shares[i].cp })).filter((a) => a.cp > 0);
}

/* -------------------------------------------- */
/*  Settlement and a late reroll (6.12)          */
/* -------------------------------------------- */

/**
 * The settlement record a settle writes with its rows (6.12, As built in M4): the attempt, the check it settled, the
 * state it moved the order to, and its rows. A reroll recorded afterwards cannot change it, since nothing but a settle
 * and its undo writes this key.
 */
export function settlementRecord(order, patch, rowIds, stamp) {
    return { attempt: order.attempt, check: patch.check, status: patch.status, rows: [...rowIds], ...stamp };
}

/** Whether the order's current attempt has been settled, by its settlement record. */
export const settledAttempt = (order) => order.settlement?.attempt === order.attempt && order.attempt > 0;

/**
 * The repair of an order whose settled check was overwritten by a reroll recorded from a copy that had not seen the
 * settlement yet (6.12 follow-up): the stored check is not the one the settlement record holds. The check goes back
 * to the settled one, and the reroll is kept as the conflict the card shows, so the crafter can undo the settlement
 * and settle again with it. A status a reroll wrote (`rolled`) goes back too. Null when nothing needs repairing.
 * Deterministic, so two clients repairing the same order write the same thing.
 */
export function settlementRepair(order) {
    if (!settledAttempt(order)) return null;
    const settled = order.settlement.check;
    const check = order.check;
    const sameCheck = check?.messageId === settled?.messageId && check?.settled === true;
    const statusOk = order.status !== "rolled";
    if (sameCheck && statusOk) return null;
    const patch = {};
    if (!sameCheck) patch.check = settled;
    if (!sameCheck && check && check.messageId !== settled?.messageId && order.conflict?.messageId !== check.messageId) {
        patch.conflict = { ...check, attempt: check.attempt ?? order.attempt };
    }
    if (!statusOk) patch.status = order.settlement.status;
    return patch;
}

/**
 * Whether a check recorded for `attempt` must be kept as a conflict rather than replace the order's check: the attempt
 * is settled, by its record, its rows, or its flag (6.12).
 */
export function lateForAttempt(order, attempt, settledRows) {
    return attempt === order.attempt && (settledAttempt(order) || settledRows || order.check?.settled === true);
}

/* -------------------------------------------- */
/*  Work days (the day resolver's craft days, M6) */
/* -------------------------------------------- */

/**
 * The day record (4.8) of a crafter's day on an order, and the order fields it moves: in `setup` a setup day, and
 * `check` once the setup is complete (4.2.3); in `finishing` (or `rolled`, written at the recorded degree, 6.2.3) an
 * extra day with the crafter's reduction. Null for any other state. Keyed `<actorId>-<day>`, one per actor per day,
 * and deterministic, so a day written twice is one record.
 *
 * @param {object} order
 * @param {number} day
 * @param {{actorId: string, level: number, rank: number, rateLevel?: number|null}} crafter  the crafter on that day
 * @param {object[]} days   the order's day records so far
 * @param {{by: string, at: object}} stamp
 * @returns {{record: object, patch: object} | null}
 */
export function workDayRecord(order, day, crafter, days, stamp, rules = DEFAULT_RULES) {
    requireInteger(day, "day");
    const base = { id: `${crafter.actorId}-${day}`, v: DAY_VERSION, actor: crafter.actorId, day, toDay: day,
        activity: { kind: "craft", ref: order.id }, order: order.id, attempt: order.attempt, rows: [], result: null, ...stamp };
    if (order.status === "setup") {
        const record = { ...base, kind: "setup" };
        const done = setupComplete(order, [...days, record]);
        return { record, patch: done ? { status: "check" } : {} };
    }
    let extra = extraDayRecord(order, day, { crafter, rateLevel: crafter.rateLevel ?? null }, rules);
    if (!extra) return null;
    // M9a (6.16.1): a day of rushed finishing, while the crafter has the order's rush on.
    if (order.variant?.rushFinish === true) extra = rushDay(extra, crafter.rank ?? 0, rules);
    return { record: { ...base, ...extra, id: base.id, v: DAY_VERSION, actor: crafter.actorId, toDay: day }, patch: {} };
}

/** The setup days the order's current attempt has, from its day records. */
export const setupDaysOf = (order, days) => recordsOf(order, days, "setup").length;

/* -------------------------------------------- */
/*  Who may act                                  */
/* -------------------------------------------- */

/**
 * The actions open to a viewer on an order, by the rules of 4.2.3 and 4.2.4: the crafter's steps belong to whoever owns
 * the crafter (a GM owns every actor); cancelling to the requester's or the crafter's owners; funding to any member
 * with a character while the order is open; undo per `undoPlan`.
 *
 * @param {object} order
 * @param {{userId: string, isGM: boolean, owns: (uuid: string|null) => boolean, hasCharacter: boolean}} viewer
 * @param {{withdrawable?: number, gatesPass?: boolean}} [facts]
 */
export function orderActions(order, viewer, { withdrawable = 0, gatesPass = false } = {}) {
    const s = order.status;
    const crafter = !!order.crafter && viewer.owns(order.crafter);
    const party = crafter || viewer.owns(order.requester) || viewer.isGM;
    const open = !CLOSED.includes(s);
    return {
        accept: s === "requested" && viewer.hasCharacter,
        release: s === "accepted" && crafter,
        start: s === "accepted" && crafter,
        startReady: s === "accepted" && crafter && gatesPass,
        work: (s === "setup" || s === "rolled" || s === "finishing") && crafter,
        roll: s === "check" && crafter,
        settle: s === "rolled" && crafter,
        finish: s === "finishing" && crafter,
        pause: (s === "setup" || s === "finishing") && crafter,
        resume: s === "paused" && crafter,
        retry: s === "failed" && crafter,
        cancel: open && s !== "rolled" && party,
        // "Fund this order" (As built in M4.1): from the party fund or a purse, by any member, while the order is open; never
        // a Deconstruct or a quest, which move no money (M9a).
        fund: open && s !== "rolled" && viewer.hasCharacter && !MONEYLESS.includes(order.craftType),
        withdraw: withdrawable > 0,
        undo: undoPlan(order, viewer).ok,
    };
}

/* -------------------------------------------- */
/*  Small helpers                                */
/* -------------------------------------------- */

/** An order's rows, live ones (not reversed), in time order. */
export function liveOrderRows(rows, orderId) {
    return liveRows(rows.filter((row) => row.order === orderId)).sort(compareRows);
}

/** Whether a degree is a success. */
export const isSuccess = (degree) => degree === DEGREE.success || degree === DEGREE.critSuccess;
