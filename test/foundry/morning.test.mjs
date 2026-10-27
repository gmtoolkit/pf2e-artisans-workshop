/**
 * Daily preparations over the fake world (DESIGN.md 4.11, 7.1-7.10, M7): the sources a character prepares from, a
 * preparation through pf2e's own methods (loadouts by family, virtual talismans, standing orders), what a run made and
 * its stamps (split stacks, the Dabbler DC stamp), party-wide expiry with its exceptions, the cycle raised once, rest
 * ordering with and without pf2e-dailies, the pf2e-dailies custom daily, the inert guard and the affix rule with
 * Talismanic Sage.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { addDocument, coin, flagsOf, installFoundry, setUsers, sharedWorld, world, resetWorld } from "./stubs.mjs";
import { asCharacter, compendiumItem, predicate } from "./pf2e-crafting.mjs";

installFoundry();
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { RANK } = await import("../../scripts/logic/core.mjs");
const { familyKey } = await import("../../scripts/logic/families.mjs");
const { ADVANCED_ALCHEMY_SECONDS } = await import("../../scripts/logic/expiry.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const { resetCatalogue } = await import("../../scripts/foundry/catalogue.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const dailies = await import("../../scripts/foundry/dailies.mjs");
const downtime = await import("../../scripts/foundry/downtime.mjs");
const expiry = await import("../../scripts/foundry/expiry.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const morning = await import("../../scripts/foundry/morning.mjs");
const rest = await import("../../scripts/foundry/rest.mjs");
const services = await import("../../scripts/foundry/services.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records, write } = await import("../../scripts/foundry/store.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const MOD = "pf2e-artisans-workshop";

let docs;
let vera;
let bo;
let items;
const stampOf = (item) => item?.flags?.[MOD]?.expiry ?? null;
const named = (actor, name) => actor.items.filter((i) => i.name === name);

/** The compendium: elixir grades, a bomb, talismans of several levels, one from GM Core with an inline save. */
function seedCompendium() {
    world.index = [];
    world.compendium = {};
    const healing = ["alchemical", "consumable", "elixir", "healing"];
    return {
        minor: compendiumItem({ id: "elixirMinor00001", name: "Elixir of Life (Minor)", level: 1, traits: healing }),
        lesser: compendiumItem({ id: "elixirLesser0001", name: "Elixir of Life (Lesser)", level: 5, traits: healing }),
        moderate: compendiumItem({ id: "elixirModerate01", name: "Elixir of Life (Moderate)", level: 9, traits: healing }),
        fire: compendiumItem({ id: "alchemistsFire01", name: "Alchemist's Fire (Lesser)", level: 1, type: "weapon", category: "bomb", traits: ["alchemical", "bomb", "consumable"] }),
        crystal: compendiumItem({ id: "potencyCrystal01", name: "Potency Crystal", level: 1, category: "talisman", traits: ["consumable", "magical", "talisman"], book: "Pathfinder GM Core" }),
        fear: compendiumItem({ id: "fearGem000000001", name: "Fear Gem", level: 4, category: "talisman", traits: ["consumable", "magical", "talisman"],
            description: "<p>@Check[will|dc:20] or frightened 1.</p>", book: "Pathfinder GM Core" }),
        jade: compendiumItem({ id: "jadeCat000000001", name: "Jade Cat", level: 2, category: "talisman", traits: ["consumable", "magical", "talisman"], book: "Pathfinder Player Core 2" }),
        high: compendiumItem({ id: "highTalisman0001", name: "Owlbear Claw", level: 8, category: "talisman", traits: ["consumable", "magical", "talisman"], book: "Pathfinder GM Core" }),
        uncommon: compendiumItem({ id: "rareTalisman0001", name: "Rare Charm", level: 1, category: "talisman", traits: ["consumable", "magical", "talisman"], rarity: "uncommon" }),
    };
}

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    downtime.resetDowntime();
    resetCatalogue();
    morning.resetMorning();
    expiry.resetExpiry();
    rest.resetRest();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    docs = sharedWorld();
    items = seedCompendium();
    game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => world.index }]]);
    vera = addDocument("Actor", { name: "Vera", type: "character", ownership: { default: 0, p1: 3 }, items: [
        { type: "feat", name: "Talisman Dabbler Dedication", sourceId: REGISTRY["talisman-dabbler-dedication"].uuid },
        { type: "feat", name: "Food Preservation", sourceId: REGISTRY["food-preservation"].uuid },
        { type: "feat", name: "Alter Admixture", sourceId: REGISTRY["alter-admixture"].uuid },
        { type: "feat", name: "Scroll Adept", sourceId: REGISTRY["scroll-adept"].uuid },
        { type: "feat", name: "Versatile Vials", sourceId: REGISTRY["versatile-vials"].uuid },
        { type: "equipment", name: "Versatile Vial", sourceId: "Compendium.pf2e.equipment-srd.Item.vial000000000001", system: { quantity: 5, level: { value: 4 } } },
    ] });
    asCharacter(vera, { level: 10, formulas: [items.minor.uuid, items.fire.uuid], classDc: 28, spellDc: 24,
        vials: { itemUUID: "Compendium.pf2e.equipment-srd.Item.vial000000000001", value: 4, max: 6 },
        rules: [
            { key: "CraftingAbility", slug: "advanced-alchemy", maxSlots: "4 + @actor.system.abilities.int.mod", resolveValue: () => 8, item: { slug: "advanced-alchemy", name: "Advanced Alchemy" } },
            { key: "CraftingAbility", slug: "advanced-alchemy", maxSlots: 4, resolveValue: (v) => v, item: { slug: "poisoner-dedication", name: "Poisoner Dedication" } },
        ] });
    vera.skills = { crafting: { slug: "crafting", rank: RANK.expert } };
    vera.crafting.add({ slug: "advanced-alchemy", label: "Advanced Alchemy", maxSlots: 4, maxItemLevel: 10, batchSize: 2,
        craftableItems: [predicate("item:trait:alchemical", "item:trait:consumable")] });
    vera.crafting.add({ slug: "talisman-dabbler", label: "Talisman Dabbler", maxSlots: 2, maxItemLevel: 5, batchSize: 1, craftableItems: [predicate("item:trait:talisman")] });
    vera.crafting.add({ slug: "snarecrafter", label: "Snares", isDailyPrep: false, isPrepared: true, maxSlots: 4, craftableItems: [predicate("item:trait:snare")] });
    bo = addDocument("Actor", { name: "Bo", type: "character", ownership: { default: 0, p2: 3 }, items: [] });
    asCharacter(bo, { level: 8 });
    world.collections.Actor.party = { id: "party", members: [vera, bo] };
    ChatMessage.implementation.getSpeaker = () => ({});
    game.time.worldTime = 0;
    game.pf2e = { settings: { variants: { pwol: { enabled: false } } } };
    game.i18n.has = () => false;
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
});
afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    expiry.resetExpiry();
    rest.resetRest();
});

