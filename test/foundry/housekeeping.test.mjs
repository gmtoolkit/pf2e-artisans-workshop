/**
 * Housekeeping over the fake world (DESIGN.md 5.3.3, 5.4; As built in M12b): every lock page says what it guards; the elected
 * client prunes the spent ones with no GM online, never a page a stranded move's resume needs; a GM's archive run moves old,
 * settled orders into the Crafting Log and leaves carry rows that keep reconciliation balanced; and the races: an archive run
 * while a move waits to be resumed, two archivers at once (the same copy, and two copies that disagree), an order reopened by
 * undo while a run is on its way.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
    MOD, addDocument, asUser, coin, controlClock, disconnect, flagsOf, installFoundry, interleave, resetWorld, setUsers, sharedWorld, world,
} from "./stubs.mjs";

installFoundry();
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { archivePageData, archiveRunPageId, archiveSlotId } = await import("../../scripts/logic/archive.mjs");
const { hashId } = await import("../../scripts/logic/ids.mjs");
const { memberBalances } = await import("../../scripts/logic/reconcile.mjs");
const { applyMarkId } = await import("../../scripts/logic/lock-first.mjs");
const { PRUNE_AGE_MS } = await import("../../scripts/logic/locks.mjs");
const { logLockId } = await import("../../scripts/logic/orders.mjs");
const { fundsView } = await import("../../scripts/logic/views.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const funds = await import("../../scripts/foundry/funds.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const housekeeping = await import("../../scripts/foundry/housekeeping.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const orders = await import("../../scripts/foundry/orders.mjs");
const { reconciliationReport } = await import("../../scripts/foundry/reconcile.mjs");
const { registerSettings } = await import("../../scripts/foundry/settings.mjs");
const shared = await import("../../scripts/foundry/shared-docs.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, serverNow, write } = await import("../../scripts/foundry/store.mjs");

registerSettings({ enabled: () => {}, docs: () => {} });
const GM = "gm00000000000000";
const DAY_MS = 24 * 60 * 60 * 1000;
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const silence = (t) => { for (const level of ["warn", "error", "info", "table"]) t.mock.method(console, level, () => {}); };
const flush = async () => { for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve)); };
const lockOf = (id) => docs.ledger.pages.get(id)?.flags[MOD].lock;
/** The Crafting Log's pages of a role: "archive-page" (a world year's records) or "archive-run" (one per run that landed). */
const logPages = (role) => log.pages.filter((p) => flagsOf(p).role === role);

let docs;
let log;
let vera;
let bo;
beforeEach(async () => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    money.resetResume();
    housekeeping.resetHousekeeping();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });   // one tab, no Web Locks
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    log = addDocument("JournalEntry", { name: "Crafting Log", ownership: { default: 2 }, flags: { [MOD]: { role: "archive", schema: 1 } } });
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 10)] });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 10)] });
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: GM, isGM: true }], "p2");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p2");
    registerBatchWatcher();
    await money.pledge({ actor: bo, cp: 500, order: "o1", nonce: "n" });   // 5 gp in the strongbox for o1
});
afterEach(() => {
    housekeeping.resetHousekeeping();
    Object.defineProperty(globalThis, "navigator", realNavigator);
});

/** Run `move` with its lock request applied and its answer lost with the connection: the apply request is never sent. */
async function strand(move) {
    const real = foundry.documents.modifyBatch;
    foundry.documents.modifyBatch = (operations) => {
        foundry.documents.modifyBatch = real;
        real(operations);
        return new Promise(() => {});
    };
    try {
        const pending = move();
        await flush();
        disconnect();
        return await pending;
    } finally {
        foundry.documents.modifyBatch = real;
    }
}

/** This client reloads. */
function reload() {
    state.resetState();
    state.setShared({ ...docs, status: "ready" });
    money.resetResume();
}

