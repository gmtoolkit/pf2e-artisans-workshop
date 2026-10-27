/**
 * The affliction tracker over the fake world (DESIGN.md 8.10, M8a): exposure claims and their prompts, the save rolled with
 * the source item (incapacitation), recording (a duplicate changes nothing, a reroll replaces), the effect-backed tracker and
 * its granted conditions, stage saves as time passes and the maximum duration, logged days, who rolls (an offline owner, a
 * GM for creatures no player owns), the stage guard, the DC stamp at creation and the DC order, coatings and Strikes with
 * Sticky Poison, coatings voided with their poison, and Affliction Forge's GM-routed hand-off.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { FakeCollection, addDocument, coin, expand, installFoundry, setUsers, sharedWorld, world, resetWorld } from "./stubs.mjs";
import { asCreature, clientUpdate, compendiumPoison, installPf2eAfflictions, reroll } from "./pf2e-afflictions.mjs";

installFoundry();
const MOD = "pf2e-artisans-workshop";
const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const downtime = await import("../../scripts/foundry/downtime.mjs");
const expiry = await import("../../scripts/foundry/expiry.mjs");
const defs = await import("../../scripts/foundry/affliction-defs.mjs");
const afflictions = await import("../../scripts/foundry/afflictions.mjs");
const coatings = await import("../../scripts/foundry/coatings.mjs");
const forge = await import("../../scripts/foundry/forge.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

let hero;
let ogre;
let poison;
let docs;
const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const ledger = () => docs.ledger.flags[MOD];
const claimsOf = (kind = "exposure") => Object.values(ledger().claims ?? {}).filter((c) => c.kind === kind);
const conditions = (actor) => actor.items.filter((i) => i.type === "condition");
const condition = (actor, slug) => conditions(actor).find((c) => c.system.slug === slug) ?? null;
const hooked = (name) => {
    const seen = [];
    Hooks.on(`${MOD}.${name}`, (payload) => seen.push(payload));
    return seen;
};

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    downtime.resetDowntime();
    expiry.resetExpiry();
    afflictions.resetAfflictions();
    defs.resetDefinitions();
    coatings.resetCoatings();
    forge.resetForge();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    installPf2eAfflictions();
    docs = sharedWorld();
    poison = compendiumPoison();
    game.combats = new FakeCollection();
    game.time.worldTime = 1000;
    game.modules = new Map([[MOD, { id: MOD, version: "0.0.0" }]]);
    ChatMessage.implementation.getSpeaker = () => ({});
    hero = asCreature(addDocument("Actor", { name: "Hero", type: "character", ownership: { default: 0, p1: 3 }, items: [] }), { level: 4 });
    ogre = asCreature(addDocument("Actor", { name: "Ogre", type: "npc", items: [] }), { level: 9 });
    setUsers([{ id: "p1", character: hero }, { id: "gm00000000000000", isGM: true }], "p1");
    world.settings.set(`${MOD}.enabled`, true);
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
    afflictions.registerAfflictionHooks();
    coatings.registerCoatingHooks();
});

/** Expose `targets` to the test poison and let the claims sweep run. */
async function exposeTo(targets, extra = {}) {
    const result = await afflictions.expose({ item: poison, targets, delivery: "injury", key: extra.key ?? "msg00000001", deliverer: extra.deliverer ?? null, ...extra });
    await settle();
    await claims.sweepClaims();
    return result;
}

/** Roll the pending save of a victim and record its message, with pf2e's outcome. */
async function rollAndRecord(victim, outcome) {
    const pending = afflictions.pendingOf(victim)[0];
    world.outcomes.push(outcome);
    const rolled = await afflictions.rollSave(victim, { runId: pending.runId, seq: pending.seq }, { skipDialog: true });
    assert.equal(rolled.ok, true, JSON.stringify(rolled));
    const message = world.lastMessage;
    const recorded = await afflictions.onAfflictionMessage(message);
    return { pending, message, recorded };
}

/* -------------------------------------------- */
/*  Exposure, the save and the tracker            */
/* -------------------------------------------- */

test("an exposure is a claim the victim's owner is prompted for; the save goes through pf2e with the source item at its level and the link (8.10.3, 8.10.8)", async () => {
    const prompts = hooked("afflictionPrompt");
    const result = await exposeTo([hero]);
    assert.equal(result.ok, true, JSON.stringify(result));
    const [claim] = claimsOf();
    assert.equal(claim.actor, hero.uuid);
    assert.deepEqual(claim.dc, { value: 18, source: "inline" }, "the inline DC as pf2e resolves it for the holder");
    assert.deepEqual(claim.pending, { kind: "initial", runId: claim.run, seq: 1 });
    assert.equal(prompts.length, 1, "one prompt");
    assert.equal(prompts[0].victim, hero);
    await claims.sweepClaims();
    assert.equal(prompts.length, 1, "a second sweep does not prompt again");
    world.outcomes.push("failure");
    await afflictions.rollSave(hero, { runId: claim.run, seq: 1 }, { skipDialog: true });
    const { params } = world.saveRolls[0];
    assert.equal(params.dc.value, 18);
    assert.equal(params.item.isOfType("physical"), true, "a physical item: pf2e takes the incapacitation level from it");
    assert.equal(params.item.level, 2, "at the affliction's level");
    assert.equal(params.item.parent, hero);
    assert.ok(params.extraRollOptions.includes("item:trait:poison"), "the system's bonuses against poisons apply");
    assert.ok(params.extraRollOptions.includes(`pf2e-artisans-workshop:affliction:${claim.run}:1`));
});

