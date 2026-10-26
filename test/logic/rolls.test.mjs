/** The pure parts of the roll wrapper (DESIGN.md 6.12) and the Earn Income roll (6.10). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MODULE_ID } from "../../scripts/constants.mjs";
import { DEGREE, RANK } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { wagePerDay } from "../../scripts/logic/earn-income.mjs";
import { itemOptions } from "../../scripts/logic/registry.mjs";
import {
    LINK_PREFIX, checkFromContext, craftDegree, craftRollPlan, earnIncomeRollPlan, guardCheck, jobCheckPatch, jobLink,
    makeJob, orderLink, parseLink, unadjustedDegree,
} from "../../scripts/logic/rolls.mjs";

const ELIXIR = itemOptions({ type: "consumable", slug: "elixir-of-life-minor", traits: ["alchemical", "consumable", "elixir", "healing"], level: 1 });

test("the link options name the order and attempt, or the job, under the module id", () => {
    assert.equal(LINK_PREFIX, MODULE_ID);
    assert.equal(orderLink("abc123", 2), "pf2e-artisans-workshop:order:abc123:2");
    assert.deepEqual(parseLink(["action:craft", orderLink("abc123", 2)]), { kind: "order", id: "abc123", attempt: 2 });
    assert.deepEqual(parseLink([jobLink("job1")]), { kind: "job", id: "job1" });
    assert.equal(parseLink(["pf2e-artisans-workshop:order:abc123"]), null, "an order link needs its attempt");
    assert.equal(parseLink(["pf2e-artisans-workshop:other:x", "item:trait:alchemical", 7]), null);
    assert.equal(parseLink(undefined), null);
    assert.throws(() => orderLink("abc", 1.5), TypeError);
});

test("a Craft roll's options: action:craft, the product's, the registry's, the link; modifiers where no rule exists", () => {
    const held = ["specialty-crafting:alchemy", "alchemists-lab-expanded", "tattoo-artist"];
    const plan = craftRollPlan({ item: ELIXIR, held, ranks: { crafting: RANK.master }, order: { id: "o1", attempt: 3 } });
    for (const o of ["action:craft", "item:trait:alchemical", "alchemy", "alchemical", "pf2e-artisans-workshop:order:o1:3"]) {
        assert.ok(plan.options.includes(o), o);
    }
    assert.equal(new Set(plan.options).size, plan.options.length);
    assert.deepEqual(plan.modifiers, [], "Tattoo Artist only for tattoos");
    const tattoo = craftRollPlan({ item: itemOptions({ traits: ["magical", "tattoo"] }), held, ranks: { crafting: RANK.master }, order: { id: "o2", attempt: 1, craftType: "tattoo" } });
    assert.deepEqual(tattoo.modifiers.map(({ slug, type, value }) => [slug, type, value]), [["tattoo-artist", "circumstance", 2]]);
    assert.ok(tattoo.options.includes("artistry") === false, "artistry is not this crafter's specialty");
});

test("gear whose Crafting bonus predicates a bare or trade option gets it from the wrapper (6.15 gap 2)", () => {
    const snare = itemOptions({ type: "consumable", traits: ["consumable", "mechanical", "snare", "trap"], level: 1 });
    const order = { id: "o1", attempt: 1 };
    for (const ring of ["ring-of-maniacal-devices", "ring-of-maniacal-devices-greater"]) {
        assert.ok(craftRollPlan({ item: snare, held: [ring], order }).options.includes("snare"), ring);
        assert.ok(!craftRollPlan({ item: ELIXIR, held: [ring], order }).options.includes("snare"), `${ring}: snares only`);
    }
    assert.ok(craftRollPlan({ item: ELIXIR, held: ["philosophers-extractor"], order }).options.includes("action:craft:alchemical"));
    assert.ok(!craftRollPlan({ item: snare, held: ["philosophers-extractor"], order }).options.includes("action:craft:alchemical"));
    const axe = (item, extra = {}) => craftRollPlan({ item, held: ["axe-of-the-dwarven-lords"], order: { ...order, ...extra } }).options;
    assert.ok(axe(itemOptions({ type: "weapon", traits: [] })).includes("weapon"));
    assert.ok(axe(itemOptions({ type: "armor", traits: [] })).includes("armor"));
    assert.ok(axe(snare).includes("snare"));
    assert.ok(axe(itemOptions({ type: "equipment", traits: [] }), { specialty: "stonemasonry" }).includes("stonemasonry"));
    assert.deepEqual(axe(ELIXIR).filter((o) => !o.includes(":")), [], "nothing for an elixir");
});

test("the activity's own actions: reverse-engineering and graft implanting", () => {
    const reverse = craftRollPlan({ item: ELIXIR, held: [], order: { id: "o1", attempt: 1, route: "reverse-engineer" } });
    assert.ok(reverse.options.includes("action:reverse-engineer"));
    const graft = craftRollPlan({ item: [], held: [], order: { id: "o1", attempt: 1, craftType: "graft" } });
    assert.ok(graft.options.includes("action:implant-graft"));
    assert.deepEqual(earnIncomeRollPlan("j1").options, ["action:earn-income", "pf2e-artisans-workshop:job:j1"]);
});

test("the unadjusted degree, as pf2e's DegreeOfSuccess computes it", () => {
    const cases = [
        [{ total: 30, dc: 20, die: 10 }, DEGREE.critSuccess],
        [{ total: 29, dc: 20, die: 10 }, DEGREE.success],
        [{ total: 20, dc: 20, die: 10 }, DEGREE.success],
        [{ total: 19, dc: 20, die: 10 }, DEGREE.fail],
        [{ total: 11, dc: 20, die: 5 }, DEGREE.fail],
        [{ total: 10, dc: 20, die: 5 }, DEGREE.critFail],
        [{ total: 19, dc: 20, die: 20 }, DEGREE.success],
        [{ total: 30, dc: 20, die: 20 }, DEGREE.critSuccess],
        [{ total: 25, dc: 20, die: 1 }, DEGREE.fail],
        [{ total: 5, dc: 20, die: 1 }, DEGREE.critFail],
    ];
    for (const [input, degree] of cases) assert.equal(unadjustedDegree(input), degree, JSON.stringify(input));
});

test("a check from a message's context: a reroll's stale unadjusted outcome is recomputed; bad outcomes are not recorded", () => {
    const first = checkFromContext({ outcome: "success", unadjustedOutcome: "success", dc: { value: 20 }, options: [] }, { total: 22, die: 12 });
    assert.deepEqual(first, { ok: true, check: { degree: DEGREE.success, unadjusted: DEGREE.success, total: 22, rerolled: false, fortune: false } });
    // pf2e copies the first roll's context into the reroll's message and updates only `outcome`.
    const reroll = checkFromContext({ outcome: "criticalFailure", unadjustedOutcome: "success", isReroll: true, dc: { value: 20 },
        options: ["check:reroll", "check:reroll:hero-points"] }, { total: 9, die: 2 });
    assert.deepEqual(reroll.check, { degree: DEGREE.critFail, unadjusted: DEGREE.critFail, total: 9, rerolled: true, fortune: true });
    // Experienced Professional's rule element turned a critical failure into a failure: the unadjusted degree is kept.
    const adjusted = checkFromContext({ outcome: "failure", unadjustedOutcome: "criticalFailure", dc: { value: 20 }, options: [] }, { total: 8, die: 3 });
    assert.deepEqual([adjusted.check.degree, adjusted.check.unadjusted], [DEGREE.fail, DEGREE.critFail]);
    assert.equal(checkFromContext({ outcome: "criticalFailure", dc: { value: 20 }, rollTwice: "keep-higher" }, { total: 1, die: 1 }).check.fortune, true);
    assert.deepEqual(checkFromContext({ outcome: null, dc: { value: 20 } }, { total: 1, die: 1 }), { ok: false, reason: "no-outcome" });
    assert.deepEqual(checkFromContext({ outcome: "success" }, { total: 1, die: 1 }), { ok: false, reason: "no-dc" });
    const noDie = checkFromContext({ outcome: "success", unadjustedOutcome: "criticalSuccess", dc: { value: 20 } }, { total: undefined, die: null });
    assert.equal(noDie.check.unadjusted, DEGREE.critSuccess, "falls back to the context's own");
});

test("any reroll is guarded, not only a Hero Point one: pf2e's free keep-new and keep-higher rerolls spend nothing", () => {
    // pf2e's Check.rerollFromMessage: `isReroll` and `check:reroll`, plus `check:reroll:<resource>` only when one is spent.
    const free = checkFromContext({ outcome: "success", dc: { value: 20 }, isReroll: true, options: ["action:craft", "check:reroll"] }, { total: 22, die: 12 });
    assert.deepEqual([free.check.rerolled, free.check.fortune], [true, true]);
    assert.deepEqual(guardCheck(free.check, rulesWith({ downtimeRerolls: "block" })), { ok: false, reason: "fortune-blocked" });
    assert.equal(guardCheck(free.check).check.warn, true, "warn (the default) marks it for the card");
    assert.equal(checkFromContext({ outcome: "success", dc: { value: 20 }, options: ["check:reroll"] }, { total: 22, die: 12 }).check.fortune, true,
        "the option alone");
    // Assurance is not a reroll and stays unmarked (fact-check 51).
    assert.equal(checkFromContext({ outcome: "success", dc: { value: 20 }, options: ["action:craft", "assurance"] }, { total: 20, die: null }).check.fortune, false);
});

test("the downtime-check guardrail: warn marks a fortune check, block refuses it", () => {
    const fortune = { degree: 2, fortune: true };
    assert.deepEqual(guardCheck(fortune), { ok: true, check: { ...fortune, warn: true } });
    assert.deepEqual(guardCheck(fortune, rulesWith({ downtimeRerolls: "block" })), { ok: false, reason: "fortune-blocked" });
    assert.deepEqual(guardCheck({ degree: 2, fortune: false }, rulesWith({ downtimeRerolls: "block" })), { ok: true, check: { degree: 2, fortune: false, warn: false } });
});

test("Impeccable Crafting's shift applies when the roll carried the option the wrapper added", () => {
    assert.equal(craftDegree(["impeccable-crafting"], ["action:craft", "speciality"], DEGREE.success), DEGREE.critSuccess);
    assert.equal(craftDegree(["impeccable-crafting"], ["action:craft"], DEGREE.success), DEGREE.success);
});

test("an Earn Income check sets the pay per day and the status; Experienced Professional doubles failure pay in a Lore", () => {
    const job = makeJob({ id: "j1", actor: "Actor.a", skill: "cooking-lore", taskLevel: 3, dc: 18 }, { by: "u1", at: { world: 0, real: 0 } });
    assert.deepEqual([job.status, job.check, job.perDayCp, job.v], ["open", null, 0, 1]);
    const earner = { level: 5, rank: RANK.expert, experiencedProfessional: true };
    const fail = jobCheckPatch(job, { degree: DEGREE.fail, unadjusted: DEGREE.fail, rerolled: false }, earner);
    assert.equal(fail.patch.perDayCp, 2 * wagePerDay({ taskLevel: 3, rank: RANK.expert, degree: DEGREE.fail, skill: "cooking-lore" }));
    assert.deepEqual([fail.patch.status, fail.patch.shortened, fail.patch.check.level, fail.patch.check.rank], ["open", true, 5, RANK.expert]);
    // A critical failure the feat's rule element turned into a failure is not doubled (the unadjusted degree).
    const converted = jobCheckPatch(job, { degree: DEGREE.fail, unadjusted: DEGREE.critFail }, earner);
    assert.equal(converted.patch.perDayCp, wagePerDay({ taskLevel: 3, rank: RANK.expert, degree: DEGREE.fail, skill: "cooking-lore" }));
    const fired = jobCheckPatch(job, { degree: DEGREE.critFail, unadjusted: DEGREE.critFail }, earner);
    assert.deepEqual([fired.patch.status, fired.patch.perDayCp], ["fired", 0]);
});

test("a job takes one roll, and a reroll only until a wage has been paid", () => {
    const rolled = { ...makeJob({ id: "j1", actor: "Actor.a", skill: "crafting", taskLevel: 2, dc: 16 }, {}), check: { degree: DEGREE.fail } };
    const earner = { level: 3, rank: RANK.trained };
    assert.deepEqual(jobCheckPatch(rolled, { degree: DEGREE.success, rerolled: false }, earner), { ok: false, reason: "rolled" });
    assert.equal(jobCheckPatch(rolled, { degree: DEGREE.success, rerolled: true }, earner).ok, true);
    assert.equal(jobCheckPatch({ ...rolled, status: "fired" }, { degree: DEGREE.success, rerolled: true }, earner).patch.status, "open",
        "a Hero Point reroll of the critical failure that fired the earner");
    assert.deepEqual(jobCheckPatch(rolled, { degree: DEGREE.success, rerolled: true }, earner, 1), { ok: false, reason: "paid", data: { days: 1 } });
    assert.equal(jobCheckPatch({ ...rolled, status: "ended" }, { degree: 2, rerolled: true }, earner).reason, "state");
    assert.throws(() => jobCheckPatch({ ...rolled, check: null }, { degree: 2 }, { level: 1.5, rank: 1 }), TypeError);
});
