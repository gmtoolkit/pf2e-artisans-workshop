/**
 * Downtime over the fake world (DESIGN.md 4.8, 6.7, 6.10, 9, M6): the workshop day with the World Clock offset and the
 * logged days, a PC's downtime status, the one prompt when days accrue, the day resolver and the Advance days wizard
 * (with a GM moving the clock, and with players only), Earn Income jobs paid once per day across repeated resolutions
 * and two devices, settlement profiles capping task levels, and Communal Crafting helpers joining, rolling and leaving.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { addDocument, asUser, coin, flagsOf, installFoundry, interleave, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { DEGREE, RANK } = await import("../../scripts/logic/core.mjs");
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { reductionCp } = await import("../../scripts/logic/progress.mjs");
const { helpLink, jobLink } = await import("../../scripts/logic/rolls.mjs");
const { wagePerDay } = await import("../../scripts/logic/earn-income.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const communal = await import("../../scripts/foundry/communal.mjs");
const downtime = await import("../../scripts/foundry/downtime.mjs");
const jobs = await import("../../scripts/foundry/jobs.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const orders = await import("../../scripts/foundry/orders.mjs");
const rolls = await import("../../scripts/foundry/rolls.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, write } = await import("../../scripts/foundry/store.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const DAY = 86400;

let docs;
let vera;
let bo;
let rolled;
const statistic = (slug, rank) => ({ slug, rank, label: slug, roll: async (args) => { rolled.push(args); return { total: 20 }; } });

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    orders.resetOrders();
    downtime.resetDowntime();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [
        coin("gp", 50), { type: "feat", name: "Communal Crafting", sourceId: REGISTRY["communal-crafting"].uuid },
    ] });
    Object.assign(vera, { level: 5, skills: { crafting: statistic("crafting", RANK.expert) }, system: {} });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 10)] });
    Object.assign(bo, { level: 10, skills: { crafting: statistic("crafting", RANK.expert), "cooking-lore": statistic("cooking-lore", RANK.expert) }, system: {} });
    world.collections.Actor.party = { id: "party", members: [vera, bo] };
    ChatMessage.implementation.getSpeaker = () => ({});
    game.time.worldTime = 0;
    game.time.advance = async (seconds) => {
        game.time.worldTime += seconds;
        Hooks.callAll("updateWorldTime", game.time.worldTime, seconds, {}, game.user.id);
    };
    game.pf2e = { settings: { variants: { pwol: { enabled: false } } } };
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
    rolled = [];
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

/** As another user (another client), then back. */
const as = (user, action) => asUser(user, action)();

/** A pf2e check message linked by `link`. */
function message({ id = "m1", link, outcome = "success", author = "p1", actor = vera, dc = 15, total = 20, die = 10, isReroll = false }) {
    return { id, author: { id: author }, actor, rolls: [{ total, dice: [{ faces: 20, total: die }] }],
        flags: { pf2e: { context: { outcome, unadjustedOutcome: outcome, dc: { value: dc }, options: [link], isReroll } } } };
}

/** An order Vera crafts, written straight into the ledger. */
async function order(fields = {}) {
    const o = { id: "o1", v: 1, status: "setup", attempt: 1, crafter: vera.uuid, requester: vera.uuid, skill: "crafting", craftType: "item",
        setup: { days: 1, hours: 0 }, priceCp: 6500, upfrontCp: 3250, dc: { final: 19 }, check: null, helpers: {}, log: {},
        product: { uuid: "Compendium.x", snapshot: { name: "Rune", traits: [] } }, ...fields };
    await write({ set: { [`orders.${o.id}`]: o } });
    return o;
}

/* -------------------------------------------- */
/*  The workshop day                             */
/* -------------------------------------------- */

test("the workshop day: the clock from pf2e's World Clock date, the logged days on top, the offset frozen once (4.8)", async () => {
    game.pf2e.settings.worldClock = { worldCreatedOn: "2026-01-01T12:00:00Z" };
    assert.equal(downtime.today().day, 0);
    game.time.worldTime = 12 * 3600;
    assert.equal(downtime.today().day, 1, "midnight of the World Clock's date, 12 hours in");
    assert.equal(await downtime.freezeDayOffset(), true);
    assert.equal(read("meta.dayOffset"), 12 * 3600);
    game.pf2e.settings.worldClock.worldCreatedOn = "2026-01-01T00:00:00Z";
    assert.equal(downtime.today().day, 1, "the frozen offset stands");
    assert.equal(await downtime.freezeDayOffset(), false, "frozen once");
    await write({ set: { "meta.manual.r1": { id: "r1", v: 1, fromDay: 2, toDay: 5 } } });
    assert.deepEqual([downtime.today().day, downtime.today().ahead], [5, 4], "logged days run ahead of the clock");
});

