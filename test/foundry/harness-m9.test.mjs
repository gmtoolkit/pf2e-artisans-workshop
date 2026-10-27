/**
 * The M9 live-harness steps and plans, as far as they run without a browser (DESIGN.md 15.3 scenario 14): every step a plan
 * calls exists and says what it does, the plans are registered, and the feats the plans give are the registry's own. After
 * the M9 live pass: the plans run over a fake harness, so a failed Craft check, a pledge with no entry or a gadget nobody is
 * held back from fails a check instead of passing on the branch it skips; the die is fixed for every Craft check; the
 * `snares` step prepares every slot ready.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { installFoundry } from "./stubs.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
foundry.applications.api.ApplicationV2 = class {};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { CRAFT_SCENARIOS } = await import("../../tools/harness/craft-scenarios.mjs");
const { BEHAVIOURS, M9 } = await import("../../tools/harness/live-plans.mjs");

test("every m9 step the plans call exists and says what it does; every m9 plan is registered", () => {
    const source = readFileSync(join(ROOT, "tools/harness/live-plans.mjs"), "utf8");
    const called = new Set([...source.matchAll(/h\.step\("\w+", "m9", "(\w+)"/g)].map((m) => m[1]));
    assert.ok(called.size >= 12, [...called].join(", "));
    const steps = CRAFT_SCENARIOS.m9;
    for (const name of called) assert.equal(typeof steps[name]?.run, "function", name);
    for (const step of Object.values(steps).filter((s) => typeof s === "object")) assert.equal(typeof step.about, "string");
    for (const id of ["m9-tattoo", "m9-simple", "m9-graft", "m9-fulu-missive", "m9-staff", "m9-snares", "m9-gadget", "m9-shots"]) {
        assert.equal(typeof BEHAVIOURS[id], "function", id);
    }
});

test("the plans' feats are the registry's, and their items are compendium UUIDs", () => {
    assert.equal(M9.graftTechnician, REGISTRY["graft-technician"].uuid);
    assert.equal(M9.giantSnare, REGISTRY["giant-snare"].uuid);
    for (const uuid of Object.values(M9)) assert.match(uuid, /^Compendium\.pf2e\.(equipment|feats)-srd\.Item\.[A-Za-z0-9]{16}$/);
});

/* -------------------------------------------- */
/*  After the M9 live pass                       */
/* -------------------------------------------- */

const { withDie } = await import("../../tools/harness/craft-scenarios.mjs");

/** The fixtures the M9 plans name, as `prepareWorld` lists them. */
const WORLD = () => ({
    fixtures: [["tat", "rogue-tattoo-7"], ["clr", "cleric-5"], ["fig", "fighter-crafter-10"], ["wiz", "wizard-9"], ["rng", "ranger-snares-8"], ["inv", "inventor-6"]],
    pcs: { p1: { id: "p1", uuid: "Actor.p1" }, p2: { id: "p2", uuid: "Actor.p2" } }, strays: [], party: { id: "party" },
});

/**
 * A harness that runs a plan without a browser: every client ready, each step answered from `answers` (by "<scenario>.<step>",
 * a value or a function of the params), and every check and step call recorded.
 */
function fakeHarness(answers) {
    const checks = [];
    const calls = [];
    const h = {
        clients: new Map([["gm", {}], ["p2", {}]]), shots: [], label: "test", canvas: false,
        only: async () => {}, settle: async () => {}, closeAll: async () => {}, collectPages: async () => ({}),
        evaluate: async (client, fn) => (fn.name === "pageStatus" ? "ready" : { status: "ready" }),
        screenshot: async (client, file, size, fn) => fn(),
        step: async (client, scenario, step, params) => {
            calls.push({ client, scenario, step, params });
            const answer = answers[`${scenario}.${step}`];
            return structuredClone(typeof answer === "function" ? answer(params) : answer ?? {});
        },
        check: (name, ok, detail) => {
            checks.push({ name, ok: !!ok, detail });
            return !!ok;
        },
    };
    return { h, checks, calls };
}

/** Answers under which every M9 order is filed and agreed to, and its Craft check fails. */
const failedCraft = (craftType) => ({
    "m9.request": { order: "ord1", brief: { craftType, recipient: { uuid: "Actor.p2" } } },
    "m9.consent": { result: { ok: true, presence: true }, status: { inDowntime: true, activity: { kind: "subject" } } },
    "m5.gates": { failing: [] },
    "m9.tradition": { ok: true },
    "m9.leave": { ok: false, reason: "subject" },
    "m9.run": { steps: [], order: { status: "failed", craftType, process: "secrets-of-magic", skill: "medicine", tradition: "divine" } },
});

