/**
 * Reconciliation on the client (DESIGN.md 4.7), migration locks (4.14) and waiting for a migrating client that
 * went away, the sync's reactions to changes of the shared documents (each client's sweep in its turn, one sweep
 * at a time, one failing step skipping no other), and the harness scenarios' shape.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { MOD, OWNER, addDocument, coin, controlClock, disconnect, flagsOf, installFoundry, resetWorld, serverStamp, setUsers, world } from "./stubs.mjs";

installFoundry();
const { hashId } = await import("../../scripts/logic/ids.mjs");
const { MIGRATION_LOCK_TIMEOUT_MS } = await import("../../scripts/logic/migrations.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const { createClaims } = await import("../../scripts/foundry/claims.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const { ensureSchema } = await import("../../scripts/foundry/migrate.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const reconcile = await import("../../scripts/foundry/reconcile.mjs");
const { createShared, resetMaintenance } = await import("../../scripts/foundry/shared-docs.mjs");
const { resetClaims } = await import("../../scripts/foundry/claims.mjs");
const { PENDING_GRACE_MS } = await import("../../scripts/logic/reconcile.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records } = await import("../../scripts/foundry/store.mjs");
const sync = await import("../../scripts/foundry/sync.mjs");
const { scenarios } = await import("../../tools/harness/sync-scenarios.mjs");

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
/** Let the promise chains a fired timer started run to the end. */
const settle = async () => { for (let i = 0; i < 200; i++) await new Promise((resolve) => setImmediate(resolve)); };

let docs;
let vera;
beforeEach(async () => {
    resetWorld();
    state.resetState();
    resetLease();
    resetMaintenance();
    resetClaims();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    mock.timers.enable({ apis: ["setTimeout"] });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    vera = addDocument("Actor", { name: "Vera", ownership: { default: OWNER }, items: [coin("gp", 20)] });
    setUsers([{ id: "gm00000000000000", isGM: true }, { id: "p1", character: vera, active: false }]);
    requestLease(game.user.id);
    sync.initSync();   // hooks live in the world the stubs just reset
    registerBatchWatcher();
    world.settings.set(`${MOD}.enabled`, true);
    docs = await createShared();
    await sync.refresh();
});
afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    mock.timers.reset();
});

test("the report matches coins and rows; a GM books a hand-made difference as an adjust row", async () => {
    await money.pledge({ actor: vera, cp: 500, nonce: "n" });
    assert.equal(reconcile.reconciliationReport().differenceCp, 0);
    docs.strongbox.addItem(coin("gp", 2));   // dragged in by hand
    assert.equal(reconcile.reconciliationReport().differenceCp, 200);
    const result = await reconcile.bookAdjustment("found in the box");
    assert.equal(result.outcome, "ok");
    assert.equal(reconcile.reconciliationReport().differenceCp, 0);
    assert.equal((await reconcile.bookAdjustment()).outcome, "balanced");
    world.currentUser = "p1";
    await assert.rejects(reconcile.bookAdjustment(), /only a GM/);
});

test("the same difference booked twice (two GMs, a double click) is one adjust row", async () => {
    docs.strongbox.addItem(coin("gp", 1));
    const seen = { ...flagsOf(docs.ledger).rows };
    assert.equal((await reconcile.bookAdjustment()).outcome, "ok");
    const first = flagsOf(docs.ledger).rows;
    flagsOf(docs.ledger).rows = seen;   // the assistant GM worked out the same difference before the row reached it
    await reconcile.bookAdjustment();
    flagsOf(docs.ledger).rows = { ...first, ...flagsOf(docs.ledger).rows };
    assert.equal(records("rows").filter((r) => r.kind === "adjust").length, 1);
    assert.equal(reconcile.reconciliationReport().differenceCp, 0);
});

