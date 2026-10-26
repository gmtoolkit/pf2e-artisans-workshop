/**
 * The Workshop window and its helpers over the fake world (DESIGN.md 10, M4), as far as they run without a browser:
 * money formatting and parsing, gate and refusal sentences, every label key in `lang/en.json`, the window's Queue and
 * Funds context from a seeded ledger, and the Actors directory button; the tab nav core's `changeTab` reads; focus and
 * the caret kept across a re-render (on small fake elements); the chat cards rendered again where they are shown; and
 * the request form and dialogs opened in the window the Workshop is in.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { MOD, addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};   // the browser global the entry point names
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
CONFIG.PF2E = { skills: { crafting: { label: "PF2E.SkillCrafting" } }, rarityTraits: {} };

/** Core's ApplicationV2, as far as the window calls into it. */
foundry.applications.api.ApplicationV2 = class {
    constructor(options = {}) { this.options = options; this.tabGroups = { primary: "queue" }; this.window = {}; this.children = []; }
    async _prepareContext() { return { tabs: { queue: { id: "queue", cssClass: "active" }, funds: { id: "funds", cssClass: "" } } }; }
    async _preparePartContext(_partId, context) { return context; }
    _preSyncPartState() {}
    _syncPartState() {}
    renderChild(app) { this.children.push(app); return app; }
};

