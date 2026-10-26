/**
 * Smoke test: the manifest points at real files, and the entry module registers what M0 and M2 need: the
 * hidden dev setting and the deprecation-failure mode in dev worlds; the M2 settings, the purge menu and the
 * GM relay query; at `ready`, the sync (which writes nothing while the master switch is off) and, in a dev
 * world, the harness tools (scenarios for everyone, fixtures for a GM).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, mock, test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import { ROOT } from "./helpers.mjs";
import { installFoundry, resetWorld, setUsers, world } from "./foundry/stubs.mjs";

const manifest = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));

test("module.json names this module and its files exist", () => {
    assert.equal(manifest.id, MODULE_ID);
    for (const path of manifest.esmodules) assert.ok(existsSync(join(ROOT, path)), path);
    for (const { path } of manifest.languages) JSON.parse(readFileSync(join(ROOT, path), "utf8"));
});

installFoundry();
const compatibility = () => ({ mode: 1, includePatterns: [], excludePatterns: [] });
globalThis.CONST.COMPATIBILITY_MODES = { SILENT: 0, WARNING: 1, ERROR: 2, FAILURE: 3 };
globalThis.CONFIG.compatibility = compatibility();

// The entry module registers its hooks when first imported, so it is imported once and the handlers kept.
await import("../scripts/module.mjs");
const { init, ready } = Object.fromEntries(["init", "ready"].map((name) => [name, world.hooks.get(name)[0]]));
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

beforeEach(() => {
    resetWorld();
    world.settingConfigs.clear();
    world.menus.clear();
    globalThis.CONFIG.compatibility = compatibility();
    globalThis.CONFIG.queries = {};
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    mock.timers.enable({ apis: ["setTimeout"] });   // the sync's debounced refresh and sweep never fire on their own
});
afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    mock.timers.reset();
});

function runInit(t, { dev = false } = {}) {
    const log = t.mock.method(console, "log", () => {});
    if (dev) world.settings.set(`${MODULE_ID}.dev`, true);
    init();
    return log;
}

test("init logs the version, registers the hidden dev setting, the M2 settings, the purge menu and the relay", (t) => {
    const log = runInit(t);
    assert.match(log.mock.calls[0].arguments[0], /version 0\.0\.0/);
    const dev = world.settingConfigs.get(`${MODULE_ID}.dev`);
    assert.deepEqual([dev.scope, dev.config, dev.default], ["world", false, false]);
    for (const key of ["enabled", "docs", "members", "claims.auto", "rules.legendaryItemLevel"]) {
        assert.ok(world.settingConfigs.has(`${MODULE_ID}.${key}`), key);
    }
    assert.equal(world.settingConfigs.get(`${MODULE_ID}.enabled`).default, false, "inert until switched on (P10)");
    assert.equal(world.menus.get(`${MODULE_ID}.purge`).restricted, true);
    assert.equal(typeof CONFIG.queries["pf2e-artisans-workshop.relay"], "function");
    for (const hook of ["preDeleteJournalEntry", "preDeleteActor", "updateJournalEntry", "updateActor", "createItem", "userConnected"]) {
        assert.ok(world.hooks.get(hook)?.length, hook);
    }
    assert.equal(globalThis.CONFIG.compatibility.mode, 1, "compatibility mode untouched outside dev");
});

test("in a dev world, deprecated calls from this module throw", (t) => {
    runInit(t, { dev: true });
    assert.equal(globalThis.CONFIG.compatibility.mode, globalThis.CONST.COMPATIBILITY_MODES.FAILURE);
    assert.ok(globalThis.CONFIG.compatibility.includePatterns.some((re) => re.test(`/modules/${MODULE_ID}/scripts/module.mjs`)));
});

test("ready with the master switch off writes nothing", async (t) => {
    runInit(t);
    await ready();
    assert.deepEqual(world.calls, []);
});

test("ready loads the harness in a dev world: scenarios for every user, fixtures for a GM", async (t) => {
    for (const [dev, isGM, scenarios, fixtures] of [[false, true, false, false], [true, false, true, false], [true, true, true, true]]) {
        resetWorld();
        world.settingConfigs.clear();
        setUsers([{ id: "u1", isGM }]);
        const module = game.modules.get(MODULE_ID);
        delete module.dev;
        runInit(t, { dev });
        await ready();
        assert.equal(typeof module.dev?.scenarios?.run === "function", scenarios, `dev=${dev} isGM=${isGM}`);
        assert.equal(typeof module.dev?.fixtures?.create === "function", fixtures, `dev=${dev} isGM=${isGM}`);
    }
});
