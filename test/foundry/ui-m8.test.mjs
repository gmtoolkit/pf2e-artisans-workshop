/**
 * The combat windows, the token HUD palette and the combat cards over the fake world (DESIGN.md 8.1-8.3, 8.6, 10.4, 10.5,
 * 10.9, M8), as far as they run without a browser: the Bandolier's context (why it is off, the vials, the ready items with
 * their potency, splash and pf2e's Strike variants), opening at an encounter's start for the responsible user only, the
 * Quick Alchemy panel's list, picks, additives, cost and keyboard, the HUD palette's null guards and tolerance of other
 * HUDs, the cards' buttons, the settings note under Duct Tape, and every M8 label a key.
 *
 * ApplicationV2 is faked with Foundry 14.368's read-only properties as getters (`state`, `rendered`, `element`, `id`,
 * `window`, `title`, ...) and frozen `options`, so code that assigns one fails here as it would in Foundry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { FakeCollection, addDocument, coin, installFoundry, setUsers, sharedWorld, world, resetWorld } from "./stubs.mjs";
import { asAlchemist, encounter, physicalItems, seedCombatCompendium } from "./alchemist.mjs";
import { asCharacter } from "./pf2e-crafting.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
game.i18n.has = (key) => key in lang;
CONFIG.PF2E = { damageTypes: { fire: "PF2E.TraitFire" }, preciousMaterials: {} };

/** A tiny DOM: elements with classes, data, attributes, children, listeners, and `.a.b` / `[name="x"]` selectors. */
class El {
    constructor(tag, doc) {
        Object.assign(this, { tagName: tag.toUpperCase(), ownerDocument: doc, children: [], dataset: {}, attributes: {}, listeners: {}, hidden: false, disabled: false,
            parent: null, isConnected: true, textContent: "" });
        const classes = new Set();
        this.classList = { add: (...c) => c.forEach((x) => classes.add(x)), contains: (c) => classes.has(c), has: (c) => classes.has(c), toggle: () => {} };
    }
    append(...nodes) {
        for (const node of nodes) {
            if (node && typeof node === "object") node.parent = this;
            this.children.push(node);
        }
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    matches(selector) {
        const name = /^\[name="(.+)"\]$/.exec(selector);
        if (name) return this.attributes.name === name[1];
        return selector.split(".").filter(Boolean).every((c) => this.classList.contains(c));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
        const out = [];
        const walk = (node) => {
            for (const child of node.children) {
                if (!(child instanceof El)) continue;
                if (child.matches(selector)) out.push(child);
                walk(child);
            }
        };
        walk(this);
        return out;
    }
    closest(selector) {
        for (let node = this; node; node = node.parent) if (node instanceof El && node.matches(selector)) return node;
        return null;
    }
}
const fakeDocument = { createElement: (tag) => new El(tag, fakeDocument), createTextNode: (text) => ({ text }), activeElement: null };
const element = (tag, classes = []) => {
    const el = new El(tag, fakeDocument);
    el.classList.add(...classes);
    return el;
};

/** ApplicationV2 with 14.368's read-only properties as getters, frozen options, and a render that runs the life cycle. */
foundry.applications.api.ApplicationV2 = class {
    #state = 0;
    #element = null;
    #window = {};
    constructor(options = {}) {
        this.options = Object.freeze({ ...this.constructor.DEFAULT_OPTIONS, ...options });
        this.renders = [];
    }
    get state() { return this.#state; }
    get rendered() { return this.#state === 2; }
    get element() { return this.#element; }
    get id() { return this.options.id; }
    get window() { return this.#window; }
    get title() { return this.options.window?.title ?? ""; }
    get classList() { return this.#element?.classList; }
    get form() { return null; }
    get minimized() { return false; }
    get hasFrame() { return true; }
    async _prepareContext() { return {}; }
    _preSyncPartState() {}
    _syncPartState() {}
    async _onRender() {}
    _onClose() {}
    async render(options = {}) {
        const first = this.#state !== 2;
        this.context = await this._prepareContext(options);
        this.renders.push(options);
        if (first) {
            this.#element = element("div");
            this.#element.contains = () => false;
            this.#state = 2;
            await this._onFirstRender?.(this.context, options);
        }
        await this._onRender(this.context, { ...options, isFirstRender: first });
        return this;
    }
    async close() {
        this.#state = -1;
        this._onClose({});
        return this;
    }
};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const MOD = "pf2e-artisans-workshop";
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { resetCatalogue } = await import("../../scripts/foundry/catalogue.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const alchemy = await import("../../scripts/foundry/alchemy.mjs");
const combat = await import("../../scripts/foundry/combat.mjs");
const bandolier = await import("../../scripts/ui/bandolier.mjs");
const panel = await import("../../scripts/ui/alchemy-panel.mjs");
const hud = await import("../../scripts/ui/hud.mjs");
const cards = await import("../../scripts/ui/combat-cards.mjs");
const entry = await import("../../scripts/ui/combat-entry.mjs");
const labels = await import("../../scripts/ui/labels.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

let vera;
let bo;
let items;

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    resetCatalogue();
    alchemy.resetAlchemy();
    bandolier.BandolierApp.instance = null;
    panel.QuickAlchemyPanel.instance = null;
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    Object.assign(world, { toggles: [], strikes: [], damage: [], checks: [], consumed: [], nextCheck: null });
    items = seedCombatCompendium();
    game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => world.index }]]);
    game.combats = new FakeCollection();
    game.time.worldTime = 1000;
    game.pf2e = { settings: { variants: { pwol: { enabled: false } } } };
    game.modules = new Map([[MOD, { id: MOD, version: "0.0.0" }]]);
    vera = addDocument("Actor", { name: "Vera", type: "character", img: "vera.webp", ownership: { default: 0, p1: 3 }, items: [] });
    asAlchemist(vera, { level: 10, formulas: [items.minor.uuid, items.fire.uuid], registry: REGISTRY,
        feats: ["versatile-vials", "bomber", "field-discovery-bomber", "healing-bomb", "combine-elixirs", "quick-bomber", "double-brew"] });
    bo = addDocument("Actor", { name: "Bo", type: "character", ownership: { default: 0, p2: 3 }, items: [] });
    physicalItems(bo);
    asCharacter(bo, { level: 8 });
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [vera, bo] };
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    world.settings.set(`${MOD}.enabled`, true);
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    ChatMessage.implementation.getSpeaker = () => ({});
    globalThis.canvas = { ready: false, tokens: { controlled: [], placeables: [] } };
    ui.hotbar = null;
});
afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
});

