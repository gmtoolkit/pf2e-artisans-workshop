/**
 * The extension API over the fake world (DESIGN.md 12, M10), against the test extension in `ext-fixture.mjs`: registration
 * through the hook and its close at ready, the GM's warning for another API major, an extension activity's run through
 * the day resolver (its check, Aid, result, store writes, rows and notes; resolved twice, written once), per-day income,
 * income per event (the `incomeComputed` hook, a split with claims), `api.funds.post` expenses, consumable sinks (the
 * decrement, the log, inert items, a double spend), and check-modifier sources in the Workshop's own rolls.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { addDocument, asUser, coin, installFoundry, MOD, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";
import { EXT_ID, registerTestExtension } from "./ext-fixture.mjs";

installFoundry();
const { RANK } = await import("../../scripts/logic/core.mjs");
const { levelDC } = await import("../../scripts/logic/dc.mjs");
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { extLink, jobLink } = await import("../../scripts/logic/rolls.mjs");
const { extRunId } = await import("../../scripts/logic/extensions.mjs");
const { unallocatedCp } = await import("../../scripts/logic/funds.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const downtime = await import("../../scripts/foundry/downtime.mjs");
const ext = await import("../../scripts/foundry/extensions.mjs");
const funds = await import("../../scripts/foundry/funds.mjs");
const jobs = await import("../../scripts/foundry/jobs.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const rolls = await import("../../scripts/foundry/rolls.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, write } = await import("../../scripts/foundry/store.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const DAY = 86400;
const GM = "gm00000000000000";

let docs;
let vera;
let bo;
let rolled;
const statistic = (slug, rank) => ({ slug, rank, label: slug, roll: async (args) => { rolled.push({ slug, ...args }); return { total: 20 }; } });
const as = (user, action) => asUser(user, action)();
const extFlags = () => docs.ledger.flags[EXT_ID] ?? {};

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    downtime.resetDowntime();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 50),
        { type: "consumable", name: "Alchemist's Fire", system: { quantity: 2, traits: { value: ["alchemical", "bomb", "consumable"] } } },
        { type: "consumable", name: "Spent Elixir", system: { quantity: 1, traits: { value: ["alchemical"] } }, flags: { [MOD]: { inert: true } } },
        { type: "consumable", name: "Bandage", system: { quantity: 3, traits: { value: [] } } }] });
    Object.assign(vera, { level: 5, skills: { society: statistic("society", RANK.expert), performance: statistic("performance", RANK.trained) }, system: {} });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 10)] });
    Object.assign(bo, { level: 10, skills: { society: statistic("society", RANK.master), performance: statistic("performance", RANK.expert) }, system: {} });
    world.collections.Actor.party = { id: "party", members: [vera, bo] };
    ChatMessage.implementation.getSpeaker = () => ({});
    game.time.worldTime = 0;
    game.time.advance = async (seconds) => {
        game.time.worldTime += seconds;
        Hooks.callAll("updateWorldTime", game.time.worldTime, seconds, {}, game.user.id);
    };
    game.pf2e = { settings: { variants: { pwol: { enabled: false } } }, Modifier: class { constructor(data) { Object.assign(this, data); } } };
    game.modules.set(EXT_ID, { id: EXT_ID, title: "Test Extension", active: true });
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: GM, isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
    registerTestExtension(ext.resetExtensions({ open: true }));
    rolled = [];
});
afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    game.modules.delete(EXT_ID);
    game.modules.delete("future-ext");
});

/** A pf2e check message linked by `link`. */
function message({ id = "m1", link, outcome = "success", author = "p1", actor = vera, dc = 20, isReroll = false }) {
    return { id, author: { id: author }, actor, rolls: [{ total: 22, dice: [{ faces: 20, total: 12 }] }],
        flags: { pf2e: { context: { outcome, unadjustedOutcome: outcome, dc: { value: dc }, options: [link], isReroll } } } };
}

