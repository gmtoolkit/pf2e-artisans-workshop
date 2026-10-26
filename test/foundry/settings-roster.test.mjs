/**
 * Settings registered in M2 (DESIGN.md 14) and roster publishing (4.10) over the fake world.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MOD, addDocument, flagsOf, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";

installFoundry();
const { DEFAULT_RULES } = await import("../../scripts/logic/defaults.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const roster = await import("../../scripts/foundry/roster.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const state = await import("../../scripts/foundry/state.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

/** Every leaf of DEFAULT_RULES as a dotted path. */
const leaves = (object, prefix = "") => Object.entries(object).flatMap(([key, value]) =>
    (value && typeof value === "object" ? leaves(value, `${prefix}${key}.`) : [`${prefix}${key}`]));

test("the master switch is a world setting, off by default, shown in the settings window", () => {
    const config = world.settingConfigs.get(`${MOD}.enabled`);
    assert.deepEqual([config.scope, config.default, config.config, config.type], ["world", false, true, Boolean]);
    assert.equal(world.settingConfigs.get(`${MOD}.docs`).config, false);
    assert.equal(world.settingConfigs.get(`${MOD}.claims.auto`).scope, "user");
    assert.equal(world.settingConfigs.get(`${MOD}.members`).default, "party");
});

test("every rule the engine reads has a world setting whose default is DEFAULT_RULES's", () => {
    const registered = settings.RULE_SETTINGS.map((s) => s.rule).sort();
    assert.deepEqual(registered, leaves(DEFAULT_RULES).sort());
    for (const { key, rule } of settings.RULE_SETTINGS) {
        const config = world.settingConfigs.get(`${MOD}.${key}`);
        const value = rule.split(".").reduce((o, k) => o[k], DEFAULT_RULES);
        assert.equal(config.default, value, key);
        assert.equal(config.scope, "world", key);
        assert.ok(config.config === false || (config.name && config.hint), `${key} has strings`);
    }
    assert.ok(settings.RULE_SETTINGS.every((s) => s.key.startsWith("rules.") || s.key.startsWith("variants.")));
});

test("the rules object follows the settings, nested keys included", () => {
    assert.deepEqual(settings.rulesFromSettings(), { ...DEFAULT_RULES, communal: { ...DEFAULT_RULES.communal }, variants: { ...DEFAULT_RULES.variants } });
    world.settings.set(`${MOD}.rules.legendaryItemLevel`, 16);
    world.settings.set(`${MOD}.rules.communal.helperCap`, 2);
    world.settings.set(`${MOD}.variants.complexCrafting`, true);
    const rules = settings.rulesFromSettings();
    assert.deepEqual([rules.legendaryItemLevel, rules.communal.helperCap, rules.variants.complexCrafting], [16, 2, true]);
    assert.equal(rules.communal.helperLeaveRetroactive, true);
});

/* -------------------------------------------- */

let pc;
let docs;
const character = (data) => {
    const actor = addDocument("Actor", { name: "Vera", img: "vera.webp", ownership: { default: 0, p1: 3 }, system: { crafting: { formulas: [{ uuid: "Compendium.x.b" }, { uuid: "Compendium.x.a" }] } }, items: [
        { type: "feat", name: "Magical Crafting", system: { slug: "magical-crafting" } },
        { type: "feat", name: "Toughness", system: { slug: "toughness" } },
    ], ...data });
    Object.assign(actor, {
        level: 5, size: "med", hasPlayerOwner: true,
        skills: { crafting: { slug: "crafting", rank: 2 }, arcana: { slug: "arcana", rank: 0 }, "cooking-lore": { slug: "cooking-lore", rank: 1 } },
        crafting: { abilities: new Map([["alchemist", { slug: "alchemist", maxSlots: 4, maxItemLevel: 5, resource: null }]]) },
        inventory: { invested: { value: 1, max: 10 } },
        getResource: (slug) => (slug === "versatile-vials" ? { value: 3, max: 5 } : null),
    });
    return actor;
};

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    docs = sharedWorld();
    pc = character();
    world.settings.set(`${MOD}.members`, "all");
    setUsers([{ id: "p1", character: pc }, { id: "p2" }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

test("the extract reads the pf2e character: trained skills, rules-read feats, formulas, abilities, vials", () => {
    const extract = roster.rosterExtract(pc);
    assert.deepEqual(extract.skills, { crafting: 2, "cooking-lore": 1 });
    assert.deepEqual(extract.feats, ["magical-crafting"]);
    assert.deepEqual(extract.formulas, ["Compendium.x.b", "Compendium.x.a"]);
    assert.deepEqual(extract.abilities, [{ slug: "alchemist", maxSlots: 4, maxItemLevel: 5, resource: null }]);
    assert.deepEqual([extract.vials, extract.investiture], [{ value: 3, max: 5 }, { value: 1, max: 10 }]);
});

test("the responsible tab publishes, replacing the snapshot whole; an unchanged one is not rewritten", async () => {
    assert.equal(await roster.publishRoster(pc), true);
    const snap = flagsOf(docs.ledger).roster[pc.id];
    assert.deepEqual([snap.crafting.rank, snap.by, snap.formulas], [2, "p1", ["Compendium.x.a", "Compendium.x.b"]]);
    const before = world.calls.length;
    assert.equal(await roster.publishRoster(pc), false);
    assert.equal(world.calls.length, before);
    pc.skills.arcana.rank = 1;
    flagsOf(docs.ledger).roster[pc.id].stale = "left over";
    assert.equal(await roster.publishRoster(pc), true);
    assert.equal(flagsOf(docs.ledger).roster[pc.id].stale, undefined, "replaced, not merged");
});

test("other players' tabs do not publish; members follow the setting", async () => {
    world.currentUser = "p2";
    resetLease();
    requestLease("p2");
    assert.equal(await roster.publishRoster(pc), false);
    world.currentUser = "p1";
    world.settings.set(`${MOD}.members`, "party");
    assert.deepEqual(roster.members(), [], "no pf2e party actor");
    game.actors.party = { members: [pc] };
    assert.deepEqual(roster.members(), [pc]);
    delete game.actors.party;
});

test("changes to the actor or its items republish after the burst settles", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    roster.registerRosterHooks();
    Hooks.callAll("updateActor", pc, {}, {}, "p1");
    Hooks.callAll("createItem", { parent: pc }, {}, "p1");
    t.mock.timers.tick(999);
    assert.equal(flagsOf(docs.ledger).roster, undefined);
    t.mock.timers.tick(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(flagsOf(docs.ledger).roster?.[pc.id]);
    assert.equal(world.calls.filter(([kind, doc]) => kind === "update" && doc === "JournalEntry").length, 1, "one write for the burst");
});
