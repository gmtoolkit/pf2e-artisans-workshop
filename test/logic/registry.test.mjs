/** The rules registry (DESIGN.md 6.11): its data's shape and the lookups the M1 rules and the roll wrapper read. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY, SPECIALTY_DEFAULTS } from "../../scripts/data/registry.mjs";
import { IGNORE_REASONS, REGISTRY_IGNORE } from "../../scripts/data/registry-ignore.mjs";
import { FEAT, RANK } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { craftRoute } from "../../scripts/logic/formula-jobs.mjs";
import { crafterRate } from "../../scripts/logic/progress.mjs";
import { gateFeats, gateTools } from "../../scripts/logic/gates.mjs";
import { wagePerDay } from "../../scripts/logic/earn-income.mjs";
import {
    accessGrant, batchMultiplier, consumableFix, craftOptions, craftSkills, earnIncomeFlags, formulaPicks, heldEffects,
    heldKeys, holds, itemOptions, keyOfUuid, modifiers, parseHeld, rateLevel, registryEntry, rollOptions, routeInputs,
    setupOverride, shiftDegree, testPredicate, tools, unlocks, virtualFormula,
} from "../../scripts/logic/registry.mjs";

const uuidOf = (key) => REGISTRY[key].uuid;

/** Facts of a few compendium products, as the Foundry side would read them. */
const ELIXIR = { uuid: "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318", type: "consumable", slug: "elixir-of-life-minor",
    traits: ["alchemical", "consumable", "elixir", "healing"], rarity: "common", level: 1, category: "elixir", book: "Pathfinder Player Core 2" };
const TALISMAN = { uuid: "Compendium.pf2e.equipment-srd.Item.aaaaaaaaaaaaaaaa", type: "consumable", traits: ["consumable", "magical", "talisman"],
    rarity: "common", level: 6, book: "Pathfinder GM Core" };
const TATTOO = { uuid: "Compendium.pf2e.equipment-srd.Item.bbbbbbbbbbbbbbbb", type: "equipment", traits: ["magical", "tattoo"], rarity: "common", level: 2 };

/* -------------------------------------------- */
/*  The data                                     */
/* -------------------------------------------- */

const KINDS = {
    craftUnlock: (e) => typeof e.category === "string" || typeof e.access === "object",
    formulaAllowance: (e) => ["gain", "level", "rank"].includes(e.on) && (Number.isInteger(e.count) || Array.isArray(e.uuids)) &&
        (e.on !== "rank" || (typeof e.skill === "string" && Array.isArray(e.ranks))),
    virtualFormulaList: (e) => Array.isArray(e.uuids) || typeof e.filter === "object" || Array.isArray(e.books),
    setupDays: (e) => Number.isInteger(e.days) && e.days >= 0,
    rateLevel: (e) => Number.isInteger(e.add) || e.source === "monster",
    degreeShift: (e) => [0, 1, 2, 3].includes(e.from) && [0, 1, 2, 3].includes(e.to) && typeof e.when === "object",
    batchSize: (e) => Number.isInteger(e.multiply) && e.multiply > 1,
    rollOptions: (e) => Array.isArray(e.options) && e.options.every((o) => typeof o === "string"),
    modifier: (e) => typeof e.slug === "string" && ["circumstance", "item", "status", "untyped"].includes(e.type) && Number.isInteger(e.value),
    skillSubstitution: (e) => typeof e.skill === "string" && typeof e.when === "object",
    toolSubstitution: (e) => Array.isArray(e.tools) && e.tools.length > 0,
    earnIncome: (e) => typeof e.doubleFailure === "boolean",
    // A talisman batched as a consumable; or (M7, 7.1) a daily pool's source: its slots, what it makes, or a rank gate,
    // with the pf2e rule it answers.
    correction: (e) => e.consumable === true || (typeof e.pool === "string" && typeof e.bug === "object" && (
        (typeof e.slots === "object" && (Array.isArray(e.slots.byRank) ? e.slots.byRank.every(Number.isInteger) && typeof e.slots.skill === "string"
            : Number.isInteger(e.slots.add))) ||
        typeof e.craftable === "object" ||
        (typeof e.gate === "object" && typeof e.gate.when === "object" && typeof e.gate.skill === "string" && Number.isInteger(e.gate.rank)))),
    repairHp: (e) => Number.isInteger(e.success) && Number.isInteger(e.critSuccess),
    variantOnly: (e) => typeof e.variant === "string" && e.variant in rulesWith({}).variants,
    // M7 (7.1, 7.4, 7.7, 7.10).
    dcStamp: (e) => typeof e.pool === "string" && Array.isArray(e.dcs) && e.dcs.every((dc) => ["class", "spell"].includes(dc)),
    dailyGap: (e) => ["note", "designate", "dailies"].includes(e.flow),
    vialSource: (e) => typeof e.regain === "boolean",
    expiryRule: (e) => e.rule === "designate" && typeof e.when === "object",
};

