/**
 * The M9a live-harness steps and plans, as far as they run without a browser (DESIGN.md 15.3 scenario 13): every step a plan
 * calls exists and says what it does, the plans are registered, and the items and feats the plans use are compendium UUIDs;
 * with PF2E_SRC set, they and the variants' own UUIDs exist in the pf2e checkout.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { installFoundry } from "./stubs.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
foundry.applications.api.ApplicationV2 = class {};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { VARIANT_UUIDS } = await import("../../scripts/data/variants.mjs");
const { CRAFT_SCENARIOS } = await import("../../tools/harness/craft-scenarios.mjs");
const { VARIANT_SCENARIOS } = await import("../../tools/harness/variant-scenarios.mjs");
const { BEHAVIOURS, M9A } = await import("../../tools/harness/live-plans.mjs");

test("every m9a step the plans call exists and says what it does; every m9a plan is registered", () => {
    const source = readFileSync(join(ROOT, "tools/harness/live-plans.mjs"), "utf8");
    const called = new Set([...source.matchAll(/"m9a", "(\w+)"/g)].map((m) => m[1]));
    assert.ok(called.size >= 20, [...called].join(", "));
    const steps = VARIANT_SCENARIOS.m9a;
    for (const name of called) assert.equal(typeof steps[name]?.run, "function", name);
    for (const step of Object.values(steps).filter((s) => typeof s === "object")) assert.equal(typeof step.about, "string");
    const m9 = new Set([...source.slice(source.indexOf("M9a: Treasure Vault")).matchAll(/"m9", "(\w+)"/g)].map((m) => m[1]));
    for (const name of m9) assert.equal(typeof CRAFT_SCENARIOS.m9[name]?.run, "function", `m9 ${name}`);
    for (const id of ["m9a-notice", "m9a-complex", "m9a-quick-setup", "m9a-deconstruct", "m9a-grow", "m9a-garden", "m9a-quest", "m9a-adjust", "m9a-secret", "m9a-shots"]) {
        assert.equal(typeof BEHAVIOURS[id], "function", id);
    }
});

test("the plans' items are compendium UUIDs, and Quick Setup is the registry's and the variants'", () => {
    for (const uuid of Object.values(M9A)) assert.match(uuid, /^Compendium\.pf2e\.(equipment|feats)-srd\.Item\.[A-Za-z0-9]{16}$/);
    assert.equal(M9A.quickSetup, REGISTRY["quick-setup"].uuid);
    assert.equal(VARIANT_UUIDS.quickSetup, REGISTRY["quick-setup"].uuid);
});

const NEEDS_SOURCE = { skip: !process.env.PF2E_SRC && "set PF2E_SRC to a pf2e checkout" };
/** Every document id (and journal page id) of a pf2e source pack. */
function packIds(pack) {
    const walk = (dir) => readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".json") ? [join(dir, e.name)] : []));
    const ids = new Set();
    for (const file of walk(join(process.env.PF2E_SRC, "packs/pf2e", pack))) {
        const doc = JSON.parse(readFileSync(file, "utf8"));
        ids.add(doc._id);
        for (const page of doc.pages ?? []) ids.add(`${doc._id}.JournalEntryPage.${page._id}`);
    }
    return ids;
}

test("the plans' items and the variants' actions, feat and journal page exist in the pf2e checkout", NEEDS_SOURCE, () => {
    const equipment = packIds("equipment");
    const feats = packIds("feats");
    const actions = packIds("actions");
    const journals = packIds("journals");
    for (const uuid of Object.values(M9A)) {
        const id = uuid.split(".").at(-1);
        assert.ok((uuid.includes("feats-srd") ? feats : equipment).has(id), uuid);
    }
    assert.ok(actions.has(VARIANT_UUIDS.deconstruct.split(".").at(-1)), "Deconstruct");
    assert.ok(actions.has(VARIANT_UUIDS.grow.split(".").at(-1)), "Grow");
    assert.ok(feats.has(VARIANT_UUIDS.quickSetup.split(".").at(-1)), "Quick Setup");
    assert.ok(journals.has(VARIANT_UUIDS.downtimeEvents.replace("Compendium.pf2e.journals.JournalEntry.", "")), "GM Screen: Downtime Events");
});

