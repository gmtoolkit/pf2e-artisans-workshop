/**
 * What the release workflow does for the run that started it (DESIGN.md 16.2, 16.3, 16.9). Two events start it:
 *
 * - `workflow_dispatch`, the Release button (Actions, Release, Run workflow): the author types the version and ticks
 *   "pre-release". It must run from the default branch, the version must not already be a release or tag, and it must be
 *   newer than the latest release; the workflow then creates the release itself, as a draft with both files attached,
 *   and publishes it, so GitHub's "latest" moves only once the files are there.
 * - `release: published`, a release published by hand. GitHub fires it for pre-releases too.
 *
 * Either way the channel decides the rest: a stable release runs the strings gate and the registry completeness check in
 * enforce mode and is registered with the Package Release API when the repository has the token; a pre-release runs
 * both in report mode and is never registered.
 *
 *   node tools/release-plan.mjs [--event <file>] [--releases <file>] [--tags <file>]
 *   node tools/release-plan.mjs --recheck <version> --releases <file> --tags <file>
 *
 * `--event` defaults to $GITHUB_EVENT_PATH and the event's name comes from $GITHUB_EVENT_NAME (inferred from the payload
 * when that is unset). `--releases` is `gh release list --json tagName,isDraft,isPrerelease,isLatest` and `--tags` one
 * tag name per line; a dispatched release needs both, and a file that does not exist counts as not given. Reads
 * `FOUNDRY_TOKEN_PRESENT` ("true" when the FOUNDRY_RELEASE_TOKEN secret exists; the workflow passes only that, never the
 * token). Writes `version`, `prerelease`, `strings-mode`, `registry-mode`, `publish` and `notes-url` to $GITHUB_OUTPUT
 * when it is set, and prints them. Exits 1 when the release cannot go out as asked.
 *
 * `--recheck` is the package job's last look before the button creates its release, with that job's own token (which,
 * unlike the plan's, sees drafts): the version must still be free and newer than the latest stable release, which a
 * re-run of an old run, or a release made in the meantime, can have changed. It writes nothing and exits 1 if not.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { SEMVER } from "./check-manifest.mjs";
import { versionProblems } from "./package-release.mjs";

/**
 * Semantic-version precedence of two versions `SEMVER` accepts: negative when `a` comes first, positive when `b` does,
 * 0 when they are equal. A pre-release comes before its release; pre-release identifiers compare numerically when both
 * are numbers, a number before a word, words by code unit, and a shorter list first when the rest is equal.
 */
export function compareVersions(a, b) {
    const parse = (version) => {
        const dash = version.indexOf("-");
        const core = (dash === -1 ? version : version.slice(0, dash)).split(".").map(Number);
        return { core, pre: dash === -1 ? [] : version.slice(dash + 1).split(".") };
    };
    const x = parse(a);
    const y = parse(b);
    for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
    if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
    const numeric = (part) => /^\d+$/.test(part);
    for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
        const [p, q] = [x.pre[i], y.pre[i]];
        if (p === q) continue;
        if (numeric(p) && numeric(q)) return Number(p) - Number(q);
        if (numeric(p) !== numeric(q)) return numeric(p) ? -1 : 1;
        return p < q ? -1 : 1;
    }
    return x.pre.length - y.pre.length;
}

/**
 * The newest stable release among `releases` (`gh release list --json tagName,isDraft,isPrerelease,isLatest`): the one
 * GitHub marks latest, or a published stable release newer than it. Tags that are not bare versions are skipped.
 * @returns {string | null}
 */
export function newestStable(releases) {
    const stable = releases
        .filter((release) => (release.isLatest || (!release.isDraft && !release.isPrerelease)) && SEMVER.test(release.tagName ?? ""))
        .map((release) => release.tagName);
    return stable.reduce((newest, version) => (newest === null || compareVersions(version, newest) > 0 ? version : newest), null);
}

/**
 * Why `version` cannot be the button's next release, given the repository's `releases` and `tags`: a release (or draft)
 * or tag already has the name, or it is not newer than the latest stable release. Empty when it can.
 */
export function freshnessProblems(version, releases, tags) {
    if (!Array.isArray(releases) || !Array.isArray(tags)) return ["the existing releases and tags were not read, so the version cannot be checked as new"];
    const problems = [];
    if (releases.some((release) => release.tagName === version) || tags.includes(version)) {
        problems.push(`${version} is taken: a release, draft or tag with that name already exists`);
    }
    const newest = newestStable(releases);
    if (newest !== null && compareVersions(version, newest) <= 0) problems.push(`${version} is not newer than ${newest}, the latest release`);
    return problems;
}

/** The plan once the version and channel are known; `notices` gets what the run should say about it. */
function planFor({ version, prerelease, notesUrl, tokenPresent }, notices) {
    const mode = prerelease ? "report" : "enforce";
    if (prerelease) {
        notices.push(`${version} is a pre-release: strings gate and registry completeness in report mode, its own manifest URL, not registered with foundryvtt.com.`);
    } else if (!tokenPresent) {
        notices.push(`${version} is stable, but the repository has no FOUNDRY_RELEASE_TOKEN secret: it is not registered with foundryvtt.com.`);
    }
    return { version, prerelease, stringsMode: mode, registryMode: mode, publish: !prerelease && tokenPresent, notesUrl };
}

