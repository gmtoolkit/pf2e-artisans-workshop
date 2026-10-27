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
 * Every coin move is resumable (`lockFirstBatch`): if its lock request lands and its apply request never does (the
 * tab closed, or the connection dropped or the answer never came in between), the sweep sends the apply request
 * again under the same lock once the rows are past the grace time and its items are as it planned them
 * (`resumeStalled`); its apply mark lets that request apply once, whoever sends it. A close by hand
 * (`resolvePending`) and a GM's adjust (`reconcile.mjs`) leave a move the module resumes alone; for one that needs a
 * hand they take that mark, so of a close, an adjust and a late apply request exactly one lands.
 *
 * The functions return `{ok, outcome?, reason?, rows?}`. `reason` codes for refusals: "not-ready" (the client
 * may not write), "no-coins" (the coin items did not load), "not-owner" (the purse is not this user's to write),
 * "nothing" (no positive amount: 0 cp, a negative one or none), "purse-short", "strongbox-short".
 */
import { hashId, idemKey } from "../logic/ids.mjs";
import { planPurseCredit, planPurseDebit, planSpend, planStrongboxCredit, planStrongboxDebit } from "../logic/coins.mjs";
import { MODULE_ID } from "../constants.mjs";
import {
    applyMarkId, lockFirstBatch, lockIdsFor, purseLockIds, recreateLockId, resumeApply, resumeDecision, stackLockId,
} from "../logic/lock-first.mjs";
import { pendingState } from "../logic/reconcile.mjs";
import { BOOKKEEPING_KINDS, makeRow, reversalRow } from "../logic/rows.mjs";
import { coinStacks, coinsLoaded, itemVersion } from "./coins.mjs";
import { runApply, runLockFirst, runRequest } from "./batch.mjs";
import { holdsLease, withCoinMutex } from "./lease.mjs";
import { responsibleUserIdFor, responsibleUserIdForShared } from "./responsible.mjs";
import { canWrite, shared } from "./state.mjs";
import { exists, read, records, serverNow, stampNow, write } from "./store.mjs";

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

/** Two ledger changes as one. */
function mergeChanges(a = {}, b = {}) {
    return { set: { ...a.set, ...b.set }, replace: { ...a.replace, ...b.replace }, del: [...(a.del ?? []), ...(b.del ?? [])] };
}

/**
 * The common path of every coin move.
 * @param {(strongbox: Actor) => ({rows: object[], debits?: object[], credits?: object[], locks?: string[], items?: object[],
 *        ledger?: object} | {refuse: string})} plan
 *        called inside the mutex with the strongbox; returns the `makeRow` inputs (or rows already built, such as
 *        reversals), the coin plans, the purse stack locks, items the apply request creates (`{target, data}`: a
 *        finished order's shelf items, M4), items it updates (`itemUpdates`, `{target, updates}`: a target's new runes,
 *        an earmarked item put on the shelf, M5) and ledger keys that depend on the plan (written with the lock)
 * @param {object} [ledger]  other ledger keys written with the rows, e.g. a claim's `resolved`
 * @param {object[]} [known] the `makeRow` inputs of the rows, when they are known before planning (every move but a
 *        spend, whose rows follow its shares). The fast path then comes first: a move whose row exists is "already",
 *        even while the coins it would plan from are spoken for by that very move (its lock pages hold them, so a
 *        plan would come back short). It looks only at the rows' ids (the hashes of their keys), so an input the
 *        plan refuses (0 cp, a negative or missing amount: "nothing") is refused there, not thrown by `makeRow`.
 */
export function moveCoins(plan, ledger = {}, known = []) {
    return withCoinMutex(game.user.id, async () => {
        if (!canWrite()) return refuse("not-ready");
        const knownIds = known.map((input) => hashId(input.idem));
        if (knownIds.some((id) => exists(`rows.${id}`))) {
            return { ok: true, outcome: "already", rows: knownIds.map((id) => read(`rows.${id}`)).filter(Boolean) };   // fast path
        }
        if (!coinsLoaded()) return refuse("no-coins");
        const planned = plan(shared().strongbox);
        if (planned.refuse) return refuse(planned.refuse);
        const stamp = stampNow();
        const rows = planned.rows.map((input) => (input.id && input.v ? input : makeRow(input, stamp)));
        if (rows.some((row) => exists(`rows.${row.id}`))) return { ok: true, outcome: "already", rows };   // fast path
        const rowIds = rows.map((row) => row.id);
        const debits = planned.debits ?? [];
        const credits = planned.credits ?? [];
        const itemUpdates = planned.itemUpdates ?? [];
        const updated = itemUpdates.map(({ target, updates }) => ({ target, plan: { updates: updates.map((u) => ({ id: u._id })) } }));
        const batch = lockFirstBatch({
            rowIds, lockIds: lockIdsFor([...rowIds, ...(planned.locks ?? [])], debits), ledger: withRows(mergeChanges(ledger, planned.ledger), rows),
            debits, credits, items: planned.items ?? [], itemUpdates, lot: rows[0].id,
            // The resumer must be able to write every actor the apply request touches: an item changed in place on a
            // character (a finished etching) names that character even when the coins come from the strongbox alone.
            resume: { touched: touchedBy([...debits, ...updated, ...credits]), actor: purseOf([...debits, ...updated, ...credits, ...(planned.items ?? [])]) },
        });
        const result = await runLockFirst(batch);
        if (result.outcome === "stopped") await noteStopped(rows, result);
        return { ok: result.outcome === "ok", outcome: result.outcome, reason: result.reason, rows };
    });
}

/** The actor a coin plan's `target` names: the strongbox, or an actor by UUID. */
const actorOf = (target) => (target === "strongbox" ? shared().strongbox : fromUuidSync(target));

/** Every item the coin plans delete or update, with its version now (as planned): what a resume checks first. */
function touchedBy(plans) {
    return plans.flatMap(({ target, plan }) => {
        const ids = [...new Set([...(plan.deletes ?? []), ...(plan.updates ?? []).map((update) => update.id)])];
        return ids.map((id) => ({ target, id, version: itemVersion(actorOf(target).items.get(id)) }));
    });
}

/**
 * The actor (a UUID) a move writes besides the strongbox: the purse its coin plans move coins in or out of, or a
 * character whose items it updates or creates; null for the strongbox alone. Its resumer must own it (`resumerOf`).
 */
const purseOf = (plans) => plans.find(({ target }) => target !== "strongbox")?.target ?? null;

/**
 * Note on rows whose move stopped after its lock what happened, for reconciliation (best effort). A request that
 * went out smaller than it was built (`shrunk`: the client dropped an operation on the way) may have settled the
 * rows without it, so they are set pending again. Otherwise the settle, the request's last operation, did not apply
 * (the server stops at the first error, and a refusal applies nothing), so the rows are still pending on the
 * server, and writing that again could only undo the settle of a client that resumed the move meanwhile.
 */
export async function noteStopped(rows, { applied, total, reason }) {
    const note = { ...stampNow(), applied, total, reason: reason ?? null };
    const set = {};
    for (const row of rows) {
        set[`rows.${row.id}.stopped`] = note;
        if (reason === "shrunk") set[`rows.${row.id}.state`] = "pending";
    }
    await write({ set });
}

/* -------------------------------------------- */
/*  Resuming a move whose apply never landed     */
/* -------------------------------------------- */

/** Lock pages holding a resumable move (its first row's), in this client's ledger. */
const movePages = () => shared().ledger?.pages.filter((page) => page.flags?.[MODULE_ID]?.move) ?? [];

/** What to do about the move on `page` (`resumeDecision`), from this client's copies. */
function decide(page) {
    const { move } = page.flags[MODULE_ID];
    return resumeDecision({
        move, rows: move.rows.map((id) => read(`rows.${id}`)), marked: shared().ledger.pages.has(applyMarkId(move.rows[0])),
        versionOf: (target, id) => {
            const item = actorOf(target)?.items.get(id);
            return item ? itemVersion(item) : null;
        },
        now: serverNow(),
    });
}

/**
 * The user whose client resumes the move on `page` (5.6), or null when no connected user's does. While the user who
 * took its lock is connected, that user: they planned the move, and their coin mutex keeps the resume behind a move of
 * their own still waiting for an answer; but only if they may write the purse it moves. Otherwise the user responsible
 * for the purse (its connected owner, else the active GM), or for a move on the strongbox alone the one responsible for
 * shared writes after that user (the active GM, else the first connected user). A purse needs a writer who owns it.
 */
function resumerOf(page) {
    const { lock, move } = page.flags[MODULE_ID];
    const purse = move.actor ? fromUuidSync(move.actor) : null;
    if (move.actor && !purse) return null;
    const author = game.users.get(lock?.by);
    if (author?.active) return !purse || purse.testUserPermission(author, "OWNER") ? author.id : null;
    return purse ? responsibleUserIdFor(purse) : responsibleUserIdForShared(lock?.by);
}

/** Whether this tab resumes the move on `page`: its user is the one (`resumerOf`) and it holds that user's lease. */
const mayResume = (page) => holdsLease() && resumerOf(page) === game.user.id;

/** Moves this client resumed without success this session: left to the manual path until it reloads. */
const unresumable = new Set();

/**
 * Send again the apply request of every move whose lock request landed but whose apply request never did, that this
 * tab is the one to resume (DESIGN.md 5.4, As built: Resume); part of the catch-up sweep. A move that is too young
 * to judge is looked at again when it is due.
 * @returns {Promise<{resumed: number, dueInMs: number|null}>}  how many applied, and when the next one is due
 */
export async function resumeStalled() {
    let resumed = 0;
    let dueInMs = null;
    if (!canWrite() || !coinsLoaded()) return { resumed, dueInMs };
    for (const page of movePages()) {
        if (unresumable.has(page.id) || !mayResume(page)) continue;
        const decision = decide(page);
        if (decision.action === "wait") dueInMs = Math.min(dueInMs ?? Infinity, decision.dueInMs);
        if (decision.action === "resume" && (await resumeMove(page.id)).ok) resumed += 1;
    }
    return { resumed, dueInMs };
}

/**
 * Resume one move inside the coin mutex, judged again there. An apply request this client sees through to "ok"
 * settles the rows; "taken" means another client sent it first, or a close or an adjust took the mark; "stopped" notes
 * the rows for the manual path.
 */
function resumeMove(pageId) {
    return withCoinMutex(game.user.id, async () => {
        const page = shared().ledger?.pages.get(pageId);
        if (!canWrite() || !page || decide(page).action !== "resume") return { ok: false, outcome: "skipped" };
        const { move } = page.flags[MODULE_ID];
        const rows = move.rows.map((id) => read(`rows.${id}`));
        console.info(`${MODULE_ID} | resuming a move whose apply request never landed`, move.rows);
        const result = await runApply(resumeApply(move));
        if (result.outcome !== "ok") unresumable.add(pageId);
        if (result.outcome === "stopped") await noteStopped(rows, result);
        return { ok: result.outcome === "ok", outcome: result.outcome, reason: result.reason, rows };
    });
}

/** For tests only. */
export function resetResume() {
    unresumable.clear();
}

/* -------------------------------------------- */
/*  What finishes a pending row                  */
/* -------------------------------------------- */

/** A mark's lock page as `pendingState` reads it (when it was taken, and `hand` if by a close or an adjust), or null. */
function markOf(id) {
    const page = shared().ledger?.pages.get(id);
    if (!page) return null;
    const flags = page.flags?.[MODULE_ID] ?? {};
    return { at: flags.lock?.at ?? null, hand: flags.hand ?? null };
}

/**
 * The automatic path of every pending row that has one, from this client's copies, by row id: for the rows of a
 * resumable coin move, its apply mark, and whether the move is resumed (`resumeDecision` says "resume" and a connected
 * user's client resumes it, `resumerOf`; otherwise nothing will, and its author is told); for a `delivered` row, the
 * lock its re-creation takes, and whether it is re-created (a snapshot, a recipient and a connected user responsible
 * for the recipient, 4.7). `rows` are the rows that path settles together: every row of the move, or the delivered
 * row. Reconciliation sorts pending rows by it (`pendingState`); a close or an adjust leaves a path that runs alone,
 * and takes the mark of one that does not, so that of that path, a close and an adjust exactly one lands.
 * @returns {Map<string, {markId: string, mark: {at: object, hand: object|null}|null, auto: boolean, rows: string[]}>}
 */
export function pendingPaths() {
    const paths = new Map();
    for (const page of movePages()) {
        const { move } = page.flags[MODULE_ID];
        if (!move.rows.some((id) => read(`rows.${id}.state`) === "pending")) continue;
        const markId = applyMarkId(move.rows[0]);
        const path = { markId, mark: markOf(markId), auto: decide(page).action === "resume" && resumerOf(page) !== null, rows: [...move.rows] };
        for (const id of move.rows) paths.set(id, path);
    }
    for (const row of records("rows")) {
        if (row.kind !== "delivered" || row.state !== "pending") continue;
        const markId = recreateLockId(row.id);
        const recipient = fromUuidSync(row.actor);
        const auto = !!row.items?.[0]?.source && !!recipient && responsibleUserIdFor(recipient) !== null;
        paths.set(row.id, { markId, mark: markOf(markId), auto, rows: [row.id] });
    }
    return paths;
}

/**
 * One request: lock pages for `markIds`, flagged as taken by hand (`hand`), then the ledger `change`. The server
 * creates none of them if one exists, so a resume (or re-creation) that took a mark first refuses the whole request,
 * and this one, landing first, refuses theirs.
 * @returns {Promise<{ok: boolean, outcome: string, reason?: string}>}  "taken" when a mark was someone else's
 */
async function withMarks(markIds, hand, change) {
    const result = await runRequest([{ op: "lock", ids: markIds, hand }, { op: "ledger", change }]);
    if (result.outcome === "ok") return { ok: true, outcome: "ok" };
    if (result.outcome === "refused") return { ok: false, outcome: "taken", reason: "taken" };
    return { ok: false, outcome: result.outcome, reason: result.reason };
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
    }, {}, [row]);
}