/* -------------------------------------------- */
/*  The Bandolier (8.1)                          */
/* -------------------------------------------- */

test("the Bandolier: vial pips and tier, the ready bombs and elixirs with potency, splash and pf2e's Strike variants, the state of Double Brew and the additive (8.1)", async () => {
    await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid });
    const app = new bandolier.BandolierApp();
    const context = await bandolier.bandolierContext(app);
    assert.equal(context.actor.name, "Vera");
    assert.equal(context.vials.text, "4 of 6 vials");
    assert.deepEqual(context.vials.pips.map((p) => p.full), [true, true, true, true, false, false]);
    assert.equal(context.vials.level, "level 4");
    assert.deepEqual([context.canQuick, context.canVial, context.healingBomb, context.quickBomber], [true, true, true, true]);
    assert.equal(context.brew, "Double Brew: two items at once.");
    assert.equal(context.additive, "Additive this round: free.");
    assert.deepEqual(context.fieldVial.choices.map((c) => c.value), ["", "cold", "electricity", "fire"]);
    const fire = context.ready.find((r) => r.name === "Alchemist's Fire (Lesser)");
    assert.equal(fire.potency, "6 s left", "outside an encounter: one round of world time");
    assert.equal(fire.splash, "Splash 4, 5 ft · may splash the target only", "the bomber's field discovery: Int 4");
    assert.deepEqual(fire.strikes.map((s) => s.label), ["+10", "+5 (MAP -5)", "+0 (MAP -10)"], "pf2e's own labels");
    const vial = context.ready.find((r) => r.name === "Versatile Vial");
    assert.equal(vial.splash, "Splash 4, 5 ft · may splash the target only");
    // Its buttons: a Strike goes through pf2e's Strike with the field vial chosen in the Bandolier.
    app.damageType = "fire";
    const struck = await app.run("strike", { item: vera.items.find((i) => i.name === "Versatile Vial").id, map: "2" });
    assert.equal(struck.ok, true);
    assert.deepEqual([world.strikes.at(-1).map, world.toggles.at(-1).slice(2)], [2, ["bomber-field-vials", true, "fire"]]);
    const quick = await app.run("quick-vial", {});
    assert.equal(vera.items.get(quick.items[0].id).flags[MOD].quick.damageType, "fire");
});

