/** View models of the Workshop window (DESIGN.md 10.3, 10.1): pure, from plain records. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE } from "../../scripts/logic/core.mjs";
import { makeOrder } from "../../scripts/logic/orders.mjs";
import { makeRow, reversalRow } from "../../scripts/logic/rows.mjs";
import { earmarkInputs } from "../../scripts/logic/funds.mjs";
import {
    DEFAULT_FILTERS, blockers, canReverse, coinParts, costSummary, deliveryOf, estimateOf, fundWithdrawableCp, fundsView, orderProgress,
    orderView, passesEverything, passesFilters, percent, perDayCp, queueOrder, queueSummary, requirementVariant, requirementsView, rowLabel, workDaysView,
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

test("filters that let every order through: the Queue then views only the orders it lists (M12 performance pass)", () => {
    assert.equal(passesEverything(DEFAULT_FILTERS), true);
    assert.equal(passesEverything({}), true);
    assert.equal(passesEverything({ ...DEFAULT_FILTERS, search: "   " }), true, "blank search text filters nothing, as in passesFilters");
    for (const narrowing of [{ scope: "mine" }, { scope: "open" }, { scope: "blocked" }, { status: "complete" }, { crafter: "none" },
        { crafter: "Actor.c" }, { recipient: "strongbox" }, { recipient: "Actor.f" }, { search: "rune" }]) {
        assert.equal(passesEverything({ ...DEFAULT_FILTERS, ...narrowing }), false, JSON.stringify(narrowing));
    }
    // Wherever passesEverything holds, passesFilters lets any view through.
    const odd = order({ id: "z", status: "cancelled", crafter: "Actor.q", recipient: { kind: "strongbox", uuid: null } }, 9);
    const view = { mine: false, closed: true, blocked: [{ id: "G1" }], name: "" };
    assert.equal(passesFilters(view, odd, { ...DEFAULT_FILTERS, search: "  " }), true);
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
    assert.deepEqual([v.expectedCp, v.differenceCp, v.fundCp, v.accounts.earmarkedCp], [1100, 50, 400, 700],
        "a complete order still holding money counts as earmarked until its refunds are collected");
    assert.deepEqual(v.members.map((m) => [m.name, m.cp, m.mine]), [["a", 600, true], ["b", 500, false]]);
    assert.deepEqual(v.ledger.map((r) => [r.kind, r.author, r.mine]), [["pledge", "U2", false], ["deposit", "U2", false], ["pledge", "U1", true]]);
    assert.equal(v.ledger[2].canReverse, true);
    assert.equal(fundWithdrawableCp(rows, "Actor.b"), 400);
    assert.equal(fundWithdrawableCp(rows, "Actor.a"), 0);
});

test("requirements in plain words: met ones counted, unmet ones with the action that meets them (C, M4.1)", () => {
    const gates = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G9", "G10", "G11", "G12"].map((id) => ({ id, ok: true, reason: null, data: null }));
    gates.splice(7, 0, { id: "G8", ok: false, reason: "underfunded", data: { shortCp: 1714 }, unlock: "fund" });
    const r = requirementsView(gates);
    assert.deepEqual([r.total, r.met, r.allMet], [12, 11, false]);
    assert.deepEqual(r.unmet, [{ id: "G8", ok: false, reason: "underfunded", data: { shortCp: 1714 }, action: "fund", variant: null }]);
    assert.equal(r.metList.length, 11);
    assert.equal(requirementsView([{ id: "G7", ok: false, reason: "tool", data: { tool: "alchemists-lab" } }]).unmet[0].action, null, "no Workshop action fetches a tool");
    // M5 on M4.1: precious stock, castings and an item to hand over each have their fix.
    const fix = (gate) => requirementsView([{ ok: false, data: {}, ...gate }]).unmet[0].action;
    assert.deepEqual([fix({ id: "G8", reason: "precious" }), fix({ id: "G9", reason: "spells" }), fix({ id: "G9", reason: "checklist" }),
        fix({ id: "G10", reason: "target-not-held" }), fix({ id: "G10", reason: "no-consent" })], ["stock", "castings", null, "hand-over", "consent"],
    "M9: the subject agrees from the Queue (6.14)");
    assert.equal(fix({ id: "G12", reason: "fulu-tradition" }), "tradition", "M9: the crafter chooses a fulu's tradition");
    assert.deepEqual([requirementsView([]).total, requirementsView([]).allMet], [0, true]);
    const accepted = order({ status: "accepted", crafter: "Actor.c" });
    assert.equal(orderView(accepted, { gates, viewer: viewer(), nameOf }).requirements.met, 11, "an accepted order's view carries them");
    assert.equal(orderView(order(), { gates, viewer: viewer(), nameOf }).requirements, null, "a requested order has no crafter's gates");
});

/** A 65 gp rune by a 5th-level expert: 1 gp a day after a success (Player Core p.237's numbers). */
const started = (fields = {}) => {
    const check = { degree: DEGREE.success, level: 5, rank: 2, settled: true, attempt: 1 };
    return order({ status: "finishing", crafter: "Actor.c", attempt: 1, priceCp: 6500, upfrontCp: 3250, setup: { days: 2, hours: 0 }, check, ...fields });
};
const dayRecord = (kind, day, fields = {}) => ({ order: "o1", attempt: 1, kind, actor: "c", day, crafterCp: 100, helpers: {}, ...fields });

