/** Precious materials (DESIGN.md 6.6) and Communal Crafting helpers and Aid (DESIGN.md 6.7). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { aidModifier, helperDC, helperEligibility, helperForfeits, helperPresent, helperRate, relevantSkills } from "../../scripts/logic/communal.mjs";
import { DEGREE, FEAT, RANK } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { materialShareCp, preciousCheck } from "../../scripts/logic/materials.mjs";

const { critFail, fail, success, critSuccess } = DEGREE;
const { untrained, trained, expert, master, legendary } = RANK;

const silver = (grade = "low", level = 2) => ({ type: "silver", grade, level, rarity: "common" });
const reasons = (result) => result.problems.map((p) => p.reason);

test("GM Core p.253 example: of 10 gp up front for a 20 gp low-grade silver object, at least 1 gp is silver", () => {
    assert.equal(materialShareCp(1000, "low"), 100);
    assert.equal(materialShareCp(1000, "standard"), 250);
    assert.equal(materialShareCp(1000, "high"), 1000);
    assert.equal(materialShareCp(1005, "low"), 101);              // rounded up
});

test("no precious material, no conditions", () => {
    assert.deepEqual(preciousCheck({ crafter: { level: 1, rank: trained }, item: { level: 1 }, upfrontCp: 100 }), { ok: true, problems: [], requiredCp: 0 });
});

test("an expert crafter for any grade, master for standard, legendary for high", () => {
    const check = (rank, grade) => preciousCheck({ crafter: { level: 20, rank }, item: { level: 1 }, materials: [silver(grade)], upfrontCp: 1000, stockCp: 1000 });
    assert.deepEqual(reasons(check(trained, "low")), ["expert-needed", "grade-rank"]);
    assert.equal(check(expert, "low").ok, true);
    assert.deepEqual(check(expert, "standard").problems, [{ reason: "grade-rank", data: { grade: "standard", rank: master } }]);
    assert.equal(check(master, "standard").ok, true);
    assert.deepEqual(reasons(check(master, "high")), ["grade-rank"]);
    assert.equal(check(legendary, "high").ok, true);
});

test("the crafter's level reaches the material's, and magic items respect the grade's level cap", () => {
    const base = { crafter: { level: 9, rank: master }, upfrontCp: 1000, stockCp: 1000 };
    assert.deepEqual(reasons(preciousCheck({ ...base, item: { level: 9 }, materials: [silver("standard", 10)] })), ["material-level"]);
    assert.deepEqual(preciousCheck({ ...base, item: { level: 9, magical: true }, materials: [silver("low")] }).problems,
        [{ reason: "grade-item-level", data: { grade: "low", max: 8 } }]);
    assert.equal(preciousCheck({ ...base, item: { level: 9 }, materials: [silver("low")] }).ok, true);   // a mundane item has no cap
    assert.equal(preciousCheck({ ...base, item: { level: 8, magical: true }, materials: [silver("low")] }).ok, true);
    const high = { crafter: { level: 20, rank: legendary }, upfrontCp: 1000, stockCp: 1000, item: { level: 20, magical: true } };
    assert.equal(preciousCheck({ ...high, materials: [silver("high", 17)] }).ok, true);
});

test("one material per item, valid for the item", () => {
    const base = { crafter: { level: 10, rank: master }, item: { level: 5 }, upfrontCp: 1000, stockCp: 1000 };
    assert.deepEqual(reasons(preciousCheck({ ...base, materials: [silver(), { ...silver(), type: "cold-iron" }] })), ["one-material"]);
    assert.deepEqual(reasons(preciousCheck({ ...base, materials: [{ ...silver(), validForItem: false }] })), ["invalid-for-item"]);
    assert.throws(() => preciousCheck({ ...base, materials: [{ ...silver(), grade: "mythic" }] }), RangeError);
});

test("coin stands in for a common material by setting; rarer materials need stock", () => {
    const base = { crafter: { level: 10, rank: master }, item: { level: 5 }, upfrontCp: 1000 };
    assert.equal(preciousCheck({ ...base, materials: [silver()], coinCp: 1000 }).ok, true);
    const noCoin = rulesWith({ preciousCoinForCommon: false });
    assert.deepEqual(preciousCheck({ ...base, materials: [silver()], coinCp: 1000 }, noCoin).problems,
        [{ reason: "material-share", data: { requiredCp: 100, availableCp: 0, stockOnly: true } }]);
    const adamantine = { type: "adamantine", grade: "standard", level: 8, rarity: "uncommon" };
    assert.deepEqual(reasons(preciousCheck({ ...base, materials: [adamantine], coinCp: 1000, stockCp: 200 })), ["material-share"]);
    assert.equal(preciousCheck({ ...base, materials: [adamantine], stockCp: 250 }).ok, true);
});

/* -------------------------------------------- */
/*  Communal Crafting                            */
/* -------------------------------------------- */

