/**
 * Service orders (DESIGN.md 4.5, 6.13), precious-material stock lines (6.6), the formula jobs' plans and gates (6.8) and
 * the M5 order records (4.2.1), M5.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE, RANK } from "../../scripts/logic/core.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { FORMULA_ORDER_ROUTES, formulaOrderGates, instantPlan } from "../../scripts/logic/formula-jobs.mjs";
import { lockFirstBatch } from "../../scripts/logic/lock-first.mjs";
import { materialLines, materialRarity, materialsCp, orderPrecious, runeLevelProblem, stockCpOf, stockMaterial } from "../../scripts/logic/materials.mjs";
import { makeOrder } from "../../scripts/logic/orders.mjs";
import { repairEyepiece } from "../../scripts/logic/registry.mjs";
import {
    affixHostKinds, affixProblem, cancelService, closeService, makeService, offerService, repairDamage, repairHp, repairResult, serviceActions,
} from "../../scripts/logic/services.mjs";

const stamp = { by: "u1", at: { world: 0, real: 1 } };
const viewer = (owned = [], isGM = false) => ({ isGM, owns: (uuid) => isGM || owned.includes(uuid), hasCharacter: owned.length > 0 || isGM });

/* -------------------------------------------- */
/*  Services                                     */
/* -------------------------------------------- */

test("a service record: a repair names its item, a formula copy its formula; offered once, closed once", () => {
    const repair = makeService({ id: "s1", kind: "repair", requester: "A", target: "Actor.a.Item.shield" }, stamp);
    assert.deepEqual([repair.status, repair.performer, repair.target], ["open", null, "Actor.a.Item.shield"]);
    assert.throws(() => makeService({ id: "s2", kind: "repair", requester: "A" }, stamp), TypeError);
    assert.throws(() => makeService({ id: "s3", kind: "formula-copy", requester: "A" }, stamp), TypeError);
    assert.throws(() => makeService({ id: "s4", kind: "sharpen", requester: "A" }, stamp), RangeError);
    assert.deepEqual(offerService(repair, "B"), { ok: true, patch: { performer: "B" } });
    assert.equal(offerService({ ...repair, performer: "C" }, "B").reason, "taken");
    assert.deepEqual(closeService(repair, "done", { restored: 15 }).patch, { status: "done", result: { restored: 15 } });
    assert.equal(closeService({ ...repair, status: "done" }, "done").reason, "state");
    assert.throws(() => closeService(repair, "cancelled"), RangeError);
    assert.deepEqual(cancelService(repair).patch, { status: "cancelled" });
});

test("who may act on a service: any member offers, the performer's owners perform, either side or a GM cancels", () => {
    const open = makeService({ id: "s1", kind: "identify-alchemy", requester: "A" }, stamp);
    assert.deepEqual(serviceActions(open, viewer(["B"])), { offer: true, perform: false, cancel: false });
    assert.deepEqual(serviceActions(open, viewer(["A"])), { offer: true, perform: false, cancel: true });
    const taken = { ...open, performer: "B" };
    assert.deepEqual(serviceActions(taken, viewer(["B"])), { offer: false, perform: true, cancel: true });
    assert.deepEqual(serviceActions(taken, viewer([], true)).cancel, true);
    assert.deepEqual(serviceActions({ ...taken, status: "done" }, viewer(["B"])), { offer: false, perform: false, cancel: false });
});

test("Repair restores 5 + 5 per rank, 10 + 10 on a critical success; the Crafter's Eyepiece 10 + 10 and 15 + 15 (6.13)", () => {
    assert.equal(repairHp({ rank: RANK.expert, degree: DEGREE.success }), 15);
    assert.equal(repairHp({ rank: RANK.expert, degree: DEGREE.critSuccess }), 30);
    assert.equal(repairHp({ rank: RANK.expert, degree: DEGREE.fail }), 0);
    const eyepiece = repairEyepiece(["crafters-eyepiece"]);
    assert.deepEqual(eyepiece, { success: 10, critSuccess: 15 });
    assert.equal(repairHp({ rank: RANK.master, degree: DEGREE.success, eyepiece }), 40);
    assert.equal(repairHp({ rank: RANK.master, degree: DEGREE.critSuccess, eyepiece }), 60);
    assert.equal(repairEyepiece(["artisans-toolkit"]), null);
    assert.equal(repairHp({ rank: RANK.untrained, degree: DEGREE.success }), 5, "Repair is an untrained action: 5 + 5 x 0");
    assert.equal(repairHp({ rank: RANK.untrained, degree: DEGREE.critSuccess }), 10);
    assert.equal(repairHp({ rank: RANK.untrained, degree: DEGREE.success, eyepiece }), 10, "the eyepiece's base, untrained");
    assert.deepEqual(repairResult({ value: 5, max: 20 }, DEGREE.success, { rank: RANK.untrained }), { ok: true, hp: 10, restored: 5, damage: 0 });
    assert.equal(repairDamage(9, 5), 4);
    assert.equal(repairDamage(3, 5), 0);
});

