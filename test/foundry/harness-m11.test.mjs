/**
 * The M11 live-harness steps and plans, as far as they run without a browser (DESIGN.md 15.3 scenarios 8 and 10): every step
 * a plan calls exists and says what it does, every plan is registered, and the scenario is merged into the scenarios the
 * driver runs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";
import { ROOT } from "../helpers.mjs";
import { installFoundry } from "./stubs.mjs";

installFoundry();
globalThis.HTMLElement ??= class {};
foundry.applications.api.ApplicationV2 = class {};
foundry.applications.ux.DragDrop = { implementation: class { bind() {} } };

const { INTEGRATION_SCENARIOS } = await import("../../tools/harness/integration-scenarios.mjs");
const { BEHAVIOURS } = await import("../../tools/harness/live-plans.mjs");

test("every m11 step the plans call exists and says what it does; every m11 plan is registered", () => {
    const source = readFileSync(join(ROOT, "tools/harness/live-plans.mjs"), "utf8");
    const called = new Set([...source.matchAll(/"m11", "(\w+)"/g)].map((m) => m[1]));
    assert.ok(called.size >= 12, [...called].join(", "));
    const steps = INTEGRATION_SCENARIOS.m11;
    for (const name of called) assert.equal(typeof steps[name]?.run, "function", name);
    for (const step of Object.values(steps).filter((s) => typeof s === "object")) assert.equal(typeof step.about, "string");
    for (const id of ["m11-sheet", "m11-companions", "m11-party", "m11-context", "m11-shelf", "m11-macros", "m11-keys", "m11-keyboard", "m11-themes", "m11-shots"]) {
        assert.equal(typeof BEHAVIOURS[id], "function", id);
    }
    const sync = readFileSync(join(ROOT, "tools/harness/sync-scenarios.mjs"), "utf8");
    assert.match(sync, /\.\.\.INTEGRATION_SCENARIOS/);
});

test("the m4 steps the M11 plans borrow exist", async () => {
    const { ORDER_SCENARIOS } = await import("../../tools/harness/order-scenarios.mjs");
    const source = readFileSync(join(ROOT, "tools/harness/live-plans.mjs"), "utf8");
    const m11 = source.slice(source.indexOf("M11: the integration surface"));
    for (const name of new Set([...m11.matchAll(/"m4", "(\w+)"/g)].map((m) => m[1]))) assert.equal(typeof ORDER_SCENARIOS.m4[name]?.run, "function", name);
});

test("the m8 steps the M11 plans borrow exist", async () => {
    const { COMBAT_SCENARIOS } = await import("../../tools/harness/combat-scenarios.mjs");
    const source = readFileSync(join(ROOT, "tools/harness/live-plans.mjs"), "utf8");
    const m11 = source.slice(source.indexOf("M11: the integration surface"));
    const used = new Set([...m11.matchAll(/"m8", "(\w+)"/g)].map((m) => m[1]));
    assert.ok(used.has("arena"));
    for (const name of used) assert.equal(typeof COMBAT_SCENARIOS.m8[name]?.run, "function", name);
});

/* -------------------------------------------- */
/*  The M11 live pass: the audit of the plans    */
/* -------------------------------------------- */

const { MODULE_ID } = await import("../../scripts/constants.mjs");
const { MACROS } = await import("../../scripts/logic/macros.mjs");
const { moduleWindows } = await import("../../tools/harness/integration-scenarios.mjs");

/** The fixtures the M11 plans name, as `prepareWorld` lists them. */
const WORLD = () => ({ pcs: { p1: { id: "p1", uuid: "Actor.p1" }, p2: { id: "p2", uuid: "Actor.p2" } }, strays: [], party: { id: "party" } });

const clean = () => ({ unnamed: [], positive: [], looseTabs: 0, lowContrast: [], lowContrastCount: 0 });

/**
 * A harness that runs an M11 plan without a browser. Each step is answered from `answers` (by "<scenario>.<step>", a value
 * or a function of the params, the client and the table state), over answers under which every M11 plan passes. The pages
 * share one keyboard: the Workshop opens on Alt+Shift+W, closes with the `close` step, and (with `leak`) a GM's Space pauses
 * and a Tab controls a token even while it is open, as core would if the Workshop let its keys through.
 */
