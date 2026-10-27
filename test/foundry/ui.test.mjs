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
    async _onRender() {}
    renderChild(app) { this.children.push(app); return app; }
};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const { makeOrder } = await import("../../scripts/logic/orders.mjs");
const { earmarkInputs } = await import("../../scripts/logic/funds.mjs");
const { orderView } = await import("../../scripts/logic/views.mjs");
const { decorate } = await import("../../scripts/ui/context.mjs");
const { makeRow } = await import("../../scripts/logic/rows.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { read, write } = await import("../../scripts/foundry/store.mjs");
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
        ...Object.values(labels.REQUIREMENT), ...Object.values(labels.DELIVERY),
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
    assert.deepEqual([funds.actualCp, funds.expectedCp, funds.accounts.earmarkedCp], [700, 150, 150]);
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
    await WorkshopApp.DEFAULT_OPTIONS.actions.deposit.call(app, null, target);
    await WorkshopApp.DEFAULT_OPTIONS.actions.reverse.call(app, null, target);
    assert.deepEqual(asked.map((config) => config.renderOptions?.window?.windowId), ["detached-1", "detached-1"]);
});

/** Bo's order for two elixirs (3 gp up front), with Bo's 18 gp in the party fund, 2 gp of it earmarked for the order. */
async function fundedLedger() {
    const stamp = { by: "p2", at: { world: 1, real: 1, server: 1, launch: 0 } };
    const order = makeOrder({ id: "o1", requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid },
        product: { uuid: "U", snapshot: { name: "Elixir", img: "e.webp", level: 1, rarity: "common", traits: [], priceCp: 300, per: 1 } }, quantity: 2 }, stamp);
    const rows = [
        { ...makeRow({ kind: "deposit", idem: "deposit:fund:b:n", cp: 1800, actor: bo.uuid }, stamp), state: "applied" },
        ...earmarkInputs({ orderId: "o1", cp: 200, nonce: "e" }).map((input) => ({ ...makeRow(input, { ...stamp, at: { ...stamp.at, real: 2 } }), state: "applied" })),
    ];
    docs.strongbox.items.get(docs.strongbox.items.find((i) => i.system?.unit === "gp").id).system.quantity = 18;
    await write({ set: { "orders.o1": order, ...Object.fromEntries(rows.map((row) => [`rows.${row.id}`, row])) } });
    return order;
}

test("the Funds tab states the strongbox as the unallocated fund plus what is earmarked, by order and source (A)", async () => {
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    await fundedLedger();
    const app = new WorkshopApp();
    const context = await app._prepareContext({});
    const funds = (await app._preparePartContext("funds", { ...context }, {})).funds;
    assert.equal(funds.identityText, "Strongbox 18 gp = party fund, unallocated 16 gp + earmarked for orders 2 gp.");
    assert.deepEqual(funds.accountOrders.map((o) => [o.name, o.earmarked.map((e) => [e.name, e.amount, e.fund]), o.earmarkedText]),
        [["Elixir", [["Party fund", "2 gp", true]], "2 gp"]]);
    assert.deepEqual(funds.ledger.map((row) => row.kindLabel), ["pf2e-artisans-workshop.Row.Earmark", "pf2e-artisans-workshop.Row.Deposit"],
        "one row per earmark: the fund's mirror row is not listed");
    docs.strongbox.items.find((i) => i.system?.unit === "gp").system.quantity = 19;
    const off = (await app._preparePartContext("funds", { ...context }, {})).funds;
    assert.match(off.identityText, /^Strongbox 19 gp counted\. The ledger accounts for 18 gp.*a GM can reconcile/, "a difference is flagged");
    assert.ok(!off.identityText.includes("1 gp)"), "its amount is a GM's, as reconciliation is");
});

