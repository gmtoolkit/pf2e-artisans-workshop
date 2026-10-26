import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import {
    ANCESTRY, FEATURE, FIXTURES, applyChoices, characterSource, choicePicker, choiceSetFlag, fixtureMarkOf, fixtureUuids,
    loreSources, validateFixtures,
} from "../tools/harness/fixtures.mjs";

test("the definitions are well formed", () => {
    assert.deepEqual(validateFixtures(), []);
});

test("every build of DESIGN.md 15.4 has a fixture", () => {
    const builds = new Set(FIXTURES.map((fixture) => fixture.build));
    const expected = ["1", "2", "3", "4", "5", "5b", ...Array.from({ length: 12 }, (_, i) => String(i + 6))];
    assert.deepEqual([...builds].sort(), expected.sort());
    assert.equal(FIXTURES.filter((fixture) => fixture.build === "17").length, 3, "three NPC targets");
});

test("validateFixtures reports bad definitions", () => {
    const bad = [
        { id: "a", name: "Fixture a", level: 0, class: "Compendium.pf2e.classes.Item.short", feats: [], items: [], skills: { cooking: 2 } },
        { id: "a", name: "Hero", npc: "Compendium.pf2e.feats-srd.Item.0123456789abcdef" },
    ];
    const problems = validateFixtures(bad);
    for (const expected of ["level must be 1-20", "is not an Item UUID", "bad skill cooking", "duplicate id", 'must start with "Fixture "', "not an Actor UUID"]) {
        assert.ok(problems.some((problem) => problem.includes(expected)), expected);
    }
});

test("characterSource starts at level 0 with manual attributes, ranks and the fixture flag", () => {
    const fixture = FIXTURES.find((f) => f.id === "rogue-tattoo-7");
    const source = characterSource(fixture, "folder1");
    assert.equal(source.type, "character");
    assert.equal(source.folder, "folder1");
    assert.equal(source.system.details.level.value, 0);
    assert.deepEqual(source.system.abilities.dex, { mod: 4 });
    assert.deepEqual(source.system.abilities.wis, { mod: 0 });
    assert.deepEqual(source.system.skills, { crafting: { rank: 3 } });
    assert.equal(source.flags.world[`${MODULE_ID}-fixture`], "rogue-tattoo-7");
    assert.equal(source.flags[MODULE_ID], undefined, "marked outside the module's own flags, which a purge removes");
    assert.equal(fixtureMarkOf(source), "rogue-tattoo-7");
    assert.equal(fixtureMarkOf({ flags: { [MODULE_ID]: { fixture: "wizard-9" } } }), "wizard-9", "a fixture built before the marks moved");
    assert.equal(fixtureMarkOf({ flags: {} }), null);
    assert.deepEqual(loreSources(fixture), [{ name: "Cooking Lore", type: "lore", system: { proficient: { value: 2 } } }]);
});

test("choicePicker answers repeated flags from a list, in order", () => {
    const pick = choicePicker({ implement: ["a", "b"], patron: "p" });
    assert.deepEqual([pick("implement"), pick("implement"), pick("implement")], ["a", "b", undefined]);
    assert.deepEqual([pick("patron"), pick("patron"), pick("other")], ["p", "p", undefined]);
});

test("applyChoices fills choice sets and preselects through GrantItem, without touching the input", () => {
    const item = {
        name: "Some Feature",
        system: {
            slug: "some-feature",
            rules: [
                { key: "ChoiceSet", flag: "researchField", choices: { filter: [] } },
                { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.researchField}" },
                { key: "ChoiceSet", slug: "sanctification", choices: [] },
                { key: "ChoiceSet", choices: [] },
                { key: "GrantItem", uuid: "x", preselectChoices: { researchField: "kept" } },
            ],
        },
    };
    const choices = { researchField: FEATURE.toxicologist, sanctification: "none", implement: ["a"] };
    const filled = applyChoices(item, choicePicker(choices), choices);
    const [field, grant, sanctification, unanswered, preset] = filled.system.rules;
    assert.equal(field.selection, FEATURE.toxicologist);
    assert.deepEqual(grant.preselectChoices, { researchField: FEATURE.toxicologist, sanctification: "none" });
    assert.equal(sanctification.selection, "none");
    assert.equal(unanswered.selection, undefined, "a set whose flag (someFeature) has no answer is left to prompt");
    assert.equal(preset.preselectChoices.researchField, "kept", "the item's own preselection wins");
    assert.equal(item.system.rules[0].selection, undefined);
});

test("choiceSetFlag follows pf2e's defaults", () => {
    assert.equal(choiceSetFlag({ flag: "huntersEdge" }, {}), "huntersEdge");
    assert.equal(choiceSetFlag({ slug: "sanctification" }, {}), "sanctification");
    assert.equal(choiceSetFlag({}, { system: { slug: "deity-cleric" } }), "deityCleric");
    assert.equal(choiceSetFlag({}, { name: "Rogue's Racket" }), "roguesRacket");
});

