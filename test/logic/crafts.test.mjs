/**
 * Tattoos, grafts and the remaining crafts (DESIGN.md 6.14, 7.1, M9): subjects, locks and one at a time, investiture,
 * healing, Legendary Tattoo Artist's mark, fulus, missives and the quick-deploy snare ledger. Pure parts, with the gates,
 * day planner, routes, expiry, batches and registry lookups M9 changed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY } from "../../scripts/data/registry.mjs";
import { batchMax } from "../../scripts/logic/batches.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";
import {
    FULU_DAYS, busyWith, composePlan, consentProblem, entryKeys, fuluStamp, fuluTradition, fuluTraits, healedUntil, investitureCheck, markFor,
    quickDeployLedger, raiseActivated, raiseResistances, settleSubject, subjectCustody, subjectLockOf, subjectProcess, subjectRecord, subjectTypeOf,
} from "../../scripts/logic/crafts.mjs";
import { lockOf, planDays } from "../../scripts/logic/downtime.mjs";
import { expiryReason } from "../../scripts/logic/expiry.mjs";
import { acquisitionRoutes } from "../../scripts/logic/formula-jobs.mjs";
import { craftGates, gateAvailable, gateRoute, reverseEngineerGates } from "../../scripts/logic/gates.mjs";
import { makeOrder } from "../../scripts/logic/orders.mjs";
import { accessGrant, craftOptions, crafterMarks, heldKeys, investitureExemptions, itemOptions, quickDeployMarks } from "../../scripts/logic/registry.mjs";
import { requirementVariant } from "../../scripts/logic/views.mjs";

const stamp = { by: "u1", at: { world: 0, real: 1 } };
const TATTOO = { traits: ["invested", "magical", "tattoo"], level: 4 };

/** A tattoo order for subject B, crafted by A. */
const order = (over = {}) => ({ id: "o1", craftType: "tattoo", crafter: "Actor.A", target: "Actor.B", status: "accepted", subject: null, variant: {}, ...over });
const consented = (presence = true) => ({ actor: "Actor.B", consented: true, presence, process: "secrets-of-magic" });

/* -------------------------------------------- */
/*  Subjects                                     */
/* -------------------------------------------- */

test("a tattoo or graft is told by its trait; the process sets presence, one at a time, healing and investiture (6.14)", () => {
    assert.equal(subjectTypeOf(TATTOO), "tattoo");
    assert.equal(subjectTypeOf({ traits: ["graft", "invested", "magical"] }), "graft");
    assert.equal(subjectTypeOf({ traits: ["magical"] }), null);
    const som = subjectProcess("tattoo");
    assert.deepEqual(som, { process: "secrets-of-magic", presence: true, oneAtATime: true, healingDays: 30, fails: "decorative", invested: false });
    assert.deepEqual(subjectProcess("tattoo", rulesWith({ tattooProcess: "simple" })),
        { process: "simple", presence: false, oneAtATime: false, healingDays: 0, fails: null, invested: true }, "the toggle: consent only, invested at once");
    assert.equal(subjectProcess("tattoo", rulesWith({ tattooProcess: "simple" }), "secrets-of-magic").process, "secrets-of-magic", "the process frozen at start wins");
    assert.equal(subjectProcess("tattoo", rulesWith({ tattooSubjectLocked: false })).presence, false);
    assert.equal(subjectProcess("tattoo", rulesWith({ tattooHealingDays: 7 })).healingDays, 7);
    assert.deepEqual(subjectProcess("graft"), { process: "graft", presence: true, oneAtATime: true, healingDays: 0, fails: "inactive", invested: false });
    assert.equal(subjectProcess("item"), null);
});

test("a subject is locked from its consent until the order closes, never to its own Craft (6.14)", () => {
    assert.equal(subjectLockOf([order({ subject: consented() })], "Actor.B"), "o1");
    assert.equal(subjectLockOf([order({ subject: consented(), status: "setup" })], "Actor.B"), "o1");
    assert.equal(subjectLockOf([order({ subject: consented(), status: "complete" })], "Actor.B"), null);
    assert.equal(subjectLockOf([order({ subject: consented(false) })], "Actor.B"), null, "the simple toggle does not lock");
    assert.equal(subjectLockOf([order({ subject: { ...consented(), consented: false } })], "Actor.B"), null, "withdrawn");
    assert.equal(subjectLockOf([order({ subject: consented(), crafter: "Actor.B" })], "Actor.B"), null, "a tattooist on themself is crafting");
    assert.equal(subjectLockOf([order({ subject: consented() })], "Actor.C"), null);
    // The day planner's locks: a helper's or a subject's.
    const helping = { id: "o2", status: "setup", helpers: { b: { leftDay: null } } };
    assert.equal(lockOf([helping, order({ subject: consented() })], "b", "Actor.B"), "o2");
    assert.equal(lockOf([order({ subject: consented() })], "b", "Actor.B"), "o1");
});

