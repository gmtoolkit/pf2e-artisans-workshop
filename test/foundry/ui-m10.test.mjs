/**
 * The window's parts of the extension API over the fake world (DESIGN.md 12, M10): an extension's activities among a
 * character's choices (and an Aid to a member whose days go to one), their days and stops in words, the wizard's checks
 * step offering an extension activity's check, and every M10 label a key in lang/en.json.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { addDocument, coin, installFoundry, resetWorld, setUsers, sharedWorld, world } from "./stubs.mjs";
import { EXT_ID, registerTestExtension } from "./ext-fixture.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));
const testLang = { "TEST.Study": "Study the stars", "TEST.Rest": "Rest", "TEST.NotBo": "Bo never rests." };
game.i18n.lang = "en";
game.i18n.localize = (key) => lang[key] ?? testLang[key] ?? key;
game.i18n.format = (key, data) => (lang[key] ?? key).replace(/\{(\w+)\}/g, (_m, name) => String(data?.[name] ?? ""));
CONFIG.PF2E = { skills: { society: { label: "Society" } }, rarityTraits: {} };
foundry.applications.api.ApplicationV2 = class {
    constructor(options = {}) { this.options = options; this.tabGroups = { primary: "queue" }; this.window = {}; this.children = []; }
    get state() { return 0; }
    async _prepareContext() { return { tabs: {} }; }
};

const { RANK } = await import("../../scripts/logic/core.mjs");
const { extRowInput, extRunId } = await import("../../scripts/logic/extensions.mjs");
const { makeRow } = await import("../../scripts/logic/rows.mjs");
const { fundsView } = await import("../../scripts/logic/views.mjs");
const settings = await import("../../scripts/foundry/settings.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const ext = await import("../../scripts/foundry/extensions.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { write } = await import("../../scripts/foundry/store.mjs");
const labels = await import("../../scripts/ui/labels.mjs");
const { AdvanceDaysApp } = await import("../../scripts/ui/advance.mjs");
const { activityText, dayLines, stopText } = await import("../../scripts/ui/days.mjs");
const { activityOptions } = await import("../../scripts/ui/downtime.mjs");

settings.registerSettings({ enabled: () => {}, docs: () => {} });

let vera;
let bo;
const statistic = (slug, rank) => ({ slug, rank, label: slug, roll: async () => ({ total: 20 }) });

beforeEach(async () => {
    resetWorld();
    state.resetState();
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    const docs = sharedWorld();
    vera = addDocument("Actor", { name: "Vera", ownership: { default: 0, p1: 3 }, items: [] });
    Object.assign(vera, { level: 5, skills: { society: statistic("society", RANK.expert) }, system: {} });
    bo = addDocument("Actor", { name: "Bo", ownership: { default: 0, p2: 3 }, items: [] });
    Object.assign(bo, { level: 5, skills: { society: statistic("society", RANK.trained) }, system: {} });
    world.collections.Actor.party = { id: "party", name: "Heroes", members: [vera, bo] };
    setUsers([{ id: "p1", character: vera }, { id: "p2", character: bo }, { id: "gm00000000000000", isGM: true }], "p1");
    state.setShared({ ...docs, status: "ready" });
    game.modules.set(EXT_ID, { id: EXT_ID, title: "Test Extension", active: true });
    registerTestExtension(ext.resetExtensions({ open: true }));
    game.time.worldTime = 2 * 86400;
    await write({ set: {
        [`pcs.${vera.id}`]: { id: vera.id, v: 1, inDowntime: true, since: 0, activity: { kind: "ext", ref: `${EXT_ID}.study` } },
        [`pcs.${bo.id}`]: { id: bo.id, v: 1, inDowntime: true, since: 0, activity: null },
    } });
});

test("an extension's activities are among a character's choices, and an Aid to a member whose days go to one that has an Aid", () => {
    const boChoices = activityOptions(bo, null).map((o) => [o.value, o.label]);
    assert.ok(boChoices.some(([v, l]) => v === `ext:${EXT_ID}.study` && l === "Study the stars"));
    assert.ok(boChoices.some(([v, l]) => v === `ext:${EXT_ID}.rest` && l === "Rest"));
    assert.ok(boChoices.some(([v, l]) => v === `ext:${EXT_ID}.study:${vera.id}` && l === "Aiding Vera: Study the stars"));
    const veraChoices = activityOptions(vera, { kind: "ext", ref: `${EXT_ID}.study` });
    assert.ok(!veraChoices.some((o) => o.value.endsWith(`:${bo.id}`)), "nobody to aid: Bo's days go nowhere yet");
    assert.ok(veraChoices.find((o) => o.value === `ext:${EXT_ID}.study`).selected);
});

test("extension days and stops in words, by the extension's own label", () => {
    assert.equal(activityText({ kind: "ext", ref: `${EXT_ID}.study` }), "Study the stars");
    assert.equal(activityText({ kind: "ext", ref: "gone-ext.x" }), lang["pf2e-artisans-workshop.Ext.Unknown"]);
    const records = [
        { day: 1, toDay: 1, activity: { kind: "ext", ref: `${EXT_ID}.study` }, ext: { n: 1 } },
        { day: 2, toDay: 2, activity: { kind: "ext", ref: `${EXT_ID}.study` }, ext: { n: 2 } },
        { day: 1, toDay: 1, activity: { kind: "ext", ref: `${EXT_ID}.study`, aid: vera.id }, ext: { n: 1 } },
    ];
    assert.deepEqual(dayLines(records), ["2 days: Study the stars", "1 day aiding Vera: Study the stars"]);
    assert.equal(stopText({ day: 2, reason: "ext-check", ref: "r", activity: `${EXT_ID}.study`, from: 1, aid: null }),
        "Day 2: Study the stars needs its check before its last day. Roll it, then resolve the rest.");
    assert.equal(stopText({ day: 3, reason: "ext-ineligible", ref: `${EXT_ID}.rest`, why: "TEST.NotBo" }), "Day 3: Rest cannot start for this character. Bo never rests.");
});

test("the wizard's checks step offers an extension activity's check to its owner, with the run's first day", async () => {
    const app = new AdvanceDaysApp({ mode: "advance" });
    app.wizard.step = "checks";
    const context = await app._prepareContext({});
    const due = context.checks.due.find((d) => d.kind === "ext");
    assert.deepEqual([due.ref, due.from, due.aid, due.canRoll, due.text], [`${EXT_ID}.study`, 1, "", true, "Vera: the check for Study the stars"]);
    world.currentUser = "p2";
    const other = new AdvanceDaysApp({ mode: "advance" });
    other.wizard.step = "checks";
    assert.equal((await other._prepareContext({})).checks.due.find((d) => d.kind === "ext").canRoll, false, "Player Two may not roll Vera's check");
    const run = extRunId(vera.id, `${EXT_ID}.study`, 1);
    await write({ set: { [`extRuns.${run}`]: { id: run, v: 1, actor: vera.uuid, actorId: vera.id, activity: `${EXT_ID}.study`, from: 1, check: { degree: 2 } } } });
    world.currentUser = "p1";
    const after = await app._prepareContext({});
    assert.equal(after.checks.due.some((d) => d.kind === "ext"), false, "rolled: nothing due");
});

test("an extension's row shows the note it was posted with in the Funds tab's ledger, so members can tell what a row they reverse was for", () => {
    const made = extRowInput({ kind: "expense", cp: 5000, key: "upgrade.tickets.p1", source: `${EXT_ID}:upgrades`, note: "Circus upgrade: tickets" });
    const row = { ...makeRow(made.input, { by: "p1", at: { real: 1, world: 0 } }), state: "applied" };
    const view = fundsView({ rows: [row], actualCp: 0, viewer: { userId: "p1", isGM: false, owns: () => true }, nameOf: () => null, userName: (id) => id });
    assert.equal(view.ledger[0].note, "Circus upgrade: tickets");
    const funds = readFileSync(join(ROOT, "templates/workshop/funds.hbs"), "utf8");
    const entry = funds.match(/<tr data-row-id="\{\{id\}\}"[\s\S]*?<\/tr>/)[0].match(/<td>\{\{localize kindLabel\}\}.*?<\/td>/)[0];
    assert.match(entry, /\{\{#if note\}\}.*\{\{note\}\}.*\{\{\/if\}\}/, "the Entry cell shows the row's note beside its kind");
});

test("every M10 label is a key in lang/en.json", () => {
    for (const reason of ["ext-unknown", "ext-ineligible", "ext-check", "ext-aid-check"]) assert.ok(lang[labels.DAY_STOP[reason]], reason);
    for (const key of Object.values(labels.REFUSAL)) assert.ok(lang[key], key);
    for (const key of ["Ext.ApiMismatch", "Ext.AidModifier", "Ext.RollDC", "Ext.Roll", "Ext.RollAid", "Ext.Unknown", "Activity.Ext", "Activity.ExtAid",
        "Days.Ext", "Days.ExtOne", "Days.ExtAid", "Days.ExtAidOne", "Wizard.Due.Ext", "Wizard.Due.ExtAid", "Bandolier.Spend", "Bandolier.SpendLabel",
        "Morning.Sinks", "Morning.SinkLine"]) {
        assert.ok(lang[`pf2e-artisans-workshop.${key}`], key);
    }
});
