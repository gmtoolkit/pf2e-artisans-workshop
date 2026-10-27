/**
 * Fund accounting over the fake world (DESIGN.md 4.6, 4.7, As built in M4.1): adding coins to the party fund, funding an
 * order from the party fund (earmarking, no coins move) or from a purse, two members spending the same unallocated money
 * at once, giving a share back, finishing with the shortfall drawn from a chosen source and the over-funding returned to
 * its source, a cancel returning each share to its source, and where a finished item went as the window and the card
 * say it. No GM is connected in any of them.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MOD, addDocument, asUser, coin, flagsOf, installFoundry, interleave, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { RANK } = await import("../../scripts/logic/core.mjs");
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { fundAccounts, unallocatedCp } = await import("../../scripts/logic/funds.mjs");
const { orderLink } = await import("../../scripts/logic/rolls.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const funds = await import("../../scripts/foundry/funds.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const orders = await import("../../scripts/foundry/orders.mjs");
const { resetProducts } = await import("../../scripts/foundry/products.mjs");
const { reconciliationReport } = await import("../../scripts/foundry/reconcile.mjs");
const rolls = await import("../../scripts/foundry/rolls.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, write } = await import("../../scripts/foundry/store.mjs");
const { orderContext } = await import("../../scripts/ui/context.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const ordersById = () => Object.fromEntries(records("orders").map((o) => [o.id, o]));
const accounts = () => fundAccounts(records("rows"), ordersById());

const ELIXIR = "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318";
const OPTIONS = ["item:type:consumable", "item:slug:elixir-of-life-minor", "item:trait:alchemical", "item:trait:consumable", "item:trait:elixir",
    "item:trait:healing", "item:rarity:common", "item:level:1"];

/** pf2e's prepared, unsaved item, as far as the module reads it: 3 gp each. */
CONFIG.Item = {
    documentClass: class {
        constructor(source) {
            Object.assign(this, { name: source.name, img: "elixir.webp", type: "consumable", slug: "elixir-of-life-minor", level: 1, rarity: "common",
                traits: new Set(["alchemical", "consumable", "elixir", "healing"]), category: "elixir",
                price: { value: { copperValue: 300 }, per: 1 }, system: { publication: { title: "Pathfinder Player Core" } } });
        }
        getRollOptions(prefix) { return OPTIONS.map((o) => o.replace(/^item/, prefix)); }
    },
};
game.pf2e = { settings: { variants: { pwol: { enabled: false } } }, Modifier: class {} };

let docs;
let vera;
let bo;
const statistic = (slug, rank) => ({ slug, rank, label: slug, roll: async () => ({ total: 20 }) });

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    orders.resetOrders();
    resetProducts();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [
        coin("gp", 50),
        { type: "feat", name: "Alchemical Crafting", sourceId: REGISTRY["alchemical-crafting"].uuid },
        { type: "equipment", name: "Alchemist's Lab", sourceId: REGISTRY["alchemists-lab"].uuid },
    ] });
    Object.assign(vera, { level: 5, skills: { crafting: statistic("crafting", RANK.expert) }, system: { crafting: { formulas: [{ uuid: ELIXIR }] } } });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 50)] });
    Object.assign(bo, { level: 3, skills: {}, system: {} });
    world.compendium = { [ELIXIR]: { name: "Elixir of Life (Minor)", isOfType: (t) => t === "physical",
        toObject: () => ({ _id: "src", name: "Elixir of Life (Minor)", type: "consumable", system: { quantity: 1 }, flags: {} }) } };
    world.collections.Actor.party = { id: "party", members: [vera, bo] };
    ChatMessage.implementation.getSpeaker = () => ({});
    // Two players and no GM connected: nothing here waits on one (P2).
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }], "p2");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p2");
    registerBatchWatcher();
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

/** Bo requests two elixirs (6 gp, 3 gp up front) and Vera accepts. Returns the order id. */
async function acceptedOrder() {
    world.currentUser = "p2";
    const [id] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 2, requester: bo.uuid })).orders;
    world.currentUser = "p1";
    assert.deepEqual(await orders.accept(id, vera.uuid), { ok: true });
    world.currentUser = "p2";
    return id;
}