test("one tattoo or graft at a time per crafter, not per subject (6.14; Secrets of Magic p.164, Howl of the Wild p.97)", () => {
    const working = order({ id: "o2", status: "setup", target: "Actor.C" });
    assert.equal(busyWith([working], order()), "o2");
    assert.equal(busyWith([{ ...working, status: "complete" }], order()), null, "a finished tattoo frees the tattooist");
    assert.equal(busyWith([{ ...working, craftType: "graft" }], order()), null, "a graft is another kind");
    assert.equal(busyWith([{ ...working, crafter: "Actor.Z" }], order()), null, "another tattooist");
    assert.equal(busyWith([order({ status: "setup" })], order()), null, "not the order itself");
    assert.deepEqual(gateAvailable({ lockedBy: null }, "o1", "o2"), { id: "G11", ok: false, reason: "one-at-a-time", data: { order: "o2" }, unlock: "finish" });
    assert.equal(gateAvailable({ lockedBy: null }, "o1", null).ok, true);
    assert.equal(gateAvailable({ lockedBy: "o3" }, "o1", "o2").reason, "locked", "a lock is told first");
});

test("G10 for a subject: consent, and presence where the process needs it; the crafter on themself needs neither", () => {
    const som = subjectProcess("tattoo");
    const sitting = { inDowntime: true, activity: { kind: "subject", ref: "o1" } };
    assert.deepEqual(subjectCustody(order(), som, null), { subjectConsented: false, subjectLocked: false });
    assert.deepEqual(subjectCustody(order({ subject: consented() }), som, null), { subjectConsented: true, subjectLocked: false }, "not in downtime");
    assert.deepEqual(subjectCustody(order({ subject: consented() }), som, sitting), { subjectConsented: true, subjectLocked: true });
    assert.deepEqual(subjectCustody(order({ subject: consented() }), som, { inDowntime: true, activity: { kind: "earn", ref: "j" } }).subjectLocked, false);
    assert.deepEqual(subjectCustody(order({ subject: consented(false) }), som, sitting).subjectLocked, false, "consented under the toggle, then the process changed");
    assert.deepEqual(subjectCustody(order({ subject: consented(false) }), subjectProcess("tattoo", rulesWith({ tattooProcess: "simple" }))),
        { subjectConsented: true, subjectLocked: true }, "the toggle: consent only");
    assert.deepEqual(subjectCustody(order({ crafter: "Actor.B" }), som), { subjectConsented: true, subjectLocked: true });
    assert.equal(consentProblem(order(), "Actor.B"), null);
    assert.equal(consentProblem(order(), "Actor.C").reason, "not-subject");
    assert.equal(consentProblem(order({ status: "setup" }), "Actor.B").reason, "state", "consent is given before the Craft starts");
    assert.equal(consentProblem(order({ status: "failed" }), "Actor.B"), null, "or again after it failed");
    assert.equal(consentProblem(order(), "Actor.B", "o9").reason, "subject-locked");
    assert.equal(consentProblem(null, "Actor.B").reason, "no-order");
    assert.deepEqual([requirementVariant("G10", order()), requirementVariant("G11", order({ craftType: "graft" }))], ["subject", "subject"]);
});

test("a tattoo or graft order names its subject, who receives it, one at a time", () => {
    const base = { id: "o1", requester: "Actor.A", product: { uuid: "U", snapshot: {} }, quantity: 1, craftType: "tattoo" };
    assert.equal(makeOrder({ ...base, recipient: { kind: "actor", uuid: "Actor.B" }, target: "Actor.B" }, stamp).target, "Actor.B");
    assert.throws(() => makeOrder({ ...base, recipient: { kind: "actor", uuid: "Actor.A" }, target: "Actor.B" }, stamp), TypeError);
    assert.throws(() => makeOrder({ ...base, recipient: { kind: "strongbox" }, target: "Actor.B" }, stamp), TypeError);
    assert.throws(() => makeOrder({ ...base, recipient: { kind: "actor", uuid: "Actor.B" }, target: "Actor.B", quantity: 2 }, stamp), TypeError);
});