/* -------------------------------------------- */
/*  Against a pf2e source checkout (PF2E_SRC)    */
/* -------------------------------------------- */

const NEEDS_SOURCE = { skip: !process.env.PF2E_SRC && "set PF2E_SRC to a pf2e checkout" };

/**
 * The items of a pf2e source checkout, by compendium UUID. In the source files a UUID names its item by
 * `_id` or by name. `get` returns undefined for an item its pack lacks, and null for a pack that
 * system.pf2e.json lists but a sparse checkout left out (`skipped` collects those); a pack the system
 * does not have at all fails the test.
 */
function pf2eSource(root) {
    const manifest = JSON.parse(readFileSync(join(root, "system.pf2e.json"), "utf8"));
    // Built pack name to source folder: "feats-srd" is built from packs/pf2e/feats.
    const folders = new Map(manifest.packs.map((pack) => [pack.name, pack.path.split("/").pop()]));
    const packs = new Map();
    const skipped = new Set();
    function get(uuid) {
        const [, , name, , ...id] = uuid.split(".");
        assert.ok(folders.has(name), `${uuid}: system.pf2e.json has no pack "${name}"`);
        if (!packs.has(name)) packs.set(name, loadPack(join(root, "packs", "pf2e", folders.get(name))));
        const items = packs.get(name);
        if (!items) skipped.add(name);
        return items === null ? null : items.get(id.join("."));
    }
    return { get, skipped };
}

/** The items in one pack folder, by `_id` and by name, or null if the checkout lacks the folder. */
function loadPack(dir) {
    if (!existsSync(dir)) return null;
    const items = new Map();
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_")) {
            const item = JSON.parse(readFileSync(join(entry.parentPath, entry.name), "utf8"));
            items.set(item._id, item).set(item.name, item);
        }
    }
    return items;
}

const reportSkipped = (t, source) => {
    if (source.skipped.size) t.diagnostic(`not in this checkout, so not checked: ${[...source.skipped].join(", ")}`);
};

test("every fixture UUID exists in the pf2e source", NEEDS_SOURCE, (t) => {
    const source = pf2eSource(process.env.PF2E_SRC);
    const missing = [...new Set(FIXTURES.flatMap(fixtureUuids))].filter((uuid) => source.get(uuid) === undefined);
    assert.deepEqual(missing, []);
    reportSkipped(t, source);
});

/**
 * What would make building `fixture` prompt: a choice set it meets with no answer, an answer that is not
 * one of a static list of choices, or a grant the walk cannot follow.
 *
 * The walk follows what pf2e creates: the ancestry and class, the class features up to the fixture's
 * level, the feats and items, and every item those grant, whether the GrantItem names it, a choice
 * selects it (`{item|flags.system.rulesSelections.<flag>}`), or an ActiveEffectLike stores it in an
 * actor flag (`{actor|flags.system.<path>}`: the alchemist's field discoveries, the cleric's doctrines).
 * An actor flag may be set by an item the walk reaches after the grant that reads it, so the walk repeats
 * until the flags stop changing. Predicates are not evaluated, so a predicated choice set needs an
 * answer too (an answer pf2e never asks for is harmless). A set with one static choice, or with its
 * selection already in the item, needs none.
 *
 * Where an answer can come from depends on how deep the item is granted. The builder fills in the items it
 * creates itself (depth 0) from the fixture's choices, and gives their GrantItem rules the fixture's single-valued
 * choices as `preselectChoices`, which pf2e applies to the item each grants (depth 1). pf2e passes a grant's
 * preselections no further (`#applyChoicePreselections` in `grant-item/rule-element.ts`), so an item two or more
 * grants deep has only the preselections of the compendium's own grant, unless the fixture lists it as `nested`:
 * the builder then answers it on the compendium copy pf2e loads.
 */
