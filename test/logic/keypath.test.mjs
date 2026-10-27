/** The write rule (DESIGN.md 5.3, P3): key paths only, never a whole collection, `_del` for deletions. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPath, flagKey, flagUpdate, keyPathDiff, liveRecords, readPath } from "../../scripts/logic/keypath.mjs";

const DEL = { del: true };
const operators = { deletion: DEL, replacement: (value) => ({ replaced: value }) };

test("paths into records are accepted; whole collections and unknown keys are refused", () => {
    assert.deepEqual(checkPath("rows.abc.state"), ["rows", "abc", "state"]);
    assert.doesNotThrow(() => checkPath("orders.o1"));
    assert.doesNotThrow(() => checkPath("meta.settlement"));
    assert.doesNotThrow(() => checkPath("meta.manual.run1"));
    assert.doesNotThrow(() => checkPath("formulas.actor1.hash1"));
    assert.doesNotThrow(() => checkPath("extRuns.run1"));
    assert.doesNotThrow(() => checkPath("spends.s1.notes"));
    assert.throws(() => checkPath("ext.my-module.key"), /not under a known ledger key/, "M10: an extension's data is in its own flag scope (12.4)");
    assert.doesNotThrow(() => checkPath("schema"));
    for (const path of ["rows", "orders", "meta", "meta.manual", "formulas.actor1", "extRuns", "spends", "claims"]) {
        assert.throws(() => checkPath(path), /whole collection/, path);
    }
    assert.throws(() => checkPath("ordres.o1"), /not under a known ledger key/);
    assert.throws(() => checkPath(""), TypeError);
});

test("bad segments are refused: empty, the banned -= and == keys, prototype keys", () => {
    for (const path of ["rows..x", "rows.-=x", "rows.==x", "rows.x.__proto__", "rows.a b", "rows.x."]) {
        assert.throws(() => checkPath(path), TypeError, path);
    }
});

test("an update sets, replaces and deletes by key path in the module's flags", () => {
    const update = flagUpdate("mod", {
        set: { "rows.r1": { id: "r1" }, "orders.o1.status": "setup" },
        replace: { "roster.a1": { name: "A" } },
        del: ["standing.s1"],
    }, operators);
    assert.deepEqual(update, {
        "flags.mod.rows.r1": { id: "r1" },
        "flags.mod.orders.o1.status": "setup",
        "flags.mod.roster.a1": { replaced: { name: "A" } },
        "flags.mod.standing.s1": DEL,
    });
    assert.equal(flagKey("mod", "rows.x"), "flags.mod.rows.x");
});

test("an update refuses overlapping or repeated paths, and any bad path", () => {
    assert.throws(() => flagUpdate("mod", { set: { "rows.r1": {}, "rows.r1.state": "applied" } }, operators), /overlap/);
    assert.throws(() => flagUpdate("mod", { set: { "rows.r1": 1 }, del: ["rows.r1"] }, operators), /twice/);
    assert.throws(() => flagUpdate("mod", { set: { rows: {} } }, operators), /whole collection/);
    assert.throws(() => flagUpdate("mod", { del: ["orders"] }, operators), /whole collection/);
});

test("stubs without id or v are not live records", () => {
    const records = liveRecords({
        a: { id: "a", v: 1, kind: "pledge" },
        b: { reversedBy: "x" },                // re-created by a late key-path write after archiving
        c: { id: "c" },
        d: { id: "d", v: "1" },
        e: null,
    });
    assert.deepEqual(records.map((r) => r.id), ["a"]);
    assert.deepEqual(liveRecords(undefined), []);
    assert.deepEqual(liveRecords([1, 2]), []);
});

test("readPath walks plain objects", () => {
    const flags = { rows: { r1: { state: "pending" } } };
    assert.equal(readPath(flags, "rows.r1.state"), "pending");
    assert.equal(readPath(flags, "rows.r2.state"), undefined);
    assert.equal(readPath(flags, "rows.r1.state.deeper"), undefined);
});

test("keyPathDiff writes changed leaves and deletes removed keys, never a whole collection", () => {
    const before = { schema: 0, role: "ledger", rows: { r1: { id: "r1", v: 1, state: "pending", items: [1] } }, meta: { old: 1 } };
    const after = { schema: 1, role: "ledger", rows: { r1: { id: "r1", v: 2, state: "pending", items: [1, 2] }, r2: { id: "r2", v: 1 } }, meta: {} };
    const diff = keyPathDiff(before, after);
    assert.deepEqual(diff.set, { schema: 1, "rows.r1.v": 2, "rows.r1.items": [1, 2], "rows.r2.id": "r2", "rows.r2.v": 1 });
    assert.deepEqual(diff.del, ["meta.old"]);
    assert.doesNotThrow(() => flagUpdate("mod", diff, operators));
    assert.deepEqual(keyPathDiff(after, after), { set: {}, del: [] });
});
