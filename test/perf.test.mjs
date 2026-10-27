/**
 * The performance pass (DESIGN.md 15.3 scenario 11, OQ-36; `tools/harness/perf.mjs`): its copies of a ledger keep the module's
 * own invariants (a row's id is the hash of its key, every reference follows the copy, work days stay out of a PC's day
 * records, the strongbox gets the coins the copies hold), and its summaries of timings and CPU profiles add up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hashId } from "../scripts/logic/ids.mjs";
import { isDayRecord } from "../scripts/logic/downtime.mjs";
import { FIXTURES } from "../tools/harness/fixtures.mjs";
import { EXTRA, cloneRecords, hotspots, shortUrl, stats } from "../tools/harness/perf.mjs";

const ACTOR = "Actor.aaaaaaaaaaaaaaaa";

/** A small ledger: an order with a pledge, its commit and a work day; a requested order; a deposit; a pending pledge. */
function ledger() {
    const row = (kind, idem, fields) => ({ id: hashId(idem), v: 1, kind, idem, state: "applied", box: 0, purse: 0, alloc: 0, cp: 0, ...fields });
    const pledge = row("pledge", "pledge:order0000000001:a:n1", { order: "order0000000001", cp: 300, box: 300, purse: -300, alloc: 300, actor: ACTOR });
    const commit = row("commit", "commit:order0000000001:1", { order: "order0000000001", cp: 300 });
    const deposit = row("deposit", "deposit:fund:a:n2", { cp: 500, box: 500, purse: -500, alloc: 500, actor: ACTOR });
    const pending = row("pledge", "pledge:order0000000002:a:n3", { order: "order0000000002", cp: 10, box: 10, purse: -10, alloc: 10, state: "pending" });
    const day = { id: "aaaaaaaaaaaaaaaa-12", v: 1, actor: "aaaaaaaaaaaaaaaa", day: 12, toDay: 12, order: "order0000000001", kind: "setup" };
    return {
        flags: {
            orders: {
                order0000000001: { id: "order0000000001", v: 1, status: "setup", created: { real: 1 }, log: { 1: { seq: 1, event: "start", rows: [commit.id] } } },
                order0000000002: { id: "order0000000002", v: 1, status: "requested", created: { real: 2 }, log: {} },
                stub0000000000x1: { reversedBy: "x" },
            },
            rows: Object.fromEntries([pledge, commit, deposit, pending].map((r) => [r.id, r])),
            days: { [day.id]: day },
        },
        pages: [{ _id: pledge.id, name: pledge.id, flags: { "pf2e-artisans-workshop": { lock: pledge.id, order: "order0000000001" } } },
            { _id: deposit.id, name: deposit.id, flags: { "pf2e-artisans-workshop": { lock: deposit.id } } }],
        rows: { pledge, commit, deposit, pending },
    };
}

let counter = 0;
const newId = () => `new${String(++counter).padStart(13, "0")}`;

/** The copied rows of a plan (its `rows.<id>` keys). */
const copiedRowsOf = (plan) => Object.entries(plan.set).filter(([key]) => key.startsWith("rows.")).map(([, row]) => row);

test("copies of a ledger: as many orders as asked, each with its rows and work days under new ids", () => {
    const { flags, pages, rows } = ledger();
    const plan = cloneRecords(flags, { orders: 6, rows: 12, pages, newId, hashId });
    assert.equal(plan.counts.orders, 6);
    const orders = Object.entries(plan.set).filter(([key]) => key.startsWith("orders.")).map(([, o]) => o);
    assert.equal(orders.length, 4, "four copies beside the two live orders; the stub is not an order");
    assert.equal(new Set(orders.map((o) => o.id)).size, 4);
    for (const order of orders) assert.ok(!["order0000000001", "order0000000002"].includes(order.id));
    const copiedRows = Object.entries(plan.set).filter(([key]) => key.startsWith("rows.")).map(([key, r]) => [key, r]);
    for (const [key, row] of copiedRows) {
        assert.equal(key, `rows.${row.id}`);
        assert.equal(row.id, hashId(row.idem), "a row's id is the hash of its key");
        assert.match(row.idem, /:perf:\d+$/);
        assert.notEqual(row.state, "pending", "pending rows are never copied");
    }
    assert.equal(new Set(copiedRows.map(([, r]) => r.id)).size, copiedRows.length, "no two copies share an id");
    // The setup order was copied twice: each copy's rows and log point at the copy, not the original.
    const setups = orders.filter((o) => o.status === "setup");
    assert.equal(setups.length, 2);
    for (const order of setups) {
        const own = copiedRows.map(([, r]) => r).filter((r) => r.order === order.id);
        assert.deepEqual(own.map((r) => r.kind).sort(), ["commit", "pledge"]);
        assert.deepEqual(order.log[1].rows, [own.find((r) => r.kind === "commit").id]);
        assert.ok(own.every((r) => r.idem.includes(order.id) && !r.idem.includes("order0000000001")));
    }
    const days = Object.values(plan.set).filter((d) => d.day === 12);
    assert.equal(days.length, 2);
    for (const day of days) {
        assert.equal(isDayRecord(day), false, "a copied work day is not one of the PC's own day records");
        assert.ok(setups.some((o) => o.id === day.order));
    }
    assert.ok(!copiedRows.some(([, r]) => r.idem === rows.pending.idem));
});

