/**
 * The M9a interface over the fake world (DESIGN.md 6.16, 10.1-10.5): nothing of a variant shows while it is off; with each
 * on, an order's detail shows what it adds (Complex Crafting's setup and rush, events with their link, Critical Crafting's
 * special flag and record, a secret check hidden from players, Deconstruct, Grow, a quest), the Funds tab its gardens and
 * gifts, the Downtime tab today's harvests, the request form its kinds and adjustments; the buttons run the variants'
 * functions; every M9a label is a key in lang/en.json and every placeholder is filled.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { MOD, addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
const moduleKeys = new Set(Object.keys(lang));
Object.assign(lang, { "PF2E.CurrencyAbbreviations.gp": "gp", "PF2E.CurrencyAbbreviations.sp": "sp", "PF2E.CurrencyAbbreviations.cp": "cp", "PF2E.CurrencyAbbreviations.pp": "pp" });
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => (data && name in data ? String(data[name]) : `{${name}}`));
foundry.applications.api.ApplicationV2 = class {
    constructor(options = {}) { this.options = options; this.tabGroups = { primary: "queue" }; this.window = {}; }
    async _prepareContext() { return { tabs: {} }; }
};

const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { RANK } = await import("../../scripts/logic/core.mjs");
const { makeOrder } = await import("../../scripts/logic/orders.mjs");
const { orderView } = await import("../../scripts/logic/views.mjs");
const { itemOptions } = await import("../../scripts/logic/registry.mjs");
const { makeQuest } = await import("../../scripts/logic/variants.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { resetProducts } = await import("../../scripts/foundry/products.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, write } = await import("../../scripts/foundry/store.mjs");
const { decorate } = await import("../../scripts/ui/context.mjs");
const { fundsVariants, harvestView, onVariantOp, variantDetail } = await import("../../scripts/ui/variants.mjs");
const { adjustmentChoices, kindsNow } = await import("../../scripts/ui/request.mjs");
const { productFacts } = await import("../../scripts/foundry/products.mjs");
const { gateText, refusalText } = await import("../../scripts/ui/format.mjs");
const labels = await import("../../scripts/ui/labels.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

const C = (id) => `Compendium.pf2e.equipment-srd.Item.${id}`;
const RING = C("ringofwarding0000");
const ELIXIR = C("elixiroflife00000");
const ARMOR = C("breastplate000000");
const LATCHES = C("armorlatches00000");
const SIPHON = C("weaponsiphon00000");
const INDEX = [
    { uuid: RING, name: "Ring of Warding", type: "equipment", system: { level: { value: 4 }, traits: { value: ["invested", "magical"], rarity: "common" }, price: { value: { gp: 100 } } } },
    { uuid: ELIXIR, name: "Elixir of Life (Minor)", type: "consumable", system: { level: { value: 1 }, traits: { value: ["alchemical", "consumable", "elixir"], rarity: "common" },
        price: { value: { gp: 3 } } } },
    { uuid: ARMOR, name: "Breastplate", type: "armor", system: { level: { value: 2 }, category: "medium", traits: { value: [], rarity: "common" }, price: { value: { gp: 30 } } } },
    { uuid: LATCHES, name: "Armor Latches", type: "equipment", system: { level: { value: 1 }, traits: { value: ["adjustment"], rarity: "common" }, usage: { value: "applied-to-armor" },
        price: { value: { gp: 4 } } } },
    { uuid: SIPHON, name: "Weapon Siphon", type: "equipment", system: { level: { value: 1 }, traits: { value: ["adjustment"], rarity: "common" },
        usage: { value: "attached-to-melee-weapon" }, price: { value: { gp: 10 } } } },
];
game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => INDEX }]]);
game.pf2e = { settings: { variants: { pwol: { enabled: false } } } };
CONFIG.PF2E = { rarityTraits: {}, magicTraditions: {}, skills: { crafting: { label: "Crafting" }, nature: { label: "Nature" } } };
CONFIG.Item = {
    documentClass: class {
        constructor(source) {
            const s = source.system ?? {};
            Object.assign(this, { name: source.name, img: "i.webp", type: source.type, system: s, slug: s.slug ?? null, level: s.level?.value ?? 0,
                rarity: s.traits?.rarity ?? "common", traits: new Set(s.traits?.value ?? []), category: s.category ?? null,
                price: { value: { copperValue: (s.price?.value?.gp ?? 0) * 100 }, per: 1 } });
        }
        getRollOptions() { return [...itemOptions({ type: this.type, slug: this.slug, traits: [...this.traits], rarity: this.rarity, level: this.level, category: this.category })]; }
    },
};

let vera;
let bo;
const stamp = { by: "p1", at: { world: 1, real: 1 } };
const statistic = (slug, rank) => ({ slug, rank, label: slug, modifiers: [] });
beforeEach(() => {
    resetWorld();
    state.resetState();
    resetProducts();
    resetLease();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [
        { type: "feat", name: "Magical Crafting", sourceId: REGISTRY["magical-crafting"].uuid, system: { level: { taken: 1 } } }] });
    Object.assign(vera, { level: 7, skills: { crafting: statistic("crafting", RANK.master), nature: statistic("nature", RANK.trained) },
        system: { crafting: { formulas: [{ uuid: ELIXIR }, { uuid: RING }] } } });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [] });
    Object.assign(bo, { level: 3, skills: {}, system: { crafting: { formulas: [] } } });
    world.compendium = Object.fromEntries(INDEX.map((entry) => [entry.uuid, { ...entry, isOfType: (t) => t === "physical", toObject: () => structuredClone(entry) }]));
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [vera, bo] };
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
});

const turnOn = async (...keys) => {
    for (const key of keys) await game.settings.set(MOD, `variants.${key}`, true);
};

/** An order stored in the ledger. */
async function stored(over = {}, fields = {}) {
    const order = { ...makeOrder({ id: "o1", requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, product: { uuid: ELIXIR, snapshot: { name: "Elixir of Life (Minor)" } },
        quantity: 4, crafter: vera.uuid, ...over }, stamp), ...fields };
    await write({ set: { "orders.o1": order } });
    return read("orders.o1");
}

