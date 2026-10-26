/**
 * Smoke test: the manifest points at real files, and the entry module registers what M0 needs (the
 * hidden dev setting, the deprecation-failure mode in dev worlds, the dev harness for a GM) and
 * nothing else.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import { ROOT } from "./helpers.mjs";

const manifest = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));

test("module.json names this module and its files exist", () => {
    assert.equal(manifest.id, MODULE_ID);
    for (const path of manifest.esmodules) assert.ok(existsSync(join(ROOT, path)), path);
    for (const { path } of manifest.languages) JSON.parse(readFileSync(join(ROOT, path), "utf8"));
});

/** Minimal Foundry globals for the entry module: hooks, settings, the module, CONFIG and CONST. */
function stubFoundry({ dev, isGM }) {
    const hooks = {};
    const settings = new Map();
    const registered = new Map();
    const module = { id: MODULE_ID, version: "0.0.0" };
    globalThis.Hooks = { once: (name, fn) => (hooks[name] = fn), on: () => assert.fail("M0 registers no Hooks.on") };
    globalThis.game = {
        modules: new Map([[MODULE_ID, module]]),
        settings: {
            register: (namespace, key, config) => registered.set(`${namespace}.${key}`, config),
            get: (namespace, key) => settings.get(`${namespace}.${key}`) ?? registered.get(`${namespace}.${key}`)?.default,
        },
        user: { isGM },
    };
    globalThis.CONFIG = { compatibility: { mode: 1, includePatterns: [], excludePatterns: [] } };
    globalThis.CONST = { COMPATIBILITY_MODES: { SILENT: 0, WARNING: 1, ERROR: 2, FAILURE: 3 } };
    settings.set(`${MODULE_ID}.dev`, dev);
    return { hooks, registered, module };
}

// The entry module registers its hooks when first imported, so it is imported once; each test swaps
// in fresh stubs and calls the captured handlers.
const captured = stubFoundry({ dev: false, isGM: true }).hooks;
await import("../scripts/module.mjs");

test("init logs the version and registers only the hidden dev setting", (t) => {
    const { registered } = stubFoundry({ dev: false, isGM: true });
    const log = t.mock.method(console, "log", () => {});
    captured.init();
    assert.deepEqual([...registered.keys()], [`${MODULE_ID}.dev`]);
    assert.equal(registered.get(`${MODULE_ID}.dev`).config, false);
    assert.equal(registered.get(`${MODULE_ID}.dev`).scope, "world");
    assert.match(log.mock.calls[0].arguments[0], /version 0\.0\.0/);
    assert.equal(globalThis.CONFIG.compatibility.mode, 1, "compatibility mode untouched outside dev");
});

test("in a dev world, deprecated calls from this module throw", (t) => {
    stubFoundry({ dev: true, isGM: false });
    t.mock.method(console, "log", () => {});
    captured.init();
    assert.equal(globalThis.CONFIG.compatibility.mode, globalThis.CONST.COMPATIBILITY_MODES.FAILURE);
    assert.ok(globalThis.CONFIG.compatibility.includePatterns.some((re) => re.test(`/modules/${MODULE_ID}/scripts/module.mjs`)));
});

test("ready loads the dev harness only for a GM in a dev world", async (t) => {
    t.mock.method(console, "log", () => {});
    for (const [dev, isGM, loaded] of [[false, true, false], [true, false, false], [true, true, true]]) {
        const { module } = stubFoundry({ dev, isGM });
        await captured.ready();
        assert.equal(typeof module.dev?.fixtures?.create === "function", loaded, `dev=${dev} isGM=${isGM}`);
    }
});
