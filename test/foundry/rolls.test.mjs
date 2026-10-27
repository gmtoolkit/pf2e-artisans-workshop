/**
 * The roll wrapper and the Earn Income roll (DESIGN.md 6.12, 6.10) over the fake world: what the Statistic is rolled
 * with, how a check's chat message is recorded (by whom, once, a reroll before and after settlement, a stale attempt),
 * settlement's money rows, and a wage day paid once.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MOD, addDocument, coin, flagsOf, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { DEGREE, RANK } = await import("../../scripts/logic/core.mjs");
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { hashId } = await import("../../scripts/logic/ids.mjs");
const { makeJob, orderLink, jobLink } = await import("../../scripts/logic/rolls.mjs");
const { wagePerDay } = await import("../../scripts/logic/earn-income.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const { records, write } = await import("../../scripts/foundry/store.mjs");
const rolls = await import("../../scripts/foundry/rolls.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

const ELIXIR = "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318";
const ELIXIR_OPTIONS = ["item:type:consumable", "item:slug:elixir-of-life-minor", "item:trait:alchemical", "item:trait:consumable",
    "item:trait:elixir", "item:trait:healing", "item:rarity:common", "item:level:1"];

/** pf2e's Modifier and an unsaved Item, as far as the wrapper uses them. */
game.pf2e = { Modifier: class { constructor(data) { Object.assign(this, data); } } };
CONFIG.Item = {
    documentClass: class {
        constructor(source, { parent }) { Object.assign(this, { name: source.name, parent }); }
        getRollOptions(prefix) { return ELIXIR_OPTIONS.map((o) => o.replace(/^item/, prefix)); }
    },
};

let docs;
let pc;
let rolled;
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const ledgerWrites = () => world.calls.filter(([kind, name, id]) => kind === "update" && name === "JournalEntry" && id === docs.ledger.id).length;

