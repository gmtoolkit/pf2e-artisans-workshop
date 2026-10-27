/**
 * M9a over the fake world (DESIGN.md 6.16, 14.4): every Treasure Vault (Remastered) variant is off by default and costs
 * nothing then; the one-group notice; Complex Crafting's Table 5-1 setup, rush, "Set up now", rushed finishing and its flat
 * check; crafting events rolled once per key and pausing the order; Critical Crafting's record, replace mode, curse and
 * secret rolls; Deconstruct into components, its follow-on credit, damage and loss, and the components on a later order;
 * Grow with Nature, its tools and its season check; a garden funded, planted once and harvested once a day; a bestowed gift
 * dormant on anyone but its heirs; a quest gathered, assembled or not; an item crafted with its adjustments and delivered
 * with its host remapped.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MOD, addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { RANK } = await import("../../scripts/logic/core.mjs");
const { DEFAULT_RULES } = await import("../../scripts/logic/defaults.mjs");
const { itemOptions } = await import("../../scripts/logic/registry.mjs");
const { orderLink } = await import("../../scripts/logic/rolls.mjs");
const { setupDaysDone, reductionCp } = await import("../../scripts/logic/progress.mjs");
const { materialsCp } = await import("../../scripts/logic/materials.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { handOver } = await import("../../scripts/foundry/custody.mjs");
const deconstruct = await import("../../scripts/foundry/deconstruct.mjs");
const { registerExpiryHooks } = await import("../../scripts/foundry/expiry.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const nature = await import("../../scripts/foundry/nature.mjs");
const orders = await import("../../scripts/foundry/orders.mjs");
const { crafterFacts, gatesFor, planFor, productFacts, resetProducts, skillFor } = await import("../../scripts/foundry/products.mjs");
const quests = await import("../../scripts/foundry/quests.mjs");
const rolls = await import("../../scripts/foundry/rolls.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, write } = await import("../../scripts/foundry/store.mjs");
const variants = await import("../../scripts/foundry/variants.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

/** A deep merge, as core's `mergeObject` merges (the stub's is shallow). */
function deepMerge(target, source) {
    const out = structuredClone(target ?? {});
    for (const [key, value] of Object.entries(source ?? {})) {
        out[key] = value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])
            ? deepMerge(out[key], value) : structuredClone(value);
    }
    return out;
}
foundry.utils.mergeObject = (a, b) => deepMerge(a, b);
let nextRandom = 0;
foundry.utils.randomID = () => `rnd${String(nextRandom++).padStart(13, "0")}`;

/** The d20s the next `Roll`s give (a flat check, an event), and the messages posted with them. */
const dice = [];
const posted = [];
globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() { this.total = dice.shift() ?? 10; return this; }
    async toMessage(data) { posted.push(data); return data; }
};

const C = (id) => `Compendium.pf2e.equipment-srd.Item.${id}`;
const RING = C("ringofwarding0000");
const BOOTS = C("bootsofbounding00");
const ELIXIR = C("elixiroflife00000");
const ARMOR = C("breastplate000000");
const LATCHES = C("armorlatches00000");
const SIPHON = C("weaponsiphon00000");
const LEAF = C("leafweave00000000");
const SOURCES = {
    [RING]: { name: "Ring of Warding", type: "equipment", system: { slug: "ring-of-warding", level: { value: 4 }, price: { value: { gp: 100 } },
        traits: { value: ["invested", "magical"], rarity: "common" }, quantity: 1, description: { value: "<p>Ring.</p>" } } },
    [BOOTS]: { name: "Boots of Bounding", type: "equipment", system: { slug: "boots-of-bounding", level: { value: 5 }, price: { value: { gp: 160 } },
        traits: { value: ["invested", "magical"], rarity: "common" }, quantity: 1, description: { value: "<p>Boots.</p>" } } },
    [ELIXIR]: { name: "Elixir of Life (Minor)", type: "consumable", system: { slug: "elixir-of-life-minor", level: { value: 1 }, price: { value: { gp: 3 } },
        traits: { value: ["alchemical", "consumable", "elixir", "healing"], rarity: "common" }, quantity: 1, description: { value: "<p>Elixir.</p>" } } },
    [ARMOR]: { name: "Breastplate", type: "armor", system: { slug: "breastplate", level: { value: 2 }, price: { value: { gp: 30 } }, category: "medium",
        traits: { value: [], rarity: "common" }, quantity: 1, description: { value: "<p>Armor.</p>" } } },
    [LATCHES]: { name: "Armor Latches", type: "equipment", system: { slug: "armor-latches", level: { value: 1 }, price: { value: { gp: 4 } },
        traits: { value: ["adjustment"], rarity: "common" }, usage: { value: "applied-to-armor" }, quantity: 1, description: { value: "<p>Latches.</p>" } } },
    [SIPHON]: { name: "Weapon Siphon", type: "equipment", system: { slug: "weapon-siphon", level: { value: 1 }, price: { value: { gp: 10 } },
        traits: { value: ["adjustment", "alchemical"], rarity: "common" }, usage: { value: "attached-to-melee-weapon" }, quantity: 1, description: { value: "<p>.</p>" } } },
    [LEAF]: { name: "Leaf Weave", type: "armor", system: { slug: "leaf-weave", level: { value: 0 }, price: { value: { gp: 4 } }, category: "light",
        traits: { value: [], rarity: "common" }, quantity: 1, description: { value: "<p>Leaves.</p>" } } },
};

