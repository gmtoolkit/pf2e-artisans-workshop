/**
 * What the release workflow does for the release that started it (DESIGN.md 16.2, 16.3, 16.9). GitHub fires
 * `release: published` for pre-releases too, so the channel comes from the event: a stable release runs the strings gate
 * and the registry completeness check in enforce mode and is registered with the Package Release API when the repository
 * has the token; a pre-release runs both in report mode and is never registered.
 *
 *   node tools/release-plan.mjs [--event <file>]      (default: $GITHUB_EVENT_PATH)
 *
 * Reads `FOUNDRY_TOKEN_PRESENT` ("true" when the FOUNDRY_RELEASE_TOKEN secret exists; the workflow passes only that, never
 * the token). Writes `version`, `prerelease`, `strings-mode`, `registry-mode`, `publish` and `notes-url` to
 * $GITHUB_OUTPUT when it is set, and prints them. Exits 1 when the release cannot go out as tagged.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { versionProblems } from "./package-release.mjs";

/**
 * The plan for a `release` event payload.
 * @returns {{problems: string[], notices: string[], plan: {version: string, prerelease: boolean, stringsMode: string,
 *   registryMode: string, publish: boolean, notesUrl: string} | null}}
 */
export function releasePlan(event, { tokenPresent = false } = {}) {
    const release = event?.release;
    if (!release || typeof release !== "object") return { problems: ["not a release event: no release in the payload"], notices: [], plan: null };
    if (release.draft) return { problems: ["the release is a draft; the workflow runs only for a published release"], notices: [], plan: null };
    const prerelease = release.prerelease === true;
    const version = release.tag_name;
    const problems = versionProblems(version, { prerelease });
    if (problems.length) return { problems, notices: [], plan: null };

    const mode = prerelease ? "report" : "enforce";
    const notices = [];
    if (prerelease) {
        notices.push(`${version} is a pre-release: strings gate and registry completeness in report mode, its own manifest URL, not registered with foundryvtt.com.`);
    } else if (!tokenPresent) {
        notices.push(`${version} is stable, but the repository has no FOUNDRY_RELEASE_TOKEN secret: it is not registered with foundryvtt.com.`);
    }
    // The release page is the notes Foundry links to; anything else (or a value that could break $GITHUB_OUTPUT) is dropped.
    const notesUrl = typeof release.html_url === "string" && /^https:\/\/github\.com\/\S+$/.test(release.html_url) ? release.html_url : "";
    return {
        problems, notices,
        plan: { version, prerelease, stringsMode: mode, registryMode: mode, publish: !prerelease && tokenPresent, notesUrl },
    };
}

/** The plan as `name=value` lines for $GITHUB_OUTPUT. */
export function outputLines(plan) {
    return [
        `version=${plan.version}`, `prerelease=${plan.prerelease}`, `strings-mode=${plan.stringsMode}`,
        `registry-mode=${plan.registryMode}`, `publish=${plan.publish}`, `notes-url=${plan.notesUrl}`,
    ];
}

/** Run the command and return the exit code. `log` receives each output line. */
export function run(args = [], env = process.env, log = console.log) {
    let values;
    try {
        ({ values } = parseArgs({ args, options: { event: { type: "string" } } }));
    } catch {
        log("Usage: release-plan.mjs [--event <file>]");
        return 2;
    }
    const path = values.event ?? env.GITHUB_EVENT_PATH;
    if (!path) {
        log("Usage: release-plan.mjs [--event <file>]   (or set GITHUB_EVENT_PATH)");
        return 2;
    }
    let event;
    try {
        event = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        log(`error: ${path}: ${error.message}`);
        return 1;
    }
    const { problems, notices, plan } = releasePlan(event, { tokenPresent: env.FOUNDRY_TOKEN_PRESENT === "true" });
    for (const problem of problems) log(env.GITHUB_ACTIONS ? `::error title=Release plan::${problem}` : `error: ${problem}`);
    if (!plan) return 1;
    for (const notice of notices) log(env.GITHUB_ACTIONS ? `::notice title=Release plan::${notice}` : notice);
    const lines = outputLines(plan);
    for (const line of lines) log(line);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
    return 0;
}

if (import.meta.main) {
    process.exitCode = run(process.argv.slice(2));
}
