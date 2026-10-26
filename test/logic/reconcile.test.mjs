/** Reconciliation (DESIGN.md 4.7) and the purge's member balances (5.9). */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    PENDING_GRACE_MS, adjustNonce, adjustRowInput, memberBalances, pendingDueInMs, pendingState, reconcile,
} from "../../scripts/logic/reconcile.mjs";
import { makeRow, reversalRow } from "../../scripts/logic/rows.mjs";

let clock = 0;
const at = () => ({ by: "u1", at: { world: 0, real: ++clock } });
const row = (input) => ({ ...makeRow(input, at()), state: "applied" });

test("expected coins are the rows' sum of box; actual coins every stack; pending rows are listed", () => {
    const rows = [
        row({ kind: "pledge", idem: "p1", cp: 1000, actor: "A", order: "o1" }),
        { ...makeRow({ kind: "deposit", idem: "d1", cp: 250, actor: "B" }, { by: "u2", at: { world: 0, real: 10 } }) },
    ];
    const stacks = [{ id: "s1", denomination: "gp", quantity: 10 }, { id: "s2", denomination: "gp", quantity: 2 }, { id: "s3", denomination: "sp", quantity: 5 }];
    const report = reconcile({ rows, stacks, now: 10 + PENDING_GRACE_MS });
    assert.deepEqual([report.expectedCp, report.actualCp, report.differenceCp], [1250, 1250, 0]);
    assert.deepEqual(report.pending.map((r) => r.idem), ["d1"]);
    assert.deepEqual(report.stalled.map((r) => r.idem), ["d1"]);
    assert.deepEqual(reconcile({ rows, stacks, now: 10 + PENDING_GRACE_MS - 1 }).stalled, [], "within the grace time");
    assert.deepEqual(reconcile({ rows, stacks, now: 0, lockedIds: new Set(["s2", "other"]) }).lockedStacks, ["s2"], "locked but still there");
});

test("ages are read on the server's clock when a stamp has it, so two machines' clocks never meet", () => {
    const launch = 1_000_000;
    const slowAuthor = { ...makeRow({ kind: "deposit", idem: "d1", cp: 1, actor: "B" }, { by: "u2", at: { world: 0, real: 0, server: 5000, launch } }) };
    assert.deepEqual(reconcile({ rows: [slowAuthor], stacks: [], now: launch + 5000 + PENDING_GRACE_MS - 1 }).stalled, []);
    assert.equal(reconcile({ rows: [slowAuthor], stacks: [], now: launch + 5000 + PENDING_GRACE_MS }).stalled.length, 1);
});

test("a row left pending in an earlier, longer launch of the world is stalled once past the grace time", () => {
    const firstLaunch = 1_790_000_000_000;
    const secondLaunch = firstLaunch + 11 * 60 * 60 * 1000;
    const now = secondLaunch + 30 * 1000;   // half a minute after the relaunch
    const at = { world: 0, real: 0, server: now - 2 * PENDING_GRACE_MS - firstLaunch, launch: firstLaunch };   // two minutes ago
    const row = makeRow({ kind: "deposit", idem: "d1", cp: 1, actor: "B" }, { by: "u2", at });
    assert.equal(reconcile({ rows: [row], stacks: [], now }).stalled.length, 1, "its server time is far ahead of today's, but it is old");
});

test("a pending row is in flight, resumable or needing a hand, by its age, its automatic path and that path's mark", () => {
    const at = (ms) => ({ world: 0, real: ms });
    const now = 10 * PENDING_GRACE_MS;
    const old = { id: "r", state: "pending", at: at(0) };
    const mark = (ms, hand = null) => ({ at: at(ms), hand });
    assert.equal(pendingState({ ...old, at: at(now - 1) }, { now, auto: true }), "inFlight", "younger than the grace time: its own apply request may still land");
    assert.equal(pendingState({ ...old, at: at(now - 1) }, { now }), "inFlight", "even with nothing to finish it later");
    assert.equal(pendingState(old, { now, auto: true }), "resumable", "the module finishes it, and nobody has taken its mark");
    assert.equal(pendingState(old, { now }), "needsHand", "nothing finishes it");
    assert.equal(pendingState(old, { now, auto: true, mark: mark(now - 1) }), "inFlight", "a request took its mark just now");
    assert.equal(pendingState(old, { now, auto: true, mark: mark(now - PENDING_GRACE_MS) }), "needsHand", "and stopped part-way");
    assert.equal(pendingState(old, { now, auto: true, mark: mark(now - 1, { kind: "close" }) }), "needsHand", "a close or an adjust took it: nothing is behind it");
    const noted = (reason, ms) => ({ ...old, stopped: { by: "u", at: at(ms), applied: 0, total: 3, reason } });
    assert.equal(pendingState(noted("dry-run", now - 1), { now }), "inFlight", "refused at its dry run just now, as a race lost at the mark looks");
    assert.equal(pendingState(noted("dry-run", now - PENDING_GRACE_MS), { now }), "needsHand");
    assert.equal(pendingState(noted("stopped", now - 1), { now }), "needsHand", "answered, and part of it applied");
});

