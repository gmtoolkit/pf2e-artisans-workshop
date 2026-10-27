/**
 * The M5 live-harness steps the first live run of the M5 plans corrected (2026-10-26, DESIGN.md 10.11): an item found by
 * the base name pf2e keeps in its source while it derives a runed weapon's name, and a step that waits for a record
 * another client wrote to reach this client's copy before acting on it.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld } from "./stubs.mjs";

installFoundry();
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const { write } = await import("../../scripts/foundry/store.mjs");
const { FORMULA_SCENARIOS, named, seen } = await import("../../tools/harness/formula-scenarios.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const steps = FORMULA_SCENARIOS.m5;

let vera;
beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 10)] });
    setUsers([{ id: "p1", character: vera }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

/** A weapon as pf2e prepares it: the name derived from its runes, the base name in its source. */
function runed(actor, base, derived, runes) {
    const item = actor.addItem({ type: "weapon", name: derived, system: { runes } });
    item._source.name = base;
    return item;
}

test("named: a runed weapon is found by the base name its source keeps, not only by the name pf2e derives", () => {
    const sword = { name: "+1 Striking Longsword", _source: { name: "Longsword" } };
    assert.equal(named(sword, ["Longsword"]), true);
    assert.equal(named(sword, ["+1 Striking Longsword"]), true);
    assert.equal(named({ name: "Steel Shield", _source: { name: "Steel Shield" } }, ["Longsword"]), false);
    assert.equal(named({ name: "Anything" }, undefined), true, "no names: every item");
    assert.equal(named({ name: "No source" }, ["Longsword"]), false);
});

test("the state step lists the user's runed longswords asked for as \"Longsword\" (m5-etch, m5-upgrade-transfer)", async () => {
    runed(vera, "Longsword", "+1 Striking Longsword", { potency: 1, striking: 1, property: [] });
    runed(vera, "Longsword", "+1 Longsword", { potency: 1, striking: 0, property: [] });
    vera.addItem({ type: "shield", name: "Steel Shield" });
    const out = await steps.state.run({ names: ["Longsword"] });
    assert.deepEqual(out.mine.map((i) => [i.name, i.runes.striking]).sort(), [["+1 Longsword", 0], ["+1 Striking Longsword", 1]]);
});

test("seen: waits for a record another client writes, and reports one that never arrives or never takes the value", async () => {
    setTimeout(() => write({ set: { "services.s1": { id: "s1", v: 1, status: "open" } } }), 250);
    const t0 = Date.now();
    const arrived = await seen("services.s1", { ms: 5000 });
    assert.equal(arrived.ok, true);
    assert.equal(arrived.value.status, "open");
    assert.ok(Date.now() - t0 >= 200, "it waited for the write");
    assert.deepEqual(await seen("services.s1.status", { value: "done", ms: 300 }), { ok: false, value: "open" });
    assert.deepEqual(await seen("services.none", { ms: 300 }), { ok: false, value: null });
    assert.equal((await steps.seen.run({ path: "services.s1.status", value: "open", ms: 300 })).ok, true, "the step is the helper");
});

test("m5-buy counts the formula cards it posted, not the ones earlier runs left in the dev world's chat log (M6 live pass)", async () => {
    const { pageCards } = await import("../../tools/harness/live-plans.mjs");
    const card = (id, kind) => ({ id, flags: { "pf2e-artisans-workshop": { card: { kind } } } });
    const log = [card("a", "formula"), card("b", "formula"), card("c", "order")];
    const real = Object.getOwnPropertyDescriptor(game, "messages");
    Object.defineProperty(game, "messages", { configurable: true, value: { filter: (fn) => log.filter(fn), map: (fn) => log.map(fn) } });
    try {
        const earlier = pageCards({ mod: "pf2e-artisans-workshop", kind: "formula" });
        assert.deepEqual([earlier.cards, earlier.messages, earlier.ids], [2, 3, ["a", "b", "c"]]);
        log.push(card("d", "formula"), { id: "e", flags: {} });
        const after = pageCards({ mod: "pf2e-artisans-workshop", kind: "formula", since: earlier.ids });
        assert.deepEqual([after.cards, after.messages], [1, 2], "one card posted since, of two messages");
    } finally {
        Object.defineProperty(game, "messages", real);
    }
});