const helper = (fields = {}) => ({ isPC: true, feats: [], ranks: { crafting: trained, religion: expert }, ...fields });
const eligible = (fields = {}, rules) => helperEligibility({
    helper: helper(), skill: "crafting", crafterHasFeat: true, relevant: ["crafting"], ...fields,
}, rules);

test("who may help: the crafter's feat, or the helper's when accepted, or the Cooperation setting", () => {
    assert.deepEqual(eligible(), { ok: true, reasons: [] });
    assert.deepEqual(eligible({ crafterHasFeat: false }).reasons, ["no-feat"]);
    assert.equal(eligible({ crafterHasFeat: false, helper: helper({ feats: [FEAT.communalCrafting] }) }).ok, false);
    assert.equal(eligible({ crafterHasFeat: false, helper: helper({ feats: [FEAT.communalCrafting] }), accepted: true }).ok, true);
    assert.equal(eligible({ crafterHasFeat: false }, rulesWith({ communal: { countHelpersWithoutFeat: true } })).ok, true);
});

test("helpers are PCs, trained in a relevant skill, free, and within the cap", () => {
    assert.deepEqual(eligible({ helper: helper({ isPC: false }) }).reasons, ["not-pc"]);
    assert.deepEqual(eligible({ helper: helper({ ranks: { crafting: untrained } }) }).reasons, ["untrained"]);
    assert.deepEqual(eligible({ skill: "religion" }).reasons, ["irrelevant-skill"]);
    assert.equal(eligible({ skill: "religion", relevant: relevantSkills({ traits: ["divine", "magical"] }) }).ok, true);
    assert.deepEqual(eligible({ lockedElsewhere: true }).reasons, ["locked"]);
    const capped = rulesWith({ communal: { helperCap: 2 } });
    assert.equal(eligible({ otherHelpers: 1 }, capped).ok, true);
    assert.deepEqual(eligible({ otherHelpers: 2 }, capped).reasons, ["cap"]);
    assert.equal(eligible({ otherHelpers: 9 }).ok, true);          // no cap by default
});

test("relevant skills: Crafting, the trait mapping, Warfare Lore for weapons, and the crafter's marks", () => {
    assert.deepEqual([...relevantSkills({ traits: ["alchemical"] })], ["crafting"]);
    assert.deepEqual([...relevantSkills({ traits: ["arcane", "primal"] })].sort(), ["arcana", "crafting", "nature"]);
    assert.deepEqual([...relevantSkills({ traits: ["occult"], type: "weapon" }, ["performance"])].sort(), ["crafting", "occultism", "performance", "warfare-lore"]);
});

test("helper rate: Income Earned at (helper level - 1) and their rank, by their degree", () => {
    // DESIGN 6.7 example: a 10th-level expert helper who succeeds adds the level-9 expert amount.
    assert.equal(helperRate({ level: 10, rank: expert, degree: success }), 400);
    assert.equal(helperRate({ level: 10, rank: expert, degree: critSuccess }), 500);   // level 10 expert
    assert.equal(helperRate({ level: 10, rank: expert, degree: fail }), 60);           // level 9 failure column
    assert.equal(helperRate({ level: 10, rank: expert, degree: critFail }), 0);
    assert.equal(helperRate({ level: 10, rank: expert, degree: null }), 0);            // not rolled yet
    assert.equal(helperRate({ level: 1, rank: trained, degree: success }), 5);         // row 0
    assert.equal(helperRate({ level: 21, rank: legendary, degree: critSuccess }), 30000);
    assert.equal(helperRate({ level: 5, rank: untrained, degree: success }), 0);
});

test("helper rate settings: a critical success as a success, a failure as nothing", () => {
    const strict = rulesWith({ communal: { helperCritUsesNextRow: false, helperFailUsesFailColumn: false } });
    assert.equal(helperRate({ level: 10, rank: expert, degree: critSuccess }, strict), 400);
    assert.equal(helperRate({ level: 10, rank: expert, degree: fail }, strict), 0);
});

test("presence, forfeiting and the helper DC", () => {
    const h = { joinedDay: 3, leftDay: 6 };
    assert.deepEqual([2, 3, 5, 6].map((day) => helperPresent(h, day)), [false, true, true, false]);
    assert.equal(helperPresent({ joinedDay: 0 }, 99), true);
    assert.equal(helperForfeits(h), true);
    assert.equal(helperForfeits({ joinedDay: 0 }), false);
    assert.equal(helperForfeits(h, rulesWith({ communal: { helperLeaveRetroactive: false } })), false);
    assert.equal(helperDC({ dc: { final: 27 } }), 27);
});

test("Aid: +1 on a success, +2/+3/+4 on a critical success by rank, -1 on a critical failure", () => {
    assert.equal(aidModifier(success, trained), 1);
    assert.deepEqual([untrained, trained, expert, master, legendary].map((rank) => aidModifier(critSuccess, rank)), [2, 2, 2, 3, 4]);
    assert.equal(aidModifier(fail, legendary), 0);
    assert.equal(aidModifier(critFail, legendary), -1);
});
