/**
 * The M9 live-harness steps and plans, as far as they run without a browser (DESIGN.md 15.3 scenario 14): every step a plan
 * calls exists and says what it does, the plans are registered, and the feats the plans give are the registry's own.
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

const { REGISTRY } = await import("../../scripts/data/registry.mjs");
const { CRAFT_SCENARIOS } = await import("../../tools/harness/craft-scenarios.mjs");
const { BEHAVIOURS, M9 } = await import("../../tools/harness/live-plans.mjs");

test("every m9 step the plans call exists and says what it does; every m9 plan is registered", () => {
    const source = readFileSync(join(ROOT, "tools/harness/live-plans.mjs"), "utf8");
    const called = new Set([...source.matchAll(/h\.step\("\w+", "m9", "(\w+)"/g)].map((m) => m[1]));
    assert.ok(called.size >= 12, [...called].join(", "));
    const steps = CRAFT_SCENARIOS.m9;
    for (const name of called) assert.equal(typeof steps[name]?.run, "function", name);
    for (const step of Object.values(steps).filter((s) => typeof s === "object")) assert.equal(typeof step.about, "string");
    for (const id of ["m9-tattoo", "m9-simple", "m9-graft", "m9-fulu-missive", "m9-staff", "m9-snares", "m9-gadget", "m9-shots"]) {
        assert.equal(typeof BEHAVIOURS[id], "function", id);
    }
});

test("the plans' feats are the registry's, and their items are compendium UUIDs", () => {
    assert.equal(M9.graftTechnician, REGISTRY["graft-technician"].uuid);
    assert.equal(M9.giantSnare, REGISTRY["giant-snare"].uuid);
    for (const uuid of Object.values(M9)) assert.match(uuid, /^Compendium\.pf2e\.(equipment|feats)-srd\.Item\.[A-Za-z0-9]{16}$/);
});
