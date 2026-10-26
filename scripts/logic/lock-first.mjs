/**
 * The order of operations in a lock-first move (DESIGN.md 5.4, 5.5). Pure: it lays out the two requests one coin
 * move or delivery sends, as descriptors the Foundry side turns into `foundry.documents.modifyBatch` operations
 * (`scripts/foundry/batch.mjs`).
 *
 * Foundry 14.368's server dry-runs every operation of a request and refuses the whole request if one fails, then
 * applies them one at a time and stops at the first error without rolling back (5.4). When it refuses at the dry
 * run, the requesting client processes the dry-run results that passed as if they had happened: created and
 * deleted documents appear and vanish on that client only, while an update is not committed. So a move is two
 * requests:
 *
 * 1. The lock request: the lock pages, then the ledger rows (`state: "pending"`) and any other ledger keys (a
 *    claim's `resolved`). The lock pages are created in the ledger with `keepId`, one per id the move names: its
 *    rows, every strongbox item it deletes, and every purse coin stack it changes, at that stack's version
 *    (`stackLockId`). The server refuses a page whose id exists, and refuses the whole create if any one does, so
 *    two moves for the same row, or two that spend the same stack, cannot both get past it. A lock request that
 *    loses changes nothing anywhere: its only other operation is an update, which a refused dry run does not
 *    commit on the client either.
 * 2. The apply request, sent once the lock is held: debits (the coins and items that leave: purse or strongbox
 *    stacks deleted or reduced, and their change), credits (the coins that arrive, and items created), and last a
 *    ledger update that sets the rows to `"applied"`. Debits come before credits, so a request that stops part-way
 *    never creates value. A row still pending is exactly a move whose apply request did not finish, which
 *    reconciliation lists (4.7).
 *
 * A resumable move (every coin move) also carries what it takes to send its apply request again, for when its lock
 * request landed but the apply request never did (the tab closed, or the connection dropped or the answer never
 * came, between the two): the lock page of its first row holds the move (`move`: its rows, its apply request less
 * the settle, and the version of every item that request deletes or updates), and the apply request starts with
 * the move's apply mark, one more lock page, so it applies at most once whoever sends it, the move itself or a
 * resume (`resumeDecision`, `resumeApply`). The settle is left out of what the page holds because its ledger
 * change is written in key paths (`rows.<id>.state`), and Foundry expands a dotted key wherever it appears in flag
 * data it stores (`ObjectField#_cleanType`, Foundry 14.368 `common/data/fields.mjs`); it is made again from the rows.
 *
 * A close by hand or a GM's adjust leaves a move that a resume finishes alone; for one that needs a hand it takes the
 * same mark (with `hand` on its page), so of a late apply request, a close and an adjust exactly one gets past it.
 *
 * Descriptors: `{op: "lock", ids, move?, hand?}`, `{op: "ledger", change: {set, replace, del}}`, `{op: "deleteItems",
 * target, ids}`, `{op: "updateCoins", target, updates: [{id, quantity}]}`, `{op: "createCoins", target, coins:
 * [{denomination, quantity}], lot}`, `{op: "createItems", target, data}`. `target` is "strongbox" or an actor UUID.
 */
import { stampTime } from "./core.mjs";
import { hashId, idemKey } from "./ids.mjs";
import { PENDING_GRACE_MS } from "./reconcile.mjs";

/** A coin plan (`scripts/logic/coins.mjs`) as descriptors: deletes, then quantity updates, then new stacks. */
function coinOps(target, plan, lot) {
    return [
        { op: "deleteItems", target, ids: plan.deletes ?? [] },
        { op: "updateCoins", target, updates: plan.updates ?? [] },
        { op: "createCoins", target, coins: plan.creates ?? [], lot },
    ];
}

const nonEmpty = (descriptor) => {
    const payload = descriptor.ids ?? descriptor.updates ?? descriptor.coins ?? descriptor.data;
    return payload === undefined || payload.length > 0;
};