/** A statistic whose `roll` records its arguments. */
const statistic = (slug, rank) => ({ slug, rank, label: slug, roll: async (args) => { rolled.push(args); return { total: 20 }; } });

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    pc = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [
        coin("gp", 10),
        { type: "feat", name: "Specialty Crafting", system: { slug: "specialty-crafting" }, flags: { pf2e: { rulesSelections: { specialtyCrafting: "alchemy" } } } },
        { type: "feat", name: "Impeccable Crafting", _stats: { compendiumSource: REGISTRY["impeccable-crafting"].uuid } },
        { type: "feat", name: "Experienced Professional", system: { slug: "experienced-professional" } },
    ] });
    for (const item of pc.items) item.sourceId = item._stats?.compendiumSource ?? null;
    Object.assign(pc, { level: 9, skills: { crafting: statistic("crafting", RANK.master), "cooking-lore": statistic("cooking-lore", RANK.expert) } });
    world.compendium = { [ELIXIR]: { name: "Elixir of Life (Minor)", toObject: () => ({ name: "Elixir of Life (Minor)" }) } };
    setUsers([{ id: "p1", character: pc }, { id: "p2" }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
    rolled = [];
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

/** An order waiting for its Craft check. */
async function orderInCheck(fields = {}) {
    const order = { id: "o1", v: 1, status: "check", attempt: 1, crafter: pc.uuid, skill: "crafting", craftType: "item", route: "known",
        product: { uuid: ELIXIR, snapshot: { traits: ["alchemical", "consumable"] } }, dc: { final: 17 }, check: null, ...fields };
    await write({ set: { "orders.o1": order } });
    return order;
}

/** A pf2e check message for an order or a job. */
function message({ id = "m1", author = "p1", outcome = "success", link = orderLink("o1", 1), total = 20, die = 10, dc = 17, isReroll = false, extra = [],
    resource = "hero-points" } = {}) {
    const rerollOptions = isReroll ? ["check:reroll", ...(resource ? [`check:reroll:${resource}`] : [])] : [];
    const options = [link, "action:craft", ...extra, ...rerollOptions];
    return { id, author: { id: author }, actor: pc, rolls: [{ total, dice: [{ faces: 20, total: die }] }],
        flags: { pf2e: { context: { outcome, unadjustedOutcome: outcome, dc: { value: dc }, options, isReroll } } } };
}

/* -------------------------------------------- */
/*  Rolling                                      */
/* -------------------------------------------- */

test("a Craft check rolls the order's skill with the explicit DC, action:craft, the product's options, the registry's and the link", async () => {
    await orderInCheck();
    assert.deepEqual(await rolls.rollCraft("o1", { skipDialog: true }), { ok: true, total: 20 });
    const [args] = rolled;
    assert.equal(args.dc.value, 17);
    assert.equal(args.dc.label, "pf2e-artisans-workshop.Roll.CraftDC");
    for (const option of ["action:craft", "item:trait:alchemical", "alchemy", "speciality", orderLink("o1", 1)]) assert.ok(args.extraRollOptions.includes(option), option);
    assert.deepEqual(args.traits, ["downtime", "manipulate"]);
    assert.equal(args.item, undefined, "the product is never passed as the roll's item");
    assert.deepEqual([args.skipDialog, args.createMessage], [true, true]);
    await rolls.rollCraft("o1");
    assert.equal(rolled[1].skipDialog, undefined, "left to pf2e, which applies the user's own check-dialog setting");
});

test("the wrapper refuses an order that is not waiting for its check, or a crafter this user does not own", async () => {
    await orderInCheck({ status: "setup" });
    assert.equal((await rolls.rollCraft("o1")).reason, "state");
    await orderInCheck({ crafter: addDocument("Actor", { name: "Other" }).uuid });
    assert.equal((await rolls.rollCraft("o1")).reason, "not-owner");
    assert.equal((await rolls.rollCraft("nope")).reason, "no-order");
    assert.equal(rolled.length, 0);
});

/* -------------------------------------------- */
/*  Recording                                    */
/* -------------------------------------------- */

test("the message's author records the check, in the tab that holds the lease; nobody else writes", async () => {
    await orderInCheck();
    assert.equal(await rolls.onCheckMessage(message({ author: "p2" })), null, "another user's message");
    assert.equal(await rolls.onCheckMessage({ id: "x", author: { id: "p1" }, flags: {} }), null, "not a linked check");
    resetLease();
    assert.equal(await rolls.onCheckMessage(message()), null, "a tab without the lease");
    requestLease("p1");
    const before = ledgerWrites();
    const result = await rolls.onCheckMessage(message());
    assert.equal(result.ok, true);
    assert.equal(ledgerWrites() - before, 1, "one write");
    const order = flagsOf(docs.ledger).orders.o1;
    assert.equal(order.status, "rolled");
    assert.deepEqual({ ...order.check, at: undefined, by: undefined }, {
        degree: DEGREE.success, unadjusted: DEGREE.success, total: 20, die: 10, rerolled: false, fortune: false, warn: false, messageId: "m1",
        shifted: false, attempt: 1, level: 9, rank: RANK.master, settled: false, at: undefined, by: undefined,
    });
});

test("Impeccable Crafting: a success the roll marked with the specialty option is recorded as a critical success", async () => {
    await orderInCheck();
    await rolls.onCheckMessage(message({ extra: ["alchemy", "speciality"] }));
    const { check } = flagsOf(docs.ledger).orders.o1;
    assert.deepEqual([check.degree, check.unadjusted, check.shifted], [DEGREE.critSuccess, DEGREE.success, true]);
});

test("a Hero Point reroll before settlement replaces the check, once; a reroll of an older attempt is refused", async () => {
    await orderInCheck();
    await rolls.onCheckMessage(message({ outcome: "failure", total: 15, die: 5 }));
    const before = ledgerWrites();
    const reroll = await rolls.onCheckMessage(message({ id: "m2", outcome: "success", total: 19, die: 14, isReroll: true }));
    assert.equal(reroll.ok, true);
    assert.equal(ledgerWrites() - before, 1);
    const { check } = flagsOf(docs.ledger).orders.o1;
    assert.deepEqual([check.degree, check.rerolled, check.fortune, check.warn, check.messageId], [DEGREE.success, true, true, true, "m2"]);
    await write({ set: { "orders.o1.attempt": 2, "orders.o1.status": "check" } });
    const stale = await rolls.onCheckMessage(message({ id: "m3", isReroll: true }));
    assert.equal(stale.reason, "stale-attempt");
});

test("a second first roll for the same attempt is refused: it never replaces the check, and the roller is told", async () => {
    await orderInCheck();
    // Two dialogs open at once (or a double click, or a second device): roll A fails, then roll B succeeds.
    assert.equal((await rolls.onCheckMessage(message({ id: "m1", outcome: "failure", total: 12, die: 4 }))).ok, true);
    const before = ledgerWrites();
    const second = await rolls.onCheckMessage(message({ id: "m2", outcome: "criticalSuccess", total: 30, die: 19 }));
    assert.equal(second.reason, "rolled");
    assert.equal(ledgerWrites(), before, "nothing written");
    const order = flagsOf(docs.ledger).orders.o1;
    assert.deepEqual([order.check.messageId, order.check.degree, order.conflict], ["m1", DEGREE.fail, undefined]);
    assert.deepEqual(world.notes.at(-1), ["warn", "pf2e-artisans-workshop.Roll.AlreadyRolled", { localize: true }]);
    // The first message recorded again (a second tab without Web Locks) is harmless.
    assert.equal((await rolls.onCheckMessage(message({ id: "m1", outcome: "failure", total: 12, die: 4 }))).ok, true);
    assert.equal(flagsOf(docs.ledger).orders.o1.check.messageId, "m1");
});

test("a reroll that arrives after settlement is kept as a conflict, and the settled check stands", async () => {
    await orderInCheck({ status: "failed", check: { degree: DEGREE.fail, settled: true, attempt: 1 } });
    const result = await rolls.onCheckMessage(message({ id: "m9", isReroll: true }));
    assert.equal(result.reason, "settled");
    const order = flagsOf(docs.ledger).orders.o1;
    assert.equal(order.check.degree, DEGREE.fail);
    assert.deepEqual([order.conflict.messageId, order.conflict.degree, order.conflict.by], ["m9", DEGREE.success, "p1"]);
});

test("a reroll for an attempt whose settlement rows exist is a conflict, even if a late write cleared settled", async () => {
    // The settlement (a failure: one release row with the order's new state) landed, then a reroll recorded from a
    // copy that had not seen it overwrote the check: rolled, unsettled, while the release row stays.
    await orderInCheck({ status: "rolled", check: { degree: DEGREE.success, settled: false, attempt: 1, messageId: "m2", rerolled: true } });
    await money.postRows([{ kind: "release", idem: "release:o1:1:0", cp: 100, order: "o1" }]);
    const result = await rolls.onCheckMessage(message({ id: "m3", outcome: "criticalSuccess", total: 30, die: 18, isReroll: true }));
    assert.equal(result.reason, "settled");
    const order = flagsOf(docs.ledger).orders.o1;
    assert.deepEqual([order.check.messageId, order.conflict.messageId], ["m2", "m3"], "the check stands; the reroll is kept as a conflict");
    // Another attempt's rows do not count: attempt 2 records its first roll.
    await write({ set: { "orders.o1.attempt": 2, "orders.o1.status": "check" }, replace: { "orders.o1.check": null } });
    assert.equal((await rolls.onCheckMessage(message({ id: "m4", link: orderLink("o1", 2) }))).ok, true);
});

test("under downtimeRerolls: block, a fortune reroll is not recorded and the user is told", async () => {
    world.settings.set(`${MOD}.rules.downtimeRerolls`, "block");
    await orderInCheck();
    await rolls.onCheckMessage(message({ outcome: "failure" }));
    const result = await rolls.onCheckMessage(message({ id: "m2", isReroll: true }));
    assert.equal(result.reason, "fortune-blocked");
    assert.equal(flagsOf(docs.ledger).orders.o1.check.degree, DEGREE.fail);
    assert.deepEqual(world.notes.at(-1), ["warn", "pf2e-artisans-workshop.Roll.FortuneBlocked", { localize: true }]);
    // pf2e's free "Reroll (keep new)" from the chat menu spends no Hero Point, and is blocked all the same.
    const free = await rolls.onCheckMessage(message({ id: "m3", outcome: "criticalSuccess", isReroll: true, resource: null }));
    assert.equal(free.reason, "fortune-blocked");
    assert.equal(flagsOf(docs.ledger).orders.o1.check.degree, DEGREE.fail);
});

test("an outcome that does not map to a degree is never recorded", async () => {
    await orderInCheck();
    const result = await rolls.onCheckMessage(message({ outcome: "bogus" }));
    assert.equal(result.reason, "no-outcome");
    assert.equal(flagsOf(docs.ledger).orders.o1.status, "check");
});

/* -------------------------------------------- */
/*  Settling                                     */
/* -------------------------------------------- */

/** An order in `rolled` with `degree`, its escrow pledged and the up-front half committed. */
async function rolledOrder(degree, upfront = 100) {
    await orderInCheck({ status: "rolled", check: { degree, settled: false, attempt: 1 } });
    await money.pledge({ actor: pc, cp: 200, order: "o1", nonce: "n1" });
    await money.postRows([{ kind: "commit", idem: "commit:o1:1:0", cp: upfront, order: "o1" }]);
}

test("settling a success expends the committed half out of the strongbox with the order's new state, once", async () => {
    await rolledOrder(DEGREE.success);
    const result = await rolls.settleOrder("o1");
    assert.equal(result.outcome, "ok");
    const order = flagsOf(docs.ledger).orders.o1;
    assert.deepEqual([order.status, order.check.settled], ["finishing", true]);
    const expend = records("rows").filter((row) => row.kind === "expend");
    assert.deepEqual(expend.map((row) => [row.idem, row.cp, row.state]), [[`expend:o1:1:0:${pc.uuid}`, 100, "applied"]]);
    assert.equal(cpOf(docs.strongbox), 100);
    assert.equal((await rolls.settleOrder("o1")).reason, "state", "settled already");
});

test("settling a critical failure ruins 10% and releases the rest in one request; a failure only releases", async () => {
    await rolledOrder(DEGREE.critFail);
    const result = await rolls.settleOrder("o1");
    assert.equal(result.outcome, "ok");
    assert.deepEqual(result.notices, ["alchemical-crit-fail"]);
    const kinds = (kind) => records("rows").filter((row) => row.kind === kind).map((row) => [row.cp, row.state]);
    assert.deepEqual(kinds("ruin"), [[10, "applied"]]);
    assert.deepEqual(kinds("release"), [[90, "applied"]]);
    assert.equal(flagsOf(docs.ledger).orders.o1.status, "failed");

    resetWorld();
    state.resetState();
    docs = sharedWorld();
    pc = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 10)] });
    Object.assign(pc, { level: 9, skills: { crafting: statistic("crafting", RANK.master) } });
    setUsers([{ id: "p1", character: pc }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    registerBatchWatcher();
    await rolledOrder(DEGREE.fail);
    const fail = await rolls.settleOrder("o1");
    assert.equal(fail.outcome, "ok");
    assert.deepEqual(records("rows").filter((row) => row.kind === "release").map((row) => row.cp), [100]);
    assert.equal(cpOf(docs.strongbox), 200, "nothing left the strongbox");
});