test("Fund this order asks for pp, gp, sp and cp with the shortfall to fill, from the party fund first, and earmarks it (A, B)", async () => {
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    await fundedLedger();
    const app = new WorkshopApp();
    const rendered = [];
    world.render = (path, data) => { rendered.push({ path, data }); return ""; };
    let config = null;
    foundry.applications.api.DialogV2.prompt = async (c) => {
        config = c;
        const form = { elements: { namedItem: (name) => ({ gp: { value: "1" }, actor: { value: bo.uuid } })[name] ?? null },
            querySelector: () => ({ value: "fund" }) };
        return c.ok.callback(null, { form });
    };
    await app.fundPrompt("o1", { prefill: true });
    const data = rendered.find((r) => r.path.endsWith("prompts/amount.hbs")).data;
    assert.deepEqual(data.coins.map((c) => [c.denomination, c.value]), [["pp", ""], ["gp", "1"], ["sp", ""], ["cp", ""]], "3 gp less the 2 gp held");
    assert.deepEqual([data.fill.gp, data.fill.sp, data.fill.cp, data.fill.label], [1, 0, 0, "Fill the shortfall (1 gp)"]);
    assert.deepEqual(data.sources.map((x) => [x.value, x.checked, x.disabled]), [["fund", true, false], ["purse", false, false]]);
    assert.match(data.intro, /needs 3 gp up front and holds 2 gp: 1 gp more/);
    assert.equal(typeof config.render, "function", "the fields are wired once rendered: Fill, and the button enabled only for a usable amount");
    const earmarks = (await import("../../scripts/foundry/store.mjs")).records("rows").filter((r) => r.kind === "allocate" && r.order === "o1");
    assert.deepEqual(earmarks.map((r) => r.alloc).sort((a, b) => a - b), [100, 200], "the 1 gp was earmarked from the party fund");
    world.render = null;
});

test("the amount form fills the shortfall and keeps its button off while the amount cannot be used (B)", async () => {
    const { wireAmountForm } = await import("../../scripts/ui/prompts.mjs");
    const inputs = Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, { value: "" }]));
    const listeners = {};
    const fill = { dataset: { pp: "0", gp: "17", sp: "1", cp: "4" }, addEventListener: (_type, fn) => { listeners.fill = fn; } };
    const problem = { textContent: "" };
    const confirm = { disabled: false };
    const box = { querySelector: (sel) => ({ "button[data-fill]": fill, ".amount-problem": problem, "select[name='actor']": null })[sel] ?? null,
        addEventListener: (type, fn) => { listeners[type] = fn; } };
    const form = { elements: { namedItem: (name) => inputs[name] ?? null }, querySelector: () => null };
    const root = { querySelector: (sel) => ({ form, ".pf2e-artisans-workshop-amount": box, "button[data-action='ok']": confirm })[sel] ?? null };
    wireAmountForm(root, () => ({ minCp: null, maxCp: 2000 }));
    assert.deepEqual([confirm.disabled, problem.textContent], [true, lang["pf2e-artisans-workshop.Prompt.Problem.Nothing"]]);
    listeners.fill({ currentTarget: fill });
    assert.deepEqual(Object.values(inputs).map((i) => i.value), ["", "17", "1", "4"]);
    assert.deepEqual([confirm.disabled, problem.textContent], [false, ""]);
    inputs.gp.value = "1.5";
    listeners.input();
    assert.deepEqual([confirm.disabled, problem.textContent], [true, lang["pf2e-artisans-workshop.Prompt.Problem.BadNumber"]]);
    inputs.gp.value = "21";
    listeners.input();
    assert.equal(confirm.disabled, true, "more than the most");
});

