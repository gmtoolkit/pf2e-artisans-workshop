/**
 * Fixture actors for the local Foundry harness (DESIGN.md 15.3, 15.4): generic builds made from pf2e
 * compendium items, so every scenario starts from the same characters.
 *
 * This file is data plus pure helpers and runs in Node tests as well as in Foundry.
 * `fixture-actors.mjs` turns the definitions into actors in a test world.
 *
 * Items are referenced by compendium UUID (P9); the comment beside each UUID is only a reminder of
 * the item's name. The UUIDs were read from the pf2e source (release 8.6.1 and the v14-dev branch);
 * `PF2E_SRC=<checkout> npm test` checks them again, and walks each build to check that every choice
 * set it meets has an answer here. Every character is a human with no heritage and no background, so
 * that no build carries choices it does not need; attribute modifiers are entered directly (pf2e's
 * manual attribute mode) instead of through boosts.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";

const pf2e = (pack, id, type = "Item") => `Compendium.pf2e.${pack}.${type}.${id}`;

export const ANCESTRY = {
    human: pf2e("ancestries", "IiG7DgeLWYrSNXuX"),
};

export const CLASS = {
    alchemist: pf2e("classes", "XwfcJuskrhI9GIjX"),
    cleric: pf2e("classes", "EizrWvUPMS67Pahd"),
    druid: pf2e("classes", "7s57JDCaiYYCAdFx"),
    fighter: pf2e("classes", "8zn3cD6GSmoo1LW4"),
    inventor: pf2e("classes", "30qVs46dVNflgQNx"),
    ranger: pf2e("classes", "Yix76sfxrIlltSTJ"),
    rogue: pf2e("classes", "LO9STvskJemPkiAI"),
    thaumaturge: pf2e("classes", "Y5GsHqzCzJlKka6x"),
    witch: pf2e("classes", "bYDXk9HUMKOuym9h"),
    wizard: pf2e("classes", "RwjIZzIxzPpUglnK"),
};

/** Class features: choice-set answers, plus one legacy feature added directly. */
export const FEATURE = {
    bomber: pf2e("classfeatures", "7JbiaZ8bxODM5mzS"),
    chirurgeon: pf2e("classfeatures", "eNZnx4LISDNftbx2"),
    mutagenist: pf2e("classfeatures", "tvdb1jkjl2bRZjSp"),
    toxicologist: pf2e("classfeatures", "P9quO9XZi3OWFe1k"),
    infusedReagents: pf2e("classfeatures", "wySB9VHOW1v3TX1L"), // legacy
    cloisteredCleric: pf2e("classfeatures", "ZZzLMOUAtBVgV1DF"),
    leafOrder: pf2e("classfeatures", "u4nlOzPj2WHkIj9l"),
    armorInnovation: pf2e("classfeatures", "fpwtpm8pdwO1I6MO"),
    metallicReactance: pf2e("classfeatures", "xndlv9T3JgYYUtf8"),
    precision: pf2e("classfeatures", "u6cBjqz2fiRBadBt"),
    mastermind: pf2e("classfeatures", "RyOkmu0W9svavuAB"),
    thief: pf2e("classfeatures", "wAh2riuFRzz0edPl"),
    amulet: pf2e("classfeatures", "PoclGJ7BCEyIuqJe"),
    chalice: pf2e("classfeatures", "1vgFGSnn0DIBmK7j"),
    amuletAdept: pf2e("classfeatures", "l3X6D8uMlt2y6vGS"), // Adept Benefit (Amulet)
    faithsFlamekeeper: pf2e("classfeatures", "mFqMSQoNl0NMDklv"),
    unifiedMagicalTheory: pf2e("classfeatures", "xYYhJtGhFSWNifcO"), // School of Unified Magical Theory
    spellBlending: pf2e("classfeatures", "OAcxS625AXSGrQIC"),
};

