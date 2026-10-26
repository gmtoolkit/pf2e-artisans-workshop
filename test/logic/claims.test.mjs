/** Claims (DESIGN.md 5.5) and the GM relay's checks (5.7). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { claimRowInput, makeClaim, openClaims, relayDecision } from "../../scripts/logic/claims.mjs";
import { hashId } from "../../scripts/logic/ids.mjs";
import { makeRow } from "../../scripts/logic/rows.mjs";

const stamp = (real = 1) => ({ by: "u1", at: { world: 0, real } });

test("a claim's id is the hash of its key, which is also the key of the row applying it writes", () => {
    const claim = makeClaim({ kind: "refund", idem: "refund:o1:Actor.b:0", actor: "Actor.b", cp: 500, order: "o1", parties: ["Actor.a"] }, stamp());
    assert.equal(claim.id, hashId("refund:o1:Actor.b:0"));
    const row = makeRow(claimRowInput(claim), stamp());
    assert.equal(row.id, claim.id, "claim and row share one lock page");
    assert.deepEqual([row.kind, row.box, row.purse, row.alloc, row.actor, row.order], ["refund", -500, 500, -500, "Actor.b", "o1"]);
});

test("a refund claim for a garden's allocation writes a row against that garden", () => {
    const claim = makeClaim({ kind: "refund", idem: "purge-refund:garden-g1:Actor.b", actor: "Actor.b", cp: 200, garden: "g1" }, stamp());
    const row = makeRow(claimRowInput(claim), stamp());
    assert.deepEqual([row.garden, row.order, row.alloc], ["g1", null, -200]);
});

test("a wage claim mints into the purse; kinds without coins have no row", () => {
    const wage = makeClaim({ kind: "wage", idem: "wage:j1:4:0", actor: "Actor.b", cp: 30, job: "j1", day: 4 }, stamp());
    assert.deepEqual(makeRow(claimRowInput(wage), stamp()).purse, 30);
    assert.equal(claimRowInput(makeClaim({ kind: "expiry", idem: "expiry:c:3", actor: "Actor.b" }, stamp())), null);
});

test("claims are refused with an unknown kind, no target, or a coin claim without whole copper", () => {
    assert.throws(() => makeClaim({ kind: "gift", idem: "x", actor: "A" }, stamp()), RangeError);
    assert.throws(() => makeClaim({ kind: "refund", idem: "x", actor: "" , cp: 1 }, stamp()), TypeError);
    assert.throws(() => makeClaim({ kind: "refund", idem: "x", actor: "A", cp: 1.5 }, stamp()), RangeError);
});

test("open claims leave out resolved ones and stubs, earliest first, optionally for one actor", () => {
    const a = makeClaim({ kind: "refund", idem: "r:a", actor: "A", cp: 1 }, stamp(3));
    const b = makeClaim({ kind: "refund", idem: "r:b", actor: "B", cp: 1 }, stamp(1));
    const c = { ...makeClaim({ kind: "refund", idem: "r:c", actor: "A", cp: 1 }, stamp(2)), resolved: { by: "u2" } };
    const claims = { [a.id]: a, [b.id]: b, [c.id]: c, stub: { resolved: { by: "x" } } };
    assert.deepEqual(openClaims(claims).map((x) => x.idem), ["r:b", "r:a"]);
    assert.deepEqual(openClaims(claims, "A").map((x) => x.idem), ["r:a"]);
});

test("the relay applies a claim only for a party to it, and never while an owner is connected", () => {
    const claim = makeClaim({ kind: "refund", idem: "r:x", actor: "Actor.b", cp: 5, parties: ["Actor.a"] }, stamp());
    const request = { actorUuid: "Actor.b", userId: "u9", ownedUuids: new Set(["Actor.a"]), ownerConnected: false };
    assert.deepEqual(relayDecision(claim, request), { ok: true });
    assert.deepEqual(relayDecision(claim, { ...request, ownedUuids: new Set() }), { ok: false, reason: "not-party" });
    assert.deepEqual(relayDecision(claim, { ...request, ownedUuids: new Set(), userId: "u1" }), { ok: true }, "the claim's author");
    assert.equal(relayDecision(claim, { ...request, ownerConnected: true }).reason, "owner-connected");
    assert.equal(relayDecision(claim, { ...request, actorUuid: "Actor.c" }).reason, "wrong-actor");
    assert.equal(relayDecision({ ...claim, resolved: {} }, request).reason, "resolved");
    assert.equal(relayDecision(undefined, request).reason, "unknown");
});
