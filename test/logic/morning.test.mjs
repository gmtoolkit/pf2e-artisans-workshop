/** The Morning tab's rules (DESIGN.md 4.11, 7.1-7.10): pure parts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY } from "../../scripts/data/registry.mjs";
import { familyKey } from "../../scripts/logic/families.mjs";
import {
    MAX_QTY, afterRest, captureEntries, countsByLevel, cycleState, dcStampPools, deliveriesOf, filledIn, gapEntries, makeLoadout, makeStanding,
    mergeSources, normalizeBuckets, poolView, preparationDiff, resolveEntry, resolvePools, standingDue, talismanChoices, talismanPickProblem,
    vialSources, vialState, withStanding,
} from "../../scripts/logic/morning.mjs";

/** Elixir of life grades as catalogue facts. */
const grade = (name, level, extra = {}) => ({
    uuid: `Compendium.pf2e.equipment-srd.Item.${name.replace(/\W/g, "").padEnd(16, "x").slice(0, 16)}`, name, type: "consumable", category: "elixir", level,
    rarity: "common", options: ["item:trait:alchemical", "item:trait:consumable", "item:trait:elixir", "item:trait:healing", `item:level:${level}`], ...extra,
});
const MINOR = grade("Elixir of Life (Minor)", 1);
const LESSER = grade("Elixir of Life (Lesser)", 5);
const MODERATE = grade("Elixir of Life (Moderate)", 9);
const GREATER = grade("Elixir of Life (Greater)", 13);
const FIRE = { ...grade("Alchemist's Fire (Lesser)", 1), category: "bomb", type: "weapon", options: ["item:trait:alchemical", "item:trait:bomb", "item:trait:consumable"] };
const ITEMS = [MINOR, LESSER, MODERATE, GREATER, FIRE];
const ELIXIR = familyKey(MINOR);
const alchemical = (item) => item.options.includes("item:trait:alchemical") && item.options.includes("item:trait:consumable");

test("pools from several sources merge by the highest slots, item level and batch, as pf2e does and Player Core 2 p.173 says (7.1)", () => {
    const merged = mergeSources([
        { key: "advanced-alchemy", maxSlots: 8, maxItemLevel: 9, batchSize: 2 },
        { key: "poisoner-dedication", maxSlots: 4, maxItemLevel: 9, batchSize: 1 },
        { key: "munitions-crafter", maxSlots: 9, maxItemLevel: 9, batchSize: 1 },
    ]);
    assert.deepEqual(merged, { maxSlots: 9, maxItemLevel: 9, batchSize: 2, winners: { maxSlots: "munitions-crafter", maxItemLevel: "advanced-alchemy" } });
    assert.equal(mergeSources([{ key: "a", maxSlots: null, maxItemLevel: 3 }]).maxSlots, null, "a resource-based pool has no slot count");
});

test("prepared items counted by level, and a pool's slots used and free (7.1)", () => {
    const prepared = [{ level: 5, quantity: 4, batches: 2 }, { level: 1, quantity: 2, batches: 1 }, { level: 5, quantity: 2, batches: 1, expended: true }];
    assert.deepEqual(countsByLevel(prepared), [{ level: 1, count: 2 }, { level: 5, count: 6 }]);
    const view = poolView({ maxSlots: 3, prepared });
    assert.deepEqual([view.used, view.max, view.free, view.insufficient, view.made], [4, 3, 0, true, false]);
    assert.equal(poolView({ maxSlots: null, prepared: [] }).free, null);
    assert.equal(poolView({ maxSlots: 2, prepared: [{ level: 1, quantity: 2, batches: 1, expended: true }] }).made, true);
});

test("versatile vials: the resource counts; the vial items are checked against it; material buckets follow it (7.3)", () => {
    assert.deepEqual(vialState({ value: 5, max: 7, inventory: 5, level: 4 }), { value: 5, max: 7, inventory: 5, level: 4, consistent: true, missing: 2 });
    assert.equal(vialState({ value: 5, max: 7, inventory: 6 }).consistent, false);
    assert.deepEqual(normalizeBuckets({ plain: 2, "cold-iron": 3, silver: 1 }, 4), { "cold-iron": 3, silver: 1 }, "plain vials go first");
    assert.deepEqual(normalizeBuckets({ plain: 0, silver: 2 }, 5), { silver: 2, plain: 3 }, "new vials are plain");
    assert.deepEqual(normalizeBuckets({ "cold-iron": 3, silver: 3 }, 2), { silver: 2 }, "then the buckets in key order");
});

