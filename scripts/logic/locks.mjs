/**
 * What a lock page guards, and when it may go (DESIGN.md 5.4, As built in M12b: lock kinds and pruning). Pure.
 *
 * A lock page's existence is the lock (5.1): the server refuses a page whose id exists, so of two requests that name the
 * same page only the first lands. The ids are hashes, so until M12b nothing could tell a spent stack lock from a marker
 * that must stay, and nothing removed any: every write on the ledger paid for every page ever taken (15.7, OQ-36). Every
 * page now says what it guards, in its `lock` stamp:
 *
 * - `kind: "row"`: the id is a ledger row's (the rows a move writes; a claim's row shares its claim's id);
 * - `kind: "claim"`: the id is a claim's (a formula claim, an exposure's save);
 * - `kind: "item"`: the id is a strongbox item's (a coin stack a move spends, a shelf item a delivery takes);
 * - otherwise `kind` is the first segment of the idempotency key the id hashes, and `key` that key: `stack`, `apply`,
 *   `recreate`, `log`, `fund-slot`, `prep` and the rest (`lockKeyId`, `LOCK_RULES`).
 *
 * A page may be pruned (`pruneVerdict`) only once it is older than `PRUNE_AGE_MS` on the server's clock, far past the
 * longest a request can be under way (`ANSWER_LIMIT_MS`, then the client goes stale), and only once what it guards says on
 * every client the same thing the page said: the row is applied (the fast path then stops a second move by the row
 * itself), the stack has moved on, the counter the slot was named after has moved past it, the cycle is over, the
 * coating, the tracker or the order is gone. A page of an unknown kind, or an old page whose kind cannot be worked out, is
 * kept. A page of a move whose rows are pending is never pruned, nor its apply mark or its stack locks while the stacks
 * are still at the version the move planned from: the resume (5.4, As built: Resume) and the close by hand need them.
 */
import { stampTime } from "./core.mjs";
import { hashId, idemKey } from "./ids.mjs";

/**
 * How old a lock page must be, on the server's clock, before it may be pruned: three times the longest a client waits for
 * an answer (`ANSWER_LIMIT_MS`, 5 minutes, after which it goes stale), so no request planned while the page mattered can
 * still be on its way.
 */
export const PRUNE_AGE_MS = 15 * 60 * 1000;

/**
 * The soft bound on the ledger's lock pages (OQ-36): past it, a prune pass runs as soon as it may instead of at its next
 * turn. Pages younger than `PRUNE_AGE_MS` and pages that still guard something stay whatever the count.
 */
export const LOCK_PAGE_BOUND = 300;

const KEYS = new Map();
const KEYS_LIMIT = 4096;

/**
 * The lock page id of an idempotency key: its hash, as before, remembered with its key for a moment so the page this client
 * creates for it can say what it guards (`lockTag`). Every lock-id factory goes through here.
 */
export function lockKeyId(key) {
    const id = hashId(key);
    KEYS.delete(id);
    KEYS.set(id, key);
    if (KEYS.size > KEYS_LIMIT) KEYS.delete(KEYS.keys().next().value);
    return id;
}

/** `lockKeyId` of the key `idemKey` makes of `parts`. */
export const lockIdOf = (...parts) => lockKeyId(idemKey(...parts));

/** The key a lock id was made from on this client, or null. */
export const lockKeyOf = (id) => KEYS.get(id) ?? null;

/** For tests only. */
export function forgetLockKeys() {
    KEYS.clear();
}

/**
 * What a new lock page says it guards (its `lock.kind` and `lock.key`), from the request that creates it: an id given a key
 * (`keys`), else a row or a claim the same request writes, else a strongbox item, else a key this client made the id of.
 * `{kind: null}` when none applies: kept by the pruner.
 * @param {string} id
 * @param {{keys?: object, rowIds?: Set<string>, claimIds?: Set<string>, boxItemIds?: Set<string>}} context
 * @returns {{kind: string|null, key?: string}}
 */
export function lockTag(id, { keys = {}, rowIds = new Set(), claimIds = new Set(), boxItemIds = new Set() } = {}) {
    const key = keys[id] ?? null;
    if (key) return { kind: kindOfKey(key), key };
    if (rowIds.has(id)) return { kind: "row" };
    if (claimIds.has(id)) return { kind: "claim" };
    if (boxItemIds.has(id)) return { kind: "item" };
    const known = lockKeyOf(id);
    return known ? { kind: kindOfKey(known), key: known } : { kind: null };
}

/** The kind of a key: its first segment. */
export const kindOfKey = (key) => String(key).split(":")[0];

/**
 * How each keyed kind is pruned once old (`pruneVerdict`). Unknown kinds are kept.
 * - "age": a race guard on a counter or a moment that only moves forward (a log slot, a fund slot, a PC's days from a day,
 *   a gathering at one world time, a cycle raised from a number); once old, the live data names the next slot.
 * - "row": an apply mark or a re-creation lock: kept while its row is pending.
 * - "stack": a purse stack at one version: kept while the stack is still at that version (a move stopped on it).
 * - "cycle": a cycle's preparations or standing deliveries: kept while that cycle is the character's current one.
 * - "coating": spent-coating marker: kept while the coating exists (its existence is the coating's spent state).
 * - "tracker": an affliction save: kept while the tracker item exists.
 * - "order": an order's once-marker (its assembly, its sub-day setup): kept while the order is in the ledger.
 * - "migration": kept while a migration is under way.
 */