/* -------------------------------------------- */
/*  Status and the prompt                        */
/* -------------------------------------------- */

test("a PC in downtime gets one pending day per day the clock moves, and its owner's client one prompt (9.1)", async () => {
    assert.equal((await downtime.setDowntime(vera.uuid, true)).ok, true);
    assert.deepEqual([downtime.statusOf(vera).inDowntime, downtime.statusOf(vera).since], [true, 0]);
    assert.deepEqual(downtime.promptPending(), [], "nothing pending on the day downtime begins");
    await game.time.advance(DAY);
    assert.equal(downtime.pendingOf(vera).count, 1);
    const notes = world.notes.length;
    assert.deepEqual(downtime.promptPending().map((a) => a.name), ["Vera"]);
    assert.equal(world.notes.length, notes + 1);
    assert.deepEqual(downtime.promptPending(), [], "one prompt per day on this client");
    assert.deepEqual(await as("p2", () => downtime.promptPending()), [], "Player Two's client is not Vera's");
    assert.deepEqual(await as("gm00000000000000", () => downtime.promptPending()), [], "nor the GM's while her player is connected");
    world.collections.User.get("p1").active = false;
    downtime.resetDowntime();   // the GM's client has its own memory of what it prompted
    assert.deepEqual((await as("gm00000000000000", () => downtime.promptPending())).map((a) => a.name), ["Vera"], "with her player away, the GM's");
    assert.equal((await as("p2", () => downtime.setDowntime(vera.uuid, false))).reason, "not-owner", "a status is its owner's to write");
});

test("ending downtime with days to resolve asks first; counting them as not downtime records the span with no effects (4.8)", async () => {
    await downtime.setDowntime(vera.uuid, true);
    await game.time.advance(3 * DAY);
    assert.deepEqual(await downtime.setDowntime(vera.uuid, false), { ok: false, reason: "days-pending", data: { count: 3 } });
    assert.equal((await downtime.setDowntime(vera.uuid, false, { notDowntime: true })).ok, true);
    const [record] = records("days");
    assert.deepEqual([record.id, record.day, record.toDay, record.result, record.activity], [`${vera.id}-1`, 1, 3, "not-downtime", null]);
    assert.equal(downtime.statusOf(vera).inDowntime, false);
    assert.equal(downtime.resolvedOf(vera), 3);
});

/* -------------------------------------------- */
/*  The day resolver                             */
/* -------------------------------------------- */

test("resolving: a setup day moves the order to its check and the next day stays pending until the check is rolled", async () => {
    await order();
    await downtime.setDowntime(vera.uuid, true);
    await downtime.setActivity(vera.uuid, { kind: "craft", ref: "o1" });
    await game.time.advance(2 * DAY);
    const result = await downtime.resolveDays({ actor: vera });
    assert.deepEqual([result.ok, result.records.map((r) => r.kind), result.stop.reason], [true, ["setup"], "check"]);
    assert.equal(read("orders.o1.status"), "check", "the crafter's owner moves it");
    assert.equal(downtime.pendingOf(vera).count, 1, "day 2 waits for the check");
    assert.equal((await downtime.resolveDays({ actor: vera })).records.length, 0, "and still does until the roll");
});

test("a runner who does not own the crafter writes the days only; the crafter's client moves the order to its check (4.2.4)", async () => {
    await order();
    await downtime.setDowntime(vera.uuid, true);
    await downtime.setActivity(vera.uuid, { kind: "craft", ref: "o1" });
    await game.time.advance(DAY);
    const result = await as("p2", () => downtime.resolveDays({ actor: vera }));
    assert.deepEqual([result.ok, result.records.length], [true, 1]);
    assert.equal(read("orders.o1.status"), "setup", "Player Two writes the day record, not Vera's order");
    await orders.onOrdersChanged(["o1"]);   // Vera's client is responsible for her
    assert.equal(read("orders.o1.status"), "check");
});