/**
 * Coins from the strongbox into a purse, for a row given in full: a `withdraw` of an unspent share or a
 * `refund` (4.6). `ledger` holds other keys to write with it (a claim's `resolved`); `locks` other lock pages its lock
 * request takes (a withdrawal from the party fund takes the fund slot, `fundSlotLockId`, As built in M4.1).
 */
export function payout({ actor, row, ledger = {}, locks = [] }) {
    return moveCoins((strongbox) => {
        if (!ownsPurse(actor)) return { refuse: "not-owner" };
        if (!(row.cp > 0)) return { refuse: "nothing" };
        const box = planStrongboxDebit(freeStacks(strongbox), row.cp);
        if (!box) return { refuse: "strongbox-short" };
        const stacks = freeStacks(actor);
        const purse = planPurseCredit(stacks, row.cp);
        return { rows: [row], debits: [{ target: "strongbox", plan: box }], credits: [{ target: actor.uuid, plan: purse }],
            locks: [...locks, ...purseLockIds(stacks, purse)] };
    }, ledger, [row]);
}

/** A withdrawal of the actor's unspent, uncommitted share of an order, a garden or the fund (4.6). */
export function withdraw({ actor, cp, order = null, garden = null, nonce, note = null, locks = [] }) {
    const idem = idemKey("withdraw", order ?? garden ?? "fund", actor.uuid, nonce);
    return payout({ actor, row: { kind: "withdraw", idem, cp, actor: actor.uuid, order, garden, note }, locks });
}