test("a failed initial save creates the effect-backed tracker with its stage badge, grants stage 1's conditions and posts its damage (8.10.1)", async () => {
    await exposeTo([hero]);
    const changes = hooked("afflictionChanged");
    const { pending, recorded } = await rollAndRecord(hero, "failure");
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    const tracker = hero.items.get(pending.runId);
    assert.equal(tracker.type, "effect");
    assert.deepEqual(tracker.system.duration, { value: -1, unit: "unlimited", expiry: null, sustained: false });
    assert.equal(tracker.system.badge.value, 1);
    assert.equal(tracker.system.badge.labels.length, 3);
    const run = afflictions.runOf(tracker);
    assert.deepEqual([run.phase, run.stage, run.nextDueAt, run.maxEndsAt], ["active", 1, 1006, 1036]);
    assert.equal(tracker.flags[MOD].affliction.system.save.value, 18, "the schema of pf2e's affliction item");
    const sickened = condition(hero, "sickened");
    assert.deepEqual(sickened.flags.pf2e.grantedBy, { id: tracker.id, onDelete: "detach" }, "sickened expires on its own: it outlasts the tracker");
    assert.equal(sickened.system.references.parent.id, tracker.id, "linked, as pf2e links stage conditions");
    assert.deepEqual(Object.values(tracker.flags.pf2e.itemGrants), [{ id: sickened.id, onDelete: "detach" }], "the tracker's own grants never delete it");
    assert.equal(world.damageMessages[0].formula, "{(1d6)[poison]}");
    assert.equal(world.damageMessages[0].flags.pf2e.context.type, "damage-roll");
    assert.equal(claimsOf()[0].outcome, "afflicted");
    assert.ok(claimsOf()[0].resolved);
    assert.equal(changes[0].reason, "initial");
});

test("a successful initial save leaves the creature unaffected; Pernicious Poison's damage is posted (8.10.6)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "success");
    assert.equal(hero.items.get(pending.runId), undefined);
    assert.equal(claimsOf()[0].outcome, "unaffected");
    assert.equal(world.damageMessages.length, 0);
});

test("recording: a second message for the same save changes nothing; a Hero Point reroll replaces it once the original is gone (8.10.8)", async () => {
    await exposeTo([hero]);
    const notices = hooked("afflictionNotice");
    const { pending, message } = await rollAndRecord(hero, "failure");
    const again = await afflictions.onAfflictionMessage(message);
    assert.deepEqual([again.ok, again.reason], [false, "already"]);
    assert.equal(notices.length, 1);
    assert.equal(conditions(hero).length, 1);
    // The reroll: pf2e deletes the original and posts the new result; a success ends what the failure started, its
    // conditions included (the expiring ones too: that outcome never happened).
    const rerolled = await afflictions.onAfflictionMessage(reroll(message, "success"));
    assert.equal(rerolled.ok, true, JSON.stringify(rerolled));
    assert.equal(hero.items.get(pending.runId), undefined);
    assert.equal(condition(hero, "sickened"), null);
});

test("a failed reroll of a successful initial save starts the affliction (8.10.8)", async () => {
    await exposeTo([hero]);
    const { pending, message } = await rollAndRecord(hero, "success");
    assert.equal(hero.items.get(pending.runId), undefined);
    const rerolled = await afflictions.onAfflictionMessage(reroll(message, "criticalFailure"));
    assert.equal(rerolled.ok, true, JSON.stringify(rerolled));
    assert.equal(afflictions.runOf(hero.items.get(pending.runId)).stage, 2);
});

test("stage saves fall due as time passes; a failure enters the next stage, granting its conditions; the maximum duration ends it and drained stays (8.10.6, 8.10.7)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "failure");
    const prompts = hooked("afflictionPrompt");
    game.time.worldTime = 1006;
    await afflictions.processAfflictions();
    const tracker = hero.items.get(pending.runId);
    assert.deepEqual(afflictions.runOf(tracker).pending, { seq: 2, kind: "stage", dueAt: 1006 });
    assert.equal(prompts.length, 1);
    await rollAndRecord(hero, "failure");
    const run = afflictions.runOf(hero.items.get(pending.runId));
    assert.deepEqual([run.stage, run.nextDueAt, run.maxEndsAt, run.pending], [2, 1012, 1036, null], "the next save from its own due time; the maximum never moves");
    assert.deepEqual(condition(hero, "slowed").flags.pf2e.grantedBy, { id: pending.runId, onDelete: "cascade" });
    assert.deepEqual(condition(hero, "drained").flags.pf2e.grantedBy, { id: pending.runId, onDelete: "detach" });
    assert.ok(condition(hero, "sickened"), "an expiring condition is not removed at the stage change");
    assert.equal(world.damageMessages.at(-1).formula, "{(2d6)[poison]}");
    // The maximum duration: pushed past the next save so it is what falls due.
    await hero.items.get(pending.runId).update({ [`flags.${MOD}.affliction.run.nextDueAt`]: 5000 }, afflictions.ownWrite());
    const changes = hooked("afflictionChanged");
    game.time.worldTime = 1036;
    await afflictions.processAfflictions();
    assert.equal(hero.items.get(pending.runId), undefined);
    assert.equal(condition(hero, "slowed"), null, "a linked condition goes with the tracker");
    assert.ok(condition(hero, "drained"), "drained outlives a poison whose maximum duration ran out");
    assert.equal(changes[0].reason, "max-duration");
});

