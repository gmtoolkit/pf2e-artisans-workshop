/** The key-path store over the ledger (DESIGN.md 5.3) and the client's write status (5.2, 4.14). */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { DELETION, MOD, flagsOf, installFoundry, resetWorld, sharedWorld, world } from "./stubs.mjs";

installFoundry();
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
    state.markStale();
    assert.equal(state.status(), "stale");
    assert.equal(await store.write({ set: { "meta.x": 1 } }), false);
    assert.equal(flagsOf(docs.ledger).meta, undefined);
    assert.equal(world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Sync.Stale").length, 1);
    state.markStale();
    assert.equal(world.notes.length, 1, "told once");
});

test("stamps, random ids and the extension store", async () => {
    const stamp = store.stampNow();
    assert.equal(stamp.by, "gm00000000000000");
    assert.equal(stamp.at.world, 1000);
    assert.match(store.newId(), /^[a-z0-9]{16}$/);
    const ext = store.extStore("circus-module");
    await ext.set("prestige", 4);
    assert.equal(ext.get("prestige"), 4);
    await ext.delete("prestige");
    assert.equal(ext.get("prestige"), undefined);
    assert.throws(() => store.extStore("bad id"), TypeError);
});
