/**
 * The pf2e churn watch (DESIGN.md 3.3, 16.9), run daily by `.github/workflows/pf2e-watch.yml` in two steps around the
 * registry validations it runs against pf2e checkouts:
 *
 *   node tools/pf2e-watch.mjs collect --out <dir>   read pf2e's releases, its dev head and the watched paths from the
 *                                                     GitHub API into <dir>/watch.json (GH_TOKEN or GITHUB_TOKEN if set)
 *   node tools/pf2e-watch.mjs report --dir <dir>    turn that and the validations' results into <dir>/report.md
 *   node tools/pf2e-watch.mjs issue --dir <dir>     open the churn issue, or update the open one (GH_TOKEN, GITHUB_REPOSITORY)
 *
 * The baseline is the pf2e release CI pins (`ref: <sha> # pf2e-x.y.z` under `repository: foundryvtt/pf2e` in
 * `.github/workflows/ci.yml`), so the report says what changed since the release the module was last checked against,
 * and stays the same until that pin moves. `collect` lists the `pf2e-<version>` releases newer than the pin (never
 * `releases/latest`, which in that repository is usually an SF2e release, and not the `pf2e-anachronism-*` tags), with
 * the lines of their notes that name a watched word; the commits on the dev branch since the pin that touch a watched
 * path; and the watched paths the dev branch no longer has. The workflow then validates the registry against the pinned
 * release, the newest release and the dev head, writing `<target>.status` ("pass" or "fail"), `<target>.json` (the
 * validator's `--json`) and `<target>.log` for each, and `report` sets `changed` (to $GITHUB_OUTPUT) when anything is
 * new. `issue` then keeps one issue, "pf2e churn watch", for it: it updates the open one, opens a new one when the last was
 * closed, and does nothing when the last one (open or closed) already reported the same findings, so closing the issue
 * without moving the pin is not undone the next morning. It finds its issues as the ones the workflow's bot opened.
 *
 * The report quotes pf2e's notes and commit titles in code spans, so no @mention or #reference in them notifies anyone
 * or cross-links an issue, and never links a pf2e issue.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

export const PF2E_REPO = "foundryvtt/pf2e";

/** The paths of 3.3 whose changes on pf2e's dev branch the module needs to hear about. */
export const WATCHED_PATHS = Object.freeze([
    "src/module/actor/character/crafting/",
    "src/module/rules/rule-element/crafting-ability.ts",
    "src/module/rules/rule-element/special-resource.ts",
    "src/module/system/action-macros/crafting/",
    "src/scripts/macros/rest-for-the-night.ts",
    "src/scripts/macros/earn-income.ts",
    "src/module/actor/inventory/index.ts",
    "src/module/actor/party/",
    "src/module/actor/loot/",
    "src/module/system/check/check.ts",
    "src/module/system/statistic/statistic.ts",
    "src/module/item/affliction/",
    "src/module/item/abstract-effect/",
    "src/module/item/effect/data.ts",
    "src/scripts/hooks/init.ts",
    "src/scripts/hooks/load.ts",
    "src/module/apps/effects-panel.ts",
    "src/module/system/text-editor.ts",
    "static/templates/actors/character/tabs/crafting.hbs",
    "static/templates/actors/party/sheet.hbs",
]);

/** The words of 3.3 to look for in release notes. */
export const NOTE_KEYWORDS = Object.freeze([
    ["craft", /\bcraft/i], ["alchem", /\balchem/i], ["formula", /\bformula/i], ["party", /\bpart(?:y|ies)\b/i],
    ["rest", /\brest\b/i], ["ApplicationV2", /ApplicationV2/], ["DialogV2", /DialogV2/], ["Svelte", /svelte/i],
    ["TypeDataModel", /TypeDataModel/],
]);

/** A pf2e system release's tag. */
export const RELEASE_TAG = /^pf2e-(\d+)\.(\d+)\.(\d+)$/;

