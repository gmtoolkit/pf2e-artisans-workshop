/** Pro-rata splitting and remaining allocations (DESIGN.md 4.6). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { allocationsByContributor, splitProRata } from "../../scripts/logic/split.mjs";

const parts = (...cps) => cps.map((cp, i) => ({ key: `p${i}`, cp }));
const amounts = (shares) => shares.map((s) => s.cp);

test("exact shares need no rounding", () => {
    assert.deepEqual(splitProRata(3250, parts(2000, 1250)), [{ key: "p0", cp: 2000 }, { key: "p1", cp: 1250 }]);
    assert.deepEqual(amounts(splitProRata(50, parts(100, 100))), [25, 25]);
});

test("largest remainder in whole copper; ties go to the earliest contribution", () => {
    assert.deepEqual(amounts(splitProRata(10, parts(10, 10, 10))), [4, 3, 3]);
    assert.deepEqual(amounts(splitProRata(2, parts(1, 1, 1))), [1, 1, 0]);
    assert.deepEqual(amounts(splitProRata(100, parts(100, 200, 300))), [17, 33, 50]);   // 16.67, 33.33, 50
    assert.deepEqual(amounts(splitProRata(1, parts(5, 5))), [1, 0]);
    assert.deepEqual(amounts(splitProRata(1, parts(3, 7))), [0, 1]);                // the larger remainder wins
});

test("zero, empty and full splits", () => {
    assert.deepEqual(amounts(splitProRata(0, parts(10, 20))), [0, 0]);
    assert.deepEqual(splitProRata(0, []), []);
    assert.deepEqual(amounts(splitProRata(30, parts(10, 20))), [10, 20]);
    assert.deepEqual(amounts(splitProRata(7, parts(0, 10, 0))), [0, 7, 0]);
});

test("more than the allocations, or bad amounts, throw", () => {
    assert.throws(() => splitProRata(31, parts(10, 20)), RangeError);
    assert.throws(() => splitProRata(5, []), RangeError);
    assert.throws(() => splitProRata(-1, parts(10)), RangeError);
    assert.throws(() => splitProRata(1, parts(1.5)), RangeError);
});

test("on random splits the shares add up, never exceed an allocation and stay within 1 cp of exact", () => {
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 2000; i++) {
        const allocation = parts(...Array.from({ length: 1 + Math.floor(next() * 6) }, () => Math.floor(next() * 50000)));
        const sum = allocation.reduce((s, p) => s + p.cp, 0);
        const total = Math.floor(next() * (sum + 1));
        const shares = splitProRata(total, allocation);
        assert.equal(shares.reduce((s, p) => s + p.cp, 0), total);
        shares.forEach((share, j) => {
            assert.ok(share.cp <= allocation[j].cp);
            const exact = sum ? (total * allocation[j].cp) / sum : 0;
            assert.ok(Math.abs(share.cp - exact) < 1);
        });
    }
});

test("remaining allocations by contributor, earliest first contribution first", () => {
    const rows = [
        { id: "r3", actor: "B", alloc: 1000, at: { world: 10, real: 5 } },
        { id: "r1", actor: "A", alloc: 2000, at: { world: 10, real: 7 } },
        { id: "r2", actor: "A", alloc: -500, at: { world: 11, real: 1 } },           // a withdrawal
        { id: "r4", actor: null, alloc: 700, at: { world: 12, real: 1 } },           // allocated from the party fund
        { id: "r5", actor: "C", alloc: 300, at: { world: 13, real: 1 } },
        { id: "r6", actor: "C", alloc: -300, at: { world: 14, real: 1 } },           // took it all back
        { id: "r7", actor: "D", alloc: 0, at: { world: 1, real: 1 } },
    ];
    assert.deepEqual(allocationsByContributor(rows), [{ actor: "B", cp: 1000 }, { actor: "A", cp: 1500 }, { actor: null, cp: 700 }]);
});

test("contributions at the same moment are ordered by row id", () => {
    const at = { world: 5, real: 5 };
    const rows = [{ id: "b", actor: "B", alloc: 1, at }, { id: "a", actor: "A", alloc: 1, at }];
    assert.deepEqual(allocationsByContributor(rows).map((a) => a.actor), ["A", "B"]);
    assert.deepEqual(amounts(splitProRata(1, allocationsByContributor(rows).map((a) => ({ key: a.actor, cp: a.cp })))), [1, 0]);
});