test("days logged by the wizard move the affliction clock: a day-interval disease's save falls due without the world clock (8.10.7)", async () => {
    const p = (label, rest) => `<p><strong>${label}</strong> ${rest}</p>`;
    poison = compendiumPoison({ id: "diseaseCompend01", name: "Test Fever", traits: ["consumable", "disease"],
        html: [p("Saving Throw", "@Check[fortitude|dc:20]"), p("Stage 1", "drained 1 (1 day)"), p("Stage 2", "drained 2 (1 day)")].join("") });
    await exposeTo([hero], { delivery: null });
    const { pending } = await rollAndRecord(hero, "failure");
    await afflictions.processAfflictions();
    assert.equal(afflictions.runOf(hero.items.get(pending.runId)).pending, null, "a day has not passed");
    await docs.ledger.update({ [`flags.${MOD}.meta.manual.run1`]: { id: "run1", v: 1, fromDay: 0, toDay: 1 } });
    assert.equal(afflictions.clockNow(), 1000 + 86400, "a day ahead of world time: the logged day, at the world's time of day");
    await afflictions.processAfflictions();
    assert.equal(afflictions.runOf(hero.items.get(pending.runId)).pending.dueAt, 1000 + 86400, "due from the stage's own start");
});

test("who rolls: an offline owner's save waits and a GM sees roll-for-them; with gmRollsForOfflinePCs the GM's client rolls (8.10.8)", async () => {
    setUsers([{ id: "p1", character: hero, active: false }, { id: "gm00000000000000", isGM: true }], "gm00000000000000");
    const prompts = hooked("afflictionPrompt");
    await exposeTo([hero]);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].waiting, "owner");
    assert.equal(world.saveRolls.length, 0, "nobody rolls for an offline owner by default");
    world.settings.set(`${MOD}.afflictions.gmRollsForOfflinePCs`, true);
    afflictions.resetAfflictions();
    await claims.sweepClaims();
    assert.equal(world.saveRolls.length, 1, "the GM's client rolls it");
});

test("a creature no player owns is rolled at once on the GM's client (npcSaves auto) and recorded there (8.10.8)", async () => {
    setUsers([{ id: "p1", character: hero }, { id: "gm00000000000000", isGM: true }], "gm00000000000000");
    world.outcomes.push("criticalFailure");
    await exposeTo([ogre]);
    assert.equal(world.saveRolls.length, 1);
    assert.equal(world.saveRolls[0].actor, ogre.id);
    const recorded = await afflictions.onAfflictionMessage(world.lastMessage);
    assert.equal(recorded.ok, true);
    assert.equal(afflictions.trackersOf(ogre).length, 1);
    assert.equal(afflictions.runOf(afflictions.trackersOf(ogre)[0]).stage, 2);
});

test("a creature immune to the affliction's kind is unaffected, with no save (8.10.3)", async () => {
    setUsers([{ id: "p1", character: hero }, { id: "gm00000000000000", isGM: true }], "gm00000000000000");
    ogre.attributes.immunities = [{ type: "poison" }];
    await exposeTo([ogre]);
    assert.equal(world.saveRolls.length, 0);
    assert.equal(claimsOf()[0].outcome, "immune");
});

test("re-exposure to an active poison rolls a save that adds a stage; a world definition with reExposure none rolls nothing (8.10.6)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "failure");
    await exposeTo([hero], { key: "msg00000002" });
    const second = claimsOf().find((c) => !c.resolved);
    assert.deepEqual(second.pending, { kind: "re-exposure", runId: pending.runId, seq: 2 });
    await rollAndRecord(hero, "failure");
    assert.equal(afflictions.runOf(hero.items.get(pending.runId)).stage, 2);
    // The item's own rule (Lethargy Poison's shape): further exposure rolls no save and changes nothing.
    const def = await defs.definitionOf(poison);
    await defs.defineWorld(poison.uuid, { ...def, reExposure: "none" });
    const rolls = world.saveRolls.length;
    await exposeTo([hero], { key: "msg00000003" });
    assert.equal(world.saveRolls.length, rolls);
    assert.equal(claimsOf().find((c) => c.idem.startsWith("expose:msg00000003")).outcome, "no-save");
});

test("the save item of a weapon-type source (a bomb) is a consumable at the affliction's level, never the check's weapon (8.10.8)", async () => {
    const item = await afflictions.saveItemFor(hero, { uuid: "Compendium.pf2e.equipment-srd.Item.nothingHere00000", name: "Bomb", type: "weapon",
        traits: ["bomb", "poison", "disease"], level: 15 });
    assert.equal(item.type, "consumable");
    assert.equal(item.level, 15);
    assert.ok(item.getRollOptions("item").includes("item:trait:disease"));
});

/* -------------------------------------------- */
/*  Manual changes and the stage guard (8.10.9)   */
/* -------------------------------------------- */

test("the stage guard: an effects-panel click becomes a recorded manual adjust with the stage's conditions; undo puts it back (8.10.1, 8.10.9)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "failure");
    const tracker = hero.items.get(pending.runId);
    const changed = await clientUpdate(tracker, expand({ "system.badge.value": 2 }));
    assert.equal(changed, null, "pf2e's own write is cancelled");
    await settle(20);
    const run = afflictions.runOf(hero.items.get(pending.runId));
    assert.equal(run.stage, 2);
    assert.equal(Object.values(run.manual).at(-1).by, "p1", "its author recorded");
    assert.equal(hero.items.get(pending.runId).system.badge.value, 2, "the badge matches the run");
    assert.ok(condition(hero, "slowed"));
    assert.equal(world.damageMessages.length, 1, "a manual change rolls no damage");
    const undone = await afflictions.adjust(hero.items.get(pending.runId), { undo: true });
    assert.equal(undone.ok, true);
    assert.equal(afflictions.runOf(hero.items.get(pending.runId)).stage, 1);
    assert.equal(condition(hero, "slowed"), null);
    // A module write is let through.
    assert.ok(await clientUpdate(hero.items.get(pending.runId), expand({ "system.badge.value": 1 }), afflictions.ownWrite()));
});

