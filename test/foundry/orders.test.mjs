/**
 * The order lifecycle over the fake world (DESIGN.md 4.2.3, 6.2, M4): request, pledge, accept, start with its gates,
 * work days, the Craft check, settle, finish onto the pickup shelf and delivery, cancel with refunds, undo of a
 * settlement; and the races M4 closes: a reroll recorded after the settlement (6.12 follow-up), a delivery's late apply
 * request against the re-creation of the lost delivery (5.11 follow-up "item delivered twice"), and transitions planned
 * from the same copy of an order (a cancel and a finish, two offers to craft) or written late onto a closed order.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
    MOD, addDocument, asUser, coin, flagsOf, installFoundry, interleave, resetWorld, serverStamp, setUsers, sharedWorld, world,
} from "./stubs.mjs";

installFoundry();
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { DEGREE, RANK } = await import("../../scripts/logic/core.mjs");
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { hashId } = await import("../../scripts/logic/ids.mjs");
const { recreateLockId } = await import("../../scripts/logic/lock-first.mjs");
const { PENDING_GRACE_MS } = await import("../../scripts/logic/reconcile.mjs");
const { orderLink } = await import("../../scripts/logic/rolls.mjs");
const { lastEntry } = await import("../../scripts/logic/orders.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const funds = await import("../../scripts/foundry/funds.mjs");
const purge = await import("../../scripts/foundry/purge.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const orders = await import("../../scripts/foundry/orders.mjs");
const { resetProducts } = await import("../../scripts/foundry/products.mjs");
const { reconciliationReport } = await import("../../scripts/foundry/reconcile.mjs");
const rolls = await import("../../scripts/foundry/rolls.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, write } = await import("../../scripts/foundry/store.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));

const ELIXIR = "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318";
const OPTIONS = ["item:type:consumable", "item:slug:elixir-of-life-minor", "item:trait:alchemical", "item:trait:consumable", "item:trait:elixir",
    "item:trait:healing", "item:rarity:common", "item:level:1"];

/** pf2e's prepared, unsaved item, as far as the module reads it. */
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
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p2");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p2");
    registerBatchWatcher();
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

/** A pf2e check message for the order's Craft check. */
function message({ id = "m1", outcome = "success", attempt = 1, isReroll = false, author = "p1" } = {}) {
    return { id, author: { id: author }, actor: vera, rolls: [{ total: 20, dice: [{ faces: 20, total: 10 }] }],
        flags: { pf2e: { context: { outcome, unadjustedOutcome: outcome, dc: { value: 15 }, options: [orderLink("o1", attempt), "action:craft"], isReroll } } } };
}