export const LOCK_RULES = Object.freeze({
    log: "age", "job-log": "age", "fund-slot": "age", "fund-return-slot": "age", "garden-slot": "age", days: "age",
    gather: "age", cycle: "age", archive: "age", "give-back": "age", service: "age",
    apply: "row", recreate: "row",
    stack: "stack",
    prep: "cycle", standing: "cycle",
    coating: "coating",
    afflict: "tracker",
    assemble: "order", "setup-hours": "order",
    migration: "migration",
});

/**
 * Whether a lock page may be deleted now, and why (DESIGN.md 5.4, As built in M12b).
 *
 * @param {{id: string, lock?: object, move?: object, hand?: object}} page  the page's id and its module flags
 * @param {object} ctx  what the live data says, from one client's copies:
 * @param {number} ctx.now                     the moment on the server's clock (`serverNow`)
 * @param {Map<string, object>} ctx.rows       live rows by id
 * @param {Map<string, object>} [ctx.claims]   live claims by id
 * @param {Map<string, string>} [ctx.marks]    the apply mark and re-creation lock ids of every live row, to its row id (for
 *        pages written before kinds)
 * @param {Set<string>} [ctx.boxItems]         the strongbox's item ids
 * @param {Map<string, number>} [ctx.items]    every actor's item ids, to their version (`_stats.modifiedTime`)
 * @param {Set<string>} [ctx.coatings]         ids of the coatings items carry
 * @param {Map<string, number>} [ctx.cycles]   each PC's preparation cycle (`pcs.<actorId>.prepCycle`)
 * @param {Set<string>} [ctx.orders]           live order ids
 * @param {boolean} [ctx.migrating]            whether `meta.migration` is set
 * @param {number} [ctx.ageMs]                 the age a page must reach (PRUNE_AGE_MS)
 * @returns {{prune: boolean, reason: string}}
 */
export function pruneVerdict(page, ctx) {
    const lock = page.lock ?? null;
    const keep = (reason) => ({ prune: false, reason });
    const prune = (reason) => ({ prune: true, reason });
    if (!lock?.at) return keep("unstamped");
    if (ctx.now - stampTime(lock.at) < (ctx.ageMs ?? PRUNE_AGE_MS)) return keep("young");
    const rows = ctx.rows ?? new Map();
    const pending = (id) => rows.get(id)?.state === "pending";
    const claimOpen = (id) => {
        const claim = ctx.claims?.get(id);
        return !!claim && (!claim.resolved || (claim.kind === "formula" && !claim.applied));
    };
    // A strongbox item still there is locked by a move that stopped part-way (or is in flight): reconciliation lists it.
    if (ctx.boxItems?.has(page.id)) return keep("item-there");
    if (page.move) return page.move.rows?.some(pending) ? keep("move-pending") : prune("move-done");
    if (lock.to !== undefined && !lock.kind) return ctx.migrating ? keep("migrating") : prune("migrated");
    let kind = lock.kind ?? null;
    let key = lock.key ?? null;
    if (!kind) {
        // Written before kinds: what the live data can still say about it.
        if (rows.has(page.id)) kind = "row";
        else if (ctx.claims?.has(page.id)) kind = "claim";
        else if (ctx.marks?.has(page.id)) {
            kind = "apply";
            key = idemKey("apply", ctx.marks.get(page.id));
        } else return keep("unknown");
    }
    if (kind === "row") return pending(page.id) || claimOpen(page.id) ? keep("row-pending") : prune("row-done");
    if (kind === "claim") return claimOpen(page.id) || pending(page.id) ? keep("claim-open") : prune("claim-done");
    if (kind === "item") return prune("item-gone");
    const parts = String(key ?? "").split(":");
    switch (LOCK_RULES[kind]) {
        case "age": return prune("spent");
        case "row": return pending(parts[1]) ? keep("row-pending") : prune("row-done");
        case "stack": {
            const version = ctx.items?.get(parts[1]);
            return version !== undefined && String(version) === parts[2] ? keep("stack-held") : prune("stack-moved");
        }
        case "cycle": {
            const [actorId, cycle] = kind === "prep" ? [parts[1], Number(parts[2])] : [parts[2], Number(parts[3])];
            return (ctx.cycles?.get(actorId) ?? 0) <= cycle ? keep("cycle-current") : prune("cycle-over");
        }
        case "coating": return ctx.coatings?.has(parts[1]) ? keep("coating-there") : prune("coating-gone");
        case "tracker": return ctx.items?.has(parts[1]) ? keep("tracker-there") : prune("tracker-gone");
        case "order": return ctx.orders?.has(parts[1]) ? keep("order-live") : prune("order-gone");
        case "migration": return ctx.migrating ? keep("migrating") : prune("migrated");
        default: return keep("unknown-kind");
    }
}

/**
 * The ids of the pages `pruneVerdict` lets go, oldest first, and how many stay for each reason.
 * @param {{id: string, lock?: object, move?: object, hand?: object}[]} pages
 * @returns {{ids: string[], kept: Record<string, number>}}
 */
export function prunablePages(pages, ctx) {
    const ids = [];
    const kept = {};
    const sorted = [...pages].sort((a, b) => stampTime(a.lock?.at ?? {}) - stampTime(b.lock?.at ?? {}));
    for (const page of sorted) {
        const verdict = pruneVerdict(page, ctx);
        if (verdict.prune) ids.push(page.id);
        else kept[verdict.reason] = (kept[verdict.reason] ?? 0) + 1;
    }
    return { ids, kept };
}
