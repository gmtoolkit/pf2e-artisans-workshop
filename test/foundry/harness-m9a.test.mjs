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
