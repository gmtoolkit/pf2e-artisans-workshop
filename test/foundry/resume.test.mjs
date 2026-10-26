/**
 * Resuming a coin move whose lock request landed but whose apply request never did (DESIGN.md 5.4, As built:
 * Resume), over the fake world: the answer to the lock request lost with the connection leaves a pending row, its
 * lock held, a claim resolved and no coins moved. After the client reloads, the sweep sends the move's apply request
 * again, once the row is past the grace time, its items are as planned and this tab is the one to resume it; the
 * apply mark lets that request through once, whoever sends it. Reconciliation tells a row the module resumes from one
 * that needs a hand: a close by hand and a GM's adjust leave a move the module resumes alone, and take the mark of one
 * that needs a hand, so of a close, an adjust and an apply request exactly one lands.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
    MOD, addDocument, asUser, coin, controlClock, disconnect, flagsOf, installFoundry, interleave, resetWorld, serverStamp, setUsers, sharedWorld, world,
} from "./stubs.mjs";

installFoundry();
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { applyMarkId } = await import("../../scripts/logic/lock-first.mjs");
const { PENDING_GRACE_MS, memberBalances } = await import("../../scripts/logic/reconcile.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease, withCoinMutex } = await import("../../scripts/foundry/lease.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const { bookAdjustment, reconciliationReport, reportOwnPending } = await import("../../scripts/foundry/reconcile.mjs");
const { registerSettings } = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records } = await import("../../scripts/foundry/store.mjs");

registerSettings({ enabled: () => {}, docs: () => {} });
const GM = "gm00000000000000";
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const silence = (t) => { for (const level of ["warn", "error", "info", "table"]) t.mock.method(console, level, () => {}); };
/** Let the promise chains started so far run to the end. */
const flush = async () => { for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve)); };

let docs;
let vera;
let bo;
beforeEach(async () => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    money.resetResume();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });   // one tab, no Web Locks
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 10)] });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 10)] });
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: GM, isGM: true }], "p2");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p2");
    registerBatchWatcher();
    await money.pledge({ actor: bo, cp: 500, order: "o1", nonce: "n" });   // 5 gp in the strongbox
    world.currentUser = "p1";
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

/**
 * Run `move` with its first request (the lock request) applied by the server and its answer lost with the
 * connection, as the live harness's `resume` check does: the client never sends the apply request.
 */
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

/** This client reloads: its copies are read again, it is no longer stale, and it forgets this session's attempts. */
function reload() {
    state.resetState();
    state.setShared({ ...docs, status: "ready" });
    money.resetResume();
}

const refund = (actor, cp) => ({ kind: "refund", idem: `refund:o1:${actor.uuid}:r`, actor: actor.uuid, cp, parties: [bo.uuid] });

/** Whether a request is an apply request (it changes items), or takes a mark by hand. */
const applies = (operations) => operations.some((op) => op.documentName === "Item");
const byHand = (operations) => operations.some((op) => op.documentName === "JournalEntryPage" && op.data.some((d) => d.flags?.[MOD]?.hand));

test("a move whose lock request landed but whose answer was lost: after a reload its author resumes it, once, past the grace time", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const result = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "s1" }));
    assert.deepEqual([result.outcome, result.reason], ["unknown", "disconnected"]);
    const [row] = result.rows;
    assert.equal(state.status(), "stale");
    assert.equal(read(`rows.${row.id}.state`), "pending", "the lock request landed: its row is pending, its lock held");
    assert.ok(docs.ledger.pages.get(row.id).flags[MOD].move, "and its lock page holds the move");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse, before.box], "no coins moved");
    clock.server += PENDING_GRACE_MS;
    assert.deepEqual(await money.resumeStalled(), { resumed: 0, dueInMs: null }, "a stale client resumes nothing");

    reload();
    clock.server -= PENDING_GRACE_MS - 20 * 1000;   // back to 20 s after the move
    assert.deepEqual(await money.resumeStalled(), { resumed: 0, dueInMs: PENDING_GRACE_MS - 20 * 1000 }, "too young: it may still be in flight");
    clock.server += PENDING_GRACE_MS;
    assert.deepEqual(await money.resumeStalled(), { resumed: 1, dueInMs: null });
    assert.equal(read(`rows.${row.id}.state`), "applied");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse - 300, before.box + 300], "the coins moved");
    assert.equal(docs.ledger.pages.get(applyMarkId(row.id)).flags[MOD].lock.by, "p1", "its apply mark, by its author");

    assert.deepEqual(await money.resumeStalled(), { resumed: 0, dueInMs: null });
    reload();
    assert.deepEqual(await money.resumeStalled(), { resumed: 0, dueInMs: null }, "nor again after another reload");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse - 300, before.box + 300], "once");
    assert.equal(reconciliationReport().differenceCp, 0);
    assert.equal(reconciliationReport().pending.length, 0);
});

test("a refund claim whose lock request landed is resolved with it, so the claim sweep leaves it; the resume pays it, once", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const [claim] = await claims.createClaims([refund(vera, 200)]);
    const before = cpOf(vera);
    const result = await strand(() => claims.applyClaim(claim, vera));
    assert.equal(result.outcome, "unknown");
    assert.ok(read(`claims.${claim.id}.resolved`), "resolved with the lock: nothing would retry the claim");
    reload();
    clock.server += PENDING_GRACE_MS;
    assert.equal(await claims.sweepClaims(), 0);
    assert.equal(cpOf(vera), before, "and nothing has paid it");
    assert.equal((await money.resumeStalled()).resumed, 1);
    assert.equal(cpOf(vera), before + 200);
    assert.equal(read(`rows.${claim.id}.state`), "applied");
    assert.equal(await claims.sweepClaims(), 0);
    assert.equal((await money.resumeStalled()).resumed, 0);
    assert.equal(cpOf(vera), before + 200, "paid once");
});