/** Rename the order id to "o1" so the check messages link to it. */
async function asO1(id) {
    const order = read(`orders.${id}`);
    await write({ replace: { "orders.o1": { ...order, id: "o1" } }, del: [`orders.${id}`] });
    for (const row of records("rows").filter((r) => r.order === id)) flagsOf(docs.ledger).rows[row.id].order = "o1";
    for (const day of records("days").filter((d) => d.order === id)) flagsOf(docs.ledger).days[day.id].order = "o1";
    return "o1";
}

const message = () => ({ id: "m1", author: { id: "p1" }, actor: vera, rolls: [{ total: 20, dice: [{ faces: 20, total: 10 }] }],
    flags: { pf2e: { context: { outcome: "success", unadjustedOutcome: "success", dc: { value: 15 }, options: [orderLink("o1", 1), "action:craft"], isReroll: false } } } });

/** Fund the up-front half from `source`, start, work the setup day, roll a success, and work one extra day (1 gp off). */
async function finishingOrder(fund) {
    const id = await acceptedOrder();
    await fund(id);
    world.currentUser = "p1";
    requestLease("p1");
    assert.equal((await orders.start(id)).ok, true);
    const o1 = await asO1(id);
    assert.equal((await orders.workDay(o1)).status, "check");
    assert.equal((await rolls.onCheckMessage(message())).ok, true);
    assert.equal((await orders.workDay(o1)).kind, "extra", "settles, then a day takes 1 gp off");
    assert.equal(read("orders.o1.status"), "finishing");
    return o1;
}

test("money added to the party fund is earmarked for an order with no coins moving, and the order can start (A)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 1800)).outcome, "ok");
    assert.deepEqual([cpOf(bo), cpOf(docs.strongbox), unallocatedCp(records("rows"))], [3200, 1800, 1800]);
    const id = await acceptedOrder();
    world.currentUser = "p1";
    const blocked = await orders.start(id);
    assert.deepEqual(blocked.data.gates.map((g) => [g.id, g.data.shortCp]), [["G8", 300]], "the money is in the fund, not on the order");
    world.currentUser = "p2";
    assert.equal(funds.shortfallFor(id).shortCp, 300, "what Fill the shortfall puts in");
    const funded = await funds.fundOrder(id, { source: "fund", cp: 300 });
    assert.deepEqual([funded.ok, funded.outcome], [true, "ok"]);
    assert.deepEqual([cpOf(bo), cpOf(docs.strongbox)], [3200, 1800], "earmarking moves no coins");
    const pair = records("rows").filter((r) => r.kind === "allocate");
    assert.deepEqual(pair.map((r) => [r.order, r.actor, r.alloc, r.author]).sort(), [[id, null, 300, "p2"], [null, null, -300, "p2"]].sort(),
        "the party fund is the source; the ledger records who earmarked it");
    const a = accounts();
    assert.deepEqual([a.unallocatedCp, a.earmarkedCp, a.balanced, a.expectedCp], [1500, 300, true, cpOf(docs.strongbox)]);
    assert.deepEqual(a.orders[0].earmarked, [{ actor: null, cp: 300 }]);
    assert.equal((await funds.fundOrder(id, { source: "fund", cp: 1501 })).reason, "fund-short", "no more than is unallocated");
    assert.equal((await funds.fundOrder(id, { source: "fund", cp: 0 })).reason, "nothing");
    world.currentUser = "p1";
    assert.equal((await orders.start(id)).ok, true, "G8 is met by the party fund's money");
    assert.equal(reconciliationReport().differenceCp, 0);
});

/**
 * Two clients planning from the same copy of the ledger: the request `mine` sends is held at the server's door while
 * `other` (another client's write) runs to the end, then let through. Returns both results.
 */
async function race(mine, other) {
    let theirs = null;
    const restore = interleave(() => true, async () => { theirs = await other(); });
    try {
        return [await mine(), theirs];
    } finally {
        restore();
    }
}