test("every entry has the schema of scripts/data/registry.mjs, tier 4 exactly for legacy entries", () => {
    const problems = [];
    for (const [key, entry] of Object.entries(REGISTRY)) {
        const bad = (why) => problems.push(`${key}: ${why}`);
        if (!/^[a-z0-9-]+(@[a-z]+)?$/.test(key)) bad("key");
        if (!/^Compendium\.pf2e\.[a-z-]+\.Item\.[A-Za-z0-9]{16}$/.test(entry.uuid)) bad("uuid");
        if (![1, 2, 3, 4].includes(entry.tier)) bad("tier");
        if ((entry.tier === 4) !== (entry.remaster === false)) bad("tier 4 is legacy-only content");
        if (typeof entry.type !== "string" || typeof entry.book !== "string" || entry.verified !== "pf2e-8.6.1") bad("type, book or verified");
        for (const effect of entry.effects) if (!KINDS[effect.kind]?.(effect)) bad(`effect ${JSON.stringify(effect)}`);
        for (const r of entry.relies ?? []) if (typeof r.key !== "string" || typeof r.match !== "object") bad("relies");
        if (entry.choice !== undefined && typeof entry.choice !== "string") bad("choice");
    }
    assert.deepEqual(problems, []);
});

test("the registry ships numbers, slugs, UUIDs and predicates, never rules text (P9)", () => {
    const strings = [];
    const walk = (value, path) => {
        if (typeof value === "string") strings.push([path, value]);
        else if (value && typeof value === "object") {
            for (const [k, v] of Object.entries(value)) if (k !== "book" && k !== "books") walk(v, `${path}.${k}`);
        }
    };
    for (const [key, entry] of Object.entries(REGISTRY)) walk(entry, key);
    assert.deepEqual(strings.filter(([, s]) => /\s/.test(s)), [], "only publication titles hold a space");
});

test("UUIDs are unique; the ignore list neither overlaps the registry nor names an unknown reason", () => {
    const uuids = Object.values(REGISTRY).map((e) => e.uuid);
    assert.equal(new Set(uuids).size, uuids.length);
    assert.deepEqual(Object.keys(REGISTRY_IGNORE).filter((uuid) => uuids.includes(uuid)), []);
    assert.deepEqual(Object.values(REGISTRY_IGNORE).filter((reason) => !(reason in IGNORE_REASONS)), []);
    assert.ok(Object.isFrozen(REGISTRY.seasoned.effects[0]) && Object.isFrozen(REGISTRY_IGNORE));
});

test("tiers 1 and 2 are seeded; every feat slug the M1 rules read has an entry", () => {
    const tiers = Object.values(REGISTRY).reduce((n, e) => ({ ...n, [e.tier]: (n[e.tier] ?? 0) + 1 }), {});
    assert.ok(tiers[1] >= 40 && tiers[2] >= 100, JSON.stringify(tiers));
    for (const slug of Object.values(FEAT)) assert.ok(REGISTRY[slug.split(":")[0]], slug);
    assert.deepEqual(Object.keys(SPECIALTY_DEFAULTS).sort(), ["alchemy", "artistry"]);
});

