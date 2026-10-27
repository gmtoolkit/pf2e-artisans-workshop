/**
 * M5 over the fake world (DESIGN.md 4.5, 4.13, 5.5, 6.6, 6.8, 6.9, 6.13): learning a formula at once with its purchase row
 * and formula claim, a formula copied from an ally and written by the learner's own client, an owed pick taken, a
 * reverse-engineering job through the order lifecycle (the item kept), a rune etched in place, an item handed over and
 * given back on a cancel, precious stock counted toward the up-front half and consumed at the finish, a Repair, casting
 * pledges as G9, and the scroll built with its pledged spell. M5 on M4.1: purchases paid from the party fund or a purse,
 * an order's purchase earmarked and spent in one move, the fund slot against an earmark of the same money, a formula
 * copy's cost refunded to its source on a cancel, and stock lowering what "Fund this order" fills.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MOD, addDocument, asUser, coin, installFoundry, interleave, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { RANK } = await import("../../scripts/logic/core.mjs");
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { provenancePath } = await import("../../scripts/logic/codex.mjs");
const { itemOptions } = await import("../../scripts/logic/registry.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { resetCatalogue } = await import("../../scripts/foundry/catalogue.mjs");
const { coinStacks, setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const custody = await import("../../scripts/foundry/custody.mjs");
const formulas = await import("../../scripts/foundry/formulas.mjs");
const funds = await import("../../scripts/foundry/funds.mjs");
const { fundAccounts, spentBySource, unallocatedCp } = await import("../../scripts/logic/funds.mjs");
const { allocationsByContributor } = await import("../../scripts/logic/split.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const orders = await import("../../scripts/foundry/orders.mjs");
const { spellItemSource } = await import("../../scripts/foundry/outputs.mjs");
const pledges = await import("../../scripts/foundry/pledges.mjs");
const { crafterFacts, gatesFor, productFacts, resetProducts } = await import("../../scripts/foundry/products.mjs");
const { reconciliationReport } = await import("../../scripts/foundry/reconcile.mjs");
const services = await import("../../scripts/foundry/services.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, write } = await import("../../scripts/foundry/store.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
formulas.registerFormulaClaims();
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));

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
const ELIXIR = C("hDLbR56Id2OtU318");
const STRIKING = C("DxCuJKynlnMQZHgp");
const SCROLL1 = C("RjuupS9xyXDLgyIr");
const IRON = C("eQjibJl41aQpQ47d");
const HEAL = "Compendium.pf2e.spells-srd.Item.healspell0000000";
const WP1 = C("weaponpotency001");
const WP2 = C("weaponpotency002");
const FLAMING = C("flamingrune00000");
const GFLAMING = C("flaminggreater00");
const VORPAL = C("vorpalrune000000");
const ENERGY = C("energyresistant0");

/** Compendium sources, as `toObject()` gives them. */
const SOURCES = {
    [ELIXIR]: { name: "Elixir of Life (Minor)", type: "consumable", system: { slug: "elixir-of-life-minor", level: { value: 1 }, price: { value: { gp: 3 } },
        traits: { value: ["alchemical", "consumable", "elixir", "healing"], rarity: "common" }, category: "elixir", quantity: 1 } },
    [STRIKING]: { name: "Striking", type: "equipment", system: { slug: "striking", level: { value: 4 }, price: { value: { gp: 65 } },
        traits: { value: ["magical"], rarity: "common" }, usage: { value: "etched-onto-a-weapon" }, quantity: 1 } },
    [SCROLL1]: { name: "Scroll of 1st-rank Spell", type: "consumable", system: { slug: "scroll-of-1st-rank-spell", level: { value: 1 }, price: { value: { gp: 4 } },
        traits: { value: ["consumable", "magical", "scroll"], rarity: "common" }, category: "scroll", description: { value: "<p>base</p>" }, quantity: 1 } },
    [IRON]: { name: "Cold Iron Ingot", type: "equipment", system: { slug: "cold-iron-ingot", level: { value: 0 }, price: { value: { gp: 100 } },
        traits: { value: ["precious"], rarity: "common" }, quantity: 1 } },
    [WP1]: { name: "Weapon Potency (+1)", type: "equipment", system: { slug: "weapon-potency-1", level: { value: 2 }, price: { value: { gp: 35 } },
        traits: { value: ["magical"], rarity: "common" }, usage: { value: "etched-onto-a-weapon" }, quantity: 1 } },
    [WP2]: { name: "Weapon Potency (+2)", type: "equipment", system: { slug: "weapon-potency-2", level: { value: 10 }, price: { value: { gp: 935 } },
        traits: { value: ["magical"], rarity: "common" }, usage: { value: "etched-onto-a-weapon" }, quantity: 1 } },
    [FLAMING]: { name: "Flaming", type: "equipment", system: { slug: "flaming", level: { value: 8 }, price: { value: { gp: 500 } },
        traits: { value: ["magical", "fire"], rarity: "common" }, usage: { value: "etched-onto-a-weapon" }, quantity: 1 } },
    [GFLAMING]: { name: "Flaming (Greater)", type: "equipment", system: { slug: "flaming-greater", level: { value: 15 }, price: { value: { gp: 6500 } },
        traits: { value: ["magical", "fire"], rarity: "common" }, usage: { value: "etched-onto-a-weapon" }, quantity: 1 } },
    [VORPAL]: { name: "Vorpal", type: "equipment", system: { slug: "vorpal", level: { value: 17 }, price: { value: { gp: 15000 } },
        traits: { value: ["magical"], rarity: "rare" }, usage: { value: "etched-onto-slashing-melee-weapon" }, quantity: 1 } },
    [ENERGY]: { name: "Energy-Resistant", type: "equipment", system: { slug: "energy-resistant", level: { value: 8 }, price: { value: { gp: 420 } },
        traits: { value: ["magical"], rarity: "common" }, usage: { value: "etched-onto-armor" }, quantity: 1 } },
};
/** The equipment compendium's index, as `getIndex` returns it: the catalogue the rune Prices are read from. */
game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => Object.entries(SOURCES).map(([uuid, source]) => ({ uuid, ...structuredClone(source) })) }]]);

/** Property rune keys pf2e knows (its rune data); it values no other key. */
const KNOWN_PROPERTY = new Set(["flaming", "greaterFlaming", "frost", "vorpal"]);
/**
 * pf2e's prepared, unsaved item, as far as the module reads it. Runes price as pf2e's `computePrice` does: a specific
 * item's runes add nothing, an item with runes drops its own base Price, and a property rune key pf2e does not know
 * adds nothing.
 */