/** pf2e's prepared, unsaved item, as far as the module reads it. */
CONFIG.Item = {
    documentClass: class {
        constructor(source) {
            const s = source.system ?? {};
            Object.assign(this, {
                name: source.name, img: "i.webp", type: source.type, system: s, slug: s.slug ?? null, level: s.level?.value ?? 0,
                rarity: s.traits?.rarity ?? "common", traits: new Set(s.traits?.value ?? []), category: s.category ?? null,
                price: { value: { copperValue: (s.price?.value?.gp ?? 0) * 100 }, per: s.price?.per ?? 1 }, isSpecific: false,
            });
        }
        getRollOptions() {
            return [...itemOptions({ type: this.type, slug: this.slug, traits: [...this.traits], rarity: this.rarity, level: this.level, category: this.category })];
        }
    },
};
CONFIG.PF2E = { spellcastingItems: {}, magicTraditions: {} };
game.pf2e = { settings: { variants: { pwol: { enabled: false } } }, Modifier: class {} };

/** Items behave as pf2e's do where the module reads them: physical or not, their Price, level, traits and rarity. */
const PHYSICAL = ["weapon", "armor", "shield", "equipment", "consumable", "treasure", "backpack"];
function teach(item) {
    const proto = Object.getPrototypeOf(item);
    if (proto.isOfType) return;
    Object.defineProperty(proto, "isOfType", { value(...types) { return types.some((t) => t === this.type || (t === "physical" && PHYSICAL.includes(this.type))); } });
    Object.defineProperty(proto, "price", { get() { return { value: { copperValue: (this.system?.price?.value?.gp ?? 0) * 100 }, per: 1 }; } });
    Object.defineProperty(proto, "level", { get() { return this.system?.level?.value ?? 0; } });
    Object.defineProperty(proto, "traits", { get() { return new Set(this.system?.traits?.value ?? []); } });
    Object.defineProperty(proto, "rarity", { get() { return this.system?.traits?.rarity ?? "common"; } });
}

let docs;
let vera;
let bo;
/** The last arguments a statistic rolled with. */
let rolled = null;
const statistic = (slug, rank, proficiency = 0) => ({ slug, rank, label: slug, modifiers: [{ slug: "proficiency", modifier: proficiency }],
    roll: async (args) => { rolled = args; return { total: 20, degreeOfSuccess: 2 }; } });
const feat = (key) => ({ type: "feat", name: key, sourceId: REGISTRY[key].uuid, system: { level: { taken: 1 } } });
const tool = (key, name) => ({ type: "equipment", name, sourceId: REGISTRY[key].uuid });

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    orders.resetOrders();
    resetProducts();
    nature.resetNature();
    variants.resetVariants();
    nextRandom = 0;
    dice.length = 0;
    posted.length = 0;
    rolled = null;
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 2000), feat("magical-crafting"), feat("alchemical-crafting"),
        feat("quick-setup"), tool("artisans-toolkit", "Artisan's Toolkit"), tool("alchemists-lab", "Alchemist's Lab")] });
    Object.assign(vera, { level: 7, skills: { crafting: statistic("crafting", RANK.master, 13), nature: statistic("nature", RANK.trained, 9) },
        system: { crafting: { formulas: [RING, BOOTS, ELIXIR, LEAF, ARMOR, LATCHES].map((uuid) => ({ uuid })) } } });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 500)] });
    Object.assign(bo, { level: 5, skills: { crafting: statistic("crafting", RANK.trained, 7) }, system: { crafting: { formulas: [] } } });
    teach(vera.items.contents[0]);
    Object.getPrototypeOf(bo).deleteEmbeddedDocuments ??= async function (_name, ids) {
        return ids.map((id) => {
            const item = this.items.get(id);
            this.items.delete(id);
            return item;
        });
    };
    world.compendium = Object.fromEntries(Object.entries(SOURCES).map(([uuid, source]) => [uuid, {
        uuid, name: source.name, isOfType: (t) => t === "physical", toObject: () => structuredClone(source) }]));
    // fromUuidSync reads names (an adjustment's, a garden's product): the same compendium entries.
    for (const [uuid, entry] of Object.entries(world.compendium)) world.uuids.set(uuid, Object.assign(entry, { type: SOURCES[uuid].type, system: SOURCES[uuid].system }));
    world.collections.Actor.party = { id: "party", members: [vera, bo] };
    ChatMessage.implementation.getSpeaker = () => ({});
    ChatMessage.implementation.create = async (data) => posted.push(data) && data;
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
    // The hooks the module registers at `init` (the world's reset clears them): the inert guard, and the variants' sweeps.
    registerExpiryHooks();
    nature.registerNatureHooks();
    quests.registerQuestHooks();
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

/** Switch to a user's client, with its lease. */
function as(user) {
    world.currentUser = user;
    resetLease();
    requestLease(user);
}

/** Turn variants on (`variants.<key>` settings). */
async function turnOn(...keys) {
    for (const key of keys) await game.settings.set(MOD, `variants.${key}`, true);
}

/** The gates that fail for an order, as `[id, reason]`. */
const failing = async (id, crafter = vera) => (await gatesFor(read(`orders.${id}`), crafterFacts(crafter), await productFacts(read(`orders.${id}.product.uuid`)),
    records("rows").filter((r) => r.order === id), settings.rulesFromSettings())).gates.filter((g) => !g.ok).map((g) => [g.id, g.reason]);

/** Record a check on an order in `check`, as the roll wrapper would, at `degree` with a d20 of `die`. */
async function recordCheck(id, degree, die = 10) {
    const order = read(`orders.${id}`);
    await write({ replace: { [`orders.${id}.check`]: { degree, die, level: 7, rank: RANK.master, attempt: order.attempt, messageId: `m-${id}-${order.attempt}`, settled: false } },
        set: { [`orders.${id}.status`]: "rolled" } });
}

/** Work an order through its setup to its check, as its crafter's owner. */
async function toCheck(id) {
    for (let i = 0; i < 6 && read(`orders.${id}.status`) === "setup"; i++) assert.equal((await orders.workDay(id)).ok, true);
    assert.equal(read(`orders.${id}.status`), "check");
}