test("two members earmarking the same unallocated money at once: only one lands, and the fund never goes below zero", async () => {
    assert.equal((await funds.deposit(bo.uuid, 300)).outcome, "ok");
    const a = await acceptedOrder();
    const b = await acceptedOrder();
    const [mine, theirs] = await race(() => funds.fundFromParty(a, 300), asUser("p1", () => funds.fundFromParty(b, 300)));
    assert.deepEqual([theirs.ok, mine.ok, mine.outcome], [true, false, "taken"], "the fund slot's page was the other's");
    assert.equal(unallocatedCp(records("rows")), 0, "300 earmarked once, not twice");
    assert.equal((await funds.fundFromParty(a, 300)).reason, "fund-short", "planned again from fresh data, there is nothing left");
    // An earmark and a withdrawal from the fund planned from the same copy take the same slot too.
    assert.equal((await funds.deposit(bo.uuid, 200)).outcome, "ok");
    const [earmark, withdrawal] = await race(() => funds.fundFromParty(b, 200), () => funds.withdrawFund(bo.uuid, 200));
    assert.deepEqual([withdrawal.outcome, earmark.ok], ["ok", false], JSON.stringify({ earmark, withdrawal }));
    assert.equal(unallocatedCp(records("rows")), 0);
    assert.equal(accounts().balanced, true);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("funding from a purse is a pledge credited to that character; the party fund's share can be given back (A)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const id = await acceptedOrder();
    assert.equal((await funds.fundOrder(id, { source: "purse", actor: bo.uuid, cp: 100 })).outcome, "ok");
    assert.equal((await funds.fundOrder(id, { source: "fund", cp: 400 })).outcome, "ok");
    const bySource = () => Object.fromEntries(accounts().orders[0].earmarked.map((e) => [e.actor ?? "fund", e.cp]));
    assert.deepEqual(bySource(), { [bo.uuid]: 100, fund: 400 }, "two writes in one millisecond: compared by source, not order");
    assert.equal((await funds.returnToParty(id, 401)).reason, "too-much");
    const twice = await race(() => funds.returnToParty(id, 300), asUser("p1", () => funds.returnToParty(id, 300)));
    assert.deepEqual(twice.map((r) => r.ok), [false, true], "two returns of one share planned at once: one lands");
    assert.deepEqual([unallocatedCp(records("rows")), bySource()], [400, { [bo.uuid]: 100, fund: 100 }]);
    assert.equal((await funds.fundOrder(id, { source: "purse", actor: vera.uuid, cp: 100 })).reason, "not-owner", "only one's own purse");
    assert.equal((await funds.fundOrder(id, { source: "elsewhere", cp: 100 })).ok, false);
});

test("finish draws the shortfall from the party fund, and the over-funding goes back to the fund (A, D)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const id = await finishingOrder((orderId) => orders.pledgeTo(orderId, bo.uuid, 300));
    // 600 - 300 up front - 100 for the extra day = 200 to finish; the order holds nothing after the materials were used.
    assert.deepEqual(funds.shortfallFor(id), { phase: "finish", needCp: 200, holdsCp: 0, shortCp: 200 });
    assert.deepEqual(await funds.finishOrder(id), { ok: false, reason: "underfunded", data: { shortCp: 200 } }, "a finish without a source is refused");
    assert.equal((await funds.finishOrder(id, { draw: { source: "fund", cp: 199 } })).reason, "underfunded", "and so is too little");
    assert.equal(unallocatedCp(records("rows")), 500, "nothing was drawn");
    const done = await funds.finishOrder(id, { draw: { source: "fund", cp: 250 } });
    assert.equal(done.outcome, "ok", JSON.stringify(done));
    assert.equal(read(`orders.${id}.status`), "complete");
    const remainder = records("rows").filter((r) => r.kind === "remainder");
    assert.deepEqual(remainder.map((r) => [r.actor, r.cp]), [[null, 200]], "paid from the party fund's earmark");
    assert.equal(unallocatedCp(records("rows")), 300, "500 - 250 drawn + 50 over-funding given back");
    assert.equal(records("claims").filter((c) => c.kind === "refund").length, 0, "the fund's share is not a refund to anyone");
    const a = accounts();
    assert.deepEqual([cpOf(docs.strongbox), a.expectedCp, a.unallocatedCp, a.earmarkedCp, a.spentCp], [300, 300, 300, 0, 500]);
    assert.deepEqual(Object.fromEntries(a.orders[0].spent.map((e) => [e.actor ?? "fund", e.cp])), { [bo.uuid]: 300, fund: 200 },
        "spent per order, by source");
    const context = await orderContext(read(`orders.${id}`));
    assert.deepEqual([context.cost.upfrontCp, context.cost.workDays, context.cost.workCp, context.cost.finishCp, context.cost.totalCp], [300, 1, 100, 200, 500]);
    assert.match(context.costText.summary, /CostSummaryOneDay/, "one work day reads as one");
    assert.deepEqual(context.workDays.map((d) => [d.kind, d.n, d.cp ?? null]), [["setup", 1, null], ["extra", 2, 100]]);
});

