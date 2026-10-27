/**
 * The Morning tab and the M7 chat cards over the fake world (DESIGN.md 10.1, 10.5, 7.1-7.10, M7), as far as they run
 * without a browser: who sees which characters, the pools in words, the plan's choices, the talisman picker and its state,
 * the standing orders, the badge, the affix board, every M7 label a key, and the Morning and Expiry cards.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";
import { asCharacter, compendiumItem, predicate } from "./pf2e-crafting.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
game.i18n.has = (key) => key in lang;
CONFIG.PF2E = { skills: {}, rarityTraits: {} };

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

const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { familyKey } = await import("../../scripts/logic/families.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { resetCatalogue } = await import("../../scripts/foundry/catalogue.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const expiry = await import("../../scripts/foundry/expiry.mjs");
const morningFoundry = await import("../../scripts/foundry/morning.mjs");
const { write } = await import("../../scripts/foundry/store.mjs");
const labels = await import("../../scripts/ui/labels.mjs");
const { WorkshopApp } = await import("../../scripts/ui/workshop.mjs");
const { focusSelector } = await import("../../scripts/ui/focus.mjs");
const morningUi = await import("../../scripts/ui/morning.mjs");
const chat = await import("../../scripts/ui/chat.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

let vera;
let bo;
let items;

beforeEach(async () => {
    resetWorld();
    state.resetState();
    resetLease();
    resetCatalogue();
    morningFoundry.resetMorning();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    world.index = [];
    world.compendium = {};
    items = {
        minor: compendiumItem({ id: "elixirMinor00001", name: "Elixir of Life (Minor)", level: 1, traits: ["alchemical", "consumable", "elixir", "healing"] }),
        fear: compendiumItem({ id: "fearGem000000001", name: "Fear Gem", level: 4, category: "talisman", traits: ["consumable", "magical", "talisman"] }),
    };
    game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => world.index }]]);
    vera = addDocument("Actor", { name: "Vera", type: "character", ownership: { default: 0, p1: 3 }, items: [
        { type: "feat", name: "Talisman Dabbler Dedication", sourceId: REGISTRY["talisman-dabbler-dedication"].uuid },
        { type: "feat", name: "Root Magic", sourceId: REGISTRY["root-magic"].uuid },
    ] });
    asCharacter(vera, { level: 10, formulas: [items.minor.uuid], classDc: 28 });
    vera.crafting.add({ slug: "advanced-alchemy", label: "Advanced Alchemy", maxSlots: 4, maxItemLevel: 10, batchSize: 2, prepared: [{ uuid: items.minor.uuid, quantity: 4 }],
        craftableItems: [predicate("item:trait:alchemical", "item:trait:consumable")] });
    vera.crafting.add({ slug: "talisman-dabbler", label: "Talisman Dabbler", maxSlots: 2, maxItemLevel: 5, craftableItems: [predicate("item:trait:talisman")] });
    bo = addDocument("Actor", { name: "Bo", type: "character", ownership: { default: 0, p2: 3 }, items: [] });
    asCharacter(bo, { level: 8 });
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [vera, bo] };
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    game.time.worldTime = 0;
    game.pf2e = { settings: { variants: { pwol: { enabled: false } } } };
});

/** The Morning part's context as the window builds it, on the Morning tab. */
async function morningPart(app) {
    app.tabGroups.primary = "morning";
    const context = await app._prepareContext({});
    return app._preparePartContext("morning", { ...context, readable: true }, {});
}

