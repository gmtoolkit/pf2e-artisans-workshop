/**
 * Coin moves (DESIGN.md 4.6, 5.4) end to end over the fake world: rows and coins move together in one
 * lock-first batch, the strongbox is create-only, the fast path skips a row that exists, and a burst of
 * pledges from one client is serialised so the strongbox always equals the sum of the rows.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MOD, addDocument, coin, flagsOf, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { allocationsByContributor } = await import("../../scripts/logic/split.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const { reconciliationReport } = await import("../../scripts/foundry/reconcile.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { records } = await import("../../scripts/foundry/store.mjs");
const { resetLease } = await import("../../scripts/foundry/lease.mjs");
const { stackLockId } = await import("../../scripts/logic/lock-first.mjs");

const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
let docs;
let pc;
beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    pc = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 10), coin("sp", 3)] });
    setUsers([{ id: "p1", character: pc }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    registerBatchWatcher();
});

test("a pledge moves coins from the purse into a new strongbox lot, with one pending-then-applied row", async () => {
    const result = await money.pledge({ actor: pc, cp: 250, order: "o1", nonce: "n1" });
    assert.equal(result.outcome, "ok");
    assert.equal(cpOf(pc), 1030 - 250);
    assert.equal(cpOf(docs.strongbox), 250);
    const [row] = records("rows");
    assert.deepEqual([row.kind, row.box, row.purse, row.alloc, row.state, row.author], ["pledge", 250, -250, 250, "applied", "p1"]);
    assert.ok(docs.strongbox.items.contents.every((item) => item.flags[MOD].lot.row === row.id), "every new stack is a lot of its row");
    assert.ok(docs.ledger.pages.has(row.id));
});

test("the same pledge again is skipped by the fast path; a lost lock moves nothing", async () => {
    await money.pledge({ actor: pc, cp: 100, order: "o1", nonce: "n1" });
    const again = await money.pledge({ actor: pc, cp: 100, order: "o1", nonce: "n1" });
    assert.equal(again.outcome, "already");
    assert.equal(world.batches.length, 2, "the first pledge's lock and apply requests only");
    assert.equal(cpOf(docs.strongbox), 100);
});

test("a refund pays out of the strongbox by deleting whole stacks and creating change; never an update there", async () => {
    await money.pledge({ actor: pc, cp: 1000, order: "o1", nonce: "a" });
    const before = cpOf(pc);
    const result = await money.payout({ actor: pc, row: { kind: "refund", idem: "refund:o1:x:0", cp: 375, actor: pc.uuid, order: "o1" } });
    assert.equal(result.outcome, "ok");
    assert.equal(cpOf(pc), before + 375);
    assert.equal(cpOf(docs.strongbox), 625);
    const strongboxUpdates = world.batches.at(-1).filter((op) => op.action === "update" && op.parent === docs.strongbox);
    assert.deepEqual(strongboxUpdates, [], "create-only strongbox");
    const [lock] = world.batches.at(-2);
    const deleted = world.batches.at(-1).find((op) => op.action === "delete").ids;
    assert.ok(deleted.every((id) => lock.data.some((page) => page._id === id)), "the deleted stacks are locked too");
    const [raised] = world.batches.at(-1).find((op) => op.action === "update" && op.parent === pc).updates;
    const planned = pc.items.get(raised._id)._stats.modifiedTime - 1;   // the fake server bumps it by one per write
    assert.ok(lock.data.some((page) => page._id === stackLockId(raised._id, planned)), "and the purse stack it raised, at the version it was planned from");
});

test("locked stacks are planned around: one a stopped move left behind is never picked again", async () => {
    await money.pledge({ actor: pc, cp: 300, order: "o1", nonce: "a" });
    await money.pledge({ actor: pc, cp: 200, order: "o1", nonce: "b" });
    const [small] = coinStacks(docs.strongbox).filter((stack) => stack.quantity === 2);
    docs.ledger.pages.set(small.id, { id: small.id });   // locked by a move that stopped before deleting it
    const result = await money.payout({ actor: pc, row: { kind: "refund", idem: "refund:o1:x:1", cp: 100, actor: pc.uuid, order: "o1" } });
    assert.equal(result.outcome, "ok");
    assert.ok(docs.strongbox.items.has(small.id), "the locked stack was left alone");
    assert.deepEqual(reconciliationReport().lockedStacks, [small.id], "and reconciliation lists it");
    const short = await money.payout({ actor: pc, row: { kind: "refund", idem: "refund:o1:x:2", cp: 300, actor: pc.uuid, order: "o1" } });
    assert.equal(short.reason, "strongbox-short", "its coins are spoken for");
});

test("refusals: short purse, short strongbox, nothing to move, a purse the user does not own, not ready", async () => {
    assert.equal((await money.pledge({ actor: pc, cp: 99999, nonce: "z" })).reason, "purse-short");
    assert.equal((await money.payout({ actor: pc, row: { kind: "withdraw", idem: "w:x", cp: 1, actor: pc.uuid } })).reason, "strongbox-short");
    assert.equal((await money.pledge({ actor: pc, cp: 0, nonce: "z" })).reason, "nothing");
    const other = addDocument("Actor", { name: "Other", ownership: { default: 0 }, items: [coin("gp", 1)] });
    assert.equal((await money.pledge({ actor: other, cp: 10, nonce: "z" })).reason, "not-owner");
    state.setShared({ ...docs, status: "missing" });
    assert.equal((await money.pledge({ actor: pc, cp: 10, nonce: "z" })).reason, "not-ready");
    assert.equal(world.batches.length, 0);
});

test("no positive amount is refused as \"nothing\", for every move, before anything is sent", async () => {
    // The fast path looks at the row's id before the plan runs; it must not build the row (which throws on such an
    // amount) and so turn the documented refusal into an exception.
    for (const cp of [0, -5, undefined]) {
        assert.deepEqual(await money.pledge({ actor: pc, cp, nonce: "z" }), { ok: false, reason: "nothing" }, `pledge ${cp}`);
        assert.deepEqual(await money.pledge({ actor: pc, cp, order: "o1", nonce: "z" }), { ok: false, reason: "nothing" }, `pledge to an order ${cp}`);
        assert.deepEqual(await money.withdraw({ actor: pc, cp, nonce: "z" }), { ok: false, reason: "nothing" }, `withdraw ${cp}`);
        assert.deepEqual(await money.mint({ actor: pc, row: { kind: "wage", idem: "wage:j1:1:0", cp, actor: pc.uuid } }), { ok: false, reason: "nothing" }, `wage ${cp}`);
    }
    assert.equal(world.batches.length, 0);
    assert.deepEqual(records("rows"), []);
});

test("a wage mints into the purse; a deposit and withdrawal go through the party fund", async () => {
    await money.mint({ actor: pc, row: { kind: "wage", idem: "wage:j1:3:0", cp: 30, actor: pc.uuid, job: "j1", day: 3 } });
    assert.equal(cpOf(pc), 1060);
    await money.pledge({ actor: pc, cp: 200, nonce: "d" });
    await money.withdraw({ actor: pc, cp: 50, nonce: "w" });
    const kinds = records("rows").map((r) => r.kind).sort();
    assert.deepEqual(kinds, ["deposit", "wage", "withdraw"]);
    assert.equal(cpOf(docs.strongbox), 150);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a spend is split across contributors pro rata, one row each, from the strongbox", async () => {
    const pc2 = addDocument("Actor", { name: "Bo", ownership: { default: 3 }, items: [coin("gp", 50)] });
    await money.pledge({ actor: pc, cp: 600, order: "o1", nonce: "a" });
    await money.pledge({ actor: pc2, cp: 200, order: "o1", nonce: "b" });
    const allocations = allocationsByContributor(records("rows").filter((r) => r.order === "o1"));
    const result = await money.spend({ kind: "expend", stem: "expend:o1:1:0", cp: 400, allocations, link: { order: "o1" } });
    assert.equal(result.outcome, "ok");
    const expends = records("rows").filter((r) => r.kind === "expend");
    assert.deepEqual(expends.map((r) => [r.actor, r.cp]).sort(), [[pc.uuid, 300], [pc2.uuid, 100]]);
    assert.equal(cpOf(docs.strongbox), 400);
    assert.deepEqual(allocationsByContributor(records("rows").filter((r) => r.order === "o1")).map((a) => a.cp), [300, 100]);
});

test("two pledges fired at once from one client are serialised: the strongbox equals the sum of the rows", async () => {
    const results = await Promise.all([1, 2, 3].map((n) => money.pledge({ actor: pc, cp: 120, order: "o1", nonce: `burst${n}` })));
    assert.deepEqual(results.map((r) => r.outcome), ["ok", "ok", "ok"]);
    const report = reconciliationReport();
    assert.deepEqual([report.expectedCp, report.actualCp, report.pending.length], [360, 360, 0]);
    assert.equal(cpOf(pc), 1030 - 360);
});

test("bookkeeping rows are written directly and already applied; coin kinds are refused there", async () => {
    const result = await money.postRows([{ kind: "commit", idem: "commit:o1:1:0", cp: 3250, order: "o1" }]);
    assert.equal(result.outcome, "ok");
    assert.equal(records("rows")[0].state, "applied");
    assert.equal((await money.postRows([{ kind: "commit", idem: "commit:o1:1:0", cp: 3250, order: "o1" }])).outcome, "already");
    await assert.rejects(money.postRows([{ kind: "pledge", idem: "p", cp: 1 }]), RangeError);
    await assert.rejects(money.postRows([{ kind: "material-in", idem: "m", cp: 1, order: "o1" }]), RangeError, "item movements take a lock");
});

test("coin moves are refused while the coin items have not loaded", async () => {
    setCoinTemplates(null);
    assert.equal((await money.pledge({ actor: pc, cp: 10, nonce: "z" })).reason, "no-coins");
    assert.equal(world.batches.length, 0);
});

test("a pending row can be closed by its author or a GM", async () => {
    flagsOf(docs.ledger).rows = { r1: { id: "r1", v: 1, kind: "deposit", state: "pending", author: "someone" } };
    assert.equal((await money.resolvePending("r1")).reason, "not-author");
    world.currentUser = "gm00000000000000";
    assert.equal((await money.resolvePending("r1")).ok, true);
    assert.equal(flagsOf(docs.ledger).rows.r1.state, "applied");
    assert.equal((await money.resolvePending("r1")).reason, "not-pending");
});
