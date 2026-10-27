/**
 * Treasure Vault (Remastered) variants (DESIGN.md 6.16, 15.1 "Variants"), the pure math: one group at a time, Complex
 * Crafting's rushed finishing and sub-day setups, crafting events, Critical Crafting, Deconstruct, Grow, gardens, gifts,
 * quests and adjustments. Book vectors are checked against Treasure Vault (Remastered) pp.157-175 and GM Core pp.46, 133.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PERMANENT_PRICE_MAX, TREASURE_BY_ENCOUNTER, VARIANT_GROUPS } from "../../scripts/data/variants.mjs";
import { rushOptions } from "../../scripts/logic/complex.mjs";
import { DEGREE, RANK } from "../../scripts/logic/core.mjs";
import { settleCheck } from "../../scripts/logic/craft.mjs";
import { DEFAULT_RULES, rulesWith } from "../../scripts/logic/defaults.mjs";
import { isDayRecord, planDays, resolvedThrough } from "../../scripts/logic/downtime.mjs";
import { expiryReason } from "../../scripts/logic/expiry.mjs";
import { lineValueCp, materialsCp } from "../../scripts/logic/materials.mjs";
import { workDayRecord } from "../../scripts/logic/orders.mjs";
import { crafterRate, reductionCp, remainingCp, setupComplete } from "../../scripts/logic/progress.mjs";
import {
    adjustmentFits, adjustmentsPlan, allFound, anyVariantOn, assemblyNeeded, assemblyOutcome, canRushFinish, checkHidden, componentsExcessCp,
    componentsExpired, componentsRecord, componentsRuinCp, craftSkill, craftTypeOn, criticalOf, criticalRecord, curseEffectData, deconstructCredit,
    deconstructGates, encounterBudgetCp, eventKey, eventPause, eventRecord, eventResult, eventSlot, eventsDue, flatCheckDegree, followOnCredit,
    gardenLimit, gardenRoom, gardenSeedCostCp, giftDormant, giftRecord, growSkill, makeGarden, makeQuest, mixedGroups, moneyDegree, openEvent,
    produceStamp, questBudget, questCost, rushDay, rushFinishOutcome, rushedFinishDC, rushedInAttempt, seasonCp, seasonIndexOf, seasonRecord,
    seasonsDue, secretRoll, setupHoursRecord, variantGroupsOn, variantRecordId, workedDays,
} from "../../scripts/logic/variants.mjs";

const stamp = { by: "u1", at: { world: 0, real: 1 } };
const on = (variants) => rulesWith({ variants });

test("every variant is off by default, and the groups follow the book (TV-R p.157)", () => {
    const keys = Object.values(VARIANT_GROUPS).flat();
    for (const key of keys) assert.equal(DEFAULT_RULES.variants[key], false, key);
    assert.deepEqual(variantGroupsOn(DEFAULT_RULES), []);
    assert.equal(anyVariantOn(DEFAULT_RULES), false);
    assert.deepEqual(variantGroupsOn(on({ complexCrafting: true, events: true })), ["alternate"]);
    assert.equal(mixedGroups(on({ complexCrafting: true, events: true })), false, "one group, however many of its variants");
    assert.deepEqual(variantGroupsOn(on({ complexCrafting: true, grow: true })), ["alternate", "nature"]);
    assert.equal(mixedGroups(on({ gardens: true, quests: true })), true, "nature and story together are noticed too");
    assert.deepEqual([craftTypeOn("grow"), craftTypeOn("grow", on({ grow: true })), craftTypeOn("item"), craftTypeOn("quest", on({ quests: true }))],
        [false, true, true, true]);
});

/* -------------------------------------------- */
/*  Complex Crafting                             */
/* -------------------------------------------- */

test("the rushed finish's flat check DC: a legendary 15th-level crafter on a 15th-level item is DC 2 with or without PwL (6.16.1)", () => {
    // pf2e's proficiency modifier: level + 8 at legendary; under Proficiency without Level, 8 alone.
    assert.equal(rushedFinishDC({ itemLevel: 15, proficiency: 15 + 8 }), 2);
    assert.equal(rushedFinishDC({ itemLevel: 15, proficiency: 8, pwol: true }), 2, "not 17");
    assert.equal(rushedFinishDC({ itemLevel: 4, proficiency: 9 + 4 }), 1, "an expert 9th-level crafter on a 4th-level item");
});

