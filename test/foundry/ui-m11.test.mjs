/**
 * The integration surface of M11 over the fake world and a small DOM (DESIGN.md 10.4, 10.8, 10.9, 11.1): the character
 * sheet's header button and Crafting tab strip (beside what PF2e Toolbelt and PF2e Workbench put there), the Party sheet's
 * card (back after pf2e renders its region again), the Actors directory's context menu, the keybinding, the hotbar drop of
 * the macro shelf making one macro, the shelf itself, each catalogue macro's API call, a macro run's reports and the paths
 * that ask for a missing argument, the window's size kept per client, Parchment, the detail's focus trap, the rows' context
 * menu and the tabs' tooltips.
 *
 * ApplicationV2 is `dom.mjs`'s faithful one: Foundry 14.368's read-only properties are getters and `options` is frozen.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { FakeCollection, addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";
import { FakeElement, build, fakeDocument, faithfulApplicationV2, installMutationObserver } from "./dom.mjs";

installFoundry();
const doc = fakeDocument();
installMutationObserver(doc);
globalThis.HTMLElement = FakeElement;
foundry.utils.isElementInstanceOf = (el) => el instanceof FakeElement;
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
game.i18n.has = (key) => key in lang;
CONFIG.PF2E = { skills: { crafting: { label: "PF2E.SkillCrafting" } }, rarityTraits: {} };
foundry.applications.api.ApplicationV2 = faithfulApplicationV2(doc);
foundry.applications.instances = new Map();
const menus = [];
foundry.applications.ux.ContextMenu = { implementation: class { constructor(container, selector, items, options) { menus.push({ container, selector, items, options }); } } };
const drags = [];
foundry.applications.ux.DragDrop = { implementation: class { constructor(config) { drags.push(config); } bind() {} } };
const keybindings = [];
game.keybindings = { register: (namespace, id, config) => keybindings.push({ namespace, id, config }) };
ui.sidebar = { element: { ownerDocument: doc } };
globalThis.canvas = null;   // no canvas: the API and macros fall back to the user's character
const renders = [];
foundry.applications.handlebars.renderTemplate = async (path, data) => {
    renders.push({ path, data });
    return "";
};

const MOD = "pf2e-artisans-workshop";
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { write } = await import("../../scripts/foundry/store.mjs");
const { makeOrder } = await import("../../scripts/logic/orders.mjs");
const { MACROS, macroById, macroCommand } = await import("../../scripts/logic/macros.mjs");
const entry = await import("../../scripts/ui/entry.mjs");
const macros = await import("../../scripts/ui/macros.mjs");
const { WorkshopApp } = await import("../../scripts/ui/workshop.mjs");
const { AdvanceDaysApp } = await import("../../scripts/ui/advance.mjs");
const theme = await import("../../scripts/ui/theme.mjs");
const { tierOf, trapStep, focusablesIn } = await import("../../scripts/ui/focus.mjs");
const { buildApi } = await import("../../scripts/foundry/api.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

let docs;
let bo;
let cy;
let created;
const stamp = { by: "p2", at: { world: 1, real: 1, server: 1, launch: 0 } };
const product = (name = "Elixir") => ({ uuid: `Compendium.pf2e.equipment-srd.Item.${name}`, snapshot: { name, img: "e.webp", level: 1, rarity: "common", traits: [], priceCp: 300, per: 1 } });
/** What Application V1's render hooks pass: jQuery, an array-like with the element first. */
const jq = (element) => Object.assign([element], { jquery: "3.7.1" });

async function addOrder(id, fields = {}, real = 1) {
    const order = { ...makeOrder({ id, requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid }, product: product(id), quantity: 1 },
        { ...stamp, at: { ...stamp.at, real } }), ...fields };
    await write({ set: { [`orders.${id}`]: order } });
    return order;
}