export const FEAT = {
    communalCrafting: pf2e("feats-srd", "lUXVmSFJbaPos5pY"),
    cauldron: pf2e("feats-srd", "zUtdBd3IbM7UX0AD"),
    doubleDouble: pf2e("feats-srd", "wwnhnV3balaVdMu5"), // Double, Double
    efficientAlchemy: pf2e("feats-srd", "c7jNms3ZQ8eaMUqv"), // Efficient Alchemy (Alchemist)
    enduringAlchemy: pf2e("feats-srd", "jBeuyq0Aged45YAc"),
    eternalElixir: pf2e("feats-srd", "giOEclnMp8txkRSU"),
    experiencedProfessional: pf2e("feats-srd", "sMm0UfYxEPpq2Yzd"),
    extendElixir: pf2e("feats-srd", "asRbkgW59DZUpvAq"),
    gadgetSpecialist: pf2e("feats-srd", "DQN7YC7s7T0pL6Aa"),
    healingBomb: pf2e("feats-srd", "xXHwktc9SymSY8d6"),
    improviseAdmixture: pf2e("feats-srd", "H6SL2F11nlMfqCQC"),
    inventor: pf2e("feats-srd", "XR95taODq1sq82Du"), // the skill feat
    magicalCrafting: pf2e("feats-srd", "xWY5omyIcILNR7y1"),
    persistentMutagen: pf2e("feats-srd", "GKP2dHkgQw1o0k8g"),
    plantEmpathy: pf2e("feats-srd", "ahyQpMVDIqhvXkQ4"),
    poisonWeapon: pf2e("feats-srd", "ALbosSUygdq4T1Yk"),
    poisonerDedication: pf2e("feats-srd", "y7DDs03GtDnmhxFp"),
    quickFix: pf2e("feats-srd", "RlhvppSmQRqL2RUe"),
    reachSpell: pf2e("feats-srd", "BWomK7EVY0WXxWgh"),
    reverseEngineer: pf2e("feats-srd", "Na1qfHd6AFAXoN1A"), // the inventor class feat
    snareCrafting: pf2e("feats-srd", "DMetdzt1VJL2Y62i"),
    snarecrafterDedication: pf2e("feats-srd", "4MUbwilvb9dI0X59"),
    specialtyCrafting: pf2e("feats-srd", "QLeMH5mQgh28sa5o"),
    talismanDabblerDedication: pf2e("feats-srd", "1t5479E6bdvFs4E7"),
    talismanEsoterica: pf2e("feats-srd", "ygCLN0brunmBYtJR"),
    tattooArtist: pf2e("feats-srd", "z0HX5L7bOOrKi0dD"),
};

export const EQUIPMENT = {
    alchemistsToolkit: pf2e("equipment-srd", "4ftXXUCBHcf4b0MH"),
    artisansToolkit: pf2e("equipment-srd", "y34yjumCFakrbtdw"),
    powerSuit: pf2e("equipment-srd", "N42lmp3Ft6EsSvzg"),
};

export const DEITY = {
    erastil: pf2e("deities", "mm1j6UbHqFCI8fwB"),
};

export const NPC = {
    goblinWarrior: pf2e("pathfinder-monster-core", "fLLKuOXwPq1Iq0U4", "Actor"), // level -1
    skeletonGuard: pf2e("pathfinder-monster-core", "trchDxbDR2TiPMxT", "Actor"), // immune to poison
    frostGiant: pf2e("pathfinder-monster-core", "893mp411SdYren3H", "Actor"), // level 9
};

/**
 * The builds of DESIGN.md 15.4. `build` is the row number there.
 *
 * Character fields:
 * - `attributes`: modifiers, 0 when omitted.
 * - `skills`: proficiency ranks (1 trained ... 4 legendary). The class's own trained skills apply too.
 * - `lore`: Lore skills by name, with their rank.
 * - `choices`: answers to the system's choice prompts, by the choice set's flag: on the class itself,
 *   its features, the feats and items, and whatever those grant. A flag that appears on more than one
 *   class feature (the thaumaturge's implements) takes a list, used in level order.
 * - `feats` and `items`: added after the class features, unslotted.
 *
 * NPC fields: `npc`, the bestiary actor to import.
 */