/** As another user (client), then back. */
async function as(user, action) {
    const me = world.currentUser;
    world.currentUser = user;
    try {
        return await action();
    } finally {
        world.currentUser = me;
    }
}

/** Raise a character's cycle as a rest would (7.8). */
const rested = (actor, key) => expiry.beginCycle(actor, { key });

/* -------------------------------------------- */
/*  Sources (7.1)                                */
/* -------------------------------------------- */

test("the Morning reads every daily source from the system: pools with their sources, other slots, vials, talisman picker, gaps (7.1)", async () => {
    const facts = await morning.morningFacts(vera);
    assert.deepEqual(facts.pools.map((p) => p.slug), ["advanced-alchemy", "talisman-dabbler"]);
    const aa = facts.pools[0];
    assert.deepEqual(aa.sources.map((s) => [s.name, s.maxSlots]), [["Advanced Alchemy", 8], ["Poisoner Dedication", 4]], "each source's own count, from its rule element");
    assert.equal(aa.merged.winners.maxSlots, "advanced-alchemy");
    assert.deepEqual(facts.slots.map((s) => s.slug), ["snarecrafter"], "snares are prepared slots, shown read-only");
    const dabbler = facts.pools[1];
    assert.deepEqual(dabbler.offered.map((i) => i.name), ["Fear Gem", "Jade Cat", "Potency Crystal"],
        "common talismans up to half the level (5), best first; none written to the book");
    assert.ok(!vera.system.crafting.formulas.some((f) => dabbler.offered.some((o) => o.uuid === f.uuid)), "the virtual list is not in the book");
    assert.equal(dabbler.dcStamp, true);
    assert.deepEqual([facts.vials.value, facts.vials.max, facts.vials.inventory, facts.vials.consistent], [4, 6, 5, false],
        "the resource counts; a vial item holding more is pointed out");
    assert.deepEqual(facts.gaps.map((g) => [g.key, g.flow, g.automated]),
        [["alter-admixture", "note", true], ["food-preservation", "designate", true], ["scroll-adept", "dailies", false]]);
    assert.equal(facts.state, "fresh");
});

/* -------------------------------------------- */
/*  Preparing (7.1, 7.5)                         */
/* -------------------------------------------- */

test("a loadout's family resolves to the best grade the pool allows; the grade is written to the book by family; pf2e makes and the run is stamped (7.5, 7.7)", async () => {
    const saved = await morning.saveLoadout(vera, { name: "Healer", pools: { "advanced-alchemy": [{ family: familyKey(items.minor), qty: 4 }, { family: familyKey(items.fire), qty: 2 }] } });
    assert.equal(saved.ok, true);
    const fired = [];
    Hooks.on(`${MOD}.preparationCompleted`, (payload) => fired.push(payload));
    game.time.worldTime = 5000;
    const result = await morning.applyMorning(vera, { pools: { "advanced-alchemy": { mode: "loadout", id: saved.id } } });
    assert.equal(result.ok, true, JSON.stringify(result));
    const ability = vera.crafting.abilities.get("advanced-alchemy");
    assert.deepEqual(ability.calls.filter((c) => c[0] === "setFormulaQuantity").map((c) => [c[1], c[2]]), [[items.moderate.uuid, 4], [items.fire.uuid, 2]],
        "quantities set through setFormulaQuantity: the moderate grade at level 10, covered by the minor formula");
    assert.ok(vera.system.crafting.formulas.some((f) => f.uuid === items.moderate.uuid), "the grade is in the book");
    const provenance = Object.values(read(`formulas.${vera.id}`) ?? {});
    assert.deepEqual(provenance.map((p) => [p.uuid, p.route]), [[items.moderate.uuid, "family"]]);
    assert.equal(vera.crafting.performed, 1);
    const elixirs = named(vera, "Elixir of Life (Moderate)");
    assert.equal(elixirs.length, 1);
    assert.equal(elixirs[0].quantity, 4);
    assert.deepEqual(stampOf(elixirs[0]), { creator: vera.uuid, cycle: 0, rule: "prep", pool: "advanced-alchemy", at: 5000 + ADVANCED_ALCHEMY_SECONDS, atDay: 1 });
    assert.ok(elixirs[0].system.traits.value.includes("infused"));
    assert.equal(flagsOf(vera).morning.cycle, 0);
    assert.deepEqual(flagsOf(vera).morning.created.length, 2);
    assert.equal(fired.length, 1);
    assert.equal(fired[0].cycle, 0);
    const again = await morning.applyMorning(vera, {});
    assert.equal(again.reason, "prepared", "one preparation per cycle unless asked for a new day");
});

