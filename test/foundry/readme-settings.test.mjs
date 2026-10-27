/**
 * The README's "For GMs" section (DESIGN.md 16.8) lists every setting: each setting a user can change in Configure Settings
 * (registered with `config: true`) has a row with its key, in the scope the code registers it with, and no row names a
 * setting the code does not register; the settings menu and the keybindings are named too.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { installFoundry, world } from "./stubs.mjs";

installFoundry();
const { registerSettings } = await import("../../scripts/foundry/settings.mjs");
registerSettings({ enabled: () => {}, docs: () => {} });

const README = readFileSync(join(import.meta.dirname, "..", "..", "README.md"), "utf8");
const section = README.slice(README.indexOf("## For GMs\n"), README.indexOf("\n## ", README.indexOf("## For GMs\n") + 1));

/** The rows of the section's settings tables: key and the scope its table gives. */
function rows() {
    const found = new Map();
    let scope = null;
    for (const line of section.split("\n")) {
        const heading = /^\*\*.+\*\*(?: \((W|U|C)\))?/.exec(line);
        if (heading) scope = heading[1] ?? null;
        const row = /^\| [^|]+ \| `([\w.]+)` \|(?: (W|U|C) \|)?/.exec(line);
        if (row) found.set(row[1], row[2] ?? scope);
    }
    return found;
}

const SCOPE = { world: "W", user: "U", client: "C" };

test("For GMs lists every setting a user can change, with its scope, and nothing else", () => {
    const listed = rows();
    const shown = [...world.settingConfigs.values()].filter((config) => config.config);
    assert.ok(shown.length > 70, "the settings are registered");
    for (const config of shown) {
        assert.ok(listed.has(config.key), `README For GMs: no row for ${config.key}`);
        assert.equal(listed.get(config.key), SCOPE[config.scope], `${config.key}: scope`);
    }
    for (const key of listed.keys()) assert.ok(shown.some((config) => config.key === key), `README For GMs: ${key} is not a setting users see`);
});

test("For GMs names the purge menu, the keybindings, and how to turn the module off and remove its data", () => {
    assert.ok(section.includes("Purge all Workshop data"));
    for (const heading of ["### What it changes in your world", "### Settings", "### Turning it off", "### Removing its data"]) {
        assert.ok(section.includes(heading), heading);
    }
    for (const name of ["Open the Workshop", "Open the Bandolier", "Quick Alchemy"]) assert.ok(section.includes(name), name);
});
