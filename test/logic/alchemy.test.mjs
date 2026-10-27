/**
 * Combat alchemy's pure parts (DESIGN.md 8.3-8.6, 8.8, M8): what Quick Alchemy can make, one use's cost and refusals
 * (Double Brew, additives, 0 vials), potency stamps and turn expiry over a scripted initiative order, splash numbers,
 * Healing Bomb's dice, the 10-minute cap, the best ready item, Advanced Vials' buckets, and the expiry reasons of turn
 * stamps.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY } from "../../scripts/data/registry.mjs";
import {
    ROUND_SECONDS, additiveSpent, additivesFor, additivesOf, bestOfFamily, brewPlan, cappedDuration, chooseBest, comparePosition, damageDiceCount,
    expirySortKey, mergeSplash, moveIndex, potencyRule, quickChoices, quickStamp, quickenedSpent, searchChoices, splashNumbers, takeFromBucket,
    turnDeadline, turnExpired, uncapped, vialSplash,
} from "../../scripts/logic/alchemy.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { expiryReason } from "../../scripts/logic/expiry.mjs";
import { heldEffects, itemOptions } from "../../scripts/logic/registry.mjs";

/** Catalogue facts as `scripts/foundry/catalogue.mjs` gives them. */
function facts({ uuid, name, level, type = "consumable", category = "elixir", traits = ["alchemical", "consumable", "elixir"], slug = null, otherTags = [], rarity = "common" }) {
    const f = { uuid, name, type, category, level, traits, rarity, slug: slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), otherTags };
    return { ...f, options: [...itemOptions(f)] };
}

const ELIXIRS = ["Minor", "Lesser", "Moderate", "Greater"].map((grade, i) => facts({ uuid: `E${i}`, name: `Elixir of Life (${grade})`, level: [1, 5, 9, 13][i],
    traits: ["alchemical", "consumable", "elixir", "healing"] }));
const FIRE = [1, 3, 11].map((level, i) => facts({ uuid: `F${i}`, name: `Alchemist's Fire (${["Lesser", "Moderate", "Greater"][i]})`, level, type: "weapon", category: "bomb",
    traits: ["alchemical", "bomb", "consumable", "fire", "splash"] }));
const POTION = facts({ uuid: "P0", name: "Healing Potion (Minor)", level: 1, category: "potion", traits: ["consumable", "healing", "magical", "potion"] });
const TOOL = facts({ uuid: "T0", name: "Smokestick (Lesser)", level: 1, category: "tool", traits: ["alchemical", "consumable"], otherTags: ["alchemical-tool"] });
const CATALOGUE = [...ELIXIRS, ...FIRE, POTION, TOOL];
/** pf2e's Quick Alchemy predicates: alchemical consumables. */
const accepts = (options) => options.has("item:trait:alchemical") && options.has("item:trait:consumable");

test("Quick Alchemy makes what the book or a family covers, up to the ability's level, alchemical consumables only (8.3, 6.4)", () => {
    const choices = quickChoices(CATALOGUE, { known: [ELIXIRS[0], FIRE[1]], maxLevel: 10, accepts });
    const names = choices.map((c) => [c.name, c.route]);
    assert.deepEqual(names, [
        ["Alchemist's Fire (Lesser)", "family"], ["Alchemist's Fire (Moderate)", "known"],
        ["Elixir of Life (Lesser)", "family"], ["Elixir of Life (Minor)", "known"], ["Elixir of Life (Moderate)", "family"],
    ], "level 13 and 11 grades are above the ability's level; the potion is not alchemical; no formula for the smokestick");
    assert.equal(choices.find((c) => c.name.startsWith("Alchemist's Fire (Lesser)")).bomb, true);
    const strict = quickChoices(CATALOGUE, { known: [ELIXIRS[1]], maxLevel: 20, accepts }, rulesWith({ familyCoversLowerGrades: false }));
    assert.deepEqual(strict.map((c) => c.name), ["Elixir of Life (Greater)", "Elixir of Life (Lesser)", "Elixir of Life (Moderate)"], "the setting restricts it to higher grades");
    assert.equal(bestOfFamily(choices, choices[2].family).name, "Elixir of Life (Moderate)");
    assert.equal(bestOfFamily(choices, "nothing"), null);
});

