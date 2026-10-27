/**
 * Combat over the fake world (DESIGN.md 8.1-8.9, M8): Quick Alchemy through pf2e's own `craft` (the vial gate pf2e's
 * own path lacks, Double Brew, additives, the split of a merged stack), quick vials and their source identity, Strikes
 * through pf2e's own Strike with the system toggles, Healing Bomb, turn expiry on each holder's client, the encounter's
 * end, Duct Tape's step-aside, vial gathering with its cap, Improvise Admixture, "Use best consumable", the roster's
 * consumables and the 10-minute cap.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { FakeCollection, addDocument, coin, installFoundry, setUsers, sharedWorld, world, resetWorld } from "./stubs.mjs";
import { VIAL_UUID, asAlchemist, encounter, physicalItems, seedCombatCompendium, turnTo } from "./alchemist.mjs";
import { asCharacter } from "./pf2e-crafting.mjs";

installFoundry();
const MOD = "pf2e-artisans-workshop";
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { familyKey } = await import("../../scripts/logic/families.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const { resetCatalogue } = await import("../../scripts/foundry/catalogue.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const downtime = await import("../../scripts/foundry/downtime.mjs");
const expiry = await import("../../scripts/foundry/expiry.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const morning = await import("../../scripts/foundry/morning.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const alchemy = await import("../../scripts/foundry/alchemy.mjs");
const combat = await import("../../scripts/foundry/combat.mjs");
const vials = await import("../../scripts/foundry/vials.mjs");
const consumables = await import("../../scripts/foundry/consumables.mjs");
const { rosterExtract } = await import("../../scripts/foundry/roster.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

let vera;
let bo;
let items;
const stampOf = (item) => item?.flags?.[MOD]?.expiry ?? null;
const quickOf = (item) => item?.flags?.[MOD]?.quick ?? null;
const named = (actor, name) => actor.items.filter((i) => i.name === name);
const vialCount = (actor) => actor.getResource("versatile-vials").value;
const hooked = (name) => {
    const seen = [];
    Hooks.on(`${MOD}.${name}`, (payload) => seen.push(payload));
    return seen;
};

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    downtime.resetDowntime();
    resetCatalogue();
    morning.resetMorning();
    expiry.resetExpiry();
    alchemy.resetAlchemy();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    Object.assign(world, { toggles: [], strikes: [], damage: [], checks: [], consumed: [], nextCheck: null });
    items = seedCombatCompendium();
    game.packs = new Map([["pf2e.equipment-srd", { getIndex: async () => world.index }]]);
    game.combats = new FakeCollection();
    game.time.worldTime = 1000;
    game.pf2e = { settings: { variants: { pwol: { enabled: false } } } };
    game.i18n.has = () => false;
    game.modules = new Map([[MOD, { id: MOD, version: "0.0.0" }]]);
    vera = addDocument("Actor", { name: "Vera", type: "character", ownership: { default: 0, p1: 3 }, items: [] });
    asAlchemist(vera, { level: 10, formulas: [items.minor.uuid, items.fire.uuid, items.mutagen.uuid],
        feats: ["versatile-vials", "bomber", "field-discovery-bomber", "expanded-splash", "healing-bomb", "combine-elixirs", "sticky-bomb", "enduring-alchemy",
            "quick-bomber"], registry: REGISTRY });
    bo = addDocument("Actor", { name: "Bo", type: "character", ownership: { default: 0, p2: 3 }, items: [] });
    physicalItems(bo);
    asCharacter(bo, { level: 8 });
    bo.applyDamage = async ({ damage, token }) => world.damage.push([bo.id, damage, token?.id ?? null]);
    world.collections.Actor.party = { id: "party", members: [vera, bo] };
    ChatMessage.implementation.getSpeaker = () => ({});
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    world.settings.set(`${MOD}.enabled`, true);
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
    expiry.registerExpiryHooks();
    alchemy.registerAlchemyHooks();
});
afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    expiry.resetExpiry();
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

/* -------------------------------------------- */
/*  Quick Alchemy (8.3)                          */
/* -------------------------------------------- */