/* -------------------------------------------- */
/*  Earn Income                                  */
/* -------------------------------------------- */

async function openJob(fields = {}) {
    const job = { ...makeJob({ id: "j1", actor: pc.uuid, skill: "cooking-lore", taskLevel: 3, dc: 18 }, { by: "p1", at: { world: 0, real: 0 } }), ...fields };
    await write({ set: { "jobs.j1": job } });
    return job;
}

test("an Earn Income check rolls with action:earn-income and the job's link, and records the pay with Experienced Professional", async () => {
    await openJob();
    assert.equal((await rolls.rollEarnIncome("j1", { skipDialog: true })).ok, true);
    const [args] = rolled;
    assert.deepEqual(args.extraRollOptions, ["action:earn-income", jobLink("j1")]);
    assert.deepEqual([args.dc.value, args.traits], [18, ["downtime"]]);
    const result = await rolls.onCheckMessage(message({ link: jobLink("j1"), outcome: "failure", total: 12, die: 6, dc: 18 }));
    assert.equal(result.ok, true);
    const job = flagsOf(docs.ledger).jobs.j1;
    const single = wagePerDay({ taskLevel: 3, rank: RANK.expert, degree: DEGREE.fail, skill: "cooking-lore" });
    assert.deepEqual([job.perDayCp, job.status, job.check.rank, job.check.level], [2 * single, "open", RANK.expert, 9]);
    assert.equal((await rolls.rollEarnIncome("j1")).reason, "rolled");
});