/** An order record closed `agoMs` ago (a cancel at log seq 2 by default), as the order machine leaves one. */
async function closedOrder(id, { status = "cancelled", event = "cancel", extra = {}, agoMs = 0 } = {}) {
    const stamp = { by: GM, at: { world: 1000, real: Date.now() - agoMs, server: game.time.serverTime - agoMs, launch: world.launch } };
    await write({ set: { [`orders.${id}`]: {
        id, v: 1, status, requester: bo.uuid, crafter: vera.uuid, attempt: 1, check: { degree: 2, settled: true },
        log: { 1: { seq: 1, event: "accept", from: "requested", to: "accepted", prev: { status: "requested" }, rows: [], ...stamp },
            2: { seq: 2, event, from: "rolled", to: status, prev: { status: "rolled" }, rows: [], ...stamp } },
        ...extra, ...stamp,
    } } });
}

const refundOf = (actor, cp, order = "o1") => ({ kind: "refund", idem: `refund:${order}:${actor.uuid}:2`, actor: actor.uuid, cp, order, parties: [actor.uuid] });

test("every lock page a move takes says what it guards: its rows, its purse stacks at their version, its apply mark", () => {
    const [row] = records("rows");
    assert.equal(lockOf(row.id).kind, "row");
    assert.ok(docs.ledger.pages.get(row.id).flags[MOD].move, "the first row's page holds the move");
    assert.deepEqual([lockOf(applyMarkId(row.id)).kind, lockOf(applyMarkId(row.id)).key], ["apply", `apply:${row.id}`]);
    const stacks = docs.ledger.pages.filter((p) => p.flags[MOD].lock.kind === "stack");
    assert.equal(stacks.length, 1, "Bo's gold stack, at the version the pledge planned from");
    assert.match(stacks[0].flags[MOD].lock.key, new RegExp(`^stack:${bo.items.contents[0].id}:\\d+$`));
    assert.ok(docs.ledger.pages.contents.every((p) => p.flags[MOD].lock.kind), "no page without a kind");
});