beforeEach(() => {
    resetWorld();
    // The world's hooks start empty with each test: the entry points and the hotbar drop register again.
    keybindings.length = 0;
    entry.registerEntryPoints();
    macros.registerMacroHooks();
    state.resetState();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld({ strongboxItems: [coin("gp", 7)] });
    bo = addDocument("Actor", { name: "Bo", type: "character", ownership: { default: 0, p2: 3 }, items: [coin("gp", 50)] });
    cy = addDocument("Actor", { name: "Cy", type: "character", ownership: { default: 0 }, items: [] });
    const party = addDocument("Actor", { name: "Heroes", type: "party", ownership: { default: 2 } });
    party.members = [bo, cy];
    world.collections.Actor.party = party;
    setUsers([{ id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p2");
    for (const user of world.collections.User) {
        user.hotbar = {};
        user.can = (permission) => permission === "MACRO_SCRIPT" && user.allowScript !== false;
        user.assignHotbarMacro = async (macro, slot) => { user.hotbar[slot] = macro.id; return user; };
    }
    created = [];
    game.macros = new FakeCollection();
    globalThis.Macro = { implementation: { create: async (data) => {
        const macro = { id: `mac${created.length}`, ...data, _source: { author: game.user.id } };
        created.push(macro);
        game.macros.set(macro.id, macro);
        return macro;
    } } };
    state.setShared({ ...docs, status: "ready" });
    world.settings.set(`${MOD}.enabled`, true);
    world.notes.length = 0;
    menus.length = 0;
    WorkshopApp.instance = null;
});

/* -------------------------------------------- */
/*  Character sheet                              */
/* -------------------------------------------- */

/** pf2e 8.6.1's character sheet as far as the hooks see it: the Crafting tab with Toolbelt's and Workbench's additions. */
function characterSheet(actor) {
    const html = build(doc, ["form.pf2e.sheet",
        ["section.sheet-body",
            ["div.tab.crafting.crafting-pane", { "data-group": "primary", "data-tab": "crafting" },
                ["div.crafting-options.item-list"],
                ["ol.directory-list.item-list.crafting-entry-list",
                    ["li.crafting-entry.item-container", { "data-container-type": "craftingEntry", "data-ability": "alchemist" },
                        ["header", ["a.toolbelt-sort", { "data-tooltip": "sort" }]],
                        ["ol.formula-list", ["li.formula-item", { "data-item-uuid": "Compendium.pf2e.equipment-srd.Item.x", "data-rarity": "uncommon" }]]]],
                ["section.known-formulas", ["header", ["a.toolbelt-sort"]], ["ol", ["li.formula-item", { "data-item-uuid": "Compendium.pf2e.equipment-srd.Item.y" }]]]]]]);
    doc.body.append(html);
    return { sheet: { actor }, html };
}

test("the character sheet gets one Workshop button in its header (Application V1) and one control (ApplicationV2), none while the sheet entries are off", () => {
    const buttons = [{ class: "close" }];
    Hooks.callAll("getCharacterSheetPF2eHeaderButtons", { actor: bo }, buttons);
    Hooks.callAll("getCharacterSheetPF2eHeaderButtons", { actor: bo }, buttons);
    assert.deepEqual(buttons.map((b) => b.class), ["pf2e-artisans-workshop-open", "close"], "first, once");
    assert.equal(buttons[0].label, "pf2e-artisans-workshop.Entry.Button");
    const controls = [];
    Hooks.callAll("getHeaderControlsCharacterSheetPF2e", { actor: bo }, controls);
    assert.equal(controls.length, 1);
    assert.equal(typeof controls[0].onClick, "function");
    world.settings.set(`${MOD}.features.sheetEntryPoints`, false);
    const none = [];
    Hooks.callAll("getCharacterSheetPF2eHeaderButtons", { actor: bo }, none);
    Hooks.callAll("getPartySheetPF2eHeaderButtons", { actor: game.actors.party }, none);
    assert.deepEqual(none, []);
});

test("the Crafting tab strip: at the top of the tab, once, leaving Toolbelt's sort buttons and Workbench's formula rows as they were", async () => {
    await addOrder("o1", { crafter: bo.uuid, status: "check" });
    await addOrder("o2", { crafter: bo.uuid, status: "setup" }, 2);
    await addOrder("o3", { requester: cy.uuid }, 3);
    const { sheet, html } = characterSheet(bo);
    const pane = html.querySelector(".tab.crafting.crafting-pane");
    const before = pane.children.slice();
    Hooks.callAll("renderCharacterSheetPF2e", sheet, jq(html));   // V1 passes jQuery
    Hooks.callAll("renderCharacterSheetPF2e", sheet, html);     // and V2 an element: still one strip
    const strips = pane.querySelectorAll(".pf2e-artisans-workshop-strip");
    assert.equal(strips.length, 1);
    assert.equal(pane.children[0], strips[0], "prepended at the top of the tab");
    assert.deepEqual(pane.children.slice(1), before, "pf2e's own children follow, untouched");
    assert.equal(html.querySelectorAll(".formula-item").length, 2, "Workbench's rows are still the only formula rows");
    assert.equal(html.querySelectorAll(".toolbelt-sort").length, 2);
    const strip = strips[0];
    assert.equal(strip.querySelectorAll("li.formula-item, [data-item-id], [data-item-uuid], [data-action]").length, 0,
        "nothing pf2e's listeners, Toolbelt or Workbench read");
    const text = strip.textContent;
    assert.match(text, /Crafting: 2/);
    assert.match(text, /Waiting on your roll or settlement: 1/);
    assert.match(text, /Orders for this character: 3/);
    assert.equal(strip.querySelectorAll("button").length, 3, "Workshop, Request, Morning");
    assert.ok(strip.querySelectorAll("button").every((b) => b.getAttribute("type") === "button"));
    // The Workshop button opens the window acting as the character.
    strip.querySelector("[data-pf2e-artisans-workshop-entry='open']").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(WorkshopApp.instance?.acting, bo.uuid);
    await WorkshopApp.instance.close();
});

test("the strip follows the ledger without a sheet render, and goes when its sheet does", async () => {
    const { sheet, html } = characterSheet(bo);
    Hooks.callAll("renderCharacterSheetPF2e", sheet, html);
    const strip = html.querySelector(".pf2e-artisans-workshop-strip");
    assert.match(strip.textContent, /No Workshop jobs right now/);
    await addOrder("o1", { crafter: bo.uuid, status: "check" });
    entry.refreshEntries();
    assert.match(strip.textContent, /Crafting: 1/);
    html.remove();
    assert.doesNotThrow(() => entry.refreshEntries());
});

test("no strip for a character the user does not own, one outside the party, a sheet without a Crafting tab, or with the entries off", () => {
    const other = characterSheet(cy);
    assert.equal(entry.addCraftingStrip(other.sheet, other.html), null, "Cy is not the user's");
    const stranger = addDocument("Actor", { name: "Dee", type: "character", ownership: { default: 0, p2: 3 } });
    const outside = characterSheet(stranger);
    assert.equal(entry.addCraftingStrip(outside.sheet, outside.html), null, "Dee is not a member");
    const bare = build(doc, ["form", ["section.sheet-body"]]);
    assert.equal(entry.addCraftingStrip({ actor: bo }, bare), null, "a sheet that changed shape only loses the strip");
    world.settings.set(`${MOD}.features.sheetEntryPoints`, false);
    const own = characterSheet(bo);
    assert.equal(entry.addCraftingStrip(own.sheet, own.html), null);
});

/* -------------------------------------------- */
/*  Party sheet                                  */
/* -------------------------------------------- */

function partySheet() {
    const html = build(doc, ["form.party",
        ["section.container",
            ["div.tab", { "data-tab": "overview", "data-region": "overview" },
                ["div.content", ["section.summary", ["nav"]], ["section.member", { "data-actor-uuid": bo.uuid }]]]]]);
    doc.body.append(html);
    return { sheet: { actor: game.actors.party }, html };
}

test("the Party card sits after pf2e's summary, comes back when pf2e renders the region again, and follows the ledger", async () => {
    await addOrder("o1");
    await addOrder("o2", { crafter: bo.uuid, status: "finishing" }, 2);
    const { sheet, html } = partySheet();
    Hooks.callAll("renderPartySheetPF2e", sheet, jq(html));
    const content = html.querySelector(".content");
    assert.equal(content.children[1].classList.contains("pf2e-artisans-workshop-party-card"), true, "after the summary");
    const facts = () => html.querySelector(".pf2e-artisans-workshop-party-card").querySelectorAll("dd").map((dd) => dd.textContent);
    assert.deepEqual(facts().slice(0, 4), ["2", "1", "1", "0"]);
    // pf2e renders the region again on its own (`render(false, {actors: true})`), without a render hook.
    const region = html.querySelector("[data-region='overview']");
    region.replaceChildren(build(doc, ["div.content", ["section.summary"], ["section.member"]]));
    assert.equal(region.querySelectorAll(".pf2e-artisans-workshop-party-card").length, 1, "the observer put it back");
    Hooks.callAll("renderPartySheetPF2e", sheet, html);
    assert.equal(region.querySelectorAll(".pf2e-artisans-workshop-party-card").length, 1, "and a full render adds no second one");
    await addOrder("o3", {}, 3);
    entry.refreshEntries();
    assert.equal(facts()[0], "3");
});

test("no card for a player whose Overview tab pf2e hides (partyStats off): the header button stays", () => {
    const html = build(doc, ["form.party", ["section.container", ["div.tab.inventory", { "data-tab": "inventory" }]]]);
    assert.equal(entry.addPartyCard({ actor: game.actors.party }, html), null);
    const buttons = [];
    Hooks.callAll("getPartySheetPF2eHeaderButtons", { actor: game.actors.party }, buttons);
    assert.equal(buttons.length, 1);
});

/* -------------------------------------------- */
/*  Directory, keybinding                        */
/* -------------------------------------------- */

test("the Actors directory's context menu: Open Workshop on the party and on a member the user owns, acting as that member", async () => {
    const options = [];
    Hooks.callAll("getActorContextOptions", {}, options);
    Hooks.callAll("getActorContextOptions", {}, options);
    assert.equal(options.length, 1, "once");
    const [option] = options;
    const li = (actor) => build(doc, ["li.directory-item", { "data-entry-id": actor.id }]);
    assert.equal(option.visible(li(game.actors.party)), true);
    assert.equal(option.visible(li(bo)), true);
    assert.equal(option.visible(li(cy)), false, "not the user's");
    await option.onClick({}, li(bo));
    assert.equal(WorkshopApp.instance?.acting, bo.uuid);
    await WorkshopApp.instance.close();
    world.settings.set(`${MOD}.enabled`, false);
    assert.equal(option.visible(li(game.actors.party)), false, "follows the master switch");
});

test("the Open Workshop keybinding is registered, unbound; Bandolier and Quick Alchemy stay M8's", () => {
    const binding = keybindings.find((k) => k.id === "openWorkshop");
    assert.equal(binding?.namespace, MOD);
    assert.deepEqual(binding.config.editable, []);
    assert.ok(binding.config.name in lang && binding.config.hint in lang);
    world.settings.set(`${MOD}.enabled`, false);
    assert.equal(binding.config.onDown(), false, "nothing while the Workshop is off");
});

/* -------------------------------------------- */
/*  Macros                                       */
/* -------------------------------------------- */

test("a shelf tile dropped on the hotbar makes one world script macro holding the catalogue's line; a second drop reuses it", async () => {
    const data = { type: macros.DRAG_TYPE, macro: "open-workshop" };
    assert.equal(Hooks.call("hotbarDrop", {}, data, "3"), false, "core's own drop does not run");
    assert.equal(Hooks.call("hotbarDrop", {}, data, "4"), false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(created.length, 1, "two drops (even at once) make one macro");
    const [macro] = created;
    assert.deepEqual([macro.type, macro.name, macro.img, macro.flags[MOD].macro], ["script", "Open Workshop", "icons/svg/house.svg", "open-workshop"]);
    assert.equal(macro.command, macroCommand(macroById("open-workshop"), MOD));
    assert.equal(game.user.hotbar[3], macro.id);
    assert.equal(game.user.hotbar[4], macro.id);
    const again = await macros.addToHotbar("open-workshop");
    assert.deepEqual([again.ok, again.slot, created.length], [true, 1, 1], "Add to hotbar: the first free slot, the same macro");
    assert.equal(Hooks.call("hotbarDrop", {}, { type: "Item", uuid: "Item.x" }, "5"), true, "another drop is core's");
});

test("a macro another user made is not reused; without MACRO_SCRIPT nothing is made and the user is told why", async () => {
    game.macros.set("theirs", { id: "theirs", flags: { [MOD]: { macro: "pledge" } }, _source: { author: "gm00000000000000" } });
    const mine = await macros.addToHotbar("pledge", 7);
    assert.equal(mine.ok, true);
    assert.notEqual(mine.macro, "theirs");
    game.user.allowScript = false;
    const refused = await macros.addToHotbar("roll-craft");
    assert.equal(refused.reason, "no-script");
    Hooks.call("hotbarDrop", {}, { type: macros.DRAG_TYPE, macro: "roll-craft" }, "8");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(created.length, 1);
    assert.equal(world.notes.at(-1)[1], lang["pf2e-artisans-workshop.Refusal.NoScript"]);
});

test("the shelf lists the catalogue by group, leaves out a feature that is off, drags as the hotbar expects, and offers Run only without MACRO_SCRIPT", async () => {
    const shelf = await macros.openShelf();
    const context = shelf.context;
    assert.equal(context.canScript, true);
    assert.equal(context.groups.flatMap((g) => g.macros).length, MACROS.filter((m) => !m.feature || macros.featureOn(m.feature)).length);
    assert.ok(context.groups.every((g) => g.heading in lang));
    const tile = context.groups[0].macros[0];
    assert.deepEqual([tile.name, tile.call], ["Open Workshop", "api.ui.open({ tab: \"queue\", actor: null, filter: null })"]);
    assert.equal(tile.runLabel, "Run Open Workshop");
    const drag = drags.at(-1);
    assert.equal(drag.dragSelector, ".macro-tile[draggable]");
    const set = [];
    const tileEl = build(doc, ["li.macro-tile", { "data-macro": "pledge", draggable: "true" }]);
    drag.callbacks.dragstart({ target: tileEl, dataTransfer: { setData: (type, value) => set.push([type, JSON.parse(value)]) } });
    assert.deepEqual(set, [["text/plain", { type: macros.DRAG_TYPE, macro: "pledge" }]]);
    world.settings.set(`${MOD}.features.combat`, false);
    await shelf.render();
    assert.equal(shelf.context.groups.flatMap((g) => g.macros).some((m) => m.id === "quick-alchemy"), false, "combat off: no combat tiles");
    game.user.allowScript = false;
    await shelf.render();
    assert.equal(shelf.context.canScript, false);
    assert.equal(drag.permissions.dragstart(), false);
    await shelf.close();
    const template = readFileSync(join(ROOT, "templates/macros/shelf.hbs"), "utf8");
    assert.match(template, /\{\{#if @root\.canScript\}\} draggable="true"\{\{\/if\}\}/);
    assert.match(template, /\{\{#if @root\.canScript\}\}<button type="button" data-action="hotbar"/);
});

test("every catalogue macro calls a member of the published API", () => {
    const api = buildApi();
    for (const m of MACROS) {
        const [namespace, member] = m.call.split(".");
        assert.equal(typeof api[namespace]?.[member], "function", `${m.id}: api.${m.call}`);
    }
    assert.equal(typeof api.macros.run, "function");
    assert.equal(api.macros.list().length, 23);
    assert.equal(api.macros.command("pledge"), macroCommand(macroById("pledge"), MOD));
    assert.equal(typeof api.ui.macros, "function");
    assert.equal(typeof api.orders.postSummary, "function");
});

test("a run reports what came of it: a refusal as its sentence, a step already taken as Already done, nothing for an opened window", async () => {
    const api = {
        funds: { pledge: async () => ({ ok: false, reason: "too-much", data: { maxCp: 100 } }), claimAll: async () => ({ ok: true, outcome: "already" }) },
        ui: { open: async () => ({ rendered: true }) },
    };
    await macros.runMacro(api, "pledge", { order: "o1", amount: "20 gp" });
    assert.equal(world.notes.at(-1)[0], "warn");
    await macros.runMacro(api, "take-deliveries", {});
    assert.deepEqual(world.notes.at(-1), ["info", "pf2e-artisans-workshop.Macro.Already", { localize: true }]);
    const before = world.notes.length;
    await macros.runMacro(api, "open-workshop", {});
    assert.equal(world.notes.length, before, "an opened window is no refusal");
    await macros.runMacro(api, "nope", {});
    assert.equal(world.notes.at(-1)[1], lang["pf2e-artisans-workshop.Refusal.NoMacro"]);
    world.settings.set(`${MOD}.features.consumables`, false);
    const off = await macros.runMacro(api, "use-best", { family: "x" });
    assert.equal(off.reason, "macro-off");
    world.settings.set(`${MOD}.enabled`, false);
    assert.equal((await macros.runMacro(api, "open-workshop", {})).reason, "not-ready");
});

test("a run without a required argument asks instead: Finish opens the one finishable order, Pledge the open orders, Earn Income the Downtime tab", async () => {
    const calls = [];
    const api = { orders: { finish: (args) => calls.push(["finish", args]) }, funds: { pledge: (args) => calls.push(["pledge", args]) } };
    // M11 review: not "no-order" ("That order no longer exists."), since the user named no order.
    assert.equal((await macros.runMacro(api, "finish-order", {})).reason, "nothing-to-finish", "nothing to finish");
    assert.deepEqual(world.notes.at(-1), ["warn", "Bo has no order ready to finish.", undefined]);
    await addOrder("o1", { crafter: bo.uuid, status: "finishing" });
    await macros.runMacro(api, "finish-order", {});
    assert.equal(WorkshopApp.instance.selected, "o1", "its detail, where Finish asks where any shortfall comes from");
    await addOrder("o2", { crafter: bo.uuid, status: "rolled" }, 2);
    await macros.runMacro(api, "finish-order", {});
    assert.equal(WorkshopApp.instance.filters.scope, "mine", "two: the Queue on the user's orders");
    await macros.runMacro(api, "pledge", {});
    assert.equal(WorkshopApp.instance.filters.scope, "open");
    await macros.runMacro(api, "earn-income", {});
    assert.equal(WorkshopApp.instance.tabGroups.primary, "downtime");
    await macros.runMacro(api, "learn-formula", {});
    assert.equal(WorkshopApp.instance.tabGroups.primary, "formulas");
    assert.deepEqual(calls, [], "the API was not called without what it needs");
    await macros.runMacro(api, "finish-order", { order: "o2" });
    assert.deepEqual(calls, [["finish", { order: "o2" }]], "given, it is called");
    await WorkshopApp.instance.close();
});

test("Roll Craft check without an order rolls the actor's oldest order waiting for its check; Advance days opens the wizard with its days", async () => {
    await addOrder("o1", { crafter: cy.uuid, status: "check" });
    await addOrder("o2", { crafter: bo.uuid, status: "check" }, 2);
    const api = buildApi();
    const none = addDocument("Actor", { name: "Eve", type: "character", ownership: { default: 3 } });
    assert.equal((await api.orders.rollCheck({ actor: none })).reason, "no-check-order", "Eve crafts nothing");
    // M11 review: the macro says so in words that fit, not "That order no longer exists.".
    await macros.runMacro(api, "roll-craft", { actor: none });
    assert.deepEqual(world.notes.at(-1), ["warn", "Eve has no order waiting for its Craft check.", undefined]);
    const tried = await api.orders.rollCheck({ actor: bo }).catch((error) => ({ threw: error }));
    assert.notEqual(tried?.reason, "no-order", "Bo's order waiting for its check was taken up");
    // M11 live pass: the run resolves once the wizard is open, not before its first render (a render that takes a turn of
    // the event loop, as Foundry's template fetch does).
    const prepare = AdvanceDaysApp.prototype._prepareContext;
    AdvanceDaysApp.prototype._prepareContext = async function (...args) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return prepare.apply(this, args);
    };
    let wizard;
    try {
        wizard = await macros.runMacro(api, "advance-days", { days: 3 });
    } finally {
        AdvanceDaysApp.prototype._prepareContext = prepare;
    }
    assert.ok(wizard instanceof AdvanceDaysApp);
    assert.equal(wizard.rendered, true, "the wizard is open when the run resolves");
    assert.equal(wizard.wizard.count, 3);
    assert.equal(wizard.wizard.advanceClock, false, "moving the clock stays a GM's");
    await wizard.close();
});

test("Post queue summary whispers the open orders to the poster; a gift's name is hidden from its recipient's owner", async () => {
    await addOrder("o1");
    await addOrder("o2", { visibility: "gift" }, 2);
    await addOrder("o3", { status: "complete" }, 3);
    const posted = [];
    ChatMessage.implementation = { create: async (data) => { posted.push(data); return { id: "m1" }; }, getSpeaker: (s) => s };
    const result = await buildApi().orders.postSummary({});
    assert.deepEqual([result.ok, result.open], [true, 2]);
    assert.deepEqual(posted[0].whisper, ["p2"]);
    const card = renders.at(-1).data;
    assert.equal(card.lines.length, 2);
    assert.match(card.lines[0], /^#1 o1 × 1 for Bo: Requested, no crafter yet\.$/);
    assert.match(card.lines[1], /^#2 A gift/);
    // A player who is not the recipient sees the gift's name in the Queue, and in a whisper to themselves; not on a public card.
    bo.ownership = { default: 0 };
    await buildApi().orders.postSummary({});
    assert.match(renders.at(-1).data.lines[1], /^#2 o2 /, "whispered to a player who may see it");
    await buildApi().orders.postSummary({ whisper: false });
    assert.deepEqual(posted.at(-1).whisper, []);
    assert.match(renders.at(-1).data.lines[1], /^#2 A gift/, "a public card names no gift");
});

/* -------------------------------------------- */
/*  The window                                   */
/* -------------------------------------------- */

test("the Workshop opens at the size the user last gave it, clamped to the screen, and remembers a resize but not a move", async () => {
    const app = new WorkshopApp();
    assert.deepEqual([app.position.width, app.position.height], [1060, 780], "the default from a 1440x900 screen");
    await app.render({ force: true });
    app.setPosition({ left: 50, top: 60 });
    assert.equal(world.settings.has(`${MOD}.ui.windowSize`), false, "a move writes nothing");
    app.setPosition({ width: 900, height: 700 });
    assert.deepEqual(world.settings.get(`${MOD}.ui.windowSize`), { width: 900, height: 700 });
    await app.close();
    assert.deepEqual([new WorkshopApp().position.width, new WorkshopApp().position.height], [900, 700]);
    world.settings.set(`${MOD}.ui.windowSize`, { width: 5000, height: 4000 });
    const big = new WorkshopApp();
    assert.deepEqual([big.position.width, big.position.height], [1420, 880], "never past the screen");
    assert.deepEqual(theme.openingSize({ width: -1 }, { width: 800, height: 600 }, { width: 1440, height: 900 }), { width: 800, height: 600 });
});

test("Parchment gives the module's windows core's light theme and pf2e's parchment, at once when the setting changes", async () => {
    assert.deepEqual(theme.themeClasses(), []);
    const plain = new WorkshopApp();
    assert.equal(plain.options.classes.includes("paw-parchment"), false);
    await game.settings.set(MOD, "ui.parchment", true);
    const app = new WorkshopApp();
    assert.ok(["themed", "theme-light", "paw-parchment"].every((c) => app.options.classes.includes(c)));
    await plain.render({ force: true });
    foundry.applications.instances.set("w", plain);
    await game.settings.set(MOD, "ui.parchment", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(plain.element.classList.contains("paw-parchment"), "an open window takes it at once");
    await game.settings.set(MOD, "ui.parchment", false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(plain.element.classList.contains("theme-light"), false);
    foundry.applications.instances.clear();
    await plain.close();
});

test("the detail traps Tab while it covers the list (medium and narrow tiers); docked beside it (wide) Tab leaves it", async () => {
    assert.deepEqual([tierOf(1200), tierOf(1040), tierOf(900), tierOf(719), tierOf(0)], ["wide", "wide", "medium", "narrow", "wide"]);
    const detail = build(doc, ["aside.order-detail", { tabindex: "-1" }, ["button.a", { type: "button" }], ["button.b", { type: "button", disabled: "" }],
        ["details", ["summary"]], ["button.c", { type: "button" }]]);
    detail.querySelector("button.b").disabled = true;
    detail.querySelector("button.b").setAttribute("disabled", "");
    const [a, summary, c] = focusablesIn(detail);
    assert.deepEqual([a, summary, c].map((e) => e.tagName), ["BUTTON", "SUMMARY", "BUTTON"]);
    assert.equal(trapStep([a, summary, c], c, false), a, "Tab from the last goes to the first");
    assert.equal(trapStep([a, summary, c], a, true), c, "Shift+Tab from the first goes to the last");
    assert.equal(trapStep([a, summary, c], detail, true), c, "from the drawer itself");
    assert.equal(trapStep([a, summary, c], summary, false), null, "inside, the browser's own step");
    // In the window: the keydown handler applies it only while the window is narrower than the wide tier.
    const app = new WorkshopApp();
    await app.render({ force: true });
    app.element.append(detail);
    app.element.clientWidth = 900;
    c.focus();
    const event = c.dispatch("keydown", { key: "Tab", shiftKey: false });
    assert.equal(event.defaultPrevented, true);
    assert.equal(doc.activeElement, a);
    app.element.clientWidth = 1200;
    c.focus();
    assert.equal(c.dispatch("keydown", { key: "Tab", shiftKey: false }).defaultPrevented, false, "docked: no trap");
    await app.close();
});

test("the rows' context menu offers what the row allows, and acts on its order", async () => {
    await addOrder("o1");
    const app = new WorkshopApp();
    await app.render({ force: true });
    const menu = menus.at(-1);
    assert.equal(menu.selector, ".order-row[data-order-id]");
    assert.equal(menu.options.jQuery, false);
    const context = await app._prepareContext({});
    await app._preparePartContext("queue", context, {});
    const row = build(doc, ["li.order-row", { "data-order-id": "o1" }]);
    const shown = menu.items.filter((item) => item.visible === undefined || item.visible(row)).map((item) => item.label);
    assert.ok(shown.includes("pf2e-artisans-workshop.Action.Open"));
    assert.ok(shown.includes("pf2e-artisans-workshop.Action.Cancel"), "the requester may cancel a request");
    assert.equal(shown.includes("pf2e-artisans-workshop.Action.Resume"), false, "nothing to resume");
    assert.ok(menu.items.every((item) => item.label in lang));
    await app.close();
});

test("a tab's tooltip only in the narrow tier, where its word is hidden; its name is the aria-label in every tier", async () => {
    const app = new WorkshopApp();
    await app.render({ force: true });
    const nav = build(doc, ["nav.tabs.workshop-tabs", ["button", { "data-tab": "queue", "aria-label": "Queue" }]]);
    app.element.append(nav);
    app.element.clientWidth = 600;
    app.setPosition({ width: 600 });
    assert.equal(nav.querySelector("button").dataset.tooltip, "Queue");
    app.element.clientWidth = 1100;
    app.setPosition({ width: 1100 });
    assert.equal(nav.querySelector("button").dataset.tooltip, undefined);
    assert.doesNotMatch(readFileSync(join(ROOT, "templates/workshop/nav.hbs"), "utf8"), /data-tooltip/);
    await app.close();
});

/* -------------------------------------------- */
/*  The UI lows fixed in M11                     */
/* -------------------------------------------- */

test("the request form leaves the DC column out for a player who may not see DCs; the check augment's days only while they matter, one as one", () => {
    const form = readFileSync(join(ROOT, "templates/request/form.hbs"), "utf8");
    assert.match(form, /\{\{#if showDcs\}\}<th scope="col">\{\{localize "pf2e-artisans-workshop\.Detail\.Dc"\}\}<\/th>\{\{\/if\}\}/);
    assert.match(form, /\{\{#if \.\.\/showDcs\}\}<td>\{\{dc\}\}<\/td>\{\{\/if\}\}/);
    assert.match(form, /colspan="\{\{#if \.\.\/showDcs\}\}5\{\{else\}\}4\{\{\/if\}\}"/);
    const augment = readFileSync(join(ROOT, "templates/chat/check-augment.hbs"), "utf8");
    assert.match(augment, /\{\{#if success\}\}\{\{#if working\}\}/);
    assert.match(augment, /Augment\.SuccessOneDay/);
});

test("counts of one read as one: setup days, castings, Crafts, minutes, gardens, days at a rate, orders filed", () => {
    for (const key of ["Detail.SetupDaysOne", "Pledge.LineOne", "Formulas.BreakEvenOne", "Augment.SuccessOneDay", "Morning.Affix.MinutesOne",
        "Variant.Garden.LimitOne", "Request.DaysAtOne", "Request.FiledOne", "Affliction.In.RoundsOne", "Affliction.Unit.DaysOne"]) {
        const text = lang[`pf2e-artisans-workshop.${key}`];
        assert.ok(text && /\b1 (more )?(day|casting|Craft|minute|garden|order|round)\b/.test(text), key);
    }
    assert.match(readFileSync(join(ROOT, "templates/workshop/queue.hbs"), "utf8"), /\{\{#if \(eq setup\.days 1\)\}\}/);
});

test("unmet requirements say so to a screen reader; each PC's activity select names the PC after its visible label; the Start/End downtime button has no aria-pressed", () => {
    const queue = readFileSync(join(ROOT, "templates/workshop/queue.hbs"), "utf8");
    assert.match(queue, /<ul class="detail-gates unmet" aria-label="\{\{localize 'pf2e-artisans-workshop\.Detail\.NotMet'\}\}">/);
    assert.match(queue, /<span class="sr-only">\{\{localize "pf2e-artisans-workshop\.Detail\.NotMetPrefix"\}\}<\/span>/);
    const downtime = readFileSync(join(ROOT, "templates/workshop/downtime.hbs"), "utf8");
    // M11 review (WCAG 2.5.3, label in name): the select's name is its visible label, then the PC's visible name
    // ("Spending days on Bo"), not a different sentence that hides the words a voice-control user reads on screen.
    assert.match(downtime, /<strong class="pc-name" id="pf2e-artisans-workshop-dt-name-\{\{@index\}\}">\{\{name\}\}<\/strong>/);
    assert.match(downtime, /<span class="label" id="pf2e-artisans-workshop-dt-activity-\{\{@index\}\}">\{\{localize "pf2e-artisans-workshop\.Downtime\.Activity"\}\}<\/span>/);
    assert.match(downtime, /name="dtActivity"[^>]*aria-labelledby="pf2e-artisans-workshop-dt-activity-\{\{@index\}\} pf2e-artisans-workshop-dt-name-\{\{@index\}\}"/);
    assert.doesNotMatch(downtime, /name="dtActivity"[^>]*aria-label=/);
    assert.doesNotMatch(downtime, /data-op="toggle"[^>]*aria-pressed/);
    assert.doesNotMatch(downtime, /class="pc-pending" role="status"/);
});

/* -------------------------------------------- */
/*  The M11 review's fixes                       */
/* -------------------------------------------- */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Press `key` on `el` with a spy for `stopPropagation`: whether the key stopped at our window, and whether its default went. */
function press(el, key, init = {}) {
    let stopped = false;
    const event = el.dispatch("keydown", { key, shiftKey: false, ...init, stopPropagation() { stopped = true; } });
    return { stopped, prevented: event.defaultPrevented };
}

test("M11 review: a key the Workshop answers stops at its window, so core's keybindings never pause the game, pan the canvas or cycle the token", async () => {
    await addOrder("o1");
    await addOrder("o2", {}, 2);
    const app = new WorkshopApp();
    await app.render({ force: true });
    const nav = build(doc, ["nav.tabs.workshop-tabs", ["button", { type: "button", "data-tab": "queue" }], ["button", { type: "button", "data-tab": "funds" }]]);
    const list = build(doc, ["ol.order-list", ["li.order-row", { "data-order-id": "o1", tabindex: "0" }], ["li.order-row", { "data-order-id": "o2", tabindex: "-1" }]]);
    const detail = build(doc, ["aside.order-detail", { tabindex: "-1" }, ["button.a", { type: "button" }], ["button.c", { type: "button" }]]);
    const plain = build(doc, ["button.plain", { type: "button" }]);
    app.element.append(nav, list, detail, plain);
    app.element.clientWidth = 900;
    const [first, second] = list.children;
    // Core's KeyboardManager listens on the browser window and treats a row, a tab or a button outside a form as no field.
    assert.deepEqual(press(first, "ArrowDown"), { stopped: true, prevented: true }, "a row's arrow moves the tab stop, not the canvas");
    assert.equal(doc.activeElement, second);
    assert.equal(press(second, "Home").stopped, true);
    assert.equal(press(first, " ").stopped, true, "Space opens the detail; it never pauses the game");
    await tick();
    assert.equal(press(nav.children[0], "ArrowRight").stopped, true, "a tab's arrow");
    assert.equal(app.tabGroups.primary, "funds");
    const c = detail.querySelector("button.c");
    c.focus();
    assert.deepEqual(press(c, "Tab"), { stopped: true, prevented: true }, "the trapped Tab never cycles the controlled token");
    // Tab, Space and Enter on any control of the window belong to that control (the browser's own step, its press).
    app.element.clientWidth = 1200;
    assert.deepEqual(press(plain, "Tab"), { stopped: true, prevented: false }, "the browser's own Tab, kept from core");
    assert.equal(press(plain, " ").stopped, true);
    assert.equal(press(plain, "Enter").stopped, true);
    assert.equal(press(plain, "ArrowDown").stopped, false, "an arrow nothing here answers stays core's");
    assert.equal(press(plain, " ", { ctrlKey: true }).stopped, false, "nor a key with a modifier");
    await app.close();
});

test("M11 review: switching the Workshop off or on renders the open character and party sheets again, so their entries follow the master switch", () => {
    const rendered = [];
    const sheet = (actor, open = true) => ({ actor, rendered: open, render: (force) => rendered.push([actor.name, force]) });
    ui.windows = { 1: sheet(bo), 2: sheet(game.actors.party), 3: { actor: { name: "Npc", type: "npc" }, rendered: true, render: () => rendered.push(["Npc"]) }, 4: sheet(cy, false) };
    ui.actors = { render: () => rendered.push(["directory"]) };
    try {
        Hooks.callAll("pf2e-artisans-workshop.status", "ready");
        assert.deepEqual(rendered, [], "the first status only sets where it starts");
        Hooks.callAll("pf2e-artisans-workshop.status", "disabled");
        assert.deepEqual(rendered, [["directory"], ["Bo", false], ["Heroes", false]], "off: the open sheets render without their header button, strip and card");
        rendered.length = 0;
        Hooks.callAll("pf2e-artisans-workshop.status", "disabled");
        assert.deepEqual(rendered, [], "no change, no render");
        Hooks.callAll("pf2e-artisans-workshop.status", "ready");
        assert.deepEqual(rendered, [["directory"], ["Bo", false], ["Heroes", false]], "on again: they come back");
    } finally {
        delete ui.windows;
        delete ui.actors;
    }
});

test("M11 review: opened from the keyboard, the Workshop and the shelf take focus (the keybinding, a sheet entry, the status bar's Macros button)", async () => {
    const elsewhere = build(doc, ["button.elsewhere", { type: "button" }]);
    doc.body.append(elsewhere);
    const app = new WorkshopApp();
    await app.render({ force: true });
    app.element.append(build(doc, ["nav.tabs.workshop-tabs", ["button", { type: "button", "data-tab": "queue" }], ["button", { type: "button", "data-tab": "funds" }]]));
    elsewhere.focus();
    keybindings.find((k) => k.id === "openWorkshop").config.onDown();
    await tick();
    assert.ok(app.element.contains(doc.activeElement), "focus is in the Workshop, not where the key was pressed");
    assert.equal(doc.activeElement.dataset.tab, app.tabGroups.primary, "on the active tab");
    elsewhere.focus();
    const { sheet, html } = characterSheet(bo);
    Hooks.callAll("renderCharacterSheetPF2e", sheet, html);
    html.querySelector("[data-pf2e-artisans-workshop-entry='open']").click();
    await tick();
    assert.ok(app.element.contains(doc.activeElement), "the strip's Workshop button");
    html.remove();
    const shelf = await macros.openShelf();
    shelf.element.append(build(doc, ["section.macro-shelf", ["li.macro-tile", { "data-macro": "open-workshop" },
        ["button", { type: "button", "data-action": "run" }], ["button", { type: "button", "data-action": "hotbar" }]]]));
    elsewhere.focus();
    await WorkshopApp.DEFAULT_OPTIONS.actions.macros.call(app);
    assert.ok(shelf.element.contains(doc.activeElement), "the Macros button puts focus in the shelf");
    assert.equal(doc.activeElement.dataset.action, "run", "on the first tile's Run");
    await shelf.close();
    await app.close();
    elsewhere.remove();
});

test("M11 review: Add to hotbar renders the shelf again with focus still on that tile's button", async () => {
    const shelf = await macros.openShelf();
    const tiles = () => ["section.macro-shelf", ...["pledge", "roll-craft"].map((id) => ["li.macro-tile", { "data-macro": id },
        ["button", { type: "button", "data-action": "run" }], ["button", { type: "button", "data-action": "hotbar" }]])];
    const prior = build(doc, tiles());
    shelf.element.append(prior);
    prior.querySelector("[data-macro='roll-craft'] [data-action='hotbar']").focus();
    // What HandlebarsApplicationMixin does with a part: state before, the new element in, state after.
    const next = build(doc, tiles());
    const state = {};
    shelf._preSyncPartState("body", next, prior, state);
    prior.remove();
    shelf.element.append(next);
    shelf._syncPartState("body", next, prior, state);
    assert.ok(next.contains(doc.activeElement), "focus is in the new shelf, not on a button that is gone");
    assert.deepEqual([doc.activeElement.dataset.action, doc.activeElement.closest("[data-macro]").dataset.macro], ["hotbar", "roll-craft"], "the same tile's button");
    // The shelf's Tab, Space and Enter stay its own too.
    assert.equal(press(doc.activeElement, "Tab").stopped, true);
    assert.equal(press(doc.activeElement, " ").stopped, true);
    await shelf.close();
});

test("M11 review: a live refresh of the strip or the card keeps focus on the button that had it", async () => {
    const { sheet, html } = characterSheet(bo);
    Hooks.callAll("renderCharacterSheetPF2e", sheet, html);
    const strip = html.querySelector(".pf2e-artisans-workshop-strip");
    strip.querySelector("[data-pf2e-artisans-workshop-entry='request']").focus();
    await addOrder("o1", { crafter: bo.uuid, status: "check" });
    entry.refreshEntries();
    assert.match(strip.textContent, /Crafting: 1/, "refilled");
    assert.equal(doc.activeElement.isConnected, true, "not a button that is gone");
    assert.ok(strip.contains(doc.activeElement));
    assert.equal(doc.activeElement.getAttribute("data-pf2e-artisans-workshop-entry"), "request");
    const party = partySheet();
    Hooks.callAll("renderPartySheetPF2e", party.sheet, party.html);
    const card = party.html.querySelector(".pf2e-artisans-workshop-party-card");
    card.querySelector("[data-pf2e-artisans-workshop-entry='open']").focus();
    await addOrder("o2", {}, 2);
    entry.refreshEntries();
    assert.equal(card.querySelectorAll("dd")[0].textContent, "2");
    assert.ok(card.contains(doc.activeElement) && doc.activeElement.isConnected, "the card's Workshop button has it again");
    const elsewhere = build(doc, ["button.elsewhere", { type: "button" }]);
    doc.body.append(elsewhere);
    elsewhere.focus();
    entry.refreshEntries();
    assert.equal(doc.activeElement, elsewhere, "focus elsewhere is left alone");
    for (const el of [html, party.html, elsewhere]) el.remove();
});

test("M11 review: with Parchment on, every module window opens with it, not only the Workshop and the shelf", async () => {
    const { RequestForm } = await import("../../scripts/ui/request.mjs");
    const { AfflictionsApp } = await import("../../scripts/ui/afflictions.mjs");
    const { BandolierApp } = await import("../../scripts/ui/bandolier.mjs");
    const { QuickAlchemyPanel } = await import("../../scripts/ui/alchemy-panel.mjs");
    const windows = () => [new RequestForm(), new AdvanceDaysApp(), new AfflictionsApp(), new BandolierApp(), new QuickAlchemyPanel(), new macros.MacroShelf(), new WorkshopApp()];
    await game.settings.set(MOD, "ui.parchment", true);
    try {
        for (const app of windows()) {
            assert.ok(["themed", "theme-light", "paw-parchment"].every((c) => app.options.classes.includes(c)), app.constructor.name);
            assert.ok(app.options.classes.includes("pf2e-artisans-workshop"), `${app.constructor.name} keeps its own classes`);
        }
    } finally {
        await game.settings.set(MOD, "ui.parchment", false);
    }
    assert.ok(windows().every((app) => !app.options.classes.includes("paw-parchment")), "off: the application scheme");
});

test("M11 review: the shelf uses the window's words for money, never the retired 'pledge'", () => {
    const shelfText = Object.entries(lang).filter(([key]) => key.startsWith("pf2e-artisans-workshop.Macro."));
    assert.deepEqual(shelfText.filter(([, text]) => /pledg/i.test(text)).map(([key]) => key), []);
    assert.equal(lang["pf2e-artisans-workshop.Macro.Pledge.Name"], "Fund an order", "the window's Fund this order");
    assert.equal(lang["pf2e-artisans-workshop.Macro.TakeDeliveries.Name"], lang["pf2e-artisans-workshop.Action.CollectAll"]);
});