/** Log days ahead of the clock, so the workshop day moves. */
const logDays = (toDay) => write({ set: { [`meta.manual.run${toDay}`]: { fromDay: 1, toDay, by: "p1" } } });

/** File and start an order of `uuid` by Vera, funded from her purse. */
async function started(uuid, { quantity = 1, craftType = null, variant = {}, fund = true } = {}) {
    const filed = await orders.requestOrder({ uuid, quantity, requester: vera.uuid, crafter: vera.uuid, craftType, variant });
    assert.equal(filed.ok, true, JSON.stringify(filed));
    const [id] = filed.orders;
    if (fund) assert.equal((await orders.pledgeTo(id, vera.uuid, 20000)).outcome, "ok");
    const result = await orders.start(id);
    assert.equal(result.ok, true, JSON.stringify(result));
    return id;
}

/* -------------------------------------------- */
/*  Off by default, and one group at a time      */
/* -------------------------------------------- */

test("every variant setting of 14.4 is registered, off by default, and costs nothing while off", async () => {
    const keys = ["variants.complexCrafting", "variants.complex.rushCritFail", "variants.adjustments", "variants.events", "variants.events.firstDay",
        "variants.events.everyDays", "variants.events.table", "variants.events.pauses", "variants.criticalCrafting", "variants.critical.trigger",
        "variants.critical.specialOnly", "variants.critical.mode", "variants.critical.secret", "variants.deconstruct", "variants.deconstruct.expiryDays",
        "variants.grow", "variants.natureCrafting.skills", "variants.natureCrafting.seasonDays", "variants.gardens", "variants.gifts", "variants.quests",
        "variants.quests.critFail"];
    for (const key of keys) assert.ok(world.settingConfigs.has(`${MOD}.${key}`), key);
    const values = Object.fromEntries(keys.map((key) => [key, game.settings.get(MOD, key)]));
    assert.deepEqual(values, {
        "variants.complexCrafting": false, "variants.complex.rushCritFail": "ruined", "variants.adjustments": false, "variants.events": false,
        "variants.events.firstDay": 7, "variants.events.everyDays": 91, "variants.events.table": "", "variants.events.pauses": false,
        "variants.criticalCrafting": false, "variants.critical.trigger": "natural", "variants.critical.specialOnly": true, "variants.critical.mode": "alongside",
        "variants.critical.secret": false, "variants.deconstruct": false, "variants.deconstruct.expiryDays": 0, "variants.grow": false,
        "variants.natureCrafting.skills": "crafting", "variants.natureCrafting.seasonDays": 91, "variants.gardens": false, "variants.gifts": false,
        "variants.quests": false, "variants.quests.critFail": "destroyed",
    });
    assert.deepEqual(settings.rulesFromSettings().variants, DEFAULT_RULES.variants);
    // Off: the variant kinds are refused, the variant fields of a request are dropped, and nothing is written.
    for (const craftType of ["deconstruct", "grow", "quest"]) {
        assert.equal((await orders.requestOrder({ uuid: RING, requester: vera.uuid, craftType, target: RING })).reason, "variant-off", craftType);
    }
    const filed = await orders.requestOrder({ uuid: ARMOR, requester: vera.uuid, variant: { adjustments: [LATCHES], special: true, bestow: { giver: "x" } } });
    assert.deepEqual(read(`orders.${filed.orders[0]}.variant`), {});
    const before = world.calls.length;
    assert.deepEqual(await variants.variantSweep(), { events: 0, seasons: 0, gardens: 0, quests: 0 });
    assert.equal(await variants.eventSweep(), 0);
    assert.equal(world.calls.length, before, "no write at all");
    assert.equal((await variants.chooseRush(filed.orders[0], 1)).reason, "variant-off");
    assert.equal((await nature.addGarden({ uuid: ELIXIR })).reason, "variant-off");
    // The plan is the plain Craft's: 1 day with the formula.
    const plan = await planFor(read(`orders.${filed.orders[0]}`), crafterFacts(vera), await productFacts(ARMOR), settings.rulesFromSettings());
    assert.deepEqual([plan.setup, plan.priceCp], [{ days: 1, hours: 0 }, 3000]);
});

test("while every variant is off, a ledger change or a clock move schedules no catch-up", async () => {
    variants.registerVariantHooks();
    const realSetTimeout = globalThis.setTimeout;
    let scheduled = 0;
    const fire = () => {
        globalThis.setTimeout = () => {
            if (new Error().stack.includes("scheduleVariantSweep")) scheduled += 1;
            return realSetTimeout(() => {}, 0);
        };
        try {
            Hooks.callAll("updateJournalEntry", docs.ledger, { flags: { [MOD]: { orders: {} } } });
            Hooks.callAll("updateWorldTime", 100, 100);
        } finally {
            globalThis.setTimeout = realSetTimeout;
        }
    };
    fire();
    assert.equal(scheduled, 0, "the settings' defaults (Critical Crafting's special-only is on) are not a variant");
    await turnOn("gifts");
    fire();
    assert.equal(scheduled, 2);
});

test("one group at a time: whoever turns on a second group is told; Settings shows the notice; nothing is blocked", async () => {
    await turnOn("complexCrafting", "events");
    assert.equal(world.notes.some(([, message]) => message === "pf2e-artisans-workshop.Settings.Variants.Mixed"), false, "one group");
    assert.equal(variants.groupNotice(), null);
    await turnOn("gardens");
    assert.ok(world.notes.some(([level, message]) => level === "warn" && message === "pf2e-artisans-workshop.Settings.Variants.Mixed"));
    assert.match(variants.groupNotice(), /Variants\.Notice/);
    const section = { children: [], prepend(node) { this.children.unshift(node); }, querySelector: () => null };
    const root = { querySelector: (selector) => (selector === `[data-category="${MOD}"]` ? section : null), ownerDocument: { createElement: () => ({}) } };
    variants.onRenderSettings({}, root);
    assert.equal(section.children.length, 1);
    assert.match(section.children[0].className, /warning/);
    // Another user's change is not this user's to be told about.
    world.notes.length = 0;
    world.currentUser = "p2";
    await game.settings.set(MOD, "variants.quests", true);
    world.currentUser = "p1";
    const config = world.settingConfigs.get(`${MOD}.variants.quests`);
    await config.onChange(true, {}, "p2");
    assert.equal(world.notes.filter(([, message]) => message === "pf2e-artisans-workshop.Settings.Variants.Mixed").length, 1, "only the changer's own client");
});

