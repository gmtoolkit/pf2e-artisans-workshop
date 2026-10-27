/**
 * The affliction rules engine (DESIGN.md 8.10.6, 15.1): every degree of the initial, stage and re-exposure saves, onset and
 * maximum duration, virulent streaks, the highest stage repeating, Tenacious Toxins and the other modifiers, the grant
 * flags, the DC order and the DC stamp, coatings and Sticky Poison, Double Poison, recording and rerolls, the time function
 * over logged days, catch-up order and both combat anchors.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE } from "../../scripts/logic/core.mjs";
import {
    EXPIRING_CONDITIONS, advance, afflictionNow, applyDegree, applyOverride, canDoublePoison, chooseBackend, chooseDc, claimOrder, coatingAfterAttack,
    coatingAfterDamage, definitionDigest, enterStage, exposureKind, forgeRoute, grantOnDelete, initialSaveModifiers, isDue, maxSeconds,
    mergeDoublePoison, newRun, nextEvent, potentPoisonerDc, powerfulAlchemyDc, printedSaveDcs, recordSave, resolveDefinition, rollDuration,
    rollFormula, rollerFor, stageConditionPlan, stickyDc, systemSource, trackerSource, waitsBehind,
} from "../../scripts/logic/affliction.mjs";

const { critFail, fail, success, critSuccess } = DEGREE;

/** A three-stage poison: 1-round intervals, a 6-round maximum, stage conditions. */
const stage = (n, conditions = [], duration = { value: 1, unit: "rounds" }) => ({
    damage: [{ formula: `${n}d6`, damageType: "poison", category: null }], conditions, effects: [], duration,
});
const POISON = {
    v: 1, level: 2, traits: ["poison", "injury"], save: { type: "fortitude", value: 18 }, onset: null,
    duration: { value: 6, unit: "rounds", expiry: null },
    stages: [stage(1, [{ slug: "sickened", value: 1, linked: true }]), stage(2, [{ slug: "sickened", value: 2, linked: true }]),
        stage(3, [{ slug: "slowed", value: 1, linked: true }])],
    confidence: "full",
};
const ONSET = { ...POISON, onset: { value: 10, unit: "minutes" }, duration: { value: 6, unit: "minutes", expiry: null } };
const VIRULENT = { ...POISON, traits: ["poison", "virulent"] };
const SINGLE = { ...POISON, stages: [stage(1)], duration: { value: -1, unit: "unlimited", expiry: null } };
const DISEASE = { ...POISON, traits: ["disease"] };
const run0 = (mods = []) => newRun({ id: "run1", source: { uuid: "Compendium.x.y.Item.p", name: "P", level: 2, traits: ["poison"] }, defKey: "uuid:p",
    dc: { value: 18, source: "printed" }, mods });
const random = () => 0.5;

test("the initial save: success and critical success leave it unaffected; failure is stage 1, critical failure stage 2", () => {
    for (const degree of [success, critSuccess]) {
        const out = applyDegree(run0(), POISON, degree, "initial", 100, { random });
        assert.equal(out.run.phase, "ended");
        assert.equal(out.effects, null);
    }
    const failed = applyDegree(run0(), POISON, fail, "initial", 100, { random });
    assert.equal(failed.run.stage, 1);
    assert.equal(failed.run.phase, "active");
    assert.equal(failed.run.nextDueAt, 106);
    assert.equal(failed.run.maxEndsAt, 136);
    assert.deepEqual(failed.effects.conditions, [{ slug: "sickened", value: 1, linked: true }]);
    assert.equal(failed.effects.damage[0].formula, "1d6");
    const crit = applyDegree(run0(), POISON, critFail, "initial", 100, { random });
    assert.equal(crit.run.stage, 2);
    assert.equal(crit.effects.stage, 2);
});

test("a critical failure on a single-stage affliction stays at stage 1", () => {
    const out = applyDegree(run0(), SINGLE, critFail, "initial", 0, { random });
    assert.equal(out.run.stage, 1);
    assert.equal(out.run.maxEndsAt, null, "no maximum duration: it lasts until saves end it");
});

test("stage saves: success -1, critical success -2, failure +1, critical failure +2; below 1 it ends; the highest repeats", () => {
    const at2 = enterStage({ ...run0(), phase: "active", stage: 1 }, POISON, 2, 100, { random }).run;
    assert.equal(applyDegree(at2, POISON, success, "stage", 106, { random }).run.stage, 1);
    assert.equal(applyDegree(at2, POISON, critSuccess, "stage", 106, { random }).run.phase, "ended");
    assert.equal(applyDegree(at2, POISON, fail, "stage", 106, { random }).run.stage, 3);
    const top = applyDegree(at2, POISON, critFail, "stage", 106, { random });
    assert.equal(top.run.stage, 3);
    const again = applyDegree(top.run, POISON, fail, "stage", 112, { random });
    assert.equal(again.run.stage, 3);
    assert.equal(again.effects.repeat, true, "past the highest stage, its effects repeat");
    assert.equal(again.run.nextDueAt, 118, "and its interval restarts");
    assert.equal(again.run.maxEndsAt, at2.maxEndsAt, "the maximum duration never moves");
});

