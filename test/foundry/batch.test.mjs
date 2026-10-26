/**
 * Running a lock-first move (DESIGN.md 5.4) against the fake client and batch server: every operation applied, a
 * lock lost in the server's real pass or at its dry run (which changes nothing, on either side), a lock or a
 * deletion this client can already see is taken (nothing sent), a move stopped after its lock, an apply request
 * refused at the dry run (its embedded operations do not replay here, so nothing is left behind), a deletion pf2e
 * drops on the way out, an answer that is only slow, and one lost with the connection; and DESIGN 5.1's storage table
 * naming every flag a lock page carries.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { MOD, coin, disconnect, flagsOf, installFoundry, resetWorld, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { lockFirstBatch } = await import("../../scripts/logic/lock-first.mjs");
const { ANSWER_LIMIT_MS, registerBatchWatcher, runLockFirst, runRequest, toOperations } = await import("../../scripts/foundry/batch.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const state = await import("../../scripts/foundry/state.mjs");

const templates = Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)]));
let docs;
beforeEach(() => {
    resetWorld();
    state.resetState();
    setCoinTemplates(structuredClone(templates));
    docs = sharedWorld({ strongboxItems: [coin("gp", 5, { _id: "stackgp000000001" })] });
    state.setShared({ ...docs, status: "ready" });
    registerBatchWatcher();
});

const row = (id) => ({ id, v: 1, state: "pending" });
const deposit = (id) => lockFirstBatch({
    rowIds: [id], ledger: { set: { [`rows.${id}`]: row(id) } },
    credits: [{ target: "strongbox", plan: { updates: [], deletes: [], creates: [{ denomination: "sp", quantity: 3 }] } }], lot: id,
});
const spendStack = (id) => lockFirstBatch({
    rowIds: [id], lockIds: [id, "stackgp000000001"], ledger: { set: { [`rows.${id}`]: row(id) } },
    debits: [{ target: "strongbox", plan: { updates: [], deletes: ["stackgp000000001"], creates: [{ denomination: "gp", quantity: 2 }] } }], lot: id,
});
const silence = (t) => { t.mock.method(console, "warn", () => {}); t.mock.method(console, "error", () => {}); };
/** The stale notices shown so far (`markStale`). */
const staleNotices = () => world.notes.filter(([level, key]) => level === "warn" && key.startsWith("pf2e-artisans-workshop.Sync.Stale")).map(([, key]) => key);

test("descriptors become Foundry operations: lock pages with keepId, an undiffed ledger update, coin items", () => {
    const { lock, apply } = deposit("row0000000000001");
    const ops = toOperations([...lock, ...apply], docs);
    assert.deepEqual(ops.map((o) => [o.action, o.documentName]), [["create", "JournalEntryPage"], ["update", "JournalEntry"], ["create", "Item"], ["update", "JournalEntry"]]);
    assert.equal(ops[0].keepId, true);
    assert.equal(ops[0].parent, docs.ledger);
    assert.deepEqual(ops[0].data.map((d) => [d._id, d.type]), [["row0000000000001", "text"]]);
    assert.equal(ops[1].diff, false);
    assert.equal(ops[2].parent, docs.strongbox);
    assert.deepEqual(ops[2].data[0].flags[MOD].lot, { row: "row0000000000001" });
    assert.equal(ops[2].data[0].system.quantity, 3);
});

test("ok: the lock request, then the apply request; the row settled, the lock page kept", async () => {
    const result = await runLockFirst(deposit("row0000000000001"));
    assert.deepEqual(result, { outcome: "ok", applied: 4, total: 4, phase: "apply", reason: undefined });
    assert.equal(world.batches.length, 2);
    assert.deepEqual(world.batches[0].map((o) => o.documentName), ["JournalEntryPage", "JournalEntry"], "the lock request holds only the lock and the rows");
    assert.equal(flagsOf(docs.ledger).rows.row0000000000001.state, "applied");
    assert.ok(docs.ledger.pages.has("row0000000000001"));
    assert.equal(docs.strongbox.items.filter((i) => i.unit === "sp").length, 1);
});

test("conflict in the real pass: another client's lock lands between the dry run and the real pass; nothing moves", async () => {
    world.server.beforeApply = (i) => { if (i === 0) docs.ledger.pages.set("row0000000000002", { id: "row0000000000002" }); };
    const result = await runLockFirst(deposit("row0000000000002"));
    assert.deepEqual([result.outcome, result.phase, result.reason], ["conflict", "lock", "first"]);
    assert.equal(flagsOf(docs.ledger).rows, undefined);
    assert.equal(world.batches.length, 1, "no apply request");
    assert.equal(state.status(), "ready");
});