/* -------------------------------------------- */
/*  Complex Crafting (6.16.1)                    */
/* -------------------------------------------- */

test("Complex Crafting: Table 5-1, a rush chosen and frozen at start with its DC, Quick Setup's hours and Set up now", async () => {
    await turnOn("complexCrafting");
    // A 4th-level permanent item for a 7th-level crafter with its formula: 2 days, less 1 for the formula.
    const filedRing = await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid });
    assert.equal(filedRing.ok, true, JSON.stringify(filedRing));
    const ring = filedRing.orders[0];
    const plan = await planFor(read(`orders.${ring}`), crafterFacts(vera), await productFacts(RING), settings.rulesFromSettings());
    assert.deepEqual([plan.setup, plan.dc.adjust], [{ days: 1, hours: 0, complex: { rush: 0, band: 2, quick: false } }, 0]);
    // Elixirs 6 levels below a master with Quick Setup: 1 day, rushed to 2 hours.
    const filed = await orders.requestOrder({ uuid: ELIXIR, quantity: 4, requester: vera.uuid, crafter: vera.uuid });
    const [id] = filed.orders;
    assert.equal((await variants.chooseRush(id, 1)).ok, true);
    as("p2");
    assert.equal((await variants.chooseRush(id, 1)).reason, "not-owner", "the crafter's choice");
    as("p1");
    assert.equal((await orders.pledgeTo(id, vera.uuid, 1000)).outcome, "ok");
    assert.equal((await orders.start(id)).ok, true);
    const order = read(`orders.${id}`);
    assert.deepEqual([order.setup, order.variant.complex, order.dc.adjust], [{ days: 0, hours: 2 }, { rush: 1, band: 2, quick: true }, 5]);
    assert.equal((await variants.chooseRush(id, 0)).reason, "state", "frozen at start");
    // No downtime day sets it up: the planner stops, and "Set up now" records the hours as a variant record.
    assert.equal((await orders.workDay(id)).ok, false);
    const done = await variants.setUpNow(id);
    assert.equal(done.ok, true, JSON.stringify(done));
    const record = records("days").find((d) => d.order === id && d.kind === "setup-hours");
    assert.deepEqual([record.id, record.hours, read(`orders.${id}.status`)], [`${vera.id}-${done.day}-${id}`, 2, "check"]);
    assert.equal((await variants.setUpNow(id)).reason, "state", "once");
});

test("rushed finishing: doubled days while the crafter rushes, then the flat check: a quirk on a failure, nothing on a critical failure", async () => {
    await turnOn("complexCrafting");
    vera.skills.crafting.modifiers = [{ slug: "proficiency", modifier: 4 }];   // DC 10 + 4 - 4 = 10
    const run = async (die) => {
        const id = await started(RING);
        await toCheck(id);
        await recordCheck(id, 2);
        assert.equal((await orders.workDay(id)).ok, true);
        assert.equal(read(`orders.${id}.status`), "finishing");
        assert.equal((await variants.setRushFinish(id, true)).ok, true);
        const day = await orders.workDay(id);
        const rushedDay = records("days").find((d) => d.order === id && d.day === day.day);
        assert.deepEqual([rushedDay.rushed, rushedDay.crafterCp], [true, 2 * 250], "master, 7th level: twice 2 gp 5 sp");
        dice.push(die);
        const finished = await orders.finish(id);
        assert.equal(finished.ok, true, JSON.stringify(finished));
        return id;
    };
    const quirky = await run(5);
    const flat = read(`orders.${quirky}.check.rushFlat`);
    assert.deepEqual([flat.dc, flat.die, flat.outcome], [10, 5, "quirk"]);
    const item = docs.strongbox.items.find((i) => i.flags?.[MOD]?.crafted?.order === quirky);
    assert.deepEqual(item.flags[MOD].quirk, { from: "rushed-finish", order: quirky, note: "" });
    assert.ok(posted.some((p) => /Variant\.Rush\.Flavor/.test(p.flavor ?? "")), "the flat check posted as a roll card");
    const ruined = await run(1);
    assert.equal(read(`orders.${ruined}.status`), "complete");
    assert.equal(docs.strongbox.items.find((i) => i.flags?.[MOD]?.crafted?.order === ruined), undefined, "a critical failure ruins it");
    await game.settings.set(MOD, "variants.complex.rushCritFail", "cursed");
    const cursed = await run(1);
    assert.equal(docs.strongbox.items.find((i) => i.flags?.[MOD]?.crafted?.order === cursed).flags[MOD].curse.from, "rushed-finish");
});

test("a rushed finish refused for want of money rolls its flat check once", async () => {
    await turnOn("complexCrafting");
    vera.skills.crafting.modifiers = [{ slug: "proficiency", modifier: 4 }];
    const filed = await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid });
    const [id] = filed.orders;
    assert.equal((await orders.pledgeTo(id, vera.uuid, 5000)).outcome, "ok");
    assert.equal((await orders.start(id)).ok, true);
    await toCheck(id);
    await recordCheck(id, 2);
    await orders.workDay(id);
    await variants.setRushFinish(id, true);
    await orders.workDay(id);
    dice.push(15);
    assert.equal((await orders.finish(id)).reason, "underfunded");
    dice.push(1);
    await orders.pledgeTo(id, vera.uuid, 10000);
    assert.equal((await orders.finish(id)).ok, true);
    assert.equal(read(`orders.${id}.check.rushFlat.die`), 15, "the first roll stands");
});

