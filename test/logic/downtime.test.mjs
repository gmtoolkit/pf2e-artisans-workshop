/**
 * Downtime (DESIGN.md 4.8, 9, M6): the workshop day, a PC's status and pending days, the day planner the resolver, the
 * wizard and "Work a day" share, and the wizard's span. Pure parts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE, RANK } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import {
    activityKey, asSettled, clockDayOf, componentsOffset, daySpan, dayRecordsOf, firstOpenDay, helperLockOf, isDayRecord, manualDayOf, notDowntimeRecord,
    openDaysThrough, parseActivity, pcStatusOf, pendingDays, planDays, resolvedThrough, secondsPerDayOf, wageDaysOf, wizardSpan,
    workshopDay, worldClockOffset,
} from "../../scripts/logic/downtime.mjs";
import { wageKey } from "../../scripts/logic/earn-income.mjs";
import { hashId } from "../../scripts/logic/ids.mjs";
import { reductionCp, remainingCp } from "../../scripts/logic/progress.mjs";
import { setupRepair } from "../../scripts/logic/orders.mjs";

const stamp = { by: "u1", at: { world: 0, real: 1 } };

test("seconds per day follow the calendar; 86,400 by default", () => {
    assert.equal(secondsPerDayOf(), 86400);
    assert.equal(secondsPerDayOf({ hoursPerDay: 20, minutesPerHour: 60, secondsPerMinute: 60 }), 72000);
    assert.equal(secondsPerDayOf({ hoursPerDay: 0 }), 86400, "a calendar that says nothing usable falls back");
});

test("the day offset puts the boundary at midnight of the date the table sees (4.8)", () => {
    // pf2e's World Clock: the date is worldCreatedOn plus world time; created at 13:30:15 UTC.
    assert.equal(worldClockOffset("2026-10-26T13:30:15.000Z"), 13 * 3600 + 30 * 60 + 15);
    assert.equal(worldClockOffset("2026-10-26T00:00:00Z"), 0);
    assert.equal(worldClockOffset(null), null);
    assert.equal(worldClockOffset("not a date"), null);
    // A calendar whose time 0 is 06:00.
    assert.equal(componentsOffset({ hour: 6, minute: 0, second: 0 }), 6 * 3600);
    assert.equal(componentsOffset({}), 0);
    // World time 10.5 hours past a 13:30 creation crosses midnight: day 1.
    const offset = worldClockOffset("2026-10-26T13:30:00Z");
    assert.equal(clockDayOf(10 * 3600, { offset }), 0);
    assert.equal(clockDayOf(10.5 * 3600, { offset }), 1);
    assert.equal(clockDayOf(86400 * 3 - 1), 2);
    assert.equal(clockDayOf(86400 * 3), 3);
    assert.throws(() => clockDayOf(Number.NaN), TypeError);
});

test("the workshop day is the maximum of the clock and the logged days, never the sum (4.8)", () => {
    assert.deepEqual(workshopDay({ clockDay: 5 }), { day: 5, clockDay: 5, manualDay: null, ahead: 0 });
    const manual = { a: { toDay: 8 }, b: { toDay: 7 }, junk: { toDay: "9" } };
    assert.equal(manualDayOf(manual), 8);
    assert.deepEqual(workshopDay({ clockDay: 5, manual }), { day: 8, clockDay: 5, manualDay: 8, ahead: 3 }, "3 days logged ahead");
    assert.deepEqual(workshopDay({ clockDay: 6, manual }).day, 8, "a clock advance inside logged days adds nothing");
    assert.deepEqual(workshopDay({ clockDay: 10, manual }), { day: 10, clockDay: 10, manualDay: 8, ahead: 0 }, "one past them counts");
});

test("a PC's status has defaults; its day records exclude variant records; resolved-through is derived", () => {
    assert.deepEqual(pcStatusOf({}, "a"), { id: "a", v: 1, inDowntime: false, since: null, activity: null, standingRoutine: false, lockedBy: null, prepCycle: 0 });
    assert.equal(pcStatusOf({ a: { inDowntime: true, since: 3 } }, "a").since, 3);
    const days = [
        { id: "a-4", actor: "a", day: 4, toDay: 4 }, { id: "a-2", actor: "a", day: 2, toDay: 3 },
        { id: "a-9-o1", actor: "a", day: 9, toDay: 9 },   // a variant record: not a day record (4.8)
        { id: "b-12", actor: "b", day: 12, toDay: 12 },
    ];
    assert.equal(isDayRecord(days[2]), false);
    assert.deepEqual(dayRecordsOf("a", days).map((d) => d.id), ["a-2", "a-4"]);
    assert.equal(resolvedThrough("a", days), 4);
    assert.equal(resolvedThrough("c", days), null);
});

test("pending days: from the day after downtime began or the last resolved day, through the workshop day", () => {
    const on = { inDowntime: true, since: 10 };
    assert.deepEqual(pendingDays({ status: on, day: 10 }), { from: null, to: null, count: 0 }, "the day downtime begins is not one of its days");
    assert.deepEqual(pendingDays({ status: on, day: 11 }), { from: 11, to: 11, count: 1 }, "the clock advanced one day: one pending day");
    assert.deepEqual(pendingDays({ status: on, day: 17 }), { from: 11, to: 17, count: 7 });
    assert.deepEqual(pendingDays({ status: on, resolved: 14, day: 17 }), { from: 15, to: 17, count: 3 });
    assert.deepEqual(pendingDays({ status: on, resolved: 20, day: 17 }).count, 0, "days logged ahead are not pending");
    assert.equal(pendingDays({ status: { inDowntime: false, since: 10 }, day: 17 }).count, 0, "only PCs in downtime accrue");
    assert.equal(firstOpenDay({ status: on, day: 17 }), 11);
    assert.equal(firstOpenDay({ status: { inDowntime: false }, day: 17 }), 18, "not in downtime: the next day");
    assert.equal(firstOpenDay({ status: { inDowntime: false }, resolved: 20, day: 17 }), 21);
    assert.deepEqual(daySpan(3, 5), [3, 4, 5]);
    assert.deepEqual(daySpan(5, 3), []);
});

test("activities as select keys", () => {
    assert.equal(activityKey({ kind: "craft", ref: "o1" }), "craft:o1");
    assert.equal(activityKey({ kind: "other", ref: null }), "other");
    assert.deepEqual(parseActivity("earn:j1"), { kind: "earn", ref: "j1" });
    assert.deepEqual(parseActivity("subsist"), { kind: "subsist", ref: null });
    assert.equal(parseActivity("craft"), null, "a craft activity names its order");
    assert.equal(parseActivity("fishing"), null);
    assert.equal(parseActivity(""), null);
});

/* -------------------------------------------- */
/*  The planner                                  */
/* -------------------------------------------- */