export const FIXTURES = [
    {
        id: "toxicologist-1", build: "1", name: "Fixture 1: Toxicologist alchemist", level: 1,
        class: CLASS.alchemist,
        attributes: { int: 4, dex: 2, con: 2, wis: 1 },
        skills: { crafting: 1 },
        choices: { researchField: FEATURE.toxicologist },
        feats: [],
        items: [EQUIPMENT.alchemistsToolkit],
    },
    {
        id: "mutagenist-5", build: "2", name: "Fixture 2: Mutagenist alchemist", level: 5,
        class: CLASS.alchemist,
        attributes: { int: 4, con: 2, dex: 1, wis: 1 },
        skills: { crafting: 2 },
        choices: { researchField: FEATURE.mutagenist },
        feats: [FEAT.efficientAlchemy, FEAT.improviseAdmixture],
        items: [EQUIPMENT.alchemistsToolkit],
    },
    {
        id: "bomber-11", build: "3", name: "Fixture 3: Bomber alchemist, Talisman Dabbler", level: 11,
        class: CLASS.alchemist,
        attributes: { int: 5, dex: 3, con: 2, wis: 2 },
        skills: { crafting: 3 },
        choices: { researchField: FEATURE.bomber },
        // Talisman Dabbler as the free-archetype feat; Double Brew and Advanced Vials are class features.
        feats: [FEAT.talismanDabblerDedication, FEAT.quickFix],
        items: [EQUIPMENT.alchemistsToolkit],
    },
    {
        id: "chirurgeon-9", build: "4", name: "Fixture 4: Chirurgeon alchemist", level: 9,
        class: CLASS.alchemist,
        attributes: { int: 4, con: 2, dex: 2, wis: 2 },
        skills: { crafting: 2 },
        choices: { researchField: FEATURE.chirurgeon },
        feats: [FEAT.healingBomb, FEAT.communalCrafting, FEAT.enduringAlchemy],
        items: [EQUIPMENT.alchemistsToolkit],
    },
    {
        id: "toxicologist-poisoner-8", build: "5", name: "Fixture 5: Toxicologist alchemist, Poisoner", level: 8,
        class: CLASS.alchemist,
        attributes: { int: 4, dex: 3, con: 2, wis: 1 },
        skills: { crafting: 2 },
        choices: { researchField: FEATURE.toxicologist },
        feats: [FEAT.poisonerDedication],
        items: [EQUIPMENT.alchemistsToolkit],
    },
    {
        id: "mutagenist-16", build: "5b", name: "Fixture 5b: Mutagenist alchemist", level: 16,
        class: CLASS.alchemist,
        attributes: { int: 5, dex: 3, con: 3, wis: 2 },
        skills: { crafting: 3 },
        choices: { researchField: FEATURE.mutagenist },
        feats: [FEAT.extendElixir, FEAT.eternalElixir, FEAT.persistentMutagen],
        items: [EQUIPMENT.alchemistsToolkit],
    },
    {
        id: "fighter-crafter-10", build: "6", name: "Fixture 6: Fighter crafter", level: 10,
        class: CLASS.fighter,
        attributes: { str: 5, con: 3, dex: 2, int: 3 },
        skills: { crafting: 3, athletics: 2 },
        choices: { fighterSkill: "athletics", fighterWeaponMastery: "sword", specialtyCrafting: "blacksmithing" },
        feats: [FEAT.magicalCrafting, FEAT.specialtyCrafting, FEAT.inventor],
        items: [EQUIPMENT.artisansToolkit],
    },
    {
        id: "wizard-9", build: "7", name: "Fixture 7: Wizard", level: 9,
        class: CLASS.wizard,
        attributes: { int: 4, dex: 2, con: 2, wis: 1 },
        skills: { arcana: 2 },
        // The school's choice set is flagged "feat": its 1st-level wizard feat.
        choices: { arcaneSchool: FEATURE.unifiedMagicalTheory, feat: FEAT.reachSpell, arcaneThesis: FEATURE.spellBlending },
        feats: [],
        items: [],
    },
    {
        id: "ranger-snares-8", build: "8", name: "Fixture 8: Ranger snarecrafter", level: 8,
        class: CLASS.ranger,
        attributes: { dex: 4, wis: 2, con: 2, int: 2 },
        skills: { crafting: 2, survival: 2 },
        choices: { huntersEdge: FEATURE.precision },
        feats: [FEAT.snareCrafting, FEAT.snarecrafterDedication],
        items: [EQUIPMENT.artisansToolkit],
    },
    {
        id: "inventor-6", build: "9", name: "Fixture 9: Inventor", level: 6,
        class: CLASS.inventor,
        attributes: { int: 4, dex: 2, con: 2, str: 1 },
        skills: { crafting: 2 },
        choices: {
            innovation: FEATURE.armorInnovation,
            armorInnovation: EQUIPMENT.powerSuit,
            initialModification: FEATURE.metallicReactance,
        },
        feats: [FEAT.gadgetSpecialist, FEAT.reverseEngineer],
        items: [EQUIPMENT.artisansToolkit],
    },
    {
        id: "thaumaturge-8", build: "10", name: "Fixture 10: Thaumaturge", level: 8,
        class: CLASS.thaumaturge,
        attributes: { cha: 4, dex: 2, con: 2, wis: 1 },
        skills: {},
        choices: { implement: [FEATURE.amulet, FEATURE.chalice], implementAdept: FEATURE.amuletAdept },
        feats: [FEAT.talismanEsoterica],
        items: [],
    },
    {
        id: "witch-10", build: "11", name: "Fixture 11: Witch", level: 10,
        class: CLASS.witch,
        attributes: { int: 5, con: 2, dex: 2, wis: 1 },
        skills: { crafting: 1 },
        choices: { patron: FEATURE.faithsFlamekeeper },
        feats: [FEAT.cauldron, FEAT.doubleDouble],
        items: [EQUIPMENT.artisansToolkit],
    },
    {
        id: "rogue-tattoo-7", build: "12", name: "Fixture 12: Rogue tattoo artist", level: 7,
        class: CLASS.rogue,
        attributes: { dex: 4, int: 3, con: 1, cha: 2 },
        skills: { crafting: 3 },
        lore: { "Cooking Lore": 2 },
        // Mastermind's own choice set (flag "mastermind") trains one more skill.
        choices: { roguesRacket: FEATURE.mastermind, mastermind: "system.skills.arcana.rank" },
        feats: [FEAT.tattooArtist, FEAT.experiencedProfessional],
        items: [EQUIPMENT.artisansToolkit],
    },
    {
        id: "cleric-5", build: "13", name: "Fixture 13: Cleric helper", level: 5,
        class: CLASS.cleric,
        attributes: { wis: 4, cha: 2, con: 2, int: 1 },
        skills: { crafting: 1, religion: 2 },
        // The cloistered cleric's first doctrine grants Domain Initiate, which picks one of the deity's domains.
        choices: {
            deity: DEITY.erastil, sanctification: "none", doctrine: FEATURE.cloisteredCleric, divineFont: "heal",
            domainInitiate: "family",
        },
        feats: [],
        items: [EQUIPMENT.artisansToolkit],
    },
    {
        id: "legacy-alchemist-3", build: "14", name: "Fixture 14: Legacy alchemist", level: 3,
        class: CLASS.alchemist,
        attributes: { int: 4, dex: 2, con: 2 },
        skills: { crafting: 2 },
        choices: { researchField: FEATURE.chirurgeon },
        // The pre-Remaster infused reagents feature, as an older character would still carry it.
        feats: [FEATURE.infusedReagents],
        items: [EQUIPMENT.alchemistsToolkit],
    },
    {
        id: "druid-grower-8", build: "15", name: "Fixture 15: Druid grower", level: 8,
        class: CLASS.druid,
        attributes: { wis: 4, int: 2, con: 2, dex: 1 },
        skills: { crafting: 2, nature: 2 },
        lore: { "Herbalism Lore": 1 },
        // Voice of Nature's choice set is flagged "feat".
        choices: { druidicOrder: FEATURE.leafOrder, feat: FEAT.plantEmpathy },
        feats: [FEAT.magicalCrafting],
        items: [EQUIPMENT.artisansToolkit],
    },
    {
        id: "rogue-poisoner-6", build: "16", name: "Fixture 16: Rogue poisoner", level: 6,
        class: CLASS.rogue,
        attributes: { dex: 4, int: 2, con: 2 },
        skills: { crafting: 1, stealth: 2 },
        choices: { roguesRacket: FEATURE.thief },
        feats: [FEAT.poisonWeapon, FEAT.poisonerDedication],
        items: [EQUIPMENT.alchemistsToolkit],
    },
    { id: "npc-ordinary", build: "17", name: "Fixture 17a: ordinary NPC", npc: NPC.goblinWarrior },
    { id: "npc-poison-immune", build: "17", name: "Fixture 17b: poison-immune NPC", npc: NPC.skeletonGuard },
    { id: "npc-high-level", build: "17", name: "Fixture 17c: 9th-level NPC", npc: NPC.frostGiant },
];

