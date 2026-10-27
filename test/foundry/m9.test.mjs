/**
 * M9 over the fake world (DESIGN.md 6.9, 6.14, 7.1): a tattoo filed for its subject, who consents and sits for it in
 * downtime; one tattoo at a time per tattooist; the finish putting it on the shelf uninvested and healing; healing
 * recorded; the subject's client investing it, or leaving it decorative when the invest limit is used up; the simple
 * toggle; a graft rolled with Medicine, needing its formula, inactive until the limit rises; Legendary Tattoo Artist's
 * mark; a fulu's tradition and year; a missive composed one at a time; a staff's listed castings; quick-deploy snares.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MOD, addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { RANK } = await import("../../scripts/logic/core.mjs");
const { itemOptions } = await import("../../scripts/logic/registry.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { resetCatalogue } = await import("../../scripts/foundry/catalogue.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const crafts = await import("../../scripts/foundry/crafts.mjs");
const downtime = await import("../../scripts/foundry/downtime.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const orders = await import("../../scripts/foundry/orders.mjs");
const pledges = await import("../../scripts/foundry/pledges.mjs");
const { crafterFacts, gatesFor, productFacts, resetProducts } = await import("../../scripts/foundry/products.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, write } = await import("../../scripts/foundry/store.mjs");

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

const C = (id) => `Compendium.pf2e.equipment-srd.Item.${id}`;
const TATTOO = C("tattooward000000");
const TATTOO_GREATER = C("tattoowardgreat0");
const GRAFT = C("graftclaws000000");
const FULU = C("fuluward00000000");
const MISSIVE = C("missiveletter000");
const STAFF = C("staffoffire00000");
const BREATHE = "Compendium.pf2e.spells-srd.Item.breathefire00000";
const FIREBALL = "Compendium.pf2e.spells-srd.Item.fireball00000000";

const TATTOO_TEXT = "<p>Worn: resist fire.</p><hr><p><strong>Activate</strong> 2</p><p>A foe attempts a @Check[reflex|dc:20] save.</p>";
/** Compendium sources, as `toObject()` gives them. */
const SOURCES = {
    [TATTOO]: { name: "Warding Tattoo", type: "equipment", system: { slug: "warding-tattoo", level: { value: 4 }, price: { value: { gp: 100 } },
        traits: { value: ["invested", "magical", "tattoo"], rarity: "common" }, usage: { value: "tattooed-on-the-body" }, quantity: 1,
        description: { value: TATTOO_TEXT }, rules: [{ key: "Resistance", type: "fire", value: 2 }] } },
    [TATTOO_GREATER]: { name: "Warding Tattoo (Greater)", type: "equipment", system: { slug: "warding-tattoo-greater", level: { value: 6 }, price: { value: { gp: 250 } },
        traits: { value: ["invested", "magical", "tattoo"], rarity: "common" }, usage: { value: "tattooed-on-the-body" }, quantity: 1,
        description: { value: TATTOO_TEXT }, rules: [] } },
    [GRAFT]: { name: "Claws of the Beast", type: "equipment", system: { slug: "claws-of-the-beast", level: { value: 3 }, price: { value: { gp: 50 } },
        traits: { value: ["graft", "invested", "magical"], rarity: "common" }, usage: { value: "implanted" }, quantity: 1, description: { value: "<p>Claws.</p>" } } },
    [FULU]: { name: "Ward Fulu", type: "consumable", system: { slug: "ward-fulu", level: { value: 2 }, price: { value: { gp: 6 } },
        traits: { value: ["consumable", "fulu", "magical"], rarity: "common" }, quantity: 1, description: { value: "<p>Paper.</p>" } } },
    [MISSIVE]: { name: "Letter of Grace", type: "consumable", system: { slug: "letter-of-grace", level: { value: 3 }, price: { value: { gp: 10 } },
        traits: { value: ["consumable", "magical", "missive"], rarity: "common" }, quantity: 1, description: { value: "<p>Paper.</p>" } } },
    [STAFF]: { name: "Staff of Fire", type: "weapon", system: { slug: "staff-of-fire", level: { value: 3 }, price: { value: { gp: 60 } },
        traits: { value: ["magical", "staff", "two-hand-d8"], rarity: "common" }, quantity: 1,
        description: { value: `<ul><li><strong>1st</strong> @UUID[${BREATHE}]</li><li><strong>2nd</strong> @UUID[${FIREBALL}]</li></ul>` +
            "<p><strong>Craft Requirements</strong> Supply one casting of all listed ranks of all listed spells.</p>" } } },
};
game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => Object.entries(SOURCES).map(([uuid, source]) => ({ uuid, ...structuredClone(source) })) }]]);

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
CONFIG.PF2E = { spellcastingItems: {}, magicTraditions: { arcane: "", divine: "", occult: "", primal: "" } };
game.pf2e = { settings: { variants: { pwol: { enabled: false } } }, Modifier: class {} };