const PC = { actorId: "c1", actorUuid: "Actor.c1" };
const facts = { level: 5, ranks: { crafting: RANK.expert } };
const settled = (degree = DEGREE.success) => ({ degree, level: 5, rank: RANK.expert, settled: true });
const order = (fields = {}) => ({
    id: "o1", status: "setup", attempt: 1, crafter: "Actor.c1", skill: "crafting", setup: { days: 2, hours: 0 }, priceCp: 6500, upfrontCp: 3250,
    helpers: {}, check: null, log: {}, ...fields,
});

test("craft days: setup days move the order to its check, which stops the plan; the rest stay pending", () => {
    const plan = planDays({ ...PC, days: [11, 12, 13, 14], activity: { kind: "craft", ref: "o1" }, orders: [order()], facts }, stamp);
    assert.deepEqual(plan.records.map((r) => [r.id, r.kind]), [["c1-11", "setup"], ["c1-12", "setup"]]);
    assert.deepEqual(plan.status, { o1: "check" });
    assert.deepEqual(plan.stop, { day: 13, reason: "check", ref: "o1" });
    const again = planDays({ ...PC, days: [11, 12, 13, 14], activity: { kind: "craft", ref: "o1" }, orders: [order()], facts }, stamp);
    assert.deepEqual(again, plan, "deterministic: any resolver writes the same records");
    const inCheck = planDays({ ...PC, days: [13], activity: { kind: "craft", ref: "o1" }, orders: [order({ status: "check" })], facts }, stamp);
    assert.deepEqual([inCheck.records.length, inCheck.stop.reason], [0, "check"]);
});