test("the panel's search matches every word, accents and case ignored; the arrows stay inside the list (8.3)", () => {
    const list = [{ name: "Élixir of Life (Minor)" }, { name: "Alchemist's Fire (Lesser)" }, { name: "Elixir of Life (Lesser)" }];
    assert.deepEqual(searchChoices(list, "elixir LESSER").map((c) => c.name), ["Elixir of Life (Lesser)"]);
    assert.deepEqual(searchChoices(list, "elixir").length, 2, "the accent does not hide a match");
    assert.equal(searchChoices(list, "  ").length, 3);
    assert.deepEqual([moveIndex(0, 1, 3), moveIndex(2, 1, 3), moveIndex(0, -1, 3), moveIndex(-1, 1, 3), moveIndex(1, 0, 3), moveIndex(0, 1, 0)], [1, 2, 0, 0, 1, -1]);
});

test("one use: a vial per item, Double Brew for two, the additive's own vials; refused at 0 vials, which pf2e's own path would craft for free (8.3, 8.6)", () => {
    const [elixir, , moderate] = quickChoices(CATALOGUE, { known: [ELIXIRS[0]], maxLevel: 10, accepts });
    const bomb = quickChoices(CATALOGUE, { known: [FIRE[0]], maxLevel: 10, accepts })[0];
    const additives = additivesOf(["combine-elixirs", "healing-bomb", "sticky-bomb"]);
    assert.deepEqual(brewPlan({ picks: [elixir], vials: 3 }), { ok: true, cost: 1, problems: [] });
    assert.deepEqual(brewPlan({ picks: [elixir], vials: 0 }).problems.map((p) => p.reason), ["no-vials"]);
    assert.deepEqual(brewPlan({ picks: [elixir, bomb], vials: 3 }).problems.map((p) => p.reason), ["double-brew"]);
    assert.equal(brewPlan({ picks: [elixir, bomb], vials: 3, brew: 2 }).cost, 2);
    assert.deepEqual(brewPlan({ picks: [elixir, bomb], vials: 1, brew: 2 }).problems, [{ reason: "vials", data: { n: 2, have: 1 } }]);
    assert.deepEqual(brewPlan({ picks: [], vials: 3 }).problems.map((p) => p.reason), ["nothing-picked"]);
    // Healing Bomb: on an elixir of life only, one vial; never with a second additive this round.
    assert.equal(brewPlan({ picks: [moderate], vials: 1, additive: "healing-bomb", additives }).ok, true);
    assert.deepEqual(brewPlan({ picks: [bomb], vials: 1, additive: "healing-bomb", additives }).problems.map((p) => p.reason), ["additive-fit"]);
    assert.deepEqual(brewPlan({ picks: [moderate], vials: 1, additive: "healing-bomb", additives, additiveSpent: true }).problems.map((p) => p.reason), ["additive-round"]);
    assert.deepEqual(brewPlan({ picks: [moderate], vials: 1, additive: "smoke-bomb", additives }).problems.map((p) => p.reason), ["additive-unknown"]);
    // Combine Elixirs: one more vial, a second elixir of the same level or lower.
    assert.deepEqual(brewPlan({ picks: [moderate], vials: 1, additive: "combine-elixirs", additives, combine: elixir }).problems, [{ reason: "vials", data: { n: 2, have: 1 } }]);
    assert.equal(brewPlan({ picks: [moderate], vials: 2, additive: "combine-elixirs", additives, combine: elixir }).ok, true);
    assert.deepEqual(brewPlan({ picks: [elixir], vials: 2, additive: "combine-elixirs", additives, combine: moderate }).problems.map((p) => p.reason), ["combine-fit"]);
    assert.deepEqual(brewPlan({ picks: [elixir], vials: 2, additive: "combine-elixirs", additives }).problems.map((p) => p.reason), ["combine-pick"]);
    assert.deepEqual(additivesFor(additives, bomb.options).map((a) => a.key), ["sticky-bomb"]);
    assert.deepEqual(additivesOf(["sticky-bomb"])[0].toggle, { domain: "alchemical-bomb-base-type-damage", option: "sticky-bomb" });
});