/** Every string a view holds, flattened. */
function strings(value, out = []) {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
    else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
    return out;
}

/** No placeholder left unfilled, no key left unlocalized. */
function wellWritten(view) {
    for (const text of strings(view)) {
        assert.doesNotMatch(text, /\{\w+\}/, `an unfilled placeholder: ${text}`);
        assert.doesNotMatch(text, /^pf2e-artisans-workshop\./, `a raw key: ${text}`);
    }
}

test("while every variant is off, the window shows nothing of them", async () => {
    const order = await stored();
    assert.equal(await variantDetail(order, await productFacts(ELIXIR)), null);
    // A quirk noted while a variant was on is not shown once every variant is off (Critical Crafting's special-only default is no variant).
    const noted = await stored({}, { status: "complete", check: { degree: 2, settled: true, rushFlat: { outcome: "quirk" } }, variantNote: { text: "it squeaks" } });
    assert.equal(await variantDetail(noted, await productFacts(ELIXIR)), null);
    assert.equal(fundsVariants(), null);
    assert.equal(harvestView(vera), null);
    assert.deepEqual(kindsNow(), ["item", "upgrade", "rune-etch", "rune-transfer", "service"]);
});

test("Complex Crafting on the detail: the setup in words, the rush the crafter may choose, and the choice from the Queue", async () => {
    await turnOn("complexCrafting");
    const order = await stored();
    const detail = await variantDetail(order, await productFacts(ELIXIR));
    assert.deepEqual([detail.complex.lines, detail.complex.rush.can], [["Setup: 1 day"], true]);
    wellWritten(detail);
    let asked = null;
    foundry.applications.api.DialogV2.prompt = async (config) => {
        asked = config;
        return { value: "1" };
    };
    const target = { closest: (selector) => (selector === "[data-order-id]" ? { dataset: { orderId: "o1" } } : { dataset: { op: "rush" } }) };
    const result = await onVariantOp({ actingActor: () => vera }, target);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(read("orders.o1.variant.rushRequest"), 1);
    assert.equal(asked.window.title, "pf2e-artisans-workshop.Variant.Rush.Choose");
    const after = await variantDetail(read("orders.o1"), await productFacts(ELIXIR));
    assert.deepEqual(after.complex.lines, ["Setup: 4 hours, rushed 1 day (DC +5)"]);
    world.currentUser = "p2";
    assert.equal((await variantDetail(read("orders.o1"), await productFacts(ELIXIR))).complex.rush.can, false, "only the crafter's side");
});

