/**
 * The copy-paste macros (DESIGN.md 11.1): `macros/` holds one file per catalogue entry, each the line a hotbar macro made
 * from the shelf holds, and nothing else (`npm run macros` writes them).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "./helpers.mjs";
import { differences, expectedFiles } from "../tools/write-macros.mjs";
import { MACROS, macroCommand } from "../scripts/logic/macros.mjs";

test("macros/ matches the catalogue: one file per macro, none stale, none extra", () => {
    assert.deepEqual(differences(), []);
    assert.equal(Object.keys(expectedFiles()).length, MACROS.length);
});

test("each copy-paste file ends with the same line as the hotbar macro", () => {
    for (const entry of MACROS) {
        const text = readFileSync(join(ROOT, "macros", `${entry.id}.js`), "utf8");
        assert.equal(text.trimEnd().split("\n").at(-1), macroCommand(entry, "pf2e-artisans-workshop"), entry.id);
    }
});