test("Quick Alchemy makes the item through pf2e's craft: one vial, held, infused, stamped until the start of the next turn (a round outside an encounter) (8.3, 8.8)", async () => {
    const made = hooked("quickAlchemy");
    const facts = await alchemy.alchemyFacts(vera);
    assert.deepEqual(facts.choices.map((c) => c.name), ["Alchemist's Fire (Lesser)", "Bestial Mutagen (Lesser)", "Elixir of Life (Lesser)", "Elixir of Life (Minor)",
        "Elixir of Life (Moderate)"], "by book and family, at most level 10; the potion is not alchemical");
    const result = await alchemy.quickAlchemy(vera, { uuid: items.lesser.uuid });
    assert.equal(result.ok, true, JSON.stringify(result));
    const [elixir] = named(vera, "Elixir of Life (Lesser)");
    assert.equal(elixir.system.equipped.carryType, "held");
    assert.equal(elixir.system.temporary, true);
    assert.ok(elixir.system.traits.value.includes("infused"));
    assert.deepEqual(stampOf(elixir), { creator: vera.uuid, cycle: 0, rule: "turn-end", when: "next", quick: "quick-alchemy", combat: null, at: 1006 },
        "Enduring Alchemy: an elixir lasts to the end of the next turn; outside an encounter, a round of world time");
    assert.deepEqual([quickOf(elixir).source, quickOf(elixir).additive], ["quick-alchemy", null]);
    assert.equal(vialCount(vera), 4, "one vial, through pf2e's resource");
    assert.deepEqual(vera.crafting.abilities.get("quick-alchemy").calls.at(-1), ["craft", items.lesser.uuid, true, "hand"]);
    assert.equal(made.length, 1, "the Quick Alchemy card's hook, on this client");
    const bomb = await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid });
    assert.equal(stampOf(vera.items.get(bomb.items[0].id)).rule, "turn-start", "a bomb lasts until the start of the next turn");
});

test("Quick Alchemy at 0 vials is refused before pf2e is asked (its own path crafts for free at 0, 8.3)", async () => {
    await vera.updateResource("versatile-vials", 0);
    const calls = vera.crafting.abilities.get("quick-alchemy").calls.length;
    const result = await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid });
    assert.deepEqual([result.ok, result.reason], [false, "no-vials"]);
    assert.equal(vera.crafting.abilities.get("quick-alchemy").calls.length, calls, "craft never called");
    assert.equal(named(vera, "Elixir of Life (Minor)").length, 0);
});

test("refusals before anything is made: no formula or above the level, two items without Double Brew, a player who does not own the alchemist (8.3)", async () => {
    assert.deepEqual([(await alchemy.quickAlchemy(vera, { uuid: items.greater.uuid })).reason, (await alchemy.quickAlchemy(vera, { uuid: items.potion.uuid })).reason],
        ["cannot-make", "cannot-make"]);
    assert.equal((await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid, second: items.fire.uuid })).reason, "double-brew");
    assert.equal((await as("p2", () => alchemy.quickAlchemy(vera, { uuid: items.minor.uuid }))).reason, "not-owner");
    assert.equal(vialCount(vera), 5);
});

test("Double Brew: two items, two vials; the second needs a vial of its own (8.3)", async () => {
    vera.addItem({ type: "feat", name: "double-brew", sourceId: REGISTRY["double-brew"].uuid, system: { slug: "double-brew" } });
    const two = await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid, second: items.fire.uuid });
    assert.equal(two.ok, true);
    assert.deepEqual(two.items.map((i) => i.name), ["Elixir of Life (Minor)", "Alchemist's Fire (Lesser)"]);
    assert.equal(vialCount(vera), 3);
    await vera.updateResource("versatile-vials", 1);
    assert.deepEqual((await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid, second: items.fire.uuid })).data.n, 2);
});

