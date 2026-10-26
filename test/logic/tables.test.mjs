/**
 * The numeric tables of DESIGN.md 6.1 against the books. Each table is transcribed here a second time in
 * the book's own units ("1 gp, 5 sp"), so a typo in the data module and one here would have to agree to
 * pass. With PF2E_SRC set, every row is also compared with the pf2e source and its compendium.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AID_CRIT_BY_RANK, AID_MODIFIER, AID_TYPICAL_DC } from "../../scripts/data/aid.mjs";
import { COIN_RATE } from "../../scripts/data/coins.mjs";
import { COMPLEX_SETUP_DAYS } from "../../scripts/data/complex-crafting.mjs";
import { DC_ADJUSTMENT, DC_BY_LEVEL, RARITY_DC_ADJUSTMENT } from "../../scripts/data/dc.mjs";
import { FORMULA_PRICE } from "../../scripts/data/formulas.mjs";
import { INCOME_EARNED } from "../../scripts/data/income.mjs";
import { PRECIOUS_GRADE } from "../../scripts/data/materials.mjs";
import { COST_OF_LIVING, SPELLCASTING_SERVICE } from "../../scripts/data/services.mjs";
import { SETTLEMENT_TASK_LEVELS } from "../../scripts/data/settlements.mjs";

/** "1 gp, 5 sp" or "2 gp 5 sp" or "-" to cp. */
function cp(text) {
    if (text === "-") return 0;
    let total = 0;
    for (const [, n, unit] of text.replace(/,(?=\d{3})/g, "").matchAll(/(\d+)\s*(pp|gp|sp|cp)/g)) total += Number(n) * COIN_RATE[unit];
    return total;
}

test("DCs by level, -1 to 25 (GM Core p.52)", () => {
    const book = {
        "-1": 13, 0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22, 7: 23, 8: 24, 9: 26, 10: 27, 11: 28, 12: 30,
        13: 31, 14: 32, 15: 34, 16: 35, 17: 36, 18: 38, 19: 39, 20: 40, 21: 42, 22: 44, 23: 46, 24: 48, 25: 50,
    };
    assert.equal(DC_BY_LEVEL.length, 27);
    for (const [level, dc] of Object.entries(book)) assert.equal(DC_BY_LEVEL[Number(level) + 1], dc, `level ${level}`);
});

test("DC and rarity adjustments (GM Core pp.52-53)", () => {
    assert.deepEqual({ ...DC_ADJUSTMENT }, {
        incrediblyEasy: -10, veryEasy: -5, easy: -2, normal: 0, hard: 2, veryHard: 5, incrediblyHard: 10,
    });
    assert.deepEqual({ ...RARITY_DC_ADJUSTMENT }, { common: 0, uncommon: 2, rare: 5, unique: 10 });
});

