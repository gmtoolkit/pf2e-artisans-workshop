/**
 * tools/validate-registry.mjs (DESIGN.md 6.11, 15.2): over a small fake checkout, then, with PF2E_SRC set, the
 * shipped registry and ignore list against a real pf2e checkout.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY } from "../scripts/data/registry.mjs";
import { REGISTRY_IGNORE } from "../scripts/data/registry-ignore.mjs";
import { AFFLICTION_IGNORE, AFFLICTION_OVERRIDES } from "../scripts/data/afflictions.mjs";
import {
    checkAfflictions, checkEntries, checkReferences, contains, loadSource, main, mentions, sluggify, unlisted, wrapperOptions,
} from "../tools/validate-registry.mjs";
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

test("a daily pool's correction is reported once pf2e's CraftingAbility rule no longer reads as its bug says (second M7 review)", (t) => {
    const source = loadSource(fakeCheckout(t));
    const entry = (bug) => ({ uuid: uuid("feats-srd", FEAT_ID), type: "feat", remaster: true,
        effects: [{ kind: "correction", pool: "talisman-dabbler", slots: { add: -1, unless: "wilderness" }, bug }] });
    assert.deepEqual(checkEntries({ registry: { "talisman-dabbler-dedication": entry({ slug: "talisman-dabbler", maxSlots: 2 }) }, ignore: {}, source }).problems, []);
    const stale = checkEntries({ registry: { "talisman-dabbler-dedication": entry({ slug: "talisman-dabbler", maxSlots: 4 }) }, ignore: {}, source });
    assert.deepEqual(stale.problems.map((p) => p.problem),
        ['its CraftingAbility rule no longer reads {"slug":"talisman-dabbler","maxSlots":4}: check whether the talisman-dabbler correction is still needed']);
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
    const names = new Set([...Object.values(REGISTRY).map((e) => e.uuid), ...Object.keys(REGISTRY_IGNORE), ...Object.values(AFFLICTION_OVERRIDES).map((e) => e.uuid),
        ...Object.keys(AFFLICTION_IGNORE)].map((u) => u.split(".")[2]));
    const packs = [...names].map((name) => ({ name, path: `packs/${name}`, type: "Item" }));
    const root = tempDir(t, { "system.pf2e.json": { packs } });
    const log = logger();
    assert.equal(main(["--pf2e", root], log), 1);
    assert.match(log.text(), /FAIL \d+ entries and ignored UUIDs are in packs this checkout lacks/);
    assert.doesNotMatch(log.text(), /does not resolve/, "the packs are named, so nothing is reported missing from them");
    // Every entry checked and every candidate listed: a pack nothing names (spells-srd) still has to be there in
    // enforce mode, since completeness is about the packs.
    const data = { registry: REG, ignore: { [uuid("equipment-srd", "cccccccccccccccc")]: "fp-food" }, reasons: { "fp-food": "x" }, defaults: {},
        afflictions: { overrides: {}, ignore: {}, reasons: {} } };
    assert.equal(main(["--pf2e", fakeCheckout(t)], logger(), data), 0, "nothing unchecked, nothing enforced");
    const enforced = logger();
    assert.equal(main(["--pf2e", fakeCheckout(t), "--enforce"], enforced, data), 1);
    assert.match(enforced.text(), /enforce mode needs every Item pack/);
});

/* -------------------------------------------- */
/*  Afflictions (M8a, 8.10.2)                    */
/* -------------------------------------------- */

const para = (label, rest) => `<p><strong>${label}</strong> ${rest}</p>`;
const poisonDoc = (id, name, html, traits = ["consumable", "injury", "poison"]) => doc(id, name, {
    root: { type: "consumable" }, system: { description: { value: html }, traits: { value: traits }, level: { value: 3 } },
});
const SAVE = para("Saving Throw", "@Check[fortitude|dc:20]");
const CLEAN = `${SAVE}${para("Maximum Duration", "6 rounds")}${para("Stage 1", "@Damage[1d6[poison]] damage (1 round)")}`;
const PROSE = `${SAVE}${para("Stage 1", "+1 item bonus to something (1 hour)")}`;

function afflictionCheckout(t) {
    return tempDir(t, {
        "system.pf2e.json": MANIFEST,
        "packs/pf2e/equipment/p000000000000001.json": poisonDoc("p000000000000001", "Clean Venom", CLEAN),
        "packs/pf2e/equipment/p000000000000002.json": poisonDoc("p000000000000002", "Prose Draught", PROSE),
        "packs/pf2e/equipment/p000000000000003.json": poisonDoc("p000000000000003", "Fixed Draught", PROSE),
        "packs/pf2e/equipment/p000000000000004.json": poisonDoc("p000000000000004", "Delayed Potion", para("Onset", "1 minute"), ["consumable", "potion"]),
        "packs/pf2e/equipment/p000000000000005.json": poisonDoc("p000000000000005", "Again Venom", `<p>Further exposure does nothing.</p>${CLEAN}`),
        "packs/pf2e/equipment/p000000000000006.json": poisonDoc("p000000000000006", "Kindless Fang", CLEAN, ["magical"]),
        "packs/pf2e/feats/level-1/aaaaaaaaaaaaaaa1.json": doc(FEAT_ID, "Talisman Dabbler Dedication"),
    });
}