/* -------------------------------------------- */
/*  After the M9a live pass                      */
/* -------------------------------------------- */

const { M9_FACE } = await import("../../tools/harness/live-plans.mjs");
const { VARIANT_WRITE, faceFor, storedPath } = await import("../../tools/harness/variant-scenarios.mjs");

/** The fixtures the M9a plans name, as `prepareWorld` lists them. */
const WORLD = () => ({
    fixtures: [["alc", "legacy-alchemist-3"], ["dru", "druid-grower-8"]],
    pcs: { p1: { id: "p1", uuid: "Actor.p1" }, p2: { id: "p2", uuid: "Actor.p2" } }, strays: [], party: { id: "party" },
});

/**
 * A harness that runs a plan without a browser: every client ready, each step answered from `answers` (by "<scenario>.<step>",
 * a value or a function of the params and the client), the server view reconciled, and every check and step call recorded.
 */
function fakeHarness(answers) {
    const checks = [];
    const calls = [];
    const h = {
        clients: new Map([["gm", {}], ["p1", {}], ["p2", {}]]), shots: [], label: "test", canvas: false,
        only: async () => {}, settle: async () => {}, closeAll: async () => {}, collectPages: async () => ({}),
        evaluate: async (client, fn) => {
            if (fn.name === "pageStatus") return "ready";
            if (fn.name === "pageServerView") return { rows: [{ idem: "shelve:1", state: "applied" }], expectedCp: 0, actualCp: 0, strongboxes: [{ shelf: 0 }] };
            return { status: "ready" };
        },
        screenshot: async (client, file, size, fn) => fn(),
        step: async (client, scenario, step, params) => {
            calls.push({ client, scenario, step, params });
            const answer = answers[`${scenario}.${step}`];
            return structuredClone(typeof answer === "function" ? answer(params, client) : answer ?? {});
        },
        check: (name, ok, detail) => {
            checks.push({ name, ok: !!ok, detail });
            return !!ok;
        },
    };
    return { h, checks, calls };
}

/** Answers under which every M9a order is filed, rushed and started as its plan wants, and its check fails. */
const failedChecks = () => ({
    "m9.give": { uuid: "Actor.p2.Item.cloak" },
    "m9.request": (p) => ({ ok: true, order: "ord1", brief: { craftType: p.craftType ?? "item", target: p.target ?? null } }),
    "m9a.rush": { result: { ok: true }, order: { variant: { rushRequest: 1 } } },
    "m9a.checklist": { ok: true },
    "m9a.followOn": { ok: true },
    "m5.gates": { failing: [["G9", "workshop"]] },
    "m9a.start": { start: { ok: true }, order: { priceCp: 0, setup: { days: 1 }, variant: {}, days: [] } },
    "m9a.work": { results: [], order: { status: "failed", check: { degree: 1 }, days: [] } },
    "m9a.setUpNow": { result: { ok: false, reason: "downtime-day" } },
    "m9a.order": { status: "failed", skill: "nature", setup: { days: 1 }, variant: { complex: { rush: 1 } }, dc: { adjust: 5 }, check: { degree: 1 },
        days: [{ kind: "setup" }] },
    "m9.run": { steps: [], order: { status: "failed", priceCp: 1200 } },
});

test("a plan that crafts, deconstructs or grows records a failed check when its check fails, rather than passing on the branch it skips", async () => {
    for (const [id, pattern] of [["m9a-complex", /succeeds at the fixed die/], ["m9a-deconstruct", /the Deconstruct completes/], ["m9a-grow", /Grow check succeeds/],
        ["m9a-adjust", /crafted at the fixed die/]]) {
        const { h, checks } = fakeHarness(failedChecks());
        await BEHAVIOURS[id](h, WORLD());
        const found = checks.filter((c) => pattern.test(c.name));
        assert.ok(found.length > 0 && found.every((c) => c.ok === false), `${id}: ${JSON.stringify(checks.map((c) => [c.name, c.ok]))}`);
    }
});

