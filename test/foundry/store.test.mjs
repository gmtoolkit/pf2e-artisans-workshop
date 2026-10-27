/** The key-path store over the ledger (DESIGN.md 5.3) and the client's write status (5.2, 4.14). */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { DELETION, MOD, controlClock, flagsOf, installFoundry, resetWorld, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { stampTime } = await import("../../scripts/logic/core.mjs");
const store = await import("../../scripts/foundry/store.mjs");
const state = await import("../../scripts/foundry/state.mjs");

let docs;
beforeEach(() => {
    resetWorld();
    state.resetState();
    docs = sharedWorld({ ledgerFlags: { rows: { r1: { id: "r1", v: 1, state: "pending" }, stub: { state: "applied" } } } });
    state.setShared({ ...docs, status: "ready" });
});

test("reads walk the ledger's flags; records leave out stubs", () => {
    assert.equal(store.read("rows.r1.state"), "pending");
    assert.equal(store.read("orders.none"), undefined);
    assert.deepEqual(store.records("rows").map((r) => r.id), ["r1"]);
    assert.throws(() => store.read("rows r1"), TypeError);
});

test("writes are key-path updates sent without diffing; other keys are left alone", async () => {
    await store.write({ set: { "rows.r1.state": "applied", "orders.o1": { id: "o1", v: 1 } } });
    const [, , , update, options] = world.calls.at(-1);
    assert.deepEqual(update, { [`flags.${MOD}.rows.r1.state`]: "applied", [`flags.${MOD}.orders.o1`]: { id: "o1", v: 1 } });
    assert.equal(options.diff, false);
    assert.equal(flagsOf(docs.ledger).rows.r1.state, "applied");
    assert.equal(flagsOf(docs.ledger).rows.r1.v, 1, "a sibling key survives");
});

test("deletes use _del and replacements do not merge", async () => {
    await store.write({ replace: { "roster.pc1": { name: "B" } } });
    await store.write({ set: { "roster.pc1.level": 3 } });
    await store.write({ replace: { "roster.pc1": { name: "C" } } });
    assert.deepEqual(flagsOf(docs.ledger).roster.pc1, { name: "C" });
    await store.write({ del: ["rows.r1"] });
    assert.equal(world.calls.at(-1)[3][`flags.${MOD}.rows.r1`], DELETION);
    assert.equal(flagsOf(docs.ledger).rows.r1, undefined);
});

test("a whole-collection write is refused before anything is sent", async () => {
    await assert.rejects(store.write({ set: { rows: {} } }), /whole collection/);
    await assert.rejects(store.write({ del: ["orders"] }), /whole collection/);
});

test("writes are refused while the client may not write, and when it is stale", async (t) => {
    t.mock.method(console, "warn", () => {});
    state.setShared({ ...docs, status: "migrating" });
    assert.equal(await store.write({ set: { "meta.x": 1 } }), false);
    state.setShared({ ...docs, status: "ready" });
    assert.throws(() => state.markStale("bored"), TypeError, "every cause has its notice");
    state.markStale("disconnected");
    assert.equal(state.status(), "stale");
    assert.equal(await store.write({ set: { "meta.x": 1 } }), false);
    assert.equal(flagsOf(docs.ledger).meta, undefined);
    assert.equal(world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Sync.Stale.Disconnected").length, 1);
    state.markStale("refused");
    assert.equal(world.notes.length, 1, "told once");
});

test("a stamp is a moment on the server's clock: the launch the server sent plus the server time, whatever this client's clock says", (t) => {
    const HOUR = 60 * 60 * 1000;
    const clock = controlClock(t);
    for (const skew of [3 * HOUR, -3 * HOUR, 0]) {
        clock.skew = skew;
        const { at } = store.stampNow();
        assert.equal(at.launch, world.launch, `the launch read from game.world.lastPlayed (client clock ${skew / HOUR} h off)`);
        assert.equal(at.server, clock.server - world.launch, "the server time since that launch");
        assert.equal(at.real, clock.server + skew, "and this client's own clock, for display only");
        assert.equal(stampTime(at), clock.server, "read back on the server's clock");
        assert.equal(store.serverNow(), clock.server, "the moment a reader compares it with, on the same clock");
    }
    // The next launch: the server time starts again from 0, the launch moves on, and the moment stays in order.
    const earlier = store.stampNow().at;
    clock.server += 60 * 1000;
    world.launch = Math.floor(clock.server / 1000) * 1000;
    clock.skew = -3 * HOUR;
    const later = store.stampNow().at;
    assert.ok(later.server < earlier.server, "the new launch's server time is behind the old one's");
    assert.equal(stampTime(later) - stampTime(earlier), 60 * 1000);
});

test("stamps and random ids", () => {
    const stamp = store.stampNow();
    assert.equal(stamp.by, "gm00000000000000");
    assert.equal(stamp.at.world, 1000);
    assert.match(store.newId(), /^[a-z0-9]{16}$/);
});

test("an extension's store is its own flag scope on the ledger, written by key path in the same request as the Workshop's keys (12.4, M10)", async () => {
    const { extStore } = await import("../../scripts/foundry/extensions.mjs");
    const ext = extStore("circus-module");
    await ext.set("prestige.shows.s1", 4);
    assert.equal(ext.get("prestige.shows.s1"), 4);
    assert.deepEqual(docs.ledger.flags["circus-module"], { prestige: { shows: { s1: 4 } } }, "under the extension's own scope");
    assert.equal(flagsOf(docs.ledger).ext, undefined, "nothing under the Workshop's");
    const copy = ext.get("prestige");
    copy.shows.s1 = 99;
    assert.equal(ext.get("prestige.shows.s1"), 4, "get returns a copy");
    await ext.write({ set: { "a.b": 1 }, del: ["prestige.shows.s1"] });
    assert.deepEqual([ext.get("a.b"), ext.get("prestige.shows.s1")], [1, undefined]);
    await ext.delete("a");
    assert.equal(ext.get("a"), undefined);
    assert.throws(() => extStore("bad id"), TypeError);
    for (const reserved of ["pf2e-artisans-workshop", "core", "world", "pf2e"]) assert.throws(() => extStore(reserved), TypeError, reserved);
    await assert.rejects(() => ext.set("bad path", 1), TypeError);
    assert.throws(() => ext.get("__proto__.x"), TypeError);
    const both = store.ledgerChange({ set: { "meta.x": 1 }, scopes: { "circus-module": { set: { y: 2 } } } });
    assert.deepEqual(both, { "flags.pf2e-artisans-workshop.meta.x": 1, "flags.circus-module.y": 2 }, "one update for the Workshop's keys and the extension's");
    assert.throws(() => store.ledgerChange({ scopes: { "pf2e-artisans-workshop": { set: { y: 2 } } } }), TypeError, "the Workshop's own scope is not an extension's");
    const first = await ext.exclusive("show-1", { set: { "shows.s1.done": true } });
    const second = await ext.exclusive("show-1", { set: { "shows.s1.done": false } });
    assert.deepEqual([first.ok, second.ok, second.outcome, ext.get("shows.s1.done")], [true, false, "taken", true], "an exclusive write lands once");
});