test("who resumes: the author's tab while the author is connected; once the author has gone, the purse's responsible client", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "s2" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    world.currentUser = "p2";
    assert.equal((await money.resumeStalled()).resumed, 0, "another player: not their move, nor their purse");
    world.currentUser = GM;
    assert.equal((await money.resumeStalled()).resumed, 0, "the GM, while the author is connected: the author's to resume");
    game.users.get("p1").active = false;
    world.currentUser = "p2";
    assert.equal((await money.resumeStalled()).resumed, 0, "a player who does not own the purse, the author gone");
    world.currentUser = GM;
    assert.equal((await money.resumeStalled()).resumed, 1, "the active GM, responsible for the purse while no owner is connected");
    assert.equal(docs.ledger.pages.get(applyMarkId(row.id)).flags[MOD].lock.by, GM);
    assert.equal(read(`rows.${row.id}.state`), "applied");
});

test("a move whose purse changed since it was planned is left to its author or a GM, who hears of it", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "s3" }));
    reload();
    const [stack] = vera.items.contents;
    await stack.update({ "system.quantity": 9 });   // a gold piece spent by hand meanwhile: the planned quantity is wrong now
    clock.server += PENDING_GRACE_MS;
    assert.deepEqual(await money.resumeStalled(), { resumed: 0, dueInMs: null });
    assert.equal(read(`rows.${row.id}.state`), "pending");
    assert.equal(stack.quantity, 9, "the hand change stands");
    assert.equal(reportOwnPending().reported, 1, "its author is told");
});

test("a move whose apply request was sent and refused is not resumed: its stopped note sends it the manual way", async (t) => {
    silence(t);
    const clock = controlClock(t);
    world.server.beforeDryRun = (operations) => {
        if (operations.some((op) => op.documentName === "Item")) vera.items.clear();   // the purse emptied by hand between the requests
    };
    const result = await money.pledge({ actor: vera, cp: 300, nonce: "s4" });
    world.server.beforeDryRun = null;
    assert.deepEqual([result.outcome, result.reason], ["stopped", "dry-run"]);
    const [row] = result.rows;
    assert.equal(read(`rows.${row.id}.stopped.reason`), "dry-run");
    clock.server += PENDING_GRACE_MS;
    assert.equal((await money.resumeStalled()).resumed, 0);
    assert.equal(read(`rows.${row.id}.state`), "pending");
});

test("the move's own apply request, answered late, against a resume from another device: coins move once and the row stays applied", async (t) => {
    silence(t);
    const clock = controlClock(t);
    // Two devices of Player One: each has its own lock manager, so the coin mutex holds neither back.
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_name, task) => task() } }, configurable: true });
    const real = foundry.documents.modifyBatch;
    let release = null;
    foundry.documents.modifyBatch = (operations) => {   // device A's apply request waits on a busy server
        if (release || !operations.some((op) => op.documentName === "Item")) return real(operations);
        return new Promise((resolve) => { release = () => resolve(real(operations)); });
    };
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const deviceA = money.pledge({ actor: vera, cp: 300, nonce: "s5" });
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    foundry.documents.modifyBatch = real;
    clock.server += PENDING_GRACE_MS;
    let resumed;
    try {
        resumed = await money.resumeStalled();   // device B: the apply request has not landed
    } finally {
        release();
    }
    const a = await deviceA;
    assert.equal(resumed.resumed, 1, "device B resumed it");
    assert.deepEqual([a.outcome, a.reason], ["taken", "dry-run"], "device A's request is refused at the apply mark, which it sees now");
    assert.equal(read(`rows.${a.rows[0].id}.state`), "applied");
    assert.equal(read(`rows.${a.rows[0].id}.stopped`), undefined, "nothing noted on a row the resume settled");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse - 300, before.box + 300], "the coins moved once");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("an apply request refused at its mark in the server's real pass was taken by a resume: nothing applied, nothing noted", async (t) => {
    silence(t);
    const before = cpOf(vera);
    world.server.beforeApply = (i, operation) => {
        const id = operation.data?.[0]?._id;
        const mark = i === 0 && operation.documentName === "JournalEntryPage" && Object.keys(flagsOf(docs.ledger).rows ?? {}).some((r) => applyMarkId(r) === id);
        if (mark) docs.ledger.pages.set(id, { id, flags: { [MOD]: { lock: { by: "someone" } } } });   // a resume's apply mark landed between this request's dry run and its real pass
    };
    const result = await money.pledge({ actor: vera, cp: 300, nonce: "s6" });
    world.server.beforeApply = null;
    assert.deepEqual([result.outcome, result.reason], ["taken", "first"]);
    assert.equal(cpOf(vera), before, "none of this request applied");
    assert.equal(read(`rows.${result.rows[0].id}.stopped`), undefined, "the row is the resume's to settle");
});

