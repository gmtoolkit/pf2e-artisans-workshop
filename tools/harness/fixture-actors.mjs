/**
 * Create, reset and remove the fixture actors of `fixtures.mjs` in a test world (DESIGN.md 15.4).
 *
 * Loaded only when the module's hidden `dev` setting is on, and only for a GM (scripts/module.mjs).
 * From the browser console of the test world:
 *
 *   const { fixtures } = game.modules.get("pf2e-artisans-workshop").dev;
 *   await fixtures.create();                         // create the missing ones
 *   await fixtures.create({ reset: true });          // rebuild them all
 *   await fixtures.create({ only: ["wizard-9"] });   // just these
 *   fixtures.list();                                 // what exists
 *   await fixtures.remove();                         // delete them all
 *
 * Fixture actors carry `flags.pf2e-artisans-workshop.fixture` (their id) and live in a folder flagged
 * `fixtures`; nothing else in the world is touched. Output goes to the console only: this is a
 * developer tool, not part of the module's interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { ANCESTRY, FIXTURES, applyChoices, characterSource, choicePicker, fixtureUuids, loreSources } from "./fixtures.mjs";

const FOLDER_NAME = "Workshop fixtures";

export const fixtures = { create, list, remove, definitions: FIXTURES };

/**
 * Create the fixture actors that do not exist yet; with `reset`, rebuild existing ones.
 * @param {object} [options]
 * @param {string[]} [options.only]  fixture ids to act on (default: all)
 * @param {boolean} [options.reset]  rebuild fixtures that already exist
 * @returns {Promise<{id: string, status: string, uuid: string}[]>}
 */
async function create({ only = null, reset = false } = {}) {
    assertDevGM();
    const wanted = selected(only);
    // Every UUID must resolve before anything is deleted or created.
    await resolve([...new Set(wanted.flatMap(fixtureUuids))]);

    const folder = await fixtureFolder();
    const existing = fixtureActors();
    const report = [];
    try {
        for (const fixture of wanted) {
            const old = existing.get(fixture.id);
            if (old && !reset) {
                report.push({ id: fixture.id, status: "kept", uuid: old.uuid });
                continue;
            }
            const actor = fixture.npc ? await createNpc(fixture, folder) : await createCharacter(fixture, folder);
            // The old actor goes only once its replacement is built, so a failed rebuild keeps it.
            if (old) await old.delete();
            report.push({ id: fixture.id, status: old ? "rebuilt" : "created", uuid: actor.uuid });
        }
    } finally {
        // Also when a build fails: the rows so far say what was done before it.
        console.table(report);
    }
    return report;
}

/** Every fixture with the actor that currently stands for it, if any. */
function list() {
    const existing = fixtureActors();
    const rows = FIXTURES.map((fixture) => ({
        id: fixture.id,
        build: fixture.build,
        actor: existing.get(fixture.id)?.uuid ?? null,
    }));
    console.table(rows);
    return rows;
}

/** Delete the fixture actors (all, or `only` these ids). */
async function remove({ only = null } = {}) {
    assertDevGM();
    const existing = fixtureActors();
    const ids = selected(only).map((fixture) => existing.get(fixture.id)?.id).filter(Boolean);
    await Actor.implementation.deleteDocuments(ids);
    console.log(`${MODULE_ID} | removed ${ids.length} fixture actor(s)`);
    return ids.length;
}

/* -------------------------------------------- */
/*  Building                                     */
/* -------------------------------------------- */

/**
 * Build a character the way the system would, without its choice prompts:
 *
 * 1. Create the actor at level 0 and add the ancestry and class, with their own choice sets filled in
 *    (the fighter's class picks a trained skill). The class grants only features at or below the
 *    actor's level, so at level 0 it grants none.
 * 2. Ask the class for its features up to the fixture's level (`createGrantedItems`, the same call
 *    pf2e makes on level-up) and fill in their choice sets.
 * 3. Level up one feature level at a time: create that level's features, then raise the actor to it.
 *    pf2e's level-up adds the class features the actor lacks, and it lacks none. Going level by level
 *    lets a feature read what earlier ones set up (the thaumaturge's Implement Adept lists the
 *    implements chosen before it).
 * 4. Add the feats, equipment and Lore skills at the final level.
 */