test("a deletion the module did not make (a right-click at stage 1) is allowed and recorded as a manual end, which can be undone (8.10.1)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "failure");
    const changes = hooked("afflictionChanged");
    await hero.deleteEmbeddedDocuments("Item", [pending.runId]);
    await settle();
    assert.equal(hero.items.get(pending.runId), undefined);
    assert.equal(changes[0].reason, "manual");
    assert.ok(hero.flags[MOD].afflictionEnded[pending.runId]);
    const back = await afflictions.undoEnd(hero, pending.runId);
    assert.equal(back.ok, true);
    assert.equal(afflictions.runOf(hero.items.get(pending.runId)).stage, 1);
});

/* -------------------------------------------- */
/*  DCs (8.10.4)                                 */
/* -------------------------------------------- */

test("the Powerful Alchemy stamp is written at creation only when the class DC beats the printed DC; an ally holding the item keeps it (8.10.4)", () => {
    const alchemist = addDocument("Actor", { name: "Alch", type: "character", items: [{ type: "feat", name: "Powerful Alchemy", system: { slug: "powerful-alchemy" },
        _stats: { compendiumSource: REGISTRY["powerful-alchemy"].uuid } }] });
    alchemist.classDCs = { alchemist: { dc: { value: 22 } } };
    const infused = (dc) => ({ system: { description: { value: `<p>@Check[fortitude|dc:${dc}]</p>` }, traits: { value: ["infused", "poison"] } } });
    const stamp = defs.dcStampFor(alchemist, infused(18));
    assert.deepEqual([stamp.value, stamp.rule, stamp.creator, stamp.printed], [22, "powerful-alchemy", alchemist.uuid, 18]);
    alchemist.classDCs.alchemist.dc.value = 29;
    assert.equal(defs.dcStampFor(alchemist, infused(30)), null, "Wolfsbane 30 against a 10th-level alchemist's 29: no stamp");
    assert.equal(defs.dcStampFor(alchemist, { system: { description: { value: "<p>@Check[fortitude|dc:18]</p>" }, traits: { value: ["poison"] } } }), null,
        "not infused (downtime-crafted): Powerful Alchemy never applies");
    // The DC order with the item in an ally's hands: the stamp wins over the ally's inline (printed) DC.
    const def = { save: { type: "fortitude", value: 18 }, origin: "parse" };
    const held = { ...infused(18), flags: { [MOD]: { dcStamp: { value: 22, rule: "powerful-alchemy", creator: alchemist.uuid } } } };
    assert.deepEqual(defs.exposureDc({ def, item: held, holder: hero }), { value: 22, source: "stamp", creator: alchemist.uuid });
    assert.deepEqual(defs.exposureDc({ def, item: infused(18), holder: hero }), { value: 18, source: "inline" });
    assert.deepEqual(defs.exposureDc({ def, item: infused(18), holder: alchemist }).value, 29, "pf2e's own upgrade for the creator holding it");
    assert.equal(defs.exposureDc({ def, item: infused(18), holder: hero, manual: 25 }).value, 25, "a DC typed on a manual Expose");
});

/* -------------------------------------------- */
/*  Coatings and Strikes (8.10.5)                */
/* -------------------------------------------- */

/** A coated weapon on the hero, with the test poison as a carried dose. */
async function coat({ feats = [] } = {}) {
    for (const slug of feats) hero.addItem({ type: "feat", name: slug, system: { slug }, _stats: { compendiumSource: REGISTRY[slug].uuid } });
    const weapon = hero.addItem({ type: "weapon", name: "Dagger", system: { slug: "dagger" } });
    const dose = hero.addItem({ type: "consumable", name: "Test Toxin", system: { quantity: 2, slug: "test-toxin", level: { value: 2 },
        traits: { value: ["alchemical", "consumable", "injury", "poison"] }, description: poison.system.description }, _stats: { compendiumSource: poison.uuid } });
    const applied = await coatings.applyPoison({ poison: dose, weapon, actor: hero });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    return { weapon: hero.items.get(weapon.id), dose: hero.items.get(dose.id) };
}

/** A pf2e Strike message from the hero's weapon. */
function strikeMessage(weapon, type, extra = {}) {
    return addDocument("ChatMessage", { flags: { pf2e: { origin: { uuid: weapon.uuid, type: "weapon" }, context: { type, target: { actor: ogre.uuid }, ...extra.context },
        ...(extra.damageRoll ? { damageRoll: extra.damageRoll } : {}) } } });
}

test("applying a poison writes a coating with the DC frozen and spends one dose (8.10.5)", async () => {
    const { weapon, dose } = await coat();
    const coating = coatings.coatingOf(weapon);
    assert.deepEqual(coating.dc, { value: 18, source: "inline" });
    assert.equal(coating.delivery, "injury");
    assert.equal(dose.system.quantity, 1);
    const again = await coatings.applyPoison({ poison: dose, weapon, actor: hero });
    assert.equal(again.reason, "coated", "one injury poison per weapon: replacing needs a confirmation");
    assert.equal((await coatings.applyPoison({ poison: dose, weapon, actor: hero, replace: true })).ok, true);
});