test("finish draws the shortfall from the crafter's purse instead, when that is the source chosen (A)", async () => {
    const id = await finishingOrder((orderId) => orders.pledgeTo(orderId, bo.uuid, 300));
    const before = cpOf(vera);
    const done = await funds.finishOrder(id, { draw: { source: "purse", actor: vera.uuid } });
    assert.equal(done.outcome, "ok", JSON.stringify(done));
    assert.equal(cpOf(vera), before - 200, "the shortfall, no more");
    assert.deepEqual(records("rows").filter((r) => r.kind === "remainder").map((r) => [r.actor, r.cp]), [[vera.uuid, 200]]);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a cancel returns each share to its source: the party fund's to the fund, a member's as a refund (A)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 1000)).outcome, "ok");
    const id = await acceptedOrder();
    assert.equal((await funds.fundOrder(id, { source: "fund", cp: 200 })).outcome, "ok");
    assert.equal((await funds.fundOrder(id, { source: "purse", actor: bo.uuid, cp: 100 })).outcome, "ok");
    assert.equal(unallocatedCp(records("rows")), 800);
    const cancelled = await orders.cancel(id);
    assert.deepEqual(cancelled, { ok: true, refunds: 1 });
    assert.equal(unallocatedCp(records("rows")), 1000, "the fund's 200 is unallocated again");
    assert.deepEqual(records("claims").filter((c) => c.kind === "refund").map((c) => [c.actor, c.cp]), [[bo.uuid, 100]]);
    resetLease();
    requestLease("p2");
    await claims.sweepClaims();
    assert.deepEqual([cpOf(bo), cpOf(docs.strongbox)], [4000, 1000], "Bo has his purse share back; the fund keeps its own");
    const a = accounts();
    assert.deepEqual([a.unallocatedCp, a.earmarkedCp, a.balanced], [1000, 0, true]);
});

test("reversing a deposit takes the fund slot, so it cannot land with an earmark of the same money", async () => {
    const deposited = await funds.deposit(bo.uuid, 300);
    const id = await acceptedOrder();
    const [earmark, reversal] = await race(() => funds.fundFromParty(id, 300), () => funds.reverse(deposited.rows[0].id));
    assert.deepEqual([reversal.outcome, earmark.ok], ["ok", false], JSON.stringify({ earmark, reversal }));
    assert.deepEqual([unallocatedCp(records("rows")), cpOf(bo)], [0, 5000], "the deposit went back to Bo, and nothing was earmarked");
    assert.equal(accounts().balanced, true);
});

