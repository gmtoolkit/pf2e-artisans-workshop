/**
 * The Foundry side of the fixture tools, against small fakes of the documents it touches: it refuses
 * to run outside a dev world, builds a character level by level with its choices filled in, only
 * rebuilds existing fixtures when asked, cleans up after a failed build, and marks what it makes
 * (actors and their folder) outside the module's own flags.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import { fixtures } from "../tools/harness/fixture-actors.mjs";
import { CLASS, FEAT, FEATURE, FIXTURES } from "../tools/harness/fixtures.mjs";

let calls;
let worldActors;
let worldFolders;
let tables;
/** The compendium documents `fromUuid` has loaded, by UUID: like a pack's cache, it returns the same copy each time. */
let loaded;
/** How the fakes misbehave: `failBuild` rejects the class features, `failDelete` rejects deletions. */
let faults;

/** A thaumaturge-like class: implement choices at levels 1 and 5, Implement Adept at 7. */
const classFeatures = [
    { level: 1, rules: [{ key: "ChoiceSet", flag: "implement" }] },
    { level: 5, rules: [{ key: "ChoiceSet", flag: "implement" }] },
    { level: 7, rules: [{ key: "ChoiceSet", flag: "implementAdept" }] },
    { level: 9, rules: [] },
];

function fakeActor(source) {
    const actor = {
        id: `actor${worldActors.length}`,
        uuid: `Actor.actor${worldActors.length}`,
        name: source.name,
        source,
        flags: source.flags ?? {},
        // Each creation also records the Domain Initiate copy's choice selection at that moment, as pf2e would see it.
        createEmbeddedDocuments: async (type, data, options = {}) =>
            calls.push(["embed", data, options, loaded.get(FEAT.domainInitiate)?.toObject().system.rules[0]?.selection]),
        update: async (data) => calls.push(["update", data]),
        delete: async () => {
            calls.push(["delete", actor.id]);
            if (faults.failDelete) throw new Error("delete failed");
            worldActors.splice(worldActors.indexOf(actor), 1);
        },
        class: {
            createGrantedItems: async ({ level }) => {
                if (faults.failBuild) throw new Error("build failed");
                return classFeatures
                    .filter((feature) => feature.level <= level)
                    .map((feature) => ({
                        system: { level: { value: feature.level } },
                        toObject: () => ({ name: `L${feature.level}`, system: { level: { value: feature.level }, rules: structuredClone(feature.rules) } }),
                    }));
            },
        },
    };
    worldActors.push(actor);
    return actor;
}

/**
 * Foundry globals for the tools. `rules` gives the rule elements of compendium items by UUID; `folders` the world's
 * actor folders (by default one marked as the fixtures' folder, "folder1"), to which `Folder.implementation.create`
 * adds.
 */
function stubFoundry({ dev = true, isGM = true, missing = [], rules = {}, folders = [{ id: "folder1", type: "Actor", flags: { world: { [`${MODULE_ID}-fixtures`]: true } } }] } = {}) {
    worldFolders = folders;
    globalThis.game = {
        settings: { get: (namespace, key) => (namespace === MODULE_ID && key === "dev" ? dev : undefined) },
        user: { isGM },
        actors: Object.assign(worldActors, { fromCompendium: (doc) => ({ name: doc.name, type: "npc", flags: {} }) }),
        folders: { find: (test) => worldFolders.find(test) },
    };
    globalThis.Folder = {
        implementation: {
            create: async (data) => {
                calls.push(["createFolder", data]);
                const folder = { id: `folder${worldFolders.length + 1}`, ...data };
                worldFolders.push(folder);
                return folder;
            },
        },
    };
    loaded = new Map();
    const compendiumDoc = (uuid) => ({
        uuid, name: uuid.split(".").pop(),
        _source: { _id: "x", name: uuid, system: { rules: structuredClone(rules[uuid] ?? []) } },
        toObject() { return structuredClone(this._source); },
        updateSource(changes) {
            for (const [path, value] of Object.entries(changes)) globalThis.foundry.utils.setProperty(this._source, path, structuredClone(value));
        },
    });
    globalThis.fromUuid = async (uuid) => {
        if (missing.includes(uuid)) return null;
        if (!loaded.has(uuid)) loaded.set(uuid, compendiumDoc(uuid));
        return loaded.get(uuid);
    };
    globalThis.foundry = {
        utils: {
            setProperty: (object, path, value) => {
                const keys = path.split(".");
                const last = keys.pop();
                let target = object;
                for (const key of keys) target = target[key] ??= {};
                target[last] = value;
            },
        },
    };
    globalThis.Actor = {
        implementation: {
            create: async (source) => {
                calls.push(["create", source]);
                return fakeActor(source);
            },
            deleteDocuments: async (ids) => calls.push(["deleteDocuments", ids]),
        },
    };
    globalThis.console.table = (rows) => tables.push(rows);
}