test("an in-flight row says when its state changes with time alone; any other waits for a change to the data", () => {
    const at = (ms) => ({ world: 0, real: ms });
    const now = 10 * PENDING_GRACE_MS;
    const old = { id: "r", state: "pending", at: at(0) };
    const mark = (ms, hand = null) => ({ at: at(ms), hand });
    assert.equal(pendingDueInMs({ ...old, at: at(now - 1000) }, { now, auto: true }), PENDING_GRACE_MS - 1000, "a young row: once past the grace time");
    assert.equal(pendingDueInMs(old, { now, mark: mark(now - 2000) }), PENDING_GRACE_MS - 2000, "in flight: once its mark is");
    const refused = { ...old, stopped: { by: "u", at: at(now - 3000), applied: 0, total: 3, reason: "dry-run" } };
    assert.equal(pendingDueInMs(refused, { now }), PENDING_GRACE_MS - 3000, "refused at its dry run: once the note is");
    assert.equal(pendingState(refused, { now: now + PENDING_GRACE_MS - 3000 }), "needsHand", "and then it needs a hand");
    assert.equal(pendingDueInMs(old, { now, auto: true }), null, "resumable");
    assert.equal(pendingDueInMs(old, { now }), null, "needs a hand");
    assert.equal(pendingDueInMs(old, { now, mark: mark(now - 1, { kind: "close" }) }), null, "a close or an adjust took its mark");
});

test("the report divides the pending rows into in flight, resumable and needing a hand; the first two are still owed", () => {
    const at = (ms) => ({ world: 0, real: ms });
    const rows = ["a", "b", "c", "d"].map((id, i) => ({ id, kind: "deposit", box: 10 ** i, state: "pending", at: at(i) }));
    const now = 2 + PENDING_GRACE_MS;   // "d" is younger than the grace time
    const paths = new Map([["a", { auto: true, mark: null }], ["b", { auto: false, mark: { at: at(now - 1), hand: null } }]]);
    const report = reconcile({ rows, stacks: [], now, paths });
    const ids = (list) => list.map((row) => row.id);
    assert.deepEqual([ids(report.pending), ids(report.stalled)], [["a", "b", "c", "d"], ["a", "b", "c"]]);
    assert.deepEqual([ids(report.inFlight), ids(report.resumable), ids(report.needsHand)], [["b", "d"], ["a"], ["c"]]);
    assert.equal(report.owedBoxCp, 1 + 10 + 1000, "what the in-flight and resumable rows will still put in the strongbox");
});

test("coins dragged in by hand show as a difference, booked by a GM's adjust row", () => {
    const rows = [row({ kind: "deposit", idem: "d1", cp: 100, actor: "B" })];
    const report = reconcile({ rows, stacks: [{ id: "s", denomination: "gp", quantity: 3 }], now: 0 });
    assert.equal(report.differenceCp, 200);
    const adjust = row(adjustRowInput(report.differenceCp, "n1", "found coins"));
    assert.deepEqual([adjust.kind, adjust.cp, adjust.box, adjust.purse, adjust.alloc], ["adjust", 200, 200, 0, 200]);
    assert.equal(reconcile({ rows: [...rows, adjust], stacks: [{ id: "s", denomination: "gp", quantity: 3 }], now: 0 }).differenceCp, 0);
    assert.throws(() => adjustRowInput(0, "n"), RangeError);
});