test("the author hears once about their own rows that did not finish", async (t) => {
    t.mock.method(console, "table", () => {});
    flagsOf(docs.ledger).rows = {
        r1: { id: "r1", v: 1, kind: "deposit", box: 10, state: "pending", author: game.user.id, at: { real: 0 } },
        r2: { id: "r2", v: 1, kind: "deposit", box: 10, state: "pending", author: "someone", at: { real: 0 } },
    };
    assert.equal(reconcile.reportOwnPending().reported, 1);
    assert.equal(reconcile.reportOwnPending().reported, 0);
    assert.equal(world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Sync.PendingRows").length, 1);
});

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** A move whose apply request fails in the server's real pass after its lock: its rows stay pending, `stopped`. */
async function strandedPledge(actor, cp, nonce) {
    world.server.beforeApply = (_i, op) => {
        if (op.documentName === "Item" && op.parent === actor && op.action !== "create") actor.items.clear();
    };
    try {
        return await money.pledge({ actor, cp, nonce });
    } finally {
        world.server.beforeApply = null;
    }
}

test("a row left pending is stalled, and its author told, once the grace time has passed on the server's clock", async (t) => {
    t.mock.method(console, "table", () => {});
    t.mock.method(console, "warn", () => {});
    const clock = controlClock(t);
    clock.skew = 3 * HOUR;   // this client's own clock runs fast; the stamp and the check use the server's
    const result = await strandedPledge(vera, 100, "stranded");
    assert.equal(result.outcome, "stopped");
    const [row] = result.rows;
    assert.equal(read(`rows.${row.id}.state`), "pending");
    assert.deepEqual(reconcile.reconciliationReport().stalled, [], "a pending row this young may be a move in flight");
    clock.server += PENDING_GRACE_MS - 1;
    assert.deepEqual(reconcile.reportOwnPending(), { reported: 0, dueInMs: 1 }, "it says when to look again");
    clock.server += 1;
    assert.deepEqual(reconcile.reconciliationReport().stalled.map((r) => r.id), [row.id]);
    assert.deepEqual(reconcile.reportOwnPending(), { reported: 1, dueInMs: null });
});

test("a row left pending in an earlier, longer launch, by a client whose clock ran fast, is stalled by its age on the server's clock", async (t) => {
    t.mock.method(console, "warn", () => {});
    const clock = controlClock(t);
    world.launch = Math.floor((clock.server - 11 * HOUR) / 1000) * 1000;   // the first launch has run for 11 hours
    clock.skew = 3 * HOUR;                                                  // and the writing client's clock runs fast
    const { rows: [row] } = await strandedPledge(vera, 100, "earlier-launch");
    clock.server += 40 * 1000;
    world.launch = Math.floor(clock.server / 1000) * 1000;   // relaunched: the server time starts again from 0
    clock.skew = -3 * HOUR;                                   // and the reading client's clock runs slow
    clock.server += 10 * 1000;
    assert.ok(game.time.serverTime < row.at.server, "the stamp's server time is ahead of today's");
    assert.deepEqual(reconcile.reconciliationReport().stalled, [], "50 s old: within the grace time");
    clock.server += 11 * 1000;
    assert.deepEqual(reconcile.reconciliationReport().stalled.map((r) => r.id), [row.id], "61 s old: stalled");
});

test("a migration lock its holder stamped in an earlier, longer launch, its clock fast, is broken once five minutes old on the server's clock", async (t) => {
    const clock = controlClock(t);
    world.launch = Math.floor((clock.server - 11 * HOUR) / 1000) * 1000;
    // Player One is the elected client (no GM connected) and takes the lock through the module's own path
    // (`takeLock`, stamped by `stampNow`) with its clock three hours fast; its client then dies mid-migration.
    game.users.get("gm00000000000000").active = false;
    game.users.get("p1").active = true;
    world.currentUser = "p1";
    clock.skew = 3 * HOUR;
    delete flagsOf(docs.ledger).schema;
    assert.equal(await ensureSchema(docs), "migrated");
    const id = hashId("migration:1");
    assert.equal(docs.ledger.pages.get(id).flags[MOD].lock.by, "p1");
    delete flagsOf(docs.ledger).schema;   // as if it died before writing the schema
    game.users.get("p1").active = false;
    // The world is relaunched a minute later; the GM comes back, its clock three hours slow.
    clock.server += MINUTE;
    world.launch = Math.floor(clock.server / 1000) * 1000;
    game.users.get("gm00000000000000").active = true;
    world.currentUser = "gm00000000000000";
    clock.skew = -3 * HOUR;
    clock.server += 3 * MINUTE;
    assert.equal(await ensureSchema(docs), "migrating", "4 minutes old: it stands");
    clock.server += 2 * MINUTE;
    assert.equal(await ensureSchema(docs), "migrated", "6 minutes old and its holder gone: broken and taken");
    assert.equal(docs.ledger.pages.get(id).flags[MOD].lock.by, "gm00000000000000");
});

test("a migration lock held by a connected user is respected; a stale one is broken and taken", async () => {
    delete flagsOf(docs.ledger).schema;
    const id = hashId("migration:1");
    const lock = (by, agoMs) => ({ _id: id, name: id, flags: { [MOD]: { lock: { to: 1, by, at: serverStamp(agoMs) } } } });
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [lock("p1", 0)], { keepId: true });
    game.users.get("p1").active = true;
    assert.equal(await ensureSchema(docs), "migrating");
    docs.ledger.pages.delete(id);
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [lock("p1", MIGRATION_LOCK_TIMEOUT_MS + 1)], { keepId: true });
    game.users.get("p1").active = false;
    assert.equal(await ensureSchema(docs), "migrated");
    assert.equal(flagsOf(docs.ledger).schema, 1);
    assert.equal(docs.ledger.pages.get(id).flags[MOD].lock.by, game.user.id);
});