test("two resolutions of the same days planned from one copy: the first lands, the other is refused and writes nothing", async () => {
    await order({ status: "finishing", check: { degree: DEGREE.success, level: 5, rank: RANK.expert, settled: true } });
    await downtime.setDowntime(vera.uuid, true);
    await game.time.advance(DAY);
    const restore = interleave(() => true, asUser("p1", () => downtime.resolveDays({ actor: vera, activity: { kind: "craft", ref: "o1" } })));
    const second = await downtime.resolveDays({ actor: vera, activity: { kind: "retrain" } });
    restore();
    assert.deepEqual([second.ok, second.reason], [false, "taken"]);
    const [day] = records("days");
    assert.deepEqual([day.kind, day.crafterCp], ["extra", 100], "the first device's day stands");
});

/* -------------------------------------------- */
/*  Earn Income and settlements                  */
/* -------------------------------------------- */

/** The GM keeps a town; Player Two puts the party in it and takes a Cooking Lore job at task level 3; Bo rolls a success. */
async function boJob() {
    const saved = await as("gm00000000000000", () => jobs.saveProfile({ name: "Otari", size: "town", level: 3 }));
    assert.equal(saved.ok, true);
    assert.equal((await as("p2", () => jobs.setSettlement(saved.id))).ok, true);
    const started = await as("p2", () => jobs.startJob({ actor: bo.uuid, skill: "cooking-lore", taskLevel: 3 }));
    assert.equal(started.ok, true, JSON.stringify(started));
    const recorded = await as("p2", () => rolls.onCheckMessage(message({ link: jobLink(started.job, 1), author: "p2", actor: bo, dc: 18 })));
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    await as("p2", () => downtime.setDowntime(bo.uuid, true));
    return started.job;
}

test("settlement profiles: the GM keeps them, any member sets the current one, and it caps the task level (6.10)", async () => {
    assert.equal((await jobs.saveProfile({ name: "Otari", size: "town" })).reason, "not-gm", "players cannot write world settings");
    const saved = await as("gm00000000000000", () => jobs.saveProfile({ name: "Otari", size: "town", level: 3, caps: { "cooking-lore": 5 } }));
    assert.equal((await as("p2", () => jobs.setSettlement(saved.id))).ok, true, "with no GM needed");
    assert.deepEqual([jobs.settlement().name, jobs.settlementRecord().by], ["Otari", "p2"]);
    const tooHigh = await as("p2", () => jobs.startJob({ actor: bo.uuid, skill: "crafting", taskLevel: 4 }));
    assert.deepEqual([tooHigh.reason, tooHigh.data.max], ["task-level-cap", 3]);
    assert.equal((await as("p2", () => jobs.startJob({ actor: bo.uuid, skill: "cooking-lore", taskLevel: 5 }))).ok, true, "the Lore's exception");
    await as("p2", () => jobs.setSettlement(null));
    const anywhere = await as("p2", () => jobs.startJob({ actor: bo.uuid, skill: "crafting", taskLevel: 12 }));
    assert.deepEqual([anywhere.ok, anywhere.unconfirmed], [true, true], "no settlement: any level, marked unconfirmed (OQ-17)");
    assert.equal((await jobs.startJob({ actor: bo.uuid, skill: "crafting", taskLevel: 1 })).reason, "not-owner");
});

test("an Earn Income job pays each day once: resolved twice, by a runner as a claim, and the job's activity set (6.10)", async () => {
    const id = await boJob();
    const job = read(`jobs.${id}`);
    const pay = wagePerDay({ taskLevel: 3, rank: RANK.expert, degree: DEGREE.success, skill: "cooking-lore" });
    assert.deepEqual([job.perDayCp, job.dc, downtime.statusOf(bo).activity], [pay, 18, { kind: "earn", ref: id }]);
    await game.time.advance(2 * DAY);
    const before = cpOf(bo);
    requestLease("p2");
    const first = await as("p2", () => downtime.resolveDays({ actor: bo }));
    assert.deepEqual([first.records.length, first.wages.map((w) => w.result.outcome)], [2, ["ok", "ok"]]);
    assert.equal(cpOf(bo) - before, 2 * pay);
    assert.equal((await as("p2", () => downtime.resolveDays({ actor: bo }))).reason, "no-days", "resolved twice: nothing more");
    // Player One runs the wizard for a day: Bo is not Player One's to pay, so the wage is a claim Bo's client collects.
    const run = await downtime.advanceDays({ count: 1 });
    const boResult = run.results.find((r) => r.actor === bo);
    assert.equal(boResult.wages[0].result.outcome, "claimed");
    assert.equal(cpOf(bo) - before, 2 * pay, "nothing minted by Player One's client");
    assert.equal(await as("p2", () => claims.sweepClaims()), 1);
    assert.equal(await as("p2", () => claims.sweepClaims()), 0);
    assert.equal(cpOf(bo) - before, 3 * pay);
    assert.equal(records("rows").filter((r) => r.kind === "wage").length, 3, "one wage row a day");
});