test("the Morning tab: a player's own characters, each pool in words with its plan choices, the talisman picker and its DC (10.1, 7.1)", async () => {
    const app = new WorkshopApp();
    await morningFoundry.saveLoadout(vera, { name: "Healer", pools: { "advanced-alchemy": [{ family: familyKey(items.minor), qty: 4 }] } });
    const part = await morningPart(app);
    const m = part.morning;
    assert.deepEqual(m.choices.map((c) => c.name), ["Vera"], "a player sees their own characters only");
    assert.equal(m.state.word, "Ready to prepare");
    assert.equal(m.canPrepare, true);
    const [aa, dabbler] = m.pools;
    assert.equal(aa.label, "Advanced Alchemy");
    assert.equal(aa.slots, "2 of 4 batches");
    assert.deepEqual(aa.byLevel, ["Level 1: 4"]);
    assert.deepEqual(aa.plans.map((p) => p.label), ["Keep the current preparation", "Healer"]);
    assert.deepEqual(dabbler.offered.map((o) => [o.name, o.picked]), [["Fear Gem", false]]);
    assert.equal(dabbler.dcStamp, "Talismans made here use DC 28 for their saves.");
    assert.deepEqual(m.gaps.map((g) => [g.name, g.notAutomated]), [["root-magic", true]], "pf2e-dailies inactive: Root Magic is not automated");
    // Picking a talisman and a loadout: the plan follows the tab's state.
    assert.equal(morningUi.onMorningChange(app, { dataset: { morning: "talisman", pool: "talisman-dabbler", uuid: items.fear.uuid }, checked: true }), true);
    assert.equal(morningUi.onMorningChange(app, { dataset: { morning: "plan", pool: "advanced-alchemy" }, value: Object.keys(morningFoundry.loadoutsOf(vera))[0] }), true);
    const again = (await morningPart(app)).morning;
    assert.deepEqual(again.pools[1].offered.map((o) => o.picked), [true]);
    assert.equal(again.pools[1].lines[0].route.key, "pf2e-artisans-workshop.Morning.Route.Virtual");
    assert.ok(again.pools[0].lines.length > 0, "the loadout's lines");
    // A count per talisman (second review fix): two of one are two picks.
    assert.equal(morningUi.onMorningChange(app, { type: "number", value: "2", dataset: { morning: "talisman", pool: "talisman-dabbler", uuid: items.fear.uuid } }), true);
    assert.deepEqual(app.morning.talismans["talisman-dabbler"], [items.fear.uuid, items.fear.uuid]);
    const two = (await morningPart(app)).morning.pools[1];
    assert.deepEqual([two.offered[0].count, two.pickedCount, two.lines[0].qty], [2, "2", "2"]);
    world.currentUser = "gm00000000000000";
    const gm = (await morningPart(new WorkshopApp())).morning;
    assert.deepEqual(gm.choices.map((c) => c.name), ["Vera", "Bo"], "a GM sees every member");
});

test("a corrected pool shows pf2e's count beside the rules'; the tab asks whether the preparations are in the wilderness (second review fix, 7.1)", async () => {
    vera.addItem({ type: "feat", name: "Herbalist Dedication", sourceId: REGISTRY["herbalist-dedication"].uuid });
    vera.rules = [{ key: "CraftingAbility", slug: "advanced-alchemy", maxSlots: 4, resolveValue: (v) => v, craftableItems: predicate("item:trait:healing"),
        item: { sourceId: REGISTRY["herbalist-dedication"].uuid, slug: "herbalist-dedication", name: "Herbalist Dedication" } }];
    const app = new WorkshopApp();
    const m = (await morningPart(app)).morning;
    assert.equal(m.wildernessAsked, true);
    assert.equal(m.pools[0].corrected, "pf2e counts 4; the rules allow 2");
    assert.equal(m.pools[0].slots, "2 of 2 batches");
    assert.equal(morningUi.onMorningChange(app, { dataset: { morning: "wilderness" }, checked: true }), true);
    const wild = (await morningPart(app)).morning;
    assert.deepEqual([wild.wilderness, wild.pools[0].corrected, wild.pools[0].slots], [true, null, "2 of 4 batches"]);
});

test("standing orders due show as chips the crafter may leave out; the badge counts characters waiting after a rest (7.6, 7.8)", async () => {
    await write({ set: { "standing.s1": { id: "s1", v: 1, requester: bo.uuid, crafter: vera.uuid, recipient: bo.uuid, pool: "advanced-alchemy",
        family: familyKey(items.minor), name: "Elixir of Life (Minor)", qty: 2, fromDay: 0, untilDay: null, active: true, last: null } } });
    const app = new WorkshopApp();
    const m = (await morningPart(app)).morning;
    assert.deepEqual(m.due.map((d) => [d.text, d.included]), [["2 Elixir of Life (Minor) for Bo (asked by Bo)", true]]);
    morningUi.onMorningChange(app, { dataset: { morning: "standing", standing: "s1" }, checked: false });
    assert.equal((await morningPart(app)).morning.due[0].included, false);
    assert.equal(morningUi.morningBadge(), 0);
    await expiry.beginCycle(vera, { key: "rest" });
    assert.equal(morningUi.morningBadge(), 1);
    const nav = await app._preparePartContext("nav", { ...(await app._prepareContext({})), readable: true }, {});
    assert.equal(nav.badges.morning, 1);
    assert.equal(nav.badgeLabels.morning, "1 character waiting to prepare", "a key of its own for one");
});