/* -------------------------------------------- */
/*  Investiture and healing                      */
/* -------------------------------------------- */

test("each magical tattoo or graft lowers the invest limit by 1; a new one fails only when the limit is already zero (settled)", () => {
    assert.deepEqual(investitureCheck({ kind: "tattoo", max: 10, tattoos: 2, grafts: 1 }), { works: true, limit: 7, exempt: false, over: false });
    assert.equal(investitureCheck({ kind: "tattoo", max: 10, tattoos: 9, grafts: 0 }).works, true, "a limit of one left still takes it");
    assert.equal(investitureCheck({ kind: "tattoo", max: 10, tattoos: 7, grafts: 3 }).works, false, "a limit of zero: decorative");
    assert.equal(investitureCheck({ kind: "graft", max: 10, tattoos: 10 }).works, false, "a graft against the same limit");
    assert.equal(investitureCheck({ kind: "tattoo", max: 10, tattoos: 10, exempt: 1 }).works, true, "Tattooed Historian: one does not count");
    assert.deepEqual(investitureCheck({ kind: "tattoo", max: 10, tattoos: 0, exempt: 1 }), { works: true, limit: 10, exempt: true, over: false },
        "the new tattoo is the exempt one");
    assert.equal(investitureCheck({ kind: "tattoo", max: 10, tattoos: 2, otherInvested: 8 }).over, true, "eight others no longer fit in a limit of seven");
    assert.equal(investitureCheck({ kind: "tattoo", max: 10, tattoos: 2, otherInvested: 7 }).over, false);
    assert.throws(() => investitureCheck({ kind: "tattoo", max: 1.5 }), TypeError);
});

test("a tattoo heals for its period, or a day once healing is recorded; then it works, or stays decorative (6.14)", () => {
    const som = subjectProcess("tattoo");
    const record = subjectRecord({ kind: "tattoo", order: "o1", subject: "Actor.B", crafter: "Actor.A", process: som, magical: true, day: 100 });
    assert.deepEqual([record.from, record.until, record.state, record.process], [100, 130, "healing", "secrets-of-magic"]);
    assert.equal(healedUntil(record, 104), 104, "magical healing on day 104 ends it that day");
    assert.equal(healedUntil(record, 100), 101, "never before the day after the finish");
    assert.equal(healedUntil(record, 200), 130, "never later than the period");
    const works = () => ({ works: true });
    const full = () => ({ works: false });
    assert.equal(settleSubject(record, { day: 129, check: works }), null, "still healing");
    assert.deepEqual(settleSubject(record, { day: 130, check: works }), { state: "invested", invested: true });
    assert.deepEqual(settleSubject(record, { day: 130, check: full }), { state: "decorative", invested: false });
    assert.equal(settleSubject({ ...record, state: "decorative" }, { day: 200, check: works }), null, "decorative for good");
    const graft = subjectRecord({ kind: "graft", order: "o2", subject: "Actor.B", crafter: "Actor.A", process: subjectProcess("graft"), magical: true, day: 100 });
    assert.deepEqual([graft.until, graft.state], [100, "healing"], "a graft has no healing period");
    assert.deepEqual(settleSubject(graft, { day: 100, check: full }), { state: "inactive", invested: false });
    assert.equal(settleSubject({ ...graft, state: "inactive" }, { day: 101, check: full }), null, "inactive stays until the limit rises");
    assert.deepEqual(settleSubject({ ...graft, state: "inactive" }, { day: 150, check: works }), { state: "invested", invested: true });
    const simple = subjectRecord({ kind: "tattoo", order: "o3", subject: "Actor.B", crafter: "Actor.A",
        process: subjectProcess("tattoo", rulesWith({ tattooProcess: "simple" })), magical: true, day: 100 });
    assert.equal(simple.state, "invested", "the toggle: delivered invested, not checked");
    assert.equal(settleSubject(simple, { day: 300, check: full }), null);
    assert.equal(subjectRecord({ kind: "tattoo", process: som, magical: false, day: 1 }).state, "mundane");
});

/* -------------------------------------------- */
/*  Legendary Tattoo Artist                      */
/* -------------------------------------------- */