test("a finished item's card and detail say where it went, and Collect stays until it is delivered (E)", async () => {
    const id = await finishingOrder((orderId) => orders.pledgeTo(orderId, bo.uuid, 300));
    assert.equal((await funds.finishOrder(id, { draw: { source: "purse", actor: vera.uuid } })).outcome, "ok");
    world.currentUser = "p2";
    let context = await orderContext(read(`orders.${id}`));
    assert.equal(context.deliveryState, "shelf");
    assert.match(context.deliveryText, /Delivery\.Shelf.*Bo/);
    assert.equal(context.canCollect, true, "Bo's owner can collect it");
    world.currentUser = "p1";
    assert.equal((await orderContext(read(`orders.${id}`))).canCollect, false, "the crafter's player does not own Bo");
    world.currentUser = "p2";
    resetLease();
    requestLease("p2");
    assert.equal((await funds.takeAll()).ok, true);
    assert.equal(bo.items.filter((i) => i.name === "Elixir of Life (Minor)").length, 1);
    context = await orderContext(read(`orders.${id}`));
    assert.deepEqual([context.deliveryState, context.canCollect], ["delivered", false]);
    assert.match(context.deliveryText, /Delivery\.Delivered.*Bo/, "the card says it was delivered, and to whom");
    assert.ok(!docs.strongbox.items.some((i) => i.flags?.[MOD]?.shelf), "the shelf is empty");
});

test("a finish that cannot happen draws nothing: not the crafter's owner, or not finishing yet", async () => {
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const id = await finishingOrder((orderId) => orders.pledgeTo(orderId, bo.uuid, 300));
    world.currentUser = "p2";
    assert.equal((await funds.finishOrder(id, { draw: { source: "fund" } })).reason, "not-owner");
    assert.equal(unallocatedCp(records("rows")), 500, "nothing was earmarked for a finish Bo's player may not make");
    const other = await acceptedOrder();
    world.currentUser = "p1";
    assert.equal((await funds.finishOrder(other, { draw: { source: "fund" } })).reason, "state");
    assert.equal(unallocatedCp(records("rows")), 500);
});

test("an earmark that lands after the order closed can be given back to the party fund, all of it (review fix)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const id = await acceptedOrder();
    assert.deepEqual(await orders.cancel(id), { ok: true, refunds: 0 });
    // An earmark planned before the cancel, landing after it: the order is closed with fund money on it.
    const { earmarkInputs, fundSlotLockId: slot } = await import("../../scripts/logic/funds.mjs");
    const { lockedWrite } = await import("../../scripts/foundry/money.mjs");
    assert.equal((await lockedWrite([slot(records("rows"))], earmarkInputs({ orderId: id, cp: 200, nonce: "late" }))).ok, true);
    assert.deepEqual([unallocatedCp(records("rows")), accounts().orders[0].refundsWaiting], [300, true]);
    const context = await orderContext(read(`orders.${id}`));
    assert.deepEqual([context.actions.returnToFund, context.fundReturnableCp], [true, 200]);
    assert.equal((await funds.returnToParty(id, 200)).ok, true);
    assert.deepEqual([unallocatedCp(records("rows")), accounts().orders.length], [500, 0]);
    assert.equal((await funds.fundFromParty(id, 100)).reason, "state", "a closed order takes no new money");
});

/* -------------------------------------------- */
/*  Money off an order against its transitions   */
/* -------------------------------------------- */

const { committedFromRows } = await import("../../scripts/logic/craft.mjs");
const { escrowCp } = await import("../../scripts/logic/orders.mjs");
const { allocationsByContributor } = await import("../../scripts/logic/split.mjs");

/** Every allocation of every order and the fund at or above zero, the accounts balanced, the strongbox as expected. */
function soundBooks() {
    const a = accounts();
    const byOrder = Map.groupBy(records("rows").filter((r) => r.order), (r) => r.order);
    for (const [id, rows] of byOrder) {
        const byActor = new Map();
        for (const row of rows) byActor.set(row.actor ?? null, (byActor.get(row.actor ?? null) ?? 0) + (row.alloc ?? 0));
        for (const [actor, cp] of byActor) assert.ok(cp >= 0, `${id}: ${actor ?? "fund"} holds ${cp}`);
    }
    assert.ok(a.unallocatedCp >= 0, `unallocated ${a.unallocatedCp}`);
    assert.equal(a.balanced, true);
    assert.equal(a.expectedCp, cpOf(docs.strongbox));
}

