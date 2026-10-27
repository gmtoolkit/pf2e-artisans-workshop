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
 * "ready" is checked again on every read: once a document in use is deleted, or this user loses OWNER on one, the
 * status is "missing" at once, before the sync's next check runs. That check is a hook away, and a hook can be late
 * (the re-check waits 250 ms) or never come: without a canvas, core's `Actor#_onUpdate` throws on a player's client
 * when an actor's ownership changes, before any `updateActor` hook (Foundry 14.368 `client/documents/actor.mjs`
 * calls `canvas.tokens.cycleTokens`), although the client's copy of the actor has the new ownership.
 *
 * On top of these, "stale": this client processed the results of a request the server refused at its dry run
 * that created or deleted documents on this client only (5.4, As built in M2), or it never heard back about one,
 * or its connection dropped at all (As built in M12b, review); its copies may differ from the server's, so it stops
 * writing until reloaded. A lost lock does not do this: in
 * 14.368 only the world-level operations of a refused request replay, and the lock request's one world-level
 * operation is an update, which a dry run does not commit.
 */
import { MODULE_ID } from "../constants.mjs";

let current = { ledger: null, strongbox: null, status: "disabled" };
let stale = false;

/** Whether every player owns `doc` by default. */
export const sharedOwnership = (doc) => doc?.ownership?.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

/**
 * Whether this client may write `doc`: every player owns it by default, and this user owns it too. Foundry reads a
 * user's own entry before the default (`getUserLevel`), so a GM can give one player less.
 */
export const writable = (doc) => sharedOwnership(doc) && doc.testUserPermission(game.user, "OWNER");

/** Whether `doc` is still in its collection: a deleted document stays referenced here, but its collection lost it. */
const present = (doc) => doc?.collection?.get(doc.id) === doc;

/** The shared documents in use, or null. */
export function shared() {
    return { ledger: current.ledger, strongbox: current.strongbox };
}

/** This client's status. */
export function status() {
    if (stale) return "stale";
    if (current.status !== "ready") return current.status;
    const { ledger, strongbox } = current;
    return [ledger, strongbox].every((doc) => present(doc) && writable(doc)) ? "ready" : "missing";
}

/** Whether this client may write to the shared documents. */
export function canWrite() {
    return status() === "ready";
}

/** Record the outcome of locating and checking the shared documents. */
export function setShared({ ledger = null, strongbox = null, status: next }) {
    current = { ledger, strongbox, status: next };
}

/**
 * Why a client goes stale, with what it tells its user (one notice per cause, since only the cause differs):
 * - "refused": the server refused a request at its dry run, and this client replayed a creation or deletion from
 *   it that happened here only (5.4, Dry-run replay);
 * - "disconnected": the connection dropped while a request was out, so its answer is lost (5.4, Answers);
 * - "dropped": the connection dropped with no request out (`sync.mjs`): broadcasts sent while it was down are lost, so
 *   this client's copies may be behind the server's, and a request planned from them could name lock pages the pruner has
 *   since deleted, which the server would no longer refuse (5.4, As built in M12b: Races);
 * - "timeout": no answer came within `ANSWER_LIMIT_MS` (`batch.mjs`).
 * In the last two the request may have applied on the server, or may yet.
 */
const STALE_CAUSES = Object.freeze({
    refused: { notice: "pf2e-artisans-workshop.Sync.Stale.Refused", log: "the server refused a request that this client had already replayed" },
    disconnected: { notice: "pf2e-artisans-workshop.Sync.Stale.Disconnected", log: "the connection dropped while a request was out, so its answer is lost" },
    dropped: { notice: "pf2e-artisans-workshop.Sync.Stale.Dropped", log: "the connection dropped, so changes made meanwhile may never have reached this client" },
    timeout: { notice: "pf2e-artisans-workshop.Sync.Stale.Timeout", log: "the server did not answer a request in time" },
});

/** Stop writing until this client reloads, and say why, once. `cause` is a key of `STALE_CAUSES`. */
export function markStale(cause) {
    const { notice, log } = STALE_CAUSES[cause] ?? {};
    if (!notice) throw new TypeError(`${MODULE_ID} | unknown stale cause ${cause}`);
    if (stale) return;
    stale = true;
    console.warn(`${MODULE_ID} | local copies may differ from the server: ${log}; reload to continue`);
    ui.notifications?.warn(notice, { localize: true, permanent: true });   // a drop before `ready` comes before the notifications
}

/** For tests only: forget everything. */
export function resetState() {
    current = { ledger: null, strongbox: null, status: "disabled" };
    stale = false;
}