test("the Bandolier says why it is off: the master switch, the toggle, Duct Tape; it opens at an encounter's start for the alchemist's responsible user only (8, 8.1)", async () => {
    game.modules.set(combat.DUCT_TAPE, { id: combat.DUCT_TAPE, active: true });
    assert.equal((await bandolier.bandolierContext(new bandolier.BandolierApp())).off, lang["pf2e-artisans-workshop.Combat.Off.DuctTape"]);
    assert.equal((await bandolier.openBandolier()).reason, "duct-tape");
    game.modules.delete(combat.DUCT_TAPE);
    world.settings.set(`${MOD}.features.combat`, false);
    assert.equal((await bandolier.bandolierContext(new bandolier.BandolierApp())).off, lang["pf2e-artisans-workshop.Combat.Off.Feature"]);
    world.settings.set(`${MOD}.features.combat`, true);
    const fight = encounter("c1", [bo, vera]);
    assert.equal(bandolier.autoOpenFor(fight), vera, "Player One's client");
    world.currentUser = "gm00000000000000";
    assert.equal(bandolier.autoOpenFor(fight), null, "not the GM's while Player One is connected");
    world.currentUser = "p1";
    world.settings.set(`${MOD}.bandolier.autoOpen`, false);
    assert.equal(bandolier.autoOpenFor(fight), null, "the user's setting");
    world.settings.set(`${MOD}.bandolier.autoOpen`, true);
    bandolier.registerBandolierHooks();
    Hooks.callAll("combatTurnChange", fight, { round: 0, turn: null }, { round: 1, turn: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(bandolier.BandolierApp.instance?.rendered, "opened by itself");
    assert.equal(bandolier.BandolierApp.instance.actorUuid, vera.uuid);
});

test("the Bandolier remembers where it was dragged, per user (8.1, 14.3)", async () => {
    const app = new bandolier.BandolierApp();
    app.savePosition({ left: 120.4, top: 640.6, width: 340 });
    assert.deepEqual(world.settings.get(`${MOD}.bandolier.position`), { left: 120, top: 641 });
    const again = new bandolier.BandolierApp();
    assert.deepEqual([again.options.position.left, again.options.position.top], [120, 641], "a new window starts there");
});

/* -------------------------------------------- */
/*  The Quick Alchemy panel (8.3)                */
/* -------------------------------------------- */

const keyEvent = (key, target) => ({ key, target, preventDefault() {}, stopPropagation() {} });

test("the panel: search, picks (two with Double Brew), only the additives that fit, Combine Elixirs' second elixir, the cost and the first problem (8.3, 8.6)", async () => {
    const opened = await panel.openQuickAlchemy({ actor: vera });
    const app = opened.app;
    assert.deepEqual(app.context.options.map((o) => o.name), ["Alchemist's Fire (Lesser)", "Elixir of Life (Lesser)", "Elixir of Life (Minor)", "Elixir of Life (Moderate)"]);
    app.query = "life les";
    await app.renderList();
    assert.deepEqual(app.context.options.map((o) => [o.name, o.route]), [["Elixir of Life (Lesser)", "by family"]]);
    app.toggle(items.lesser.uuid);
    await app.renderList();
    assert.deepEqual(app.context.additives.map((a) => a.value), ["", "combine-elixirs", "healing-bomb"], "additives that fit an elixir of life");
    assert.equal(app.context.cost, "Costs 1 vial.");
    app.additive = "combine-elixirs";
    await app.render({ parts: ["plan"] });
    assert.deepEqual(app.context.combine.map((c) => c.value), ["", items.lesser.uuid, items.minor.uuid], "elixirs of the same level or lower");
    assert.equal(app.context.problem, lang["pf2e-artisans-workshop.Refusal.CombinePick"]);
    assert.equal(app.context.canCreate, false);
    app.combine = items.minor.uuid;
    await app.render({ parts: ["plan"] });
    assert.deepEqual([app.context.cost, app.context.canCreate], ["Costs 2 vials.", true]);
    app.query = "";
    app.toggle(items.fire.uuid);
    await app.renderList();
    assert.deepEqual(app.context.picks.map((p) => p.name), ["Elixir of Life (Lesser)", "Alchemist's Fire (Lesser)"], "Double Brew: two picks");
    assert.deepEqual(app.context.then.map((t) => t.value), ["hand", "strike"], "a bomb picked: hold it or throw it");
    await vera.updateResource("versatile-vials", 0);
    await app.render({ parts: ["plan"] });
    assert.equal(app.context.problem, lang["pf2e-artisans-workshop.Refusal.NoVials"]);
});

test("the panel works from the keyboard: the arrows go into and through the list, Space picks, Enter creates, Esc closes (8.3, 10.9)", async () => {
    const { app } = await panel.openQuickAlchemy({ actor: vera });
    const keydown = app.element.listeners.keydown[0];
    const search = { dataset: { quick: "search" } };
    keydown(keyEvent("ArrowDown", search));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(app.active, 0, "from the search field onto the list's active row");
    const option = (i) => ({ dataset: { quick: "option", uuid: app.visible[i].uuid } });
    keydown(keyEvent("ArrowDown", option(0)));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(app.active, 1);
    keydown(keyEvent(" ", option(1)));
    assert.deepEqual(app.picks, [app.visible[1].uuid], "Space picks the row with focus");
    keydown(keyEvent(" ", search));
    assert.equal(app.picks.length, 1, "Space in the search field types a space");
    keydown(keyEvent("Enter", option(1)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(vera.items.filter((i) => i.name === "Elixir of Life (Lesser)").length, 1, "Enter creates");
    assert.equal(app.state, -1, "and the panel closes");
    const again = (await panel.openQuickAlchemy({ actor: vera })).app;
    again.element.listeners.keydown[0](keyEvent("Escape", search));
    assert.equal(again.state, -1, "Esc closes");
});

test("Enter with nothing picked creates the list's first match; Quick Bomber's panel lists bombs and throws the one it makes (8.3, 8.4)", async () => {
    const { app } = await panel.openQuickAlchemy({ actor: vera, bombs: true });
    assert.deepEqual(app.context.options.map((o) => o.name), ["Alchemist's Fire (Lesser)"]);
    app.element.listeners.keydown[0](keyEvent("Enter", { dataset: { quick: "search" } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(world.strikes.length, 1, "made and thrown through pf2e's Strike");
    assert.equal((await panel.openQuickAlchemy({ actor: bo })).reason, "no-quick-alchemy");
});

/* -------------------------------------------- */
/*  The token HUD palette (8.2)                  */
/* -------------------------------------------- */

/** A token HUD's element: the left column core renders, unless another HUD replaced it. */
function hudElement({ left = true } = {}) {
    const html = element("form");
    if (left) html.append(element("div", ["col", "left"]));
    html.append(element("div", ["col", "right"]));
    return html;
}

test("the HUD palette: a flask button core's togglePalette opens, with Quick Alchemy, a quick vial, Healing Bomb, a Strike per bomb and the Bandolier (8.2)", async () => {
    await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid });
    const html = hudElement();
    assert.equal(hud.injectPalette({ actor: vera }, html), true);
    const column = html.querySelector(".col.left");
    const [button, palette] = column.children;
    assert.deepEqual([button.dataset.action, button.dataset.palette, button.attributes.type], ["togglePalette", hud.PALETTE, "button"]);
    assert.deepEqual([palette.classList.contains("palette"), palette.dataset.palette], [true, hud.PALETTE]);
    assert.deepEqual(palette.children.map((e) => e.dataset.pf2eArtisansWorkshopHud), ["quick-alchemy", "quick-vial", "healing-bomb", "strike", "strike", "strike",
        "strike", "strike", "strike", "bandolier"], "pf2e's three Strike variants for the Alchemist's Fire and for the vials");
    assert.ok(palette.children.every((e) => e.dataset.action === undefined), "no data-action: the HUD's form never looks for a handler");
    assert.equal(hud.injectPalette({ actor: vera }, html), false, "once: a second render adds nothing");
    // A click on an entry: a quick vial through the module.
    const click = palette.listeners.click[0];
    const link = palette.children[1];
    await click({ target: { closest: () => link }, preventDefault() {}, stopPropagation() {} });
    assert.equal(vera.items.filter((i) => i.flags?.[MOD]?.quick?.source === "quick-vial").length, 1);
});

test("the HUD palette is null-guarded and tolerates other HUDs: no element, no left column, a player who does not own the token, Duct Tape (8.2, OQ-33)", () => {
    const isElement = foundry.utils.isElementInstanceOf;
    foundry.utils.isElementInstanceOf = () => false;
    assert.equal(hud.injectPalette({ actor: vera }, {}), false, "jQuery or nothing: left alone");
    foundry.utils.isElementInstanceOf = isElement;
    assert.equal(hud.injectPalette({ actor: vera }, hudElement({ left: false })), false, "PF2e HUD or Token Action HUD replaced the column");
    assert.equal(hud.injectPalette(null, hudElement()), false);
    assert.equal(hud.injectPalette({ actor: bo }, hudElement()), false, "no Quick Alchemy");
    world.currentUser = "p2";
    assert.equal(hud.injectPalette({ actor: vera }, hudElement()), false, "not the owner");
    world.currentUser = "p1";
    game.modules.set(combat.DUCT_TAPE, { id: combat.DUCT_TAPE, active: true });
    const plain = hudElement();
    assert.equal(hud.injectPalette({ actor: vera, activePalette: null }, plain), false);
    assert.equal(plain.querySelector(".col.left").children.length, 0);
    // Our palette was open when the HUD rendered again: core reopens it after the hook, so an empty pair stands in.
    const open = hudElement();
    assert.equal(hud.injectPalette({ actor: vera, activePalette: hud.PALETTE }, open), false);
    const stand = open.querySelector(".col.left").children;
    assert.deepEqual(stand.map((e) => [e.dataset.palette, e.attributes.hidden]), [[hud.PALETTE, ""], [hud.PALETTE, ""]]);
});

/* -------------------------------------------- */
/*  Cards (10.5)                                 */
/* -------------------------------------------- */

test("the Quick Alchemy and Healing Bomb cards: what was made with its potency and splash, Strike buttons per variant, Apply buttons per creature (10.5)", async () => {
    const rendered = [];
    world.render = (path, data) => {
        rendered.push([path, data]);
        return "<div></div>";
    };
    cards.registerCombatCards();
    const made = await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [path, data] = rendered.at(-1);
    assert.equal(path, "modules/pf2e-artisans-workshop/templates/chat/alchemy.hbs");
    assert.deepEqual(data.lines.map((l) => l.text), ["Alchemist's Fire (Lesser), potent 6 s left.", "Splash 4, 5 ft · may splash the target only"]);
    assert.deepEqual(data.buttons.map((b) => [b.op, b.item, b.map]), [0, 1, 2].map((map) => ["strike", made.items[0].id, map]));
    const message = world.collections.ChatMessage.contents.at(-1);
    assert.deepEqual(message.flags[MOD].card, { kind: "quick-alchemy", order: null });
    assert.deepEqual(message.whisper.sort(), ["gm00000000000000", "p1"]);
    const hb = await alchemy.healingBomb(vera);
    await alchemy.throwHealingBomb(vera, hb.items[0].id, { target: bo.uuid });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const healing = rendered.at(-1)[1];
    assert.deepEqual(healing.lines.map((l) => l.text), ["Elixir of Life (Moderate) thrown at Bo, who is healed as though they drank it.",
        lang["pf2e-artisans-workshop.Card.HealingNoneKnown"].replace("{hp}", "5")], "without a canvas no neighbours are known");
    assert.deepEqual(healing.buttons.map((b) => b.op), [], "no living party member but the target (the fakes have no modeOfBeing)");
    assert.equal(world.collections.ChatMessage.contents.at(-1).flags[MOD].combat.hp, 5);
});

test("a card's buttons are hidden from users who may not use them; Apply heals once, through the owner (10.5, 8.6)", async () => {
    const message = { id: "m1", flags: { [MOD]: { card: { kind: "healing-bomb", order: null }, combat: { hp: 3 } } } };
    const html = element("div");
    const heal = element("button");
    Object.assign(heal.dataset, { pf2eArtisansWorkshopOp: "heal", actor: bo.uuid });
    const strike = element("button");
    Object.assign(strike.dataset, { pf2eArtisansWorkshopOp: "strike", actor: vera.uuid, item: "x", map: "0" });
    html.append(heal, strike);
    heal.matches = (s) => s === "button[data-pf2e-artisans-workshop-op]";
    strike.matches = heal.matches;
    bo.applyDamage = async ({ damage }) => world.damage.push([bo.id, damage]);
    world.currentUser = "p2";
    assert.equal(cards.renderCombatCard(message, html), true);
    assert.deepEqual([heal.hidden, strike.hidden], [false, true], "Bo's player may heal Bo, not Strike with Vera's bomb");
    await heal.listeners.click[0]({ preventDefault() {} });
    assert.deepEqual(world.damage.at(-1), [bo.id, -3]);
    assert.equal(heal.disabled, true, "applied: the button stays off");
    assert.equal(cards.renderCombatCard({ flags: { [MOD]: { card: { kind: "request", order: "o1" } } } }, element("div")), false, "order cards are chat.mjs's");
});

/* -------------------------------------------- */
/*  Settings, keys and labels                    */
/* -------------------------------------------- */

test("Settings say why combat alchemy is off while Duct Tape is active (8); the keybindings are unbound by default (10.4)", () => {
    const html = element("form");
    const group = element("div", ["form-group"]);
    const input = element("input");
    input.setAttribute("name", `${MOD}.features.combat`);
    group.append(input);
    html.append(group);
    assert.equal(entry.noteDuctTape(html), false, "nothing to say without Duct Tape");
    game.modules.set(combat.DUCT_TAPE, { id: combat.DUCT_TAPE, active: true });
    assert.equal(entry.noteDuctTape(html), true);
    assert.equal(group.children.at(-1).textContent, lang["pf2e-artisans-workshop.Combat.Off.DuctTape"]);
    assert.equal(entry.noteDuctTape(html), false, "once");
    const bound = [];
    game.keybindings = { register: (ns, key, config) => bound.push([ns, key, config.editable, config.name]) };
    entry.registerCombatEntry();
    assert.deepEqual(bound.map((b) => [b[1], b[2]]), [["openBandolier", []], ["quickAlchemy", []]]);
    assert.ok(bound.every((b) => lang[b[3]]));
    const configs = ["features.combat", "features.consumables", "features.vialGathering", "expiry.quickAlchemyAtCombatEnd", "bandolier.autoOpen", "bandolier.position"]
        .map((key) => world.settingConfigs.get(`${MOD}.${key}`));
    assert.deepEqual(configs.map((c) => [c.scope, c.default]), [["world", true], ["world", true], ["world", false], ["world", true], ["user", true], ["user", {}]],
        "14.1-14.3: vial gathering off by default (P10)");
});

test("every M8 label is a key in lang/en.json; every M8 refusal has words", () => {
    const files = ["scripts/ui/bandolier.mjs", "scripts/ui/alchemy-panel.mjs", "scripts/ui/hud.mjs", "scripts/ui/combat-cards.mjs", "scripts/ui/combat-entry.mjs",
        "scripts/foundry/alchemy.mjs", "scripts/foundry/vials.mjs", "scripts/foundry/consumables.mjs", "scripts/foundry/settings.mjs", "templates/combat/bandolier.hbs",
        "templates/combat/quick-alchemy-search.hbs", "templates/combat/quick-alchemy-list.hbs", "templates/combat/quick-alchemy-plan.hbs", "templates/chat/alchemy.hbs"];
    const source = files.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
    const keys = [...source.matchAll(/pf2e-artisans-workshop\.[A-Z][A-Za-z0-9.]*[A-Za-z0-9]/g)].map((m) => m[0]);
    assert.ok(keys.length > 90, String(keys.length));
    for (const key of [...new Set(keys)]) assert.ok(lang[key], key);
    for (const code of ["duct-tape", "combat-off", "consumables-off", "alchemy-busy", "craft-failed", "not-chosen", "no-quick-alchemy", "cannot-make", "nothing-picked",
        "double-brew", "additive-unknown", "additive-fit", "additive-round", "combine-pick", "combine-fit", "no-vials", "vials", "no-vial-item", "bad-choice", "no-feat",
        "not-in-combat", "quickened", "none", "item-gone", "not-healing-bomb", "inert", "no-creature", "range", "no-strike", "no-regain", "in-combat", "full", "minutes",
        "frequency"]) {
        assert.ok(lang[labels.REFUSAL[code]], code);
    }
});

/* -------------------------------------------- */
/*  Second M8 review                             */
/* -------------------------------------------- */

/** A card's buttons as elements, from the data its template was rendered with. */
function cardButtons(data) {
    const html = element("div");
    for (const b of data.buttons) {
        const button = element("button");
        Object.assign(button.dataset, { pf2eArtisansWorkshopOp: b.op, map: String(b.map ?? 0), ...(b.actor ? { actor: b.actor } : {}), ...(b.item ? { item: b.item } : {}),
            ...(b.token ? { token: b.token } : {}) });
        button.matches = (s) => s === "button[data-pf2e-artisans-workshop-op]";
        html.append(button);
    }
    return html;
}

test("Double Brew in the panel: two of the same item, shown with a count; a chip takes one off; both made, one vial each (review fix, 8.3)", async () => {
    const { app } = await panel.openQuickAlchemy({ actor: vera });
    app.toggle(items.minor.uuid);
    app.toggle(items.minor.uuid);
    await app.renderList();
    assert.deepEqual(app.picks, [items.minor.uuid, items.minor.uuid], "a picked row picked again adds a second");
    const row = app.context.options.find((o) => o.uuid === items.minor.uuid);
    assert.deepEqual([row.picked, row.count], [true, "× 2"]);
    assert.deepEqual(app.context.picks.map((p) => [p.index, p.name]), [[0, "Elixir of Life (Minor)"], [1, "Elixir of Life (Minor)"]]);
    assert.equal(app.context.cost, "Costs 2 vials.");
    app.toggle(items.minor.uuid);
    assert.deepEqual(app.picks, [items.minor.uuid], "full: a picked row gives one back");
    app.toggle(items.minor.uuid);
    app.unpick(1);
    assert.deepEqual(app.picks, [items.minor.uuid], "a chip takes one off");
    app.toggle(items.minor.uuid);
    const before = vera.getResource("versatile-vials").value;
    const made = await app.create(null);
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.deepEqual([vera.items.filter((i) => i.name === "Elixir of Life (Minor)").length, vera.getResource("versatile-vials").value], [2, before - 2]);
});

test("a throw from the panel or the HUD palette uses the multiple attack penalty variant chosen (review fix, 8.2, 8.4)", async () => {
    const { app } = await panel.openQuickAlchemy({ actor: vera, bombs: true });
    assert.ok(app.context.map, "a choice of pf2e's Strike variant");
    assert.deepEqual(app.context.map.map((m) => [m.value, m.selected]), [["0", true], ["1", false], ["2", false]], "Quick Bomber's panel always throws");
    app.element.listeners.change[0]({ target: { dataset: { quick: "map" }, value: "2" } });
    app.toggle(items.fire.uuid);
    await app.create(null);
    assert.equal(world.strikes.at(-1).map, 2, "pf2e's third variant");
    const again = (await panel.openQuickAlchemy({ actor: vera })).app;
    again.toggle(items.fire.uuid);
    await again.renderList();
    assert.equal(again.context.map, null, "held, not thrown: no variant to choose");
    again.then = "strike";
    await again.render({ parts: ["plan"] });
    assert.equal(again.context.map.length, 3);
    // The palette: one entry per pf2e variant, with pf2e's label.
    const bomb = (await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid })).items[0].id;
    const html = hudElement();
    hud.injectPalette({ actor: vera }, html);
    const palette = html.querySelector(".col.left").children[1];
    const fire = palette.children.filter((e) => e.dataset.pf2eArtisansWorkshopHud === "strike" && e.dataset.item === bomb);
    assert.deepEqual(fire.map((e) => e.dataset.map), ["0", "1", "2"]);
    assert.equal(fire[1].children[0].children[1].text, " Strike: Alchemist's Fire (Lesser), +5 (MAP -5)");
    await palette.listeners.click[0]({ target: { closest: () => fire[1] }, preventDefault() {}, stopPropagation() {} });
    assert.equal(world.strikes.at(-1).map, 1);
});

test("the Healing Bomb card goes to every owner who must apply it: the target's and each adjacent creature's (review fix, 8.6)", async () => {
    const rendered = [];
    world.render = (path, data) => {
        rendered.push(data);
        return "<div></div>";
    };
    cards.registerCombatCards();
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "p3" }, { id: "gm00000000000000", isGM: true }], "p1");
    const dee = addDocument("Actor", { name: "Dee", type: "character", ownership: { default: 0, p3: 3 }, items: [] });
    physicalItems(dee);
    asCharacter(dee, { level: 5 });
    dee.modeOfBeing = "living";
    const boToken = { name: "Bo", actor: bo, document: { uuid: "Scene.s.Token.bo" }, distanceTo: () => 0 };
    const deeToken = { name: "Dee", actor: dee, document: { uuid: "Scene.s.Token.dee" }, distanceTo: (t) => (t === boToken ? 5 : 99) };
    bo.getActiveTokens = () => [boToken];
    globalThis.canvas = { ready: true, grid: { distance: 5 }, tokens: { controlled: [], placeables: [boToken, deeToken] } };
    const made = await alchemy.healingBomb(vera);
    const thrown = await alchemy.throwHealingBomb(vera, made.items[0].id, { target: bo.uuid });
    assert.deepEqual(thrown.adjacent.map((a) => a.name), ["Dee"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const message = world.collections.ChatMessage.contents.at(-1);
    assert.equal(message.flags[MOD].card.kind, "healing-bomb");
    assert.deepEqual(message.whisper.sort(), ["gm00000000000000", "p1", "p2", "p3"], "the thrower's, the target's and Dee's owners");
    assert.deepEqual(rendered.at(-1).buttons.map((b) => [b.op, b.actor]), [["heal", dee.uuid]], "no 'selected tokens' fallback beside the canvas's own list");
});

test("Healing Bomb without a canvas: the creature is picked, the party's living members are offered the healing, and pf2e applies it with no token on the canvas (review fix, 8.6)", async () => {
    const rendered = [];
    world.render = (path, data) => {
        rendered.push(data);
        return "<div></div>";
    };
    cards.registerCombatCards();
    globalThis.canvas = undefined;
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "p3" }, { id: "gm00000000000000", isGM: true }], "p1");
    const dee = addDocument("Actor", { name: "Dee", type: "character", ownership: { default: 0, p3: 3 }, items: [] });
    physicalItems(dee);
    asCharacter(dee, { level: 5 });
    for (const a of [vera, bo, dee]) a.modeOfBeing = "living";
    world.collections.Actor.party.members = [vera, bo, dee];
    // pf2e's applyDamage: the token is required (it names the creature after the Hit Points are written).
    dee.applyDamage = async ({ damage, token }) => {
        world.damage.push([dee.id, damage]);
        token.name.replace(/[<>]/g, "");
    };
    const asked = [];
    foundry.applications.api.DialogV2.prompt = async (config) => {
        asked.push(config);
        return { value: bo.uuid };
    };
    const made = await alchemy.healingBomb(vera);
    // The Bandolier's and the card's Throw pass no target: with none on a canvas, the user picks the creature.
    const bandolierApp = new bandolier.BandolierApp();
    const thrown = await bandolierApp.run("throw", { item: made.items[0].id });
    assert.equal(thrown.ok, true, JSON.stringify(thrown));
    assert.deepEqual([asked.length, thrown.target.actor, thrown.known], [1, bo.uuid, false]);
    assert.deepEqual(alchemy.throwCandidates(vera).map((a) => a.name), ["Bo", "Dee", "Vera"], "the party, then the encounter, the thrower last");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const data = rendered.at(-1);
    assert.deepEqual(data.buttons.map((b) => [b.op, b.actor]), [["heal", vera.uuid], ["heal", dee.uuid]], "the party's living members but the target");
    const message = world.collections.ChatMessage.contents.at(-1);
    assert.deepEqual(message.whisper.sort(), ["gm00000000000000", "p1", "p2", "p3"]);
    // Dee's player applies it from the card, with no canvas: pf2e is given Dee's token without one.
    world.currentUser = "p3";
    const html = cardButtons(data);
    cards.renderCombatCard(message, html);
    const [veraButton, deeButton] = html.children;
    assert.deepEqual([veraButton.hidden, deeButton.hidden], [true, false]);
    await deeButton.listeners.click[0]({ preventDefault() {} });
    assert.deepEqual(world.damage.at(-1), [dee.id, -5]);
    assert.equal(deeButton.disabled, true, "applied once");
    // pf2e failing leaves no record behind: the button can be used again.
    world.currentUser = "p1";
    vera.applyDamage = async () => {
        throw new TypeError("pf2e failed");
    };
    const failed = await alchemy.applyHealingBomb(message.id, { actor: vera.uuid, hp: 5 });
    assert.equal(failed.reason, "apply-failed");
    assert.equal(vera.flags[MOD]?.healed?.[message.id], undefined);
});

test("the Quick Alchemy card and the Bandolier name Combine Elixirs' second elixir (review fix, 8.6)", async () => {
    const rendered = [];
    world.render = (path, data) => {
        rendered.push(data);
        return "<div></div>";
    };
    cards.registerCombatCards();
    const made = await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid, additive: "combine-elixirs", combine: items.minor.uuid });
    assert.equal(made.ok, true, JSON.stringify(made));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(rendered.at(-1).lines.some((l) => l.text.endsWith("with Elixir of Life (Minor)")), JSON.stringify(rendered.at(-1).lines));
    const context = await bandolier.bandolierContext(new bandolier.BandolierApp());
    assert.ok(context.ready.find((r) => r.id === made.items[0].id).additive.endsWith("with Elixir of Life (Minor)"));
});
