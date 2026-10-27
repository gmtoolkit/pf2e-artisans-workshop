/**
 * Registering a stable release with foundryvtt.com (tools/publish-foundry.mjs, DESIGN.md 16.3, 16.9), against a fake fetch:
 * the release's own manifest is checked first, the body names the version-specific manifest (never /latest), the request is
 * a dry run until FOUNDRY_RELEASE_LIVE is "true", and the token is sent but never printed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import { LATEST_MANIFEST, releaseUrl } from "../tools/check-manifest.mjs";
import { stampManifest } from "../tools/package-release.mjs";
import { RELEASE_API, manifestProblems, publish, releaseBody, run } from "../tools/publish-foundry.mjs";
import { ROOT, logger } from "./helpers.mjs";

const TOKEN = "fvttp_secret_token_value";
const NOTES = "https://github.com/gmtoolkit/pf2e-artisans-workshop/releases/tag/1.0.0";
const SOURCE = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
const RELEASED = stampManifest(SOURCE, { version: "1.0.0", prerelease: false });

/** A fetch that serves the release's files and answers the API; it records every request. */
function fakeFetch({ manifest = RELEASED, zipStatus = 200, api = { status: 200, json: { status: "success", page: "https://foundryvtt.com/packages/x/edit/" } } } = {}) {
    const calls = [];
    const respond = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, init });
        if (url === releaseUrl("1.0.0", "module.json")) return manifest ? respond(200, manifest) : respond(404, {});
        if (url === releaseUrl("1.0.0", "module.zip")) return respond(zipStatus, {});
        if (url === RELEASE_API) return respond(api.status, api.json);
        throw new Error(`unexpected request ${url}`);
    };
    return { calls, fetchImpl };
}

test("the body: the package id, the version-specific manifest (never /latest), the notes and the Foundry compatibility", () => {
    assert.equal(RELEASED.manifest, LATEST_MANIFEST, "a stable release's own manifest points at /latest");
    const body = releaseBody(RELEASED, { notesUrl: NOTES, live: true });
    assert.deepEqual(body, {
        id: MODULE_ID,
        release: { version: "1.0.0", manifest: releaseUrl("1.0.0", "module.json"), notes: NOTES, compatibility: SOURCE.compatibility },
    });
    assert.equal(releaseBody(RELEASED, { notesUrl: NOTES, live: false })["dry-run"], true);
});

test("the release's manifest must be this version's, with this release's zip and no unreleased marker", () => {
    assert.deepEqual(manifestProblems(RELEASED, "1.0.0"), []);
    assert.equal(manifestProblems(RELEASED, "1.0.1").length, 2);
    assert.match(manifestProblems(SOURCE, "0.0.0").join(), /unreleased marker/);
    assert.match(manifestProblems({ ...RELEASED, id: "x" }, "1.0.0")[0], /id/);
});

test("a dry run by default: it checks the release on GitHub, then posts with the token, and never prints it", async () => {
    const { calls, fetchImpl } = fakeFetch({ api: { status: 200, json: { status: "success", message: "dry run ok" } } });
    const log = logger();
    assert.equal(await publish({ version: "1.0.0", notesUrl: NOTES, token: TOKEN, fetchImpl, log }), 0);
    assert.deepEqual(calls.map((call) => call.url), [releaseUrl("1.0.0", "module.json"), releaseUrl("1.0.0", "module.zip"), RELEASE_API]);
    assert.equal(calls[1].init.method, "HEAD");
    const post = calls[2].init;
    assert.equal(post.method, "POST");
    assert.equal(post.headers.Authorization, TOKEN);
    assert.equal(post.headers["Content-Type"], "application/json");
    const body = JSON.parse(post.body);
    assert.equal(body["dry-run"], true);
    assert.equal(body.release.manifest, releaseUrl("1.0.0", "module.json"));
    assert.match(log.text(), /Dry run: validating/);
    assert.match(log.text(), /FOUNDRY_RELEASE_LIVE/);
    assert.doesNotMatch(log.text(), new RegExp(TOKEN));
});

test("live only when FOUNDRY_RELEASE_LIVE is exactly \"true\"", async () => {
    for (const [value, live] of [["true", true], ["1", false], ["", false], [undefined, false]]) {
        const { calls, fetchImpl } = fakeFetch();
        const env = { FOUNDRY_RELEASE_TOKEN: TOKEN, ...(value === undefined ? {} : { FOUNDRY_RELEASE_LIVE: value }) };
        assert.equal(await run(["--version", "1.0.0", "--notes", NOTES], env, { fetchImpl, log: logger() }), 0);
        assert.equal("dry-run" in JSON.parse(calls.at(-1).init.body), !live, String(value));
    }
});

test("it refuses without the token, with notes that are not the release page, and when the release is not as built", async () => {
    const log = logger();
    assert.equal(await run(["--version", "1.0.0", "--notes", NOTES], {}, { fetchImpl: fakeFetch().fetchImpl, log }), 1);
    assert.match(log.text(), /FOUNDRY_RELEASE_TOKEN is not set/);
    assert.equal(await run(["--version", "1.0.0"], { FOUNDRY_RELEASE_TOKEN: TOKEN }, { log: logger() }), 2);
    assert.equal(await publish({ version: "1.0.0", notesUrl: "https://example.com", token: TOKEN, fetchImpl: fakeFetch().fetchImpl, log: logger() }), 1);

    for (const options of [{ manifest: null }, { manifest: { ...RELEASED, version: "0.9.0" } }, { zipStatus: 404 }]) {
        const { calls, fetchImpl } = fakeFetch(options);
        assert.equal(await publish({ version: "1.0.0", notesUrl: NOTES, token: TOKEN, fetchImpl, log: logger() }), 1, JSON.stringify(options));
        assert.ok(!calls.some((call) => call.url === RELEASE_API), "nothing is posted");
    }
});

test("an error from foundryvtt.com fails the step and says why", async () => {
    const { fetchImpl } = fakeFetch({ api: { status: 400, json: { status: "error", errors: { manifest: ["bad"] } } } });
    const log = logger();
    assert.equal(await publish({ version: "1.0.0", notesUrl: NOTES, token: TOKEN, live: true, fetchImpl, log }), 1);
    assert.match(log.text(), /HTTP 400: \{"manifest":\["bad"\]\}/);
    const odd = fakeFetch({ api: { status: 200, json: { status: "error", message: "nope" } } });
    assert.equal(await publish({ version: "1.0.0", notesUrl: NOTES, token: TOKEN, fetchImpl: odd.fetchImpl, log: logger() }), 1);
});
