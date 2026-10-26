/**
 * Reconciliation on this client (DESIGN.md 4.7, 5.4): the report the Funds tab (M4) shows, the author's notice
 * about their own rows that did not finish, and a GM's `adjust` row for a difference.
 */
import { MODULE_ID } from "../constants.mjs";
import { adjustNonce, adjustRowInput, pendingDueInMs, reconcile } from "../logic/reconcile.mjs";
import { coinStacks } from "./coins.mjs";
import { withCoinMutex } from "./lease.mjs";
import { pendingPaths, postRows } from "./money.mjs";
import { canWrite, shared } from "./state.mjs";
import { records, serverNow } from "./store.mjs";

/** The report over this client's copies, with the pending rows' automatic paths (`pendingPaths`). */
function report(paths) {
    const { ledger, strongbox } = shared();
    const lockedIds = new Set(ledger?.pages.keys() ?? []);
    return reconcile({ rows: records("rows"), stacks: strongbox ? coinStacks(strongbox) : [], now: serverNow(), lockedIds, paths });
}

/**
 * Expected and actual strongbox coins, the rows still pending (`stalled`: those past the grace time), which of them a
 * request may be applying now (`inFlight`), which the module finishes by itself (`resumable`) and which need their
 * author or a GM (`needsHand`); and the strongbox stacks a move locked but did not spend (`lockedStacks`).
 */
export function reconciliationReport() {
    return report(pendingPaths());
}

const reported = new Set();

/**
 * Tell this user, once per session, about their own rows that need a hand: a move that stopped part-way, not one
 * the module resumes, nor one a request (perhaps another client's resume) may be applying right now. A row left out
 * for now because it is in flight changes state with time alone, which nothing else may set off, so this
 * says when to look again (`dueInMs`, the earliest of `pendingDueInMs` over this user's rows): the sweep comes back
 * then (`sync.mjs`).
 * @returns {{reported: number, dueInMs: number|null}}
 */
export function reportOwnPending() {
    const paths = pendingPaths();
    const current = report(paths);
    const own = (row) => row.author === game.user.id && !reported.has(row.id);
    const now = serverNow();
    const dues = current.pending.filter(own).map((row) => pendingDueInMs(row, { now, ...paths.get(row.id) })).filter((ms) => ms !== null);
    const dueInMs = dues.length ? Math.min(...dues) : null;
    const mine = current.needsHand.filter(own);
    if (!mine.length) return { reported: 0, dueInMs };
    for (const row of mine) reported.add(row.id);
    console.table(mine.map(({ id, kind, cp, idem, stopped }) => ({ id, kind, cp, idem, stopped: JSON.stringify(stopped ?? null) })));
    ui.notifications.warn("pf2e-artisans-workshop.Sync.PendingRows", { format: { count: String(mine.length) } });
    return { reported: mine.length, dueInMs };
}

/**
 * A GM books the difference between actual and expected coins as an `adjust` row (4.7). Its key comes from the
 * state it corrects (`adjustNonce`), so a second booking of the same difference, by another GM or a double
 * click, is the same row.
 *
 * It acts only on pending rows that need a hand (`pendingState`). Rows in flight or resumable are still owed by their
 * own move, which may land or will be resumed: their coins are left out of the difference (`owedBoxCp`) and their
 * marks alone, so once the move lands the coins and the rows agree. When that leaves nothing to book, the booking is
 * refused ("in-flight" while any such row that changes the strongbox is in flight, else "resumable"). The coins of
 * rows that need a hand count, and for each one that changes the strongbox (`box` not 0) the apply mark of its move is
 * taken in the same request as the row if nobody has taken it (`postRows` with `marks`), since a late apply request
 * could still land there: that request either lands first and the booking is refused ("taken": look again), or never
 * lands. Those rows stay pending, for their author or a GM to close. Runs in the coin mutex, so it waits for this
 * client's own move or resume under way and judges the rows as it left them.
 * @returns {Promise<{ok: boolean, outcome?: string, reason?: string, rows?: object[]}>}  reasons "not-ready",
 *          "in-flight", "resumable", "taken", or a batch failure
 */
export async function bookAdjustment(note = null) {
    if (!game.user.isGM) throw new Error(`${MODULE_ID} | only a GM books adjustments`);
    return withCoinMutex(game.user.id, async () => {
        if (!canWrite()) return { ok: false, reason: "not-ready" };
        const paths = pendingPaths();
        const current = report(paths);
        const boxed = (rows) => rows.filter((row) => (row.box ?? 0) !== 0);
        // A strongbox move in flight that holds its apply mark may have landed in part: what it still owes is unknown.
        if (boxed(current.inFlight).some((row) => paths.get(row.id)?.mark)) return { ok: false, reason: "in-flight" };
        const differenceCp = current.differenceCp + current.owedBoxCp;
        if (differenceCp === 0) {
            if (current.differenceCp === 0) return { ok: true, outcome: "balanced" };
            return { ok: false, reason: boxed(current.inFlight).length ? "in-flight" : "resumable" };
        }
        const marks = [...new Set(boxed(current.needsHand).map((row) => paths.get(row.id)).filter((path) => path && !path.mark).map((path) => path.markId))];
        return postRows([adjustRowInput(differenceCp, adjustNonce(current, records("rows")), note)], {}, { marks });
    });
}