/* -------------------------------------------- */
/*  Crafting events (6.16.3)                     */
/* -------------------------------------------- */

test("crafting events: rolled once on the 7th day by the crafter's responsible client; with pauses, days wait until it is resolved", async () => {
    await turnOn("events");
    await game.settings.set(MOD, "variants.events.pauses", true);
    const id = await started(BOOTS);
    await toCheck(id);
    await recordCheck(id, 2);
    for (let i = 0; i < 6; i++) assert.equal((await orders.workDay(id)).ok, true, `day ${i}`);
    assert.equal(variants.variantOn("events"), true);
    // Seven days worked (one setup, six extra): the event is due, and the next day waits for it.
    assert.equal((await orders.workDay(id)).ok, false, "the order is paused until the event is rolled");
    dice.push(2);
    assert.equal(await variants.eventSweep(), 1);
    assert.equal(await variants.eventSweep(), 0, "a sweep run twice rolls nothing new");
    const event = Object.values(read(`orders.${id}.events`))[0];
    assert.deepEqual([event.k, event.roll, event.gmCore, event.status], [1, 2, true, "open"]);
    assert.ok(posted.some((p) => /Variant\.Event\.GmCore/.test(p.flavor ?? "")));
    assert.equal((await orders.workDay(id)).ok, false, "open: paused");
    as("p2");
    assert.equal((await variants.resolveEvent(id, "1-1", { note: "the shipment came" })).ok, true, "any member resolves it");
    as("p1");
    assert.equal((await orders.workDay(id)).ok, true, "resolved: the days go on");
    assert.equal(read(`orders.${id}.events.1-1.note`), "the shipment came");
});

test("an event rolled by two clients at once is recorded once (its lock)", async () => {
    await turnOn("events");
    const id = await started(BOOTS);
    dice.push(9, 14);
    const [first, second] = await Promise.all([variants.rollEvent(id, { k: 1 }), variants.rollEvent(id, { k: 1 })]);
    assert.deepEqual([first.ok, second.ok, second.reason], [true, false, "taken"], "the second stops at the event's lock page");
    assert.equal(Object.keys(read(`orders.${id}.events`)).length, 1);
});

/* -------------------------------------------- */
/*  Critical Crafting (6.16.4)                   */
/* -------------------------------------------- */

test("Critical Crafting: a special order's natural 20 is stamped at settlement; replace mode ruins nothing; the curse comes and goes", async () => {
    await turnOn("criticalCrafting");
    const filed = (await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid })).orders[0];
    assert.equal((await variants.setSpecial(filed, true)).ok, true);
    await orders.pledgeTo(filed, vera.uuid, 20000);
    await orders.start(filed);
    await toCheck(filed);
    await recordCheck(filed, 3, 20);
    assert.equal((await orders.settle(filed)).ok, true);
    const critical = read(`orders.${filed}.check.critical`);
    assert.deepEqual([critical.kind, critical.natural, critical.mode], ["success", true, "alongside"]);
    assert.equal((await variants.recordCritical(filed, { category: "durable", note: "it hums" })).ok, true);
    assert.deepEqual([read(`orders.${filed}.check.critical.category`), read(`orders.${filed}.check.critical.note`)], ["durable", "it hums"]);
    // Replace: a critical failure's story effect takes the 10% ruin's place.
    await game.settings.set(MOD, "variants.critical.mode", "replace");
    const id = (await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid, variant: { special: true } })).orders[0];
    await orders.pledgeTo(id, vera.uuid, 20000);
    await orders.start(id);
    await toCheck(id);
    await recordCheck(id, 0, 1);
    assert.equal((await orders.settle(id)).ok, true);
    assert.deepEqual(records("rows").filter((r) => r.order === id && (r.kind === "ruin" || r.kind === "release")).map((r) => [r.kind, r.cp]), [["release", 5000]]);
    assert.equal(read(`orders.${id}.check.critical.mode`), "replace");
    // The crafter's curse: a status penalty to Crafting, lifted by the next critical success at a Craft check.
    assert.equal((await variants.curseCrafter(id, 2)).ok, true);
    const curse = variants.curseEffects(vera)[0];
    assert.deepEqual(curse.system.rules[0].value, -2);
    assert.equal((await variants.curseCrafter(id, 1)).reason, "cursed");
    // A non-special order's natural 20 is not stamped under "special only".
    const plain = await started(RING);
    await toCheck(plain);
    const message = { id: "msg1", author: game.user, actor: vera, rolls: [{ total: 40, dice: [{ faces: 20, total: 20 }] }],
        flags: { pf2e: { context: { outcome: "criticalSuccess", dc: { value: 20 }, options: [orderLink(plain, read(`orders.${plain}.attempt`))] } } } };
    const recorded = await rolls.onCheckMessage(message);
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    assert.equal(variants.curseEffects(vera).length, 0, "a critical success lifts the curse");
    assert.equal((await orders.settle(plain)).ok, true);
    assert.equal(read(`orders.${plain}.check.critical`), undefined, "not special");
});

test("secret checks: rolled blind for a special order while a GM is connected, never without one", async () => {
    await turnOn("criticalCrafting");
    await game.settings.set(MOD, "variants.critical.secret", true);
    const id = (await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid, variant: { special: true } })).orders[0];
    await orders.pledgeTo(id, vera.uuid, 20000);
    await orders.start(id);
    await toCheck(id);
    CONFIG.Item.documentClass.prototype.getRollOptions ??= () => [];
    const product = world.compendium[RING];
    product.toObject = () => structuredClone(SOURCES[RING]);
    await rolls.rollCraft(id, { skipDialog: true });
    assert.equal(rolled.rollMode, "blindroll");
    world.collections.User.get("gm00000000000000").active = false;
    await rolls.rollCraft(id, { skipDialog: true });
    assert.equal(rolled.rollMode, undefined, "no GM to see it: an ordinary roll");
});

