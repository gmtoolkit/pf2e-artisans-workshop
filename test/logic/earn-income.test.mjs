/** Earn Income jobs (DESIGN.md 4.9, 6.10). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE, RANK } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import {
    checkTaskLevel, costOfLivingCp, daysPaid, defaultSettlementProfile, downtimeCheckGuard, earnIncomeDC, isLore,
    isUsualIncomeSkill, jobAfterRoll, maxTaskLevel, resumeJob, wageKey, wagePerDay, wageSeq,
} from "../../scripts/logic/earn-income.mjs";

const { critFail, fail, success, critSuccess } = DEGREE;
const { untrained, trained, expert, master, legendary } = RANK;

test("settlement profiles start from the top of GM Core p.53's ranges", () => {
    assert.deepEqual(["village", "town", "city", "metropolis"].map((size) => defaultSettlementProfile(size).level), [1, 4, 7, 10]);
    assert.throws(() => defaultSettlementProfile("hamlet"), RangeError);
    const port = { level: 5, caps: { "sailing-lore": 8 } };
    assert.equal(maxTaskLevel(port, "sailing-lore"), 8);
    assert.equal(maxTaskLevel(port, "crafting"), 5);
});

test("task level: 0..20, at most the profile's cap, any level unconfirmed without a profile", () => {
    const town = defaultSettlementProfile("town");
    assert.deepEqual(checkTaskLevel({ taskLevel: 4, skill: "crafting", profile: town }), { ok: true, unconfirmed: false });
    assert.deepEqual(checkTaskLevel({ taskLevel: 0, skill: "crafting", profile: town }), { ok: true, unconfirmed: false });
    assert.deepEqual(checkTaskLevel({ taskLevel: 5, skill: "crafting", profile: town }), { ok: false, reason: "task-level-cap", data: { max: 4 }, unconfirmed: false });
    assert.deepEqual(checkTaskLevel({ taskLevel: 12, skill: "crafting" }), { ok: true, unconfirmed: true });
    assert.equal(checkTaskLevel({ taskLevel: 21, skill: "crafting" }).reason, "task-level-range");
    assert.equal(checkTaskLevel({ taskLevel: -1, skill: "crafting" }).reason, "task-level-range");
});

test("DC: the task level's, plus adjustments, plus the bump for other skills", () => {
    assert.ok(isLore("cooking-lore") && !isLore("crafting"));
    assert.deepEqual(["crafting", "performance", "cooking-lore", "acrobatics"].map(isUsualIncomeSkill), [true, true, true, false]);
    assert.equal(earnIncomeDC({ taskLevel: 3, skill: "crafting" }), 18);
    assert.equal(earnIncomeDC({ taskLevel: 3, skill: "cooking-lore", adjust: 2 }), 20);
    assert.equal(earnIncomeDC({ taskLevel: 3, skill: "acrobatics" }), 23);
    assert.equal(earnIncomeDC({ taskLevel: 3, skill: "acrobatics" }, rulesWith({ earnIncomeOtherSkillDc: 10 })), 28);
    assert.equal(earnIncomeDC({ taskLevel: 3, skill: "crafting", pwol: true }), 15);
});

test("pay by degree: task level + 1, task level, the failure column, nothing", () => {
    const pay = (degree, taskLevel = 7, rank = expert) => wagePerDay({ taskLevel, rank, degree, skill: "crafting" });
    assert.equal(pay(critSuccess), 300);         // level 8 expert
    assert.equal(pay(success), 250);
    assert.equal(pay(fail), 40);
    assert.equal(pay(critFail), 0);
    assert.equal(pay(critSuccess, 20, legendary), 30000);
    assert.equal(pay(success, 0, trained), 5);
    assert.equal(pay(success, 5, untrained), 0);
});

test("Experienced Professional doubles failure pay for an expert in Lore, unless it was a critical failure", () => {
    const base = { taskLevel: 4, degree: fail, skill: "cooking-lore", experiencedProfessional: true };
    assert.equal(wagePerDay({ ...base, rank: expert }), 20);
    assert.equal(wagePerDay({ ...base, rank: master }), 20);
    assert.equal(wagePerDay({ ...base, rank: trained }), 10);                  // the system dialog doubles here too
    assert.equal(wagePerDay({ ...base, rank: expert, unadjusted: critFail }), 10);   // raised from a critical failure
    assert.equal(wagePerDay({ ...base, rank: expert, skill: "crafting" }), 10);
    assert.equal(wagePerDay({ ...base, rank: expert, experiencedProfessional: false }), 10);
    assert.equal(wagePerDay({ ...base, rank: expert, degree: success }), 80);
});

test("a critical failure fires the earner; a failure marks the job as likely shortened", () => {
    assert.deepEqual(jobAfterRoll(critFail), { status: "fired", shortened: false });
    assert.deepEqual(jobAfterRoll(fail), { status: "open", shortened: true });
    assert.deepEqual(jobAfterRoll(success), { status: "open", shortened: false });
});

test("resuming keeps the roll; a new roll only after the level or rank changed", () => {
    const job = { status: "open", check: { level: 5, rank: expert } };
    assert.deepEqual(resumeJob(job, { level: 5, rank: expert }), { ok: true, keepCheck: true, mayReroll: false });
    assert.equal(resumeJob(job, { level: 6, rank: expert }).mayReroll, true);
    assert.equal(resumeJob(job, { level: 5, rank: master }).mayReroll, true);
    assert.deepEqual(resumeJob({ ...job, status: "fired" }, { level: 6, rank: expert }), { ok: false, reason: "fired" });
});

test("wages are keyed per job, day and correction, and a day paid twice counts once", () => {
    assert.equal(wageKey("j1", 12, 0), "wage:j1:12:0");
    assert.throws(() => wageKey("j1", 1.5, 0), TypeError);
    assert.throws(() => wageKey("j1", 12), TypeError);                     // the sequence is required
    const rows = [
        { id: "a", kind: "wage", job: "j1", day: 1 }, { id: "b", kind: "wage", job: "j1", day: 1 }, { id: "c", kind: "wage", job: "j1", day: 2 },
        { id: "d", kind: "wage", job: "j1", day: 3, reversedBy: "r" }, { id: "e", kind: "wage", job: "j2", day: 1 }, { id: "f", kind: "pledge", job: "j1", day: 4 },
    ];
    assert.equal(daysPaid(rows, "j1"), 2);
    // A reversal row that names the wage is enough, without the mark on the original.
    assert.equal(daysPaid([...rows, { id: "r2", kind: "reversal", reverses: "c" }], "j1"), 1);
});

test("a wage corrected after an undo gets a fresh key, so it does not collide with the first payment's lock", () => {
    const first = { id: "w0", kind: "wage", job: "j1", day: 12 };
    assert.equal(wageSeq([], "j1", 12), 0);
    assert.equal(wageSeq([first], "j1", 12), 0);                           // a second resolver pays the same key
    const undone = [{ ...first, reversedBy: "r" }, { id: "r", kind: "reversal", reverses: "w0" }];
    assert.equal(wageSeq(undone, "j1", 12), 1);
    assert.notEqual(wageKey("j1", 12, wageSeq(undone, "j1", 12)), wageKey("j1", 12, wageSeq([first], "j1", 12)));
    assert.equal(wageSeq(undone, "j1", 13), 0);
    assert.equal(wageSeq(undone, "j2", 12), 0);
});

test("the downtime-check guardrail warns by default, blocks by setting", () => {
    assert.equal(downtimeCheckGuard({ fortune: true }), "warn");
    assert.equal(downtimeCheckGuard({ activated: true }, rulesWith({ downtimeRerolls: "block" })), "block");
    assert.equal(downtimeCheckGuard({}), null);
});

test("cost of living by standard and period", () => {
    assert.equal(costOfLivingCp("comfortable"), 100);
    assert.equal(costOfLivingCp("fine", "month"), 13000);
    assert.equal(costOfLivingCp("subsistence", "year"), 2400);
    assert.throws(() => costOfLivingCp("royal"), RangeError);
});
