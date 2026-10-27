/**
 * The M5 interface over the fake world (DESIGN.md 10.1 Formulas tab, 10.3, 4.5): the Formula Codex's context (families
 * with provenance badges, picks owed, the routes for a formula with its break-even), the tab's buttons, the Queue's
 * services list and an order's custody and pledge lines, the request form's item choices, and every M5 label a key.
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
Object.assign(lang, { "PF2E.CurrencyAbbreviations.gp": "gp", "PF2E.CurrencyAbbreviations.sp": "sp", "PF2E.CurrencyAbbreviations.cp": "cp" });
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
foundry.applications.api.ApplicationV2 = class {
    constructor(options = {}) { this.options = options; this.tabGroups = { primary: "queue" }; this.window = {}; }
    async _prepareContext() { return { tabs: {} }; }
    async _preparePartContext(_partId, context) { return context; }
};

const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { RANK } = await import("../../scripts/logic/core.mjs");
const { makeProvenance } = await import("../../scripts/logic/codex.mjs");
const { makeOrder } = await import("../../scripts/logic/orders.mjs");
const { itemOptions } = await import("../../scripts/logic/registry.mjs");
const { makeService } = await import("../../scripts/logic/services.mjs");
const { resetCatalogue } = await import("../../scripts/foundry/catalogue.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { resetProducts } = await import("../../scripts/foundry/products.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { write } = await import("../../scripts/foundry/store.mjs");
const { codexState, formulasContext, onFormulaChange, onFormulaOp } = await import("../../scripts/ui/formulas.mjs");
const { detailExtras, kindText, servicesView } = await import("../../scripts/ui/extras.mjs");
const labels = await import("../../scripts/ui/labels.mjs");
const { itemChoices } = await import("../../scripts/ui/request.mjs");
const { focusSelector } = await import("../../scripts/ui/focus.mjs");
const { gateText } = await import("../../scripts/ui/format.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

const C = (id) => `Compendium.pf2e.equipment-srd.Item.${id}`;
const MINOR = C("minor00000000000");
const LESSER = C("lesser0000000000");
const STRIKING = C("striking00000000");
/** The equipment compendium's index, as `getIndex` returns it. */
const INDEX = [
    { uuid: MINOR, name: "Elixir of Life (Minor)", type: "consumable", img: "m.webp", system: { level: { value: 1 }, traits: { value: ["alchemical", "consumable", "elixir"], rarity: "common" }, category: "elixir", price: { value: { gp: 3 } } } },
    { uuid: LESSER, name: "Elixir of Life (Lesser)", type: "consumable", img: "l.webp", system: { level: { value: 5 }, traits: { value: ["alchemical", "consumable", "elixir"], rarity: "common" }, category: "elixir", price: { value: { gp: 30 } } } },
    { uuid: STRIKING, name: "Striking", type: "equipment", img: "s.webp", system: { slug: "striking", level: { value: 4 }, traits: { value: ["magical"], rarity: "common" }, usage: { value: "etched-onto-a-weapon" }, price: { value: { gp: 65 } } } },
];
game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => INDEX }]]);
game.pf2e = { settings: { variants: { pwol: { enabled: false } } }, system: { sluggify: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-") } };
CONFIG.PF2E = { rarityTraits: {}, skills: { crafting: { label: "PF2E.SkillCrafting" } } };
/** pf2e's prepared item, from an index entry's fields. */
CONFIG.Item = {
    documentClass: class {
        constructor(source) {
            const s = source.system ?? {};
            Object.assign(this, { name: source.name, img: source.img, type: source.type, system: s, slug: s.slug ?? null, level: s.level?.value ?? 0,
                rarity: s.traits?.rarity ?? "common", traits: new Set(s.traits?.value ?? []), category: s.category ?? null,
                price: { value: { copperValue: (s.price?.value?.gp ?? 0) * 100 }, per: 1 } });
        }
        getRollOptions() { return [...itemOptions({ type: this.type, slug: this.slug, traits: [...this.traits], rarity: this.rarity, level: this.level, category: this.category })]; }
    },
};

let vera;
let bo;
beforeEach(() => {
    resetWorld();
    state.resetState();
    resetCatalogue();
    resetProducts();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [
        { type: "feat", name: "Formula Book", sourceId: REGISTRY["formula-book"].uuid, system: { level: { value: 1 } } },
        { type: "feat", name: "Alchemical Crafting", sourceId: REGISTRY["alchemical-crafting"].uuid, system: { level: { taken: 1 } } },
    ] });
    Object.assign(vera, { level: 2, skills: { crafting: { slug: "crafting", rank: RANK.expert } }, system: { crafting: { formulas: [{ uuid: MINOR }] } } });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [] });
    Object.assign(bo, { level: 2, skills: {}, system: { crafting: { formulas: [] } } });
    world.compendium = Object.fromEntries(INDEX.map((entry) => [entry.uuid, { ...entry, isOfType: (t) => t === "physical", toObject: () => structuredClone(entry) }]));
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [vera, bo] };
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
});