/** Bo requests two elixirs and pledges the up-front half; Vera accepts and starts. Returns the order id. */
async function startedOrder({ pledged = 300 } = {}) {
    world.currentUser = "p2";
    const filed = await orders.requestOrder({ uuid: ELIXIR, quantity: 2, requester: bo.uuid });
    assert.equal(filed.ok, true, JSON.stringify(filed));
    const [id] = filed.orders;
    if (pledged) assert.equal((await orders.pledgeTo(id, bo.uuid, pledged)).outcome, "ok");
    world.currentUser = "p1";
    assert.deepEqual(await orders.accept(id, vera.uuid), { ok: true });
    const started = await orders.start(id);
    assert.equal(started.ok, true, JSON.stringify(started));
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

/** Work the setup day, roll a check, and record it. */
async function toRolled(outcome = "success") {
    const id = await asO1(await startedOrder());
    world.currentUser = "p1";
    requestLease("p1");
    assert.deepEqual((await orders.workDay(id)).status, "check", "one setup day with the formula");
    assert.equal((await rolls.onCheckMessage(message({ outcome }))).ok, true);
    assert.equal(read("orders.o1.status"), "rolled");
    return id;
}

test("the whole lifecycle: request, pledge, accept, start, work, roll, settle, work, finish, shelf, delivery", async () => {
    const id = await toRolled();
    const order = read(`orders.${id}`);
    assert.deepEqual([order.priceCp, order.upfrontCp, order.dc.final, order.route, order.attempt], [600, 300, 15, "known", 1]);
    assert.equal(cpOf(docs.strongbox), 300, "the pledge is in escrow");
    // The next day settles the check first (4.2.3), then counts as an extra day.
    const worked = await orders.workDay(id);
    assert.deepEqual([worked.ok, worked.kind], [true, "extra"]);
    assert.equal(read(`orders.${id}.status`), "finishing");
    assert.equal(read(`orders.${id}.settlement.attempt`), 1, "the settlement record");
    assert.equal(cpOf(docs.strongbox), 0, "the up-front materials were used");
    const extra = records("days").find((d) => d.kind === "extra");
    assert.equal(extra.crafterCp, 100, "a 5th-level expert takes 1 gp a day off");
    // 600 - 300 - 100 = 200 left: Bo pledges it, Vera finishes.
    world.currentUser = "p2";
    assert.equal((await orders.withdrawFrom(id, bo.uuid, 1)).reason, "too-much", "nothing uncommitted to take back");
    assert.equal((await orders.pledgeTo(id, bo.uuid, 250)).outcome, "ok");
    world.currentUser = "p1";
    const finished = await orders.finish(id);
    assert.equal(finished.outcome, "ok", JSON.stringify(finished));
    assert.equal(read(`orders.${id}.status`), "complete");
    const shelf = docs.strongbox.items.find((item) => item.flags?.[MOD]?.shelf);
    assert.deepEqual([shelf.name, shelf.system.quantity, shelf.flags[MOD].shelf.for], ["Elixir of Life (Minor)", 2, bo.uuid]);
    assert.equal(records("rows").filter((r) => r.kind === "shelved").length, 1);
    assert.equal(records("rows").filter((r) => r.kind === "remainder").reduce((s, r) => s + r.cp, 0), 200);
    const refund = records("claims").find((c) => c.kind === "refund");
    assert.deepEqual([refund.actor, refund.cp], [bo.uuid, 50], "over-funding goes back");
    // Bo's client collects the item and the refund.
    world.currentUser = "p2";
    resetLease();
    requestLease("p2");
    assert.equal(await claims.sweepClaims(), 2);
    assert.equal(bo.items.filter((i) => i.name === "Elixir of Life (Minor)").length, 1);
    assert.equal(cpOf(bo), 5000 - 300 - 250 + 50);
    assert.equal(cpOf(docs.strongbox), 0);
    const report = reconciliationReport();
    assert.deepEqual([report.differenceCp, report.pending.length], [0, 0]);
    world.currentUser = "p1";
    assert.equal((await orders.finish(id)).reason, "state", "finished once");
});

test("start refuses until every gate passes (P1), and says which", async () => {
    world.currentUser = "p2";
    const [id] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 2, requester: bo.uuid })).orders;
    world.currentUser = "p1";
    await orders.accept(id, vera.uuid);
    const refused = await orders.start(id);
    assert.equal(refused.reason, "gates");
    assert.deepEqual(refused.data.gates.map((g) => [g.id, g.reason]), [["G8", "underfunded"]]);
    vera.items.delete(vera.items.find((i) => i.name === "Alchemist's Lab").id);
    assert.deepEqual((await orders.start(id)).data.gates.map((g) => g.id), ["G7", "G8"]);
    world.currentUser = "p2";
    assert.equal((await orders.start(id)).reason, "not-owner", "only the crafter's owner starts it");
});

test("a request above one batch splits into orders of at most a batch; a stranger cannot file for another's character", async () => {
    world.currentUser = "p2";
    const filed = await orders.requestOrder({ uuid: ELIXIR, quantity: 9, requester: bo.uuid });
    assert.deepEqual(records("orders").map((o) => o.quantity).sort(), [1, 4, 4]);
    assert.equal(filed.orders.length, 3);
    assert.equal((await orders.requestOrder({ uuid: ELIXIR, quantity: 1, requester: vera.uuid })).reason, "not-owner");
});