/* -------------------------------------------- */
/*  Held keys and options                        */
/* -------------------------------------------- */

test("heldKeys matches by source UUID, else by an unshared slug, and adds a choice", () => {
    const held = heldKeys([
        { sourceId: uuidOf("magical-crafting"), slug: "renamed-homebrew" },
        { sourceId: null, slug: "efficient-alchemy-alchemist" },
        { sourceId: "Compendium.world.x.Item.y", slug: "advanced-alchemy" },     // shared by two entries: no match
        { sourceId: uuidOf("specialty-crafting"), slug: "specialty-crafting", selections: { specialtyCrafting: "alchemy" } },
        { sourceId: uuidOf("tattoo-artist"), slug: "tattoo-artist", selections: { other: "x" } },
        { sourceId: null, slug: "not-in-the-registry" },
    ]);
    assert.deepEqual(held, ["efficient-alchemy-alchemist", "magical-crafting", "specialty-crafting:alchemy", "tattoo-artist"]);
    assert.deepEqual(parseHeld("specialty-crafting:alchemy"), { key: "specialty-crafting", choice: "alchemy" });
    assert.equal(registryEntry("specialty-crafting:alchemy"), REGISTRY["specialty-crafting"]);
    assert.equal(keyOfUuid(uuidOf("advanced-alchemy@archetype")), "advanced-alchemy@archetype");
});

test("itemOptions names an item's facts as pf2e's getRollOptions does; predicates read all, any and not", () => {
    const options = itemOptions({ ...ELIXIR, otherTags: ["alchemical-food"], usage: "held-in-one-hand", id: "hDLbR56Id2OtU318" });
    for (const o of ["item:type:consumable", "item:slug:elixir-of-life-minor", "item:trait:healing", "item:rarity:common", "item:level:1",
        "item:category:elixir", "item:tag:alchemical-food", "item:usage:held-in-one-hand", "item:id:hDLbR56Id2OtU318"]) assert.ok(options.has(o), o);
    assert.equal(itemOptions({ traits: [] }).has("item:rarity:common"), true, "rarity defaults to common");
    assert.equal(testPredicate({ all: ["a"], any: ["b", "c"], not: ["d"] }, new Set(["a", "c"])), true);
    assert.equal(testPredicate({ all: ["a"], any: ["b"] }, new Set(["a"])), false);
    assert.equal(testPredicate({ not: ["d"] }, new Set(["d"])), false);
    assert.equal(testPredicate(undefined, new Set()), true);
});

test("craftOptions adds the context and the trades the Craft falls under; specialty:own for the crafter's own", () => {
    const item = itemOptions(ELIXIR);
    const own = craftOptions({ item, held: ["specialty-crafting:alchemy"], route: "known", material: "monster" });
    for (const o of ["craft-type:item", "route:known", "material:monster", "specialty:alchemy", "specialty:own"]) assert.ok(own.has(o), o);
    const other = craftOptions({ item, held: ["specialty-crafting:blacksmithing"] });
    assert.ok(other.has("specialty:alchemy") && !other.has("specialty:own"));
    const chosen = craftOptions({ item: itemOptions({ type: "weapon", traits: [] }), held: ["specialty-crafting:blacksmithing"], specialty: "blacksmithing" });
    assert.ok(chosen.has("specialty:blacksmithing") && chosen.has("specialty:own"));
    assert.ok(craftOptions({ item: [], craftType: "tattoo" }).has("specialty:artistry"));
});

/* -------------------------------------------- */
/*  Gates, routes and planning                   */
/* -------------------------------------------- */

