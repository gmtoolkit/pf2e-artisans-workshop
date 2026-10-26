/**
 * Claims (DESIGN.md 5.5) and the GM relay (5.7) over the fake world: only the target's responsible tab
 * applies a claim; applying moves the coins and resolves the claim in one move; a delivery locks its row and its
 * shelf item, and a delivery that another one beat is never sent; a lost delivery is finished from its row, once;
 * the relay checks requests against stored state; one claim that throws holds up no other.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MOD, addDocument, coin, flagsOf, installFoundry, resetWorld, serverStamp, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { hashId } = await import("../../scripts/logic/ids.mjs");
const { PENDING_GRACE_MS } = await import("../../scripts/logic/reconcile.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const relay = await import("../../scripts/foundry/relay.mjs");
const { registerSettings } = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records } = await import("../../scripts/foundry/store.mjs");

registerSettings({ enabled: () => {}, docs: () => {} });
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

let docs;
let vera;
let bo;
beforeEach(async () => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });   // one tab, no Web Locks
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 10)] });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 10)] });
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p2");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p2");
    registerBatchWatcher();
    await money.pledge({ actor: bo, cp: 500, order: "o1", nonce: "n" });
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

const refundFor = (actor, cp = 200, tag = "t1") => ({ kind: "refund", idem: `refund:o1:${actor.uuid}:${tag}`, actor: actor.uuid, cp, parties: [bo.uuid] });

test("a claim is recorded once; only the target's responsible tab applies it", async () => {
    const [claim] = await claims.createClaims([refundFor(vera)]);
    assert.deepEqual(await claims.createClaims([refundFor(vera)]), [], "the same key is not recorded twice");
    assert.equal(await claims.sweepClaims(), 0, "Bo's player is not responsible for Vera while her player is connected");
    game.users.get("p1").active = false;
    assert.equal(await claims.sweepClaims(), 0, "nor when she is away: the GM is");
    world.currentUser = "gm00000000000000";
    assert.equal(await claims.sweepClaims(), 1);
    assert.equal(cpOf(vera), 1200);
    assert.equal(read(`claims.${claim.id}.resolved.by`), "gm00000000000000");
    const row = read(`rows.${claim.id}`);
    assert.deepEqual([row.kind, row.state, row.purse], ["refund", "applied", 200]);
    assert.equal(await claims.sweepClaims(), 0, "resolved claims are done");
});

test("the owner's own sweep applies the claim, once, however often it runs", async () => {
    await claims.createClaims([refundFor(vera)]);
    world.currentUser = "p1";
    assert.equal(await claims.sweepClaims(), 1);
    assert.equal(await claims.sweepClaims(), 0);
    assert.equal(cpOf(vera), 1200);
    assert.equal(records("rows").filter((r) => r.kind === "refund").length, 1);
});

/** Run `task` as a client that has not seen the first client's rows, claim resolution or (optionally) lock pages yet. */
async function asUnaware(claim, task, { pages = false } = {}) {
    const seen = { rows: flagsOf(docs.ledger).rows, pages: new Map(docs.ledger.pages.entries()) };
    flagsOf(docs.ledger).rows = {};
    delete flagsOf(docs.ledger).claims[claim.id].resolved;
    if (pages) world.server.beforeDryRun = () => { for (const [id, page] of seen.pages) docs.ledger.pages.set(id, page); };
    if (pages) docs.ledger.pages.clear();
    try {
        return await task();
    } finally {
        flagsOf(docs.ledger).rows = { ...seen.rows, ...flagsOf(docs.ledger).rows };
        world.server.beforeDryRun = null;
    }
}

test("two clients applying the same claim: the second loses at its lock, moves nothing, and needs no reload", async (t) => {
    t.mock.method(console, "warn", () => {});
    const [claim] = await claims.createClaims([refundFor(vera)]);
    world.currentUser = "p1";
    const first = await claims.applyClaim(claim, vera);
    world.currentUser = "gm00000000000000";
    const seesLock = await asUnaware(claim, () => claims.applyClaim(claim, vera));
    const atServer = await asUnaware(claim, () => claims.applyClaim(claim, vera), { pages: true });
    assert.equal(first.outcome, "ok");
    assert.deepEqual([seesLock.outcome, seesLock.reason], ["conflict", "locked"], "its own copy already shows the lock: nothing sent");
    assert.deepEqual([atServer.outcome, atServer.reason], ["conflict", "dry-run"], "the server refuses the lock request");
    assert.equal(state.status(), "ready", "a lost lock leaves nothing on that client to undo");
    assert.equal(cpOf(vera), 1200, "paid once");
});

