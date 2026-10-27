/**
 * Fund accounting (DESIGN.md 4.6, 4.7, As built in M4.1): the unallocated party fund and money earmarked per order by
 * source, the identity the Funds tab states, the fund slot that keeps two members from spending the same unallocated
 * money, funding and giving back by source, what an order still needs ("Fill the shortfall"), and money typed as coins.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE } from "../../scripts/logic/core.mjs";
import {
    SPEND_KINDS, checkAmount, coinFields, earmarkInputs, estimateOf, fieldsToCp, fundAccounts, fundSlotLockId, purchaseInputs, returnSlotLockId,
    shortfallOf, spentBySource, stockBySource, unallocatedCp,
} from "../../scripts/logic/funds.mjs";
import { hashId } from "../../scripts/logic/ids.mjs";
import { leftAfterSpend, makeOrder, refundClaims, withdrawableCp } from "../../scripts/logic/orders.mjs";
import { expectedBoxCp, makeRow, reversalRow } from "../../scripts/logic/rows.mjs";
import { allocationsByContributor, splitProRata } from "../../scripts/logic/split.mjs";

const at = (real) => ({ world: real, real, server: real, launch: 0 });
const stamp = (real = 1, by = "u1") => ({ by, at: at(real) });
const applied = (input, real = 1, by = "u1") => ({ ...makeRow(input, stamp(real, by)), state: "applied" });
const product = (priceCp = 3500) => ({ uuid: "U", snapshot: { name: "Elixir", img: "e.webp", level: 1, rarity: "common", traits: [], priceCp, per: 1 } });
const order = (fields = {}) => ({ ...makeOrder({ id: fields.id ?? "o1", requester: "Actor.r", recipient: { kind: "actor", uuid: "Actor.r" },
    product: product(), quantity: 1 }, stamp(fields.real ?? 1)), ...fields });

/** An order's own rows: the fund's side of an allocation belongs to the fund, not the order. */
const orderRowsOf = (rows, id = "o1") => rows.filter((row) => row.order === id);

/** Bo adds 18 gp to the party fund; the party earmarks all of it for o1; Cy pledges 5 gp from her purse to o1. */
function ledger() {
    return [
        applied({ kind: "deposit", idem: "deposit:fund:Actor.bo:n1", cp: 1800, actor: "Actor.bo" }, 1),
        ...earmarkInputs({ orderId: "o1", cp: 1800, nonce: "n2" }).map((input) => applied(input, 2)),
        applied({ kind: "pledge", idem: "pledge:o1:Actor.cy:n3", cp: 500, actor: "Actor.cy", order: "o1" }, 3),
    ];
}

test("earmarking from the party fund is two allocation rows from the fund itself: no coins move", () => {
    const [fund, side] = earmarkInputs({ orderId: "o1", cp: 1800, nonce: "n2" }).map((input) => makeRow(input, stamp()));
    assert.deepEqual([fund.kind, fund.box, fund.purse, fund.alloc, fund.order, fund.actor], ["allocate", 0, 0, -1800, null, null]);
    assert.deepEqual([side.kind, side.box, side.purse, side.alloc, side.order, side.actor], ["allocate", 0, 0, 1800, "o1", null]);
    assert.equal(fund.idem, "earmark:o1:n2:fund", "keyed by the confirmation's nonce, so a retried click is the same rows");
    const [back, backSide] = earmarkInputs({ orderId: "o1", cp: 300, nonce: "n9", back: true }).map((input) => makeRow(input, stamp()));
    assert.deepEqual([back.alloc, backSide.alloc, back.idem], [300, -300, "unearmark:o1:n9:fund"]);
    assert.throws(() => earmarkInputs({ orderId: "o1", cp: -1, nonce: "n" }), RangeError);
});