test("Talisman Dabbler unlocks talismans (G4) and knows every common talisman of the crafter's level or lower", () => {
    const held = ["talisman-dabbler-dedication"];
    assert.deepEqual(unlocks(held), ["talisman"]);
    const crafter = { feats: [], unlocks: unlocks(held), ranks: { crafting: RANK.expert }, level: 8 };
    assert.equal(gateFeats(crafter, TALISMAN).ok, true);
    assert.equal(gateFeats({ ...crafter, unlocks: [] }, TALISMAN).ok, false);
    const options = itemOptions(TALISMAN);
    assert.equal(virtualFormula(held, TALISMAN, options, 8), true);
    assert.equal(virtualFormula(held, TALISMAN, options, 5), false, "above the crafter's level");
    assert.equal(virtualFormula(held, { ...TALISMAN, rarity: "uncommon" }, itemOptions({ ...TALISMAN, rarity: "uncommon" }), 8), false);
    assert.equal(virtualFormula(held, ELIXIR, itemOptions(ELIXIR), 8), false);
    const route = craftRoute({ known: false, rarity: "common", ...routeInputs(held, TALISMAN, options, 8) });
    assert.equal(route, "virtual", "replaces M1's virtual input");
});

test("the witch's Cauldron unlocks oils and potions (G4) without Magical Crafting", () => {
    assert.deepEqual(unlocks(["cauldron"]), ["oil", "potion"]);
    const witch = { feats: ["cauldron"], unlocks: unlocks(["cauldron"]), ranks: { crafting: RANK.trained }, level: 1 };
    assert.equal(gateFeats(witch, { traits: ["consumable", "healing", "magical", "potion"], level: 1 }).ok, true);
    assert.equal(gateFeats(witch, { traits: ["consumable", "magical", "oil"], level: 1 }).ok, true);
    assert.deepEqual(gateFeats(witch, { traits: ["magical", "scroll", "consumable"], level: 1 }).data, { feats: [FEAT.magicalCrafting], ranks: {} });
    assert.deepEqual(unlocks(["cauldron", "talisman-dabbler-dedication"]), ["oil", "potion", "talisman"]);
});

test("Talisman Esoterica is limited to GM Core; Improvise Tool and the Witch's Broom name UUIDs; Runic Crafter by rune level", () => {
    assert.equal(virtualFormula(["talisman-esoterica"], TALISMAN, itemOptions(TALISMAN), 8), true);
    assert.equal(virtualFormula(["talisman-esoterica"], { ...TALISMAN, book: "Pathfinder Player Core 2" }, itemOptions(TALISMAN), 8), false);
    const [toolUuid] = REGISTRY["improvise-tool"].effects[0].uuids;
    assert.equal(virtualFormula(["improvise-tool"], { uuid: toolUuid, level: 0 }, new Set(), 1), true);
    assert.equal(REGISTRY["improvise-tool"].effects[0].uuids.length, 15);
    const striking = { uuid: "x", level: 4, rarity: "common" };
    const strikingOptions = itemOptions({ slug: "striking", level: 4, traits: ["magical"] });
    assert.equal(virtualFormula(["runic-crafter"], striking, strikingOptions, 4), true);
    assert.equal(virtualFormula(["runic-crafter"], striking, strikingOptions, 3), false);
    assert.equal(virtualFormula(["basic-crafters-book"], { uuid: "y", level: 0, rarity: "common", book: "Pathfinder Player Core" }, new Set(), 1), true);
    assert.equal(virtualFormula(["basic-crafters-book"], { uuid: "y", level: 1, rarity: "common", book: "Pathfinder Player Core" }, new Set(), 1), false);
});