test("giving the fund's share back and a cancel planned from one copy: only one lands, so the share goes back once (review fix)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const id = await acceptedOrder();
    assert.equal((await funds.fundFromParty(id, 300)).ok, true);
    const [given, cancelled] = await race(() => funds.returnToParty(id, 300), () => orders.cancel(id));
    assert.deepEqual([cancelled.ok, given.ok], [true, false], JSON.stringify({ given, cancelled }));
    assert.equal(unallocatedCp(records("rows")), 500, "the fund's 300 came back once");
    soundBooks();
});

test("giving the fund's share back and a finish planned from one copy: only one lands (review fix)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 1000)).outcome, "ok");
    const id = await finishingOrder((orderId) => funds.fundFromParty(orderId, 300));
    world.currentUser = "p2";
    assert.equal((await funds.fundFromParty(id, 300)).ok, true, "200 to finish, 300 earmarked from the fund");
    const [given, finished] = await race(() => funds.returnToParty(id, 300), asUser("p1", () => orders.finish(id)));
    assert.deepEqual([finished.ok, given.ok], [true, false], JSON.stringify({ given, finished }));
    assert.equal(unallocatedCp(records("rows")), 500, "1000 - 300 - 300 earmarked + 100 over-funding back, once");
    soundBooks();
});

test("giving the fund's share back and a start planned from one copy: the order never starts holding less than it commits (review fix)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const id = await acceptedOrder();
    assert.equal((await funds.fundFromParty(id, 300)).ok, true, "exactly the up-front half");
    const [given, started] = await race(() => funds.returnToParty(id, 300), asUser("p1", () => orders.start(id)));
    assert.deepEqual([started.ok, given.ok], [true, false], JSON.stringify({ given, started }));
    const rows = orders.orderRows(id);
    assert.deepEqual([committedFromRows(rows), escrowCp(rows)], [300, 300]);
    assert.equal((await funds.returnToParty(id, 1)).reason, "too-much", "planned again from fresh data: all of it is committed");
    soundBooks();
});

test("giving the fund's share back and a settlement planned from one copy: no source's share goes below zero (review fix)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const id = await acceptedOrder();
    assert.equal((await funds.fundFromParty(id, 300)).ok, true);
    assert.equal((await funds.fundOrder(id, { source: "purse", actor: bo.uuid, cp: 200 })).outcome, "ok");
    world.currentUser = "p1";
    requestLease("p1");
    assert.equal((await orders.start(id)).ok, true);
    const o1 = await asO1(id);
    assert.equal((await orders.workDay(o1)).status, "check");
    assert.equal((await rolls.onCheckMessage(message())).ok, true);
    assert.equal(read("orders.o1.status"), "rolled");
    world.currentUser = "p2";
    const [given, settled] = await race(() => funds.returnToParty(o1, 200), asUser("p1", () => orders.settle(o1)));
    assert.deepEqual([settled.ok, given.ok], [true, false], JSON.stringify({ given, settled }));
    assert.deepEqual(Object.fromEntries(allocationsByContributor(orders.orderRows(o1)).map((a) => [a.actor ?? "fund", a.cp])),
        { fund: 120, [bo.uuid]: 80 }, "the 300 spent pro rata over 300 and 200 (by source: two writes in one millisecond)");
    soundBooks();
});

test("a member taking back their share and a cancel planned from one copy: they are paid once (review fix)", async () => {
    const id = await acceptedOrder();
    assert.equal((await funds.fundOrder(id, { source: "purse", actor: bo.uuid, cp: 300 })).outcome, "ok");
    const [taken, cancelled] = await race(() => orders.withdrawFrom(id, bo.uuid, 300), () => orders.cancel(id));
    assert.deepEqual([cancelled.ok, taken.ok], [true, false], JSON.stringify({ taken, cancelled }));
    resetLease();
    requestLease("p2");
    await claims.sweepClaims();
    assert.equal(cpOf(bo), 5000, "the refund, and no withdrawal on top of it");
    soundBooks();
});

