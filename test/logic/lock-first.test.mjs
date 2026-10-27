/** Lock ordering of a coin-moving move (DESIGN.md 5.4, 5.5, 15.1 "idempotency keys and lock ordering"). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planPledge, planPayout, planPurseCredit } from "../../scripts/logic/coins.mjs";
import { hashId } from "../../scripts/logic/ids.mjs";
import { MOVE_VERSION, applyMarkId, lockFirstBatch, lockIdsFor, purseLockIds, resumeApply, resumeDecision, stackLockId } from "../../scripts/logic/lock-first.mjs";
import { PENDING_GRACE_MS } from "../../scripts/logic/reconcile.mjs";

const purse = [{ id: "gp1", denomination: "gp", quantity: 10, version: 7 }, { id: "sp1", denomination: "sp", quantity: 3, version: 9 }];
const box = [{ id: "lotA", denomination: "gp", quantity: 2 }, { id: "lotB", denomination: "gp", quantity: 5 }, { id: "lotC", denomination: "sp", quantity: 4 }];
const ops = ({ lock, apply }) => [...lock, ...apply].map((o) => o.op);

test("a pledge: the lock request holds the lock and the rows; the apply request the purse debit, the lot and the settle", () => {
    const plan = planPledge(purse, 250);
    const batch = lockFirstBatch({
        rowIds: ["row1"], lockIds: ["row1", ...purseLockIds(purse, plan.purse)], ledger: { set: { "rows.row1": { id: "row1" } } },
        debits: [{ target: "Actor.pc", plan: plan.purse }], credits: [{ target: "strongbox", plan: plan.strongbox }], lot: "row1",
    });
    assert.deepEqual(batch.lock.map((o) => o.op), ["lock", "ledger"]);
    assert.deepEqual(batch.apply.map((o) => o.op), ["updateCoins", "createCoins", "ledger"]);
    const changed = [...plan.purse.updates.map((u) => u.id), ...plan.purse.deletes];
    assert.deepEqual(batch.lock[0].ids, ["row1", ...changed.map((id) => stackLockId(id, id === "gp1" ? 7 : 9))], "each purse stack it changes, at its version");
    assert.deepEqual(batch.apply[1], { op: "createCoins", target: "strongbox", coins: [{ denomination: "gp", quantity: 2 }, { denomination: "sp", quantity: 5 }], lot: "row1" });
    assert.deepEqual(batch.apply.at(-1).change, { set: { "rows.row1.state": "applied" } });
});

test("a payout locks its row and every strongbox stack it deletes; debits before credits", () => {
    const plan = planPayout(box, purse, 650);
    const batch = lockFirstBatch({
        rowIds: ["row2"], lockIds: lockIdsFor(["row2"], [{ target: "strongbox", plan: plan.strongbox }]), ledger: { set: { "rows.row2": {} } },
        debits: [{ target: "strongbox", plan: plan.strongbox }], credits: [{ target: "Actor.pc", plan: plan.purse }], lot: "row2",
    });
    assert.deepEqual(batch.lock[0], { op: "lock", ids: ["row2", ...plan.strongbox.deletes] });
    assert.ok(plan.strongbox.deletes.length > 0);
    const kinds = batch.apply.map((o) => `${o.op}:${o.target ?? ""}`);
    assert.ok(kinds.indexOf("deleteItems:strongbox") < kinds.indexOf("updateCoins:Actor.pc"), "debits first");
    assert.equal(batch.apply.find((o) => o.op === "createCoins" && o.target === "Actor.pc"), undefined, "the purse has stacks to add to");
    assert.equal(batch.apply.at(-1).op, "ledger");
});

test("purse stack locks name the stack and the version it was planned from; new stacks need none", () => {
    assert.deepEqual(purseLockIds(purse, planPurseCredit(purse, 105)), [stackLockId("gp1", 7)], "1 gp onto the gold stack, 5 cp new");
    assert.notEqual(stackLockId("gp1", 7), stackLockId("gp1", 8), "a change to the stack gives a new lock");
    assert.equal(stackLockId("gp1", 7), hashId("stack:gp1:7"));
    assert.deepEqual(purseLockIds([], planPurseCredit([], 100)), []);
    assert.deepEqual(purseLockIds(purse, { deletes: ["sp1"], updates: [{ id: "sp1", quantity: 1 }] }), [stackLockId("sp1", 9)], "no repeats");
});

test("empty steps are left out; a lot flag goes only on strongbox stacks; no ledger step when nothing is written with the lock", () => {
    const batch = lockFirstBatch({
        rowIds: ["w"], ledger: { set: {} },
        credits: [{ target: "Actor.pc", plan: { updates: [], deletes: [], creates: [{ denomination: "cp", quantity: 3 }] } }], lot: "w",
    });
    assert.deepEqual(ops(batch), ["lock", "createCoins", "ledger"]);
    assert.equal(batch.apply[0].lot, null);
});

test("a delivery locks its row and its shelf item with lock pages, then deletes the item and creates it on the recipient", () => {
    const batch = lockFirstBatch({
        rowIds: ["d1"], lockIds: ["d1", "shelf1"], ledger: { set: { "rows.d1": {} } },
        debits: [{ target: "strongbox", plan: { deletes: ["shelf1"] } }], items: [{ target: "Actor.pc", data: [{ name: "x" }] }],
    });
    assert.deepEqual(batch.lock[0], { op: "lock", ids: ["d1", "shelf1"] });
    assert.deepEqual(batch.apply.map((o) => o.op), ["deleteItems", "createItems", "ledger"]);
});

test("a move that locks nothing is refused; lock ids are not repeated; a move without rows has no settle", () => {
    assert.throws(() => lockFirstBatch({ rowIds: [], ledger: {} }), RangeError);
    assert.deepEqual(lockIdsFor(["r1", "r2"], [{ target: "strongbox", plan: { deletes: ["s1", "s1"] } }, { target: "Actor.x", plan: { deletes: ["p1"] } }]), ["r1", "r2", "s1"]);
    const purge = lockFirstBatch({ lockIds: ["a", "a"], debits: [{ target: "strongbox", plan: { deletes: ["a"] } }] });
    assert.deepEqual(purge.lock, [{ op: "lock", ids: ["a"] }]);
    assert.deepEqual(purge.apply.map((o) => o.op), ["deleteItems"]);
});

test("a resumable move: its first row's lock page holds the move, and its apply request starts with its apply mark", () => {
    const plan = planPledge(purse, 250);
    const touched = [{ target: "Actor.pc", id: "gp1", version: 7 }];
    const batch = lockFirstBatch({
        rowIds: ["row1"], lockIds: ["row1", ...purseLockIds(purse, plan.purse)], ledger: { set: { "rows.row1": { id: "row1" } } },
        debits: [{ target: "Actor.pc", plan: plan.purse }], credits: [{ target: "strongbox", plan: plan.strongbox }], lot: "row1",
        resume: { touched, actor: "Actor.pc" },
    });
    assert.equal(applyMarkId("row1"), hashId("apply:row1"));
    assert.deepEqual(batch.apply[0], { op: "lock", ids: [applyMarkId("row1")], keys: { [applyMarkId("row1")]: "apply:row1" } },
        "the mark first, before any coin moves, saying what it guards (M12b), so a resume from another client's copy tags its page too");
    assert.deepEqual(batch.apply.slice(1).map((o) => o.op), ["updateCoins", "createCoins", "ledger"]);
    assert.deepEqual(batch.lock[0].move, { v: MOVE_VERSION, rows: ["row1"], apply: batch.apply.slice(0, -1), touched, actor: "Actor.pc" },
        "the page holds no key path: Foundry would expand `rows.row1.state` in stored flags");
    assert.ok(!JSON.stringify(batch.lock[0].move).includes("rows.row1"));
    assert.deepEqual(resumeApply(batch.lock[0].move), batch.apply, "the apply request is made again as the move built it");
    assert.equal(batch.lock[0].ids[0], "row1");
    assert.throws(() => lockFirstBatch({ lockIds: ["a"], resume: { touched: [] } }), RangeError, "a move without rows has nothing to resume");
    assert.throws(() => lockFirstBatch({ rowIds: ["r"], lockIds: ["s", "r"], resume: { touched: [] } }), RangeError);
    assert.equal(lockFirstBatch({ rowIds: ["r"] }).lock[0].move, undefined, "a move is resumable only when asked");
});

test("resuming: only a move whose rows are pending, unmarked, unstopped, past the grace time, and whose items are as planned", () => {
    const now = 10_000_000;
    const at = (agoMs) => ({ real: 0, server: now - agoMs - 1_000_000, launch: 1_000_000 });
    const move = { rows: ["r1", "r2"], touched: [{ target: "strongbox", id: "s1", version: 3 }, { target: "Actor.pc", id: "p1", version: 8 }] };
    const versions = new Map([["strongbox s1", 3], ["Actor.pc p1", 8]]);
    const versionOf = (target, id) => versions.get(`${target} ${id}`) ?? null;
    const pending = (agoMs = PENDING_GRACE_MS) => [{ state: "pending", at: at(agoMs) }, { state: "pending", at: at(agoMs) }];
    const decide = (over) => resumeDecision({ move, rows: pending(), marked: false, versionOf, now, ...over });
    assert.deepEqual(decide({}), { action: "resume" });
    assert.deepEqual(decide({ rows: pending(PENDING_GRACE_MS - 1500) }), { action: "wait", dueInMs: 1500 }, "it may still be in flight");
    assert.deepEqual(decide({ marked: true }), { action: "none" }, "its apply request reached the server");
    assert.deepEqual(decide({ rows: [{ state: "applied", at: at(0) }, { state: "applied", at: at(0) }] }), { action: "none" });
    assert.deepEqual(decide({ rows: [{ ...pending()[0], stopped: { reason: "dry-run" } }, pending()[1]] }), { action: "none" }, "sent and answered");
    assert.deepEqual(decide({ rows: [pending()[0], undefined] }), { action: "none" }, "a row is gone");
    assert.deepEqual(decide({ rows: [] }), { action: "none" });
    versions.set("Actor.pc p1", 9);
    assert.deepEqual(decide({}), { action: "manual" }, "the purse stack changed since the move was planned");
    versions.set("Actor.pc p1", 8);
    versions.delete("strongbox s1");
    assert.deepEqual(decide({}), { action: "manual" }, "a strongbox stack it spends is gone");
    assert.deepEqual(decide({ rows: pending(1000) }), { action: "wait", dueInMs: PENDING_GRACE_MS - 1000 }, "a young move is waited for before it is judged");
});
