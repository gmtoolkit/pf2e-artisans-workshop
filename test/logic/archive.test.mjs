/**
 * Archiving (DESIGN.md 5.3.3, As built in M12b): what a run moves (closed, settled, old orders with their rows, claims and days;
 * ended, paid jobs; the fund's own old rows; old day records and claims of nothing live), what it leaves (open and holding
 * orders, pending rows, a reversal without its row, rows an open order's log names, every PC's latest day record, extension
 * records), and the carry rows that keep the expected coins, the fund, the members' balances and the fund slot where they were.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCHIVE_THRESHOLDS, archivePageId, archiveSlotId, archivedRecords, carryRows, planArchive } from "../../scripts/logic/archive.mjs";
import { fundAccounts, fundDebitCount, fundSlotLockId, unallocatedCp } from "../../scripts/logic/funds.mjs";
import { hashId } from "../../scripts/logic/ids.mjs";
import { jobLogLockId } from "../../scripts/logic/jobs.mjs";
import { logLockId } from "../../scripts/logic/orders.mjs";
import { memberBalances } from "../../scripts/logic/reconcile.mjs";
import { expectedBoxCp, makeRow, reversalRow } from "../../scripts/logic/rows.mjs";

const DAY = 86400;
const NOW = 50_000_000_000;
const TODAY = 200;
const REAL_OLD = 3 * 24 * 3600 * 1000;
const on = (day, agoMs = REAL_OLD) => ({ by: "u1", at: { world: day * DAY, real: NOW - agoMs, server: NOW - agoMs, launch: 0 } });
const dayOf = (at) => Math.floor(at.world / DAY);
const A = "Actor.aaaa";
const B = "Actor.bbbb";
const applied = (row) => ({ ...row, state: "applied" });
const row = (input, day, agoMs) => applied(makeRow(input, on(day, agoMs)));
const order = (id, status, day, { event = status === "cancelled" ? "cancel" : "finish", seq = 3, agoMs, ...extra } = {}) => ({
    id, v: 1, status, log: { [seq]: { seq, event, from: "finishing", to: status, rows: [], ...on(day, agoMs) } }, ...extra, ...on(day, agoMs),
});
const toFlags = (lists) => Object.fromEntries(Object.entries(lists).map(([c, list]) => [c, Object.fromEntries(list.map((r) => [r.id, r]))]));
const plan = (flags, extra = {}) => planArchive({ flags, today: TODAY, now: NOW, dayOf, stamp: on(TODAY, 0), ...extra });

/** The ledger after a run: what the plan deletes gone, its carry rows in. */
function after(flags, p) {
    const out = structuredClone(flags);
    for (const path of p.change.del) {
        const [c, id] = path.split(".");
        delete out[c][id];
    }
    for (const [path, value] of Object.entries(p.change.set)) {
        const [c, id] = path.split(".");
        out[c][id] = value;
    }
    return out;
}

/** A small campaign: a finished order funded by a pledge and the fund, a cancelled one refunded, the fund's own rows. */
function campaign() {
    const rows = [
        row({ kind: "deposit", idem: "deposit:fund:A:n1", cp: 1000, actor: A }, 10),
        row({ kind: "deposit", idem: "deposit:fund:B:n2", cp: 500, actor: B }, 11),
        row({ kind: "withdraw", idem: "withdraw:fund:B:n3", cp: 100, actor: B }, 12),
        // o1: A pledges 300, the fund earmarks 200, it spends 400 and refunds A the 100 left.
        row({ kind: "pledge", idem: "pledge:o1:A:n4", cp: 300, actor: A, order: "o1" }, 20),
        row({ kind: "allocate", how: { side: "fund" }, idem: "earmark:o1:n5:fund", cp: 200, actor: null, order: null }, 20),
        row({ kind: "allocate", how: { side: "order" }, idem: "earmark:o1:n5:order", cp: 200, actor: null, order: "o1" }, 20),
        row({ kind: "expend", idem: "expend:o1:1:0:A", cp: 200, actor: A, order: "o1" }, 25),
        row({ kind: "expend", idem: "expend:o1:1:0:fund", cp: 200, actor: null, order: "o1" }, 25),
        row({ kind: "refund", idem: "refund:o1:A:4", cp: 100, actor: A, order: "o1" }, 30),
        // o2: B pledges 50, cancelled, refunded.
        row({ kind: "pledge", idem: "pledge:o2:B:n6", cp: 50, actor: B, order: "o2" }, 40),
        row({ kind: "refund", idem: "refund:o2:B:2", cp: 50, actor: B, order: "o2" }, 41),
    ];
    const claims = [{ id: rows[8].id, v: 1, kind: "refund", idem: "refund:o1:A:4", actor: A, order: "o1", resolved: on(30), ...on(30) }];
    const days = [
        { id: "pc1-21", v: 1, actor: "pc1", day: 21, toDay: 21, order: "o1", kind: "setup", ...on(21) },
        { id: "pc1-22", v: 1, actor: "pc1", day: 22, toDay: 22, order: "o1", kind: "extra", ...on(22) },
        { id: "pc1-23", v: 1, actor: "pc1", day: 23, toDay: 23, ...on(23) },
    ];
    const orders = [order("o1", "complete", 30), order("o2", "cancelled", 41)];
    return { rows, claims, days, orders, jobs: [] };
}