/** The window as far as the Formulas tab reads it. */
const fakeApp = () => ({ actingActor: () => vera });

test("the Codex: the book by family with provenance badges and covered grades, and the picks owed by level (10.1)", async () => {
    const record = makeProvenance({ uuid: MINOR, route: "granted", source: "alchemical-crafting", pickLevel: 1 }, { by: "p1", at: { real: 1 } });
    await write({ set: { [`formulas.${vera.id}.${record.id}`]: record } });
    const { codex } = await formulasContext(fakeApp());
    assert.deepEqual([codex.actor.name, codex.total], ["Vera", "1"]);
    const [family] = codex.families;
    assert.deepEqual([family.name, family.known[0].route, family.known[0].badge.key, family.coveredCount], ["Elixir of Life", "granted",
        labels.PROVENANCE.granted.key, 1]);
    assert.deepEqual(family.covered.shown, ["Elixir of Life (Lesser) (5)"]);
    // Formula Book: 2 at level 1 and 2 at level 2; Alchemical Crafting: 4 at level 1, one already taken.
    assert.deepEqual(codex.owed.map((e) => [e.level, e.key, e.owed]), [[1, "alchemical-crafting", "3"], [1, "formula-book", "2"], [2, "formula-book", "2"]]);
    assert.equal(codex.owedTotal, "7");
    assert.deepEqual(codex.badges.map((b) => b.route), ["granted"]);
});

test("Learn a formula: the routes for a formula with their costs, and the break-even of buying it", async () => {
    const app = fakeApp();
    await onFormulaOp(app, { closest: () => ({ dataset: { op: "select", uuid: STRIKING } }) });
    assert.equal(codexState(app).uuid, STRIKING);
    const { codex } = await formulasContext(app);
    const selected = codex.learn.selected;
    assert.equal(selected.name, "Striking");
    assert.equal(selected.known, false);
    assert.deepEqual(selected.routes.map((r) => r.route), ["none", "buy", "copy-npc"]);
    assert.equal(selected.routes.find((r) => r.route === "buy").cost, "5 gp", "a 4th-level formula costs 5 gp");
    assert.deepEqual([selected.breakEven.needed, selected.breakEven.crafts], [false, "17"], "a 2nd-level expert's day is worth 30 cp");
    assert.equal(onFormulaChange(app, { name: "codexSeller", checked: true }), true);
    assert.equal(codexState(app).seller, true);
});

test("a grade another known grade covers is crafted now: no route to acquire it (6.4; the live m5-shots plan expected routes there)", async () => {
    // Core's fromUuidSync answers a compendium UUID with its index entry once the pack's index is loaded.
    const real = globalThis.fromUuidSync;
    globalThis.fromUuidSync = (uuid) => real(uuid) ?? INDEX.find((entry) => entry.uuid === uuid) ?? null;
    try {
        const app = fakeApp();
        await onFormulaOp(app, { closest: () => ({ dataset: { op: "select", uuid: LESSER } }) });
        const { codex } = await formulasContext(app);
        const selected = codex.learn.selected;
        assert.deepEqual([selected.name, selected.known, selected.route, selected.routes], ["Elixir of Life (Lesser)", false, "family", []]);
        await onFormulaOp(app, { closest: () => ({ dataset: { op: "select", uuid: STRIKING } }) });
        assert.ok((await formulasContext(app)).codex.learn.selected.routes.length >= 1, "a formula nothing covers has its routes");
    } finally {
        globalThis.fromUuidSync = real;
    }
});