test("a plan the pool cannot hold changes nothing, not even the cycle (7.5)", async () => {
    const result = await morning.applyMorning(vera, { pools: { "advanced-alchemy": { mode: "set", entries: [{ family: familyKey(items.minor), qty: 12 }] } } });
    assert.equal(result.reason, "plan");
    assert.equal(result.data.problems[0].reason, "slots");
    assert.equal(vera.crafting.performed, 0);
    assert.equal(downtime.statusOf(vera).prepCycle, 0);
});

test("output merged into another creator's stack is split into its own item before stamping; theirs keeps its count and stamp (7.1 step 3)", async () => {
    const theirs = { creator: bo.uuid, cycle: 7, rule: "prep", pool: "advanced-alchemy", at: 99999, atDay: 9 };
    const given = items.minor.toObject();
    delete given._id;
    Object.assign(given.system, { quantity: 2, temporary: true, traits: { ...given.system.traits, value: [...given.system.traits.value, "infused"].sort() } });
    given.flags = { [MOD]: { expiry: theirs } };
    const [held] = await vera.createEmbeddedDocuments("Item", [given]);
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 2 }];
    const result = await morning.applyMorning(vera, {});
    assert.equal(result.ok, true, JSON.stringify(result));
    const minors = named(vera, "Elixir of Life (Minor)");
    assert.equal(minors.length, 2, "split into its own item");
    assert.equal(vera.items.get(held.id).quantity, 2, "Bo's two are still two");
    assert.deepEqual(stampOf(vera.items.get(held.id)), theirs);
    const mine = minors.find((i) => i.id !== held.id);
    assert.equal(mine.quantity, 2);
    assert.equal(stampOf(mine).creator, vera.uuid);
});

test("virtual talismans: made with craft() without a book, slots counted; Talisman Dabbler's get the DC stamp (7.4)", async () => {
    const result = await morning.applyMorning(vera, { talismans: { "talisman-dabbler": [items.fear.uuid, items.crystal.uuid] } });
    assert.equal(result.ok, true, JSON.stringify(result));
    const dabbler = vera.crafting.abilities.get("talisman-dabbler");
    assert.deepEqual(dabbler.calls.filter((c) => c[0] === "craft").map((c) => [c[1], c[2]]), [[items.fear.uuid, false], [items.crystal.uuid, false]]);
    assert.ok(!vera.system.crafting.formulas.some((f) => f.uuid === items.fear.uuid), "no formula written to the book (Player Core 2: no book needed)");
    const gem = named(vera, "Fear Gem")[0];
    assert.equal(stampOf(gem).pool, "talisman-dabbler");
    assert.equal(stampOf(gem).at, undefined, "talismans last until the next preparations, no 24 hours");
    assert.match(gem.system.description.value, /@Check\[will\|dc:28\]/, "the highest of class DC 28 and spell DC 24");
    assert.deepEqual(gem.flags[MOD].dcStamp, { dc: 28, printed: [20], pool: "talisman-dabbler", by: vera.uuid });
    const three = await morning.applyMorning(vera, { again: true, talismans: { "talisman-dabbler": [items.fear.uuid, items.crystal.uuid, items.jade.uuid] } });
    assert.equal(three.reason, "plan", "three talismans for two slots");
    const high = await morning.applyMorning(vera, { again: true, talismans: { "talisman-dabbler": [items.high.uuid] } });
    assert.equal(high.data.problems[0].reason, "not-offered", "level 8 is above half the level");
});

test("pf2e's craft() adds to a stack without waiting: the run waits for the quantity before stamping (7.1)", async () => {
    const result = await morning.applyMorning(vera, { talismans: { "talisman-dabbler": [items.jade.uuid] } });
    assert.equal(result.ok, true);
    const jade = named(vera, "Jade Cat")[0];
    // Two of one talisman: the second craft() stacks onto the first with an update pf2e does not await.
    await vera.update({ [`flags.${MOD}.morning.cycle`]: -1 });
    const twice = await morning.applyMorning(vera, { again: true, talismans: { "talisman-dabbler": [items.crystal.uuid, items.crystal.uuid] } });
    assert.equal(twice.ok, true, JSON.stringify(twice));
    const crystals = named(vera, "Potency Crystal");
    assert.equal(crystals.length, 1);
    assert.equal(crystals[0].quantity, 2, "both landed");
    assert.equal(twice.created.find((c) => c.id === crystals[0].id).qty, 2);
    assert.ok(jade);
});

