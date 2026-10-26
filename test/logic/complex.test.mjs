/** Complex Crafting setup (DESIGN.md 6.16.1 Tests): bands, columns, the formula, rush caps, floors, Quick Setup. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { complexSetup, isComplexCraftSetup } from "../../scripts/logic/complex.mjs";
import { RANK } from "../../scripts/logic/core.mjs";

const { trained, expert, master, legendary } = RANK;
const setup = (fields) => complexSetup({ itemLevel: 5, crafterLevel: 5, consumable: false, route: "none", rank: trained, ...fields });

test("every band for both columns, without and with the formula", () => {
    const cases = [
        // [crafter level above item, consumable, days without, days with formula]
        [0, true, 2, 1], [1, true, 1, 1], [2, true, 1, 1], [3, true, 1, 1], [9, true, 1, 1],
        [0, false, 4, 3], [1, false, 3, 2], [2, false, 3, 2], [3, false, 2, 1], [9, false, 2, 1],
    ];
    for (const [delta, consumable, without, withFormula] of cases) {
        const crafterLevel = 5 + delta;
        assert.equal(setup({ crafterLevel, consumable }).days, without, `delta ${delta} consumable ${consumable}`);
        for (const route of ["known", "family", "virtual"]) {
            assert.equal(setup({ crafterLevel, consumable, route }).days, withFormula, `delta ${delta} ${route}`);
        }
    }
    assert.deepEqual([0, 1, 2, 3].map((delta) => setup({ crafterLevel: 5 + delta }).band), [0, 1, 1, 2]);
});

test("rush is capped by rank: none trained, 1 expert, 2 master, 3 legendary", () => {
    const capped = (rank) => setup({ rank, rushDays: 3 }).rush;      // 4-day permanent item
    assert.deepEqual([trained, expert, master, legendary].map(capped), [0, 1, 2, 3]);
    assert.deepEqual(setup({ rank: legendary, rushDays: 3 }), { days: 1, hours: 0, rush: 3, band: 0, quick: false });
    assert.equal(setup({ rank: master, rushDays: -1 }).rush, 0);
});

test("rush is capped by the days left: a permanent item never goes below 1 day", () => {
    assert.deepEqual(setup({ crafterLevel: 8, rank: legendary, rushDays: 3 }), { days: 1, hours: 0, rush: 1, band: 2, quick: false });
});

test("a consumable rushed to 0 days takes 4 hours", () => {
    assert.deepEqual(setup({ consumable: true, rank: master, rushDays: 2 }), { days: 0, hours: 4, rush: 2, band: 0, quick: false });
    assert.deepEqual(setup({ consumable: true, rank: legendary, rushDays: 3 }), { days: 0, hours: 4, rush: 2, band: 0, quick: false });
});

test("Quick Setup: at least 6 levels below and rushed below a day, 2 hours for a consumable and 4 for a permanent item", () => {
    const quick = { crafterLevel: 11, quickSetup: true };      // 6 below
    assert.deepEqual(setup({ ...quick, consumable: true, rank: master, rushDays: 1 }), { days: 0, hours: 2, rush: 1, band: 2, quick: true });
    assert.deepEqual(setup({ ...quick, rank: master, rushDays: 2 }), { days: 0, hours: 4, rush: 2, band: 2, quick: true });
    // 5 below: no Quick Setup, so the permanent item stops at 1 day.
    assert.deepEqual(setup({ crafterLevel: 10, quickSetup: true, rank: master, rushDays: 2 }), { days: 1, hours: 0, rush: 1, band: 2, quick: false });
    assert.deepEqual(setup({ crafterLevel: 10, quickSetup: true, consumable: true, rank: master, rushDays: 1 }), { days: 0, hours: 4, rush: 1, band: 2, quick: false });
    // Not rushed below a day: Quick Setup changes nothing.
    assert.deepEqual(setup({ ...quick, rank: master, rushDays: 1 }), { days: 1, hours: 0, rush: 1, band: 2, quick: false });
});

test("Table 5-1 replaces only the setup of an item Craft", () => {
    for (const type of ["item", "upgrade", "rune-etch", "tattoo", "graft", "spell-item"]) assert.equal(isComplexCraftSetup(type), true, type);
    for (const type of ["rune-transfer", "grow", "deconstruct", "quest"]) assert.equal(isComplexCraftSetup(type), false, type);
    assert.equal(isComplexCraftSetup("item", "formula"), false);
});