/** Items behave as pf2e's do where the module reads them: physical or not, their Price, their level. */
const PHYSICAL = ["weapon", "armor", "shield", "equipment", "consumable", "treasure", "backpack"];
function teach(item) {
    const proto = Object.getPrototypeOf(item);
    if (proto.isOfType) return;
    Object.defineProperty(proto, "isOfType", { value(...types) { return types.some((t) => t === this.type || (t === "physical" && PHYSICAL.includes(this.type))); } });
    Object.defineProperty(proto, "price", { get() { return { value: { copperValue: (this.system?.price?.value?.gp ?? 0) * 100 }, per: 1 }; } });
    Object.defineProperty(proto, "level", { get() { return this.system?.level?.value ?? 0; } });
}

let docs;
let vera;
let bo;
let cy;
const statistic = (slug, rank) => ({ slug, rank, label: slug, roll: async () => ({ total: 20, degreeOfSuccess: 2 }) });
const feat = (key, extra = {}) => ({ type: "feat", name: key, sourceId: REGISTRY[key].uuid, system: { level: { taken: 1 } }, ...extra });
const toolkit = () => ({ type: "equipment", name: "Artisan's Toolkit", sourceId: REGISTRY["artisans-toolkit"].uuid });

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    orders.resetOrders();
    crafts.resetCrafts();
    resetProducts();
    resetCatalogue();
    nextRandom = 0;
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [coin("gp", 1000), feat("tattoo-artist"), feat("magical-crafting"), toolkit()] });
    Object.assign(vera, { level: 7, skills: { crafting: statistic("crafting", RANK.expert) }, system: { crafting: { formulas: [] } } });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 100)] });
    Object.assign(bo, { level: 3, skills: {}, system: { crafting: { formulas: [] }, resources: { investiture: { value: 0, max: 10 } } } });
    cy = addDocument("Actor", { name: "Cy", ownership: { default: 0, p1: 3 }, items: [coin("gp", 1000), feat("graft-technician"), toolkit()] });
    Object.assign(cy, { level: 6, skills: { crafting: statistic("crafting", RANK.trained), medicine: statistic("medicine", RANK.expert) },
        system: { crafting: { formulas: [] } } });
    teach(vera.items.contents[0]);
    // Core's deletion of embedded items, which the subject sweep uses for an upgraded tattoo's old one.
    Object.getPrototypeOf(bo).deleteEmbeddedDocuments ??= async function (_name, ids) {
        return ids.map((id) => {
            const item = this.items.get(id);
            this.items.delete(id);
            return item;
        });
    };
    world.compendium = Object.fromEntries(Object.entries(SOURCES).map(([uuid, source]) => [uuid, {
        uuid, name: source.name, isOfType: (t) => t === "physical", toObject: () => structuredClone(source) }]));
    world.collections.Actor.party = { id: "party", members: [vera, bo, cy] };
    ChatMessage.implementation.getSpeaker = () => ({});
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

/** Switch to a user's client, with its lease. */
function as(user) {
    world.currentUser = user;
    resetLease();
    requestLease(user);
}

const failing = async (id, crafter = vera) => (await gatesFor(read(`orders.${id}`), crafterFacts(crafter), await productFacts(read(`orders.${id}.product.uuid`)),
    records("rows").filter((r) => r.order === id), settings.rulesFromSettings())).gates.filter((g) => !g.ok).map((g) => [g.id, g.reason]);