/** Vera in downtime on the study activity, with `days` days to resolve. */
async function veraStudies(days = 2) {
    await downtime.setDowntime(vera.uuid, true);
    await downtime.setActivity(vera.uuid, { kind: "ext", ref: `${EXT_ID}.study` });
    await game.time.advance(days * DAY);
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

test("extensions register from the hook the Workshop fires at setup; the registry closes at ready (12.1)", () => {
    ext.resetExtensions();
    let handed = null;
    Hooks.once("pf2e-artisans-workshop.register", (registry) => {
        handed = registry;
        registerTestExtension(registry);
    });
    ext.openRegistration();
    assert.deepEqual(ext.registered("downtimeActivity").map((a) => a.id), [`${EXT_ID}.study`, `${EXT_ID}.rest`]);
    assert.deepEqual(ext.registered("incomeSource").map((s) => s.cadence), ["perEvent", "perDay", "perEvent"]);
    assert.equal(ext.registered("consumableSink").length, 1);
    assert.equal(ext.registered("checkModifierSource").length, 1);
    assert.equal(ext.registrationProblems().length, 0);
    ext.closeRegistration();
    const late = handed.downtimeActivity({ id: `${EXT_ID}.late`, label: "TEST.Late", days: 1, resolve: () => ({}) });
    assert.equal(late.reason, "closed", "registration closes at ready");
    assert.equal(ext.activityOf(`${EXT_ID}.late`), null);
    assert.equal(handed.extension(EXT_ID).downtimeActivity({ id: `${EXT_ID}.study`, label: "X", days: 1, resolve: () => ({}) }).reason, "closed");
});

test("an extension needing another API major is ignored, and a GM is told at ready; players are not (12.1)", () => {
    game.modules.set("future-ext", { id: "future-ext", title: "Future Ext", active: true, flags: { [MOD]: { requiresApi: 2 } } });
    const registry = ext.resetExtensions({ open: true });
    assert.equal(registry.downtimeActivity({ id: "future-ext.x", label: "X", days: 1, resolve: () => ({}) }).reason, "ignored");
    ext.closeRegistration();
    assert.equal(world.notes.length, 0, "Player One's client says nothing");
    world.currentUser = GM;
    ext.closeRegistration();
    const [level, key, options] = world.notes.at(-1);
    assert.deepEqual([level, key, options.format.module, options.format.wants, options.format.has], ["warn", "pf2e-artisans-workshop.Ext.ApiMismatch", "Future Ext", "2", "1"]);
    assert.equal(registry.downtimeActivity({ id: "future-ext.y", label: "Y", days: 1, resolve: () => ({}) }).reason, "closed");
});

/* -------------------------------------------- */
/*  A downtime activity                          */
/* -------------------------------------------- */

test("an activity's run: the first day writes, the last waits for the check, then resolves its writes once (12.2)", async () => {
    await veraStudies(2);
    const first = await downtime.resolveDays({ actor: vera });
    const run = extRunId(vera.id, `${EXT_ID}.study`, 1);
    assert.deepEqual([first.ok, first.records.length, first.stop.reason, first.stop.ref], [true, 1, "ext-check", run]);
    // The check: Society against the party's level-based DC (levels 5 and 10: party level 8), with the costume's +1.
    const roll = await ext.rollActivity({ actor: vera, activity: `${EXT_ID}.study`, from: 1 });
    assert.deepEqual([roll.ok, roll.run], [true, run]);
    const [args] = rolled;
    assert.deepEqual([args.slug, args.dc.value], ["society", levelDC(8)]);
    assert.ok(args.extraRollOptions.includes(extLink(run)) && args.extraRollOptions.includes("test:study"));
    assert.deepEqual(args.traits, ["downtime", "circus"]);
    assert.deepEqual(args.modifiers.map((m) => [m.slug, m.modifier, m.label]), [["costume", 1, "TEST.Costume"]]);
    assert.equal(read(`extRuns.${run}.check`), null, "the run is recorded before the roll, its check when the message comes");
    assert.equal((await rolls.onCheckMessage(message({ link: extLink(run) }))).ok, true);
    assert.deepEqual([read(`extRuns.${run}.check.degree`), read(`extRuns.${run}.check.rank`)], [2, RANK.expert]);
    const ends = [];
    Hooks.on("pf2e-artisans-workshop.downtimeDayEnd", (p) => ends.push(p.results[vera.id]));
    const posted = [];
    Hooks.on("pf2e-artisans-workshop.ledgerPosted", (p) => posted.push(...p.rows.map((r) => [r.kind, r.source])));
    const box = cpOf(docs.strongbox);
    const purse = cpOf(vera);
    const done = await downtime.resolveDays({ actor: vera });
    assert.deepEqual([done.records.length, done.records[0].result, done.records[0].extNotes], [1, "ext", ["TEST.Studied"]]);
    assert.deepEqual(extFlags().gains[run], { actor: vera.id, day: 2, gain: 5, aided: 0 }, "its own scope, written with the day");
    assert.equal(cpOf(docs.strongbox) - box, 100, "a success's 1 gp into the party fund");
    assert.equal(unallocatedCp(records("rows")), 100);
    assert.equal(cpOf(vera) - purse, 10, "the per-day stipend of day 2 (day 1's was paid with it)");
    assert.deepEqual(ends.at(-1).notes, ["TEST.Studied"]);
    assert.ok(posted.some(([kind, source]) => kind === "income" && source === `${EXT_ID}:study`));
    assert.equal((await downtime.resolveDays({ actor: vera })).reason, "no-days", "resolved twice: nothing more");
    assert.equal(records("rows").filter((r) => r.source === `${EXT_ID}:study`).length, 1);
    assert.equal(await ext.sweepExtRows(), 0, "nothing owed");
    // A reroll after the last day is written changes nothing; it is kept as a conflict.
    const late = await rolls.onCheckMessage(message({ id: "m2", link: extLink(run), outcome: "criticalSuccess", isReroll: true }));
    assert.deepEqual([late.ok, late.reason, read(`extRuns.${run}.check.degree`)], [false, "resolved", 2]);
    assert.equal(read(`extRuns.${run}.conflict.degree`), 3);
    assert.equal((await ext.rollActivity({ actor: vera, activity: `${EXT_ID}.study`, from: 1 })).reason, "resolved");
});

test("an Aid is its own run with its own check, and helps the aided PC's next check once (12.2 aid)", async () => {
    await veraStudies(2);
    await as("p2", () => downtime.setDowntime(bo.uuid, true));
    await as("p2", () => downtime.setActivity(bo.uuid, { kind: "ext", ref: `${EXT_ID}.study`, aid: vera.id }));
    await game.time.advance(2 * DAY);
    requestLease("p2");
    const boDays = await as("p2", () => downtime.resolveDays({ actor: bo }));
    const aidRun = extRunId(bo.id, `${EXT_ID}.study`, 3, vera.id);
    assert.deepEqual([boDays.records.length, boDays.stop.reason, boDays.stop.ref], [1, "ext-aid-check", aidRun]);
    assert.equal((await as("p2", () => ext.rollActivity({ actor: bo, activity: `${EXT_ID}.study`, from: 3, aid: vera.id }))).ok, true);
    assert.deepEqual([rolled[0].slug, rolled[0].dc.value, rolled[0].modifiers.length], ["society", 20, 0], "the Aid's DC 20; the costume skips Aid checks");
    assert.equal((await as("p2", () => rolls.onCheckMessage(message({ link: extLink(aidRun), author: "p2", actor: bo })))).ok, true);
    assert.equal((await as("p2", () => downtime.resolveDays({ actor: bo }))).records[0].result, "ext-aid");
    requestLease("p1");
    await downtime.resolveDays({ actor: vera });
    const run = extRunId(vera.id, `${EXT_ID}.study`, 1);
    await ext.rollActivity({ actor: vera, activity: `${EXT_ID}.study`, from: 1 });
    assert.deepEqual(rolled.at(-1).modifiers.map((m) => [m.slug, m.modifier, m.type]).sort(),
        [["aid-" + bo.id.toLowerCase(), 2, "circumstance"], ["costume", 1, "circumstance"]].sort());
    assert.equal((await rolls.onCheckMessage(message({ link: extLink(run) }))).ok, true);
    assert.equal(read(`extRuns.${aidRun}.usedBy`), run, "used by this check");
    assert.deepEqual(ext.openAids(vera, `${EXT_ID}.study`), [], "and by no other");
    assert.equal((await rolls.onCheckMessage(message({ id: "m3", link: extLink(run) }))).reason, "rolled", "a second roll that is no reroll is kept nowhere");
    await downtime.resolveDays({ actor: vera });
    assert.equal(extFlags().gains[run].aided, 1, "the result sees the Aid");
});

test("an activity that refuses the PC stops before its first day; one no module provides any more stops too (12.2)", async () => {
    requestLease("p2");
    await as("p2", () => downtime.setDowntime(bo.uuid, true));
    await game.time.advance(DAY);
    const barred = await as("p2", () => downtime.resolveDays({ actor: bo, activity: { kind: "ext", ref: `${EXT_ID}.rest` } }));
    assert.deepEqual([barred.records.length, barred.stop.reason, barred.stop.why], [0, "ext-ineligible", "TEST.NotBo"]);
    const gone = await as("p2", () => downtime.resolveDays({ actor: bo, activity: { kind: "ext", ref: "gone-ext.x" } }));
    assert.equal(gone.stop.reason, "ext-unknown");
    requestLease("p1");
    await downtime.setDowntime(vera.uuid, true);
    await game.time.advance(2 * DAY);
    const rest = await downtime.resolveDays({ actor: vera, activity: { kind: "ext", ref: `${EXT_ID}.rest` } });
    assert.deepEqual([rest.records.map((r) => r.day), rest.records.map((r) => r.result), extFlags().rested[vera.id]], [[2, 3], ["ext", "ext"], 3],
        "a 1-day activity with no check: each day is a run, resolved as it is written");
});

test("a run's rows that did not land are posted by the sweep on the PC's responsible client, once (P5)", async () => {
    const input = { kind: "income", idem: `ext:${EXT_ID}:study:run.x.0`, cp: 100, how: { via: "box" }, actor: null, source: `${EXT_ID}:study`, day: 4 };
    await write({ set: { [`days.${vera.id}-4`]: { id: `${vera.id}-4`, v: 1, actor: vera.id, day: 4, toDay: 4, activity: { kind: "ext", ref: `${EXT_ID}.study` }, extRows: [input], rows: [] } } });
    requestLease("p2");
    assert.equal(await as("p2", () => ext.sweepExtRows()), 0, "Player Two's client is not Vera's");
    requestLease("p1");
    assert.equal(await ext.sweepExtRows(), 1);
    assert.equal(await ext.sweepExtRows(), 0);
    assert.equal(cpOf(docs.strongbox), 100);
});

/* -------------------------------------------- */
/*  Income, rows and expenses                    */
/* -------------------------------------------- */

test("income per event: computed, adjusted by an incomeComputed listener, posted once per key (12.2, 12.3)", async () => {
    const heard = [];
    Hooks.on("pf2e-artisans-workshop.incomeComputed", (p) => {
        heard.push([p.source, p.key, p.result.cp, Object.isFrozen(p), Object.isFrozen(p.result)]);
        p.result.cp *= 2;
    });
    const paid = await ext.postIncome(`${EXT_ID}.show`, { key: "show.s1", data: { cp: 1500 } });
    assert.deepEqual([paid.ok, paid.cp, paid.breakdown], [true, 3000, [{ label: "TEST.Base", cp: 1500 }]]);
    assert.deepEqual(heard, [[`${EXT_ID}.show`, "show.s1", 1500, true, false]]);
    assert.equal(cpOf(docs.strongbox), 3000);
    const again = await ext.postIncome(`${EXT_ID}.show`, { key: "show.s1", data: { cp: 1500 } });
    assert.deepEqual(again.results.map((r) => r.outcome), ["already"]);
    assert.equal(cpOf(docs.strongbox), 3000, "one payment per key");
    assert.equal((await ext.postIncome(`${EXT_ID}.show`, { key: "bad key", data: { cp: 1 } })).reason, "bad-key");
    assert.equal((await ext.postIncome("gone-ext.show", { key: "k" })).reason, "no-income-source");
});

test("income split among the members: minted into this user's purse, a claim for the other's, collected by its client (12.2)", async () => {
    const paid = await ext.postIncome(`${EXT_ID}.share`, { key: "share.1", data: { cp: 301 } });
    assert.deepEqual(paid.results.map((r) => r.outcome), ["ok", "claimed"]);
    const veraBefore = 5000;
    assert.equal(cpOf(vera), veraBefore + 151, "Vera's share, with the odd copper");
    const boBefore = cpOf(bo);
    requestLease("p2");
    assert.equal(await as("p2", () => claims.sweepClaims()), 1);
    assert.equal(cpOf(bo) - boBefore, 150);
    const [row] = records("rows").filter((r) => r.actor === bo.uuid && r.kind === "income");
    assert.deepEqual([row.source, row.purse, row.box], [`${EXT_ID}:share`, 150, 0]);
});

test("api.funds.post: an extension's expense comes out of the party fund behind its slot; strangers and bad rows are refused (12.4)", async () => {
    const row = { kind: "expense", cp: 4000, key: "upgrade.seats", source: `${EXT_ID}:upgrades` };
    assert.equal((await ext.postExtRow({ ...row, source: "stranger-ext:upgrades" })).reason, "unknown-extension");
    assert.deepEqual([(await ext.postExtRow(row)).reason, (await ext.postExtRow(row)).data.maxCp], ["fund-short", 0]);
    assert.equal((await funds.deposit(vera.uuid, 5000)).outcome, "ok");
    const paid = await ext.postExtRow(row);
    assert.equal(paid.outcome, "ok", JSON.stringify(paid));
    assert.deepEqual([cpOf(docs.strongbox), unallocatedCp(records("rows"))], [1000, 1000]);
    assert.equal((await ext.postExtRow(row)).outcome, "already", "posting the same key again moves nothing");
    assert.equal((await ext.postExtRow({ ...row, key: "a:b" })).reason, "bad-key");
    assert.equal((await ext.postExtRow({ ...row, kind: "refund" })).reason, "bad-kind");
    const income = await ext.postExtRow({ kind: "income", amount: 250, key: "gift", source: `${EXT_ID}:gifts`, actor: bo.uuid });
    assert.equal(income.outcome, "claimed", "into a purse this user does not own: a claim");
});

/* -------------------------------------------- */
/*  Consumable sinks                             */
/* -------------------------------------------- */

test("a sink spends one item, logs it, gives its modifiers, and the same key spends nothing more (12.2 ConsumableSink)", async () => {
    const fire = vera.items.find((i) => i.name === "Alchemist's Fire");
    const spent = [];
    Hooks.on("pf2e-artisans-workshop.consumableSpent", (p) => spent.push(p));
    assert.deepEqual(ext.sinksFor(fire).map((s) => s.id), [`${EXT_ID}.alchemical-trick`]);
    assert.deepEqual(ext.sinkItems(`${EXT_ID}.alchemical-trick`, vera).map((i) => i.name), ["Alchemist's Fire"], "not the inert elixir, not the bandage");
    const first = await ext.spendItem(`${EXT_ID}.alchemical-trick`, { actor: vera, item: fire.id, key: "show.s1.trick.4" });
    assert.deepEqual([first.ok, first.modifiers.map((m) => [m.slug, m.modifier, m.type]), first.notes], [true, [["alchemical-trick", 1, "circumstance"]], ["spent Alchemist's Fire"]]);
    assert.equal(fire.system.quantity, 1);
    const log = records("spends");
    assert.deepEqual([log.length, log[0].item.name, log[0].actor, log[0].key], [1, "Alchemist's Fire", vera.uuid, "show.s1.trick.4"]);
    const again = await ext.spendItem(`${EXT_ID}.alchemical-trick`, { actor: vera, item: fire.id, key: "show.s1.trick.4" });
    assert.deepEqual([again.outcome, fire.system.quantity, spent.length], ["already", 1, 1]);
    assert.equal((await ext.spendItem(`${EXT_ID}.alchemical-trick`, { actor: vera, item: fire.id, key: "show.s1.trick.5" })).ok, true);
    assert.equal(vera.items.find((i) => i.name === "Alchemist's Fire"), undefined, "the last one is gone");
    const inert = vera.items.find((i) => i.name === "Spent Elixir");
    assert.equal((await ext.spendItem(`${EXT_ID}.alchemical-trick`, { actor: vera, item: inert.id, key: "x" })).reason, "inert");
    const bandage = vera.items.find((i) => i.name === "Bandage");
    assert.equal((await ext.spendItem(`${EXT_ID}.alchemical-trick`, { actor: vera, item: bandage.id, key: "y" })).reason, "not-accepted");
    assert.equal((await as("p2", () => ext.spendItem(`${EXT_ID}.alchemical-trick`, { actor: vera, item: bandage.id, key: "z" }))).reason, "not-owner");
    assert.equal((await ext.spendItem("gone-ext.sink", { actor: vera, item: bandage.id })).reason, "no-sink");
    assert.equal(spent.length, 2);
    assert.ok(Object.isFrozen(spent[0]));
});

/* -------------------------------------------- */
/*  Check modifiers in the Workshop's rolls      */
/* -------------------------------------------- */

test("check-modifier sources add to the Workshop's own rolls of their selectors, and a failing source adds nothing (12.2)", async () => {
    requestLease("p2");
    const started = await as("p2", () => jobs.startJob({ actor: bo.uuid, skill: "performance", taskLevel: 3 }));
    assert.equal(started.ok, true, JSON.stringify(started));
    await as("p2", () => jobs.rollJob(started.job));
    assert.deepEqual(rolled.at(-1).modifiers.map((m) => [m.slug, m.modifier]), [["costume", 1]]);
    assert.ok(rolled.at(-1).extraRollOptions.includes(jobLink(started.job, 1)));
    const registry = ext.resetExtensions({ open: true });
    registry.extension(EXT_ID).checkModifierSource({ id: `${EXT_ID}.broken`, selectors: ["all"], modifiers: () => { throw new Error("boom"); } });
    registry.extension(EXT_ID).checkModifierSource({ id: `${EXT_ID}.crafting-only`, selectors: ["crafting"], modifiers: () => [{ slug: "x", modifier: 2 }] });
    assert.deepEqual(await ext.modifierData({ actor: bo, statistic: "performance", kind: "extension" }), [], "the broken source is skipped; crafting does not answer");
    assert.deepEqual((await ext.modifierData({ actor: bo, statistic: "crafting", kind: "craft" })).map((m) => m.source), [`${EXT_ID}.crafting-only`]);
});
