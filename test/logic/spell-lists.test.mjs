/**
 * The spells an item's Craft needs, read from its description (DESIGN.md 6.9, M9), and the casting pledges that supply them:
 * staves and codas by their lists, spellhearts by what they cast, specialty wands by their rank, other items by their Craft
 * Requirements.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { castingsNeeded, entryFor, makePledge, openEntries, pledgeProblem, spellGate, spellSupply } from "../../scripts/logic/pledges.mjs";
import {
    craftRequirementsOf, entryMatches, parseCastSpells, parseRequirementSpells, parseSpellList, rankWord, spellEntry, spellNeedsOf, wandRankOf,
} from "../../scripts/logic/spell-lists.mjs";

const S = (id) => `Compendium.pf2e.spells-srd.Item.${id}`;
const IGNITION = S("ignition00000000");
const BREATHE = S("breathefire00000");
const FIREBALL = S("fireball00000000");
const TAME = S("tame000000000000");
const SUMMON = S("summonanimal0000");
const SUNBURST = S("sunburst00000000");

/** pf2e's staff description, as the built compendium has it (ids in the links, a label on one). */
const STAFF = `<p>A staff.</p><p><strong>Activate</strong> Cast a Spell</p><hr /><ul>
<li><strong>Cantrip</strong> @UUID[${IGNITION}]</li>
<li><strong>1st</strong> @UUID[${BREATHE}]{Breathe Fire}</li>
<li><strong>2nd</strong> @UUID[${BREATHE}], @UUID[Compendium.pf2e.equipment-srd.Item.notaspell0000000]</li>
<li><strong>3rd</strong> @UUID[${FIREBALL}]</li></ul><hr />
<p><strong>Craft Requirements</strong> Supply one casting of all listed ranks of all listed spells.</p>`;
const SPELLHEART = `<p>The spell DC is 23.</p><hr /><p><strong>Activate</strong> Cast a Spell</p><p><strong>Effect</strong> You cast @UUID[${TAME}].</p>
<hr /><p><strong>Activate</strong> Cast a Spell</p><p><strong>Effect</strong> You cast 3rd-rank @UUID[${SUMMON}] to summon a beast.</p>`;

test("ranks are read as pf2e writes them; a cantrip is rank 0", () => {
    assert.deepEqual(["Cantrip", "Cantrips", "1st", "2nd", "3rd", "10th", "Focus"].map(rankWord), [0, 0, 1, 2, 3, 10, null]);
    assert.deepEqual(spellEntry(IGNITION, 0), { key: `${IGNITION}@c`, uuid: IGNITION, rank: 0, cantrip: true });
    assert.deepEqual(spellEntry(TAME, null), { key: `${TAME}@base`, uuid: TAME, rank: null, cantrip: false });
});

test("a staff needs one casting of every listed rank of every listed spell, cantrips included; links to other packs are not spells", () => {
    const entries = parseSpellList(STAFF);
    assert.deepEqual(entries.map((e) => [e.uuid, e.rank]), [[IGNITION, 0], [BREATHE, 1], [BREATHE, 2], [FIREBALL, 3]]);
    assert.deepEqual(spellNeedsOf({ html: STAFF, traits: ["magical", "staff"], name: "Staff of Fire" }), { kind: "staff", rank: null, entries, any: 0 });
    assert.equal(craftRequirementsOf(STAFF).trim(), "Supply one casting of all listed ranks of all listed spells.");
    assert.deepEqual(spellNeedsOf({ html: "<p>No list.</p>", traits: ["staff"] }), null);
});

test("a spellheart needs the spells it casts, at the rank written or the spell's own (Secrets of Magic p.170)", () => {
    const entries = parseCastSpells(SPELLHEART);
    assert.deepEqual(entries.map((e) => [e.uuid, e.rank]), [[TAME, null], [SUMMON, 3]]);
    assert.deepEqual(spellNeedsOf({ html: SPELLHEART, traits: ["magical", "spellheart"] }).entries, entries);
    assert.equal(spellNeedsOf({ html: "<p>No spells.</p>", traits: ["spellheart"] }), null);
});

