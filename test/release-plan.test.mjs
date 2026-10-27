/**
 * The release plan (tools/release-plan.mjs, DESIGN.md 16.2, 16.9): the gates run in enforce mode for a stable release and in
 * report mode for a pre-release, only a stable release with the token is registered, and the outputs the workflow reads.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { outputLines, releasePlan, run } from "../tools/release-plan.mjs";
import { logger, tempDir } from "./helpers.mjs";

const PAGE = "https://github.com/gmtoolkit/pf2e-artisans-workshop/releases/tag/1.0.0";
const event = (release) => ({ action: "published", release: { tag_name: "1.0.0", prerelease: false, draft: false, html_url: PAGE, ...release } });

test("a stable release: both gates in enforce mode, registered only when the token is there", () => {
    const withToken = releasePlan(event(), { tokenPresent: true });
    assert.deepEqual(withToken.problems, []);
    assert.deepEqual(withToken.plan, {
        version: "1.0.0", prerelease: false, stringsMode: "enforce", registryMode: "enforce", publish: true, notesUrl: PAGE,
    });
    assert.deepEqual(withToken.notices, []);

    const without = releasePlan(event(), { tokenPresent: false });
    assert.equal(without.plan.stringsMode, "enforce");
    assert.equal(without.plan.registryMode, "enforce");
    assert.equal(without.plan.publish, false);
    assert.match(without.notices[0], /no FOUNDRY_RELEASE_TOKEN secret: it is not registered/);
});

test("a pre-release: both gates in report mode, never registered, even with the token", () => {
    const { problems, plan, notices } = releasePlan(event({ tag_name: "0.12.0-rc.1", prerelease: true }), { tokenPresent: true });
    assert.deepEqual(problems, []);
    assert.equal(plan.version, "0.12.0-rc.1");
    assert.equal(plan.prerelease, true);
    assert.equal(plan.stringsMode, "report");
    assert.equal(plan.registryMode, "report");
    assert.equal(plan.publish, false);
    assert.match(notices[0], /pre-release: strings gate and registry completeness in report mode/);
    // A pre-release may carry a plain version (the M12 test-table build).
    assert.equal(releasePlan(event({ tag_name: "0.12.0", prerelease: true })).plan.stringsMode, "report");
});

test("a release that cannot go out as tagged has no plan", () => {
    assert.match(releasePlan(event({ tag_name: "v1.0.0" })).problems[0], /bare version/);
    assert.match(releasePlan(event({ tag_name: "1.0.0-rc.1" })).problems[0], /pre-release suffix/);
    assert.match(releasePlan(event({ tag_name: "0.0.0", prerelease: true })).problems[0], /scaffold/);
    assert.match(releasePlan(event({ draft: true })).problems[0], /draft/);
    assert.match(releasePlan({ action: "published" }).problems[0], /not a release event/);
    for (const plan of [releasePlan(event({ tag_name: "v1.0.0" })), releasePlan({})]) assert.equal(plan.plan, null);
});

test("the notes URL is the release's GitHub page or nothing, so a value cannot add lines to $GITHUB_OUTPUT", () => {
    assert.equal(releasePlan(event({ html_url: "https://evil.example/x" })).plan.notesUrl, "");
    assert.equal(releasePlan(event({ html_url: `${PAGE}\npublish=true` })).plan.notesUrl, "");
    assert.equal(releasePlan(event({ html_url: undefined })).plan.notesUrl, "");
});

test("the command writes the plan to $GITHUB_OUTPUT as the workflow's jobs read it", (t) => {
    const dir = tempDir(t, { "event.json": event({ tag_name: "1.2.0" }) });
    const output = join(dir, "output");
    const log = logger();
    const env = { GITHUB_EVENT_PATH: join(dir, "event.json"), GITHUB_OUTPUT: output, FOUNDRY_TOKEN_PRESENT: "true" };
    assert.equal(run([], env, log), 0);
    assert.deepEqual(readFileSync(output, "utf8").trim().split("\n"), [
        "version=1.2.0", "prerelease=false", "strings-mode=enforce", "registry-mode=enforce", "publish=true", `notes-url=${PAGE}`,
    ]);
    assert.deepEqual(outputLines(releasePlan(event({ tag_name: "1.2.0" }), { tokenPresent: true }).plan), readFileSync(output, "utf8").trim().split("\n"));

    // Only the string "true" counts as the token being there (the workflow passes `secrets.X != ''`).
    const noToken = join(dir, "output-2");
    assert.equal(run(["--event", join(dir, "event.json")], { GITHUB_OUTPUT: noToken, FOUNDRY_TOKEN_PRESENT: "false" }, logger()), 0);
    assert.match(readFileSync(noToken, "utf8"), /^publish=false$/m);
});

test("the command fails a bad release with an error annotation, and a missing event with a usage error", (t) => {
    const dir = tempDir(t, { "event.json": event({ tag_name: "v1.0.0" }) });
    const log = logger();
    assert.equal(run(["--event", join(dir, "event.json")], { GITHUB_ACTIONS: "true" }, log), 1);
    assert.match(log.text(), /^::error title=Release plan::the tag must be the bare version/m);
    assert.equal(run([], {}, logger()), 2);
    assert.equal(run(["--nope"], {}, logger()), 2);
    assert.equal(run(["--event", join(dir, "missing.json")], {}, logger()), 1);
});