test("virulent: two successes in a row reduce by 1, a critical success by 1 only; a failure breaks the streak", () => {
    const at2 = enterStage({ ...run0(), phase: "active", stage: 1 }, VIRULENT, 2, 0, { random }).run;
    const one = applyDegree(at2, VIRULENT, success, "stage", 6, { random });
    assert.equal(one.run.stage, 2);
    assert.equal(one.run.streak, 1);
    assert.equal(one.effects.repeat, true, "a success that changes nothing repeats the stage (OQ-39)");
    const two = applyDegree(one.run, VIRULENT, success, "stage", 12, { random });
    assert.equal(two.run.stage, 1);
    assert.equal(two.run.streak, 0);
    const broken = applyDegree(one.run, VIRULENT, fail, "stage", 12, { random });
    assert.equal(broken.run.streak, 0);
    assert.equal(applyDegree(at2, VIRULENT, critSuccess, "stage", 6, { random }).run.stage, 1);
});

test("re-exposure: a poison's failed save adds a stage (2 on a critical failure); a success changes nothing; disease and curse are unaffected", () => {
    const at1 = applyDegree(run0(), POISON, fail, "initial", 0, { random }).run;
    assert.equal(applyDegree(at1, POISON, success, "re-exposure", 3, { random }).run.stage, 1);
    const plus1 = applyDegree(at1, POISON, fail, "re-exposure", 3, { random });
    assert.equal(plus1.run.stage, 2);
    assert.equal(plus1.run.maxEndsAt, at1.maxEndsAt, "re-exposure never changes the maximum duration");
    assert.equal(plus1.run.nextDueAt, 9, "the new stage's effects apply at once and its interval starts");
    assert.ok(plus1.effects.conditions.length);
    assert.equal(applyDegree(at1, POISON, critFail, "re-exposure", 3, { random }).run.stage, 3);
    assert.equal(applyDegree(at1, DISEASE, critFail, "re-exposure", 3, { random }).run.stage, 1);
    assert.equal(exposureKind(at1, DISEASE), "no-effect");
    assert.equal(exposureKind(at1, POISON), "re-exposure");
    assert.equal(exposureKind(null, POISON), "initial");
    assert.equal(exposureKind({ ...at1, phase: "ended" }, POISON), "initial");
});

test("re-exposure during the onset raises the target stage and leaves the onset's length", () => {
    const onset = applyDegree(run0(), ONSET, fail, "initial", 0, { random });
    assert.equal(onset.run.phase, "onset");
    assert.equal(onset.effects, null, "nothing takes effect during the onset");
    assert.equal(onset.run.onsetEndsAt, 600);
    const raised = applyDegree(onset.run, ONSET, fail, "re-exposure", 60, { random });
    assert.equal(raised.run.stage, 2);
    assert.equal(raised.run.onsetEndsAt, 600);
    assert.equal(raised.effects, null);
});

test("reExposure none (Lethargy Poison): no save, nothing changes; reset-max starts the maximum again", () => {
    const def = { ...POISON, reExposure: "none" };
    const at1 = applyDegree(run0(), def, fail, "initial", 0, { random }).run;
    assert.equal(exposureKind(at1, def), "no-save");
    const out = applyDegree(at1, def, critFail, "re-exposure", 3, { random });
    assert.equal(out.noSave, true);
    assert.equal(out.run.stage, 1);
    const reset = { ...POISON, reExposure: "reset-max" };
    const r1 = applyDegree(run0(), reset, fail, "initial", 0, { random }).run;
    assert.equal(applyDegree(r1, reset, success, "re-exposure", 20, { random }).run.maxEndsAt, 56);
});

test("the maximum duration starts after the onset, even an onset longer than the maximum (Wolfsbane's shape)", () => {
    const run = applyDegree(run0(), ONSET, fail, "initial", 0, { random }).run;
    assert.equal(run.maxEndsAt, null);
    const after = advance(run, ONSET, 600, {});
    assert.equal(after.steps[0].kind, "onset");
    assert.equal(after.run.phase, "active");
    assert.equal(after.run.maxEndsAt, 600 + 360);
    assert.equal(after.run.nextDueAt, 600 + 6);
    assert.equal(after.save, null, "the first save is not due yet");
});