test("work days: each setup day, then each extra day with what it took off, never below nothing left (D, M4.1)", () => {
    const days = [dayRecord("setup", 1), dayRecord("setup", 2), dayRecord("extra", 4), dayRecord("extra", 3), dayRecord("extra", 9, { attempt: 0 })];
    assert.deepEqual(workDaysView(started(), days), [
        { kind: "setup", n: 1, of: 2, day: 1 }, { kind: "setup", n: 2, of: 2, day: 2 },
        { kind: "extra", n: 3, day: 3, cp: 100, counted: true }, { kind: "extra", n: 4, day: 4, cp: 100, counted: true },
    ], "in day order, numbered after the setup; another attempt's day is not this one's");
    const rolled = started({ status: "rolled", check: { ...started().check, settled: false } });
    assert.deepEqual(workDaysView(rolled, days).filter((d) => d.kind === "extra").map((d) => [d.cp, d.counted]), [[0, false], [0, false]],
        "a day counts once the check settles as a success");
    const nearly = started({ priceCp: 3400, upfrontCp: 3250 });
    assert.deepEqual(workDaysView(nearly, [dayRecord("extra", 3), dayRecord("extra", 4)]).map((d) => d.cp), [100, 50],
        "the second day takes off only the 50 cp that was left");
    assert.deepEqual(workDaysView(order({ attempt: 2 }), days), [], "another attempt's days are not this one's");
});

test("what a finished order cost: up front, work days, at the finish, and in all (D, M4.1)", () => {
    const days = [3, 4, 5].map((day) => dayRecord("extra", day));
    const rows = [
        row("expend", 3250, { actor: null }, 1), row("remainder", 2950, { actor: null }, 2),
        row("ruin", 325, { actor: "Actor.a" }, 3), row("shelved", 0, {}, 4),
    ];
    const cost = costSummary(started({ status: "complete" }), rows, days);
    assert.deepEqual(cost, { upfrontCp: 3250, ruinedCp: 325, workDays: 3, workCp: 300, finishCp: 2950, stockCp: 0, purchasesCp: 0, totalCp: 6525 });
    assert.equal(cost.upfrontCp + cost.workCp + cost.finishCp, 6500, "up front + the work days + the finish = the Price");
    const v = orderView(started({ status: "complete" }), { rows, days, viewer: viewer(), nameOf });
    assert.deepEqual([v.cost.totalCp, v.workDays.length], [6525, 3]);
    assert.equal(orderView(started(), { rows, days, viewer: viewer(), nameOf }).cost, null, "only once complete");
});