test("access grants (G5): kobold snares for Snare Setter; nothing for a crafter without one", () => {
    const snare = itemOptions({ traits: ["snare", "kobold"], rarity: "uncommon" });
    assert.equal(accessGrant(["snare-setter"], snare), true);
    assert.equal(accessGrant(["snare-setter"], itemOptions({ traits: ["snare"], rarity: "uncommon" })), false);
    assert.equal(accessGrant([], snare), false);
    assert.equal(accessGrant(["snare-setter"], itemOptions({ traits: ["snare", "kobold"], rarity: "rare" })), false, "uncommon only");
    assert.equal(accessGrant(["legions-aim"], itemOptions({ traits: ["alchemical", "bomb", "consumable"], rarity: "uncommon" })), true);
    assert.equal(accessGrant(["legions-aim"], itemOptions({ traits: ["alchemical", "bomb", "consumable"], rarity: "rare" })), false);
    assert.equal(craftRoute({ rarity: "uncommon", accessGrant: accessGrant(["snare-setter"], snare) }), "none");
});

test("skills (G1) and tools (G7): substitutes by predicate; tools that require another tool", () => {
    const healing = itemOptions(ELIXIR);
    assert.deepEqual(craftSkills(["herbalist-dedication"], healing), ["crafting", "nature"]);
    assert.deepEqual(craftSkills(["monster-crafting"], craftOptions({ item: healing, material: "monster" })), ["crafting", "survival"]);
    assert.deepEqual(craftSkills(["monster-crafting"], healing), ["crafting"]);
    assert.deepEqual(craftSkills(["graft-technician"], craftOptions({ item: [], craftType: "graft" })), ["crafting", "medicine"]);
    assert.deepEqual(tools(["alchemists-lab-expanded"], healing), ["alchemists-lab"]);
    assert.deepEqual(tools(["herbalist-dedication"], healing), [], "needs a healer's toolkit too");
    assert.deepEqual(tools(["herbalist-dedication", "healers-toolkit"], healing), ["alchemists-lab", "healers-toolkit"]);
    const food = itemOptions({ traits: ["alchemical", "consumable"], otherTags: ["alchemical-food"] });
    assert.deepEqual(tools(["wandering-chef-dedication", "cookware"], food), ["alchemists-lab", "cookware"]);
    assert.equal(gateTools(ELIXIR, { available: tools(["scrounger-dedication"], healing) }).ok, true);
    assert.equal(gateTools(ELIXIR, { available: tools([], healing) }).ok, false);
});

test("tools (G7): the gear that functions as a lab or toolkit counts as that tool", () => {
    const healing = itemOptions(ELIXIR);
    // A herbalist whose only healer's toolkit is an expanded one (or a cytillesh one) still crafts herbal items.
    for (const kit of ["healers-toolkit-expanded", "cytillesh-toolkit"]) {
        assert.deepEqual(tools(["herbalist-dedication", kit], healing), ["alchemists-lab", "healers-toolkit"], kit);
        assert.equal(gateTools(ELIXIR, { available: tools(["herbalist-dedication", kit], healing) }).ok, true, kit);
    }
    const sword = itemOptions({ type: "weapon", traits: [] });
    for (const kit of ["toolkit-of-bronze-whispers", "flawless-celestial-shawl"]) {
        assert.deepEqual(tools([kit], sword), ["artisans-toolkit"], kit);
        assert.equal(gateTools({ traits: [] }, { available: tools([kit], sword) }).ok, true, kit);
    }
    assert.deepEqual(tools(["philosophers-extractor"], healing), ["alchemists-lab"]);
});