/** Work an order from `setup` through a recorded success to `finishing`, as its crafter's owner. */
async function toFinishing(id) {
    for (let i = 0; i < 4 && read(`orders.${id}.status`) === "setup"; i++) assert.equal((await orders.workDay(id)).ok, true);
    assert.equal(read(`orders.${id}.status`), "check");
    const order = read(`orders.${id}`);
    await write({ replace: { [`orders.${id}.check`]: { degree: 2, level: 7, rank: 2, attempt: order.attempt, messageId: "m", settled: false } },
        set: { [`orders.${id}.status`]: "rolled" } });
    assert.equal((await orders.workDay(id)).ok, true);
    assert.equal(read(`orders.${id}.status`), "finishing");
}

/** Fund, start, work and finish an order as `crafter`'s owner, paying what is left. */
async function craft(id, crafter = vera) {
    const upfront = read(`orders.${id}.upfrontCp`) ?? 0;
    assert.equal((await orders.pledgeTo(id, crafter.uuid, Math.max(1, Math.ceil(((await productFacts(read(`orders.${id}.product.uuid`))).priceCp *
        (read(`orders.${id}.quantity`) ?? 1)) / 2)) + upfront)).outcome, "ok");
    const started = await orders.start(id);
    assert.equal(started.ok, true, JSON.stringify(started));
    await toFinishing(id);
    const order = read(`orders.${id}`);
    await orders.pledgeTo(id, crafter.uuid, order.priceCp);
    const finished = await orders.finish(id);
    assert.equal(finished.ok, true, JSON.stringify(finished));
}

/** The shelf item an order made, or the item it became on its recipient. */
const madeOn = (actor, id) => actor.items.find((i) => i.flags?.[MOD]?.crafted?.order === id) ?? null;
const shelfFor = (id) => docs.strongbox.items.find((i) => i.flags?.[MOD]?.crafted?.order === id) ?? null;
/** Log days ahead of the clock (the Advance days wizard's record), so the workshop day moves. */
const logDays = (toDay) => write({ set: { [`meta.manual.run${toDay}`]: { fromDay: 1, toDay, by: "p1" } } });

/* -------------------------------------------- */
/*  Tattoos (6.14)                               */
/* -------------------------------------------- */