test("Legendary Tattoo Artist: +1 to a magical tattoo's activated DCs, attacks and resistances, 3 levels below the tattooist", () => {
    const options = craftOptions({ item: itemOptions({ type: "equipment", traits: ["invested", "magical", "tattoo"], level: 4 }) });
    const marks = crafterMarks(["legendary-tattoo-artist"], options);
    assert.deepEqual(marks, [{ key: "legendary-tattoo-artist", mark: "activated", by: 1, below: 3 }]);
    assert.deepEqual(crafterMarks(["legendary-tattoo-artist"], craftOptions({ item: itemOptions({ type: "equipment", traits: ["magical"], level: 4 }) })), []);
    assert.equal(markFor(marks, { crafterLevel: 15, item: { traits: ["magical", "tattoo"], level: 12 } })?.by, 1);
    assert.equal(markFor(marks, { crafterLevel: 15, item: { traits: ["magical", "tattoo"], level: 13 } }), null, "only 2 below");
    assert.equal(markFor(marks, { crafterLevel: 15, item: { traits: ["tattoo"], level: 2 } }), null, "not magical");
    const html = "<p>Worn: @Check[will|dc:18] and DC 18.</p><hr><p><strong>Activate</strong> 2</p><p>@Check[reflex|dc:20|basic] and DC 21; " +
        "a spell attack modifier of +12.</p>";
    const raised = raiseActivated(html, 1);
    assert.equal(raised.raised, 3);
    assert.match(raised.html, /Worn: @Check\[will\|dc:18\] and DC 18\./, "what it does while worn is not an activated ability");
    assert.match(raised.html, /@Check\[reflex\|dc:21\|basic\] and DC 22; a spell attack modifier of \+13/);
    assert.deepEqual(raiseActivated("<p>No activation.</p>"), { html: "<p>No activation.</p>", raised: 0 });
    const rules = [{ key: "Resistance", type: "fire", value: 5 }, { key: "Resistance", type: "cold", value: "@item.level" }, { key: "FlatModifier", value: 1 }];
    assert.deepEqual(raiseResistances(rules, 1), { rules: [{ key: "Resistance", type: "fire", value: 6 }, rules[1], rules[2]], raised: 1 });
});

/* -------------------------------------------- */
/*  Fulus, missives, snares                      */
/* -------------------------------------------- */

test("a fulu takes its creator's tradition and lasts a year (Secrets of Magic p.158)", () => {
    assert.equal(fuluTradition({ traditions: ["divine"] }), "divine");
    assert.equal(fuluTradition({ traditions: ["arcane", "occult"] }), null, "two: the crafter chooses");
    assert.equal(fuluTradition({ traditions: [] }), null, "none: the crafter chooses");
    assert.equal(fuluTradition({ chosen: "primal", traditions: ["divine"] }), "primal", "a choice on the order wins");
    assert.equal(fuluTradition({ chosen: "wood", traditions: ["divine"] }), "divine");
    assert.deepEqual(fuluTraits(["consumable", "fulu", "magical"], "occult"), ["consumable", "fulu", "occult"]);
    assert.deepEqual(fuluTraits(["consumable", "fulu", "magical"], null), ["consumable", "fulu", "magical"]);
    const fulu = fuluStamp({ creator: "Actor.A", worldTime: 1000, day: 10 });
    assert.deepEqual(fulu, { creator: "Actor.A", cycle: null, rule: "world", fulu: true, at: 1000 + FULU_DAYS * 86400, atDay: 10 + FULU_DAYS });
    assert.equal(expiryReason(fulu, { worldTime: 1000 + 364 * 86400, loggedDay: 300 }), null);
    assert.equal(expiryReason(fulu, { worldTime: fulu.at, loggedDay: null }), "time");
    assert.equal(expiryReason(fulu, { worldTime: 0, loggedDay: fulu.atDay }), "day", "days logged ahead of the clock count too");
    assert.throws(() => fuluStamp({ creator: "", worldTime: 0, day: 0 }), TypeError);
    // A fulu's formula cannot be reverse-engineered (Secrets of Magic p.158).
    const item = { level: 3, rarity: "common", traits: ["consumable", "fulu", "magical"] };
    assert.ok(!acquisitionRoutes({ item, possessesItem: true }).some((r) => r.route === "reverse-engineer"));
    assert.ok(acquisitionRoutes({ item: { ...item, traits: ["consumable", "magical"] }, possessesItem: true }).some((r) => r.route === "reverse-engineer"));
    assert.deepEqual(reverseEngineerGates({ crafter: { level: 5, ranks: { crafting: 2 }, feats: [] }, item, upfrontCp: 0 }).map((g) => g.reason), ["no-reverse-engineer"]);
});