/* -------------------------------------------- */
/*  Standing orders (7.6)                        */
/* -------------------------------------------- */

test("a standing order from Bo's player is filled at Vera's preparation and lands on the pickup shelf for Bo; once per cycle (7.6)", async () => {
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 2 }];
    const placed = await as("p2", () => morning.placeStanding({ requester: bo.uuid, crafter: vera.uuid, uuid: items.minor.uuid, qty: 2 }));
    assert.equal(placed.ok, true, JSON.stringify(placed));
    const facts = await morning.morningFacts(vera);
    const plan = morning.planMorning(facts, {});
    assert.deepEqual(plan.due.map((s) => s.id), [placed.id]);
    const result = await morning.applyMorning(vera, {});
    assert.equal(result.ok, true, JSON.stringify(result));
    const minorsOnVera = named(vera, "Elixir of Life (Minor)");
    assert.equal(minorsOnVera.reduce((n, i) => n + i.quantity, 0), 2, "Vera's own two stay; the order's two left");
    const shelf = docs.strongbox.items.filter((i) => i.flags?.[MOD]?.shelf);
    assert.equal(shelf.length, 1);
    assert.equal(shelf[0].quantity, 2);
    assert.equal(shelf[0].flags[MOD].shelf.for, bo.uuid);
    assert.equal(stampOf(shelf[0]).creator, vera.uuid, "the stamp travels with the items");
    assert.equal(read(`standing.${placed.id}.last.cycle`), 0);
    assert.equal(result.deliveries[0].direct, false);
    // The same cycle never delivers twice: the order is filled.
    const replanned = morning.planMorning(await morning.morningFacts(vera), {});
    assert.deepEqual(replanned.pools["advanced-alchemy"]?.lines?.flatMap((l) => l.standing) ?? [], []);
    // Ending it: the requester's player.
    assert.equal((await as("p2", () => morning.endStanding(placed.id))).ok, true);
    assert.equal(read(`standing.${placed.id}.active`), false);
});

test("a standing order for a character this user owns is delivered straight into its inventory (7.6)", async () => {
    vera.ownership.p1 = 3;
    bo.ownership.p1 = 3;
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [];
    const placed = await morning.placeStanding({ requester: bo.uuid, crafter: vera.uuid, uuid: items.minor.uuid, qty: 2 });
    const result = await morning.applyMorning(vera, {});
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(named(bo, "Elixir of Life (Moderate)")[0]?.quantity, 2, "the family's best grade Vera makes at level 10");
    assert.equal(named(vera, "Elixir of Life (Moderate)").length, 0, "all of it went: the stack is gone from Vera");
    assert.equal(result.created[0].name, "Elixir of Life (Moderate)", "named before it left, for the card");
    assert.equal(result.deliveries[0].direct, true);
    assert.ok(placed.ok);
});

test("a standing order that does not fit is left out for today; it never blocks the crafter's own preparation (review fix, 7.6)", async () => {
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 8 }];
    const placed = await as("p2", () => morning.placeStanding({ requester: bo.uuid, crafter: vera.uuid, uuid: items.fire.uuid, qty: 2 }));
    const result = await morning.applyMorning(vera, {});
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.problems.map((p) => [p.reason, p.standing]), [["standing-slots", placed.id]]);
    assert.equal(named(vera, "Elixir of Life (Minor)")[0]?.quantity, 8, "the crafter's own four batches are made");
    assert.equal(read(`standing.${placed.id}.last`), null, "the order was not filled today");
});

test("output split off another creator's stack carries only this run's flags, not the stack's delivery or inert marks (review fix, 7.1)", async () => {
    const given = items.minor.toObject();
    delete given._id;
    Object.assign(given.system, { quantity: 1, temporary: true, traits: { ...given.system.traits, value: [...given.system.traits.value, "infused"].sort() } });
    given.flags = { [MOD]: { expiry: { creator: bo.uuid, cycle: 3, rule: "prep", pool: "advanced-alchemy" }, delivered: { row: "r1" }, inertFrom: { name: "x" } } };
    await vera.createEmbeddedDocuments("Item", [given]);
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 2 }];
    assert.equal((await morning.applyMorning(vera, {})).ok, true);
    const mine = named(vera, "Elixir of Life (Minor)").find((i) => stampOf(i).creator === vera.uuid);
    assert.deepEqual(Object.keys(mine.flags[MOD]), ["expiry"]);
});

test("when pf2e refuses its daily crafting, nothing is recorded and the player may prepare again (review fix, 7.1)", async () => {
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 20 }];
    const result = await morning.applyMorning(vera, {});
    assert.equal(result.reason, "system");
    assert.equal(flagsOf(vera).morning?.cycle, undefined, "not prepared in this cycle");
    assert.equal(flagsOf(vera).morning?.applying, null);
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 2 }];
    assert.equal((await morning.applyMorning(vera, {})).ok, true);
});