test("cancel releases the commit, refunds each contributor by claim, and closes the order", async () => {
    const id = await startedOrder();
    world.currentUser = "p2";
    const cancelled = await orders.cancel(id);
    assert.deepEqual(cancelled, { ok: true, refunds: 1 });
    assert.equal(read(`orders.${id}.status`), "cancelled");
    assert.equal(records("rows").filter((r) => r.kind === "release" && r.order === id).length, 1);
    resetLease();
    requestLease("p2");
    await claims.sweepClaims();
    assert.equal(cpOf(bo), 5000, "Bo has his coins back");
    assert.equal(cpOf(docs.strongbox), 0);
    assert.equal((await orders.cancel(id)).reason, "state");
});

test("undo of a settlement mints the spent materials back and returns to the recorded check; settling again spends once more", async () => {
    const id = await toRolled();
    assert.equal((await orders.settle(id)).outcome, "ok");
    assert.equal(cpOf(docs.strongbox), 0);
    const undone = await orders.undo(id);
    assert.deepEqual(undone, { ok: true, event: "settle" });
    const order = read(`orders.${id}`);
    assert.deepEqual([order.status, order.check.settled, order.settlement], ["rolled", false, null]);
    assert.equal(cpOf(docs.strongbox), 300, "the expend's reversal put the coins back");
    assert.equal((await orders.undo(id)).reason, "nothing", "an undo is not undone in turn");
    assert.equal((await orders.settle(id)).outcome, "ok");
    assert.equal(cpOf(docs.strongbox), 0);
    const expends = records("rows").filter((r) => r.kind === "expend");
    assert.equal(new Set(expends.map((r) => r.id)).size, 2, "the second settlement's rows have keys of their own");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a reroll recorded after the settlement landed is put back as a conflict, from the settlement record (6.12)", async () => {
    const id = await toRolled("success");
    assert.equal((await orders.settle(id)).outcome, "ok");
    // A reroll recorded from a copy that had not seen the settlement: its write of the check lands afterwards.
    const reroll = { degree: DEGREE.critFail, messageId: "m2", attempt: 1, rerolled: true, settled: false };
    flagsOf(docs.ledger).orders.o1.check = reroll;
    await orders.onOrdersChanged(["o1"]);   // Vera's client is responsible for her: it repairs
    const order = read("orders.o1");
    assert.deepEqual([order.check.messageId, order.check.settled, order.status], ["m1", true, "finishing"]);
    assert.equal(order.conflict.messageId, "m2", "the reroll is kept for the crafter to use by undoing the settlement");
    // Undo takes the conflict: the order is back in `rolled` with the reroll as its check.
    assert.equal((await orders.undo(id)).ok, true);
    assert.deepEqual([read("orders.o1.check.messageId"), read("orders.o1.status"), read("orders.o1.conflict")], ["m2", "rolled", null]);
});

test("a reroll the settlement overwrote is kept as a conflict by the client that recorded it (6.12)", async () => {
    await toRolled("success");
    const reroll = { degree: DEGREE.success, messageId: "m2", attempt: 1, rerolled: true, settled: false };
    await orders.settle("o1");
    // The reroll's write landed first; the settlement then replaced the check with the one it settled.
    await orders.rememberReroll("o1", reroll);
    assert.equal(read("orders.o1.conflict.messageId"), "m2");
    assert.equal(read("orders.o1.check.messageId"), "m1");
});

test("a remembered reroll that a later roll superseded before any settlement is not kept as a conflict (6.12)", async () => {
    await toRolled("success");
    const mine = { degree: DEGREE.success, messageId: "m2", attempt: 1, rerolled: true, settled: false };
    flagsOf(docs.ledger).orders.o1.check = mine;
    await orders.rememberReroll("o1", mine);
    // Another client's later reroll replaces it, and the order is then settled with that one.
    await write({ replace: { "orders.o1.check": { ...mine, messageId: "m3" } } });
    assert.equal((await orders.settle("o1")).outcome, "ok");
    assert.equal(read("orders.o1.settlement.check.messageId"), "m3");
    assert.equal(read("orders.o1.conflict"), null, "m2 was superseded, not lost");
});