function fakeHarness(answers = {}, { canvas = false, leak = false } = {}) {
    const checks = [];
    const calls = [];
    const keys = [];
    const state = { open: false, paused: true, controlled: [], toolbelt: true, workbench: true, scheme: "dark", parchment: false };
    const press = async (key) => {
        keys.push(key);
        if (key === "Alt+Shift+KeyW") state.open = true;
        if (key === "Space" && (leak || !state.open)) state.paused = !state.paused;
        if (key === "Tab" && canvas && (leak || !state.open)) state.controlled = ["t1"];
    };
    const page = {
        keyboard: { press }, mouse: { click: async () => {} }, click: async () => {}, dragAndDrop: async () => {},
        locator: () => ({ allTextContents: async () => ["Open Workshop"], first: () => ({ click: async () => { state.open = true; } }) }),
    };
    const sheet = (p, client) => ({
        open: true, header: 1, strips: 1, first: true, stripFormulaItems: 0, stripWorkbench: 0, formulaItems: 3,
        toolbeltSort: state.toolbelt ? 1 : 0, workbenchRarity: state.workbench ? 3 : 0, audit: clean(),
        stripText: client === "p2" ? "Artisan's Workshop No Workshop jobs right now. Workshop Request"
            : "Artisan's Workshop Crafting: 1 Waiting on your roll or settlement: 1 Workshop Request Morning",
        stripButtons: ["open", "request", "morning"],
        clicked: p.click === "open" ? { workshop: true, acting: "Actor.p1" } : p.click === "request" ? { requestForm: true } : undefined,
    });
    /** Where focus is in the GM's walkthrough, from the keys pressed so far (Space opens the detail, two Enters after Escape). */
    const focus = () => {
        const last = keys.at(-1);
        const escaped = keys.includes("Escape");
        const enters = keys.slice(keys.indexOf("Escape")).filter((k) => k === "Enter").length;
        if (!escaped) {
            if (last === "Alt+Shift+KeyW") return { inWorkshop: true, tab: "queue", currentTab: "queue" };
            if (last === "ArrowDown") return { inWorkshop: true, tab: "funds", currentTab: "funds" };
            if (last === "ArrowUp") return { inWorkshop: true, orderId: "ord1", tag: "LI" };
            return { inWorkshop: true, inDetail: true, selected: "ord1", detailOpen: true };
        }
        if (last === "Escape") return { inWorkshop: true, orderId: "ord1", tag: "LI", detailOpen: false };
        if (enters === 0) return { inWorkshop: true, action: "macros" };
        if (enters === 1 && last === "Enter") return { inShelf: true, action: "run", macro: "open-workshop" };
        return { inShelf: true, action: "hotbar", macro: "open-workshop" };
    };
    const runs = () => MACROS.map((m) => ({ id: m.id, ms: 10, asked: false, notes: [],
        windows: ["request-item", "earn-income", "learn-formula", "advance-days", "open-workshop"].includes(m.id) ? ["workshop-window"] : [],
        result: { ok: true, reason: null, outcome: null, app: false } }));
    const base = {
        "m4.request": { ok: true, order: "ord1" }, "m4.pledge": { ok: true }, "m4.start": { ok: true }, "m4.work": { order: { status: "check" } },
        "m4.open": { open: true }, "m4.state": { order: { status: "rolled" } },
        "m4.theme": (p) => { state.scheme = p.scheme; return { scheme: p.scheme }; },
        "m8.arena": (p) => (p.off ? { active: null, left: 0 } : { id: "arena", previous: null, tokens: [{ id: "t1" }, { id: "t2" }] }),
        "m11.cleanup": { deleted: 0, slots: 0 }, "m11.close": () => { state.open = false; return { closed: true }; },
        "m11.modules": (p) => { const before = { toolbelt: state.toolbelt, workbench: state.workbench }; Object.assign(state, p); return { before, after: p }; },
        "m11.active": () => ({ toolbelt: state.toolbelt, workbench: state.workbench }),
        "m11.companions": { sortList: "pf2e-toolbelt.crafting.sortList", rarityColour: true },
        "m11.sheet": sheet,
        "m11.party": { first: { region: true, cards: 1, afterSummary: true, facts: ["1", "0", "1", "0", "0", "1 gp"], header: 1 },
            again: { region: true, cards: 1, afterSummary: true, facts: [], header: 1 }, audit: clean() },
        "m11.open": () => ({ open: state.open, acting: "Actor.p1", tab: "queue" }),
        "m11.shelf": { open: true, tiles: MACROS.map((m) => m.id), draggable: MACROS.length, hotbarButtons: MACROS.length, canScript: true, audit: clean() },
        "m11.run": runs,
        "m11.keybinding": { registered: true, bindings: [], others: [true, true] },
        "m11.focus": focus,
        "m11.size": (p) => ({ open: true, width: p.width, saved: { width: p.width } }),
        "m11.hotbar": { macros: [{ id: "m1", macro: "open-workshop", type: "script", command: "x" }], slots: [{ slot: 3, id: "m1" }] },
        "m11.audit": () => ({ workshop: clean(), shelf: clean(), scheme: state.scheme, classes: state.parchment ? ["themed", "theme-light", "paw-parchment"] : [] }),
        "m11.parchment": (p) => { state.parchment = !!p.on; return { on: !!p.on }; },
        "m11.table": () => ({ paused: state.paused, canvas, pivot: canvas ? { x: 0, y: 0 } : null, controlled: [...state.controlled],
            tokens: canvas ? [{ id: "t1", x: 400, y: 400 }, { id: "t2", x: 800, y: 600 }] : [] }),
    };
    const all = { ...base, ...answers };
    const h = {
        clients: new Map([["gm", { page }], ["p1", { page }], ["p2", { page }]]), shots: [], label: "test", canvas, console: [],
        only: async () => {}, settle: async () => {}, closeAll: async () => {}, collectPages: async () => ({}),
        evaluate: async (_client, fn) => (fn.name === "pageStatus" ? "ready" : { status: "ready" }),
        screenshot: async (_client, _file, _size, prepare) => prepare(),
        step: async (client, scenario, step, params) => {
            calls.push({ client, scenario, step, params });
            const answer = all[`${scenario}.${step}`];
            return structuredClone(typeof answer === "function" ? answer(params, client, state) : answer ?? {});
        },
        check: (name, ok, detail) => {
            checks.push({ name, ok: !!ok, detail });
            return !!ok;
        },
    };
    return { h, checks, calls, keys, state };
}