/* -------------------------------------------- */
/*  Deconstruct (6.16.5)                         */
/* -------------------------------------------- */

test("Deconstruct: a ring broken down for a similar item becomes components, and its day sets up the boots it was meant for", async () => {
    await turnOn("deconstruct");
    const ring = vera.addItem({ type: "equipment", name: "Ring of Warding", sourceId: RING, system: { ...structuredClone(SOURCES[RING].system),
        equipped: { carryType: "worn", invested: true, inSlot: false } } });
    const boots = (await orders.requestOrder({ uuid: BOOTS, requester: vera.uuid, crafter: vera.uuid })).orders[0];
    assert.equal((await deconstruct.confirmChecklist(boots, "similar")).ok, true);
    const filed = await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid, craftType: "deconstruct", target: ring.uuid,
        variant: { deconstruct: { purpose: "similar" } } });
    assert.equal(filed.ok, true, JSON.stringify(filed));
    const [id] = filed.orders;
    assert.deepEqual(read(`orders.${id}.variant.deconstruct`), { purpose: "similar", similarTo: null, damaged: false, lossPct: 0, followOn: null });
    assert.deepEqual(await failing(id), [["G9", "workshop"]]);
    assert.equal((await deconstruct.confirmChecklist(id, "workshop")).ok, true);
    assert.deepEqual(await failing(id), []);
    assert.equal((await deconstruct.chooseFollowOn(id, boots)).ok, true);
    const start = await orders.start(id);
    assert.equal(start.ok, true, JSON.stringify(start));
    assert.deepEqual([read(`orders.${id}.priceCp`), read(`orders.${id}.setup`), read(`orders.${id}.dc.final`)], [0, { days: 1, hours: 0 }, 19]);
    await toCheck(id);
    const day = records("days").find((d) => d.order === id).day;
    await recordCheck(id, 2);
    const settled = await orders.settle(id);
    assert.equal(settled.ok, true, JSON.stringify(settled));
    assert.equal(read(`orders.${id}.status`), "complete");
    const components = ring.flags[MOD].components;
    assert.deepEqual([components.valueCp, components.rawCp, components.purpose, ring.flags[MOD].inert], [7500, 5000, "similar", true]);
    assert.match(ring.name, /ComponentsName/);
    assert.equal(ring.system.equipped.invested, false, "uninvested");
    assert.ok(records("rows").every((r) => r.order !== id || ["commit", "release"].includes(r.kind)), "no money moved");
    // The boots' first setup day is the deconstruct day, for the attempt their start will open.
    const credit = records("days").find((d) => d.order === boots);
    assert.deepEqual([credit.id, credit.day, credit.attempt, credit.kind], [`${vera.id}-${day}-${boots}`, day, 1, "setup"]);
    // The components go into the boots as their materials, at the similar share once confirmed.
    const handed = await handOver({ order: boots, item: ring.uuid, purpose: "material" });
    assert.equal(handed.ok, true, JSON.stringify(handed));
    assert.equal(materialsCp(read(`orders.${boots}`)), 7500);
    const other = vera.addItem({ type: "equipment", name: "Old ring (components)", system: { quantity: 1, price: { value: { gp: 50 } } },
        flags: { [MOD]: { components: { valueCp: 100, rawCp: 50, purpose: "raw" } } } });
    assert.equal((await handOver({ order: boots, item: other.uuid, purpose: "material" })).reason, "one-components");
    assert.equal((await orders.pledgeTo(boots, vera.uuid, 500)).outcome, "ok");
    assert.equal((await orders.start(boots)).ok, true);
    const order = read(`orders.${boots}`);
    assert.equal(setupDaysDone(order, records("days").filter((d) => d.order === boots)), 1, "set up already");
    assert.deepEqual(records("rows").filter((r) => r.order === boots && r.kind === "commit").map((r) => r.cp), [500], "only the half the credit does not cover");
});

test("Deconstruct: a critical failure damages the item; a retry needs a repair or accepts the 5% loss; a raw purpose names no follow-on", async () => {
    await turnOn("deconstruct");
    const ring = vera.addItem({ type: "equipment", name: "Ring of Warding", sourceId: RING, system: structuredClone(SOURCES[RING].system) });
    const [id] = (await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid, craftType: "deconstruct", target: ring.uuid })).orders;
    assert.equal((await deconstruct.chooseFollowOn(id, null)).reason, "raw");
    await deconstruct.confirmChecklist(id, "workshop");
    await orders.start(id);
    await toCheck(id);
    await recordCheck(id, 0);
    assert.equal((await orders.settle(id)).ok, true);
    assert.deepEqual([read(`orders.${id}.status`), read(`orders.${id}.variant.deconstruct.damaged`)], ["failed", true]);
    assert.equal((await orders.retry(id)).reason, "damaged");
    assert.equal((await orders.retry(id, { acceptLoss: true })).ok, true);
    assert.deepEqual([read(`orders.${id}.variant.deconstruct.lossPct`), read(`orders.${id}.variant.deconstruct.damaged`)], [5, false]);
    await toCheck(id);
    await recordCheck(id, 2);
    await orders.settle(id);
    assert.equal(ring.flags[MOD].components.rawCp, 4750, "50% of 95 gp");
    assert.equal((await orders.requestOrder({ uuid: ELIXIR, requester: vera.uuid, crafter: vera.uuid, craftType: "deconstruct", target: "Actor.none.Item.x" })).reason,
        "no-target");
});

/* -------------------------------------------- */
/*  Grow (6.16.6)                                */
/* -------------------------------------------- */

