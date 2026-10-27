/**
 * The affliction parser (DESIGN.md 8.10.2, 15.1) against a fixture corpus of stage paragraphs written for these tests in
 * the compendium's markup (no item's own text): dice intervals and dice onsets, "Stages 1–5" ranges, "as stage N", bare
 * condition names, persistent damage, intervals in the label, and what makes a definition partial.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { durationSeconds, flattenInlineRolls, isCandidate, parseAffliction, parseDuration } from "../../scripts/logic/affliction-parse.mjs";

const p = (label, rest) => `<p><strong>${label}</strong> ${rest}</p>`;
const cond = (name, value = null) => `@UUID[Compendium.pf2e.conditionitems.Item.${name}]${value === null ? "" : `{${name} ${value}}`}`;

/** A made-up poison in the compendium's markup. */
const TOY = [
    "<p>An intro.</p><hr />",
    p("Activate", "<span class=\"action-glyph\">A</span> (manipulate)"),
    p("Saving Throw", "@Check[fortitude|dc:21|showDC:all]"),
    p("Onset", "10 minutes"),
    p("Maximum Duration", "6 rounds"),
    p("Stage 1", `@Damage[1d6[poison]] damage and ${cond("Sickened", 1)} (1 round)`),
    p("Stage 2", `@Damage[2d6[poison]] damage, sickened 2, and ${cond("Off-Guard")} (1 round)`),
    p("Stage 3", `@Damage[(3d6+2)[persistent,acid]] damage and ${cond("Paralyzed")} (1 minute)`),
].join("\n");

test("a whole poison parses fully: save, onset, maximum duration, stages with damage, conditions and intervals", () => {
    const def = parseAffliction(TOY, { level: 4, traits: ["alchemical", "consumable", "injury", "poison"] });
    assert.equal(def.confidence, "full");
    assert.deepEqual(def.problems, []);
    assert.deepEqual(def.save, { type: "fortitude", value: 21 });
    assert.deepEqual(def.onset, { value: 10, unit: "minutes" });
    assert.deepEqual(def.duration, { value: 6, unit: "rounds", expiry: null });
    assert.equal(def.stages.length, 3);
    assert.deepEqual(def.stages[0], { damage: [{ formula: "1d6", damageType: "poison", category: null }],
        conditions: [{ slug: "sickened", value: 1, linked: true }], effects: [], duration: { value: 1, unit: "rounds" } });
    assert.deepEqual(def.stages[1].conditions.map((c) => [c.slug, c.value]).sort(), [["off-guard", null], ["sickened", 2]]);
    assert.deepEqual(def.stages[2].damage, [{ formula: "3d6+2", damageType: "acid", category: "persistent" }]);
    assert.deepEqual(def.stages[2].duration, { value: 1, unit: "minutes" });
    assert.equal(def.level, 4);
    assert.equal(def.voluntaryFail, false);
    assert.equal(def.intro.reExposure, false);
});

test("dice onsets and dice intervals in inline rolls; weeks and months as days", () => {
    assert.deepEqual(parseDuration("[[/r 1d4 #days]]{1d4 days}"), { formula: "1d4", unit: "days" });
    assert.deepEqual(parseDuration("[[/r 1d6]] minutes"), { formula: "1d6", unit: "minutes" });
    assert.deepEqual(parseDuration("1 week"), { value: 7, unit: "days" });
    assert.deepEqual(parseDuration("2d4 weeks"), { formula: "(2d4)*7", unit: "days" });
    assert.deepEqual(parseDuration("1 month"), { value: 30, unit: "days" });
    assert.equal(parseDuration("6 rounds (but longer)"), null);
    assert.equal(durationSeconds({ value: 10, unit: "minutes" }), 600);
    assert.equal(flattenInlineRolls("([[/gmr 1d4 #Duration]]{1d4 hours})"), "(1d4 hours)");
    const def = parseAffliction([
        p("Saving Throw", "@Check[fortitude|dc:30]"), p("Onset", "[[/r 1d4 #days]]{1d4 days}"),
        p("Stage 1", `${cond("Drained", 1)} (1 day)`),
        p("Stage 2", `unconscious ([[/gmr 1d4 #Duration]]{1d4 hours})`),
    ].join(""), { traits: ["disease"] });
    assert.equal(def.confidence, "full");
    assert.deepEqual(def.onset, { formula: "1d4", unit: "days" });
    assert.deepEqual(def.stages[1], { damage: [], conditions: [{ slug: "unconscious", value: null, linked: true }], effects: [], duration: { formula: "1d4", unit: "hours" } });
});