test("a tattoo for Bo: his owner consents and sits for it; one at a time; healing on the shelf; invested by his client once healed", async () => {
    const filed = await orders.requestOrder({ uuid: TATTOO, requester: vera.uuid, target: bo.uuid, crafter: vera.uuid });
    assert.equal(filed.ok, true, JSON.stringify(filed));
    const [id] = filed.orders;
    const order = read(`orders.${id}`);
    assert.deepEqual([order.craftType, order.target, order.recipient, order.quantity], ["tattoo", bo.uuid, { kind: "actor", uuid: bo.uuid }, 1]);
    assert.ok((await failing(id)).some(([gate, reason]) => gate === "G10" && reason === "no-consent"));
    assert.equal((await crafts.consent(id, bo.uuid)).reason, "not-owner", "only the subject's owner agrees");
    as("p2");
    const agreed = await crafts.consent(id, bo.uuid);
    assert.deepEqual(agreed, { ok: true, presence: true });
    const status = downtime.statusOf(bo);
    assert.deepEqual([status.inDowntime, status.activity, status.lockedBy], [true, { kind: "subject", ref: id }, id], "Bo sits for it in downtime");
    assert.equal((await downtime.setDowntime(bo.uuid, false)).reason, "subject", "he stays until it is done");
    as("p1");
    assert.deepEqual((await failing(id)).filter(([gate]) => gate !== "G8"), [], "consented and present");
    // One tattoo at a time per tattooist: a second, for Cy, waits while the first is under way.
    const [second] = (await orders.requestOrder({ uuid: TATTOO, requester: vera.uuid, target: cy.uuid, crafter: vera.uuid })).orders;
    await crafts.consent(second, cy.uuid);
    assert.equal((await orders.pledgeTo(id, vera.uuid, 5000)).outcome, "ok");
    const started = await orders.start(id);
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.deepEqual([read(`orders.${id}.variant.process`), read(`orders.${id}.skill`)], ["secrets-of-magic", "crafting"]);
    assert.ok((await failing(second)).some(([gate, reason]) => gate === "G11" && reason === "one-at-a-time"));
    as("p2");
    assert.equal((await crafts.withdrawConsent(id, bo.uuid)).reason, "state", "no withdrawing once the work started");
    as("p1");
    await toFinishing(id);
    await orders.pledgeTo(id, vera.uuid, 5000);
    assert.equal((await orders.finish(id)).ok, true);
    const shelved = shelfFor(id);
    const record = shelved.flags[MOD].subject;
    assert.deepEqual([record.kind, record.state, record.from, record.until, record.subject], ["tattoo", "healing", 0, 30, bo.uuid]);
    assert.deepEqual([shelved.system.equipped.carryType, shelved.system.equipped.invested], ["worn", false], "delivered uninvested");
    assert.equal(shelved.flags[MOD].shelf.for, bo.uuid);
    assert.equal(downtime.statusOf(bo).inDowntime, true);
    assert.equal(await orders.allOrders().length, 2);
    assert.equal((await failing(second)).some(([gate]) => gate === "G11"), false, "the tattooist is free again");
    // Bo's client collects it and keeps it healing; recorded healing ends it the day after the finish at the earliest.
    as("p2");
    assert.equal(await claims.sweepClaims(), 1);
    const tattoo = madeOn(bo, id);
    assert.ok(tattoo, "on Bo");
    assert.deepEqual(await crafts.subjectSweep(), [], "still healing");
    const healed = await crafts.recordHealing(tattoo.uuid);
    assert.deepEqual([healed.ok, healed.until], [true, 1]);
    assert.equal(read(`orders.${id}.healing.until`), 1, "the order notes it for everyone");
    await logDays(1);
    const settled = await crafts.subjectSweep();
    assert.deepEqual(settled.map((s) => s.changed.map((c) => c.state)), [["invested"]]);
    assert.deepEqual([tattoo.system.equipped.invested, tattoo.flags[MOD].subject.state], [true, "invested"]);
    assert.deepEqual(await crafts.subjectSweep(), [], "settled once (P5)");
    assert.equal((await crafts.recordHealing(tattoo.uuid)).reason, "state");
});

test("a new magical tattoo on a subject whose invest limit is already zero stays decorative; one with room left works (settled)", async () => {
    bo.system.resources.investiture.max = 2;
    bo.addItem({ type: "equipment", name: "Old Tattoo", system: { traits: { value: ["invested", "magical", "tattoo"] }, equipped: { carryType: "worn", invested: true } } });
    const make = async () => {
        const [id] = (await orders.requestOrder({ uuid: TATTOO, requester: vera.uuid, target: bo.uuid, crafter: vera.uuid })).orders;
        as("p2");
        await crafts.consent(id, bo.uuid);
        as("p1");
        await craft(id);
        as("p2");
        await claims.sweepClaims();
        as("p1");
        return id;
    };
    const first = await make();
    await logDays(30);
    as("p2");
    await crafts.subjectSweep();
    assert.equal(madeOn(bo, first).flags[MOD].subject.state, "invested", "a limit of one left takes it");
    assert.equal(world.notes.some(([, message]) => message === "pf2e-artisans-workshop.Subject.Over"), false, "nothing else is invested");
    as("p1");
    const second = await make();
    await logDays(60);
    as("p2");
    await crafts.subjectSweep();
    const late = madeOn(bo, second);
    assert.deepEqual([late.flags[MOD].subject.state, late.system.equipped.invested], ["decorative", false], "no limit left: decorative for good");
    assert.ok(world.notes.some(([level, message]) => level === "info" && message === "pf2e-artisans-workshop.Subject.Settled.Decorative"), "Bo's player is told");
    bo.system.resources.investiture.max = 10;
    await crafts.subjectSweep();
    assert.equal(late.flags[MOD].subject.state, "decorative");
});

