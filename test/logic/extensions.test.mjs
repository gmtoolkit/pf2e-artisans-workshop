/**
 * The extension API's pure parts (DESIGN.md 12, M10): ids, the four interfaces checked, the registry's life (open at setup,
 * closed at ready, duplicates, foreign ids, API majors), selectors and modifier data, Aid, rows, income splits and cadences,
 * activity results, and an extension activity's runs in the day planner.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { DEGREE } from "../../scripts/logic/core.mjs";
import { activityKey, daysSummary, extBlockOf, parseActivity, planDays } from "../../scripts/logic/downtime.mjs";
import {
    activityResult, aidModifier, answers, API_VERSION, cadenceKey, createRegistry, extRowInput, extRowKey, extRunId, incomeResult, incomeRowInputs,
    isExtensionScope, isScopePath, modifierData, modifierList, normaliseActivity, normaliseIncomeSource, normaliseModifierSource, normaliseSink,
    partyLevelOf, pathsOverlap, rollSelectors, splitEvenly, splitId, WORKSHOP_ID,
} from "../../scripts/logic/extensions.mjs";
import { hashId } from "../../scripts/logic/ids.mjs";
import { makeRow } from "../../scripts/logic/rows.mjs";

const resolve = () => ({});
const activity = (extra = {}) => ({ id: "my-ext.promote", label: "MY.Promote", days: 2, resolve, ...extra });
const stamp = { by: "u1", at: { world: 0, real: 0 } };

test("the logic folder's Workshop id is the module's (12.1: never an extension's scope)", () => {
    assert.equal(WORKSHOP_ID, MODULE_ID);
    assert.equal(API_VERSION, 1);
});

test("ids are <moduleId>.<slug>; module ids are Foundry package ids other than the reserved scopes", () => {
    assert.deepEqual(splitId("my-ext.promote-the-show"), { moduleId: "my-ext", slug: "promote-the-show" });
    for (const bad of ["promote", ".x", "my ext.x", "my-ext.Promote", "my-ext.", "pf2e.x", "core.x", `${MODULE_ID}.x`, 7, null]) assert.equal(splitId(bad), null, String(bad));
    assert.equal(isExtensionScope("my_ext-2"), true);
    assert.equal(isExtensionScope("world"), false);
    assert.equal(isScopePath("shows.s1.promo"), true);
    assert.equal(isScopePath("shows..x"), false);
    assert.equal(isScopePath("__proto__.x"), false);
});

test("a DowntimeActivity is checked and normalised (12.2)", () => {
    const ok = normaliseActivity(activity({ consecutive: true, check: { statistic: "society", dc: "partyLevel" }, aid: { days: 2, statistic: "society", dc: 20, bonus: 2 } }));
    assert.equal(ok.ok, true);
    assert.deepEqual([ok.value.moduleId, ok.value.slug, ok.value.days, ok.value.consecutive, ok.value.check.traits, ok.value.aid.bonus], ["my-ext", "promote", 2, true, [], 2]);
    assert.ok(Object.isFrozen(ok.value));
    const cases = [
        [{ days: 0 }, "bad-days"], [{ days: 1.5 }, "bad-days"], [{ resolve: undefined }, "no-resolve"], [{ label: "" }, "no-label"],
        [{ id: "promote" }, "bad-id"], [{ eligible: true }, "bad-eligible"], [{ check: { statistic: "society", dc: "high" } }, "bad-dc"],
        [{ check: { statistic: 3, dc: 15 } }, "bad-statistic"], [{ check: { statistic: "society", dc: 15, traits: [1] } }, "bad-traits"],
        [{ aid: { days: 0, statistic: "society", dc: 20, bonus: 2 } }, "bad-aid-days"], [{ aid: { days: 2, statistic: "society", dc: 20, bonus: -1 } }, "bad-aid-bonus"],
    ];
    for (const [patch, reason] of cases) assert.equal(normaliseActivity(activity(patch)).reason, reason, JSON.stringify(patch));
    assert.equal(normaliseActivity(activity({ check: { statistic: () => "society", dc: () => 15 } })).ok, true, "functions for the statistic and DC");
});

test("an IncomeSource, a ConsumableSink and a CheckModifierSource are checked (12.2)", () => {
    const compute = () => ({ cp: 0, breakdown: [] });
    assert.equal(normaliseIncomeSource({ id: "my-ext.payout", label: "L", cadence: "perEvent", distribute: "strongbox", compute }).ok, true);
    assert.equal(normaliseIncomeSource({ id: "my-ext.payout", label: "L", cadence: "monthly", distribute: "strongbox", compute }).reason, "bad-cadence");
    assert.equal(normaliseIncomeSource({ id: "my-ext.payout", label: "L", cadence: "perDay", distribute: "party", compute }).reason, "bad-distribute");
    assert.equal(normaliseSink({ id: "my-ext.trick", label: "L", accepts: () => true, spend: () => ({}) }).ok, true);
    assert.equal(normaliseSink({ id: "my-ext.trick", label: "L", accepts: () => true }).reason, "no-spend");
    const source = normaliseModifierSource({ id: "my-ext.roles", selectors: ["society", "society", "skill-check"], modifiers: () => [] });
    assert.deepEqual(source.value.selectors, ["society", "skill-check"], "no label needed; selectors deduplicated");
    assert.equal(normaliseModifierSource({ id: "my-ext.roles", selectors: [], modifiers: () => [] }).reason, "bad-selectors");
});

test("the registry: open from setup to ready, ids unique, an extension's objects under its own module id (12.1)", () => {
    const warned = [];
    const registry = createRegistry({ isActive: (id) => id !== "sleeping-ext", warn: (p) => warned.push(p.reason) });
    assert.equal(registry.facade.downtimeActivity(activity()).reason, "not-open", "before setup");
    registry.open();
    assert.equal(registry.facade.apiVersion, 1);
    assert.equal(registry.facade.downtimeActivity(activity()).ok, true);
    assert.equal(registry.facade.downtimeActivity(activity()).reason, "duplicate");
    const mine = registry.facade.extension("my-ext");
    assert.equal(mine.consumableSink({ id: "other-ext.trick", label: "L", accepts: () => true, spend: () => ({}) }).reason, "foreign-id");
    assert.equal(mine.checkModifierSource({ id: "my-ext.roles", selectors: ["society"], modifiers: () => [] }).ok, true);
    assert.equal(registry.facade.extension("sleeping-ext"), null, "an inactive module");
    assert.equal(registry.facade.incomeSource({ id: "sleeping-ext.x", label: "L", cadence: "perEvent", distribute: "actor", compute: () => null }).reason, "inactive");
    registry.close();
    assert.equal(registry.facade.downtimeActivity(activity({ id: "my-ext.late" })).reason, "closed", "after ready");
    assert.deepEqual(registry.list("downtimeActivity").map((a) => a.id), ["my-ext.promote"]);
    assert.equal(registry.get("checkModifierSource", "my-ext.roles").selectors[0], "society");
    assert.deepEqual(warned, ["not-open", "duplicate", "foreign-id", "inactive", "inactive", "closed"]);
});

test("an extension that requires another API major is ignored as a whole, from its own declaration or its manifest (12.1)", () => {
    const registry = createRegistry({ manifestApi: (id) => (id === "old-ext" ? 0 : null) });
    registry.open();
    assert.equal(registry.facade.extension("future-ext", { requiresApi: 2 }), null);
    assert.equal(registry.facade.downtimeActivity(activity({ id: "future-ext.a" })).reason, "ignored", "the first declaration decides");
    assert.equal(registry.facade.downtimeActivity(activity({ id: "old-ext.a" })).reason, "ignored", "the manifest's flag");
    assert.equal(registry.facade.downtimeActivity(activity({ id: "new-ext.a" })).ok, true);
    assert.deepEqual(registry.modules().map((m) => [m.module, m.requiresApi, m.ignored]), [["future-ext", 2, true], ["old-ext", 0, true], ["new-ext", null, false]]);
    assert.deepEqual([registry.knows("new-ext"), registry.knows("future-ext")], [true, false]);
    assert.equal(registry.problems().filter((p) => p.reason === "api-mismatch").length, 2);
});

test("a roll's selectors, and which sources answer them; modifier data checked (12.2 CheckModifierSource)", () => {
    assert.deepEqual(rollSelectors("society"), ["society", "skill-check", "check", "all"]);
    assert.deepEqual(rollSelectors("will"), ["will", "saving-throw", "check", "all"]);
    assert.deepEqual(rollSelectors("perception"), ["perception", "check", "all"]);
    assert.equal(answers({ selectors: ["skill-check"] }, rollSelectors("crafting")), true);
    assert.equal(answers({ selectors: ["performance"] }, rollSelectors("crafting")), false);
    assert.deepEqual(modifierData({ slug: "roles", label: "MY.Roles", modifier: 1, type: "circumstance" }, "my-ext.roles"),
        { slug: "roles", label: "MY.Roles", modifier: 1, type: "circumstance", source: "my-ext.roles" });
    assert.equal(modifierData({ slug: "x", modifier: 1 }, "s").type, "untyped");
    for (const bad of [{ slug: "Bad Slug", modifier: 1 }, { slug: "x", modifier: 1.5 }, { slug: "x", modifier: 0 }, { slug: "x", modifier: 1, type: "luck" }, null]) {
        assert.equal(modifierData(bad, "s"), null, JSON.stringify(bad));
    }
    assert.deepEqual(modifierList([{ slug: "a", modifier: 2 }, { slug: "Bad", modifier: 1 }], "s").dropped, 1);
    assert.deepEqual(modifierList("nope", "s"), { modifiers: [], dropped: 1 });
});

test("Aid gives the activity's bonus on a success or better, -1 on a critical failure (Player Core p.416)", () => {
    assert.equal(aidModifier(DEGREE.critSuccess, 2).modifier, 2);
    assert.equal(aidModifier(DEGREE.success, 2).type, "circumstance");
    assert.equal(aidModifier(DEGREE.fail, 2), null);
    assert.equal(aidModifier(DEGREE.critFail, 2).modifier, -1);
});

test("extension rows: keyed under the extension, income into the fund or a purse, expenses out of the fund (4.6, 12.4)", () => {
    assert.equal(extRowKey("my-ext:payout", "show.s1"), "ext:my-ext:payout:show.s1");
    assert.throws(() => extRowKey("my-ext", "x"), TypeError);
    assert.throws(() => extRowKey("my-ext:payout", "a:b"), TypeError);
    const box = extRowInput({ kind: "income", cp: 1500, key: "show.s1", source: "my-ext:payout" });
    assert.equal(box.ok, true);
    const row = makeRow(box.input, stamp);
    assert.deepEqual([row.kind, row.box, row.purse, row.alloc, row.source, row.actor], ["income", 1500, 0, 1500, "my-ext:payout", null]);
    const purse = makeRow(extRowInput({ kind: "income", cp: 30, key: "k", source: "my-ext:payout", actor: "Actor.a" }).input, stamp);
    assert.deepEqual([purse.box, purse.purse, purse.alloc, purse.actor], [0, 30, 0, "Actor.a"]);
    const expense = makeRow(extRowInput({ kind: "expense", cp: 4000, key: "upgrade.bleachers", source: "my-ext:upgrades" }).input, stamp);
    assert.deepEqual([expense.box, expense.purse, expense.alloc, expense.order], [-4000, 0, -4000, null], "the party fund's own row");
    const refusals = [[{ kind: "wage" }, "bad-kind"], [{ cp: -1 }, "bad-amount"], [{ cp: 0 }, "nothing"], [{ key: "a b" }, "bad-key"], [{ source: "pf2e:x" }, "bad-source"],
        [{ via: "purse", actor: null }, "no-actor"], [{ via: "bank" }, "bad-via"], [{ day: 1.5 }, "bad-day"]];
    for (const [patch, reason] of refusals) {
        assert.equal(extRowInput({ kind: "income", cp: 10, key: "k", source: "my-ext:payout", ...patch }).reason, reason, JSON.stringify(patch));
    }
});

test("income: an even split by largest remainder, the rows by distribution, results checked, cadence keys (12.2)", () => {
    assert.deepEqual(splitEvenly(10, ["a", "b", "c"]).map((s) => s.cp), [4, 3, 3]);
    assert.deepEqual(splitEvenly(0, ["a"]).map((s) => s.cp), [0]);
    const rows = incomeRowInputs({ source: "my-ext:payout", key: "show.s1", cp: 101, distribute: "split", recipients: ["Actor.a", "Actor.b"] });
    assert.deepEqual(rows.map((r) => [r.input.cp, r.input.actor, r.input.idem]), [[51, "Actor.a", "ext:my-ext:payout:show.s1.Actor.a"], [50, "Actor.b", "ext:my-ext:payout:show.s1.Actor.b"]]);
    assert.equal(incomeRowInputs({ source: "my-ext:payout", key: "k", cp: 5, distribute: "strongbox" })[0].input.how.via, "box");
    assert.equal(incomeRowInputs({ source: "my-ext:payout", key: "k", cp: 0, distribute: "strongbox" }).length, 0);
    assert.deepEqual(incomeResult({ cp: 7, breakdown: [{ label: "A", cp: 7 }, { nope: 1 }] }), { cp: 7, breakdown: [{ label: "A", cp: 7 }] });
    assert.equal(incomeResult({ cp: -1 }), null);
    assert.equal(cadenceKey("perDay", "a1", 9), "day.a1.9");
    assert.equal(cadenceKey("perWeek", "a1", 13), "week.a1.1");
    assert.equal(cadenceKey("perWeek", "a1", 12), null, "a week pays on its last day");
    assert.equal(cadenceKey("perEvent", "a1", 13), null);
    assert.equal(partyLevelOf([4, 5, 5]), 5);
    assert.equal(partyLevelOf([]), null);
});

test("an activity's result: store writes by valid path, rows keyed by the run unless given a key, notes (12.2 ActivityResult)", () => {
    const result = activityResult({
        ext: { "shows.s1.promo.a1-4": 6, "bad path": 1, "x..y": 2, "z": undefined },
        ledger: [{ kind: "income", cp: 100 }, { kind: "income", cp: 5, key: "own" }, { kind: "wage", cp: 1 }, { kind: "expense", cp: 1, source: "other-ext:x" }],
        notes: ["MY.Note", "", 3],
    }, { source: "my-ext:promote", runId: "run1", day: 4 });
    assert.deepEqual(result.ext, { "shows.s1.promo.a1-4": 6 });
    assert.deepEqual(result.rows.map((r) => [r.idem, r.day]), [["ext:my-ext:promote:run.run1.0", 4], ["ext:my-ext:promote:own", 4]]);
    assert.deepEqual(result.notes, ["MY.Note"]);
    assert.equal(result.dropped, 7);
    assert.deepEqual(activityResult(undefined, { source: "my-ext:promote", runId: "r", day: 1 }), { ext: {}, rows: [], notes: [], dropped: 0 });
});

test("an activity's result never carries two store paths one inside the other: the outer one is dropped (M10 review)", () => {
    const result = activityResult({ ext: { tally: { a: 1 }, "tally.b": 2, "tally.c.d": 3, other: 4, "others.x": 5 } }, { source: "my-ext:promote", runId: "r", day: 1 });
    assert.deepEqual(result.ext, { "tally.b": 2, "tally.c.d": 3, other: 4, "others.x": 5 }, "`other` is no prefix of `others.x`");
    assert.equal(result.dropped, 1);
    assert.deepEqual([pathsOverlap("a", "a"), pathsOverlap("a", "a.b"), pathsOverlap("a.b", "a"), pathsOverlap("a", "ab"), pathsOverlap("a.b", "a.c")], [true, true, true, false, false]);
});

/* -------------------------------------------- */
/*  Runs in the day planner                      */
/* -------------------------------------------- */

