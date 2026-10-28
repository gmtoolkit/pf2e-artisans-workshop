/**
 * The game-material notices (DESIGN.md 16.6, 16.9). Paizo's Community Use Policy notice must be copied exactly from
 * paizo.com/licenses/communityuse, with "This module" as the work's name; `NOTICE`, the README and the package description
 * carry it word for word. `NOTICE` holds the ORC notice and the Open Game License notices, which link the licences
 * themselves (paizo.com/orclicense, opengamingfoundation.org/ogl.html) and credit the author; the README and the package
 * description carry the same ORC notice and the same OGL section 15. `LICENSE` is the MIT licence alone, so GitHub and Foundry read it as MIT. The
 * placeholders themselves block a stable release (tools/package-release.mjs).
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

const read = (file) => readFileSync(join(ROOT, file), "utf8");
const notice = read("NOTICE");

/** A block of NOTICE: from its `--- name ---` line to the next one (or the end). */
function block(name) {
    const start = notice.indexOf(`--- ${name} ---\n`);
    assert.ok(start >= 0, name);
    const body = notice.slice(start + name.length + 9);
    const end = body.indexOf("\n--- ");
    return (end < 0 ? body : body.slice(0, end)).trim();
}

test("NOTICE, the README and the package description carry the Community Use Policy notice word for word", () => {
    assert.equal(normalise(block("Community Use Policy")), COMMUNITY_USE_NOTICE);
    for (const file of ["NOTICE", "README.md", "docs/package-description.md"]) {
        assert.ok(normalise(read(file)).includes(COMMUNITY_USE_NOTICE), file);
    }
});

test("the README and the package description carry NOTICE's ORC notice and OGL section 15 as they are there", () => {
    const orc = normalise(block("ORC Notice"));
    const ogl = block("Open Game License");
    const section15 = normalise(ogl.slice(ogl.indexOf("15. COPYRIGHT NOTICE")));
    assert.ok(orc.startsWith("This product is licensed under the ORC License, available at https://paizo.com/orclicense."));
    assert.match(orc, /Attribution: This product is based on the following Licensed Material:/);
    assert.match(orc, /Reserved Material: /);
    assert.match(orc, /Expressly Designated Licensed Material: /);
    assert.ok(section15.startsWith("15. COPYRIGHT NOTICE"));
    for (const file of ["README.md", "docs/package-description.md"]) {
        assert.ok(normalise(read(file)).includes(orc), `${file}: ORC notice`);
        assert.ok(normalise(read(file)).includes(section15), `${file}: OGL section 15`);
    }
});

test("LICENSE is the MIT licence alone; the notices live in NOTICE, which ships", () => {
    const license = read("LICENSE");
    assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Cliff Colvin\n/);
    assert.match(license, /SOFTWARE\.\n$/);
    assert.doesNotMatch(license, /Paizo|ORC|Open Game/);
});

test("the notices are complete: no placeholder left, both licences linked, the author credited, in all three files", () => {
    for (const file of ["NOTICE", "README.md", "docs/package-description.md"]) {
        const text = normalise(read(file));
        assert.doesNotMatch(text, /AUTHOR-TODO/, file);
        assert.ok(text.includes("https://paizo.com/orclicense"), `${file}: ORC License link`);
        assert.ok(text.includes("https://opengamingfoundation.org/ogl.html"), `${file}: Open Game License link`);
        assert.ok(text.includes("PF2e Artisan's Workshop © 2026 Cliff Colvin"), `${file}: credit line`);
    }
});