test("two devices of the earner resolving the same day: one record, one wage (6.10)", async () => {
    const id = await boJob();
    await game.time.advance(DAY);
    requestLease("p2");
    const before = cpOf(bo);
    const restore = interleave(() => true, asUser("p2", () => downtime.resolveDays({ actor: bo })));
    const late = await as("p2", () => downtime.resolveDays({ actor: bo }));
    restore();
    assert.equal(late.reason, "taken");
    assert.equal(records("rows").filter((r) => r.kind === "wage" && r.job === id).length, 1);
    assert.equal(cpOf(bo) - before, read(`jobs.${id}.perDayCp`));
});

test("a day record whose wage never landed is paid by the earner's client at the sweep, once", async () => {
    const id = await boJob();
    const cp = read(`jobs.${id}.perDayCp`);
    await write({ set: { [`days.${bo.id}-7`]: { id: `${bo.id}-7`, v: 1, actor: bo.id, day: 7, toDay: 7, activity: { kind: "earn", ref: id }, job: id, wageCp: cp, rows: [] } } });
    const before = cpOf(bo);
    assert.equal(await downtime.sweepWages(), 0, "Player One's client is not Bo's");
    requestLease("p2");
    assert.equal(await as("p2", () => downtime.sweepWages()), 1);
    assert.equal(await as("p2", () => downtime.sweepWages()), 0);
    assert.equal(cpOf(bo) - before, cp);
});

test("a resumed job is rolled again only after a level or rank change; the earlier round's reroll is refused as stale", async () => {
    const id = await boJob();
    assert.equal((await as("p2", () => jobs.rerollJob(id))).reason, "same");
    bo.level = 11;
    assert.equal((await as("p2", () => jobs.rerollJob(id))).ok, true);
    assert.deepEqual([read(`jobs.${id}.round`), read(`jobs.${id}.check`)], [2, null]);
    const stale = await as("p2", () => rolls.onCheckMessage(message({ id: "m9", link: jobLink(id, 1), author: "p2", actor: bo, dc: 18, isReroll: true })));
    assert.equal(stale.reason, "stale-round");
    assert.equal((await as("p2", () => rolls.rollEarnIncome(id, { skipDialog: true }))).ok, true);
    assert.equal(rolled.at(-1).extraRollOptions.at(-1), jobLink(id, 2));
    assert.equal((await as("p2", () => jobs.undoJob(id))).event, "reroll", "undo takes the round back");
    assert.equal(read(`jobs.${id}.round`), 1);
});

test("a reroll after a wage claim was filed at the earlier rate is kept as a conflict (the 6.12 follow-up)", async () => {
    const id = await boJob();
    await game.time.advance(DAY);
    await downtime.resolveDays({ actor: bo });   // Player One: a claim, not yet collected
    assert.equal(records("claims").filter((c) => c.kind === "wage").length, 1);
    const late = await as("p2", () => rolls.onCheckMessage(message({ id: "m2", link: jobLink(id, 1), author: "p2", actor: bo, dc: 18, outcome: "criticalSuccess", isReroll: true })));
    assert.equal(late.reason, "paid");
    assert.equal(read(`jobs.${id}.conflict.messageId`), "m2");
});

test("ending a job stops its days; undo reopens it; a job never worked can be undone away", async () => {
    const id = await boJob();
    assert.equal((await as("p2", () => jobs.endJob(id))).ok, true);
    assert.equal(downtime.statusOf(bo).activity, null, "the earner's activity is cleared");
    await game.time.advance(DAY);
    assert.equal((await as("p2", () => downtime.resolveDays({ actor: bo, activity: { kind: "earn", ref: id } }))).stop.reason, "job-ended");
    assert.equal((await as("p2", () => jobs.undoJob(id))).event, "end");
    assert.equal(read(`jobs.${id}.status`), "open");
    const fresh = await as("p2", () => jobs.startJob({ actor: bo.uuid, skill: "crafting", taskLevel: 1 }));
    assert.equal((await as("p2", () => jobs.undoJob(fresh.job))).event, "start");
    assert.equal(read(`jobs.${fresh.job}`), undefined);
});