test("a flat check: DC 1 or lower always succeeds; degrees by 10 and the natural 20 or 1", () => {
    assert.equal(flatCheckDegree(1, 1), DEGREE.success);
    assert.equal(flatCheckDegree(1, 2), DEGREE.critFail);
    assert.equal(flatCheckDegree(2, 2), DEGREE.success);
    assert.equal(flatCheckDegree(12, 2), DEGREE.critSuccess);
    assert.equal(flatCheckDegree(20, 15), DEGREE.critSuccess);
    assert.equal(flatCheckDegree(10, 11), DEGREE.fail);
    assert.equal(flatCheckDegree(20, 25), DEGREE.fail, "DC 21 or higher fails");
    assert.deepEqual([3, 2, 1].map((d) => rushFinishOutcome(d)), ["fine", "fine", "quirk"]);
    assert.equal(rushFinishOutcome(DEGREE.critFail), "ruined");
    assert.equal(rushFinishOutcome(DEGREE.critFail, on({ complexRushCritFail: "cursed" })), "cursed");
});

test("a rushed day doubles the crafter's reduction, never a helper's, and only for an expert under Complex Crafting", () => {
    const rules = on({ complexCrafting: true });
    const record = { kind: "extra", crafterCp: 200, helpers: { h: 50 } };
    assert.deepEqual(rushDay(record, RANK.expert, rules), { kind: "extra", crafterCp: 400, helpers: { h: 50 }, rushed: true });
    assert.equal(rushDay(record, RANK.trained, rules), record, "a trained crafter cannot rush");
    assert.equal(rushDay(record, RANK.master, DEFAULT_RULES), record, "the variant is off");
    assert.equal(rushDay({ kind: "setup" }, RANK.master, rules).rushed, undefined, "a setup day is never rushed");
    assert.deepEqual([canRushFinish(RANK.trained, rules), canRushFinish(RANK.expert, rules)], [false, true]);
});

test("a run of mixed rushed and normal days: the order's rush toggle decides each day as it is resolved", () => {
    const rules = on({ complexCrafting: true });
    const order = { id: "o", attempt: 1, status: "finishing", check: { degree: DEGREE.success, settled: true, level: 5, rank: RANK.expert }, helpers: {},
        priceCp: 6500, upfrontCp: 3250, variant: {} };
    const crafter = { actorId: "a", level: 5, rank: RANK.expert };
    const normal = workDayRecord(order, 1, crafter, [], stamp, rules).record;
    const rushed = workDayRecord({ ...order, variant: { rushFinish: true } }, 2, crafter, [], stamp, rules).record;
    assert.deepEqual([normal.crafterCp, normal.rushed, rushed.crafterCp, rushed.rushed], [100, undefined, 200, true]);
    assert.equal(reductionCp(order, [normal, rushed], rules), 300);
    assert.equal(rushedInAttempt(order, [normal]), false);
    assert.equal(rushedInAttempt(order, [normal, rushed]), true);
    assert.equal(rushedInAttempt({ ...order, attempt: 2 }, [rushed]), false, "another attempt's rushed day does not count");
});

test("the start form's rush choices: one per rush the rank allows, each with the days left and the DC added", () => {
    const input = { itemLevel: 5, crafterLevel: 5, consumable: false, route: "known", rank: RANK.master };
    assert.deepEqual(rushOptions(input).map((o) => [o.rush, o.days, o.hours, o.dcAdd]), [[0, 3, 0, 0], [1, 2, 0, 5], [2, 1, 0, 10]]);
    // A consumable at the crafter's level with the formula: 1 day, rushed to 4 hours by an expert.
    assert.deepEqual(rushOptions({ ...input, consumable: true, rank: RANK.legendary }).map((o) => [o.rush, o.days, o.hours]), [[0, 1, 0], [1, 0, 4]]);
    // Quick Setup at exactly 6 levels below: 2 hours for a consumable; at 5 below it does nothing.
    const quick = { itemLevel: 1, crafterLevel: 7, consumable: true, route: "none", rank: RANK.master, quickSetup: true };
    assert.deepEqual(rushOptions(quick).at(-1), { rush: 1, days: 0, hours: 2, dcAdd: 5, quick: true });
    assert.deepEqual(rushOptions({ ...quick, itemLevel: 2 }).at(-1), { rush: 1, days: 0, hours: 4, dcAdd: 5, quick: false });
});