test("every check the M9a crafting plans roll has its die fixed: a face, or the degree it aims for", async () => {
    let rolls = 0;
    for (const id of ["m9a-complex", "m9a-deconstruct", "m9a-grow", "m9a-adjust"]) {
        const { h, calls } = fakeHarness(failedChecks());
        await BEHAVIOURS[id](h, WORLD());
        for (const call of calls.filter((c) => (c.scenario === "m9" && c.step === "run") || (c.scenario === "m9a" && c.step === "roll"))) {
            rolls += 1;
            const { face, degree } = call.params;
            assert.ok((Number.isInteger(face) && face >= 2 && face <= 19) || [0, 1, 2, 3].includes(degree), `${id}: ${JSON.stringify(call.params)}`);
        }
    }
    assert.equal(rolls, 5);
});

/** Answers for m9a-secret: a blind roll, read by each client as `views` says. */
const secretAnswers = (views) => ({
    "m4.request": { ok: true, order: "ord1" }, "m9a.special": { ok: true }, "m4.roll": { recorded: true },
    "m9a.view": (p, client) => (p.ms === 1500 ? { ...views.gm, user: "p2", secretCheck: false } : { ...views[client] }),
    "m9a.reveal": { result: { ok: true } },
});

test("m9a-secret fails when a player can read the blind card's content, and passes when only the GM can", async () => {
    const gm = { blind: true, visible: true, secretCheck: false, checkText: "success" };
    const hidden = { blind: true, visible: false, secretCheck: true, checkText: "rolled (secret)" };
    const leaked = fakeHarness(secretAnswers({ gm, p1: { ...hidden, visible: true }, p2: hidden }));
    await BEHAVIOURS["m9a-secret"](leaked.h, WORLD());
    assert.equal(leaked.checks.find((c) => c.name.startsWith("the card's content is hidden"))?.ok, false);
    const blind = fakeHarness(secretAnswers({ gm, p1: hidden, p2: hidden }));
    await BEHAVIOURS["m9a-secret"](blind.h, WORLD());
    assert.deepEqual(blind.checks.filter((c) => !c.ok).map((c) => c.name), []);
});

/** Answers for m9a-off: M4's lifecycle to the delivery, then the audit and the markers as given. */
const offAnswers = ({ flagged = [], markers = {}, kinds = ["item", "upgrade", "service"] } = {}) => {
    const clean = { markers: [], words: [] };
    const tabs = (client) => Object.fromEntries(["queue", "funds", "downtime"].map((t) => [t, { open: true, ...clean, markers: markers[`${client}.${t}`] ?? [] }]));
    return {
        "m9a.variants": { groups: [], mixed: false },
        "m4.request": { ok: true, order: "ord1" }, "m4.pledge": { ok: true }, "m4.accept": { ok: true }, "m4.start": { ok: true },
        "m4.work": (p) => (p.until === "check" ? { order: { status: "check" } } : { order: { status: "finishing", priceCp: 600, upfrontCp: 300,
            check: { degree: 3, settled: true }, settlement: { attempt: 1 }, days: [{ kind: "extra", crafterCp: 300 }] } }),
        "m4.roll": (p) => ({ recorded: true, face: p.face }),
        "m4.finish": { result: { ok: true }, order: { status: "complete" } },
        "m4.waitDelivered": { delivered: true, count: 1 },
        "m4.state": { cards: ["request", "accepted", "started", "complete"], shelf: [] },
        "m9a.audit": (p) => (p.start ? { started: true, at: 1000 } : { running: true, writes: 40, keys: ["flags.pf2e-artisans-workshop.orders.ord1.status"], flagged, byHook: {} }),
        "m9a.markers": (p, client) => ({ texts: 120, tabs: tabs(client), request: { open: true, ...clean, kinds }, chat: { cards: 4, ...clean } }),
        "m9a.notice": { notice: null },
    };
};

