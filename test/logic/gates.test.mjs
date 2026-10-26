/** Eligibility gates G1-G12 and the gate sets for formula jobs (DESIGN.md 6.5, 6.8). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { FEAT, RANK } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import {
    allPass, craftCopyGates, craftGates, gateAccess, gateAvailable, gateCustody, gateFeats, gateLevel,
    gateMaterials, gateProduct, gateProficiency, gateRequirements, gateRoute, gateTools, gateTrained, inventGates,
    missingCraftingFeats, requiredRank, requiredTool, reverseEngineerGates, runeProblem,
} from "../../scripts/logic/gates.mjs";

const { untrained, trained, expert, master, legendary } = RANK;
const crafter = (fields = {}) => ({ level: 10, ranks: { crafting: master }, feats: [], lockedBy: null, ...fields });
const elixir = { level: 5, rarity: "common", traits: ["alchemical", "consumable", "elixir"], priceCp: 3000 };
const potion = { level: 6, rarity: "common", traits: ["consumable", "magical", "potion"], priceCp: 5000 };

test("G1: trained in Crafting or the substitute skill", () => {
    assert.equal(gateTrained(crafter()).ok, true);
    assert.deepEqual(gateTrained(crafter({ ranks: { crafting: untrained } })), { id: "G1", ok: false, reason: "untrained", data: { skill: "crafting" }, unlock: "train" });
    assert.equal(gateTrained(crafter({ ranks: { crafting: untrained, survival: trained } }), "survival").ok, true);
});

test("G2: the item's level is at most the crafter's", () => {
    assert.equal(gateLevel(crafter(), { level: 10 }).ok, true);
    assert.deepEqual(gateLevel(crafter(), { level: 11 }).data, { level: 11 });
    assert.equal(gateLevel(crafter({ level: 0 }), { level: 0 }).ok, true);
});

test("G3: master from item level 9, legendary from 17 or 16 by setting", () => {
    assert.deepEqual([0, 8, 9, 16, 17, 20].map((level) => requiredRank(level)), [trained, trained, master, master, legendary, legendary]);
    assert.equal(requiredRank(16, rulesWith({ legendaryItemLevel: 16 })), legendary);
    assert.equal(gateProficiency(crafter({ ranks: { crafting: expert } }), { level: 9 }).reason, "rank");
    assert.equal(gateProficiency(crafter({ level: 17 }), { level: 16 }).ok, true);
    assert.equal(gateProficiency(crafter({ level: 17 }), { level: 16 }, "crafting", rulesWith({ legendaryItemLevel: 16 })).ok, false);
    assert.deepEqual(gateProficiency(crafter({ level: 20 }), { level: 17 }).data, { skill: "crafting", rank: legendary });
});

test("G4: crafting feats by kind of item", () => {
    const missing = (item, feats = [], fields = {}, craftType, rules) => missingCraftingFeats(item, crafter({ feats, ...fields }), craftType, rules).feats;
    assert.deepEqual(missing(elixir), [FEAT.alchemicalCrafting]);
    assert.deepEqual(missing(elixir, [FEAT.alchemicalCrafting]), []);
    assert.deepEqual(missing(potion), [FEAT.magicalCrafting]);
    assert.deepEqual(missing({ traits: ["alchemical", "consumable", "magical"] }), [FEAT.alchemicalCrafting, FEAT.magicalCrafting]);
    assert.deepEqual(missing({ traits: ["consumable", "magical", "talisman"] }), [FEAT.magicalCrafting]);
    assert.deepEqual(missing({ traits: ["consumable", "magical", "talisman"] }, [], { unlocks: ["talisman"] }), []);
    assert.deepEqual(missing({ traits: ["consumable", "snare"] }), [FEAT.snareCrafting]);
    assert.deepEqual(missing({ traits: ["consumable", "magical", "snare"] }, [FEAT.snareCrafting]), [FEAT.magicalCrafting]);
    assert.deepEqual(missing({ traits: ["consumable", "magical", "snare"] }, [FEAT.snareCrafting], {}, "item",
        rulesWith({ magicalSnaresNeedMagicalCrafting: false })), []);
    assert.deepEqual(missing({ traits: ["consumable", "gadget", "magical"] }), []);
    assert.deepEqual(missing({ traits: ["mechanical"] }), []);
});

test("G4: tattoos and grafts", () => {
    const tattoo = { traits: ["invested", "magical", "tattoo"] };
    assert.deepEqual(missingCraftingFeats(tattoo, crafter(), "tattoo").feats, [FEAT.tattooArtist]);
    const artistry = crafter({ feats: [FEAT.magicalCrafting, FEAT.specialtyCraftingArtistry] });
    assert.deepEqual(missingCraftingFeats(tattoo, artistry, "tattoo").feats, []);
    assert.deepEqual(missingCraftingFeats(tattoo, artistry, "tattoo", rulesWith({ tattooProcess: "simple" })).feats, [FEAT.tattooArtist]);
    const graft = { traits: ["graft", "invested", "magical"] };
    assert.deepEqual(missingCraftingFeats(graft, crafter(), "graft"), { feats: [FEAT.graftTechnician], ranks: { medicine: expert } });
    const technician = crafter({ feats: [FEAT.graftTechnician], ranks: { crafting: trained, medicine: expert } });
    assert.equal(gateFeats(technician, graft, "graft").ok, true);
    assert.deepEqual(gateFeats(crafter(), potion).data, { feats: [FEAT.magicalCrafting], ranks: {} });
});

test("G5: access to an uncommon item through its formula or a registry grant", () => {
    const uncommon = { rarity: "uncommon" };
    assert.equal(gateAccess({ rarity: "common" }, "none").ok, true);
    assert.equal(gateAccess(uncommon, "known").ok, true);
    assert.equal(gateAccess(uncommon, "family").ok, true);
    assert.equal(gateAccess(uncommon, "virtual").ok, true);
    assert.deepEqual(gateAccess(uncommon, null), { id: "G5", ok: false, reason: "no-access", data: { rarity: "uncommon" }, unlock: "formula" });
    assert.equal(gateAccess(uncommon, "none", true).ok, true);
    const strict = rulesWith({ uncommonNeedsFormula: true });
    assert.equal(gateAccess(uncommon, "none", true, strict).reason, "needs-formula");
    assert.equal(gateAccess({ rarity: "unique" }, "known", false, strict).ok, true);
});

test("G6: a Craft route, or the formula jobs that would open one", () => {
    assert.equal(gateRoute("none").ok, true);
    assert.deepEqual(gateRoute(null, [{ route: "buy" }]).data, { routes: [{ route: "buy" }] });
});

test("G7: the right tool on the crafter or in the strongbox, or a substitution", () => {
    assert.equal(requiredTool(elixir), "alchemists-lab");
    assert.equal(requiredTool(potion), "artisans-toolkit");
    assert.equal(requiredTool({ traits: ["snare"] }), "artisans-toolkit");
    assert.equal(requiredTool({ traits: ["snare"] }, rulesWith({ snareToolkitIsArtisans: false })), "snare-toolkit");
    assert.equal(gateTools(elixir, { available: ["artisans-toolkit"] }).reason, "tool");
    assert.equal(gateTools(elixir, { available: ["alchemists-lab"] }).ok, true);
    assert.equal(gateTools(elixir, { substitutes: ["alchemists-lab"] }).ok, true);
    assert.equal(gateTools(potion).ok, false);
});

test("G8: escrow covers the up-front half, and the precious-material rules pass", () => {
    assert.equal(gateMaterials(3250, 3250).ok, true);
    assert.deepEqual(gateMaterials(3000, 3250).data, { shortCp: 250 });
    assert.equal(gateMaterials(5000, 3250, { ok: false, problems: [{ reason: "grade-rank" }] }).reason, "precious");
    // A missing amount is a caller bug, not a pass (0 < undefined is false).
    assert.throws(() => gateMaterials(0, undefined), RangeError);
    assert.throws(() => gateMaterials(undefined, 0), RangeError);
    assert.throws(() => craftGates({ crafter: crafter(), item: elixir, route: "known", tools: { available: ["alchemists-lab"] } }), RangeError);
});

test("G9: the checklist and spell supply; Craft Anything waives all but added costs", () => {
    const requirements = [{ key: "a", kind: "narrative", confirmed: true }, { key: "b", kind: "narrative", confirmed: false }, { key: "c", kind: "cost", confirmed: false }];
    assert.deepEqual(gateRequirements(crafter(), requirements).data, { keys: ["b", "c"], spells: false });
    const anything = crafter({ feats: [FEAT.craftAnything] });
    assert.deepEqual(gateRequirements(anything, requirements).data, { keys: ["c"], spells: false });
    assert.equal(gateRequirements(crafter(), [], { spellsNeeded: true }).reason, "spells");
    assert.equal(gateRequirements(crafter(), [], { spellsNeeded: true, spellsSupplied: true }).ok, true);
    assert.equal(gateRequirements(anything, [], { spellsNeeded: true }).ok, true);
});

test("G10: custody of the target, or a consenting and locked subject", () => {
    assert.equal(gateCustody("item").ok, true);
    for (const type of ["upgrade", "rune-etch", "rune-transfer"]) {
        assert.equal(gateCustody(type).reason, "target-not-held");
        assert.equal(gateCustody(type, { targetHeld: true }).ok, true);
    }
    assert.equal(gateCustody("tattoo").reason, "no-consent");
    assert.equal(gateCustody("graft", { subjectConsented: true }).reason, "subject-not-locked");
    assert.equal(gateCustody("tattoo", { subjectConsented: true, subjectLocked: true }).ok, true);
});

test("G11: not locked to another order", () => {
    assert.equal(gateAvailable(crafter(), "o1").ok, true);
    assert.equal(gateAvailable(crafter({ lockedBy: "o1" }), "o1").ok, true);
    assert.deepEqual(gateAvailable(crafter({ lockedBy: "o2" }), "o1").data, { order: "o2" });
});

test("G12: no artifacts, a Price, and the rune rules", () => {
    assert.equal(gateProduct({ priceCp: 100, isArtifact: true }).reason, "artifact");
    assert.equal(gateProduct({ priceCp: 0 }).reason, "no-price");
    const target = { potency: 1, propertyRunes: 0 };
    assert.equal(runeProblem({ kind: "property", target }), null);
    assert.deepEqual(runeProblem({ kind: "property", target: { potency: 1, propertyRunes: 1 } }), { reason: "property-slots", data: { slots: 1 } });
    assert.equal(runeProblem({ kind: "property", target: { potency: 1, propertyRunes: 1, orichalcum: true } }), null);
    assert.equal(runeProblem({ kind: "property", target: { potency: 0 } }).reason, "property-slots");
    assert.equal(runeProblem({ kind: "property", target: { isSpecific: true, potency: 3 } }).reason, "specific-fundamental-only");
    assert.equal(runeProblem({ kind: "fundamental", target: { isSpecific: true } }), null);
    assert.equal(runeProblem({ kind: "property", target: { isStaff: true, potency: 3 } }).reason, "staff-fundamental-only");
    assert.equal(runeProblem({ kind: "fundamental", target: { isShield: true } }).reason, "shield-reinforcing-only");
    assert.equal(runeProblem({ kind: "reinforcing", target: { isShield: true } }), null);
    assert.equal(runeProblem({ kind: "fundamental", target: { etching: true } }).reason, "one-rune-at-a-time");
    assert.equal(gateProduct({ priceCp: 100 }, "rune-etch", { kind: "property", target: { potency: 0 } }).reason, "property-slots");
    assert.equal(gateProduct({ priceCp: 100 }, "item", { kind: "property", target: { potency: 0 } }).ok, true);
});

test("craftGates: G1 to G12 in order, all passing for a ready alchemist", () => {
    const alchemist = crafter({ level: 5, ranks: { crafting: expert }, feats: [FEAT.alchemicalCrafting] });
    const gates = craftGates({
        crafter: alchemist, item: elixir, orderId: "o1", route: "known", tools: { available: ["alchemists-lab"] },
        escrowCp: 1500, upfrontCp: 1500,
    });
    assert.deepEqual(gates.map((g) => g.id), ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]);
    assert.equal(allPass(gates), true);
    const blocked = craftGates({ crafter: alchemist, item: { ...elixir, level: 9 }, route: null, upfrontCp: 1500 });
    assert.deepEqual(blocked.filter((g) => !g.ok).map((g) => g.id), ["G2", "G3", "G6", "G7", "G8"]);
});

test("reverse-engineering skips access and Craft Requirements, and needs the item in hand", () => {
    const uncommon = { ...potion, rarity: "uncommon" };
    const magician = crafter({ feats: [FEAT.magicalCrafting] });
    const base = { crafter: magician, item: uncommon, tools: { available: ["artisans-toolkit"] }, escrowCp: 650, upfrontCp: 650 };
    assert.equal(allPass(reverseEngineerGates({ ...base, itemHeld: true })), true);
    assert.deepEqual(reverseEngineerGates(base).filter((g) => !g.ok).map((g) => g.reason), ["target-not-held"]);
    assert.ok(!reverseEngineerGates(base).some((g) => g.id === "G5" || g.id === "G9"));
});

test("inventing needs Inventor and the item's feat; uncommon and rare only by setting, unique never", () => {
    const inventor = crafter({ feats: [FEAT.inventor, FEAT.magicalCrafting] });
    const base = { crafter: inventor, item: potion, tools: { available: ["artisans-toolkit"] }, escrowCp: 650, upfrontCp: 650 };
    assert.deepEqual(inventGates(base).map((g) => g.id), ["G1", "G2", "G3", "G4", "G5", "G7", "G8", "G11"]);
    assert.equal(allPass(inventGates(base)), true);
    assert.deepEqual(inventGates({ ...base, crafter: crafter({ feats: [FEAT.magicalCrafting] }) }).find((g) => g.id === "G4").data.feats, [FEAT.inventor]);
    const rare = { ...base, item: { ...potion, rarity: "rare" } };
    assert.equal(inventGates(rare).find((g) => g.id === "G5").reason, "invent-rarity");
    assert.equal(allPass(inventGates(rare, rulesWith({ inventorRarity: true }))), true);
    assert.equal(allPass(inventGates({ ...base, item: { ...potion, rarity: "unique" } }, rulesWith({ inventorRarity: true }))), false);
});

test("inventing works just like the Craft activity, so it needs the Craft's tool", () => {
    const alchemist = crafter({ level: 5, ranks: { crafting: expert }, feats: [FEAT.inventor, FEAT.alchemicalCrafting] });
    const formula = { level: 3, rarity: "common", traits: ["alchemical", "consumable"] };
    const gates = inventGates({ crafter: alchemist, item: formula, escrowCp: 150, upfrontCp: 150 });
    assert.deepEqual(gates.filter((g) => !g.ok).map((g) => [g.id, g.data]), [["G7", { tool: "alchemists-lab" }]]);
    assert.equal(allPass(inventGates({ crafter: alchemist, item: formula, tools: { available: ["alchemists-lab"] }, escrowCp: 150, upfrontCp: 150 })), true);
});

test("crafting a formula copy needs the formula and, as reverse-engineering, every requirement to Craft the item", () => {
    const magician = crafter({ feats: [FEAT.magicalCrafting] });
    const base = { crafter: magician, item: potion, tools: { available: ["artisans-toolkit"] }, escrowCp: 650, upfrontCp: 650 };
    assert.deepEqual(craftCopyGates({ ...base, knowsFormula: true }).map((g) => g.id), ["G1", "G2", "G3", "G4", "G6", "G7", "G8", "G11"]);
    assert.equal(allPass(craftCopyGates({ ...base, knowsFormula: true })), true);
    assert.equal(craftCopyGates(base).find((g) => g.id === "G6").reason, "formula-unknown");
    // Player Core p.294: a 3rd-level crafter trained in Crafting, with no feats, who owns a 12th-level magical
    // formula cannot Craft a copy of it, as they could not Craft the item.
    const novice = crafter({ level: 3, ranks: { crafting: trained }, feats: [] });
    const magicItem = { level: 12, rarity: "common", traits: ["consumable", "magical"] };
    const copy = craftCopyGates({ crafter: novice, item: magicItem, knowsFormula: true, tools: { available: ["artisans-toolkit"] }, escrowCp: 5000, upfrontCp: 5000 });
    assert.deepEqual(copy.filter((g) => !g.ok).map((g) => g.id), ["G2", "G3", "G4"]);
    // Access and the special Craft Requirements are never asked for.
    assert.ok(!copy.some((g) => g.id === "G5" || g.id === "G9"));
});
