/**
 * The Funds tab's actions (DESIGN.md 4.6, 4.7, 10.1): deposits into and withdrawals from the party fund, reversing a
 * financial row, collecting what waits for the user's characters, and for a GM closing a pending row and booking a
 * reconciliation difference (M2's `resolvePending` and `bookAdjustment`). Each is a user's own action.
 */
import { CLOSED } from "../logic/orders.mjs";
import { canReverse, fundWithdrawableCp } from "../logic/views.mjs";
import { sweepClaims } from "./claims.mjs";
import { pledge, reverseRows, withdraw } from "./money.mjs";
import { viewer } from "./orders.mjs";
import { canWrite } from "./state.mjs";
import { newId, records } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid) : null);

/** Coins from one of the user's characters into the party fund (4.6 `deposit`). */
export function deposit(actorUuid, cp) {
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return Promise.resolve(refuse("not-owner"));
    return pledge({ actor, cp, nonce: newId() });
}

/** Coins back out of the party fund, up to the character's own net deposits (4.6 `withdraw`). */
export function withdrawFund(actorUuid, cp) {
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return Promise.resolve(refuse("not-owner"));
    const max = fundWithdrawableCp(records("rows"), actorUuid);
    if (!(cp > 0) || cp > max) return Promise.resolve(refuse("too-much", { maxCp: max }));
    return withdraw({ actor, cp, nonce: newId() });
}

/** Reverse a financial row (4.6): its author or a GM, while its coins can still move back (`canReverse`). */
export async function reverse(rowId) {
    if (!canWrite()) return refuse("not-ready");
    const rows = records("rows");
    const row = rows.find((r) => r.id === rowId);
    if (!row) return refuse("not-reversible");
    const orders = Object.fromEntries(records("orders").map((order) => [order.id, order]));
    if (!canReverse(row, rows, viewer(), orders)) return refuse("not-reversible");
    if (row.order && CLOSED.includes(orders[row.order]?.status)) return refuse("not-reversible");
    return reverseRows([row]);
}

/** Collect every claim and shelf item this user's tab is responsible for now ("Take it", 5.5). */
export async function takeAll() {
    if (!canWrite()) return refuse("not-ready");
    const taken = await sweepClaims({ force: true });
    return { ok: true, taken };
}
