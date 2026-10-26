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
 * Descriptors: `{op: "lock", ids}`, `{op: "ledger", change: {set, replace, del}}`, `{op: "deleteItems", target,
 * ids}`, `{op: "updateCoins", target, updates: [{id, quantity}]}`, `{op: "createCoins", target, coins:
 * [{denomination, quantity}], lot}`, `{op: "createItems", target, data}`. `target` is "strongbox" or an actor UUID.
 */
import { hashId, idemKey } from "./ids.mjs";

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
 * @returns {{lock: object[], apply: object[]}}
 */
export function lockFirstBatch({ rowIds = [], lockIds = rowIds, ledger = {}, debits = [], credits = [], items = [], lot = null }) {
    const ids = [...new Set(lockIds)];
    if (!ids.length) throw new RangeError("a lock-first move takes at least one lock");
    const settle = { op: "ledger", change: { set: Object.fromEntries(rowIds.map((id) => [`rows.${id}.state`, "applied"])) } };
    return {
        lock: [{ op: "lock", ids }, ...(writesSomething(ledger) ? [{ op: "ledger", change: ledger }] : [])],
        apply: [
            ...debits.flatMap((d) => coinOps(d.target, d.plan, d.target === "strongbox" ? lot : null)),
            ...credits.flatMap((c) => coinOps(c.target, c.plan, c.target === "strongbox" ? lot : null)),
            ...items.map((i) => ({ op: "createItems", target: i.target, data: i.data })),
            ...(rowIds.length ? [settle] : []),
        ].filter(nonEmpty),
    };
}