test("a reroll whose copy still shows the settlement's record is refused as settled, even with the flag and rows out of sight", async () => {
    await toRolled("success");
    await orders.settle("o1");
    const seen = flagsOf(docs.ledger).rows;
    flagsOf(docs.ledger).rows = {};
    flagsOf(docs.ledger).orders.o1.check.settled = false;
    const result = await rolls.onCheckMessage(message({ id: "m3", isReroll: true }));
    flagsOf(docs.ledger).rows = { ...seen, ...flagsOf(docs.ledger).rows };
    assert.equal(result.reason, "settled");
    assert.equal(read("orders.o1.conflict.messageId"), "m3");
});

test("a reroll writes the check alone, so it cannot undo a settlement's state", async () => {
    await toRolled("failure");
    const writes = [];
    Hooks.on("updateJournalEntry", (_doc, changed) => writes.push(Object.keys(changed.flags?.[MOD]?.orders?.o1 ?? {})));
    assert.equal((await rolls.onCheckMessage(message({ id: "m2", outcome: "success", isReroll: true }))).ok, true);
    assert.deepEqual(writes[0], ["check"]);
    assert.equal(read("orders.o1.status"), "rolled");
});

test("a delivery's late apply request and the re-creation of the lost delivery take the same lock: the item arrives once (5.11)", async (t) => {
    t.mock.method(console, "warn", () => {});
    world.currentUser = "p2";
    const shelf = docs.strongbox.addItem({ type: "consumable", name: "Elixir", system: { quantity: 1 },
        flags: { [MOD]: { shelf: { for: bo.uuid, from: vera.uuid, order: "o9", claimKey: "deliver:o9:1" } } } });
    const rowId = hashId("deliver:o9:1");
    // Hold the delivery's apply request (it starts with the re-creation lock) at the server's door, and meanwhile let
    // the recipient's client re-create the delivery, as it does once the row is past the grace time.
    const apply = (ops) => ops[0]?.documentName === "JournalEntryPage" && ops[0].data?.[0]?._id === recreateLockId(rowId) && ops.some((op) => op.action === "delete");
    let recreated = null;
    const restore = interleave(apply, async () => {
        flagsOf(docs.ledger).rows[rowId].at = serverStamp(PENDING_GRACE_MS + 1);
        recreated = await claims.finishDelivery(read(`rows.${rowId}`), bo);
    });
    let delivered;
    try {
        delivered = await claims.deliver(shelf, bo);
    } finally {
        restore();
    }
    assert.equal(recreated.outcome, "ok");
    assert.equal(delivered.outcome, "taken", "refused at the lock the re-creation took");
    assert.equal(bo.items.filter((i) => i.name === "Elixir").length, 1, "delivered once");
    assert.equal(docs.strongbox.items.has(shelf.id), false);
    assert.equal(read(`rows.${rowId}.state`), "applied");
});

/**
 * Run `action` as planned from the copies it reads now, but let `other` (another client's work) reach the server first:
 * the first write `action` sends, a plain update or a batch, waits at the server's door until `other` is done.
 */
async function landsAfter(other, action) {
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_name, task) => task() } }, configurable: true });
    const batch = foundry.documents.modifyBatch;
    let held = false;
    const hold = (send) => async (...args) => {
        if (!held) {
            held = true;
            await other();
        }
        return send(...args);
    };
    foundry.documents.modifyBatch = hold(batch);
    docs.ledger.update = hold(Object.getPrototypeOf(docs.ledger).update.bind(docs.ledger));
    try {
        return await action();
    } finally {
        foundry.documents.modifyBatch = batch;
        delete docs.ledger.update;
    }
}