test("conflict at the dry run: the winner's lock reached the server first; the refusal leaves nothing behind, so no reload", async () => {
    world.server.beforeDryRun = () => docs.ledger.pages.set("row0000000000003", { id: "row0000000000003" });
    const result = await runLockFirst(deposit("row0000000000003"));
    assert.deepEqual([result.outcome, result.reason], ["conflict", "dry-run"]);
    assert.equal(flagsOf(docs.ledger).rows, undefined);
    assert.equal(state.status(), "ready", "the only replayed result is an update, which a dry run does not commit");
    assert.ok(world.notes.some(([level]) => level === "error"), "core still shows the server's error");
});

test("a lock request that stops after its pages: the lock is held, so the move is stopped, not lost", async (t) => {
    silence(t);
    world.server.beforeApply = (i) => { if (i === 1) world.collections.JournalEntry.delete(docs.ledger.id); };
    const result = await runLockFirst(deposit("row000000000000b"));
    world.collections.JournalEntry.set(docs.ledger.id, docs.ledger);
    assert.deepEqual([result.outcome, result.phase, result.applied], ["stopped", "lock", 1]);
    assert.equal(world.batches.length, 1, "no apply request after a lock request that did not finish");
});

test("a lock request whose only result is the ledger update did not get the lock, however the refusal looked", async () => {
    const real = foundry.documents.modifyBatch;
    foundry.documents.modifyBatch = async () => [[docs.ledger]];   // a refused dry run's replayed update, without its flag
    try {
        const result = await runLockFirst(deposit("row000000000000a"));
        assert.deepEqual([result.outcome, result.phase], ["conflict", "lock"]);
    } finally {
        foundry.documents.modifyBatch = real;
    }
});

test("a lock this client already sees as taken, or an item already gone: nothing is sent", async () => {
    docs.ledger.pages.set("row0000000000004", { id: "row0000000000004" });
    const locked = await runLockFirst(deposit("row0000000000004"));
    assert.deepEqual([locked.outcome, locked.reason], ["conflict", "locked"]);
    docs.strongbox.items.delete("stackgp000000001");
    const gone = await runLockFirst(spendStack("row0000000000005"));
    assert.deepEqual([gone.outcome, gone.reason], ["conflict", "gone"]);
    assert.equal(world.batches.length, 0);
    assert.ok(!docs.ledger.pages.has("row0000000000005"), "no lock is taken for a move that cannot run");
});

test("stopped: the apply request fails part-way; the lock and the pending row stay", async (t) => {
    silence(t);
    const batch = deposit("row0000000000006");
    batch.apply.unshift({ op: "deleteItems", target: "strongbox", ids: ["stackgp000000001"] }, { op: "deleteItems", target: "strongbox", ids: ["stackgp000000001"] });
    const result = await runLockFirst(batch);
    assert.deepEqual([result.outcome, result.phase, result.reason, result.applied, result.total], ["stopped", "apply", "stopped", 3, 6]);
    assert.equal(flagsOf(docs.ledger).rows.row0000000000006.state, "pending");
    assert.ok(docs.ledger.pages.has("row0000000000006"));
});

test("an apply request refused at the dry run: its embedded operations do not replay here, so the client stays ready", async (t) => {
    silence(t);
    world.server.beforeDryRun = (ops) => {
        if (ops[0].documentName === "Item") docs.strongbox.items.delete("stackgp000000001");   // removed by hand meanwhile
    };
    const result = await runLockFirst(spendStack("row0000000000007"));
    assert.deepEqual([result.outcome, result.reason], ["stopped", "dry-run"], "told by the settle's replayed update hook");
    assert.equal(state.status(), "ready", "the change it would have created was never created on this client");
    assert.equal(docs.strongbox.items.filter((i) => i.unit === "gp").length, 0, "no stack of change appeared here");
    const errors = world.notes.filter(([level]) => level === "error").map(([, message]) => message);
    assert.deepEqual(errors, ["does not exist", "A parent Document provided to the database operation must be a Document instance"],
        "the server's error, then one for the creation core could not replay");
    assert.equal(flagsOf(docs.ledger).rows.row0000000000007.state, "pending");
});

test("a deletion pf2e drops on the way out (the item went after the check): stopped, never ok", async (t) => {
    silence(t);
    world.client.beforeSend = (ops) => {
        if (ops[0].action === "delete") docs.strongbox.items.delete("stackgp000000001");   // another client's broadcast arrives now
    };
    const result = await runLockFirst(spendStack("row0000000000008"));
    assert.deepEqual([result.outcome, result.reason], ["stopped", "shrunk"]);
    assert.ok(world.batches.at(-1).every((op) => op.action !== "delete"), "the request went out without the deletion");
});