test("a closed, settled, old order moves with its rows, claims and days; the fund's old rows move; carry rows keep every total", () => {
    const lists = campaign();
    const flags = toFlags(lists);
    const p = plan(flags);
    assert.deepEqual(p.orders.sort(), ["o1", "o2"]);
    assert.equal(p.rows.length, lists.rows.length, "every row: the orders' and the fund's");
    assert.deepEqual(p.claims, [lists.claims[0].id]);
    assert.deepEqual(p.days.sort(), ["pc1-21", "pc1-22"], "the PC's latest day record stays");
    const next = after(flags, p);
    const before = Object.values(flags.rows);
    const now = Object.values(next.rows);
    assert.ok(now.every((r) => r.kind === "carry"));
    assert.equal(expectedBoxCp(now), expectedBoxCp(before), "the expected strongbox coins");
    assert.equal(unallocatedCp(now), unallocatedCp(before), "the unallocated fund");
    assert.deepEqual(memberBalances(now), memberBalances(before), "each member's share");
    assert.equal(fundDebitCount(now), fundDebitCount(before), "the fund slot's number");
    assert.equal(fundSlotLockId(now), fundSlotLockId(before));
    assert.equal(fundAccounts(now).balanced, true, "the Funds tab's identity holds");
    assert.equal(p.change.replace["meta.archive"].runs, 1);
    const reversals = lists.rows.slice(0, 3).map((r) => `reversal:${r.id}`);
    assert.deepEqual(p.locks, [archiveSlotId(0), logLockId("o1", 4), logLockId("o2", 4), ...reversals.map(hashId)],
        "the run's slot, each order's next log slot, then the reversal row id of each fund row a reversal could still take back");
    assert.deepEqual(Object.values(p.keys), reversals, "keyed, so the pruner knows them");
    assert.ok(p.lockPages.includes(lists.rows[0].id), "the archived rows' lock pages go with them");
    assert.ok([...p.years.keys()].every((y) => y === 0), "day 200 is in the first world year");
    assert.equal(p.years.get(0).orders.o1.id, "o1");
});

test("an order is not archived while it is open, young, holding money, items or an open claim, or its log disagrees", () => {
    const lists = campaign();
    const cases = [
        ["open", { orders: [order("o1", "finishing", 30), lists.orders[1]] }],
        ["young by workshop days", { orders: [order("o1", "complete", TODAY - 10), lists.orders[1]] }],
        ["young by real time", { orders: [order("o1", "complete", 30, { agoMs: 3600 * 1000 }), lists.orders[1]] }],
        ["a late write moved its status", { orders: [{ ...order("o1", "complete", 30), status: "finishing" }, lists.orders[1]] }],
        ["a pending row", { rows: lists.rows.map((r, i) => (i === 8 ? { ...r, state: "pending" } : r)) }],
        ["money still held", { rows: lists.rows.filter((_, i) => i !== 8) }],
        ["an open claim", { claims: [{ ...lists.claims[0], resolved: null }] }],
        ["an item line not given back", { orders: [order("o1", "complete", 30, { custody: { l1: { id: "l1", itemId: "i1", returned: null, used: null } } }), lists.orders[1]] }],
    ];
    for (const [why, change] of cases) {
        const p = plan(toFlags({ ...lists, ...change }));
        assert.ok(!p.orders.includes("o1"), why);
        assert.ok(p.orders.includes("o2"), `${why}: the other order still moves`);
    }
    const held = plan(toFlags(lists), { held: new Set(["o1"]) });
    assert.ok(!held.orders.includes("o1"), "an item on the shelf or earmarked in the strongbox");
});

