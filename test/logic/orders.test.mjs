/** The order lifecycle around M1's Craft steps (DESIGN.md 4.2, 6.2.4, 6.12, M4): pure parts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { hashId } from "../../scripts/logic/ids.mjs";
import {
    acceptOrder, closedAs, closedRepair, lateForAttempt, lastEntry, leftAfterSpend, logEntries, logLockId, makeOrder, nextWorkDay,
    orderActions, refundClaims, releaseOrder, reversalKeepsCommitted, settlementRecord, settlementRepair, transitionChange, undoPlan,
    withdrawableCp, workDayRecord,
} from "../../scripts/logic/orders.mjs";
import { makeRow } from "../../scripts/logic/rows.mjs";

const stamp = { by: "u1", at: { world: 10, real: 1000, server: 5, launch: 1 } };
const later = { by: "u2", at: { world: 20, real: 2000, server: 6, launch: 1 } };

const product = { uuid: "Compendium.pf2e.equipment-srd.Item.x", snapshot: { name: "Elixir", img: "e.webp", level: 1, rarity: "common", traits: ["alchemical"], priceCp: 300, per: 1 } };
const order = (fields = {}) => ({ ...makeOrder({ id: "o1", requester: "Actor.r", recipient: { kind: "actor", uuid: "Actor.r" }, product, quantity: 2 }, stamp), ...fields });
const viewer = (fields = {}) => ({ userId: "u1", isGM: false, owns: () => false, hasCharacter: true, ...fields });
const row = (kind, cp, fields = {}) => ({ ...makeRow({ kind, idem: `${kind}:${fields.actor ?? "x"}:${fields.n ?? 0}`, cp, order: "o1", ...fields }, stamp), state: "applied" });

test("a request is filed requested, or accepted when its crafter is named; money waits for start", () => {
    const o = order();
    assert.equal(o.status, "requested");
    assert.equal(o.attempt, 0);
    assert.equal(o.priceCp, null);
    assert.deepEqual(o.created, stamp.at);
    assert.equal(makeOrder({ id: "o2", requester: "A", recipient: { kind: "strongbox" }, product, quantity: 1, crafter: "C" }, stamp).status, "accepted");
    assert.throws(() => makeOrder({ id: "o3", requester: "A", recipient: { kind: "strongbox" }, product, quantity: 0 }, stamp), RangeError);
    assert.throws(() => makeOrder({ id: "o3", requester: "A", recipient: null, product, quantity: 1 }, stamp), TypeError);
});

test("accept and release move between requested and accepted only", () => {
    assert.deepEqual(acceptOrder(order(), "Actor.c").patch, { crafter: "Actor.c", status: "accepted" });
    assert.equal(acceptOrder(order({ status: "accepted" }), "Actor.c").reason, "state");
    assert.deepEqual(releaseOrder(order({ status: "accepted", crafter: "Actor.c" })).patch, { crafter: null, status: "requested" });
    assert.equal(releaseOrder(order()).reason, "state");
});

test("a transition sets plain fields, replaces objects, and logs what they held before", () => {
    const o = order({ status: "accepted", crafter: "Actor.c" });
    const change = transitionChange(o, "start", { status: "setup", attempt: 1, dc: { final: 15 } }, { rows: ["r1"] }, later);
    assert.equal(change.set["orders.o1.status"], "setup");
    assert.equal(change.set["orders.o1.attempt"], 1);
    assert.deepEqual(change.replace["orders.o1.dc"], { final: 15 });
    assert.deepEqual(change.entry, { seq: 1, event: "start", from: "accepted", to: "setup", prev: { status: "accepted", attempt: 0, dc: null }, rows: ["r1"], ...later });
    assert.deepEqual(change.replace["orders.o1.log.1"], change.entry);
    const logged = { ...o, log: { 1: change.entry } };
    assert.equal(transitionChange(logged, "pause", { status: "paused" }, {}, later).entry.seq, 2);
    assert.deepEqual(logEntries({ log: { 2: { seq: 2 }, 1: { seq: 1 }, x: "junk" } }).map((e) => e.seq), [1, 2]);
});

test("undo: only the last undoable step, only while the order is where it left it, by its maker, an owner or a GM", () => {
    const o = order({ status: "accepted", crafter: "Actor.c" });
    const entry = transitionChange(o, "start", { status: "setup", attempt: 1, priceCp: 600 }, { rows: ["r1"] }, stamp).entry;
    const started = { ...o, status: "setup", attempt: 1, priceCp: 600, log: { 1: entry } };
    const plan = undoPlan(started, viewer());
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.patch, { status: "accepted", priceCp: null }, "a start's attempt stays counted");
    assert.equal(undoPlan(started, viewer({ userId: "u9" })).reason, "not-yours");
    assert.equal(undoPlan(started, viewer({ userId: "u9", owns: (uuid) => uuid === "Actor.c" })).ok, true);
    assert.equal(undoPlan(started, viewer({ userId: "u9", isGM: true })).ok, true);
    assert.equal(undoPlan({ ...started, status: "check" }, viewer()).reason, "moved-on");
    assert.equal(undoPlan(order(), viewer()).reason, "nothing");
    const finished = { ...started, status: "complete", log: { 1: { ...entry, event: "finish", to: "complete" } } };
    assert.equal(undoPlan(finished, viewer()).reason, "not-undoable");
    const undone = { ...started, log: { 1: entry, 2: { ...entry, seq: 2, event: "undo" } } };
    assert.equal(undoPlan(undone, viewer()).reason, "nothing", "one step back, not a chain");
});

test("undoing a settlement goes back to the recorded check, or to a reroll kept as the conflict (6.12)", () => {
    const first = { degree: DEGREE.fail, messageId: "m1", attempt: 1, settled: true };
    const settled = order({ status: "failed", attempt: 1, crafter: "C", check: first,
        settlement: { attempt: 1, check: first, status: "failed", rows: [] },
        log: { 1: { seq: 1, event: "settle", from: "rolled", to: "failed", prev: { check: { ...first, settled: false }, status: "rolled", settlement: null }, rows: ["x"], by: "u1" } } });
    assert.deepEqual(undoPlan(settled, viewer()).patch, { check: { ...first, settled: false }, status: "rolled", settlement: null, conflict: null });
    const reroll = { degree: DEGREE.success, messageId: "m2", attempt: 1 };
    const withConflict = { ...settled, conflict: reroll };
    assert.deepEqual(undoPlan(withConflict, viewer()).patch.check, { ...reroll, settled: false });
    const oldConflict = { ...settled, conflict: { ...reroll, attempt: 0 } };
    assert.equal(undoPlan(oldConflict, viewer()).patch.check.messageId, "m1", "a conflict from another attempt is not used");
});

test("withdrawable: own allocation, no more than the order holds beyond what is committed, nothing once closed", () => {
    const rows = [row("pledge", 600, { actor: "A" }), row("pledge", 400, { actor: "B" }), row("commit", 700)];
    const o = order({ status: "setup", attempt: 1 });
    assert.equal(withdrawableCp(o, rows, "A"), 300);
    assert.equal(withdrawableCp(o, rows, "B"), 300);
    assert.equal(withdrawableCp(o, rows, "C"), 0);
    assert.equal(withdrawableCp(order({ status: "requested" }), rows.slice(0, 2), "A"), 600);
    assert.equal(withdrawableCp(order({ status: "cancelled" }), rows, "A"), 0);
    assert.equal(reversalKeepsCommitted(rows[0], rows), false, "taking A's 600 back would leave 400 for a 700 commit");
    assert.equal(reversalKeepsCommitted(row("pledge", 200, { actor: "A", n: 1 }), [...rows, row("pledge", 200, { actor: "A", n: 1 })]), true);
});

test("refunds: one claim per contributor keyed by the transition; a gone actor's share and the fund's go back to the fund", () => {
    const o = order({ crafter: "Actor.c" });
    const { claims, toFund } = refundClaims(o, [{ actor: "Actor.a", cp: 500 }, { actor: "Actor.gone", cp: 200 }, { actor: null, cp: 50 }, { actor: "Actor.b", cp: 0 }], 3,
        (uuid) => uuid !== "Actor.gone");
    assert.deepEqual(claims, [{ kind: "refund", idem: "refund:o1:Actor.a:3", actor: "Actor.a", cp: 500, order: "o1", parties: ["Actor.r", "Actor.c"] }]);
    assert.deepEqual(toFund, [{ actor: "Actor.gone", cp: 200 }, { actor: null, cp: 50 }]);
});

test("a finish refunds what is left after the remainder, pro rata", () => {
    assert.deepEqual(leftAfterSpend([{ actor: "A", cp: 600 }, { actor: "B", cp: 400 }], 500), [{ actor: "A", cp: 300 }, { actor: "B", cp: 200 }]);
    assert.deepEqual(leftAfterSpend([{ actor: "A", cp: 600 }], 600), []);
    assert.deepEqual(leftAfterSpend([{ actor: "A", cp: 3 }, { actor: "B", cp: 3 }], 3), [{ actor: "A", cp: 1 }, { actor: "B", cp: 2 }], "ties go to the earliest");
});

test("the settlement record is what a late reroll is measured against, and its repair is deterministic (6.12)", () => {
    const settledCheck = { degree: DEGREE.success, messageId: "m1", attempt: 1, settled: true };
    const base = order({ status: "finishing", attempt: 1, check: settledCheck });
    const record = settlementRecord(base, { check: settledCheck, status: "finishing" }, ["r1", "r2"], stamp);
    assert.deepEqual(record, { attempt: 1, check: settledCheck, status: "finishing", rows: ["r1", "r2"], ...stamp });
    const settled = { ...base, settlement: record };
    assert.equal(settlementRepair(settled), null, "nothing to repair");
    // A reroll recorded from a copy that had not seen the settlement replaced the check, unsettled.
    const reroll = { degree: DEGREE.critSuccess, messageId: "m2", attempt: 1, settled: false };
    const overwritten = { ...settled, check: reroll };
    assert.deepEqual(settlementRepair(overwritten), { check: settledCheck, conflict: reroll });
    assert.deepEqual(settlementRepair({ ...overwritten, status: "rolled" }), { check: settledCheck, conflict: reroll, status: "finishing" });
    assert.deepEqual(settlementRepair({ ...overwritten, conflict: reroll }), { check: settledCheck }, "the conflict is kept once");
    assert.equal(settlementRepair({ ...overwritten, attempt: 2 }), null, "a settlement of an earlier attempt does not count");
    assert.equal(lateForAttempt(settled, 1, false), true);
    assert.equal(lateForAttempt(order({ attempt: 1, status: "rolled", check: { ...reroll } }), 1, false), false);
    assert.equal(lateForAttempt(order({ attempt: 1, status: "rolled" }), 1, true), true, "settlement rows count too");
});

test("work days: the clock's day or the day after the last record; setup days move the order to its check", () => {
    assert.equal(nextWorkDay(10, []), 10);
    assert.equal(nextWorkDay(10, [{ day: 12 }, { day: 11 }]), 13);
    assert.equal(nextWorkDay(20, [{ day: 12, toDay: 14 }]), 20);
    const o = order({ status: "setup", attempt: 1, setup: { days: 2, hours: 0 }, crafter: "C" });
    const crafter = { actorId: "c1", level: 5, rank: 2 };
    const first = workDayRecord(o, 3, crafter, [], stamp);
    assert.deepEqual([first.record.id, first.record.kind, first.record.day, first.record.attempt], ["c1-3", "setup", 3, 1]);
    assert.deepEqual(first.patch, {});
    assert.deepEqual(workDayRecord(o, 4, crafter, [first.record], stamp).patch, { status: "check" });
    const finishing = order({ status: "finishing", attempt: 1, check: { degree: DEGREE.success, level: 5, rank: 2, settled: true }, helpers: {} });
    const extra = workDayRecord(finishing, 9, crafter, [], stamp);
    assert.deepEqual([extra.record.kind, extra.record.crafterCp, extra.record.id], ["extra", 100, "c1-9"], "Player Core p.237: 5th-level expert, 1 gp a day");
    assert.equal(workDayRecord(order({ status: "check", attempt: 1 }), 9, crafter, [], stamp), null);
    assert.equal(workDayRecord(finishing, 9, crafter, [], stamp, rulesWith({ recomputeRateOnLevelUp: false })).record.crafterCp, 100);
});

test("actions follow who owns the crafter, the requester, or nothing at all", () => {
    const crafterOwner = viewer({ owns: (uuid) => uuid === "Actor.c" });
    const requested = order();
    assert.equal(orderActions(requested, viewer()).accept, true);
    assert.equal(orderActions(requested, viewer({ hasCharacter: false })).accept, false);
    assert.equal(orderActions(requested, viewer()).cancel, false, "a bystander cannot cancel");
    assert.equal(orderActions(requested, viewer({ owns: (uuid) => uuid === "Actor.r" })).cancel, true);
    const accepted = order({ status: "accepted", crafter: "Actor.c" });
    assert.deepEqual([orderActions(accepted, crafterOwner).start, orderActions(accepted, crafterOwner).startReady], [true, false]);
    assert.equal(orderActions(accepted, crafterOwner, { gatesPass: true }).startReady, true);
    assert.equal(orderActions(order({ status: "rolled", crafter: "Actor.c" }), crafterOwner).settle, true);
    assert.equal(orderActions(order({ status: "rolled", crafter: "Actor.c" }), crafterOwner).cancel, false, "settle first (6.2.4)");
    assert.equal(orderActions(order({ status: "finishing", crafter: "Actor.c" }), crafterOwner).finish, true);
    assert.equal(orderActions(order({ status: "finishing", crafter: "Actor.c" }), viewer()).finish, false);
    assert.equal(orderActions(order({ status: "complete" }), viewer()).pledge, false);
    assert.equal(orderActions(order(), viewer(), { withdrawable: 5 }).withdraw, true);
    assert.equal(lastEntry(order()), null);
    assert.equal(hashId("refund:o1:Actor.a:3").length, 16);
});

test("every transition names its log slot's lock page; a closed order's log says so whatever its status", () => {
    const o = order();
    const first = transitionChange(o, "accept", { crafter: "Actor.c", status: "accepted" }, {}, stamp);
    assert.equal(first.lock, logLockId("o1", 1));
    assert.notEqual(logLockId("o1", 2), first.lock);
    assert.notEqual(logLockId("o2", 1), first.lock);
    const accepted = { ...o, status: "accepted", log: { 1: first.entry } };
    assert.equal(closedAs(accepted), null);
    assert.equal(closedRepair(accepted), null);
    const cancel = transitionChange(accepted, "cancel", { status: "cancelled" }, {}, later);
    assert.equal(cancel.lock, logLockId("o1", 2), "a cancel and a finish planned from the same copy take the same page");
    assert.equal(transitionChange(accepted, "finish", { status: "complete" }, {}, later).lock, cancel.lock);
    const cancelled = { ...accepted, status: "cancelled", log: { ...accepted.log, 2: cancel.entry } };
    assert.equal(closedAs(cancelled), "cancelled");
    assert.equal(closedRepair(cancelled), null);
    assert.deepEqual(closedRepair({ ...cancelled, status: "check" }), { status: "cancelled" }, "a late work day's status goes back");
});