test("a formula on its way to the book (a claim not applied yet) shows as such, with no route to buy it again (5.5)", async () => {
    const { makeClaim } = await import("../../scripts/logic/claims.mjs");
    const claim = makeClaim({ kind: "formula", idem: "formula:x:vera:striking", actor: vera.uuid, uuid: STRIKING, route: "bought" }, { by: "gm", at: { real: 1 } });
    await write({ set: { [`claims.${claim.id}`]: claim } });
    const app = fakeApp();
    await onFormulaOp(app, { closest: () => ({ dataset: { op: "select", uuid: STRIKING } }) });
    const { codex } = await formulasContext(app);
    assert.deepEqual([codex.learn.selected.known, codex.learn.selected.pending, codex.learn.selected.routes], [false, true, []]);
});

test("choosing for a pick lists the catalogue's items that fit it, and 'clear' stops", async () => {
    const app = fakeApp();
    await onFormulaOp(app, { closest: () => ({ dataset: { op: "pick", key: "alchemical-crafting", level: "1" } }) });
    const { codex } = await formulasContext(app);
    assert.equal(codex.learn.pick.maxLevel, 1);
    assert.deepEqual(codex.learn.matches.map((m) => m.name), ["Elixir of Life (Minor)"], "alchemical, common, level 1 or lower");
    await onFormulaOp(app, { closest: () => ({ dataset: { op: "clear" } }) });
    assert.equal(codexState(app).pick, null);
});

test("the Queue's services: open first, with what this user may do; an order's kind and its pledge and custody lines", async () => {
    const stamp = { by: "p2", at: { world: 1, real: 1 } };
    const open = makeService({ id: "s1", kind: "repair", requester: bo.uuid, target: "Actor.x.Item.y" }, stamp);
    const done = { ...makeService({ id: "s2", kind: "affix", requester: vera.uuid, performer: vera.uuid, target: "Actor.x.Item.t" }, stamp), status: "done",
        result: { item: "Talisman", host: "Armor" } };
    const view = servicesView([done, open]);
    assert.deepEqual(view.map((s) => [s.id, s.actions.offer, s.closed]), [["s1", true, false], ["s2", false, true]]);
    assert.equal(view[1].result, "Talisman affixed to Armor.");
    const order = makeOrder({ id: "o1", requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, product: { uuid: STRIKING, snapshot: {} },
        quantity: 1, craftType: "rune-etch", target: "Actor.x.Item.sword" }, stamp);
    assert.equal(kindText(order), "Etch a rune");
    const extras = await detailExtras({ ...order, custody: { l1: { id: "l1", purpose: "target", name: "Sword", from: bo.uuid, itemId: "i", valueCp: 0 } } });
    assert.deepEqual(extras.custody.map((l) => [l.name, l.purpose]), [["Sword", "item to work on"]]);
    assert.equal(extras.supply, null, "a rune needs no spells");
});