test("the Funds tab's accounts: unallocated, earmarked per order by source, and the strongbox identity", () => {
    const rows = ledger();
    const accounts = fundAccounts(rows, { o1: order({ status: "accepted" }) });
    assert.equal(unallocatedCp(rows), 0, "the 18 gp went to the order");
    assert.deepEqual([accounts.expectedCp, accounts.unallocatedCp, accounts.earmarkedCp, accounts.spentCp], [2300, 0, 2300, 0]);
    assert.equal(accounts.balanced, true, "strongbox = unallocated + earmarked");
    assert.deepEqual(accounts.orders.map((o) => [o.id, o.open, o.earmarkedCp]), [["o1", true, 2300]]);
    assert.deepEqual(accounts.orders[0].earmarked, [{ actor: null, cp: 1800 }, { actor: "Actor.cy", cp: 500 }], "the party fund first, then Cy");
    assert.equal(expectedBoxCp(rows), accounts.unallocatedCp + accounts.earmarkedCp);
});

test("spending deducts each source's share of the earmarked money, and the identity still holds", () => {
    const rows = ledger();
    // Settling a success expends the up-front half (1750) pro rata over what each source has earmarked (4.6).
    const shares = splitProRata(1750, allocationsByContributor(orderRowsOf(rows)).map((a) => ({ key: a.actor, cp: a.cp })));
    assert.deepEqual(shares.map((s) => s.cp), [1370, 380]);
    const spent = shares.map((s, i) => applied({ kind: "expend", idem: `expend:o1:1:0:${s.key ?? "fund"}`, cp: s.cp, actor: s.key, order: "o1" }, 10 + i));
    const all = [...rows, ...spent];
    const accounts = fundAccounts(all, { o1: order({ status: "finishing" }) });
    assert.deepEqual([accounts.earmarkedCp, accounts.spentCp, accounts.balanced], [550, 1750, true]);
    assert.deepEqual(accounts.orders[0].earmarked, [{ actor: null, cp: 430 }, { actor: "Actor.cy", cp: 120 }]);
    assert.deepEqual(spentBySource(all.filter((r) => r.order === "o1")), [{ actor: null, cp: 1370 }, { actor: "Actor.cy", cp: 380 }]);
    assert.ok(SPEND_KINDS.includes("remainder") && !SPEND_KINDS.includes("refund"), "a refund gives back, it is not spent");
});

test("a refund goes back to its source: the party fund's share to the unallocated fund, a member's to the member", () => {
    const rows = ledger();
    const left = leftAfterSpend(allocationsByContributor(orderRowsOf(rows)), 1150);
    assert.deepEqual(left, [{ actor: null, cp: 900 }, { actor: "Actor.cy", cp: 250 }], "1150 spent pro rata, the rest over-funding");
    const { claims, toFund } = refundClaims(order({ status: "finishing", crafter: "Actor.c" }), left, 7);
    assert.deepEqual(claims.map((c) => [c.actor, c.cp, c.idem]), [["Actor.cy", 250, "refund:o1:Actor.cy:7"]]);
    assert.deepEqual(toFund, [{ actor: null, cp: 900 }], "the fund's share is booked back to the fund, not paid to anyone");
    assert.equal(withdrawableCp(order({ status: "accepted" }), orderRowsOf(rows), null), 1800, "the fund's share an order can give back");
});

test("a closed order that still holds money is listed after the open ones, waiting for its refunds", () => {
    const rows = [...ledger(), applied({ kind: "pledge", idem: "pledge:o2:Actor.bo:n", cp: 200, actor: "Actor.bo", order: "o2" }, 4)];
    const accounts = fundAccounts(rows, { o1: order({ status: "cancelled", real: 1 }), o2: order({ id: "o2", status: "requested", real: 2 }) });
    assert.deepEqual(accounts.orders.map((o) => [o.id, o.open, o.refundsWaiting]), [["o2", true, false], ["o1", false, true]]);
    assert.equal(accounts.balanced, true, "money waiting for a refund is still in the strongbox and still earmarked");
    const withAdjust = [...rows, applied({ kind: "adjust", idem: "adjust:x", cp: 100, signed: { box: 100, purse: 0, alloc: 100 } }, 5)];
    assert.deepEqual([fundAccounts(withAdjust).unallocatedCp, fundAccounts(withAdjust).balanced], [100, true], "a GM's adjust books into the fund");
});