test("a stopped move's note never sets its rows back to pending, unless its request went out without an operation", async (t) => {
    silence(t);
    // Refused for a reason of its own (the purse emptied by hand) while another client's resume, whose apply mark
    // has not reached this client yet, settled the row: the note must leave that settle alone.
    world.server.beforeDryRun = (operations) => {
        if (!operations.some((op) => op.documentName === "Item")) return;
        const [id] = Object.keys(flagsOf(docs.ledger).rows).filter((r) => flagsOf(docs.ledger).rows[r].state === "pending");
        flagsOf(docs.ledger).rows[id].state = "applied";
        vera.items.clear();
    };
    const refused = await money.pledge({ actor: vera, cp: 300, nonce: "n1" });
    world.server.beforeDryRun = null;
    assert.deepEqual([refused.outcome, refused.reason], ["stopped", "dry-run"]);
    assert.equal(read(`rows.${refused.rows[0].id}.state`), "applied", "the settle stands");
    assert.equal(read(`rows.${refused.rows[0].id}.stopped.reason`), "dry-run", "and the note says what happened here");
    // A request the client sent without an operation it dropped (pf2e's `deleteDocuments`) may have settled the rows
    // without moving everything: they are pending again.
    const bos = bo.items.contents[0];
    world.currentUser = "p2";
    world.client.beforeSend = (operations) => {
        if (operations.some((op) => op.action === "delete" && op.parent === bo)) bo.items.delete(bos.id);   // another client's broadcast arrives now
    };
    const shrunk = await money.pledge({ actor: bo, cp: bos.quantity * 100, nonce: "n2" });
    world.client.beforeSend = null;
    assert.deepEqual([shrunk.outcome, shrunk.reason], ["stopped", "shrunk"]);
    assert.equal(read(`rows.${shrunk.rows[0].id}.state`), "pending");
});

test("a close by hand reaching the server while a resume's apply request is on its way takes the mark: the resume is refused there", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "c1" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    assert.deepEqual(reconciliationReport().resumable.map((r) => r.id), [row.id], "the module resumes it: nobody needs to close it");
    // Player One resumes it. As the apply request goes out, a GM takes the character away: nobody connected may resume
    // the move now, so on the GM's client it needs a hand, and the GM closes it.
    let closed = null;
    const restore = interleave(applies, asUser(GM, async () => {
        vera.ownership.p1 = 0;
        assert.deepEqual(reconciliationReport().needsHand.map((r) => r.id), [row.id]);
        closed = await money.resolvePending(row.id, "checked by hand");
    }));
    const resumed = await money.resumeStalled();
    restore();
    assert.deepEqual(closed, { ok: true, rows: [row.id] });
    assert.equal(resumed.resumed, 0, "refused at the mark the close took");
    assert.equal(read(`rows.${row.id}.state`), "applied");
    assert.equal(read(`rows.${row.id}.resolved.note`), "checked by hand");
    const mark = docs.ledger.pages.get(applyMarkId(row.id)).flags[MOD];
    assert.deepEqual([mark.lock.by, mark.hand], [GM, { kind: "close", row: row.id }]);
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse, before.box], "no coins moved: the close won");
});

test("a resume reaching the server while a close's request is on its way: the close is refused (taken), the resume's settle stands", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "c2" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    world.currentUser = GM;
    vera.ownership.p1 = 0;   // Player One cannot write the purse: nobody connected may resume the move, so it needs a hand
    // As the GM's close goes out, the character is given back, and Player One's client resumes the move first.
    let resumed = null;
    const restore = interleave(byHand, asUser("p1", async () => {
        vera.ownership.p1 = 3;
        resumed = await money.resumeStalled();
    }));
    const closed = await money.resolvePending(row.id, "checked by hand");
    restore();
    assert.equal(resumed.resumed, 1);
    assert.deepEqual(closed, { ok: false, reason: "taken" });
    assert.equal(read(`rows.${row.id}.state`), "applied");
    assert.equal(read(`rows.${row.id}.resolved`), undefined, "nothing of the close was written");
    assert.equal(docs.ledger.pages.get(applyMarkId(row.id)).flags[MOD].lock.by, "p1");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse - 300, before.box + 300], "the coins moved once");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a close by hand is refused while a request may still be applying the row", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "c3" }));
    world.currentUser = GM;
    reload();
    assert.deepEqual(await money.resolvePending(row.id), { ok: false, reason: "in-flight" }, "younger than the grace time");
    assert.equal(docs.ledger.pages.has(applyMarkId(row.id)), false, "its mark is left for the move's own apply request");
    clock.server += PENDING_GRACE_MS;
    const markId = applyMarkId(row.id);
    docs.ledger.pages.set(markId, { id: markId, flags: { [MOD]: { lock: { by: "p1", at: serverStamp() } } } });   // a resume's, just now
    assert.deepEqual(await money.resolvePending(row.id), { ok: false, reason: "in-flight" }, "a resume took its mark just now");
    clock.server += PENDING_GRACE_MS;   // and stopped part-way: now it needs a hand
    assert.deepEqual(await money.resolvePending(row.id, "coins checked"), { ok: true, rows: [row.id] });
    assert.equal(read(`rows.${row.id}.state`), "applied");
});