test("one additive a round per character, and Abundant Vials' extra quick vial once a turn (8.5, 8.6)", () => {
    const combat = { id: "c1", round: 2, turn: 1 };
    assert.equal(additiveSpent({ combat: "c1", round: 2 }, { combat }), true);
    assert.equal(additiveSpent({ combat: "c1", round: 1 }, { combat }), false, "last round's");
    assert.equal(additiveSpent({ combat: null, at: 100 }, { combat: null, worldTime: 103 }), true, "outside an encounter, a round of world time");
    assert.equal(additiveSpent({ combat: null, at: 100 }, { combat: null, worldTime: 106 }), false);
    assert.equal(additiveSpent(null, { combat }), false);
    assert.equal(quickenedSpent({ combat: "c1", round: 2, turn: 1 }, combat), true);
    assert.equal(quickenedSpent({ combat: "c1", round: 2, turn: 0 }, combat), false);
    assert.equal(quickenedSpent({ combat: "c1", round: 2, turn: 1 }, null), false);
});

test("potency: start of the next turn; the end of the next turn for Enduring Alchemy's tools and elixirs; a quick vial's turn (8.3, 8.5, 8.8)", () => {
    const enduring = heldEffects(["enduring-alchemy"], "expiryRule").map(({ effect }) => effect);
    assert.deepEqual(potencyRule(ELIXIRS[0].options), { rule: "turn-start" });
    assert.deepEqual(potencyRule(ELIXIRS[0].options, { enduring }), { rule: "turn-end", when: "next" });
    assert.deepEqual(potencyRule(TOOL.options, { enduring }), { rule: "turn-end", when: "next" }, "an alchemical tool");
    assert.deepEqual(potencyRule(FIRE[0].options, { enduring }), { rule: "turn-start" }, "a bomb is neither");
    assert.deepEqual(potencyRule([], { quickVial: true, enduring }), { rule: "turn-end", when: "current" });
    const inCombat = quickStamp({ creator: "Actor.a", cycle: 2, options: FIRE[0].options, combat: { id: "c1", combatant: "k1", round: 1, turn: 0 }, worldTime: 50 });
    assert.deepEqual(inCombat, { creator: "Actor.a", cycle: 2, rule: "turn-start", quick: "quick-alchemy", combat: { id: "c1", combatant: "k1", round: 1, turn: 0 } });
    const outside = quickStamp({ creator: "Actor.a", options: [], quickVial: true, worldTime: 50 });
    assert.deepEqual([outside.combat, outside.at, outside.quick], [null, 50 + ROUND_SECONDS, "quick-vial"]);
    assert.throws(() => quickStamp({ creator: "" }), TypeError);
});

/**
 * A scripted initiative order: the alchemist acts third (turn index 2) of four. Positions are `{round, turn}`; the
 * module reads only the encounter's state now, so skipping turns gives the same answers.
 */
test("turn expiry against a scripted initiative order (8.8)", () => {
    const at = (round, turn) => ({ round, turn });
    const made = (rule, when, turn) => ({ rule, when, combat: { id: "c", combatant: "alch", round: 1, turn } });
    // Made on the alchemist's own turn (round 1, turn 2).
    const start = made("turn-start", undefined, 2);
    assert.deepEqual(turnDeadline(start, 2), { round: 2, turn: 2, after: false });
    assert.equal(turnExpired(start, { position: at(1, 3), creatorTurn: 2 }), false);
    assert.equal(turnExpired(start, { position: at(2, 1), creatorTurn: 2 }), false);
    assert.equal(turnExpired(start, { position: at(2, 2), creatorTurn: 2 }), true, "the start of its next turn");
    assert.equal(turnExpired(start, { position: at(3, 0), creatorTurn: 2 }), true, "several turns skipped at once");
    const enduring = made("turn-end", "next", 2);
    assert.equal(turnExpired(enduring, { position: at(2, 2), creatorTurn: 2 }), false, "potent through its next turn");
    assert.equal(turnExpired(enduring, { position: at(2, 3), creatorTurn: 2 }), true, "ends with that turn");
    const vial = made("turn-end", "current", 2);
    assert.equal(turnExpired(vial, { position: at(1, 2), creatorTurn: 2 }), false);
    assert.equal(turnExpired(vial, { position: at(1, 3), creatorTurn: 2 }), true, "the end of the current turn");
    // Made before its turn (a quick vial on another's turn lasts until the end of its own coming turn; the next turn
    // starts this round).
    const early = made("turn-start", undefined, 0);
    assert.equal(turnExpired(early, { position: at(1, 2), creatorTurn: 2 }), true);
    assert.equal(turnExpired(made("turn-end", "current", 0), { position: at(1, 2), creatorTurn: 2 }), false);
    assert.equal(turnExpired(made("turn-end", "current", 0), { position: at(1, 3), creatorTurn: 2 }), true);
    // Made after its turn: the next is next round's.
    assert.equal(turnExpired(made("turn-start", undefined, 3), { position: at(2, 1), creatorTurn: 2 }), false);
    assert.equal(turnExpired(made("turn-start", undefined, 3), { position: at(2, 2), creatorTurn: 2 }), true);
    // The alchemist left the encounter: it ends.
    assert.equal(turnExpired(start, { position: at(1, 3), creatorTurn: null }), true);
    assert.equal(comparePosition(at(2, 0), at(1, 3)) > 0, true);
});