test("other items: the spells their Craft Requirements link, at a written rank; an unlinked casting asks for any spell", () => {
    const linked = `<p>Armor.</p><p><strong>Craft Requirements</strong> Supply one casting of @UUID[${SUNBURST}] and @UUID[${FIREBALL}]{fireball} (4th rank).</p>`;
    assert.deepEqual(parseRequirementSpells(craftRequirementsOf(linked)).entries.map((e) => [e.uuid, e.rank]), [[SUNBURST, null], [FIREBALL, 4]]);
    assert.deepEqual(spellNeedsOf({ html: linked, traits: ["magical"] }).kind, "named");
    const unlinked = "<p><strong>Craft Requirements</strong> Supply one casting of dispel magic.</p>";
    assert.deepEqual(spellNeedsOf({ html: unlinked, traits: ["magical"] }), { kind: "named", rank: null, entries: [], any: 1 });
    const capable = "<p><strong>Craft Requirements</strong> You have a spellcasting class feature with the divine tradition.</p>";
    assert.equal(spellNeedsOf({ html: capable, traits: ["magical"] }), null, "spellcasting is not a casting supplied");
    assert.equal(spellNeedsOf({ html: "<p>Plain.</p>", traits: [] }), null);
});

test("a specialty wand takes one casting of a spell of its rank; pf2e's base scrolls and wands are spellSupply's own", () => {
    assert.deepEqual([wandRankOf("Wand of Continuation (1st-Rank Spell)"), wandRankOf("Arboreal Wand (Rank 2)"), wandRankOf("Wand of Smoke")], [1, 2, null]);
    const html = "<p><strong>Craft Requirements</strong> Supply a casting of a spell of the appropriate rank.</p>";
    assert.deepEqual(spellNeedsOf({ html, traits: ["magical", "wand"], name: "Wand of Continuation (3rd-Rank Spell)" }),
        { kind: "wand-special", rank: 3, entries: [], any: 1 });
    assert.equal(spellNeedsOf({ html, traits: ["magical", "wand"], name: "Magic Wand (1st-Rank Spell)", spellcasting: { kind: "wand", rank: 1 } }), null);
});

test("a caster's spell is a listed one by its compendium source, or by name where the link still names it", () => {
    const entry = spellEntry(BREATHE, 1);
    assert.equal(entryMatches(entry, { uuid: "Actor.a.Item.x", source: BREATHE, name: "Breathe Fire" }), true);
    assert.equal(entryMatches(entry, { uuid: "Actor.a.Item.x", source: FIREBALL, name: "Breathe Fire" }), false, "an id link is matched by source only");
    assert.equal(entryMatches(spellEntry("Compendium.pf2e.spells-srd.Item.Breathe Fire", 1), { source: null, name: "breathe fire" }), true);
});

/* -------------------------------------------- */
/*  Pledges for listed castings                  */
/* -------------------------------------------- */

const staff = () => spellSupply({ traits: ["magical", "staff"], spellNeeds: spellNeedsOf({ html: STAFF, traits: ["magical", "staff"] }) });
const caster = (source, rank, extra = {}) => ({ uuid: `Actor.w.Item.${rank}`, source, name: "x", rank, traits: [], category: "spell", ...extra });
const stamp = (real) => ({ by: "u1", at: { world: 0, real } });

