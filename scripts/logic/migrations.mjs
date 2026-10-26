/**
 * Schema version and migrations of the shared documents (DESIGN.md 4.14).
 *
 * - Each shared document carries `flags.MOD.schema`, an integer, and no world setting holds it, so a
 *   migration run by a player can finish.
 * - A migration is a pure function from one version's flag data to the next, run in order.
 * - The migrating client is the elected one (`electedUser`, 5.6); it takes a lock first and the others
 *   wait and re-read. A client whose code is older than a document's schema stays read-only.
 *
 * The flag data a migration receives is the document's whole `flags.MOD` object, including `schema`; it
 * returns the new object. The Foundry side writes the difference as key paths (`keyPathDiff`), never the
 * object whole (P3).
 */
import { stampTime } from "./core.mjs";

/** The schema version this code writes. */
export const SCHEMA_VERSION = 1;

/**
 * Version 1, the first schema: documents created before schemas existed (none were released) have no
 * `schema` flag, which reads as 0. Nothing in the data changes.
 */
export function migrate1(flags) {
    return flags;
}

/** A deep copy of plain stored data (flags hold only JSON values). */
const copy = (data) => JSON.parse(JSON.stringify(data));

/** Every migration, in order: `to` is the version it produces, from `to - 1`. */
export const MIGRATIONS = Object.freeze([
    Object.freeze({ to: 1, ledger: migrate1, strongbox: migrate1 }),
]);

/** A document's schema version: its `schema` flag, or 0 when it has none. */
export function schemaOf(flags) {
    const schema = flags?.schema;
    return Number.isInteger(schema) && schema >= 0 ? schema : 0;
}

/**
 * How this code stands to a document: "current", "migrate" (older, this code can upgrade it) or "newer"
 * (written by a newer version of the module: read-only until the module is updated).
 */
export function schemaStatus(flags, code = SCHEMA_VERSION) {
    const schema = schemaOf(flags);
    if (schema === code) return "current";
    return schema < code ? "migrate" : "newer";
}

/**
 * Run the migrations from the document's version up to `to`, in order. Each step gets a copy, so a
 * migration may change its input freely. `kind` is "ledger" or "strongbox".
 *
 * @returns {{flags: object, from: number, to: number}}
 */
export function migrateFlags(flags, kind, { migrations = MIGRATIONS, to = SCHEMA_VERSION } = {}) {
    const from = schemaOf(flags);
    if (from > to) throw new RangeError(`cannot migrate down from ${from} to ${to}`);
    let data = copy(flags ?? {});
    for (let version = from + 1; version <= to; version++) {
        const step = migrations.find((m) => m.to === version);
        if (!step?.[kind]) throw new RangeError(`no ${kind} migration to version ${version}`);
        data = step[kind](copy(data));
        data.schema = version;
    }
    return { flags: data, from, to };
}

/** A migration lock older than this, whose holder has gone, may be broken (the holder's client died). */
export const MIGRATION_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Whether a migration lock (`{to, by, at}`) still stands: "free" when there is none, "held" while its holder is
 * connected or it is recent, "stale" when the holder has gone and it is older than the timeout. `now` is the
 * server time (`game.time.serverTime`), compared with the lock's (`stampTime`).
 */
export function migrationLockState(lock, { now, activeUserIds }) {
    if (!lock) return "free";
    const fresh = now - stampTime(lock.at) < MIGRATION_LOCK_TIMEOUT_MS;
    return activeUserIds.has(lock.by) || fresh ? "held" : "stale";
}
