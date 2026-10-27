/**
 * Earn Income jobs, settlement profiles and Communal Crafting helpers in M6 (DESIGN.md 4.9, 6.7, 6.10, 14.2): pure parts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE, RANK } from "../../scripts/logic/core.mjs";
import { helperCheckPatch, helperPresent, joinHelper, leaveHelper } from "../../scripts/logic/communal.mjs";
import { hashId, idemKey } from "../../scripts/logic/ids.mjs";
import {
    currentProfile, jobActions, jobLog, jobLogLockId, jobStart, jobTransitionChange, jobUndoPlan, makeProfile, mayRerollJob, profilesOf, rerollPatch,
} from "../../scripts/logic/jobs.mjs";
import { earnIncomeRollPlan, helpLink, jobCheckPatch, jobLink, makeJob, parseLink } from "../../scripts/logic/rolls.mjs";

const stamp = { by: "u1", at: { world: 0, real: 1 } };
const viewer = (fields = {}) => ({ userId: "u1", isGM: false, owns: () => false, ...fields });

test("settlement profiles: the size's top task level by default, per-skill exceptions, sorted, the current one by id", () => {
    assert.deepEqual(makeProfile({ id: "p1", name: " Otari ", size: "town" }), { id: "p1", name: "Otari", size: "town", level: 4, caps: {}, notes: "" });
    const port = makeProfile({ id: "p2", name: "Absalom", size: "metropolis", level: 9, caps: { "sailing-lore": 10 } });
    assert.deepEqual([port.level, port.caps], [9, { "sailing-lore": 10 }]);
    assert.throws(() => makeProfile({ id: "p3", size: "hamlet" }), RangeError);
    assert.throws(() => makeProfile({ id: "p3", level: 21 }), RangeError);
    assert.throws(() => makeProfile({ id: "p3", caps: { "Bad Skill": 3 } }), TypeError);
    const setting = { p2: port, p1: makeProfile({ id: "p1", name: "Otari" }), junk: { id: "x" } };
    assert.deepEqual(profilesOf(setting).map((p) => p.id), ["p2", "p1"], "by name; anything not a profile left out");
    assert.equal(currentProfile(setting, { profileId: "p1" }).name, "Otari");
    assert.equal(currentProfile(setting, null), null);
    assert.equal(currentProfile(setting, { profileId: "gone" }), null);
});

test("a job starts at a task level the settlement allows; trained only; no settlement means unconfirmed (6.10, OQ-17)", () => {
    const town = makeProfile({ id: "p1", size: "town", caps: { "sailing-lore": 6 } });
    assert.deepEqual(jobStart({ taskLevel: 4, skill: "crafting", rank: RANK.trained, profile: town }), { ok: true, unconfirmed: false });
    assert.deepEqual(jobStart({ taskLevel: 5, skill: "crafting", rank: RANK.trained, profile: town }), { ok: false, reason: "task-level-cap", data: { max: 4 } });
    assert.equal(jobStart({ taskLevel: 6, skill: "sailing-lore", rank: RANK.expert, profile: town }).ok, true, "the port's exception");
    assert.deepEqual(jobStart({ taskLevel: 1, skill: "crafting", rank: RANK.untrained, profile: town }), { ok: false, reason: "untrained", data: { skill: "crafting" } });
    assert.deepEqual(jobStart({ taskLevel: 12, skill: "crafting", rank: RANK.trained }), { ok: true, unconfirmed: true });
    assert.equal(jobStart({ taskLevel: 21, skill: "crafting", rank: RANK.trained }).reason, "task-level-range");
});

test("a job's links carry its round; an earlier round's reroll is stale; links from before M6 read as round 1", () => {
    assert.equal(jobLink("j1", 2), "pf2e-artisans-workshop:job:j1:2");
    assert.deepEqual(parseLink([jobLink("j1", 2)]), { kind: "job", id: "j1", round: 2 });
    assert.deepEqual(parseLink(["pf2e-artisans-workshop:job:j1"]), { kind: "job", id: "j1", round: 1 });
    assert.deepEqual(parseLink([helpLink("o1", "a1")]), { kind: "help", id: "o1", actor: "a1" });
    assert.deepEqual(earnIncomeRollPlan("j1", 3).options, ["action:earn-income", "pf2e-artisans-workshop:job:j1:3"]);
    const job = { ...makeJob({ id: "j1", actor: "Actor.a", skill: "crafting", taskLevel: 2, dc: 16 }, stamp), round: 2 };
    const check = { degree: DEGREE.success, unadjusted: DEGREE.success, rerolled: true };
    assert.equal(jobCheckPatch(job, check, { level: 3, rank: 1 }, 0, 1).reason, "stale-round");
    assert.equal(jobCheckPatch({ ...job, check: null }, { ...check, rerolled: false }, { level: 3, rank: 1 }, 0, 2).ok, true);
    assert.equal(jobCheckPatch({ ...job, check: { degree: 1 } }, check, { level: 3, rank: 1 }, 1, 2).reason, "paid");
});

test("a new job record carries its round, log and confirmation", () => {
    const job = makeJob({ id: "j1", actor: "Actor.a", skill: "cooking-lore", taskLevel: 2, dc: 16, unconfirmed: true }, stamp);
    assert.deepEqual([job.round, job.log, job.unconfirmed, job.status, job.check], [1, {}, true, "open", null]);
});

test("job transitions log what they changed behind their slot's lock; undo restores it or removes an unused job", () => {
    const job = makeJob({ id: "j1", actor: "Actor.a", skill: "crafting", taskLevel: 2, dc: 16 }, stamp);
    const started = jobTransitionChange(job, "start", {}, stamp);
    assert.equal(started.lock, hashId(idemKey("job-log", "j1", 1)));
    assert.equal(started.lock, jobLogLockId("j1", 1));
    const withStart = { ...job, log: { 1: started.replace["jobs.j1.log.1"] } };
    assert.deepEqual(jobUndoPlan(withStart, viewer({ userId: "u1" })), { ok: true, entry: withStart.log[1], delete: true });
    assert.equal(jobUndoPlan(withStart, viewer({ userId: "u1" }), { worked: 2 }).reason, "job-moved-on", "days were spent on it");
    const rolled = { ...withStart, check: { degree: DEGREE.success, level: 3, rank: 1 }, perDayCp: 20 };
    const reroll = jobTransitionChange(rolled, "reroll", rerollPatch(rolled), { by: "u2", at: {} });
    assert.deepEqual(reroll.set["jobs.j1.round"], 2);
    assert.equal(reroll.set["jobs.j1.check"], null);
    const after = { ...rolled, round: 2, check: null, perDayCp: 0, log: { ...withStart.log, 2: reroll.replace["jobs.j1.log.2"] } };
    assert.deepEqual(jobLog(after).map((e) => e.event), ["start", "reroll"]);
    assert.equal(jobUndoPlan(after, viewer()).reason, "not-yours");
    const undo = jobUndoPlan(after, viewer({ owns: (uuid) => uuid === "Actor.a" }));
    assert.deepEqual(undo.patch, { round: 1, check: rolled.check, perDayCp: 20, shortened: null });
    assert.equal(jobUndoPlan({ ...after, log: {} }, viewer({ isGM: true })).reason, "nothing");
    // Once the new round's check is rolled, undoing the roll-again would keep the better of two rolls (review fix).
    const rerolled = { ...after, check: { degree: DEGREE.fail, level: 4, rank: 1 }, perDayCp: 2 };
    assert.deepEqual(jobUndoPlan(rerolled, viewer({ isGM: true })), { ok: false, reason: "job-moved-on", data: { status: "open" } });
});

test("a resumed job may be rolled again only after a level or rank change (Player Core p.228)", () => {
    const job = { status: "open", check: { level: 3, rank: RANK.trained } };
    assert.equal(mayRerollJob(job, { level: 3, rank: RANK.trained }), false);
    assert.equal(mayRerollJob(job, { level: 4, rank: RANK.trained }), true);
    assert.equal(mayRerollJob({ ...job, status: "fired" }, { level: 4, rank: RANK.trained }), false);
    const actions = jobActions({ ...job, id: "j1", actor: "Actor.a", log: {} }, viewer({ owns: () => true }), { now: { level: 3, rank: RANK.expert } });
    assert.deepEqual(actions, { roll: false, reroll: true, end: true, undo: false });
    assert.equal(jobActions({ id: "j1", actor: "Actor.a", status: "open", check: null, log: {} }, viewer({ owns: () => true })).roll, true);
    assert.equal(jobActions({ id: "j1", actor: "Actor.a", status: "open", check: null, log: {} }, viewer()).roll, false, "not the earner's");
});

test("helpers join an order with a crafter, leave once, and roll once (6.7)", () => {
    const order = { status: "setup", helpers: {} };
    const joined = joinHelper(order, { actorId: "h1", crafterId: "c1", skill: "crafting", rank: 2, level: 10, joinedDay: 4 });
    assert.deepEqual(joined.entry, { actor: "h1", skill: "crafting", rank: 2, level: 10, degree: null, check: null, joinedDay: 4, leftDay: null, accepted: true });
    assert.equal(joinHelper({ status: "requested" }, { actorId: "h1", crafterId: "c1" }).reason, "state", "no crafter yet");
    assert.equal(joinHelper({ status: "complete" }, { actorId: "h1", crafterId: "c1" }).reason, "state");
    assert.equal(joinHelper(order, { actorId: "c1", crafterId: "c1" }).reason, "crafter");
    const helping = { status: "setup", helpers: { h1: joined.entry } };
    assert.equal(joinHelper(helping, { actorId: "h1", crafterId: "c1" }).reason, "already");
    assert.deepEqual(leaveHelper(helping, "h1", 9), { ok: true, leftDay: 9 });
    assert.deepEqual(leaveHelper(helping, "h1", 2), { ok: true, leftDay: 4 }, "never before the day they joined");
    assert.equal(leaveHelper(helping, "h9", 9).reason, "not-helping");
    const left = { status: "setup", helpers: { h1: { ...joined.entry, leftDay: 9 } } };
    assert.equal(leaveHelper(left, "h1", 10).reason, "left");
    assert.equal(joinHelper(left, { actorId: "h1", crafterId: "c1" }).reason, "left", "a helper who left does not come back");
    const check = { degree: DEGREE.success, rerolled: false, messageId: "m1" };
    assert.deepEqual(helperCheckPatch(helping, "h1", check, { level: 10, rank: 2 }).patch, { degree: DEGREE.success, level: 10, rank: 2, check });
    const rolled = { status: "check", helpers: { h1: { ...joined.entry, check } } };
    assert.equal(helperCheckPatch(rolled, "h1", { ...check, messageId: "m2" }, { level: 10, rank: 2 }).reason, "rolled");
    assert.equal(helperCheckPatch(rolled, "h1", { ...check, rerolled: true }, { level: 10, rank: 2 }).ok, true, "a reroll replaces it");
    assert.equal(helperCheckPatch(left, "h1", check, { level: 10, rank: 2 }).reason, "not-helping");
    assert.equal(helperPresent({ ...joined.entry, accepted: false }, 5), false);
    assert.equal(helperPresent(joined.entry, 3), false);
    assert.equal(helperPresent(joined.entry, 4), true);
});
