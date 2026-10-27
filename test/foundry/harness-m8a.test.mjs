/**
 * The M8a live-harness steps and plans, as far as they run without a browser (DESIGN.md 8.10, 15.3 scenario 12): every step a
 * plan calls exists, the plans are registered, the ones that need a canvas say they were skipped without one, the plans'
 * family is the one `familyKey` gives pf2e's name, the brief reads a tracker, and the Affliction Forge stand-in comes and
 * goes on a client and refuses a player's call as Affliction Forge does.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { FakeCollection, addDocument, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";
import { asCreature, installPf2eAfflictions } from "./pf2e-afflictions.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
foundry.applications.api.ApplicationV2 = class {
    #state = 0;
    constructor(options = {}) { this.options = Object.freeze({ ...options }); }
    get state() { return this.#state; }
    get rendered() { return this.#state === 2; }
    get element() { return null; }
    async render() { this.#state = 2; return this; }
    async close() { this.#state = -1; return this; }
};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const MOD = "pf2e-artisans-workshop";
const { familyKey } = await import("../../scripts/logic/families.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const afflictions = await import("../../scripts/foundry/afflictions.mjs");
const { AFFLICTION_SCENARIOS, afflictionBrief } = await import("../../tools/harness/affliction-scenarios.mjs");
const { BEHAVIOURS, M8A } = await import("../../tools/harness/live-plans.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const steps = AFFLICTION_SCENARIOS.m8a;

let hero;
beforeEach(() => {
    resetWorld();
    state.resetState();
    installPf2eAfflictions();
    const docs = sharedWorld();
    game.combats = new FakeCollection();
    game.modules = new Map([[MOD, { id: MOD, version: "0.0.0" }]]);
    hero = asCreature(addDocument("Actor", { name: "Hero", type: "character", ownership: { default: 0, p1: 3 }, items: [] }));
    setUsers([{ id: "p1", character: hero }, { id: "gm00000000000000", isGM: true }], "p1");
    world.settings.set(`${MOD}.enabled`, true);
    state.setShared({ ...docs, status: "ready" });
});

test("every m8a step the plans call exists, every m8a plan is registered, and the steps say what they do", () => {
    const source = readFileSync(join(ROOT, "tools/harness/live-plans.mjs"), "utf8");
    const called = new Set([...source.matchAll(/h\.step\((?:"\w+"|role), "m8a", "(\w+)"/g)].map((m) => m[1]));
    assert.ok(called.size >= 15, [...called].join(", "));
    for (const name of called) assert.equal(typeof steps[name]?.run, "function", name);
    for (const step of Object.values(steps).filter((s) => typeof s === "object")) assert.equal(typeof step.about, "string");
    for (const id of ["m8a-strike", "m8a-cloud", "m8a-once", "m8a-powerful", "m8a-timing", "m8a-forge", "m8a-backends", "m8a-panel", "m8a-familiar", "m8a-shots"]) {
        assert.equal(typeof BEHAVIOURS[id], "function", id);
    }
});

test("m8a-strike says it was skipped without a canvas, and touches nothing", async () => {
    const checks = [];
    const result = await BEHAVIOURS["m8a-strike"]({ canvas: false, check: (name, ok, detail) => checks.push([name, ok, detail]) }, {});
    assert.deepEqual(result, { skipped: true });
    assert.deepEqual(checks.map((c) => c[1]), [true]);
    assert.match(checks[0][0], /--canvas/);
});

test("the plans' poison family is the one familyKey gives pf2e's name", () => {
    assert.equal(M8A.blackAdderFamily, familyKey({ name: "Black Adder Venom", type: "consumable", category: "poison" }));
});

test("the brief reads a tracker's run, badge and conditions", () => {
    hero.addItem({ _id: "trk0000000000001", type: "effect", name: "Toxin", system: { badge: { type: "counter", value: 2, labels: ["a", "b"] } },
        flags: { [MOD]: { affliction: { run: { id: "trk0000000000001", phase: "active", stage: 2, saves: {}, pending: null } } } } });
    hero.addItem({ type: "condition", name: "drained", system: { slug: "drained", value: { value: 1 } }, flags: { pf2e: { grantedBy: { id: "trk0000000000001", onDelete: "detach" } } } });
    const brief = afflictionBrief(hero);
    assert.deepEqual([brief.trackers.length, brief.trackers[0].stage, brief.trackers[0].badge.value], [1, 2, 2]);
    assert.deepEqual(brief.conditions, [{ slug: "drained", value: 1, grantedBy: { id: "trk0000000000001", onDelete: "detach" } }]);
    assert.equal(afflictions.trackersOf(hero).length, 1);
});

test("the Affliction Forge stand-in comes and goes on this client and refuses a player's call, as Affliction Forge does", async () => {
    assert.deepEqual(await steps.forge.run({ on: true }), { installed: false, active: true });
    const api = game.modules.get("pf2e-affliction-forge").api;
    await assert.rejects(() => api.application.apply({ templateUuid: "t", context: { saveDc: 18 } }), /not on a GM client/);
    world.currentUser = "gm00000000000000";
    await api.application.apply({ templateUuid: "t", context: { saveDc: 18 } });
    assert.deepEqual((await steps.forgeCalls.run()).calls, [{ templateUuid: "t", context: { saveDc: 18 }, user: "gm00000000000000" }]);
    assert.deepEqual(await steps.forge.run({ on: false }), { installed: false, active: false });
    assert.equal(game.modules.get("pf2e-affliction-forge"), undefined);
});

test("the npc step finds a fixture NPC under the name the fixture builder gives it, the creature's name after it (M8a live pass)", async () => {
    const goblin = addDocument("Actor", { name: `${M8A.npcOrdinary} (Goblin Warrior)`, type: "npc", items: [] });
    const found = await steps.npc.run({ name: M8A.npcOrdinary });
    assert.equal(found.uuid, goblin.uuid);
    assert.deepEqual(await steps.npc.run({ name: M8A.npcImmune }), { missing: M8A.npcImmune });
});
