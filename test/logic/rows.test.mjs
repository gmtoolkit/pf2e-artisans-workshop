/** Stored ledger rows (DESIGN.md 4.6): signs, ids, reversals, the correction sequence, the expected balance. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { committedFromRows, startOrder, settleCheck } from "../../scripts/logic/craft.mjs";
import { liveRows } from "../../scripts/logic/core.mjs";
import { hashId } from "../../scripts/logic/ids.mjs";
import { BOOKKEEPING_KINDS, ROW_KINDS, expectedBoxCp, makeRow, reversalRow, seqFor, signedAmounts } from "../../scripts/logic/rows.mjs";
import { allocationsByContributor } from "../../scripts/logic/split.mjs";

const stamp = { by: "user1", at: { world: 100, real: 1000 } };

test("signs per kind follow the 4.6 table", () => {
    const table = {
        pledge: [100, -100, 100], deposit: [100, -100, 100], withdraw: [-100, 100, -100], commit: [0, 0, 0],
        expend: [-100, 0, -100], release: [0, 0, 0], ruin: [-100, 0, -100], remainder: [-100, 0, -100],
        refund: [-100, 100, -100], wage: [0, 100, 0], expense: [-100, 0, -100], plant: [-100, 0, -100], delivered: [0, 0, 0],
    };
    for (const [kind, [box, purse, alloc]] of Object.entries(table)) {
        assert.deepEqual(signedAmounts(kind, 100), { box, purse, alloc }, kind);
    }
    assert.deepEqual(signedAmounts("allocate", 50, { side: "fund" }), { box: 0, purse: 0, alloc: -50 });
    assert.deepEqual(signedAmounts("allocate", 50, { side: "order" }), { box: 0, purse: 0, alloc: 50 });
    assert.deepEqual(signedAmounts("purchase", 50, { via: "purse" }), { box: 0, purse: -50, alloc: 0 });
    // Paid from the strongbox, a purchase spends the allocation that held the coins (As built in M5 on M4.1).
    assert.deepEqual(signedAmounts("purchase", 50, { via: "box" }), { box: -50, purse: 0, alloc: -50 });
    assert.deepEqual(signedAmounts("income", 50, { via: "box" }), { box: 50, purse: 0, alloc: 50 });
    assert.deepEqual(signedAmounts("income", 50, { via: "purse" }), { box: 0, purse: 50, alloc: 0 });
    assert.throws(() => signedAmounts("allocate", 50), /side/);
    assert.throws(() => signedAmounts("pledge", -1), RangeError);
    assert.throws(() => signedAmounts("nonsense", 1), RangeError);
    assert.ok(Object.is(signedAmounts("expend", 0).box, 0), "no negative zero");
});

test("a row's id is the hash of its key, it starts pending, and it records its author", () => {
    const row = makeRow({ kind: "pledge", idem: "pledge:o1:Actor.a:n1", cp: 250, actor: "Actor.a", order: "o1" }, stamp);
    assert.equal(row.id, hashId("pledge:o1:Actor.a:n1"));
    assert.equal(row.v, 1);
    assert.equal(row.state, "pending");
    assert.equal(row.author, "user1");
    assert.deepEqual(row.at, stamp.at);
    assert.deepEqual([row.box, row.purse, row.alloc, row.cp], [250, -250, 250, 250]);
    assert.equal(makeRow({ kind: "pledge", idem: "pledge:o1:Actor.a:n1", cp: 250 }, { by: "u2", at: {} }).id, row.id, "the same key is the same row");
});

test("adjust and carry rows carry explicit signed amounts", () => {
    const row = makeRow({ kind: "adjust", idem: "adjust:x", cp: 30, signed: { box: -30, alloc: -30 } }, stamp);
    assert.deepEqual([row.box, row.purse, row.alloc], [-30, 0, -30]);
    assert.throws(() => makeRow({ kind: "adjust", idem: "adjust:y", cp: 1 }, stamp), /explicit/);
    assert.throws(() => makeRow({ kind: "carry", idem: "carry:y", cp: 1, signed: { box: 0.5 } }, stamp), RangeError);
});

test("a reversal carries the inverse amounts, is keyed by its target, and cannot itself be reversed", () => {
    const pledge = makeRow({ kind: "pledge", idem: "pledge:o1:A:n1", cp: 400, actor: "A", order: "o1" }, stamp);
    const reversal = reversalRow(pledge, stamp, "mistake");
    assert.equal(reversal.id, hashId(`reversal:${pledge.id}`));
    assert.deepEqual([reversal.box, reversal.purse, reversal.alloc], [-400, 400, -400]);
    assert.equal(reversal.reverses, pledge.id);
    assert.equal(expectedBoxCp([pledge, reversal]), 0);
    assert.deepEqual(liveRows([pledge, reversal]), [], "M1's reversal model drops both");
    assert.throws(() => reversalRow(reversal, stamp), RangeError);
});

test("the correction sequence counts reversed rows of a key stem, so a corrected row gets a fresh key", () => {
    const expend = (seq) => makeRow({ kind: "expend", idem: `expend:o1:1:${seq}:A`, cp: 100, actor: "A", order: "o1" }, stamp);
    const first = expend(0);
    assert.equal(seqFor([first], "expend:o1:1"), 0);
    const undone = [first, reversalRow(first, stamp)];
    assert.equal(seqFor(undone, "expend:o1:1"), 1);
    assert.equal(seqFor([{ ...first, reversedBy: "x" }], "expend:o1:1"), 1, "either mark counts");
    assert.equal(seqFor(undone, "expend:o1:2"), 0, "another attempt's stem");
    assert.notEqual(expend(1).id, first.id);
});

test("M1 lifecycle rows become stored rows the M1 derivations still read", () => {
    const order = { id: "o1", status: "accepted", attempt: 0 };
    const plan = { ok: true, priceCp: 6500, upfrontCp: 3250, setup: { days: 1, hours: 0 }, dc: { final: 19 } };
    const started = startOrder(order, plan);
    const commit = makeRow({ ...started.rows[0], idem: "commit:o1:1:0", order: "o1" }, stamp);
    const settled = settleCheck({ ...order, ...started.patch, status: "rolled", check: { degree: 2 } }, { committedCp: committedFromRows([commit]) });
    const expend = makeRow({ ...settled.rows[0], idem: "expend:o1:1:0:A", order: "o1", actor: "A" }, stamp);
    assert.equal(commit.kind, "commit");
    assert.equal(committedFromRows([commit]), 3250);
    assert.equal(committedFromRows([commit, expend]), 0);
    assert.deepEqual([expend.box, expend.alloc], [-3250, -3250]);
});

test("the expected strongbox balance is the sum of box over every row", () => {
    const rows = [
        makeRow({ kind: "pledge", idem: "p1", cp: 1000, actor: "A", order: "o1" }, stamp),
        makeRow({ kind: "deposit", idem: "d1", cp: 500, actor: "B" }, stamp),
        makeRow({ kind: "expend", idem: "e1", cp: 300, actor: "A", order: "o1" }, stamp),
        makeRow({ kind: "wage", idem: "w1", cp: 70, actor: "A" }, stamp),
    ];
    assert.equal(expectedBoxCp(rows), 1200);
    assert.deepEqual(allocationsByContributor(rows.filter((r) => r.order === "o1")), [{ actor: "A", cp: 700 }]);
});

test("bookkeeping kinds are exactly the kinds that move neither coins nor items", () => {
    const ITEM_KINDS = ["material-in", "material-out", "delivered", "shelved", "custody-in", "custody-out"];
    for (const kind of ROW_KINDS) {
        if (["reversal", "adjust", "carry", "allocate", "purchase", "income"].includes(kind)) continue;
        const { box, purse } = signedAmounts(kind, 10);
        assert.equal(box === 0 && purse === 0 && !ITEM_KINDS.includes(kind), BOOKKEEPING_KINDS.includes(kind), kind);
    }
    assert.ok(BOOKKEEPING_KINDS.includes("adjust") && BOOKKEEPING_KINDS.includes("allocate"));
    assert.ok(ITEM_KINDS.every((kind) => !BOOKKEEPING_KINDS.includes(kind)), "item movements take a lock (4.1)");
});