test("the request form offers the requester's items that fit what is asked", () => {
    const item = (data) => {
        const doc = vera.addItem(data);
        doc.isOfType = (t) => t === "physical";
        return doc;
    };
    item({ type: "weapon", name: "Sword", system: { runes: { potency: 1, striking: 1, property: [] } } });
    item({ type: "armor", name: "Mail", system: { runes: { potency: 0 } } });
    item({ type: "shield", name: "Shield", system: { hp: { value: 5, max: 20 } } });
    item({ type: "consumable", name: "Talisman", traits: new Set(["talisman"]), flags: { [MOD]: { affix: { host: "x" } } } });
    const striking = { slug: "striking", usage: "etched-onto-a-weapon" };
    assert.deepEqual(itemChoices(vera, "rune-etch", striking).map((i) => i.name), ["Sword"]);
    assert.deepEqual(itemChoices(vera, "rune-transfer", striking, { source: "pick" }).map((i) => i.name), ["Sword"], "the sword holds a striking rune");
    assert.deepEqual(itemChoices(vera, "rune-transfer", striking).map((i) => i.name), [], "and no other weapon could take it");
    assert.deepEqual(itemChoices(vera, "service", null, { serviceKind: "repair" }).map((i) => i.name), ["Shield"]);
    assert.deepEqual(itemChoices(vera, "service", null, { serviceKind: "affix" }).map((i) => i.name), ["Talisman"]);
    assert.deepEqual(itemChoices(vera, "service", null, { serviceKind: "host" }).map((i) => i.name), ["Sword", "Mail", "Shield"]);
    assert.deepEqual(itemChoices(vera, "service", null, { serviceKind: "unaffix" }).map((i) => i.name), ["Talisman"]);
});

test("the Workshop builds the Codex only while the Formulas tab is shown", async () => {
    const { WorkshopApp } = await import("../../scripts/ui/workshop.mjs");
    const app = new WorkshopApp();
    app.actingActor = () => vera;
    const context = { readable: true, tabs: {} };
    assert.deepEqual(await app._preparePartContext("formulas", { ...context }, {}), { ...context, tab: null, formulasPending: true });
    app.tabGroups.primary = "formulas";
    assert.equal((await app._preparePartContext("formulas", { ...context }, {})).codex.actor.name, "Vera");
});

test("every M5 label is a key in lang/en.json", () => {
    const keys = [
        ...Object.values(labels.ACQUIRE_ROUTE), ...Object.values(labels.PROVENANCE).map((p) => p.key), ...Object.values(labels.CRAFT_TYPE),
        ...Object.values(labels.SERVICE), ...Object.values(labels.SERVICE_STATUS).map((s) => s.key), ...Object.values(labels.PLEDGE_STATUS),
        ...Object.values(labels.PURPOSE), ...Object.values(labels.GATE), ...Object.values(labels.REFUSAL), ...Object.values(labels.ROW_KIND),
        ...Object.values(labels.REQUIREMENT), ...Object.values(labels.DELIVERY),
    ];
    assert.deepEqual(keys.filter((key) => !(key in lang)), []);
});

test("the Formulas tab's controls are found again after a re-render: the search field by its name, each button by its op (10.9)", () => {
    const template = readFileSync(join(ROOT, "templates/workshop/formulas.hbs"), "utf8");
    /** A fake element from a tag's attributes in the template, as `focus.mjs` reads it. */
    const element = (tag) => {
        const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"{]*)"/g)].map(([, k, v]) => [k, v]));
        const dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-"))
            .map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()), v]));
        return { tagName: tag.slice(1).split(/\s/)[0].toUpperCase(), id: attrs.id ?? "", dataset, getAttribute: (k) => attrs[k] ?? null, closest: () => null };
    };
    const search = template.match(/<input type="search"[^>]*>/)[0];
    assert.equal(focusSelector(element(search)), 'input[name="codexSearch"]', "typing on after the debounced re-render keeps the field");
    const buttons = [...template.matchAll(/<button[^>]*data-action="formula"[^>]*>/g)].map(([tag]) => tag);
    assert.ok(buttons.length >= 10);
    for (const tag of buttons) assert.match(focusSelector(element(tag)) ?? "", /\[data-op="[\w-]+"\]/, tag);
    const selectors = new Set(buttons.filter((tag) => !/data-op="(select|ask)"/.test(tag)).map((tag) => focusSelector(element(tag))));
    assert.ok(selectors.has('button[data-action="formula"][data-op="buy"]') && selectors.has('button[data-action="formula"][data-op="grant"]'),
        "each route's button is its own control, not the first formula button in the part");
});