/** Player Core p.228, Table 4-2, as printed: task level, failure, trained, expert, master, legendary. */
const INCOME_BOOK = [
    ["0", "1 cp", "5 cp", "5 cp", "5 cp", "5 cp"],
    ["1", "2 cp", "2 sp", "2 sp", "2 sp", "2 sp"],
    ["2", "4 cp", "3 sp", "3 sp", "3 sp", "3 sp"],
    ["3", "8 cp", "5 sp", "5 sp", "5 sp", "5 sp"],
    ["4", "1 sp", "7 sp", "8 sp", "8 sp", "8 sp"],
    ["5", "2 sp", "9 sp", "1 gp", "1 gp", "1 gp"],
    ["6", "3 sp", "1 gp, 5 sp", "2 gp", "2 gp", "2 gp"],
    ["7", "4 sp", "2 gp", "2 gp, 5 sp", "2 gp, 5 sp", "2 gp, 5 sp"],
    ["8", "5 sp", "2 gp, 5 sp", "3 gp", "3 gp", "3 gp"],
    ["9", "6 sp", "3 gp", "4 gp", "4 gp", "4 gp"],
    ["10", "7 sp", "4 gp", "5 gp", "6 gp", "6 gp"],
    ["11", "8 sp", "5 gp", "6 gp", "8 gp", "8 gp"],
    ["12", "9 sp", "6 gp", "8 gp", "10 gp", "10 gp"],
    ["13", "1 gp", "7 gp", "10 gp", "15 gp", "15 gp"],
    ["14", "1 gp, 5 sp", "8 gp", "15 gp", "20 gp", "20 gp"],
    ["15", "2 gp", "10 gp", "20 gp", "28 gp", "28 gp"],
    ["16", "2 gp, 5 sp", "13 gp", "25 gp", "36 gp", "40 gp"],
    ["17", "3 gp", "15 gp", "30 gp", "45 gp", "55 gp"],
    ["18", "4 gp", "20 gp", "45 gp", "70 gp", "90 gp"],
    ["19", "6 gp", "30 gp", "60 gp", "100 gp", "130 gp"],
    ["20", "8 gp", "40 gp", "75 gp", "150 gp", "200 gp"],
    ["20 (critical success)", "-", "50 gp", "90 gp", "175 gp", "300 gp"],
];

test("Income Earned, every row (Player Core p.228, Table 4-2)", () => {
    assert.equal(INCOME_EARNED.length, 22);
    INCOME_BOOK.forEach(([label, ...cells], row) => {
        assert.deepEqual([...INCOME_EARNED[row]], cells.map(cp), `row ${label}`);
    });
});

test("formula Prices, levels 0 to 20 (Player Core p.294, Table 6-13)", () => {
    const book = ["5 sp", "1 gp", "2 gp", "3 gp", "5 gp", "8 gp", "13 gp", "18 gp", "25 gp", "35 gp", "50 gp", "70 gp",
        "100 gp", "150 gp", "225 gp", "325 gp", "500 gp", "750 gp", "1,200 gp", "2,000 gp", "3,500 gp"];
    assert.deepEqual([...FORMULA_PRICE], book.map(cp));
});

test("spellcasting services by rank (Player Core p.295)", () => {
    const book = ["3 gp", "7 gp", "18 gp", "40 gp", "80 gp", "160 gp", "360 gp", "720 gp", "1,800 gp"];
    assert.deepEqual([...SPELLCASTING_SERVICE], book.map(cp));
});

test("cost of living (Player Core p.295, Table 6-16)", () => {
    const book = {
        subsistence: ["4 sp", "2 gp", "24 gp"],
        comfortable: ["1 gp", "4 gp", "52 gp"],
        fine: ["30 gp", "130 gp", "1,600 gp"],
        extravagant: ["100 gp", "430 gp", "5,200 gp"],
    };
    for (const [standard, [week, month, year]] of Object.entries(book)) {
        assert.deepEqual({ ...COST_OF_LIVING[standard] }, { week: cp(week), month: cp(month), year: cp(year) }, standard);
    }
});

test("settlement task levels (GM Core p.53), precious grades (GM Core p.253), Aid (Player Core p.416)", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(SETTLEMENT_TASK_LEVELS)), {
        village: [0, 1], town: [2, 4], city: [5, 7], metropolis: [8, 10],
    });
    assert.deepEqual(JSON.parse(JSON.stringify(PRECIOUS_GRADE)), {
        low: { rank: 2, maxMagicLevel: 8, upfrontPct: 10 },
        standard: { rank: 3, maxMagicLevel: 15, upfrontPct: 25 },
        high: { rank: 4, maxMagicLevel: null, upfrontPct: 100 },
    });
    assert.equal(AID_TYPICAL_DC, 15);
    assert.deepEqual([...AID_MODIFIER], [-1, 0, 1, null]);
    assert.deepEqual([...AID_CRIT_BY_RANK], [2, 2, 2, 3, 4]);
});

