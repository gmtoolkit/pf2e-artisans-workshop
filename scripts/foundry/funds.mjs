/**
 * The Funds actions (DESIGN.md 4.6, 4.7, 10.1; fund accounting, As built in M4.1): adding coins to the party fund and
 * taking them out, funding an order from a chosen source (the party fund, which earmarks unallocated money and moves no
 * coins, or a character's purse, whose coins move into the strongbox), giving an order's party-fund share back,
 * finishing an order with any shortfall drawn from a chosen source, reversing a financial row, and collecting what
 * waits for the user's characters. For a GM, M2's `resolvePending` and `bookAdjustment` close a pending row and book a
 * reconciliation difference. Each is a user's own action, run on that user's client; none needs a GM.
 *
 * Every write that takes money out of the unallocated party fund takes the fund slot's lock page (`fundSlotLockId`):
 * earmarking it for an order, a withdrawal from the fund and the reversal of a deposit. Of two planned from the same
 * copy of the ledger only the first lands, so two members cannot both spend the same unallocated money; the other is
 * refused ("taken" or "conflict") and tries again from fresh data.
 *
 * Purchases (a formula, a casting, a spell's cost, a formula copy) are paid from the same two sources by `payPurchase`
 * (`purchases.mjs`, As built in M5 on M4.1), which takes the fund slot too when the party fund pays.
 */
import {
    earmarkInputs, fundReturnableCp, fundSlotLockId, isFundRow, returnSlotLockId, shortfallOf, unallocatedCp,
} from "../logic/funds.mjs";
import { CLOSED, closedAs } from "../logic/orders.mjs";
import { canReverse, fundWithdrawableCp } from "../logic/views.mjs";
import { sweepClaims } from "./claims.mjs";
import { lockedWrite, pledge, reverseRows, withdraw } from "./money.mjs";
import { finish, orderDays, orderRows, owns, pledgeTo, retry, viewer } from "./orders.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite } from "./state.mjs";
import { newId, read, records } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid) : null);

/** Whether `cp` is an amount that can move: whole copper above zero. */
const positive = (cp) => Number.isSafeInteger(cp) && cp > 0;

/** Coins from one of the user's characters into the party fund, unallocated (4.6 `deposit`: "Add to party fund"). */
export function deposit(actorUuid, cp) {
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return Promise.resolve(refuse("not-owner"));
    return pledge({ actor, cp, nonce: newId() });
}

/**
 * Coins back out of the party fund, up to the character's own net deposits and what is unallocated (4.6 `withdraw`).
 * It takes the fund slot: earmarking the same money at the same moment cannot also land.
 */
export function withdrawFund(actorUuid, cp) {
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return Promise.resolve(refuse("not-owner"));
    const rows = records("rows");
    const max = fundWithdrawableCp(rows, actorUuid);
    if (!(cp > 0) || cp > max) return Promise.resolve(refuse("too-much", { maxCp: max }));
    return withdraw({ actor, cp, nonce: newId(), locks: [fundSlotLockId(rows)] });
}

/**
 * The order if money may be earmarked for it now: open by its log and its state, and not waiting while a check is
 * recorded and not settled (`rolled`), as a pledge waits.
 */
function fundableOrder(id) {
    if (!canWrite()) return { refusal: refuse("not-ready") };
    const order = read(`orders.${id}`);
    if (!order) return { refusal: refuse("no-order") };
    const status = closedAs(order) ?? order.status;
    if (CLOSED.includes(status) || status === "rolled") return { refusal: refuse("state", { status }) };
    return { order };
}

/**
 * Fund an order from the party fund (As built in M4.1): `cp` of the unallocated fund is earmarked for the order, two
 * `allocate` rows with the party fund as their source, written behind the fund slot's lock page. No coins move: they
 * are in the strongbox already. Any member may (the cooperative trust model of DECISIONS.md 2026-10-25; the rows record
 * who), or a GM.
 */
export async function fundFromParty(orderId, cp) {
    const { refusal } = fundableOrder(orderId);
    if (refusal) return refusal;
    if (!viewer().hasCharacter) return refuse("not-owner");
    if (!positive(cp)) return refuse("nothing");
    const rows = records("rows");
    const available = unallocatedCp(rows);
    if (cp > available) return refuse("fund-short", { maxCp: Math.max(0, available) });
    return lockedWrite([fundSlotLockId(rows)], earmarkInputs({ orderId, cp, nonce: newId() }));
}

/**
 * What of an order's party-fund share can be given back now (`fundReturnableCp`), with a closed order read as its log
 * says (`closedAs`): what the window's "Give back to the party fund" offers and what `returnToParty` allows.
 */
export function returnableFor(orderId) {
    const stored = read(`orders.${orderId}`);
    if (!stored) return 0;
    return fundReturnableCp({ ...stored, status: closedAs(stored) ?? stored.status }, orderRows(orderId));
}

/**
 * Give an order's party-fund share back to the unallocated fund (`returnableFor`): on an open order up to what it does
 * not have committed; on a closed one all of it, which only an earmark that landed after the close can leave there. Any
 * member, or a GM. It takes the order's return slot (`returnSlotLockId`), which every transition that moves the order's
 * money takes too, so neither a second give-back nor a start, settle, finish or cancel planned from the same copy can
 * land with it.
 */