beforeEach(() => {
    calls = [];
    worldActors = [];
    tables = [];
    faults = {};
});

test("nothing runs unless the dev setting is on and the user is a GM", async () => {
    stubFoundry({ dev: false });
    await assert.rejects(fixtures.create(), /dev setting is off/);
    await assert.rejects(fixtures.remove(), /dev setting is off/);
    stubFoundry({ isGM: false });
    await assert.rejects(fixtures.create(), /GM tool/);
    assert.deepEqual(calls, []);
});

test("a character is built at level 0, then level by level with its choices filled in", async () => {
    stubFoundry();
    const [row] = await fixtures.create({ only: ["thaumaturge-8"] });
    assert.equal(row.status, "created");

    const [create, classItems, ...rest] = calls;
    assert.equal(create[0], "create");
    assert.equal(create[1].system.details.level.value, 0);
    assert.equal(create[1].folder, "folder1");
    assert.equal(classItems[1].length, 2, "ancestry and class first");
    assert.ok(classItems[1].every((source) => source._id === undefined && source._stats.compendiumSource));

    const steps = rest.map(([kind, data, options]) =>
        kind === "update" ? `level ${data["system.details.level.value"]}` : `${data.map((s) => s.name).join(",")}${options.keepId ? " keepId" : ""}`);
    const [esoterica] = FIXTURES.find((f) => f.id === "thaumaturge-8").feats;
    assert.deepEqual(steps, ["L1 keepId", "level 1", "L5 keepId", "level 5", "L7 keepId", "level 7", "level 8", esoterica]);

    const selections = rest.filter(([kind]) => kind === "embed").slice(0, 3).map(([, [source]]) => source.system.rules[0].selection);
    assert.deepEqual(selections, [FEATURE.amulet, FEATURE.chalice, FEATURE.amuletAdept]);
});

