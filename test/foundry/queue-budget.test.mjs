/**
 * The Queue's render budget with a long campaign behind it (M12 performance pass, DESIGN.md 15.7, 10.3): with the performance
 * pass's S2 ledger (200 orders, 2000 rows, 500 day records) the window lists one page of orders and builds the views of no
 * more than it lists, within 50 ms, the budget 15.7 judges a re-render by. Live, most of a Queue render over 200 orders was
 * Foundry's work on their DOM (about 8800 elements), which a page bounds; this measures the module's part, over the fake world.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
CONFIG.PF2E = { skills: { crafting: { label: "PF2E.SkillCrafting" } }, rarityTraits: {} };

foundry.applications.api.ApplicationV2 = class {
    constructor(options = {}) { this.options = options; this.tabGroups = { primary: "queue" }; this.window = {}; this.children = []; }
    async _prepareContext() { return { tabs: { queue: { id: "queue", cssClass: "active" }, funds: { id: "funds", cssClass: "" } } }; }
    async _preparePartContext(_partId, context) { return context; }
    _preSyncPartState() {}
    _syncPartState() {}
    async _onRender() {}
};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const { makeOrder } = await import("../../scripts/logic/orders.mjs");
const { makeRow } = await import("../../scripts/logic/rows.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { write } = await import("../../scripts/foundry/store.mjs");
const { QUEUE_PAGE, WorkshopApp } = await import("../../scripts/ui/workshop.mjs");
const { BUDGETS } = await import("../../tools/harness/perf.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

/** S2's shape (15.7): 200 orders, two in three open as the copied seed orders are, ten rows each, 500 day records. */
const ORDERS = 200;
const ROWS_PER_ORDER = 10;
const DAYS = 500;
const STATES = ["requested", "accepted", "requested", "accepted", "complete", "cancelled"];