/** Run a plan with its sleeps on mocked timers, so a walkthrough's waits for the browser cost nothing here. */
async function quickly(run) {
    mock.timers.enable({ apis: ["setTimeout"] });
    let done = false;
    try {
        const running = run().finally(() => { done = true; });
        while (!done) {
            mock.timers.tick(250);
            await new Promise((resolve) => setImmediate(resolve));
        }
        return await running;
    } finally {
        mock.timers.reset();
    }
}

const failed = (checks) => checks.filter((c) => !c.ok).map((c) => c.name);
const failedMatching = (checks, pattern) => checks.some((c) => pattern.test(c.name) && !c.ok);

test("the audited M11 plans pass on answers where everything works (M11 live pass)", async () => {
    for (const id of ["m11-sheet", "m11-companions", "m11-party", "m11-macros", "m11-keys", "m11-themes", "m11-shots"]) {
        const { h, checks } = fakeHarness();
        await quickly(() => BEHAVIOURS[id](h, WORLD()));
        assert.deepEqual(failed(checks), [], id);
        assert.ok(checks.length > 0, id);
    }
});

test("m11-macros: core's own windows are not the windows a macro opened, and a notification with a placeholder fails", async () => {
    const Dialog = class {};
    foundry.applications.api.DialogV2 = Dialog;
    class Hotbar { rendered = true; options = { classes: ["faded-ui"] }; }
    class Sidebar { rendered = true; options = { classes: [] }; }
    class Workshop { rendered = true; options = { classes: [MODULE_ID, "workshop-window"] }; }
    class Shut { rendered = false; options = { classes: [MODULE_ID, "workshop-window"] }; }
    class Question extends Dialog { rendered = true; options = { classes: ["dialog"] }; }
    assert.deepEqual(moduleWindows([new Hotbar(), new Sidebar()]), []);
    assert.deepEqual(moduleWindows([new Hotbar(), new Workshop(), new Shut(), new Question()]), ["workshop-window", "dialog"]);

    // The step itself, with core's hotbar rendered and a macro that opens nothing: no window.
    globalThis.window ??= globalThis;
    globalThis.window.__live = { notes: [] };
    foundry.applications.instances = new Map([["hotbar", new Hotbar()], ["sidebar", new Sidebar()]]);
    game.modules.get(MODULE_ID).api = { macros: { run: async () => ({ ok: false, reason: "no-actor" }) } };
    const [run] = await INTEGRATION_SCENARIOS.m11.run.run({ ids: ["open-workshop"], wait: 10 });
    assert.deepEqual(run.windows, []);

    const placeholder = fakeHarness({ "m11.run": () => MACROS.map((m) => ({ id: m.id, ms: 1, asked: false, windows: ["workshop-window"],
        notes: m.id === "pledge" ? [{ type: "info", message: "Pledged {amount} to the order." }] : [], result: { ok: true } })) });
    await BEHAVIOURS["m11-macros"](placeholder.h, WORLD());
    assert.ok(failedMatching(placeholder.checks, /unfilled \{placeholder\}/));
});