test("requirements read as plain names: the met ones counted, an underfunded G8 with its Fund it amount (C)", () => {
    const gates = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G9", "G10", "G11", "G12"].map((id) => ({ id, ok: true }));
    gates.push({ id: "G8", ok: false, reason: "underfunded", data: { shortCp: 1714 } });
    const order = makeOrder({ id: "o1", requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid }, crafter: bo.uuid,
        product: { uuid: "U", snapshot: { name: "Elixir", priceCp: 3500, per: 1 } }, quantity: 1 }, { by: "p2", at: { real: 1 } });
    const viewer = { userId: "p2", isGM: false, owns: () => true, hasCharacter: true };
    const view = decorate(orderView(order, { gates, viewer, nameOf: () => "Bo" }), order);
    assert.equal(view.requirementsText.countText, "11 of 12 met");
    assert.deepEqual(view.requirementsText.metList.slice(0, 2).map((g) => g.name), ["Trained in PF2E.SkillCrafting", "Item level within the crafter's level"]);
    assert.deepEqual(view.requirementsText.unmet.map((g) => [g.name, g.action, g.fillCp]), [["Up-front materials funded", "fund", 1714]]);
    assert.ok(!view.requirementsText.unmet[0].name.includes("G8"), "no gate codes for players");
    assert.equal(view.showWorkRule, true, "an accepted order explains the work days");
});

test("the magnifying glass opens the request form with its item search focused, and Browse opens pf2e's Compendium Browser (F)", async () => {
    const app = new WorkshopApp();
    await WorkshopApp.DEFAULT_OPTIONS.actions.findItem.call(app);
    const [form] = app.children;
    assert.ok(form instanceof RequestForm);
    const focused = [];
    form.element = { querySelector: (sel) => (sel === "input[name='search']" ? { focus: () => focused.push(sel) } : null) };
    await form._onRender({}, {});
    await form._onRender({}, {});
    assert.deepEqual(focused, ["input[name='search']"], "focused once, not on every re-render");
    const opened = [];
    game.pf2e = { compendiumBrowser: { openTab: async (tab) => opened.push(tab) } };
    await RequestForm.DEFAULT_OPTIONS.actions.browse.call(form);
    assert.deepEqual(opened, ["equipment"]);
    delete game.pf2e;
    const queue = template("workshop/queue.hbs");
    assert.match(queue, /data-action="findItem"[^>]*>\s*<i class="fa-solid fa-magnifying-glass"/s);
    assert.equal(lang["pf2e-artisans-workshop.Queue.Search"], "Filter orders", "the search box filters orders; finding items is the form's");
});