test("Grow: Nature by setting, the formula required, the tools confirmed, 4 days; left untended, one season check per season", async () => {
    await turnOn("grow");
    await game.settings.set(MOD, "variants.natureCrafting.skills", "nature");
    await game.settings.set(MOD, "variants.natureCrafting.seasonDays", 10);
    const [id] = (await orders.requestOrder({ uuid: LEAF, requester: vera.uuid, crafter: vera.uuid, craftType: "grow" })).orders;
    assert.equal(skillFor(read(`orders.${id}`), settings.rulesFromSettings()), "nature");
    assert.deepEqual(await failing(id), [["G7", "grow-tools"], ["G8", "underfunded"]]);
    assert.ok((await failing(id, bo)).some(([gate, reason]) => gate === "G6" && reason === "needs-formula"), "no formula, no Grow");
    await deconstruct.confirmChecklist(id, "grow-tools");
    await orders.pledgeTo(id, vera.uuid, 200);
    assert.equal((await orders.start(id)).ok, true);
    const order = read(`orders.${id}`);
    assert.deepEqual([order.skill, order.setup, order.variant.grow.mode], ["nature", { days: 4, hours: 0 }, "tended"]);
    await toCheck(id);
    assert.equal(records("days").filter((d) => d.order === id).length, 4);
    await recordCheck(id, 2);
    await orders.workDay(id);
    assert.equal((await nature.setUntended(id, true)).ok, true);
    assert.deepEqual(nature.seasonChecksDue(read(`orders.${id}`)), [], "the season has not ended");
    await logDays(25);
    const due = nature.seasonChecksDue(read(`orders.${id}`));
    assert.equal(due.length, 1);
    const recorded = await nature.recordSeasonCheck({ id, season: due[0].season }, { degree: 2, messageId: "s1", rerolled: false }, vera);
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    assert.equal((await nature.recordSeasonCheck({ id, season: due[0].season }, { degree: 3, messageId: "s2", rerolled: false }, vera)).ok, false, "once a season");
    assert.deepEqual(nature.seasonChecksDue(read(`orders.${id}`)), []);
    const days = records("days").filter((d) => d.order === id);
    assert.equal(reductionCp(read(`orders.${id}`), days, settings.rulesFromSettings()) >= recorded.record.crafterCp + 5, true);
});

/* -------------------------------------------- */
/*  Gardens (6.16.7)                             */
/* -------------------------------------------- */

test("a garden: the party's limit, funded by two members, planted once, harvested once a day with produce that spoils at day's end", async () => {
    await turnOn("gardens");
    const added = await nature.addGarden({ name: "Herbs", uuid: ELIXIR });
    assert.deepEqual([added.ok, added.seedCostCp], [true, 6000], "a 1st-level elixir: the top of a 3rd-level permanent item, 60 gp");
    assert.equal((await nature.addGarden({ uuid: ELIXIR })).reason, "garden-limit", "two PCs keep one garden");
    const gardenId = added.garden;
    assert.equal((await nature.fundGarden(gardenId, { source: "purse", actor: vera.uuid, cp: 4000 })).outcome, "ok");
    assert.equal((await nature.plantGarden(gardenId)).reason, "underfunded");
    as("p2");
    assert.equal((await nature.fundGarden(gardenId, { source: "purse", actor: bo.uuid, cp: 2000 })).outcome, "ok");
    // The pledge that completes the seed cost plants it, on the client responsible for that change (Bo's own, 5.6).
    for (let i = 0; i < 5 && !Number.isInteger(read(`gardens.${gardenId}.plantedDay`)); i++) await new Promise((resolve) => setTimeout(resolve, 0));
    as("p1");
    const again = await Promise.all([nature.plantGarden(gardenId), nature.plantGarden(gardenId)]);
    assert.deepEqual(again.map((r) => r.outcome), ["already", "already"]);
    const plants = records("rows").filter((r) => r.kind === "plant");
    assert.deepEqual(plants.map((r) => r.cp).sort((a, b) => a - b), [2000, 4000], "pro rata, once");
    assert.equal(Number.isInteger(read(`gardens.${gardenId}.plantedDay`)), true);
    const harvested = await nature.harvest(gardenId, vera.uuid);
    assert.equal(harvested.ok, true, JSON.stringify(harvested));
    const produce = vera.items.find((i) => i.flags?.[MOD]?.produce);
    assert.deepEqual([produce.system.temporary, produce.flags[MOD].expiry.rule, produce.flags[MOD].expiry.atDay], [true, "world", harvested.day + 1]);
    as("p2");
    assert.equal((await nature.harvest(gardenId, bo.uuid)).reason, "harvested", "one a day");
    await logDays(harvested.day + 1);
    assert.equal((await nature.harvest(gardenId, bo.uuid)).ok, true, "the next day's");
});

/* -------------------------------------------- */
/*  Bestowed gifts (6.16.8)                      */
/* -------------------------------------------- */

test("a bestowed gift is dormant in anyone's hands but its recipient's or an heir's", async () => {
    await turnOn("gifts");
    const cloak = bo.addItem({ type: "equipment", name: "Autumn's Cloak", system: { price: { value: { gp: 200 } }, quantity: 1 } });
    as("p2");
    assert.equal((await variants.bestow(cloak.uuid, { giver: "the faerie queen" })).ok, true);
    assert.deepEqual([cloak.flags[MOD].gift.bound, cloak.flags[MOD].gift.giver], [bo.uuid, "the faerie queen"]);
    assert.equal(variants.isDormantGift(cloak), false);
    const borrowed = vera.addItem({ type: "equipment", name: "Autumn's Cloak", system: { quantity: 1 }, flags: { [MOD]: { gift: structuredClone(cloak.flags[MOD].gift) } } });
    assert.equal(variants.isDormantGift(borrowed), true);
    const message = { flags: { pf2e: { origin: { uuid: borrowed.uuid } } } };
    assert.equal(Hooks.call("preCreateChatMessage", message), false, "its use is cancelled");
    assert.ok(world.notes.some(([, key]) => key === "pf2e-artisans-workshop.Variant.Gift.Dormant"));
    assert.equal((await variants.nameHeir(cloak.uuid, vera.uuid)).ok, true);
    borrowed.flags[MOD].gift = structuredClone(cloak.flags[MOD].gift);
    assert.equal(variants.isDormantGift(borrowed), false, "an heir holds it");
    assert.deepEqual(variants.partyGifts().map((g) => [g.holder.name, g.dormant, g.priceCp]), [["Vera", false, 0], ["Bo", false, 20000]]);
});