test("events, Critical Crafting and a secret check on the detail and in the Queue", async () => {
    await turnOn("events", "criticalCrafting");
    const event = { k: 1, attempt: 1, key: "event:o1:1:1", day: 7, roll: 2, gmCore: true, tableResult: null, note: "", status: "open", by: "p1" };
    const order = await stored({}, { status: "finishing", attempt: 1, events: { "1-1": event }, variant: { special: true },
        check: { degree: 3, die: 20, settled: true, level: 7, rank: 3, attempt: 1, critical: { kind: "success", natural: true, mode: "alongside", category: "durable", note: "it hums" } } });
    const detail = await variantDetail(order, await productFacts(ELIXIR));
    assert.deepEqual(detail.events.list.map((e) => [e.slot, e.text, e.gmCore, e.canResolve]), [["1-1", "an event from the GM Core", true, true]]);
    assert.equal(detail.events.list[0].link, "Compendium.pf2e.journals.JournalEntry.S55aqwWIzpQRFhcq.JournalEntryPage.or9dAZfXyd01A8dS");
    assert.deepEqual([detail.critical.record.kindText, detail.critical.record.category, detail.critical.record.note], ["Critical success", "Unusually durable", "it hums"]);
    wellWritten(detail);
    // A secret check: players read "rolled (secret)" until it settles or a GM reveals it; a GM reads the degree.
    const secret = await stored({}, { status: "rolled", attempt: 1, priceCp: 1200, upfrontCp: 600, check: { degree: 3, die: 20, settled: false, secret: true, level: 7, rank: 3, attempt: 1 } });
    world.currentUser = "p2";
    const viewer = { userId: "p2", isGM: false, owns: () => false, hasCharacter: true };
    const asPlayer = decorate(orderView(secret, { viewer, nameOf: () => "Vera" }), secret);
    assert.deepEqual([asPlayer.checkText, asPlayer.checkClass], ["rolled (secret)", null]);
    world.currentUser = "gm00000000000000";
    const asGm = decorate(orderView(secret, { viewer: { ...viewer, isGM: true }, nameOf: () => "Vera" }), secret);
    assert.equal(asGm.checkText, "PF2E.Check.Result.Degree.Check.criticalSuccess");
    const gmDetail = await variantDetail(secret, await productFacts(ELIXIR));
    assert.equal(gmDetail.critical.secret.canReveal, true);
});

test("Deconstruct, Grow and a quest on the detail", async () => {
    await turnOn("deconstruct", "grow", "quests");
    const item = vera.addItem({ type: "equipment", name: "Ring of Warding", system: { quantity: 1 } });
    const deconstruct = await stored({ craftType: "deconstruct", target: item.uuid, quantity: 1, product: { uuid: RING, snapshot: { name: "Ring of Warding" } },
        variant: { deconstruct: { purpose: "similar", damaged: false, lossPct: 5 } } });
    const d = (await variantDetail(deconstruct, await productFacts(RING))).deconstruct;
    assert.deepEqual([d.purpose, d.canPurpose, d.workshop, d.loss], ["a new, similar item", true, { on: false, can: true }, "Value lost to retries: 5%"]);
    const grow = await stored({ craftType: "grow" });
    const g = (await variantDetail(grow, await productFacts(ELIXIR))).grow;
    assert.deepEqual([g.skill, g.tools], ["Grown with Crafting.", { on: false, can: true }]);
    const quest = await stored({ craftType: "quest", quantity: 1, product: { uuid: RING, snapshot: { name: "Ring of Warding", priceCp: 10000 } },
        variant: { quest: makeQuest({ encounters: 2, threats: ["low", "severe"] }) } }, { status: "gathering" });
    const q = (await variantDetail(quest, await productFacts(RING))).quest;
    assert.equal(q.cost, "Price 100 gp; it counts as 80 gp against party treasure, 40 gp from each of its 2 encounters.");
    assert.deepEqual(q.components.map((c) => [c.label, c.threat, c.canMark]), [["Component 1", "low threat", true], ["Component 2", "severe threat", true]]);
    assert.equal(q.assembly, "Assembled with a Crafting check.");
    wellWritten({ d, g, q });
    const target = { closest: (selector) => (selector === "[data-order-id]" ? { dataset: { orderId: "o1" } } : { dataset: { op: "found", component: "c1" } }) };
    world.currentUser = "p2";
    assert.equal((await onVariantOp({ actingActor: () => bo }, target)).ok, true);
    assert.deepEqual([read("orders.o1.variant.quest.components.c1.found.actor"), read("orders.o1.variant.quest.components.c1.found.by")], [bo.uuid, "p2"]);
});

