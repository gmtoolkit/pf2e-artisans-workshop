/**
 * The pf2e churn watch (tools/pf2e-watch.mjs, DESIGN.md 3.3, 16.9), against a fake GitHub API: the pin comes from CI, only
 * pf2e system releases count (never SF2e's or pf2e-anachronism's), the watched paths, the report's quoting, what counts as
 * new, and the one issue it keeps.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
    ISSUE_TITLE, TARGETS, WATCHED_PATHS, collect, keywordHits, pinnedFromWorkflow, readResults, render, run, syncIssue, systemReleases,
} from "../tools/pf2e-watch.mjs";
import { ROOT, logger, tempDir } from "./helpers.mjs";

const PINNED = { sha: "28d9d156f252d084371d994dc359509b49eadf18", tag: "pf2e-8.6.1" };
const DEV = "057bd484b4901b1257c434af97efe590023e4440";
const NEW = "1111111111111111111111111111111111111111";
const release = (tag, body = "", extra = {}) => ({ tag_name: tag, draft: false, html_url: `https://github.com/foundryvtt/pf2e/releases/tag/${tag}`, published_at: "2026-10-30T00:00:00Z", body, ...extra });
const commit = (sha, title, date = "2026-10-20T00:00:00Z") => ({ sha, html_url: `https://github.com/foundryvtt/pf2e/commit/${sha}`, commit: { message: `${title}\n\nbody`, committer: { date } } });

/** A fake GitHub API over pf2e: `changes` maps a watched path to its commits; `gone` lists paths the dev head lacks. */
function fakeApi({ releases = [], changes = {}, gone = [] } = {}) {
    const calls = [];
    const api = async (path) => {
        calls.push(path);
        const repo = "repos/foundryvtt/pf2e";
        if (path === `${repo}/commits/${PINNED.sha}`) return { status: 200, body: commit(PINNED.sha, "Release 8.6.1", "2026-10-12T00:21:44Z") };
        if (path === repo) return { status: 200, body: { default_branch: "v14-dev" } };
        if (path === `${repo}/commits/v14-dev`) return { status: 200, body: commit(DEV, "head", "2026-10-27T05:30:38Z") };
        if (path === `${repo}/releases?per_page=100`) return { status: 200, body: releases };
        if (path.startsWith(`${repo}/commits/pf2e-`)) return { status: 200, body: { sha: path.endsWith("8.6.1") ? PINNED.sha : NEW } };
        const byPath = /^repos\/foundryvtt\/pf2e\/commits\?sha=(\w+)&path=([^&]+)&since=([^&]+)&per_page=100$/.exec(path);
        if (byPath) {
            assert.equal(byPath[1], DEV, "commits are read from the dev head");
            assert.equal(decodeURIComponent(byPath[3]), "2026-10-12T00:21:44Z", "since the pinned commit");
            return { status: 200, body: [...(changes[`${byPath[2]}/`] ?? changes[byPath[2]] ?? []), commit(PINNED.sha, "the pin itself")] };
        }
        const contents = /^repos\/foundryvtt\/pf2e\/contents\/(.+)\?ref=(\w+)$/.exec(path);
        if (contents) return gone.some((p) => p.replace(/\/$/, "") === contents[1]) ? { status: 404, body: { message: "Not Found" } } : { status: 200, body: [] };
        throw new Error(`unexpected API call ${path}`);
    };
    api.calls = calls;
    return api;
}