test("a Stages 1–5 range gives every stage the same effects and interval", () => {
    const def = parseAffliction([p("Saving Throw", "@Check[fortitude|dc:34|traits:secret] (secret)"), p("Maximum Duration", "5 minutes"),
        p("Stages 1–5", "@Damage[1d6[poison]] damage (1 round)")].join(""), { traits: ["poison", "virulent"] });
    assert.equal(def.confidence, "full");
    assert.equal(def.stages.length, 5);
    assert.ok(def.stages.every((s) => s.damage[0].formula === "1d6" && s.duration.value === 1));
    assert.ok(def.traits.includes("virulent"));
});

test("as stage N copies that stage's effects; its own interval wins", () => {
    const def = parseAffliction([p("Saving Throw", "@Check[fortitude|dc:16]"), p("Maximum Duration", "6 rounds"),
        p("Stage 1", `@Damage[1d6[poison]] damage and ${cond("Enfeebled", 1)} (1 round)`), p("Stage 2", "As stage 1"),
        p("Stage 3", `@Damage[1d6[poison]] damage, and ${cond("Enfeebled", 2)} (1 round)`)].join(""), { traits: ["poison"] });
    assert.equal(def.confidence, "full");
    assert.deepEqual(def.stages[1].conditions, [{ slug: "enfeebled", value: 1, linked: true }]);
    assert.deepEqual(def.stages[1].duration, { value: 1, unit: "rounds" });
});

test("bare condition names with values, plain damage words and bleed as persistent", () => {
    const def = parseAffliction([p("Saving Throw", "@Check[fortitude|dc:20]"),
        p("Stage 1", "1d6 poison damage, drained 1, and fatigued (1 minute)"),
        p("Stage 2", "@Damage[3d6[bleed]] and stupefied 2 (1 minute)"),
        p("Stage 3", "persistent 2d6 fire damage and confused (1 hour)")].join(""), { traits: ["poison"] });
    assert.equal(def.confidence, "full");
    assert.deepEqual(def.stages[0].damage, [{ formula: "1d6", damageType: "poison", category: null }]);
    assert.deepEqual(def.stages[0].conditions.map((c) => [c.slug, c.value]).sort(), [["drained", 1], ["fatigued", null]]);
    assert.deepEqual(def.stages[1].damage, [{ formula: "3d6", damageType: "bleed", category: "persistent" }]);
    assert.deepEqual(def.stages[2].damage, [{ formula: "2d6", damageType: "fire", category: "persistent" }]);
});

test("effect links are effects; an interval in the label counts", () => {
    const def = parseAffliction([p("Saving Throw", "@Check[will|dc:25]"),
        p("Stage 1 (2 Days)", "@UUID[Compendium.pf2e.equipment-effects.Item.abcdefghijklmnop]{Effect: Something}")].join(""), { traits: ["curse"] });
    assert.equal(def.confidence, "full");
    assert.deepEqual(def.stages[0].effects, [{ uuid: "Compendium.pf2e.equipment-effects.Item.abcdefghijklmnop" }]);
    assert.deepEqual(def.stages[0].duration, { value: 2, unit: "days" });
    assert.deepEqual(def.save, { type: "will", value: 25 });
});

