/** Casting pledges (DESIGN.md 6.9) and runes on items (6.13, GM Core pp.223-225), M5. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { runeProblem } from "../../scripts/logic/gates.mjs";
import {
    castingServiceCp, castingsNeeded, castingsOf, livePledges, makePledge, pledgeProblem, pledgeTransition, pledgedSpell, scribable, spellGate,
    spellSupply,
} from "../../scripts/logic/pledges.mjs";
import {
    etchCheck, etchPriceCp, isRuneItemOf, normalRunes, priceDifferenceCp, propertyGrade, propertyKey, runeOf, runeSlug, runeTargetType, runesAfterEtch, runesUpdate,
    transferCostCp, transferRunes, usageFits,
} from "../../scripts/logic/runes.mjs";

const stamp = (real = 1) => ({ by: "u1", at: { world: 0, real } });
const SCROLL3 = { traits: ["consumable", "magical", "scroll"], spellcasting: { kind: "scroll", rank: 3 } };
const WAND2 = { traits: ["magical", "wand"], spellcasting: { kind: "wand", rank: 2 } };
const FIREBALL = { uuid: "Actor.c.Item.fireball", rank: 3, traits: ["fire", "manipulate"], category: "spell" };
const HASTE = { uuid: "Actor.c.Item.haste", rank: 3, traits: [], category: "spell" };

/* -------------------------------------------- */
/*  Pledges                                      */
/* -------------------------------------------- */

test("spell supply: pf2e's base scrolls and wands by rank, staves and spellhearts by trait", () => {
    assert.deepEqual(spellSupply(SCROLL3), { kind: "scroll", rank: 3, entries: [], any: 0 });
    assert.deepEqual(spellSupply(WAND2), { kind: "wand", rank: 2, entries: [], any: 0 });
    // A staff or spellheart whose description was not read (M9: `spellNeeds`) takes any casting, as many as offered (M5).
    assert.deepEqual(spellSupply({ traits: ["magical", "staff"] }), { kind: "staff", rank: null, entries: [], any: 1, unread: true });
    assert.deepEqual(spellSupply({ traits: ["magical", "spellheart"] }), { kind: "spellheart", rank: null, entries: [], any: 1, unread: true });
    assert.equal(spellSupply({ traits: ["alchemical"] }), null);
});

test("cantrips, focus spells and rituals cannot go into an item", () => {
    assert.equal(scribable(FIREBALL), true);
    assert.equal(scribable({ traits: ["cantrip"] }), false);
    assert.equal(scribable({ traits: [], category: "focus" }), false);
    assert.equal(scribable({ traits: [], category: "ritual" }), false);
});

test("pledge rules: rank, one spell per scroll batch, one casting for a wand, four scrolls at most (GM Core pp.262, 282)", () => {
    const supply = spellSupply(SCROLL3);
    assert.equal(pledgeProblem({ supply, spell: FIREBALL, castings: 2 }), null);
    assert.equal(pledgeProblem({ supply: null, spell: FIREBALL, castings: 1 }).reason, "not-spell-item");
    assert.equal(pledgeProblem({ supply, spell: { ...FIREBALL, rank: 4 }, castings: 1 }).reason, "spell-rank");
    assert.equal(pledgeProblem({ supply, spell: { ...FIREBALL, rank: 1 }, castings: 1 }), null, "a lower-rank spell is heightened");
    assert.equal(pledgeProblem({ supply, spell: { ...FIREBALL, category: "ritual" }, castings: 1 }).reason, "unscribable");
    assert.equal(pledgeProblem({ supply, spell: FIREBALL, castings: 0 }).reason, "castings");
    assert.equal(pledgeProblem({ supply, spell: null, castings: 1 }).reason, "no-spell");
    const existing = [makePledge({ id: "p1", caster: "A", spell: FIREBALL, rank: 3, castings: 3 }, stamp())];
    assert.equal(pledgeProblem({ supply, spell: HASTE, castings: 1, existing }).reason, "same-spell");
    assert.equal(pledgeProblem({ supply, spell: FIREBALL, castings: 2, existing }).reason, "scroll-castings");
    assert.equal(pledgeProblem({ supply, spell: FIREBALL, castings: 1, existing }), null);
    const wand = spellSupply(WAND2);
    assert.equal(pledgeProblem({ supply: wand, spell: { ...HASTE, rank: 2 }, castings: 2 }).reason, "one-casting");
    const staff = spellSupply({ traits: ["staff"] });
    assert.equal(pledgeProblem({ supply: staff, spell: null, castings: 3 }), null, "a staff's castings are the caster's count");
});