test("an operation the client cannot build is an error and nothing is sent", async (t) => {
    silence(t);
    const result = await runLockFirst({ lock: [{ op: "lock", ids: ["x"] }], apply: [{ op: "createItems", target: "Actor.missing", data: [{}] }] });
    assert.deepEqual([result.outcome, result.reason], ["error", "build"]);
    assert.equal((await runRequest([{ op: "nonsense" }])).outcome, "error");
    assert.equal(world.batches.length, 0);
});

test("no answer from the server at all, the connection up: unknown once the limit passes, and this client goes stale", async (t) => {
    silence(t);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const real = foundry.documents.modifyBatch;
    foundry.documents.modifyBatch = () => new Promise(() => {});
    try {
        const pending = runLockFirst(deposit("row0000000000009"));
        await new Promise((resolve) => setImmediate(resolve));
        t.mock.timers.tick(ANSWER_LIMIT_MS);
        const result = await pending;
        assert.deepEqual([result.outcome, result.reason], ["unknown", "timeout"]);
        assert.equal(state.status(), "stale");
        assert.deepEqual(staleNotices(), ["pf2e-artisans-workshop.Sync.Stale.Timeout"], "the user is told the answer never came");
    } finally {
        foundry.documents.modifyBatch = real;
    }
});

/** Let the promise chains started so far run to the end. */
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve)); };

test("an answer that is only slow, with the connection up, is waited for: the move completes and nothing goes stale", async (t) => {
    silence(t);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const real = foundry.documents.modifyBatch;
    // A busy server: each request is answered 40 s after it was sent (seen live: a lock request answered late).
    foundry.documents.modifyBatch = (ops) => new Promise((resolve) => setTimeout(() => resolve(real(ops)), 40 * 1000));
    try {
        const pending = runLockFirst(deposit("row000000000000c"));
        for (let second = 0; second < 90; second++) {
            await flush();
            t.mock.timers.tick(1000);
        }
        const result = await pending;
        assert.deepEqual([result.outcome, result.phase], ["ok", "apply"]);
        assert.equal(flagsOf(docs.ledger).rows.row000000000000c.state, "applied", "the apply request went out after the late answer");
        assert.equal(state.status(), "ready");
    } finally {
        foundry.documents.modifyBatch = real;
    }
});

test("an answer lost with the connection: unknown at once, and this client goes stale", async (t) => {
    silence(t);
    const real = foundry.documents.modifyBatch;
    foundry.documents.modifyBatch = () => new Promise(() => {});   // socket.io drops the acknowledgement on a disconnect
    try {
        const pending = runLockFirst(deposit("row000000000000d"));
        await flush();
        disconnect();
        const result = await pending;
        assert.deepEqual([result.outcome, result.phase, result.reason], ["unknown", "lock", "disconnected"]);
        assert.equal(state.status(), "stale", "the lock request may have applied, and this client would never hear");
        assert.deepEqual(staleNotices(), ["pf2e-artisans-workshop.Sync.Stale.Disconnected"], "the user is told the connection dropped, not that a change was refused");
        assert.deepEqual(world.socketHandlers.get("disconnect"), [], "it stops listening once the move has its answer");
    } finally {
        foundry.documents.modifyBatch = real;
    }
});

test("a refused request whose replay created or deleted something here: stale, and the user is told the change was refused", (t) => {
    silence(t);
    Hooks.callAll("updateJournalEntry", docs.ledger, {}, { dryRun: true }, game.user.id);
    assert.equal(state.status(), "ready", "a replayed update commits nothing");
    Hooks.callAll("deleteJournalEntryPage", { id: "p", parent: docs.ledger }, { dryRun: true }, game.user.id);
    assert.equal(state.status(), "stale");
    assert.deepEqual(staleNotices(), ["pf2e-artisans-workshop.Sync.Stale.Refused"]);
});

test("DESIGN 5.1's storage table names every flag a lock page carries", () => {
    const [op] = toOperations([{ op: "lock", ids: ["r1"], move: { rows: ["r1"] }, hand: { kind: "close", row: "r1" } }], docs);
    const keys = Object.keys(op.data[0].flags[MOD]).sort();
    assert.deepEqual(keys, ["hand", "lock", "move"]);
    const row = readFileSync(join(ROOT, "DESIGN.md"), "utf8").split("\n").find((line) => line.startsWith("| Lock pages |"));
    for (const key of keys) assert.match(row, new RegExp(`\`${key}[\`:]`), `the Lock pages row of 5.1 names \`${key}\``);
});
