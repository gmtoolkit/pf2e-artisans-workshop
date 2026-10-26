/** View models of the Workshop window (DESIGN.md 10.3, 10.1): pure, from plain records. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE } from "../../scripts/logic/core.mjs";
import { makeOrder } from "../../scripts/logic/orders.mjs";
import { makeRow, reversalRow } from "../../scripts/logic/rows.mjs";
import {
    DEFAULT_FILTERS, blockers, canReverse, coinParts, estimateOf, fundWithdrawableCp, fundsView, orderProgress, orderView,
    passesFilters, percent, perDayCp, queueOrder, queueSummary,
} from "../../scripts/logic/views.mjs";

const at = (real) => ({ world: real, real, server: real, launch: 0 });
const stamp = (real = 1, by = "u1") => ({ by, at: at(real) });
const product = (priceCp = 6500, fields = {}) => ({ uuid: "U", snapshot: { name: "Striking Rune", img: "r.webp", level: 4, rarity: "common", traits: [], priceCp, per: 1, ...fields } });
const order = (fields = {}, real = 1) => ({ ...makeOrder({ id: fields.id ?? "o1", requester: "Actor.r", recipient: { kind: "actor", uuid: "Actor.f" }, product: product(), quantity: 1 }, stamp(real)), ...fields });
const row = (kind, cp, fields = {}, real = 1, by = "u1") => ({ ...makeRow({ kind, idem: `${kind}:${fields.actor ?? "x"}:${real}`, cp, order: "o1", ...fields }, stamp(real, by)), state: "applied" });
const viewer = (fields = {}) => ({ userId: "u1", isGM: false, owns: () => false, hasCharacter: true, ...fields });
const nameOf = (uuid) => (uuid ? uuid.replace("Actor.", "") : null);

test("money reads as gold, silver and copper (10.3)", () => {
    assert.deepEqual(coinParts(104530), [{ unit: "gp", n: 1045 }, { unit: "sp", n: 3 }]);
    assert.deepEqual(coinParts(1450), [{ unit: "gp", n: 14 }, { unit: "sp", n: 5 }]);
    assert.deepEqual(coinParts(0), [{ unit: "gp", n: 0 }]);
    assert.deepEqual(coinParts(7), [{ unit: "cp", n: 7 }]);
    assert.deepEqual(coinParts(-250), [{ unit: "gp", n: -2 }, { unit: "sp", n: 5 }]);
    assert.throws(() => coinParts(1.5), RangeError);
    assert.equal(percent(1, 3), 33);
    assert.equal(percent(5, 0), 100);
    assert.equal(percent(9, 4), 100);
});

test("before start the bar shows escrow against the up-front half, from the snapshot", () => {
    assert.deepEqual(estimateOf(order()), { priceCp: 6500, upfrontCp: 3250, frozen: false });
    assert.deepEqual(estimateOf({ ...order(), quantity: 4, product: product(25, { per: 10 }) }), { priceCp: 10, upfrontCp: 5, frozen: false });
    const p = orderProgress(order(), { rows: [row("pledge", 1625, { actor: "Actor.a" })] });
    assert.deepEqual([p.phase, p.pct, p.escrowCp, p.upfrontCp, p.remainingCp], ["funding", 50, 1625, 3250, 1625]);
    assert.deepEqual(p.segments, [{ kind: "escrow", pct: 50 }, { kind: "empty", pct: 50 }]);
});

test("after start the bar is up-front paid, reduction earned, and what is left: the wireframe's 78% (10.3)", () => {
    // A 4th-level 65 gp rune by a 10th-level master: 600 cp a day, three extra days.
    const check = { degree: DEGREE.success, level: 10, rank: 3, settled: true, attempt: 1 };
    const o = order({ status: "finishing", attempt: 1, priceCp: 6500, upfrontCp: 3250, check, settlement: { attempt: 1, check, status: "finishing" } });
    const days = [1, 2, 3].map((day) => ({ order: "o1", attempt: 1, kind: "extra", actor: "c", day, crafterCp: 600, helpers: {} }));
    const p = orderProgress(o, { days });
    assert.deepEqual([p.phase, p.paidCp, p.earnedCp, p.remainingCp, p.pct], ["crafting", 3250, 1800, 1450, 78]);
    assert.deepEqual(p.segments.map((s) => s.kind), ["paid", "earned", "empty"]);
    assert.equal(p.segments.reduce((sum, s) => sum + s.pct, 0), 100);
    assert.equal(perDayCp(o, { level: 10, rank: 3 }), 600);
    const view = orderView(o, { days, crafterToday: { level: 10, rank: 3 }, viewer: viewer(), nameOf, no: 12 });
    assert.deepEqual([view.extraDays, view.daysToZero, view.finishCp, view.no], [3, 3, 1450, 12], "day 3 of at most 6");
    const done = orderProgress({ ...o, status: "complete" }, { days });
    assert.deepEqual([done.phase, done.pct], ["done", 100]);
});

test("an extra day is estimated at a success before the check, and none without a crafter", () => {
    assert.equal(perDayCp(order({ status: "accepted" }), { level: 5, rank: 2 }), 100);
    assert.equal(perDayCp(order(), null), null);
    assert.equal(perDayCp(order({ check: { degree: DEGREE.critSuccess, level: 5, rank: 2 } }), { level: 5, rank: 2 }), 200);
});

test("an order view: blockers from the gates, contributors, a gift hidden from its recipient, and the viewer's actions", () => {
    const gates = [{ id: "G1", ok: true }, { id: "G7", ok: false, reason: "tool", data: { tool: "alchemists-lab" }, unlock: "tool" }];
    const accepted = order({ status: "accepted", crafter: "Actor.c" });
    const rows = [row("pledge", 1000, { actor: "Actor.a" }, 1), row("pledge", 500, { actor: "Actor.b" }, 2)];
    const v = orderView(accepted, { rows, gates, viewer: viewer({ owns: (u) => u === "Actor.a" }), nameOf });
    assert.deepEqual(v.blocked, [{ id: "G7", reason: "tool", data: { tool: "alchemists-lab" }, unlock: "tool" }]);
    assert.deepEqual(v.contributors.map((c) => [c.name, c.cp, c.mine]), [["a", 1000, true], ["b", 500, false]]);
    assert.equal(v.mine, true);
    assert.equal(v.withdrawableCp, 1000);
    assert.equal(v.actions.withdraw, true);
    assert.equal(v.actions.start, false, "not the crafter's owner");
    assert.deepEqual(blockers(gates).map((b) => b.id), ["G7"]);
    const gift = { ...accepted, visibility: "gift" };
    const recipient = orderView(gift, { viewer: viewer({ owns: (u) => u === "Actor.f" }), nameOf });
    assert.deepEqual([recipient.giftHidden, recipient.name, recipient.img], [true, null, null]);
    assert.equal(orderView(gift, { viewer: viewer({ owns: (u) => u === "Actor.f" || u === "Actor.r" }), nameOf }).giftHidden, false, "the giver sees it");
    assert.equal(orderView(gift, { viewer: viewer({ isGM: true, owns: () => true }), nameOf }).giftHidden, false);
    const gm = orderView(accepted, { viewer: viewer({ isGM: true, owns: () => true, isMine: () => false }), nameOf });
    assert.equal(gm.mine, false, "a GM's own orders are the ones of their own characters");
});

test("queue filters, order and numbering (10.3)", () => {
    const a = order({ id: "a", status: "requested" }, 1);
    const b = order({ id: "b", status: "complete", crafter: "Actor.c" }, 2);
    const c = order({ id: "c", status: "accepted", crafter: "Actor.c", recipient: { kind: "strongbox", uuid: null } }, 3);
    assert.deepEqual(queueOrder([b, c, a]).map(({ order: o, no }) => [o.id, no]), [["a", 1], ["c", 3], ["b", 2]]);
    const view = (o, fields = {}) => ({ mine: false, closed: ["complete", "cancelled"].includes(o.status), blocked: [], name: "Striking Rune", ...fields });
    assert.equal(passesFilters(view(a), a, DEFAULT_FILTERS), true);
    assert.equal(passesFilters(view(b), b, { scope: "open" }), false);
    assert.equal(passesFilters(view(a), a, { scope: "mine" }), false);
    assert.equal(passesFilters(view(c, { blocked: [{ id: "G7" }] }), c, { scope: "blocked" }), true);
    assert.equal(passesFilters(view(a), a, { crafter: "none" }), true);
    assert.equal(passesFilters(view(c), c, { crafter: "Actor.c" }), true);
    assert.equal(passesFilters(view(a), a, { crafter: "Actor.c" }), false);
    assert.equal(passesFilters(view(c), c, { recipient: "strongbox" }), true);
    assert.equal(passesFilters(view(a), a, { recipient: "Actor.f" }), true);
    assert.equal(passesFilters(view(a), a, { status: "requested", search: "strik" }), true);
    assert.equal(passesFilters(view(a), a, { search: "elixir" }), false);
    assert.deepEqual(queueSummary([a, b, c]), { open: 2, requested: 1, accepted: 1, working: 0, failed: 0, complete: 1 });
});

test("reversal: financial rows that count, by their author or a GM, while the coins can move back (4.6)", () => {
    const orders = { o1: order({ status: "setup", attempt: 1 }) };
    const pledge = row("pledge", 600, { actor: "Actor.a" }, 1, "u1");
    const commit = row("commit", 500, {}, 2);
    const mine = viewer({ owns: (u) => u === "Actor.a" });
    assert.equal(canReverse(pledge, [pledge], mine, orders), true);
    assert.equal(canReverse(pledge, [pledge, commit], mine, orders), false, "the crafter is using it");
    assert.equal(canReverse(pledge, [pledge], viewer({ userId: "u2", owns: (u) => u === "Actor.a" }), orders), false, "not its author");
    assert.equal(canReverse(pledge, [pledge], viewer({ isGM: true, userId: "gm", owns: () => true }), orders), true);
    assert.equal(canReverse(pledge, [pledge], viewer(), orders), false, "the purse is not the reverser's to write");
    assert.equal(canReverse(commit, [commit], mine, orders), false, "state-coupled rows are undone with their transition");
    const reversal = { ...reversalRow(pledge, stamp(3)), state: "applied" };
    assert.equal(canReverse(pledge, [pledge, reversal], mine, orders), false, "already reversed");
    assert.equal(canReverse(pledge, [pledge], mine, { o1: { ...orders.o1, status: "cancelled" } }), false);
    const deposit = row("deposit", 300, { actor: "Actor.a", order: null }, 4);
    const other = row("deposit", 200, { actor: "Actor.b", order: null }, 5);
    assert.equal(canReverse(deposit, [deposit, other], mine), true);
    assert.equal(canReverse(deposit, [deposit, other, row("withdraw", 200, { actor: "Actor.b", order: null }, 8), row("withdraw", 200, { actor: "Actor.c", order: null }, 9)], mine), false,
        "the fund no longer holds it");
    assert.equal(canReverse({ ...deposit, cp: 300 }, [deposit, row("withdraw", 250, { actor: "Actor.a", order: null }, 6)], mine), false);
    assert.equal(canReverse(row("adjust", 0, { signed: { box: 10, purse: 0, alloc: 10 }, order: null }, 7), [], mine), false, "a GM's only");
});

test("the Funds view: coins, fund, escrow, members and the ledger newest first (10.1)", () => {
    const orders = { o1: order({ status: "accepted" }), o2: order({ id: "o2", status: "complete" }) };
    const rows = [
        row("pledge", 600, { actor: "Actor.a" }, 1, "u1"),
        row("deposit", 400, { actor: "Actor.b", order: null }, 2, "u2"),
        row("pledge", 100, { actor: "Actor.b", order: "o2" }, 3, "u2"),
    ];
    const v = fundsView({ rows, actualCp: 1150, orders, viewer: viewer({ owns: (u) => u === "Actor.a" }), nameOf, userName: (id) => id.toUpperCase() });
    assert.deepEqual([v.expectedCp, v.differenceCp, v.fundCp, v.escrowCp], [1100, 50, 400, 600], "a complete order's escrow is not counted");
    assert.deepEqual(v.members.map((m) => [m.name, m.cp, m.mine]), [["a", 600, true], ["b", 500, false]]);
    assert.deepEqual(v.ledger.map((r) => [r.kind, r.author, r.mine]), [["pledge", "U2", false], ["deposit", "U2", false], ["pledge", "U1", true]]);
    assert.equal(v.ledger[2].canReverse, true);
    assert.equal(fundWithdrawableCp(rows, "Actor.b"), 400);
    assert.equal(fundWithdrawableCp(rows, "Actor.a"), 0);
});