test("copies of a ledger: party-fund rows fill up to the rows asked for, and the strongbox gets what the copies hold", () => {
    const { flags, pages } = ledger();
    const plan = cloneRecords(flags, { orders: 6, rows: 12, pages, newId, hashId });
    assert.ok(plan.counts.rows >= 12);
    const copied = copiedRowsOf(plan);
    const deposits = copied.filter((r) => r.kind === "deposit");
    assert.ok(deposits.length >= 1);
    assert.equal(plan.counts.rows, 4 + copied.length);
    assert.equal(plan.boxCp, copied.reduce((sum, r) => sum + r.box, 0));
    assert.equal(plan.boxCp, 2 * 300 + deposits.length * 500);
});

test("copies of a ledger: lock pages follow the rows that moved coins, under the copies' ids", () => {
    const { flags, pages } = ledger();
    const plan = cloneRecords(flags, { orders: 6, rows: 12, pages, newId, hashId });
    const rowIds = new Set(copiedRowsOf(plan).map((r) => r.id));
    assert.ok(plan.pages.length >= 2);
    for (const page of plan.pages) {
        assert.ok(rowIds.has(page._id), "a copied lock page is the copied row's");
        assert.equal(page.flags["pf2e-artisans-workshop"].lock, page._id);
        assert.notEqual(page.flags["pf2e-artisans-workshop"].order, "order0000000001");
    }
    assert.equal(plan.counts.pages, pages.length + plan.pages.length);
});

test("copies of a ledger: nothing to copy, nothing asked beyond what is there", () => {
    assert.deepEqual(cloneRecords({}, { orders: 10, rows: 10, newId, hashId }).counts, { orders: 0, rows: 0, days: 0, pages: 0 });
    const { flags } = ledger();
    const none = cloneRecords(flags, { orders: 1, rows: 1, newId, hashId });
    assert.deepEqual(none.set, {});
    assert.equal(none.boxCp, 0);
});

test("timings: median and 90th percentile of what was measured", () => {
    assert.deepEqual(stats([5, 1, 3, 2, 4]), { n: 5, min: 1, median: 3, p90: 5, max: 5 });
    assert.deepEqual(stats([10.04, NaN, 20]), { n: 2, min: 10, median: 10, p90: 20, max: 20 });
    assert.equal(stats([]).median, null);
});

test("a CPU profile's hotspots: self time by function and by file, idle left out", () => {
    const frame = (functionName, url, lineNumber = 0) => ({ functionName, url, lineNumber });
    const profile = {
        nodes: [
            { id: 1, callFrame: frame("(root)", "") },
            { id: 2, callFrame: frame("orderContext", "http://localhost:30000/modules/pf2e-artisans-workshop/scripts/ui/context.mjs", 51) },
            { id: 3, callFrame: frame("render", "http://localhost:30000/scripts/foundry.mjs", 9) },
            { id: 4, callFrame: frame("(idle)", "") },
        ],
        samples: [2, 2, 3, 4, 2],
        timeDeltas: [0, 1000, 1000, 1000, 5000],
    };
    const out = hotspots(profile);
    assert.equal(out.totalMs, 3, "the idle sample's time is left out");
    assert.deepEqual(out.functions[0], { name: "orderContext workshop:scripts/ui/context.mjs:52", ms: 2, pct: 66.7 });
    assert.equal(out.functions[1].name, "render foundry:foundry.mjs:10");
    assert.deepEqual(out.files.map((f) => f.name), ["workshop:scripts/ui", "foundry:foundry.mjs"]);
});

test("script URLs are labelled by owner", () => {
    assert.equal(shortUrl("http://localhost:30000/modules/pf2e-artisans-workshop/scripts/ui/workshop.mjs"), "workshop:scripts/ui/workshop.mjs");
    assert.equal(shortUrl("http://localhost:30000/systems/pf2e/pf2e.mjs?v=1"), "pf2e:pf2e.mjs");
    assert.equal(shortUrl("http://localhost:30000/modules/lib-wrapper/x.js"), "module:lib-wrapper/x.js");
    assert.equal(shortUrl(""), "(native)");
});

test("the three extra members are copies of fixture characters with generic names", () => {
    assert.equal(EXTRA.length, 3);
    for (const member of EXTRA) {
        assert.ok(FIXTURES.some((f) => f.id === member.fixture && !f.npc), member.fixture);
        assert.doesNotMatch(member.name, /fixture|\d|:/i);
    }
});