test("requirements go by the name the order's kind gives them (M5 on M4.1)", () => {
    const names = (fields) => requirementsView(["G9", "G10", "G12"].map((id) => ({ id, ok: true })), order(fields)).metList.map((g) => g.variant);
    assert.deepEqual(names({}), [null, null, null], "a plain Craft");
    assert.deepEqual(names({ craftType: "spell-item" }), ["spells", null, null]);
    assert.deepEqual(names({ craftType: "rune-etch", target: "Actor.a.Item.s" }), [null, "target", "rune"]);
    assert.deepEqual(names({ craftType: "upgrade", target: "Actor.a.Item.s" }), [null, "target", "upgrade"]);
    assert.deepEqual(names({ product: { type: "formula", uuid: "C.x", snapshot: {} } }), [null, "possession", null]);
    assert.equal(requirementVariant("G1", order({ craftType: "spell-item" })), null);
});

test("what a finished order cost counts the stock it used and what was bought for it (M5 on M4.1)", () => {
    const days = [3, 4, 5].map((day) => dayRecord("extra", day));
    const rows = [
        row("expend", 1250, { actor: null }, 1), row("remainder", 2950, { actor: null }, 2),
        row("purchase", 300, { actor: "Actor.a", how: { via: "purse" } }, 3),
    ];
    const materials = { l1: { id: "l1", valueCp: 2000, used: { at: {} } }, l2: { id: "l2", valueCp: 500, returned: { at: {} } } };
    const cost = costSummary(started({ status: "complete", materials }), rows, days);
    assert.deepEqual([cost.upfrontCp, cost.stockCp, cost.purchasesCp, cost.totalCp], [1250, 2000, 300, 6500]);
    assert.equal(cost.upfrontCp + cost.stockCp + cost.workCp + cost.finishCp, 6500, "coins and stock up front + the work days + the finish = the Price");
});

test("where a finished item went: delivered, arriving, on the shelf, or kept in the strongbox (E, M4.1)", () => {
    const done = started({ status: "complete", recipient: { kind: "actor", uuid: "Actor.f" } });
    assert.deepEqual(deliveryOf(done, [], 1), { state: "shelf", to: "Actor.f" });
    assert.deepEqual(deliveryOf(done, [], 0), { state: "arriving", to: "Actor.f" }, "the shelf item is not here yet");
    const delivered = row("delivered", 0, { actor: "Actor.f" }, 5);
    assert.deepEqual(deliveryOf(done, [delivered], 0), { state: "delivered", to: "Actor.f" });
    assert.deepEqual(deliveryOf(done, [{ ...delivered, state: "pending" }], 1), { state: "arriving", to: "Actor.f" }, "a delivery under way");
    assert.deepEqual(deliveryOf({ ...done, recipient: { kind: "strongbox", uuid: null } }, [], 0), { state: "strongbox", to: null });
    assert.equal(deliveryOf(started(), [], 1), null, "not before it is complete");
    assert.deepEqual(orderView(done, { rows: [delivered], viewer: viewer(), nameOf }).delivery.state, "delivered");
    assert.deepEqual(orderView(done, { viewer: viewer(), nameOf, shelfCount: 1 }).delivery.state, "shelf");
});

test("a rushed finish that ruined the item makes nothing, and says so rather than \"on its way\" (M9a live pass)", () => {
    const ruined = started({ status: "complete", recipient: { kind: "actor", uuid: "Actor.f" },
        check: { degree: 2, settled: true, rushFlat: { attempt: 1, dc: 4, die: 1, degree: 0, outcome: "ruined" } } });
    assert.deepEqual(deliveryOf(ruined, [], 0), { state: "ruined", to: null });
    for (const outcome of ["fine", "quirk", "cursed"]) {
        const made = { ...ruined, check: { ...ruined.check, rushFlat: { ...ruined.check.rushFlat, outcome } } };
        assert.deepEqual(deliveryOf(made, [], 1), { state: "shelf", to: "Actor.f" }, outcome);
    }
});