test("a missive is composed once, by itself (Treasure Vault (Remastered) p.84)", () => {
    const blank = { traits: ["consumable", "magical", "missive"], composed: false };
    assert.deepEqual(composePlan(blank, { actor: "Actor.A", by: "u1", at: 1, note: "  for the duke " }),
        { ok: true, record: { actor: "Actor.A", by: "u1", at: 1, note: "for the duke" } });
    assert.equal(composePlan(blank, { actor: "Actor.A", by: "u1", at: 1 }).record.note, null);
    assert.equal(composePlan({ ...blank, composed: true }, {}).reason, "composed");
    assert.equal(composePlan({ traits: ["consumable"] }, {}).reason, "not-missive");
});

test("quick-deploy snares: deployed and ready, giant and broad snares cost two slots (7.1; Giant Snare, Broad Snare)", () => {
    const prepared = [{ uuid: "S1", name: "Alarm" }, { uuid: "S1", name: "Alarm", expended: true }, { uuid: "S2", name: "Hampering" }];
    assert.deepEqual(entryKeys(prepared), ["S1#1", "S1#2", "S2#1"]);
    const ledger = quickDeployLedger({ maxSlots: 4, prepared }, { "S1#1": "giant", "S2#1": "broad" }, ["giant"]);
    assert.deepEqual(ledger.entries.map((e) => [e.key, e.mark, e.cost, e.deployed]), [["S1#1", "giant", 2, false], ["S1#2", null, 1, true], ["S2#1", null, 1, false]],
        "a mark the character's feats do not allow counts as plain");
    assert.deepEqual([ledger.used, ledger.max, ledger.over, ledger.deployed, ledger.ready], [4, 4, 0, 1, 2]);
    assert.equal(quickDeployLedger({ maxSlots: 3, prepared }, { "S1#1": "giant" }, ["giant"]).over, 1);
    assert.deepEqual(quickDeployMarks(["giant-snare", "broad-snare"]), ["broad", "giant"]);
    assert.deepEqual(quickDeployMarks(["snare-crafting"]), []);
});

/* -------------------------------------------- */
/*  What M9 changed elsewhere                    */
/* -------------------------------------------- */

test("a graft needs its formula (Howl of the Wild p.97); other Crafts take the no-formula route", () => {
    assert.equal(gateRoute("none", [], { needsFormula: true }).reason, "needs-formula");
    assert.equal(gateRoute("known", [], { needsFormula: true }).ok, true);
    assert.equal(gateRoute("none").ok, true);
    const crafter = { level: 6, ranks: { medicine: 2, crafting: 1 }, feats: ["graft-technician"] };
    const item = { level: 3, rarity: "common", traits: ["graft", "invested", "magical"], priceCp: 5000 };
    const gates = craftGates({ crafter, item, craftType: "graft", skill: "medicine", route: "none", upfrontCp: 0, custody: { subjectConsented: true, subjectLocked: true } });
    assert.deepEqual(gates.filter((g) => !g.ok).map((g) => [g.id, g.reason]), [["G6", "needs-formula"], ["G7", "tool"]]);
    const busy = craftGates({ crafter, item, craftType: "graft", skill: "medicine", route: "known", upfrontCp: 0, busyWith: "o7",
        tools: { available: ["artisans-toolkit"] }, custody: { subjectConsented: true, subjectLocked: true } });
    assert.deepEqual(busy.filter((g) => !g.ok).map((g) => [g.id, g.reason]), [["G11", "one-at-a-time"]]);
});