test("the talisman picker: the virtual list's talismans up to the pool's half-level cap, best first; a pick within the slots (7.4)", () => {
    const items = [{ uuid: "a", name: "Alpha", level: 1 }, { uuid: "b", name: "Beta", level: 6 }, { uuid: "c", name: "Gamma", level: 4 }, { uuid: "d", name: "Delta", level: 4 }];
    assert.deepEqual(talismanChoices(items, { maxItemLevel: 5 }).map((i) => i.uuid), ["d", "c", "a"]);
    assert.deepEqual(talismanChoices(items, { maxItemLevel: 5, canCraft: (i) => i.uuid !== "d" }).map((i) => i.uuid), ["c", "a"]);
    assert.equal(talismanPickProblem(["a", "c"], { maxSlots: 2, offered: ["a", "c"] }), null);
    assert.deepEqual(talismanPickProblem(["a", "c", "d"], { maxSlots: 2, offered: ["a", "c", "d"] }), { ok: false, reason: "too-many", data: { max: 2 } });
    assert.deepEqual(talismanPickProblem(["b"], { maxSlots: 2, offered: ["a"] }), { ok: false, reason: "not-offered", data: { uuid: "b" } });
});

test("only Talisman Dabbler's pool gets the DC stamp (7.4: Talisman Esoterica has no such rule)", () => {
    assert.deepEqual(dcStampPools(["talisman-dabbler-dedication", "talisman-esoterica"]), [{ key: "talisman-dabbler-dedication", pool: "talisman-dabbler", dcs: ["class", "spell"] }]);
    assert.deepEqual(dcStampPools(["talisman-esoterica"]), []);
});

test("a loadout stores families and quantities, checked (4.11)", () => {
    const loadout = makeLoadout({ id: "l1", name: " Healer ", pools: { "advanced-alchemy": [{ family: ELIXIR, qty: "4" }] }, talismans: { "talisman-dabbler": ["a", "a", "b"] } });
    assert.deepEqual(loadout, { id: "l1", v: 1, name: "Healer", pools: { "advanced-alchemy": [{ family: ELIXIR, qty: 4 }] }, talismans: { "talisman-dabbler": ["a", "b"] },
        talismanHosts: {}, vialMaterials: null });
    assert.throws(() => makeLoadout({ id: "l1", name: "" }), TypeError);
    assert.throws(() => makeLoadout({ id: "l1", name: "x", pools: { a: [{ family: ELIXIR, qty: 0 }] } }), RangeError);
    assert.throws(() => makeLoadout({ id: "l1", name: "x", pools: { a: [{ family: ELIXIR, qty: MAX_QTY + 1 }] } }), RangeError);
    assert.throws(() => makeLoadout({ id: "l1", name: "x", pools: { a: [{ qty: 1 }] } }), TypeError);
});

test("capturing a preparation keeps families, adding up grades of one family", () => {
    const entries = captureEntries([
        { uuid: LESSER.uuid, quantity: 2, item: LESSER }, { uuid: MINOR.uuid, quantity: 4, item: MINOR }, { uuid: FIRE.uuid, quantity: 2, item: FIRE },
    ]);
    assert.deepEqual(entries, [{ family: ELIXIR, qty: 6, name: LESSER.name }, { family: familyKey(FIRE), qty: 2, name: FIRE.name }]);
});