test("Healing Bomb is an additive on a Quick Alchemy elixir of life only; one additive a round; Combine Elixirs takes a second vial (8.6)", async () => {
    const hb = await alchemy.healingBomb(vera);
    assert.equal(hb.ok, true, JSON.stringify(hb));
    const elixir = vera.items.get(hb.items[0].id);
    assert.equal(elixir.name, "Elixir of Life (Moderate)", "the best grade it can make");
    assert.equal(quickOf(elixir).additive, "healing-bomb");
    assert.deepEqual(vera.flags[MOD].combat.additive, { combat: null, round: null, at: 1000 });
    const again = await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid, additive: "combine-elixirs", combine: items.minor.uuid });
    assert.equal(again.reason, "additive-round", "one additive a round");
    assert.equal((await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid, additive: "healing-bomb" })).reason, "additive-round");
    game.time.worldTime = 1006;
    assert.equal((await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid, additive: "healing-bomb" })).reason, "additive-fit", "never on a bomb");
    const before = vialCount(vera);
    const combined = await alchemy.quickAlchemy(vera, { uuid: items.lesser.uuid, additive: "combine-elixirs", combine: items.minor.uuid });
    assert.equal(combined.ok, true, JSON.stringify(combined));
    assert.equal(vialCount(vera), before - 2, "the elixir and the combined one");
    assert.deepEqual([quickOf(vera.items.get(combined.items[0].id)).additive, quickOf(vera.items.get(combined.items[0].id)).combine], ["combine-elixirs", items.minor.uuid]);
});

test("an item pf2e merged into a held stack (quantity 0) is split off into its own before it is stamped (8.3, 7.1)", async () => {
    const empty = vera.addItem({ type: "consumable", name: "Elixir of Life (Minor)", system: { quantity: 0, equipped: { carryType: "held", handsHeld: 1 },
        traits: { value: ["alchemical", "consumable", "elixir", "healing", "infused"] } }, flags: { [MOD]: { expiry: { creator: "Actor.other", cycle: 3, rule: "prep" } } } });
    const result = await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid });
    assert.equal(result.ok, true, JSON.stringify(result));
    const made = vera.items.get(result.items[0].id);
    assert.notEqual(made.id, empty.id, "its own item");
    assert.deepEqual([made.quantity, stampOf(made).quick, empty.quantity, stampOf(empty).creator], [1, "quick-alchemy", 0, "Actor.other"]);
});

/* -------------------------------------------- */
/*  Quick vials and Strikes (8.4, 8.5)           */
/* -------------------------------------------- */

test("a quick vial is a free, held, infused copy of the vial whose source identity is cleared, so the vial count stays (8.5)", async () => {
    const result = await alchemy.quickVial(vera, { damageType: "fire" });
    assert.equal(result.ok, true, JSON.stringify(result));
    const quick = vera.items.get(result.items[0].id);
    assert.equal(quick.sourceId, null, "not the Versatile Vial's source");
    assert.equal(vialCount(vera), 5, "the resource still reads the vial item alone");
    assert.deepEqual([quick.quantity, quick.system.temporary, quick.system.equipped.carryType, quick.slug], [1, true, "held", "versatile-vial"]);
    assert.deepEqual([stampOf(quick).rule, stampOf(quick).when, quickOf(quick).damageType], ["turn-end", "current", "fire"]);
    assert.equal((await alchemy.quickVial(vera, { damageType: "acid" })).reason, "bad-choice", "the bomber's field vials: cold, electricity or fire");
    // Strikes go through pf2e's own Strike, with the field-vial toggle set first.
    const strike = await combat.strikeWith(vera, quick, { map: 1 });
    assert.equal(strike.ok, true);
    assert.deepEqual(world.strikes.at(-1).map, 1);
    assert.deepEqual(world.toggles.at(-1), [vera.id, "all", "bomber-field-vials", true, "fire"]);
    assert.equal(world.strikes.at(-1).options.all["bomber-field-vials"], true, "the toggle was on when pf2e rolled");
});