test("the Funds tab's gardens and gifts, and the Downtime tab's harvests", async () => {
    await turnOn("gardens", "gifts");
    await write({ set: { "gardens.g1": { id: "g1", v: 1, party: "party", name: "Herbs", kind: "orchard", product: { uuid: ELIXIR, level: 1, name: "Elixir of Life (Minor)" },
        perDay: 1, seedCostCp: 6000, plantedDay: 0, harvests: {}, by: "p1" } } });
    const funds = fundsVariants();
    assert.deepEqual(funds.gardens.list.map((g) => [g.name, g.seed, g.planted, g.canFund]), [["Herbs", "60 gp", "planted on day 0", false]]);
    assert.equal(funds.gardens.limit, "1 of 1 gardens");
    assert.equal(funds.gardens.canAdd, false, "the party is at its limit");
    vera.addItem({ type: "equipment", name: "Cloak", system: { quantity: 1 }, flags: { [MOD]: { gift: { bound: bo.uuid, heirs: [], giver: "a nymph" } } } });
    const gifts = fundsVariants().gifts;
    assert.deepEqual(gifts.list.map((g) => [g.name, g.holder, g.bound, g.dormant]), [["Cloak", "Vera", "Bo", true]]);
    const harvests = harvestView(vera);
    assert.deepEqual(harvests.list.map((h) => [h.name, h.canHarvest, h.done]), [["Herbs", true, null]]);
    wellWritten({ funds: fundsVariants(), harvests });
});

test("the request form offers the variant kinds while they are on, and only the adjustments that fit", async () => {
    await turnOn("deconstruct", "quests");
    assert.deepEqual(kindsNow(), ["item", "upgrade", "rune-etch", "rune-transfer", "deconstruct", "quest", "service"]);
    await turnOn("adjustments");
    assert.deepEqual((await adjustmentChoices(await productFacts(ARMOR))).map((a) => a.name), ["Armor Latches"]);
    assert.deepEqual(await adjustmentChoices(await productFacts(ELIXIR)), [], "only armor, shields and weapons take adjustments");
});

test("M9a's gates and refusals read as sentences; every M9a label is a key; the templates carry the variant buttons", () => {
    assert.equal(gateText({ reason: "workshop", data: {} }), "The crafter has not confirmed the workshop.");
    assert.equal(gateText({ reason: "adjustment-fit", data: { name: "Weapon Siphon" } }), "Weapon Siphon does not fit this item.");
    assert.equal(refusalText({ reason: "variant-off" }), "That variant rule is turned off.");
    assert.equal(refusalText({ reason: "garden-limit", data: { max: 2 } }), "The party already keeps as many gardens as it can (2).");
    const keys = [
        labels.CRAFT_TYPE.deconstruct, labels.CRAFT_TYPE.grow, labels.CRAFT_TYPE.quest, labels.DAY_STOP.event, labels.DAY_STOP["event-due"], labels.DAY_STOP["setup-hours"],
        labels.EVENT.deconstruct, labels.EVENT.assemble, ...Object.values(labels.THREAT), ...Object.values(labels.CRITICAL_CATEGORY), ...Object.values(labels.ITEM_OUTCOME),
        ...["hard-to-destroy", "consumable", "workshop", "grow-tools", "quest-components", "adjustment-fit"].map((code) => labels.GATE[code]),
        ...["variant-off", "rush", "no-hours", "setup-days", "rank", "no-event", "not-member", "no-critical", "cursed", "no-check", "gifted", "dormant", "damaged", "raw",
            "not-similar", "purpose", "key", "expired", "one-components", "no-garden", "planted", "not-planted", "harvested", "garden-limit", "not-consumable", "funded",
            "encounters", "no-component", "found", "missing", "not-due", "adjustment-fit"].map((code) => labels.REFUSAL[code]),
    ];
    assert.deepEqual(keys.filter((key) => !moduleKeys.has(key)), []);
    const queue = readFileSync(join(ROOT, "templates/workshop/queue.hbs"), "utf8");
    for (const op of ["rush", "setup-now", "rush-finish", "roll-event", "resolve-event", "special", "reveal", "critical", "curse", "purpose", "checklist", "follow-on",
        "retry-loss", "components", "untended", "season", "found", "unfound", "component", "quest-config", "note"]) {
        assert.match(queue, new RegExp(`data-action="variant" data-op="${op}"`), op);
    }
    const funds = readFileSync(join(ROOT, "templates/workshop/funds.hbs"), "utf8");
    for (const op of ["garden-add", "garden-fund", "garden-remove", "bestow", "heir"]) assert.match(funds, new RegExp(`data-op="${op}"`), op);
    assert.match(readFileSync(join(ROOT, "templates/workshop/downtime.hbs"), "utf8"), /data-op="harvest"/);
});