/** Whether a `{set, replace, del}` ledger change writes anything. */
const writesSomething = ({ set = {}, replace = {}, del = [] } = {}) =>
    Object.keys(set).length > 0 || Object.keys(replace).length > 0 || del.length > 0;

/**
 * The lock page id of a purse coin stack at one version (the time it last changed, `_stats.modifiedTime`). Two
 * moves planned from the same coins name the same page, so one of them loses at the lock instead of overwriting
 * the other's quantity; a move planned after the stack changed names a new page.
 */
export function stackLockId(id, version) {
    return hashId(idemKey("stack", id, String(version ?? 0)));
}

/**
 * The lock ids for the purse stacks a coin plan reduces, raises or deletes, at the versions it was planned from.
 * New stacks need none: two moves that both create one simply leave two stacks.
 * @param {{id: string, version?: number}[]} stacks  the purse's stacks the plan was made from
 * @param {{updates?: {id: string}[], deletes?: string[]}} plan
 */
export function purseLockIds(stacks, plan) {
    const versions = new Map(stacks.map((stack) => [stack.id, stack.version]));
    const ids = [...(plan.updates ?? []).map((update) => update.id), ...(plan.deletes ?? [])];
    return [...new Set(ids)].map((id) => stackLockId(id, versions.get(id)));
}

/**
 * The lock ids of a coin move: `ids` (its rows, and any purse stack locks), then every strongbox stack its debits
 * delete, without repeats.
 * @param {string[]} ids
 * @param {{target: string, plan: object}[]} debits
 */
export function lockIdsFor(ids, debits = []) {
    const stacks = debits.filter((d) => d.target === "strongbox").flatMap((d) => d.plan.deletes ?? []);
    return [...new Set([...ids, ...stacks])];
}

/** The version of a move's plan (`move.v`), for a later change to what a lock page holds. */
export const MOVE_VERSION = 1;

/**
 * The lock page id of a move's apply mark, from its first row: the first operation of its apply request, so the
 * server lets that request through once (keepId, as for every lock), whoever sends it.
 */
export function applyMarkId(rowId) {
    return hashId(idemKey("apply", rowId));
}

/**
 * The lock page id that re-creating a lost delivery takes (4.7), from its `delivered` row: the delivery's own lock
 * pages exist already, so the re-creation needs one of its own. A close of that row by hand, once it needs a hand,
 * takes it too, and so does the delivery's own apply request (As built in M4: the 5.11 follow-up "item delivered
 * twice"), so of a late apply request, a re-creation and a close exactly one lands.
 */
export function recreateLockId(rowId) {
    return hashId(idemKey("recreate", rowId));
}

/** The last operation of an apply request: the ledger update that sets the rows to "applied". */
function settleOf(rowIds) {
    return { op: "ledger", change: { set: Object.fromEntries(rowIds.map((id) => [`rows.${id}.state`, "applied"])) } };
}

/** The apply request of a resumable move, from what its lock page holds (`move`): as the move built it. */
export function resumeApply(move) {
    return [...move.apply, settleOf(move.rows)];
}

/**
 * The two requests of one lock-first move.
 *
 * @param {object} p
 * @param {string[]} [p.rowIds]   the rows the move writes (in `ledger.set` as `rows.<id>`), settled at the end
 * @param {string[]} [p.lockIds]  the ids its lock pages take; the row ids by default (callers add the stacks)
 * @param {object} [p.ledger]     `{set, replace, del}` key paths written with the lock
 * @param {{target: string, plan: object}[]} [p.debits]
 * @param {{target: string, plan: object}[]} [p.credits]
 * @param {{target: string, data: object[]}[]} [p.items]   items created, after the credits
 * @param {string} [p.lot]        the row id new strongbox stacks are flagged with (`flags.MOD.lot.row`)
 * @param {{touched: {target: string, id: string, version: number}[], actor: string|null}} [p.resume]  makes the move
 *        resumable: every item its apply request deletes or updates with the version it was planned from, and the
 *        purse it moves coins in or out of (an actor UUID; null for the strongbox alone). Needs rows.
 * @param {string|null} [p.mark]  a lock page id the apply request takes first, for a move that is not resumable but
 *        shares its apply with another path: a delivery's apply request and the re-creation of a lost delivery take
 *        the same page (`recreateLockId`), so only one of them ever creates the item (DESIGN.md 5.11, As built in M4)
 * @returns {{lock: object[], apply: object[]}}
 */