test("extra days take the crafter's rate off once the check is settled; a paid-off order stops (Player Core p.237 vector)", () => {
    const finishing = order({ status: "finishing", check: settled() });
    const plan = planDays({ ...PC, days: [20, 21, 22], activity: { kind: "craft", ref: "o1" }, orders: [finishing], facts }, stamp);
    assert.deepEqual(plan.records.map((r) => [r.kind, r.crafterCp]), [["extra", 100], ["extra", 100], ["extra", 100]]);
    assert.equal(plan.stop, null);
    const rolled = order({ status: "rolled", check: { degree: DEGREE.critSuccess, level: 5, rank: RANK.expert, settled: false } });
    const pending = planDays({ ...PC, days: [20], activity: { kind: "craft", ref: "o1" }, orders: [rolled], facts }, stamp);
    assert.deepEqual(asSettled(rolled).status, "finishing");
    assert.equal(planDays({ ...PC, days: [20], activity: { kind: "craft", ref: "o1" }, orders: [asSettled(rolled)], facts }, stamp).records[0].crafterCp, 200,
        "settled as the critical success it recorded");
    // 13 extra days leave 1,950 cp at a success; 3,250 cp off makes it 0 and the next day stops.
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ id: `c1-${i}`, actor: "c1", day: i, order: "o1", attempt: 1, kind: "extra", crafterCp: 100, helpers: {} }));
    assert.equal(remainingCp(finishing, thirteen), 1950);
    const nearly = order({ status: "finishing", check: settled(), priceCp: 3450 });
    const done = planDays({ ...PC, days: [30, 31, 32], activity: { kind: "craft", ref: "o1" }, orders: [nearly], facts }, stamp);
    assert.deepEqual([done.records.length, done.stop.reason, done.stop.day], [2, "paid-off", 32], "200 cp left: two days, then finish it");
    assert.deepEqual(pending, { records: [], status: {}, wages: [], ext: [], stop: { day: 20, reason: "settle", ref: "o1" } });
});

test("a recorded check that is not settled stops the days whatever its degree: a reroll could still replace it (review fix, 6.2.3)", () => {
    for (const degree of [DEGREE.critFail, DEGREE.fail, DEGREE.success, DEGREE.critSuccess]) {
        const rolled = order({ status: "rolled", check: { degree, level: 5, rank: RANK.expert, settled: false } });
        const plan = planDays({ ...PC, days: [20, 21, 22, 23, 24], activity: { kind: "craft", ref: "o1" }, orders: [rolled], facts }, stamp);
        assert.deepEqual([plan.records.length, plan.stop], [0, { day: 20, reason: "settle", ref: "o1" }], `degree ${degree}`);
    }
    // Settled, a failure takes no days, and a success that is already paid off stops at once.
    assert.equal(asSettled(order({ status: "rolled", check: { degree: DEGREE.fail, settled: false } })).status, "failed");
    const nearly = order({ status: "rolled", priceCp: 3450, check: { degree: DEGREE.success, level: 5, rank: RANK.expert, settled: false } });
    const settledPlan = planDays({ ...PC, days: Array.from({ length: 10 }, (_, i) => 30 + i), activity: { kind: "craft", ref: "o1" }, orders: [asSettled(nearly)], facts }, stamp);
    assert.deepEqual([settledPlan.records.length, settledPlan.stop.reason], [2, "paid-off"]);
    assert.equal(asSettled(order({ status: "finishing", check: settled() })).status, "finishing", "anything else is left as it is");
});

test("a setup the day records already completed stops at its check: no setup day past the count (review fix)", () => {
    const records = [{ id: "c1-11", actor: "c1", day: 11, order: "o1", attempt: 1, kind: "setup" }, { id: "c1-12", actor: "c1", day: 12, order: "o1", attempt: 1, kind: "setup" }];
    const plan = planDays({ ...PC, days: [13, 14, 15], activity: { kind: "craft", ref: "o1" }, orders: [order()], records, facts }, stamp);
    assert.deepEqual(plan, { records: [], status: { o1: "check" }, wages: [], ext: [], stop: { day: 13, reason: "check", ref: "o1" } });
    const half = planDays({ ...PC, days: [13, 14], activity: { kind: "craft", ref: "o1" }, orders: [order()], records: records.slice(0, 1), facts }, stamp);
    assert.deepEqual([half.records.map((r) => r.kind), half.stop.reason], [["setup"], "check"], "one more day completes it");
});

test("craft days refuse orders that are not the PC's, are closed, or take no days", () => {
    const plan = (o, ref = "o1") => planDays({ ...PC, days: [5], activity: { kind: "craft", ref }, orders: [o], facts }, stamp).stop;
    assert.equal(plan(order(), "o9").reason, "no-order");
    assert.equal(plan(order({ crafter: "Actor.x" })).reason, "no-order");
    assert.equal(plan(order({ status: "complete" })).reason, "no-order");
    assert.deepEqual(plan(order({ status: "paused" })), { day: 5, reason: "order-state", ref: "o1", status: "paused" });
    assert.equal(plan(order({ status: "accepted" })).reason, "order-state");
});

