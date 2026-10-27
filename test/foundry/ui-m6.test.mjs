/**
 * The Downtime tab, the Advance days wizard, the helpers section and the day card over the fake world (DESIGN.md 10.1,
 * 9, 6.7, 10.5, M6), as far as they run without a browser: who sees which rows, the activity choices, the badge, the
 * settlement and job views, the wizard's steps and what it previews, the day lines in words, and every M6 label a key.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
lang["PF2E.CurrencyAbbreviations.sp"] = "sp";
lang["PF2E.CurrencyAbbreviations.cp"] = "cp";
CONFIG.PF2E = { skills: { crafting: { label: "Crafting" } }, rarityTraits: {} };

foundry.applications.api.ApplicationV2 = class {
    constructor(options = {}) { this.options = options; this.tabGroups = { primary: "queue" }; this.window = {}; this.children = []; }
    async _prepareContext() { return { tabs: {} }; }
    async _preparePartContext(_partId, context) { return context; }
    _preSyncPartState() {}
    _syncPartState() {}
    async _onRender() {}
    renderChild(app) { this.children.push(app); return app; }
};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const { DEGREE, RANK } = await import("../../scripts/logic/core.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { write } = await import("../../scripts/foundry/store.mjs");
const labels = await import("../../scripts/ui/labels.mjs");
const { WorkshopApp, registerWindowHooks } = await import("../../scripts/ui/workshop.mjs");
const { focusSelector } = await import("../../scripts/ui/focus.mjs");
const { AdvanceDaysApp } = await import("../../scripts/ui/advance.mjs");
const { dayLines, spanText, stopText } = await import("../../scripts/ui/days.mjs");
const { helpersContext, pendingBadge } = await import("../../scripts/ui/downtime.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

let vera;
let bo;
const statistic = (slug, rank, label = slug) => ({ slug, rank, label, roll: async () => ({ total: 20 }) });

beforeEach(async () => {
    resetWorld();
    state.resetState();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [] });
    Object.assign(vera, { level: 5, skills: { crafting: statistic("crafting", RANK.expert, "Crafting") }, system: {} });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [] });
    Object.assign(bo, { level: 3, skills: { crafting: statistic("crafting", RANK.trained, "Crafting") }, system: {} });
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [vera, bo] };
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p2");
    state.setShared({ ...docs, status: "ready" });
    game.time.worldTime = 2 * 86400;
    await write({ set: {
        [`pcs.${bo.id}`]: { id: bo.id, v: 1, inDowntime: true, since: 0, activity: { kind: "earn", ref: "j1" } },
        [`pcs.${vera.id}`]: { id: vera.id, v: 1, inDowntime: true, since: 1, activity: { kind: "craft", ref: "o1" } },
        "jobs.j1": { id: "j1", v: 1, actor: bo.uuid, skill: "crafting", taskLevel: 1, dc: 15, round: 1, check: null, perDayCp: 0, status: "open", log: {} },
        "orders.o1": { id: "o1", v: 1, status: "finishing", attempt: 1, crafter: vera.uuid, requester: vera.uuid, priceCp: 6500, upfrontCp: 3250,
            dc: { final: 19 }, check: { degree: DEGREE.success, level: 5, rank: 2, settled: true }, log: {}, visibility: "public",
            product: { uuid: "U", snapshot: { name: "Striking rune", traits: [] } },
            helpers: { [bo.id]: { skill: "crafting", rank: 1, level: 3, degree: DEGREE.success, joinedDay: 1, leftDay: null } } },
    } });
});

test("players see their own characters in the Downtime tab, a GM every member; pending days and the badge (10.1, 9.1)", async () => {
    const app = new WorkshopApp();
    const context = await app._prepareContext({});
    assert.equal(context.dayText, "Day 2");
    const part = await app._preparePartContext("downtime", { ...context }, {});
    const rows = part.downtime.pcs;
    assert.deepEqual(rows.map((r) => [r.name, r.pending, r.pendingText]), [["Bo", 2, "2 days to resolve"]]);
    assert.equal(rows[0].activityText, "Earn Income: Crafting, task level 1");
    assert.deepEqual(rows[0].activityOptions.map((o) => o.label), [
        "Nothing chosen yet", "Helping with Striking rune", "Earn Income: Crafting, task level 1", "Subsisting", "Retraining", "Something else"]);
    assert.equal(rows[0].locked, "Helping with Striking rune until it is finished or they leave.");
    assert.equal(pendingBadge(), 1);
    const nav = await app._preparePartContext("nav", { ...context, readable: true }, {});
    assert.deepEqual(nav.badges, { downtime: 1 });
    assert.deepEqual(part.downtime.jobs.map((j) => [j.actor, j.actions.roll, j.daysText]), [["Bo", true, "0 days paid, 0 gp in all"]]);
    assert.equal(part.downtime.settlement.capText, "No settlement is set: Earn Income jobs may take any task level.");
    assert.equal(part.downtime.profiles, null, "settlement profiles are a GM's");
    world.currentUser = "gm00000000000000";
    const gm = await app._preparePartContext("downtime", { ...(await app._prepareContext({})) }, {});
    assert.deepEqual(gm.downtime.pcs.map((r) => r.name), ["Vera", "Bo"]);
    assert.notEqual(gm.downtime.profiles, null);
});

test("an order's helpers: their share a day, their own buttons, and Help with this order for a character who could (6.7)", async () => {
    world.currentUser = "p2";
    const order = { id: "o1", status: "finishing", crafter: vera.uuid, dc: { final: 19 }, product: { snapshot: { traits: [] } },
        helpers: { [bo.id]: { skill: "crafting", rank: 1, level: 3, degree: DEGREE.success, joinedDay: 1, leftDay: null, check: { messageId: "m" } } } };
    const view = helpersContext(order);
    const [helper] = view.list;
    assert.deepEqual([helper.name, helper.rate, helper.canLeave, helper.canRoll, helper.canAccept], ["Bo", "3 sp", true, false, false],
        "a 3rd-level trained helper's success: the level-2 trained amount (Player Core p.228)");
    assert.equal(view.canJoin, false, "Bo helps already, and Vera is not Player Two's");
    world.currentUser = "p1";
    const crafterView = helpersContext({ ...order, helpers: { [bo.id]: { ...order.helpers[bo.id], accepted: false } } });
    assert.deepEqual([crafterView.list[0].canAccept, crafterView.list[0].waiting], [true, true]);
});

test("the wizard's steps: how many days, who does what with a preview, checks due, review; the resolver skips the span", async () => {
    world.currentUser = "p1";
    const app = new AdvanceDaysApp({ mode: "advance" });
    let context = await app._prepareContext({});
    assert.deepEqual(context.stepper.map((s) => s.id), ["span", "who", "checks", "review", "done"]);
    assert.equal(context.span.from + " " + context.span.to, "Today is workshop day 2. It becomes day 3.");
    app.state.step = "who";
    context = await app._prepareContext({});
    const vera_ = context.who.find((w) => w.name === "Vera");
    assert.equal(vera_.span, "2 days (days 2 to 3)");
    assert.equal(vera_.willWrite, "2 days (days 2 to 3)");
    const bo_ = context.who.find((w) => w.name === "Bo");
    assert.match(bo_.stop, /helping with Striking rune/, "Bo helps Vera, so his days go to her order until he leaves it");
    app.state.step = "checks";
    context = await app._prepareContext({});
    assert.deepEqual(context.checks.due.map((d) => [d.kind, d.canRoll]), [["earn", false]], "Bo's check, which only his player rolls");
    app.state.step = "review";
    context = await app._prepareContext({});
    assert.deepEqual(context.review.find((r) => r.name === "Vera").lines, ["2 days of work on Striking rune: up to 2 gp 6 sp off what is left to pay"], "her 1 gp and Bo's 3 sp a day");
    const resolver = new AdvanceDaysApp({ mode: "resolve", actor: bo.uuid });
    assert.deepEqual((await resolver._prepareContext({})).stepper.map((s) => s.id), ["who", "checks", "review", "done"]);
});

test("day records and stops in words, with a key of their own for one day", () => {
    const records = [
        { day: 1, toDay: 1, kind: "setup", order: "o1", activity: { kind: "craft", ref: "o1" } },
        { day: 2, toDay: 2, job: "j1", wageCp: 30, activity: { kind: "earn", ref: "j1" } },
        { day: 3, toDay: 3, job: "j1", wageCp: 30, activity: { kind: "earn", ref: "j1" } },
    ];
    assert.equal(spanText(records), "3 days (days 1 to 3)");
    assert.deepEqual(dayLines(records), ["1 setup day on Striking rune", "2 days of Crafting, task level 1: 6 sp earned"]);
    assert.equal(stopText({ day: 4, reason: "check", ref: "o1" }), "Day 4: Striking rune needs its Craft check. Roll it, then resolve the rest.");
});

test("every M6 label is a key in lang/en.json", () => {
    const keys = [
        ...Object.values(labels.DAY_STOP), ...Object.values(labels.ACTIVITY), ...Object.values(labels.HELPER_REASON),
        ...Object.values(labels.JOB_STATUS).map((s) => s.key), ...Object.values(labels.SETTLEMENT_SIZE), ...Object.values(labels.REFUSAL),
    ];
    for (const key of keys) assert.ok(lang[key], key);
    for (const one of ["Days.SetupOne", "Days.ExtraOne", "Days.HelpOne", "Days.EarnOne", "Days.NotDowntimeOne", "Days.OtherOne",
        "Downtime.PendingOne", "Downtime.AheadOne", "Downtime.BehindOne", "Downtime.PromptOne", "Job.DaysPaidOne"]) {
        assert.ok(lang[`pf2e-artisans-workshop.${one}`], one);
    }
});

test("the Downtime tab is a tab of the window, with its badge described to screen readers", () => {
    assert.ok(WorkshopApp.TABS.primary.tabs.some((t) => t.id === "downtime"));
    assert.ok(WorkshopApp.PARTS.downtime);
    const nav = readFileSync(join(ROOT, "templates/workshop/nav.hbs"), "utf8");
    assert.match(nav, /aria-description="\{\{lookup \.\.\/badgeLabels tab\.id\}\}"/);
});

/* -------------------------------------------- */
/*  After the M6 review (fix pass)               */
/* -------------------------------------------- */

