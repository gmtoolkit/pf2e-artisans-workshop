/**
 * Resuming a coin move whose lock request landed but whose apply request never did (DESIGN.md 5.4, As built:
 * Resume), over the fake world: the answer to the lock request lost with the connection leaves a pending row, its
 * lock held, a claim resolved and no coins moved. After the client reloads, the sweep sends the move's apply request
 * again, once the row is past the grace time, its items are as planned and this tab is the one to resume it; the
 * apply mark lets that request through once, whoever sends it.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MOD, addDocument, coin, controlClock, disconnect, flagsOf, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { applyMarkId } = await import("../../scripts/logic/lock-first.mjs");
const { PENDING_GRACE_MS } = await import("../../scripts/logic/reconcile.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const { reconciliationReport, reportOwnPending } = await import("../../scripts/foundry/reconcile.mjs");
const { registerSettings } = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read } = await import("../../scripts/foundry/store.mjs");

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
    assert.equal(reportOwnPending(), 1, "its author is told");
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