test("afflictions: each candidate parses fully, has an override or is ignored; intros and kindless items need review", (t) => {
    const source = loadSource(afflictionCheckout(t));
    const overrides = { "fixed-draught": { uuid: uuid("equipment-srd", "p000000000000003"), prose: [1] } };
    const ignore = { [uuid("equipment-srd", "p000000000000004")]: "not-affliction" };
    const out = checkAfflictions({ source, overrides, ignore, reasons: { "not-affliction": "x" } });
    assert.deepEqual(out.summary, { candidates: 6, full: 1, overridden: 1, ignored: 1, failed: 3,
        poisons: { candidates: 4, full: 1, overridden: 1, ignored: 0 } });
    assert.deepEqual(out.problems.map((p) => p.key).sort(), [uuid("equipment-srd", "p000000000000002"), uuid("equipment-srd", "p000000000000005"),
        uuid("equipment-srd", "p000000000000006")]);
    assert.match(out.problems.find((p) => p.key.endsWith("2")).problem, /does not parse fully/);
    assert.match(out.problems.find((p) => p.key.endsWith("5")).problem, /further exposure/);
    assert.match(out.problems.find((p) => p.key.endsWith("6")).problem, /no affliction kind/);
    assert.deepEqual(out.unchecked, []);
    // A changed parse between two tags is reported against a baseline of digests.
    const changed = checkAfflictions({ source, overrides, ignore, reasons: { "not-affliction": "x" },
        baseline: { [uuid("equipment-srd", "p000000000000001")]: "different" } });
    assert.deepEqual(changed.changed.map((c) => c.name), ["Clean Venom"]);
});

test("afflictions: overrides and ignored UUIDs are checked like registry entries", (t) => {
    const source = loadSource(afflictionCheckout(t));
    const out = checkAfflictions({
        source,
        overrides: { "wrong-slug": { uuid: uuid("equipment-srd", "p000000000000002"), prose: [1] }, "gone": { uuid: uuid("equipment-srd", "zzzzzzzzzzzzzzzz") },
            "spelled": { uuid: uuid("spells-srd", "zzzzzzzzzzzzzzzz") } },
        ignore: { [uuid("equipment-srd", "p000000000000002")]: "nope" }, reasons: {},
    });
    const text = out.problems.map((p) => `${p.key}: ${p.problem}`).join("\n");
    assert.match(text, /wrong-slug: slug is now prose-draught/);
    assert.match(text, /wrong-slug: overridden and on the affliction ignore list/);
    assert.match(text, /gone: .* does not resolve/);
    assert.match(text, /unknown affliction ignore reason nope/);
    assert.deepEqual(out.unchecked, ["spelled"], "a pack the checkout lacks is not passed");
});

test("the shipped overrides are numbers, slugs and UUIDs only (P9), keyed by slug, never on the ignore list", () => {
    const strings = [];
    const walk = (value, path) => {
        if (typeof value === "string") strings.push([path, value]);
        else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(AFFLICTION_OVERRIDES, "overrides");
    assert.deepEqual(strings.filter(([, s]) => /\s/.test(s)), []);
    for (const [key, entry] of Object.entries(AFFLICTION_OVERRIDES)) {
        assert.match(key, /^[a-z0-9-]+$/);
        assert.match(entry.uuid, /^Compendium\.pf2e\.[a-z-]+\.Item\.[A-Za-z0-9]{16}$/);
        assert.ok(!(entry.uuid in AFFLICTION_IGNORE), key);
        for (const n of entry.prose ?? []) assert.ok(Number.isInteger(n) && n > 0, key);
        assert.ok(!entry.reExposure || ["none", "reset-max", "table"].includes(entry.reExposure), key);
    }
});

/* -------------------------------------------- */
/*  Against a pf2e source checkout (PF2E_SRC)    */
/* -------------------------------------------- */

const NEEDS_SOURCE = { skip: !process.env.PF2E_SRC && "set PF2E_SRC to a pf2e checkout" };

test("the daily-pool corrections answer pf2e's compendium rules as they read (second M7 review: Herbalist, Lethargy Poisoner, the archetype's Advanced Alchemy)", NEEDS_SOURCE, () => {
    const source = loadSource(process.env.PF2E_SRC);
    const rulesOf = (key) => (source.get(REGISTRY[key].uuid)?.system?.rules ?? []).filter((r) => r.key === "CraftingAbility");
    assert.deepEqual(rulesOf("herbalist-dedication").map((r) => [r.slug, r.maxSlots]), [["advanced-alchemy", 4]], "Herbalist: 4 always");
    assert.deepEqual(rulesOf("lethargy-poisoner").map((r) => [r.maxSlots ?? null, r.craftableItems]),
        [["ternary(gte(@actor.system.skills.crafting.rank,3),3,1)", ["item:slug:lethargy-poison"]], [null, ["item:slug:stupor-poison"]]],
        "Lethargy Poisoner: 3 doses from master; Stupor Poison on a rule whose rank predicate CraftingAbility never tests");
    assert.deepEqual(rulesOf("advanced-alchemy@archetype").map((r) => r.craftableItems), [["item:trait:alchemical"]], "any alchemical item, not consumables only");
});

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

test("every affliction candidate in the pf2e checkout parses fully, has an override or is ignored", NEEDS_SOURCE, (t) => {
    const source = loadSource(process.env.PF2E_SRC);
    const out = checkAfflictions({ source });
    assert.deepEqual(out.problems, []);
    assert.deepEqual(out.unchecked, []);
    const a = out.summary;
    t.diagnostic(`afflictions: ${a.candidates} candidates, ${a.full} parse fully, ${a.overridden} overridden, ${a.ignored} ignored; ` +
        `poisons ${a.poisons.candidates}: ${a.poisons.full} parse fully, ${a.poisons.overridden} overridden`);
});