test("a family resolves to the highest grade the pool allows and the character has a formula for (7.5)", () => {
    const known = new Set([MINOR.uuid]);
    const routeOf = (item) => (known.has(item.uuid) ? "known" : item.name.startsWith("Elixir of Life") ? "family" : null);
    const at = (maxItemLevel) => resolveEntry({ family: ELIXIR, qty: 2 }, { items: ITEMS, maxItemLevel, canCraft: alchemical, routeOf });
    assert.equal(at(1).item.uuid, MINOR.uuid);
    assert.equal(at(1).route, "known");
    assert.equal(at(8).item.uuid, LESSER.uuid, "level 8: the lesser grade, by family");
    assert.equal(at(8).route, "family");
    assert.equal(at(12).item.uuid, MODERATE.uuid);
    assert.equal(at(20).item.uuid, GREATER.uuid);
    assert.deepEqual(at(0), { ok: false, reason: "no-grade", data: { family: ELIXIR, name: MINOR.name, maxItemLevel: 0 } });
    const noFormula = resolveEntry({ family: ELIXIR, qty: 1 }, { items: ITEMS, maxItemLevel: 20, canCraft: alchemical, routeOf: () => null });
    assert.equal(noFormula.reason, "no-grade", "without a formula no grade resolves");
    const notThisPool = resolveEntry({ family: familyKey(FIRE), qty: 1 }, { items: ITEMS, maxItemLevel: 20, canCraft: (i) => !i.options.includes("item:trait:bomb"), routeOf });
    assert.equal(notThisPool.reason, "no-grade", "the pool's own predicate decides");
    assert.equal(resolveEntry({ family: "consumable|elixir|nothing", qty: 1 }, { items: ITEMS, maxItemLevel: 20, canCraft: alchemical, routeOf }).reason, "unknown-family");
    const pinned = resolveEntry({ family: ELIXIR, qty: 1, uuid: MINOR.uuid }, { items: ITEMS, maxItemLevel: 20, canCraft: alchemical, routeOf });
    assert.equal(pinned.item.uuid, MINOR.uuid, "a pinned grade stays as it is");
    const tie = resolveEntry({ family: ELIXIR, qty: 1 }, { items: [...ITEMS, { ...LESSER, uuid: "Compendium.pf2e.equipment-srd.Item.zzzzzzzzzzzzzzzz" }], maxItemLevel: 8, canCraft: alchemical,
        routeOf: (item) => (item.uuid === LESSER.uuid ? "family" : item.uuid.endsWith("zzzz") ? "known" : null) });
    assert.equal(tie.route, "known", "between equal grades, one in the book first");
});

test("resolving a loadout's pools: batches against slots, grades added together, standing orders kept with their lines (7.5, 7.6)", () => {
    const routeOf = (item) => (item.name.startsWith("Elixir") ? "known" : "known");
    const pools = { "advanced-alchemy": { maxSlots: 3, maxItemLevel: 9, canCraft: alchemical, batchSize: () => 2 } };
    const { pools: out, problems } = resolvePools({ "advanced-alchemy": [
        { family: ELIXIR, qty: 3 }, { family: ELIXIR, qty: 2, standing: "s1", recipient: "Actor.bo" }, { family: familyKey(FIRE), qty: 1 },
    ], cauldron: [{ family: ELIXIR, qty: 1 }] }, pools, { items: ITEMS, routeOf });
    const lines = out["advanced-alchemy"].lines;
    assert.deepEqual(lines.map((l) => [l.item.name, l.qty, l.batches]), [["Elixir of Life (Moderate)", 5, 3], ["Alchemist's Fire (Lesser)", 1, 1]]);
    assert.deepEqual(lines[0].standing, [{ id: "s1", qty: 2, recipient: "Actor.bo" }]);
    assert.equal(out["advanced-alchemy"].batches, 4);
    assert.equal(out["advanced-alchemy"].over, true);
    assert.deepEqual(problems.find((p) => p.reason === "slots"), { pool: "advanced-alchemy", reason: "slots", used: 4, max: 3 });
    assert.deepEqual(problems.find((p) => p.reason === "no-pool"), { pool: "cauldron", reason: "no-pool" }, "a pool the character lacks today is reported");
});

test("the diff against the last preparation names new formulas, new grades, changed quantities and dropped families (7.5)", () => {
    const previous = { "advanced-alchemy": [{ uuid: MINOR.uuid, quantity: 4, item: MINOR }, { uuid: FIRE.uuid, quantity: 2, item: FIRE }] };
    const next = { "advanced-alchemy": { lines: [{ uuid: LESSER.uuid, item: LESSER, family: ELIXIR, qty: 4, standing: [] }],
        batches: 2, max: 4, over: false }, cauldron: { lines: [{ uuid: MINOR.uuid, item: MINOR, family: ELIXIR, qty: 1, standing: [{ id: "s" }] }] } };
    assert.deepEqual(preparationDiff(previous, next).map((d) => [d.pool, d.kind, d.name, d.request]), [
        ["advanced-alchemy", "grade", LESSER.name, false], ["advanced-alchemy", "removed", FIRE.name, false], ["cauldron", "new", MINOR.name, true],
    ]);
});

