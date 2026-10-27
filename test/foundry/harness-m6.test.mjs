/**
 * The M6 live-harness steps and plans the first live run of the M6 plans corrected (2026-10-26, DESIGN.md 10.12): the
 * wizard step waits for the window `openAdvance` resolves to (it returns a promise since the M6 review closes the old
 * window first), and `m6-communal` crafts an order with two work days left to pay for its crafter and helper.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addDocument, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
game.i18n.localize = (key) => key;
game.i18n.format = (key) => key;

/** The wizard's window as far as the step reads it: rendered once `render` ran, an element with no controls. */
const element = { querySelector: () => null, querySelectorAll: () => [] };
foundry.applications.api.ApplicationV2 = class {
    #rendered = false;
    constructor(options = {}) { this.options = options; this.children = []; }
    get state() { return this.#rendered ? 2 : 0; }
    get rendered() { return this.#rendered; }
    get element() { return this.#rendered ? element : null; }
    get title() { return ""; }
    async _prepareContext() { return {}; }
    async render() { this.#rendered = true; return this; }
    async close() { this.#rendered = false; this._onClose?.({}); return this; }
};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const { DEGREE, RANK } = await import("../../scripts/logic/core.mjs");
const { crafterRate } = await import("../../scripts/logic/progress.mjs");
const { helperRate } = await import("../../scripts/logic/communal.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { DOWNTIME_SCENARIOS, craftRequest } = await import("../../tools/harness/downtime-scenarios.mjs");
const { COMMUNAL_ORDER } = await import("../../tools/harness/live-plans.mjs");
const { FIXTURES } = await import("../../tools/harness/fixtures.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const steps = DOWNTIME_SCENARIOS.m6;

beforeEach(() => {
    resetWorld();
    state.resetState();
    const docs = sharedWorld();
    const vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [] });
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [vera] };
    setUsers([{ id: "p1", character: vera }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
});

test("the wizard step drives the window openAdvance resolves to, not the promise (m6-wizard-gm, m6-wizard-players)", async () => {
    const out = await steps.wizard.run({ script: [] });
    assert.equal(out.seen[0].step, "span", "the window's first step, read from the window");
    assert.equal(out.seen[0].clockOption, false);
    assert.equal(out.result, null, "nothing committed");
});

test("m6-communal crafts an order whose second work day still falls before it is paid off", () => {
    const fixture = (id) => FIXTURES.find((f) => f.id === id);
    const crafter = fixture("bomber-11");
    const helper = fixture("fighter-crafter-10");
    // The most a day can take off: both checks critical successes, at the fixtures' levels and Crafting ranks.
    const day = crafterRate({ degree: DEGREE.critSuccess, level: crafter.level, rank: crafter.skills.crafting },
        { level: crafter.level, rank: crafter.skills.crafting })
        + helperRate({ level: helper.level, rank: helper.skills.crafting, degree: DEGREE.critSuccess });
    assert.ok(day > 0);
    // pf2e's Elixir of Life (Lesser) costs 30 gp, (Minor) 3 gp; the pledge covers the up-front half.
    const PRICE = { "Compendium.pf2e.equipment-srd.Item.TZUskLT7yvP7N2co": 3000, "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318": 300 };
    const leftAfterUpfront = (uuid, quantity) => (PRICE[uuid] * quantity) / 2;
    assert.equal(COMMUNAL_ORDER.pledge, leftAfterUpfront(COMMUNAL_ORDER.uuid, COMMUNAL_ORDER.quantity), "the pledge is the up-front half");
    assert.ok(leftAfterUpfront(COMMUNAL_ORDER.uuid, COMMUNAL_ORDER.quantity) > day, `a day takes off at most ${day} cp`);
    assert.ok(leftAfterUpfront("Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318", 1) <= day, "one Minor elixir was paid off by the first day");
    assert.ok(RANK.master === crafter.skills.crafting && RANK.master === helper.skills.crafting);
});

test("the craft step files the quantity it is given", () => {
    const me = { uuid: "Actor.vera" };
    assert.deepEqual(craftRequest({ uuid: "U", quantity: 2 }, me), { uuid: "U", quantity: 2, requester: "Actor.vera", crafter: "Actor.vera", recipient: { kind: "strongbox" } });
    assert.equal(craftRequest({ uuid: "U" }, me).quantity, 1);
});
