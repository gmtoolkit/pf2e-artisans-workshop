/**
 * The M9 interface over the fake world (DESIGN.md 6.9, 6.14, 7.1, 10.3): an order's subject on the detail (who, the
 * process, Agree and Withdraw for the right users, the made tattoo's state and healing), a fulu's tradition, a missive
 * order's blank missives, a staff's listed castings, the request form's subject and upgrade choices, the Queue's craft
 * buttons, and every M9 label a key.
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
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
foundry.applications.api.ApplicationV2 = class {
    constructor(options = {}) { this.options = options; this.tabGroups = { primary: "queue" }; this.window = {}; }
    async _prepareContext() { return { tabs: {} }; }
};

const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { RANK } = await import("../../scripts/logic/core.mjs");
const { makeOrder } = await import("../../scripts/logic/orders.mjs");
const { makePledge } = await import("../../scripts/logic/pledges.mjs");
const { itemOptions } = await import("../../scripts/logic/registry.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { resetProducts } = await import("../../scripts/foundry/products.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, write } = await import("../../scripts/foundry/store.mjs");
const { detailExtras, kindText, targetText } = await import("../../scripts/ui/extras.mjs");
const { onCraftOp } = await import("../../scripts/ui/crafts.mjs");
const { dayLines } = await import("../../scripts/ui/days.mjs");
const labels = await import("../../scripts/ui/labels.mjs");
const { replaceChoices } = await import("../../scripts/ui/request.mjs");
const { gateText } = await import("../../scripts/ui/format.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

const C = (id) => `Compendium.pf2e.equipment-srd.Item.${id}`;
const TATTOO = C("tattooward000000");
const GREATER = C("tattoowardgreat0");
const FULU = C("fuluward00000000");
const MISSIVE = C("missiveletter000");
const STAFF = C("staffoffire00000");
const BREATHE = "Compendium.pf2e.spells-srd.Item.breathefire00000";
const INDEX = [
    { uuid: TATTOO, name: "Warding Tattoo", type: "equipment", system: { level: { value: 4 }, traits: { value: ["invested", "magical", "tattoo"], rarity: "common" }, price: { value: { gp: 100 } } } },
    { uuid: GREATER, name: "Warding Tattoo (Greater)", type: "equipment", system: { level: { value: 6 }, traits: { value: ["invested", "magical", "tattoo"], rarity: "common" }, price: { value: { gp: 250 } } } },
    { uuid: FULU, name: "Ward Fulu", type: "consumable", system: { level: { value: 2 }, traits: { value: ["consumable", "fulu", "magical"], rarity: "common" }, price: { value: { gp: 6 } } } },
    { uuid: MISSIVE, name: "Letter of Grace", type: "consumable", system: { level: { value: 3 }, traits: { value: ["consumable", "magical", "missive"], rarity: "common" }, price: { value: { gp: 10 } } } },
    { uuid: STAFF, name: "Staff of Fire", type: "weapon", system: { level: { value: 3 }, traits: { value: ["magical", "staff"], rarity: "common" }, price: { value: { gp: 60 } },
        description: { value: `<ul><li><strong>1st</strong> @UUID[${BREATHE}]</li></ul>` } } },
];
game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => INDEX }]]);
game.pf2e = { settings: { variants: { pwol: { enabled: false } } } };
CONFIG.PF2E = { rarityTraits: {}, magicTraditions: { arcane: "PF2E.TraitArcane", occult: "PF2E.TraitOccult" }, skills: {} };
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
beforeEach(() => {
    resetWorld();
    state.resetState();
    resetProducts();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [
        { type: "feat", name: "Tattoo Artist", sourceId: REGISTRY["tattoo-artist"].uuid, system: { level: { taken: 1 } } }] });
    Object.assign(vera, { level: 7, skills: { crafting: { slug: "crafting", rank: RANK.expert } }, system: { crafting: { formulas: [] } } });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [] });
    Object.assign(bo, { level: 3, skills: {}, system: { crafting: { formulas: [] } } });
    world.compendium = Object.fromEntries(INDEX.map((entry) => [entry.uuid, { ...entry, isOfType: (t) => t === "physical", toObject: () => structuredClone(entry) }]));
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [vera, bo] };
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
});

/** A tattoo order for Bo by Vera, stored in the ledger. */
async function tattooOrder(over = {}) {
    const order = { ...makeOrder({ id: "o1", requester: vera.uuid, recipient: { kind: "actor", uuid: bo.uuid }, product: { uuid: TATTOO, snapshot: {} },
        quantity: 1, craftType: "tattoo", target: bo.uuid, crafter: vera.uuid }, stamp), ...over };
    await write({ set: { "orders.o1": order } });
    return read("orders.o1");
}

