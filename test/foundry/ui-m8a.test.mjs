/**
 * The affliction tracker's interface over the fake world (DESIGN.md 8.10.9, 10.2, 10.5, M8a): the Afflictions window's view
 * (pending saves, the stage list with the parsed parts, the next save, the buttons an owner gets and a player who does not own
 * the creature does not), the save prompt card (one per save and state, its buttons by kind, a player's own card after a
 * "waiting for the player" card), no stage card for a successful initial save, and the Workshop header's count. Every label
 * the interface uses is a key of the language file.
 *
 * ApplicationV2 is faked with Foundry 14.368's read-only properties as getters, so code that assigns one fails here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { FakeCollection, addDocument, coin, installFoundry, setUsers, sharedWorld, world, resetWorld } from "./stubs.mjs";
import { asCreature, compendiumPoison, installPf2eAfflictions } from "./pf2e-afflictions.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
game.i18n.localize = (key) => lang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
foundry.applications.api.ApplicationV2 = class {
    #state = 0;
    constructor(options = {}) { this.options = Object.freeze({ ...options }); }
    get state() { return this.#state; }
    get rendered() { return this.#state === 2; }
    get element() { return null; }
    async render() { this.#state = 2; return this; }
    async close() { this.#state = -1; return this; }
};

const MOD = "pf2e-artisans-workshop";
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const claims = await import("../../scripts/foundry/claims.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const downtime = await import("../../scripts/foundry/downtime.mjs");
const defs = await import("../../scripts/foundry/affliction-defs.mjs");
const afflictions = await import("../../scripts/foundry/afflictions.mjs");
const ui = await import("../../scripts/ui/afflictions.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

let hero;
let poison;
const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const cards = () => world.collections.ChatMessage.filter((m) => m.flags?.[MOD]?.card);

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    claims.resetClaims();
    downtime.resetDowntime();
    afflictions.resetAfflictions();
    defs.resetDefinitions();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    installPf2eAfflictions();
    const docs = sharedWorld();
    poison = compendiumPoison();
    game.combats = new FakeCollection();
    game.time.worldTime = 1000;
    game.modules = new Map([[MOD, { id: MOD, version: "0.0.0" }]]);
    ChatMessage.implementation.getSpeaker = () => ({});
    world.render = (path, data) => JSON.stringify({ path, data });
    hero = asCreature(addDocument("Actor", { name: "Hero", type: "character", ownership: { default: 0, p1: 3 }, items: [] }), { level: 4 });
    setUsers([{ id: "p1", character: hero }, { id: "p2" }, { id: "gm00000000000000", isGM: true }], "p1");
    world.settings.set(`${MOD}.enabled`, true);
    state.setShared({ ...docs, status: "ready" });
    requestLease("p1");
    registerBatchWatcher();
    afflictions.registerAfflictionHooks();
    ui.registerAfflictionUi();
});

/** Expose the hero and record a failed initial save. */
async function afflicted() {
    await afflictions.expose({ item: poison, targets: [hero], delivery: "injury", key: "msg00000001" });
    await settle();
    await claims.sweepClaims();
    const pending = afflictions.pendingOf(hero)[0];
    world.outcomes.push("failure");
    await afflictions.rollSave(hero, { runId: pending.runId, seq: pending.seq }, { skipDialog: true });
    await afflictions.onAfflictionMessage(world.lastMessage);
    await settle();
    return pending.runId;
}

test("the save prompt: one card per save and state, Roll for the owner, the injury exposure's void button; the window lists the pending save (8.10.8, 8.10.9)", async () => {
    await afflictions.expose({ item: poison, targets: [hero], delivery: "injury", key: "msg00000001" });
    await settle();
    await claims.sweepClaims();
    const prompts = cards().filter((m) => m.flags[MOD].card.kind === "affliction-prompt");
    assert.equal(prompts.length, 1);
    const { data } = JSON.parse(prompts[0].content);
    assert.deepEqual(data.buttons.map((b) => b.op), ["roll", "void"], "an injury exposure can be voided from the prompt");
    assert.ok(data.lines.some((l) => l.text.includes("18")), "the DC where pf2e shows DCs");
    assert.deepEqual(prompts[0].whisper.sort(), ["gm00000000000000", "p1"], "to the victim's owner and GMs");
    afflictions.resetAfflictions();
    await claims.sweepClaims();
    assert.equal(cards().filter((m) => m.flags[MOD].card.kind === "affliction-prompt").length, 1, "the card is there already: not posted again");
    const view = await ui.afflictionsView();
    assert.equal(view.actors.length, 1);
    assert.equal(view.actors[0].pending.length, 1);
    assert.equal(view.actors[0].pending[0].canRoll, true);
    assert.equal(view.actors[0].pending[0].canVoid, true);
});