test("expiry reasons of turn stamps: by turn, by the encounter's end (setting), by world time outside one (8.8, 7.7)", () => {
    const stamp = { creator: "Actor.a", cycle: 0, rule: "turn-start", quick: "quick-alchemy", combat: { id: "c", combatant: "k", round: 1, turn: 0 } };
    const now = (state, extra = {}) => ({ turn: () => state, ...extra });
    assert.equal(expiryReason(stamp, now({ position: { round: 1, turn: 1 }, creatorTurn: 0 })), null);
    assert.equal(expiryReason(stamp, now({ position: { round: 2, turn: 0 }, creatorTurn: 0 })), "turn");
    assert.equal(expiryReason(stamp, now({ gone: true })), "combat-end");
    assert.equal(expiryReason(stamp, now({ gone: true }, { combatEnd: false })), null, "with the setting off the Foundry side gives it a round of world time");
    assert.equal(expiryReason(stamp, now(null)), null, "an encounter that cannot be read is left alone");
    assert.equal(expiryReason(stamp, now({ position: { round: 5, turn: 0 }, creatorTurn: 0 }, { inert: true })), null);
    const outside = { ...stamp, combat: null, at: 106 };
    assert.equal(expiryReason(outside, { worldTime: 105 }), null);
    assert.equal(expiryReason(outside, { worldTime: 106 }), "time");
    assert.equal(expiryReason({ ...stamp, combat: null }, { worldTime: 10_000 }), null, "no deadline, nothing to read");
    // A prep stamp keeps its M7 rules: a cycle past it.
    assert.equal(expiryReason({ creator: "Actor.a", cycle: 0, rule: "prep" }, { creatorCycle: 1, turn: () => ({ gone: true }) }), "cycle");
});

test("splash numbers: the bomber's field discovery, Expanded Splash's bonus and radius, the greater discovery, Directional Bombs (8.8)", () => {
    const of = (keys) => mergeSplash(heldEffects(keys, "splash").map(({ effect }) => effect));
    assert.deepEqual(splashNumbers({ base: 1, int: 4 }), { damage: 1, bonus: 0, total: 1, radius: 5, cone: null, primaryOnly: false });
    assert.deepEqual(splashNumbers({ base: 1, int: 4, splash: of(["bomber", "field-discovery-bomber"]) }), { damage: 4, bonus: 0, total: 4, radius: 5, cone: null, primaryOnly: true });
    assert.deepEqual(splashNumbers({ base: 1, int: 4, splash: of(["bomber", "field-discovery-bomber", "expanded-splash"]) }).total, 8, "twice Int with both");
    assert.equal(splashNumbers({ base: 2, int: 0, splash: of(["field-discovery-bomber"]) }).damage, 1, "minimum 1");
    assert.equal(splashNumbers({ base: 1, int: 4, splash: of(["expanded-splash"]) }).radius, 10);
    assert.equal(splashNumbers({ base: 1, int: 4, splash: of(["greater-field-discovery-bomber"]) }).radius, 10);
    assert.equal(splashNumbers({ base: 1, int: 4, splash: of(["greater-field-discovery-bomber", "expanded-splash"]) }).radius, 15);
    assert.equal(splashNumbers({ base: 1, int: 4, splash: of(["directional-bombs"]) }).cone, 15);
    assert.equal(splashNumbers({ base: 1, int: 4, splash: of(["directional-bombs", "expanded-splash"]) }).cone, 20);
    assert.deepEqual([1, 4, 11, 12, 18].map(vialSplash), [1, 2, 2, 3, 4]);
});

