/**
 * Reconciliation on the client (DESIGN.md 4.7), migration locks (4.14) and waiting for a migrating client that
 * went away, the sync's reactions to changes of the shared documents (each client's sweep in its turn, one sweep
 * at a time, one failing step skipping no other), and the harness scenarios' shape.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { MOD, OWNER, addDocument, coin, flagsOf, installFoundry, resetWorld, setUsers, world } from "./stubs.mjs";

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
    assert.equal(reconcile.reportOwnPending(), 1);
    assert.equal(reconcile.reportOwnPending(), 0);
    assert.equal(world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Sync.PendingRows").length, 1);
});

test("a migration lock held by a connected user is respected; a stale one is broken and taken", async () => {
    delete flagsOf(docs.ledger).schema;
    const id = hashId("migration:1");
    const lock = (by, real) => ({ _id: id, name: id, flags: { [MOD]: { lock: { to: 1, by, at: { real } } } } });
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [lock("p1", Date.now())], { keepId: true });
    game.users.get("p1").active = true;
    assert.equal(await ensureSchema(docs), "migrating");
    docs.ledger.pages.delete(id);
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [lock("p1", Date.now() - MIGRATION_LOCK_TIMEOUT_MS - 1)], { keepId: true });
    game.users.get("p1").active = false;
    assert.equal(await ensureSchema(docs), "migrated");
    assert.equal(flagsOf(docs.ledger).schema, 1);
    assert.equal(docs.ledger.pages.get(id).flags[MOD].lock.by, game.user.id);
});

test("waiting for a migration whose client went away: a disconnect and the periodic re-check break its lock", async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    const id = hashId("migration:1");
    const lock = (by, server) => ({ _id: id, name: id, flags: { [MOD]: { lock: { to: 1, by, at: { real: 0, server } } } } });
    delete flagsOf(docs.ledger).schema;
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [lock("p1", Date.now() - MIGRATION_LOCK_TIMEOUT_MS - 1)], { keepId: true });
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
    await docs.ledger.createEmbeddedDocuments("JournalEntryPage", [lock("p1", Date.now())], { keepId: true });
    assert.equal(await sync.refresh(), "migrating");
    for (let minute = 0; minute < 6 && state.status() === "migrating"; minute++) {
        mock.timers.tick(sync.MIGRATION_RECHECK_MS);
        mock.timers.tick(250);
        await settle();
    }
    assert.equal(state.status(), "ready");
    assert.equal(flagsOf(docs.ledger).schema, 1);
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
        at: { real: 0, server: Date.now() - PENDING_GRACE_MS - 1 } };
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

test("the harness scenarios cover DESIGN 15.3's M2 scenarios, every step documented", () => {
    const ids = Object.keys(scenarios.definitions);
    assert.deepEqual(ids.sort(), ["1", "2", "3", "3c", "7", "7b", "9"]);
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