test("the affix board in the tab: hosts and their state, loose talismans with a host to choose (7.4)", async () => {
    vera.addItem({ type: "armor", name: "Leather", system: { equipped: { inSlot: true } } });
    vera.addItem({ type: "consumable", name: "Fear Gem", traits: ["talisman"] });
    const m = (await morningPart(new WorkshopApp())).morning;
    assert.deepEqual(m.board.hosts.map((h) => [h.name, h.state]), [["Leather", "Nothing affixed"]]);
    assert.deepEqual(m.board.loose.map((t) => t.name), ["Fear Gem"]);
    assert.equal(m.board.minutes, "Affixing the loose talismans takes about 10 minutes of your preparations.", "a Dabbler: four per 10 minutes");
});

test("the Morning tab is a tab of the window between Funds and Formulas, with its badge; its controls are found again after a render", () => {
    assert.deepEqual(WorkshopApp.TABS.primary.tabs.map((t) => t.id), ["queue", "funds", "morning", "formulas", "downtime"]);
    assert.ok(WorkshopApp.PARTS.morning);
    const el = (data) => ({ tagName: "INPUT", id: "", dataset: data, getAttribute: () => null, closest: () => null });
    assert.equal(focusSelector(el({ morning: "talisman", pool: "talisman-dabbler", uuid: "U" })), 'input[data-uuid="U"][data-pool="talisman-dabbler"][data-morning="talisman"]');
    const template = readFileSync(join(ROOT, "templates/workshop/morning.hbs"), "utf8");
    assert.match(template, /role="tabpanel"/);
    assert.match(template, /data-action="morning" data-op="prepare"/);
});

test("every M7 label is a key in lang/en.json", () => {
    const source = ["scripts/ui/morning.mjs", "scripts/foundry/morning.mjs", "scripts/foundry/expiry.mjs", "scripts/foundry/rest.mjs", "scripts/foundry/dailies.mjs",
        "templates/workshop/morning.hbs", "templates/chat/morning.hbs"].map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
    const keys = [...source.matchAll(/pf2e-artisans-workshop\.[A-Z][A-Za-z0-9.]*[A-Za-z0-9]/g)].map((m) => m[0]);
    assert.ok(keys.length > 80);
    for (const key of [...new Set(keys)]) assert.ok(lang[key], key);
    for (const code of ["prepared", "sheet", "plan", "busy", "off", "no-loadout", "bad-loadout", "nothing-prepared", "no-crafter", "bad-standing", "no-standing",
        "not-preservable", "too-many"]) {
        assert.ok(lang[labels.REFUSAL[code]], code);
    }
});

test("the Morning and Expiry cards: what was made, the DC stamp, deliveries, and what expired, whispered to the owners and GMs (10.5)", async () => {
    const rendered = [];
    world.render = (path, data) => {
        rendered.push([path, data]);
        return "<div></div>";
    };
    const created = [];
    ChatMessage.implementation.create = async (data) => {
        created.push(data);
        return data;
    };
    ChatMessage.implementation.getSpeaker = () => ({});
    await chat.postMorningCard(vera, { created: [{ name: "Elixir of Life (Minor)", qty: 2 }, { name: "Elixir of Life (Minor)", qty: 2 }, { name: "Fear Gem", qty: 1 }],
        dc: 28, deliveries: [{ ok: true, outcome: "ok", direct: false, name: "Elixir of Life (Minor)", qty: 2, recipient: "Bo" }] });
    const [, data] = rendered.at(-1);
    assert.deepEqual(data.lines, ["Elixir of Life (Minor) × 4", "Fear Gem × 1"]);
    assert.deepEqual(data.notes.map((n) => n.text), ["Save DCs on the new talismans use DC 28.", "2 Elixir of Life (Minor) left on the pickup shelf for Bo.",
        "These items expire at the next daily preparations; Advanced Alchemy items also after 24 hours."]);
    assert.deepEqual(created.at(-1).whisper.sort(), ["gm00000000000000", "p1"]);
    await chat.postExpiryCard(bo, [{ name: "Elixir of Life (Minor)", creator: vera.uuid, reason: "cycle" }]);
    assert.deepEqual(rendered.at(-1)[1].lines, ["Elixir of Life (Minor), made by Vera: its creator made new daily preparations"]);
    assert.deepEqual(created.at(-1).whisper.sort(), ["gm00000000000000", "p1", "p2"], "Bo's owner, the GMs and the client that posted it");
});

