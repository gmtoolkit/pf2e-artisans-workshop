/**
 * The release plan (tools/release-plan.mjs, DESIGN.md 16.2, 16.9): the gates run in enforce mode for a stable release and in
 * report mode for a pre-release, only a stable release with the token is registered, and the outputs the workflow reads;
 * the Release button's release runs from the default branch, with a version that is new and newer than the latest.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compareVersions, freshnessProblems, newestStable, outputLines, releasePlan, run } from "../tools/release-plan.mjs";
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

const REPO = "https://github.com/gmtoolkit/pf2e-artisans-workshop";
const dispatch = (inputs = {}, extra = {}) => ({
    inputs: { version: "1.0.0", prerelease: "false", ...inputs },
    ref: "refs/heads/main",
    repository: { default_branch: "main", html_url: REPO },
    ...extra,
});
const RELEASES = [
    { tagName: "0.12.0", isDraft: false, isPrerelease: true, isLatest: false },
    { tagName: "0.9.0", isDraft: false, isPrerelease: false, isLatest: true },
];
const TAGS = ["0.12.0", "0.9.0", "not-a-version"];
const facts = { releases: RELEASES, tags: TAGS, eventName: "workflow_dispatch" };

test("versions compare by semantic-version precedence", () => {
    const ordered = ["0.9.0", "0.12.0-alpha", "0.12.0-alpha.1", "0.12.0-alpha.beta", "0.12.0-beta", "0.12.0-beta.2", "0.12.0-beta.11", "0.12.0-rc.1", "0.12.0", "1.0.0", "1.0.10", "10.0.0"];
    for (let i = 0; i < ordered.length; i++) {
        assert.equal(compareVersions(ordered[i], ordered[i]), 0, ordered[i]);
        for (let j = i + 1; j < ordered.length; j++) {
            assert.ok(compareVersions(ordered[i], ordered[j]) < 0, `${ordered[i]} < ${ordered[j]}`);
            assert.ok(compareVersions(ordered[j], ordered[i]) > 0, `${ordered[j]} > ${ordered[i]}`);
        }
    }
});

test("the newest stable release: GitHub's latest, or a published stable one newer than it; never a draft or a pre-release", () => {
    assert.equal(newestStable(RELEASES), "0.9.0");
    assert.equal(newestStable([]), null);
    assert.equal(newestStable([{ tagName: "2.0.0", isDraft: true, isPrerelease: false }, { tagName: "3.0.0-rc.1", isDraft: false, isPrerelease: true }]), null);
    assert.equal(newestStable([...RELEASES, { tagName: "1.1.0", isDraft: false, isPrerelease: false, isLatest: false }]), "1.1.0");
    assert.equal(newestStable([{ tagName: "v2.0.0", isDraft: false, isPrerelease: false, isLatest: true }]), null);
});

test("the Release button: a stable release from main, new and newer than the latest, with its page as the notes URL", () => {
    const { problems, notices, plan } = releasePlan(dispatch(), { ...facts, tokenPresent: true });
    assert.deepEqual(problems, []);
    assert.deepEqual(notices, []);
    assert.deepEqual(plan, {
        version: "1.0.0", prerelease: false, stringsMode: "enforce", registryMode: "enforce", publish: true,
        notesUrl: `${REPO}/releases/tag/1.0.0`,
    });
    assert.equal(releasePlan(dispatch(), facts).plan.publish, false, "registered only with the token");
    // The payload gives a boolean input as a string; the boolean itself works too.
    for (const prerelease of ["true", true]) {
        const pre = releasePlan(dispatch({ version: "1.0.0-rc.1", prerelease }), { ...facts, tokenPresent: true });
        assert.deepEqual(pre.problems, []);
        assert.equal(pre.plan.prerelease, true);
        assert.equal(pre.plan.stringsMode, "report");
        assert.equal(pre.plan.publish, false);
    }
    // The first release of all: nothing to compare with.
    assert.deepEqual(releasePlan(dispatch({ version: "0.1.0" }), { ...facts, releases: [], tags: [] }).problems, []);
    // Without the event's name, a payload with inputs is the button.
    assert.equal(releasePlan(dispatch(), { releases: RELEASES, tags: TAGS }).plan.version, "1.0.0");
});

test("the Release button refuses a bad version, another branch, a taken name, an older version, and unread facts", () => {
    const problem = (event, options = facts) => releasePlan(event, options);
    const refused = (result, pattern) => {
        assert.equal(result.plan, null);
        assert.match(result.problems.join("\n"), pattern);
    };
    refused(problem(dispatch({ version: "v1.0.0" })), /bare version/);
    refused(problem(dispatch({ version: "1.0.0-rc.1" })), /pre-release suffix/);
    refused(problem(dispatch({ version: "0.0.0", prerelease: "true" })), /scaffold/);
    refused(problem(dispatch({}, { ref: "refs/heads/m13-strings" })), /from main, not refs\/heads\/m13-strings/);
    refused(problem(dispatch({}, { ref: "refs/tags/1.0.0" })), /from main/);
    refused(problem(dispatch({}, { repository: { html_url: REPO } })), /default/);
    refused(problem(dispatch({ version: "0.12.0", prerelease: "true" })), /0\.12\.0 is taken/);
    refused(problem(dispatch({ version: "1.0.0" }), { ...facts, releases: [], tags: ["1.0.0"] }), /1\.0\.0 is taken/);
    refused(problem(dispatch({ version: "0.9.0" })), /taken/);
    refused(problem(dispatch({ version: "0.8.0" })), /0\.8\.0 is not newer than 0\.9\.0, the latest release/);
    refused(problem(dispatch({ version: "0.9.0-rc.1", prerelease: "true" })), /not newer than 0\.9\.0/);
    refused(problem(dispatch(), { eventName: "workflow_dispatch" }), /were not read/);
    refused(problem(dispatch(), { ...facts, tags: null }), /were not read/);
    refused(problem({ ref: "refs/heads/main" }, facts), /no inputs/);
    refused(problem(dispatch(), { ...facts, eventName: "push" }), /does not run on push events/);
});

test("the Release button's notes URL is its release page only when the repository URL is GitHub's", () => {
    for (const html_url of ["https://evil.example/x/y", `${REPO}\npublish=true`, undefined]) {
        assert.equal(releasePlan(dispatch({}, { repository: { default_branch: "main", html_url } }), facts).plan.notesUrl, "", String(html_url));
    }
});

test("the command plans the button's release from the event name and the files of releases and tags", (t) => {
    const dir = tempDir(t, { "event.json": dispatch({ version: "1.2.0" }), "releases.json": RELEASES, "tags.txt": `${TAGS.join("\n")}\n` });
    const output = join(dir, "output");
    const env = { GITHUB_EVENT_PATH: join(dir, "event.json"), GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_OUTPUT: output, FOUNDRY_TOKEN_PRESENT: "true" };
    const args = ["--releases", join(dir, "releases.json"), "--tags", join(dir, "tags.txt")];
    assert.equal(run(args, env, logger()), 0);
    assert.deepEqual(readFileSync(output, "utf8").trim().split("\n"), [
        "version=1.2.0", "prerelease=false", "strings-mode=enforce", "registry-mode=enforce", "publish=true", `notes-url=${REPO}/releases/tag/1.2.0`,
    ]);

    // The files a release published by hand never has (the read step runs only for the button) count as not given...
    const missing = ["--releases", join(dir, "nope.json"), "--tags", join(dir, "nope.txt")];
    assert.equal(run(missing, { ...env, GITHUB_EVENT_NAME: "release", GITHUB_EVENT_PATH: join(dir, "published.json") }, logger()), 1, "no event file");
    const published = tempDir(t, { "event.json": event({ tag_name: "1.2.0" }) });
    assert.equal(run(missing, { GITHUB_EVENT_PATH: join(published, "event.json"), GITHUB_EVENT_NAME: "release" }, logger()), 0);
    // ...which the button cannot do without.
    const log = logger();
    assert.equal(run(missing, { ...env, GITHUB_ACTIONS: "true" }, log), 1);
    assert.match(log.text(), /^::error title=Release plan::the existing releases and tags were not read/m);

    // A file that is there but unreadable fails with its name.
    const bad = tempDir(t, { "releases.json": "{" });
    const badLog = logger();
    assert.equal(run(["--releases", join(bad, "releases.json"), "--tags", join(dir, "tags.txt")], env, badLog), 1);
    assert.match(badLog.text(), /releases\.json/);
});

test("the package job's recheck: still free (drafts count) and newer than the latest, or exit 1 with the reason", (t) => {
    assert.deepEqual(freshnessProblems("1.0.0", RELEASES, TAGS), []);
    assert.match(freshnessProblems("1.0.0", [...RELEASES, { tagName: "1.0.0", isDraft: true, isPrerelease: false, isLatest: false }], TAGS)[0], /taken: a release, draft or tag/);
    assert.match(freshnessProblems("1.0.0", [...RELEASES, { tagName: "1.1.0", isDraft: false, isPrerelease: false, isLatest: true }], TAGS)[0], /not newer than 1\.1\.0/);
    assert.match(freshnessProblems("1.0.0", null, TAGS)[0], /not read/);

    const dir = tempDir(t, { "releases.json": RELEASES, "tags.txt": `${TAGS.join("\n")}\n` });
    const files = ["--releases", join(dir, "releases.json"), "--tags", join(dir, "tags.txt")];
    const ok = logger();
    assert.equal(run(["--recheck", "1.0.0", ...files], { GITHUB_OUTPUT: join(dir, "output") }, ok), 0);
    assert.match(ok.text(), /1\.0\.0 is still free/);
    assert.throws(() => readFileSync(join(dir, "output")), "the recheck writes no outputs");
    const late = logger();
    assert.equal(run(["--recheck", "0.9.0", ...files], { GITHUB_ACTIONS: "true" }, late), 1);
    assert.match(late.text(), /^::error title=Release plan::0\.9\.0 is taken/m);
    assert.match(late.text(), /^::error title=Release plan::0\.9\.0 is not newer than 0\.9\.0/m);
    assert.equal(run(["--recheck", "v1.0.0", ...files], {}, logger()), 1);
    assert.equal(run(["--recheck", "1.0.0", "--releases", join(dir, "releases.json")], {}, logger()), 2);
    assert.equal(run(["--recheck", "1.0.0", "--releases", join(dir, "missing.json"), "--tags", join(dir, "tags.txt")], {}, logger()), 1);
});
