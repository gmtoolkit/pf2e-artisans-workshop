/**
 * Register a stable release with foundryvtt.com's Package Release API (DESIGN.md 16.3, 16.9). The release workflow runs
 * it after uploading `module.json` and `module.zip`, only for a stable release and only when the repository has the
 * FOUNDRY_RELEASE_TOKEN secret (`tools/release-plan.mjs` decides).
 *
 *   FOUNDRY_RELEASE_TOKEN=... node tools/publish-foundry.mjs --version <x.y.z> --notes <release page URL>
 *
 * First it reads the release's own `module.json` back from GitHub, as Foundry will, and checks it is this version with
 * this release's zip, and that the zip downloads. Then it posts `{id, release: {version, manifest, notes,
 * compatibility}}`, where `manifest` is the version-specific URL, never `/latest`. Unless FOUNDRY_RELEASE_LIVE is "true"
 * (a repository variable the author sets after the first dry run has passed), the request carries `"dry-run": true`, so
 * foundryvtt.com validates it and changes nothing. The token is read from the environment only, never from an argument,
 * and never printed. At most one release a minute is accepted; the workflow sends one.
 */
import { parseArgs } from "node:util";
import { MODULE_ID } from "../scripts/constants.mjs";
import { releaseUrl } from "./check-manifest.mjs";

export const RELEASE_API = "https://foundryvtt.com/_api/packages/release_version/";

/** The request body for `manifest` (the release's own `module.json`). */
export function releaseBody(manifest, { notesUrl, live }) {
    const { minimum, verified, maximum } = manifest.compatibility ?? {};
    return {
        id: MODULE_ID,
        ...(live ? {} : { "dry-run": true }),
        release: {
            version: manifest.version,
            manifest: releaseUrl(manifest.version, "module.json"),
            notes: notesUrl,
            compatibility: { minimum: minimum ?? "", verified: verified ?? "", maximum: maximum ?? "" },
        },
    };
}

/** @returns {string[]} what is wrong with the `module.json` a release serves, for `version` */
export function manifestProblems(manifest, version) {
    const problems = [];
    if (manifest?.id !== MODULE_ID) problems.push(`its id is ${JSON.stringify(manifest?.id)}, not ${MODULE_ID}`);
    if (manifest?.version !== version) problems.push(`its version is ${JSON.stringify(manifest?.version)}, not ${version}`);
    if (manifest?.download !== releaseUrl(version, "module.zip")) problems.push(`its download is not ${releaseUrl(version, "module.zip")}`);
    if (manifest?.flags?.[MODULE_ID]?.unreleased) problems.push("it still carries the unreleased marker");
    return problems;
}

/**
 * Check the release on GitHub and register it.
 * @returns {Promise<number>} the exit code
 */
export async function publish({ version, notesUrl, token, live = false, fetchImpl = fetch, log = console.log }) {
    if (!token) {
        log("error: FOUNDRY_RELEASE_TOKEN is not set");
        return 1;
    }
    if (!/^https:\/\/github\.com\/\S+$/.test(notesUrl ?? "")) {
        log(`error: --notes must be the release's page on GitHub (got ${JSON.stringify(notesUrl)})`);
        return 1;
    }
    const manifestUrl = releaseUrl(version, "module.json");
    let manifest;
    try {
        const response = await fetchImpl(manifestUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        manifest = await response.json();
    } catch (error) {
        log(`error: ${manifestUrl}: ${error.message}`);
        return 1;
    }
    const problems = manifestProblems(manifest, version);
    for (const problem of problems) log(`error: ${manifestUrl}: ${problem}`);
    if (problems.length) return 1;
    try {
        const response = await fetchImpl(manifest.download, { method: "HEAD" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        log(`error: ${manifest.download}: ${error.message}`);
        return 1;
    }

    const body = releaseBody(manifest, { notesUrl, live });
    log(`${live ? "Registering" : "Dry run: validating"} ${MODULE_ID} ${version} with foundryvtt.com (manifest ${body.release.manifest})`);
    let response;
    let answer;
    try {
        response = await fetchImpl(RELEASE_API, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: token },
            body: JSON.stringify(body),
        });
        answer = await response.json().catch(() => ({}));
    } catch (error) {
        log(`error: ${RELEASE_API}: ${error.message}`);
        return 1;
    }
    if (!response.ok || answer.status !== "success") {
        log(`error: foundryvtt.com answered HTTP ${response.status}: ${JSON.stringify(answer.errors ?? answer.message ?? answer)}`);
        return 1;
    }
    log(live ? `Registered: ${answer.page ?? "(no page in the answer)"}` : `Dry run passed: ${answer.message ?? "foundryvtt.com accepted the request"}`);
    if (!live) log("Nothing was registered. Set the repository variable FOUNDRY_RELEASE_LIVE to true to register the next release.");
    return 0;
}

/** Run the command and return the exit code. `log` receives each output line. */
export async function run(args = [], env = process.env, { fetchImpl = fetch, log = console.log } = {}) {
    let values;
    try {
        ({ values } = parseArgs({ args, options: { version: { type: "string" }, notes: { type: "string" } } }));
    } catch {
        values = null;
    }
    if (!values?.version || !values.notes) {
        log("Usage: FOUNDRY_RELEASE_TOKEN=... publish-foundry.mjs --version <x.y.z> --notes <release page URL>");
        return 2;
    }
    return publish({
        version: values.version, notesUrl: values.notes, token: env.FOUNDRY_RELEASE_TOKEN, live: env.FOUNDRY_RELEASE_LIVE === "true",
        fetchImpl, log,
    });
}

if (import.meta.main) {
    process.exitCode = await run(process.argv.slice(2));
}