test("advance: onset end and maximum duration each at their own moment; the first due save stops it; the maximum wins a tie", () => {
    const run = applyDegree(run0(), POISON, fail, "initial", 0, { random }).run;
    const due = advance(run, POISON, 100, {});
    assert.deepEqual(due.save, { at: 6 });
    assert.equal(due.steps.length, 0);
    const tie = { ...run, nextDueAt: 36, maxEndsAt: 36 };
    assert.deepEqual(nextEvent(tie), { kind: "max", at: 36 });
    const out = advance(tie, POISON, 36, {});
    assert.equal(out.run.phase, "ended");
    assert.equal(out.run.endReason, "max-duration");
    assert.equal(out.save, null);
});

test("Tenacious Toxins adds the stage-1 interval to the maximum, at most twice it", () => {
    assert.equal(maxSeconds(POISON, []), 36);
    assert.equal(maxSeconds(POISON, [{ slug: "tenacious-toxins" }]), 42);
    const short = { ...POISON, duration: { value: 1, unit: "rounds" }, stages: [stage(1, [], { value: 1, unit: "minutes" })] };
    assert.equal(maxSeconds(short, [{ slug: "tenacious-toxins" }]), 12);
    const run = applyDegree(run0([{ slug: "tenacious-toxins" }]), POISON, fail, "initial", 0, { random }).run;
    assert.equal(run.maxEndsAt, 42);
});

test("modifiers: Pinpoint Poisoner, Combustible Poison, holding breath, Blowgun Poisoner's critical, Pernicious Poison, the toxicologist's acid", () => {
    assert.deepEqual(initialSaveModifiers([{ slug: "pinpoint-poisoner" }, { slug: "held-breath" }]), [{ slug: "pinpoint-poisoner", value: -2 }, { slug: "held-breath", value: 2 }]);
    assert.deepEqual(initialSaveModifiers([{ slug: "combustible-poison" }, { slug: "combustible-fire" }]), [{ slug: "combustible-poison", value: -1 }]);
    const blow = applyDegree(run0([{ slug: "blowgun-crit" }]), POISON, success, "initial", 0, { random });
    assert.equal(blow.run.stage, 1, "a success counts as a failure");
    const pern = applyDegree(run0([{ slug: "pernicious-poison" }]), POISON, success, "initial", 0, { random });
    assert.deepEqual(pern.extras, [{ formula: "2", damageType: "poison", category: null }]);
    assert.deepEqual(applyDegree(run0([{ slug: "pernicious-poison" }]), POISON, critSuccess, "initial", 0, { random }).extras, []);
    const comb = applyDegree(run0([{ slug: "combustible-poison" }]), POISON, fail, "initial", 0, { random });
    assert.deepEqual(comb.extras, [{ formula: "1d4", damageType: "fire", category: "persistent" }]);
    const acid = applyDegree(run0([{ slug: "toxicologist-acid" }]), POISON, fail, "initial", 0, { random });
    assert.equal(acid.effects.damage[0].damageType, "acid");
});

test("the grant flags: the six expiring conditions and unlinked ones outlast the tracker; drained stays when it ends", () => {
    for (const slug of EXPIRING_CONDITIONS) assert.equal(grantOnDelete({ slug, linked: true }), "detach");
    assert.equal(grantOnDelete({ slug: "slowed", linked: true }), "cascade");
    assert.equal(grantOnDelete({ slug: "slowed", linked: false }), "detach");
    // A stage change deletes the tracker's linked conditions that do not expire on their own and updates the rest.
    const plan = stageConditionPlan("trk", [{ slug: "sickened", value: 2, linked: true }],
        [{ id: "c1", slug: "sickened", value: 1, grantedBy: "trk" }, { id: "c2", slug: "slowed", value: 1, grantedBy: "trk" },
            { id: "c3", slug: "drained", value: 1, grantedBy: "trk" }, { id: "c4", slug: "slowed", value: 1, grantedBy: null }]);
    assert.deepEqual(plan.deletes, ["c2"]);
    assert.deepEqual(plan.updates, [{ id: "c1", value: 2 }]);
    assert.deepEqual(plan.creates, []);
    const fresh = stageConditionPlan("trk", [{ slug: "slowed", value: 1, linked: true }, { slug: "drained", value: 1, linked: true }], []);
    assert.deepEqual(fresh.creates.map((c) => [c.slug, c.onDelete]), [["slowed", "cascade"], ["drained", "detach"]]);
});

test("the DC order: definition, manual, stamp, inline, printed; a stamped poison held by an ally keeps the creator's DC", () => {
    assert.deepEqual(chooseDc({ fixed: 30, manual: 25, stamp: 22, inline: 20, printed: 18 }), { value: 30, source: "definition" });
    assert.deepEqual(chooseDc({ manual: 25, stamp: 22, inline: 20, printed: 18 }), { value: 25, source: "manual" });
    assert.deepEqual(chooseDc({ stamp: 22, inline: 18, printed: 18 }), { value: 22, source: "stamp" }, "the ally's inline DC falls back to the printed one");
    assert.deepEqual(chooseDc({ inline: 20, printed: 18 }), { value: 20, source: "inline" });
    assert.deepEqual(chooseDc({ printed: 18 }), { value: 18, source: "printed" });
    assert.equal(chooseDc({}), null);
});