test("a Repair's result: capped at the item's maximum; a critical failure damages; destroyed or whole items are refused", () => {
    assert.deepEqual(repairResult({ value: 10, max: 20 }, DEGREE.success, { rank: RANK.expert }), { ok: true, hp: 20, restored: 10, damage: 0 });
    assert.deepEqual(repairResult({ value: 10, max: 20 }, DEGREE.critFail, { rank: RANK.expert, rolled: 9, hardness: 5 }), { ok: true, hp: 6, restored: 0, damage: 4 });
    assert.equal(repairResult({ value: 0, max: 20 }, DEGREE.success, { rank: 1 }).reason, "destroyed");
    assert.equal(repairResult({ value: 20, max: 20 }, DEGREE.success, { rank: 1 }).reason, "undamaged");
    assert.equal(repairResult({ value: 0, max: 0 }, DEGREE.success, { rank: 1 }).reason, "no-hp");
});

test("affixing: a talisman or spellheart, on the same actor, on the kind of host it names; one per host, two with Talismanic Sage", () => {
    const talisman = { traits: ["consumable", "magical", "talisman"], usage: "affixed-to-armor", actor: "A" };
    const armor = { type: "armor", traits: [], actor: "A" };
    assert.equal(affixProblem({ talisman, host: armor, onHost: 0 }), null);
    assert.equal(affixProblem({ talisman, host: armor, onHost: 1 }).reason, "host-taken");
    assert.equal(affixProblem({ talisman, host: armor, onHost: 1, talismanicSage: true }), null);
    assert.equal(affixProblem({ talisman, host: { ...armor, type: "weapon" } }).reason, "wrong-host");
    assert.equal(affixProblem({ talisman, host: { ...armor, actor: "B" } }).reason, "not-together");
    assert.equal(affixProblem({ talisman: { ...talisman, traits: ["consumable"] }, host: armor }).reason, "not-talisman");
    assert.equal(affixProblem({ talisman: { ...talisman, usage: "" }, host: { type: "weapon", traits: ["bomb"], actor: "A" } }).reason, "not-host",
        "bombs are consumed (rules.talismanHostsExcludeBombs)");
    assert.equal(affixProblem({ talisman: { ...talisman, usage: "" }, host: { type: "weapon", traits: ["bomb"], actor: "A" }, excludeBombs: false }), null);
    assert.deepEqual(affixHostKinds("affixed-to-a-melee-weapon"), ["weapon"]);
    assert.deepEqual(affixHostKinds("affixed-to-a-shield"), ["shield"]);
});

test("a talisman whose usage names several hosts goes on any of them (affixed-to-armor-or-a-weapon and the rest)", () => {
    const on = (usage, type) => affixProblem({ talisman: { traits: ["talisman"], usage, actor: "A" }, host: { type, traits: [], actor: "A" } });
    for (const usage of ["affixed-to-armor-or-a-weapon", "affixed-to-metal-armor-or-a-weapon", "affixed-to-non-metal-armor-or-a-weapon"]) {
        assert.deepEqual(affixHostKinds(usage), ["armor", "weapon"], usage);
        assert.equal(on(usage, "armor"), null, `${usage} on armor`);
        assert.equal(on(usage, "weapon"), null, `${usage} on a weapon`);
        assert.equal(on(usage, "shield").reason, "wrong-host", `${usage} on a shield`);
    }
    assert.deepEqual(affixHostKinds("affixed-to-a-shield-or-weapon"), ["shield", "weapon"]);
    assert.equal(on("affixed-to-a-shield-or-weapon", "weapon"), null);
    assert.equal(on("affixed-to-a-shield-or-weapon", "armor").reason, "wrong-host");
    assert.deepEqual(affixHostKinds("affixed-to-armor-shield-or-weapon"), ["armor", "shield", "weapon"]);
    assert.equal(on("affixed-to-armor-shield-or-weapon", "armor"), null);
    assert.deepEqual(affixHostKinds("affixed-to-headgear"), ["equipment"]);
    assert.equal(on("affixed-to-headgear", "equipment"), null, "headgear is worn equipment");
    assert.equal(on("affixed-to-headgear", "weapon").reason, "wrong-host");
    assert.deepEqual(affixHostKinds("affixed-to-firearm"), ["weapon"]);
    assert.deepEqual(affixHostKinds("affixed-to-armor-or-travelers-clothing"), ["armor"]);
    assert.equal(affixHostKinds("affixed-to-a-creature"), null, "no host word: any armor, shield or weapon");
    assert.equal(on("affixed-to-a-creature", "equipment").reason, "not-host");
});