test("a sub-day setup stays in setup until its setup-hours record exists, even one made on a day spent on something else", () => {
    const order = { id: "o2", attempt: 1, setup: { days: 0, hours: 4 } };
    assert.equal(setupComplete(order, []), false);
    // The crafter's day 5 went to another order; the hours were recorded that same day.
    const other = { id: "a-5", actor: "a", day: 5, toDay: 5, order: "o1", attempt: 1, kind: "extra" };
    const hours = setupHoursRecord({ actorId: "a", day: 5, order, hours: 4, worldTime: 432000 }, stamp);
    assert.equal(hours.id, variantRecordId("a", 5, "o2"));
    assert.notEqual(hours.id, other.id, "a variant record never overwrites the day record");
    assert.equal(isDayRecord(hours), false);
    assert.equal(resolvedThrough("a", [other, hours]), 5, "and does not count toward resolvedThrough");
    assert.equal(resolvedThrough("a", [hours]), null);
    assert.equal(setupComplete(order, [other, hours]), true);
});

test("the planner stops at a sub-day setup for its Set up now, and lets the day go once the hours are recorded", () => {
    const rules = on({ complexCrafting: true });
    const order = { id: "o", crafter: "Actor.a", attempt: 1, status: "setup", setup: { days: 0, hours: 4 }, helpers: {}, skill: "crafting" };
    const plan = planDays({ actorId: "a", actorUuid: "Actor.a", days: [3], activity: { kind: "craft", ref: "o" }, orders: [order] }, stamp, rules);
    assert.deepEqual([plan.records.length, plan.stop?.reason], [0, "setup-hours"]);
    const hours = setupHoursRecord({ actorId: "a", day: 2, order, hours: 4 }, stamp);
    const after = planDays({ actorId: "a", actorUuid: "Actor.a", days: [3], activity: { kind: "craft", ref: "o" }, orders: [order], records: [hours] }, stamp, rules);
    assert.deepEqual([after.records.length, after.stop?.reason, after.status.o], [0, "check", "check"], "the setup is done: the check is due");
});

/* -------------------------------------------- */
/*  Crafting downtime events                     */
/* -------------------------------------------- */

test("event cadence: one in a week or a month, four in a year (GM Core p.46), first on the 7th day", () => {
    const rules = on({ events: true });
    assert.deepEqual([6, 7, 30, 97, 98, 189, 280, 365].map((n) => eventsDue(n, rules)), [0, 1, 1, 1, 2, 3, 4, 4]);
    assert.equal(eventsDue(365, DEFAULT_RULES), 0, "off: none");
    assert.equal(eventsDue(10, on({ events: true, eventsFirstDay: 3, eventsEveryDays: 2 })), 4);
    assert.deepEqual([eventResult(3), eventResult(4)].map((r) => r.gmCore), [true, false]);
});

test("event keys: per order, attempt and number, so a day resolved twice rolls nothing new; a retry starts again", () => {
    assert.equal(eventKey("o", 1, 1), "event:o:1:1");
    assert.notEqual(eventKey("o", 2, 1), eventKey("o", 1, 1));
    assert.equal(eventSlot(2, 1), "2-1");
    const order = { id: "o", attempt: 1, events: { "1-1": eventRecord({ order: { id: "o", attempt: 1 }, k: 1, day: 7, roll: 12 }, stamp) } };
    assert.equal(openEvent(order).k, 1);
    assert.equal(openEvent({ ...order, attempt: 2 }), null, "another attempt's event does not count");
    const days = Array.from({ length: 7 }, (_, i) => ({ actor: "a", day: i + 1, order: "o", attempt: 1, kind: i < 1 ? "setup" : "extra" }));
    assert.equal(workedDays(order, [...days, ...days]), 7, "a day written twice is one day");
});