CONFIG.Item = {
    documentClass: class {
        constructor(source) {
            const s = source.system ?? {};
            const runes = s.runes ?? {};
            const isSpecific = !!s.specific;
            const known = (runes.property ?? []).filter((key) => KNOWN_PROPERTY.has(key)).length;
            const runeCp = isSpecific ? 0 : (runes.potency ?? 0) * 3500 + (runes.striking ?? 0) * 6500 + known * 50000 + (runes.reinforcing ?? 0) * 7500;
            Object.assign(this, {
                name: source.name, img: "i.webp", type: source.type, system: s, slug: s.slug ?? null, level: s.level?.value ?? 0,
                rarity: s.traits?.rarity ?? "common", traits: new Set(s.traits?.value ?? []), category: s.category ?? null,
                price: { value: { copperValue: runeCp > 0 ? runeCp : (s.price?.value?.gp ?? 0) * 100 }, per: s.price?.per ?? 1 }, isSpecific,
            });
        }
        getRollOptions() {
            return [...itemOptions({ type: this.type, slug: this.slug, traits: [...this.traits], rarity: this.rarity, level: this.level, category: this.category })];
        }
    },
};
CONFIG.PF2E = {
    spellcastingItems: { scroll: { nameTemplate: "PF2E.Item.Physical.FromSpell.Scroll", compendiumUuids: { 1: SCROLL1 } } },
    magicTraditions: { arcane: "", divine: "", occult: "", primal: "" },
};
game.pf2e = { settings: { variants: { pwol: { enabled: false } } }, Modifier: class {} };

/** Items behave as pf2e's do where the module reads them: physical or not, their Price per item. */
const PHYSICAL = ["weapon", "armor", "shield", "equipment", "consumable", "treasure", "backpack"];
function teach(item) {
    const proto = Object.getPrototypeOf(item);
    if (proto.isOfType) return;
    Object.defineProperty(proto, "isOfType", { value(...types) { return types.some((t) => t === this.type || (t === "physical" && PHYSICAL.includes(this.type))); } });
    Object.defineProperty(proto, "price", { get() { return { value: { copperValue: (this.system?.price?.value?.gp ?? 0) * 100 }, per: 1 }; } });
}

let docs;
let vera;
let bo;
let hooked;
const statistic = (slug, rank, degree = 2) => ({ slug, rank, label: slug, roll: async () => ({ total: 20, degreeOfSuccess: degree }) });

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    orders.resetOrders();
    resetProducts();
    resetCatalogue();
    nextRandom = 0;
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    const feat = (key, extra = {}) => ({ type: "feat", name: key, sourceId: REGISTRY[key].uuid, system: { level: { taken: 1 } }, ...extra });
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [
        coin("gp", 100), feat("alchemical-crafting"), feat("magical-crafting"),
        { type: "equipment", name: "Alchemist's Lab", sourceId: REGISTRY["alchemists-lab"].uuid },
        { type: "equipment", name: "Artisan's Toolkit", sourceId: REGISTRY["artisans-toolkit"].uuid },
        { type: "equipment", name: "Repair Toolkit", sourceId: REGISTRY["repair-toolkit"].uuid },
    ] });
    Object.assign(vera, { level: 5, skills: { crafting: statistic("crafting", RANK.expert) }, system: { crafting: { formulas: [] } } });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [coin("gp", 100)] });
    Object.assign(bo, { level: 3, skills: {}, system: { crafting: { formulas: [] } } });
    teach(vera.items.contents[0]);
    world.compendium = Object.fromEntries(Object.entries(SOURCES).map(([uuid, source]) => [uuid, {
        uuid, name: source.name, isOfType: (t) => t === "physical", toObject: () => structuredClone(source) }]));
    world.compendium[HEAL] = { uuid: HEAL, name: "Heal", type: "spell", rarity: "common", system: { traits: { value: ["healing", "vitality"] } },
        sourceId: HEAL, toObject: () => ({ name: "Heal", type: "spell", system: { traits: { value: ["healing", "vitality"] }, location: { value: "entry" } } }) };
    world.collections.Actor.party = { id: "party", members: [vera, bo] };
    ChatMessage.implementation.getSpeaker = () => ({});
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
    hooked = [];
    Hooks.on(`${MOD}.formulaAcquired`, (payload) => hooked.push(payload));
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

const bookOf = (actor) => actor.system.crafting.formulas.map((f) => f.uuid);
/** Switch to a user's client, with its lease. */
function as(user) {
    world.currentUser = user;
    resetLease();
    requestLease(user);
}

/* -------------------------------------------- */
/*  Learning at once                             */
/* -------------------------------------------- */