test("what a stage cannot map makes it partial: prose, a choice, a missing interval, an unknown link", () => {
    const def = parseAffliction([p("Saving Throw", "@Check[fortitude|dc:20]"), p("Maximum Duration", "6 rounds"),
        p("Stage 1", "+1 item bonus to saves against fear (10 minutes)"),
        p("Stage 2", "2d6 cold or fire damage (1 round)"),
        p("Stage 3", `@Damage[1d6[poison]] damage and ${cond("Sickened", 1)}`),
        p("Stage 4", "@UUID[Compendium.pf2e.spells-srd.Item.Something] (1 round)")].join(""), { traits: ["poison"] });
    assert.equal(def.confidence, "partial");
    assert.deepEqual(def.problems, ["stage-1", "stage-2", "interval-3", "stage-4"]);
    assert.equal(def.stages[0].unparsed, true);
    assert.equal(def.stages[2].unparsed, true);
    assert.deepEqual(def.stages[2].conditions, [{ slug: "sickened", value: 1, linked: true }], "the mapped parts still run");
});

test("the save: against a statistic leaves the DC to the user; a check's traits count as kinds; a drug may fail on purpose", () => {
    const def = parseAffliction([p("Saving Throw", "@Check[fortitude|against:class-spell|traits:injury,poison]"),
        p("Stage 1", "@Damage[1d4[poison]] damage (1 round)")].join(""), { traits: ["drug"] });
    assert.deepEqual(def.save, { type: "fortitude", value: null, against: "class-spell" });
    assert.equal(def.confidence, "full");
    assert.ok(def.traits.includes("poison") && def.traits.includes("injury"));
    assert.equal(def.voluntaryFail, true);
    const none = parseAffliction(p("Stage 1", "no effect (1 round)"), {});
    assert.ok(none.problems.includes("save"));
});

test("an intro that changes further exposure is flagged; candidates are found by any stage, onset or maximum duration label", () => {
    const html = `<p>Further exposure needs no new save.</p>${p("Saving Throw", "@Check[fortitude|dc:18]")}${p("Stage 1", "slowed 1 (1 round)")}`;
    assert.equal(parseAffliction(html, { traits: ["poison"] }).intro.reExposure, true);
    assert.ok(isCandidate(p("Onset", "1 minute")));
    assert.ok(isCandidate(p("Stages 2–3", "x")));
    assert.ok(isCandidate(p("Maximum Duration", "1 hour")));
    assert.ok(!isCandidate("<p>Stage 1 of the plan</p>"));
    assert.equal(parseAffliction("<p>No stages.</p>").confidence, "none");
});

test("localized labels match (OQ-46)", () => {
    const html = [p("Rettungswurf", "@Check[fortitude|dc:18]"), p("Stadium 1", "@Damage[1d4[poison]] (1 round)")].join("");
    const def = parseAffliction(html, { traits: ["poison"] }, { stage: ["Stadium"], save: ["Rettungswurf"] });
    assert.equal(def.stages.length, 1);
    assert.equal(def.confidence, "full");
});

test("spells and creature abilities: the spell's own save, a named level, a blank DC, a plain-text DC, pf2e's damage options, carriers", () => {
    const spell = parseAffliction([p("Level", "3"), p("Maximum Duration", "6 rounds"),
        p("Stage 1", "@Damage[1d6[poison]|traits:poison] damage (1 round),")].join(""), { level: 2, traits: ["poison"], save: { type: "fortitude", against: "spell" } });
    assert.deepEqual(spell.save, { type: "fortitude", value: null, against: "spell" }, "a spell's save, against its caster's DC");
    assert.equal(spell.level, 3, "the affliction's own level");
    assert.equal(spell.confidence, "full", "a trailing comma after the interval, damage options after the formula");
    const ability = parseAffliction([p("Saving Throw", "@Check[fortitude|dc:]"), p("Stage 1", "carrier with no ill effect (1 day)"),
        p("Stage 2", "@Damage[2d6[void]] damage (1 day)")].join(""), { traits: ["disease"] });
    assert.deepEqual(ability.save, { type: "fortitude", value: null, against: "creature" }, "a blank DC: the creature's");
    assert.equal(ability.confidence, "full");
    assert.deepEqual(ability.stages[0].conditions, []);
    const plain = parseAffliction([p("Saving Throw", "DC 32 Fortitude"), p("Stage 1", "drained 1 (1 day)")].join(""), { traits: ["disease"] });
    assert.deepEqual(plain.save, { type: "fortitude", value: 32 });
});