test("an order view says what it still needs and who may give the party fund's share back (A, M4.1)", () => {
    const rows = [...earmarkInputs({ orderId: "o1", cp: 1000, nonce: "n" }).map((input, i) => ({ ...makeRow(input, stamp(i + 1)), state: "applied" })),
        row("pledge", 500, { actor: "Actor.a" }, 5)];
    const v = orderView(order({ status: "accepted", crafter: "Actor.c" }), { rows: rows.filter((r) => r.order === "o1"), viewer: viewer(), nameOf });
    assert.deepEqual(v.shortfall, { phase: "upfront", needCp: 3250, holdsCp: 1500, shortCp: 1750 });
    assert.deepEqual([v.fundReturnableCp, v.actions.returnToFund, v.actions.fund], [1000, true, true]);
    assert.deepEqual(v.contributors.map((c) => [c.actor, c.cp]), [[null, 1000], ["Actor.a", 500]]);
    const bystander = orderView(order({ status: "accepted" }), { rows: rows.filter((r) => r.order === "o1"), viewer: viewer({ hasCharacter: false }), nameOf });
    assert.deepEqual([bystander.actions.returnToFund, bystander.actions.fund], [false, false], "only members with a character");
});

test("the Funds ledger names an allocation by its direction and lists one row of each pair (M4.1)", () => {
    const [fundSide, orderSide] = earmarkInputs({ orderId: "o1", cp: 1000, nonce: "n" }).map((input, i) => ({ ...makeRow(input, stamp(2 + i)), state: "applied" }));
    const [backFund, backOrder] = earmarkInputs({ orderId: "o1", cp: 200, nonce: "m", back: true }).map((input, i) => ({ ...makeRow(input, stamp(4 + i)), state: "applied" }));
    assert.deepEqual([rowLabel(fundSide).mirror, rowLabel(orderSide).code, rowLabel(backOrder).code, rowLabel(backFund).mirror], [true, "earmark", "unearmark", true]);
    assert.deepEqual(rowLabel(row("shelved", 0, { actor: null }, 1)), { code: "kept", mirror: false, items: true }, "an order for the strongbox keeps its item");
    assert.deepEqual(rowLabel(row("shelved", 0, { actor: "Actor.f" }, 1)).code, "shelved");
    assert.equal(rowLabel(row("delivered", 0, { actor: "Actor.f" }, 1)).items, true);
    const deposit = row("deposit", 1000, { actor: "Actor.b", order: null }, 1, "u2");
    const rows = [deposit, fundSide, orderSide, backFund, backOrder];
    const v = fundsView({ rows, actualCp: 1000, orders: { o1: order({ status: "accepted" }) }, viewer: viewer(), nameOf, userName: (id) => id });
    assert.deepEqual(v.ledger.map((r) => r.code), ["unearmark", "earmark", "deposit"], "newest first, the fund's mirror rows left out");
    assert.equal(v.total, 3);
    assert.deepEqual([v.accounts.unallocatedCp, v.accounts.earmarkedCp, v.accounts.balanced, v.fundCp], [200, 800, true, 200]);
});

test("member balances split a member's party fund share as the fund is split: unallocated, and earmarked for orders (review fix)", () => {
    const deposit = row("deposit", 1800, { actor: "Actor.bo", order: null }, 1, "u2");
    const earmark = earmarkInputs({ orderId: "o1", cp: 200, nonce: "e" }).map((input) => ({ ...makeRow(input, stamp(2, "u2")), state: "applied" }));
    const v = fundsView({ rows: [deposit, ...earmark], actualCp: 1800, orders: { o1: order({ status: "accepted" }) }, viewer: viewer(), nameOf,
        userName: (id) => id });
    assert.deepEqual([v.accounts.unallocatedCp, v.accounts.earmarkedCp], [1600, 200]);
    assert.deepEqual(v.members.map((m) => [m.name, m.ownCp, m.fundUnallocatedCp, m.fundEarmarkedCp, m.cp]), [["bo", 0, 1600, 200, 1800]],
        "the 2 gp the fund earmarked is no longer unallocated, in the table as on the cards");
    // Two depositors and a pledge from a purse: each share split pro rata, never below zero, adding up to the cards.
    const more = [row("deposit", 600, { actor: "Actor.cy", order: null }, 3, "u3"), row("pledge", 100, { actor: "Actor.cy" }, 4, "u3")];
    const w = fundsView({ rows: [deposit, ...earmark, ...more], actualCp: 2500, orders: { o1: order({ status: "accepted" }) }, viewer: viewer(),
        nameOf, userName: (id) => id });
    assert.deepEqual(w.members.map((m) => [m.name, m.ownCp, m.fundUnallocatedCp, m.fundEarmarkedCp, m.cp]),
        [["bo", 0, 1650, 150, 1800], ["cy", 100, 550, 50, 700]]);
    assert.equal(w.members.reduce((sum, m) => sum + m.fundUnallocatedCp, 0), w.accounts.unallocatedCp);
});