test("buying a formula: one purchase row from the purse, a formula claim applied at once, the book written as pf2e does", async () => {
    const result = await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bookOf(vera), [ELIXIR]);
    assert.equal(cpOf(vera), 10000 - 100, "a 1st-level formula costs 1 gp (Player Core p.294)");
    const [row] = records("rows");
    assert.deepEqual([row.kind, row.cp, row.purse, row.box, row.state], ["purchase", 100, -100, 0, "applied"]);
    const provenance = read(provenancePath(vera.id, ELIXIR));
    assert.deepEqual([provenance.route, provenance.row], ["bought", row.id]);
    const [claim] = records("claims");
    assert.ok(claim.resolved && claim.applied, "the claim is resolved with its lock and applied after the book");
    assert.equal(hooked.length, 1, "formulaAcquired once, on the writing client (12.3)");
    assert.deepEqual([hooked[0].route, hooked[0].added], ["bought", true]);
    assert.equal((await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy" })).reason, "known");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("an uncommon formula needs a seller confirmed; another user's purse is refused", async () => {
    SOURCES[ELIXIR].system.traits.rarity = "uncommon";
    try {
        resetProducts();
        assert.equal((await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy" })).reason, "needs");
        assert.equal((await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy", payer: bo.uuid, confirm: ["seller"] })).reason, "not-owner");
        assert.equal((await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy", confirm: ["seller"] })).ok, true);
    } finally {
        SOURCES[ELIXIR].system.traits.rarity = "common";
    }
});

test("a formula copied from an ally: the ally's owner performs the service, the learner's own client writes the book (5.5)", async () => {
    vera.system.crafting.formulas = [{ uuid: ELIXIR }];
    as("p2");
    const asked = await services.requestService({ kind: "formula-copy", requester: bo.uuid, performer: vera.uuid, uuid: ELIXIR });
    assert.equal(asked.ok, true, JSON.stringify(asked));
    assert.equal((await services.perform(asked.service)).reason, "not-owner", "only the ally's owner performs it");
    as("p1");
    const done = await services.perform(asked.service);
    assert.deepEqual([done.ok, done.outcome], [true, "claimed"], "Vera's client does not write Bo's book");
    assert.deepEqual(bookOf(bo), []);
    assert.equal(read(`services.${asked.service}.status`), "done");
    assert.equal((await services.perform(asked.service)).reason, "state", "performed once");
    as("p2");
    assert.equal(await claims.sweepClaims(), 1);
    assert.deepEqual(bookOf(bo), [ELIXIR]);
    const provenance = read(provenancePath(bo.id, ELIXIR));
    assert.deepEqual([provenance.route, provenance.source, provenance.service], ["copied-ally", vera.uuid, asked.service]);
    assert.equal(await claims.sweepClaims(), 0, "applied once");
});

test("an owed pick: Alchemical Crafting's four common alchemical formulas of level 1, taken one at a time (6.8)", async () => {
    const before = formulas.owedPicks(vera);
    assert.deepEqual(before.entries.filter((e) => e.key === "alchemical-crafting").map((e) => [e.level, e.owed, e.maxLevel]), [[1, 4, 1]]);
    const taken = await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "grant", source: "alchemical-crafting" });
    assert.equal(taken.ok, true, JSON.stringify(taken));
    assert.deepEqual([read(provenancePath(vera.id, ELIXIR)).route, read(provenancePath(vera.id, ELIXIR)).pickLevel], ["granted", 1]);
    assert.equal(formulas.owedPicks(vera).entries.find((e) => e.key === "alchemical-crafting").owed, 3);
    assert.equal(records("rows").length, 0, "a pick costs nothing");
    assert.equal((await formulas.acquire({ learner: vera.uuid, uuid: STRIKING, route: "grant", source: "alchemical-crafting" })).reason, "no-pick",
        "a magical rune is no alchemical formula");
});

test("a formula on its way to the book counts as known: a GM's second buy for a connected player's character is refused, not charged (5.5)", async () => {
    as("gm00000000000000");
    const first = await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy" });
    assert.deepEqual([first.ok, first.outcome], [true, "claimed"], "Vera's own client writes her book");
    assert.deepEqual(bookOf(vera), []);
    const second = await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy" });
    assert.deepEqual([second.ok, second.reason], [false, "pending"]);
    assert.equal(records("rows").filter((r) => r.kind === "purchase").length, 1, "one purchase row");
    assert.equal(cpOf(vera), 10000 - 100, "charged once");
    assert.equal((await services.requestService({ kind: "formula-copy", requester: vera.uuid, performer: bo.uuid, uuid: ELIXIR })).reason, "pending");
    as("p1");
    assert.equal(await claims.sweepClaims(), 1);
    assert.deepEqual(bookOf(vera), [ELIXIR]);
    assert.equal((await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy" })).reason, "known");
});

test("a pick taken by a tab that is not the learner's counts at once: the picks owed drop before the claim is applied (6.8)", async () => {
    as("gm00000000000000");
    const owed = () => formulas.owedPicks(vera).entries.find((e) => e.key === "alchemical-crafting").owed;
    assert.equal(owed(), 4);
    const taken = await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "grant", source: "alchemical-crafting" });
    assert.deepEqual([taken.ok, taken.outcome], [true, "claimed"]);
    assert.equal(owed(), 3, "the claim on its way fills a pick");
    assert.equal((await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "grant", source: "alchemical-crafting" })).reason, "pending");
    as("p1");
    await claims.sweepClaims();
    assert.equal(owed(), 3, "applied, the record fills the same pick once");
});

test("a formula claim whose application stopped after its lock is finished by the learner's client (resume)", async () => {
    const input = formulas.formulaClaimInput({ learner: vera.uuid, uuid: ELIXIR, route: "bought", ref: "x" });
    const { makeClaim } = await import("../../scripts/logic/claims.mjs");
    const claim = makeClaim(input, { by: "p1", at: { world: 0, real: 1, server: 0, launch: 0 } });
    await write({ set: { [`claims.${claim.id}`]: { ...claim, resolved: { by: "p1", at: { world: 0, real: 1, server: 0, launch: 0 } } } } });
    assert.equal(await formulas.resumeFormulaClaims(), 1);
    assert.deepEqual(bookOf(vera), [ELIXIR]);
    assert.ok(read(`claims.${claim.id}.applied`));
    assert.equal(await formulas.resumeFormulaClaims(), 0);
});

/* -------------------------------------------- */
/*  Formula jobs and items on the order machine  */
/* -------------------------------------------- */

/** Work an order from `setup` through a recorded success to `finishing`. */
async function toFinishing(id) {
    for (let i = 0; i < 4 && read(`orders.${id}.status`) === "setup"; i++) assert.equal((await orders.workDay(id)).ok, true);
    assert.equal(read(`orders.${id}.status`), "check");
    const order = read(`orders.${id}`);
    await write({ replace: { [`orders.${id}.check`]: { degree: 2, level: 5, rank: 2, attempt: order.attempt, messageId: "m", settled: false } },
        set: { [`orders.${id}.status`]: "rolled" } });
    const worked = await orders.workDay(id);
    assert.equal(worked.ok, true, JSON.stringify(worked));
    assert.equal(read(`orders.${id}.status`), "finishing");
}

test("reverse-engineering on the order machine: the formula's Price, 2 setup days, the formula claimed at the finish, the item kept", async () => {
    const elixir = vera.addItem({ type: "consumable", name: "Elixir of Life (Minor)", sourceId: ELIXIR, system: { quantity: 1 } });
    const filed = await orders.requestOrder({ uuid: ELIXIR, requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid,
        productType: "formula", route: "reverse-engineer" });
    assert.equal(filed.ok, true, JSON.stringify(filed));
    const [id] = filed.orders;
    assert.deepEqual((await orders.start(id)).data.gates.map((g) => g.reason), ["underfunded"]);
    assert.equal((await orders.pledgeTo(id, vera.uuid, 50)).outcome, "ok");
    assert.equal((await orders.start(id)).ok, true);
    const order = read(`orders.${id}`);
    assert.deepEqual([order.priceCp, order.upfrontCp, order.setup.days, order.dc.final, order.route], [100, 50, 2, 15, "reverse-engineer"]);
    await toFinishing(id);
    const finished = await orders.finish(id);
    assert.equal(finished.ok, true, JSON.stringify(finished));
    assert.equal(read(`orders.${id}.status`), "complete");
    assert.deepEqual(bookOf(vera), [ELIXIR]);
    assert.equal(read(provenancePath(vera.id, ELIXIR)).route, "reverse-engineered");
    assert.ok(vera.items.get(elixir.id), "the item is kept (Player Core p.294)");
    assert.equal(records("rows").filter((r) => r.kind === "shelved").length, 0, "nothing goes on the shelf");
});

test("a rune etched onto the crafter's own weapon: the rune's Price and DC, the runes changed in place, the move resumed only by the crafter's owner", async () => {
    const sword = vera.addItem({ type: "weapon", name: "Longsword", system: { quantity: 1, runes: { potency: 1, striking: 0, property: [] }, price: { value: { gp: 1 } } } });
    const filed = await orders.requestOrder({ uuid: STRIKING, requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid,
        craftType: "rune-etch", target: sword.uuid });
    assert.equal(filed.ok, true, JSON.stringify(filed));
    const [id] = filed.orders;
    assert.equal((await orders.pledgeTo(id, vera.uuid, 3250)).outcome, "ok");
    const started = await orders.start(id);
    assert.equal(started.ok, true, JSON.stringify(started));
    const order = read(`orders.${id}`);
    assert.deepEqual([order.priceCp, order.upfrontCp, order.dc.final], [6500, 3250, 19], "the striking rune's 65 gp at its level-4 DC");
    await toFinishing(id);
    assert.equal((await orders.pledgeTo(id, vera.uuid, 3150)).outcome, "ok");
    const finished = await orders.finish(id);
    assert.equal(finished.ok, true, JSON.stringify(finished));
    assert.deepEqual(vera.items.get(sword.id).system.runes, { potency: 1, striking: 1, property: [] });
    assert.equal(docs.strongbox.items.filter((i) => i.type === "weapon").length, 0, "the sword stayed with its owner");
    assert.equal(reconciliationReport().differenceCp, 0);
    // The finish's coins came from the strongbox alone, but it changed Vera's sword: only a user who owns Vera may resume it.
    const page = docs.ledger.pages.find((p) => p.flags[MOD]?.move?.apply?.some((op) => op.op === "updateItems" && op.target === vera.uuid));
    assert.ok(page, "the finish is a resumable move");
    assert.equal(page.flags[MOD].move.actor, vera.uuid);
});

test("an etching costs the rune's Price, or the difference to the rune it upgrades, whatever pf2e makes of the item's own Price (GM Core p.224)", async () => {
    const rules = settings.rulesFromSettings();
    const planOf = async (uuid, target) => {
        const [id] = (await orders.requestOrder({ uuid, requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid,
            craftType: "rune-etch", target: target.uuid })).orders;
        return (await gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(uuid), [], rules)).plan;
    };
    // A mundane longsword: pf2e drops its 1 gp once it has a rune, so its Price goes from 1 gp to 35 gp.
    const plain = vera.addItem({ type: "weapon", name: "Longsword", system: { quantity: 1, runes: { potency: 0, striking: 0, property: [] }, price: { value: { gp: 1 } } } });
    const first = await planOf(WP1, plain);
    assert.deepEqual([first.ok, first.priceCp], [true, 3500], "+1 weapon potency costs its 35 gp");
    // A specific weapon: pf2e prices its runes at nothing, yet a stronger fundamental rune may be etched (G12).
    const specific = vera.addItem({ type: "weapon", name: "Sparkblade", isSpecific: true,
        system: { quantity: 1, specific: { value: true }, runes: { potency: 1, striking: 0, property: [] }, price: { value: { gp: 100 } } } });
    const upgrade = await planOf(WP2, specific);
    assert.deepEqual([upgrade.ok, upgrade.priceCp], [true, 90000], "+1 to +2 costs 935 gp less 35 gp");
});

test("a rune goes only on an item its usage allows: Vorpal is refused on a bow (G12)", async () => {
    const bow = vera.addItem({ type: "weapon", name: "Longbow", system: { quantity: 1, range: 100, damage: { damageType: "piercing" },
        runes: { potency: 3, striking: 3, property: [] } } });
    const sword = vera.addItem({ type: "weapon", name: "Longsword", system: { quantity: 1, damage: { damageType: "slashing" },
        runes: { potency: 3, striking: 3, property: [] } } });
    const planOn = async (target) => {
        const [id] = (await orders.requestOrder({ uuid: VORPAL, requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid,
            craftType: "rune-etch", target: target.uuid })).orders;
        return gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(VORPAL), [], settings.rulesFromSettings());
    };
    const onBow = await planOn(bow);
    assert.equal(onBow.plan.reason, "wrong-item");
    assert.ok(onBow.gates.some((g) => g.id === "G12" && g.reason === "wrong-item"));
    assert.equal((await planOn(sword)).plan.ok, true, "a slashing melee weapon takes it");
});

test("a low-grade silver dagger holds no rune above 8th level (GM Core p.253, 6.6)", async () => {
    const dagger = vera.addItem({ type: "weapon", name: "Silver Dagger", system: { quantity: 1, damage: { damageType: "piercing" }, traits: { value: ["versatile-s"] },
        material: { type: "silver", grade: "low" }, runes: { potency: 2, striking: 1, property: [] } } });
    dagger.traits = new Set(["versatile-s"]);
    const gatesOn = async (uuid) => {
        const [id] = (await orders.requestOrder({ uuid, requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid,
            craftType: "rune-etch", target: dagger.uuid })).orders;
        return gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(uuid), [], settings.rulesFromSettings());
    };
    assert.equal((await gatesOn(FLAMING)).plan.ok, true, "flaming is 8th level: it fits");
    const greater = await gatesOn(GFLAMING);
    assert.deepEqual([greater.plan.ok, greater.plan.reason, greater.plan.data], [false, "grade-rune-level", { grade: "low", max: 8 }], "greater flaming is 15th level");
    assert.ok(greater.gates.some((g) => g.id === "G12" && g.reason === "grade-rune-level" && g.data.max === 8));
});

