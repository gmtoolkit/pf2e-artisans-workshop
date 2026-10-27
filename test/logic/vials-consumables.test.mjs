/**
 * Vial gathering (DESIGN.md 8.7) and "Use best consumable" (8.9, 4.10) pure parts: vials over elapsed time with the
 * remainder carried, the cap, Improvise Admixture by degree, Alchemical Expertise's rate; where an item is carried, the
 * roster's consumables by family and who holds a family.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEGREE } from "../../scripts/logic/core.mjs";
import { carryOf, familySummary, holdersOf } from "../../scripts/logic/consumables.mjs";
import { vialSources } from "../../scripts/logic/morning.mjs";
import { GATHER_SECONDS, admixtureVials, gatherOver, gatherRate, regainTo, regains } from "../../scripts/logic/vials.mjs";

test("gathering: 2 vials per full 10 minutes (3 with Alchemical Expertise), the remainder carried; time going back gathers nothing (8.7)", () => {
    assert.equal(GATHER_SECONDS, 600);
    assert.equal(gatherRate([]), 2);
    assert.equal(gatherRate(["alchemical-expertise"]), 3);
    assert.deepEqual(gatherOver({ elapsed: 1500, per: 2 }), { add: 4, clock: 300 }, "25 minutes: two tens, five minutes carried");
    assert.deepEqual(gatherOver({ elapsed: 300, clock: 300, per: 2 }), { add: 2, clock: 0 }, "the carried five minutes complete a ten");
    assert.deepEqual(gatherOver({ elapsed: 599, per: 3 }), { add: 0, clock: 599 });
    assert.deepEqual(gatherOver({ elapsed: -600, clock: 120 }), { add: 0, clock: 120 });
    assert.deepEqual(gatherOver({ elapsed: 6, clock: Number.NaN }), { add: 0, clock: 6 });
});

test("the cap: never past the maximum; a second regain at the cap gains nothing (8.7)", () => {
    assert.deepEqual(regainTo({ value: 3, max: 6, add: 2 }), { to: 5, gained: 2 });
    assert.deepEqual(regainTo({ value: 5, max: 6, add: 2 }), { to: 6, gained: 1 });
    assert.deepEqual(regainTo({ value: 6, max: 6, add: 2 }), { to: 6, gained: 0 });
    assert.deepEqual(regainTo({ value: 2, max: 6, add: -1 }), { to: 2, gained: 0 });
});

test("only the class's vials and Firework Technician's regain during the day (8.7, Player Core 2 p.173)", () => {
    assert.equal(regains(vialSources(["versatile-vials"])), true);
    assert.equal(regains(vialSources(["firework-technician-dedication"])), true);
    assert.equal(regains(vialSources(["alchemist-dedication"])), false);
    assert.equal(regains(vialSources(["wandering-chef-dedication", "munitions-machinist"])), false);
});

test("Improvise Admixture: 3, 2, 1 or no vials by degree (8.7)", () => {
    assert.deepEqual([DEGREE.critSuccess, DEGREE.success, DEGREE.fail, DEGREE.critFail, null].map(admixtureVials), [3, 2, 1, 0, 0]);
});

test("where an item is carried: held, worn, else stowed; in a container is stowed (8.4, 8.9)", () => {
    assert.deepEqual([carryOf({ carryType: "held" }), carryOf({ carryType: "worn" }), carryOf({ carryType: "worn", inContainer: true }), carryOf({}), carryOf()],
        ["held", "worn", "stowed", "stowed", "stowed"]);
});

test("the roster's consumables by family: quantities summed, the soonest deadline, inert left out (4.10, 8.9); who holds a family", () => {
    const summary = familySummary([
        { family: "consumable|elixir|elixir of life", qty: 2, stamp: { at: 900 } },
        { family: "consumable|elixir|elixir of life", qty: 1, stamp: { at: 400 } },
        { family: "consumable|elixir|elixir of life", qty: 5, inert: true, stamp: { at: 100 } },
        { family: "consumable|potion|healing potion", qty: 1, stamp: null },
        { family: "weapon|bomb|alchemist's fire", qty: 0 },
    ]);
    assert.deepEqual(summary, {
        "consumable|elixir|elixir of life": { qty: 3, soonestExpiry: 400 },
        "consumable|potion|healing potion": { qty: 1, soonestExpiry: null },
    });
    assert.deepEqual(Object.keys(summary), Object.keys(summary).sort(), "sorted, so an unchanged character writes the same snapshot");
    const holders = holdersOf([{ id: "b", name: "Bo", consumables: summary }, { id: "a", name: "Al", consumables: { "consumable|elixir|elixir of life": { qty: 3 } } },
        { id: "c", name: "Cy", consumables: {} }, null], "consumable|elixir|elixir of life");
    assert.deepEqual(holders.map((h) => [h.name, h.qty, h.soonestExpiry]), [["Al", 3, null], ["Bo", 3, 400]]);
});
