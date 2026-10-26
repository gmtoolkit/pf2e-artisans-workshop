/**
 * The Web Locks lease and the coin mutex (DESIGN.md 5.6, 5.4), and the responsible-client guard over Foundry
 * users. Node 24 has `navigator.locks`, so the lease runs on the real API; the fallback runs without it.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { addDocument, installFoundry, resetWorld, setUsers } from "./stubs.mjs";

installFoundry();
const lease = await import("../../scripts/foundry/lease.mjs");
const responsible = await import("../../scripts/foundry/responsible.mjs");

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const withoutLocks = () => Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });

beforeEach(() => {
    resetWorld();
    lease.resetLease();
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

test("without Web Locks (plain http) every tab holds the lease", () => {
    withoutLocks();
    let granted = 0;
    lease.requestLease("u1", () => granted++);
    assert.equal(lease.holdsLease(), true);
    assert.equal(granted, 1);
});

test("with Web Locks the first tab gets the lease; a second request for the same user waits", async () => {
    const name = `test-user-${Date.now()}`;
    let granted = 0;
    lease.requestLease(name, () => granted++);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(lease.holdsLease(), true);
    const state = await navigator.locks.query();
    assert.ok(state.held.some((l) => l.name === `pf2e-artisans-workshop-lease-${name}`));
    let second = false;
    navigator.locks.request(`pf2e-artisans-workshop-lease-${name}`, { ifAvailable: true }, (lock) => { second = lock !== null; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(second, false, "another tab cannot take it while this one holds it");
    assert.equal(granted, 1);
});

test("the coin mutex runs one task at a time, in order, with and without Web Locks", async () => {
    for (const setup of [() => {}, withoutLocks]) {
        setup();
        lease.resetLease();
        const log = [];
        const task = (n, ms) => async () => {
            log.push(`start ${n}`);
            await new Promise((resolve) => setTimeout(resolve, ms));
            log.push(`end ${n}`);
            return n;
        };
        const results = await Promise.all([lease.withCoinMutex("m", task(1, 15)), lease.withCoinMutex("m", task(2, 1))]);
        assert.deepEqual(results, [1, 2]);
        assert.deepEqual(log, ["start 1", "end 1", "start 2", "end 2"]);
        await assert.rejects(lease.withCoinMutex("m", async () => { throw new Error("boom"); }), /boom/);
        assert.equal(await lease.withCoinMutex("m", async () => "after"), "after", "a failed task does not block the next");
    }
});

test("the guard: the assigned player's lease-holding tab acts; the GM only when no owner is connected", () => {
    withoutLocks();
    const pc = addDocument("Actor", { name: "PC", ownership: { default: 0, p1: 3, p2: 3 } });
    setUsers([
        { id: "gm00000000000000", isGM: true }, { id: "p1", character: null }, { id: "p2", character: pc },
    ], "p2");
    assert.equal(responsible.isResponsibleFor(pc), false, "no lease yet");
    lease.requestLease("p2");
    assert.equal(responsible.responsibleUserIdFor(pc), "p2");
    assert.equal(responsible.isResponsibleFor(pc), true);
    assert.equal(responsible.ownerConnected(pc), true);
    game.users.get("p2").active = false;
    assert.equal(responsible.responsibleUserIdFor(pc), "p1", "the lowest-id owner");
    game.users.get("p1").active = false;
    assert.equal(responsible.responsibleUserIdFor(pc), "gm00000000000000");
    assert.equal(responsible.ownerConnected(pc), false);
});

test("shared writes and elections over Foundry users", () => {
    withoutLocks();
    setUsers([{ id: "pB", isGM: false }, { id: "pA", isGM: false }], "pA");
    lease.requestLease("pA");
    assert.equal(responsible.isElected(), true, "no GM: the lowest id");
    assert.equal(responsible.isResponsibleForShared("pB"), false);
    game.users.get("pB").active = false;
    assert.equal(responsible.isResponsibleForShared("pB"), true);
});