test("a property rune pf2e has no key for is refused, not charged for a rune that would do nothing (Energy-Resistant)", async () => {
    const armor = vera.addItem({ type: "armor", name: "Leather Armor", system: { quantity: 1, category: "light", group: "leather",
        runes: { potency: 1, resilient: 0, property: [] } } });
    const [id] = (await orders.requestOrder({ uuid: ENERGY, requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid,
        craftType: "rune-etch", target: armor.uuid })).orders;
    const { gates, plan } = await gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(ENERGY), [], settings.rulesFromSettings());
    assert.deepEqual([plan.ok, plan.reason, plan.data], [false, "rune-unsupported", { name: "Energy-Resistant" }]);
    assert.ok(gates.some((g) => g.id === "G12" && g.reason === "rune-unsupported"));
});

test("upgrading flaming to greater flaming on a +1 weapon replaces the rune in its slot, at the difference of the two Prices", async () => {
    const sword = vera.addItem({ type: "weapon", name: "Longsword", system: { quantity: 1, runes: { potency: 1, striking: 1, property: ["flaming"] } } });
    const [id] = (await orders.requestOrder({ uuid: GFLAMING, requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid,
        craftType: "rune-etch", target: sword.uuid })).orders;
    const { gates, plan } = await gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(GFLAMING), [], settings.rulesFromSettings());
    assert.deepEqual([plan.ok, plan.priceCp, plan.change.runes.property], [true, 600000, ["greaterFlaming"]], "6,500 gp less 500 gp; one slot");
    assert.ok(gates.find((g) => g.id === "G12").ok, JSON.stringify(gates.find((g) => g.id === "G12")));
});