test("Advanced Vials' buckets follow the resource at a preparation; the vial item is never made again (7.3)", async () => {
    const vial = vera.items.find((i) => i.name === "Versatile Vial");
    await vial.update({ [`flags.${MOD}.vialMaterials`]: { plain: 3, silver: 3 } });
    assert.equal((await morning.applyMorning(vera, {})).ok, true);
    assert.deepEqual(vera.items.get(vial.id).flags[MOD].vialMaterials, { silver: 3, plain: 1 }, "four vials: plain ones go first");
});

/* -------------------------------------------- */
/*  Party-wide expiry (7.7)                      */
/* -------------------------------------------- */

test("party-wide expiry: Vera's next cycle makes the elixir Bo holds inert, on Bo's client only; the strongbox on Vera's (7.7)", async () => {
    const stamp = { creator: vera.uuid, cycle: 0, rule: "prep", pool: "advanced-alchemy", at: 10 * ADVANCED_ALCHEMY_SECONDS, atDay: 99 };
    bo.addItem({ type: "consumable", name: "Elixir of Life (Minor)", system: { quantity: 1, temporary: true }, flags: { [MOD]: { expiry: stamp } } });
    docs.strongbox.addItem({ type: "consumable", name: "Elixir of Life (Minor)", system: { quantity: 1, temporary: true }, flags: { [MOD]: { expiry: stamp } } });
    expiry.registerExpiryHooks();
    const begun = await rested(vera, "rest-1");
    assert.deepEqual([begun.ok, begun.cycle], [true, 1]);
    const claim = records("claims").find((c) => c.kind === "expiry");
    assert.equal(claim.actor, vera.uuid);
    // Vera's client (p1): responsible for Vera, so for the strongbox's share of her items; not for Bo (Bo's player is connected).
    const mine = await expiry.expirySweep();
    assert.deepEqual(mine.map((m) => m.holder), [docs.strongbox.uuid], "the strongbox's share is the creator's client's");
    assert.equal(docs.strongbox.items.contents.find((i) => i.name.includes("Elixir"))?.flags[MOD].inert, true);
    assert.equal((await claims.applyClaim(claim, vera)).ok, true, "the expiry claim finds nothing left and is resolved");
    assert.ok(read(`claims.${claim.id}.resolved`));
    // Bo's client.
    await as("p2", async () => {
        resetLease();
        requestLease("p2");
        const theirs = await expiry.expirySweep();
        assert.equal(theirs.length, 1);
    });
    const elixir = bo.items.contents[0];
    assert.equal(elixir.flags[MOD].inert, true);
    assert.equal(elixir.name, "pf2e-artisans-workshop.Expiry.InertName {\"name\":\"Elixir of Life (Minor)\"}");
    assert.equal(elixir.flags[MOD].inertFrom.reason, "cycle");
    await as("p2", async () => assert.deepEqual(await expiry.expirySweep(), [], "never marked twice"));
});

test("Advanced Alchemy items expire after 24 hours or the next logged day; exceptions never; the delete setting deletes (7.7)", async () => {
    const at = (extra) => ({ creator: vera.uuid, cycle: 0, rule: "prep", pool: "advanced-alchemy", at: ADVANCED_ALCHEMY_SECONDS, atDay: 1, ...extra });
    const a = vera.addItem({ type: "consumable", name: "A", system: { quantity: 1 }, flags: { [MOD]: { expiry: at() } } });
    const b = vera.addItem({ type: "consumable", name: "B", system: { quantity: 1 }, flags: { [MOD]: { expiry: at({ at: 9 * ADVANCED_ALCHEMY_SECONDS }) } } });
    const c = vera.addItem({ type: "consumable", name: "C", system: { quantity: 1 }, flags: { [MOD]: { expiry: at({ exempt: { key: "food-preservation" } }) } } });
    game.time.worldTime = ADVANCED_ALCHEMY_SECONDS - 1;
    assert.deepEqual(await expiry.expirySweep(), []);
    game.time.worldTime = ADVANCED_ALCHEMY_SECONDS;
    const out = await expiry.expirySweep();
    assert.deepEqual(out[0].items.map((i) => [i.name, i.reason]), [["A", "time"]]);
    await write({ set: { "meta.manual.r1": { id: "r1", v: 1, fromDay: 0, toDay: 1 } } });
    await game.settings.set(MOD, "expiry.action", "delete");
    const logged = await expiry.expirySweep();
    assert.deepEqual(logged[0].items.map((i) => [i.name, i.reason]), [["B", "day"]]);
    assert.equal(vera.items.get(b.id), undefined, "deleted under the other setting");
    assert.ok(vera.items.get(c.id), "the preserved one stays");
    assert.ok(vera.items.get(a.id));
});

test("the cycle goes up once per rest, and once per cycle across two devices (7.7)", async () => {
    assert.equal((await rested(vera, "m1")).cycle, 1);
    assert.equal((await rested(vera, "m1")).outcome, "already", "the same rest message");
    // A second device that read cycle 1 raises it from 1 again: its lock page is taken.
    await rested(vera, "m2");
    assert.equal(downtime.statusOf(vera).prepCycle, 2);
    const stale = expiry.cycleLockId(vera.id, 1);
    assert.ok(docs.ledger.pages.get(stale), "the lock page of the cycle left");
    await write({ set: { [`pcs.${vera.id}.prepCycle`]: 1, [`pcs.${vera.id}.cycleKey`]: "x" } });
    const late = await rested(vera, "m3");
    assert.equal(late.outcome, "already", "raising from 1 a second time is refused at its lock");
});