test("batch, setup and rate: Efficient Alchemy, Reverse Engineering, the inexplicable apparatus, Monster Crafting", () => {
    assert.equal(batchMultiplier(["efficient-alchemy-alchemist"], itemOptions(ELIXIR)), 2);
    assert.equal(batchMultiplier(["efficient-alchemy-alchemist"], itemOptions(TALISMAN)), 1);
    assert.equal(setupOverride(["reverse-engineering"], craftOptions({ item: [], route: "reverse-engineer" })), 1);
    assert.equal(setupOverride(["reverse-engineering"], craftOptions({ item: [], route: "known" })), null);
    assert.equal(setupOverride(["inexplicable-apparatus"], craftOptions({ item: [] })), 1);
    assert.equal(setupOverride(["inexplicable-apparatus"], craftOptions({ item: [], craftType: "grow" })), null, "a Craft's minimum, not Grow's");
    const plain = craftOptions({ item: [] });
    assert.equal(rateLevel(["inexplicable-apparatus"], plain, { level: 18 }), 19);
    const monster = craftOptions({ item: [], material: "monster" });
    assert.equal(rateLevel(["monster-crafting"], monster, { level: 7, monsterLevel: 10 }), 10);
    assert.equal(rateLevel(["monster-crafting"], monster, { level: 7 }), 7, "no monster level on the order");
    assert.equal(rateLevel([], plain, { level: 5 }), 5);
    // crafterRate takes it as a value: the apparatus's +1, and a critical success's own +1 on top (level + 2).
    const check = { degree: 3, level: 18, rank: RANK.legendary };
    assert.equal(crafterRate(check, { level: 18, rank: RANK.legendary }, rateLevel(["inexplicable-apparatus"], plain, { level: 18 })),
        crafterRate(check, { level: 19, rank: RANK.legendary }));
    assert.equal(consumableFix(uuidOf("runescribed-disk")), true);
    assert.equal(consumableFix(uuidOf("seasoned")), false);
    assert.equal(consumableFix("Compendium.pf2e.equipment-srd.Item.nothingnothingno"), false);
});

test("Quick Setup counts only while Complex Crafting is on (variantOnly)", () => {
    assert.equal(holds(["quick-setup"], "quick-setup"), false);
    assert.equal(holds(["quick-setup"], "quick-setup", rulesWith({ variants: { complexCrafting: true } })), true);
    assert.equal(heldEffects(["quick-setup"], "variantOnly").length, 0);
});

/* -------------------------------------------- */
/*  The roll                                     */
/* -------------------------------------------- */

test("roll options: Specialty Crafting's bare trade when the Craft is in it; Impeccable's misspelled option; the lab's bare trait", () => {
    const held = ["specialty-crafting:alchemy", "impeccable-crafting", "alchemists-lab-expanded", "seasoned"];
    const alchemy = craftOptions({ item: itemOptions(ELIXIR), held });
    assert.deepEqual(rollOptions(held, alchemy), ["alchemical", "alchemy", "speciality"]);
    const weapon = craftOptions({ item: itemOptions({ type: "weapon", traits: [] }), held });
    assert.deepEqual(rollOptions(held, weapon), []);
    const food = craftOptions({ item: itemOptions({ traits: ["alchemical"], otherTags: ["alchemical-food"] }), held: ["seasoned"] });
    assert.deepEqual(rollOptions(["seasoned"], food), ["item:tag:food"]);
    assert.deepEqual(rollOptions(["carver-cutter"], craftOptions({ item: [], specialty: "woodworking" })), ["action:craft:woodworking"]);
});

test("modifiers where no rule element exists: Tattoo Artist +1, +2 at master Crafting", () => {
    const options = craftOptions({ item: itemOptions(TATTOO), held: ["tattoo-artist"] });
    const [expert] = modifiers(["tattoo-artist"], options, { crafting: RANK.expert });
    assert.deepEqual({ ...expert }, { key: "tattoo-artist", uuid: uuidOf("tattoo-artist"), slug: "tattoo-artist", type: "circumstance", value: 1 });
    assert.equal(modifiers(["tattoo-artist"], options, { crafting: RANK.master })[0].value, 2);
    assert.deepEqual(modifiers(["tattoo-artist"], craftOptions({ item: itemOptions(ELIXIR) })), []);
});

test("Impeccable Crafting turns a success into a critical success only when the roll carried its option", () => {
    assert.equal(shiftDegree(["impeccable-crafting"], new Set(["speciality"]), 2), 3);
    assert.equal(shiftDegree(["impeccable-crafting"], new Set(["speciality"]), 1), 1);
    assert.equal(shiftDegree(["impeccable-crafting"], new Set(), 2), 2);
    assert.equal(shiftDegree([], new Set(["speciality"]), 2), 2);
});