test("existing fixtures are kept unless reset, and a missing UUID stops everything", async () => {
    stubFoundry();
    await fixtures.create({ only: ["npc-ordinary"] });
    calls = [];
    const [kept] = await fixtures.create({ only: ["npc-ordinary"] });
    assert.equal(kept.status, "kept");
    assert.deepEqual(calls, []);

    const [rebuilt] = await fixtures.create({ only: ["npc-ordinary"], reset: true });
    assert.equal(rebuilt.status, "rebuilt");
    assert.deepEqual(calls.map(([kind]) => kind), ["create", "delete"], "the replacement is built first");
    assert.match(calls[0][1].name, /^Fixture 17a: ordinary NPC \(/);
    assert.equal(worldActors.length, 1);

    calls = [];
    const wizard = FIXTURES.find((f) => f.id === "wizard-9");
    stubFoundry({ missing: [wizard.class] });
    await assert.rejects(fixtures.create({ only: ["wizard-9", "npc-ordinary"], reset: true }), /not found/);
    assert.deepEqual(calls, []);
});

test("the ancestry and class get their own choice sets filled in", async () => {
    stubFoundry({ rules: { [CLASS.fighter]: [{ key: "ChoiceSet", flag: "fighterSkill", choices: [] }] } });
    await fixtures.create({ only: ["fighter-crafter-10"] });
    const [, [, [ancestry, cls]]] = calls;
    assert.deepEqual(ancestry.system.rules, []);
    assert.equal(cls.system.rules[0].selection, "athletics");
});

test("fixtures are marked outside the module's own flags, and found by their mark, an older mark included", async () => {
    stubFoundry();
    await fixtures.create({ only: ["npc-ordinary", "wizard-9"] });
    const marks = worldActors.map((actor) => [actor.flags.world?.[`${MODULE_ID}-fixture`], actor.flags[MODULE_ID]]);
    assert.deepEqual(marks.sort(), [["npc-ordinary", undefined], ["wizard-9", undefined]]);
    // A fixture built before the marks moved is still found (and kept) by its old mark.
    fakeActor({ name: "Fixture 16: Rogue poisoner", flags: { [MODULE_ID]: { fixture: "rogue-poisoner-6" } } });
    calls = [];
    assert.deepEqual((await fixtures.create({ only: ["rogue-poisoner-6"] })).map((row) => row.status), ["kept"]);
    assert.deepEqual(calls, []);
});

test("the fixtures' folder is created marked outside the module's flags, and found again by that mark or the older one", async () => {
    stubFoundry({ folders: [{ id: "other", type: "Actor", name: "Workshop fixtures", flags: {} }] });   // not ours: no mark
    await fixtures.create({ only: ["npc-ordinary"] });
    const created = calls.filter(([kind]) => kind === "createFolder").map(([, data]) => data);
    assert.equal(created.length, 1);
    assert.deepEqual([created[0].type, created[0].flags], ["Actor", { world: { [`${MODULE_ID}-fixtures`]: true } }], "a purge leaves this mark be");
    assert.equal(worldActors[0].source.folder, worldFolders.at(-1).id, "the fixture goes into it");
    calls = [];
    await fixtures.create({ only: ["wizard-9"] });
    assert.equal(calls.filter(([kind]) => kind === "createFolder").length, 0, "found again by its mark");
    stubFoundry({ folders: [{ id: "old", type: "Actor", flags: { [MODULE_ID]: { fixtures: true } } }] });   // made before the marks moved
    calls = [];
    await fixtures.create({ only: ["cleric-5"] });
    assert.equal(calls.filter(([kind]) => kind === "createFolder").length, 0);
    assert.equal(worldActors.at(-1).source.folder, "old");
});

test("a failed build removes the half-built actor and throws the build error", async (t) => {
    stubFoundry();
    faults.failBuild = true;
    await assert.rejects(fixtures.create({ only: ["wizard-9"] }), /build failed/);
    assert.equal(worldActors.length, 0, "the half-built actor is gone");
    assert.deepEqual(tables, [[]], "the report is printed anyway");

    // If the clean-up fails as well, the build error is still the one thrown.
    faults.failDelete = true;
    const logged = t.mock.method(console, "error", () => {});
    await assert.rejects(fixtures.create({ only: ["wizard-9"] }), /build failed/);
    assert.match(logged.mock.calls[0].arguments[0], /could not remove half-built wizard-9/);
});

test("a failed rebuild keeps the old fixture", async () => {
    stubFoundry();
    const [first] = await fixtures.create({ only: ["wizard-9"] });
    faults.failBuild = true;
    await assert.rejects(fixtures.create({ only: ["wizard-9"], reset: true }), /build failed/);
    assert.deepEqual(worldActors.map((actor) => actor.uuid), [first.uuid]);
});

test("a choice set two grants deep is answered on the compendium copy pf2e loads, for the build only", async () => {
    // The cleric's First Doctrine grants First Doctrine (Cloistered Cleric), which grants Domain Initiate. pf2e hands
    // a grant's preselections only to the item it grants, so the domain must already be chosen on the copy of Domain
    // Initiate that the inner grant clones (seen live: a Domain Initiate prompt opened during the build).
    const choiceSet = { key: "ChoiceSet", flag: "domainInitiate", choices: "system.details.deities.domains" };
    stubFoundry({ rules: { [FEAT.domainInitiate]: [choiceSet] } });
    await fixtures.create({ only: ["cleric-5"] });
    const embeds = calls.filter(([kind]) => kind === "embed");
    assert.ok(embeds.length > 1);
    assert.deepEqual([...new Set(embeds.map(([, , , selection]) => selection))], ["family"], "answered while every item was created");
    assert.deepEqual(loaded.get(FEAT.domainInitiate).toObject().system.rules, [choiceSet], "and the copy is put back afterwards");

    calls = [];
    faults.failBuild = true;
    await assert.rejects(fixtures.create({ only: ["cleric-5"], reset: true }), /build failed/);
    assert.deepEqual(loaded.get(FEAT.domainInitiate).toObject().system.rules, [choiceSet], "also after a failed build");
});

test("unknown ids are rejected", async () => {
    stubFoundry();
    await assert.rejects(fixtures.create({ only: ["nobody"] }), /unknown fixture ids: nobody/);
});