/** Coins minted into a purse, for a row given in full: a `wage` (6.10). */
export function mint({ actor, row, ledger = {} }) {
    return moveCoins(() => {
        if (!ownsPurse(actor)) return { refuse: "not-owner" };
        if (!(row.cp > 0)) return { refuse: "nothing" };
        const stacks = freeStacks(actor);
        const purse = planPurseCredit(stacks, row.cp);
        return { rows: [row], credits: [{ target: actor.uuid, plan: purse }], locks: purseLockIds(stacks, purse) };
    }, ledger, [row]);
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
 * @param {object} [p.ledger] other ledger keys written with the rows (a settled order's new state, 6.12)
 * @param {string[]} [p.locks] other lock pages its lock request takes (the order's log slot, `logLockId`)
 */
export function spend({ kind, stem, cp, allocations, link = {}, ledger = {}, locks = [] }) {
    return moveCoins((strongbox) => {
        if (!(cp > 0)) return { refuse: "nothing" };
        const planned = planSpend(freeStacks(strongbox), allocations, cp);
        if (!planned) return { refuse: "strongbox-short" };
        const rows = planned.shares.filter((share) => share.cp > 0).map((share) => ({
            kind, idem: `${stem}:${share.actor ?? "fund"}`, cp: share.cp, actor: share.actor, ...link,
        }));
        return { rows, debits: [{ target: "strongbox", plan: planned.strongbox }], locks };
    }, ledger);
}

/**
 * Reverse rows (4.6): one `reversal` row each, keyed `reversal:<row id>`, with the inverse amounts, and the original
 * marked `reversedBy`. Coins move back where that is what the rows moved: out of or into the strongbox (`box`), and into
 * or out of the purse of the rows' counterparty (`purse`); a reversal of an `expend` or `ruin` mints the spent coins back
 * into the strongbox (an undone settlement, 4.2.3). Reversals of rows that moved nothing (`commit`, `release`) are
 * written applied in one key-path write. All rows' purse amounts must belong to one actor. `ledger` holds other keys
 * written with them (an undone transition's fields), and `locks` lock pages the write takes first (the undo's log slot,
 * `logLockId`): with them it lands only if none exists ("taken" otherwise).
 * @returns {Promise<{ok: boolean, outcome?: string, reason?: string, rows?: object[]}>}
 */
export async function reverseRows(targets, ledger = {}, note = null, { locks = [] } = {}) {
    if (!targets.length) {
        if (!canWrite()) return refuse("not-ready");
        if (locks.length) return { ...(await withMarks(locks, null, ledger)), rows: [] };
        await write(ledger);
        return { ok: true, outcome: "ok", rows: [] };
    }
    const purses = [...new Set(targets.filter((row) => (row.purse ?? 0) !== 0).map((row) => row.actor))];
    if (purses.length > 1) throw new RangeError("one reversal moves one purse's coins");
    const boxCp = -targets.reduce((sum, row) => sum + (row.box ?? 0), 0);
    const purseCp = -targets.reduce((sum, row) => sum + (row.purse ?? 0), 0);
    const marks = (reversals) => ({ set: Object.fromEntries(reversals.map((r) => [`rows.${r.reverses}.reversedBy`, r.id])) });
    if (boxCp === 0 && purseCp === 0) {
        if (!canWrite()) return refuse("not-ready");
        const stamp = stampNow();
        const reversals = targets.map((row) => ({ ...reversalRow(row, stamp, note), state: "applied" }));
        const fresh = reversals.filter((row) => !exists(`rows.${row.id}`));
        if (!fresh.length) return { ok: true, outcome: "already", rows: reversals };
        const change = withRows(mergeChanges(ledger, marks(fresh)), fresh);
        if (locks.length) return { ...(await withMarks(locks, null, change)), rows: reversals };
        await write(change);
        return { ok: true, outcome: "ok", rows: reversals };
    }
    const purse = purses.length ? fromUuidSync(purses[0]) : null;
    return moveCoins((strongbox) => {
        if (purses.length && !purse) return { refuse: "no-actor" };
        if (purse && !ownsPurse(purse)) return { refuse: "not-owner" };
        const stamp = stampNow();
        const reversals = targets.map((row) => reversalRow(row, stamp, note));
        const debits = [];
        const credits = [];
        const purseLocks = [];
        if (boxCp < 0) {
            const box = planStrongboxDebit(freeStacks(strongbox), -boxCp);
            if (!box) return { refuse: "strongbox-short" };
            debits.push({ target: "strongbox", plan: box });
        }
        if (purseCp < 0) {
            const stacks = freeStacks(purse);
            const plan = planPurseDebit(stacks, -purseCp);
            if (!plan) return { refuse: "purse-short" };
            debits.push({ target: purse.uuid, plan });
            purseLocks.push(...purseLockIds(stacks, plan));
        }
        if (boxCp > 0) credits.push({ target: "strongbox", plan: planStrongboxCredit(boxCp) });
        if (purseCp > 0) {
            const stacks = freeStacks(purse);
            const plan = planPurseCredit(stacks, purseCp);
            credits.push({ target: purse.uuid, plan });
            purseLocks.push(...purseLockIds(stacks, plan));
        }
        return { rows: reversals, debits, credits, locks: [...locks, ...purseLocks], ledger: marks(reversals) };
    }, ledger, targets.map((row) => ({ idem: `reversal:${row.id}` })));
}

/**
 * Rows that move nothing (`BOOKKEEPING_KINDS`: `commit`, `release`, `allocate`, a GM's `adjust`, `carry`): one
 * key-path write, already applied. They are idempotent by key without a lock: writing one twice writes the
 * same key. With `marks` (a GM's adjust, `reconcile.mjs`), the write goes in one request after lock pages for those
 * marks, flagged as taken by hand: it lands only if none of them exists, and once it has, no move behind them can.
 * @returns {Promise<{ok: boolean, outcome: string, reason?: string, rows: object[]}>}  "taken" when a mark existed
 */
export async function postRows(inputs, ledger = {}, { marks = [] } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const stamp = stampNow();
    const rows = inputs.map((input) => ({ ...makeRow(input, stamp), state: "applied" }));
    if (rows.some((row) => !BOOKKEEPING_KINDS.includes(row.kind))) throw new RangeError("postRows is for rows that move nothing");
    const fresh = rows.filter((row) => !exists(`rows.${row.id}`));
    if (!fresh.length) return { ok: true, outcome: "already", rows };
    if (!marks.length) {
        await write(withRows(ledger, fresh));
        return { ok: true, outcome: "ok", rows };
    }
    return { ...(await withMarks(marks, { kind: fresh[0].kind, row: fresh[0].id }, withRows(ledger, fresh))), rows };
}

/**
 * Rows that move nothing (`BOOKKEEPING_KINDS`) and other ledger keys in one request behind lock pages `lockIds`
 * (As built in M4: an order's transition, behind its log slot's page, `logLockId`): the server creates none of the
 * pages if one exists, so the write lands only if none did, and nothing of it lands otherwise ("taken"). Rows that
 * exist already are not written again; the ledger keys always are.
 * @returns {Promise<{ok: boolean, outcome: string, reason?: string, rows: object[]}>}
 */
export async function lockedWrite(lockIds, inputs, ledger = {}) {
    if (!canWrite()) return refuse("not-ready");
    const stamp = stampNow();
    const rows = inputs.map((input) => ({ ...makeRow(input, stamp), state: "applied" }));
    if (rows.some((row) => !BOOKKEEPING_KINDS.includes(row.kind))) throw new RangeError("lockedWrite is for rows that move nothing");
    const fresh = rows.filter((row) => !exists(`rows.${row.id}`));
    return { ...(await withMarks(lockIds, null, withRows(ledger, fresh))), rows };
}

/**
 * Close a pending row by hand after checking the coins (5.4 step 4): its author or a GM marks it applied, with every
 * other pending row of the same move, since one request moved their coins together. The money itself is corrected,
 * if needed, with a GM `adjust` row.
 *
 * Only a row that needs a hand is closed (`pendingState` "needsHand"). Refused as "in-flight" while a request may still
 * apply it, and as "resumable" while the module finishes it by itself (a coin move it resumes, a lost delivery it
 * re-creates): closing it would cancel a move whose row still counts, crediting coins nobody paid. A row
 * whose automatic path has a mark nobody has taken (its move's own apply request may still land, or the path may run
 * again later) is closed in one request with that mark (`withMarks`): whichever of the close and that request reaches
 * the server first lands, and the other is refused there ("taken" here, nothing written). Runs in the coin mutex, so
 * it waits for a move or a resume of this client's own that is under way.
 * @returns {Promise<{ok: boolean, rows?: string[], reason?: string}>}  `rows`: the ids closed; reasons "not-ready",
 *          "not-pending", "not-author", "in-flight", "resumable", "taken", or a batch failure ("disconnected", ...)
 */
export function resolvePending(rowId, note = null) {
    return withCoinMutex(game.user.id, async () => {
        if (!canWrite()) return refuse("not-ready");
        const row = read(`rows.${rowId}`);
        if (!row || row.state !== "pending") return refuse("not-pending");
        if (row.author !== game.user.id && !game.user.isGM) return refuse("not-author");
        const path = pendingPaths().get(rowId) ?? null;
        const state = pendingState(row, { now: serverNow(), auto: path?.auto, mark: path?.mark });
        if (state === "inFlight") return refuse("in-flight");
        if (state === "resumable") return refuse("resumable");
        const ids = (path?.rows ?? [rowId]).filter((id) => read(`rows.${id}.state`) === "pending");
        const resolved = { ...stampNow(), note };
        const change = { set: Object.fromEntries(ids.flatMap((id) => [[`rows.${id}.state`, "applied"], [`rows.${id}.resolved`, resolved]])) };
        if (!path || path.mark) {
            await write(change);
            return { ok: true, rows: ids };
        }
        const taken = await withMarks([path.markId], { kind: "close", row: rowId }, change);
        return taken.ok ? { ok: true, rows: ids } : refuse(taken.reason);
    });
}