test("Abundant Vials' extra action makes one quick vial a turn, in an encounter (8.5)", async () => {
    assert.equal((await alchemy.quickVial(vera, { quickened: true })).reason, "no-feat");
    vera.addItem({ type: "feat", name: "abundant-vials", sourceId: REGISTRY["abundant-vials"].uuid, system: { slug: "abundant-vials" } });
    assert.equal((await alchemy.quickVial(vera, { quickened: true })).reason, "not-in-combat");
    const fight = encounter("c1", [vera, bo]);
    assert.equal((await alchemy.quickVial(vera, { quickened: true })).ok, true);
    assert.equal((await alchemy.quickVial(vera, { quickened: true })).reason, "quickened");
    assert.equal((await alchemy.quickVial(vera, {})).ok, true, "an ordinary quick vial is still free");
    turnTo(fight, 1, 1);
    assert.equal((await alchemy.quickVial(vera, { quickened: true })).ok, true, "a new turn");
});

test("an additive's own pf2e toggle is on for a Strike with its item and off for the next plain one (OQ-27)", async () => {
    const sticky = await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid, additive: "sticky-bomb" });
    assert.equal(sticky.ok, true, JSON.stringify(sticky));
    await combat.strikeWith(vera, vera.items.get(sticky.items[0].id));
    assert.equal(world.strikes.at(-1).options["alchemical-bomb-base-type-damage"]["sticky-bomb"], true);
    game.time.worldTime = 1010;
    const plain = await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid });
    await combat.strikeWith(vera, vera.items.get(plain.items[0].id));
    assert.equal(world.strikes.at(-1).options["alchemical-bomb-base-type-damage"]["sticky-bomb"], false);
});

test("Quick Bomber draws the held bomb before the worn vial and Strikes; with none of the family it makes one and throws it (8.4)", async () => {
    await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid });
    const drawn = await alchemy.quickBomb(vera, { family: familyKey(items.fire) });
    assert.equal(drawn.ok, true, JSON.stringify(drawn));
    assert.equal(vera.items.get(drawn.drawn).name, "Alchemist's Fire (Lesser)");
    const vial = await alchemy.quickBomb(vera, { family: "vial" });
    assert.equal(vera.items.get(vial.drawn).sourceId, VIAL_UUID, "the vial item itself");
    // By UUID (the macro's form): the held bomb of that UUID's family is drawn, not a new one made (review fix: the family
    // was read from the compendium index without its category, so nothing held matched and every call made a bomb).
    // Foundry's `fromUuidSync` gives a compendium UUID's index entry, whose category is under `system`.
    const sync = globalThis.fromUuidSync;
    globalThis.fromUuidSync = (uuid, options) => (uuid?.startsWith("Compendium.") ? world.index.find((e) => e.uuid === uuid) ?? null : sync(uuid, options));
    const crafts = vera.crafting.abilities.get("quick-alchemy").calls.length;
    let byUuid;
    try {
        byUuid = await alchemy.quickBomb(vera, { uuid: items.fire.uuid });
    } finally {
        globalThis.fromUuidSync = sync;
    }
    assert.deepEqual([byUuid.ok, byUuid.drawn, vera.crafting.abilities.get("quick-alchemy").calls.length], [true, drawn.drawn, crafts]);
    await vera.items.get(drawn.drawn).delete();
    const fresh = await alchemy.quickBomb(vera, { uuid: items.fire.uuid, map: 2 });
    assert.equal(fresh.ok, true);
    assert.equal(vera.crafting.abilities.get("quick-alchemy").calls.length, crafts + 1, "none held: one made with Quick Alchemy");
    assert.equal(world.strikes.at(-1).map, 2);
    vera.items.find((i) => i.name === "feat" || i.system?.slug === "quick-bomber").delete();
    assert.equal((await alchemy.quickBomb(vera, { family: "vial" })).reason, "no-feat");
});