/* -------------------------------------------- */
/*  Communal Crafting                            */
/* -------------------------------------------- */

test("a helper joins, rolls against the item's DC, adds their share to the crafter's days, and forfeits it on leaving (6.7)", async () => {
    await order({ status: "finishing", check: { degree: DEGREE.success, level: 5, rank: RANK.expert, settled: true } });
    // Player Two cannot read Vera's sheet: her feats come from her roster snapshot (4.10).
    assert.deepEqual((await as("p2", () => communal.joinOrder("o1", bo.uuid, "crafting"))).data.reasons, ["no-feat"]);
    await write({ replace: { [`roster.${vera.id}`]: { id: vera.id, v: 1, level: 5, skills: { crafting: RANK.expert }, feats: ["communal-crafting"] } } });
    const joined = await as("p2", () => communal.joinOrder("o1", bo.uuid, "crafting"));
    assert.deepEqual([joined.ok, joined.accepted], [true, true], "Vera has the feat");
    assert.deepEqual(downtime.statusOf(bo).activity, { kind: "help", ref: "o1" });
    assert.equal((await as("p2", () => communal.rollHelp("o1", bo.uuid, { skipDialog: true }))).ok, true);
    assert.deepEqual([rolled.at(-1).dc.value, rolled.at(-1).extraRollOptions], [19, [helpLink("o1", bo.id)]], "the item's Craft DC");
    const recorded = await as("p2", () => rolls.onCheckMessage(message({ link: helpLink("o1", bo.id), author: "p2", actor: bo, dc: 19 })));
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    const helper = read(`orders.o1.helpers.${bo.id}`);
    assert.deepEqual([helper.degree, helper.level, helper.rank], [DEGREE.success, 10, RANK.expert]);
    // Two of Vera's days: her 1 gp, and Bo's level-9 expert amount, 4 gp (Player Core p.253 by the author's defaults).
    const worked = await downtime.resolveDays({ actor: vera, activity: { kind: "craft", ref: "o1" }, count: 2 });
    assert.deepEqual(worked.records.map((r) => r.helpers), [{ [bo.id]: 400 }, { [bo.id]: 400 }]);
    assert.equal(reductionCp(read("orders.o1"), records("days")), 1000);
    const helping = await as("p2", () => downtime.resolveDays({ actor: bo, count: 1 }));
    assert.equal(helping.records[0].result, "help", "Bo's own day is spent helping");
    const elsewhere = await as("p2", () => downtime.resolveDays({ actor: bo, activity: { kind: "retrain" }, count: 1 }));
    assert.equal(elsewhere.stop.reason, "locked", "locked to the order until it ends or he leaves");
    const left = await as("p2", () => communal.leaveOrder("o1", bo.uuid));
    assert.deepEqual([left.ok, left.forfeits], [true, true]);
    assert.equal(left.leftDay, 3, "the first day neither has resolved: Vera's days 1-2 counted him (review fix)");
    assert.equal(reductionCp(read("orders.o1"), records("days")), 200, "his help no longer counts");
    assert.equal(downtime.statusOf(bo).activity, null);
    assert.equal((await as("p2", () => communal.joinOrder("o1", bo.uuid, "crafting"))).reason, "left", "and he does not come back");
});

test("a helper who brings the feat waits for the crafter to accept; until then they add nothing (6.7)", async () => {
    vera.items.delete([...vera.items.values()].find((i) => i.type === "feat").id);
    bo.addItem({ type: "feat", name: "Communal Crafting", sourceId: REGISTRY["communal-crafting"].uuid });
    await order({ status: "finishing", check: { degree: DEGREE.success, level: 5, rank: RANK.expert, settled: true } });
    const elig = await as("p2", () => communal.eligibility(read("orders.o1"), bo, "crafting"));
    assert.deepEqual([elig.ok, elig.needsAcceptance], [true, true]);
    const joined = await as("p2", () => communal.joinOrder("o1", bo.uuid, "crafting"));
    assert.equal(joined.accepted, false);
    await write({ set: { [`orders.o1.helpers.${bo.id}.degree`]: DEGREE.success } });
    const before = await downtime.resolveDays({ actor: vera, activity: { kind: "craft", ref: "o1" }, count: 1 });
    assert.deepEqual(before.records[0].helpers, {});
    assert.equal((await as("p2", () => communal.acceptHelper("o1", bo.id))).reason, "not-owner", "the crafter's owner accepts");
    assert.equal((await communal.acceptHelper("o1", bo.id)).outcome, "ok");
    const after = await downtime.resolveDays({ actor: vera, activity: { kind: "craft", ref: "o1" }, count: 1 });
    assert.deepEqual(after.records[0].helpers, { [bo.id]: 400 });
    const noFeat = await as("p2", () => communal.eligibility(read("orders.o1"), vera, "crafting"));
    assert.deepEqual(noFeat.reasons, ["no-feat"], "without either feat, no help");
});