test("preparing again begins a new cycle and un-expends the pools through pf2e; last cycle's items expire (7.2, 7.7)", async () => {
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 2 }];
    assert.equal((await morning.applyMorning(vera, {})).ok, true);
    const first = named(vera, "Elixir of Life (Minor)")[0];
    const again = await morning.applyMorning(vera, { again: true });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(again.cycle, 1);
    assert.ok(vera.crafting.abilities.get("advanced-alchemy").calls.some((c) => c[0] === "updateFormulas"), "un-expended with updateFormulas");
    await expiry.expirySweep();
    assert.equal(vera.items.get(first.id).flags[MOD].inert, true);
    const fresh = named(vera, "Elixir of Life (Minor)").filter((i) => !i.flags[MOD].inert);
    assert.equal(fresh.length, 1);
    assert.equal(stampOf(fresh[0]).cycle, 1);
});

test("Food Preservation: designated foods are exempt; past the cap the oldest spoil (7.7)", async () => {
    const food = (name) => Object.assign(vera.addItem({ type: "consumable", name, system: { quantity: 1 },
        flags: { [MOD]: { expiry: { creator: vera.uuid, cycle: 0, rule: "prep", pool: "advanced-alchemy" } } } }), { getRollOptions: () => ["item:tag:alchemical-food"] });
    const [x, y, z, w, v] = [food("X"), food("Y"), food("Z"), food("W"), food("V")];
    assert.deepEqual(morning.preservable(vera).map((i) => i.name), ["X", "Y", "Z", "W", "V"]);
    assert.equal((await morning.preserve(vera, [x.id, y.id])).ok, true, "two at expert");
    assert.equal((await morning.preserve(vera, [z.id, w.id, v.id])).reason, "too-many", "never more than the cap at once");
    const third = await morning.preserve(vera, [z.id]);
    assert.deepEqual(third.spoiled, [x.id], "the oldest spoils");
    assert.equal(stampOf(vera.items.get(x.id)).exempt, null);
    assert.equal(stampOf(vera.items.get(z.id)).exempt.key, "food-preservation");
    await write({ set: { [`pcs.${vera.id}`]: { id: vera.id, v: 1, prepCycle: 1 } } });
    const out = await expiry.expirySweep();
    assert.deepEqual(out[0].items.map((i) => i.name).sort(), ["V", "W", "X"], "the spoiled one expires with the rest; the preserved two stay");
});

test("the inert guard cancels a message that uses an inert item, with a notice (OQ-19)", async () => {
    expiry.registerExpiryHooks();
    const item = vera.addItem({ type: "consumable", name: "Old", flags: { [MOD]: { inert: true } } });
    const ok = Hooks.call("preCreateChatMessage", { flags: { pf2e: { origin: { uuid: item.uuid } } } });
    assert.equal(ok, false);
    assert.equal(world.notes.at(-1)[1], "pf2e-artisans-workshop.Expiry.Used");
    assert.equal(Hooks.call("preCreateChatMessage", { flags: { pf2e: { origin: { uuid: vera.addItem({ type: "consumable", name: "New" }).uuid } } } }), true);
});

test("pf2e's daily crafting from the sheet is stamped with the current cycle once its items arrive (7.7)", async () => {
    vera.crafting.abilities.get("talisman-dabbler").preparedFormulaData = [{ uuid: items.fear.uuid, quantity: 1 }];
    vera.system.crafting.formulas.push({ uuid: items.fear.uuid });
    await vera.crafting.performDailyCrafting();
    const stamped = await morning.stampSheetCrafting(vera);
    assert.equal(stamped.length, 1);
    const gem = named(vera, "Fear Gem")[0];
    assert.equal(stampOf(gem).pool, "talisman-dabbler");
    assert.match(gem.system.description.value, /dc:28/, "the Dabbler DC stamp too");
    const facts = await morning.morningFacts(vera);
    assert.equal(facts.state, "sheet");
    assert.equal((await morning.applyMorning(vera, {})).reason, "sheet");
});

/* -------------------------------------------- */
/*  Rest ordering (7.8) and pf2e-dailies (7.9)   */
/* -------------------------------------------- */

test("without pf2e-dailies: the rest message starts the pipeline on the responsible client after the actor's updates settle (7.8)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    rest.registerRestHooks();
    Hooks.callAll("createChatMessage", { id: "rest1", speaker: { actor: vera.id } }, { restForTheNight: true });
    assert.deepEqual(rest.pendingRests(), [vera.id]);
    t.mock.timers.tick(500);
    Hooks.callAll("updateActor", vera, { system: {} });
    t.mock.timers.tick(500);
    assert.equal(downtime.statusOf(vera).prepCycle, 0, "an update put it off");
    t.mock.timers.tick(300);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downtime.statusOf(vera).prepCycle, 1);
    assert.equal(world.notes.filter((n) => n[1] === "pf2e-artisans-workshop.Morning.Prompt").length, 1, "one Morning prompt");
});