export const ATTRIBUTES = ["str", "dex", "con", "int", "wis", "cha"];

/** pf2e's skill slugs (src/scripts/config/index.ts). */
export const SKILLS = [
    "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine",
    "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery",
];

/* -------------------------------------------- */
/*  Helpers                                      */
/* -------------------------------------------- */

/**
 * The actor's creation data. The level starts at 0, so that adding the class grants no features;
 * `fixture-actors.mjs` adds them itself with the choices filled in, then raises the level.
 */
export function characterSource(fixture, folder = null) {
    return {
        name: fixture.name,
        type: "character",
        folder,
        flags: { [MODULE_ID]: { fixture: fixture.id } },
        system: {
            details: { level: { value: 0 } },
            abilities: Object.fromEntries(ATTRIBUTES.map((key) => [key, { mod: fixture.attributes?.[key] ?? 0 }])),
            skills: Object.fromEntries(Object.entries(fixture.skills ?? {}).map(([slug, rank]) => [slug, { rank }])),
        },
    };
}

/** Lore skill items for the fixture's `lore` entries. */
export function loreSources(fixture) {
    return Object.entries(fixture.lore ?? {}).map(([name, rank]) => ({
        name,
        type: "lore",
        system: { proficient: { value: rank } },
    }));
}