test("waiting for a migration whose client went away: a disconnect and the periodic re-check break its lock", async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    const id = hashId("migration:1");
    const lock = (by, agoMs) => ({ _id: id, name: id, flags: { [MOD]: { lock: { to: 1, by, at: { ...serverStamp(agoMs), real: 0 } } } } });
    delete flagsOf(docs.ledger).schema;
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [lock("p1", MIGRATION_LOCK_TIMEOUT_MS + 1)], { keepId: true });
    game.users.get("p1").active = true;
    assert.equal(await sync.refresh(), "migrating", "held while its holder is connected");
    game.users.get("p1").active = false;
    Hooks.callAll("userConnected", game.users.get("p1"), false);
    mock.timers.tick(250);
    await settle();
    assert.equal(state.status(), "ready", "its holder left and the lock is old: broken and taken");
    // A fresh lock whose holder has gone: nothing else will change the ledger, so the client looks again later.
    delete flagsOf(docs.ledger).schema;
    docs.ledger.pages.delete(id);
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [lock("p1", 0)], { keepId: true });
    assert.equal(await sync.refresh(), "migrating");
    for (let minute = 0; minute < 6 && state.status() === "migrating"; minute++) {
        mock.timers.tick(sync.MIGRATION_RECHECK_MS);
        mock.timers.tick(250);
        await settle();
    }
    assert.equal(state.status(), "ready");
    assert.equal(flagsOf(docs.ledger).schema, 1);
});

test("a migration lock left in an earlier, longer launch is broken once it is five minutes old by the server's clock", async () => {
    // game.time.serverTime counts from the launch: the lock's holder wrote it 11 hours into the previous launch,
    // six minutes ago, and has gone; the world was relaunched since (seen live: such a lock was never broken).
    const id = hashId("migration:1");
    const previousLaunch = world.launch - 12 * 60 * 60 * 1000;
    const written = Date.now() - 6 * 60 * 1000;
    const at = { world: 0, real: written, server: written - previousLaunch, launch: previousLaunch };
    assert.ok(at.server > game.time.serverTime, "its server time is ahead of today's");
    delete flagsOf(docs.ledger).schema;
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [{ _id: id, name: id, flags: { [MOD]: { lock: { to: 1, by: "p1", at } } } }], { keepId: true });
    assert.equal(await ensureSchema(docs), "migrated");
    assert.equal(docs.ledger.pages.get(id).flags[MOD].lock.by, game.user.id);
});

test("every client sweeps after the same change, each in its turn by user id", async () => {
    await money.pledge({ actor: vera, cp: 300, nonce: "n" });
    mock.timers.tick(2000);   // let the checks and sweeps the setup scheduled run out
    await settle();
    game.users.get("p1").active = true;
    world.currentUser = "p1";   // second in id order after the GM
    const idem = `refund:o1:${vera.uuid}:turn`;
    await createClaims([{ kind: "refund", idem, actor: vera.uuid, cp: 100, parties: [vera.uuid] }]);
    mock.timers.tick(sync.SWEEP_DELAY_MS);
    await settle();
    assert.equal(read(`claims.${hashId(idem)}.resolved`), undefined, "the GM's turn first");
    mock.timers.tick(sync.SWEEP_STAGGER_MS);
    await settle();
    assert.ok(read(`claims.${hashId(idem)}.resolved`));
});

