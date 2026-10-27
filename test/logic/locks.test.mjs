/**
 * Lock kinds and pruning (DESIGN.md 5.4, As built in M12b): every page says what it guards, and a page goes only once it is old
 * and what it guards says the same on every client; a page of a pending move, a stack still at its version, a current cycle,
 * a coating or a tracker still there, or a kind nobody knows, stays.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hashId, idemKey } from "../../scripts/logic/ids.mjs";
import { applyMarkId, recreateLockId, stackLockId } from "../../scripts/logic/lock-first.mjs";
import {
    LOCK_RULES, PRUNE_AGE_MS, forgetLockKeys, kindOfKey, lockIdOf, lockKeyId, lockKeyOf, lockTag, prunablePages, pruneVerdict,
} from "../../scripts/logic/locks.mjs";
import { logLockId } from "../../scripts/logic/orders.mjs";

const NOW = 10_000_000_000;
const at = (agoMs) => ({ world: 0, real: NOW - agoMs, server: NOW - agoMs, launch: 0 });
const OLD = at(PRUNE_AGE_MS + 1000);
const YOUNG = at(PRUNE_AGE_MS - 1000);
const page = (id, lock, extra = {}) => ({ id, lock, ...extra });
const ctx = (extra = {}) => ({ now: NOW, rows: new Map(), claims: new Map(), marks: new Map(), boxItems: new Set(), items: new Map(),
    coatings: new Set(), cycles: new Map(), orders: new Set(), migrating: false, ...extra });

test("a lock id is the hash of its key, and this client remembers the key for the page it creates", () => {
    forgetLockKeys();
    const id = lockIdOf("stack", "abc", "5");
    assert.equal(id, hashId(idemKey("stack", "abc", "5")), "the same ids as before kinds");
    assert.equal(lockKeyOf(id), "stack:abc:5");
    assert.equal(stackLockId("abc", 5), id);
    assert.equal(lockKeyOf(applyMarkId("r1")), "apply:r1");
    assert.equal(lockKeyOf(recreateLockId("r1")), "recreate:r1");
    assert.equal(lockKeyOf(logLockId("o1", 3)), "log:o1:3");
    assert.equal(lockKeyId("afflict:run:1:0"), hashId("afflict:run:1:0"));
    assert.equal(kindOfKey("afflict:run:1:0"), "afflict");
});

test("a page's tag: a key given, else a row or claim the request writes, else a strongbox item, else a key remembered", () => {
    forgetLockKeys();
    const slot = lockIdOf("fund-slot", 3);
    const context = { keys: { m1: "apply:r9" }, rowIds: new Set(["r1"]), claimIds: new Set(["c1"]), boxItemIds: new Set(["s1"]) };
    assert.deepEqual(lockTag("m1", context), { kind: "apply", key: "apply:r9" });
    assert.deepEqual(lockTag("r1", context), { kind: "row" });
    assert.deepEqual(lockTag("c1", context), { kind: "claim" });
    assert.deepEqual(lockTag("s1", context), { kind: "item" });
    assert.deepEqual(lockTag(slot, context), { kind: "fund-slot", key: "fund-slot:3" });
    assert.deepEqual(lockTag("unknown00000000", context), { kind: null });
});

test("no page is pruned while it is younger than the prune age, whatever it guards", () => {
    const c = ctx();
    for (const lock of [{ ...{ by: "u", at: YOUNG }, kind: "row" }, { by: "u", at: YOUNG, kind: "log", key: "log:o1:1" }]) {
        assert.deepEqual(pruneVerdict(page("p", lock), c), { prune: false, reason: "young" });
    }
    assert.equal(pruneVerdict(page("p", { by: "u" }), c).reason, "unstamped");
});

test("a row's page stays while the row is pending or its claim open, and goes once it is applied or gone", () => {
    const rows = new Map([["r1", { id: "r1", state: "pending" }], ["r2", { id: "r2", state: "applied" }], ["r3", { id: "r3", state: "applied" }]]);
    const claims = new Map([["r3", { id: "r3", kind: "refund" }]]);
    const c = ctx({ rows, claims });
    const lock = { by: "u", at: OLD, kind: "row" };
    assert.equal(pruneVerdict(page("r1", lock), c).prune, false);
    assert.equal(pruneVerdict(page("r2", lock), c).prune, true);
    assert.equal(pruneVerdict(page("r3", lock), c).prune, false, "an open claim of the same id keeps it");
    assert.equal(pruneVerdict(page("gone0000000000aa", lock), c).prune, true, "a row archived, or never written");
});

test("a move's page and its apply mark stay while any of its rows is pending: the resume needs both", () => {
    const rows = new Map([["r1", { id: "r1", state: "applied" }], ["r2", { id: "r2", state: "pending" }]]);
    const c = ctx({ rows });
    const move = { rows: ["r1", "r2"], apply: [], touched: [] };
    assert.equal(pruneVerdict(page("r1", { by: "u", at: OLD, kind: "row" }, { move }), c).reason, "move-pending");
    assert.equal(pruneVerdict(page(applyMarkId("r2"), { by: "u", at: OLD, kind: "apply", key: "apply:r2" }), c).prune, false);
    rows.set("r2", { id: "r2", state: "applied" });
    assert.equal(pruneVerdict(page("r1", { by: "u", at: OLD, kind: "row" }, { move }), c).reason, "move-done");
    assert.equal(pruneVerdict(page(applyMarkId("r2"), { by: "u", at: OLD, kind: "apply", key: "apply:r2" }), c).prune, true);
});

test("a stack lock stays while the stack is still at the version it locked; a strongbox item's while the item is there", () => {
    const c = ctx({ items: new Map([["st1", 7]]), boxItems: new Set(["box1"]) });
    const stack = (version) => page(stackLockId("st1", version), { by: "u", at: OLD, kind: "stack", key: `stack:st1:${version}` });
    assert.equal(pruneVerdict(stack(7), c).reason, "stack-held");
    assert.equal(pruneVerdict(stack(6), c).reason, "stack-moved");
    assert.equal(pruneVerdict(page("box1", { by: "u", at: OLD, kind: "item" }), c).reason, "item-there");
    assert.equal(pruneVerdict(page("box2", { by: "u", at: OLD, kind: "item" }), c).reason, "item-gone");
    assert.equal(pruneVerdict(page("box1", { by: "u", at: OLD }), c).reason, "item-there", "an untagged page of a stack still there too");
});

test("slots, cycles, coatings, trackers and orders' markers each go when what they guard has moved on", () => {
    const c = ctx({ cycles: new Map([["a1", 4]]), coatings: new Set(["co1"]), items: new Map([["run1", 1]]), orders: new Set(["o1"]) });
    const keyed = (key) => page(hashId(key), { by: "u", at: OLD, kind: kindOfKey(key), key });
    assert.equal(pruneVerdict(keyed("log:o1:3"), c).prune, true, "a log slot: the next transition names the next slot");
    assert.equal(pruneVerdict(keyed("fund-slot:12"), c).prune, true);
    assert.equal(pruneVerdict(keyed("prep:a1:4:0"), c).prune, false, "this cycle's preparations");
    assert.equal(pruneVerdict(keyed("prep:a1:3:0"), c).prune, true, "an earlier cycle's");
    assert.equal(pruneVerdict(keyed("standing:s1:a1:4"), c).prune, false);
    assert.equal(pruneVerdict(keyed("coating:co1"), c).prune, false, "a spent coating's marker is its spent state");
    assert.equal(pruneVerdict(keyed("coating:co2"), c).prune, true);
    assert.equal(pruneVerdict(keyed("afflict:run1:1:0"), c).prune, false);
    assert.equal(pruneVerdict(keyed("afflict:run2:1:0"), c).prune, true);
    assert.equal(pruneVerdict(keyed("assemble:o1:1"), c).prune, false);
    assert.equal(pruneVerdict(keyed("assemble:o2:1"), c).prune, true);
    assert.equal(pruneVerdict(keyed("spend:sink:key"), c).reason, "unknown-kind", "a kind with no rule stays");
    assert.ok(Object.keys(LOCK_RULES).includes("archive"), "an archive run's slot is an age lock");
});

test("pages written before kinds: rows, claims, marks and migrations are worked out from the live data; the rest stay", () => {
    const rows = new Map([["r1", { id: "r1", state: "applied" }], ["r2", { id: "r2", state: "pending" }]]);
    const marks = new Map([[applyMarkId("r1"), "r1"], [recreateLockId("r2"), "r2"]]);
    const c = ctx({ rows, marks });
    const old = { by: "u", at: OLD };
    assert.equal(pruneVerdict(page("r1", old), c).prune, true);
    assert.equal(pruneVerdict(page("r2", old), c).prune, false);
    assert.equal(pruneVerdict(page(applyMarkId("r1"), old), c).prune, true);
    assert.equal(pruneVerdict(page(recreateLockId("r2"), old), c).prune, false);
    assert.equal(pruneVerdict(page("mig", { ...old, to: 1 }), c).prune, true);
    assert.equal(pruneVerdict(page("mig", { ...old, to: 1 }), { ...c, migrating: true }).prune, false);
    assert.equal(pruneVerdict(page("legacy0000000000", old), c).reason, "unknown", "a stack lock of an old world cannot be told apart");
});

test("prunablePages lists the pages that go, oldest first, and counts the rest by reason", () => {
    const rows = new Map([["r1", { id: "r1", state: "applied" }], ["r2", { id: "r2", state: "pending" }]]);
    const pages = [
        page("r1", { by: "u", at: at(PRUNE_AGE_MS + 5000), kind: "row" }),
        page("r2", { by: "u", at: OLD, kind: "row" }),
        page("x", { by: "u", at: at(PRUNE_AGE_MS + 9000), kind: "log", key: "log:o:1" }),
        page("y", { by: "u", at: YOUNG, kind: "log", key: "log:o:2" }),
    ];
    const { ids, kept } = prunablePages(pages, ctx({ rows }));
    assert.deepEqual(ids, ["x", "r1"]);
    assert.deepEqual(kept, { "row-pending": 1, young: 1 });
});