test("the simple toggle: consent only, no lock, no healing, delivered invested", async () => {
    await game.settings.set(MOD, "rules.tattooProcess", "simple");
    const [id] = (await orders.requestOrder({ uuid: TATTOO, requester: vera.uuid, target: bo.uuid, crafter: vera.uuid })).orders;
    as("p2");
    assert.deepEqual(await crafts.consent(id, bo.uuid), { ok: true, presence: false });
    assert.equal(downtime.statusOf(bo).inDowntime, false, "the subject is not locked");
    as("p1");
    await craft(id);
    assert.equal(read(`orders.${id}.variant.process`), "simple");
    const shelved = shelfFor(id);
    assert.deepEqual([shelved.flags[MOD].subject.state, shelved.system.equipped.invested], ["invested", true]);
});

test("Legendary Tattoo Artist: +1 to the activated DC and the resistance of a tattoo 3 levels below the tattooist", async () => {
    vera.addItem(feat("legendary-tattoo-artist"));
    vera.level = 15;
    const [id] = (await orders.requestOrder({ uuid: TATTOO, requester: vera.uuid, target: vera.uuid, crafter: vera.uuid })).orders;
    assert.deepEqual((await failing(id)).filter(([gate]) => gate !== "G8"), [], "a tattooist on themself needs no consent");
    await craft(id);
    const made = shelfFor(id);
    assert.match(made.system.description.value, /Worn: resist fire\..*@Check\[reflex\|dc:21\]/s);
    assert.deepEqual(made.system.rules, [{ key: "Resistance", type: "fire", value: 3 }]);
    assert.deepEqual(made.flags[MOD].mark, { key: "legendary-tattoo-artist", mark: "activated", by: 1, raised: 2 });
});

test("an upgrade of the tattoo the subject has: the Price difference, and the old one goes when the new one arrives (6.14)", async () => {
    const old = bo.addItem({ type: "equipment", name: "Warding Tattoo", sourceId: TATTOO, system: { level: { value: 4 }, price: { value: { gp: 100 } },
        traits: { value: ["invested", "magical", "tattoo"] }, equipped: { carryType: "worn", invested: true } } });
    const [id] = (await orders.requestOrder({ uuid: TATTOO_GREATER, requester: vera.uuid, target: bo.uuid, crafter: vera.uuid, variant: { replaces: old.uuid } })).orders;
    as("p2");
    await crafts.consent(id, bo.uuid);
    as("p1");
    const { plan } = await gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(TATTOO_GREATER), [], settings.rulesFromSettings());
    assert.deepEqual([plan.ok, plan.priceCp], [true, 15000], "250 gp less 100 gp");
    await craft(id);
    as("p2");
    await claims.sweepClaims();
    await crafts.subjectSweep();
    assert.equal(bo.items.get(old.id), undefined, "the old tattoo is reworked into the new");
    assert.ok(madeOn(bo, id).flags[MOD].subject.replaced);
});

/* -------------------------------------------- */
/*  Grafts (6.14, Howl of the Wild p.97)         */
/* -------------------------------------------- */

test("a graft: the formula, Medicine, the subject present; inactive while the invest limit is used, invested once it rises", async () => {
    const [id] = (await orders.requestOrder({ uuid: GRAFT, requester: cy.uuid, target: bo.uuid, crafter: cy.uuid })).orders;
    assert.equal(read(`orders.${id}.craftType`), "graft");
    as("p2");
    assert.deepEqual(await crafts.consent(id, bo.uuid), { ok: true, presence: true });
    as("p1");
    assert.ok((await failing(id, cy)).some(([gate, reason]) => gate === "G6" && reason === "needs-formula"), "no implant without the formula");
    cy.system.crafting.formulas = [{ uuid: GRAFT }];
    assert.deepEqual((await failing(id, cy)).filter(([gate]) => gate !== "G8"), []);
    bo.system.resources.investiture.max = 0;
    await craft(id, cy);
    assert.equal(read(`orders.${id}.skill`), "medicine", "the implant is a Medicine check");
    const shelved = shelfFor(id);
    assert.deepEqual([shelved.system.equipped.carryType, shelved.flags[MOD].subject.until], ["implanted", 0], "no healing period");
    as("p2");
    await claims.sweepClaims();
    await crafts.subjectSweep();
    const graft = madeOn(bo, id);
    assert.deepEqual([graft.flags[MOD].subject.state, graft.system.equipped.invested], ["inactive", false]);
    bo.system.resources.investiture.max = 10;
    await crafts.subjectSweep();
    assert.deepEqual([graft.flags[MOD].subject.state, graft.system.equipped.invested], ["invested", true]);
});