test("castings counted for the batch and for G9; withdrawn pledges drop out", () => {
    const order = { quantity: 3, pledges: {
        a: makePledge({ id: "a", caster: "A", spell: FIREBALL, rank: 3, castings: 2 }, stamp(1)),
        b: { ...makePledge({ id: "b", caster: "B", spell: FIREBALL, rank: 3, castings: 1 }, stamp(2)), status: "fulfilled" },
        c: { ...makePledge({ id: "c", caster: "C", spell: FIREBALL, rank: 3, castings: 4 }, stamp(3)), status: "withdrawn" },
    } };
    assert.deepEqual(livePledges(order).map((p) => p.id), ["a", "b"]);
    assert.equal(castingsOf(order), 3);
    assert.equal(castingsOf(order, ["fulfilled"]), 1);
    assert.deepEqual(spellGate(order, spellSupply(SCROLL3)), { spellsNeeded: true, spellsSupplied: false, needed: 3, fulfilled: 1, open: [] });
    assert.equal(castingsNeeded(spellSupply(WAND2), 1), 1);
    assert.equal(castingsNeeded(null, 4), 0);
    assert.equal(pledgedSpell(order).uuid, FIREBALL.uuid);
});

test("a pledge is offered, then cast or withdrawn once; a bought casting is fulfilled at the service price (Player Core p.295)", () => {
    const pledge = makePledge({ id: "p", caster: "A", spell: FIREBALL, rank: 3, castings: 1 }, stamp());
    assert.deepEqual([pledge.status, pledge.payer], ["offered", "A"], "the caster pays a scroll's spell cost");
    assert.deepEqual(pledgeTransition(pledge, "fulfil"), { ok: true, patch: { status: "fulfilled" } });
    assert.equal(pledgeTransition({ ...pledge, status: "fulfilled" }, "withdraw").reason, "state");
    assert.equal(pledgeTransition(null, "fulfil").reason, "no-pledge");
    const bought = makePledge({ id: "s", spell: FIREBALL, rank: 3, castings: 2, payer: "B", service: true, costCp: 2 * castingServiceCp(3) }, stamp());
    assert.deepEqual([bought.status, bought.caster, bought.costCp], ["fulfilled", null, 3600]);
    assert.equal(castingServiceCp(1), 300);
    assert.throws(() => castingServiceCp(10), RangeError);
});

/* -------------------------------------------- */
/*  Runes                                        */
/* -------------------------------------------- */

test("a rune item's slug names the part of system.runes it fills", () => {
    assert.deepEqual(runeOf({ slug: "weapon-potency-2", usage: "etched-onto-a-weapon" }), { target: "weapon", kind: "fundamental", slot: "potency", value: 2 });
    assert.deepEqual(runeOf({ slug: "striking-greater" }), { target: "weapon", kind: "fundamental", slot: "striking", value: 2 });
    assert.deepEqual(runeOf({ slug: "resilient-major" }), { target: "armor", kind: "fundamental", slot: "resilient", value: 3 });
    assert.deepEqual(runeOf({ slug: "reinforcing-rune-moderate" }), { target: "shield", kind: "reinforcing", slot: "reinforcing", value: 3 });
    assert.deepEqual(runeOf({ slug: "flaming-greater", usage: "etched-onto-a-weapon" }), { target: "weapon", kind: "property", slot: "property", value: "greaterFlaming" });
    assert.deepEqual(runeOf({ slug: "energy-resistant", usage: "etched-onto-armor" }).value, "energyResistant");
    assert.equal(runeOf({ slug: "elixir-of-life-minor", usage: "held-in-one-hand" }), null);
    assert.equal(runeOf({ slug: "striking-snare" }), null);
    assert.equal(propertyKey("ghost-touch"), "ghostTouch");
    assert.equal(runeTargetType("etched-onto-medium-heavy-metal-armor"), "armor");
});