test("Healing Bomb: each adjacent creature regains the elixir's number of damage dice, read from its formula (8.6)", () => {
    assert.deepEqual(["1d6", "3d6+6", "(5d6+12)", "10d6+27", "2d8+1d6", "d6", "12"].map(damageDiceCount), [1, 3, 5, 10, 3, 1, 0]);
    assert.ok(REGISTRY["healing-bomb"].effects[0].when.any.includes("item:slug:elixir-of-life-moderate"));
});

test("the 10-minute cap: longer effects, unlimited ones too, but not an encounter-long one; Eternal Elixir's own elixir at half level (8.8)", () => {
    assert.deepEqual(cappedDuration({ value: 1, unit: "hours", expiry: "turn-start" }), { value: 10, unit: "minutes", expiry: "turn-start" });
    assert.deepEqual(cappedDuration({ value: -1, unit: "unlimited", expiry: null }), { value: 10, unit: "minutes", expiry: "turn-start" });
    assert.equal(cappedDuration({ value: 10, unit: "minutes" }), null);
    assert.equal(cappedDuration({ value: 100, unit: "rounds" }), null, "600 seconds is the cap itself");
    assert.equal(cappedDuration({ value: 0, unit: "encounter" }), null);
    assert.equal(cappedDuration({ value: 1, unit: "hours" }, { uncapped: true }), null);
    const eternal = heldEffects(["eternal-elixir", "persistent-mutagen"], "expiryRule").map(({ effect }) => effect);
    const elixir = new Set(["item:trait:elixir"]);
    assert.equal(uncapped(eternal, { options: elixir, level: 8, creatorLevel: 16, own: true }), true);
    assert.equal(uncapped(eternal, { options: elixir, level: 9, creatorLevel: 16, own: true }), false, "above half the creator's level");
    assert.equal(uncapped(eternal, { options: elixir, level: 1, creatorLevel: 16, own: false }), false, "an ally drinking it");
    assert.equal(uncapped(eternal, { options: new Set(["item:trait:mutagen"]), level: 15, creatorLevel: 16, own: true }), true, "Persistent Mutagen");
});

test("the best ready item: held, then worn, then stowed; the soonest-expiring infused among equals; inert never; ties named (8.4, 8.9)", () => {
    const turn = { rule: "turn-start", combat: { id: "c" } };
    const soon = { rule: "prep", at: 200 };
    const late = { rule: "prep", at: 900 };
    const cands = [
        { id: "stowed", carry: "stowed", infused: true, stamp: turn },
        { id: "worn-late", carry: "worn", infused: true, stamp: late },
        { id: "worn-soon", carry: "worn", infused: true, stamp: soon },
        { id: "held-inert", carry: "held", inert: true },
    ];
    assert.equal(chooseBest(cands, 100).best.id, "worn-soon");
    assert.deepEqual(chooseBest(cands, 100).ties.map((c) => c.id), ["worn-soon"]);
    const equal = [{ id: "a", carry: "stowed" }, { id: "b", carry: "stowed" }];
    assert.deepEqual(chooseBest(equal).ties.map((c) => c.id), ["a", "b"], "two equally good: the picker asks");
    assert.deepEqual(chooseBest([{ id: "x", carry: "held", inert: true }]), { best: null, ties: [] });
    assert.ok(expirySortKey(turn) < expirySortKey(soon, 100) && expirySortKey(soon, 100) < expirySortKey({ rule: "prep" }) && expirySortKey({ rule: "prep" }) < expirySortKey(null));
});

test("Advanced Vials: a throw takes one from the chosen bucket, else plain (7.3, OQ-22)", () => {
    assert.deepEqual(takeFromBucket({ plain: 2, "cold-iron": 1 }, "cold-iron"), { buckets: { plain: 2 }, material: "cold-iron" });
    assert.deepEqual(takeFromBucket({ plain: 2, "cold-iron": 1 }, "dawnsilver"), { buckets: { plain: 1, "cold-iron": 1 }, material: null });
    assert.deepEqual(takeFromBucket({ "cold-iron": 1 }, null), null, "no plain vial and no choice");
    assert.equal(takeFromBucket({}, "cold-iron"), null);
});