test("Complex Crafting days of setup (Treasure Vault (Remastered) p.158, Table 5-1)", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(COMPLEX_SETUP_DAYS)), { consumable: [2, 1, 1], permanent: [4, 3, 2] });
});

test("coin rates (Player Core p.10)", () => {
    assert.deepEqual({ ...COIN_RATE }, { pp: 1000, gp: 100, sp: 10, cp: 1 });
});

test("every shipped table is frozen all the way down", () => {
    const tables = [DC_BY_LEVEL, DC_ADJUSTMENT, RARITY_DC_ADJUSTMENT, INCOME_EARNED, FORMULA_PRICE, SPELLCASTING_SERVICE,
        COST_OF_LIVING, SETTLEMENT_TASK_LEVELS, PRECIOUS_GRADE, AID_MODIFIER, AID_CRIT_BY_RANK, COMPLEX_SETUP_DAYS, COIN_RATE];
    const frozen = (value) => typeof value !== "object" || value === null ||
        (Object.isFrozen(value) && Object.values(value).every(frozen));
    for (const table of tables) assert.ok(frozen(table));
});

/* -------------------------------------------- */
/*  Against a pf2e source checkout (PF2E_SRC)    */
/* -------------------------------------------- */

const NEEDS_SOURCE = { skip: !process.env.PF2E_SRC && "set PF2E_SRC to a pf2e checkout" };
const source = (path) => readFileSync(join(process.env.PF2E_SRC, path), "utf8");

test("DC_BY_LEVEL matches pf2e dcByLevel", NEEDS_SOURCE, () => {
    const map = source("src/module/dc.ts").match(/const dcByLevel = new Map\(\[([\s\S]*?)\]\);/)[1];
    const pairs = [...map.matchAll(/\[(-?\d+),\s*(\d+)\]/g)].map(([, level, dc]) => [Number(level), Number(dc)]);
    assert.equal(pairs.length, 27);
    for (const [level, dc] of pairs) assert.equal(DC_BY_LEVEL[level + 1], dc, `level ${level}`);
});

test("INCOME_EARNED matches pf2e EarnIncomeDialog.REWARDS_BY_LEVEL", NEEDS_SOURCE, () => {
    const text = source("src/scripts/macros/earn-income.ts");
    const block = text.match(/static REWARDS_BY_LEVEL = \{([\s\S]*?)\n {4}\};/)[1];
    const coins = (literal) => cp(literal.replace(/(pp|gp|sp|cp):\s*(\d+)/g, "$2 $1"));
    const rows = [...block.matchAll(/(\d+): \{\s*failure: (\{[^}]*\}),\s*rewards: EarnIncomeDialog\.#buildRewards\(([^)]*)\)/g)];
    assert.equal(rows.length, 22);
    for (const [, row, failure, rewards] of rows) {
        // #buildRewards fills a missing rank from the one below it.
        const given = [...rewards.matchAll(/\{[^}]*\}/g)].map(([literal]) => coins(literal));
        const ranks = [1, 2, 3, 4].map((rank) => given[Math.min(rank, given.length) - 1]);
        assert.deepEqual([...INCOME_EARNED[Number(row)]], [coins(failure), ...ranks], `row ${row}`);
    }
});

test("INCOME_EARNED matches the Earn Income compendium table", NEEDS_SOURCE, () => {
    const json = JSON.parse(source("packs/pf2e/actions/skill/earn-income.json"));
    const text = json.system.description.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const amount = String.raw`(?:-|\d+ (?:gp|sp|cp)(?:, \d+ sp)?)`;
    const rows = [...text.matchAll(new RegExp(String.raw`(\d+(?: \(critical success\))?) (${amount}) (${amount}) (${amount}) (${amount}) (${amount})`, "g"))];
    const table = rows.slice(-22);
    assert.equal(table.length, 22);
    table.forEach(([, label, ...cells], row) => assert.deepEqual([...INCOME_EARNED[row]], cells.map(cp), `row ${label}`));
});