test("a second client that already sees the first's lock and row is told \"already\", whatever the coins now allow", async () => {
    const [claim] = await claims.createClaims([refundFor(vera, 500)]);   // all of the strongbox's coins, in one stack
    // Two devices: each has its own lock manager, so the coin mutex does not hold the second back.
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_name, task) => task() } }, configurable: true });
    const real = foundry.documents.modifyBatch;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let requests = 0;
    // The first client's lock request lands; its apply request is still on its way when the GM's client looks.
    foundry.documents.modifyBatch = async (operations) => (++requests === 2 ? held.then(() => real(operations)) : real(operations));
    world.currentUser = "p1";
    const first = claims.applyClaim(claim, vera);
    while (read(`rows.${claim.id}.state`) !== "pending") await new Promise((resolve) => setImmediate(resolve));
    try {
        world.currentUser = "gm00000000000000";
        const second = await claims.applyClaim(claim, vera);
        assert.deepEqual([second.ok, second.outcome], [true, "already"], "not strongbox-short: the stack it would spend is the first move's");
        assert.equal(read(`claims.${claim.id}.resolved.by`), "p1", "the first client's resolution stands");
    } finally {
        release();
        world.currentUser = "p1";
        assert.equal((await first).outcome, "ok");
        foundry.documents.modifyBatch = real;
    }
    assert.equal(cpOf(vera), 1500, "paid once");
});