test("G8's precious-material failure says what is wrong, with its amounts: the share of stock needed and what the order has (6.5, 6.6)", async () => {
    const { orderPrecious } = await import("../../scripts/logic/materials.mjs");
    const { gateMaterials } = await import("../../scripts/logic/gates.mjs");
    CONFIG.PF2E.preciousMaterials = { adamantine: "PF2E.PreciousMaterialAdamantine" };
    lang["PF2E.PreciousMaterialAdamantine"] = "Adamantine";
    lang["PF2E.ProficiencyLevel3"] = "Master";
    const precious = orderPrecious({ product: { level: 11, magical: false, material: { type: "adamantine", grade: "standard" } }, crafter: { level: 12, rank: RANK.expert },
        order: { materials: { a: { id: "a", material: "adamantine", valueCp: 10000 } } }, upfrontCp: 200000, coinCp: 200000 });
    const text = gateText(gateMaterials(210000, 200000, precious));
    assert.match(text, /500 gp of the materials up front must be Adamantine stock; the order has 100 gp \(only stock counts\)/);
    assert.match(text, /needs .+ in Crafting/, "the standard grade's rank is told too");
    assert.doesNotMatch(text, /not ready/);
});

/* -------------------------------------------- */
/*  M5 on M4.1                                   */
/* -------------------------------------------- */