test("the fund slot moves with every debit of the unallocated fund and with nothing else", () => {
    const deposit = applied({ kind: "deposit", idem: "deposit:fund:Actor.bo:n1", cp: 1800, actor: "Actor.bo" }, 1);
    const first = fundSlotLockId([deposit]);
    assert.equal(first, hashId("fund-slot:0"));
    const more = [deposit, applied({ kind: "deposit", idem: "deposit:fund:Actor.cy:n", cp: 50, actor: "Actor.cy" }, 2)];
    assert.equal(fundSlotLockId(more), first, "money coming in takes no slot: two earmarks planned around a deposit still collide");
    const earmarked = [...more, ...earmarkInputs({ orderId: "o1", cp: 100, nonce: "a" }).map((input) => applied(input, 3))];
    assert.equal(fundSlotLockId(earmarked), hashId("fund-slot:1"));
    const withdrawn = [...earmarked, applied({ kind: "withdraw", idem: "withdraw:fund:Actor.bo:w", cp: 10, actor: "Actor.bo" }, 4)];
    assert.equal(fundSlotLockId(withdrawn), hashId("fund-slot:2"));
    const reversed = [...withdrawn, { ...reversalRow(deposit, stamp(5)), state: "applied" }];
    assert.equal(fundSlotLockId(reversed), hashId("fund-slot:3"), "reversing a deposit takes money out of the fund");
    const returned = [...earmarked, ...earmarkInputs({ orderId: "o1", cp: 100, nonce: "b", back: true }).map((input) => applied(input, 6))];
    assert.equal(fundSlotLockId(returned), fundSlotLockId(earmarked), "a share given back is money coming in");
    const order = { id: "o1", log: {} };
    assert.equal(returnSlotLockId(order, earmarked.filter((r) => r.order === "o1")), hashId("fund-return-slot:o1:0:0"));
    assert.equal(returnSlotLockId(order, returned.filter((r) => r.order === "o1")), hashId("fund-return-slot:o1:0:1"), "a give-back moves it");
    const accepted = { ...order, log: { 1: { seq: 1, event: "accept" } } };
    assert.equal(returnSlotLockId(accepted, returned.filter((r) => r.order === "o1")), hashId("fund-return-slot:o1:1:1"),
        "and so does every transition, which takes the same page: a give-back planned from the same copy conflicts with it");
});

test("what an order still needs: the up-front half, a retry's commit, or what finishing now costs", () => {
    const rows = orderRowsOf(ledger());
    assert.deepEqual(estimateOf(order()), { priceCp: 3500, upfrontCp: 1750, frozen: false });
    const before = shortfallOf(order({ status: "accepted" }), [rows[1]]);
    assert.deepEqual(before, { phase: "upfront", needCp: 1750, holdsCp: 500, shortCp: 1250 }, "G8: 12 gp 5 sp more up front");
    assert.equal(shortfallOf(order({ status: "accepted" }), rows).shortCp, 0, "funded: nothing to fill");
    const check = { degree: DEGREE.success, level: 1, rank: 1, settled: true, attempt: 1 };
    const started = order({ status: "finishing", attempt: 1, priceCp: 3500, upfrontCp: 1750, check });
    const finishing = [...rows, applied({ kind: "expend", idem: "expend:o1:1:0:fund", cp: 1750, actor: null, order: "o1" }, 9)];
    const days = [{ order: "o1", attempt: 1, kind: "extra", actor: "c", day: 3, crafterCp: 20, helpers: {} }];
    assert.deepEqual(shortfallOf(started, finishing, days), { phase: "finish", needCp: 1730, holdsCp: 550, shortCp: 1180 });
    const committed = [...rows, applied({ kind: "commit", idem: "commit:o1:1:0", cp: 1750, order: "o1" }, 9)];
    assert.deepEqual(shortfallOf({ ...started, status: "setup", check: null }, committed), { phase: "finish", needCp: 3500, holdsCp: 2300, shortCp: 1200 },
        "before the check: the committed half plus the rest, with no extra days yet");
    const failed = { ...started, status: "failed", check: { ...check, degree: DEGREE.fail } };
    assert.deepEqual(shortfallOf(failed, rows), { phase: "retry", needCp: 1750, holdsCp: 2300, shortCp: 0 });
    assert.deepEqual(shortfallOf({ ...started, status: "complete" }, rows), { phase: "closed", needCp: 0, holdsCp: 2300, shortCp: 0 });
});