test("etching: a stronger fundamental rune replaces the old one, a property rune joins the list; G12's limits", () => {
    const sword = { type: "weapon", runes: { potency: 1, striking: 0, property: [] } };
    assert.deepEqual(runesAfterEtch(sword, runeOf({ slug: "striking" })).runes, { ...normalRunes(sword.runes), striking: 1 });
    assert.equal(runesAfterEtch(sword, runeOf({ slug: "weapon-potency-1" })).reason, "not-stronger");
    assert.equal(runesAfterEtch(sword, runeOf({ slug: "resilient" })).reason, "wrong-item");
    const flaming = runeOf({ slug: "flaming", usage: "etched-onto-a-weapon" });
    assert.deepEqual(runesAfterEtch(sword, flaming).runes.property, ["flaming"]);
    assert.equal(runesAfterEtch({ ...sword, runes: { potency: 1, property: ["flaming"] } }, flaming).reason, "has-rune");
    // One property rune per point of potency (GM Core p.224), +1 on orichalcum.
    assert.equal(runeProblem(etchCheck({ ...sword, runes: { potency: 1, property: ["frost"] } }, flaming)).reason, "property-slots");
    assert.equal(runeProblem(etchCheck({ ...sword, runes: { potency: 1, property: ["frost"] }, material: { type: "orichalcum" } }, flaming)), null);
    assert.equal(runeProblem(etchCheck(sword, flaming, { etching: true })).reason, "one-rune-at-a-time");
    assert.equal(runeProblem(etchCheck({ ...sword, isSpecific: true }, flaming)).reason, "specific-fundamental-only");
    assert.equal(runeProblem(etchCheck({ type: "shield", runes: {} }, runeOf({ slug: "reinforcing-rune-minor" }))), null);
    assert.deepEqual(runesUpdate("shield", normalRunes({ reinforcing: 2 })), { reinforcing: 2 });
    assert.deepEqual(runesUpdate("armor", normalRunes({ potency: 1, resilient: 1 })), { potency: 1, resilient: 1, property: [] });
});

test("a rune's usage fits only the items it names: melee, thrown, damage types, monk, clan dagger, holy or unholy, armor category, metal", () => {
    const longsword = { type: "weapon", range: null, damageType: "slashing", traits: ["versatile-p"], category: "martial", group: "sword", baseItem: "longsword" };
    const rapier = { ...longsword, damageType: "piercing", traits: ["deadly-d8", "finesse"], baseItem: "rapier" };
    const mace = { ...longsword, damageType: "bludgeoning", traits: ["shove"], group: "club", baseItem: "mace" };
    const longbow = { type: "weapon", range: 100, damageType: "piercing", traits: ["deadly-d10", "volley-30"], category: "martial", group: "bow", baseItem: "longbow" };
    const dagger = { type: "weapon", range: null, damageType: "piercing", traits: ["agile", "finesse", "thrown-10", "versatile-s"], group: "knife", baseItem: "dagger" };
    const javelin = { type: "weapon", range: 30, damageType: "piercing", traits: ["thrown"], group: "dart", baseItem: "javelin" };
    const clan = { ...dagger, traits: ["agile", "dwarf", "parry", "versatile-b"], baseItem: "clan-dagger" };
    const staff = { type: "weapon", range: null, damageType: "bludgeoning", traits: ["monk", "two-hand-d8"], group: "club", baseItem: "staff" };
    const leather = { type: "armor", category: "light", group: "leather", traits: [] };
    const hide = { type: "armor", category: "medium", group: "leather", traits: [] };
    const chain = { type: "armor", category: "medium", group: "chain", traits: ["flexible", "noisy"] };
    const plate = { type: "armor", category: "heavy", group: "plate", traits: ["bulwark"] };
    const table = [
        ["etched-onto-a-weapon", [longsword, longbow], [leather]],
        ["etched-onto-slashing-melee-weapon", [longsword, { ...dagger }], [longbow, rapier, mace]],
        ["etched-onto-melee-weapon", [longsword, dagger, mace], [longbow, javelin]],
        ["etched-onto-piercing-or-slashing-melee-weapon", [longsword, rapier, dagger], [mace, longbow]],
        ["etched-onto-piercing-or-slashing-weapon", [longbow, rapier], [mace]],
        ["etched-onto-bludgeoning-weapon", [mace, clan], [longsword, rapier]],
        ["etched-onto-thrown-weapon", [dagger, javelin], [longsword, longbow]],
        ["etched-onto-melee-weapon-monk", [staff], [longsword]],
        ["etched-onto-clan-dagger", [clan], [dagger]],
        ["etched-onto-weapon-wo-holy-rune", [longsword, { ...longsword, runes: { property: ["holy"] } }], [{ ...longsword, runes: { property: ["unholy"] } }]],
        ["etched-onto-weapon-wo-unholy-rune", [longsword], [{ ...longsword, runes: { property: ["holy"] } }]],
        ["etched-onto-armor", [leather, plate], [longsword]],
        ["etched-onto-light-armor", [leather], [hide, plate]],
        ["etched-onto-heavy-armor", [plate], [chain]],
        ["etched-onto-med-heavy-armor", [hide, chain, plate], [leather]],
        ["etched-onto-lm-nonmetal-armor", [leather, hide], [chain, plate]],
        ["etched-onto-medium-heavy-metal-armor", [chain, plate], [hide, leather]],
        ["etched-onto-metal-armor", [chain, { ...leather, traits: ["metal"] }], [hide]],
    ];
    for (const [usage, fits, refused] of table) {
        for (const item of fits) assert.equal(usageFits(usage, item), true, `${usage} on ${item.baseItem ?? item.group}`);
        for (const item of refused) assert.equal(usageFits(usage, item), false, `${usage} not on ${item.baseItem ?? item.group}`);
    }
    assert.equal(usageFits("held-in-one-hand", leather), true, "no rune usage, nothing to check");
});