test("a GM resting the party: each character's pipeline runs on its own player's client, not the GM's (7.8)", async () => {
    rest.registerRestHooks();
    await as("gm00000000000000", async () => {
        Hooks.callAll("createChatMessage", { id: "r", speaker: { actor: vera.id } }, { restForTheNight: true });
        Hooks.callAll("createChatMessage", { id: "r2", speaker: { actor: bo.id } }, { restForTheNight: true });
        assert.deepEqual(rest.pendingRests(), [], "the GM's client waits for nobody: the players are connected");
    });
    Hooks.callAll("createChatMessage", { id: "r", speaker: { actor: vera.id } }, { restForTheNight: true });
    assert.deepEqual(rest.pendingRests(), [vera.id], "Vera's player's client, not Bo's character");
});

test("a rest raises no cycle for a character who makes nothing at preparations (review fix: no ledger writes for a fighter's rest)", async () => {
    const fighter = await as("p2", () => rest.afterRestFor(bo, "rest-bo"));
    assert.deepEqual([fighter.cycle, fighter.prompted], [null, false]);
    assert.equal(downtime.statusOf(bo).prepCycle, 0);
    assert.equal(records("claims").length, 0);
});

test("in downtime without a standing routine a rest only prompts; with one it starts a new cycle (7.2)", async () => {
    await write({ set: { [`pcs.${vera.id}`]: { id: vera.id, v: 1, inDowntime: true, since: 0, standingRoutine: false } } });
    const prompt = await rest.afterRestFor(vera, "a");
    assert.deepEqual([prompt.cycle, prompt.prompted], [null, true]);
    assert.equal(downtime.statusOf(vera).prepCycle, 0);
    await write({ set: { [`pcs.${vera.id}.standingRoutine`]: true } });
    const routine = await rest.afterRestFor(vera, "b");
    assert.equal(routine.cycle.cycle, 1);
});

test("with pf2e-dailies: the pipeline waits for its rested flag; its interface's choice is applied when rested goes back to false (7.8, 7.9)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    game.modules.set("pf2e-dailies", { id: "pf2e-dailies", active: true });
    rest.registerRestHooks();
    Hooks.callAll("createChatMessage", { id: "rest9", speaker: { actor: vera.id } }, { restForTheNight: true });
    t.mock.timers.tick(1000);
    assert.equal(downtime.statusOf(vera).prepCycle, 0, "no settle timer: it waits for pf2e-dailies");
    Hooks.callAll("updateActor", vera, { flags: { "pf2e-dailies": { rested: true } } });
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downtime.statusOf(vera).prepCycle, 1);
    // The interface: the daily's process records the choice.
    const saved = await morning.saveLoadout(vera, { name: "Fire", pools: { "advanced-alchemy": [{ family: familyKey(items.fire), qty: 2 }] } });
    const daily = dailies.morningDaily();
    assert.equal(daily.key, "pf2e-artisans-workshop.morning");
    const rows = daily.rows(vera);
    assert.deepEqual(rows.map((r) => [r.type, r.slug]), [["select", "advanced-alchemy"], ["select", "talisman-dabbler"]]);
    assert.deepEqual(rows[0].options.map((o) => o.value), ["keep", saved.id, "later"]);
    await daily.process({ actor: vera, rows: { "advanced-alchemy": saved.id, "talisman-dabbler": "keep" } });
    assert.equal(flagsOf(vera).morning.choice.cycle, 1);
    assert.equal(vera.crafting.performed, 0, "process creates nothing inside pf2e-dailies' flow");
    t.mock.timers.reset();
    const applied = await rest.applyChoice(vera);
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(named(vera, "Alchemist's Fire (Lesser)")[0]?.quantity, 2);
    assert.ok(flagsOf(vera).morning.choice.applied, "applied once");
    assert.equal((await rest.applyChoice(vera)).reason, "no-choice");
    game.modules.delete("pf2e-dailies");
});

test("two characters' pf2e-dailies choices both apply: one timer each (review fix, 7.9)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    rest.registerRestHooks();
    bo.ownership.p1 = 3;
    bo.crafting.add({ slug: "advanced-alchemy", label: "Advanced Alchemy", maxSlots: 4, maxItemLevel: 8, batchSize: 2,
        craftableItems: [predicate("item:trait:alchemical", "item:trait:consumable")] });
    bo.system.crafting.formulas.push({ uuid: items.fire.uuid });
    bo.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.fire.uuid, quantity: 2 }];
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 2 }];
    world.collections.User.get("p2").active = false;
    for (const actor of [vera, bo]) {
        await actor.update({ [`flags.${MOD}.morning.choice`]: { pools: { "advanced-alchemy": "keep" }, cycle: 0, applied: null } });
    }
    Hooks.callAll("updateActor", vera, { flags: { "pf2e-dailies": { rested: false } } });
    Hooks.callAll("updateActor", bo, { flags: { "pf2e-dailies": { rested: false } } });
    t.mock.timers.tick(rest.SETTLE_MS);
    t.mock.timers.reset();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(flagsOf(vera).morning.choice.applied, "Vera's choice applied");
    assert.ok(flagsOf(bo).morning.choice.applied, "and Bo's");
});