/**
 * A function that answers a choice-set flag from `choices`. A list answers the same flag several
 * times, in order; once it is used up the flag has no answer and pf2e prompts as usual.
 */
export function choicePicker(choices = {}) {
    const used = new Map();
    return (flag) => {
        const value = choices[flag];
        if (!Array.isArray(value)) return value;
        const index = used.get(flag) ?? 0;
        used.set(flag, index + 1);
        return value[index];
    };
}

/**
 * Fill in a copy of an item source's choice sets from `pick`, so pf2e creates the item without
 * prompting. GrantItem rules also get the fixture's single-valued choices as `preselectChoices`,
 * which pf2e applies to the choice sets of the item they grant (the research field, the innovation).
 */
export function applyChoices(itemSource, pick, choices = {}) {
    const source = structuredClone(itemSource);
    const preselect = Object.fromEntries(Object.entries(choices).filter(([, value]) => !Array.isArray(value)));
    for (const rule of source.system?.rules ?? []) {
        if (rule.key === "ChoiceSet") {
            const value = pick(choiceSetFlag(rule, source));
            if (value !== undefined) rule.selection = value;
        } else if (rule.key === "GrantItem" && Object.keys(preselect).length) {
            rule.preselectChoices = { ...preselect, ...rule.preselectChoices };
        }
    }
    return source;
}

/**
 * The flag pf2e gives a choice set: its own `flag`, else its `slug`, else the item's slug, in
 * camelCase (pf2e's `sluggify(..., {camel: "dromedary"})`).
 */
export function choiceSetFlag(rule, itemSource) {
    if (typeof rule.flag === "string" && rule.flag) return rule.flag.replace(/[^-a-z0-9]/gi, "");
    return dromedary(rule.slug ?? itemSource.system?.slug ?? itemSource.name ?? "");
}

function dromedary(text) {
    return text
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+(.)?/g, (_, next) => (next ? next.toUpperCase() : ""))
        .replace(/^./, (first) => first.toLowerCase());
}

/** Every compendium UUID a fixture needs: its items or NPC, and the UUIDs among its choices. */
export function fixtureUuids(fixture) {
    if (fixture.npc) return [fixture.npc];
    const choiceUuids = Object.values(fixture.choices ?? {})
        .flat()
        .filter((value) => typeof value === "string" && value.startsWith("Compendium."));
    return [ANCESTRY.human, fixture.class, ...fixture.feats, ...fixture.items, ...choiceUuids];
}

/** Problems with the definitions themselves; the tests require none. */
export function validateFixtures(fixtures = FIXTURES) {
    const problems = [];
    const uuid = /^Compendium\.pf2e\.[a-z0-9-]+\.(Item|Actor)\.[A-Za-z0-9]{16}$/;
    const ids = new Set();
    for (const fixture of fixtures) {
        const where = `fixture ${fixture.id}`;
        if (ids.has(fixture.id)) problems.push(`${where}: duplicate id`);
        ids.add(fixture.id);
        if (!fixture.name?.startsWith("Fixture ")) problems.push(`${where}: name must start with "Fixture "`);
        if (fixture.npc) {
            if (!uuid.test(fixture.npc) || !fixture.npc.includes(".Actor.")) problems.push(`${where}: npc is not an Actor UUID`);
            continue;
        }
        if (!Number.isInteger(fixture.level) || fixture.level < 1 || fixture.level > 20) problems.push(`${where}: level must be 1-20`);
        for (const item of fixtureUuids(fixture)) {
            if (!uuid.test(item ?? "") || !item.includes(".Item.")) problems.push(`${where}: ${item} is not an Item UUID`);
        }
        for (const [key, mod] of Object.entries(fixture.attributes ?? {})) {
            if (!ATTRIBUTES.includes(key) || !Number.isInteger(mod) || mod < -5 || mod > 7) problems.push(`${where}: bad attribute ${key}`);
        }
        for (const [slug, rank] of Object.entries(fixture.skills ?? {})) {
            if (!SKILLS.includes(slug) || ![0, 1, 2, 3, 4].includes(rank)) problems.push(`${where}: bad skill ${slug}`);
        }
        for (const [name, rank] of Object.entries(fixture.lore ?? {})) {
            if (!name.endsWith(" Lore") || ![1, 2, 3, 4].includes(rank)) problems.push(`${where}: bad lore ${name}`);
        }
    }
    return problems;
}