/* -------------------------------------------- */
/*  M5 on M4.1: review fixes                     */
/* -------------------------------------------- */

test("before start an order is measured against the plan it would freeze, as G8 judges it, not the item's Price (M5 on M4.1)", () => {
    // A rune upgraded in its slot costs the difference of the two Prices: 60 gp, 30 gp up front, not half of 65 gp.
    const accepted = order({ status: "accepted", crafter: "Actor.c", craftType: "rune-etch", target: "Actor.c.Item.s" });
    const plan = { priceCp: 6000, upfrontCp: 3000 };
    assert.deepEqual(estimateOf(accepted, plan), { priceCp: 6000, upfrontCp: 3000, frozen: false });
    assert.deepEqual(estimateOf(accepted), { priceCp: 6500, upfrontCp: 3250, frozen: false }, "with no plan, the snapshot's Price");
    assert.deepEqual(estimateOf({ ...accepted, priceCp: 100, upfrontCp: 50 }, plan), { priceCp: 100, upfrontCp: 50, frozen: true }, "a frozen plan wins");
    assert.deepEqual(estimateOf(accepted, { priceCp: null, upfrontCp: 1 }).priceCp, 6500, "a plan that is not whole copper is ignored");
    const rows = [row("pledge", 1000, { actor: "Actor.a" }, 1)];
    const v = orderView(accepted, { rows, viewer: viewer(), nameOf, plan });
    assert.deepEqual([v.progress.upfrontCp, v.progress.priceCp, v.progress.remainingCp], [3000, 6000, 2000]);
    assert.deepEqual(v.shortfall, { phase: "upfront", needCp: 3000, holdsCp: 1000, shortCp: 2000 });
    // A rune moved off its own runestone is free (GM Core p.225): nothing up front, nothing short.
    const free = orderView(order({ status: "accepted", crafter: "Actor.c", craftType: "rune-transfer", target: "Actor.c.Item.s" }),
        { viewer: viewer(), nameOf, plan: { priceCp: 0, upfrontCp: 0 } });
    assert.deepEqual([free.shortfall.shortCp, free.progress.pct], [0, 100]);
});

test("a finished formula job goes into a book and an item changed where it was never arrives (M5 on M4.1)", () => {
    const formula = started({ status: "complete", recipient: { kind: "actor", uuid: "Actor.f" }, product: { type: "formula", uuid: "U", snapshot: {} } });
    assert.deepEqual(deliveryOf(formula, [], 0), { state: "book", to: "Actor.f" }, "a formula claim, no shelf item");
    const inPlace = row("shelved", 0, { actor: "Actor.c", items: [{ uuid: "U", name: "Longsword", qty: 1, inPlace: true }] }, 5);
    const etched = started({ status: "complete", craftType: "rune-etch", recipient: { kind: "actor", uuid: "Actor.c" } });
    assert.deepEqual(deliveryOf(etched, [inPlace], 0), { state: "in-place", to: "Actor.c" });
    assert.deepEqual(rowLabel(inPlace), { code: "in-place", mirror: false, items: true }, "the ledger does not say it went on the shelf");
    const shelved = row("shelved", 0, { actor: "Actor.c", items: [{ uuid: "U", name: "Longsword", qty: 1 }] }, 5);
    assert.deepEqual([deliveryOf(etched, [shelved], 1).state, rowLabel(shelved).code], ["shelf", "shelved"], "handed over, it goes on the shelf");
    assert.equal(deliveryOf(etched, [{ ...inPlace, reversedBy: "r" }], 1).state, "shelf", "a reversed row counts for nothing");
    for (const kind of ["material-in", "material-out", "custody-in", "custody-out"]) {
        assert.equal(rowLabel(row(kind, 0, { actor: "Actor.b" }, 1)).items, true, `${kind} moves items, not money: no "0 gp" beside it`);
    }
    assert.equal(rowLabel(row("purchase", 300, { actor: "Actor.b", how: { via: "purse" } }, 1)).items, false);
});
