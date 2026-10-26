/**
 * Races between clients that the lease cannot serialise (DESIGN.md 5.4, 5.6): the same player on two devices (or
 * two tabs over plain http), and two players' clients collecting refunds at once. Each device has its own lock
 * manager, so the coin mutex excludes nothing; one device's request is held in flight while the other's lands.
 *
 * Purse writes are absolute quantities, so two moves planned from the same coins would lose one change; the purse
 * stack locks (stack id and version) make the second one lose at its lock instead, and it is re-planned from fresh
 * coins. A lock lost this way leaves nothing behind, so no client has to reload.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { OWNER, addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const { reconciliationReport } = await import("../../scripts/foundry/reconcile.mjs");
const { registerSettings } = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read } = await import("../../scripts/foundry/store.mjs");

registerSettings({ enabled: () => {}, docs: () => {} });
const GM = "gm00000000000000";
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

/** Every client its own lock manager: the lease is held everywhere and the coin mutex excludes nothing. */
const devices = () => Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_name, task) => task() } }, configurable: true });

/**
 * Hold the next request in flight: `sent` resolves once the client has planned and sent it; `release()` lets it
 * reach the server.
 */
function holdNext() {
    const real = foundry.documents.modifyBatch;
    let arrive;
    let release;
    const sent = new Promise((resolve) => { arrive = resolve; });
    foundry.documents.modifyBatch = (operations) => {
        foundry.documents.modifyBatch = real;
        arrive();
        return new Promise((resolve) => { release = () => resolve(real(operations)); });
    };
    return { sent, release: () => release() };
}

let docs;
let vera;
let bo;
beforeEach(async () => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    devices();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: OWNER }, items: [coin("gp", 10)] });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: OWNER }, items: [coin("gp", 10)] });
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: GM, isGM: true }], "p2");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p2");
    registerBatchWatcher();
    await money.pledge({ actor: bo, cp: 500, order: "o1", nonce: "n" });   // 5 gp in the strongbox
    world.currentUser = "p1";
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

const wage = (day, cp) => ({ kind: "wage", idem: `wage:j1:${day}:0`, actor: vera.uuid, cp, job: "j1", day, parties: [vera.uuid] });
const refund = (actor, cp, tag) => ({ kind: "refund", idem: `refund:o1:${actor.uuid}:${tag}`, actor: actor.uuid, cp, parties: [bo.uuid] });

test("two devices apply two wages to one purse at once: the second loses at the purse lock, and nothing is lost", async () => {
    const [w1, w2] = await claims.createClaims([wage(1, 100), wage(2, 150)]);
    const held = holdNext();
    const deviceA = claims.applyClaim(w1, vera);   // planned from 10 gp; its lock request is in flight
    await held.sent;
    const deviceB = await claims.applyClaim(w2, vera);   // planned from 10 gp too, and lands first
    held.release();
    const a = await deviceA;
    assert.equal(deviceB.outcome, "ok");
    assert.deepEqual([a.outcome, a.reason], ["conflict", "dry-run"], "both raise the same gold stack, at the same version");
    assert.equal(state.status(), "ready", "a lost lock needs no reload");
    assert.equal(read(`claims.${w1.id}.resolved`), undefined, "still open");
    assert.equal(await claims.sweepClaims(), 1, "the next sweep plans it again from the coins as they are now");
    assert.equal(cpOf(vera), 1000 + 100 + 150);
});

test("a refund on one device and a pledge on the other, from one purse: one waits, both land", async () => {
    const [r] = await claims.createClaims([refund(vera, 200, "1")]);
    const held = holdNext();
    const deviceB = claims.applyClaim(r, vera);   // +2 gp, planned from 10 gp, in flight
    await held.sent;
    const deviceA = await money.pledge({ actor: vera, cp: 300, order: "o2", nonce: "m" });   // -3 gp, planned from 10 gp, lands first
    held.release();
    const b = await deviceB;
    assert.equal(deviceA.outcome, "ok");
    assert.equal(b.outcome, "conflict");
    assert.equal(await claims.sweepClaims(), 1);
    assert.equal(cpOf(vera), 1000 - 300 + 200);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a pledge cannot land between a refund's lock and its coins: the purse's coins are spoken for until it lands", async () => {
    const [r] = await claims.createClaims([refund(vera, 200, "1")]);
    const real = foundry.documents.modifyBatch;
    let held = null;
    foundry.documents.modifyBatch = (operations) => {   // hold the refund's apply request, after its lock went through
        if (held || !operations.some((op) => op.documentName === "Item")) return real(operations);   // the lock request moves no item
        foundry.documents.modifyBatch = real;
        return new Promise((resolve) => { held = () => resolve(real(operations)); });
    };
    const deviceB = claims.applyClaim(r, vera);
    while (!held) await new Promise((resolve) => setImmediate(resolve));
    const deviceA = await money.pledge({ actor: vera, cp: 1000, order: "o2", nonce: "m" });   // all 10 gp
    held();
    assert.equal((await deviceB).outcome, "ok");
    assert.equal(deviceA.reason, "purse-short", "its only gold stack is locked by the refund in flight, so it is left out");
    assert.equal(cpOf(vera), 1200, "the refund arrived");
    assert.equal((await money.pledge({ actor: vera, cp: 1000, order: "o2", nonce: "m" })).outcome, "ok", "and then the pledge");
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox)], [200, 1300]);
});

test("two players collecting refunds at once from one strongbox stack: one waits for the next sweep; neither reloads", async () => {
    world.currentUser = GM;
    const [rv, rb] = await claims.createClaims([refund(vera, 100, "a"), refund(bo, 100, "b")]);
    world.currentUser = "p1";
    const held = holdNext();
    const veraClient = claims.applyClaim(rv, vera);   // planned from the 5 gp lot, in flight
    await held.sent;
    world.currentUser = "p2";
    const boClient = await claims.applyClaim(rb, bo);   // planned from the same lot, lands first
    world.currentUser = "p1";
    held.release();
    const v = await veraClient;
    assert.equal(boClient.outcome, "ok");
    assert.deepEqual([v.outcome, v.reason], ["conflict", "dry-run"], "both took the smallest stack");
    assert.equal(state.status(), "ready");
    assert.equal(await claims.sweepClaims(), 1, "the lot is locked now, so the sweep plans from Bo's change");
    assert.deepEqual([cpOf(vera), cpOf(bo), cpOf(docs.strongbox)], [1100, 600, 300]);
});
