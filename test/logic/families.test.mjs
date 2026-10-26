/** Formula families and coverage (DESIGN.md 6.4). Item names are the pf2e 8.6.1 compendium's. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { covers, familyKey, formulaCoverage, hiddenByAbp, upgradeCostCp } from "../../scripts/logic/families.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";

const elixir = (grade, level, rarity = "common") =>
    ({ uuid: `elixir-${grade}`, name: `Elixir of Life (${grade})`, type: "consumable", category: "elixir", level, rarity });

test("the family key drops the parenthesised grade", () => {
    const key = "consumable|elixir|elixir of life";
    for (const grade of ["Minor", "Lesser", "Moderate", "Greater", "Major", "True"]) assert.equal(familyKey(elixir(grade, 1)), key, grade);
    assert.equal(familyKey({ name: "Spacious Pouch (Type IV)", type: "backpack" }), "backpack||spacious pouch");
    assert.equal(familyKey({ name: "Spellstrike Ammunition (Type VIII)", type: "ammo" }), "ammo||spellstrike ammunition");
    assert.equal(familyKey({ name: "Weapon Potency (+2)", type: "equipment" }), familyKey({ name: "Weapon Potency (+1)", type: "equipment" }));
    assert.equal(familyKey({ name: "Reinforcing Rune (Supreme)", type: "equipment" }), "equipment||reinforcing rune");
    assert.equal(familyKey({ name: "Striking (Greater)", type: "equipment" }), familyKey({ name: "Striking", type: "equipment" }));
});

test("other parentheses, other types and other categories make other families; the registry can override", () => {
    assert.notEqual(familyKey({ name: "Aeon Stone (Clear Spindle)", type: "equipment" }), familyKey({ name: "Aeon Stone (Tourmaline Sphere)", type: "equipment" }));
    assert.notEqual(familyKey({ name: "Striking Snare", type: "consumable" }), familyKey({ name: "Striking", type: "equipment" }));
    assert.notEqual(familyKey({ name: "Healing Potion (Minor)", type: "consumable", category: "potion" }),
        familyKey({ name: "Healing Potion (Minor)", type: "consumable", category: "elixir" }));
    assert.equal(familyKey({ name: "Anything", type: "equipment", familyOverride: "doubling-rings" }), "doubling-rings");
});

test("a formula covers higher grades, and lower grades by default", () => {
    assert.equal(covers(elixir("Minor", 1), elixir("True", 19)), true);
    assert.equal(covers(elixir("Moderate", 9), elixir("Minor", 1)), true);
    assert.equal(covers(elixir("Moderate", 9), elixir("Minor", 1), rulesWith({ familyCoversLowerGrades: false })), false);
    assert.equal(covers(elixir("Moderate", 9), elixir("Major", 15), rulesWith({ familyCoversLowerGrades: false })), true);
});

test("a type of higher rarity, or one that needs its own formula, is not covered", () => {
    assert.equal(covers(elixir("Minor", 1), elixir("Greater", 13, "uncommon")), false);
    assert.equal(covers(elixir("Minor", 1, "rare"), elixir("Greater", 13, "uncommon")), true);
    assert.equal(covers(elixir("Minor", 1), { ...elixir("Greater", 13), ownFormulaPerType: true }), false);
    assert.equal(covers(elixir("Minor", 1), { name: "Healing Potion (Minor)", type: "consumable", category: "potion", level: 1 }), false);
});

test("formulaCoverage prefers the item's own formula, then the closest covering grade", () => {
    const known = [elixir("Minor", 1), elixir("Greater", 13), elixir("Moderate", 9)];
    assert.deepEqual(formulaCoverage(known, elixir("Moderate", 9)), { route: "known", formula: known[2] });
    assert.deepEqual(formulaCoverage(known, elixir("Major", 15)), { route: "family", formula: known[1] });
    assert.deepEqual(formulaCoverage([elixir("Minor", 1)], elixir("Lesser", 5)).route, "family");
    assert.equal(formulaCoverage([], elixir("Lesser", 5)), null);
});

test("an upgrade costs the full Price difference (GM Core p.223)", () => {
    // Spacious pouch type I (75 gp) straight to type III (1,200 gp), as GM Core p.223 allows.
    assert.equal(upgradeCostCp(7500, 120000), 112500);
    assert.equal(upgradeCostCp(120000, 7500), null);
    assert.equal(upgradeCostCp(100, 100), null);
});

test("Automatic Bonus Progression hides the runes it replaces and item-bonus gear, not reinforcing runes", () => {
    assert.equal(hiddenByAbp({ fundamentalRune: "striking" }, "ABPRulesAsWritten"), true);
    assert.equal(hiddenByAbp({ fundamentalRune: "weapon-potency" }, "ABPFundamentalPotency"), true);
    assert.equal(hiddenByAbp({ givesItemBonus: true }, "ABPRulesAsWritten"), true);
    assert.equal(hiddenByAbp({ fundamentalRune: "reinforcing" }, "ABPRulesAsWritten"), false);
    assert.equal(hiddenByAbp({ fundamentalRune: "striking" }, "noABP"), false);
});
