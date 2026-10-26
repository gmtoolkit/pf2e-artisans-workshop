/** Batch limits (DESIGN.md 4.4, 6.3). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { batchMax, isConsumableForBatch, splitIntoBatches } from "../../scripts/logic/batches.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { batchMultiplier, itemOptions } from "../../scripts/logic/registry.mjs";

const elixir = { traits: ["alchemical", "consumable", "elixir", "healing"], type: "consumable" };
const potion = { traits: ["consumable", "magical", "potion"], type: "consumable" };

test("consumables batch in fours; permanent items one at a time", () => {
    assert.equal(batchMax(potion), 4);
    assert.equal(batchMax(elixir), 4);
    assert.equal(batchMax({ traits: ["magical", "invested"], type: "equipment" }), 1);
    assert.equal(batchMax({ traits: ["consumable"], per: 10 }), 10);       // larger `per` wins, as in pf2e
});

test("mundane ammunition batches by its `per`; magic ammunition as a consumable", () => {
    assert.equal(batchMax({ traits: [], type: "ammo", per: 10 }), 10);
    assert.equal(batchMax({ traits: ["consumable"], type: "ammo", per: 10 }), 10);
    assert.equal(batchMax({ traits: ["consumable", "magical"], type: "ammo", per: 1 }), 4);
});

test("Efficient Alchemy doubles a batch of alchemical consumables only, through the registry's multiplier", () => {
    const held = ["efficient-alchemy-alchemist"];
    const multiplier = (item) => batchMultiplier(held, itemOptions(item));
    assert.equal(batchMax(elixir, { multiplier: multiplier(elixir) }), 8);
    assert.equal(batchMax(potion, { multiplier: multiplier(potion) }), 4);
    const tool = { traits: ["alchemical"], type: "equipment" };
    assert.equal(batchMax(tool, { multiplier: multiplier(tool) }), 1);
    assert.equal(batchMultiplier([], itemOptions(elixir)), 1);
    assert.throws(() => batchMax(elixir, { multiplier: 1.5 }), TypeError);
});

test("the talismans that lack the consumable trait batch in fours through the registry fix", () => {
    const talisman = { traits: ["magical", "talisman"], type: "consumable" };
    assert.equal(isConsumableForBatch(talisman), false);
    assert.equal(batchMax(talisman), 1);
    assert.equal(batchMax({ ...talisman, consumableFix: true }), 4);
});

test("scrolls: one casting each, up to 4; wands one; snares by setting", () => {
    const scroll = { traits: ["consumable", "magical", "scroll"], spellcasting: "scroll" };
    assert.equal(batchMax(scroll), 0);
    assert.equal(batchMax(scroll, { pledgedCastings: 3 }), 3);
    assert.equal(batchMax(scroll, { pledgedCastings: 6 }), 4);
    assert.equal(batchMax({ traits: ["magical", "wand"], spellcasting: "wand" }), 1);
    const snare = { traits: ["consumable", "mechanical", "snare", "trap"] };
    assert.equal(batchMax(snare), 4);
    assert.equal(batchMax(snare, {}, rulesWith({ snareDowntimeBatch: 2 })), 2);
});

test("a request larger than a batch splits into sequential orders", () => {
    assert.deepEqual(splitIntoBatches(10, 4), [4, 4, 2]);
    assert.deepEqual(splitIntoBatches(8, 8), [8]);
    assert.deepEqual(splitIntoBatches(3, 4), [3]);
    assert.deepEqual(splitIntoBatches(0, 4), []);
    assert.deepEqual(splitIntoBatches(5, 0), []);
});