test("with pauses on, an open or unrolled event stops the order's days; any member's resolve lets them go on", () => {
    const rules = on({ events: true, eventsPauses: true });
    const order = { id: "o", attempt: 1, events: {} };
    const days = Array.from({ length: 7 }, (_, i) => ({ actor: "a", day: i + 1, order: "o", attempt: 1, kind: "extra" }));
    assert.equal(eventPause(order, days.slice(0, 6), rules), null);
    assert.equal(eventPause(order, days, rules), "event-due");
    const rolled = { ...order, events: { "1-1": { ...eventRecord({ order, k: 1, day: 7, roll: 9 }, stamp) } } };
    assert.equal(eventPause(rolled, days, rules), "event");
    rolled.events["1-1"].status = "resolved";
    assert.equal(eventPause(rolled, days, rules), null);
    assert.equal(eventPause(order, days, on({ events: true })), null, "without pauses, days go on");
    // The planner stops on the day after the 7th.
    const finishing = { ...order, crafter: "Actor.a", status: "finishing", check: { degree: DEGREE.success, settled: true, level: 5, rank: 2 }, helpers: {},
        priceCp: 100000, upfrontCp: 50000 };
    const plan = planDays({ actorId: "a", actorUuid: "Actor.a", days: [8, 9], activity: { kind: "craft", ref: "o" }, orders: [finishing], records: days,
        facts: { level: 5, ranks: { crafting: 2 } } }, stamp, rules);
    assert.deepEqual([plan.records.length, plan.stop?.reason, plan.stop?.day], [0, "event-due", 8]);
});

/* -------------------------------------------- */
/*  Critical Crafting                            */
/* -------------------------------------------- */

test("Critical Crafting triggers: natural 20s and 1s by default, any critical by setting, special orders only by default", () => {
    const rules = on({ criticalCrafting: true });
    const special = { variant: { special: true } };
    assert.deepEqual(criticalOf({ degree: DEGREE.critSuccess, die: 20 }, special, rules), { kind: "success", natural: true });
    assert.deepEqual(criticalOf({ degree: DEGREE.critFail, die: 1 }, special, rules), { kind: "failure", natural: true });
    assert.equal(criticalOf({ degree: DEGREE.critSuccess, die: 17 }, special, rules), null, "not natural");
    assert.deepEqual(criticalOf({ degree: DEGREE.critSuccess, die: 17 }, special, on({ criticalCrafting: true, criticalTrigger: "any" })),
        { kind: "success", natural: false });
    assert.equal(criticalOf({ degree: DEGREE.critSuccess, die: 20 }, {}, rules), null, "special only");
    assert.notEqual(criticalOf({ degree: DEGREE.critSuccess, die: 20 }, {}, on({ criticalCrafting: true, criticalSpecialOnly: false })), null);
    assert.equal(criticalOf({ degree: DEGREE.success, die: 20 }, special, rules), null, "a natural 20 that is only a success");
    assert.equal(criticalOf({ degree: DEGREE.critSuccess, die: 20 }, special, DEFAULT_RULES), null, "off");
});

test("replace versus alongside in the reduction totals and the ruin (6.16.4)", () => {
    const rules = on({ criticalCrafting: true, criticalSpecialOnly: false, criticalMode: "replace" });
    const crit = { degree: DEGREE.critSuccess, die: 20, level: 5, rank: RANK.expert };
    const replace = { ...crit, critical: criticalRecord(crit, {}, rules, stamp) };
    const alongside = { ...crit, critical: criticalRecord(crit, {}, on({ criticalCrafting: true, criticalSpecialOnly: false }), stamp) };
    assert.deepEqual([replace.critical.mode, alongside.critical.mode], ["replace", "alongside"]);
    const today = { level: 5, rank: RANK.expert };
    assert.equal(crafterRate(replace, today), 100, "replace: the success rate");
    assert.equal(crafterRate(alongside, today), 200, "alongside: the critical's own rate");
    assert.equal(moneyDegree(replace), DEGREE.success);
    // A critical failure under replace ruins nothing: the whole commit is released.
    const fail = { degree: DEGREE.critFail, die: 1, level: 5, rank: 2 };
    const failReplace = { ...fail, critical: criticalRecord(fail, {}, rules, stamp) };
    const settled = settleCheck({ status: "rolled", check: failReplace }, { committedCp: 1000 });
    assert.deepEqual([settled.patch.status, settled.rows], ["failed", [{ kind: "release", cp: 1000 }]]);
    const usual = settleCheck({ status: "rolled", check: fail }, { committedCp: 1000 });
    assert.deepEqual(usual.rows, [{ kind: "ruin", cp: 100 }, { kind: "release", cp: 900 }]);
    assert.equal(criticalRecord({ ...crit, critical: replace.critical }, {}, DEFAULT_RULES), replace.critical, "a record is kept, whatever the setting says now");
});