test("Powerful Alchemy stamps the class DC only when it beats the printed DC (Wolfsbane 30 against a 10th-level alchemist's 29: none)", () => {
    assert.equal(powerfulAlchemyDc({ printed: [30], classDc: 29, infused: true }), null);
    assert.equal(powerfulAlchemyDc({ printed: [18], classDc: 17, infused: true }), null, "Arsenic at 1st level");
    assert.equal(powerfulAlchemyDc({ printed: [25], classDc: 24, infused: true }), null, "Curare at 8th level");
    assert.equal(powerfulAlchemyDc({ printed: [18], classDc: 22, infused: true }), 22);
    assert.equal(powerfulAlchemyDc({ printed: [18], classDc: 22, infused: false }), null, "downtime-crafted items are not infused");
    assert.equal(potentPoisonerDc({ printed: [18], classDc: 30 }), 22);
    assert.equal(potentPoisonerDc({ printed: [18], classDc: 20 }), 20);
    assert.equal(potentPoisonerDc({ printed: [30], classDc: 29 }), null);
    assert.deepEqual(printedSaveDcs("<p>@Check[fortitude|dc:18|showDC:all] and @Check[flat|dc:5]</p>"), [18]);
});

test("coatings: each attack degree, each damage type, Blowgun Poisoner, an item that stays potent; Sticky Poison's DCs", () => {
    assert.equal(coatingAfterAttack(critFail), "spend");
    assert.equal(coatingAfterAttack(fail), "keep");
    assert.equal(coatingAfterAttack(success), "arm");
    assert.equal(coatingAfterAttack(critSuccess), "arm");
    assert.deepEqual(coatingAfterDamage({ types: ["piercing"] }), { expose: true, spend: true });
    assert.deepEqual(coatingAfterDamage({ types: ["slashing", "fire"] }), { expose: true, spend: true });
    assert.deepEqual(coatingAfterDamage({ types: ["bludgeoning"] }), { expose: false, spend: true });
    assert.deepEqual(coatingAfterDamage({ types: ["bludgeoning"], blowgun: true }), { expose: true, spend: true });
    assert.deepEqual(coatingAfterDamage({ types: ["piercing"], keepsCoating: true }), { expose: true, spend: false });
    assert.equal(stickyDc(true), 17);
    assert.equal(stickyDc(false), 5);
});

test("Double Poison: the lower stage count, combined effects, the longer interval per stage, virulent only if both, the chosen save", () => {
    const a = { ...POISON, traits: ["poison", "injury", "virulent"], stages: [stage(1, [{ slug: "sickened", value: 1, linked: true }]), stage(2, [], { value: 1, unit: "minutes" })] };
    const b = { ...POISON, save: { type: "reflex", value: 20 }, stages: [stage(1, [{ slug: "sickened", value: 2, linked: true }], { value: 2, unit: "rounds" }), stage(2), stage(3)] };
    const merged = mergeDoublePoison(a, b, { saveType: "reflex" });
    assert.equal(merged.stages.length, 2);
    assert.deepEqual(merged.stages[0].conditions, [{ slug: "sickened", value: 2, linked: true }]);
    assert.deepEqual(merged.stages[0].duration, { value: 2, unit: "rounds" });
    assert.deepEqual(merged.stages[1].duration, { value: 1, unit: "minutes" });
    assert.equal(merged.stages[0].damage.length, 2);
    assert.ok(!merged.traits.includes("virulent"));
    assert.equal(merged.save.type, "reflex");
    const ok = (p) => ({ uuid: p, traits: ["infused", "injury", "poison"], level: 4 });
    assert.deepEqual(canDoublePoison({ first: ok("a"), second: ok("b"), alchemistLevel: 14 }), { ok: true });
    assert.equal(canDoublePoison({ first: ok("a"), second: ok("a"), alchemistLevel: 14 }).reason, "double-same");
    assert.equal(canDoublePoison({ first: ok("a"), second: ok("b"), alchemistLevel: 5 }).reason, "double-level");
    assert.equal(canDoublePoison({ first: ok("a"), second: ok("b"), alchemistLevel: 14, ammunition: true }).reason, "double-ammo");
    assert.equal(canDoublePoison({ first: { ...ok("a"), traits: ["injury"] }, second: ok("b"), alchemistLevel: 14 }).reason, "double-infused");
});