test("a GM's adjust leaves a move the module resumes alone: its coins are not booked, and once resumed its pledger has paid", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, order: "o1", nonce: "b1" }));
    clock.server += PENDING_GRACE_MS + 30 * 1000;
    // Player One's only client is stale and still connected, so nobody resumes the move yet; the GM sees the difference.
    world.currentUser = GM;
    reload();   // the GM's client (the stubs keep one status for every user)
    assert.equal((await money.resumeStalled()).resumed, 0, "the author is connected: theirs to resume");
    const report = reconciliationReport();
    assert.deepEqual([report.differenceCp, report.resumable.map((r) => r.id), report.owedBoxCp], [-300, [row.id], 300]);
    assert.deepEqual(await bookAdjustment("stranded pledge"), { ok: false, reason: "resumable" }, "the difference settles by itself");
    assert.equal(docs.ledger.pages.has(applyMarkId(row.id)), false, "its mark is left for the resume");
    docs.strongbox.addItem(coin("sp", 5));   // 50 cp dragged in by hand meanwhile
    const booked = await bookAdjustment("found in the box");
    assert.equal(booked.outcome, "ok");
    assert.equal(booked.rows[0].box, 50, "only what nothing explains is booked");
    assert.equal(docs.ledger.pages.has(applyMarkId(row.id)), false);
    assert.deepEqual(await money.resolvePending(row.id, "looked fine"), { ok: false, reason: "resumable" }, "nor can a close cancel it");
    // The author reloads, and the sweep resumes the move: the coins and the rows agree, and Vera has paid her pledge.
    world.currentUser = "p1";
    reload();
    assert.equal((await money.resumeStalled()).resumed, 1);
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse - 300, before.box + 300 + 50]);
    assert.equal(read(`rows.${row.id}.state`), "applied");
    assert.equal(reconciliationReport().differenceCp, 0);
    const balances = memberBalances(records("rows"));
    assert.deepEqual(balances.byAllocation.map(({ actor, order, cp }) => [actor, order, cp]).sort(), [[bo.uuid, "o1", 500], [vera.uuid, "o1", 300]].sort());
    assert.equal(balances.unassignedCp, 50, "the hand coins belong to nobody in particular");
});

test("coins dragged in that match what a resumable move will bring are booked, though the report balances", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const box = cpOf(docs.strongbox);
    await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "b5" }));
    clock.server += PENDING_GRACE_MS;
    world.currentUser = GM;
    reload();
    docs.strongbox.addItem(coin("gp", 3));   // 300 cp dragged in by hand
    assert.deepEqual([reconciliationReport().differenceCp, reconciliationReport().owedBoxCp], [0, 300]);
    const booked = await bookAdjustment("found in the box");
    assert.deepEqual([booked.outcome, booked.rows[0].box], ["ok", 300], "the pledge will bring its own coins");
    world.currentUser = "p1";
    reload();
    assert.equal((await money.resumeStalled()).resumed, 1);
    assert.equal(cpOf(docs.strongbox), box + 600);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a GM's adjust takes the apply mark of a strongbox move that needs a hand: no late request lands after it", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "b4" }));
    clock.server += PENDING_GRACE_MS;
    world.currentUser = GM;
    reload();
    vera.ownership.p1 = 0;   // Player One cannot write the purse: nobody connected may resume the move
    assert.deepEqual(reconciliationReport().needsHand.map((r) => r.id), [row.id]);
    const booked = await bookAdjustment("stranded pledge");
    assert.equal(booked.outcome, "ok");
    const mark = docs.ledger.pages.get(applyMarkId(row.id)).flags[MOD];
    assert.deepEqual([mark.lock.by, mark.hand], [GM, { kind: "adjust", row: booked.rows[0].id }]);
    assert.equal(reconciliationReport().differenceCp, 0);
    vera.ownership.p1 = 3;   // the character is given back before anyone closes the row
    world.currentUser = "p1";
    reload();
    assert.equal((await money.resumeStalled()).resumed, 0, "the mark is taken");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse, before.box], "no coins moved");
    assert.equal(reconciliationReport().differenceCp, 0, "the booked difference stands");
    assert.deepEqual(await money.resolvePending(row.id, "booked by the GM"), { ok: true, rows: [row.id] }, "its author closes it");
    assert.deepEqual(reconciliationReport().pending, []);
});

test("a resume reaching the server while a GM's adjust is on its way: the adjust is refused (taken), and nothing is left to book", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "b2" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    world.currentUser = GM;
    vera.ownership.p1 = 0;   // nobody connected may resume the move: on the GM's client it needs a hand
    let resumed = null;
    const restore = interleave(byHand, asUser("p1", async () => {
        vera.ownership.p1 = 3;   // given back as the booking goes out: Player One's client resumes the move first
        resumed = await money.resumeStalled();
    }));
    const booked = await bookAdjustment("stranded pledge");
    restore();
    assert.equal(resumed.resumed, 1);
    assert.deepEqual([booked.ok, booked.reason], [false, "taken"]);
    assert.equal(records("rows").filter((r) => r.kind === "adjust").length, 0, "no adjust row");
    assert.equal(read(`rows.${row.id}.state`), "applied");
    assert.deepEqual(await bookAdjustment(), { ok: true, outcome: "balanced" }, "looked at again, nothing to book");
});

/** Two clients, each with a coin mutex of its own (two devices, or two users), as `interleave` sets up. */
const twoClients = () => Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_name, task) => task() } }, configurable: true });

/**
 * Player One's pledge, its apply request held at a busy server's door: the move's result (a promise), its row, and
 * `release`, which lets that request through as Player One's and waits for the move to end.
 */