function promptsIn(fixture, source) {
    // The source files name items in UUIDs by name; the fixtures (like the built packs) use ids.
    const sameChoice = (value, answer) =>
        value === answer || (value.startsWith?.("Compendium.") && source.get(value) === source.get(answer));
    const singleValued = Object.fromEntries(Object.entries(fixture.choices).filter(([, value]) => !Array.isArray(value)));
    const nested = new Set((fixture.nested ?? []).map((uuid) => source.get(uuid)));
    const actorFlags = {};
    let flagsBefore;
    let problems;
    do {
        flagsBefore = JSON.stringify(actorFlags);
        problems = new Set();
        const seen = new Set();
        const deep = new Set();
        const visit = (uuid, preset = {}, depth = 0) => {
            const item = source.get(uuid);
            if (item === undefined) problems.add(`${uuid} is not in the pf2e source`);
            if (!item || seen.has(uuid)) return;
            seen.add(uuid);
            if (depth >= 2) deep.add(item);
            for (const rule of item.system.rules ?? []) {
                if (rule.key === "ChoiceSet") {
                    const flag = choiceSetFlag(rule, item);
                    const answer = depth === 0 || nested.has(item) ? fixture.choices[flag] : preset[flag];
                    const values = Array.isArray(rule.choices) ? rule.choices.map((choice) => choice.value) : null;
                    if (answer === undefined && rule.selection == null && values?.length !== 1) {
                        problems.add(`no answer for ${flag} (${item.name})`);
                    } else if (typeof answer === "string" && values && !values.some((value) => sameChoice(value, answer))) {
                        problems.add(`${flag} (${item.name}): "${answer}" is not one of ${values.join(", ")}`);
                    }
                } else if (rule.key === "ActiveEffectLike" && rule.path?.startsWith("flags.system.")) {
                    const keys = rule.path.split(".").slice(2);
                    let target = actorFlags;
                    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
                    target[keys.at(-1)] = rule.value;
                } else if (rule.key === "GrantItem") {
                    const targets = grantTargets(rule.uuid, fixture.choices, actorFlags);
                    if (!targets.length) problems.add(`cannot follow the grant of ${rule.uuid} (${item.name})`);
                    const preselect = depth === 0 ? { ...singleValued, ...rule.preselectChoices } : { ...rule.preselectChoices };
                    for (const target of targets) visit(target, preselect, depth + 1);
                }
            }
        };
        visit(ANCESTRY.human);
        visit(fixture.class);
        for (const feature of Object.values(source.get(fixture.class)?.system.items ?? {})) {
            if (feature.level <= fixture.level) visit(feature.uuid);
        }
        for (const uuid of [...fixture.feats, ...fixture.items]) visit(uuid);
        for (const uuid of fixture.nested ?? []) {
            if (!deep.has(source.get(uuid))) problems.add(`nested ${uuid} is not granted two or more grants deep`);
        }
    } while (JSON.stringify(actorFlags) !== flagsBefore);
    return [...problems];
}

test("the walk knows how far pf2e passes a preselection: one grant down, no further", () => {
    const item = (name, rules) => ({ name, system: { rules } });
    const items = new Map([
        ["Compendium.pf2e.classes.Item.cls", item("Class", [])],
        ["Compendium.pf2e.feats-srd.Item.outer", item("Outer", [{ key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.middle" }])],
        ["Compendium.pf2e.feats-srd.Item.middle", item("Middle", [
            { key: "ChoiceSet", flag: "near", choices: [{ value: "a" }, { value: "b" }] },
            { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.inner" },
        ])],
        ["Compendium.pf2e.feats-srd.Item.inner", item("Inner", [{ key: "ChoiceSet", flag: "far", choices: [{ value: "x" }, { value: "y" }] }])],
    ]);
    items.set(ANCESTRY.human, item("Human", []));
    const source = { get: (uuid) => items.get(uuid) };
    const fixture = { class: "Compendium.pf2e.classes.Item.cls", level: 1, choices: { near: "a", far: "x" }, feats: ["Compendium.pf2e.feats-srd.Item.outer"], items: [] };
    assert.deepEqual(promptsIn(fixture, source), ["no answer for far (Inner)"], "two grants deep, the fixture's answer does not reach");
    assert.deepEqual(promptsIn({ ...fixture, nested: ["Compendium.pf2e.feats-srd.Item.inner"] }, source), []);
    assert.deepEqual(promptsIn({ ...fixture, nested: ["Compendium.pf2e.feats-srd.Item.middle"] }, source),
        ["no answer for far (Inner)", "nested Compendium.pf2e.feats-srd.Item.middle is not granted two or more grants deep"]);
});

/** The compendium UUIDs a GrantItem's `uuid` names, from the fixture's choices and the actor flags. */
function grantTargets(uuid, choices, actorFlags) {
    const chosen = /^\{item\|flags\.system\.rulesSelections\.(\w+)\}$/.exec(uuid);
    const stored = /^\{actor\|flags\.system\.([\w.]+)\}$/.exec(uuid);
    const targets = chosen
        ? [choices[chosen[1]]].flat()
        : stored
          ? [stored[1].split(".").reduce((flags, key) => flags?.[key], actorFlags)]
          : [uuid];
    return targets.filter((target) => typeof target === "string" && target.startsWith("Compendium."));
}

test("building a fixture raises no choice prompts", NEEDS_SOURCE, (t) => {
    const source = pf2eSource(process.env.PF2E_SRC);
    const problems = FIXTURES.filter((fixture) => !fixture.npc)
        .flatMap((fixture) => promptsIn(fixture, source).map((problem) => `${fixture.id}: ${problem}`));
    assert.deepEqual(problems, []);
    reportSkipped(t, source);
});