test("a Strike: the attack arms the coating; a hit with piercing damage exposes the target and spends it (8.10.5)", async () => {
    const { weapon } = await coat();
    assert.deepEqual(await coatings.onStrikeMessage(strikeMessage(weapon, "attack-roll", { context: { outcome: "success" } })), { outcome: "armed" });
    assert.ok(coatings.coatingOf(hero.items.get(weapon.id)).armed);
    const result = await coatings.onStrikeMessage(strikeMessage(weapon, "damage-roll", { damageRoll: { types: { piercing: { base: 4 } } } }));
    assert.equal(result.outcome, "exposed");
    assert.equal(coatings.coatingOf(hero.items.get(weapon.id)), null);
    const [claim] = claimsOf();
    assert.equal(claim.actor, ogre.uuid);
    assert.deepEqual(claim.dc, { value: 18, source: "inline" }, "the DC frozen when the poison was applied");
    assert.equal(claim.restore.host, weapon.uuid);
});

test("a Strike's critical failure spends the coating, a failure keeps it, a hit without piercing or slashing damage spends it unexposed (8.10.5)", async () => {
    const { weapon } = await coat();
    assert.equal((await coatings.onStrikeMessage(strikeMessage(weapon, "attack-roll", { context: { outcome: "failure" } }))).outcome, "kept");
    assert.ok(coatings.coatingOf(hero.items.get(weapon.id)));
    await coatings.onStrikeMessage(strikeMessage(weapon, "attack-roll", { context: { outcome: "criticalSuccess" } }));
    const blunt = await coatings.onStrikeMessage(strikeMessage(weapon, "damage-roll", { damageRoll: { types: { bludgeoning: { base: 4 } } } }));
    assert.equal(blunt.outcome, "spent");
    assert.equal(claimsOf().length, 0, "no exposure");
    const again = await coat();
    await coatings.onStrikeMessage(strikeMessage(again.weapon, "attack-roll", { context: { outcome: "criticalFailure" } }));
    assert.equal(coatings.coatingOf(hero.items.get(again.weapon.id)), null);
});

test("Sticky Poison: a DC 17 flat check after an exposure and a DC 5 check on a spend without a save keep the coating (8.10.5)", async () => {
    const { weapon } = await coat({ feats: ["sticky-poison"] });
    world.flats.push(18);
    await coatings.onStrikeMessage(strikeMessage(weapon, "attack-roll", { context: { outcome: "success" } }));
    const result = await coatings.onStrikeMessage(strikeMessage(weapon, "damage-roll", { damageRoll: { types: { slashing: { base: 4 } } } }));
    assert.equal(result.kept, true);
    assert.ok(coatings.coatingOf(hero.items.get(weapon.id)).sticky);
    world.flats.push(4);
    await coatings.onStrikeMessage(strikeMessage(weapon, "attack-roll", { context: { outcome: "criticalFailure" } }));
    assert.equal(coatings.coatingOf(hero.items.get(weapon.id)), null, "4 against DC 5: spent");
});

test("a coating made from an infused poison is voided with its expiry; the weapon itself is never marked inert (4.12, 8.10.5)", async () => {
    const { weapon } = await coat();
    await weapon.update({ [`flags.${MOD}.coating.stamp`]: { creator: hero.uuid, cycle: 0, rule: "prep" } });
    await docs.ledger.update({ [`flags.${MOD}.pcs.${hero.id}`]: { id: hero.id, v: 1, prepCycle: 1 } });
    const cleared = await expiry.voidCoatings(hero);
    assert.deepEqual(cleared, [weapon.id]);
    assert.equal(coatings.coatingOf(hero.items.get(weapon.id)), null);
    assert.notEqual(hero.items.get(weapon.id).flags[MOD]?.inert, true);
});

/* -------------------------------------------- */
/*  Affliction Forge (8.10.11)                   */
/* -------------------------------------------- */

/** Affliction Forge, active, with an API that records hand-offs. */
function forgeOn() {
    game.modules.set("pf2e-affliction-forge", { active: true, api: {
        application: { apply: async (args) => world.forgeCalls.push(args) },
        instances: { listForActor: async () => [] }, templates: { list: async () => [] },
    } });
    poison.flags = { "pf2e-affliction-forge": { afflictionReferences: [{ templateUuid: "Compendium.forge.templates.Item.toxinTemplate000", enabled: true }] } };
}

test("Affliction Forge: a template-linked exposure is handed off on the active GM's client only, with the chosen DC (8.10.11)", async () => {
    forgeOn();
    const prompts = hooked("afflictionPrompt");
    await exposeTo([hero]);
    assert.equal(world.forgeCalls.length, 0, "a player's client never calls Affliction Forge");
    assert.equal(prompts.length, 0, "nor tracks it");
    assert.equal(claimsOf()[0].forge.template, "Compendium.forge.templates.Item.toxinTemplate000");
    world.currentUser = "gm00000000000000";
    await claims.sweepClaims();
    assert.equal(world.forgeCalls.length, 1);
    assert.deepEqual(world.forgeCalls[0].context, { saveDc: 18 });
    assert.equal(claimsOf()[0].outcome, "forge");
});

test("Affliction Forge without a GM: the Workshop tracks it (forgeWithoutGm workshop), or it waits (wait) (8.10.11, P2)", async () => {
    forgeOn();
    setUsers([{ id: "p1", character: hero }, { id: "gm00000000000000", isGM: true, active: false }], "p1");
    const prompts = hooked("afflictionPrompt");
    await exposeTo([hero]);
    assert.equal(world.forgeCalls.length, 0);
    assert.equal(prompts.length, 1, "tracked by the Workshop");
    assert.equal(prompts[0].waiting, null);
    world.settings.set(`${MOD}.afflictions.forgeWithoutGm`, "wait");
    await exposeTo([ogre], { key: "msg00000009" });
    assert.ok(prompts.some((p) => p.waiting === "forge"));
    assert.equal(world.forgeCalls.length, 0);
});