test("a subject's days: sitting for the order, locked from anything else, stopped once the order is over (4.8, 6.14)", () => {
    const pc = { actorId: "b", actorUuid: "Actor.B" };
    const sitting = order({ subject: consented(), status: "setup" });
    const plan = planDays({ ...pc, days: [5, 6], activity: { kind: "subject", ref: "o1" }, orders: [sitting] }, stamp);
    assert.deepEqual(plan.records.map((r) => [r.day, r.order, r.result]), [[5, "o1", "subject"], [6, "o1", "subject"]]);
    assert.equal(plan.stop, null);
    assert.deepEqual(planDays({ ...pc, days: [5], activity: { kind: "subsist" }, orders: [sitting] }, stamp).stop, { day: 5, reason: "sitting", ref: "o1" });
    assert.deepEqual(planDays({ ...pc, days: [5], activity: null, orders: [sitting] }, stamp).stop.reason, "sitting", "never \"not downtime\" while sitting");
    const helping = { id: "o2", status: "setup", helpers: { b: { leftDay: null } } };
    assert.equal(planDays({ ...pc, days: [5], activity: { kind: "subsist" }, orders: [helping] }, stamp).stop.reason, "locked", "a helper's lock is told as before");
    assert.equal(planDays({ ...pc, days: [5], activity: { kind: "subject", ref: "o1" }, orders: [{ ...sitting, status: "complete" }] }, stamp).stop.reason, "not-subject");
    assert.equal(planDays({ actorId: "c", actorUuid: "Actor.C", days: [5], activity: { kind: "subject", ref: "o1" }, orders: [sitting] }, stamp).stop.reason,
        "not-subject");
});

test("inventors have access to uncommon gadgets; the class is keyed apart from the Inventor feat (Guns & Gears)", () => {
    const held = heldKeys([{ sourceId: REGISTRY["inventor@class"].uuid, slug: "inventor", selections: {} }]);
    assert.deepEqual(held, ["inventor@class"]);
    const gadget = craftOptions({ item: itemOptions({ type: "consumable", traits: ["consumable", "gadget"], rarity: "uncommon", level: 3 }) });
    assert.equal(accessGrant(held, gadget), true);
    assert.equal(accessGrant(held, craftOptions({ item: itemOptions({ type: "consumable", traits: ["consumable", "gadget"], rarity: "rare", level: 3 }) })), false);
    assert.equal(accessGrant(["inventor"], gadget), false, "the Inventor skill feat grants no gadgets");
});

test("Tattooed Historian's exemptions are read from pf2e's own count of the archetype's feats (registry `investitureExempt`)", () => {
    assert.deepEqual(investitureExemptions(["tattooed-historian-dedication"]).map((e) => [e.per, e.count]),
        [[2, "flags.system.tattooedHistorian.archetypeFeatCount"]]);
    assert.deepEqual(investitureExemptions(["tattoo-artist"]), []);
});

test("a scroll batch is held to its castings and a wand to one, with the facts productFacts gives (M9 review fix)", () => {
    const scroll = { traits: ["consumable", "magical", "scroll"], spellcasting: { kind: "scroll", rank: 1 } };
    assert.equal(batchMax(scroll, { pledgedCastings: 2 }), 2);
    assert.equal(batchMax({ ...scroll, spellcasting: "scroll" }, { pledgedCastings: 3 }), 3, "the kind alone, as before");
    assert.equal(batchMax({ traits: ["consumable", "magical", "wand"], spellcasting: { kind: "wand", rank: 2 } }), 1);
    assert.equal(batchMax({ traits: ["consumable", "fulu", "magical"] }), 4, "fulus batch in fours, as consumables");
});

test("the roll wrapper: Tattoo Artist's +1, +2 at master Crafting, on a tattoo order; a graft's implant option for Graft Technician's bonus", async () => {
    const { craftRollPlan } = await import("../../scripts/logic/rolls.mjs");
    const item = [...itemOptions({ type: "equipment", traits: ["invested", "magical", "tattoo"], level: 1 })];
    const order = { id: "o1", attempt: 1, craftType: "tattoo" };
    assert.deepEqual(craftRollPlan({ item, held: ["tattoo-artist"], ranks: { crafting: 2 }, order }).modifiers.map((m) => [m.slug, m.type, m.value]),
        [["tattoo-artist", "circumstance", 1]]);
    assert.equal(craftRollPlan({ item, held: ["tattoo-artist"], ranks: { crafting: 3 }, order }).modifiers[0].value, 2);
    assert.deepEqual(craftRollPlan({ item, held: [], ranks: { crafting: 3 }, order }).modifiers, [], "Specialty Crafting's route has no such bonus");
    const graft = craftRollPlan({ item: [...itemOptions({ type: "equipment", traits: ["graft", "invested", "magical"], level: 1 })], held: ["graft-technician"],
        ranks: { medicine: 3 }, order: { id: "o2", attempt: 1, craftType: "graft" } });
    assert.ok(graft.options.includes("action:implant-graft"), "pf2e's own rule element gives Graft Technician's bonus");
    assert.deepEqual(graft.modifiers, []);
});