async function createCharacter(fixture, folder) {
    const [ancestry, cls, ...extras] = await resolve([ANCESTRY.human, fixture.class, ...fixture.feats, ...fixture.items]);
    const pick = choicePicker(fixture.choices);

    const actor = await Actor.implementation.create(characterSource(fixture, folder.id));
    try {
        const abc = [ancestry, cls].map((doc) => applyChoices(compendiumSource(doc), pick, fixture.choices));
        await actor.createEmbeddedDocuments("Item", abc);

        const features = await actor.class.createGrantedItems({ level: fixture.level });
        const byLevel = Map.groupBy(features, (feature) => feature.system.level.value);
        for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
            const sources = byLevel.get(level).map((feature) => applyChoices(feature.toObject(), pick, fixture.choices));
            // keepId, as pf2e's own level-up does: the ids are the compendium ids, unique within a class.
            await actor.createEmbeddedDocuments("Item", sources, { keepId: true });
            await actor.update({ "system.details.level.value": level });
        }
        await actor.update({ "system.details.level.value": fixture.level });

        const extraSources = extras.map((doc) => applyChoices(compendiumSource(doc), pick, fixture.choices));
        await actor.createEmbeddedDocuments("Item", [...extraSources, ...loreSources(fixture)]);
    } catch (error) {
        // A half-built fixture would be "kept" by the next create(), so remove it. If that fails too, the
        // build error is still the one thrown.
        await actor.delete().catch((cleanup) => {
            console.error(`${MODULE_ID} | could not remove half-built ${fixture.id}`, cleanup);
        });
        throw error;
    }
    return actor;
}

/** Import a bestiary actor, renamed and flagged as a fixture. */
async function createNpc(fixture, folder) {
    const [npc] = await resolve([fixture.npc]);
    const data = game.actors.fromCompendium(npc);
    data.name = `${fixture.name} (${npc.name})`;
    data.folder = folder.id;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.fixture`, fixture.id);
    return Actor.implementation.create(data);
}

/* -------------------------------------------- */
/*  Helpers                                      */
/* -------------------------------------------- */

function assertDevGM() {
    if (game.settings.get(MODULE_ID, "dev") !== true) throw new Error(`${MODULE_ID} | the dev setting is off`);
    if (!game.user.isGM) throw new Error(`${MODULE_ID} | fixtures are a GM tool`);
}

function selected(only) {
    if (!only) return FIXTURES;
    const unknown = only.filter((id) => !FIXTURES.some((fixture) => fixture.id === id));
    if (unknown.length) throw new Error(`${MODULE_ID} | unknown fixture ids: ${unknown.join(", ")}`);
    return FIXTURES.filter((fixture) => only.includes(fixture.id));
}

/** Fixture id to actor, for the actors in this world. */
function fixtureActors() {
    const actors = new Map();
    for (const actor of game.actors) {
        const id = actor.getFlag(MODULE_ID, "fixture");
        if (id) actors.set(id, actor);
    }
    return actors;
}

async function fixtureFolder() {
    const folder = game.folders.find((f) => f.type === "Actor" && f.getFlag(MODULE_ID, "fixtures"));
    return folder ?? Folder.implementation.create({ name: FOLDER_NAME, type: "Actor", flags: { [MODULE_ID]: { fixtures: true } } });
}

/** Load compendium documents by UUID, failing before anything is created if one is missing. */
async function resolve(uuids) {
    const docs = await Promise.all(uuids.map((uuid) => fromUuid(uuid)));
    const missing = uuids.filter((_, i) => !docs[i]);
    if (missing.length) throw new Error(`${MODULE_ID} | not found in the installed pf2e packs: ${missing.join(", ")}`);
    return docs;
}

/** A compendium item as embedded-item creation data, remembering where it came from. */
function compendiumSource(doc) {
    const source = doc.toObject();
    delete source._id;
    foundry.utils.setProperty(source, "_stats.compendiumSource", doc.uuid);
    return source;
}