test("custody: a member hands over the item to etch, and a cancel puts it on the shelf for them (G10, 4.7)", async () => {
    const sword = bo.addItem({ type: "weapon", name: "Longsword", system: { quantity: 1, runes: { potency: 1, striking: 0, property: [] } } });
    as("p2");
    const [id] = (await orders.requestOrder({ uuid: STRIKING, requester: bo.uuid, craftType: "rune-etch", target: sword.uuid })).orders;
    as("p1");
    await orders.accept(id, vera.uuid);
    const blocked = await gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(STRIKING), [], settings.rulesFromSettings());
    assert.ok(blocked.gates.some((g) => g.id === "G10" && g.reason === "target-not-held"), "the sword is still Bo's");
    assert.equal((await custody.handOver({ order: id, item: sword.uuid, purpose: "target" })).reason, "not-owner", "Vera cannot take Bo's sword");
    as("p2");
    const handed = await custody.handOver({ order: id, item: sword.uuid, purpose: "target" });
    assert.equal(handed.ok, true, JSON.stringify(handed));
    assert.equal(bo.items.get(sword.id), undefined);
    const held = docs.strongbox.items.find((i) => i.type === "weapon");
    assert.deepEqual([held.uuid, held.flags[MOD].earmark.order, held.flags[MOD].earmark.from], [handed.uuid, id, bo.uuid]);
    assert.equal(records("rows").find((r) => r.kind === "custody-in").state, "applied");
    as("p1");
    const open = await gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(STRIKING), [], settings.rulesFromSettings());
    assert.ok(open.gates.find((g) => g.id === "G10").ok, "in the strongbox, earmarked to the order: in custody");
    as("p2");
    assert.equal((await orders.cancel(id)).ok, true);
    assert.equal(docs.strongbox.items.find((i) => i.type === "weapon").flags[MOD].shelf.for, bo.uuid);
    assert.equal(await claims.sweepClaims(), 1);
    const back = bo.items.find((i) => i.type === "weapon");
    assert.ok(back && !back.flags[MOD].earmark && !back.flags[MOD].shelf, "back with Bo, no earmark left");
    assert.equal(docs.strongbox.items.filter((i) => i.type === "weapon").length, 0);
});

test("an etching works on one item, never a stack: a stack on the crafter is refused, and a hand-over takes one from it (G12)", async () => {
    const daggers = vera.addItem({ type: "weapon", name: "Dagger", system: { quantity: 4, runes: { potency: 1, striking: 0, property: [] } } });
    const [own] = (await orders.requestOrder({ uuid: STRIKING, requester: vera.uuid, recipient: { kind: "actor", uuid: vera.uuid }, crafter: vera.uuid,
        craftType: "rune-etch", target: daggers.uuid })).orders;
    assert.equal((await orders.pledgeTo(own, vera.uuid, 3250)).outcome, "ok");
    const refused = await orders.start(own);
    assert.ok(!refused.ok && refused.data.gates.some((g) => g.id === "G12" && g.reason === "target-stack" && g.data.qty === 4), JSON.stringify(refused));
    const bos = bo.addItem({ type: "weapon", name: "Dagger", system: { quantity: 4, runes: { potency: 1, striking: 0, property: [] } } });
    as("p2");
    const [id] = (await orders.requestOrder({ uuid: STRIKING, requester: bo.uuid, craftType: "rune-etch", target: bos.uuid })).orders;
    const handed = await custody.handOver({ order: id, item: bos.uuid, purpose: "target" });
    assert.equal(handed.ok, true, JSON.stringify(handed));
    assert.equal(bo.items.get(bos.id).system.quantity, 3, "three daggers stay with Bo");
    const held = docs.strongbox.items.find((i) => i.name === "Dagger");
    assert.equal(held.system.quantity, 1, "one dagger is held for the order");
    as("p1");
    await orders.accept(id, vera.uuid);
    const { plan } = await gatesFor(read(`orders.${id}`), crafterFacts(vera), await productFacts(STRIKING), [], settings.rulesFromSettings());
    assert.deepEqual([plan.ok, plan.priceCp], [true, 6500], "the striking rune for one dagger");
});

test("precious stock counts toward the up-front half at its Price, lowers the coin commit, and is consumed at the finish (6.6)", async () => {
    const ingot = vera.addItem({ type: "equipment", name: "Cold Iron Ingot", sourceId: IRON, system: { slug: "cold-iron-ingot", quantity: 1, price: { value: { gp: 2 } } },
        traits: new Set(["precious"]) });
    const [id] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 2, requester: vera.uuid, crafter: vera.uuid })).orders;
    const handed = await custody.handOver({ order: id, item: ingot.uuid, purpose: "material" });
    assert.equal(handed.ok, true, JSON.stringify(handed));
    const line = Object.values(read(`orders.${id}.materials`))[0];
    assert.deepEqual([line.material, line.valueCp], ["cold-iron", 200]);
    assert.equal((await orders.pledgeTo(id, vera.uuid, 100)).outcome, "ok");
    assert.equal((await orders.start(id)).ok, true, "200 cp of stock and 100 cp of coins cover the 300 cp up front");
    assert.equal(records("rows").filter((r) => r.kind === "commit").reduce((s, r) => s + r.cp, 0), 100, "the coins commit only the rest");
    await toFinishing(id);
    assert.equal((await orders.pledgeTo(id, vera.uuid, 200)).outcome, "ok");
    const finished = await orders.finish(id);
    assert.equal(finished.ok, true, JSON.stringify(finished));
    assert.equal(docs.strongbox.items.filter((i) => i.name === "Cold Iron Ingot").length, 0, "the stock was used");
    assert.equal(records("rows").filter((r) => r.kind === "material-out").length, 1);
    assert.ok(read(`orders.${id}.materials.${line.id}.used`));
    assert.equal(reconciliationReport().differenceCp, 0);
});

/* -------------------------------------------- */
/*  Services and pledges                         */
/* -------------------------------------------- */