test("m9a-off runs M4's lifecycle at a fixed die under a write audit, and fails on a variant write, a variant marker or a variant kind", async () => {
    const pass = fakeHarness(offAnswers());
    await BEHAVIOURS["m9a-off"](pass.h, WORLD());
    assert.deepEqual(pass.checks.filter((c) => !c.ok).map((c) => c.name), []);
    assert.equal(pass.calls.find((c) => c.scenario === "m4" && c.step === "roll").params.face, M9_FACE);
    const started = pass.calls.findIndex((c) => c.step === "audit" && c.params.start);
    assert.ok(started >= 0 && started < pass.calls.findIndex((c) => c.scenario === "m4" && c.step === "request"), "the audit starts before the request");

    const failing = (answers, pattern) => async () => {
        const run = fakeHarness(answers);
        await BEHAVIOURS["m9a-off"](run.h, WORLD());
        assert.ok(run.checks.some((c) => pattern.test(c.name) && !c.ok), JSON.stringify(run.checks.map((c) => [c.name, c.ok])));
    };
    await failing(offAnswers({ flagged: [{ key: "flags.pf2e-artisans-workshop.orders.ord1.check.secret" }] }), /no write only a variant makes/)();
    await failing(offAnswers({ markers: { "p2.queue": [".detail-variants"] } }), /no variant button/)();
    await failing(offAnswers({ kinds: ["item", "deconstruct", "service"] }), /no variant kind/)();
});

test("the write audit's pattern flags what only a variant writes, and not an order's own records or M9's variant fields", () => {
    const MOD = "pf2e-artisans-workshop";
    const flagged = [
        `flags.${MOD}.orders.o1.variant.complex.rush`, `flags.${MOD}.orders.o1.variant.rushRequest`, `flags.${MOD}.orders.o1.variant.special`,
        `flags.${MOD}.orders.o1.check.critical.kind`, `flags.${MOD}.orders.o1.check.secret`, `flags.${MOD}.orders.o1.check.rushFlat.dc`,
        `flags.${MOD}.orders.o1.events.1-1.roll`, `flags.${MOD}.orders.o1.checklist.workshop.at`, `flags.${MOD}.orders.o1.checklist.grow-tools`, `flags.${MOD}.gardens.g1.seedCostCp`,
        `flags.${MOD}.orders.o1.dc.adjust`, `flags.${MOD}.orders.o1.setup.hours`, `flags.${MOD}.components.valueCp`, `flags.${MOD}.inert`,
        `flags.${MOD}.produce.garden`, `flags.${MOD}.rushFlat.order`, `flags.${MOD}.appliedTo.host`, `flags.${MOD}.orders.o1.variantNote.text`,
    ];
    const plain = [
        `flags.${MOD}.orders.o1.variant`, `flags.${MOD}.orders.o1.events`, `flags.${MOD}.orders.o1.variant.process`, `flags.${MOD}.orders.o1.variant.tradition`,
        `flags.${MOD}.orders.o1.check.degree`, `flags.${MOD}.orders.o1.check.settled`, `flags.${MOD}.orders.o1.dc.final`, `flags.${MOD}.orders.o1.setup.days`,
        `flags.${MOD}.crafted.order`, `flags.${MOD}.shelf.for`, `flags.${MOD}.card.kind`, `flags.${MOD}.days.d1.kind`, `flags.${MOD}.orders.o1.checklist`,
        `flags.${MOD}.orders.o1.checklist.smithy`,
    ];
    for (const key of flagged) assert.ok(VARIANT_WRITE.test(key), key);
    for (const key of plain) assert.ok(!VARIANT_WRITE.test(key), key);
    assert.equal(storedPath(`flags.${MOD}.orders.o1.==check.secret`), `flags.${MOD}.orders.o1.check.secret`);
    assert.equal(storedPath(`flags.${MOD}.-=gardens`), `flags.${MOD}.gardens`);
});

test("faceFor aims a face at the degree asked for, from the crafter's statistic, off the natural 1 and 20", () => {
    const actor = (mod) => ({ getStatistic: (slug) => (slug === "crafting" ? { mod } : null) });
    const order = { skill: "crafting", dc: { final: 15 } };
    assert.equal(faceFor(order, actor(7), 2), 12);       // 19 against 15: a success
    assert.equal(faceFor(order, actor(18), 2), 2);       // 20 against 15 at the lowest face that is no natural 1
    assert.equal(faceFor(order, actor(0), 3), 19);       // as high as it goes without a natural 20
    assert.equal(faceFor(order, actor(7), 1), 3);        // 10 against 15: a failure
});