test("Morning off: the tab says so and the Workshop does not prepare (14.1)", async () => {
    await game.settings.set("pf2e-artisans-workshop", "features.morning", false);
    const part = await morningPart(new WorkshopApp());
    assert.equal(part.morningOff, true);
    assert.equal((await morningFoundry.applyMorning(vera, {})).reason, "off");
    Object.defineProperty(globalThis, "navigator", realNavigator);
});

test("Affix in the tab takes the host chosen in the talisman's own row (review fix: the button itself carries the talisman)", async () => {
    vera.addItem({ type: "equipment", name: "Repair Toolkit", sourceId: REGISTRY["repair-toolkit"].uuid });
    const armor = vera.addItem({ type: "armor", name: "Leather", system: { equipped: { inSlot: true } } });
    const gem = vera.addItem({ type: "consumable", name: "Jade Cat", traits: ["talisman"], system: { usage: { value: "affixed-to-armor" } } });
    const select = { value: armor.id };
    const li = { dataset: { talisman: gem.id }, querySelector: (sel) => (sel === "select[data-morning='host']" ? select : null) };
    // A DOM-like `closest`: the button matches `[data-talisman]` itself, and its list item matches `li`.
    const button = { dataset: { op: "affix", talisman: gem.id }, querySelector: () => null,
        closest: (sel) => (sel === "[data-talisman]" ? button : sel === "li" ? li : null) };
    const app = new WorkshopApp();
    const result = await morningUi.onMorningOp(app, button);
    assert.equal(result?.ok, true, JSON.stringify(result));
    assert.equal(vera.items.get(gem.id).flags["pf2e-artisans-workshop"].affix.host, armor.id);
});

test("a field's change on the press of a button renders after the click, not before: typing a talisman count and clicking Make daily preparations at once is one click (M7 live pass)", async () => {
    const app = new WorkshopApp();
    const on = { element: [], doc: [] };
    const doc = {
        addEventListener: (type, fn, capture) => on.doc.push({ type, fn, capture }),
        removeEventListener: (type, fn) => { on.doc = on.doc.filter((l) => l.type !== type || l.fn !== fn); },
    };
    app.element = { ownerDocument: doc, addEventListener: (type, fn, capture) => on.element.push({ type, fn, capture }) };
    app._onFirstRender({}, {});
    app.rendered = true;
    const renders = [];
    app.render = (options) => { renders.push(options.parts); };
    const listener = (type) => on.element.find((l) => l.type === type);
    assert.equal(listener("pointerdown")?.capture, true, "the press is seen in the capture phase, before the change it causes");
    const count = { type: "number", value: "1", name: "", dataset: { morning: "talisman", pool: "talisman-dabbler", uuid: items.fear.uuid },
        closest: (sel) => (sel === ".workshop-morning" ? {} : null) };
    // The press on the button: the count field loses focus and its change event fires before the release.
    listener("pointerdown").fn({});
    await listener("change").fn({ target: count });
    assert.deepEqual(app.morning.talismans["talisman-dabbler"], [items.fear.uuid], "the count is taken at once, for the click to use");
    assert.deepEqual(renders, [], "nothing renders while the button is pressed: the button the click lands on stays in place");
    // The release: its click runs first, then the held render.
    on.doc.find((l) => l.type === "pointerup").fn({});
    assert.deepEqual(renders, [], "the release's click comes before the render");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(renders, [["morning"]], "the tab renders once the press is over");
    assert.equal(on.doc.length, 0, "the window stops listening to the document");
    // Without a press (Tab out of the field), the change renders at once; a live refresh during a press waits too.
    await listener("change").fn({ target: count });
    assert.deepEqual(renders.at(-1), ["morning"]);
    assert.equal(renders.length, 2);
    listener("pointerdown").fn({});
    app.renderParts(["header", "queue"]);
    await listener("change").fn({ target: count });
    assert.equal(renders.length, 2);
    on.doc.find((l) => l.type === "pointercancel").fn({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(renders.at(-1), ["header", "queue", "morning"], "held parts render together, once");
    app.element = null;
});