test("the subject on the detail: who agrees, and whether they sit for it; Agree for the subject's owner only (6.14)", async () => {
    let order = await tattooOrder();
    assert.equal(kindText(order), "Tattoo");
    assert.equal(targetText(order), "Bo", "the row names whom it is for");
    let subject = (await detailExtras(order)).subject;
    assert.deepEqual([subject.text, subject.canConsent, subject.canWithdraw, subject.process], ["Waiting for Bo to agree.", false, false, lang["pf2e-artisans-workshop.Settings.TattooProcess.SecretsOfMagic"]]);
    world.currentUser = "p2";
    subject = (await detailExtras(order)).subject;
    assert.equal(subject.canConsent, true, "Bo's player agrees");
    await write({ replace: { "orders.o1.subject": { actor: bo.uuid, consented: true, presence: true, process: "secrets-of-magic" } },
        set: { [`pcs.${bo.id}.inDowntime`]: true, [`pcs.${bo.id}.activity`]: { kind: "subject", ref: "o1" } } });
    order = read("orders.o1");
    subject = (await detailExtras(order)).subject;
    assert.deepEqual([subject.text, subject.canConsent, subject.canWithdraw], ["Bo has agreed and spends their downtime sitting for it.", false, true]);
    await write({ replace: { [`pcs.${bo.id}.activity`]: { kind: "subsist", ref: null } } });
    assert.equal((await detailExtras(order)).subject.canConsent, true, "a subject who left the chair agrees again (review fix)");
    world.currentUser = "p1";
    assert.equal((await detailExtras(order)).subject.canWithdraw, false, "only the subject's side withdraws");
});

test("a finished tattoo on the detail: its state and healing day, and Record healing for its owner", async () => {
    const order = await tattooOrder({ status: "complete", healing: { day: 4 } });
    const tattoo = bo.addItem({ type: "equipment", name: "Warding Tattoo", flags: { [MOD]: { subject: { kind: "tattoo", order: "o1", state: "healing", from: 2, until: 32 },
        mark: { by: 1 } } } });
    world.currentUser = "p2";
    const made = (await detailExtras(order)).subject.made;
    assert.deepEqual([made.uuid, made.state, made.until, made.healed, made.mark, made.canHeal],
        [tattoo.uuid, "healing", "healing until day 32", "healing recorded on day 4", "+1 from the tattooist", true]);
    world.currentUser = "p1";
    assert.equal((await detailExtras(order)).subject.made.canHeal, false);
});

test("a fulu's tradition: the crafter chooses one when it is not theirs alone; the year it lasts", async () => {
    await write({ set: { "orders.o2": makeOrder({ id: "o2", requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, product: { uuid: FULU, snapshot: {} },
        quantity: 4, crafter: vera.uuid }, stamp) } });
    let tradition = (await detailExtras(read("orders.o2"))).tradition;
    assert.deepEqual([tradition.text, tradition.canChoose], ["No tradition yet: the crafter chooses one before starting.", true]);
    world.currentUser = "p2";
    assert.equal((await detailExtras(read("orders.o2"))).tradition.canChoose, false);
    await write({ set: { "orders.o2.variant.tradition": "occult" } });
    tradition = (await detailExtras(read("orders.o2"))).tradition;
    assert.equal(tradition.text, "Tradition: PF2E.TraitOccult");
    assert.match(tradition.lasts, /a year/);
});