test("secret rolls: only with a GM connected; players see 'rolled (secret)' until it settles or a GM reveals it", () => {
    const rules = on({ criticalCrafting: true, criticalSecret: true });
    assert.equal(secretRoll({ variant: { special: true } }, rules, true), true);
    assert.equal(secretRoll({ variant: { special: true } }, rules, false), false, "no GM: no effect (P2)");
    assert.equal(secretRoll({ variant: {} }, rules, true), false, "special only");
    assert.equal(secretRoll({ variant: { special: true } }, on({ criticalCrafting: true }), true), false);
    const check = { degree: 3, secret: true, settled: false };
    assert.equal(checkHidden(check, { isGM: false }), true);
    assert.equal(checkHidden(check, { isGM: true }), false);
    assert.equal(checkHidden({ ...check, settled: true }, { isGM: false }), false);
    assert.equal(checkHidden({ ...check, revealed: true }, { isGM: false }), false);
});

test("the crafter's curse: a status penalty to Crafting of the size entered, at least 1", () => {
    const data = curseEffectData({ name: "Curse", size: 2, order: "o", img: "x.svg" });
    assert.deepEqual(data.system.rules[0], { key: "FlatModifier", selector: "crafting", type: "status", value: -2, slug: "artisans-workshop-crafter-curse" });
    assert.deepEqual(data.flags["pf2e-artisans-workshop"].curse, { order: "o", size: 2 });
    assert.equal(curseEffectData({ name: "c", size: 0, order: "o" }).system.rules[0].value, -1);
});

/* -------------------------------------------- */
/*  Deconstruct                                  */
/* -------------------------------------------- */

test("Deconstruct credit for both purposes and degrees (TV-R p.162), and the loss after unrepaired retries", () => {
    const price = 10000;   // 100 gp
    const credit = (purpose, degree, lossPct = 0) => deconstructCredit({ priceCp: price, degree, purpose, lossPct });
    assert.deepEqual([credit("similar", 2), credit("similar", 3), credit("raw", 2), credit("raw", 3)], [7500, 8000, 5000, 5500]);
    assert.deepEqual([credit("similar", 1), credit("raw", 0)], [0, 0]);
    assert.equal(credit("similar", 2, 5), 7125, "75% of 95 gp: 71 gp 2 sp 5 cp");
    assert.equal(credit("similar", 2, 10), 6750, "two unrepaired retries");
});

test("Deconstruct gates: level, rank, the feat by kind, the tools, the workshop, custody; no consumables, cursed items or artifacts", () => {
    const crafter = { level: 9, ranks: { crafting: RANK.expert }, feats: ["magical-crafting"], lockedBy: null };
    const item = { level: 8, traits: ["magical"], priceCp: 50000 };
    const gates = (over = {}, extra = {}) => deconstructGates({ crafter, item: { ...item, ...over }, tools: { available: ["artisans-toolkit"] }, held: true,
        workshop: true, orderId: "o", ...extra });
    const failing = (list) => list.filter((g) => !g.ok).map((g) => [g.id, g.reason]);
    assert.deepEqual(failing(gates()), []);
    assert.deepEqual(failing(gates({ level: 10 })), [["G2", "item-level"], ["G3", "rank"]]);
    assert.deepEqual(failing(gates({ traits: ["alchemical"] })), [["G4", "feats"], ["G7", "tool"]], "Alchemical Crafting and a lab");
    assert.deepEqual(failing(gates({ traits: ["consumable", "magical"] })), [["G12", "consumable"]]);
    assert.deepEqual(failing(gates({ traits: ["cursed", "magical"] })), [["G12", "hard-to-destroy"]]);
    assert.deepEqual(failing(gates({ priceCp: 0 })), [["G12", "no-price"]]);
    assert.deepEqual(failing(gates({}, { held: false, workshop: false })), [["G9", "workshop"], ["G10", "target-not-held"]]);
});