test("after the waiting card for an offline player, the player's own card is posted when they connect (8.10.8)", async () => {
    const pending = { victim: hero, runId: "run0000000000001", seq: 1, kind: "stage", def: { save: { type: "fortitude" } } };
    await ui.postPromptCard({ ...pending, waiting: "owner" });
    await ui.postPromptCard({ ...pending, waiting: "owner" });
    await ui.postPromptCard({ ...pending, waiting: null });
    const prompts = cards().filter((m) => m.flags[MOD].card.kind === "affliction-prompt");
    assert.equal(prompts.length, 2);
    const first = JSON.parse(prompts[0].content).data;
    assert.equal(first.buttons[0].gm, true, "roll for them: a GM's button");
    assert.equal(JSON.parse(prompts[1].content).data.buttons[0].gm, false);
});

test("the window: the stage list with its parsed parts, the next save, the owner's buttons; a player who does not own it sees nothing (8.10.9)", async () => {
    const runId = await afflicted();
    const view = await ui.afflictionsView();
    const tracker = view.actors[0].trackers[0];
    assert.equal(tracker.runId, runId);
    assert.equal(tracker.stageText, "Stage 1 of 3");
    assert.equal(tracker.nextText, "Next save in 1 rounds.");
    assert.equal(tracker.maxText, "Ends in 6 rounds at most.");
    assert.equal(tracker.stages.length, 3);
    assert.equal(tracker.stages[0].current, true);
    assert.match(tracker.stages[0].parts, /1d6/);
    assert.equal(tracker.stages[0].interval, "1 rounds");
    assert.equal(tracker.canEdit, true);
    world.currentUser = "p2";
    assert.deepEqual((await ui.afflictionsView()).actors, [], "Player Two owns nothing here");
    world.currentUser = "gm00000000000000";
    assert.equal((await ui.afflictionsView()).actors.length, 1, "a GM sees every creature");
});

test("no stage card for a successful initial save; a stage card for a failure; the header counts the pending saves (8.10.9, 10.2)", async () => {
    await afflictions.expose({ item: poison, targets: [hero], delivery: "injury", key: "msg00000002" });
    await settle();
    await claims.sweepClaims();
    assert.equal(ui.pendingBadge([hero]), 1, "the initial save is pending");
    const pending = afflictions.pendingOf(hero)[0];
    world.outcomes.push("success");
    await afflictions.rollSave(hero, { runId: pending.runId, seq: 1 }, { skipDialog: true });
    await afflictions.onAfflictionMessage(world.lastMessage);
    await settle();
    assert.equal(cards().filter((m) => m.flags[MOD].card.kind === "affliction-stage").length, 0);
    assert.equal(ui.pendingBadge([hero]), 0);
    await afflicted();
    assert.equal(cards().filter((m) => m.flags[MOD].card.kind === "affliction-stage").length, 1);
});

test("every label the affliction interface uses is a key of the language file", () => {
    const sources = ["scripts/ui/afflictions.mjs", "scripts/foundry/afflictions.mjs", "scripts/foundry/coatings.mjs", "templates/afflictions/drawer.hbs",
        "templates/afflictions/define.hbs", "templates/chat/affliction.hbs"].map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
    const keys = [...sources.matchAll(/pf2e-artisans-workshop\.(?:Affliction|Refusal|Settings)\.[A-Za-z.]+[A-Za-z]/g)].map((m) => m[0]);
    assert.ok(keys.length > 60);
    assert.deepEqual(keys.filter((k) => !(k in lang)), []);
});