test("a stronger grade of a property rune replaces the weaker one in its slot, by etching or by transfer (GM Core p.224)", () => {
    const sword = { type: "weapon", runes: { potency: 1, striking: 1, property: ["flaming"] } };
    const greater = runeOf({ slug: "flaming-greater", usage: "etched-onto-a-weapon" });
    const flaming = runeOf({ slug: "flaming", usage: "etched-onto-a-weapon" });
    const etched = runesAfterEtch(sword, greater);
    assert.deepEqual([etched.ok, etched.runes.property, etched.replaces?.value], [true, ["greaterFlaming"], "flaming"]);
    assert.equal(runeSlug(etched.replaces), "flaming", "priced as the difference to the flaming rune");
    assert.equal(runeProblem(etchCheck(sword, greater, { replaces: etched.replaces })), null, "the upgrade takes the weaker rune's slot");
    assert.equal(runeProblem(etchCheck(sword, runeOf({ slug: "frost", usage: "etched-onto-a-weapon" }))).reason, "property-slots", "a new rune still needs a slot");
    assert.equal(runesAfterEtch({ ...sword, runes: { potency: 1, property: ["greaterFlaming"] } }, flaming).reason, "not-stronger");
    assert.deepEqual(propertyGrade("greaterFlaming"), { grade: "greater", base: "flaming", rank: 2 });
    assert.equal(propertyGrade("lesserDread").rank < propertyGrade("moderateDread").rank, true);
    const from = { type: "weapon", runes: { potency: 2, property: ["greaterFlaming"] } };
    const moved = transferRunes({ from, to: sword, rune: greater });
    assert.deepEqual([moved.ok, moved.toRunes.property, moved.fromRunes.property, moved.replaces?.value], [true, ["greaterFlaming"], [], "flaming"]);
    const swapped = transferRunes({ from, to: sword, rune: greater, swap: true, swapWith: "flaming" });
    assert.deepEqual([swapped.toRunes.property, swapped.fromRunes.property, swapped.replaces], [["greaterFlaming"], ["flaming"], null], "a swap sends the weaker grade back");
    assert.equal(transferRunes({ from: { type: "weapon", runes: { property: ["flaming"] } }, to: { type: "weapon", runes: { potency: 1, property: ["greaterFlaming"] } },
        rune: flaming }).reason, "not-stronger");
});