test("money is typed as four whole-number fields, never one number read as copper (B)", () => {
    assert.deepEqual(fieldsToCp({ gp: "18" }), { ok: true, cp: 1800 }, "18 in the gold field is 18 gp");
    assert.deepEqual(fieldsToCp({ pp: "1", gp: "17", sp: " 1 ", cp: "4" }), { ok: true, cp: 2714 });
    assert.deepEqual(fieldsToCp({ gp: "", sp: null, cp: undefined }), { ok: true, cp: 0 });
    assert.deepEqual(fieldsToCp({ gp: 3, cp: 0 }), { ok: true, cp: 300 }, "numbers are fine too");
    for (const bad of ["1.5", "-2", "12 gp", "1e3", "x"]) assert.deepEqual(fieldsToCp({ gp: bad }), { ok: false, reason: "bad-number", field: "gp" }, bad);
    assert.deepEqual(coinFields(1714), { pp: 0, gp: 17, sp: 1, cp: 4 }, "the shortfall fills gold, silver and copper");
    assert.deepEqual(coinFields(0), { pp: 0, gp: 0, sp: 0, cp: 0 });
    assert.throws(() => coinFields(1.5), RangeError);
    assert.deepEqual(checkAmount({ gp: "18" }, { maxCp: 2000 }), { ok: true, cp: 1800 });
    assert.deepEqual(checkAmount({ gp: "0" }), { ok: false, reason: "nothing" });
    assert.deepEqual(checkAmount({ gp: "21" }, { maxCp: 2000 }), { ok: false, reason: "too-much", maxCp: 2000 });
    assert.deepEqual(checkAmount({ gp: "1" }, { minCp: 1714 }), { ok: false, reason: "too-little", minCp: 1714 });
    assert.equal(checkAmount({ gp: "1" }, { minCp: null, maxCp: null }).ok, true, "no limits given");
    assert.equal(checkAmount({ sp: "x" }).reason, "bad-number");
});

/* -------------------------------------------- */
/*  M5 on M4.1: purchases and material stock      */
/* -------------------------------------------- */

test("a purchase from a purse moves that purse's coins; from the party fund, the strongbox's and the fund's allocation (M5 on M4.1)", () => {
    const [purse] = purchaseInputs({ source: "purse", cp: 1000, idem: "purchase:formula:Actor.bo:n1", payer: "Actor.bo" }).map((i) => makeRow(i, stamp()));
    assert.deepEqual([purse.box, purse.purse, purse.alloc, purse.actor, purse.order], [0, -1000, 0, "Actor.bo", null]);
    const rows = [applied({ kind: "deposit", idem: "deposit:fund:Actor.bo:n0", cp: 1800, actor: "Actor.bo" }, 1)];
    const slot = fundSlotLockId(rows);
    const fund = purchaseInputs({ source: "fund", cp: 1000, idem: "purchase:formula:fund:n1" }).map((i) => applied(i, 2));
    assert.deepEqual(fund.map((r) => [r.kind, r.box, r.purse, r.alloc, r.actor, r.order]), [["purchase", -1000, 0, -1000, null, null]]);
    const after = [...rows, ...fund];
    assert.deepEqual([unallocatedCp(after), fundAccounts(after).balanced], [800, true], "the strongbox is still the unallocated fund plus earmarks");
    assert.notEqual(fundSlotLockId(after), slot, "a purchase from the fund takes a fund slot, as an earmark does");
    assert.throws(() => purchaseInputs({ source: "purse", cp: 10, idem: "x" }), TypeError, "a purse purchase names its payer");
    assert.throws(() => purchaseInputs({ source: "box", cp: 10, idem: "x" }), RangeError);
});