test("m11-party fails when the GM has no Overview, rather than skipping every card check", async () => {
    const { h, checks } = fakeHarness({ "m11.party": { first: { region: false, cards: 0, header: 1, facts: [] }, again: { region: false, cards: 0 }, audit: null } });
    await BEHAVIOURS["m11-party"](h, WORLD());
    assert.ok(failedMatching(checks, /^gm: the Party sheet has its Overview/));
    assert.ok(failedMatching(checks, /^gm: one card/));
});

test("m11-companions checks Workbench's rarity classes and the GM's card, which it skipped before", async () => {
    const noRarity = fakeHarness({ "m11.sheet": (p, client, state) => ({ open: true, header: 1, strips: 1, first: true, stripFormulaItems: 0, stripWorkbench: 0,
        formulaItems: 3, toolbeltSort: state.toolbelt ? 1 : 0, workbenchRarity: 0, audit: clean(), stripText: "", stripButtons: [] }) });
    await BEHAVIOURS["m11-companions"](noRarity.h, WORLD());
    assert.ok(failedMatching(noRarity.checks, /Workbench's rarity classes/));
    const noCard = fakeHarness({ "m11.party": (p, client) => (client === "gm" ? { first: { region: true, cards: 0, header: 1 }, again: { cards: 0 } }
        : { first: { region: false, cards: 0, header: 1 }, again: { cards: 0 } }) });
    await BEHAVIOURS["m11-companions"](noCard.h, WORLD());
    assert.ok(failedMatching(noCard.checks, /Party card is there with the companions/));
});

test("m11-sheet: a fighter's strip that counts orders filed for it is not \"nothing waiting\"", async () => {
    const counted = fakeHarness({ "m11.sheet": (p, client) => ({ open: true, header: 1, strips: 1, first: true, stripFormulaItems: 0, stripWorkbench: 0, audit: clean(),
        stripButtons: ["open", "request", "morning"], clicked: p.click === "open" ? { workshop: true, acting: "Actor.p1" } : { requestForm: true },
        stripText: client === "p2" ? "Artisan's Workshop Orders for this character: 1 Workshop Request" : "Crafting: 1 Waiting on your roll or settlement: 1" }) });
    await BEHAVIOURS["m11-sheet"](counted.h, WORLD());
    assert.ok(failedMatching(counted.checks, /the fighter's strip has nothing waiting/));
});

test("m11-keys fails when the Workshop was already open before the keys", async () => {
    const { h, checks, state } = fakeHarness({ "m11.close": { closed: true } });
    state.open = true;
    await quickly(() => BEHAVIOURS["m11-keys"](h, WORLD()));
    assert.ok(failedMatching(checks, /Alt\+Shift\+W opens the Workshop/));
});

test("m11-themes checks the scheme it asked for and the shelf's contrast", async () => {
    const stuck = fakeHarness({ "m4.theme": () => ({ scheme: "dark" }) });
    await quickly(() => BEHAVIOURS["m11-themes"](stuck.h, WORLD()));
    assert.ok(failedMatching(stuck.checks, /^light: the interface is in the light scheme/));
    const shelf = fakeHarness({ "m11.audit": (p, client, state) => ({ workshop: clean(), scheme: state.scheme,
        shelf: { ...clean(), lowContrastCount: 1, lowContrast: [{ text: "Run", ratio: 2.1 }] }, classes: ["themed", "theme-light", "paw-parchment"] }) });
    await quickly(() => BEHAVIOURS["m11-themes"](shelf.h, WORLD()));
    assert.ok(failedMatching(shelf.checks, /no text in the macro shelf below its contrast/));
});

test("m11-shots fails when a capture had no card to show", async () => {
    const { h, checks } = fakeHarness({ "m11.party": { first: { region: false, cards: 0 }, again: {} } });
    await BEHAVIOURS["m11-shots"](h, WORLD());
    assert.ok(failedMatching(checks, /were there for every capture/));
});

test("m11-keyboard-gm: with a canvas, keys that reach core while the Workshop has focus fail the walkthrough; the controls show core takes them outside it", async () => {
    assert.equal(typeof BEHAVIOURS["m11-keyboard-gm"], "function");
    const kept = fakeHarness({}, { canvas: true });
    await quickly(() => BEHAVIOURS["m11-keyboard-gm"](kept.h, WORLD()));
    assert.deepEqual(failed(kept.checks), []);
    assert.ok(kept.keys.includes("Space"), "the GM opens the detail with Space");
    assert.ok(kept.calls.some((c) => c.scenario === "m8" && c.step === "arena" && c.params.off), "the arena is taken down");
    const leaked = fakeHarness({}, { canvas: true, leak: true });
    await quickly(() => BEHAVIOURS["m11-keyboard-gm"](leaked.h, WORLD()));
    assert.ok(failedMatching(leaked.checks, /none of the keys reached core/));
});