test("an etching's Price comes from the runes: the rune's own, less the one it upgrades (GM Core p.224)", () => {
    const sword = { type: "weapon", runes: { potency: 1, striking: 0, property: [] } };
    const etched = runesAfterEtch(sword, runeOf({ slug: "weapon-potency-2" }));
    assert.deepEqual(etched.replaces, { target: "weapon", kind: "fundamental", slot: "potency", value: 1 });
    assert.equal(runeSlug(etched.replaces), "weapon-potency-1");
    assert.equal(runesAfterEtch(sword, runeOf({ slug: "striking" })).replaces, null, "a new rune upgrades nothing");
    assert.equal(etchPriceCp({ runeCp: 93500, replacedCp: 3500 }), 90000);
    assert.equal(etchPriceCp({ runeCp: 3500 }), 3500);
    assert.equal(etchPriceCp({ runeCp: 3500, replacedCp: 3500 }), null);
    for (const slug of ["weapon-potency-3", "armor-potency-1", "striking", "striking-greater", "resilient-major", "reinforcing-rune-moderate"]) {
        assert.equal(runeSlug(runeOf({ slug })), slug);
    }
    for (const slug of ["flaming-greater", "ghost-touch", "dread-lesser", "rooting-true", "energy-resistant-greater"]) {
        assert.equal(runeSlug(runeOf({ slug, usage: "etched-onto-a-weapon" })), slug);
    }
});

test("a transfer's free source is the rune's own item, never a blank runestone (GM Core p.225)", () => {
    const striking = { uuid: "Compendium.pf2e.equipment-srd.Item.striking", slug: "striking" };
    assert.equal(isRuneItemOf({ sourceId: striking.uuid, slug: "striking", usage: "etched-onto-a-weapon" }, striking), true);
    assert.equal(isRuneItemOf({ sourceId: null, slug: "striking", usage: "etched-onto-a-weapon" }, striking), true, "a homebrew copy by slug and usage");
    assert.equal(isRuneItemOf({ sourceId: "Compendium.pf2e.equipment-srd.Item.runestone", slug: "runestone", usage: "held-in-one-hand" }, striking), false);
    assert.equal(isRuneItemOf({ sourceId: null, slug: "striking", usage: "held-in-one-hand" }, striking), false, "a striking snare is no rune");
    assert.equal(isRuneItemOf({ sourceId: null, slug: "weapon-potency-3", usage: "etched-onto-a-weapon" }, striking), false);
});

test("transfer: fundamental for fundamental, property for property; a swap brings the other back (GM Core p.225)", () => {
    const a = { type: "weapon", runes: { potency: 2, striking: 1, property: ["flaming"] } };
    const b = { type: "weapon", runes: { potency: 1, striking: 0, property: [] } };
    const striking = runeOf({ slug: "striking" });
    const moved = transferRunes({ from: a, to: b, rune: striking });
    assert.deepEqual([moved.fromRunes.striking, moved.toRunes.striking], [0, 1]);
    assert.equal(transferRunes({ from: a, to: b, rune: runeOf({ slug: "weapon-potency-2" }) }).reason, "occupied");
    const swapped = transferRunes({ from: a, to: b, rune: runeOf({ slug: "weapon-potency-2" }), swap: true });
    assert.deepEqual([swapped.fromRunes.potency, swapped.toRunes.potency], [1, 2]);
    const flaming = runeOf({ slug: "flaming", usage: "etched-onto-a-weapon" });
    const prop = transferRunes({ from: a, to: b, rune: flaming });
    assert.deepEqual([prop.fromRunes.property, prop.toRunes.property], [[], ["flaming"]]);
    assert.equal(transferRunes({ from: b, to: a, rune: flaming }).reason, "not-there");
    const propSwap = transferRunes({ from: a, to: { ...b, runes: { potency: 1, property: ["frost"] } }, rune: flaming, swap: true, swapWith: "frost" });
    assert.deepEqual([propSwap.fromRunes.property, propSwap.toRunes.property], [["frost"], ["flaming"]]);
    assert.equal(transferRunes({ from: a, to: { type: "armor", runes: {} }, rune: flaming }).reason, "wrong-item");
    assert.equal(transferCostCp({ runePriceCp: 6500 }), 650, "10% of the rune's Price");
    assert.equal(transferCostCp({ runePriceCp: 6501 }), 651, "rounded up");
    assert.equal(transferCostCp({ runePriceCp: 6500, otherPriceCp: 50000 }), 5000, "a swap takes the higher Price");
    assert.equal(transferCostCp({ runePriceCp: 6500, fromRunestone: true }), 0);
    assert.equal(priceDifferenceCp(3500, 10000), 6500);
    assert.equal(priceDifferenceCp(10000, 10000), null, "not dearer is no upgrade");
});