test("with auto-claim off the user is told once instead", async () => {
    await claims.createClaims([refundFor(vera)]);
    world.currentUser = "p1";
    world.settings.set(`${MOD}.claims.auto`, false);
    assert.equal(await claims.sweepClaims(), 0);
    assert.equal(await claims.sweepClaims(), 0);
    assert.equal(world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Claims.Waiting").length, 1);
    assert.equal(await claims.sweepClaims({ force: true }), 1, "Take it");
});

const shelve = (name = "Elixir", key = "deliver:o1:1") => docs.strongbox.addItem({ type: "consumable", name, system: { quantity: 2 },
    flags: { [MOD]: { shelf: { for: vera.uuid, from: bo.uuid, order: "o1", claimKey: key } } } });
const elixirs = () => vera.items.filter((i) => i.name === "Elixir").length;

test("a delivery locks its row and its shelf item, then moves the item to the recipient", async () => {
    const shelfItem = shelve();
    world.currentUser = "p1";
    assert.equal(await claims.sweepClaims(), 1);
    assert.equal(docs.strongbox.items.has(shelfItem.id), false);
    const delivered = vera.items.find((i) => i.name === "Elixir");
    assert.deepEqual(delivered.flags[MOD], { delivered: { row: hashId("deliver:o1:1") } });
    const row = read(`rows.${hashId("deliver:o1:1")}`);
    assert.deepEqual([row.kind, row.state, row.items[0].qty], ["delivered", "applied", 2]);
    const [lock, apply] = world.batches.slice(-2);
    assert.deepEqual(lock[0].data.map((d) => d._id), [row.id, shelfItem.id], "a lock page, not a deletion, is the lock");
    assert.deepEqual(apply.map((op) => op.action), ["delete", "create", "update"]);
});

test("the relay's 'deliver now' and the GM's own sweep on one tab deliver the item once", async () => {
    game.users.get("p1").active = false;   // Vera's player is away: the GM is responsible for her
    world.currentUser = "gm00000000000000";
    requestLease("gm00000000000000");
    shelve();
    const [swept, relayed] = await Promise.all([
        claims.sweepClaims(),
        relay.handleRelay({ op: "applyClaims", actorUuid: vera.uuid }, { user: game.users.get("p2") }),
    ]);
    assert.equal(swept, 1);
    assert.deepEqual(relayed.results.map((r) => [r.ok, r.outcome]), [[true, "already"]], "the second sees the first one's row");
    assert.equal(elixirs(), 1);
});

test("a second delivery of a shelf item someone else already took is never sent", async () => {
    world.currentUser = "p1";
    const item = shelve();
    assert.equal((await claims.deliver(item, vera)).outcome, "ok");
    const sent = world.batches.length;
    assert.equal((await claims.deliver(item, vera)).outcome, "already", "the row exists");
    flagsOf(docs.ledger).rows = {};   // a device that has seen the item go but not yet the row
    assert.equal((await claims.deliver(item, vera)).reason, "gone");
    assert.equal(world.batches.length, sent);
    assert.equal(elixirs(), 1);
});

test("pf2e dropping the shelf item's deletion on the way out stops the delivery; it is finished once, later", async (t) => {
    t.mock.method(console, "warn", () => {});
    world.currentUser = "p1";
    const item = shelve();
    world.client.beforeSend = (ops) => { if (ops[0].action === "delete") docs.strongbox.items.delete(item.id); };
    const result = await claims.deliver(item, vera);
    world.client.beforeSend = null;
    assert.deepEqual([result.outcome, result.reason], ["stopped", "shrunk"]);
    assert.equal(elixirs(), 1, "the request went out without the deletion: the item arrived");
    const id = hashId("deliver:o1:1");
    flagsOf(docs.ledger).rows[id].state = "pending";   // as noted by a stopped move
    flagsOf(docs.ledger).rows[id].at = serverStamp(PENDING_GRACE_MS + 1);
    assert.equal(await claims.sweepDeliveries(), 1, "it arrived, so only the settle was missing");
    assert.equal(read(`rows.${id}.state`), "applied");
    assert.equal(elixirs(), 1);
});

test("a delivery stopped after its lock is finished from its row, once, removing the shelf item if it is still there", async () => {
    const id = hashId("deliver:o1:2");
    const source = { type: "consumable", name: "Bomb", flags: { [MOD]: { delivered: { row: id } } } };
    const stale = { ...serverStamp(PENDING_GRACE_MS + 1), real: Date.now() };   // its author's clock runs fast
    flagsOf(docs.ledger).rows[id] = { id, v: 1, kind: "delivered", state: "pending", actor: vera.uuid, idem: "deliver:o1:2",
        items: [{ name: "Bomb", qty: 1, source }], at: stale };
    const leftover = shelve("Bomb", "deliver:o1:2");   // its apply request never ran
    world.currentUser = "p1";
    assert.equal(await claims.sweepDeliveries(), 1);
    assert.equal(vera.items.filter((i) => i.name === "Bomb").length, 1);
    assert.equal(docs.strongbox.items.has(leftover.id), false);
    assert.equal(read(`rows.${id}.state`), "applied");
    assert.ok(docs.ledger.pages.has(hashId(`recreate:${id}`)), "the re-creation's own lock");
    assert.equal(await claims.sweepDeliveries(), 0);
    assert.equal(await claims.sweepClaims(), 0, "nor does the sweep deliver the shelf item");
});

test("a pending delivery younger than the grace time, by the server's clock, is left to its own client", async () => {
    const id = hashId("deliver:o1:3");
    flagsOf(docs.ledger).rows[id] = { id, v: 1, kind: "delivered", state: "pending", actor: vera.uuid, idem: "deliver:o1:3",
        items: [{ name: "Bomb", qty: 1, source: { type: "consumable", name: "Bomb" } }],
        at: { ...serverStamp(0), real: Date.now() - 10 * PENDING_GRACE_MS } };   // its author's clock runs slow
    world.currentUser = "p1";
    assert.equal(await claims.sweepDeliveries(), 0);
});

test("a delivery left pending in an earlier, longer launch is finished once past the grace time", async () => {
    const id = hashId("deliver:o1:4");
    const previousLaunch = world.launch - 12 * 60 * 60 * 1000;
    const written = Date.now() - 2 * PENDING_GRACE_MS;
    const at = { world: 0, real: written, server: written - previousLaunch, launch: previousLaunch };
    assert.ok(at.server > game.time.serverTime, "its server time is ahead of today's");
    flagsOf(docs.ledger).rows[id] = { id, v: 1, kind: "delivered", state: "pending", actor: vera.uuid, idem: "deliver:o1:4",
        items: [{ name: "Bomb", qty: 1, source: { type: "consumable", name: "Bomb", flags: { [MOD]: { delivered: { row: id } } } } }], at };
    world.currentUser = "p1";
    assert.equal(await claims.sweepDeliveries(), 1);
    assert.equal(read(`rows.${id}.state`), "applied");
});

test("a claim that throws, or that cannot be built, holds up no other, and is not retried this session", async (t) => {
    t.mock.method(console, "error", () => {});
    const [bad] = await claims.createClaims([refundFor(vera, 100, "bad")]);
    const [good] = await claims.createClaims([refundFor(vera, 100, "good")]);
    flagsOf(docs.ledger).claims[bad.id].at = { world: 0 };   // first in line
    flagsOf(docs.ledger).claims[bad.id].actor = "Actor.unresolvable";
    flagsOf(docs.ledger).claims[bad.id].cp = "a lot";
    const real = globalThis.fromUuidSync;
    globalThis.fromUuidSync = (uuid) => { if (uuid === "Actor.unresolvable") throw new Error("bad uuid"); return real(uuid); };
    try {
        world.currentUser = "p1";
        assert.equal(await claims.sweepClaims(), 1);
        assert.ok(read(`claims.${good.id}.resolved`));
        assert.equal(await claims.sweepClaims(), 0);
    } finally {
        globalThis.fromUuidSync = real;
    }
});

test("the relay: ping, unsupported operations, declines while an owner is connected, applies for a party", async () => {
    world.currentUser = "gm00000000000000";
    requestLease("gm00000000000000");
    const asker = game.users.get("p2");
    assert.deepEqual(await relay.handleRelay({ op: "ping" }, { user: asker }), { ok: true, version: "0.0.0", schema: 1 });
    assert.equal((await relay.handleRelay({ op: "expireFor" }, { user: asker })).reason, "unsupported");
    const [claim] = await claims.createClaims([refundFor(vera)]);
    const declined = await relay.handleRelay({ op: "applyClaims", actorUuid: vera.uuid }, { user: asker });
    assert.equal(declined.results[0].reason, "owner-connected");
    game.users.get("p1").active = false;
    const applied = await relay.handleRelay({ op: "applyClaims", actorUuid: vera.uuid }, { user: asker });
    assert.deepEqual(applied.results, [{ id: claim.id, ok: true, outcome: "ok", reason: undefined }]);
    const stranger = addDocument("User", { _id: "p3", isGM: false, active: true });
    await claims.createClaims([refundFor(vera, 100, "t2")]);
    const refused = await relay.handleRelay({ op: "applyClaims", actorUuid: vera.uuid }, { user: stranger });
    assert.equal(refused.results[0].reason, "not-party");
});

test("asking the GM: no GM, a GM that answers, and a GM that never answers", async () => {
    world.currentUser = "p2";
    game.users.get("gm00000000000000").active = false;
    assert.equal((await relay.requestApplyNow(vera.uuid)).reason, "no-gm");
    game.users.get("gm00000000000000").active = true;
    world.queryAnswer = async () => ({ ok: true, results: [] });
    assert.equal((await relay.requestApplyNow(vera.uuid)).ok, true);
    assert.deepEqual(world.queries.at(-1).slice(1, 3), [relay.RELAY, { op: "applyClaims", actorUuid: vera.uuid }]);
    world.queryAnswer = () => new Promise(() => {});
    const t0 = Date.now();
    const silent = await relay.requestApplyNow(vera.uuid, { timeout: 10 });
    assert.equal(silent.reason, "failed");
    assert.ok(Date.now() - t0 < 2000);
});

test("registering the relay puts its handler in CONFIG.queries", () => {
    relay.registerRelay();
    assert.equal(CONFIG.queries["pf2e-artisans-workshop.relay"], relay.handleRelay);
});