let bo;
let docs;
beforeEach(async () => {
    resetWorld();
    state.resetState();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld({ strongboxItems: [coin("gp", 7)] });
    bo = addDocument("Actor", { name: "Bo", type: "character", ownership: { default: 0, p2: 3 }, items: [coin("gp", 50)] });
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [bo] };
    setUsers([{ id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p2");
    state.setShared({ ...docs, status: "ready" });
    const set = {};
    for (let n = 0; n < ORDERS; n += 1) {
        const id = `order${String(n).padStart(11, "0")}`;
        const at = { world: n, real: 1000 + n, server: 1000 + n, launch: 0 };
        const order = makeOrder({ id, requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid }, quantity: 1,
            product: { uuid: "U", snapshot: { name: `Elixir ${n}`, img: "e.webp", level: 1, rarity: "common", traits: [], priceCp: 3000, per: 1 } } },
        { by: "p2", at });
        order.status = STATES[n % STATES.length];
        set[`orders.${id}`] = order;
        for (let r = 0; r < ROWS_PER_ORDER; r += 1) {
            const row = { ...makeRow({ kind: "pledge", idem: `pledge:${id}:b:${r}`, cp: 100, actor: bo.uuid, order: id }, { by: "p2", at }), state: "applied" };
            set[`rows.${row.id}`] = row;
        }
    }
    for (let d = 0; d < DAYS; d += 1) {
        const id = `${bo.id}-${d}`;
        set[`days.${id}`] = { id, v: 1, actor: bo.id, day: d, toDay: d, kind: "idle" };
    }
    await write({ set });
});

/** How many orders have the status `pred` accepts, among the seeded ones. */
const count = (pred) => Array.from({ length: ORDERS }, (_, n) => STATES[n % STATES.length]).filter(pred).length;

/**
 * Count the orders whose view is built from here on: their `product` is read by the view model only, never by the Queue's
 * order, numbering, summary or paging.
 */
function watchViews() {
    const viewed = new Set();
    const orders = docs.ledger.flags["pf2e-artisans-workshop"].orders;
    for (const [id, order] of Object.entries(orders)) {
        orders[id] = new Proxy(order, { get: (target, key, receiver) => {
            if (key === "product") viewed.add(target.id);
            return Reflect.get(target, key, receiver);
        } });
    }
    return viewed;
}

/** The Queue part's context, built `runs` times: the last one, and the median time in ms. */
async function queueContext(app, runs = 5) {
    const context = await app._prepareContext({});
    const times = [];
    let part = null;
    for (let i = 0; i < runs; i += 1) {
        const start = performance.now();
        part = await app._preparePartContext("queue", { ...context }, {});
        times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { part, medianMs: times[Math.floor(times.length / 2)] };
}

test("with 200 orders the Queue lists one page, open orders first, and builds it within the re-render budget", async () => {
    const app = new WorkshopApp();
    const viewed = watchViews();
    const { part, medianMs } = await queueContext(app);
    assert.equal(part.orders.length, QUEUE_PAGE, "one page of rows in the DOM, not 200");
    assert.equal(viewed.size, QUEUE_PAGE, `views were built for ${viewed.size} orders to list ${QUEUE_PAGE}`);
    assert.ok(part.orders.every((view) => !view.isClosed), "the oldest open orders come first");
    assert.equal(part.filtered, false, "a page is not a filter: no Clear filters button");
    assert.equal(part.more.listedText, `${QUEUE_PAGE} of ${ORDERS} orders listed`);
    assert.equal(part.more.buttonText, `Show ${QUEUE_PAGE} more`);
    assert.ok(medianMs < BUDGETS.renderMs, `the Queue's context took ${medianMs.toFixed(1)} ms (budget ${BUDGETS.renderMs} ms)`);
});

test("Show more lists the next page; a filter starts again from the first; the last page says nothing more", async () => {
    const app = new WorkshopApp();
    app.queueLimit += QUEUE_PAGE;
    let { part } = await queueContext(app, 1);
    assert.equal(part.orders.length, 2 * QUEUE_PAGE);
    app.filters = { ...app.filters, scope: "open" };
    assert.equal(app.queueLimit, QUEUE_PAGE, "a new filter starts at the first page");
    ({ part } = await queueContext(app, 1));
    assert.equal(part.orders.length, QUEUE_PAGE);
    assert.equal(part.filtered, true);
    assert.equal(part.more.listedText, `${QUEUE_PAGE} of ${count((s) => !["complete", "cancelled"].includes(s))} orders listed`);
    app.filters = { ...app.filters, scope: "all", status: "cancelled" };
    const { part: cancelled, medianMs } = await queueContext(app);
    const closed = count((s) => s === "cancelled");
    assert.equal(cancelled.orders.length, QUEUE_PAGE);
    assert.ok(cancelled.orders.every((view) => view.status === "cancelled"));
    assert.equal(cancelled.more.buttonText, `Show ${closed - QUEUE_PAGE} more`, "the last page is smaller than a page");
    assert.ok(medianMs < BUDGETS.renderMs, `a filtered Queue took ${medianMs.toFixed(1)} ms (budget ${BUDGETS.renderMs} ms)`);
    app.queueLimit = ORDERS;
    ({ part } = await queueContext(app, 1));
    assert.equal(part.orders.length, closed);
    assert.equal(part.more, null, "everything matching is listed");
});

test("Show more: the next page, focus on the first order it adds, and the status bar says how many are listed (10.9)", async () => {
    const app = new WorkshopApp();
    const rows = Array.from({ length: 2 * QUEUE_PAGE }, (_, i) => ({ dataset: { orderId: `r${i}` }, tabIndex: i === 0 ? 0 : -1, focused: false,
        focus() { this.focused = true; } }));
    let listed = { textContent: `${2 * QUEUE_PAGE} of ${ORDERS} orders listed` };
    app.element = { querySelectorAll: (selector) => (selector === ".order-row" ? rows : []),
        querySelector: (selector) => (selector === ".queue-more .listed" ? listed : null) };
    const renders = [];
    app.render = async (options) => { renders.push(options.parts); };
    await WorkshopApp.DEFAULT_OPTIONS.actions.moreOrders.call(app);
    assert.equal(app.queueLimit, 2 * QUEUE_PAGE);
    assert.deepEqual(renders, [["queue"]]);
    assert.equal(rows[QUEUE_PAGE].focused, true, "focus goes to the first order added");
    assert.deepEqual(rows.filter((r) => r.tabIndex === 0).map((r) => r.dataset.orderId), [`r${QUEUE_PAGE}`], "and it is the list's tab stop");
    assert.equal(app.activeRow, `r${QUEUE_PAGE}`);
    assert.equal(app.lastEvent, `${2 * QUEUE_PAGE} of ${ORDERS} orders listed`);
    listed = null;
    await WorkshopApp.DEFAULT_OPTIONS.actions.moreOrders.call(app);
    assert.equal(app.lastEvent, `All ${2 * QUEUE_PAGE} orders listed`, "the last page has no count line: the status bar says all are listed");
});