test("components: the credit at the purpose or raw, the expiry day, the one line's value and its excess paying the remainder", () => {
    const rules = on({ deconstruct: true, deconstructExpiryDays: 30 });
    const record = componentsRecord({ priceCp: 10000, degree: DEGREE.success, purpose: "similar", lossPct: 5, order: "d", from: "U", day: 10 }, stamp, rules);
    assert.deepEqual([record.valueCp, record.rawCp, record.expiresDay], [7125, 4750, 40]);
    assert.deepEqual([componentsExpired(record, 40), componentsExpired(record, 41)], [false, true]);
    assert.equal(componentsRecord({ priceCp: 100, degree: 2, purpose: "raw", order: "d", from: "U", day: 1 }, stamp, DEFAULT_RULES).expiresDay, null);
    const line = { id: "l", valueCp: 4750, components: record };
    const order = { priceCp: 10000, upfrontCp: 5000, checklist: {}, materials: { l: line } };
    assert.equal(lineValueCp(line, order), 4750, "not confirmed similar: the raw share");
    assert.equal(materialsCp(order), 4750);
    assert.equal(componentsExcessCp(order), 0, "it covers the up-front half only");
    const similar = { ...order, checklist: { similar: { confirmedBy: "u" } } };
    assert.equal(materialsCp(similar), 7125);
    assert.equal(componentsExcessCp(similar), 2125);
    assert.equal(remainingCp(similar, []), 10000 - 5000 - 2125, "the credit above the half pays the remainder");
    const big = { ...similar, priceCp: 6000, upfrontCp: 3000 };
    assert.equal(remainingCp(big, []), 0, "anything above the Price is lost");
    assert.equal(componentsRuinCp(7125), 713);
    assert.equal(lineValueCp({ ...line, ruinedCp: 713 }, similar), 7125 - 713);
});

test("the follow-on's setup credit: a setup record for the follow-on's attempt, or the attempt its start will create", () => {
    const credit = followOnCredit({ actorId: "a", day: 4, followOn: { id: "f", attempt: 0, status: "accepted" }, from: "d" }, stamp);
    assert.deepEqual([credit.id, credit.order, credit.attempt, credit.kind, isDayRecord(credit)], ["a-4-f", "f", 1, "setup", false]);
    assert.equal(followOnCredit({ actorId: "a", day: 4, followOn: { id: "f", attempt: 2, status: "setup" }, from: "d" }, stamp).attempt, 2);
    assert.equal(setupComplete({ id: "f", attempt: 1, setup: { days: 1, hours: 0 } }, [credit]), true, "the deconstruct day is its setup day");
});

/* -------------------------------------------- */
/*  Grow                                         */
/* -------------------------------------------- */

test("Grow's skills (TV-R p.165): Crafting, Nature, or Nature with Arcana for every other Craft", () => {
    assert.deepEqual([growSkill(on({ grow: true })), craftSkill(on({ grow: true }))], ["crafting", "crafting"]);
    assert.deepEqual([growSkill(on({ grow: true, natureSkills: "nature" })), craftSkill(on({ grow: true, natureSkills: "nature" }))], ["nature", "crafting"]);
    assert.deepEqual([growSkill(on({ grow: true, natureSkills: "nature-arcana" })), craftSkill(on({ grow: true, natureSkills: "nature-arcana" }))],
        ["nature", "arcana"]);
    assert.equal(craftSkill(on({ natureSkills: "nature-arcana" })), "crafting", "Grow off: nothing changes");
});

test("Lini's leaf weave armor (TV-R p.165): 2 gp up front, 5 days at a critical success take 1 gp off, 1 gp left", () => {
    const order = { id: "g", craftType: "grow", attempt: 1, status: "finishing", priceCp: 400, upfrontCp: 200, helpers: {},
        check: { degree: DEGREE.critSuccess, settled: true, level: 0, rank: RANK.trained } };
    const days = Array.from({ length: 5 }, (_, i) => workDayRecord(order, i + 5, { actorId: "l", level: 0, rank: RANK.trained }, [], stamp).record);
    assert.deepEqual(days.map((d) => d.crafterCp), [20, 20, 20, 20, 20], "2 sp a day");
    assert.equal(remainingCp(order, days), 100);
});

test("season boundaries by day count, and one season check per season in which the crafter grew it", () => {
    const seasonOf = (day) => seasonIndexOf(day, { startDay: 10, seasonDays: 91 });
    assert.deepEqual([10, 100, 101, 191, 192].map(seasonOf), [0, 0, 1, 1, 2]);
    const order = { id: "g", craftType: "grow", attempt: 1, status: "finishing", check: { degree: DEGREE.success, settled: true },
        variant: { grow: { mode: "untended", since: 20 } } };
    const worked = (day) => ({ id: `a-${day}`, actor: "a", day, order: "g", attempt: 1, kind: "extra" });
    // Season 0 (days 10-100) was worked; season 1 (101-191) was not; today is in season 2.
    assert.deepEqual(seasonsDue({ order, days: [worked(15), worked(30)], today: 200, seasonOf }), [{ season: 0, endDay: 100 }]);
    assert.deepEqual(seasonsDue({ order, days: [worked(30)], today: 100, seasonOf }), [], "season 0 has not ended");
    const record = seasonRecord({ actorId: "a", order, season: 0, endDay: 100, degree: DEGREE.success, level: 8, rank: RANK.expert }, stamp);
    assert.deepEqual([record.id, record.kind, record.crafterCp, isDayRecord(record)], ["a-100-g", "season", 300, false], "8th level, expert: 3 gp");
    assert.deepEqual(seasonsDue({ order, days: [worked(30), record], today: 200, seasonOf }), [], "once per season");
    assert.deepEqual(seasonsDue({ order: { ...order, variant: { grow: { mode: "tended" } } }, days: [worked(30)], today: 200, seasonOf }), [],
        "only an untended order");
    assert.deepEqual(seasonsDue({ order: { ...order, variant: { grow: { mode: "untended", since: 150 } } }, days: [worked(30)], today: 200, seasonOf }), [],
        "a season that ended before it was left untended");
    assert.equal(reductionCp(order, [record]), 300, "a season check takes its day off the remainder");
});