test("an order reopened by undo is not archived; the run takes its next log slot, so an undo planned before it cannot land with it", () => {
    const lists = campaign();
    // A quest completed by a settlement, which undo can take back to `rolled`.
    const quest = order("o1", "complete", 30, { event: "settle" });
    const p = plan(toFlags({ ...lists, orders: [quest, lists.orders[1]] }));
    assert.ok(p.orders.includes("o1"));
    assert.ok(p.locks.includes(logLockId("o1", 4)), "the slot the undo would take");
    const reopened = { ...quest, status: "rolled", log: { ...quest.log, 4: { seq: 4, event: "undo", from: "complete", to: "rolled", rows: [], ...on(31) } } };
    assert.ok(!plan(toFlags({ ...lists, orders: [reopened, lists.orders[1]] })).orders.includes("o1"));
});

test("the fund's rows: a reversal moves only with the row it reverses; rows an open order's log names, young rows and extension rows stay", () => {
    const lists = campaign();
    const deposit = lists.rows[0];
    const reversal = applied(reversalRow(deposit, on(TODAY - 5)));
    const marked = { ...deposit, reversedBy: reversal.id };
    const young = plan(toFlags({ ...lists, rows: [marked, ...lists.rows.slice(1), reversal] }));
    assert.ok(!young.rows.includes(deposit.id) && !young.rows.includes(reversal.id), "the reversal is young, so neither moves");
    const oldReversal = applied(reversalRow(deposit, on(60)));
    const both = plan(toFlags({ ...lists, rows: [{ ...deposit, reversedBy: oldReversal.id }, ...lists.rows.slice(1), oldReversal] }));
    assert.ok(both.rows.includes(deposit.id) && both.rows.includes(oldReversal.id), "both old: they move together");
    const next = after(toFlags({ ...lists, rows: [{ ...deposit, reversedBy: oldReversal.id }, ...lists.rows.slice(1), oldReversal] }), both);
    assert.deepEqual(memberBalances(Object.values(next.rows)), memberBalances([{ ...deposit, reversedBy: oldReversal.id }, ...lists.rows.slice(1), oldReversal]));

    const open = order("o3", "setup", 50, { event: "start" });
    open.log[3].rows = [lists.rows[1].id];
    const named = plan(toFlags({ ...lists, orders: [...lists.orders, open] }));
    assert.ok(!named.rows.includes(lists.rows[1].id), "an open order's undo reverses it");
    const ext = row({ kind: "income", how: { via: "box" }, idem: "income:circus:k", cp: 30, actor: null, source: "circus:show" }, 15);
    assert.ok(!plan(toFlags({ ...lists, rows: [...lists.rows, ext] })).rows.includes(ext.id), "an extension's row: its day records say what it owes");
    const fresh = row({ kind: "deposit", idem: "deposit:fund:A:n9", cp: 5, actor: A }, TODAY - 59);
    assert.ok(!plan(toFlags({ ...lists, rows: [...lists.rows, fresh] })).rows.includes(fresh.id), "younger than the row age");
});

test("a service's payment row stays while the service is in the ledger: its cancel refunds it from the live row", () => {
    const lists = campaign();
    // A formula copy paid for from the party fund, and one from a purse (`purchaseInputs`), 185 days ago; the services stay open.
    const fromFund = row({ kind: "purchase", how: { via: "box" }, idem: "purchase:formula-copy:s1:n1", cp: 50, actor: null }, 15);
    const fromPurse = row({ kind: "purchase", how: { via: "purse" }, idem: "purchase:formula-copy:s2:n2", cp: 50, actor: A }, 15);
    const service = (id, paid, source) => ({ id, v: 1, kind: "formula-copy", status: "open", payment: { row: paid.id, source, cp: 50 }, ...on(15) });
    const flags = { ...toFlags({ ...lists, rows: [...lists.rows, fromFund, fromPurse] }),
        services: { s1: service("s1", fromFund, "fund"), s2: service("s2", fromPurse, "purse") } };
    const p = plan(flags);
    assert.ok(!p.rows.includes(fromFund.id) && !p.rows.includes(fromPurse.id), "both payments stay live");
    assert.ok(p.rows.includes(lists.rows[0].id), "the fund's other old rows still move");
    assert.ok(plan({ ...flags, services: {} }).rows.includes(fromFund.id), "with no service naming it, an old purchase moves");
});