test("recording: the first result for a seq stands; a duplicate is already; a reroll restores before and recomputes; an older reroll conflicts", () => {
    const start = applyDegree(run0(), POISON, fail, "initial", 0, { random }).run;
    const first = recordSave({ ...start, pending: { seq: 1, kind: "stage", dueAt: 6 } }, POISON, { seq: 1, kind: "stage", degree: fail, dueAt: 6, messageId: "m1" }, { random });
    assert.ok(first.ok);
    assert.equal(first.run.stage, 2);
    assert.equal(first.run.pending, null);
    assert.equal(first.run.saves[1].before.stage, 1);
    const dup = recordSave(first.run, POISON, { seq: 1, kind: "stage", degree: success, dueAt: 6, messageId: "m2" }, { random });
    assert.deepEqual(dup, { ok: false, reason: "already" });
    const stillThere = recordSave(first.run, POISON, { seq: 1, kind: "stage", degree: success, dueAt: 6, messageId: "m2", isReroll: true, originalGone: false }, { random });
    assert.equal(stillThere.reason, "already", "a reroll counts only once pf2e has deleted the original");
    const reroll = recordSave(first.run, POISON, { seq: 1, kind: "stage", degree: critSuccess, dueAt: 6, messageId: "m3", isReroll: true, originalGone: true }, { random });
    assert.ok(reroll.ok);
    assert.equal(reroll.run.phase, "ended", "stage 1 critical success: the restored stage 1, not stage 2");
    assert.equal(reroll.run.saves[1].rolls, 2);
    assert.equal(reroll.superseded.messageId, "m1");
    const second = recordSave(first.run, POISON, { seq: 2, kind: "stage", degree: fail, dueAt: 12, messageId: "m4" }, { random });
    const old = recordSave(second.run, POISON, { seq: 1, kind: "stage", degree: critSuccess, dueAt: 6, messageId: "m5", isReroll: true, originalGone: true }, { random });
    assert.deepEqual(old, { ok: false, reason: "conflict" });
});

test("the time function: logged days move the clock by whole days; a clock that reaches them takes over; nothing is rolled twice", () => {
    assert.equal(afflictionNow({ worldTime: 1000, manualDay: null }), 1000);
    assert.equal(afflictionNow({ worldTime: 1000, manualDay: 2, secondsPerDay: 86400, offset: 0 }), 2 * 86400 + 1000, "two days ahead, the same time of day");
    assert.equal(afflictionNow({ worldTime: 4 * 86400, manualDay: 2 }), 4 * 86400);
    assert.equal(afflictionNow({ worldTime: 1000, manualDay: 2, offset: 86000 }), 1000 + 86400, "the day boundary falls at the offset: day 1 already");
    // A day-interval disease: two days logged make one save due at day 1 and one at day 2; after they resolve (each next
    // due time from its own due time), a clock advanced over the same span finds nothing due.
    const disease = { ...DISEASE, stages: [stage(1, [], { value: 1, unit: "days" }), stage(2, [], { value: 1, unit: "days" })],
        duration: { value: -1, unit: "unlimited", expiry: null } };
    let run = applyDegree(run0(), disease, fail, "initial", 0, { random }).run;
    let now = afflictionNow({ worldTime: 0, manualDay: 2 });
    const saves = [];
    for (let i = 0; i < 5; i++) {
        const step = advance(run, disease, now, {});
        if (!step.save) break;
        saves.push(step.save.at);
        run = recordSave(step.run, disease, { seq: i + 1, kind: "stage", degree: fail, dueAt: step.save.at, messageId: `m${i}` }, { random }).run;
    }
    assert.deepEqual(saves, [86400, 172800]);
    now = afflictionNow({ worldTime: 2 * 86400, manualDay: 2 });
    assert.equal(advance(run, disease, now, {}).save, null, "the clock over the logged days rolls nothing twice");
});