test("Buy asks where the formula's price is paid from, as Fund this order asks: the price said, the party fund or a purse (M5 on M4.1)", async () => {
    const app = fakeApp();
    await onFormulaOp(app, { closest: () => ({ dataset: { op: "select", uuid: STRIKING } }) });
    const { codex } = await formulasContext(app);
    assert.equal(codex.learn.selected.routes.find((r) => r.route === "buy").costCp, 500, "the button carries the price");
    const rendered = [];
    world.render = (path, data) => { rendered.push({ path, data }); return ""; };
    let asked = null;
    foundry.applications.api.DialogV2.prompt = async (config) => { asked = config; return null; };
    try {
        const result = await onFormulaOp(app, { closest: () => ({ dataset: { op: "buy", cost: "500" } }) });
        assert.equal(result, null, "closed: nothing bought");
    } finally {
        world.render = null;
    }
    const data = rendered.find((r) => r.path.endsWith("prompts/amount.hbs")).data;
    assert.equal(asked.window.title, "pf2e-artisans-workshop.Prompt.Purchase.Title");
    assert.equal(data.fixed, "Price: 5 gp");
    assert.equal(data.intro, "The formula for Striking costs 5 gp.");
    assert.deepEqual(data.coins.map((c) => [c.denomination, c.value, c.autofocus]), [["pp", "", false], ["gp", "5", false], ["sp", "", false], ["cp", "", false]],
        "the price rides in hidden fields; there is nothing to type");
    assert.deepEqual(data.sources.map((x) => [x.value, x.checked, x.disabled]), [["fund", false, true], ["purse", true, false]],
        "nothing unallocated: Vera's purse");
    assert.equal(data.sources.find((x) => x.value === "purse").label, "Vera's purse", "paying takes the coins out of the purse, not into the strongbox");
    assert.match(readFileSync(join(ROOT, "templates/prompts/amount.hbs"), "utf8"), /\{\{#if fixed\}\}[\s\S]*type="hidden" name="\{\{denomination\}\}"/);
});

test("a price the party fund cannot cover keeps the button off and points at a purse (M5 on M4.1)", async () => {
    const { wireAmountForm } = await import("../../scripts/ui/prompts.mjs");
    lang["PF2E.CurrencyAbbreviations.gp"] = "gp";
    lang["PF2E.CurrencyAbbreviations.sp"] = "sp";
    const inputs = { pp: { value: "" }, gp: { value: "3" }, sp: { value: "" }, cp: { value: "" } };
    const listeners = {};
    const problem = { textContent: "" };
    const confirm = { disabled: false };
    const box = { querySelector: (sel) => ({ ".amount-problem": problem })[sel] ?? null, addEventListener: (type, fn) => { listeners[type] = fn; } };
    const form = { elements: { namedItem: (name) => inputs[name] ?? null }, querySelector: () => null };
    const root = { querySelector: (sel) => ({ form, ".pf2e-artisans-workshop-amount": box, "button[data-action='ok']": confirm })[sel] ?? null };
    wireAmountForm(root, () => ({ minCp: 300, maxCp: 300, fundCp: 50 }));
    assert.equal(confirm.disabled, true);
    assert.equal(problem.textContent, "The party fund has only 5 sp unallocated and 3 gp is needed: take it from a purse.");
    wireAmountForm(root, () => ({ minCp: 300, maxCp: 300, fundCp: null }));
    assert.deepEqual([confirm.disabled, problem.textContent], [false, ""], "from a purse the price is fine");
    wireAmountForm(root, () => ({ minCp: null, maxCp: null, fundCp: null, optional: true }));
    inputs.gp.value = "";
    listeners.input();
    assert.deepEqual([confirm.disabled, problem.textContent], [false, ""], "a spell with no cost: nothing typed is fine");
});

test("requirements have a plain name for each kind of order (M5 on M4.1)", async () => {
    const { requirementName } = await import("../../scripts/ui/format.mjs");
    assert.equal(requirementName({ id: "G9", variant: "spells" }), "Spells cast for it");
    assert.equal(requirementName({ id: "G10", variant: "target" }), "Item to work on with the crafter");
    assert.equal(requirementName({ id: "G12", variant: "rune" }), "A rune this item can take");
    assert.equal(requirementName({ id: "G9", variant: null }), "Craft Requirements confirmed", "a plain Craft's G9");
    assert.equal(requirementName({ id: "G10", variant: "unknown" }), lang["pf2e-artisans-workshop.Requirement.G10"]);
    const queue = readFileSync(join(ROOT, "templates/workshop/queue.hbs"), "utf8");
    for (const action of ["stock", "castings", "hand-over"]) assert.match(queue, new RegExp(`\\(eq action "${action}"\\)`), `the ${action} fix is offered`);
    assert.match(queue, /data-fix="requirement"/, "the fix buttons are told from the same buttons below them (10.9)");
});

test("a finished formula job and an in-place etching say where they went, never that they are on their way (M5 on M4.1 review fix)", async () => {
    const { decorate } = await import("../../scripts/ui/context.mjs");
    const { orderView } = await import("../../scripts/logic/views.mjs");
    const { makeRow } = await import("../../scripts/logic/rows.mjs");
    const stamp = { by: "p1", at: { real: 1 } };
    const viewer = { userId: "p1", isGM: false, owns: () => true, hasCharacter: true };
    const nameOf = (uuid) => fromUuidSync(uuid)?.name ?? null;
    const job = { ...makeOrder({ id: "o1", requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid, productType: "formula",
        route: "reverse-engineer", product: { uuid: "U", snapshot: { name: "Elixir", priceCp: 300, per: 1 } }, quantity: 1 }, stamp), status: "complete" };
    const book = decorate(orderView(job, { viewer, nameOf }), job);
    assert.deepEqual([book.deliveryState, book.deliveryText, book.canCollect], ["book", "The formula goes into Vera's formula book.", false]);
    const etch = { ...makeOrder({ id: "o2", requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid, craftType: "rune-etch",
        target: `${vera.uuid}.Item.s`, product: { uuid: "U", snapshot: { name: "Striking", priceCp: 6500, per: 1 } }, quantity: 1 }, stamp), status: "complete" };
    const shelved = { ...makeRow({ kind: "shelved", idem: "shelve:o2:1", cp: 0, order: "o2", actor: vera.uuid,
        items: [{ uuid: "U", name: "Longsword", qty: 1, inPlace: true }] }, stamp), state: "applied" };
    const inPlace = decorate(orderView(etch, { rows: [shelved], viewer, nameOf }), etch);
    assert.deepEqual([inPlace.deliveryState, inPlace.deliveryText], ["in-place", "Changed where it is, in Vera's inventory."]);
    assert.equal(lang[labels.ROW_KIND["in-place"]], "Changed in place");
});