test("earn days pay the job's wage, keyed per day; a missing check stops; a fired earner is paid nothing once", () => {
    const job = { id: "j1", actor: "Actor.c1", status: "open", check: { degree: DEGREE.success }, perDayCp: 30, round: 1 };
    const plan = planDays({ ...PC, days: [3, 4], activity: { kind: "earn", ref: "j1" }, jobs: [job] }, stamp);
    assert.deepEqual(plan.wages, [
        { job: "j1", day: 3, cp: 30, idem: wageKey("j1", 3, 0) }, { job: "j1", day: 4, cp: 30, idem: wageKey("j1", 4, 0) },
    ]);
    assert.deepEqual(plan.records[0].rows, [hashId("wage:j1:3:0")]);
    assert.equal(plan.records[0].wageCp, 30);
    // A day's wage undone once gets the next correction sequence (4.6).
    const undone = [{ id: "w", kind: "wage", job: "j1", day: 3, reversedBy: "r" }];
    assert.equal(planDays({ ...PC, days: [3], activity: { kind: "earn", ref: "j1" }, jobs: [job], rows: undone }, stamp).wages[0].idem, "wage:j1:3:1");
    assert.equal(planDays({ ...PC, days: [3], activity: { kind: "earn", ref: "j1" }, jobs: [{ ...job, check: null }] }, stamp).stop.reason, "income-check");
    assert.equal(planDays({ ...PC, days: [3], activity: { kind: "earn", ref: "j1" }, jobs: [{ ...job, status: "ended" }] }, stamp).stop.reason, "job-ended");
    assert.equal(planDays({ ...PC, days: [3], activity: { kind: "earn", ref: "j1" }, jobs: [{ ...job, actor: "Actor.x" }] }, stamp).stop.reason, "no-job");
    const fired = planDays({ ...PC, days: [3, 4], activity: { kind: "earn", ref: "j1" }, jobs: [{ ...job, status: "fired", perDayCp: 0 }] }, stamp);
    assert.deepEqual([fired.records.length, fired.records[0].result, fired.wages.length, fired.stop.reason], [1, "fired", 0, "job-ended"]);
});

test("help days need a helper entry on an open order; a helper locked to an order cannot spend days elsewhere (6.7)", () => {
    const helped = order({ status: "finishing", check: settled(), crafter: "Actor.k", helpers: { c1: { joinedDay: 1, leftDay: null, degree: DEGREE.success, level: 10, rank: 2 } } });
    const help = planDays({ ...PC, days: [5, 6], activity: { kind: "help", ref: "o1" }, orders: [helped] }, stamp);
    assert.deepEqual(help.records.map((r) => [r.id, r.result, r.order]), [["c1-5", "help", "o1"], ["c1-6", "help", "o1"]]);
    const elsewhere = planDays({ ...PC, days: [5], activity: { kind: "other" }, orders: [helped] }, stamp);
    assert.deepEqual(elsewhere.stop, { day: 5, reason: "locked", ref: "o1" });
    const outside = planDays({ ...PC, days: [5, 6, 7], activity: null, orders: [helped] }, stamp);
    assert.deepEqual([outside.records.length, outside.stop], [0, { day: 5, reason: "locked", ref: "o1" }],
        "nor be out of downtime while the crafter's days carry their share (review fix)");
    const left = order({ crafter: "Actor.k", helpers: { c1: { joinedDay: 1, leftDay: 6 } } });
    const after = planDays({ ...PC, days: [5, 6], activity: { kind: "help", ref: "o1" }, orders: [left] }, stamp);
    assert.deepEqual([after.records.length, after.stop.reason], [1, "not-helping"], "from the day they left, not helping");
    assert.equal(helperLockOf([left], "c1"), null, "a helper who left is not locked");
    assert.equal(helperLockOf([helped], "c1"), "o1");
    assert.equal(helperLockOf([{ ...helped, status: "complete" }], "c1"), null, "completing the order releases its helpers");
});

test("a span outside downtime is one record; other activities record the day and nothing else", () => {
    const off = planDays({ ...PC, days: [3, 4, 5], activity: null }, stamp);
    assert.deepEqual(off.records, [notDowntimeRecord("c1", 3, 5, stamp)]);
    assert.deepEqual([off.records[0].id, off.records[0].toDay, off.records[0].result], ["c1-3", 5, "not-downtime"]);
    assert.equal(resolvedThrough("c1", off.records), 5);
    const other = planDays({ ...PC, days: [3], activity: { kind: "retrain" } }, stamp);
    assert.deepEqual([other.records[0].activity, other.records[0].result, other.stop], [{ kind: "retrain", ref: null }, null, null]);
});