test("with no GM online the elected player prunes spent pages, and keeps a stranded move's until it is resumed", async (t) => {
    silence(t);
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }], "p1");
    resetLease();
    requestLease("p1");
    const clock = controlClock(t);
    const stranded = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "s1" }));
    const [row] = stranded.rows;
    assert.equal(read(`rows.${row.id}.state`), "pending");
    reload();
    const pagesBefore = docs.ledger.pages.size;
    assert.deepEqual((await housekeeping.pruneLocks()).pruned, 0, "every page is younger than the prune age");

    clock.server += PRUNE_AGE_MS + 60 * 1000;
    const notElected = await asUser("p2", () => housekeeping.housekeeping({ force: true }))();
    assert.deepEqual(notElected, { ran: false, reason: "not-elected" }, "only the elected client (the lowest-id user, no GM online)");
    const pass = await housekeeping.housekeeping({ force: true });
    assert.equal(pass.ran, true);
    assert.equal(pass.archive, null, "no GM: no archive run");
    assert.equal(pass.prune.pruned, 3, "the first pledge's row, its apply mark and Bo's stack lock: the stack has moved on");
    assert.ok(docs.ledger.pages.has(row.id), "the stranded move's page, which holds the move, stays");
    const veraStack = docs.ledger.pages.find((p) => p.flags[MOD].lock.key?.startsWith(`stack:${vera.items.contents[0].id}:`));
    assert.ok(veraStack, "and Vera's stack lock: the stack is still at the version the move planned from");
    assert.equal(pass.prune.kept["move-pending"], 1);
    assert.equal(docs.ledger.pages.size, pagesBefore - 3);

    assert.deepEqual(await money.resumeStalled(), { resumed: 1, dueInMs: null }, "the resume still finds what it needs");
    assert.equal(read(`rows.${row.id}.state`), "applied");
    const resumed = await housekeeping.pruneLocks();
    assert.equal(resumed.pruned, 2, "the move's page (its rows applied) and Vera's old stack lock (the stack moved on)");
    assert.ok(docs.ledger.pages.has(applyMarkId(row.id)), "the resume's apply mark is young: it stays");
    clock.server += PRUNE_AGE_MS + 60 * 1000;
    assert.equal((await housekeeping.pruneLocks()).pruned, 1, "then the mark goes too");
    assert.equal(docs.ledger.pages.size, 0);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("an archive run while a refund waits to be resumed leaves its order; once resumed, the next run archives it and keeps the totals", async (t) => {
    silence(t);
    const clock = controlClock(t);
    await closedOrder("o1");
    await asUser("p1", () => money.pledge({ actor: vera, cp: 200, nonce: "d1" }))();   // a deposit: the party fund's own row
    const [claim] = await claims.createClaims([refundOf(bo, 500)]);
    const stranded = await strand(() => claims.applyClaim(claim, bo));
    const [refund] = stranded.rows;
    assert.equal(read(`rows.${refund.id}.state`), "pending");
    reload();

    world.currentUser = GM;
    resetLease();
    requestLease(GM);
    clock.server += 2 * DAY_MS;   // past the real-time floor; workshop day 100, the rows' day 0
    const now = serverNow();
    const expectedBefore = reconciliationReport().expectedCp;
    const early = await housekeeping.archiveRun({ now, today: 100 });
    assert.equal(read("orders.o1.id"), "o1", "a pending row keeps its order live");
    assert.equal(early.counts.orders, 0);
    assert.ok(docs.ledger.pages.has(refund.id) && docs.ledger.pages.get(refund.id).flags[MOD].move, "and the move's page");
    assert.equal(early.counts.rows, 1, "the deposit moves on its own");
    assert.equal(reconciliationReport().expectedCp, expectedBefore, "carried forward: the expected coins did not move");
    assert.equal(records("rows").find((r) => r.kind === "carry")?.box, 200, "the deposit's coins, in Vera's carry row");

    world.currentUser = "p2";
    resetLease();
    requestLease("p2");
    assert.equal((await money.resumeStalled()).resumed, 1);
    assert.equal(read(`rows.${refund.id}.state`), "applied");
    world.currentUser = GM;
    resetLease();
    requestLease(GM);
    clock.server += PRUNE_AGE_MS + 60 * 1000;
    const run = await housekeeping.archiveRun({ now: serverNow(), today: 100 });
    assert.equal(run.outcome, "ok");
    assert.deepEqual([run.counts.orders, run.counts.rows, run.counts.claims], [1, 2, 1], "the order, its pledge and refund, its claim");
    assert.equal(read("orders.o1"), undefined);
    assert.equal(read(`claims.${claim.id}`), undefined);
    assert.ok(!docs.ledger.pages.has(refund.id) && !docs.ledger.pages.has(applyMarkId(refund.id)), "its rows' lock pages went after it");
    const report = reconciliationReport();
    assert.deepEqual([report.differenceCp, report.pending.length], [0, 0], "reconciliation still balances");
    assert.equal(report.expectedCp, cpOf(docs.strongbox));
    const [page] = logPages("archive-page");
    assert.equal(flagsOf(page).orders.o1.id, "o1", "the order is in the Crafting Log");
    assert.ok(flagsOf(page).rows[refund.id]);
    assert.deepEqual(housekeeping.archived("orders").map((o) => o.id), ["o1"]);
    const carries = records("rows").filter((r) => r.kind === "carry");
    assert.ok(carries.length >= 1 && carries.every((c) => c.state === "applied"));
    assert.equal(read("meta.archive.runs"), 2);

    const view = fundsView({ rows: records("rows"), actualCp: cpOf(docs.strongbox), orders: {}, viewer: { userId: GM, isGM: true, owns: () => true },
        nameOf: (uuid) => uuid, userName: (id) => id, history: { rows: housekeeping.archived("rows"), orders: {}, shown: true } });
    assert.equal(view.history.count, 3, "the Funds tab's history: the deposit, the pledge and the refund, from the Crafting Log");
    assert.ok(view.history.rows.every((r) => r.archived && !r.canReverse));
});