export function lockFirstBatch({ rowIds = [], lockIds = rowIds, ledger = {}, debits = [], credits = [], items = [], lot = null, resume = null, mark = null }) {
    const ids = [...new Set(lockIds)];
    if (!ids.length) throw new RangeError("a lock-first move takes at least one lock");
    if (resume && (!rowIds.length || ids[0] !== rowIds[0])) throw new RangeError("a resumable move locks its rows first");
    if (resume && mark) throw new RangeError("a resumable move's mark is its apply mark");
    const settle = settleOf(rowIds);
    const apply = [
        ...(resume ? [{ op: "lock", ids: [applyMarkId(rowIds[0])] }] : mark ? [{ op: "lock", ids: [mark] }] : []),
        ...debits.flatMap((d) => coinOps(d.target, d.plan, d.target === "strongbox" ? lot : null)),
        ...credits.flatMap((c) => coinOps(c.target, c.plan, c.target === "strongbox" ? lot : null)),
        ...items.map((i) => ({ op: "createItems", target: i.target, data: i.data })),
        ...(rowIds.length ? [settle] : []),
    ].filter(nonEmpty);
    const move = resume ? { v: MOVE_VERSION, rows: [...rowIds], apply: apply.slice(0, -1), touched: resume.touched ?? [], actor: resume.actor ?? null } : null;
    return {
        lock: [{ op: "lock", ids, ...(move ? { move } : {}) }, ...(writesSomething(ledger) ? [{ op: "ledger", change: ledger }] : [])],
        apply,
    };
}

/**
 * Whether a resumable move whose lock request landed should have its apply request sent again, judged from this
 * client's copies (DESIGN.md 5.4, As built: Resume).
 *
 * - "none": nothing to send: its rows are applied or gone; its apply mark exists, so its apply request reached the
 *   server (whatever of it applied, its author or a GM checks by hand); or a `stopped` note says it was sent and
 *   answered (refused or stopped part-way), which is the manual path too.
 * - "wait": its rows are younger than `PENDING_GRACE_MS`, so the move may still be in flight; `dueInMs` says when to
 *   look again.
 * - "manual": an item its apply request deletes or updates is gone or has changed since the move was planned
 *   (`touched`, by `_stats.modifiedTime`), so the request no longer says the right thing; its author or a GM closes
 *   the row by hand.
 * - "resume": send its apply request (`move.apply`) now. Its mark keeps a second sender, or the move itself
 *   answering late, from applying it twice.
 *
 * @param {object} p
 * @param {{rows: string[], touched: {target: string, id: string, version: number}[]}} p.move  the plan its lock page holds
 * @param {(object|undefined)[]} p.rows  its ledger rows, in `move.rows` order
 * @param {boolean} p.marked   whether its apply mark page exists
 * @param {(target: string, id: string) => number|null} p.versionOf  an item's version now, or null if it is gone
 * @param {number} p.now       the moment on the server's clock (`serverNow`), compared with the rows' `stampTime`
 * @returns {{action: "none"|"wait"|"manual"|"resume", dueInMs?: number}}
 */
export function resumeDecision({ move, rows, marked, versionOf, now }) {
    if (marked || !rows.length || rows.some((row) => row?.state !== "pending" || row.stopped)) return { action: "none" };
    const age = now - stampTime(rows[0].at);
    if (age < PENDING_GRACE_MS) return { action: "wait", dueInMs: PENDING_GRACE_MS - age };
    if (move.touched.some(({ target, id, version }) => versionOf(target, id) !== version)) return { action: "manual" };
    return { action: "resume" };
}