/* -------------------------------------------- */
/*  Crafting quests (6.16.9)                     */
/* -------------------------------------------- */

test("a quest: gathered by any member, then delivered once every component is found (three encounters apart: no assembly check)", async () => {
    await turnOn("quests");
    const filed = await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid, craftType: "quest", variant: { quest: { encounters: 3 } } });
    const [id] = filed.orders;
    assert.equal(read(`orders.${id}.variant.quest.assemblyCheck`), false);
    assert.equal((await orders.start(id)).ok, true);
    assert.deepEqual([read(`orders.${id}.status`), read(`orders.${id}.priceCp`), records("rows").filter((r) => r.order === id).length], ["gathering", 0, 0]);
    assert.equal(downtimeActivity(vera), null, "a quest is no downtime activity");
    assert.equal((await quests.markFound(id, "c1")).ok, true);
    as("p2");
    assert.equal((await quests.markFound(id, "c2")).ok, true, "any member");
    assert.equal((await quests.markFound(id, "c2")).reason, "found");
    as("p1");
    assert.equal(await quests.questSweep(), 0, "one still to find");
    await quests.markFound(id, "c3");
    assert.equal(await quests.questSweep(), 1);
    assert.equal(await quests.questSweep(), 0, "once");
    assert.equal(read(`orders.${id}.status`), "complete");
    assert.ok(docs.strongbox.items.some((i) => i.flags?.[MOD]?.crafted?.order === id), "on the pickup shelf");
});

test("a quest's assembly: a failure delivers it with a quirk; a critical failure destroys it (or curses it, by setting)", async () => {
    await turnOn("quests");
    const make = async () => {
        const [id] = (await orders.requestOrder({ uuid: RING, requester: vera.uuid, crafter: vera.uuid, craftType: "quest", variant: { quest: { encounters: 1 } } })).orders;
        await orders.start(id);
        await quests.markFound(id, "c1");
        assert.deepEqual(await quests.advanceQuest(id), { ok: true, status: "check" });
        return id;
    };
    const quirky = await make();
    await recordCheck(quirky, 1);
    assert.equal((await orders.settle(quirky)).ok, true);
    assert.equal(read(`orders.${quirky}.status`), "complete");
    assert.equal(docs.strongbox.items.find((i) => i.flags?.[MOD]?.crafted?.order === quirky).flags[MOD].quirk.from, "quest-assembly");
    const lost = await make();
    await recordCheck(lost, 0);
    await orders.settle(lost);
    assert.equal(read(`orders.${lost}.status`), "failed");
    assert.equal((await orders.retry(lost)).reason, "state", "a destroyed quest is over");
});

/** A character's downtime activity, or null. */
const downtimeActivity = (actor) => read(`pcs.${actor.id}.activity`) ?? null;

/* -------------------------------------------- */
/*  Adjustments (6.16.2)                         */
/* -------------------------------------------- */

test("an item with its adjustments: one Price, the highest level; made together and delivered with the host remapped", async () => {
    await turnOn("adjustments");
    const filed = await orders.requestOrder({ uuid: ARMOR, requester: bo.uuid === null ? null : vera.uuid, recipient: { kind: "actor", uuid: bo.uuid }, crafter: vera.uuid,
        variant: { adjustments: [LATCHES] } });
    const [id] = filed.orders;
    const plan = await planFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(ARMOR), settings.rulesFromSettings());
    assert.deepEqual([plan.priceCp, plan.dc.level, plan.change.parts.map((p) => p.name)], [3400, 2, ["Armor Latches"]]);
    const wrong = (await orders.requestOrder({ uuid: ARMOR, requester: vera.uuid, crafter: vera.uuid, variant: { adjustments: [SIPHON] } })).orders[0];
    assert.ok((await failing(wrong)).some(([gate, reason]) => gate === "G12" && reason === "adjustment-fit"));
    await orders.pledgeTo(id, vera.uuid, 3400);
    assert.equal((await orders.start(id)).ok, true);
    await toCheck(id);
    await recordCheck(id, 2);
    await orders.workDay(id);
    assert.equal((await orders.finish(id)).ok, true);
    const shelf = docs.strongbox.items.filter((i) => i.flags?.[MOD]?.crafted?.order === id);
    const host = shelf.find((i) => i.name === "Breastplate");
    const latches = shelf.find((i) => i.name === "Armor Latches");
    assert.equal(latches.flags[MOD].appliedTo.host, host.id);
    assert.equal(latches.flags[MOD].shelf.claimKey, host.flags[MOD].shelf.claimKey, "one delivery");
    as("p2");
    assert.equal(await claims.sweepClaims(), 1);
    const onBo = bo.items.filter((i) => i.flags?.[MOD]?.crafted?.order === id);
    assert.equal(onBo.length, 2);
    const boHost = onBo.find((i) => i.name === "Breastplate");
    assert.equal(onBo.find((i) => i.name === "Armor Latches").flags[MOD].appliedTo.host, boHost.id, "the recipient's copy of the host");
    assert.equal(docs.strongbox.items.filter((i) => i.flags?.[MOD]?.crafted?.order === id).length, 0);
});
