/**
 * The rules engine stays pure (DESIGN.md 6, 15.1): `scripts/logic/` imports only itself and
 * `scripts/data/`, and `scripts/data/` imports nothing, so every module loads in plain Node. ESLint already
 * rejects Foundry and browser globals in both folders.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { ROOT } from "../helpers.mjs";

const folder = (name) => readdirSync(join(ROOT, "scripts", name)).filter((f) => f.endsWith(".mjs")).map((f) => join(ROOT, "scripts", name, f));
const importsOf = (file) => [...readFileSync(file, "utf8").matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);

test("logic modules import only logic and data modules", () => {
    const allowed = [join(ROOT, "scripts/logic"), join(ROOT, "scripts/data")];
    for (const file of folder("logic")) {
        for (const specifier of importsOf(file)) {
            const target = resolve(dirname(file), specifier);
            assert.ok(specifier.startsWith("."), `${relative(ROOT, file)} imports ${specifier}`);
            assert.ok(allowed.includes(dirname(target)), `${relative(ROOT, file)} imports ${specifier}`);
        }
    }
});

test("data modules import nothing", () => {
    for (const file of folder("data")) assert.deepEqual(importsOf(file), [], relative(ROOT, file));
});

test("every logic and data module loads in Node", async () => {
    const files = [...folder("logic"), ...folder("data")];
    assert.ok(files.length >= 20);
    for (const file of files) await import(pathToFileURL(file).href);
});