test("after days are logged, rounds still move the clock: with the clock advanced to match, a 1-round poison saves each round and ends at its maximum (review fix)", () => {
    // Two days logged by the wizard, then "advance clock to match" (whole days, the same time of day): 10:00 on day 2.
    const world0 = 2 * 86400 + 10 * 3600;
    const clock = (worldTime) => afflictionNow({ worldTime, manualDay: 2, secondsPerDay: 86400, offset: 0 });
    assert.equal(clock(world0 - 2 * 86400), world0, "before the clock was advanced: the logged days ahead, at the same time of day");
    assert.equal(clock(world0), world0, "after: no jump");
    const adder = { ...POISON, duration: { value: 3, unit: "rounds", expiry: null } };
    let run = applyDegree(run0(), adder, fail, "initial", clock(world0), { random }).run;
    const saves = [];
    let ended = null;
    for (let round = 1; round <= 10 && !ended; round++) {
        const step = advance(run, adder, clock(world0 + 6 * round), {});
        if (step.run.phase === "ended") ended = { round, reason: step.run.endReason };
        else if (step.save) {
            saves.push(round);
            run = recordSave(step.run, adder, { seq: round, kind: "stage", degree: success, dueAt: step.save.at, messageId: `m${round}` }, { random }).run;
            if (run.phase === "ended") ended = { round, reason: run.endReason };
        }
    }
    assert.deepEqual(saves, [1], "the stage save falls due after one round");
    assert.deepEqual(ended, { round: 1, reason: "recovered" });
    // A failed save each round instead: the run ends at its 3-round maximum.
    run = applyDegree(run0(), adder, fail, "initial", clock(world0), { random }).run;
    ended = null;
    for (let round = 1; round <= 10 && !ended; round++) {
        const step = advance(run, adder, clock(world0 + 6 * round), {});
        if (step.run.phase === "ended") ended = { round, reason: step.run.endReason };
        else if (step.save) run = recordSave(step.run, adder, { seq: round, kind: "stage", degree: fail, dueAt: step.save.at, messageId: `f${round}` }, { random }).run;
    }
    assert.deepEqual(ended, { round: 3, reason: "max-duration" });
});

test("catch-up: a long advance makes the saves due one after another, each from the state the previous left", () => {
    let run = applyDegree(run0(), POISON, fail, "initial", 0, { random }).run;
    const order = [];
    for (let seq = 1; seq < 20; seq++) {
        const step = advance(run, POISON, 3600, {});
        if (!step.save) {
            order.push(step.run.endReason);
            break;
        }
        order.push(step.save.at);
        run = recordSave(step.run, POISON, { seq, kind: "stage", degree: success, dueAt: step.save.at, messageId: `m${seq}` }, { random }).run;
    }
    assert.deepEqual(order, [6, "recovered"]);
    let failing = applyDegree(run0(), POISON, fail, "initial", 0, { random }).run;
    const times = [];
    for (let seq = 1; seq < 20; seq++) {
        const step = advance(failing, POISON, 3600, {});
        if (!step.save) {
            times.push(step.run.endReason);
            break;
        }
        times.push(step.save.at);
        failing = recordSave(step.run, POISON, { seq, kind: "stage", degree: fail, dueAt: step.save.at, messageId: `m${seq}` }, { random }).run;
    }
    assert.deepEqual(times, [6, 12, 18, 24, 30, "max-duration"]);
});

test("both combat anchors: due at the end of the anchor's turn one interval later, by initiative", () => {
    const anchor = { combatId: "c1", initiative: 15 };
    assert.equal(isDue(106, 100, anchor, { id: "c1", initiative: 20 }), false);
    assert.equal(isDue(106, 106, anchor, { id: "c1", initiative: 20 }), false, "a turn before the anchor's");
    assert.equal(isDue(106, 106, anchor, { id: "c1", initiative: 15 }), false, "the anchor's own turn is still running");
    assert.equal(isDue(106, 106, anchor, { id: "c1", initiative: 10 }), true, "the anchor's turn has ended");
    assert.equal(isDue(106, 112, anchor, { id: "c1", initiative: 25 }), true, "the next round");
    assert.equal(isDue(106, 106, anchor, null), true, "outside the encounter, the clock alone");
    assert.equal(isDue(106, 106, null, { id: "c1", initiative: 25 }), true);
    // The victim-turn anchor is the same comparison with the victim's initiative.
    const victim = { combatId: "c1", initiative: 8 };
    assert.equal(isDue(106, 106, victim, { id: "c1", initiative: 10 }), false);
    assert.equal(isDue(106, 106, victim, { id: "c1", initiative: 5 }), true);
});

test("dice: a formula rolled with the given random, weeks as days; a dice interval is rolled when its stage starts", () => {
    assert.equal(rollFormula("2d6+1", () => 0), 3);
    assert.equal(rollFormula("(1d4)*7", () => 0.99), 28);
    assert.deepEqual(rollDuration({ formula: "1d4", unit: "hours" }, () => 0), { seconds: 3600, formula: "1d4 hours", rolled: 1 });
    assert.deepEqual(rollDuration({ value: 2, unit: "rounds" }), { seconds: 12 });
    assert.deepEqual(rollDuration(null), { seconds: null });
});