/** Answers for m9a-complex up to the fire's finish, whose rushed finish's flat check rolled `die` with `outcome`. */
const complexAnswers = ({ degree, outcome, made }) => ({
    ...failedChecks(),
    "m9a.order": { status: "finishing", setup: { days: 1 }, variant: { complex: { rush: 1 }, rushFinish: true }, dc: { adjust: 5 }, days: [{ kind: "setup" }, { kind: "extra", rushed: true }] },
    "m9.run": { steps: [], order: { status: "finishing" } },
    "m9a.start": { start: { ok: true }, order: { setup: { days: 0, hours: 4 }, dc: { adjust: 5 }, variant: {}, days: [] } },
    "m9a.work": (p) => ({ results: [], order: { status: p.while?.includes("setup") ? "check" : "finishing", days: [{ kind: "setup-hours", hours: 4, id: "alc-99" }] } }),
    "m9a.rushFinish": { result: { ok: true }, order: { variant: { rushFinish: true } } },
    "m9a.finish": (p) => (p.order === "ord1" && p.payer === "Actor.p2"
        ? { result: { ok: true }, order: { status: "complete", check: { rushFlat: { dc: -5, die: null, outcome: "fine" } } } }
        : { result: { ok: true }, order: { status: "complete", flatCards: 1, shelf: [], check: { rushFlat: { dc: 4, die: degree === 0 ? 1 : 5, degree, outcome } } } }),
    "m9a.items": { items: made ? [{ name: "Alchemist's Fire (Lesser)" }] : [] },
    "m9a.view": made ? { deliveryState: "arriving", delivery: "On its way to Alchemist's inventory." }
        : { deliveryState: "ruined", delivery: "Ruined in the rushed finish: nothing was made." },
});

test("m9a-complex reads a ruined rushed finish as complete with nothing made, and fails it if an item was made anyway (M9a live pass)", async () => {
    const outcomeCheck = async (answers) => {
        const { h, checks } = fakeHarness(answers);
        await BEHAVIOURS["m9a-complex"](h, WORLD());
        return checks.find((c) => c.name.startsWith("the outcome follows the die"))?.ok;
    };
    assert.equal(await outcomeCheck(complexAnswers({ degree: 0, outcome: "ruined", made: false })), true);
    assert.equal(await outcomeCheck(complexAnswers({ degree: 0, outcome: "ruined", made: true })), false);
    assert.equal(await outcomeCheck(complexAnswers({ degree: 1, outcome: "quirk", made: true })), true);
    assert.equal(await outcomeCheck(complexAnswers({ degree: 1, outcome: "fine", made: true })), false);
});

test("m9a-complex fixes the alchemist's flat check at a natural 1 and checks the Queue says the ruined item was never made", async () => {
    const { M9A_FLAT_FACE } = await import("../../tools/harness/live-plans.mjs");
    const ruined = fakeHarness(complexAnswers({ degree: 0, outcome: "ruined", made: false }));
    await BEHAVIOURS["m9a-complex"](ruined.h, WORLD());
    const finish = ruined.calls.find((c) => c.step === "finish" && c.params.order === "ord1" && c.params.payer === "Actor.p1");
    assert.equal(finish?.params.face, M9A_FLAT_FACE);
    assert.equal(M9A_FLAT_FACE, 1);
    assert.equal(ruined.checks.find((c) => c.name.startsWith("at a natural 1"))?.ok, true);
    const arriving = fakeHarness({ ...complexAnswers({ degree: 0, outcome: "ruined", made: false }),
        "m9a.view": { deliveryState: "arriving", delivery: "On its way to Alchemist's inventory." } });
    await BEHAVIOURS["m9a-complex"](arriving.h, WORLD());
    assert.equal(arriving.checks.find((c) => c.name.startsWith("at a natural 1"))?.ok, false);
});