test("a helper's share is in the crafter's extra days while present and accepted, and is forfeited on leaving (6.7)", () => {
    // Player Core p.253 by the author's defaults: a 10th-level expert helper who succeeds adds the level-9 expert amount, 400 cp.
    const helpers = {
        h1: { joinedDay: 1, leftDay: null, degree: DEGREE.success, level: 10, rank: RANK.expert },
        h2: { joinedDay: 1, leftDay: null, degree: DEGREE.success, level: 10, rank: RANK.expert, accepted: false },
    };
    const o = order({ status: "finishing", check: settled(), helpers });
    const plan = planDays({ ...PC, days: [2, 3], activity: { kind: "craft", ref: "o1" }, orders: [o], facts }, stamp);
    assert.deepEqual(plan.records[0].helpers, { h1: 400 }, "the helper the crafter has not accepted adds nothing");
    assert.equal(reductionCp(o, plan.records), 2 * (100 + 400));
    const leaving = { ...o, helpers: { ...helpers, h1: { ...helpers.h1, leftDay: 3 } } };
    assert.equal(reductionCp(leaving, plan.records), 200, "leaving forfeits what they gave (retroactive by default)");
    assert.equal(reductionCp(leaving, plan.records, rulesWith({ communal: { helperLeaveRetroactive: false } })), 1000, "the setting keeps it");
});

test("the wizard's span: a number of days advances, 'since last resolved' does not; a span logged twice adds nothing (9.2)", () => {
    assert.deepEqual(wizardSpan({ day: 0, count: 3 }), { fromDay: 1, toDay: 3, advances: 3 });
    assert.deepEqual(wizardSpan({ day: 3, count: 3 }), { fromDay: 4, toDay: 6, advances: 3 }, "running advance 3 again is days 4-6");
    assert.deepEqual(wizardSpan({ day: 6, kind: "since" }), { fromDay: null, toDay: 6, advances: 0 });
    assert.throws(() => wizardSpan({ day: 0, count: 0 }), RangeError);
    const status = { inDowntime: true, since: 0 };
    assert.deepEqual(openDaysThrough({ status, day: 0, toDay: 3 }), [1, 2, 3]);
    assert.deepEqual(openDaysThrough({ status, resolved: 3, day: 3, toDay: 3 }), [], "already logged: nothing to do");
    assert.deepEqual(openDaysThrough({ status: { inDowntime: false }, day: 0, toDay: 3 }), []);
});

test("wage days count open wage claims as promised (the 6.12 follow-up)", () => {
    const live = [{ kind: "wage", job: "j1", day: 1 }, { kind: "wage", job: "j2", day: 1 }];
    const claims = [{ kind: "wage", job: "j1", day: 2 }, { kind: "wage", job: "j1", day: 3, resolved: { by: "u" } }, { kind: "refund", job: "j1", day: 4 }];
    assert.deepEqual([...wageDaysOf(live, claims, "j1")].sort(), [1, 2]);
});

test("a setup completed by a runner's records is moved to check by the crafter's client; nothing else is", () => {
    const o = order();
    const records = [{ id: "c1-1", actor: "c1", day: 1, order: "o1", attempt: 1, kind: "setup" }, { id: "c1-2", actor: "c1", day: 2, order: "o1", attempt: 1, kind: "setup" }];
    assert.deepEqual(setupRepair(o, records), { status: "check" });
    assert.equal(setupRepair(o, records.slice(0, 1)), null);
    assert.equal(setupRepair(order({ status: "check" }), records), null);
    assert.equal(setupRepair({ ...o, log: { 1: { seq: 1, event: "cancel", to: "cancelled" } } }, records), null, "never a closed order");
});

test("a summary of day records: days covered and one part per activity and order or job", async () => {
    const { daysSummary } = await import("../../scripts/logic/downtime.mjs");
    const summary = daysSummary([
        { day: 1, toDay: 1, kind: "setup", order: "o1", activity: { kind: "craft", ref: "o1" } },
        { day: 2, toDay: 2, kind: "extra", order: "o1", crafterCp: 100, helpers: { h: 400 }, activity: { kind: "craft", ref: "o1" } },
        { day: 3, toDay: 3, kind: "extra", order: "o1", crafterCp: 100, helpers: {}, activity: { kind: "craft", ref: "o1" } },
        { day: 4, toDay: 4, job: "j1", wageCp: 30, activity: { kind: "earn", ref: "j1" } },
        { day: 5, toDay: 7, result: "not-downtime", activity: null },
    ]);
    assert.deepEqual(summary, { days: 7, from: 1, to: 7, parts: [
        { kind: "setup", ref: "o1", n: 1, cp: 0 }, { kind: "extra", ref: "o1", n: 2, cp: 600 }, { kind: "earn", ref: "j1", n: 1, cp: 30 },
        { kind: "not-downtime", ref: null, n: 3, cp: 0 },
    ] });
});