/* -------------------------------------------- */
/*  Fulus, missives, staves, snares              */
/* -------------------------------------------- */

test("a fulu takes its crafter's tradition, chosen when the crafter has none of their own, and lasts a year", async () => {
    const [id] = (await orders.requestOrder({ uuid: FULU, quantity: 4, requester: vera.uuid, crafter: vera.uuid })).orders;
    assert.equal(read(`orders.${id}.quantity`), 4, "a batch of four");
    assert.ok((await failing(id)).some(([gate, reason]) => gate === "G12" && reason === "fulu-tradition"));
    as("p2");
    assert.equal((await crafts.chooseTradition(id, "occult")).reason, "not-owner");
    as("p1");
    assert.equal((await crafts.chooseTradition(id, "wood")).reason, "tradition");
    assert.equal((await crafts.chooseTradition(id, "occult")).ok, true);
    assert.equal((await failing(id)).some(([, reason]) => reason === "fulu-tradition"), false);
    await craft(id);
    const fulu = shelfFor(id);
    assert.deepEqual(fulu.system.traits.value, ["consumable", "fulu", "occult"]);
    const stamp = fulu.flags[MOD].expiry;
    assert.deepEqual([stamp.rule, stamp.creator, stamp.at, stamp.atDay], ["world", vera.uuid, 1000 + 365 * 86400, 365]);
});

test("a fulu crafter's only spellcasting tradition is the fulu's, with no choice to make", async () => {
    vera.spellcasting = { regular: [{ tradition: "divine" }] };
    const [id] = (await orders.requestOrder({ uuid: FULU, requester: vera.uuid, crafter: vera.uuid })).orders;
    assert.equal((await failing(id)).some(([, reason]) => reason === "fulu-tradition"), false);
    await craft(id);
    assert.equal(read(`orders.${id}.variant.tradition`), "divine");
    assert.ok(shelfFor(id).system.traits.value.includes("divine"));
});

test("a missive is made blank and composed one at a time by its owner", async () => {
    const [id] = (await orders.requestOrder({ uuid: MISSIVE, quantity: 2, requester: bo.uuid, crafter: null, recipient: { kind: "actor", uuid: vera.uuid } }))
        .orders ?? [];
    assert.equal(id, undefined, "Bo's owner files for Bo");
    const [mine] = (await orders.requestOrder({ uuid: MISSIVE, quantity: 2, requester: vera.uuid, crafter: vera.uuid })).orders;
    await craft(mine);
    await claims.sweepClaims();
    const stack = madeOn(vera, mine);
    assert.deepEqual([stack.quantity, stack.flags[MOD].missive], [2, { composed: null }]);
    assert.equal(crafts.blankMissives(vera).length, 1);
    const composed = await crafts.composeMissive(stack.uuid, { note: "to the duke" });
    assert.equal(composed.ok, true, JSON.stringify(composed));
    const letter = world.uuids.get(composed.item);
    assert.deepEqual([letter.quantity, letter.flags[MOD].missive.composed.note, stack.quantity], [1, "to the duke", 1]);
    assert.match(letter.name, /Missive\.ComposedName/);
    assert.equal((await crafts.composeMissive(letter.uuid)).reason, "composed");
    as("p2");
    assert.equal((await crafts.composeMissive(stack.uuid)).reason, "not-owner");
});