test("a finished missive order lists its blank missives, with Compose for their owner", async () => {
    await write({ set: { "orders.o3": { ...makeOrder({ id: "o3", requester: bo.uuid, recipient: { kind: "actor", uuid: bo.uuid }, product: { uuid: MISSIVE, snapshot: {} },
        quantity: 2 }, stamp), status: "complete" } } });
    bo.addItem({ type: "consumable", name: "Letter of Grace", system: { quantity: 2, traits: { value: ["consumable", "magical", "missive"] } },
        flags: { [MOD]: { crafted: { order: "o3" }, missive: { composed: null } } } });
    bo.addItem({ type: "consumable", name: "Letter of Grace (composed)", system: { quantity: 1, traits: { value: ["consumable", "magical", "missive"] } },
        flags: { [MOD]: { crafted: { order: "o3" }, missive: { composed: { by: "p2" } } } } });
    world.currentUser = "p2";
    const missives = (await detailExtras(read("orders.o3"))).missives;
    assert.deepEqual(missives.blank.map((m) => [m.name, m.qty, m.canCompose]), [["Letter of Grace", "2", true]]);
});

test("a staff's listed castings on the detail: each spell and rank, needed, offered or cast", async () => {
    world.uuids.set(BREATHE, { name: "Breathe Fire" });
    const order = makeOrder({ id: "o4", requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, product: { uuid: STAFF, snapshot: {} },
        quantity: 1, craftType: "spell-item" }, stamp);
    let entries = (await detailExtras(order)).entries;
    assert.deepEqual(entries.map((e) => [e.spell, e.rank, e.stateText]), [["Breathe Fire", "rank 1", "Needed"]]);
    order.pledges = { p: makePledge({ id: "p", caster: vera.uuid, spell: { uuid: "x", name: "Breathe Fire" }, rank: 1, castings: 1, entry: `${BREATHE}@1` }, stamp) };
    entries = (await detailExtras(order)).entries;
    assert.equal(entries[0].state, "offered");
});

test("a subject's sitting days read as a sentence on the days card and in the wizard", async () => {
    await tattooOrder({ product: { uuid: TATTOO, snapshot: { name: "Warding Tattoo" } } });
    const record = (day) => ({ id: `${bo.id}-${day}`, actor: bo.id, day, toDay: day, activity: { kind: "subject", ref: "o1" }, order: "o1", result: "subject" });
    assert.deepEqual(dayLines([record(1), record(2)]), ["2 days sitting for Warding Tattoo"]);
    assert.deepEqual(dayLines([record(3)]), ["1 day sitting for Warding Tattoo"]);
});

test("the request form offers the subject's tattoos of the family below the one asked for", () => {
    const own = bo.addItem({ type: "equipment", name: "Warding Tattoo", sourceId: TATTOO, system: { level: { value: 4 }, traits: { value: ["invested", "magical", "tattoo"] } } });
    own.isOfType = (t) => t === "physical";
    own.level = 4;
    world.uuids.set(TATTOO, { name: "Warding Tattoo" });
    const other = bo.addItem({ type: "equipment", name: "Boozy Bottle", system: { level: { value: 5 }, traits: { value: ["invested", "magical", "tattoo"] } } });
    other.isOfType = (t) => t === "physical";
    other.level = 5;
    assert.deepEqual(replaceChoices(bo, { name: "Warding Tattoo (Greater)", type: "equipment", category: null, level: 6 }).map((i) => i.name), ["Warding Tattoo"]);
    assert.deepEqual(replaceChoices(bo, { name: "Warding Tattoo", type: "equipment", category: null, level: 4 }), [], "not the same level");
});