/* -------------------------------------------- */
/*  Precious-material stock (6.6)                */
/* -------------------------------------------- */

test("stock is precious material by slug; cold iron and silver are common, the rest need stock items", () => {
    assert.equal(stockMaterial({ slug: "adamantine-chunk", traits: ["precious"] }), "adamantine");
    assert.equal(stockMaterial({ slug: "djezet-alloy-ingot", traits: ["precious"] }), "djezet");
    assert.equal(stockMaterial({ slug: "duskwood-lumber", traits: ["precious"] }), "duskwood");
    assert.equal(stockMaterial({ slug: "adamantine-chunk", traits: [] }), null, "the precious trait marks stock");
    assert.equal(stockMaterial({ slug: "longsword", traits: ["precious"] }), null);
    assert.equal(materialRarity("cold-iron"), "common");
    assert.equal(materialRarity("adamantine"), "uncommon");
});

test("a precious item's grade caps the level of the runes it holds: 8 for low grade, 15 for standard (GM Core p.253)", () => {
    assert.deepEqual(runeLevelProblem({ type: "silver", grade: "low" }, 10), { reason: "grade-rune-level", data: { grade: "low", max: 8 } });
    assert.equal(runeLevelProblem({ type: "silver", grade: "low" }, 8), null);
    assert.equal(runeLevelProblem({ type: "cold-iron", grade: "standard" }, 15), null);
    assert.equal(runeLevelProblem({ type: "cold-iron", grade: "standard" }, 16).data.max, 15);
    assert.equal(runeLevelProblem({ type: "adamantine", grade: "high" }, 20), null);
    assert.equal(runeLevelProblem({ type: null, grade: null }, 20), null, "no precious material, no cap");
});

test("an order's material lines count at their Price toward the up-front half and the material's share (G8, 6.6)", () => {
    const order = { materials: {
        a: { id: "a", material: "adamantine", valueCp: 50000 },
        b: { id: "b", material: "cold-iron", valueCp: 1000 },
        c: { id: "c", material: "adamantine", valueCp: 9999, used: { real: 1 } },
        d: { id: "d", material: "adamantine", valueCp: 7, returned: { real: 1 } },
    } };
    assert.deepEqual(materialLines(order).map((l) => l.id), ["a", "b"]);
    assert.equal(materialsCp(order), 51000);
    assert.equal(stockCpOf(order, "adamantine"), 50000);
    // A standard-grade adamantine item of level 11: the master crafter needs 25% of the up-front half in the material.
    const product = { level: 11, magical: false, material: { type: "adamantine", grade: "standard" } };
    const crafter = { level: 12, rank: RANK.master };
    assert.equal(orderPrecious({ product, crafter, order, upfrontCp: 200000, coinCp: 0 }).ok, true, "25% of 2,000 gp is 500 gp of adamantine");
    const short = orderPrecious({ product, crafter, order: { materials: {} }, upfrontCp: 200000, coinCp: 200000 });
    assert.deepEqual([short.ok, short.problems[0].reason, short.problems[0].data.stockOnly], [false, "material-share", true], "coin never stands in for adamantine");
    const iron = { level: 2, magical: false, material: { type: "cold-iron", grade: "low" } };
    assert.equal(orderPrecious({ product: iron, crafter: { level: 2, rank: RANK.expert }, order: { materials: {} }, upfrontCp: 1000, coinCp: 1000 }).ok, true,
        "coin may buy a common material");
    assert.equal(orderPrecious({ product: { level: 1, magical: false, material: { type: null } }, crafter, order, upfrontCp: 1, coinCp: 0 }), null);
});

/* -------------------------------------------- */
/*  Formula jobs (6.8) and the order record      */
/* -------------------------------------------- */

