/**
 * Bringing the shared documents to this code's schema (DESIGN.md 4.14).
 *
 * The elected client (the active GM, else the connected user with the lowest id, 5.6) takes the lock: a lock
 * page `migration:<to>` in the ledger, created with `keepId` so the server lets only one client have it, then
 * the visible marker `meta.migration = {to, by, at}`. It runs the pure migrations, writes each document's
 * difference as key paths and the new `schema`, and deletes the marker. Every other client stays read-only
 * ("migrating") and re-checks when the ledger changes, when a user connects or disconnects, and every
 * `MIGRATION_RECHECK_MS` (`sync.mjs`). A lock whose holder has gone and is older than
 * `MIGRATION_LOCK_TIMEOUT_MS` (by the server's clock) is broken and taken again.
 */
import { MODULE_ID } from "../constants.mjs";
import { hashId } from "../logic/ids.mjs";
import { flagUpdate, keyPathDiff } from "../logic/keypath.mjs";
import { SCHEMA_VERSION, migrateFlags, migrationLockState, schemaStatus } from "../logic/migrations.mjs";
import { isElected } from "./responsible.mjs";
import { stampNow } from "./store.mjs";

const flagsOf = (doc) => doc.flags?.[MODULE_ID] ?? {};

/**
 * Where the shared documents stand: "current", "newer" (read-only), "migrating" (someone else is at it), or
 * "migrated" after this client migrated them.
 */
export async function ensureSchema({ ledger, strongbox }) {
    const statuses = [schemaStatus(flagsOf(ledger)), schemaStatus(flagsOf(strongbox))];
    if (statuses.includes("newer")) return "newer";
    if (statuses.every((s) => s === "current")) return "current";
    if (!isElected()) return "migrating";
    if (!(await takeLock(ledger))) return "migrating";
    for (const [doc, kind] of [[ledger, "ledger"], [strongbox, "strongbox"]]) await migrateDocument(doc, kind);
    await ledger.update(flagUpdate(MODULE_ID, { del: ["meta.migration"] }, operators()), { diff: false });
    ui.notifications.info("pf2e-artisans-workshop.Sync.Migrated", { format: { to: String(SCHEMA_VERSION) } });
    return "migrated";
}

const operators = () => ({ deletion: _del, replacement: _replace });

/** Write one document's migration as key paths (P3). */
async function migrateDocument(doc, kind) {
    const before = flagsOf(doc);
    if (schemaStatus(before) !== "migrate") return;
    const { flags } = migrateFlags(before, kind);
    const { set, del } = keyPathDiff(before, flags);
    await doc.update(flagUpdate(MODULE_ID, { set, del: del.filter((path) => path !== "meta.migration") }, operators()), { diff: false });
}

/** The migration lock: a page with a fixed id per target version, then the `meta.migration` marker. */
async function takeLock(ledger) {
    const id = hashId(`migration:${SCHEMA_VERSION}`);
    const stamp = stampNow();
    const existing = ledger.pages.get(id);
    if (existing) {
        const lock = existing.flags?.[MODULE_ID]?.lock;
        const activeUserIds = new Set(game.users.filter((u) => u.active).map((u) => u.id));
        if (migrationLockState(lock, { now: game.time.serverTime, activeUserIds }) !== "stale") return lock?.by === game.user.id;
        await existing.delete({ [MODULE_ID]: { internal: true } });
    }
    try {
        await ledger.createEmbeddedDocuments("JournalEntryPage", [{ _id: id, name: id, type: "text",
            flags: { [MODULE_ID]: { lock: { to: SCHEMA_VERSION, ...stamp } } } }], { keepId: true });
    } catch {
        return false;   // another client created it first
    }
    await ledger.update(flagUpdate(MODULE_ID, { set: { "meta.migration": { to: SCHEMA_VERSION, ...stamp } } }, operators()), { diff: false });
    return true;
}
