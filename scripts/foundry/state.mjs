/**
 * Where this client stands with the shared documents (DESIGN.md 5.2, 4.14, 5.4): which ledger and strongbox it
 * uses, and whether it may write to them.
 *
 * Status, in the order the sync checks them:
 * - "disabled": the master switch is off; the module writes nothing (P10).
 * - "missing": a shared document is missing or not owned by every player (a GM needs to log in once), or a GM
 *   gave this user less than OWNER on one (this user only reads).
 * - "newer": a document was written by a newer schema; read-only until the module is updated.
 * - "migrating": another client is migrating; wait and re-read.
 * - "ready": reads and writes are allowed.
 * On top of these, "stale": this client processed the dry-run results of a request the server refused, which
 * created or deleted documents on this client only (5.4, As built in M2), or it never heard back about one; its
 * copies may differ from the server's, so it stops writing until reloaded. A lost lock does not do this: the lock
 * request's only other operation is an update, which a dry run does not commit.
 */
import { MODULE_ID } from "../constants.mjs";

let current = { ledger: null, strongbox: null, status: "disabled" };
let stale = false;

/** The shared documents in use, or null. */
export function shared() {
    return { ledger: current.ledger, strongbox: current.strongbox };
}

/** This client's status. */
export function status() {
    return stale ? "stale" : current.status;
}

/** Whether this client may write to the shared documents. */
export function canWrite() {
    return status() === "ready";
}

/** Record the outcome of locating and checking the shared documents. */
export function setShared({ ledger = null, strongbox = null, status: next }) {
    current = { ledger, strongbox, status: next };
}

/** Stop writing until this client reloads, and say so once. */
export function markStale() {
    if (stale) return;
    stale = true;
    console.warn(`${MODULE_ID} | local copies may differ from the server after a refused batch; reload to continue`);
    ui.notifications.warn("pf2e-artisans-workshop.Sync.Stale", { localize: true, permanent: true });
}

/** For tests only: forget everything. */
export function resetState() {
    current = { ledger: null, strongbox: null, status: "disabled" };
    stale = false;
}