/** Vera puts 1000 cp in the party fund (other people's money in the strongbox); the order is settled and Bo pledges the rest. */
async function finishingOrder() {
    world.currentUser = "p1";
    assert.equal((await funds.deposit(vera.uuid, 1000)).outcome, "ok");
    const id = await toRolled();
    assert.equal((await orders.settle(id)).outcome, "ok");
    world.currentUser = "p2";
    assert.equal((await orders.pledgeTo(id, bo.uuid, 300)).outcome, "ok");
    return id;
}

/** Bo's client collects what waits for him. */
async function boCollects() {
    world.currentUser = "p2";
    resetLease();
    requestLease("p2");
    await claims.sweepClaims({ force: true });
}

test("a cancel planned before a finish landed is refused at the order's log slot: the item and the money move once", async () => {
    const id = await finishingOrder();
    world.currentUser = "p2";
    const cancelled = await landsAfter(asUser("p1", () => orders.finish(id)), () => orders.cancel(id));
    assert.deepEqual([cancelled.ok, cancelled.outcome], [false, "taken"]);
    const order = read(`orders.${id}`);
    assert.deepEqual([order.status, lastEntry(order).event], ["complete", "finish"]);
    assert.equal(records("claims").filter((c) => c.kind === "refund").length, 0, "the remainder used every coin; nothing to refund");
    await boCollects();
    assert.equal(bo.items.filter((i) => i.name === "Elixir of Life (Minor)").length, 1);
    assert.equal(cpOf(bo), 5000 - 300 - 300);
    assert.equal(cpOf(docs.strongbox), 1000, "Vera's deposit is still there");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a finish planned before a cancel landed is refused at the order's log slot: no item, one refund", async () => {
    const id = await finishingOrder();
    world.currentUser = "p1";
    const finished = await landsAfter(asUser("p2", () => orders.cancel(id)), () => orders.finish(id));
    assert.deepEqual([finished.ok, finished.outcome], [false, "conflict"]);
    const order = read(`orders.${id}`);
    assert.deepEqual([order.status, lastEntry(order).event], ["cancelled", "cancel"]);
    assert.equal(records("rows").some((r) => r.kind === "shelved" || r.kind === "remainder"), false);
    assert.equal(docs.strongbox.items.some((i) => i.flags?.[MOD]?.shelf), false);
    await boCollects();
    assert.equal(cpOf(bo), 5000 - 300 - 300 + 300, "the remainder pledge comes back once; the spent materials do not");
    assert.equal(cpOf(docs.strongbox), 1000);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a work day planned before a cancel landed moves the closed order's status; the crafter's client puts it back, and nothing more happens to it", async () => {
    world.currentUser = "p1";
    assert.equal((await funds.deposit(vera.uuid, 1000)).outcome, "ok");
    const id = await asO1(await startedOrder());
    world.currentUser = "p1";
    requestLease("p1");
    const day = await landsAfter(asUser("p2", () => orders.cancel(id)), () => orders.workDay(id));
    assert.equal(day.status, "check", "the setup day was planned from setup");
    assert.equal(read(`orders.${id}.status`), "check", "and its write landed after the cancel");
    await orders.onOrdersChanged([id]);   // Vera's client is responsible for her: it repairs
    assert.equal(read(`orders.${id}.status`), "cancelled");
    world.currentUser = "p2";
    assert.equal((await orders.cancel(id)).reason, "state", "cancelled once");
    world.currentUser = "p1";
    flagsOf(docs.ledger).orders[id].status = "check";   // a copy that still shows the late write
    assert.equal((await rolls.onCheckMessage(message({ outcome: "success" }))).reason, "state", "no roll is recorded on it");
    assert.equal((await orders.workDay(id)).reason, "state");
    world.currentUser = "p2";
    assert.equal((await orders.cancel(id)).reason, "state", "nor a second cancel from that copy");
    await boCollects();
    assert.equal(cpOf(bo), 5000, "Bo is refunded once");
    assert.equal(cpOf(docs.strongbox), 1000);
});