test("give-backs and take-backs one after another each take a new page, so none is refused for an earlier one", async () => {
    assert.equal((await funds.deposit(bo.uuid, 600)).outcome, "ok");
    const id = await acceptedOrder();
    assert.equal((await funds.fundFromParty(id, 500)).ok, true);
    assert.equal((await funds.fundOrder(id, { source: "purse", actor: bo.uuid, cp: 200 })).outcome, "ok");
    assert.equal((await funds.returnToParty(id, 100)).ok, true);
    assert.equal((await orders.withdrawFrom(id, bo.uuid, 100)).outcome, "ok");
    assert.equal((await funds.returnToParty(id, 100)).ok, true);
    world.currentUser = "p1";
    assert.equal((await orders.start(id)).ok, true, "a transition after them is not refused either");
    world.currentUser = "p2";
    assert.equal((await orders.withdrawFrom(id, bo.uuid, 100)).outcome, "ok", "and neither is a take-back after the transition");
    soundBooks();
});

test("reversing a pledge and a cancel planned from one copy: the pledger is paid once (review fix)", async () => {
    const id = await acceptedOrder();
    const pledged = await funds.fundOrder(id, { source: "purse", actor: bo.uuid, cp: 300 });
    assert.equal(pledged.outcome, "ok");
    const [reversed, cancelled] = await race(() => funds.reverse(pledged.rows[0].id), () => orders.cancel(id));
    assert.deepEqual([cancelled.ok, reversed.ok], [true, false], JSON.stringify({ reversed, cancelled }));
    resetLease();
    requestLease("p2");
    await claims.sweepClaims();
    assert.equal(cpOf(bo), 5000, "the refund, and no reversal on top of it");
    soundBooks();
});

test("a retry after a critical failure asks for what the ruined materials took, drawn from the source chosen (review fix)", async () => {
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const id = await acceptedOrder();
    assert.equal((await funds.fundFromParty(id, 300)).ok, true);
    world.currentUser = "p1";
    requestLease("p1");
    assert.equal((await orders.start(id)).ok, true);
    const o1 = await asO1(id);
    assert.equal((await orders.workDay(o1)).status, "check");
    const fumble = message();
    Object.assign(fumble.flags.pf2e.context, { outcome: "criticalFailure", unadjustedOutcome: "criticalFailure" });
    assert.equal((await rolls.onCheckMessage(fumble)).ok, true);
    assert.equal((await orders.settle(o1)).ok, true);
    assert.equal(read("orders.o1.status"), "failed");
    assert.deepEqual(funds.shortfallFor(o1), { phase: "retry", needCp: 300, holdsCp: 270, shortCp: 30 }, "10% ruined");
    assert.deepEqual(await funds.retryOrder(o1), { ok: false, reason: "underfunded", data: { shortCp: 30 } });
    world.currentUser = "p2";
    assert.equal((await funds.retryOrder(o1, { draw: { source: "fund" } })).reason, "not-owner", "the crafter's step: nothing drawn");
    assert.equal(unallocatedCp(records("rows")), 200);
    world.currentUser = "p1";
    assert.equal((await funds.retryOrder(o1, { draw: { source: "fund" } })).ok, true);
    assert.deepEqual([read("orders.o1.status"), read("orders.o1.attempt"), unallocatedCp(records("rows"))], ["setup", 2, 170]);
    soundBooks();
});

test("a member taking back their share and a start planned from one copy: the order never holds less than it commits (M4 follow-up, fixed)", async () => {
    const id = await acceptedOrder();
    assert.equal((await funds.fundOrder(id, { source: "purse", actor: bo.uuid, cp: 300 })).outcome, "ok");
    const [taken, started] = await race(() => orders.withdrawFrom(id, bo.uuid, 300), asUser("p1", () => orders.start(id)));
    assert.deepEqual([started.ok, taken.ok], [true, false], JSON.stringify({ taken, started }));
    const rows = orders.orderRows(id);
    assert.deepEqual([committedFromRows(rows), escrowCp(rows)], [300, 300]);
    soundBooks();
});