test("a season check's amount: one day of Income, level + 1 on a critical success, nothing below a success", () => {
    // Income Earned (Player Core p.228): 8th level expert 3 gp, 9th level expert 4 gp.
    assert.deepEqual([3, 2, 1, 0].map((d) => seasonCp(d, 8, RANK.expert)), [400, 300, 0, 0]);
});

/* -------------------------------------------- */
/*  Gardens                                      */
/* -------------------------------------------- */

test("the garden seed cost: a greater antidote (level 10) costs 2,000 gp (TV-R p.167); GM Core Table 2-19's tops", () => {
    assert.equal(gardenSeedCostCp(10), 200000);
    assert.deepEqual(PERMANENT_PRICE_MAX.map((cp) => cp / 100),
        [20, 35, 60, 100, 160, 250, 360, 500, 700, 1000, 1400, 2000, 3000, 4500, 6500, 10000, 15000, 24000, 40000, 70000]);
    assert.equal(gardenSeedCostCp(18), 7000000);
    assert.equal(gardenSeedCostCp(19), 7000000, "past 20: 20's (OQ-43)");
    assert.equal(gardenSeedCostCp(-1), 2000);
});

test("the garden limit: half the party's PCs, rounded down", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(gardenLimit), [0, 0, 1, 1, 2, 2]);
    const garden = makeGarden({ id: "g1", party: "p", name: "Herbs", product: { uuid: "U", level: 10, name: "Antidote" } }, stamp);
    assert.deepEqual([garden.seedCostCp, garden.perDay, garden.plantedDay], [200000, 1, null]);
    assert.deepEqual(gardenRoom([garden], 4, "p"), { ok: true });
    assert.equal(gardenRoom([garden, { ...garden, id: "g2" }], 4, "p").reason, "garden-limit");
    assert.equal(gardenRoom([], 1, "p").reason, "garden-limit", "a party of one keeps none");
});

test("garden produce expires at the end of the harvest day, by the clock and by logged days; nothing preserves it", () => {
    const stampOf = produceStamp({ creator: "Actor.a", day: 5, secondsPerDay: 86400, offset: 3600, garden: "g" });
    assert.deepEqual([stampOf.rule, stampOf.at, stampOf.atDay, stampOf.exempt], ["world", 6 * 86400 - 3600, 6, undefined]);
    assert.equal(expiryReason(stampOf, { worldTime: 6 * 86400 - 3601 }), null);
    assert.equal(expiryReason(stampOf, { worldTime: 6 * 86400 - 3600 }), "time");
    assert.equal(expiryReason(stampOf, { worldTime: 0, loggedDay: 6 }), "day");
});

/* -------------------------------------------- */
/*  Gifts and quests                             */
/* -------------------------------------------- */

test("a bestowed gift is dormant on a holder who is neither its recipient nor an heir, and active again for an heir", () => {
    const gift = giftRecord({ bound: "Actor.a", heirs: ["Actor.b", "Actor.b", null], giver: "the nymph" }, stamp);
    assert.deepEqual(gift.heirs, ["Actor.b"]);
    assert.deepEqual(["Actor.a", "Actor.b", "Actor.c"].map((h) => giftDormant(gift, h)), [false, false, true]);
    assert.equal(giftDormant(null, "Actor.c"), false);
});

