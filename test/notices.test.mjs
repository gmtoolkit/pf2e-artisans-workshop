/**
 * Paizo's Community Use Policy notice must be copied exactly from paizo.com/licenses/communityuse
 * (DESIGN.md 16.6), with "This module" as the work's name. The author rewrites the text around it
 * before listing (16.4); this keeps the notice itself whole. The README gets the notice in M13 and then
 * belongs in the list below.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { normalise } from "../tools/check-strings.mjs";
import { ROOT } from "./helpers.mjs";

const COMMUNITY_USE_NOTICE = [
    "This module uses trademarks and/or copyrights owned by Paizo Inc., used under Paizo's Community Use",
    "Policy (paizo.com/licenses/communityuse). We are expressly prohibited from charging you to use or",
    "access this content. This module is not published, endorsed, or specifically approved by Paizo.",
    "For more information about Paizo Inc. and Paizo products, visit paizo.com.",
].join(" ");

test("LICENSE and the package description carry the Community Use Policy notice word for word", () => {
    for (const file of ["LICENSE", "docs/package-description.md"]) {
        assert.ok(normalise(readFileSync(join(ROOT, file), "utf8")).includes(COMMUNITY_USE_NOTICE), file);
    }
});
