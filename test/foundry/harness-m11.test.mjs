/**
 * The M11 live-harness steps and plans, as far as they run without a browser (DESIGN.md 15.3 scenarios 8 and 10): every step
 * a plan calls exists and says what it does, every plan is registered, and the scenario is merged into the scenarios the
 * driver runs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
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