test("definitions: world first, then override on parse, then parse; an override fixes intervals, adds kinds and keeps prose", () => {
    const parsed = { ...POISON, stages: [{ ...stage(1), duration: null, unparsed: true }, stage(2)], problems: ["interval-1"], confidence: "partial" };
    const over = applyOverride(parsed, { stages: { 1: { duration: { value: 1, unit: "rounds" } } }, traits: ["virulent"], prose: [2], reExposure: "none" });
    assert.equal(over.stages[0].unparsed, undefined);
    assert.equal(over.stages[1].unparsed, true);
    assert.ok(over.traits.includes("virulent"));
    assert.equal(over.reExposure, "none");
    assert.deepEqual(over.problems, []);
    assert.equal(resolveDefinition({ world: { ...POISON, save: { type: "will", value: 9 } }, override: {}, parsed }).save.type, "will");
    assert.equal(resolveDefinition({ override: { traits: ["x"] }, parsed }).origin, "override");
    assert.equal(resolveDefinition({ parsed }).origin, "parse");
    assert.equal(definitionDigest(POISON), definitionDigest(JSON.parse(JSON.stringify(POISON))));
    assert.notEqual(definitionDigest(POISON), definitionDigest(ONSET));
});

test("who rolls: the owner, the GM for NPCs, waiting while nobody may", () => {
    assert.deepEqual(rollerFor({ playerOwned: true, ownerConnected: true, gmConnected: false }), { roller: "owner", auto: false });
    assert.deepEqual(rollerFor({ playerOwned: true, ownerConnected: true, gmConnected: true }, { pcSaves: "auto" }), { roller: "owner", auto: true });
    assert.deepEqual(rollerFor({ playerOwned: true, ownerConnected: false, gmConnected: true }), { roller: "nobody", auto: false, waiting: "owner" });
    assert.equal(rollerFor({ playerOwned: true, ownerConnected: false, gmConnected: true }, { gmRollsForOfflinePCs: true }).roller, "gm");
    assert.deepEqual(rollerFor({ playerOwned: false, ownerConnected: false, gmConnected: true }), { roller: "gm", auto: true });
    assert.deepEqual(rollerFor({ playerOwned: false, ownerConnected: false, gmConnected: false }), { roller: "nobody", auto: false, waiting: "gm" });
});

test("the backend by feature detection; Affliction Forge's route", () => {
    assert.equal(chooseBackend({ dataModels: {}, documentTypes: ["effect"] }), "effect");
    assert.equal(chooseBackend({ dataModels: { affliction: class {} }, documentTypes: ["effect", "affliction"] }), "native");
    assert.equal(chooseBackend({ dataModels: { affliction: class {} }, documentTypes: { effect: [] } }), "effect");
    assert.equal(forgeRoute({ active: false }), "workshop");
    assert.equal(forgeRoute({ active: true, controllerOnTarget: true }), "skip");
    assert.equal(forgeRoute({ active: true, template: "t", gmConnected: true }), "forge");
    assert.equal(forgeRoute({ active: true, template: "t", gmConnected: false }), "workshop");
    assert.equal(forgeRoute({ active: true, template: "t", gmConnected: false, withoutGm: "wait" }), "wait");
    assert.equal(forgeRoute({ active: true, template: "t", gmConnected: true, handOff: false }), "workshop");
});

test("claims for one target in order; a later claim of the same definition waits behind an open earlier one", () => {
    const a = { id: "a", actor: "A", defKey: "k", at: { world: 1, real: 5 } };
    const b = { id: "b", actor: "A", defKey: "k", at: { world: 1, real: 6 } };
    assert.ok(claimOrder(a, b) < 0);
    assert.equal(waitsBehind(b, [a, b]), true);
    assert.equal(waitsBehind(a, [a, b]), false);
    assert.equal(waitsBehind(b, [{ ...a, resolved: {} }, b]), false);
});

test("the tracker's sources: the schema of AfflictionSystemSource, a badge of stage labels, onset labels during the onset", () => {
    const run = applyDegree(run0(), ONSET, critFail, "initial", 0, { random }).run;
    const labels = { stage: (n) => `Stage ${n}`, onset: "Onset" };
    const src = trackerSource({ id: "trk0000000000000", def: ONSET, run, name: "P", img: "i.webp", labels, allowedTraits: ["poison"] });
    assert.deepEqual(src.system.badge, { type: "counter", value: 2, labels: ["Onset", "Onset", "Onset"] });
    assert.deepEqual(src.system.duration, { value: -1, unit: "unlimited", expiry: null, sustained: false });
    assert.deepEqual(src.system.traits.value, ["poison"]);
    const hidden = trackerSource({ id: "x", def: ONSET, run, name: "P", img: "i", labels, hidden: true, genericName: "An affliction", genericImg: "g" });
    assert.equal(hidden.name, "An affliction");
    assert.equal(hidden.system.unidentified, false, "never unidentified on a player-owned actor (8.10.8)");
    const sys = systemSource(ONSET, run);
    assert.equal(sys.onset, null, "the native onset is never written");
    assert.deepEqual(sys.status, { onset: true, stage: 2, progress: 0 });
    assert.equal(sys.save.value, 18);
});

/* -------------------------------------------- */
/*  After the second M8a review                  */
/* -------------------------------------------- */