async function heldPledge(nonce) {
    world.currentUser = "p1";
    const real = foundry.documents.modifyBatch;
    let held = null;
    foundry.documents.modifyBatch = (operations) => {
        if (held || !applies(operations)) return real(operations);
        return new Promise((resolve) => { held = () => resolve(real(operations)); });
    };
    const result = money.pledge({ actor: vera, cp: 300, nonce });
    while (!held) await new Promise((resolve) => setImmediate(resolve));
    foundry.documents.modifyBatch = real;
    const row = records("rows").find((r) => r.state === "pending");
    return { result, row, release: asUser("p1", async () => { held(); await result; }) };
}

test("a GM's adjust leaves a move in flight out of the difference: it books only what nothing explains, and the move still lands", async (t) => {
    silence(t);
    const clock = controlClock(t);
    twoClients();
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const { result, row, release } = await heldPledge("b3");
    world.currentUser = GM;
    let report = reconciliationReport();
    assert.deepEqual([report.differenceCp, report.inFlight.map((r) => r.id)], [-300, [row.id]], "its row counts, its coins have not moved yet");
    assert.deepEqual(await bookAdjustment(), { ok: false, reason: "in-flight" }, "still owed by its own move: nothing to book");
    docs.strongbox.addItem(coin("sp", 5));   // 50 cp dragged in by hand meanwhile
    const booked = await bookAdjustment("found in the box");
    assert.deepEqual([booked.outcome, booked.rows[0].box], ["ok", 50], "only what nothing explains is booked");
    assert.equal(docs.ledger.pages.has(applyMarkId(row.id)), false, "its mark is left for the move's own apply request");
    await release();
    assert.equal((await result).outcome, "ok", "the move lands");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse - 300, before.box + 300 + 50]);
    report = reconciliationReport();
    assert.deepEqual([report.differenceCp, report.pending], [0, []], "the coins and the rows agree");
    // A move stranded past the grace time is owed too while the module resumes it, and counts once it needs a hand.
    world.currentUser = "p1";
    const { rows: [stranded] } = await strand(() => money.pledge({ actor: vera, cp: 100, nonce: "b6" }));
    world.currentUser = GM;
    reload();
    assert.deepEqual(await bookAdjustment(), { ok: false, reason: "in-flight" }, "younger than the grace time");
    clock.server += PENDING_GRACE_MS;
    assert.deepEqual(await bookAdjustment(), { ok: false, reason: "resumable" }, "past the grace time the module resumes it");
    vera.ownership.p1 = 0;
    assert.equal((await bookAdjustment()).outcome, "ok", "once it needs a hand, its difference is booked");
    assert.equal(docs.ledger.pages.get(applyMarkId(stranded.id)).flags[MOD].hand.kind, "adjust");
});

test("a close by hand of a move that needs a hand lands before the move's own late apply request: that request is refused at the mark", async (t) => {
    silence(t);
    const clock = controlClock(t);
    twoClients();
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const { result, row, release } = await heldPledge("l1");
    clock.server += PENDING_GRACE_MS;
    world.currentUser = GM;
    vera.ownership.p1 = 0;   // a GM takes the character away: nobody connected may resume the move, so it needs a hand
    assert.deepEqual(reconciliationReport().needsHand.map((r) => r.id), [row.id]);
    assert.deepEqual(await money.resolvePending(row.id, "checked by hand"), { ok: true, rows: [row.id] });
    await release();
    const late = await result;
    assert.equal(late.outcome, "taken", "refused at the mark the close took");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse, before.box], "no coins moved: only the close landed");
    assert.deepEqual([read(`rows.${row.id}.state`), read(`rows.${row.id}.resolved.note`)], ["applied", "checked by hand"]);
    assert.deepEqual(docs.ledger.pages.get(applyMarkId(row.id)).flags[MOD].hand, { kind: "close", row: row.id });
});

test("a move's own late apply request lands before a close by hand of it: the close is refused at the mark, the coins moved once", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const { result, row, release } = await heldPledge("l2");
    clock.server += PENDING_GRACE_MS;
    world.currentUser = GM;
    vera.ownership.p1 = 0;   // it needs a hand on the GM's client
    assert.deepEqual(reconciliationReport().needsHand.map((r) => r.id), [row.id]);
    const restore = interleave(byHand, release);   // the close goes out as the held request gets through
    const closed = await money.resolvePending(row.id, "checked by hand");
    restore();
    assert.equal((await result).outcome, "ok", "the move's own apply request landed first");
    assert.deepEqual(closed, { ok: false, reason: "taken" });
    assert.equal(read(`rows.${row.id}.state`), "applied");
    assert.equal(read(`rows.${row.id}.resolved`), undefined, "nothing of the close was written");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse - 300, before.box + 300], "the coins moved once");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("the device that loses a resume race at the mark does not tell its user the move did not finish", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "d1" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    // The other device's apply request lands between this one's dry run and its real pass; its settle has not reached
    // this client yet (the verifier's probe C).
    world.server.beforeApply = (i, op) => {
        if (i !== 0 || op.documentName !== "JournalEntryPage") return;
        const id = op.data[0]._id;
        docs.ledger.pages.set(id, { id, flags: { [MOD]: { lock: { by: "p1", at: serverStamp() } } } });
    };
    const lost = await money.resumeStalled();
    world.server.beforeApply = null;
    assert.equal(lost.resumed, 0);
    assert.equal(read(`rows.${row.id}.state`), "pending", "as this client still sees it");
    assert.deepEqual(reconciliationReport().inFlight.map((r) => r.id), [row.id], "the winner's request may be applying it");
    assert.equal(reportOwnPending().reported, 0);
    assert.equal(world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Sync.PendingRows").length, 0);
    clock.server += PENDING_GRACE_MS;   // the winner stopped part-way after all: now it needs a hand
    assert.equal(reportOwnPending().reported, 1);
});