test("Earn Income: Experienced Professional's failure pay comes from the registry", () => {
    const flags = earnIncomeFlags(["experienced-professional"]);
    assert.deepEqual(flags, { experiencedProfessional: true });
    assert.deepEqual(earnIncomeFlags(["tradecraft-tattoo"]), { experiencedProfessional: false }, "the tattoo's rule element does its own work");
    const fail = { taskLevel: 3, rank: RANK.expert, degree: 1, skill: "cooking-lore" };
    assert.equal(wagePerDay({ ...fail, ...flags }), 2 * wagePerDay(fail));
});

/* -------------------------------------------- */
/*  Formula picks owed                           */
/* -------------------------------------------- */

test("formula picks: a feat gained, a level-up, a rank-up", () => {
    const gained = formulaPicks(["alchemical-crafting"], { level: 1, gained: ["alchemical-crafting"] });
    assert.deepEqual(gained.map(({ key, count, maxLevel, rarity }) => ({ key, count, maxLevel, rarity })),
        [{ key: "alchemical-crafting", count: 4, maxLevel: 1, rarity: ["common"] }]);
    const levelUp = formulaPicks(["formula-book", "alchemical-scholar"], { level: 3, fromLevel: 1 });
    assert.deepEqual(levelUp.map(({ key, count, maxLevel, minLevel }) => [key, count, maxLevel, minLevel]), [
        ["formula-book", 2, 2, null], ["formula-book", 2, 3, null], ["alchemical-scholar", 1, 2, 2], ["alchemical-scholar", 1, 3, 3],
    ]);
    const cauldron = formulaPicks(["cauldron"], { level: 6, fromLevel: 3 });
    assert.deepEqual(cauldron.map((p) => p.maxLevel), [4, 6], "every 2 levels from 4th");
    const atMaster = formulaPicks(["tattoo-artist"], { level: 9, gained: ["tattoo-artist"], ranks: { crafting: RANK.master } });
    assert.deepEqual(atMaster.map((p) => p.maxLevel), [2, 7], "gained as a master: both allowances");
    const rankUp = formulaPicks(["tattoo-artist", "snarecrafter-dedication"], { level: 7, ranks: { crafting: RANK.master }, rankUps: { crafting: RANK.expert } });
    assert.deepEqual(rankUp.map((p) => [p.key, p.count, p.maxLevel]), [["tattoo-artist", 4, 7], ["snarecrafter-dedication", 3, 7]]);
    const grant = formulaPicks(["munitions-crafter"], { level: 1, gained: ["munitions-crafter"] });
    assert.equal(grant[0].uuids.length, 1, "black powder by UUID");
});

test("the investigator's elixir-or-tool picks accept alchemical tools, which pf2e marks with the alchemical-tool tag", () => {
    // A glow rod as pf2e 8.6.1 has it: category "other", the tool marked only in `otherTags`.
    const glowRod = itemOptions({ type: "consumable", slug: "glow-rod", traits: ["alchemical", "consumable", "light"], category: "other",
        otherTags: ["alchemical-tool"], level: 1 });
    const bomb = itemOptions({ type: "consumable", traits: ["alchemical", "bomb", "consumable"], category: "bomb", level: 1 });
    for (const [key, held] of [["alchemical-sciences-methodology", 2], ["alchemical-discoveries", 1]]) {
        const picks = formulaPicks([key], { level: 2, gained: [key], fromLevel: 1 });
        assert.equal(picks.length, held, key);
        for (const pick of picks) {
            assert.equal(testPredicate(pick.filter, glowRod), true, `${key}: a tool`);
            assert.equal(testPredicate(pick.filter, itemOptions(ELIXIR)), true, `${key}: an elixir`);
            assert.equal(testPredicate(pick.filter, bomb), false, `${key}: neither`);
        }
    }
});
