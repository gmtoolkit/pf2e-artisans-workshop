/**
 * tools/validate-registry.mjs (DESIGN.md 6.11, 15.2): over a small fake checkout, then, with PF2E_SRC set, the
 * shipped registry and ignore list against a real pf2e checkout.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY } from "../scripts/data/registry.mjs";
import { REGISTRY_IGNORE } from "../scripts/data/registry-ignore.mjs";
import { checkEntries, checkReferences, contains, loadSource, main, mentions, sluggify, unlisted, wrapperOptions } from "../tools/validate-registry.mjs";
import { logger, tempDir } from "./helpers.mjs";

const MANIFEST = {
    packs: [
        { name: "feats-srd", path: "packs/feats", type: "Item" },
        { name: "equipment-srd", path: "packs/equipment", type: "Item" },
        { name: "spells-srd", path: "packs/spells", type: "Item" },
        { name: "pathfinder-bestiary", path: "packs/pathfinder-bestiary", type: "Actor" },
    ],
};
const doc = (id, name, extra = {}) => ({
    _id: id, name, type: "feat",
    system: { publication: { remaster: true }, rules: [], description: { value: "" }, ...extra.system },
    ...extra.root,
});
const FEAT_ID = "aaaaaaaaaaaaaaa1";
const GEAR_ID = "bbbbbbbbbbbbbbb2";
const uuid = (pack, id) => `Compendium.pf2e.${pack}.Item.${id}`;

function fakeCheckout(t, docs = {}) {
    return tempDir(t, {
        "system.pf2e.json": MANIFEST,
        [`packs/pf2e/feats/level-1/${FEAT_ID}.json`]: docs.feat ?? doc(FEAT_ID, "Talisman Dabbler Dedication", {
            system: { rules: [{ key: "CraftingAbility", slug: "talisman-dabbler", maxSlots: 2, craftableItems: ["item:trait:talisman"], label: "x" }] },
        }),
        [`packs/pf2e/equipment/${GEAR_ID}.json`]: docs.gear ?? doc(GEAR_ID, "Alchemist's Lab", { root: { type: "equipment" }, system: { publication: { remaster: false } } }),
        "packs/pf2e/equipment/_folders.json": [],
        "packs/pf2e/equipment/cccccccccccccccc.json": doc("cccccccccccccccc", "Formula Thing", {
            root: { type: "equipment" }, system: { description: { value: "<p>You learn its <strong>formulas</strong>.</p>" } },
        }),
        "packs/pf2e/equipment/dddddddddddddddd.json": doc("dddddddddddddddd", "Plain Thing", {
            root: { type: "equipment" }, system: { description: { value: "<hr /><p><strong>Craft Requirements</strong> a bell.</p>" } },
        }),
    });
}

const REG = {
    "talisman-dabbler-dedication": {
        uuid: uuid("feats-srd", FEAT_ID), type: "feat", remaster: true, effects: [],
        relies: [{ key: "CraftingAbility", match: { slug: "talisman-dabbler", maxSlots: 2, craftableItems: ["item:trait:talisman"] } }],
    },
    "alchemists-lab": { uuid: uuid("equipment-srd", GEAR_ID), type: "equipment", remaster: false, effects: [] },
};

test("sluggify is pf2e's: apostrophes dropped, parentheses and spaces to hyphens, camel case split", () => {
    assert.equal(sluggify("Efficient Alchemy (Alchemist)"), "efficient-alchemy-alchemist");
    assert.equal(sluggify("Alchemist's Lab (Expanded)"), "alchemists-lab-expanded");
    assert.equal(sluggify("Witch's Broom"), "witchs-broom");
    assert.equal(sluggify("Thieves' Toolkit"), "thieves-toolkit");
    assert.equal(sluggify("camelCase Name"), "camel-case-name");
    assert.equal(sluggify("-"), "-");
});

test("contains matches leaves, object subsets and whole arrays", () => {
    assert.equal(contains({ a: 1, b: [1, { c: 2 }], d: 3 }, { b: [1, { c: 2 }] }), true);
    assert.equal(contains({ b: [1, { c: 2 }, 3] }, { b: [1, { c: 2 }] }), false, "an array must match in full");
    assert.equal(contains({ a: { b: 1 } }, { a: { b: 2 } }), false);
    assert.equal(contains(null, { a: 1 }), false);
});

test("a matching checkout passes; skipped packs are named", (t) => {
    const source = loadSource(fakeCheckout(t));
    assert.deepEqual(checkEntries({ registry: REG, ignore: {}, source }), { problems: [], unchecked: [] });
    assert.equal(source.get(uuid("spells-srd", "eeeeeeeeeeeeeeee")), null, "a pack the checkout lacks");
    assert.equal(source.get("Compendium.pf2e.pathfinder-bestiary.Actor.eeeeeeeeeeeeeeee"), undefined, "Actor packs are not read");
    [...source.items()];
    assert.deepEqual([...source.skipped], ["spells-srd"]);
});

test("every kind of drift is reported", (t) => {
    const source = loadSource(fakeCheckout(t, {
        feat: doc(FEAT_ID, "Talisman Dabbler Dedication", { system: { publication: { remaster: false }, rules: [{ key: "CraftingAbility", slug: "talisman-dabbler", maxSlots: 3 }] } }),
        gear: doc(GEAR_ID, "Alchemist's Laboratory", { root: { type: "weapon" }, system: { publication: { remaster: false } } }),
    }));
    const registry = {
        ...REG,
        gone: { uuid: uuid("feats-srd", "zzzzzzzzzzzzzzzz"), type: "feat", remaster: true, effects: [] },
        twin: { uuid: uuid("feats-srd", FEAT_ID), type: "feat", remaster: true, effects: [{ kind: "virtualFormulaList", uuids: [uuid("equipment-srd", "yyyyyyyyyyyyyyyy")] }] },
        later: { uuid: uuid("spells-srd", "eeeeeeeeeeeeeeee"), type: "spell", remaster: true, effects: [] },
    };
    const ignore = {
        [uuid("equipment-srd", GEAR_ID)]: "fp-food", [uuid("equipment-srd", "xxxxxxxxxxxxxxxx")]: "nope", [uuid("spells-srd", "ffffffffffffffff")]: "fp-food",
    };
    const { problems, unchecked } = checkEntries({ registry, ignore, reasons: { "fp-food": "x" }, source });
    const text = problems.map((p) => `${p.key}: ${p.problem}`);
    for (const expected of [
        "talisman-dabbler-dedication: remaster flag is now false",
        "talisman-dabbler-dedication: no CraftingAbility rule with",
        "alchemists-lab: slug is now alchemists-laboratory",
        "alchemists-lab: type is now weapon",
        "gone: Compendium.pf2e.feats-srd.Item.zzzzzzzzzzzzzzzz does not resolve",
        "twin: same UUID as talisman-dabbler-dedication",
        "twin: effect UUID Compendium.pf2e.equipment-srd.Item.yyyyyyyyyyyyyyyy does not resolve",
        `${uuid("equipment-srd", GEAR_ID)}: ignored and in the registry as alchemists-lab`,
        `${uuid("equipment-srd", "xxxxxxxxxxxxxxxx")}: unknown ignore reason nope`,
        `${uuid("equipment-srd", "xxxxxxxxxxxxxxxx")}: ignored UUID does not resolve`,
    ]) assert.ok(text.some((line) => line.startsWith(expected)), expected);
    assert.deepEqual(unchecked, ["later", uuid("spells-srd", "ffffffffffffffff")], "an entry and an ignored UUID in a pack the checkout lacks");
});

test("an ignored item whose Crafting bonus needs an option only the roll wrapper adds is reported", (t) => {
    const crafting = (predicate) => ({ key: "FlatModifier", selector: "crafting", type: "item", value: 2, predicate });
    const ring = doc(GEAR_ID, "Ring of Devices", { root: { type: "equipment" }, system: { rules: [
        crafting([{ or: ["action:craft", "action:repair"] }, { or: ["snare", "trap"] }]),
        { key: "FlatModifier", selector: "thievery", predicate: ["lockpicking"], value: 2 },
    ] } });
    assert.deepEqual(wrapperOptions(ring), ["snare", "trap"]);
    assert.deepEqual(wrapperOptions(doc("x", "Extractor", { system: { rules: [crafting(["action:craft:alchemical", "item:trait:alchemical"])] } })),
        ["action:craft:alchemical"]);
    assert.deepEqual(wrapperOptions(doc("x", "Own Toggle", { system: { rules: [{ key: "RollOption", option: "mine" }, crafting(["mine"])] } })), [],
        "an option the item's own RollOption sets");
    assert.deepEqual(wrapperOptions(doc("x", "Goggles", { system: { rules: [crafting(["action:craft", "item:trait:alchemical"])] } })), []);
    const source = loadSource(fakeCheckout(t, { gear: ring }));
    const ignore = { [uuid("equipment-srd", GEAR_ID)]: "gear-magical" };
    const { problems } = checkEntries({ registry: {}, ignore, reasons: { "gear-magical": "x", repair: "x" }, source });
    assert.deepEqual(problems.map((p) => p.problem), ["ignored, but its Crafting bonus needs options only the roll wrapper adds: snare, trap"]);
    const deferred = checkEntries({ registry: {}, ignore: { [uuid("equipment-srd", GEAR_ID)]: "repair" }, reasons: { repair: "x" }, source });
    assert.deepEqual(deferred.problems, [], "Repair's options arrive with M5");
});

test("predicates may name only item options some physical item has; books and corrections are checked too", (t) => {
    const glowRod = doc(GEAR_ID, "Glow Rod", { root: { type: "consumable" }, system: {
        traits: { value: ["alchemical", "consumable", "light"], otherTags: ["alchemical-tool"], rarity: "common" }, category: "other",
        usage: { value: "held-in-one-hand" }, publication: { remaster: true, title: "Pathfinder GM Core" },
    } });
    const feat = doc(FEAT_ID, "Some Feat", { system: { traits: { value: ["general", "skill"], otherTags: ["feat-only"] } } });
    const source = loadSource(fakeCheckout(t, { gear: glowRod, feat }));
    const effect = (when) => ({ kind: "batchSize", multiply: 2, when });
    const registry = {
        good: { uuid: uuid("feats-srd", FEAT_ID), type: "feat", remaster: true, effects: [
            effect({ all: ["item:trait:alchemical", "item:type:consumable", "item:slug:glow-rod", "item:level:1", "item:rarity:common"],
                any: ["item:tag:alchemical-tool", "item:category:other", "item:usage:held-in-one-hand"] }),
            { kind: "rollOptions", options: ["item:tag:food"], when: { all: ["item:trait:light"] } },
            { kind: "batchSize", multiply: 2, when: { all: ["item:tag:food"] } },
            { kind: "virtualFormulaList", books: ["Pathfinder GM Core"] },
        ] },
        bad: { uuid: uuid("feats-srd", FEAT_ID), type: "feat", remaster: true, effects: [
            effect({ any: ["item:trait:elixir", "item:category:tool", "item:tag:feat-only", "item:group:firearm"] }),
            { kind: "virtualFormulaList", books: ["Pathfinder Nonexistent Guide"] },
        ] },
    };
    const problems = checkReferences({ registry, defaults: { alchemy: { all: ["item:trait:alchemical"] }, tattoos: { any: ["item:trait:tattoo"] } }, source });
    assert.deepEqual(problems.map((p) => `${p.key}: ${p.problem}`), [
        "bad: item:trait:elixir: no physical item in this checkout has it",
        "bad: item:category:tool: no physical item in this checkout has it",
        "bad: item:tag:feat-only: no physical item in this checkout has it",
        "bad: item:group:firearm: the validator cannot check item:group options",
        "bad: book \"Pathfinder Nonexistent Guide\": no physical item in this checkout is from it",
        "SPECIALTY_DEFAULTS.tattoos: item:trait:tattoo: no physical item in this checkout has it",
    ]);
    // A talisman correction goes stale once pf2e gives the item the consumable trait.
    const corrected = { uuid: uuid("equipment-srd", GEAR_ID), type: "consumable", remaster: true, effects: [{ kind: "correction", consumable: true }] };
    const stale = checkEntries({ registry: { "glow-rod": corrected }, ignore: {}, source });
    assert.deepEqual(stale.problems.map((p) => p.problem), ["has the consumable trait now, so its correction is stale"]);
});

test("completeness: an unlisted item that mentions formulas is reported; the Craft Requirements heading alone is not", (t) => {
    const source = loadSource(fakeCheckout(t));
    const found = unlisted({ registry: REG, ignore: {}, source });
    assert.deepEqual(found.map((item) => [item.name, item.mentions]), [["Formula Thing", ["formulas"]]]);
    assert.deepEqual(unlisted({ registry: REG, ignore: { [uuid("equipment-srd", "cccccccccccccccc")]: "fp-food" }, source }), []);
    assert.deepEqual(mentions({ system: { description: { value: "Earned income during your daily preparations; you craft." } } }),
        ["crafting", "daily preparations", "Earn Income"]);
    assert.deepEqual(mentions({ system: { description: { value: "<p>A crafty spell.</p>" } } }), []);
    assert.deepEqual(mentions({ system: { description: { value: "Earn Income with @UUID[Compendium.x]{Crafting}" } } }), ["crafting", "Earn Income"]);
});

test("the command line: no checkout is a usage error; drift fails the run", (t) => {
    const root = fakeCheckout(t);
    const log = logger();
    assert.equal(main(["--pf2e", ""], log), 2, "needs a checkout");
    // The shipped registry against the fake checkout: its UUIDs do not resolve there.
    assert.equal(main(["--pf2e", root], log), 1);
    assert.match(log.text(), /FAIL /);
});

test("the command line fails a checkout that lacks the packs it should check: nothing read is nothing passed", (t) => {
    // A pf2e manifest naming every pack the shipped registry and ignore list use, and none of their folders.
    const names = new Set([...Object.values(REGISTRY).map((e) => e.uuid), ...Object.keys(REGISTRY_IGNORE)].map((u) => u.split(".")[2]));
    const packs = [...names].map((name) => ({ name, path: `packs/${name}`, type: "Item" }));
    const root = tempDir(t, { "system.pf2e.json": { packs } });
    const log = logger();
    assert.equal(main(["--pf2e", root], log), 1);
    assert.match(log.text(), /FAIL \d+ entries and ignored UUIDs are in packs this checkout lacks/);
    assert.doesNotMatch(log.text(), /does not resolve/, "the packs are named, so nothing is reported missing from them");
    // Every entry checked and every candidate listed: a pack nothing names (spells-srd) still has to be there in
    // enforce mode, since completeness is about the packs.
    const data = { registry: REG, ignore: { [uuid("equipment-srd", "cccccccccccccccc")]: "fp-food" }, reasons: { "fp-food": "x" }, defaults: {} };
    assert.equal(main(["--pf2e", fakeCheckout(t)], logger(), data), 0, "nothing unchecked, nothing enforced");
    const enforced = logger();
    assert.equal(main(["--pf2e", fakeCheckout(t), "--enforce"], enforced, data), 1);
    assert.match(enforced.text(), /enforce mode needs every Item pack/);
});

/* -------------------------------------------- */
/*  Against a pf2e source checkout (PF2E_SRC)    */
/* -------------------------------------------- */

const NEEDS_SOURCE = { skip: !process.env.PF2E_SRC && "set PF2E_SRC to a pf2e checkout" };

test("every registry entry and ignored UUID matches the pf2e checkout", NEEDS_SOURCE, (t) => {
    const source = loadSource(process.env.PF2E_SRC);
    const { problems, unchecked } = checkEntries({ source });
    assert.deepEqual(problems, []);
    assert.deepEqual(unchecked, [], "entries and ignored UUIDs in packs this checkout lacks");
    assert.deepEqual(checkReferences({ source }), [], "item options, books");
    const missing = unlisted({ source });
    t.diagnostic(`completeness (report only): ${missing.length} candidate items in neither list; ` +
        `${Object.keys(REGISTRY).length} entries, ${Object.keys(REGISTRY_IGNORE).length} ignored`);
    if (source.skipped.size) t.diagnostic(`not in this checkout, so not checked: ${[...source.skipped].join(", ")}`);
});