test("what pf2e's own Quick Alchemy action makes is stamped on the creating client; the panel's own and other items are left as they are (review fix, 8.8)", async () => {
    const ability = vera.crafting.abilities.get("quick-alchemy");
    // pf2e's chat path: `craft(uuid, {consume, destination: "hand"})`, nothing stamped.
    const system = await ability.craft(items.minor.uuid, { consume: true, destination: "hand" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual([stampOf(system)?.rule, stampOf(system)?.quick, quickOf(system)?.source], ["turn-end", "quick-alchemy", "system"],
        "an elixir: Enduring Alchemy's end of the next turn");
    const panel = await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid });
    assert.equal(quickOf(vera.items.get(panel.items[0].id)).source, "quick-alchemy", "the panel's own stamp");
    const stowed = vera.addItem({ type: "consumable", name: "Elixir of Life (Minor)", system: { temporary: true, equipped: { carryType: "worn" },
        traits: { value: ["alchemical", "consumable", "elixir", "infused"] } } });
    assert.equal(await alchemy.stampSystemQuickAlchemy(stowed, "p1"), false, "not in hand: not Quick Alchemy's");
    const other = await as("p2", () => bo.createEmbeddedDocuments("Item", [{ type: "consumable", name: "Elixir of Life (Minor)", system: { temporary: true,
        equipped: { carryType: "held" }, traits: { value: ["alchemical", "consumable", "elixir", "infused"] } } }]));
    assert.equal(stampOf(other[0]), null, "a character without Quick Alchemy");
    assert.equal(await alchemy.stampSystemQuickAlchemy(system, "p2"), false, "only on the client that created it");
});

/* -------------------------------------------- */
/*  Healing Bomb (8.6)                           */
/* -------------------------------------------- */

test("a Healing Bomb is used through the system; each adjacent creature's owner applies the elixir's dice in HP, once (8.6)", async () => {
    const cards = hooked("healingBomb");
    const made = await alchemy.healingBomb(vera);
    const elixir = vera.items.get(made.items[0].id);
    assert.equal((await alchemy.throwHealingBomb(vera, made.items[0].id)).reason, "no-creature", "a target first");
    const thrown = await alchemy.throwHealingBomb(vera, elixir.id, { target: bo.uuid });
    assert.equal(thrown.ok, true, JSON.stringify(thrown));
    assert.deepEqual(world.consumed.at(-1), [vera.id, elixir.id, "Elixir of Life (Moderate)"], "used as if drunk, through pf2e's own consume");
    assert.deepEqual([thrown.hp, thrown.target.actor, cards.length], [5, bo.uuid, 1], "Moderate: 5d6+12, five dice");
    assert.equal((await alchemy.applyHealingBomb("msg1", { actor: bo.uuid, hp: 5 })).reason, "not-owner", "Bo's player applies it");
    const healed = await as("p2", () => alchemy.applyHealingBomb("msg1", { actor: bo.uuid, hp: 5 }));
    assert.equal(healed.ok, true);
    assert.deepEqual(world.damage.at(-1).slice(0, 2), [bo.id, -5], "pf2e's applyDamage, negative to heal");
    assert.equal((await as("p2", () => alchemy.applyHealingBomb("msg1", { actor: bo.uuid, hp: 5 }))).reason, "already");
    assert.equal((await alchemy.throwHealingBomb(vera, vera.items.find((i) => i.sourceId === VIAL_UUID).id, { target: bo.uuid })).reason, "not-healing-bomb");
});

/* -------------------------------------------- */
/*  Turn expiry (8.8)                            */
/* -------------------------------------------- */

test("turn expiry: a bomb at the start of the creator's next turn, a quick vial at the end of its turn, an Enduring elixir at the end of the next (8.8)", async () => {
    const fight = encounter("c1", [bo, vera]);
    turnTo(fight, 1, 1);
    const bomb = vera.items.get((await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid })).items[0].id);
    const elixir = vera.items.get((await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid })).items[0].id);
    const vial = vera.items.get((await alchemy.quickVial(vera)).items[0].id);
    assert.deepEqual(stampOf(bomb).combat, { id: "c1", combatant: "c1k1", round: 1, turn: 1 });
    const inert = () => [bomb, elixir, vial].map((i) => i.flags[MOD]?.inert === true);
    turnTo(fight, 2, 0);
    await expiry.expirySweep();
    assert.deepEqual(inert(), [false, false, true], "the quick vial ended with Vera's turn");
    turnTo(fight, 2, 1);
    await expiry.expirySweep();
    assert.deepEqual(inert(), [true, false, true], "the bomb at the start of her next turn");
    turnTo(fight, 3, 0);
    await expiry.expirySweep();
    assert.deepEqual(inert(), [true, true, true], "the elixir at the end of it");
    assert.equal(bomb.flags[MOD].inertFrom.reason, "turn");
    assert.equal(world.collections.ChatMessage.size, 0, "no Expiry card for Quick Alchemy items");
});