test("a re-exposure's save is an initial save against a new exposure: its own modifiers count (Player Core p.431)", () => {
    const active = applyDegree(run0(), POISON, fail, "initial", 0, { random }).run;
    // Blowgun Poisoner's critical hit: a success counts as a failure, so the stage goes up.
    const blowgun = applyDegree(active, POISON, success, "re-exposure", 3, { random, mods: [{ slug: "blowgun-crit" }] });
    assert.equal(blowgun.degree, fail);
    assert.equal(blowgun.run.stage, 2);
    // Pernicious Poison: a successful save still takes the poison's level in poison damage.
    const pernicious = applyDegree(active, POISON, success, "re-exposure", 3, { random, mods: [{ slug: "pernicious-poison" }] });
    assert.equal(pernicious.run.stage, 1);
    assert.deepEqual(pernicious.extras, [{ formula: "2", damageType: "poison", category: null }]);
    // Combustible Poison: a failure adds 1d4 persistent fire.
    const combustible = applyDegree(active, POISON, fail, "re-exposure", 3, { random, mods: [{ slug: "combustible-poison" }] });
    assert.equal(combustible.run.stage, 2);
    assert.deepEqual(combustible.extras, [{ formula: "1d4", damageType: "fire", category: "persistent" }]);
    // Without the exposure's modifiers, the run's own (the first exposure's) are not borrowed.
    assert.deepEqual(applyDegree({ ...active, mods: [{ slug: "pernicious-poison" }] }, POISON, success, "re-exposure", 3, { random, mods: [] }).extras, []);
});

test("King's Sleep: a cumulative condition adds its value on each failed save and never goes down while the affliction lasts (8.10.2)", () => {
    const KINGS = { ...POISON, cumulative: ["drained"], duration: { value: -1, unit: "unlimited", expiry: null },
        stages: [stage(1, [{ slug: "drained", value: 1, linked: true }]), stage(2, [{ slug: "drained", value: 1, linked: true }]),
            stage(3, [{ slug: "drained", value: 2, linked: true }])] };
    const first = applyDegree(run0(), KINGS, fail, "initial", 0, { random });
    assert.equal(first.effects.failed, true);
    assert.deepEqual(first.effects.cumulative, ["drained"]);
    const had = (value) => [{ id: "c1", slug: "drained", value, grantedBy: "trk", linked: true }];
    // A failed save from stage 1 to 2: drained 1 + 1.
    const up = applyDegree(first.run, KINGS, fail, "stage", 6, { random });
    assert.deepEqual(stageConditionPlan("trk", up.effects.conditions, had(1), up.effects), { deletes: [], updates: [{ id: "c1", value: 2 }], creates: [] });
    // A failed save at stage 3 (the highest repeats): drained 2 more.
    const top = applyDegree({ ...first.run, stage: 3 }, KINGS, fail, "stage", 6, { random });
    assert.deepEqual(stageConditionPlan("trk", top.effects.conditions, had(4), top.effects).updates, [{ id: "c1", value: 6 }]);
    // A success from stage 3 to 2: drained stays where it is.
    const down = applyDegree({ ...first.run, stage: 3 }, KINGS, success, "stage", 6, { random });
    assert.equal(down.effects.failed, false);
    assert.deepEqual(stageConditionPlan("trk", down.effects.conditions, had(4), down.effects), { deletes: [], updates: [], creates: [] });
    // Without the rule, the stage's value is set (pf2e's handleStageChange): the old reading.
    assert.deepEqual(stageConditionPlan("trk", up.effects.conditions, had(1), {}).updates, []);
});

test("Nethershade: a detached stage condition outlasts its stage and the affliction (8.10.2)", () => {
    const NETHER = { ...POISON, detach: ["enfeebled"], stages: [stage(1), stage(2, [{ slug: "enfeebled", value: 1, linked: true }]),
        stage(3, [{ slug: "enfeebled", value: 2, linked: true }])] };
    const at2 = enterStage({ ...run0(), phase: "active", stage: 1 }, NETHER, 2, 0, { random });
    assert.deepEqual(at2.effects.conditions, [{ slug: "enfeebled", value: 1, linked: false }]);
    assert.equal(grantOnDelete(at2.effects.conditions[0]), "detach");
    const back = enterStage({ ...run0(), phase: "active", stage: 2 }, NETHER, 1, 6, { random });
    assert.deepEqual(stageConditionPlan("trk", back.effects.conditions, [{ id: "e1", slug: "enfeebled", value: 1, grantedBy: "trk", linked: false }]).deletes, [],
        "not removed when the stage changes");
    const merged = applyOverride({ ...POISON, problems: [] }, { cumulative: ["drained"], detach: ["enfeebled"], intro: "table" });
    assert.deepEqual([merged.cumulative, merged.detach, merged.intro.rule], [["drained"], ["enfeebled"], "table"]);
});