/** A small fake element: its tag, name and data attributes, and the focus calls it gets. */
function fakeEl(tag, { name = null, data = {} } = {}) {
    return {
        tagName: tag.toUpperCase(), id: "", dataset: data, calls: [], getAttribute: (key) => (key === "name" ? name : null), closest: () => null,
        focus(options) { this.calls.push(["focus", options]); },
    };
}

/** A rendered part: what has focus in it, and what its selectors find. */
const part = (active, found = {}) => ({ ownerDocument: { activeElement: active }, contains: (el) => el === active, querySelector: (sel) => found[sel] ?? null });

test("a live update gives focus back to the same character's control, not the first character's (review fix, 10.9)", () => {
    const select = fakeEl("select", { name: "dtActivity", data: { actor: bo.uuid } });
    const selector = `select[name="dtActivity"][data-actor="${bo.uuid}"]`;
    assert.equal(focusSelector(select), selector);
    assert.equal(focusSelector(fakeEl("button", { data: { action: "downtime", op: "toggle", actor: bo.uuid } })),
        `button[data-action="downtime"][data-op="toggle"][data-actor="${bo.uuid}"]`);
    assert.equal(focusSelector(fakeEl("button", { data: { action: "downtime", op: "job-end", job: "j1" } })), 'button[data-action="downtime"][data-op="job-end"][data-job="j1"]');
    assert.equal(focusSelector(fakeEl("button", { data: { action: "downtime", op: "profile-edit", profile: "p9" } })),
        'button[data-action="downtime"][data-op="profile-edit"][data-profile="p9"]');
    const app = new WorkshopApp();
    const state = {};
    app._preSyncPartState("downtime", null, part(select), state);
    const first = fakeEl("select");
    const second = fakeEl("select");
    app._syncPartState("downtime", part(null, { 'select[name="dtActivity"]': first, [selector]: second }), null, state);
    assert.deepEqual([first.calls.length, second.calls.length], [0, 1], "Bo's select, not Vera's");
});