test("turn expiry runs on core's combatTurnChange, on the holder's client: an elixir handed to Bo ends on Bo's client (8.8)", async () => {
    const fight = encounter("c1", [vera, bo]);
    const made = await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid });
    const source = vera.items.get(made.items[0].id).toObject();
    delete source._id;
    const given = bo.addItem(source);
    turnTo(fight, 2, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expiry.expirySweep();
    assert.equal(vera.items.get(made.items[0].id).flags[MOD].inert, true, "Vera's own, on Vera's client, after the hook");
    assert.equal(given.flags[MOD]?.inert, undefined, "not Bo's: this client is not responsible for Bo");
    await as("p2", () => expiry.expirySweep());
    assert.equal(given.flags[MOD].inert, true, "Bo's client marks it");
});

test("the encounter's end: Quick Alchemy items end with it, or with the setting off get one round of world time (8.8, 14.2)", async () => {
    const fight = encounter("c1", [vera, bo]);
    const one = vera.items.get((await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid })).items[0].id);
    game.combats.delete(fight.id);
    Hooks.callAll("deleteCombat", fight);
    await expiry.expirySweep();
    assert.deepEqual([one.flags[MOD].inert, one.flags[MOD].inertFrom.reason], [true, "combat-end"]);
    world.settings.set(`${MOD}.expiry.quickAlchemyAtCombatEnd`, false);
    const again = encounter("c2", [vera]);
    const two = vera.items.get((await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid })).items[0].id);
    game.combats.delete(again.id);
    await expiry.expirySweep();
    assert.deepEqual([two.flags[MOD]?.inert, stampOf(two).combat, stampOf(two).at], [undefined, null, 1006], "released to world time");
    game.time.worldTime = 1006;
    await expiry.expirySweep();
    assert.deepEqual([two.flags[MOD].inert, two.flags[MOD].inertFrom.reason], [true, "time"]);
});

/* -------------------------------------------- */
/*  Duct Tape (8)                                */
/* -------------------------------------------- */

test("with Duct Tape active the combat features step aside; Use best consumable stays (8, 13)", async () => {
    const fight = encounter("c1", [vera, bo]);
    const bomb = vera.items.get((await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid })).items[0].id);
    game.modules.set(combat.DUCT_TAPE, { id: combat.DUCT_TAPE, active: true });
    assert.equal(combat.combatOffReason(), "duct-tape");
    assert.deepEqual([(await alchemy.quickAlchemy(vera, { uuid: items.fire.uuid })).reason, (await alchemy.quickVial(vera)).reason,
        (await alchemy.healingBomb(vera)).reason, (await vials.gatherReagents(vera)).reason], ["duct-tape", "duct-tape", "duct-tape", "duct-tape"]);
    turnTo(fight, 3, 0);
    await expiry.expirySweep();
    assert.equal(bomb.flags[MOD]?.inert, undefined, "no turn expiry: Duct Tape's own runs");
    const used = await consumables.useBest({ family: familyKey(items.fire), actor: vera });
    assert.equal(used.ok, true, "Use best consumable is not Duct Tape's territory");
    world.settings.set(`${MOD}.features.combat`, false);
    game.modules.delete(combat.DUCT_TAPE);
    assert.equal((await alchemy.quickVial(vera)).reason, "combat-off");
});

/* -------------------------------------------- */
/*  Vials (8.7)                                  */
/* -------------------------------------------- */

