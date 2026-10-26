/** The Formula Codex (DESIGN.md 4.13, 6.4, 6.8, M5): provenance, families, virtual lists, picks owed, break-even. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    allyKnows, breakEven, codexEntries, familiesOf, makeProvenance, partyFamilies, pickFits, picksOwed, picksSchedule, provenanceByUuid, withPending,
    provenanceId, provenancePath, virtualLists,
} from "../../scripts/logic/codex.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import { itemOptions } from "../../scripts/logic/registry.mjs";

const stamp = (real = 1) => ({ by: "u1", at: { world: 0, real } });
const item = (uuid, name, level, extra = {}) => {
    const facts = { uuid, name, level, rarity: "common", type: "consumable", category: "elixir", traits: ["alchemical", "consumable", "elixir"], ...extra };
    return { ...facts, options: [...itemOptions(facts)] };
};

const MINOR = item("Compendium.pf2e.equipment-srd.Item.minor00000000000", "Elixir of Life (Minor)", 1);
const LESSER = item("Compendium.pf2e.equipment-srd.Item.lesser0000000000", "Elixir of Life (Lesser)", 5);
const MODERATE = item("Compendium.pf2e.equipment-srd.Item.moderate00000000", "Elixir of Life (Moderate)", 9);
const TRUE = item("Compendium.pf2e.equipment-srd.Item.true000000000000", "Elixir of Life (True)", 19, { rarity: "rare" });
const FIRE = item("Compendium.pf2e.equipment-srd.Item.fire000000000000", "Alchemist's Fire (Lesser)", 1, { type: "weapon", category: "martial", traits: ["alchemical", "bomb", "consumable", "fire"] });
const CATALOGUE = [MINOR, LESSER, MODERATE, TRUE, FIRE];
const FACTS = new Map(CATALOGUE.map((i) => [i.uuid, i]));

test("provenance is keyed by a hash of the formula's UUID, and refuses an unknown route", () => {
    assert.equal(provenanceId(MINOR.uuid), provenanceId(MINOR.uuid));
    assert.notEqual(provenanceId(MINOR.uuid), provenanceId(LESSER.uuid));
    assert.match(provenancePath("actor1", MINOR.uuid), /^formulas\.actor1\.[a-z0-9]{16}$/);
    const record = makeProvenance({ uuid: MINOR.uuid, route: "bought", row: "r1" }, stamp());
    assert.deepEqual([record.id, record.route, record.row, record.by], [provenanceId(MINOR.uuid), "bought", "r1", "u1"]);
    assert.throws(() => makeProvenance({ uuid: MINOR.uuid, route: "stolen" }, stamp()), RangeError);
    assert.throws(() => makeProvenance({ route: "bought" }, stamp()), TypeError);
});

test("the book's entries carry their provenance; a formula with no record is unrecorded; an unknown UUID keeps its UUID", () => {
    const records = { [provenanceId(LESSER.uuid)]: makeProvenance({ uuid: LESSER.uuid, route: "invented" }, stamp()) };
    const entries = codexEntries([MINOR.uuid, LESSER.uuid, "Compendium.x.y.Item.homebrew00000000", MINOR.uuid], records, FACTS);
    assert.deepEqual(entries.map((e) => [e.name, e.route]), [
        ["Elixir of Life (Minor)", "unrecorded"], ["Elixir of Life (Lesser)", "invented"], ["Compendium.x.y.Item.homebrew00000000", "unrecorded"],
    ]);
    assert.equal(provenanceByUuid(records).get(LESSER.uuid).route, "invented");
});

test("families group the known grades and list the catalogue's grades they cover (6.4)", () => {
    const entries = codexEntries([LESSER.uuid, FIRE.uuid], {}, FACTS);
    const [fire, life] = familiesOf(entries, CATALOGUE);
    assert.equal(life.name, "Elixir of Life");
    assert.deepEqual(life.known.map((e) => e.name), ["Elixir of Life (Lesser)"]);
    assert.deepEqual(life.covered.map((e) => e.name), ["Elixir of Life (Minor)", "Elixir of Life (Moderate)"], "no higher rarity (true is rare)");
    assert.equal(fire.covered.length, 0);
    const higherOnly = familiesOf(entries, CATALOGUE, rulesWith({ familyCoversLowerGrades: false }));
    assert.deepEqual(higherOnly.find((f) => f.name === "Elixir of Life").covered.map((e) => e.name), ["Elixir of Life (Moderate)"]);
    const own = familiesOf(entries, [MINOR, { ...MODERATE, ownFormulaPerType: true }]);
    assert.deepEqual(own.find((f) => f.name === "Elixir of Life").covered.map((e) => e.name), ["Elixir of Life (Minor)"], "a type that needs its own formula");
});

test("virtual lists give the items a held feature knows without a book, at the character's level (6.8, 7.4)", () => {
    const talisman = (n, level, rarity = "common") => item(`Compendium.pf2e.equipment-srd.Item.talisman${n}0000000`, `Talisman ${n}`, level,
        { traits: ["consumable", "magical", "talisman"], rarity, category: "talisman" });
    const catalogue = [talisman(1, 1), talisman(2, 5), talisman(3, 12), talisman(4, 2, "uncommon"), MINOR];
    const [list] = virtualLists(["talisman-dabbler-dedication"], catalogue, 8);
    assert.equal(list.key, "talisman-dabbler-dedication");
    assert.deepEqual(list.items.map((i) => i.name), ["Talisman 1", "Talisman 2"], "common talismans of level 8 or lower");
    assert.deepEqual(virtualLists(["communal-crafting"], catalogue, 8), [], "no list for a feature without one");
});

test("picks owed: a feature's picks from the level it was gained, by level, less the granted formulas (6.8)", () => {
    // Formula Book: 2 at gain (level 1, up to level 1), then 2 at each later level (up to that level).
    const schedule = picksSchedule(["formula-book"], { level: 3, gainedAt: { "formula-book": 1 } });
    assert.deepEqual(schedule.map((e) => [e.level, e.count, e.maxLevel]), [[1, 2, 1], [2, 2, 2], [3, 2, 3]]);
    const late = picksSchedule(["alchemical-crafting"], { level: 6, gainedAt: { "alchemical-crafting": 4 } });
    assert.deepEqual(late.map((e) => [e.level, e.count, e.maxLevel]), [[4, 4, 1]], "a feat taken at 4 owes its picks from 4");
    assert.deepEqual(picksSchedule(["alchemical-crafting"], { level: 2, gainedAt: { "alchemical-crafting": 4 } }), [], "not gained yet");
    const granted = (uuid, pickLevel, real) => makeProvenance({ uuid, route: "granted", source: "formula-book", pickLevel }, stamp(real));
    const records = Object.fromEntries([granted(MINOR.uuid, 2, 1), granted(LESSER.uuid, null, 2), granted(FIRE.uuid, null, 3)]
        .map((r) => [r.id, r]));
    const owed = picksOwed(schedule, records);
    assert.deepEqual(owed.entries.map((e) => [e.level, e.taken, e.owed]), [[1, 2, 0], [2, 1, 1], [3, 0, 2]],
        "a pick with a level fills that level first; the others fill the earliest");
    assert.equal(owed.owed, 3);
    const bought = { x: makeProvenance({ uuid: MODERATE.uuid, route: "bought" }, stamp()) };
    assert.equal(picksOwed(schedule, bought).owed, 6, "only granted formulas count");
});

test("a pick fits by its named UUIDs, rarity, level bounds and filter", () => {
    const pick = { uuids: null, rarity: ["common"], maxLevel: 3, minLevel: null, filter: { all: ["item:trait:alchemical"] } };
    assert.equal(pickFits(pick, MINOR), true);
    assert.equal(pickFits(pick, LESSER), false, "above the pick's level");
    assert.equal(pickFits(pick, { ...MINOR, rarity: "uncommon" }), false);
    assert.equal(pickFits({ ...pick, filter: { all: ["item:trait:bomb"] } }, MINOR), false);
    assert.equal(pickFits({ ...pick, minLevel: 2 }, MINOR), false);
    assert.equal(pickFits({ uuids: [FIRE.uuid] }, FIRE), true);
    assert.equal(pickFits({ uuids: [FIRE.uuid] }, MINOR), false);
});

test("buying a formula pays for itself after the setup days it saves, at the crafter's daily rate (10.1)", () => {
    // A 4th-level formula costs 5 gp (Player Core p.294); a 5th-level expert's day is worth 1 gp at a success.
    assert.deepEqual(breakEven({ level: 4 }, { level: 5, rank: 2 }, "none"), { formulaCp: 500, daySavedCp: 100, crafts: 5, needed: false });
    assert.equal(breakEven({ level: 4 }, { level: 5, rank: 2 }, null).needed, true, "no Craft without the formula");
    assert.equal(breakEven({ level: 4 }, { level: 5, rank: 2 }, null).crafts, null);
    assert.equal(breakEven({ level: 4 }, { level: 5, rank: 0 }, "none").crafts, null, "an untrained crafter saves nothing");
});

test("the party's families come from the roster snapshots, with who knows each and at which levels", () => {
    const roster = [
        { id: "a", name: "Vera", formulas: [MINOR.uuid, LESSER.uuid] },
        { id: "b", name: "Bo", formulas: [MODERATE.uuid, FIRE.uuid, "Compendium.unknown"] },
    ];
    const families = partyFamilies(roster, FACTS);
    assert.deepEqual(families.map((f) => [f.name, f.members.map((m) => m.name), f.levels]), [
        ["Alchemist's Fire", ["Bo"], [1]], ["Elixir of Life", ["Vera", "Bo"], [1, 5, 9]],
    ]);
    assert.equal(allyKnows(roster[1], FIRE.uuid), true);
    assert.equal(allyKnows(roster[0], FIRE.uuid), false);
});

test("formulas on their way (claims not applied) count as the records they will write, once (5.5, 6.8)", () => {
    const schedule = picksSchedule(["alchemical-crafting"], { level: 1, gainedAt: { "alchemical-crafting": 1 } });
    const claim = (uuid, real) => ({ uuid, route: "granted", source: "alchemical-crafting", pickLevel: 1, at: { real } });
    assert.equal(picksOwed(schedule, withPending({}, [claim("A", 1), claim("B", 2)])).owed, 2);
    const written = makeProvenance({ uuid: "A", route: "granted", source: "alchemical-crafting", pickLevel: 1 }, { by: "u", at: { real: 1 } });
    const records = { [written.id]: written };
    assert.equal(picksOwed(schedule, withPending(records, [claim("A", 1)])).owed, 3, "a resolved claim's record is not counted twice");
});

test("Runic Crafter's picks take any weapon or armor property rune, whatever its usage narrows it to; no fundamental or shield rune", () => {
    const [pick] = picksSchedule(["runic-crafter"], { level: 4, gainedAt: { "runic-crafter": 2 } });
    const rune = (slug, usage, level) => ({ uuid: slug, level, rarity: "common", options: itemOptions({ type: "equipment", slug, usage, level, rarity: "common", traits: ["magical"] }) });
    assert.equal(pickFits(pick, rune("ghost-touch", "etched-onto-a-weapon", 4)), true);
    assert.equal(pickFits(pick, rune("returning", "etched-onto-thrown-weapon", 3)), true);
    assert.equal(pickFits(pick, rune("keen", "etched-onto-piercing-or-slashing-melee-weapon", 4)), true);
    assert.equal(pickFits(pick, rune("fortification", "etched-onto-med-heavy-armor", 4)), true);
    assert.equal(pickFits(pick, rune("shadow", "etched-onto-lm-nonmetal-armor", 4)), true);
    assert.equal(pickFits(pick, rune("striking", "etched-onto-a-weapon", 4)), false, "fundamental runes are the virtual list's");
    assert.equal(pickFits(pick, rune("reinforcing-rune-minor", "etched-onto-a-shield", 4)), false);
    assert.equal(pickFits(pick, rune("flaming", "etched-onto-a-weapon", 8)), false, "no higher than the level of the pick");
});