test("instant acquisitions: buy and copy at the formula's Price, a seller confirmed for a rarer one, a scanner with the item", () => {
    const common = { level: 4, rarity: "common" };
    assert.deepEqual(instantPlan("buy", { item: common }), { ok: true, route: "buy", costCp: 500, provenance: "bought", needs: [], minutes: 60 });
    assert.equal(instantPlan("copy-npc", { item: common }).provenance, "copied-npc");
    const rare = { level: 4, rarity: "uncommon" };
    assert.deepEqual(instantPlan("buy", { item: rare }), { ok: false, reason: "needs", data: { needs: ["seller"] } });
    assert.equal(instantPlan("buy", { item: rare }, ["seller"], rulesWith({ formulaSurchargeUncommon: 50 })).costCp, 750);
    assert.equal(instantPlan("scanner", { item: common }).reason, "no-route", "needs the scanner and the item");
    assert.equal(instantPlan("scanner", { item: common, possessesItem: true, hasScanner: true }).costCp, 0);
    assert.equal(instantPlan("invent", { item: common }).reason, "no-route", "a Craft-like job is an order, not instant");
    assert.equal(instantPlan("grant", {}).provenance, "granted");
    assert.deepEqual(FORMULA_ORDER_ROUTES, ["invent", "reverse-engineer", "craft-copy"]);
});

test("formula jobs take their own gate sets (6.5): Inventor, the item possessed, the formula known", () => {
    const crafter = { level: 6, ranks: { crafting: 2 }, feats: ["alchemical-crafting"], unlocks: [], lockedBy: null };
    const item = { level: 3, rarity: "common", traits: ["alchemical", "consumable"], priceCp: 900 };
    const p = { crafter, item, tools: { available: ["alchemists-lab"] }, escrowCp: 150, upfrontCp: 150 };
    const failing = (gates) => gates.filter((g) => !g.ok).map((g) => [g.id, g.reason]);
    assert.deepEqual(failing(formulaOrderGates("invent", p)), [["G4", "feats"]], "Inventor is missing");
    assert.deepEqual(failing(formulaOrderGates("reverse-engineer", p)), [["G10", "target-not-held"]]);
    assert.deepEqual(failing(formulaOrderGates("reverse-engineer", { ...p, itemHeld: true })), []);
    assert.deepEqual(failing(formulaOrderGates("craft-copy", p)), [["G6", "formula-unknown"]]);
    assert.throws(() => formulaOrderGates("buy", p), RangeError);
});

test("an M5 order record: a formula for one book, the targeted kinds name their item, unknown kinds throw", () => {
    const base = { id: "o1", requester: "A", recipient: { kind: "actor", uuid: "A" }, product: { uuid: "U", snapshot: {} }, quantity: 1 };
    const formula = makeOrder({ ...base, productType: "formula", route: "invent", crafter: "A" }, stamp);
    assert.deepEqual([formula.product.type, formula.route, formula.status, formula.custody], ["formula", "invent", "accepted", {}]);
    assert.throws(() => makeOrder({ ...base, productType: "formula", quantity: 2 }, stamp), RangeError);
    assert.throws(() => makeOrder({ ...base, productType: "formula", recipient: { kind: "strongbox" } }, stamp), RangeError);
    assert.throws(() => makeOrder({ ...base, craftType: "rune-etch" }, stamp), TypeError, "an etching names its target");
    const etch = makeOrder({ ...base, craftType: "rune-etch", target: "Actor.a.Item.sword" }, stamp);
    assert.deepEqual([etch.craftType, etch.target], ["rune-etch", "Actor.a.Item.sword"]);
    assert.throws(() => makeOrder({ ...base, craftType: "tattoo" }, stamp), RangeError, "M9");
});

test("a lock-first move's item updates come after its debits and before its credits and new items (M5)", () => {
    const batch = lockFirstBatch({
        rowIds: ["r1"], debits: [{ target: "strongbox", plan: { deletes: ["c1"] } }], credits: [{ target: "Actor.a", plan: { creates: [{ denomination: "gp", quantity: 1 }] } }],
        items: [{ target: "strongbox", data: [{ name: "x" }] }], itemUpdates: [{ target: "strongbox", updates: [{ _id: "i1", system: { runes: { potency: 1 } } }] }],
        resume: { touched: [], actor: null },
    });
    assert.deepEqual(batch.apply.map((d) => d.op), ["lock", "deleteItems", "updateItems", "createCoins", "createItems", "ledger"]);
    assert.ok(batch.lock[0].move.apply.some((d) => d.op === "updateItems"), "a resume sends the updates again");
});

test("the funding bar counts earmarked stock at its Price, as G8 does (M5)", async () => {
    const { orderProgress } = await import("../../scripts/logic/views.mjs");
    const order = { status: "accepted", quantity: 1, product: { snapshot: { priceCp: 600, per: 1 } }, materials: { a: { id: "a", valueCp: 200 } } };
    const pledge = { alloc: 100 };
    assert.deepEqual([orderProgress(order, { rows: [pledge] }).escrowCp, orderProgress(order, { rows: [pledge] }).pct], [300, 100]);
});