test("a device refused at its dry run before the winner's mark reached it does not tell its user either", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "d2" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    // The server refuses this device's apply request at its dry run, at the mark the other device's request took; this
    // client hears of that mark only later (the server tells the others once the whole winning request has applied).
    const markId = applyMarkId(row.id);
    const real = foundry.documents.modifyBatch;
    foundry.documents.modifyBatch = async (operations) => {
        if (!applies(operations)) return real(operations);
        docs.ledger.pages.set(markId, { id: markId, flags: { [MOD]: { lock: { by: "p1", at: serverStamp() } } } });
        try {
            return await real(operations);
        } finally {
            docs.ledger.pages.delete(markId);
        }
    };
    const lost = await money.resumeStalled();
    foundry.documents.modifyBatch = real;
    assert.equal(lost.resumed, 0);
    assert.equal(read(`rows.${row.id}.stopped.reason`), "dry-run", "taken for a refusal of its own");
    assert.deepEqual(reconciliationReport().inFlight.map((r) => r.id), [row.id]);
    assert.equal(reportOwnPending().reported, 0);
    clock.server += PENDING_GRACE_MS;
    assert.equal(reportOwnPending().reported, 1, "past the grace time a refusal is a refusal");
});

test("a resume refused at its mark before the mark reached this client is not sent again this session", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "u1" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    // The server holds another client's mark; this client does not have it yet.
    const markId = applyMarkId(row.id);
    world.server.beforeApply = (i) => { if (i === 0) docs.ledger.pages.set(markId, { id: markId, flags: { [MOD]: { lock: { by: "p1", at: serverStamp() } } } }); };
    const real = foundry.documents.modifyBatch;
    foundry.documents.modifyBatch = async (operations) => {
        try {
            return await real(operations);
        } finally {
            docs.ledger.pages.delete(markId);
        }
    };
    try {
        assert.equal((await money.resumeStalled()).resumed, 0, "taken");
        const sent = world.batches.length;
        assert.deepEqual(await money.resumeStalled(), { resumed: 0, dueInMs: null });
        assert.equal(world.batches.length, sent, "not sent again, though this client's copy still says it could be");
        reload();
        assert.equal((await money.resumeStalled()).resumed, 0);
        assert.equal(world.batches.length, sent + 1, "after a reload it is judged afresh");
    } finally {
        foundry.documents.modifyBatch = real;
        world.server.beforeApply = null;
    }
});

test("a resume judges the move again inside the coin mutex: a purse changed while it waited is left alone", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "m1" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    let open;
    const held = withCoinMutex("p1", () => new Promise((resolve) => { open = resolve; }));   // a move of this client's own, waiting for an answer
    const resuming = money.resumeStalled();   // judged resumable outside the mutex; waits for it
    await flush();
    const [stack] = vera.items.contents;
    await stack.update({ "system.quantity": 9 });   // a gold piece spent by hand meanwhile
    open();
    await held;
    assert.deepEqual(await resuming, { resumed: 0, dueInMs: null });
    assert.equal(stack.quantity, 9, "the planned quantity did not overwrite the hand change");
    assert.equal(read(`rows.${row.id}.state`), "pending");
});

test("while its author is connected, only the author's tab holding the lease resumes a move, and only if the author still owns the purse", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "l1" }));
    reload();
    clock.server += PENDING_GRACE_MS;
    resetLease();   // another tab of Player One's holds the lease
    const sent = world.batches.length;
    assert.equal((await money.resumeStalled()).resumed, 0, "not the lease-holding tab");
    requestLease("p1");
    vera.ownership.p1 = 0;   // a GM took the character away meanwhile: Player One can no longer write the purse
    assert.equal((await money.resumeStalled()).resumed, 0, "not the purse's owner");
    assert.equal(world.batches.length, sent, "nothing sent");
    assert.equal(read(`rows.${row.id}.state`), "pending");
    vera.ownership.p1 = 3;
    assert.equal((await money.resumeStalled()).resumed, 1);
});

test("a close by hand of a row the module resumes is refused: nothing is written, and the resume moves the coins", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const before = { purse: cpOf(vera), box: cpOf(docs.strongbox) };
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, order: "o1", nonce: "r1" }));
    clock.server += PENDING_GRACE_MS + 1000;
    world.currentUser = GM;
    reload();
    assert.deepEqual(reconciliationReport().resumable.map((r) => r.id), [row.id]);
    const sent = world.batches.length;
    assert.deepEqual(await money.resolvePending(row.id, "looked fine"), { ok: false, reason: "resumable" },
        "closing it would cancel a move whose row still counts");
    assert.equal(world.batches.length, sent, "nothing sent");
    assert.deepEqual([read(`rows.${row.id}.state`), read(`rows.${row.id}.resolved`)], ["pending", undefined]);
    assert.equal(docs.ledger.pages.has(applyMarkId(row.id)), false);
    world.currentUser = "p1";
    reload();
    assert.equal((await money.resumeStalled()).resumed, 1);
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [before.purse - 300, before.box + 300]);
    assert.equal(reconciliationReport().differenceCp, 0);
});