test("the sweep runs one at a time, and one failing step does not stop the others", async (t) => {
    t.mock.method(console, "error", () => {});
    const id = hashId("deliver:o1:9");
    flagsOf(docs.ledger).rows ??= {};
    flagsOf(docs.ledger).rows[id] = { id, v: 1, kind: "delivered", state: "pending", actor: vera.uuid, idem: "deliver:o1:9",
        items: [{ name: "Bomb", qty: 1, source: { type: "consumable", name: "Bomb", flags: { [MOD]: { delivered: { row: id } } } } }],
        at: serverStamp(PENDING_GRACE_MS + 1) };
    const get = game.settings.get;
    game.settings.get = (namespace, key) => { if (key === "claims.auto") throw new Error("broken setting"); return get.call(game.settings, namespace, key); };
    try {
        await Promise.all([sync.sweep(), sync.sweep(), sync.sweep()]);
    } finally {
        game.settings.get = get;
    }
    assert.equal(vera.items.filter((i) => i.name === "Bomb").length, 1, "deliveries ran although the claims step threw");
    assert.equal(read(`rows.${id}.state`), "applied");
});

test("new claims in the ledger schedule a sweep; a schema change schedules a re-check", async () => {
    await money.pledge({ actor: vera, cp: 300, nonce: "n" });
    const idem = `refund:o1:${vera.uuid}:0`;
    await createClaims([{ kind: "refund", idem, actor: vera.uuid, cp: 100, parties: [vera.uuid] }]);
    assert.equal(read(`claims.${hashId(idem)}.resolved`), undefined);
    mock.timers.tick(500);
    await settle();
    assert.ok(read(`claims.${hashId(idem)}.resolved`), "the debounced sweep applied it");
    await docs.ledger.update({ [`flags.${MOD}.schema`]: 2 });
    mock.timers.tick(250);
    await settle();
    assert.equal(state.status(), "newer");
    assert.equal(records("rows").filter((r) => r.kind === "refund").length, 1);
});

test("deleting a shared document sends clients back to missing", async () => {
    world.currentUser = "p1";
    game.users.get("p1").active = true;
    game.users.get("gm00000000000000").active = false;
    await docs.strongbox.delete({ [MOD]: { internal: true } });
    mock.timers.tick(250);
    await settle();
    assert.equal(state.status(), "missing");
});

test("a deleted shared document stops this client's writes at once, before its re-check runs", async () => {
    world.currentUser = "p1";
    game.users.get("p1").active = true;
    game.users.get("gm00000000000000").active = false;
    assert.equal(state.status(), "ready");
    const rowsBefore = records("rows").length;
    await docs.strongbox.delete({ [MOD]: { internal: true } });
    // No timer has run: the re-check is still 250 ms away (seen live: a player stayed ready on the deleted strongbox).
    assert.equal(state.status(), "missing");
    assert.equal(state.shared().strongbox, null, "the deleted strongbox is no longer the one in use");
    const refused = await money.pledge({ actor: vera, cp: 10, nonce: "after-delete" });
    assert.equal(refused.reason, "not-ready");
    assert.equal(records("rows").length, rowsBefore, "no lock and no pending row written");
    assert.equal(docs.ledger.pages.size, 0);
});

test("the sweep resumes a move whose apply request never landed, coming back by itself when the move is due", async (t) => {
    t.mock.method(console, "warn", () => {});
    t.mock.method(console, "info", () => {});
    const clock = controlClock(t);
    mock.timers.tick(2000);   // let the checks and sweeps the setup scheduled run out
    await settle();
    // The lock request lands; its answer is lost with the connection, so the apply request is never sent.
    const real = foundry.documents.modifyBatch;
    foundry.documents.modifyBatch = (operations) => {
        foundry.documents.modifyBatch = real;
        real(operations);
        return new Promise(() => {});
    };
    const pending = money.pledge({ actor: vera, cp: 300, nonce: "lost" });
    await settle();
    disconnect();
    const { rows: [row] } = await pending;
    assert.equal(state.status(), "stale");
    const before = vera.items.contents.map((i) => i.quantity);
    // The page reloads 10 s later: its ready check sweeps, finds the move too young to judge, and comes back for it.
    clock.server += 10 * 1000;
    state.resetState();
    money.resetResume();
    await sync.refresh();
    mock.timers.tick(sync.SWEEP_DELAY_MS);
    await settle();
    assert.equal(read(`rows.${row.id}.state`), "pending", "not before the grace time");
    clock.server += PENDING_GRACE_MS - 10 * 1000;
    mock.timers.tick(PENDING_GRACE_MS - 10 * 1000);
    mock.timers.tick(sync.SWEEP_DELAY_MS);
    await settle();
    assert.equal(read(`rows.${row.id}.state`), "applied", "resumed when due, with no other event to set off a sweep");
    assert.deepEqual(vera.items.contents.map((i) => i.quantity), [before[0] - 3], "3 gp moved, once");
    assert.equal(reconcile.reconciliationReport().differenceCp, 0);
});