test("a job moves only once ended with every day paid; a PC's latest day record and an extension run's days stay", () => {
    const job = { id: "j1", v: 1, actor: A, status: "ended", log: { 1: { seq: 1, event: "start", ...on(50) }, 2: { seq: 2, event: "end", ...on(60) } }, ...on(60) };
    const wage = (day) => row({ kind: "wage", idem: `wage:j1:${day}:0`, cp: 10, actor: A, job: "j1", day }, day);
    const days = [50, 51, 52].map((day) => ({ id: `pc2-${day}`, v: 1, actor: "pc2", day, toDay: day, job: "j1", wageCp: 10, rows: [], ...on(day) }));
    const extDay = { id: "pc3-40", v: 1, actor: "pc3", day: 40, toDay: 40, ext: { run: "x", n: 1, of: 2 }, ...on(40) };
    const pcLatest = { id: "pc3-90", v: 1, actor: "pc3", day: 90, toDay: 90, ...on(90) };
    const base = { orders: [], claims: [], jobs: [job], days: [...days, extDay, pcLatest] };
    const paid = plan(toFlags({ ...base, rows: [50, 51, 52].map(wage) }));
    assert.deepEqual(paid.jobs, ["j1"]);
    assert.deepEqual(paid.days.sort(), ["pc2-50", "pc2-51"], "its days, but not the PC's latest; nor an extension run's");
    assert.ok(paid.locks.includes(jobLogLockId("j1", 3)), "the job's next log slot: an undo of its end cannot land with the run");
    const carry = paid.carries.find((c) => c.actor === A);
    assert.equal(carry.purse, 30, "the wages minted into the purse");
    const unpaid = plan(toFlags({ ...base, rows: [50, 51].map(wage) }));
    assert.deepEqual(unpaid.jobs, [], "a day still owed");
    assert.deepEqual(plan(toFlags({ ...base, jobs: [{ ...job, status: "open" }], rows: [50, 51, 52].map(wage) })).jobs, [], "an open job");
});

test("each run folds the carry rows there into one per actor, and counts its runs; nothing to move writes nothing", () => {
    const lists = campaign();
    const flags = toFlags(lists);
    const first = plan(flags);
    const once = after(flags, first);
    once.meta = { archive: first.change.replace["meta.archive"] };
    const more = row({ kind: "deposit", idem: "deposit:fund:A:n10", cp: 70, actor: A }, 100);
    once.rows[more.id] = more;
    const second = plan(once);
    assert.equal(second.runs, 1);
    assert.equal(second.slot, archiveSlotId(1));
    const twice = after(once, second);
    const carries = Object.values(twice.rows).filter((r) => r.kind === "carry");
    assert.equal(new Set(carries.map((c) => c.actor)).size, carries.length, "one carry row per actor");
    assert.equal(expectedBoxCp(Object.values(twice.rows)), expectedBoxCp([...Object.values(flags.rows), more]));
    assert.deepEqual(memberBalances(Object.values(twice.rows)), memberBalances([...Object.values(flags.rows), more]));
    assert.equal(second.folded.length, first.carries.length, "the first run's carry rows, folded and moved to the log");
    const idle = plan(twice);
    assert.equal(idle.empty, true);
    assert.deepEqual(idle.change, { set: {}, replace: {}, del: [] });
});

test("carry rows: sums per actor, member deposits as share, fund debits counted, nothing for an actor whose sums are nothing", () => {
    const rows = [
        row({ kind: "deposit", idem: "d:1", cp: 100, actor: A }, 1),
        row({ kind: "withdraw", idem: "w:1", cp: 40, actor: A }, 2),
        row({ kind: "pledge", idem: "p:1", cp: 10, actor: B, order: "o" }, 3),
        row({ kind: "refund", idem: "r:1", cp: 10, actor: B, order: "o" }, 4),
    ];
    const carries = carryRows(rows, { runs: 0, today: 5, stamp: on(5) });
    const a = carries.find((c) => c.actor === A);
    assert.deepEqual([a.box, a.purse, a.alloc, a.share, a.fundDebits, a.count], [60, -60, 60, 60, 1, 2]);
    assert.equal(carries.find((c) => c.actor === B), undefined, "B's pledge and refund cancel out");
    assert.equal(a.idem, "carry:Actor.aaaa:0");
    assert.equal(a.state, "applied");
});

test("the run stays within its limit, whole orders first; the archived records read back newest first", () => {
    const lists = campaign();
    const p = plan(toFlags(lists), { limit: 5 });
    assert.ok(p.orders.length >= 1 && p.more === true, "the rest waits for the next run");
    const page = { rows: Object.fromEntries(lists.rows.map((r) => [r.id, r])), orders: {} };
    const back = archivedRecords([page, { rows: { stub: { reversedBy: "x" } } }], "rows");
    assert.equal(back.length, lists.rows.length, "stubs are left out");
    assert.equal(back[0].id, lists.rows.at(-1).id);
    assert.equal(typeof archivePageId(0), "string");
    assert.equal(ARCHIVE_THRESHOLDS.orderDays, 30);
});
