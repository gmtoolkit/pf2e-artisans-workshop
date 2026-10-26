/** Schema version and migrations (DESIGN.md 4.14). */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    MIGRATIONS, MIGRATION_LOCK_TIMEOUT_MS, SCHEMA_VERSION, migrate1, migrateFlags, migrationLockState, schemaOf, schemaStatus,
} from "../../scripts/logic/migrations.mjs";
import { keyPathDiff } from "../../scripts/logic/keypath.mjs";
import { stampTime } from "../../scripts/logic/core.mjs";

test("the schema is version 1, and v1 is a migration that changes nothing", () => {
    assert.equal(SCHEMA_VERSION, 1);
    assert.equal(MIGRATIONS.length, 1);
    const data = { role: "ledger", rows: { a: { id: "a", v: 1 } } };
    assert.equal(migrate1(data), data);
});

test("a document without a schema flag reads as version 0", () => {
    assert.equal(schemaOf({}), 0);
    assert.equal(schemaOf(undefined), 0);
    assert.equal(schemaOf({ schema: "1" }), 0);
    assert.equal(schemaOf({ schema: 1 }), 1);
});

test("status against this code: current, migrate when older, newer (read-only) when ahead", () => {
    assert.equal(schemaStatus({ schema: 1 }), "current");
    assert.equal(schemaStatus({}), "migrate");
    assert.equal(schemaStatus({ schema: 2 }), "newer");
    assert.equal(schemaStatus({ schema: 2 }, 3), "migrate");
});

test("migrating a v0 ledger to v1 sets only the schema; its key-path diff is that one key", () => {
    const before = { role: "ledger", meta: { dayOffset: 3600 }, rows: { a: { id: "a", v: 1, box: 5 } } };
    const { flags, from, to } = migrateFlags(before, "ledger");
    assert.equal(from, 0);
    assert.equal(to, 1);
    assert.deepEqual(flags, { ...before, schema: 1 });
    assert.deepEqual(keyPathDiff(before, flags), { set: { schema: 1 }, del: [] });
    assert.equal(before.schema, undefined, "the input is not changed");
});

test("migrations run in order, each on a copy, and a missing step or a downgrade throws", () => {
    const seen = [];
    const migrations = [
        { to: 1, ledger: (d) => { seen.push(1); d.a = 1; return d; } },
        { to: 2, ledger: (d) => { seen.push(2); d.b = d.a + 1; return d; } },
        { to: 3, ledger: (d) => { seen.push(3); delete d.a; return d; } },
    ];
    const { flags } = migrateFlags({}, "ledger", { migrations, to: 3 });
    assert.deepEqual(seen, [1, 2, 3]);
    assert.deepEqual(flags, { b: 2, schema: 3 });
    assert.deepEqual(migrateFlags({ schema: 2, b: 2 }, "ledger", { migrations, to: 3 }).flags, { b: 2, schema: 3 });
    assert.throws(() => migrateFlags({}, "strongbox", { migrations, to: 3 }), /no strongbox migration/);
    assert.throws(() => migrateFlags({ schema: 4 }, "ledger", { migrations, to: 3 }), RangeError);
});

test("a migration lock stands while its holder is connected or it is recent; otherwise it is stale", () => {
    const now = 10 * MIGRATION_LOCK_TIMEOUT_MS;
    const lock = (age) => ({ to: 1, by: "u1", at: { real: now - age } });
    assert.equal(migrationLockState(null, { now, activeUserIds: new Set() }), "free");
    assert.equal(migrationLockState(lock(MIGRATION_LOCK_TIMEOUT_MS * 2), { now, activeUserIds: new Set(["u1"]) }), "held");
    assert.equal(migrationLockState(lock(1000), { now, activeUserIds: new Set() }), "held");
    assert.equal(migrationLockState(lock(MIGRATION_LOCK_TIMEOUT_MS + 1), { now, activeUserIds: new Set(["u2"]) }), "stale");
    const launch = 1000;
    const skewed = { to: 1, by: "u1", at: { real: now - MIGRATION_LOCK_TIMEOUT_MS * 3, server: now - launch - 1000, launch } };
    assert.equal(migrationLockState(skewed, { now, activeUserIds: new Set() }), "held", "the server's clock, not the holder's own");
});

/** Two launches of one world: the first ran for 11 hours; the server was relaunched a minute after it stopped. */
const HOUR = 60 * 60 * 1000;
const firstLaunch = 1_790_000_000_000;
const secondLaunch = firstLaunch + 11 * HOUR + 60 * 1000;
/** A stamp made `agoMs` before `now`, in the first launch: `game.time.serverTime` then was far ahead of today's. */
const fromFirstLaunch = (now, agoMs) => ({ real: 0, server: now - agoMs - firstLaunch, launch: firstLaunch });

test("a stamp is a moment on the server's own clock: its launch plus the server time since then", () => {
    assert.equal(stampTime({ real: 5, server: 2000, launch: 1_000_000 }), 1_002_000);
    assert.equal(stampTime({ real: 5, server: 2000 }), 5, "a stamp without its launch falls back to its author's clock");
    assert.equal(stampTime({ real: 5 }), 5);
    assert.equal(stampTime(undefined), 0);
    // game.time.serverTime counts from the launch (Foundry 14.368 dist/components/activity.mjs), so a stamp from a
    // longer earlier launch has the larger server time although it is the older one.
    const now = secondLaunch + 5 * 60 * 1000;
    const old = fromFirstLaunch(now, 6 * 60 * 1000);
    const recent = { real: 0, server: now - 1000 - secondLaunch, launch: secondLaunch };
    assert.ok(old.server > recent.server);
    assert.ok(stampTime(old) < stampTime(recent));
    assert.equal(now - stampTime(old), 6 * 60 * 1000);
});

test("a migration lock from an earlier, longer launch is judged by its age on the server's clock", () => {
    const now = secondLaunch + 30 * 1000;   // half a minute into the second launch
    const gone = { activeUserIds: new Set() };
    const lock = (agoMs) => ({ to: 1, by: "u1", at: fromFirstLaunch(now, agoMs) });
    assert.equal(migrationLockState(lock(6 * 60 * 1000), { now, ...gone }), "stale",
        "six minutes old: broken, although its server time is 11 hours ahead of today's");
    assert.equal(migrationLockState(lock(90 * 1000), { now, ...gone }), "held", "taken just before the relaunch: it stands");
});