test("gather reagents: 2 vials, never past the maximum on a second click; never in an encounter; only vials that regain (8.7)", async () => {
    const regained = hooked("vialsRegained");
    await vera.updateResource("versatile-vials", 3);
    assert.deepEqual(await vials.gatherReagents(vera), { ok: true, from: 3, to: 5, gained: 2 });
    assert.deepEqual(await vials.gatherReagents(vera), { ok: true, from: 5, to: 6, gained: 1 }, "clamped");
    assert.equal((await vials.gatherReagents(vera)).reason, "full");
    assert.equal(regained.length, 2);
    await vera.updateResource("versatile-vials", 1);
    encounter("c1", [vera]);
    assert.equal((await vials.gatherReagents(vera)).reason, "in-combat");
    game.combats.clear();
    vera.items.find((i) => i.system?.slug === "versatile-vials").delete();
    assert.equal((await vials.gatherReagents(vera)).reason, "no-regain", "without the class's own vials");
});

test("vials gather as world time passes on the responsible client, the remainder carried; the lock lets one device gather a moment (8.7)", async () => {
    world.settings.set(`${MOD}.features.vialGathering`, true);
    vera.addItem({ type: "feat", name: "alchemical-expertise", sourceId: REGISTRY["alchemical-expertise"].uuid, system: { slug: "alchemical-expertise" } });
    await vera.updateResource("versatile-vials", 0);
    game.time.worldTime = 2500;
    const first = await vials.onWorldTime(1500);
    assert.deepEqual(first.map((r) => [r.gained, r.to]), [[6, 6]], "two tens at 3 each");
    assert.equal(vera.flags[MOD].vialClock, 300, "five minutes carried");
    game.time.worldTime = 2600;
    await vials.onWorldTime(100);
    assert.equal(vera.flags[MOD].vialClock, 0, "a full character carries no time");
    await vera.updateResource("versatile-vials", 0);
    game.time.worldTime = 2900;
    await vials.onWorldTime(300);
    assert.deepEqual([vialCount(vera), vera.flags[MOD].vialClock], [0, 300]);
    game.time.worldTime = 3200;
    await vials.onWorldTime(300);
    assert.deepEqual([vialCount(vera), vera.flags[MOD].vialClock], [3, 0]);
    // A second device of the same user sees the same move of the clock: its lock is taken.
    await vera.update({ [`flags.${MOD}.vialClock`]: 300 });
    assert.equal((await vials.onWorldTime(300)).length, 0, "the lock of this moment is already taken");
    assert.equal(vialCount(vera), 3);
    assert.equal((await as("p2", () => vials.onWorldTime(900))).length, 0, "Bo's player is not responsible for Vera");
    world.settings.set(`${MOD}.features.vialGathering`, false);
    game.time.worldTime = 9000;
    assert.equal((await vials.onWorldTime(6000)).length, 0, "off by default");
});

test("Improvise Admixture: pf2e's Crafting check against the level DC, vials by degree, the feat's frequency (8.7)", async () => {
    const feat = vera.addItem({ type: "feat", name: "Improvise Admixture", system: { slug: "improvise-admixture", frequency: { value: 1, max: 1, per: "day" } } });
    await vera.updateResource("versatile-vials", 1);
    world.nextCheck = { total: 31, degreeOfSuccess: 3 };
    const result = await vials.improviseAdmixture(vera, { skipDialog: true });
    assert.deepEqual([result.ok, result.degree, result.gained, vialCount(vera)], [true, 3, 3, 4]);
    assert.deepEqual(world.checks.at(-1)[1].dc, { value: 27 }, "level 10: DC 27");
    assert.equal(feat.system.frequency.value, 0);
    assert.equal((await vials.improviseAdmixture(vera)).reason, "frequency");
});

/* -------------------------------------------- */
/*  Use best consumable (8.9)                    */
/* -------------------------------------------- */