test("a wage day is paid once however often it is resolved; another client files a claim instead", async () => {
    await openJob({ check: { degree: DEGREE.success }, perDayCp: 30 });
    const before = cpOf(pc);
    assert.equal((await rolls.payWage("j1", 1)).outcome, "ok");
    assert.equal((await rolls.payWage("j1", 1)).outcome, "already");
    assert.equal(cpOf(pc) - before, 30);
    assert.equal(records("rows").filter((row) => row.kind === "wage").length, 1);
    // Player Two resolves day 2: not responsible for Vera, so a claim with the row's own key.
    setUsers([{ id: "p1", character: pc }, { id: "p2" }, { id: "gm00000000000000", isGM: true }], "p2");
    const claimed = await rolls.payWage("j1", 2);
    assert.equal(claimed.outcome, "claimed");
    const [claim] = Object.values(flagsOf(docs.ledger).claims);
    assert.deepEqual([claim.kind, claim.cp, claim.day, claim.id], ["wage", 30, 2, hashId("wage:j1:2:0")]);
    assert.equal((await rolls.payWage("j1", 2)).outcome, "already", "the claim exists");
    assert.equal((await rolls.payWage("j9", 1)).reason, "no-job");
    // A Hero Point reroll after day 1 was paid at the earlier rate: kept as a conflict, the paid check stands.
    const late = await rolls.onCheckMessage(message({ id: "m7", author: "p2", link: jobLink("j1"), outcome: "criticalSuccess", total: 30, die: 15, dc: 18, isReroll: true }));
    assert.equal(late.reason, "paid");
    assert.deepEqual([flagsOf(docs.ledger).jobs.j1.perDayCp, flagsOf(docs.ledger).jobs.j1.conflict.messageId], [30, "m7"]);
    await openJob({ check: null });
    assert.equal((await rolls.payWage("j1", 1)).reason, "unrolled");
});