test("Agree asks first where the subject will sit for it, naming what it replaces; declining writes nothing (6.14)", async () => {
    await tattooOrder({ product: { uuid: TATTOO, snapshot: { name: "Warding Tattoo" } } });
    await write({ set: { [`pcs.${bo.id}.inDowntime`]: true, [`pcs.${bo.id}.since`]: 0 }, replace: { [`pcs.${bo.id}.activity`]: { kind: "retrain", ref: null } } });
    world.currentUser = "p2";
    const target = { closest: (selector) => (selector === "[data-order-id]" ? { dataset: { orderId: "o1" } } : { dataset: { op: "consent" } }) };
    let asked = null;
    foundry.applications.api.DialogV2.confirm = async (config) => {
        asked = config;
        return false;
    };
    assert.equal(await onCraftOp({}, target), null);
    assert.equal(read("orders.o1.subject"), undefined, "nothing written");
    assert.deepEqual(read(`pcs.${bo.id}.activity`), { kind: "retrain", ref: null }, "Bo still retrains");
    assert.equal(asked.window.title, "pf2e-artisans-workshop.Subject.Confirm.Title");
    assert.match(asked.content, /Bo goes into downtime and spends every day sitting for Warding Tattoo until it is finished/);
    assert.match(asked.content, /This replaces what Bo is doing now: Retraining\./);
    assert.match(asked.content, /withdraw only before the work starts or after a failed check/);
    foundry.applications.api.DialogV2.confirm = async () => true;
    assert.equal((await onCraftOp({}, target)).ok, true);
    assert.deepEqual(read(`pcs.${bo.id}.activity`), { kind: "subject", ref: "o1" });
});

test("Agree from the Queue runs the subject's consent; the button carries its order", async () => {
    await tattooOrder();
    world.currentUser = "p2";
    const target = { closest: (selector) => (selector === "[data-order-id]" ? { dataset: { orderId: "o1" } } : { dataset: { op: "consent" } }) };
    foundry.applications.api.DialogV2.confirm = async () => true;
    const result = await onCraftOp({}, target);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(read("orders.o1.subject.consented"), true);
    const queue = readFileSync(join(ROOT, "templates/workshop/queue.hbs"), "utf8");
    assert.match(queue, /data-action="craft" data-op="consent" data-fix="requirement"/, "the unmet requirement's fix");
    assert.match(queue, /data-action="craft" data-op="heal" data-item="\{\{uuid\}\}"/);
    assert.match(queue, /data-action="craft" data-op="compose" data-item="\{\{uuid\}\}"/);
});

test("M9's gates and refusals read as sentences; every M9 label is a key in lang/en.json", () => {
    assert.equal(gateText({ reason: "one-at-a-time", data: { order: "o2" } }), "The crafter is already working on another one of these. Finish that order first.");
    assert.equal(gateText({ reason: "fulu-tradition", data: {} }), "The fulu needs a tradition: choose one for it.");
    const keys = [
        ...Object.values(labels.SUBJECT_STATE).map((s) => s.key), ...Object.values(labels.TATTOO_PROCESS), labels.CRAFT_TYPE.tattoo, labels.CRAFT_TYPE.graft,
        labels.GATE["one-at-a-time"], labels.GATE["fulu-tradition"], labels.GATE["no-reverse-engineer"], labels.REQUIREMENT["G10.subject"],
        labels.REQUIREMENT["G11.subject"], labels.DAY_STOP["not-subject"], labels.ACTIVITY.subject,
        ...["subject", "not-subject", "subject-recipient", "no-consent", "subject-locked", "not-on-list", "covered", "any-castings", "tradition", "not-missive",
            "composed", "no-pool", "mark", "deployed", "cantrip-service", "not-deployed"].map((code) => labels.REFUSAL[code]),
        "pf2e-artisans-workshop.Days.Subject", "pf2e-artisans-workshop.Days.SubjectOne", "pf2e-artisans-workshop.Subject.Confirm.Title",
        ...["Healing", "Decorative", "Inactive"].map((state) => `pf2e-artisans-workshop.Subject.Uninvested.${state}`),
    ];
    assert.deepEqual(keys.filter((key) => !(key in lang)), []);
});

test("after the M9 live pass: a finished order's subject no longer reads as sitting for it", async () => {
    const consented = { subject: { actor: bo.uuid, consented: true, presence: true, process: "secrets-of-magic" } };
    await tattooOrder({ ...consented, status: "finishing" });
    await write({ set: { [`pcs.${bo.id}.inDowntime`]: true, [`pcs.${bo.id}.activity`]: { kind: "subject", ref: "o1" } } });
    assert.equal((await detailExtras(read("orders.o1"))).subject.text, "Bo has agreed and spends their downtime sitting for it.");
    for (const status of ["complete", "cancelled"]) {
        await tattooOrder({ ...consented, status });
        assert.equal((await detailExtras(read("orders.o1"))).subject.text, "Bo has agreed.", status);
    }
});