test("the wizard keeps focus on the same character's choice, renders nothing while the number of days is typed, and holds live updates while a field has focus (review fix)", async () => {
    world.currentUser = "p1";
    const app = new AdvanceDaysApp({ mode: "advance" });
    const select = fakeEl("select", { name: "assign", data: { actor: bo.id } });
    const state = {};
    app._preSyncPartState("body", null, part(select), state);
    const again = fakeEl("select");
    app._syncPartState("body", part(null, { 'select[name="assign"]': fakeEl("select"), [`select[name="assign"][data-actor="${bo.id}"]`]: again }), null, state);
    assert.equal(again.calls.length, 1);
    assert.equal(app.fieldChanged({ name: "count", value: "3" }), false, "the day line is updated in place; Next stays where it was");
    assert.equal(app.state.count, 3);
    assert.equal(app.fieldChanged({ name: "assign", value: "subsist", dataset: { actor: bo.id } }), true);
    let renders = 0;
    app.render = async () => { renders += 1; };
    app.rendered = true;
    const active = { tagName: "SELECT" };
    app.element = { ownerDocument: { activeElement: active }, contains: () => true };
    app.refresh();
    assert.equal(renders, 0, "a select is open: its menu is not closed under the user");
    active.tagName = "BUTTON";
    app.refresh();
    assert.equal(renders, 1);
});