/** Two ways a resume fails after the sweep sent it: stopped after its mark, or refused at its dry run. */
const BROKEN_RESUMES = [
    ["stops part-way", "stopped", () => {   // the purse is emptied between the apply request's first and second operations
        world.server.beforeApply = (i, op) => { if (i === 1 && op.parent === vera) vera.items.clear(); };
    }],
    ["is refused at its dry run", "dry-run", () => {   // the purse is emptied as the server dry-runs the apply request
        world.server.beforeDryRun = (operations) => { if (operations.some((op) => op.documentName === "Item")) vera.items.clear(); };
    }],
];

for (const [how, reason, breakResume] of BROKEN_RESUMES) {
    test(`a resume that ${how} is reported to its author once in flight no longer, with no other event to set off the sweep`, async (t) => {
        t.mock.method(console, "warn", () => {});
        t.mock.method(console, "info", () => {});
        t.mock.method(console, "table", () => {});
        const clock = controlClock(t);
        mock.timers.tick(2000);   // let the checks and sweeps the setup scheduled run out
        await settle();
        // The GM's pledge: its lock request lands, and its answer is lost with the connection.
        const real = foundry.documents.modifyBatch;
        foundry.documents.modifyBatch = (operations) => {
            foundry.documents.modifyBatch = real;
            real(operations);
            return new Promise(() => {});
        };
        const pending = money.pledge({ actor: vera, cp: 300, nonce: `broken-${reason}` });   // a row of its own: each is told once per session
        await settle();
        disconnect();
        const { rows: [row] } = await pending;
        // The page reloads past the grace time, and its sweep resumes the move, which fails on the server.
        clock.server += PENDING_GRACE_MS;
        state.resetState();
        money.resetResume();
        breakResume();
        await sync.refresh();
        mock.timers.tick(sync.SWEEP_DELAY_MS);
        await settle();
        world.server.beforeApply = null;
        world.server.beforeDryRun = null;
        const told = () => world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Sync.PendingRows").length;
        assert.equal(read(`rows.${row.id}.stopped.reason`), reason, "the resume failed, and noted how");
        assert.deepEqual(reconcile.reconciliationReport().inFlight.map((r) => r.id), [row.id], "for the grace time a request may still be applying it");
        assert.equal(told(), 0, "not yet");
        clock.server += PENDING_GRACE_MS;
        mock.timers.tick(PENDING_GRACE_MS);
        mock.timers.tick(sync.SWEEP_DELAY_MS);
        await settle();
        assert.deepEqual(reconcile.reconciliationReport().needsHand.map((r) => r.id), [row.id]);
        assert.equal(told(), 1, "then the sweep comes back by itself and tells its author");
    });
}

test("the harness scenarios cover DESIGN 15.3's M2 scenarios, M3's rolls, M4's orders, M5's formulas, M6's downtime, M7's mornings, M8's combat and M8a's afflictions, every step documented", () => {
    const ids = Object.keys(scenarios.definitions);
    assert.deepEqual(ids.sort(), ["1", "2", "3", "3c", "7", "7b", "9", "m3", "m4", "m5", "m6", "m7", "m8", "m8a"]);
    for (const [id, scenario] of Object.entries(scenarios.definitions)) {
        assert.equal(typeof scenario.about, "string", id);
        const steps = Object.entries(scenario).filter(([key]) => key !== "about");
        assert.ok(steps.length >= 2, id);
        for (const [name, step] of steps) assert.ok(typeof step.about === "string" && typeof step.run === "function", `${id}/${name}`);
    }
});

test("a scenario step refuses to run outside a dev world", async () => {
    await assert.rejects(scenarios.run("3c", "check"), /dev setting is off/);
    await assert.rejects(scenarios.run("3c", "nope"), /no scenario step/);
});