test("one engine per affliction: a target with a Forge controller for the source is left to Affliction Forge; a coated weapon it owns is refused (8.10.11)", async () => {
    forgeOn();
    game.modules.get("pf2e-affliction-forge").api.instances.listForActor = async () => [{ flags: { "pf2e-affliction-forge": { origin: { itemUuid: poison.uuid } } } }];
    world.settings.set(`${MOD}.afflictions.handOffToForge`, false);
    await exposeTo([hero]);
    assert.equal(claimsOf()[0].outcome, "forge-owns");
    const weapon = hero.addItem({ type: "weapon", name: "Forge Blade", flags: { "pf2e-affliction-forge": { afflictionReferences: [{ templateUuid: "x", enabled: true }] } } });
    const dose = hero.addItem({ type: "consumable", name: "Dose", system: { quantity: 1, traits: { value: ["injury", "poison"] }, description: poison.system.description } });
    assert.equal((await coatings.applyPoison({ poison: dose, weapon, actor: hero })).reason, "forge-coats");
});

/* -------------------------------------------- */
/*  After the M8a review                         */
/* -------------------------------------------- */

test("a re-exposure whose affliction ended before its save was recorded starts it again as an initial exposure (8.10.3)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "failure");
    await exposeTo([hero], { key: "msg00000002" });
    const second = claimsOf().find((c) => !c.resolved);
    assert.equal(second.pending.kind, "re-exposure");
    await afflictions.adjust(hero.items.get(pending.runId), { end: true });
    assert.equal(hero.items.get(pending.runId), undefined);
    world.outcomes.push("failure");
    await afflictions.rollSave(hero, { runId: second.pending.runId, seq: second.pending.seq }, { skipDialog: true });
    const recorded = await afflictions.onAfflictionMessage(world.lastMessage);
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    const run = afflictions.runOf(hero.items.get(pending.runId));
    assert.deepEqual([run.phase, run.stage, run.nextDueAt], ["active", 1, 1006], "a working tracker at stage 1, not a stuck onset");
});

test("a pending save another client already recorded is cleared, and the next due save follows (8.10.8)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "failure");
    game.time.worldTime = 1006;
    await afflictions.processAfflictions();
    await rollAndRecord(hero, "failure");
    // This client's late pending for the save just recorded lands after the result.
    await hero.items.get(pending.runId).update({ [`flags.${MOD}.affliction.run.pending`]: { seq: 2, kind: "stage", dueAt: 1006 } }, afflictions.ownWrite());
    game.time.worldTime = 1012;
    afflictions.resetAfflictions();
    await afflictions.processAfflictions();
    assert.deepEqual(afflictions.runOf(hero.items.get(pending.runId)).pending, { seq: 3, kind: "stage", dueAt: 1012 });
});

/* -------------------------------------------- */
/*  After the second M8a review                  */
/* -------------------------------------------- */

test("logged days move the clock by whole days, so rounds still count: before and after 'advance clock to match' (8.10.7)", async () => {
    await docs.ledger.update({ [`flags.${MOD}.meta.manual.run1`]: { id: "run1", v: 1, fromDay: 0, toDay: 1 } });
    // The log runs a day ahead of the clock: an encounter that day still moves the affliction clock round by round.
    await exposeTo([hero]);
    const first = await rollAndRecord(hero, "failure");
    assert.deepEqual(afflictions.runOf(hero.items.get(first.pending.runId)).nextDueAt, 1000 + 86400 + 6);
    game.time.worldTime += 6;
    await afflictions.processAfflictions();
    assert.equal(afflictions.runOf(hero.items.get(first.pending.runId)).pending?.dueAt, 1000 + 86400 + 6, "due a round later");
    await afflictions.adjust(hero.items.get(first.pending.runId), { end: true });
    // The GM advances the clock to match (whole days, the same time of day): no jump, and a new exposure runs on world time.
    game.time.worldTime = 1000 + 86400 + 6;
    assert.equal(afflictions.clockNow(), game.time.worldTime);
    await exposeTo([hero], { key: "msg00000010" });
    const second = await rollAndRecord(hero, "failure");
    const run = afflictions.runOf(hero.items.get(second.pending.runId));
    assert.deepEqual([run.enteredAt, run.nextDueAt, run.maxEndsAt], [87406, 87412, 87442]);
    game.time.worldTime += 6;
    await afflictions.processAfflictions();
    assert.deepEqual(afflictions.runOf(hero.items.get(second.pending.runId)).pending, { seq: 2, kind: "stage", dueAt: 87412 });
});

test("a re-exposure while a stage save is pending waits for it, then takes its own save number (8.10.8)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "failure");
    game.time.worldTime = 1006;
    await afflictions.processAfflictions();
    assert.deepEqual(afflictions.runOf(hero.items.get(pending.runId)).pending, { seq: 2, kind: "stage", dueAt: 1006 });
    game.time.worldTime = 1008;
    await exposeTo([hero], { key: "msg00000002" });
    const second = claimsOf().find((c) => !c.resolved);
    assert.equal(second.pending, undefined, "the earlier stage save comes first");
    world.outcomes.push("failure");
    await afflictions.rollSave(hero, { runId: pending.runId, seq: 2 }, { skipDialog: true });
    await afflictions.onAfflictionMessage(world.lastMessage);
    await settle();
    await claims.sweepClaims();
    let run = afflictions.runOf(hero.items.get(pending.runId));
    assert.deepEqual([run.saves[2].kind, run.stage], ["stage", 2], "the card rolled was the stage save, recorded as one");
    assert.deepEqual(claimsOf().find((c) => c.id === second.id).pending, { kind: "re-exposure", runId: pending.runId, seq: 3 });
    world.outcomes.push("failure");
    await afflictions.rollSave(hero, { runId: pending.runId, seq: 3 }, { skipDialog: true });
    await afflictions.onAfflictionMessage(world.lastMessage);
    run = afflictions.runOf(hero.items.get(pending.runId));
    assert.deepEqual([run.saves[3].kind, run.stage, run.nextDueAt], ["re-exposure", 3, 1014]);
    assert.ok(claimsOf().find((c) => c.id === second.id).resolved);
});