test("the header's pickup shelf count is itself the Collect button while something waits (E)", () => {
    const header = template("workshop/header.hbs");
    assert.match(header, /<button type="button" class="take" data-action="take"[^>]*>\s*<i[^>]*><\/i><span>\{\{localize "pf2e-artisans-workshop\.Window\.Shelf"/s);
});

test("Give back to the party fund, from the window, on a closed order holding a late earmark: the dialog allows what the detail offers (review fix)", async () => {
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    const order = await fundedLedger();
    // Cancelled before the earmark landed (planned before the cancel, written after it).
    const stamp = { by: "p2", at: { world: 1, real: 3, server: 3, launch: 0 } };
    await write({ set: { "orders.o1.status": "cancelled" }, replace: { "orders.o1.log": { 1: { seq: 1, event: "cancel", from: "requested",
        to: "cancelled", prev: { status: order.status }, rows: [], ...stamp } } } });
    const { records } = await import("../../scripts/foundry/store.mjs");
    const view = orderView(read("orders.o1"), { rows: records("rows").filter((r) => r.order === "o1"),
        viewer: { userId: "p2", isGM: false, owns: () => true, hasCharacter: true }, nameOf: () => "Bo" });
    assert.deepEqual([view.actions.returnToFund, view.fundReturnableCp], [true, 200], "the detail offers all of it back");
    const rendered = [];
    world.render = (path, data) => { rendered.push({ path, data }); return ""; };
    const warned = [];
    ui.notifications.warn = (message) => warned.push(message);
    foundry.applications.api.DialogV2.prompt = async (c) => {
        const form = { elements: { namedItem: (name) => ({ gp: { value: "2" } })[name] ?? null }, querySelector: () => null };
        return c.ok.callback(null, { form });
    };
    const app = new WorkshopApp();
    await WorkshopApp.DEFAULT_OPTIONS.actions.returnToFund.call(app, null, { closest: () => ({ dataset: { orderId: "o1" } }), dataset: {} });
    world.render = null;
    const data = rendered.find((r) => r.path.endsWith("prompts/amount.hbs")).data;
    assert.deepEqual([data.max, data.fill?.gp], ["2 gp", 2], "the limit and Fill in all of it are the 2 gp");
    assert.deepEqual(warned, []);
    assert.equal(records("rows").filter((r) => r.order === "o1").reduce((sum, r) => sum + r.alloc, 0), 0, "nothing stranded on the closed order");
});

/** Bo's order for two elixirs (3 gp up front, nothing earmarked) and 50 cp in the party fund: the fund cannot cover it. */
async function thinFund() {
    const stamp = { by: "p2", at: { world: 1, real: 1, server: 1, launch: 0 } };
    const order = makeOrder({ id: "o1", requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid },
        product: { uuid: "U", snapshot: { name: "Elixir", img: "e.webp", level: 1, rarity: "common", traits: [], priceCp: 300, per: 1 } }, quantity: 2 }, stamp);
    const row = { ...makeRow({ kind: "deposit", idem: "deposit:fund:b:n", cp: 50, actor: bo.uuid }, stamp), state: "applied" };
    await write({ set: { "orders.o1": order, [`rows.${row.id}`]: row } });
}

/** Open a money prompt through `open` and return the data its template was rendered with (the dialog is dismissed). */
async function promptData(open) {
    const rendered = [];
    world.render = (path, data) => { rendered.push({ path, data }); return ""; };
    foundry.applications.api.DialogV2.prompt = async () => null;
    try {
        await open();
    } finally {
        world.render = null;
    }
    return rendered.find((r) => r.path.endsWith("prompts/amount.hbs"))?.data ?? null;
}

test("a money prompt starts on a purse when the party fund cannot cover what is needed, and says why the fund will not do (review fix)", async () => {
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    lang["PF2E.CurrencyAbbreviations.sp"] = "sp";
    await thinFund();
    const app = new WorkshopApp();
    const data = await promptData(() => app.fundPrompt("o1", { prefill: true }));
    assert.deepEqual(data.sources.map((x) => [x.value, x.checked, x.disabled]), [["fund", false, false], ["purse", true, false]],
        "5 sp unallocated cannot cover the 3 gp prefilled: the purse first, the fund still there to choose");
    const { firstSource, problemText } = await import("../../scripts/ui/prompts.mjs");
    assert.equal(firstSource({ fundCp: 50, needCp: 300, hasPurse: false }), "fund", "with no character, the fund for what it has");
    assert.equal(firstSource({ fundCp: 300, needCp: 300, hasPurse: true }), "fund");
    assert.equal(problemText({ ok: false, reason: "too-much", maxCp: 50 }, 50), "The party fund has only 5 sp unallocated: enter less, or take it from a purse.");
    assert.equal(problemText({ ok: false, reason: "too-little", minCp: 300 }, 50),
        "The party fund has only 5 sp unallocated and 3 gp is needed: take it from a purse.", "never just 'At least 3 gp' while the fund is chosen");
    assert.equal(problemText({ ok: false, reason: "too-much", maxCp: 50 }), "At most 5 sp.", "a purse's limit reads as before");
});

test("Fill the shortfall fills no more than the party fund holds while the fund is the source (review fix)", async () => {
    const { wireAmountForm } = await import("../../scripts/ui/prompts.mjs");
    const inputs = Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, { value: "" }]));
    const listeners = {};
    const fill = { dataset: { fill: "", pp: "0", gp: "3", sp: "0", cp: "0" }, addEventListener: (_type, fn) => { listeners.fill = fn; } };
    const box = { querySelector: (sel) => ({ "button[data-fill]": fill, ".amount-problem": { textContent: "" } })[sel] ?? null,
        addEventListener: (type, fn) => { listeners[type] = fn; } };
    const form = { elements: { namedItem: (name) => inputs[name] ?? null }, querySelector: () => null };
    const root = { querySelector: (sel) => ({ form, ".pf2e-artisans-workshop-amount": box, "button[data-action='ok']": { disabled: false } })[sel] ?? null };
    wireAmountForm(root, () => ({ minCp: null, maxCp: 50, fundCp: 50 }));
    listeners.fill({ currentTarget: fill });
    assert.deepEqual(Object.values(inputs).map((i) => i.value), ["", "", "5", ""], "5 sp, not the 3 gp the order lacks");
});