test("a Repair: the performer's Crafting against the item's level DC, Hit Points by rank, the service closed once (6.13)", async () => {
    const shield = vera.addItem({ type: "shield", name: "Steel Shield", level: 0, system: { quantity: 1, hp: { value: 5, max: 20 }, hardness: 5 } });
    const asked = await services.requestService({ kind: "repair", requester: vera.uuid, performer: vera.uuid, target: shield.uuid });
    assert.equal(asked.ok, true);
    const done = await services.perform(asked.service, { skipDialog: true });
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.deepEqual([done.restored, shield.system.hp.value], [15, 20], "an expert restores 5 + 5 x 2");
    assert.equal(read(`services.${asked.service}.status`), "done");
    assert.equal((await services.perform(asked.service)).reason, "state");
    vera.items.delete(vera.items.find((i) => i.name === "Repair Toolkit").id);
    const again = await services.requestService({ kind: "repair", requester: vera.uuid, performer: vera.uuid, target: shield.uuid });
    shield.system.hp.value = 2;
    assert.equal((await services.perform(again.service)).reason, "tool", "no repair toolkit, no Repair");
});

test("casting pledges: the caster's spell, cast before the order may start (G9), and the scroll built with it (6.9)", async () => {
    const heal = bo.addItem({ type: "spell", name: "Heal", sourceId: HEAL, baseRank: 1, traits: new Set(["healing", "vitality"]) });
    as("p2");
    const [id] = (await orders.requestOrder({ uuid: SCROLL1, quantity: 2, requester: bo.uuid })).orders;
    assert.equal(read(`orders.${id}.craftType`), "spell-item");
    as("p1");
    assert.equal((await pledges.pledgeCasting(id, { caster: bo.uuid, spell: heal.uuid, castings: 2 })).reason, "not-owner");
    as("p2");
    const pledged = await pledges.pledgeCasting(id, { caster: bo.uuid, spell: heal.uuid, castings: 2 });
    assert.equal(pledged.ok, true, JSON.stringify(pledged));
    const order = () => read(`orders.${id}`);
    const gate = async () => (await gatesFor(order(), crafterFacts(vera), await productFacts(SCROLL1), [], settings.rulesFromSettings())).gates.find((g) => g.id === "G9");
    assert.equal((await gate()).reason, "spells", "offered, not cast yet");
    assert.equal((await pledges.fulfilPledge(id, pledged.pledge)).ok, true);
    assert.equal((await gate()).ok, true);
    assert.equal((await pledges.fulfilPledge(id, pledged.pledge)).reason, "state", "cast once");
    const built = await spellItemSource(structuredClone(SOURCES[SCROLL1]), order(), { kind: "scroll", rank: 1 });
    assert.equal(built.system.spell.system.location.heightenedLevel, 1);
    assert.deepEqual(built.system.traits.value, ["consumable", "healing", "magical", "scroll", "vitality"]);
    assert.match(built.name, /PF2E\.Item\.Physical\.FromSpell\.Scroll/);
    assert.match(built.system.description.value, /@UUID\[Compendium\.pf2e\.spells-srd\.Item\.healspell0000000\]\{Heal\}/);
});

test("a casting bought at the spellcasting-service price is a fulfilled pledge and a purchase row (Player Core p.295)", async () => {
    as("p2");
    const [id] = (await orders.requestOrder({ uuid: SCROLL1, quantity: 1, requester: bo.uuid })).orders;
    const bought = await pledges.buyCasting(id, { payer: bo.uuid, spell: HEAL, castings: 1 });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.equal(cpOf(bo), 10000 - 300, "a 1st-rank casting costs 3 gp");
    const [pledge] = Object.values(read(`orders.${id}.pledges`));
    assert.deepEqual([pledge.status, pledge.service, pledge.caster], ["fulfilled", true, null]);
});

/* -------------------------------------------- */
/*  After the M5 review                          */
/* -------------------------------------------- */

test("a rune transferred from its own item (pf2e's rune on a runestone): free, the item used up, the rune on the target (GM Core p.225)", async () => {
    const stone = vera.addItem({ type: "equipment", name: "Striking", sourceId: STRIKING,
        system: { slug: "striking", quantity: 1, usage: { value: "etched-onto-a-weapon" }, price: { value: { gp: 65 } } } });
    const sword = vera.addItem({ type: "weapon", name: "Longsword", system: { quantity: 1, runes: { potency: 1, striking: 0, property: [] } } });
    const filed = await orders.requestOrder({ uuid: STRIKING, requester: vera.uuid, crafter: vera.uuid, craftType: "rune-transfer", target: sword.uuid,
        variant: { transfer: { source: stone.uuid } } });
    const [id] = filed.orders;
    const started = await orders.start(id);
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.deepEqual([read(`orders.${id}.priceCp`), read(`orders.${id}.setup.days`)], [0, 1], "free from the rune's own item, one setup day");
    await toFinishing(id);
    const finished = await orders.finish(id);
    assert.equal(finished.ok, true, JSON.stringify(finished));
    assert.equal(vera.items.get(stone.id), undefined, "the rune's item is used up");
    assert.equal(vera.items.get(sword.id).system.runes.striking, 1);
});

test("a blank runestone holds no rune: a transfer from it is refused, whatever rune the order names", async () => {
    const stone = vera.addItem({ type: "consumable", name: "Runestone", system: { slug: "runestone", quantity: 1, price: { value: { gp: 3 } } } });
    const sword = vera.addItem({ type: "weapon", name: "Longsword", system: { quantity: 1, runes: { potency: 1, striking: 0, property: [] } } });
    const [id] = (await orders.requestOrder({ uuid: STRIKING, requester: vera.uuid, crafter: vera.uuid, craftType: "rune-transfer", target: sword.uuid,
        variant: { transfer: { source: stone.uuid } } })).orders;
    const started = await orders.start(id);
    assert.equal(started.ok, false);
    assert.ok(started.data.gates.some((g) => g.id === "G12" && g.reason === "not-there"), JSON.stringify(started.data.gates));
    assert.ok(vera.items.get(stone.id), "the runestone is untouched");
    assert.equal(vera.items.get(sword.id).system.runes.striking, 0);
});

