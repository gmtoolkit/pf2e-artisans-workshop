/**
 * Coin moves (DESIGN.md 4.6, 5.4): every movement of value is a ledger row, and every row that moves coins is
 * written by one lock-first move together with the coin items it changes.
 *
 * Each move runs behind the user's coin mutex (`lease.mjs`), plans from the coins as they are now (the M1
 * planner in `scripts/logic/coins.mjs`), leaving out stacks another move has locked, skips rows that already
 * exist (the fast path), and sends the lock request (lock pages, rows pending) and then the apply request
 * (debits, credits, settle). The lock names the rows, the strongbox stacks the move deletes, and the purse stacks
 * it changes at the version it planned from, so two moves on the same coins cannot both land. A lost lock comes
 * back as `conflict` with nothing moved; the caller re-plans from fresh data if it still wants the move (the
 * sweep retries claims on its next run).
 *
 * The functions return `{ok, outcome?, reason?, rows?}`. `reason` codes for refusals: "not-ready" (the client
 * may not write), "no-coins" (the coin items did not load), "not-owner" (the purse is not this user's to write),
 * "nothing" (0 cp), "purse-short", "strongbox-short".
 */
import { idemKey } from "../logic/ids.mjs";
import { planPurseCredit, planPurseDebit, planSpend, planStrongboxCredit, planStrongboxDebit } from "../logic/coins.mjs";
import { lockFirstBatch, lockIdsFor, purseLockIds, stackLockId } from "../logic/lock-first.mjs";
import { BOOKKEEPING_KINDS, makeRow } from "../logic/rows.mjs";
import { coinStacks, coinsLoaded } from "./coins.mjs";
import { runLockFirst } from "./batch.mjs";
import { withCoinMutex } from "./lease.mjs";
import { canWrite, shared } from "./state.mjs";
import { exists, read, stampNow, write } from "./store.mjs";

const refuse = (reason) => ({ ok: false, reason });

/** The ledger change that writes `rows` (as `rows.<id>`) on top of `ledger`. */
function withRows(ledger, rows) {
    return { ...ledger, set: { ...ledger.set, ...Object.fromEntries(rows.map((row) => [`rows.${row.id}`, row])) } };
}

/**
 * The actor's coin stacks that no move has locked: a strongbox stack whose id has a lock page, or a purse stack
 * locked at its current version, is spoken for by a move in flight or one that stopped part-way, so planning
 * around it avoids a certain conflict (5.4).
 */
export function freeStacks(actor) {
    const pages = shared().ledger?.pages;
    if (!pages) return coinStacks(actor);
    return coinStacks(actor).filter((stack) => !pages.has(stack.id) && !pages.has(stackLockId(stack.id, stack.version)));
}

/**
 * The common path of every coin move.
 * @param {(strongbox: Actor) => ({rows: object[], debits?: object[], credits?: object[], locks?: string[]} | {refuse: string})} plan
 *        called inside the mutex with the strongbox; returns the `makeRow` inputs, the coin plans and the purse
 *        stack locks
 * @param {object} [ledger]  other ledger keys written with the rows, e.g. a claim's `resolved`
 */
export function moveCoins(plan, ledger = {}) {
    return withCoinMutex(game.user.id, async () => {
        if (!canWrite()) return refuse("not-ready");
        if (!coinsLoaded()) return refuse("no-coins");
        const planned = plan(shared().strongbox);
        if (planned.refuse) return refuse(planned.refuse);
        const stamp = stampNow();
        const rows = planned.rows.map((input) => makeRow(input, stamp));
        if (rows.some((row) => exists(`rows.${row.id}`))) return { ok: true, outcome: "already", rows };   // fast path
        const rowIds = rows.map((row) => row.id);
        const debits = planned.debits ?? [];
        const batch = lockFirstBatch({
            rowIds, lockIds: lockIdsFor([...rowIds, ...(planned.locks ?? [])], debits), ledger: withRows(ledger, rows),
            debits, credits: planned.credits ?? [], lot: rows[0].id,
        });
        const result = await runLockFirst(batch);
        if (result.outcome === "stopped") await noteStopped(rows, result);
        return { ok: result.outcome === "ok", outcome: result.outcome, reason: result.reason, rows };
    });
}

/**
 * Mark rows whose move stopped after its lock, for reconciliation (best effort): pending again (the settle may
 * have gone through although an operation before it did not), with what happened.
 */
async function noteStopped(rows, { applied, total, reason }) {
    const note = { ...stampNow(), applied, total, reason: reason ?? null };
    const set = {};
    for (const row of rows) Object.assign(set, { [`rows.${row.id}.state`]: "pending", [`rows.${row.id}.stopped`]: note });
    await write({ set });
}

/** Whether this user may write the actor's purse: its owner, or a GM. */
const ownsPurse = (actor) => actor.isOwner;

/**
 * Coins from a purse into the strongbox: a `pledge` to an order or garden, or a `deposit` into the party fund
 * (4.6). `nonce` is generated once when the user confirms, so a retried confirmation is the same row.
 */