test("a staff needs a casting of each listed spell at each listed rank; a caster's pledge names the casting it supplies (6.9)", async () => {
    const product = await productFacts(STAFF);
    assert.deepEqual(product.spellNeeds.entries.map((e) => [e.uuid, e.rank]), [[BREATHE, 1], [FIREBALL, 2]]);
    const [id] = (await orders.requestOrder({ uuid: STAFF, requester: vera.uuid, crafter: vera.uuid })).orders;
    assert.equal(read(`orders.${id}.craftType`), "spell-item");
    const breathe = vera.addItem({ type: "spell", name: "Breathe Fire", sourceId: BREATHE, baseRank: 1, traits: new Set(["fire"]) });
    const first = await pledges.pledgeCasting(id, { caster: vera.uuid, spell: breathe.uuid });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(read(`orders.${id}.pledges.${first.pledge}.entry`), `${BREATHE}@1`);
    assert.equal((await pledges.pledgeCasting(id, { caster: vera.uuid, spell: breathe.uuid })).reason, "covered");
    await pledges.fulfilPledge(id, first.pledge);
    const g9 = async () => (await gatesFor(read(`orders.${id}`), crafterFacts(vera), product, [], settings.rulesFromSettings())).gates.find((g) => g.id === "G9");
    assert.equal((await g9()).reason, "spells", "fireball at 2nd rank is still needed");
    world.compendium[FIREBALL] = { uuid: FIREBALL, name: "Fireball", type: "spell", baseRank: 3, traits: new Set(["fire"]), sourceId: FIREBALL };
    assert.equal((await pledges.buyCasting(id, { payer: vera.uuid, spell: FIREBALL })).reason, "spell-rank", "a 3rd-rank spell is no 2nd-rank casting");
    world.compendium[FIREBALL].baseRank = 2;
    const bought = await pledges.buyCasting(id, { payer: vera.uuid, spell: FIREBALL });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    const service = Object.values(read(`orders.${id}.pledges`)).find((p) => p.service);
    assert.deepEqual([service.entry, service.rank, service.costCp], [`${FIREBALL}@2`, 2, 700], "a 2nd-rank casting at the service price");
    assert.equal((await g9()).ok, true);
});

test("quick-deploy snares: marks the character's feats allow, the ledger, and pf2e's own craft to deploy one (7.1)", async () => {
    vera.addItem(feat("giant-snare"));
    const crafted = [];
    const prepared = [{ uuid: "S1", item: { name: "Alarm Snare" }, expended: false }, { uuid: "S1", item: { name: "Alarm Snare" }, expended: false }];
    const ability = { slug: "snarecrafter", isPrepared: true, isDailyPrep: false, maxSlots: 2, getPreparedCraftingFormulas: async () => prepared,
        craft: async (index) => {
            crafted.push(index);
            prepared[index].expended = true;
            return { uuid: "Actor.x.Item.snare" };
        } };
    vera.crafting = { abilities: [ability] };
    assert.equal((await crafts.setSnareMark(vera.uuid, "snarecrafter", "S1#1", "broad")).reason, "mark", "no Broad Snare");
    assert.equal((await crafts.setSnareMark(vera.uuid, "snarecrafter", "S1#1", "giant")).ok, true);
    const ledger = crafts.snareLedger(vera, { slug: "snarecrafter", maxSlots: 2, prepared: prepared.map((p) => ({ uuid: p.uuid, name: p.item.name, expended: p.expended })) });
    assert.deepEqual([ledger.used, ledger.over, ledger.allowed], [3, 1, ["giant"]], "a giant snare costs two");
    assert.equal((await crafts.deploySnare(vera.uuid, "snarecrafter", 1)).ok, true);
    assert.deepEqual(crafted, [1]);
    assert.equal((await crafts.deploySnare(vera.uuid, "snarecrafter", 1)).reason, "deployed");
    assert.equal((await crafts.setSnareMark(vera.uuid, "snarecrafter", "S1#1", null)).ok, true);
    assert.deepEqual(crafts.snareMarksOf(vera), { snarecrafter: {} });
    as("p2");
    assert.equal((await crafts.deploySnare(vera.uuid, "snarecrafter", 0)).reason, "not-owner");
});

test("with tattoos off a tattoo is crafted as a plain item; a tattoo order is refused", async () => {
    await game.settings.set(MOD, "features.tattoos", false);
    const [id] = (await orders.requestOrder({ uuid: TATTOO, requester: vera.uuid, crafter: vera.uuid })).orders;
    assert.equal(read(`orders.${id}.craftType`), "item");
    assert.equal((await orders.requestOrder({ uuid: TATTOO, requester: vera.uuid, craftType: "tattoo", target: bo.uuid })).reason, "off");
});