test("with pf2e-dailies but no rested flag, the pipeline runs on its fallback after 5 seconds (7.8)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    game.modules.set("pf2e-dailies", { id: "pf2e-dailies", active: true });
    rest.registerRestHooks();
    Hooks.callAll("createChatMessage", { id: "rest10", speaker: { actor: vera.id } }, { restForTheNight: true });
    t.mock.timers.tick(rest.DAILIES_FALLBACK_MS);
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downtime.statusOf(vera).prepCycle, 1);
    game.modules.delete("pf2e-dailies");
});

test("a choice left for the Workshop makes nothing; the custom daily registers only while pf2e-dailies is active (7.9)", async () => {
    await vera.update({ [`flags.${MOD}.morning.choice`]: { pools: { "advanced-alchemy": "later" }, cycle: 0, applied: null } });
    assert.equal((await rest.applyChoice(vera)).reason, "later");
    assert.equal(dailies.registerDailies(), false, "pf2e-dailies is not active");
    const registered = [];
    game.modules.set("pf2e-dailies", { id: "pf2e-dailies", active: true });
    game.dailies = { api: { registerCustomDailies: (list) => registered.push(...list) } };
    assert.equal(dailies.registerDailies(), true);
    assert.deepEqual(registered.map((d) => d.key), ["pf2e-artisans-workshop.morning"]);
    assert.equal(typeof registered[0].condition, "function");
    assert.equal(registered[0].condition(vera), true);
    assert.equal(registered[0].condition(bo), false, "only characters with daily pools or vials");
    game.modules.delete("pf2e-dailies");
    delete game.dailies;
});

/* -------------------------------------------- */
/*  Affix records and Talismanic Sage (7.4)      */
/* -------------------------------------------- */

test("affixing: one talisman per host; a Talismanic Sage treats a host for a second, and treating another ends the first (7.4)", async () => {
    const toolkit = vera.addItem({ type: "equipment", name: "Repair Toolkit", sourceId: REGISTRY["repair-toolkit"].uuid });
    const armor = vera.addItem({ type: "armor", name: "Armor", system: { equipped: { inSlot: true } } });
    const sword = vera.addItem({ type: "weapon", name: "Sword", system: { equipped: { carryType: "held" } } });
    const talisman = (name) => vera.addItem({ type: "consumable", name, traits: ["talisman", "consumable", "magical"], system: { usage: { value: "" } } });
    const [t1, t2, t3, t4] = [talisman("T1"), talisman("T2"), talisman("T3"), talisman("T4")];
    assert.equal((await morning.affixOwn(vera, t1.id, armor.id)).ok, true);
    assert.equal((await morning.affixOwn(vera, t2.id, armor.id)).reason, "host-taken", "one per host");
    // Talismanic Sage by its compendium UUID: M5 read it from the registry, which lacked it, so a sage never got a second talisman.
    vera.addItem({ type: "feat", name: "Talismanic Sage", sourceId: "Compendium.pf2e.feats-srd.Item.uPikeCzrTrgzEJT8" });
    const second = await morning.affixOwn(vera, t2.id, armor.id);
    assert.deepEqual([second.ok, second.treated], [true, true], "the sage treats the host for a second talisman");
    assert.equal(services.sageTreated(armor), true);
    assert.equal((await morning.affixOwn(vera, t3.id, armor.id)).reason, "host-taken", "never a third");
    assert.equal((await morning.affixOwn(vera, t3.id, sword.id)).ok, true);
    assert.equal((await morning.affixOwn(vera, t4.id, sword.id)).ok, true, "treating the sword");
    assert.equal(services.sageTreated(armor), false, "ends the armor's treatment");
    const board = morning.affixBoardOf(vera);
    assert.deepEqual(board.hosts.map((h) => [h.name, h.state]), [["Armor", "suppressed"], ["Sword", "active"]],
        "the armor's two now suppress each other");
    assert.equal((await morning.unaffixOwn(vera, t2.id)).ok, true);
    assert.equal(morning.affixBoardOf(vera).hosts[0].state, "active");
    assert.ok(toolkit);
});

test("loadouts are saved, captured from the current preparation and deleted, on the character (4.11)", async () => {
    vera.crafting.abilities.get("advanced-alchemy").preparedFormulaData = [{ uuid: items.minor.uuid, quantity: 4 }];
    const captured = await morning.captureLoadout(vera, "Morning");
    assert.equal(captured.ok, true);
    assert.deepEqual(captured.loadout.pools["advanced-alchemy"], [{ family: familyKey(items.minor), qty: 4, name: "Elixir of Life (Minor)" }]);
    assert.deepEqual(Object.keys(morning.loadoutsOf(vera)), [captured.id]);
    assert.equal((await morning.deleteLoadout(vera, captured.id)).ok, true);
    assert.deepEqual(morning.loadoutsOf(vera), {});
    assert.equal((await as("p2", () => morning.saveLoadout(vera, { name: "x" }))).reason, "not-owner");
});

test("the Morning badge counts the user's characters a rest has left waiting to prepare (7.8)", async () => {
    assert.deepEqual(morning.waitingToPrepare(), []);
    await rested(vera, "r");
    assert.deepEqual(morning.waitingToPrepare().map((a) => a.name), ["Vera"]);
    await morning.applyMorning(vera, {});
    assert.deepEqual(morning.waitingToPrepare(), []);
});