test("two offers to craft planned from the same copy: the first lands, the second is refused", async () => {
    world.currentUser = "p2";
    const [id] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 1, requester: bo.uuid })).orders;
    const offered = await landsAfter(asUser("p1", () => orders.accept(id, vera.uuid)), () => orders.accept(id, bo.uuid));
    assert.equal(offered.ok, false);
    assert.deepEqual([read(`orders.${id}.crafter`), read(`orders.${id}.status`)], [vera.uuid, "accepted"]);
    assert.deepEqual(Object.values(read(`orders.${id}.log`)).map((e) => [e.event, e.by]), [["accept", "p1"]]);
});

test("a purge's refunds leave out what a cancel's open refund claim owes, and wait for it: each contributor is paid once", async () => {
    world.currentUser = "p1";
    assert.equal((await funds.deposit(vera.uuid, 1000)).outcome, "ok");
    const id = await startedOrder();
    world.currentUser = "p2";
    assert.equal((await orders.cancel(id)).ok, true);   // Bo's 300 cp refund claim waits (auto-claim off, say)
    world.currentUser = "gm00000000000000";
    assert.equal(await purge.runPurge({ returns: "refunds", settleMs: 0 }), "refunds");
    const owed = () => records("claims").filter((c) => c.kind === "refund" && !c.resolved)
        .map((c) => [c.actor === bo.uuid ? "Bo" : "Vera", c.cp, c.idem.split(":")[0]]).sort();
    assert.deepEqual(owed(), [["Bo", 300, "refund"], ["Vera", 1000, "purge-refund"]]);
    await boCollects();
    assert.equal(cpOf(bo), 5000);
    world.currentUser = "gm00000000000000";
    assert.equal(await purge.runPurge({ returns: "refunds", settleMs: 0 }), "refunds", "nothing new is issued while a refund waits");
    assert.deepEqual(owed(), [["Vera", 1000, "purge-refund"]]);
    world.currentUser = "p1";
    resetLease();
    requestLease("p1");
    await claims.sweepClaims({ force: true });
    assert.deepEqual([cpOf(vera), cpOf(bo), cpOf(docs.strongbox)], [5000, 5000, 0], "everyone is paid what they put in, once");
});

test("the lifecycle's extension hooks fire once each on the client that wrote: orderStatusChanged, ledgerPosted, itemCrafted (12.3, M10)", async () => {
    const seen = { status: [], posted: [], crafted: [] };
    Hooks.on("pf2e-artisans-workshop.orderStatusChanged", (p) => seen.status.push([p.from, p.to, Object.isFrozen(p.order)]));
    Hooks.on("pf2e-artisans-workshop.ledgerPosted", (p) => seen.posted.push(...p.rows.map((r) => r.kind)));
    Hooks.on("pf2e-artisans-workshop.itemCrafted", (p) => seen.crafted.push(p));
    const id = await toRolled();
    await orders.workDay(id);
    world.currentUser = "p2";
    await orders.pledgeTo(id, bo.uuid, 250);
    world.currentUser = "p1";
    assert.equal((await orders.finish(id)).outcome, "ok");
    const transitions = seen.status.map(([from, to]) => `${from}>${to}`);
    for (const step of ["null>requested", "accepted>setup", "check>rolled", "rolled>finishing", "finishing>complete"]) assert.ok(transitions.includes(step), `${step} in ${transitions}`);
    assert.ok(seen.status.every(([, , frozen]) => frozen), "frozen snapshots");
    for (const kind of ["pledge", "expend", "remainder", "shelved"]) assert.ok(seen.posted.includes(kind), `${kind} posted: ${seen.posted}`);
    assert.equal(seen.posted.filter((k) => k === "remainder").length, records("rows").filter((r) => r.kind === "remainder").length, "each row once, when it applied");
    assert.equal(seen.crafted.length, 1);
    const [crafted] = seen.crafted;
    assert.deepEqual([crafted.order.id, crafted.items.map((i) => [i.name, i.qty]), crafted.crafter, crafted.delivery],
        ["o1", [["Elixir of Life (Minor)", 2]], vera.uuid, "shelf"]);
    assert.equal((await orders.finish(id)).reason, "state");
    assert.equal(seen.crafted.length, 1, "finished once, announced once");
});
