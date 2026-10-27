/**
 * Keeping the ledger small (DESIGN.md 5.3.3, 5.4; As built in M12b): the pruning of spent lock pages and the archive runs that
 * move old closed records into the Crafting Log. Both are timer-driven shared writes, so only the elected client does them
 * (P4, 5.6: the active GM, else the lowest-id connected user, on the tab holding its user's lease).
 *
 * - Pruning needs no GM. Every lock page says what it guards (`lock.kind`, `scripts/logic/locks.mjs`); a page is deleted once it
 *   is older than `PRUNE_AGE_MS` and what it guards says the same thing on every client, and never while a move it belongs to
 *   is pending or resumable, nor a stack lock while the stack is still at the version a move planned from.
 * - Archiving waits for a GM: the Crafting Log is GM-owned (players read it), so only a GM writes it. The plan is pure
 *   (`planArchive`, `scripts/logic/archive.mjs`); the run is one request: its lock pages (the run's slot, the next log slot of
 *   every order and job it moves, the reversal row id of every fund row it moves that could still be reversed), the log's
 *   pages (the run's own page first, which is never pruned), then the ledger update that writes the carry rows and deletes what
 *   moved.
 *   The lock pages of the rows that moved are pruned right after, in a request of their own: a page some other client pruned
 *   meanwhile would make the server refuse the whole run at its dry run.
 *
 * When: a pass at most once a minute (`MIN_INTERVAL_MS`), as the last step of the catch-up sweep, every five minutes while this
 * tab is elected, and soon after a lock page takes the ledger past `LOCK_PAGE_BOUND`.
 */
import { MODULE_ID } from "../constants.mjs";
import {
    ARCHIVE_THRESHOLDS, ARCHIVED, archivePageData, archivePageId, archivePageUpdate, archiveRunAttempt, archiveRunPageData, archivedRecords, planArchive,
} from "../logic/archive.mjs";
import { stampTime } from "../logic/core.mjs";
import { clockDayOf } from "../logic/downtime.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { LOCK_PAGE_BOUND, PRUNE_AGE_MS, prunablePages } from "../logic/locks.mjs";
import { runRequest } from "./batch.mjs";
import { itemVersion } from "./coins.mjs";
import { dayOffset, secondsPerDay, today } from "./downtime.mjs";
import { isElected } from "./responsible.mjs";
import { locateArchive } from "./shared-docs.mjs";
import { canWrite, shared } from "./state.mjs";
import { read, records, serverNow, stampNow } from "./store.mjs";

/** The most lock pages one request deletes. */
export const PRUNE_CHUNK = 500;
/** The shortest time between two passes on one client, unless forced. */
export const MIN_INTERVAL_MS = 60 * 1000;
/** How often an elected client looks, with nothing else to set it off. */
export const HOUSEKEEPING_EVERY_MS = 5 * 60 * 1000;

const refuse = (reason, data = {}) => ({ ok: false, reason, ...data });

/* -------------------------------------------- */
/*  Pruning lock pages                           */
/* -------------------------------------------- */

/** A ledger page as `pruneVerdict` reads it: its id and its module flags. */
const pageFacts = (page) => ({ id: page.id, ...(page.flags?.[MODULE_ID] ?? {}) });

/** What the live data says, from this client's copies, for `pruneVerdict`. */
function pruneContext({ now, ageMs }) {
    const rowList = records("rows");
    const marks = new Map();
    // Hashed directly, not through `lockKeyId`: these ids are looked up, never locked, and must not crowd out the keys of locks
    // this client is about to take.
    for (const row of rowList) {
        marks.set(hashId(idemKey("apply", row.id)), row.id);
        marks.set(hashId(idemKey("recreate", row.id)), row.id);
    }
    const items = new Map();
    const coatings = new Set();
    for (const actor of game.actors ?? []) {
        for (const item of actor.items ?? []) {
            items.set(item.id, itemVersion(item));
            const coating = item.flags?.[MODULE_ID]?.coating;
            if (coating?.id) coatings.add(coating.id);
        }
    }
    const cycles = new Map();
    for (const [id, status] of Object.entries(read("pcs") ?? {})) if (Number.isInteger(status?.prepCycle)) cycles.set(id, status.prepCycle);
    return {
        now, ageMs, rows: new Map(rowList.map((row) => [row.id, row])), claims: new Map(records("claims").map((c) => [c.id, c])), marks,
        boxItems: new Set(shared().strongbox?.items?.keys?.() ?? []), items, coatings, cycles,
        orders: new Set(records("orders").map((order) => order.id)), migrating: !!read("meta.migration"),
    };
}