test("quest cost: 10% off per encounter, never below half, spread across the encounters (TV-R p.172)", () => {
    assert.deepEqual(questCost(10000, 3), { equivalentCp: 7000, perEncounterCp: 2333, reductionCp: 3000 });
    assert.deepEqual(questCost(10000, 5), { equivalentCp: 5000, perEncounterCp: 1000, reductionCp: 5000 });
    assert.deepEqual(questCost(10000, 8), { equivalentCp: 5000, perEncounterCp: 625, reductionCp: 5000 }, "the floor at half");
    assert.equal(questCost(9999, 9).equivalentCp, 5000, "half rounded up");
});

test("Table 5-3 against GM Core: every level's budgets, and a warning when an encounter's share exceeds its treasure", () => {
    assert.equal(TREASURE_BY_ENCOUNTER.length, 20);
    assert.deepEqual(TREASURE_BY_ENCOUNTER[0], [1300, 1800, 2600, 3500]);
    assert.deepEqual(TREASURE_BY_ENCOUNTER[10], [86500, 115000, 172500, 230000]);
    assert.deepEqual(TREASURE_BY_ENCOUNTER[19], [3680000, 4900000, 7350000, 9800000]);
    assert.equal(encounterBudgetCp(5, "moderate"), 13500);
    assert.equal(encounterBudgetCp(25, "low"), 3680000);
    const quest = makeQuest({ encounters: 3, threats: ["low", "moderate", "severe"] });
    // A 5th-level 160 gp item: 112 gp in three shares of 37 gp 3 sp 3 cp.
    const budget = questBudget(quest, { priceCp: 16000, level: 5 });
    assert.deepEqual(budget.map((b) => [b.threat, b.shareCp, b.budgetCp, b.over]), [["low", 3733, 10000, false], ["moderate", 3733, 13500, false],
        ["severe", 3733, 20000, false]]);
    assert.equal(questBudget(makeQuest({ encounters: 1, threats: ["low"] }), { priceCp: 100000, level: 5 })[0].over, true);
});

test("the assembly rule: no check for three or more encounters in different locations; the outcomes by degree", () => {
    assert.deepEqual([assemblyNeeded({ encounters: 3 }), assemblyNeeded({ encounters: 2 }), assemblyNeeded({ encounters: 4, differentLocations: false })],
        [false, true, true]);
    const quest = makeQuest({ encounters: 2, threats: ["extreme", "low"], labels: ["Scale"] });
    assert.deepEqual(Object.values(quest.components).map((c) => [c.id, c.label, c.threat, c.found]), [["c1", "Scale", "moderate", null], ["c2", "", "low", null]],
        "an extreme encounter is not offered");
    assert.equal(quest.assemblyCheck, true);
    assert.equal(allFound(quest), false);
    quest.components.c1.found = { by: "u" };
    quest.components.c2.found = { by: "v" };
    assert.equal(allFound(quest), true);
    assert.deepEqual([3, 2, 1, 0].map((d) => assemblyOutcome(d)), ["deliver", "deliver", "quirk", "destroyed"]);
    assert.equal(assemblyOutcome(0, on({ questsCritFail: "cursed" })), "cursed");
});

/* -------------------------------------------- */
/*  Adjustments                                  */
/* -------------------------------------------- */

test("an item with adjustments: the Prices added, the highest level and rarity; adjustments fit by usage", () => {
    assert.deepEqual(adjustmentsPlan([{ priceCp: 3000, level: 2 }, { priceCp: 500, level: 1, rarity: "uncommon" }, { priceCp: 600, level: 4 }]),
        { priceCp: 4100, level: 4, rarity: "uncommon" });
    const armor = { type: "armor", category: "medium" };
    const sword = { type: "weapon", range: null };
    const bow = { type: "weapon", range: 60 };
    const adj = (usage) => ({ traits: ["adjustment"], usage });
    assert.equal(adjustmentFits(adj("applied-to-armor"), armor), true);
    assert.equal(adjustmentFits(adj("applied-to-armor"), sword), false);
    assert.equal(adjustmentFits(adj("affixed-to-medium-heavy-armor"), { type: "armor", category: "light" }), false);
    assert.equal(adjustmentFits(adj("attached-to-melee-weapon"), bow), false);
    assert.equal(adjustmentFits(adj("affixed-to-a-ranged-weapon"), bow), true);
    assert.equal(adjustmentFits(adj("applied-to-buckler-shield"), { type: "shield" }), true);
    assert.equal(adjustmentFits({ traits: [], usage: "applied-to-armor" }, armor), false, "not an adjustment");
});