test("Use best consumable: the held one before the stowed, the soonest-expiring among equals, inert skipped; ask only on a tie (8.9)", async () => {
    const family = familyKey(items.minor);
    const add = (carryType, flags = {}, qty = 1) => bo.addItem({ type: "consumable", name: "Elixir of Life (Minor)", flags: { [MOD]: flags },
        system: { quantity: qty, category: "elixir", equipped: { carryType }, traits: { value: ["alchemical", "consumable", "elixir", "healing", "infused"] } } });
    const stowedSoon = add("stowed", { expiry: { creator: "Actor.x", cycle: 0, rule: "prep", at: 1100 } });
    const stowedLate = add("stowed", { expiry: { creator: "Actor.x", cycle: 0, rule: "prep", at: 5000 } });
    const heldInert = add("held", { inert: true });
    const used = await as("p2", () => consumables.useBest({ family, actor: bo }));
    assert.deepEqual([used.ok, used.item], [true, stowedSoon.id], "the inert held one is skipped; among the stowed, the soonest");
    assert.ok(bo.items.get(stowedLate.id) && bo.items.get(heldInert.id));
    const held = add("held");
    assert.equal((await as("p2", () => consumables.useBest({ family, actor: bo }))).item, held.id, "held first");
    assert.equal((await as("p2", () => consumables.useBest({ family, actor: bo }))).item, stowedLate.id, "a stamped one before an unstamped one");
    add("stowed");
    add("stowed");
    let asked = null;
    const tie = await as("p2", () => consumables.useBest({ family, actor: bo, choose: async (ties) => {
        asked = ties.map((t) => t.id);
        return ties[1];
    } }));
    assert.equal(asked.length, 2, "two equally good stowed elixirs, unstamped: the user is asked");
    assert.equal(tie.item, asked[1]);
    assert.equal((await as("p2", () => consumables.useBest({ family: familyKey(items.fire), actor: bo, partyWide: true }))).reason, "none");
    assert.equal((await consumables.useBest({ family, actor: bo })).reason, "not-owner");
    world.settings.set(`${MOD}.features.consumables`, false);
    assert.equal((await as("p2", () => consumables.useBest({ family, actor: bo }))).reason, "consumables-off");
});

test("the roster publishes consumables by family, inert left out (4.10, 8.9)", async () => {
    await alchemy.quickAlchemy(vera, { uuid: items.minor.uuid });
    const extract = rosterExtract(vera);
    assert.deepEqual(extract.consumables[familyKey(items.minor)], { qty: 1, soonestExpiry: 1006 });
    assert.equal(extract.consumables["weapon||versatile vial"]?.qty, 4, "the vials are a family like any other (one went into the elixir)");
});

/* -------------------------------------------- */
/*  The 10-minute cap (8.8)                      */
/* -------------------------------------------- */

test("an effect from a Quick Alchemy item is clamped to 10 minutes as it is created; Eternal Elixir's own elixir is not (8.8, OQ-19)", async () => {
    const made = await alchemy.quickAlchemy(vera, { uuid: items.mutagen.uuid });
    const origin = vera.items.get(made.items[0].id);
    const effect = (holder) => {
        const data = { type: "effect", system: { duration: { value: 1, unit: "hours", expiry: "turn-start" }, context: { origin: { item: origin.uuid } } } };
        const doc = { parent: holder, sources: [], updateSource(change) { this.sources.push(change); } };
        Hooks.call("preCreateItem", doc, data, {}, "p1");
        return doc.sources[0]?.["system.duration"] ?? null;
    };
    assert.deepEqual(effect(bo), { value: 10, unit: "minutes", expiry: "turn-start" });
    assert.deepEqual(effect(vera), { value: 10, unit: "minutes", expiry: "turn-start" }, "no exception without the feats");
    vera.addItem({ type: "feat", name: "persistent-mutagen", sourceId: REGISTRY["persistent-mutagen"].uuid, system: { slug: "persistent-mutagen" } });
    assert.equal(effect(vera), null, "Persistent Mutagen: the creator's own mutagen outlasts the cap");
    assert.deepEqual(effect(bo), { value: 10, unit: "minutes", expiry: "turn-start" }, "an ally drinking it does not");
});