/**
 * Delete the ledger's spent lock pages (5.4, As built in M12b), in requests of `PRUNE_CHUNK`. Any client that may write can do
 * it (no GM needed); the scheduler leaves it to the elected one.
 * @param {{now?: number, ageMs?: number}} [options]  `now` on the server's clock; `ageMs` the age a page must reach
 * @returns {Promise<{ok: boolean, pruned: number, pages: number, kept: object, reason?: string}>}
 */
export async function pruneLocks({ now = serverNow(), ageMs = PRUNE_AGE_MS } = {}) {
    if (!canWrite()) return { ...refuse("not-ready"), pruned: 0, pages: 0, kept: {} };
    const ledger = shared().ledger;
    const pages = ledger.pages.map(pageFacts);
    const { ids, kept } = prunablePages(pages, pruneContext({ now, ageMs }));
    let pruned = 0;
    for (let i = 0; i < ids.length; i += PRUNE_CHUNK) {
        const chunk = ids.slice(i, i + PRUNE_CHUNK).filter((id) => ledger.pages.has(id));
        if (!chunk.length) continue;
        const result = await runRequest([{ op: "deletePages", ids: chunk }]);
        if (result.outcome !== "ok") {
            console.warn(`${MODULE_ID} | lock pages not pruned (${result.reason ?? result.outcome}); the next pass tries again`);
            break;
        }
        pruned += chunk.length;
    }
    return { ok: true, pruned, pages: pages.length, kept };
}

/* -------------------------------------------- */
/*  Archive runs                                 */
/* -------------------------------------------- */

/** Orders whose items are still in the strongbox: on the pickup shelf or earmarked for them. Not archived until they leave. */
function heldOrders(strongbox) {
    const held = new Set();
    for (const item of strongbox?.items ?? []) {
        const flags = item.flags?.[MODULE_ID] ?? {};
        for (const order of [flags.shelf?.order, flags.earmark?.order]) if (typeof order === "string") held.add(order);
    }
    return held;
}

/** Days per world year of the world's calendar (5.3.3: one archive page per world year). */
function daysPerYear() {
    const days = game.time.calendar?.days;
    const n = days?.daysPerYear ?? days?.values?.length ?? null;
    return Number.isInteger(n) && n > 0 ? n : 365;
}

/**
 * One archive run (5.3.3, As built in M12b), on a GM's client. Refused: `not-ready`, `not-gm`, `no-log` (the Crafting Log does
 * not exist yet: the active GM creates it at its next check); `taken` (another run, or a transition of an order or a job it
 * would move, landed first: nothing was written), or a batch failure.
 * @param {{now?: number, today?: number, thresholds?: object, limit?: number}} [options]  `now` on the server's clock; `today`
 *        the workshop day
 * @returns {Promise<{ok: boolean, outcome?: "ok"|"nothing", counts?: object, more?: boolean, pruned?: number, reason?: string}>}
 */
export async function archiveRun({ now = serverNow(), today: day = null, thresholds = ARCHIVE_THRESHOLDS, limit } = {}) {
    if (!canWrite()) return refuse("not-ready");
    if (!game.user.isGM) return refuse("not-gm");
    const log = locateArchive();
    if (!log) return refuse("no-log");
    const { ledger, strongbox } = shared();
    const spd = secondsPerDay();
    const offset = dayOffset();
    const dayOf = (at) => (Number.isFinite(at?.world) ? clockDayOf(at.world, { secondsPerDay: spd, offset }) : null);
    const stamp = stampNow();
    const plan = planArchive({ flags: ledger.flags?.[MODULE_ID] ?? {}, today: day ?? today().day, now, dayOf, held: heldOrders(strongbox), stamp,
        thresholds, daysPerYear: daysPerYear(), ...(limit ? { limit } : {}) });
    if (plan.empty) return { ok: true, outcome: "nothing", counts: plan.counts };
    // The run's own page first: it exists for good once the run's request has landed, so the same run planned again from a
    // copy that missed it is refused at the server's dry run, long after its slot in the ledger is pruned.
    const attempt = archiveRunAttempt(plan.runs, (id) => log.pages.has(id));
    const creates = [archiveRunPageData(plan.runs, attempt, { name: game.i18n.format("pf2e-artisans-workshop.Archive.RunPageName", { run: String(plan.runs + 1) }),
        counts: plan.counts, stamp })];
    const updates = [];
    for (const [year, records] of plan.years) {
        if (log.pages.has(archivePageId(year))) updates.push(archivePageUpdate(year, records, { stamp }));
        else creates.push(archivePageData(year, records, { name: game.i18n.format("pf2e-artisans-workshop.Archive.PageName", { year: String(year + 1) }), stamp }));
    }
    const result = await runRequest([
        { op: "lock", ids: plan.locks, keys: plan.keys },
        { op: "createPages", target: "archive", data: creates },
        ...(updates.length ? [{ op: "updatePages", target: "archive", updates }] : []),
        { op: "ledger", change: plan.change },
    ], { ...shared(), archive: log });
    if (result.outcome === "refused") return refuse("taken");
    if (result.outcome !== "ok") {
        console.warn(`${MODULE_ID} | an archive run stopped (${result.reason ?? result.outcome}); the next run repeats it once its slot is pruned`);
        return refuse(result.reason ?? result.outcome);
    }
    // The lock pages of what moved, past the prune age: the rows are gone, so no move can need them (5.4).
    const old = (id) => {
        const at = ledger.pages.get(id)?.flags?.[MODULE_ID]?.lock?.at;
        return !!at && now - stampTime(at) >= PRUNE_AGE_MS;
    };
    const spent = plan.lockPages.filter((id) => ledger.pages.has(id) && old(id));
    let pruned = 0;
    for (let i = 0; i < spent.length; i += PRUNE_CHUNK) {
        const chunk = spent.slice(i, i + PRUNE_CHUNK).filter((id) => ledger.pages.has(id));
        if (chunk.length && (await runRequest([{ op: "deletePages", ids: chunk }])).outcome === "ok") pruned += chunk.length;
    }
    return { ok: true, outcome: "ok", counts: plan.counts, more: plan.more, pruned };
}