export function pledge({ actor, cp, order = null, garden = null, nonce, note = null }) {
    const kind = order || garden ? "pledge" : "deposit";
    const row = { kind, idem: idemKey(kind, order ?? garden ?? "fund", actor.uuid, nonce), cp, actor: actor.uuid, order, garden, note };
    return moveCoins(() => {
        if (!ownsPurse(actor)) return { refuse: "not-owner" };
        if (!(cp > 0)) return { refuse: "nothing" };
        const stacks = freeStacks(actor);
        const purse = planPurseDebit(stacks, cp);
        if (!purse) return { refuse: "purse-short" };
        return { rows: [row], debits: [{ target: actor.uuid, plan: purse }], credits: [{ target: "strongbox", plan: planStrongboxCredit(cp) }],
            locks: purseLockIds(stacks, purse) };
    });
}

/**
 * Coins from the strongbox into a purse, for a row given in full: a `withdraw` of an unspent share or a
 * `refund` (4.6). `ledger` holds other keys to write with it (a claim's `resolved`).
 */
export function payout({ actor, row, ledger = {} }) {
    return moveCoins((strongbox) => {
        if (!ownsPurse(actor)) return { refuse: "not-owner" };
        if (!(row.cp > 0)) return { refuse: "nothing" };
        const box = planStrongboxDebit(freeStacks(strongbox), row.cp);
        if (!box) return { refuse: "strongbox-short" };
        const stacks = freeStacks(actor);
        const purse = planPurseCredit(stacks, row.cp);
        return { rows: [row], debits: [{ target: "strongbox", plan: box }], credits: [{ target: actor.uuid, plan: purse }],
            locks: purseLockIds(stacks, purse) };
    }, ledger);
}

/** A withdrawal of the actor's unspent, uncommitted share of an order, a garden or the fund (4.6). */
export function withdraw({ actor, cp, order = null, garden = null, nonce, note = null }) {
    const idem = idemKey("withdraw", order ?? garden ?? "fund", actor.uuid, nonce);
    return payout({ actor, row: { kind: "withdraw", idem, cp, actor: actor.uuid, order, garden, note } });
}

/** Coins minted into a purse, for a row given in full: a `wage` (6.10). */
export function mint({ actor, row, ledger = {} }) {
    return moveCoins(() => {
        if (!ownsPurse(actor)) return { refuse: "not-owner" };
        if (!(row.cp > 0)) return { refuse: "nothing" };
        const stacks = freeStacks(actor);
        const purse = planPurseCredit(stacks, row.cp);
        return { rows: [row], credits: [{ target: actor.uuid, plan: purse }], locks: purseLockIds(stacks, purse) };
    }, ledger);
}

/**
 * Money an order or a garden spends out of the strongbox (`expend`, `ruin`, `remainder`, `plant`), one row
 * per contributor in proportion to what each has left allocated (4.6), keyed `<stem>:<contributor>`.
 *
 * @param {object} p
 * @param {string} p.kind
 * @param {string} p.stem   e.g. `expend:<orderId>:<attempt>:<seq>`
 * @param {number} p.cp
 * @param {{actor: string|null, cp: number}[]} p.allocations  `allocationsByContributor` over its rows
 * @param {object} [p.link] `{order}` or `{garden}`, and `day`
 */
export function spend({ kind, stem, cp, allocations, link = {} }) {
    return moveCoins((strongbox) => {
        if (!(cp > 0)) return { refuse: "nothing" };
        const planned = planSpend(freeStacks(strongbox), allocations, cp);
        if (!planned) return { refuse: "strongbox-short" };
        const rows = planned.shares.filter((share) => share.cp > 0).map((share) => ({
            kind, idem: `${stem}:${share.actor ?? "fund"}`, cp: share.cp, actor: share.actor, ...link,
        }));
        return { rows, debits: [{ target: "strongbox", plan: planned.strongbox }] };
    });
}

/**
 * Rows that move nothing (`BOOKKEEPING_KINDS`: `commit`, `release`, `allocate`, a GM's `adjust`, `carry`): one
 * key-path write, already applied. They are idempotent by key without a lock: writing one twice writes the
 * same key.
 */
export async function postRows(inputs, ledger = {}) {
    if (!canWrite()) return refuse("not-ready");
    const stamp = stampNow();
    const rows = inputs.map((input) => ({ ...makeRow(input, stamp), state: "applied" }));
    if (rows.some((row) => !BOOKKEEPING_KINDS.includes(row.kind))) throw new RangeError("postRows is for rows that move nothing");
    const fresh = rows.filter((row) => !exists(`rows.${row.id}`));
    if (fresh.length) await write(withRows(ledger, fresh));
    return { ok: true, outcome: fresh.length ? "ok" : "already", rows };
}

/**
 * Close a pending row by hand after checking the coins (5.4 step 4): its author or a GM marks it applied. The
 * money itself is corrected, if needed, with a GM `adjust` row.
 */
export async function resolvePending(rowId, note = null) {
    const row = read(`rows.${rowId}`);
    if (!row || row.state !== "pending") return refuse("not-pending");
    if (row.author !== game.user.id && !game.user.isGM) return refuse("not-author");
    await write({ set: { [`rows.${rowId}.state`]: "applied", [`rows.${rowId}.resolved`]: { ...stampNow(), note } } });
    return { ok: true };
}