test("Pinpoint Poisoner: a flanked target (off-guard only in the Strike's roll options) takes −2; a creature in a cloud that is not off-guard does not (8.10.6)", async () => {
    const { weapon } = await coat({ feats: ["pinpoint-poisoner"] });
    await coatings.onStrikeMessage(strikeMessage(weapon, "attack-roll", { context: { outcome: "success", options: ["target:condition:off-guard", "self:flanking"] } }));
    await coatings.onStrikeMessage(strikeMessage(weapon, "damage-roll", { damageRoll: { types: { piercing: { base: 4 } } } }));
    assert.equal(claimsOf()[0].offGuard, true, "recorded at the hit");
    assert.equal(ogre.hasCondition("off-guard"), false, "pf2e's flanking off-guard is the clone's, not an item on the target");
    world.currentUser = "gm00000000000000";
    await claims.sweepClaims();
    assert.equal(world.saveRolls.at(-1).actor, ogre.id);
    assert.deepEqual(world.saveRolls.at(-1).params.modifiers.map((m) => [m.slug, m.modifier]), [["pinpoint-poisoner", -2]]);
    // An inhaled poison: the feat still needs an off-guard creature.
    const cloud = compendiumPoison({ id: "cloudCompendium1", name: "Test Cloud", traits: ["alchemical", "consumable", "inhaled", "poison"] });
    const dose = hero.addItem({ type: "consumable", name: "Test Cloud", system: { quantity: 1, level: { value: 2 }, traits: { value: ["alchemical", "consumable", "inhaled", "poison"] },
        description: cloud.system.description }, _stats: { compendiumSource: cloud.uuid } });
    const unleashed = await coatings.unleash({ poison: dose, actor: hero, targets: [ogre] });
    assert.equal(unleashed.ok, true, JSON.stringify(unleashed));
    await settle();
    await claims.sweepClaims();
    const roll = world.saveRolls.at(-1);
    assert.equal(roll.params.item.name, "Test Cloud");
    assert.deepEqual(roll.params.modifiers, [], "not off-guard: no −2");
});

test("the DC is the item's own save, not an addiction's printed before it; Powerful Alchemy's stamp compares against it too (8.10.4)", () => {
    const html = `<p>Addiction @Check[fortitude|dc:28]</p><p><strong>Saving Throw</strong> @Check[fortitude|dc:24]</p><p><strong>Stage 1</strong> drained 1 (1 hour)</p>`;
    const item = { system: { description: { value: html }, traits: { value: ["infused", "poison"] } } };
    assert.deepEqual(defs.exposureDc({ def: { save: { type: "fortitude", value: 24 }, origin: "parse" }, item, holder: hero }), { value: 24, source: "inline" });
    const alchemist = addDocument("Actor", { name: "Alch", type: "character", items: [{ type: "feat", name: "Powerful Alchemy", system: { slug: "powerful-alchemy" },
        _stats: { compendiumSource: REGISTRY["powerful-alchemy"].uuid } }] });
    alchemist.classDCs = { alchemist: { dc: { value: 26 } } };
    const stamp = defs.dcStampFor(alchemist, item);
    assert.deepEqual([stamp?.value, stamp?.printed], [26, 24], "26 beats the poison's own 24");
    assert.equal(defs.inlineDcFor(item, alchemist), 26);
});

test("a re-exposure's save gets the initial save's modifiers: holding one's breath (8.10.6)", async () => {
    await exposeTo([hero]);
    const { pending } = await rollAndRecord(hero, "failure");
    await exposeTo([hero], { key: "msg00000002", delivery: "inhaled", heldBreath: true });
    const second = claimsOf().find((c) => !c.resolved);
    assert.equal(second.pending.kind, "re-exposure");
    world.outcomes.push("success");
    await afflictions.rollSave(hero, { runId: pending.runId, seq: second.pending.seq }, { skipDialog: true });
    assert.deepEqual(world.saveRolls.at(-1).params.modifiers.map((m) => [m.slug, m.modifier]), [["held-breath", 2]]);
});