/** A spend of 400 cp from the strongbox over two contributors' shares, stranded after its lock request (two rows). */
async function strandSpend(stem) {
    world.currentUser = "p2";
    const allocations = [{ actor: bo.uuid, cp: 300 }, { actor: vera.uuid, cp: 200 }];
    const result = await strand(() => money.spend({ kind: "expend", stem, cp: 400, allocations, link: { order: "o1" } }));
    assert.equal(result.rows.length, 2);
    return result.rows;
}

test("a close of one row of a two-row spend the module resumes is refused; the resume settles both rows", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const box = cpOf(docs.strongbox);
    const [r1, r2] = await strandSpend("expend:o1:1:0");
    clock.server += PENDING_GRACE_MS + 1000;
    world.currentUser = GM;
    reload();
    assert.deepEqual(await money.resolvePending(r1.id, "this share is fine"), { ok: false, reason: "resumable" });
    world.currentUser = "p2";
    reload();
    assert.equal((await money.resumeStalled()).resumed, 1);
    assert.deepEqual([read(`rows.${r1.id}.state`), read(`rows.${r2.id}.state`)], ["applied", "applied"]);
    assert.equal(cpOf(docs.strongbox), box - 400);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a close of one row of a two-row spend that needs a hand closes every row of it, in one request with its mark", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const [r1, r2] = await strandSpend("expend:o1:1:1");
    const [stack] = docs.strongbox.items.contents.filter((i) => i.isCoinage);
    await stack.update({ "system.quantity": stack.quantity });   // touched by hand since the spend was planned: no resume
    clock.server += PENDING_GRACE_MS + 1000;
    world.currentUser = GM;
    reload();
    assert.deepEqual(reconciliationReport().needsHand.map((r) => r.id).sort(), [r1.id, r2.id].sort());
    const sent = world.batches.length;
    assert.deepEqual(await money.resolvePending(r1.id, "the share was paid by hand"), { ok: true, rows: [r1.id, r2.id] });
    assert.equal(world.batches.length, sent + 1, "one request");
    assert.deepEqual([read(`rows.${r1.id}.state`), read(`rows.${r2.id}.state`)], ["applied", "applied"]);
    assert.equal(read(`rows.${r2.id}.resolved.note`), "the share was paid by hand");
    assert.deepEqual(docs.ledger.pages.get(applyMarkId(r1.id)).flags[MOD].hand, { kind: "close", row: r1.id });
    assert.deepEqual(reconciliationReport().pending, [], "no row of the move is left behind");
});

test("a move nobody connected resumes needs a hand: its author connected without the purse is told, and a GM can close it", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "e1" }));
    reload();
    clock.server += PENDING_GRACE_MS + 1000;
    vera.ownership.p1 = 0;   // a GM took the character away: its author may not resume it, and while connected no one else does
    assert.equal((await money.resumeStalled()).resumed, 0);
    assert.deepEqual([reconciliationReport().resumable, reconciliationReport().needsHand.map((r) => r.id)], [[], [row.id]]);
    assert.equal(reportOwnPending().reported, 1, "its author is told");
    world.currentUser = GM;
    reload();
    assert.equal((await money.resumeStalled()).resumed, 0, "the author is connected: not the GM's to resume");
    // Nobody connected at all who may resume it: its author gone, and no owner of the purse nor GM.
    game.users.get("p1").active = false;
    game.users.get(GM).active = false;
    world.currentUser = "p2";
    assert.deepEqual(reconciliationReport().needsHand.map((r) => r.id), [row.id]);
    game.users.get(GM).active = true;
    assert.deepEqual(reconciliationReport().resumable.map((r) => r.id), [row.id], "with the GM back, the GM's client resumes it");
    game.users.get("p1").active = true;
    world.currentUser = GM;
    assert.deepEqual(await money.resolvePending(row.id, "not paid"), { ok: true, rows: [row.id] });
    assert.deepEqual(docs.ledger.pages.get(applyMarkId(row.id)).flags[MOD].hand, { kind: "close", row: row.id });
});

