/**
 * The key-path store over the Workshop ledger (DESIGN.md 5.3, P3), the API later milestones read and write
 * shared state through:
 *
 *   read("orders.<id>.status")                    a value at a path
 *   records("rows")                                the live records of a collection (stubs left out)
 *   write({set: {"orders.<id>.status": "setup"}})  key-path writes, merged into what is stored
 *   write({replace: {"roster.<id>": snapshot}})    replace a record whole (no stale keys survive a merge)
 *   write({del: ["standing.<id>"]})                delete with Foundry's `_del` operator
 *
 * Paths are checked by `scripts/logic/keypath.mjs`: known top-level keys only, and never a whole collection.
 * Writes go out with `diff: false`, so the server receives exactly the keys written and merges them into its
 * own current copy; two clients writing different keys at the same moment both land.
 */
import { MODULE_ID } from "../constants.mjs";
import { idFromRandom } from "../logic/ids.mjs";
import { checkPath, flagUpdate, liveRecords, readPath } from "../logic/keypath.mjs";
import { canWrite, shared, status } from "./state.mjs";

/** The ledger's module flags, or an empty object while there is no ledger. */
function ledgerFlags() {
    return shared().ledger?.flags?.[MODULE_ID] ?? {};
}

/** The value at a ledger path, or undefined. */
export function read(path) {
    checkPathForRead(path);
    return readPath(ledgerFlags(), path);
}

/** Reads may stop at a collection, so only the segments are checked here. */
function checkPathForRead(path) {
    if (typeof path !== "string" || !/^[A-Za-z0-9_.-]+$/.test(path)) throw new TypeError(`bad ledger path "${path}"`);
}

/** The live records of a collection (or of `formulas.<actorId>` and the like). */
export function records(collection) {
    return liveRecords(read(collection));
}

/** Whether a live record is stored at `path` (a stub left by a late key-path write does not count). */
export function exists(path) {
    return liveRecords({ record: read(path) }).length === 1;
}

/** One key-path change as a document update for the ledger's flags, for use inside a batch. */
export function ledgerChange(change) {
    return flagUpdate(MODULE_ID, change, { deletion: _del, replacement: _replace });
}

/**
 * Write to the ledger. Refused (returns false, writes nothing) unless this client may write (`canWrite`).
 * @param {{set?: object, replace?: object, del?: string[]}} change
 */
export async function write(change, options = {}) {
    const update = ledgerChange(change);   // throws on a bad path even when not writable
    if (!canWrite()) {
        console.warn(`${MODULE_ID} | ledger write refused while ${status()}`, Object.keys(update));
        return false;
    }
    await shared().ledger.update(update, { ...options, diff: false });
    return true;
}

/**
 * When the server launched the world, in ms on the server's clock: `game.world.lastPlayed`, which the server sets to
 * the moment of the launch (to the second, Foundry 14.368 `dist/packages/world.mjs`) and sends every client of that
 * launch as the same string. `game.time.serverTime` counts from about then (`Date.now() - start` in
 * `dist/components/activity.mjs`; measured live, the two starts lie well within a second of each other). If the
 * string does not parse, this client's own estimate stands in: its clock less the server time.
 */
function launchTime() {
    const parsed = Date.parse(game.world?.lastPlayed ?? "");
    return Number.isFinite(parsed) ? parsed : Date.now() - game.time.serverTime;
}

/** Now, on the server's clock that stamps are read on (`stampTime`): the launch plus the server time since. */
export function serverNow() {
    return launchTime() + game.time.serverTime;
}

/**
 * `by` and `at` for a record (4.1): the writing user, world time in seconds, and in ms this client's own clock
 * (`real`, for display) and the server's: the server time since the world was launched (`server`,
 * `game.time.serverTime`) and that launch (`launch`), which ages and timeouts compare across clients and across
 * relaunches (`stampTime`).
 */
export function stampNow() {
    return { by: game.user.id, at: { world: game.time.worldTime, real: Date.now(), server: game.time.serverTime, launch: launchTime() } };
}

/** A new random record id: 16 lowercase letters and digits (4.1). */
export function newId() {
    for (;;) {
        const id = idFromRandom(crypto.getRandomValues(new Uint32Array(16)));
        if (id) return id;
    }
}

/**
 * An extension's namespaced store (DESIGN.md 12.4): `get`, `set` and `delete` over `ext.<moduleId>.<key>`,
 * with the same key-path rules.
 */
export function extStore(moduleId) {
    const path = (key) => `ext.${moduleId}.${key}`;
    checkPath(path("x"));
    return {
        get: (key) => read(path(key)),
        set: (key, value) => write({ set: { [path(key)]: value } }),
        delete: (key) => write({ del: [path(key)] }),
    };
}