/**
 * The Crafting Log's archived records of `collection`, newest first (5.3.3: the Funds tab's history). Every player can read
 * them; nothing writes them but an archive run.
 */
export function archived(collection) {
    if (!ARCHIVED.includes(collection)) throw new RangeError(`${collection} is not archived`);
    const log = locateArchive();
    if (!log) return [];
    return archivedRecords(log.pages.map((page) => page.flags?.[MODULE_ID] ?? {}), collection);
}

/* -------------------------------------------- */
/*  When                                         */
/* -------------------------------------------- */

let lastPass = 0;
let paused = false;
let passing = null;
let soon = null;
let timer = null;

/**
 * One housekeeping pass on this client, if it is the elected one (P4): prune, then, on a GM's client, archive. At most once per
 * `MIN_INTERVAL_MS` unless `force`. A run that left more to archive comes back in a moment.
 * @param {{force?: boolean, now?: number, today?: number, thresholds?: object}} [options]  `now`, `today` and `thresholds` for
 *        the performance pass and tests (DESIGN.md 15.7)
 * @returns {Promise<{ran: boolean, reason?: string, prune?: object, archive?: object}>}
 */
export async function housekeeping({ force = false, now = undefined, today: day = undefined, thresholds = undefined } = {}) {
    if (!canWrite() || !isElected()) return { ran: false, reason: "not-elected" };
    if (paused && !force) return { ran: false, reason: "paused" };
    if (passing) return passing;
    if (!force && Date.now() - lastPass < MIN_INTERVAL_MS) return { ran: false, reason: "recent" };
    lastPass = Date.now();
    passing = (async () => {
        const prune = await pruneLocks({ now });
        const archive = game.user.isGM ? await archiveRun({ now, today: day, thresholds }) : null;
        if (archive?.ok && archive.more) scheduleHousekeeping(2000, true);
        return { ran: true, prune, archive };
    })().catch((error) => {
        console.error(`${MODULE_ID} | housekeeping failed`, error);
        return { ran: false, reason: "error" };
    }).finally(() => { passing = null; });
    return passing;
}

/** A pass in `ms`, unless one is due sooner. */
export function scheduleHousekeeping(ms = 5000, force = false) {
    if (soon) return;
    soon = setTimeout(() => {
        soon = null;
        housekeeping({ force }).catch(() => {});
    }, ms);
}

/**
 * The hooks and the timer, at `ready`: a lock page that takes the ledger past `LOCK_PAGE_BOUND` brings a pass forward; every
 * `HOUSEKEEPING_EVERY_MS` the elected client looks.
 */
export function registerHousekeeping() {
    Hooks.on("createJournalEntryPage", (page) => {
        const ledger = shared().ledger;
        if (page.parent === ledger && ledger.pages.size > LOCK_PAGE_BOUND && isElected()) scheduleHousekeeping();
    });
    clearInterval(timer);
    timer = setInterval(() => { housekeeping().catch(() => {}); }, HOUSEKEEPING_EVERY_MS);
    timer?.unref?.();   // in Node (the tests) the timer must not keep the process alive; a browser's is a number
}

/**
 * Hold this client's automatic passes (a forced one still runs): the performance pass (15.7) measures a stage as it was staged,
 * then archives it on purpose.
 */
export function pauseHousekeeping(value = true) {
    paused = !!value;
}

/** For tests only. */
export function resetHousekeeping() {
    lastPass = 0;
    paused = false;
    passing = null;
    clearTimeout(soon);
    soon = null;
    clearInterval(timer);
    timer = null;
}