const PC = { actorId: "a1", actorUuid: "Actor.a1" };
const ext = (defs = {}, runs = {}) => ({ activities: { "my-ext.promote": { days: 2, consecutive: true, hasCheck: true, aid: { days: 2 }, eligible: { ok: true } },
    "my-ext.rest": { days: 1, consecutive: false, hasCheck: false, aid: null, eligible: { ok: true } }, ...defs }, runs });
const promote = { kind: "ext", ref: "my-ext.promote" };

test("activity keys for an extension's activity and an Aid (4.8, 12.2)", () => {
    assert.equal(activityKey(promote), "ext:my-ext.promote");
    assert.equal(activityKey({ ...promote, aid: "b1" }), "ext:my-ext.promote:b1");
    assert.deepEqual(parseActivity("ext:my-ext.promote"), promote);
    assert.deepEqual(parseActivity("ext:my-ext.promote:b1"), { ...promote, aid: "b1" });
    assert.equal(parseActivity("ext"), null);
});

test("a run's days: the first day writes, the last waits for the check; once rolled the run finishes and is listed to resolve (12.2)", () => {
    const run = extRunId("a1", "my-ext.promote", 5);
    const first = planDays({ ...PC, days: [5, 6], activity: promote, ext: ext() }, stamp);
    assert.deepEqual(first.records.map((r) => [r.day, r.ext]), [[5, { run, n: 1, of: 2, from: 5 }]]);
    assert.deepEqual(first.stop, { day: 6, reason: "ext-check", ref: run, activity: "my-ext.promote", from: 5, aid: null });
    assert.deepEqual(first.ext, []);
    const done = planDays({ ...PC, days: [6], activity: promote, records: first.records, ext: ext({}, { [run]: { check: { degree: 2 } } }) }, stamp);
    assert.deepEqual(done.records.map((r) => [r.day, r.ext.n, r.result]), [[6, 2, "ext"]]);
    assert.deepEqual(done.ext, [{ run, activity: "my-ext.promote", aid: null, from: 5, to: 6, record: "a1-6" }]);
    const rolledFirst = planDays({ ...PC, days: [5, 6], activity: promote, ext: ext({}, { [run]: { check: { degree: 2 } } }) }, stamp);
    assert.deepEqual([rolledFirst.records.length, rolledFirst.stop, rolledFirst.ext.length], [2, null, 1], "a check rolled before the days lets the whole run through");
});