test("a homebrew poison (no compendium source) keeps running once its dose is gone, and its coating still exposes (8.10.2)", async () => {
    const own = poison.toObject();
    const homebrew = hero.addItem({ ...own, name: "Homebrew Toxin", system: { ...own.system, quantity: 1 } });
    const result = await afflictions.expose({ item: homebrew, targets: [hero], delivery: "injury", key: "msg0000000hb1" });
    assert.equal(result.ok, true, JSON.stringify(result));
    await settle();
    await claims.sweepClaims();
    const { pending } = await rollAndRecord(hero, "failure");
    // The dose is used up and the client reloads (no parse cache): the tracker's own copy of the definition runs it.
    hero.items.delete(homebrew.id);
    world.uuids.delete(homebrew.uuid);
    defs.resetDefinitions();
    afflictions.resetAfflictions();
    game.time.worldTime = 1006;
    await afflictions.processAfflictions();
    assert.deepEqual(afflictions.runOf(hero.items.get(pending.runId)).pending, { seq: 2, kind: "stage", dueAt: 1006 });
    // A weapon coated with the last homebrew dose: the Strike still exposes.
    const weapon = hero.addItem({ type: "weapon", name: "Dagger", system: { slug: "dagger" } });
    const last = hero.addItem({ ...own, name: "Homebrew Toxin", system: { ...own.system, quantity: 1 } });
    assert.equal((await coatings.applyPoison({ poison: last, weapon, actor: hero })).ok, true);
    assert.equal(hero.items.get(last.id), undefined, "the last dose is spent");
    world.uuids.delete(last.uuid);
    defs.resetDefinitions();
    await coatings.onStrikeMessage(strikeMessage(hero.items.get(weapon.id), "attack-roll", { context: { outcome: "success" } }));
    const hit = await coatings.onStrikeMessage(strikeMessage(hero.items.get(weapon.id), "damage-roll", { damageRoll: { types: { piercing: { base: 4 } } } }));
    assert.equal(hit.exposed?.ok, true, JSON.stringify(hit.exposed));
    assert.equal(claimsOf().find((c) => c.actor === ogre.uuid).def.stages.length, 3, "the claim carries the definition");
});

test("a coated piece of ammunition rides its launcher's Strike: selected when coated, armed at the hit, exposing at the damage roll (8.10.5)", async () => {
    const arrows = hero.addItem({ type: "ammo", name: "Arrows", system: { quantity: 10, slug: "arrows" } });
    const bow = hero.addItem({ type: "weapon", name: "Shortbow", system: { slug: "shortbow", selectedAmmoId: arrows.id } });
    const dose = hero.addItem({ type: "consumable", name: "Test Toxin", system: { quantity: 1, slug: "test-toxin", level: { value: 2 },
        traits: { value: ["alchemical", "consumable", "injury", "poison"] }, description: poison.system.description }, _stats: { compendiumSource: poison.uuid } });
    const applied = await coatings.applyPoison({ poison: dose, weapon: arrows, actor: hero });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    const piece = hero.items.get(applied.host);
    assert.deepEqual([piece.system.quantity, hero.items.get(arrows.id).system.quantity], [1, 9]);
    assert.equal(hero.items.get(bow.id).system.selectedAmmoId, piece.id, "the bow now fires the coated piece");
    const armed = await coatings.onStrikeMessage(strikeMessage(hero.items.get(bow.id), "attack-roll", { context: { outcome: "success", options: [`item:ammo:id:${piece.id}`] } }));
    assert.equal(armed?.outcome, "armed");
    hero.items.delete(piece.id);   // pf2e consumes the fired piece after the attack roll
    const hit = await coatings.onStrikeMessage(strikeMessage(hero.items.get(bow.id), "damage-roll", { damageRoll: { types: { piercing: { base: 4 } } } }));
    assert.equal(hit?.outcome, "exposed");
    assert.equal(claimsOf()[0].actor, ogre.uuid);
    assert.equal(hero.items.get(bow.id).flags[MOD]?.ammoStrike, undefined, "nothing stays armed on the bow");
    // A hit whose damage is never rolled, then a shot with an uncoated arrow: the earlier piece's coating does not ride it.
    const next = await coatings.applyPoison({ poison: hero.addItem({ ...dose.toObject(), _id: undefined }), weapon: hero.items.get(arrows.id), actor: hero });
    await coatings.onStrikeMessage(strikeMessage(hero.items.get(bow.id), "attack-roll", { context: { outcome: "success", options: [`item:ammo:id:${next.host}`] } }));
    hero.items.delete(next.host);
    await coatings.onStrikeMessage(strikeMessage(hero.items.get(bow.id), "attack-roll", { context: { outcome: "success", options: [`item:ammo:id:${arrows.id}`] } }));
    assert.equal(hero.items.get(bow.id).flags[MOD]?.ammoStrike, undefined, "a new attack clears it");
    assert.equal(await coatings.onStrikeMessage(strikeMessage(hero.items.get(bow.id), "damage-roll", { damageRoll: { types: { piercing: { base: 4 } } } })), null);
    assert.equal(claimsOf().length, 1);
});

test("a Double Poison exposure is keyed as the double, not as its second poison (8.10.5, 8.10.6)", async () => {
    const second = compendiumPoison({ id: "toxinCompendium2", name: "Second Toxin", traits: ["alchemical", "consumable", "injury", "infused", "poison"] });
    hero.addItem({ type: "feat", name: "Double Poison", system: { slug: "double-poison" }, _stats: { compendiumSource: REGISTRY["double-poison"].uuid } });
    const weapon = hero.addItem({ type: "weapon", name: "Dagger", system: { slug: "dagger" } });
    const doseOf = (doc) => hero.addItem({ type: "consumable", name: doc.name, system: { quantity: 1, level: { value: 2 },
        traits: { value: ["alchemical", "consumable", "injury", "infused", "poison"] }, description: doc.system.description }, _stats: { compendiumSource: doc.uuid } });
    assert.equal((await coatings.applyPoison({ poison: doseOf(poison), weapon, actor: hero })).ok, true);
    const doubled = await coatings.applyPoison({ poison: doseOf(second), weapon, actor: hero, double: true });
    assert.equal(doubled.ok, true, JSON.stringify(doubled));
    await coatings.onStrikeMessage(strikeMessage(hero.items.get(weapon.id), "attack-roll", { context: { outcome: "success" } }));
    await coatings.onStrikeMessage(strikeMessage(hero.items.get(weapon.id), "damage-roll", { damageRoll: { types: { piercing: { base: 4 } } } }));
    assert.equal(claimsOf()[0].defKey, `double:${poison.uuid}:${second.uuid}`);
});
