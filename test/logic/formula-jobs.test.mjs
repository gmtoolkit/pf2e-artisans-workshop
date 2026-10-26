/** Formula routes and acquisition jobs (DESIGN.md 4.3, 6.8). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEAT } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import {
    PROVENANCE, acquisitionRoutes, buyPriceCp, craftCopyRoute, craftRoute, formulaJobPlan,
    formulaPrice, formulaRoutes,
} from "../../scripts/logic/formula-jobs.mjs";

const { inventor: INVENTOR, reverseEngineering: REVERSE_ENGINEERING } = FEAT;

const routeNames = (routes) => routes.map((r) => r.route);

test("formula Price by level, clamped to the table", () => {
    assert.equal(formulaPrice(0), 50);
    assert.equal(formulaPrice(4), 500);
    assert.equal(formulaPrice(20), 350000);
    assert.equal(formulaPrice(25), 350000);
    assert.equal(formulaPrice(-1), 50);
    assert.throws(() => formulaPrice(1.5), TypeError);
});

test("buying adds the rarity surcharge setting, rounded up", () => {
    assert.equal(buyPriceCp({ level: 0 }), 50);
    assert.equal(buyPriceCp({ level: 0, rarity: "uncommon" }), 50);              // 0% by default
    const surcharged = rulesWith({ formulaSurchargeUncommon: 15, formulaSurchargeRare: 100 });
    assert.equal(buyPriceCp({ level: 0, rarity: "uncommon" }, surcharged), 58);  // 7.5 cp rounds up
    assert.equal(buyPriceCp({ level: 4, rarity: "rare" }, surcharged), 1000);
    assert.equal(buyPriceCp({ level: 4, rarity: "unique" }, surcharged), 1000);
    assert.equal(buyPriceCp({ level: 4 }, surcharged), 500);
});

test("the Craft route: the formula, its family, a feature, or none for what the crafter has access to", () => {
    assert.equal(craftRoute({ known: true, family: true }), "known");
    assert.equal(craftRoute({ family: true }), "family");
    assert.equal(craftRoute({ virtual: true }), "virtual");
    assert.equal(craftRoute({}), "none");
    assert.equal(craftRoute({ rarity: "uncommon" }), null);
    assert.equal(craftRoute({ rarity: "uncommon", accessGrant: true }), "none");
    assert.equal(craftRoute({ rarity: "uncommon", accessGrant: true }, rulesWith({ uncommonNeedsFormula: true })), null);
    assert.equal(craftRoute({ rarity: "rare", known: true }, rulesWith({ uncommonNeedsFormula: true })), "known");
});

test("acquisition routes: buy and copy always, the rest by feat, possession and allies", () => {
    const item = { level: 4, rarity: "common" };
    assert.deepEqual(acquisitionRoutes({ item }), [
        { route: "buy", costCp: 500, minutes: 60, check: null, needs: [] },
        { route: "copy-npc", costCp: 500, minutes: 60, check: null, needs: [] },
    ]);
    const all = acquisitionRoutes({ item, feats: [INVENTOR, REVERSE_ENGINEERING], possessesItem: true, allyHasFormula: true, hasScanner: true });
    assert.deepEqual(routeNames(all), ["buy", "copy-npc", "copy-ally", "invent", "reverse-engineer", "scanner"]);
    assert.deepEqual(all.find((r) => r.route === "copy-ally"), { route: "copy-ally", costCp: 0, minutes: 60, check: null, needs: ["ally-confirms"] });
    assert.deepEqual(all.find((r) => r.route === "invent"), { route: "invent", costCp: 500, setupDays: 2, check: "craft", needs: [] });
    assert.equal(all.find((r) => r.route === "reverse-engineer").setupDays, 1);
    assert.deepEqual(all.find((r) => r.route === "scanner"), { route: "scanner", costCp: 0, minutes: 10, check: null, needs: [] });
    assert.equal(acquisitionRoutes({ item, possessesItem: true }).find((r) => r.route === "reverse-engineer").setupDays, 2);
    assert.equal(acquisitionRoutes({ item, allyHasFormula: true }, rulesWith({ allyCopyCostCp: 25 }))[2].costCp, 25);
});

test("acquisition routes for rarer formulas and items that cannot be reverse-engineered", () => {
    const uncommon = { level: 4, rarity: "uncommon" };
    assert.deepEqual(acquisitionRoutes({ item: uncommon })[0].needs, ["seller"]);
    assert.deepEqual(routeNames(acquisitionRoutes({ item: uncommon, feats: [INVENTOR] })), ["buy", "copy-npc"]);
    assert.ok(routeNames(acquisitionRoutes({ item: uncommon, feats: [INVENTOR] }, rulesWith({ inventorRarity: true }))).includes("invent"));
    assert.ok(!routeNames(acquisitionRoutes({ item: { level: 4, rarity: "unique" }, feats: [INVENTOR] }, rulesWith({ inventorRarity: true }))).includes("invent"));
    assert.deepEqual(routeNames(acquisitionRoutes({ item: { level: 2, noReverseEngineer: true }, possessesItem: true, hasScanner: true })), ["buy", "copy-npc"]);
});

test("formulaRoutes: a crafter with the formula sees only that; without it, every way to get one", () => {
    assert.deepEqual(formulaRoutes({ item: { level: 4 }, known: true }), [{ route: "known", costCp: 0, setupDays: 1, check: "craft", needs: [] }]);
    const none = formulaRoutes({ item: { level: 4 } });
    assert.deepEqual(none[0], { route: "none", costCp: 0, setupDays: 2, check: "craft", needs: [], hintCp: 500 });
    assert.deepEqual(routeNames(none), ["none", "buy", "copy-npc"]);
    assert.deepEqual(routeNames(formulaRoutes({ item: { level: 4, rarity: "rare" } })), ["buy", "copy-npc"]);
    assert.deepEqual(craftCopyRoute({ level: 4 }), { route: "craft-copy", costCp: 500, setupDays: 1, check: "craft", needs: [] });
});

test("Craft-like formula jobs: the formula's Price, the job's setup and the item's Craft DC with rarity", () => {
    const invent = formulaJobPlan("invent", { item: { level: 6, rarity: "uncommon" } });
    assert.deepEqual(invent, {
        priceCp: 1300, upfrontCp: 650, setup: { days: 2, hours: 0 },
        dc: { level: 6, rarity: 2, repeat: 0, adjust: 0, pwol: false, final: 24 }, bonus: null,
    });
    assert.deepEqual(formulaJobPlan("invent", { item: { level: 6 } }, rulesWith({ inventorSetupDays: 3 })).setup, { days: 3, hours: 0 });
    const reverse = formulaJobPlan("reverse-engineer", { item: { level: 6, rarity: "rare" }, feats: [REVERSE_ENGINEERING] });
    assert.deepEqual(reverse.setup, { days: 1, hours: 0 });
    assert.equal(reverse.dc.final, 27);
    assert.deepEqual(reverse.bonus, { type: "circumstance", value: 2 });
    assert.deepEqual(formulaJobPlan("reverse-engineer", { item: { level: 6 } }).setup, { days: 2, hours: 0 });
    assert.equal(formulaJobPlan("reverse-engineer", { item: { level: 6 } }).bonus, null);
    const copy = formulaJobPlan("craft-copy", { item: { level: 0 } });
    assert.deepEqual([copy.priceCp, copy.upfrontCp, copy.setup.days, copy.dc.final], [50, 25, 1, 14]);
    assert.throws(() => formulaJobPlan("buy", { item: { level: 1 } }), RangeError);
});

test("each route records its provenance (4.13)", () => {
    assert.deepEqual({ ...PROVENANCE }, {
        buy: "bought", "copy-npc": "copied-npc", "copy-ally": "copied-ally", invent: "invented",
        "reverse-engineer": "reverse-engineered", scanner: "reverse-engineered", "craft-copy": "copied-ally",
    });
});
