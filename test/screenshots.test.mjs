/**
 * The README screenshots (DESIGN.md 17.1): the demo party `tools/harness/screenshots.mjs` stages has generic names and
 * real fixtures behind it, its check of a capture's text finds raw keys and fixture names, and every capture it takes is
 * in `docs/screenshots/`, where the asset check allows it, and linked from the README in the same order with its caption.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SCREENSHOT_DIR, SCREENSHOT_MAX_BYTES, checkAssets, isScreenshotPath } from "../tools/check-assets.mjs";
import { FIXTURES } from "../tools/harness/fixtures.mjs";
import { BANNED_NAMES, CAPTURES, CAST, readmeShots, textProblems } from "../tools/harness/screenshots.mjs";
import { ROOT } from "./helpers.mjs";

test("the demo party: three or four members with generic names, each copied from a fixture, one per player", () => {
    assert.ok(CAST.length >= 3 && CAST.length <= 4);
    assert.equal(new Set(CAST.map((m) => m.name)).size, CAST.length);
    assert.equal(new Set(CAST.map((m) => m.key)).size, CAST.length);
    for (const member of CAST) {
        assert.deepEqual(textProblems(member.name), [], member.name);
        assert.doesNotMatch(member.name, /fixture|\d|:/i, member.name);
        assert.ok(FIXTURES.some((f) => f.id === member.fixture && !f.npc), member.fixture);
    }
    const players = CAST.map((m) => m.user).filter(Boolean);
    assert.deepEqual(players.sort(), ["Player One", "Player Two"]);
});

test("a capture's text: raw i18n keys and banned names are found", () => {
    assert.deepEqual(textProblems("Queue\npf2e-artisans-workshop.Queue.Title"), ["raw key pf2e-artisans-workshop.Queue.Title"]);
    assert.deepEqual(textProblems("Rarity: PF2E.TraitCommon"), ["raw key PF2E.TraitCommon"]);
    assert.deepEqual(textProblems("Crafter: Fixture 3: Bomber alchemist"), ["name Fixture"]);
    assert.deepEqual(textProblems("For Someone Private", ["Fixture", "Someone Private"]), ["name Someone Private"]);
    assert.deepEqual(BANNED_NAMES.filter((name) => textProblems(name).length === 0), []);
});

test("a capture's text: ordinary window text passes", () => {
    const text = [
        "Acting as Ilsa Marrow (level 11)", "79% of the Price: 35 gp paid up front, 20 gp earned by work, 15 gp left",
        "Elixir of Life (Lesser) × 2", "Strongbox 72 gp = party fund, unallocated 39 gp + earmarked for orders 33 gp.",
        "Day 2 of at most 4", "e.g. a note", "Level 1.5", "Alchemist's Fire (Moderate) (3)",
    ].join("\n");
    assert.deepEqual(textProblems(text), []);
});

test("every capture is a PNG in docs/screenshots/, linked from the README in order, and passes the asset check", () => {
    const files = CAPTURES.map((c) => `${SCREENSHOT_DIR}${c.file}`);
    assert.equal(new Set(files).size, files.length);
    assert.deepEqual(readmeShots(ROOT), files);
    for (const file of files) {
        assert.ok(isScreenshotPath(file), file);
        assert.ok(existsSync(join(ROOT, file)), `${file} is missing: run npm run screenshots`);
        assert.ok(readFileSync(join(ROOT, file)).length <= SCREENSHOT_MAX_BYTES, file);
    }
    assert.deepEqual(checkAssets(ROOT, { files }), []);
    assert.ok(CAPTURES.some((c) => c.scheme === "light") && CAPTURES.some((c) => c.scheme === "dark"));
    for (const view of ["queue", "request", "funds", "formulas", "downtime", "morning", "bandolier", "quick-alchemy", "afflictions"]) assert.ok(CAPTURES.some((c) => c.view === view), view);
    // Each caption follows its image after a hard line break (a trailing backslash): with a plain newline GitHub puts the
    // caption on the image's line, beside any image narrower than the page (request-form.png is 560 px wide).
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const capture of CAPTURES) {
        assert.ok(readme.includes(`(${SCREENSHOT_DIR}${capture.file})\\\n*${capture.caption}*`), `README caption of ${capture.file}`);
    }
});

test("a new tab's capture waits in NEXT_CAPTURES until it has been checked; the Morning tab's (M7) is linked since the M7 live pass", async () => {
    const { NEXT_CAPTURES } = await import("../tools/harness/screenshots.mjs");
    assert.ok(CAPTURES.some((c) => c.file === "morning.png" && c.view === "morning"));
    assert.ok(CAPTURES.some((c) => c.file === "tattoo.png" && c.order === "tattoo" && c.scroll), "the tattoo's detail, linked since the M9 live pass");
    for (const capture of NEXT_CAPTURES) {
        assert.ok(!CAPTURES.some((c) => c.file === capture.file), capture.file);
        assert.ok(isScreenshotPath(`${SCREENSHOT_DIR}${capture.file}`), capture.file);
        assert.deepEqual(textProblems(capture.caption), []);
    }
});