test("stock is taken only before an attempt commits: once the order has started, a hand-over is refused and nothing is lost (6.6)", async () => {
    const [id] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 2, requester: vera.uuid, crafter: vera.uuid })).orders;
    assert.equal((await orders.pledgeTo(id, vera.uuid, 300)).outcome, "ok");
    assert.equal((await orders.start(id)).ok, true);
    const ingot = vera.addItem({ type: "equipment", name: "Cold Iron Ingot", sourceId: IRON, system: { slug: "cold-iron-ingot", quantity: 1, price: { value: { gp: 2 } } },
        traits: new Set(["precious"]) });
    const late = await custody.handOver({ order: id, item: ingot.uuid, purpose: "material" });
    assert.deepEqual([late.ok, late.reason, late.data?.status], [false, "state", "setup"]);
    await toFinishing(id);
    assert.equal((await custody.handOver({ order: id, item: ingot.uuid, purpose: "material" })).reason, "state", "nor while finishing");
    assert.equal((await orders.pledgeTo(id, vera.uuid, 300)).outcome, "ok");
    assert.equal((await orders.finish(id)).ok, true);
    assert.ok(vera.items.get(ingot.id), "the ingot is still Vera's");
    assert.equal(records("rows").filter((r) => r.kind === "material-in" || r.kind === "material-out").length, 0);
});

test("part of a stack of stock is handed over: the rest stays with its owner, and only what was handed over is used up (6.6)", async () => {
    const ingots = vera.addItem({ type: "equipment", name: "Cold Iron Ingot", sourceId: IRON, system: { slug: "cold-iron-ingot", quantity: 5, price: { value: { gp: 2 } } },
        traits: new Set(["precious"]) });
    const [id] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 2, requester: vera.uuid, crafter: vera.uuid })).orders;
    assert.equal((await custody.handOver({ order: id, item: ingots.uuid, purpose: "material", quantity: 6 })).reason, "stack");
    const handed = await custody.handOver({ order: id, item: ingots.uuid, purpose: "material", quantity: 1 });
    assert.equal(handed.ok, true, JSON.stringify(handed));
    assert.equal(vera.items.get(ingots.id)?.system.quantity, 4, "four ingots stay with Vera");
    const line = read(`orders.${id}.materials.${handed.line}`);
    assert.deepEqual([line.qty, line.valueCp], [1, 200]);
    assert.equal(docs.strongbox.items.find((i) => i.name === "Cold Iron Ingot").system.quantity, 1);
    assert.equal((await orders.pledgeTo(id, vera.uuid, 100)).outcome, "ok");
    assert.equal((await orders.start(id)).ok, true);
    await toFinishing(id);
    assert.equal((await orders.pledgeTo(id, vera.uuid, 200)).outcome, "ok");
    assert.equal((await orders.finish(id)).ok, true);
    assert.equal(vera.items.get(ingots.id)?.system.quantity, 4, "the finish used up only the one handed over");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a cancel after a settled success keeps the stock spent; one item is given back once", async () => {
    const ingot = vera.addItem({ type: "equipment", name: "Cold Iron Ingot", sourceId: IRON, system: { slug: "cold-iron-ingot", quantity: 1, price: { value: { gp: 3 } } },
        traits: new Set(["precious"]) });
    const [id] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 2, requester: vera.uuid, crafter: vera.uuid })).orders;
    assert.equal((await custody.handOver({ order: id, item: ingot.uuid, purpose: "material" })).ok, true);
    assert.equal((await orders.start(id)).ok, true, "300 cp of stock covers the up-front half; the coins commit nothing");
    await toFinishing(id);
    assert.equal((await orders.cancel(id)).ok, true);
    assert.equal(docs.strongbox.items.filter((i) => i.name === "Cold Iron Ingot").length, 0, "used by the success, not handed back");
    const iron = vera.addItem({ type: "equipment", name: "Cold Iron Ingot", sourceId: IRON, system: { slug: "cold-iron-ingot", quantity: 1, price: { value: { gp: 3 } } },
        traits: new Set(["precious"]) });
    const [next] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 1, requester: vera.uuid, crafter: vera.uuid })).orders;
    const handed = await custody.handOver({ order: next, item: iron.uuid, purpose: "material" });
    assert.equal((await custody.giveBack({ order: next, line: handed.line })).ok, true);
    assert.equal((await custody.giveBack({ order: next, line: handed.line })).reason, "no-line", "given back once");
    assert.equal(records("rows").filter((r) => r.kind === "material-out" && r.order === next).length, 1);
});

/* -------------------------------------------- */
/*  M5 on M4.1: purchases and stock under fund   */
/*  accounting                                   */
/* -------------------------------------------- */

const balanced = () => fundAccounts(records("rows"), Object.fromEntries(records("orders").map((o) => [o.id, o]))).balanced;
const fundCp = () => unallocatedCp(records("rows"));

/**
 * Two clients planning from the same copy of the ledger: the request `mine` sends is held at the server's door while
 * `other` runs to the end, then let through (as in `funds.test.mjs`).
 */
async function race(mine, other) {
    let theirs = null;
    const restore = interleave(() => true, async () => { theirs = await other(); });
    try {
        return [await mine(), theirs];
    } finally {
        restore();
    }
}