/** The validation targets the workflow writes results for, in the report's order. */
export const TARGETS = Object.freeze(["pinned", "newest", "dev"]);

/** GitHub's issue bodies hold 65,536 characters; the report stops short of that. */
export const REPORT_LIMIT = 60000;

/** The pf2e release CI pins: `{sha, tag}` from a workflow's text, or null. */
export function pinnedFromWorkflow(text) {
    const match = /repository:\s*foundryvtt\/pf2e\s*\n\s*ref:\s*([0-9a-f]{40})\s*#\s*(pf2e-\d+\.\d+\.\d+)\s*$/m.exec(text);
    return match ? { sha: match[1], tag: match[2] } : null;
}

/** Compare two `pf2e-x.y.z` tags as versions. */
export function compareTags(a, b) {
    const [x, y] = [RELEASE_TAG.exec(a), RELEASE_TAG.exec(b)];
    for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
    return 0;
}

/** pf2e system releases (no drafts, no other packages' tags), newest version first. */
export function systemReleases(releases) {
    return releases.filter((release) => !release.draft && RELEASE_TAG.test(release.tag_name ?? "")).sort((a, b) => compareTags(b.tag_name, a.tag_name));
}

/** The lines of release notes that name a watched word, at most `limit`. */
export function keywordHits(body, limit = 8) {
    const hits = [];
    for (const raw of (body ?? "").split(/\r?\n/)) {
        const line = raw.replace(/^\s*(?:[-*]|#+)\s*/, "").trim();
        if (!line) continue;
        const keywords = NOTE_KEYWORDS.filter(([, pattern]) => pattern.test(line)).map(([word]) => word);
        if (keywords.length) hits.push({ keywords, line: line.length > 200 ? `${line.slice(0, 199)}…` : line });
        if (hits.length >= limit) break;
    }
    return hits;
}

/** A GitHub REST client: `api(path, {method, body})` resolves to `{status, body}`. */
export function githubApi({ token, fetchImpl = fetch } = {}) {
    return async (path, { method = "GET", body } = {}) => {
        const response = await fetchImpl(`https://api.github.com/${path}`, {
            method,
            headers: {
                Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pf2e-artisans-workshop-churn-watch",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body ? { "Content-Type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, body: await response.json().catch(() => null) };
    };
}

const encodePath = (path) => path.replace(/\/$/, "").split("/").map(encodeURIComponent).join("/");

/**
 * Everything the report needs from the GitHub API.
 * @param {{api: Function, pinned: {sha: string, tag: string}}} options
 */
export async function collect({ api, pinned }) {
    const get = async (path) => {
        const { status, body } = await api(path);
        if (status < 200 || status >= 300) throw new Error(`GitHub API ${path}: HTTP ${status}${body?.message ? ` (${body.message})` : ""}`);
        return body;
    };
    const repo = `repos/${PF2E_REPO}`;
    const pinnedCommit = await get(`${repo}/commits/${pinned.sha}`);
    const since = pinnedCommit.commit.committer.date;
    const branch = (await get(repo)).default_branch;
    const head = await get(`${repo}/commits/${encodeURIComponent(branch)}`);
    const dev = { branch, sha: head.sha, date: head.commit.committer.date };

    const releases = systemReleases(await get(`${repo}/releases?per_page=100`));
    const newer = releases.filter((release) => compareTags(release.tag_name, pinned.tag) > 0).reverse();
    const top = releases[0] ?? null;
    const newest = top ? { tag: top.tag_name, sha: (await get(`${repo}/commits/${encodeURIComponent(top.tag_name)}`)).sha, url: top.html_url } : null;

    const paths = [];
    for (const path of WATCHED_PATHS) {
        const encoded = encodePath(path);
        const commits = (await get(`${repo}/commits?sha=${dev.sha}&path=${encoded}&since=${encodeURIComponent(since)}&per_page=100`))
            .filter((commit) => commit.sha !== pinned.sha)
            .map((commit) => ({ sha: commit.sha, date: commit.commit.committer.date, title: commit.commit.message.split("\n")[0], url: commit.html_url }));
        const contents = await api(`${repo}/contents/${encoded}?ref=${dev.sha}`);
        if (contents.status !== 404 && (contents.status < 200 || contents.status >= 300)) {
            throw new Error(`GitHub API contents of ${path}: HTTP ${contents.status}`);
        }
        paths.push({ path, missing: contents.status === 404, commits });
    }

    return {
        pinned: { ...pinned, date: since },
        newest,
        dev,
        releases: newer.map((release) => ({ tag: release.tag_name, url: release.html_url, published: release.published_at, hits: keywordHits(release.body) })),
        paths,
    };
}

/** A code span that shows `text` as it is: no backticks inside, so no mention, reference or markup in it is live. */
const code = (text) => `\`${String(text).replace(/`/g, "'")}\``;
const short = (sha) => sha.slice(0, 8);

/** The validation result of each target that ran: `{status, unlisted, changed, problems}`, from the workflow's files. */
export function readResults(dir) {
    const results = {};
    for (const target of TARGETS) {
        const statusFile = join(dir, `${target}.status`);
        if (!existsSync(statusFile)) continue;
        let json = null;
        try {
            json = JSON.parse(readFileSync(join(dir, `${target}.json`), "utf8"));
        } catch {
            // no JSON: the validator stopped before writing it; the status and the log say why
        }
        results[target] = {
            status: readFileSync(statusFile, "utf8").trim(),
            unlisted: json?.unlisted?.length ?? null,
            changed: json?.afflictions?.changed ?? [],
            problems: json?.problems?.length ?? null,
        };
    }
    return results;
}

/** The churn issue's title; `issue` finds its issues by it, among those the workflow's bot opened. */
export const ISSUE_TITLE = "pf2e churn watch";

/** The hidden line that records which findings an issue reported. */
const digestMarker = (digest) => `<!-- pf2e-churn-digest: ${digest} -->`;

/**
 * The report, whether anything is new since the pin, and a digest of the findings (the releases, commits, missing paths
 * and validation outcomes, not the wording or the dates), which `issue` compares with the last issue's.
 * @returns {{markdown: string, changed: boolean, reasons: string[], digest: string}}
 */
export function render(watch, results = {}) {
    const reasons = [];
    const touched = watch.paths.filter((path) => path.commits.length);
    const missing = watch.paths.filter((path) => path.missing);
    if (watch.releases.length) reasons.push(`${watch.releases.length} pf2e release(s) since the pin`);
    if (touched.length) reasons.push(`${touched.length} watched path(s) changed on ${watch.dev.branch}`);
    if (missing.length) reasons.push(`${missing.length} watched path(s) gone from ${watch.dev.branch}`);
    for (const target of TARGETS) {
        const result = results[target];
        if (!result) continue;
        if (result.status !== "pass") reasons.push(`registry validation against the ${target} checkout failed`);
        if (target !== "pinned" && result.changed.length) reasons.push(`${result.changed.length} affliction reading(s) changed in the ${target} checkout`);
        if (target !== "pinned" && result.unlisted !== null && results.pinned?.unlisted != null && result.unlisted > results.pinned.unlisted) {
            reasons.push(`${result.unlisted - results.pinned.unlisted} more unlisted crafting candidate(s) in the ${target} checkout`);
        }
    }

    const lines = [
        "# pf2e churn watch",
        "",
        `Pinned in CI: [${watch.pinned.tag}](https://github.com/${PF2E_REPO}/releases/tag/${watch.pinned.tag}) (${short(watch.pinned.sha)}, ${watch.pinned.date}). ` +
            `Newest release: ${watch.newest ? `[${watch.newest.tag}](${watch.newest.url}) (${short(watch.newest.sha)})` : "none found"}. ` +
            `Dev head: ${code(watch.dev.branch)} at [${short(watch.dev.sha)}](https://github.com/${PF2E_REPO}/commit/${watch.dev.sha}) (${watch.dev.date}).`,
        "",
        reasons.length ? `What is new since the pin: ${reasons.join("; ")}.` : "Nothing is new since the pin.",
        "",
        "## pf2e releases since the pin",
        "",
    ];
    if (!watch.releases.length) lines.push("None.");
    for (const release of watch.releases) {
        lines.push(`- [${release.tag}](${release.url}) (${release.published})${release.hits.length ? ":" : ": no watched words in its notes"}`);
        for (const hit of release.hits) lines.push(`  - ${hit.keywords.join(", ")}: ${code(hit.line)}`);
    }
    lines.push("", `## Watched paths changed on ${code(watch.dev.branch)} since the pin`, "");
    if (!touched.length) lines.push("None.");
    for (const path of touched) {
        lines.push(`- ${code(path.path)}: ${path.commits.length}${path.commits.length === 100 ? "+" : ""} commit(s)`);
        for (const commit of path.commits.slice(0, 10)) lines.push(`  - [${short(commit.sha)}](${commit.url}) ${commit.date.slice(0, 10)} ${code(commit.title)}`);
        if (path.commits.length > 10) lines.push(`  - and ${path.commits.length - 10} more`);
    }
    if (missing.length) {
        lines.push("", `## Watched paths no longer on ${code(watch.dev.branch)}`, "");
        for (const path of missing) lines.push(`- ${code(path.path)}: moved or removed; find where it went and update the watch list (DESIGN.md 3.3)`);
    }
    lines.push("", "## Registry validation", "", "| Checkout | Result | Problems | Unlisted candidates | Affliction readings changed since the pin |", "|---|---|---|---|---|");
    for (const target of TARGETS) {
        const result = results[target];
        const ref = target === "pinned" ? watch.pinned.tag : target === "newest" ? (watch.newest?.tag ?? "none") : `${watch.dev.branch} ${short(watch.dev.sha)}`;
        if (!result) lines.push(`| ${target} (${ref}) | not run | | | |`);
        else {
            lines.push(`| ${target} (${ref}) | ${result.status} | ${result.problems ?? "?"} | ${result.unlisted ?? "?"} | ` +
                `${target === "pinned" ? "" : result.changed.length ? result.changed.slice(0, 5).map((item) => code(item.name)).join(", ") + (result.changed.length > 5 ? ", ..." : "") : "none"} |`);
        }
    }
    lines.push(
        "",
        "The validation logs are in this run's job log. When a release is checked, bump the pinned pf2e commit in " +
            "`.github/workflows/ci.yml` and `release.yml` (the same line in both), raise `relationships.systems[pf2e]` and " +
            "`compatibility.verified` in `module.json` as DESIGN.md 3.1 says, and close this issue; the target is a `verified` bump " +
            "within a week of each pf2e release (DESIGN.md 3.3).",
        "",
    );
    const digest = createHash("sha256").update(JSON.stringify({
        pinned: watch.pinned.sha, releases: watch.releases.map((release) => release.tag), missing: missing.map((path) => path.path),
        commits: touched.flatMap((path) => path.commits.map((commit) => commit.sha)).sort(),
        results: TARGETS.map((target) => results[target] && [target, results[target].status, results[target].unlisted, results[target].changed.map((item) => item.uuid)]),
    })).digest("hex").slice(0, 16);
    let markdown = lines.join("\n");
    if (markdown.length > REPORT_LIMIT) markdown = `${markdown.slice(0, REPORT_LIMIT)}\n\n(The report was cut short; the job log has the rest.)\n`;
    markdown += `${digestMarker(digest)}\n`;
    return { markdown, changed: reasons.length > 0, reasons, digest };
}

/**
 * Open or update the churn issue (see the header). `api` is a `githubApi`; `repo` is "owner/name".
 * @returns {Promise<{action: "none"|"unchanged"|"updated"|"created", number?: number}>}
 */
export async function syncIssue({ api, repo, markdown, digest, changed }) {
    if (!changed) return { action: "none" };
    const { status, body } = await api(`repos/${repo}/issues?state=all&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100`);
    if (status !== 200) throw new Error(`GitHub API issues of ${repo}: HTTP ${status}`);
    const last = body.filter((issue) => !issue.pull_request && issue.title === ISSUE_TITLE).sort((a, b) => b.number - a.number)[0];
    if (last?.body?.includes(digestMarker(digest))) return { action: "unchanged", number: last.number };
    if (last?.state === "open") {
        const update = await api(`repos/${repo}/issues/${last.number}`, { method: "PATCH", body: { body: markdown } });
        if (update.status !== 200) throw new Error(`GitHub API update of issue ${last.number}: HTTP ${update.status}`);
        return { action: "updated", number: last.number };
    }
    const created = await api(`repos/${repo}/issues`, { method: "POST", body: { title: ISSUE_TITLE, body: markdown } });
    if (created.status !== 201) throw new Error(`GitHub API new issue: HTTP ${created.status}`);
    return { action: "created", number: created.body.number };
}

/** Run the command and return the exit code. `log` receives each output line. */
export async function run(root, args = [], env = process.env, { api, log = console.log } = {}) {
    const [command, ...rest] = args;
    let values;
    try {
        ({ values } = parseArgs({ args: rest, options: { out: { type: "string" }, dir: { type: "string" } } }));
    } catch {
        values = {};
    }
    const output = (lines) => {
        for (const line of lines) log(line);
        if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
    };

    if (command === "collect" && values.out) {
        const pinned = pinnedFromWorkflow(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
        if (!pinned) {
            log("error: .github/workflows/ci.yml pins no pf2e release (a `ref: <sha> # pf2e-x.y.z` line under `repository: foundryvtt/pf2e`)");
            return 1;
        }
        let watch;
        try {
            watch = await collect({ api: api ?? githubApi({ token: env.GH_TOKEN || env.GITHUB_TOKEN }), pinned });
        } catch (error) {
            log(`error: ${error.message}`);
            return 1;
        }
        mkdirSync(values.out, { recursive: true });
        writeFileSync(join(values.out, "watch.json"), `${JSON.stringify(watch, null, 2)}\n`);
        output([
            `pinned-tag=${watch.pinned.tag}`, `pinned-sha=${watch.pinned.sha}`, `newest-tag=${watch.newest?.tag ?? ""}`,
            `newest-sha=${watch.newest?.sha ?? ""}`, `dev-branch=${watch.dev.branch}`, `dev-sha=${watch.dev.sha}`,
        ]);
        return 0;
    }
    if ((command === "report" || command === "issue") && values.dir) {
        let watch;
        try {
            watch = JSON.parse(readFileSync(join(values.dir, "watch.json"), "utf8"));
        } catch (error) {
            log(`error: ${error.message}`);
            return 1;
        }
        const report = render(watch, readResults(values.dir));
        if (command === "report") {
            writeFileSync(join(values.dir, "report.md"), report.markdown);
            for (const reason of report.reasons) log(`  ${reason}`);
            output([`changed=${report.changed}`]);
            return 0;
        }
        if (!env.GITHUB_REPOSITORY) {
            log("error: set GITHUB_REPOSITORY to the repository the issue belongs to (owner/name)");
            return 2;
        }
        try {
            const result = await syncIssue({ api: api ?? githubApi({ token: env.GH_TOKEN || env.GITHUB_TOKEN }), repo: env.GITHUB_REPOSITORY, ...report });
            log(`churn issue: ${result.action}${result.number ? ` (#${result.number})` : ""}`);
        } catch (error) {
            log(`error: ${error.message}`);
            return 1;
        }
        return 0;
    }
    log("Usage: pf2e-watch.mjs collect --out <dir> | report --dir <dir> | issue --dir <dir>");
    return 2;
}

if (import.meta.main) {
    process.exitCode = await run(join(import.meta.dirname, ".."), process.argv.slice(2));
}