test("a staff's pledges name the listed casting they supply: one each, the spell on the list, at no lower base rank", () => {
    const supply = staff();
    assert.equal(castingsNeeded(supply, 1), 4);
    assert.equal(pledgeProblem({ supply, spell: caster(BREATHE, 1), castings: 1 }), null);
    assert.equal(entryFor(supply, caster(BREATHE, 1)).key, `${BREATHE}@1`, "the first open entry the spell matches");
    assert.equal(pledgeProblem({ supply, spell: caster(BREATHE, 1), castings: 1, entry: `${BREATHE}@2` }), null);
    assert.equal(pledgeProblem({ supply, spell: caster(BREATHE, 1), castings: 2 }).reason, "one-casting");
    assert.equal(pledgeProblem({ supply, spell: caster(SUNBURST, 1), castings: 1 }).reason, "not-on-list");
    assert.equal(pledgeProblem({ supply, spell: caster(FIREBALL, 4), castings: 1 }).reason, "spell-rank", "a 4th-rank spell is not a 3rd-rank casting");
    assert.equal(pledgeProblem({ supply, spell: caster(IGNITION, 1, { category: "cantrip", traits: ["cantrip"] }), castings: 1 }), null,
        "a staff's cantrip is supplied by casting it");
    assert.equal(pledgeProblem({ supply, spell: caster(BREATHE, 1), castings: 1, entry: `${IGNITION}@c` }).reason, "not-on-list");
    assert.equal(pledgeProblem({ supply, spell: caster(BREATHE, 1, { category: "focus" }), castings: 1 }).reason, "unscribable");
    const taken = [makePledge({ id: "p1", caster: "A", spell: caster(BREATHE, 1), rank: 1, castings: 1, entry: `${BREATHE}@1` }, stamp(1))];
    assert.equal(entryFor(supply, caster(BREATHE, 1), taken).key, `${BREATHE}@2`, "the next open one");
    assert.equal(pledgeProblem({ supply, spell: caster(BREATHE, 1), castings: 1, existing: taken, entry: `${BREATHE}@1` }).reason, "covered");
    const both = [...taken, makePledge({ id: "p2", caster: "A", spell: caster(BREATHE, 1), rank: 2, castings: 1, entry: `${BREATHE}@2` }, stamp(2))];
    assert.equal(pledgeProblem({ supply, spell: caster(BREATHE, 1), castings: 1, existing: both }).reason, "covered");
});

test("G9 for a listed item: every entry needs a fulfilled pledge naming it", () => {
    const supply = staff();
    const pledges = {};
    for (const [i, entry] of supply.entries.entries()) {
        pledges[`p${i}`] = { ...makePledge({ id: `p${i}`, caster: "A", spell: { uuid: entry.uuid }, rank: entry.rank, castings: 1, entry: entry.key }, stamp(i)),
            status: i < 3 ? "fulfilled" : "offered" };
    }
    const order = { quantity: 1, pledges };
    const gate = spellGate(order, supply);
    assert.deepEqual([gate.spellsNeeded, gate.spellsSupplied, gate.needed, gate.fulfilled, gate.open.length], [true, false, 4, 3, 0]);
    pledges.p3.status = "fulfilled";
    assert.equal(spellGate(order, supply).spellsSupplied, true);
    pledges.p3.status = "withdrawn";
    assert.deepEqual(openEntries(order, supply).map((e) => e.key), [`${FIREBALL}@3`], "a withdrawn pledge opens its entry again");
});

test("castings asked for without a link take any spell, up to that count; a specialty wand is a wand", () => {
    const named = spellSupply({ traits: ["magical"], spellNeeds: { kind: "named", rank: null, entries: [], any: 1 } });
    assert.equal(pledgeProblem({ supply: named, spell: caster(SUNBURST, 7), castings: 1 }), null);
    assert.equal(pledgeProblem({ supply: named, spell: caster(SUNBURST, 7), castings: 2 }).reason, "any-castings");
    const wand = spellSupply({ traits: ["magical", "wand"], spellNeeds: { kind: "wand-special", rank: 2, entries: [], any: 1 } });
    assert.equal(castingsNeeded(wand, 1), 1);
    assert.equal(pledgeProblem({ supply: wand, spell: caster(BREATHE, 1), castings: 1 }), null, "heightened to the wand's rank");
    assert.equal(pledgeProblem({ supply: wand, spell: caster(FIREBALL, 3), castings: 1 }).reason, "spell-rank");
    assert.equal(pledgeProblem({ supply: wand, spell: caster(BREATHE, 1), castings: 1, existing: [{ castings: 1, spell: { uuid: "x" } }] }).reason, "one-casting");
    assert.equal(pledgeProblem({ supply: wand, spell: null, castings: 1 }).reason, "no-spell");
    const fulfilled = { quantity: 1, pledges: { p: { ...makePledge({ id: "p", caster: "A", spell: { uuid: "x" }, rank: 2, castings: 1 }, stamp(1)), status: "fulfilled" } } };
    assert.equal(spellGate(fulfilled, wand).spellsSupplied, true);
});
