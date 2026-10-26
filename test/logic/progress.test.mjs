/**
 * Work totals derived from day records (DESIGN.md 4.2.1, 4.8, 6.2.3), with the worked examples: Player
 * Core p.237's crafting example (DESIGN 6.2.3 test vector) and the batch examples checked in the research.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE, RANK } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import {
    crafterRate, daysToZero, extraDayRecord, lastDayWorked, recordsOf, reductionCp, remainingCp, setupComplete,
    setupDaysDone, totalCostCp,
} from "../../scripts/logic/progress.mjs";

const { fail, success, critSuccess } = DEGREE;
const { trained, expert, master } = RANK;

/** An order past its check, with the crafting example's Price. */
function order(fields = {}) {
    return {
        id: "o1", attempt: 1, status: "finishing", priceCp: 6500, upfrontCp: 3250, setup: { days: 1, hours: 0 },
        check: { degree: success, level: 5, rank: expert, settled: true }, helpers: {}, ...fields,
    };
}

/** Day records for `order` resolved by `resolve` on days from..to. */
function run(o, from, to, crafter = { level: 5, rank: expert }, rules) {
    const days = [];
    for (let day = from; day <= to; day++) days.push({ actor: "crafter", ...extraDayRecord(o, day, { crafter }, rules) });
    return days;
}

test("DESIGN 6.2.3 test vector: a 5th-level expert crafts a 4th-level 65 gp item with its formula", () => {
    const o = order();
    const days = run(o, 2, 14);                                 // 13 extra days
    assert.equal(days[0].crafterCp, 100);
    assert.equal(reductionCp(o, days), 1300);
    assert.equal(remainingCp(o, days), 1950);                   // 6500 - 3250 - 1300
    assert.equal(totalCostCp(o, days), 5200);                   // 52 gp, as in the book
    const crit = order({ check: { degree: critSuccess, level: 5, rank: expert, settled: true } });
    const critDays = run(crit, 2, 14);
    assert.equal(critDays[0].crafterCp, 200);
    assert.equal(remainingCp(crit, critDays), 650);             // 39 gp in all
    assert.equal(totalCostCp(crit, critDays), 3900);
});

test("the remainder never drops below zero, so the total never drops below the up-front half", () => {
    const o = order();
    const days = run(o, 2, 60);
    assert.equal(remainingCp(o, days), 0);
    assert.equal(totalCostCp(o, days), 3250);
    assert.equal(daysToZero(3250, 100), 33);
    assert.equal(daysToZero(0, 100), 0);
    assert.equal(daysToZero(100, 0), Infinity);
});

test("a batch of four lesser elixirs of life: 60 days alone, 34 with a 5th-level expert helper, 30 on a critical success", () => {
    const base = { priceCp: 12000, upfrontCp: 6000 };
    assert.equal(daysToZero(6000, crafterRate({ degree: success, level: 5, rank: expert }, { level: 5, rank: expert })), 60);
    const helped = order({ ...base, helpers: { h: { level: 5, rank: expert, degree: success, joinedDay: 0 } } });
    const record = extraDayRecord(helped, 3, { crafter: { level: 5, rank: expert } });
    assert.deepEqual(record.helpers, { h: 80 });               // level-4 expert: 8 sp
    assert.equal(daysToZero(6000, record.crafterCp + record.helpers.h), 34);
    assert.equal(daysToZero(6000, crafterRate({ degree: critSuccess, level: 5, rank: expert }, { level: 5, rank: expert })), 30);
});

test("four moderate elixirs at 10th-level master: 50 days, 30 with a 10th-level expert helper", () => {
    const helped = order({ priceCp: 60000, upfrontCp: 30000, check: { degree: success, level: 10, rank: master, settled: true },
        helpers: { h: { level: 10, rank: expert, degree: success, joinedDay: 0 } } });
    const record = extraDayRecord(helped, 1, { crafter: { level: 10, rank: master } });
    assert.equal(record.crafterCp, 600);
    assert.equal(record.helpers.h, 400);                       // DESIGN 6.7 example: the level-9 expert amount
    assert.equal(daysToZero(30000, 600), 50);
    assert.equal(daysToZero(30000, 1000), 30);
});