const { makeOrder } = await import("../../scripts/logic/orders.mjs");
const { makeRow } = await import("../../scripts/logic/rows.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { write } = await import("../../scripts/foundry/store.mjs");
const format = await import("../../scripts/ui/format.mjs");
const labels = await import("../../scripts/ui/labels.mjs");
const { WorkshopApp } = await import("../../scripts/ui/workshop.mjs");
const { RequestForm } = await import("../../scripts/ui/request.mjs");
const { focusSelector } = await import("../../scripts/ui/focus.mjs");
const chat = await import("../../scripts/ui/chat.mjs");
const { orderLink } = await import("../../scripts/logic/rolls.mjs");
const { addDirectoryButton } = await import("../../scripts/ui/entry.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

let docs;
let bo;
beforeEach(() => {
    resetWorld();
    state.resetState();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld({ strongboxItems: [coin("gp", 7)] });
    bo = addDocument("Actor", { name: "Bo", type: "character", ownership: { default: 0, p2: 3 }, items: [coin("gp", 50)] });
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [bo] };
    setUsers([{ id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p2");
    state.setShared({ ...docs, status: "ready" });
});

test("money is shown in pf2e's coin words and read back from what people type", () => {
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    lang["PF2E.CurrencyAbbreviations.sp"] = "sp";
    assert.equal(format.money(104530), "1,045 gp 3 sp");
    assert.equal(format.money(0), "0 gp");
    assert.equal(format.parseMoney("12 gp 5 sp"), 1250);
    assert.equal(format.parseMoney("12.5 gp"), 1250);
    assert.equal(format.parseMoney("1,250"), 1250);
    assert.equal(format.parseMoney("1.234 cp"), null, "no fractions of a copper");
    assert.equal(format.parseMoney("lots"), null);
});

test("gates and refusals read as sentences from lang/en.json", () => {
    assert.equal(format.gateText({ reason: "rank", data: { skill: "crafting", rank: 3 } }), "Needs PF2E.ProficiencyLevel3 in PF2E.SkillCrafting.");
    assert.equal(format.gateText({ reason: "tool", data: { tool: "alchemists-lab" } }), "Needs an alchemist's lab.");
    assert.match(format.gateText({ reason: "never-heard-of-it" }), /never-heard-of-it/);
    assert.equal(format.refusalText({ ok: false, outcome: "conflict", reason: "locked" }), lang["pf2e-artisans-workshop.Refusal.Conflict"]);
    assert.match(format.refusalText({ ok: false, reason: "state", data: { status: "rolled" } }), /Rolled/);
});

test("every label is a key in lang/en.json", () => {
    const keys = [
        ...Object.values(labels.STATUS).map((s) => s.key), ...Object.values(labels.GATE), ...Object.values(labels.TOOL),
        ...Object.values(labels.REFUSAL), ...Object.values(labels.ROW_KIND), ...Object.values(labels.ROUTE), ...Object.values(labels.EVENT),
    ];
    assert.deepEqual(keys.filter((key) => !(key in lang)), []);
});

test("the window's Queue and Funds context, from the ledger", async () => {
    const stamp = { by: "p2", at: { world: 1, real: 1, server: 1, launch: 0 } };
    const order = makeOrder({ id: "o1", requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid },
        product: { uuid: "U", snapshot: { name: "Elixir", img: "e.webp", level: 1, rarity: "common", traits: [], priceCp: 300, per: 1 } }, quantity: 2 }, stamp);
    const row = { ...makeRow({ kind: "pledge", idem: "pledge:o1:b:n", cp: 150, actor: bo.uuid, order: "o1" }, stamp), state: "applied" };
    await write({ set: { "orders.o1": order, [`rows.${row.id}`]: row } });
    const app = new WorkshopApp();
    const context = await app._prepareContext({});
    assert.deepEqual([context.ready, context.party, context.shelfCount, context.acting.map((a) => a.name)], [true, "Heroes", 0, ["Bo"]]);
    const queue = await app._preparePartContext("queue", { ...context }, {});
    assert.equal(queue.orders.length, 1);
    const [view] = queue.orders;
    assert.deepEqual([view.no, view.title, view.status, view.mine, view.progress.pct], [1, "Elixir", "requested", true, 50]);
    assert.equal(view.finishLabel, "pf2e-artisans-workshop.Detail.StillNeeded", "before start the amount is what the up-front half lacks");
    assert.equal(view.finishText, format.money(150));
    assert.equal(view.actions.accept, true);
    assert.equal(view.statusIcon, labels.STATUS.requested.icon);
    app.filters = { ...app.filters, scope: "blocked" };
    assert.equal((await app._preparePartContext("queue", { ...context }, {})).orders.length, 0);
    const funds = (await app._preparePartContext("funds", { ...context }, {})).funds;
    assert.deepEqual([funds.actualCp, funds.expectedCp, funds.escrowCp], [700, 150, 150]);
    assert.equal(funds.ledger[0].canReverse, true, "Bo's own pledge, still uncommitted");
    assert.equal(funds.reconciliation, null, "reconciliation is for GMs");
});

test("the Actors directory gets one Workshop button while the Workshop is on", () => {
    const appended = [];
    const element = (tag) => ({ tag, classList: { add() {} }, dataset: {}, append: (...children) => appended.push(...children), addEventListener() {} });
    const actions = { querySelector: () => null, ownerDocument: { createElement: element }, append: (button) => appended.push(button) };
    const html = { querySelector: (selector) => (selector.includes("header-actions") ? actions : null) };
    addDirectoryButton(html);
    assert.equal(appended.length, 0, "nothing while the master switch is off");
    world.settings.set("pf2e-artisans-workshop.enabled", true);
    addDirectoryButton(html);
    assert.equal(appended.filter((el) => el.tag === "button").length, 1);
});

const template = (path) => readFileSync(join(ROOT, "templates", path), "utf8");

test("the tab buttons sit in a `.tabs` nav, where core's changeTab looks them up", () => {
    const nav = template("workshop/nav.hbs");
    const classes = nav.match(/<nav class="([^"]*)"/)[1].split(/\s+/);
    assert.ok(classes.includes("tabs"), "ApplicationV2#changeTab reads `.tabs [data-group][data-tab]`");
    const button = nav.match(/<button[^>]*>/s)[0];
    for (const attribute of ["data-group=", "data-tab="]) assert.ok(button.includes(attribute), attribute);
});

test("a tab button keeps its name in the narrow tier, where its word is hidden", () => {
    assert.match(template("workshop/nav.hbs").match(/<button[^>]*>/s)[0], /aria-label="\{\{localize tab\.label\}\}"/);
});

test("the detail drawer names its order, so its buttons act on it", () => {
    assert.match(template("workshop/queue.hbs"), /<aside class="order-detail"[^>]*data-order-id="\{\{selected\.id\}\}"/s);
});

/** A small fake element: its tag, id, name and data attributes, its container, and the focus calls it gets. */
function fake(tag, { id = "", name = null, data = {}, scope = null, caret = null } = {}) {
    const element = {
        tagName: tag.toUpperCase(), id, dataset: data, calls: [],
        getAttribute: (key) => (key === "name" ? name : null),
        closest: () => scope ?? (Object.keys(data).some((k) => k === "orderId" || k === "rowId") ? element : null),
        focus(options) { this.calls.push(["focus", options]); },
        setSelectionRange(...args) { this.calls.push(["select", ...args]); },
    };
    if (caret) Object.assign(element, { selectionStart: caret[0], selectionEnd: caret[1], selectionDirection: "forward" });
    return element;
}

/** A rendered part: what has focus in it, and what its selectors find. */
const part = (active, found = {}) => ({
    ownerDocument: { activeElement: active }, contains: (el) => el === active, querySelector: (selector) => found[selector] ?? null,
});

test("a focused control is found again after a re-render by its data attributes, inside its order or ledger row", () => {
    const row = fake("li", { data: { orderId: "o2" } });
    const detail = fake("aside", { data: { orderId: "o2" } });
    assert.equal(focusSelector(fake("input", { data: { filter: "search" } })), 'input[data-filter="search"]');
    assert.equal(focusSelector(fake("select", { data: { filter: "status" } })), 'select[data-filter="status"]');
    assert.equal(focusSelector(row), 'li[data-order-id="o2"]');
    assert.equal(focusSelector(fake("button", { data: { action: "op", op: "work" }, scope: row })), 'li[data-order-id="o2"] button[data-action="op"][data-op="work"]');
    assert.equal(focusSelector(fake("button", { data: { action: "op", op: "pause" }, scope: detail })), 'aside[data-order-id="o2"] button[data-action="op"][data-op="pause"]');
    assert.equal(focusSelector(fake("button", { data: { action: "reverse" }, scope: fake("tr", { data: { rowId: "r1" } }) })), 'tr[data-row-id="r1"] button[data-action="reverse"]');
    assert.equal(focusSelector(fake("input", { id: "f-search" })), 'input[id="f-search"]');
    assert.equal(focusSelector(fake("select", { name: "acting" })), 'select[name="acting"]');
    assert.equal(focusSelector(fake("div")), null, "nothing names it");
});

test("the Workshop and the request form give focus back after a re-render, with the caret where it was (10.9)", () => {
    const app = new WorkshopApp();
    const typing = fake("input", { data: { filter: "search" }, caret: [3, 3] });
    const again = fake("input", { data: { filter: "search" } });
    const state = {};
    app._preSyncPartState("queue", null, part(typing), state);
    app._syncPartState("queue", part(null, { 'input[data-filter="search"]': again }), null, state);
    assert.deepEqual(again.calls, [["focus", { preventScroll: true }], ["select", 3, 3, "forward"]]);
    const button = fake("button", { data: { action: "op", op: "pause" }, scope: fake("aside", { data: { orderId: "o2" } }) });
    const same = fake("button");
    const later = {};
    app._preSyncPartState("queue", null, part(button), later);
    app._syncPartState("queue", part(null, { 'aside[data-order-id="o2"] button[data-action="op"][data-op="pause"]': same }), null, later);
    assert.deepEqual(same.calls, [["focus", { preventScroll: true }]]);
    const form = new RequestForm({});
    const search = fake("input", { id: "f-search", name: "search", caret: [4, 4] });
    const rendered = fake("input", { id: "f-search", name: "search" });
    const formState = {};
    form._preSyncPartState("form", null, part(search), formState);
    form._syncPartState("form", part(null, { 'input[id="f-search"]': rendered }), null, formState);
    assert.deepEqual(rendered.calls.at(-1), ["select", 4, 4, "forward"], "typing goes on at the end, not before what was typed");
});

test("the order list's tab stop stays on the row the user was on across a re-render", async () => {
    const stamp = { by: "p2", at: { world: 1, real: 1, server: 1, launch: 0 } };
    const product = { uuid: "U", snapshot: { name: "Elixir", img: "e.webp", level: 1, rarity: "common", traits: [], priceCp: 300, per: 1 } };
    const made = ["o1", "o2", "o3"].map((id, i) => makeOrder({ id, requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid }, product, quantity: 1 },
        { ...stamp, at: { ...stamp.at, real: i + 1 } }));
    await write({ set: Object.fromEntries(made.map((o) => [`orders.${o.id}`, o])) });
    const app = new WorkshopApp();
    const context = await app._prepareContext({});
    const stops = async () => (await app._preparePartContext("queue", { ...context }, {})).orders.map((v) => v.tabStop);
    assert.deepEqual(await stops(), [true, false, false], "the first row, at first");
    app.activeRow = "o3";
    assert.deepEqual(await stops(), [false, false, true]);
    app.activeRow = "gone";
    assert.deepEqual(await stops(), [true, false, false]);
});

/** The chat log, showing some messages; the messages it is asked to render again. */
function chatLog() {
    const log = { shown: new Set(), updated: [] };
    ui.chat = { element: { querySelector: (selector) => ([...log.shown].some((id) => selector.includes(`"${id}"`)) ? {} : null) },
        updateMessage: (message) => log.updated.push(message.id) };
    const card = (order) => addDocument("ChatMessage", { flags: { [MOD]: { card: { kind: "request", order } } } });
    const check = (order) => addDocument("ChatMessage", { flags: { pf2e: { context: { options: [orderLink(order, 1)] } } } });
    Object.assign(log, { a: card("o1"), b: card("o1"), c: check("o2") });
    addDocument("ChatMessage", { flags: {} });
    log.shown.add(log.a.id).add(log.c.id);
    return log;
}

test("every shown card and check augment is rendered again once this client's status turns ready", () => {
    const log = chatLog();
    chat.registerChatHooks();
    Hooks.callAll("pf2e-artisans-workshop.status", "ready");
    assert.deepEqual(log.updated, [log.a.id, log.c.id], "the log's first messages rendered before the ledger was read");
});

test("an order's cards are rendered again only where the log shows them", () => {
    const log = chatLog();
    chat.ordersChanged(["o1"]);
    assert.deepEqual(log.updated, [log.a.id], "the other card is not in the log: core would post it at the bottom, out of order");
});

test("from a detached Workshop, the request form and the dialogs open in its window (10.1)", async () => {
    const app = new WorkshopApp();
    app.window = { windowId: "detached-1" };
    await WorkshopApp.DEFAULT_OPTIONS.actions.request.call(app);
    assert.equal(app.children.length, 1);
    assert.ok(app.children[0] instanceof RequestForm, "the form is the Workshop's child, so it renders in the same window");
    const asked = [];
    foundry.applications.api.DialogV2.prompt = async (config) => { asked.push(config); return null; };
    foundry.applications.api.DialogV2.confirm = async (config) => { asked.push(config); return false; };
    const target = { closest: () => ({ dataset: { orderId: "o1", rowId: "r1" } }), dataset: {} };
    await WorkshopApp.DEFAULT_OPTIONS.actions.pledge.call(app, null, target);
    await WorkshopApp.DEFAULT_OPTIONS.actions.reverse.call(app, null, target);
    assert.deepEqual(asked.map((config) => config.renderOptions?.window?.windowId), ["detached-1", "detached-1"]);
});
