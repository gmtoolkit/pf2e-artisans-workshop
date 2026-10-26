/** Roster snapshots (DESIGN.md 4.10). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { rosterSnapshot, sameRoster } from "../../scripts/logic/roster.mjs";

const extract = {
    id: "pc1", name: "Vera", img: "icons/vera.webp", level: 5, size: "med",
    skills: { religion: 1, crafting: 2, "cooking-lore": 2 },
    feats: ["magical-crafting", "alchemical-crafting", "magical-crafting"],
    formulas: ["Compendium.b", "Compendium.a"],
    abilities: [{ slug: "b", maxSlots: 2, maxItemLevel: 5, resource: null, extra: true }, { slug: "a", maxSlots: 0, maxItemLevel: 5, resource: "versatile-vials" }],
    vials: { value: 2, max: 4, extra: 1 }, investiture: { value: 1, max: 10 },
};

test("the snapshot has the 4.10 shape, sorted so the same actor always gives the same snapshot", () => {
    const snap = rosterSnapshot(extract, { by: "u1", at: { real: 99 } });
    assert.deepEqual(Object.keys(snap), ["id", "v", "name", "img", "level", "size", "crafting", "skills", "feats", "formulas", "abilities", "vials", "investiture", "consumables", "updatedAt", "by"]);
    assert.deepEqual(snap.crafting, { rank: 2 });
    assert.deepEqual(Object.keys(snap.skills), ["cooking-lore", "crafting", "religion"]);
    assert.deepEqual(snap.feats, ["alchemical-crafting", "magical-crafting"]);
    assert.deepEqual(snap.formulas, ["Compendium.a", "Compendium.b"]);
    assert.deepEqual(snap.abilities.map((a) => a.slug), ["a", "b"]);
    assert.equal("extra" in snap.abilities[1], false);
    assert.deepEqual(snap.vials, { value: 2, max: 4 });
    assert.deepEqual(snap.consumables, {});
    assert.equal(snap.updatedAt, 99);
    assert.equal(snap.id, "pc1");
    assert.equal(snap.v, 1);
});

test("an untrained crafter has rank 0; missing vials and investiture are null", () => {
    const snap = rosterSnapshot({ ...extract, skills: {}, vials: null, investiture: null }, { by: "u1", at: { real: 1 } });
    assert.deepEqual(snap.crafting, { rank: 0 });
    assert.equal(snap.vials, null);
    assert.equal(snap.investiture, null);
});

test("snapshots that differ only in when and by whom are the same", () => {
    const a = rosterSnapshot(extract, { by: "u1", at: { real: 1 } });
    const b = rosterSnapshot({ ...extract, feats: [...extract.feats].reverse() }, { by: "u2", at: { real: 2 } });
    assert.ok(sameRoster(a, b));
    assert.ok(!sameRoster(a, rosterSnapshot({ ...extract, level: 6 }, { by: "u1", at: { real: 1 } })));
    assert.ok(!sameRoster(undefined, a));
});