/* -------------------------------------------- */
/*  The Advance days wizard                      */
/* -------------------------------------------- */

test("the wizard with players only logs the days; run again it changes nothing; the day hooks fire (9.2, 12.3)", async () => {
    world.collections.User.get("gm00000000000000").active = false;
    await downtime.setDowntime(vera.uuid, true);
    await downtime.setActivity(vera.uuid, { kind: "subsist" });
    await as("p2", () => downtime.setDowntime(bo.uuid, true));   // Bo has no activity: his days are left to his player
    const seen = [];
    Hooks.on("pf2e-artisans-workshop.downtimeDayStart", (p) => seen.push(["start", p.day, p.mode, p.actors.length]));
    Hooks.on("pf2e-artisans-workshop.downtimeDayEnd", (p) => seen.push(["end", p.day, Object.keys(p.results).length]));
    const run = await downtime.advanceDays({ count: 2 });
    assert.deepEqual([run.ok, run.toDay, run.clock], [true, 2, null]);
    assert.deepEqual(records("days").map((d) => [d.actor, d.day]).sort(), [[vera.id, 1], [vera.id, 2]]);
    assert.equal(Object.values(flagsOf(docs.ledger).meta.manual)[0].toDay, 2);
    assert.deepEqual([downtime.today().day, downtime.today().clockDay], [2, 0], "the logged days run ahead of the clock");
    assert.equal(downtime.pendingOf(bo).count, 2, "Bo's days wait for his player");
    assert.deepEqual(seen, [["start", 1, "wizard", 1], ["start", 2, "wizard", 1], ["end", 1, 1], ["end", 2, 1]]);
    const again = await downtime.advanceDays({ kind: "since" });
    assert.deepEqual([again.ok, again.results.length, records("days").length], [true, 0, 2], "a span already logged writes nothing");
    assert.equal((await downtime.advanceClockToMatch()).reason, "not-gm");
});

test("the wizard as a GM can move the world clock to match; a clock advance inside logged days adds nothing (4.8, 9.2)", async () => {
    await downtime.setDowntime(vera.uuid, true);
    await downtime.setActivity(vera.uuid, { kind: "subsist" });
    world.currentUser = "gm00000000000000";
    const run = await downtime.advanceDays({ count: 3, advanceClock: true });
    assert.deepEqual([run.toDay, run.clock, downtime.today().clockDay, downtime.today().ahead], [3, 3, 3, 0]);
    world.currentUser = "p1";
    assert.equal(downtime.pendingOf(vera).count, 0);
    await write({ set: { "meta.manual.x": { id: "x", v: 1, fromDay: 4, toDay: 6 } } });
    world.currentUser = "gm00000000000000";
    assert.deepEqual(await downtime.advanceClockToMatch(), { ok: true, days: 3 });
    assert.deepEqual([downtime.today().day, downtime.today().ahead], [6, 0]);
});

test("the wizard's Resolve the rest resolves through the day the first commit reached; it never advances again (review fix)", async () => {
    const { AdvanceDaysApp } = await import("../../scripts/ui/advance.mjs");
    await downtime.setDowntime(vera.uuid, true);
    await downtime.setActivity(vera.uuid, { kind: "subsist" });
    const app = new AdvanceDaysApp({ mode: "advance" });
    app.render = async () => {};
    app.state.count = 2;
    const commit = AdvanceDaysApp.DEFAULT_OPTIONS.actions.commit;
    await commit.call(app);
    assert.deepEqual([downtime.today().day, app.state.toDay, app.state.step], [2, 2, "done"]);
    await commit.call(app);
    assert.equal(downtime.today().day, 2, "the second commit adds no days");
    assert.equal(records("days").length, 2);
});