test("the day resolver asks for an activity when the character has none, and says whose days it resolves (review fix)", async () => {
    world.currentUser = "p2";
    await write({ set: { [`pcs.${bo.id}.activity`]: null } });
    const app = new AdvanceDaysApp({ mode: "resolve", actor: bo.uuid });
    app.render = async () => {};
    assert.equal(app.title, "Resolve days for Bo");
    const context = await app._prepareContext({});
    const [who] = context.who;
    assert.deepEqual(who.options[0], { value: "", label: "Choose an activity", selected: true });
    assert.equal(who.options.some((o) => o.value === "skip"), false, "no leaving the days for their own player");
    assert.equal(context.blocked, true);
    assert.equal(who.choose, "Choose what Bo spends these days on, then go on.");
    await AdvanceDaysApp.DEFAULT_OPTIONS.actions.next.call(app);
    assert.equal(app.state.step, "who", "Next waits for a choice");
    app.fieldChanged({ name: "assign", value: "not-downtime", dataset: { actor: bo.id } });
    assert.equal((await app._prepareContext({})).blocked, false);
    const advance = new AdvanceDaysApp({ mode: "advance" });
    advance.state.step = "review";
    const review = (await advance._prepareContext({})).review;
    assert.equal(review.find((r) => r.name === "Bo").skipped, "Left for their player to resolve: nothing is written for these days.",
        "the wizard says when it leaves a character's days");
    const tab = await new WorkshopApp()._preparePartContext("downtime", { ...(await new WorkshopApp()._prepareContext({})) }, {});
    assert.equal(tab.downtime.pcs[0].noActivity, true);
});

test("the clock moving within a day renders nothing; a new day renders the day, the Downtime tab and the badge (review fix)", async () => {
    registerWindowHooks();
    const calls = { refresh: 0, day: 0 };
    WorkshopApp.instance = { refresh: () => { calls.refresh += 1; }, refreshDay: () => { calls.day += 1; } };
    try {
        Hooks.callAll("updateWorldTime", game.time.worldTime, 0);   // the first look
        const seen = { ...calls };
        for (let i = 0; i < 5; i += 1) {
            game.time.worldTime += 6;
            Hooks.callAll("updateWorldTime", game.time.worldTime, 6);
        }
        assert.deepEqual(calls, seen, "combat rounds render nothing");
        game.time.worldTime += 86400;
        Hooks.callAll("updateWorldTime", game.time.worldTime, 86400);
        assert.deepEqual(calls, { ...seen, day: seen.day + 1 });
    } finally {
        WorkshopApp.instance = null;
    }
    const app = new WorkshopApp();
    let parts = null;
    app.rendered = true;
    app.render = (options) => { parts = options.parts; };
    app.refreshDay();
    assert.deepEqual(parts, ["header", "downtime", "nav"], "Bo has days to resolve: the badge changes too");
});