/** A `release` event: the release already exists, published by hand. */
function publishedPlan(event, { tokenPresent }) {
    const release = event?.release;
    if (!release || typeof release !== "object") return { problems: ["not a release event: no release in the payload"], notices: [], plan: null };
    if (release.draft) return { problems: ["the release is a draft; the workflow runs only for a published release"], notices: [], plan: null };
    const prerelease = release.prerelease === true;
    const version = release.tag_name;
    const problems = versionProblems(version, { prerelease });
    if (problems.length) return { problems, notices: [], plan: null };
    // The release page is the notes Foundry links to; anything else (or a value that could break $GITHUB_OUTPUT) is dropped.
    const notesUrl = typeof release.html_url === "string" && /^https:\/\/github\.com\/\S+$/.test(release.html_url) ? release.html_url : "";
    const notices = [];
    return { problems, notices, plan: planFor({ version, prerelease, notesUrl, tokenPresent }, notices) };
}

/** A `workflow_dispatch` event: the Release button, which creates the release once every gate has passed. */
function dispatchPlan(event, { tokenPresent, releases, tags }) {
    const inputs = event?.inputs;
    if (!inputs || typeof inputs !== "object") return { problems: ["not a workflow_dispatch event: no inputs in the payload"], notices: [], plan: null };
    // GitHub sends a boolean input as a string in the payload; accept the boolean too.
    const prerelease = inputs.prerelease === true || inputs.prerelease === "true";
    const version = inputs.version;
    const problems = versionProblems(version, { prerelease });
    if (problems.length) return { problems, notices: [], plan: null };

    const branch = event.repository?.default_branch;
    if (typeof branch !== "string" || !branch) problems.push("the payload does not say which branch is the default");
    else if (event.ref !== `refs/heads/${branch}`) problems.push(`run the Release workflow from ${branch}, not ${event.ref}: a release is cut from the default branch`);

    problems.push(...freshnessProblems(version, releases, tags));

    // The page the release will have; the repository URL must be GitHub's, and the version passed SEMVER above.
    const page = event.repository?.html_url;
    const notesUrl = typeof page === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(page) ? `${page}/releases/tag/${version}` : "";
    if (problems.length) return { problems, notices: [], plan: null };
    const notices = [];
    return { problems, notices, plan: planFor({ version, prerelease, notesUrl, tokenPresent }, notices) };
}

/**
 * The plan for a workflow event payload. `eventName` is $GITHUB_EVENT_NAME; without it the payload decides (a `release`
 * object is a release event, `inputs` a dispatch). `releases` and `tags` are what the repository already has, which a
 * dispatched release is checked against.
 * @returns {{problems: string[], notices: string[], plan: {version: string, prerelease: boolean, stringsMode: string,
 *   registryMode: string, publish: boolean, notesUrl: string} | null}}
 */
export function releasePlan(event, { tokenPresent = false, eventName, releases = null, tags = null } = {}) {
    const name = eventName ?? (event?.release ? "release" : event?.inputs ? "workflow_dispatch" : "release");
    if (name === "workflow_dispatch") return dispatchPlan(event, { tokenPresent, releases, tags });
    if (name !== "release") return { problems: [`the release workflow does not run on ${name} events`], notices: [], plan: null };
    return publishedPlan(event, { tokenPresent });
}

/** The plan as `name=value` lines for $GITHUB_OUTPUT. */
export function outputLines(plan) {
    return [
        `version=${plan.version}`, `prerelease=${plan.prerelease}`, `strings-mode=${plan.stringsMode}`,
        `registry-mode=${plan.registryMode}`, `publish=${plan.publish}`, `notes-url=${plan.notesUrl}`,
    ];
}

const USAGE = "Usage: release-plan.mjs [--event <file>] [--releases <file>] [--tags <file>]\n       release-plan.mjs --recheck <version> --releases <file> --tags <file>";

/** Run the command and return the exit code. `log` receives each output line. */
export function run(args = [], env = process.env, log = console.log) {
    let values;
    try {
        ({ values } = parseArgs({
            args, options: { event: { type: "string" }, releases: { type: "string" }, tags: { type: "string" }, recheck: { type: "string" } },
        }));
    } catch {
        log(USAGE);
        return 2;
    }
    const report = (problems) => {
        for (const problem of problems) log(env.GITHUB_ACTIONS ? `::error title=Release plan::${problem}` : `error: ${problem}`);
    };
    if (values.recheck !== undefined) {
        if (!values.releases || !values.tags) {
            log(USAGE);
            return 2;
        }
        let releases;
        let tags;
        let reading = values.releases;
        try {
            releases = JSON.parse(readFileSync(reading, "utf8"));
            tags = readFileSync((reading = values.tags), "utf8").split("\n").map((tag) => tag.trim()).filter(Boolean);
        } catch (error) {
            log(`error: ${reading}: ${error.message}`);
            return 1;
        }
        const problems = SEMVER.test(values.recheck) ? freshnessProblems(values.recheck, releases, tags) : [`not a version: ${JSON.stringify(values.recheck)}`];
        report(problems);
        if (problems.length) return 1;
        log(`${values.recheck} is still free and newer than the latest release.`);
        return 0;
    }
    const path = values.event ?? env.GITHUB_EVENT_PATH;
    if (!path) {
        log(`${USAGE}   (or set GITHUB_EVENT_PATH)`);
        return 2;
    }
    let event;
    let releases = null;
    let tags = null;
    let reading = path;
    try {
        event = JSON.parse(readFileSync(path, "utf8"));
        if (values.releases && existsSync((reading = values.releases))) releases = JSON.parse(readFileSync(reading, "utf8"));
        if (values.tags && existsSync((reading = values.tags))) tags = readFileSync(reading, "utf8").split("\n").map((tag) => tag.trim()).filter(Boolean);
    } catch (error) {
        log(`error: ${reading}: ${error.message}`);
        return 1;
    }
    const { problems, notices, plan } = releasePlan(event, {
        tokenPresent: env.FOUNDRY_TOKEN_PRESENT === "true", eventName: env.GITHUB_EVENT_NAME || undefined, releases, tags,
    });
    report(problems);
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