export async function returnToParty(orderId, cp) {
    if (!canWrite()) return refuse("not-ready");
    const stored = read(`orders.${orderId}`);
    if (!stored) return refuse("no-order");
    if (!viewer().hasCharacter) return refuse("not-owner");
    const rows = orderRows(orderId);
    const max = returnableFor(orderId);
    if (!positive(cp) || cp > max) return refuse("too-much", { maxCp: max });
    return lockedWrite([returnSlotLockId(stored, rows)], earmarkInputs({ orderId, cp, nonce: newId(), back: true }));
}

/**
 * "Fund this order" with its source (As built in M4.1): `fund`, the party fund (earmarks, no coins move), or `purse`,
 * a character of this user's (a `pledge`: the coins move into the strongbox, credited to that character).
 * @param {string} orderId
 * @param {{source: "fund"|"purse", actor?: string|null, cp: number}} p
 */
export function fundOrder(orderId, { source, actor = null, cp }) {
    if (source === "fund") return fundFromParty(orderId, cp);
    if (source === "purse") return pledgeTo(orderId, actor, cp);
    return Promise.resolve(refuse("other", { reason: "source" }));
}

/** What the order still lacks for its next step (`shortfallOf`), from this client's copies. */
export function shortfallFor(orderId) {
    const order = read(`orders.${orderId}`);
    return order ? shortfallOf(order, orderRows(orderId), orderDays(orderId), rulesFromSettings()) : null;
}

/**
 * Take a crafter's step that the order's earmarked money must cover (finish, retry), first drawing what it lacks from a
 * chosen source (As built in M4.1). With nothing missing it is the step itself. Otherwise `draw` says where the rest
 * comes from (`fundOrder`); the amount drawn is at least the shortfall (more is refunded to its source when the order
 * ends, 6.2.4). What the step would refuse (not the crafter's owner, not in `status`) is refused before anything is
 * drawn. The draw and the step are two writes: a draw that lands and a step that is then refused leaves the money
 * earmarked for the order, where the next try uses it.
 */
async function drawThen(orderId, { draw, status: wanted, step }) {
    const short = shortfallFor(orderId);
    if (!short) return refuse("no-order");
    const order = read(`orders.${orderId}`);
    if (!owns(order.crafter)) return refuse("not-owner");
    const status = closedAs(order) ?? order.status;
    if (status !== wanted) return refuse("state", { status });
    if (short.shortCp > 0) {
        if (!draw) return refuse("underfunded", { shortCp: short.shortCp });
        const cp = draw.cp ?? short.shortCp;
        if (cp < short.shortCp) return refuse("underfunded", { shortCp: short.shortCp });
        const funded = await fundOrder(orderId, { ...draw, cp });
        if (!funded.ok) return funded;
    }
    return step(orderId);
}

/**
 * Finish an order, first drawing what its earmarked money lacks to pay the rest from a chosen source (`drawThen`).
 * @param {string} orderId
 * @param {{draw?: {source: "fund"|"purse", actor?: string|null, cp?: number}|null}} [options]
 */
export function finishOrder(orderId, { draw = null } = {}) {
    return drawThen(orderId, { draw, status: "finishing", step: finish });
}

/**
 * Retry a failed order, first drawing what its earmarked money lacks for the new attempt's commit (a critical failure
 * ruined some of it) from a chosen source (`drawThen`; review fix of M4.1).
 * @param {string} orderId
 * @param {{draw?: {source: "fund"|"purse", actor?: string|null, cp?: number}|null}} [options]
 */
export function retryOrder(orderId, { draw = null } = {}) {
    return drawThen(orderId, { draw, status: "failed", step: retry });
}

/**
 * Reverse a financial row (4.6): its author or a GM, while its coins can still move back (`canReverse`). Reversing a
 * deposit takes money out of the unallocated fund, so it takes the fund slot (As built in M4.1); reversing a pledge takes
 * money off its order, so it takes the order's return slot.
 */
export async function reverse(rowId) {
    if (!canWrite()) return refuse("not-ready");
    const rows = records("rows");
    const row = rows.find((r) => r.id === rowId);
    if (!row) return refuse("not-reversible");
    const orders = Object.fromEntries(records("orders").map((order) => [order.id, order]));
    if (!canReverse(row, rows, viewer(), orders)) return refuse("not-reversible");
    if (row.order && CLOSED.includes(orders[row.order]?.status)) return refuse("not-reversible");
    const locks = [];
    if (isFundRow(row) && (row.alloc ?? 0) > 0) locks.push(fundSlotLockId(rows));
    // Reversing a pledge takes money off its order: it takes the return slot, as a take-back does.
    if (row.order && (row.alloc ?? 0) > 0) locks.push(returnSlotLockId(orders[row.order], rows.filter((r) => r.order === row.order)));
    return reverseRows([row], {}, null, { locks });
}

/** Collect every claim and shelf item this user's tab is responsible for now ("Collect", 5.5). */
export async function takeAll() {
    if (!canWrite()) return refuse("not-ready");
    const taken = await sweepClaims({ force: true });
    return { ok: true, taken };
}
