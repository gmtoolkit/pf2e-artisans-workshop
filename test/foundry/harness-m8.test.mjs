/**
 * The M8 live-harness steps and plans, as far as they run without a browser (DESIGN.md 10.14, 15.3): every step a plan
 * calls exists, the plans are registered, `m8-hud` says it was skipped without a canvas, the plans' families are the ones
 * `familyKey` gives pf2e's names, the briefs read what Quick Alchemy wrote, and the Duct Tape stand-in comes and goes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { FakeCollection, addDocument, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";
import { asAlchemist, seedCombatCompendium } from "./alchemist.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
game.i18n.localize = (key) => key;
game.i18n.format = (key) => key;
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
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { familyKey } = await import("../../scripts/logic/families.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { resetCatalogue } = await import("../../scripts/foundry/catalogue.mjs");
const { COMBAT_SCENARIOS, combatBrief } = await import("../../tools/harness/combat-scenarios.mjs");
const { BEHAVIOURS, M8 } = await import("../../tools/harness/live-plans.mjs");
const alchemy = await import("../../scripts/foundry/alchemy.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const steps = COMBAT_SCENARIOS.m8;

let vera;
let items;
beforeEach(() => {
    resetWorld();
    state.resetState();
    resetCatalogue();
    alchemy.resetAlchemy();
    const docs = sharedWorld();
    Object.assign(world, { toggles: [], strikes: [], damage: [], checks: [], consumed: [], nextCheck: null });
    items = seedCombatCompendium();
    game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => world.index }]]);
    game.combats = new FakeCollection();
    game.modules = new Map([[MOD, { id: MOD, version: "0.0.0" }]]);
    vera = addDocument("Actor", { name: "Vera", type: "character", ownership: { default: 0, p1: 3 }, items: [] });
    asAlchemist(vera, { formulas: [items.fire.uuid], feats: ["versatile-vials"], registry: REGISTRY });
    setUsers([{ id: "p1", character: vera }, { id: "gm00000000000000", isGM: true }], "p1");
    world.settings.set(`${MOD}.enabled`, true);
    state.setShared({ ...docs, status: "ready" });
});

test("every m8 step the plans call exists, and every m8 plan is registered", () => {
    const source = readFileSync(join(ROOT, "tools/harness/live-plans.mjs"), "utf8");
    const called = new Set([...source.matchAll(/h\.step\("\w+", "m8", "(\w+)"/g)].map((m) => m[1]));
    for (const [, name] of source.matchAll(/\["\w+", "m8", "(\w+)"/g)) called.add(name);
    assert.ok(called.size >= 15, [...called].join(", "));
    for (const name of called) assert.equal(typeof steps[name]?.run, "function", name);
    for (const step of Object.values(steps).filter((s) => typeof s === "object")) assert.equal(typeof step.about, "string");
    for (const id of ["m8-panel", "m8-bandolier", "m8-turn", "m8-vials", "m8-healing-bomb", "m8-duct-tape", "m8-use-best", "m8-hud", "m8-shots"]) {
        assert.equal(typeof BEHAVIOURS[id], "function", id);
    }
});

test("m8-hud says it was skipped without a canvas, and touches nothing", async () => {
    const checks = [];
    const result = await BEHAVIOURS["m8-hud"]({ canvas: false, check: (name, ok, detail) => checks.push([name, ok, detail]) }, {});
    assert.deepEqual(result, { skipped: true });
    assert.deepEqual(checks.map((c) => c[1]), [true]);
    assert.match(checks[0][0], /--canvas/);
});

test("the plans' families are those familyKey gives pf2e's names", () => {
    assert.equal(M8.fireFamily, familyKey({ name: "Alchemist's Fire (Moderate)", type: "weapon", category: "bomb" }));
    assert.equal(M8.potionFamily, familyKey({ name: "Healing Potion (Lesser)", type: "consumable", category: "potion" }));
});

test("the briefs read what Quick Alchemy wrote; the Duct Tape stand-in comes and goes on this client", async () => {
    const made = await steps.quick.run({ actor: vera.uuid, uuid: items.fire.uuid, ms: 0 });
    assert.equal(made.result.ok, true, JSON.stringify(made.result));
    const brief = combatBrief(vera);
    assert.deepEqual([brief.vials.value, brief.quick.length, brief.quick[0].expiry.rule, brief.quick[0].held], [4, 1, "turn-start", true]);
    assert.deepEqual(await steps.ductTape.run({ on: true }), { installed: false, active: true, off: "duct-tape" });
    assert.equal((await steps.quick.run({ actor: vera.uuid, uuid: items.fire.uuid, ms: 0 })).result.reason, "duct-tape");
    assert.deepEqual(await steps.ductTape.run({ on: false }), { installed: false, active: false, off: null });
});
