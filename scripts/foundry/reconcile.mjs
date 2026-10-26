/**
 * Reconciliation on this client (DESIGN.md 4.7, 5.4): the report the Funds tab (M4) shows, the author's notice
 * about their own rows that did not finish, and a GM's `adjust` row for a difference.
 */
import { MODULE_ID } from "../constants.mjs";
import { adjustNonce, adjustRowInput, reconcile } from "../logic/reconcile.mjs";
import { coinStacks } from "./coins.mjs";
import { postRows } from "./money.mjs";
import { shared } from "./state.mjs";
import { records } from "./store.mjs";

/**
 * Expected and actual strongbox coins, the rows still pending (`stalled`: past the grace time), and the strongbox
 * stacks a move locked but did not spend (`lockedStacks`).
 */
export function reconciliationReport() {
    const { ledger, strongbox } = shared();
    const lockedIds = new Set(ledger?.pages.keys() ?? []);
    return reconcile({ rows: records("rows"), stacks: strongbox ? coinStacks(strongbox) : [], now: game.time.serverTime, lockedIds });
}

const reported = new Set();

/** Tell this user, once per session, about their own rows whose move stopped part-way. */
export function reportOwnPending() {
    const mine = reconciliationReport().stalled.filter((row) => row.author === game.user.id && !reported.has(row.id));
    if (!mine.length) return 0;
    for (const row of mine) reported.add(row.id);
    console.table(mine.map(({ id, kind, cp, idem, stopped }) => ({ id, kind, cp, idem, stopped: JSON.stringify(stopped ?? null) })));
    ui.notifications.warn("pf2e-artisans-workshop.Sync.PendingRows", { format: { count: String(mine.length) } });
    return mine.length;
}

/**
 * A GM books the difference between actual and expected coins as an `adjust` row (4.7). Its key comes from the
 * state it corrects (`adjustNonce`), so a second booking of the same difference, by another GM or a double
 * click, is the same row.
 */
export async function bookAdjustment(note = null) {
    if (!game.user.isGM) throw new Error(`${MODULE_ID} | only a GM books adjustments`);
    const report = reconciliationReport();
    if (report.differenceCp === 0) return { ok: true, outcome: "balanced" };
    return postRows([adjustRowInput(report.differenceCp, adjustNonce(report, records("rows")), note)]);
}