test("the amount dialog opens with focus in its gold field (review fix)", async () => {
    await fundedLedger();
    const app = new WorkshopApp();
    const data = await promptData(() => WorkshopApp.DEFAULT_OPTIONS.actions.deposit.call(app));
    assert.deepEqual(data.coins.filter((c) => c.autofocus).map((c) => c.denomination), ["gp"]);
    assert.match(template("prompts/amount.hbs"), /<input type="number" name="\{\{denomination\}\}"[^>]*\{\{#if autofocus\}\}autofocus\{\{\/if\}\}/,
        "DialogV2 focuses the first [autofocus]: the gold field comes before its (disabled) confirm button");
});

test("with one character, the purse option names them and no 'From' line suggests they pay from the party fund (review fix)", async () => {
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    await fundedLedger();
    const app = new WorkshopApp();
    const fund = await promptData(() => app.fundPrompt("o1"));
    assert.equal(fund.sources.find((x) => x.value === "purse").label, "Bo's purse (the coins move into the strongbox)");
    assert.equal(fund.from, null);
    const deposit = await promptData(() => WorkshopApp.DEFAULT_OPTIONS.actions.deposit.call(app));
    assert.deepEqual([deposit.sources, deposit.from], [null, "From Bo"], "with no source to choose, the line says whose purse it is");
    assert.doesNotMatch(template("prompts/amount.hbs"), /Prompt\.From/, "the line is the prompt's choice, not the template's");
});

test("the Funds tab's member table agrees with its cards: Bo's 18 gp is 16 gp unallocated and 2 gp earmarked (review fix)", async () => {
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    await fundedLedger();
    const app = new WorkshopApp();
    const context = await app._prepareContext({});
    const funds = (await app._preparePartContext("funds", { ...context }, {})).funds;
    assert.deepEqual(funds.members.map((m) => [m.name, m.inOrders, m.fundUnallocated, m.fundEarmarked, m.total]), [["Bo", "0 gp", "16 gp", "2 gp", "18 gp"]]);
    const table = template("workshop/funds.hbs");
    for (const key of ["Funds.InOrders", "Funds.FundShareUnallocated", "Funds.FundShareEarmarked", "Funds.MembersHint"]) assert.ok(table.includes(key), key);
});

test("a live update keeps the met requirements as the user left them, and focus on the summary or the right Fund button (review fix, 10.9)", async () => {
    const app = new WorkshopApp();
    const listeners = [];
    app.element = { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
    app._onFirstRender({}, {});
    const toggle = listeners.find((l) => l.type === "toggle");
    assert.equal(toggle?.capture, true, "`toggle` does not bubble: the window listens in the capture phase");
    toggle.fn({ target: { classList: { contains: (c) => c === "detail-met" }, open: true } });
    assert.equal(app.metOpen, true);
    await fundedLedger();
    app.selected = "o1";
    const context = await app._prepareContext({});
    assert.equal((await app._preparePartContext("queue", { ...context }, {})).selected.metOpen, true, "rendered open again");
    toggle.fn({ target: { classList: { contains: () => false }, open: false } });
    assert.equal(app.metOpen, true, "another details element does not change it");
    const queue = template("workshop/queue.hbs");
    assert.match(queue, /<details class="detail-met"\{\{#if metOpen\}\} open\{\{\/if\}\}>\s*<summary data-toggle="met">/);
    const detail = fake("aside", { data: { orderId: "o1" } });
    assert.equal(focusSelector(fake("summary", { data: { toggle: "met" }, scope: detail })), 'aside[data-order-id="o1"] summary[data-toggle="met"]');
    const fundIt = queue.match(/<button[^>]*>(?=<i class="fa-solid fa-coins" inert><\/i>\{\{localize "pf2e-artisans-workshop\.Action\.FundIt"\}\})/)[0];
    const fundOrder = queue.match(/<div class="detail-actions">[\s\S]*?(<button type="button" data-action="fund"[^>]*>)/)[1];
    const selectorOf = (html) => focusSelector(fake("button", { scope: detail, data: Object.fromEntries([...html.matchAll(/data-([a-z-]+)="([^"]*)"/g)]
        .map(([, key, value]) => [key.replace(/-([a-z])/g, (_m, c) => c.toUpperCase()), value])) }));
    assert.notEqual(selectorOf(fundIt), selectorOf(fundOrder), "Fund it and Fund this order are told apart");
    app.element = null;
});

test("the pickup shelf tells only those who can collect to collect, and the Queue row has the Collect button (review fix, E)", async () => {
    const cy = addDocument("Actor", { name: "Cy", type: "character", ownership: { default: 0, p3: 3 } });
    const order = makeOrder({ id: "o1", requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid },
        product: { uuid: "U", snapshot: { name: "Elixir", priceCp: 300, per: 1 } }, quantity: 1 }, { by: "p2", at: { real: 1 } });
    const viewer = { userId: "p2", isGM: false, owns: () => true, hasCharacter: true };
    const shelved = (to) => decorate(orderView({ ...order, status: "complete", recipient: { kind: "actor", uuid: to } },
        { viewer, nameOf: (uuid) => fromUuidSync(uuid)?.name ?? null, shelfCount: 1 }), order);
    const mine = shelved(bo.uuid);
    assert.deepEqual([mine.canCollect, mine.deliveryText], [true, "Waiting on the pickup shelf for Bo: collect it."]);
    const theirs = shelved(cy.uuid);
    assert.deepEqual([theirs.canCollect, theirs.deliveryText], [false, "Waiting on the pickup shelf for Cy."], "no Collect to point at");
    const row = template("workshop/queue.hbs").match(/<div class="order-actions">[\s\S]*?<\/div>/)[0];
    assert.match(row, /\{\{#if canCollect\}\}<button type="button" class="primary" data-action="take"/, "the row's Collect, where the sentence is shown");
});

test("Retry with too little earmarked asks where the rest comes from, as Finish does; the refusal says so without escrow (review fix)", async () => {
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    const order = makeOrder({ id: "o1", requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid }, crafter: bo.uuid,
        product: { uuid: "U", snapshot: { name: "Elixir", priceCp: 300, per: 1 } }, quantity: 2 }, { by: "p2", at: { real: 1 } });
    await write({ set: { "orders.o1": { ...order, status: "failed", attempt: 1, priceCp: 600, upfrontCp: 300 } } });
    const app = new WorkshopApp();
    let title = null;
    const data = await promptData(async () => {
        const prompt = foundry.applications.api.DialogV2.prompt;
        foundry.applications.api.DialogV2.prompt = async (config) => { title = config.window.title; return prompt(config); };
        await WorkshopApp.DEFAULT_OPTIONS.actions.op.call(app, null, { closest: () => ({ dataset: { orderId: "o1" } }), dataset: { op: "retry" },
            isConnected: false });
    });
    assert.equal(title, "pf2e-artisans-workshop.Prompt.Retry.Title");
    assert.match(data?.intro ?? "", /Another attempt needs 3 gp up front and the order holds 0 gp: 3 gp more/);
    assert.deepEqual(data.coins.map((c) => c.value), ["", "3", "", ""], "the shortfall filled in");
    assert.doesNotMatch(lang["pf2e-artisans-workshop.Refusal.Underfunded"], /escrow/);
});