test("a formula bought from the party fund: the strongbox pays out of the unallocated fund, and the identity holds (M5 on M4.1)", async () => {
    assert.equal((await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy", paidFrom: "fund" })).reason, "fund-short",
        "nothing unallocated yet");
    assert.deepEqual([records("rows").length, records("claims").length], [0, 0], "a refused purchase writes no claim");
    as("p2");
    assert.equal((await funds.deposit(bo.uuid, 5000)).outcome, "ok");
    as("p1");
    const result = await formulas.acquire({ learner: vera.uuid, uuid: ELIXIR, route: "buy", paidFrom: "fund" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bookOf(vera), [ELIXIR]);
    assert.deepEqual([cpOf(vera), cpOf(docs.strongbox), fundCp()], [10000, 4900, 4900], "Vera's purse is untouched; the strongbox paid 1 gp");
    const row = records("rows").find((r) => r.kind === "purchase");
    assert.deepEqual([row.box, row.purse, row.alloc, row.actor, row.order, row.author], [-100, 0, -100, null, null, "p1"],
        "the party fund is the source; the row records who spent it");
    assert.equal(read(provenancePath(vera.id, ELIXIR)).row, row.id);
    assert.equal(balanced(), true, "strongbox = unallocated + earmarked");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a casting bought from the party fund is earmarked for the order and spent by it: spent by the fund, nothing left earmarked (M5 on M4.1)", async () => {
    as("p2");
    assert.equal((await funds.deposit(bo.uuid, 1000)).outcome, "ok");
    const [id] = (await orders.requestOrder({ uuid: SCROLL1, quantity: 1, requester: bo.uuid })).orders;
    const bought = await pledges.buyCasting(id, { paidFrom: "fund", spell: HEAL, castings: 1 });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.deepEqual([cpOf(bo), cpOf(docs.strongbox), fundCp()], [9000, 700, 700], "3 gp out of the strongbox and the unallocated fund");
    const orderRows = records("rows").filter((r) => r.order === id);
    assert.deepEqual(allocationsByContributor(orderRows), [], "earmarked and spent in one move: nothing stays earmarked");
    assert.deepEqual(spentBySource(orderRows), [{ actor: null, cp: 300 }], "the order shows it spent by the party fund");
    const [pledge] = Object.values(read(`orders.${id}.pledges`));
    assert.deepEqual([pledge.status, pledge.paidFrom, pledge.payer, pledge.costCp], ["fulfilled", "fund", null, 300]);
    assert.equal(balanced(), true);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a spell's cost is paid from the source chosen when the casting is marked done; refused, the casting stays offered (M5 on M4.1)", async () => {
    const heal = bo.addItem({ type: "spell", name: "Heal", sourceId: HEAL, baseRank: 1, traits: new Set(["healing", "vitality"]) });
    as("p2");
    const [id] = (await orders.requestOrder({ uuid: SCROLL1, quantity: 1, requester: bo.uuid })).orders;
    const pledged = await pledges.pledgeCasting(id, { caster: bo.uuid, spell: heal.uuid, castings: 1 });
    const short = await pledges.fulfilPledge(id, pledged.pledge, { costCp: 50, paidFrom: "fund" });
    assert.deepEqual([short.ok, short.reason], [false, "fund-short"]);
    assert.equal(read(`orders.${id}.pledges.${pledged.pledge}.status`), "offered", "the cost and the casting land together or not at all");
    assert.equal((await funds.deposit(bo.uuid, 200)).outcome, "ok");
    const cast = await pledges.fulfilPledge(id, pledged.pledge, { costCp: 50, paidFrom: "fund" });
    assert.equal(cast.ok, true, JSON.stringify(cast));
    const pledge = read(`orders.${id}.pledges.${pledged.pledge}`);
    assert.deepEqual([pledge.status, pledge.costCp, pledge.paidFrom, pledge.payer], ["fulfilled", 50, "fund", null]);
    assert.deepEqual([cpOf(docs.strongbox), fundCp(), balanced()], [150, 150, true]);
});

test("a purchase from the party fund and an earmark of the same money planned from one copy: only one lands (M5 on M4.1)", async () => {
    as("p2");
    assert.equal((await funds.deposit(bo.uuid, 300)).outcome, "ok");
    const [scroll] = (await orders.requestOrder({ uuid: SCROLL1, quantity: 1, requester: bo.uuid })).orders;
    const [elixir] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 1, requester: bo.uuid })).orders;
    const [mine, theirs] = await race(() => pledges.buyCasting(scroll, { paidFrom: "fund", spell: HEAL, castings: 1 }),
        asUser("p1", () => funds.fundFromParty(elixir, 300)));
    assert.deepEqual([theirs.ok, mine.ok], [true, false], JSON.stringify({ mine, theirs }));
    assert.deepEqual([fundCp(), cpOf(docs.strongbox), balanced()], [0, 300, true], "the 3 gp went to the elixir once, and nothing was bought");
    assert.deepEqual(Object.keys(read(`orders.${scroll}.pledges`) ?? {}), [], "no casting recorded without its payment");
    assert.equal((await pledges.buyCasting(scroll, { paidFrom: "fund", spell: HEAL, castings: 1 })).reason, "fund-short", "planned again from fresh data");
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("a formula copy's cost goes back to its source on a cancel: the party fund at once, a purse by its owner (M5 on M4.1)", async () => {
    world.settings.set(`${MOD}.rules.allyCopyCostCp`, 200);
    vera.system.crafting.formulas = [{ uuid: ELIXIR }];
    as("p2");
    assert.equal((await funds.deposit(bo.uuid, 500)).outcome, "ok");
    const asked = await services.requestService({ kind: "formula-copy", requester: bo.uuid, performer: vera.uuid, uuid: ELIXIR, paidFrom: "fund" });
    assert.equal(asked.ok, true, JSON.stringify(asked));
    assert.deepEqual([fundCp(), cpOf(docs.strongbox)], [300, 300]);
    assert.equal(read(`services.${asked.service}.payment.source`), "fund");
    const cancelled = await services.cancel(asked.service);
    assert.deepEqual([cancelled.ok, cancelled.refunded], [true, true]);
    assert.deepEqual([fundCp(), cpOf(docs.strongbox), balanced()], [500, 500, true], "refunded to the party fund");
    const purse = await services.requestService({ kind: "formula-copy", requester: bo.uuid, performer: vera.uuid, uuid: ELIXIR });
    assert.equal(cpOf(bo), 10000 - 500 - 200, "from Bo's purse by default");
    as("p1");
    assert.deepEqual((({ ok, refunded }) => [ok, refunded])(await services.cancel(purse.service)), [true, false],
        "Vera's player cancels, but cannot write Bo's purse");
    as("p2");
    const row = records("rows").find((r) => r.id === read(`services.${purse.service}.payment.row`));
    assert.equal((await funds.reverse(row.id)).ok, true, "Bo's player reverses it in the Funds ledger");
    assert.equal(cpOf(bo), 10000 - 500);
    assert.equal(reconciliationReport().differenceCp, 0);
});

test("stock lowers what Fund this order fills: the up-front half less the stock, from the party fund (M5 on M4.1)", async () => {
    const ingot = vera.addItem({ type: "equipment", name: "Cold Iron Ingot", sourceId: IRON, system: { slug: "cold-iron-ingot", quantity: 1, price: { value: { gp: 2 } } },
        traits: new Set(["precious"]) });
    const [id] = (await orders.requestOrder({ uuid: ELIXIR, quantity: 2, requester: vera.uuid, crafter: vera.uuid })).orders;
    assert.equal(funds.shortfallFor(id).shortCp, 300, "3 gp up front before any stock");
    assert.equal((await custody.handOver({ order: id, item: ingot.uuid, purpose: "material" })).ok, true);
    assert.deepEqual((({ phase, needCp, shortCp }) => [phase, needCp, shortCp])(funds.shortfallFor(id)), ["upfront", 100, 100],
        "2 gp of the half is in stock");
    as("p2");
    assert.equal((await funds.deposit(bo.uuid, 100)).outcome, "ok");
    as("p1");
    assert.equal((await funds.fundOrder(id, { source: "fund", cp: 100 })).ok, true);
    assert.equal(funds.shortfallFor(id).shortCp, 0);
    assert.equal((await orders.start(id)).ok, true);
    const accounts = fundAccounts(records("rows"), Object.fromEntries(records("orders").map((o) => [o.id, o])));
    assert.deepEqual(accounts.orders.map((o) => [o.earmarkedCp, o.stock]), [[100, [{ actor: vera.uuid, cp: 200 }]]], "the stock beside the money");
    assert.equal(accounts.balanced, true, "stock is items, outside the identity");
});
