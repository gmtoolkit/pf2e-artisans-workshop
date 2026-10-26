import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import {
    ANCESTRY, FEATURE, FIXTURES, applyChoices, characterSource, choicePicker, choiceSetFlag, fixtureUuids,
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
    assert.equal(source.flags[MODULE_ID].fixture, "rogue-tattoo-7");
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
 */
function promptsIn(fixture, source) {
    // The source files name items in UUIDs by name; the fixtures (like the built packs) use ids.
    const sameChoice = (value, answer) =>
        value === answer || (value.startsWith?.("Compendium.") && source.get(value) === source.get(answer));
    const actorFlags = {};
    let flagsBefore;
    let problems;
    do {
        flagsBefore = JSON.stringify(actorFlags);
        problems = new Set();
        const seen = new Set();
        const visit = (uuid, preset = {}) => {
            const item = source.get(uuid);
            if (item === undefined) problems.add(`${uuid} is not in the pf2e source`);
            if (!item || seen.has(uuid)) return;
            seen.add(uuid);
            for (const rule of item.system.rules ?? []) {
                if (rule.key === "ChoiceSet") {
                    const flag = choiceSetFlag(rule, item);
                    const answer = fixture.choices[flag] ?? preset[flag];
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
                    for (const target of targets) visit(target, rule.preselectChoices);
                }
            }
        };
        visit(ANCESTRY.human);
        visit(fixture.class);
        for (const feature of Object.values(source.get(fixture.class)?.system.items ?? {})) {
            if (feature.level <= fixture.level) visit(feature.uuid);
        }
        for (const uuid of [...fixture.feats, ...fixture.items]) visit(uuid);
    } while (JSON.stringify(actorFlags) !== flagsBefore);
    return [...problems];
}

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