test("the pin is CI's pf2e checkout ref, with its tag in the comment", () => {
    assert.deepEqual(pinnedFromWorkflow(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")), PINNED);
    assert.equal(pinnedFromWorkflow("repository: foundryvtt/pf2e\n  ref: main\n"), null);
});

test("only pf2e system releases count: not SF2e's, not pf2e-anachronism's, not drafts; newest version first", () => {
    const releases = systemReleases([
        release("sf2e-1.6.1"), release("pf2e-anachronism-2.4.0"), release("pf2e-8.6.0"), release("pf2e-8.10.0"), release("pf2e-8.6.1"),
        release("pf2e-9.0.0", "", { draft: true }),
    ]);
    assert.deepEqual(releases.map((r) => r.tag_name), ["pf2e-8.10.0", "pf2e-8.6.1", "pf2e-8.6.0"]);
});

test("release notes: the lines that name a watched word, as words", () => {
    const hits = keywordHits([
        "### Bugfixes", "- Fix crafting formulas on the party sheet", "- Restore forest terrain", "- Rest for the Night heals",
        "- Port the dialog to DialogV2", "- Interest rates", "", "- Alchemical items",
    ].join("\n"));
    assert.deepEqual(hits.map((hit) => hit.keywords), [["craft", "formula", "party"], ["rest"], ["DialogV2"], ["alchem"]]);
    assert.equal(hits[0].line, "Fix crafting formulas on the party sheet");
    assert.equal(keywordHits(Array(20).fill("- craft").join("\n")).length, 8);
});

test("collect: releases since the pin, watched paths changed on the dev head (the pin's own commit left out), paths gone", async () => {
    const api = fakeApi({
        releases: [release("pf2e-8.6.1"), release("pf2e-8.7.0", "- Crafting: a fix"), release("sf2e-1.7.0"), release("pf2e-anachronism-2.5.0")],
        changes: { "src/module/actor/character/crafting/": [commit("2222222222222222222222222222222222222222", "Fix ammunition crafted (#23495)")] },
        gone: ["src/module/apps/effects-panel.ts"],
    });
    const watch = await collect({ api, pinned: PINNED });
    assert.deepEqual(watch.pinned, { ...PINNED, date: "2026-10-12T00:21:44Z" });
    assert.deepEqual(watch.dev, { branch: "v14-dev", sha: DEV, date: "2026-10-27T05:30:38Z" });
    assert.deepEqual(watch.newest, { tag: "pf2e-8.7.0", sha: NEW, url: release("pf2e-8.7.0").html_url });
    assert.deepEqual(watch.releases.map((r) => r.tag), ["pf2e-8.7.0"]);
    assert.deepEqual(watch.releases[0].hits, [{ keywords: ["craft"], line: "Crafting: a fix" }]);
    assert.equal(watch.paths.length, WATCHED_PATHS.length);
    assert.deepEqual(watch.paths.filter((p) => p.commits.length).map((p) => [p.path, p.commits.map((c) => c.title)]),
        [["src/module/actor/character/crafting/", ["Fix ammunition crafted (#23495)"]]]);
    assert.deepEqual(watch.paths.filter((p) => p.missing).map((p) => p.path), ["src/module/apps/effects-panel.ts"]);
    assert.ok(!api.calls.some((path) => path.includes("releases/latest")), "never releases/latest");
});

test("collect fails on an API error rather than reporting nothing changed", async () => {
    const api = async () => ({ status: 403, body: { message: "rate limited" } });
    await assert.rejects(collect({ api, pinned: PINNED }), /HTTP 403 \(rate limited\)/);
});

test("the report: nothing new is not a change; a release, a commit, a missing path or a failed validation is", async () => {
    const quiet = render(await collect({ api: fakeApi({ releases: [release("pf2e-8.6.1")] }), pinned: PINNED }));
    assert.equal(quiet.changed, false);
    assert.match(quiet.markdown, /Nothing is new since the pin\./);

    const watch = await collect({ api: fakeApi({ releases: [release("pf2e-8.7.0", "- @someone fixed #123 in `crafting`")] }), pinned: PINNED });
    const report = render(watch, { pinned: { status: "pass", unlisted: 760, changed: [], problems: 0 } });
    assert.equal(report.changed, true);
    assert.deepEqual(report.reasons, ["1 pf2e release(s) since the pin"]);
    // pf2e's text is quoted in a code span with its backticks taken out: no live @mention or #reference.
    assert.match(report.markdown, /craft: `@someone fixed #123 in 'crafting'`/);
    assert.doesNotMatch(report.markdown, /github\.com\/foundryvtt\/pf2e\/issues/);
    assert.match(report.markdown, /<!-- pf2e-churn-digest: [0-9a-f]{16} -->\n$/);

    const failed = render(await collect({ api: fakeApi(), pinned: PINNED }), {
        pinned: { status: "pass", unlisted: 760, changed: [], problems: 0 },
        dev: { status: "fail", unlisted: 765, changed: [{ uuid: "Compendium.pf2e.equipment-srd.Item.x", name: "Some Poison" }], problems: 2 },
    });
    assert.deepEqual(failed.reasons, [
        "registry validation against the dev checkout failed", "1 affliction reading(s) changed in the dev checkout",
        "5 more unlisted crafting candidate(s) in the dev checkout",
    ]);
    assert.match(failed.markdown, /\| dev \(v14-dev 057bd484\) \| fail \| 2 \| 765 \| `Some Poison` \|/);
    assert.match(failed.markdown, /\| newest \(none\) \| not run \|/);
});

test("the digest follows the findings, not the dates", async () => {
    const one = await collect({ api: fakeApi({ releases: [release("pf2e-8.7.0")] }), pinned: PINNED });
    const later = structuredClone(one);
    later.dev.date = "2026-11-01T00:00:00Z";
    later.releases[0].published = "2026-11-01T00:00:00Z";
    assert.equal(render(one).digest, render(later).digest);
    const more = structuredClone(one);
    more.paths[0].commits.push({ sha: "3333333333333333333333333333333333333333", date: "2026-11-01T00:00:00Z", title: "x", url: "u" });
    assert.notEqual(render(one).digest, render(more).digest);
});

test("the validations' results are read from the workflow's files", (t) => {
    const dir = tempDir(t, {
        "pinned.status": "pass\n", "pinned.json": { problems: [], unlisted: [1, 2], afflictions: { changed: [] } },
        "dev.status": "fail\n", "dev.log": "it crashed\n",
    });
    assert.deepEqual(readResults(dir), {
        pinned: { status: "pass", unlisted: 2, changed: [], problems: 0 },
        dev: { status: "fail", unlisted: null, changed: [], problems: null },
    });
    assert.deepEqual(TARGETS, ["pinned", "newest", "dev"]);
});

/** A fake issues API for `syncIssue`: the bot's issues, and every write. */
function issuesApi(issues) {
    const writes = [];
    const api = async (path, { method = "GET", body } = {}) => {
        if (method === "GET") {
            assert.equal(path, "repos/me/repo/issues?state=all&creator=github-actions%5Bbot%5D&per_page=100");
            return { status: 200, body: issues };
        }
        writes.push({ path, method, body });
        return method === "POST" ? { status: 201, body: { number: 99 } } : { status: 200, body: {} };
    };
    return { api, writes };
}

test("one issue: created when there is none, updated while open, left alone when it already says this", async () => {
    const report = { markdown: "report\n<!-- pf2e-churn-digest: abc -->\n", digest: "abc", changed: true };
    const fresh = issuesApi([{ number: 3, title: "Something else", state: "open", body: "" }]);
    assert.deepEqual(await syncIssue({ api: fresh.api, repo: "me/repo", ...report }), { action: "created", number: 99 });
    assert.deepEqual(fresh.writes, [{ path: "repos/me/repo/issues", method: "POST", body: { title: ISSUE_TITLE, body: report.markdown } }]);

    const open = issuesApi([{ number: 7, title: ISSUE_TITLE, state: "open", body: "old\n<!-- pf2e-churn-digest: old -->" }]);
    assert.deepEqual(await syncIssue({ api: open.api, repo: "me/repo", ...report }), { action: "updated", number: 7 });
    assert.deepEqual(open.writes, [{ path: "repos/me/repo/issues/7", method: "PATCH", body: { body: report.markdown } }]);

    const closedSame = issuesApi([{ number: 7, title: ISSUE_TITLE, state: "closed", body: report.markdown }]);
    assert.deepEqual(await syncIssue({ api: closedSame.api, repo: "me/repo", ...report }), { action: "unchanged", number: 7 });
    assert.deepEqual(closedSame.writes, [], "closing it without moving the pin keeps it closed");

    const closedOld = issuesApi([
        { number: 7, title: ISSUE_TITLE, state: "closed", body: "<!-- pf2e-churn-digest: old -->" },
        { number: 5, title: ISSUE_TITLE, state: "closed", body: report.markdown },
        { number: 8, title: ISSUE_TITLE, state: "open", body: "", pull_request: {} },
    ]);
    assert.equal((await syncIssue({ api: closedOld.api, repo: "me/repo", ...report })).action, "created", "the newest issue decides");

    const quiet = issuesApi([]);
    assert.deepEqual(await syncIssue({ api: quiet.api, repo: "me/repo", ...report, changed: false }), { action: "none" });
});

test("the command: collect writes watch.json and the checkout refs, report writes report.md and changed", async (t) => {
    const dir = tempDir(t);
    const output = join(dir, "output");
    const api = fakeApi({ releases: [release("pf2e-8.6.1")] });
    assert.equal(await run(ROOT, ["collect", "--out", dir], { GITHUB_OUTPUT: output }, { api, log: logger() }), 0);
    assert.deepEqual(readFileSync(output, "utf8").trim().split("\n"), [
        "pinned-tag=pf2e-8.6.1", `pinned-sha=${PINNED.sha}`, "newest-tag=pf2e-8.6.1", `newest-sha=${PINNED.sha}`, "dev-branch=v14-dev", `dev-sha=${DEV}`,
    ]);
    const reportOut = join(dir, "report-output");
    assert.equal(await run(ROOT, ["report", "--dir", dir], { GITHUB_OUTPUT: reportOut }, { log: logger() }), 0);
    assert.equal(readFileSync(reportOut, "utf8"), "changed=false\n");
    assert.match(readFileSync(join(dir, "report.md"), "utf8"), /^# pf2e churn watch/);
    assert.equal(await run(ROOT, ["issue", "--dir", dir], {}, { log: logger() }), 2, "issue needs GITHUB_REPOSITORY");
    assert.equal(await run(ROOT, ["nothing"], {}, { log: logger() }), 2);
});