test("standing orders: due by crafter and day, added once per cycle, delivered from the run's outputs (4.11, 7.6)", () => {
    const stamp = { by: "u1", at: { world: 0 } };
    const s1 = makeStanding({ id: "s1", requester: "Actor.bo", crafter: "Actor.al", recipient: "Actor.bo", pool: "advanced-alchemy", family: ELIXIR,
        uuid: MINOR.uuid, name: MINOR.name, qty: 2, fromDay: 3, untilDay: 5 }, stamp);
    const s2 = { ...s1, id: "s2", fromDay: 1, untilDay: null, recipient: "Actor.cy" };
    const s3 = { ...s1, id: "s3", crafter: "Actor.other" };
    const s4 = { ...s1, id: "s4", active: false };
    assert.deepEqual(standingDue([s1, s2, s3, s4], { crafter: "Actor.al", day: 4 }).map((s) => s.id), ["s2", "s1"]);
    assert.deepEqual(standingDue([s1, s2], { crafter: "Actor.al", day: 6 }).map((s) => s.id), ["s2"], "s1 ended on day 5");
    assert.throws(() => makeStanding({ ...s1, qty: 0 }, stamp), RangeError);
    assert.throws(() => makeStanding({ ...s1, untilDay: 2 }, stamp), RangeError);
    assert.throws(() => makeStanding({ ...s1, recipient: "" }, stamp), TypeError);
    const entries = withStanding({ "advanced-alchemy": [{ family: ELIXIR, qty: 4 }] }, [s1, { ...s2, last: { cycle: 7 } }], 7);
    assert.deepEqual(entries["advanced-alchemy"].map((e) => [e.qty, e.standing ?? null]), [[4, null], [2, "s1"]], "s2 was filled this cycle already");
    assert.equal(filledIn({ last: { cycle: 7 } }, 7), true);
    const outputs = [{ id: "i1", uuid: MINOR.uuid, quantity: 3 }, { id: "i2", uuid: MINOR.uuid, quantity: 2 }];
    const { deliveries, short } = deliveriesOf(outputs, [{ uuid: MINOR.uuid, standing: [{ id: "s1", qty: 2, recipient: "Actor.bo" }, { id: "s2", qty: 4, recipient: "Actor.cy" }] }]);
    assert.deepEqual(deliveries, [
        { standing: "s1", recipient: "Actor.bo", item: "i1", qty: 2 },
        { standing: "s2", recipient: "Actor.cy", item: "i1", qty: 1 },
        { standing: "s2", recipient: "Actor.cy", item: "i2", qty: 2 },
    ]);
    assert.deepEqual(short, [{ standing: "s2", missing: 1 }], "never more than the outputs hold");
});

test("gap entries: a note to tick, Food Preservation's designation, and pf2e-dailies' own features (7.9, 7.10)", () => {
    const held = ["alter-admixture", "food-preservation", "scroll-adept"];
    assert.deepEqual(gapEntries(held), [
        { key: "alter-admixture", flow: "note", handledBy: null, automated: true },
        { key: "food-preservation", flow: "designate", handledBy: null, automated: true },
        { key: "scroll-adept", flow: "dailies", handledBy: null, automated: false },
    ]);
    assert.equal(gapEntries(["scroll-adept"], { dailies: true })[0].handledBy, "pf2e-dailies");
    for (const key of ["alter-admixture", "natural-mutagen", "herbal-forager", "chrysanthemum-leshy", "imperial-dragon-potion", "practical-magic",
        "contingency-gadgets", "witchs-bottle", "poisoned-sticks-and-stones", "prepare-elemental-medicine", "repurposed-parts"]) {
        assert.ok(REGISTRY[key].effects.some((e) => e.kind === "dailyGap"), `${key} is a 7.10 gap entry`);
    }
});

test("vial sources and whether they regain during the day (7.3, 8.7: the class and Firework Technician only)", () => {
    assert.deepEqual(vialSources(["versatile-vials", "alchemist-dedication", "firework-technician-dedication", "munitions-machinist"]), [
        { key: "versatile-vials", regain: true }, { key: "alchemist-dedication", regain: false },
        { key: "firework-technician-dedication", regain: true }, { key: "munitions-machinist", regain: false },
    ]);
});

test("a rest begins a new cycle and prompts; in downtime without a standing routine it only prompts (7.2, 7.8)", () => {
    assert.deepEqual(afterRest({}), { cycle: true, prompt: true });
    assert.deepEqual(afterRest({ inDowntime: true }), { cycle: false, prompt: true });
    assert.deepEqual(afterRest({ inDowntime: true, standingRoutine: true }), { cycle: true, prompt: true });
});

test("where a character stands in its cycle: ready to prepare, prepared, or prepared from the sheet (7.7, 7.8)", () => {
    assert.equal(cycleState({ prepCycle: 0 }), "fresh");
    assert.equal(cycleState({ prepCycle: 2, morningCycle: 2 }), "prepared");
    assert.equal(cycleState({ prepCycle: 3, morningCycle: 2 }), "fresh");
    assert.equal(cycleState({ prepCycle: 3, morningCycle: 2, dailyCraftingComplete: true }), "sheet");
});
