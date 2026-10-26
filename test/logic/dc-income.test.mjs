/** Level-based DCs, the Craft DC breakdown and one day of income (DESIGN.md 6.2.1). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE, RANK } from "../../scripts/logic/core.mjs";
import { craftDC, levelDC, rarityAdjustment } from "../../scripts/logic/dc.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { incomePerDay } from "../../scripts/logic/income.mjs";

const { critFail, fail, success, critSuccess } = DEGREE;
const { untrained, trained, expert, master, legendary } = RANK;

test("levelDC reads the table from -1 to 25 and clamps outside it", () => {
    assert.equal(levelDC(-1), 13);
    assert.equal(levelDC(0), 14);
    assert.equal(levelDC(4), 19);
    assert.equal(levelDC(9), 26);
    assert.equal(levelDC(20), 40);
    assert.equal(levelDC(25), 50);
    assert.equal(levelDC(-5), 13);
    assert.equal(levelDC(30), 50);
    assert.throws(() => levelDC(2.5), TypeError);
});

test("Proficiency without Level takes the level off again, never for -1", () => {
    assert.equal(levelDC(4, { pwol: true }), 15);
    assert.equal(levelDC(20, { pwol: true }), 20);
    assert.equal(levelDC(0, { pwol: true }), 14);
    assert.equal(levelDC(-1, { pwol: true }), 13);
});

test("rarity adjustments", () => {
    assert.deepEqual(["common", "uncommon", "rare", "unique"].map((r) => rarityAdjustment(r)), [0, 2, 5, 10]);
    assert.equal(rarityAdjustment(), 0);
    assert.throws(() => rarityAdjustment("legendary"), RangeError);
});

test("craftDC returns the breakdown an order freezes", () => {
    // Player Core p.237 crafting example: a 4th-level common item, DC 19.
    assert.deepEqual(craftDC({ level: 4 }), { level: 4, rarity: 0, repeat: 0, adjust: 0, pwol: false, final: 19 });
    assert.deepEqual(craftDC({ level: 10, rarity: "rare", adjust: 1 }), { level: 10, rarity: 5, repeat: 0, adjust: 1, pwol: false, final: 33 });
    assert.equal(craftDC({ level: 10, rarity: "uncommon", pwol: true }).final, 27 - 10 + 2);
});

test("the easy DC for an item made before applies only with its setting", () => {
    assert.equal(craftDC({ level: 5, madeBefore: true }).final, 20);
    const easy = craftDC({ level: 5, madeBefore: true }, rulesWith({ easyDcForRepeat: true }));
    assert.equal(easy.repeat, -2);
    assert.equal(easy.final, 18);
    assert.equal(craftDC({ level: 5 }, rulesWith({ easyDcForRepeat: true })).final, 20);
});

test("each rushed Complex Crafting setup day adds 5 to the DC, in adjust", () => {
    const dc = craftDC({ level: 6, rush: 2, adjust: -1 });
    assert.equal(dc.adjust, 9);
    assert.equal(dc.final, 22 + 9);
});

test("incomePerDay by degree, at level and level + 1", () => {
    assert.equal(incomePerDay(5, expert, success), 100);
    assert.equal(incomePerDay(5, expert, critSuccess), 200);       // level 6 expert
    assert.equal(incomePerDay(5, expert, fail), 20);
    assert.equal(incomePerDay(5, expert, critFail), 0);
    assert.equal(incomePerDay(10, master, success), 600);
    assert.equal(incomePerDay(10, trained, success), 400);
    assert.equal(incomePerDay(16, legendary, success), 4000);
    assert.equal(incomePerDay(16, master, success), 3600);
});

test("level 0 and level 20, including the extra critical-success row", () => {
    assert.equal(incomePerDay(0, trained, success), 5);
    assert.equal(incomePerDay(0, trained, fail), 1);
    assert.equal(incomePerDay(0, trained, critSuccess), 20);
    assert.equal(incomePerDay(20, legendary, success), 20000);
    assert.equal(incomePerDay(20, trained, critSuccess), 5000);
    assert.equal(incomePerDay(20, expert, critSuccess), 9000);
    assert.equal(incomePerDay(20, master, critSuccess), 17500);
    assert.equal(incomePerDay(20, legendary, critSuccess), 30000);
    assert.equal(incomePerDay(20, legendary, fail), 800);
});

test("levels outside 0..20 clamp, and untrained earns nothing", () => {
    assert.equal(incomePerDay(25, legendary, critSuccess), 30000);
    assert.equal(incomePerDay(25, legendary, success), 20000);
    assert.equal(incomePerDay(-1, trained, success), 5);
    for (const degree of [critFail, fail, success, critSuccess]) assert.equal(incomePerDay(10, untrained, degree), 0);
    assert.throws(() => incomePerDay(1.5, trained, success), TypeError);
});