test("a consecutive run broken by another day starts again; a run that may pause goes on (12.2 consecutive)", () => {
    const records = [{ id: "a1-5", actor: "a1", day: 5, toDay: 5, activity: promote, ext: { run: "r5", n: 1, of: 2, from: 5 } },
        { id: "a1-6", actor: "a1", day: 6, toDay: 6, activity: { kind: "subsist", ref: null } }];
    const block = extBlockOf({ actorId: "a1", ref: "my-ext.promote", day: 7, all: records, length: 2, consecutive: true });
    assert.deepEqual([block.n, block.from], [1, 7], "a new run");
    const paused = extBlockOf({ actorId: "a1", ref: "my-ext.promote", day: 7, all: records, length: 2, consecutive: false });
    assert.deepEqual([paused.run, paused.n, paused.from], ["r5", 2, 5], "the same run");
    const next = extBlockOf({ actorId: "a1", ref: "my-ext.promote", day: 6, all: records.slice(0, 1), length: 2, consecutive: true });
    assert.deepEqual([next.run, next.n], ["r5", 2]);
    const finished = [{ ...records[0], ext: { run: "r5", n: 2, of: 2, from: 4 } }];
    assert.equal(extBlockOf({ actorId: "a1", ref: "my-ext.promote", day: 6, all: finished, length: 2, consecutive: true }).n, 1, "a finished run is not continued");
});