test("a GM's adjust leaves alone, and is not held up by, a move that changes no strongbox coins: the wage is still paid", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const before = cpOf(vera);
    const { rows: [wage] } = await strand(() => money.mint({ actor: vera, row: { kind: "wage", idem: "wage:g1", cp: 200, actor: vera.uuid } }));
    world.currentUser = GM;
    reload();
    docs.strongbox.addItem(coin("sp", 5));   // 50 cp dragged in by hand
    assert.equal((await bookAdjustment("hand coins")).outcome, "ok", "a young wage moves no strongbox coins: it holds nothing up");
    clock.server += PENDING_GRACE_MS;
    vera.ownership.p1 = 0;   // nobody connected may resume the wage now: it needs a hand
    assert.deepEqual(reconciliationReport().needsHand.map((r) => r.id), [wage.id]);
    docs.strongbox.addItem(coin("cp", 30));
    const booked = await bookAdjustment("more hand coins");
    assert.deepEqual([booked.outcome, booked.rows[0].box], ["ok", 30]);
    assert.equal(docs.ledger.pages.has(applyMarkId(wage.id)), false, "the wage's mark is left alone");
    vera.ownership.p1 = 3;   // the character is given back
    world.currentUser = "p1";
    reload();
    assert.equal((await money.resumeStalled()).resumed, 1);
    assert.equal(cpOf(vera) - before, 200, "the wage is paid");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a GM's adjust books the difference while a strongbox move needs a hand whose mark a request took long ago", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "h1" }));
    reload();
    clock.server += PENDING_GRACE_MS + 1000;
    world.server.beforeApply = (i, op) => { if (i === 1 && op.parent === vera) vera.items.clear(); };   // the resume stops part-way
    assert.equal((await money.resumeStalled()).resumed, 0);
    world.server.beforeApply = null;
    assert.ok(docs.ledger.pages.has(applyMarkId(row.id)), "the resume took the mark");
    clock.server += PENDING_GRACE_MS + 1000;
    world.currentUser = GM;
    reload();
    const report = reconciliationReport();
    assert.deepEqual([report.needsHand.map((r) => r.id), report.differenceCp], [[row.id], -300]);
    const booked = await bookAdjustment("after a stopped resume");
    assert.equal(booked.outcome, "ok", "the mark exists: none is taken again");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a close by hand whose answer is lost with the connection says so, not that someone else took the row", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "w1" }));
    clock.server += PENDING_GRACE_MS;
    world.currentUser = GM;
    reload();
    vera.ownership.p1 = 0;   // it needs a hand, and its mark is nobody's yet
    const closed = await strand(() => money.resolvePending(row.id, "checked"));
    assert.deepEqual(closed, { ok: false, reason: "disconnected" });
    assert.equal(state.status(), "stale", "it may have landed: this client reloads before writing again");
});

/**
 * Hold this client's next apply request at the server's door (a busy server) while `during` runs, then let it through.
 * Returns what `move` and `during` came to.
 */
async function whileApplyHeld(move, during) {
    const real = foundry.documents.modifyBatch;
    let release = null;
    foundry.documents.modifyBatch = (operations) => {
        if (release || !applies(operations)) return real(operations);
        return new Promise((resolve) => { release = () => resolve(real(operations)); });
    };
    try {
        const moving = move();
        while (!release) await new Promise((resolve) => setImmediate(resolve));
        const other = during();
        await flush();
        release();
        return [await moving, await other];
    } finally {
        foundry.documents.modifyBatch = real;
    }
}

test("a close waits for this client's own resume under way, and judges the row as the resume left it", async (t) => {
    silence(t);
    const clock = controlClock(t);
    const { rows: [row] } = await strand(() => money.pledge({ actor: vera, cp: 300, nonce: "x1" }));
    clock.server += PENDING_GRACE_MS;
    world.currentUser = GM;
    reload();
    game.users.get("p1").active = false;   // its author gone: the GM's client resumes the move
    const [resumed, closed] = await whileApplyHeld(() => money.resumeStalled(), () => money.resolvePending(row.id, "checked"));
    assert.equal(resumed.resumed, 1);
    assert.deepEqual(closed, { ok: false, reason: "not-pending" }, "judged after the resume, not before");
});

test("an adjust waits for this client's own coin move under way, and finds nothing to book once it has finished", async (t) => {
    silence(t);
    world.currentUser = GM;
    const [pledged, booked] = await whileApplyHeld(() => money.pledge({ actor: vera, cp: 300, nonce: "x2" }), () => bookAdjustment("x"));
    assert.equal(pledged.outcome, "ok");
    assert.deepEqual(booked, { ok: true, outcome: "balanced" }, "judged after the move, not while its row was pending");
});

test("a close by hand is refused on a client that may not write", async () => {
    world.currentUser = GM;
    flagsOf(docs.ledger).rows.r9 = { id: "r9", v: 1, kind: "deposit", state: "pending", author: GM, at: serverStamp(PENDING_GRACE_MS) };
    state.markStale("disconnected");
    assert.deepEqual(await money.resolvePending("r9"), { ok: false, reason: "not-ready" });
    assert.equal(read("rows.r9.state"), "pending");
});

/** Make the server stop an apply request at its settle (the ledger update), after the coins moved. */
function stopAtSettle() {
    world.server.beforeApply = (i, op) => {
        if (op.documentName === "JournalEntry" && op.action === "update" && JSON.stringify(op.updates).includes(".state")) {
            op.updates[0]._id = "nope";
        }
    };
}

test("an adjust is refused while a strongbox move that holds its mark is in flight, so it never books coins the move already moved", async (t) => {
    silence(t);
    const clock = controlClock(t);
    stopAtSettle();
    const result = await money.pledge({ actor: vera, cp: 300, nonce: "pa" });
    world.server.beforeApply = null;
    const [row] = result.rows;
    assert.equal(read(`rows.${row.id}.state`), "pending", "the apply request stopped at its settle, after the coins moved");
    assert.ok(docs.ledger.pages.has(applyMarkId(row.id)), "the move holds its apply mark");
    world.currentUser = GM;
    reload();
    const first = await bookAdjustment("GM adjusts inside the in-flight window");
    assert.deepEqual([first.ok, first.reason], [false, "in-flight"]);
    assert.equal(records("rows").filter((r) => r.kind === "adjust").length, 0, "nothing booked");
    assert.equal(memberBalances(records("rows")).unassignedCp, 0, "the party fund is not credited with coins the move moved");
    clock.server += PENDING_GRACE_MS + 1000;
    assert.equal(reconciliationReport().needsHand.length, 1, "past the grace time the row needs a hand");
});