test("a plan that crafts something records a failed check when its Craft check fails, rather than passing on the branch it skips", async () => {
    for (const [id, craftType] of [["m9-tattoo", "tattoo"], ["m9-simple", "tattoo"], ["m9-graft", "graft"], ["m9-fulu-missive", "item"]]) {
        const { h, checks } = fakeHarness(failedCraft(craftType));
        await BEHAVIOURS[id](h, WORLD());
        const crafted = checks.filter((c) => /crafted|implanted/.test(c.name));
        assert.ok(crafted.length > 0 && crafted.every((c) => c.ok === false), `${id}: ${JSON.stringify(checks.map((c) => [c.name, c.ok]))}`);
    }
});

test("every M9 Craft check the plans roll has its die fixed, at a face that is a whole number", async () => {
    const answers = { ...failedCraft("tattoo"), "m9.run": (p) => ({ steps: [], order: { status: "complete", face: p.face } }), "m9.made": { items: [] } };
    let runs = 0;
    for (const id of ["m9-tattoo", "m9-simple", "m9-graft", "m9-fulu-missive"]) {
        const { h, calls } = fakeHarness(answers);
        await BEHAVIOURS[id](h, WORLD());
        for (const call of calls.filter((c) => c.scenario === "m9" && c.step === "run")) {
            runs += 1;
            assert.ok(Number.isInteger(call.params.face) && call.params.face >= 2 && call.params.face <= 19, `${id}: ${JSON.stringify(call.params)}`);
        }
    }
    assert.equal(runs, 5);
});

test("m9-staff fails when no pledge names its entry, and m9-gadget when a crafter without the class is not held back", async () => {
    const staff = fakeHarness({
        "m9.spell": (p) => ({ ok: true, uuid: `Actor.wiz.Item.${p.name}`, compendium: `Compendium.pf2e.spells-srd.Item.${p.name}` }),
        "m9.request": { order: "ord1", brief: { craftType: "spell-item" } },
        "m5.gates": { failing: [["G9", "spells"]] },
        "m5.pledge": (p) => (p.spell.endsWith("Electric Arc") ? { ok: false, reason: "not-on-list" } : { ok: true }),
        "m9.order": { order: { pledges: [] } },
    });
    await BEHAVIOURS["m9-staff"](staff.h, WORLD());
    assert.equal(staff.checks.find((c) => c.name.startsWith("both entries are named"))?.ok, false);

    const gadget = fakeHarness({ "m9.request": { order: "ord1" }, "m5.gates": { failing: [] } });
    await BEHAVIOURS["m9-gadget"](gadget.h, WORLD());
    assert.equal(gadget.checks.find((c) => c.name.startsWith("the same gadget without the class"))?.ok, false);
});

test("withDie fixes the d20 at the face asked for and puts the random source back, even when the roll throws", async () => {
    const random = () => 0.5;
    globalThis.CONFIG.Dice = { randomUniform: random };
    const face = (u) => Math.ceil((1 - u) * 20);
    for (const want of [1, 2, 15, 20]) assert.equal(await withDie(want, () => face(CONFIG.Dice.randomUniform())), want);
    await assert.rejects(withDie(15, async () => {
        throw new Error("roll");
    }));
    assert.equal(CONFIG.Dice.randomUniform, random);
    assert.equal(await withDie(null, () => CONFIG.Dice.randomUniform), random);
});

test("the snares step prepares every slot ready, though an earlier run deployed one (pf2e keeps `expended` on the entry)", async () => {
    const SNARE = "Compendium.pf2e.equipment-srd.Item.AFX1V0Go9DqPWBlN";
    // pf2e 8.6.1's CraftingAbility for a prepared, not daily, pool: `setFormulaQuantity` adds or drops entries of the formula
    // and keeps the others as they are; `unprepareFormula` drops every entry of it.
    const ability = {
        slug: "snarecrafter", isPrepared: true, isDailyPrep: false, maxSlots: 4,
        preparedFormulaData: [{ uuid: SNARE }, { uuid: SNARE, expended: true }],
        async unprepareFormula(uuid) {
            this.preparedFormulaData = this.preparedFormulaData.filter((f) => f.uuid !== uuid);
        },
        async setFormulaQuantity(uuid, n) {
            const have = this.preparedFormulaData.filter((f) => f.uuid === uuid).length;
            for (let i = have; i < n; i++) this.preparedFormulaData.push({ uuid });
            for (let i = n; i < have; i++) this.preparedFormulaData.splice(this.preparedFormulaData.findLastIndex((f) => f.uuid === uuid), 1);
        },
        async getPreparedCraftingFormulas() {
            return this.preparedFormulaData.map((f) => ({ uuid: f.uuid, expended: !!f.expended }));
        },
    };
    const actor = { uuid: "Actor.rng", crafting: { abilities: [ability] } };
    const saved = globalThis.fromUuidSync;
    globalThis.fromUuidSync = () => actor;
    try {
        const result = await CRAFT_SCENARIOS.m9.snares.run({ actor: actor.uuid, pool: "snarecrafter", uuid: SNARE, count: 2 });
        assert.equal(result.ok, true);
        assert.deepEqual(result.prepared, [{ uuid: SNARE, expended: false }, { uuid: SNARE, expended: false }]);
    } finally {
        globalThis.fromUuidSync = saved;
    }
});