test("an Aid is its own run, waits for the Aid check, and resolves nothing itself; stops for unknown and ineligible activities", () => {
    const aid = { ...promote, aid: "b1" };
    const plan = planDays({ ...PC, days: [3, 4], activity: aid, ext: ext() }, stamp);
    const aidRun = extRunId("a1", "my-ext.promote", 3, "b1");
    assert.deepEqual([plan.records[0].activity, plan.stop.reason, plan.stop.ref, plan.stop.aid], [aid, "ext-aid-check", aidRun, "b1"]);
    assert.notEqual(aidRun, extRunId("a1", "my-ext.promote", 3));
    const done = planDays({ ...PC, days: [3, 4], activity: aid, ext: ext({}, { [aidRun]: { check: { degree: 3 } } }) }, stamp);
    assert.deepEqual([done.records.at(-1).result, done.ext.length], ["ext-aid", 1]);
    assert.equal(planDays({ ...PC, days: [3], activity: { kind: "ext", ref: "gone-ext.x" }, ext: ext() }, stamp).stop.reason, "ext-unknown");
    assert.equal(planDays({ ...PC, days: [3], activity: { kind: "ext", ref: "my-ext.rest", aid: "b1" }, ext: ext() }, stamp).stop.reason, "ext-unknown", "no Aid");
    const barred = ext({ "my-ext.rest": { days: 1, consecutive: false, hasCheck: false, aid: null, eligible: { ok: false, reason: "MY.Why" } } });
    assert.deepEqual(planDays({ ...PC, days: [3], activity: { kind: "ext", ref: "my-ext.rest" }, ext: barred }, stamp).stop,
        { day: 3, reason: "ext-ineligible", ref: "my-ext.rest", why: "MY.Why" });
    const rest = planDays({ ...PC, days: [3, 4], activity: { kind: "ext", ref: "my-ext.rest" }, ext: ext() }, stamp);
    assert.deepEqual([rest.records.length, rest.ext.map((e) => e.from)], [2, [3, 4]], "a 1-day activity with no check: one run a day");
});

test("a summary of extension days: per activity, and an Aid per PC aided (the day card)", () => {
    const records = [
        { day: 1, toDay: 1, activity: promote, ext: { n: 1 } }, { day: 2, toDay: 2, activity: promote, ext: { n: 2 } },
        { day: 1, toDay: 1, activity: { ...promote, aid: "b1" } },
    ];
    assert.deepEqual(daysSummary(records).parts, [{ kind: "ext", ref: "my-ext.promote", n: 2, cp: 0 }, { kind: "ext-aid", ref: "my-ext.promote:b1", n: 1, cp: 0 }]);
});

test("run ids are hashes of the actor, activity, first day and whom it aids", () => {
    assert.equal(extRunId("a1", "my-ext.promote", 5), hashId("ext-run:a1:my-ext.promote:5:self"));
});