test("an adjustment's key comes from the state it corrects: the same difference twice is one row, a later one another", () => {
    const rows = [row({ kind: "deposit", idem: "d1", cp: 100, actor: "B" }), row({ kind: "deposit", idem: "d2", cp: 100, actor: "C" })];
    const report = { expectedCp: 200, actualCp: 300 };
    assert.equal(adjustNonce(report, rows), adjustNonce(report, [...rows].reverse()), "row order does not matter");
    const booked = row(adjustRowInput(100, adjustNonce(report, rows)));
    assert.notEqual(adjustNonce({ expectedCp: 300, actualCp: 400 }, [...rows, booked]), adjustNonce(report, rows));
    assert.notEqual(adjustNonce({ expectedCp: 200, actualCp: 250 }, rows), adjustNonce(report, rows));
});

test("member balances: remaining allocations per order, plus the fund pro rata by net deposits", () => {
    const rows = [
        row({ kind: "pledge", idem: "p1", cp: 3000, actor: "A", order: "o1" }),
        row({ kind: "pledge", idem: "p2", cp: 1000, actor: "B", order: "o1" }),
        row({ kind: "expend", idem: "e1", cp: 2000, actor: "A", order: "o1" }),
        row({ kind: "deposit", idem: "d1", cp: 600, actor: "A" }),
        row({ kind: "deposit", idem: "d2", cp: 300, actor: "C" }),
        row({ kind: "allocate", idem: "al1", cp: 300, how: { side: "fund" } }),
        row({ kind: "allocate", idem: "al2", cp: 300, how: { side: "order" }, order: "o2" }),
        row({ kind: "withdraw", idem: "w1", cp: 100, actor: "C" }),
    ];
    // o1: A 1000 left, B 1000. o2: 300 of fund money, back to the fund. Fund: 600 + 300 - 300 - 100 + 300 = 800,
    // split over net deposits A 600, C 200: A 600, C 200.
    const { byActor, byAllocation, unassignedCp } = memberBalances(rows);
    assert.deepEqual(byActor, [{ actor: "A", cp: 1600 }, { actor: "B", cp: 1000 }, { actor: "C", cp: 200 }]);
    assert.deepEqual(byAllocation, [
        { actor: "A", order: null, garden: null, cp: 600 }, { actor: "A", order: "o1", garden: null, cp: 1000 },
        { actor: "B", order: "o1", garden: null, cp: 1000 }, { actor: "C", order: null, garden: null, cp: 200 },
    ]);
    assert.equal(unassignedCp, 0);
});

test("refunds paid against each allocation bring every balance to nothing, the fund share included", () => {
    const rows = [
        row({ kind: "pledge", idem: "p1", cp: 700, actor: "A", order: "o1" }),
        row({ kind: "pledge", idem: "p2", cp: 200, actor: "A", garden: "g1" }),
        row({ kind: "deposit", idem: "d1", cp: 500, actor: "A" }),
        row({ kind: "deposit", idem: "d2", cp: 300, actor: "B" }),
        row({ kind: "income", idem: "i1", cp: 200, how: { via: "box" } }),
    ];
    const before = memberBalances(rows);
    assert.deepEqual(before.byActor, [{ actor: "A", cp: 1400 }, { actor: "B", cp: 300 }]);
    const refunds = before.byAllocation.filter((b) => b.actor === "A")
        .map((b, n) => row({ kind: "refund", idem: `r${n}`, cp: b.cp, actor: b.actor, order: b.order, garden: b.garden }));
    const after = memberBalances([...rows, ...refunds]);
    assert.deepEqual(after.byActor, [{ actor: "B", cp: 300 }], "A's fund refund counts against A's deposits, not B's share");
    assert.equal(after.unassignedCp, 200);
});

test("fund money nobody deposited (income) is unassigned; reversed deposits do not count", () => {
    const deposit = row({ kind: "deposit", idem: "d1", cp: 500, actor: "A" });
    const rows = [deposit, { ...reversalRow(deposit, at()), state: "applied" }, row({ kind: "income", idem: "i1", cp: 400, how: { via: "box" } })];
    assert.deepEqual(memberBalances(rows), { byAllocation: [], byActor: [], unassignedCp: 400 });
});