test("an order's purchase from the party fund is earmarked and spent in one move: spent by the fund, nothing left earmarked (M5 on M4.1)", () => {
    const rows = ledger();
    const deposit = applied({ kind: "deposit", idem: "deposit:fund:Actor.bo:n4", cp: 700, actor: "Actor.bo" }, 4);
    const inputs = purchaseInputs({ source: "fund", cp: 300, idem: "purchase:casting:o1:p1", order: "o1" });
    assert.equal(inputs[0].kind, "purchase", "the purchase row first: the move's fast path and resume key");
    const bought = inputs.map((i) => applied(i, 5));
    const all = [...rows, deposit, ...bought];
    const accounts = fundAccounts(all, { o1: order({ status: "accepted" }) });
    assert.deepEqual([accounts.unallocatedCp, accounts.earmarkedCp, accounts.spentCp, accounts.balanced], [400, 2300, 300, true]);
    assert.deepEqual(accounts.orders[0].earmarked, [{ actor: null, cp: 1800 }, { actor: "Actor.cy", cp: 500 }], "the order's earmarks are as they were");
    assert.deepEqual(accounts.orders[0].spent, [{ actor: null, cp: 300 }], "spent by the party fund");
    const purse = purchaseInputs({ source: "purse", cp: 200, idem: "purchase:casting:o1:p2", payer: "Actor.cy", order: "o1" }).map((i) => applied(i, 6));
    assert.deepEqual(spentBySource(orderRowsOf([...all, ...purse])), [{ actor: null, cp: 300 }, { actor: "Actor.cy", cp: 200 }],
        "a purchase straight from a purse is spent by that member");
    assert.ok(SPEND_KINDS.includes("purchase"));
});

test("material stock stands in for coins in the up-front half: the shortfall, and the accounts beside the money (M5 on M4.1)", () => {
    const line = (id, from, valueCp, extra = {}) => ({ id, from, valueCp, purpose: "material", ...stamp(id === "l1" ? 1 : 2), ...extra });
    const materials = { l1: line("l1", "Actor.bo", 1000), l2: line("l2", "Actor.cy", 250), l3: line("l3", "Actor.bo", 400, { returned: stamp(3) }) };
    const stocked = order({ status: "accepted", materials });
    assert.deepEqual(stockBySource(stocked), [{ actor: "Actor.bo", cp: 1000 }, { actor: "Actor.cy", cp: 250 }], "a returned line counts for nothing");
    // A 35 gp elixir: 17 gp 5 sp up front, 12 gp 5 sp of it in stock, so 5 gp in coins.
    assert.deepEqual(shortfallOf(stocked, []), { phase: "upfront", needCp: 500, holdsCp: 0, shortCp: 500 });
    const covered = order({ status: "accepted", materials: { l1: line("l1", "Actor.bo", 5000) } });
    assert.equal(shortfallOf(covered, []).shortCp, 0, "stock worth more than the half leaves nothing to fund");
    const failed = order({ status: "failed", priceCp: 3500, upfrontCp: 1750, materials });
    assert.equal(shortfallOf(failed, []).needCp, 500, "a retry commits the half less the stock too");
    const accounts = fundAccounts([], { o1: stocked });
    assert.deepEqual(accounts.orders.map((o) => [o.id, o.earmarkedCp, o.stockCp]), [["o1", 0, 1250]], "an order holding only stock is listed");
    assert.equal(accounts.earmarkedCp, 0, "stock is items, outside the strongbox identity");
    assert.deepEqual(fundAccounts([], { o1: { ...stocked, status: "complete" } }).orders, [], "a closed order's stock is used or given back");
});

test("an optional amount lets nothing through as 0 (a spell with no cost, M5 on M4.1)", () => {
    assert.deepEqual(checkAmount({}, { optional: true }), { ok: true, cp: 0 });
    assert.deepEqual(checkAmount({ gp: "3" }, { optional: true }), { ok: true, cp: 300 });
    assert.equal(checkAmount({ gp: "x" }, { optional: true }).reason, "bad-number");
    assert.equal(checkAmount({}).reason, "nothing");
});