test("two archivers at once from the same copy: one run lands, the other is refused at its slot, and nothing is carried twice", async (t) => {
    silence(t);
    const clock = controlClock(t);
    await closedOrder("o1");
    const [claim] = await claims.createClaims([refundOf(bo, 500)]);
    await claims.applyClaim(claim, bo);
    world.currentUser = GM;
    resetLease();
    requestLease(GM);
    clock.server += 2 * DAY_MS;
    const now = serverNow();
    const other = asUser(GM, () => housekeeping.archiveRun({ now, today: 100 }));   // the GM's second device
    let first;
    const restore = interleave((ops) => ops.some((op) => op.parent === log), async () => { first = await other(); });
    try {
        const second = await housekeeping.archiveRun({ now, today: 100 });
        assert.equal(first.outcome, "ok");
        assert.deepEqual([second.ok, second.reason], [false, "taken"]);
    } finally {
        restore();
    }
    assert.deepEqual([logPages("archive-page").length, logPages("archive-run").length], [1, 1]);
    assert.deepEqual(Object.keys(flagsOf(logPages("archive-page")[0]).orders), ["o1"]);
    assert.equal(read("meta.archive.runs"), 1);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("two archivers whose copies disagree: the run that sees more lands, the other is refused at the slot, and no carry row is overwritten", async (t) => {
    silence(t);
    const clock = controlClock(t);
    await asUser("p1", () => money.pledge({ actor: vera, cp: 200, nonce: "d1" }))();
    clock.server += DAY_MS;
    await asUser("p1", () => money.pledge({ actor: vera, cp: 100, nonce: "d2" }))();
    world.currentUser = GM;
    resetLease();
    requestLease(GM);
    clock.server += DAY_MS / 2;
    // An earlier run's page for this world year: both runs add to it (an update each), so only their slot keeps them apart.
    await log.createEmbeddedDocuments("JournalEntryPage", [archivePageData(0, { orders: {}, rows: {}, days: {}, claims: {}, jobs: {} },
        { name: "Year 1", stamp: { by: GM, at: {} } })], { keepId: true });
    const early = serverNow();   // the second deposit is younger than a real day here
    const late = early + DAY_MS;   // and older there
    const expected = reconciliationReport().expectedCp;
    let first;
    const restore = interleave((ops) => ops.some((op) => op.parent === log), async () => {
        first = await asUser(GM, () => housekeeping.archiveRun({ now: late, today: 100 }))();
    });
    try {
        const second = await housekeeping.archiveRun({ now: early, today: 100 });
        assert.deepEqual([first.outcome, first.counts.rows], ["ok", 2], "both deposits");
        assert.equal(second.reason, "taken", "planned with the first deposit alone, from the same run slot");
    } finally {
        restore();
    }
    const carry = records("rows").find((r) => r.kind === "carry" && r.actor === vera.uuid);
    assert.deepEqual([carry.box, carry.share], [300, 300], "Vera's carry row holds both deposits: the stale run did not overwrite it");
    assert.equal(reconciliationReport().expectedCp, expected, "the expected coins did not move");
    assert.equal((await housekeeping.archiveRun({ now: late, today: 100 })).outcome, "nothing", "nothing is left to move twice");
});

/** Each member's balance (5.9), by actor UUID: their share of the party fund, and Bo's 5 gp earmarked for o1. */
const balances = () => Object.fromEntries(memberBalances(records("rows")).byActor.map((b) => [b.actor, b.cp]));

/** Vera's two deposits, a day apart, judged half a day after the second: the first is past the real-day floor, the second not. */
async function twoDeposits(clock) {
    await asUser("p1", () => funds.deposit(vera.uuid, 200))();
    clock.server += DAY_MS;
    await asUser("p1", () => funds.deposit(vera.uuid, 100))();
    world.currentUser = GM;
    resetLease();
    requestLease(GM);
    // An earlier run's page for this world year: the runs add to it, so the year page does not refuse a run a second time.
    await log.createEmbeddedDocuments("JournalEntryPage", [archivePageData(0, { orders: {}, rows: {}, days: {}, claims: {}, jobs: {} },
        { name: "Year 1", stamp: { by: GM, at: {} } })], { keepId: true });
    clock.server += DAY_MS / 2;
}

test("a run planned again from a copy that missed it is refused however late, its slot in the ledger long pruned", async (t) => {
    silence(t);
    const clock = controlClock(t);
    await twoDeposits(clock);
    const before = world.batches.length;
    const run0 = await housekeeping.archiveRun({ now: serverNow(), today: 100 });   // the first deposit only
    assert.deepEqual([run0.outcome, run0.counts.rows], ["ok", 1]);
    assert.ok(log.pages.has(archiveRunPageId(0, 0)), "the run's own page in the Crafting Log");
    const replay = world.batches.slice(before).find((ops) => ops.some((op) => op.parent === log)).map((op) => ({
        ...op, ...(op.data ? { data: op.data.map((d) => structuredClone(d)) } : {}), ...(op.updates ? { updates: op.updates.map((u) => ({ ...u })) } : {}),
    }));
    clock.server += DAY_MS;
    const run1 = await housekeeping.archiveRun({ now: serverNow(), today: 100 });   // the second deposit; folds run 0's carry row
    assert.deepEqual([run1.outcome, read("meta.archive.runs")], ["ok", 2]);
    clock.server += PRUNE_AGE_MS + 60 * 1000;
    await housekeeping.pruneLocks();
    assert.ok(!docs.ledger.pages.has(archiveSlotId(0)) && !docs.ledger.pages.has(archiveSlotId(1)), "both runs' slots are pruned");
    const carries = () => records("rows").filter((r) => r.kind === "carry").map((r) => [r.idem, r.box, r.share]);
    const expected = reconciliationReport().expectedCp;
    assert.deepEqual(carries(), [[`carry:${vera.uuid}:1`, 300, 300]]);

    // A GM's client whose copy missed run 0 (a laptop asleep through it) plans run 0 again: the same request reaches the server.
    await foundry.documents.modifyBatch(replay);
    assert.deepEqual(carries(), [[`carry:${vera.uuid}:1`, 300, 300]], "run 0's carry row is not back beside the one that folded it");
    assert.equal(read("meta.archive.runs"), 2, "the run count does not go back");
    assert.equal(reconciliationReport().expectedCp, expected);
    assert.equal(reconciliationReport().differenceCp, 0);
    assert.deepEqual(balances(), { [vera.uuid]: 300, [bo.uuid]: 500 });
});

test("a run that stopped after its Crafting Log write is tried again, once the pruner frees its slot, as the run's next attempt", async (t) => {
    silence(t);
    const clock = controlClock(t);
    await twoDeposits(clock);
    // The ledger update fails at the server: the run's page and its records' copies are in the Crafting Log, the ledger as it was.
    world.server.beforeApply = (i, op) => {
        if (op.documentName === "JournalEntry") world.collections.JournalEntry.delete(docs.ledger.id);
    };
    let stopped;
    try {
        stopped = await housekeeping.archiveRun({ now: serverNow(), today: 100 });
    } finally {
        world.server.beforeApply = null;
        world.collections.JournalEntry.set(docs.ledger.id, docs.ledger);
    }
    assert.equal(stopped.ok, false);
    assert.equal(read("meta.archive"), undefined);
    assert.ok(log.pages.has(archiveRunPageId(0, 0)));
    assert.equal((await housekeeping.archiveRun({ now: serverNow(), today: 100 })).reason, "taken", "its slot is young");
    clock.server += PRUNE_AGE_MS + 60 * 1000;
    await housekeeping.pruneLocks();
    assert.ok(!docs.ledger.pages.has(archiveSlotId(0)), "the pruner freed the slot");
    const retry = await housekeeping.archiveRun({ now: serverNow() - DAY_MS / 2, today: 100 });
    assert.deepEqual([retry.outcome, retry.counts.rows, read("meta.archive.runs")], ["ok", 1, 1]);
    assert.ok(log.pages.has(archiveRunPageId(0, 1)), "the run's second attempt has a page of its own");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a Funds-tab reversal and an archive run of the row it reverses: whichever reaches the server second is refused", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const [deposit] = (await asUser("p1", () => funds.deposit(vera.uuid, 200))()).rows;
    await asUser("p2", () => funds.deposit(bo.uuid, 200))();
    clock.server += 2 * DAY_MS;
    world.currentUser = GM;
    resetLease();
    requestLease(GM);

    // The reversal first: the run, planned from a copy without it, names the reversal's row id and is refused.
    let reversed;
    let restore = interleave((ops) => ops.some((op) => op.parent === log), async () => { reversed = await asUser("p1", () => funds.reverse(deposit.id))(); });
    let run;
    try {
        run = await housekeeping.archiveRun({ now: serverNow(), today: 100 });
    } finally {
        restore();
    }
    assert.equal(reversed.ok, true);
    assert.deepEqual([run.ok, run.reason], [false, "taken"]);
    assert.deepEqual(balances(), { [bo.uuid]: 700 }, "Vera has her deposit back: none of the fund is hers");

    // The run first: a reversal planned from the copy before it is refused at the row id the run took.
    const [again] = (await asUser("p1", () => funds.deposit(vera.uuid, 200))()).rows;
    clock.server += 2 * DAY_MS;
    const guard = hashId(`reversal:${again.id}`);
    let ran;
    restore = interleave((ops) => ops.some((op) => op.parent === docs.ledger && op.action === "create" && op.data.some((d) => d._id === guard)),
        async () => { ran = await asUser(GM, () => housekeeping.archiveRun({ now: serverNow(), today: 100 }))(); });
    let late;
    const purse = cpOf(vera);
    try {
        late = await asUser("p1", () => funds.reverse(again.id))();
    } finally {
        restore();
    }
    assert.equal(ran.outcome, "ok");
    assert.equal(read(`rows.${again.id}`), undefined, "the deposit is in the Crafting Log");
    assert.equal(late.ok, false, "the reversal is refused");
    assert.equal(cpOf(vera), purse, "and moved nothing");
    assert.equal(lockOf(guard).kind, "reversal", "the run's guard says what it is");
    assert.deepEqual(balances(), { [vera.uuid]: 200, [bo.uuid]: 700 }, "each member's share is what they put in");
    assert.equal(reconciliationReport().differenceCp, 0);
    clock.server += PRUNE_AGE_MS + 60 * 1000;
    await housekeeping.pruneLocks();
    assert.ok(!docs.ledger.pages.has(guard), "and goes once old: the row is no longer live to plan a reversal from");
});

test("an order reopened by undo while a run is on its way: the undo lands first and the run is refused, or the run lands and the undo is", async (t) => {
    silence(t);
    const clock = controlClock(t);
    // A quest completed by its settlement (6.16.9), which undo takes back to `rolled`.
    await closedOrder("o3", { status: "complete", event: "settle" });
    world.currentUser = GM;
    resetLease();
    requestLease(GM);
    clock.server += 2 * DAY_MS;
    const now = serverNow();
    let undone;
    let restore = interleave((ops) => ops.some((op) => op.parent === log), async () => { undone = await orders.undo("o3"); });
    try {
        const run = await housekeeping.archiveRun({ now, today: 100 });
        assert.equal(undone.ok, true, "the undo took the order's next log slot first");
        assert.equal(run.reason, "taken", "so the run, which takes the same slot, wrote nothing");
    } finally {
        restore();
    }
    assert.equal(read("orders.o3.status"), "rolled");
    assert.equal(log.pages.size, 0);
    assert.equal((await housekeeping.archiveRun({ now, today: 100 })).outcome, "nothing", "a reopened order is not archived");

    // The other way round: a fresh close, then the run first and an undo planned from the copy before it.
    await closedOrder("o4", { status: "complete", event: "settle", agoMs: 2 * DAY_MS });
    let run;
    restore = interleave((ops) => ops.some((op) => op.documentName === "JournalEntryPage" && op.data?.some((d) => d._id === logLockId("o4", 3))),
        async () => { run = await housekeeping.archiveRun({ now, today: 100 }); });
    try {
        const late = await orders.undo("o4");
        assert.equal(run.outcome, "ok");
        assert.deepEqual([late.ok, late.reason], [false, "taken"], "the undo planned before the run is refused at the slot the run took");
    } finally {
        restore();
    }
    assert.equal(read("orders.o4"), undefined, "archived, and no stub left by the refused undo");
    assert.equal(flagsOf(logPages("archive-page")[0]).orders.o4.status, "complete");
});

test("archiving waits for a GM and the Crafting Log; the GM's next check creates the log in a world from before it", async (t) => {
    silence(t);
    assert.equal((await housekeeping.archiveRun({ today: 100 })).reason, "not-gm");
    world.currentUser = GM;
    resetLease();
    requestLease(GM);
    log.delete({ [MOD]: { internal: true } });
    assert.equal((await housekeeping.archiveRun({ today: 100 })).reason, "no-log");
    await game.settings.set(MOD, "enabled", true);
    shared.resetMaintenance();
    await shared.gmMaintenance();
    const created = shared.locateArchive();
    assert.ok(created, "the active GM's check created it");
    assert.equal(created.ownership.default, 2);
});