test("extra days count only once the check has settled as a success", () => {
    const rolled = order({ status: "rolled", check: { degree: success, level: 5, rank: expert, settled: false } });
    const days = run(rolled, 2, 5);
    assert.equal(days.length, 4);
    assert.equal(reductionCp(rolled, days), 0);
    const settled = { ...rolled, status: "finishing", check: { ...rolled.check, settled: true } };
    assert.equal(reductionCp(settled, days), 400);
    const failed = { ...settled, status: "failed", check: { ...settled.check, degree: fail } };
    assert.equal(reductionCp(failed, days), 0);
    assert.equal(extraDayRecord(order({ status: "setup" }), 1, { crafter: { level: 5, rank: expert } }), null);
});

test("only the current attempt counts, and a day resolved twice counts once", () => {
    const o = order({ attempt: 2 });
    const days = [
        { actor: "c", day: 1, order: "o1", attempt: 1, kind: "extra", crafterCp: 100, helpers: {} },
        { actor: "c", day: 2, order: "o1", attempt: 2, kind: "extra", crafterCp: 100, helpers: {} },
        { actor: "c", day: 2, order: "o1", attempt: 2, kind: "extra", crafterCp: 100, helpers: {} },
        { actor: "c", day: 3, order: "other", attempt: 2, kind: "extra", crafterCp: 100, helpers: {} },
    ];
    assert.equal(recordsOf(o, days, "extra").length, 1);
    assert.equal(reductionCp(o, days), 100);
    assert.equal(lastDayWorked(o, days), 2);
    assert.equal(lastDayWorked(order({ attempt: 9 }), days), null);
});

test("setup completes on enough setup days, and a sub-day setup only with its setup-hours record", () => {
    const o = order({ status: "setup", setup: { days: 2, hours: 0 } });
    const setup = (day, attempt = 1) => ({ actor: "c", day, order: "o1", attempt, kind: "setup" });
    assert.equal(setupComplete(o, [setup(1)]), false);
    assert.equal(setupComplete(o, [setup(1), setup(1, 0), setup(3)]), true);
    assert.equal(setupDaysDone(o, [setup(1), setup(1)]), 1);
    const subDay = order({ status: "setup", setup: { days: 0, hours: 4 } });
    assert.equal(setupComplete(subDay, []), false);
    // Recorded on a day the crafter spent on another activity: a variant record keyed per order (4.8).
    assert.equal(setupComplete(subDay, [{ actor: "c", day: 7, order: "o1", attempt: 1, kind: "setup-hours", hours: 4 }]), true);
});

test("the daily rate follows the crafter's level and rank by default, or the check's by setting", () => {
    const check = { degree: success, level: 5, rank: expert };
    const today = { level: 7, rank: master };
    assert.equal(crafterRate(check, today), 250);              // level 7 master
    assert.equal(crafterRate(check, today, null, rulesWith({ recomputeRateOnLevelUp: false })), 100);
    assert.equal(crafterRate({ ...check, degree: critSuccess }, today), 300);   // level 8 master
    assert.equal(crafterRate(check, today, 12), 1000);         // a registry rate level (Monster Crafting)
    assert.equal(crafterRate({ degree: critSuccess, level: 20, rank: master }, { level: 20, rank: master }), 17500);
});

test("helpers contribute on the days they are present; one who left forfeits everything by default", () => {
    const helpers = {
        stays: { level: 3, rank: trained, degree: success, joinedDay: 0 },
        leaves: { level: 3, rank: trained, degree: success, joinedDay: 0, leftDay: 4 },
        late: { level: 3, rank: trained, degree: success, joinedDay: 3 },
    };
    const o = order({ helpers });
    const days = run(o, 2, 5);
    assert.deepEqual(days.map((d) => Object.keys(d.helpers).sort()), [["leaves", "stays"], ["late", "leaves", "stays"], ["late", "stays"], ["late", "stays"]]);
    // Level-2 trained helper: 3 sp a day.
    assert.equal(days[0].helpers.stays, 30);
    assert.equal(reductionCp(o, days), 4 * 100 + 4 * 30 + 3 * 30);
    const keep = rulesWith({ communal: { helperLeaveRetroactive: false } });
    assert.equal(reductionCp(o, days, keep), 4 * 100 + 4 * 30 + 3 * 30 + 2 * 30);
});

test("a helper whose entry was removed from the order counts as one who left", () => {
    const o = order({ helpers: {} });
    const days = [{ actor: "c", day: 2, order: "o1", attempt: 1, kind: "extra", crafterCp: 100, helpers: { gone: 80 } }];
    assert.equal(reductionCp(o, days), 100);
    assert.equal(reductionCp(o, days, rulesWith({ communal: { helperLeaveRetroactive: false } })), 180);
});
