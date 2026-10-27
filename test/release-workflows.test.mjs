/**
 * The release engineering's wiring (DESIGN.md 3.3, 16.2, 16.8, 16.9), read from the workflow and issue-form files as text:
 * the release workflow runs the strings gate and the registry completeness check in the mode the plan gives (enforce for a
 * stable release, report for a pre-release), packages with the plan's version and channel, registers only when the plan
 * says so, and keeps the write permission and the token in the jobs that need them; every action is pinned by commit SHA;
 * the three workflows check out the same pf2e paths, which cover every pack folder a PF2E_SRC test reads; and the issue
 * forms ask what DESIGN 16.8 says a bug report needs.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { outputLines, releasePlan } from "../tools/release-plan.mjs";
import { ROOT } from "./helpers.mjs";

const read = (path) => readFileSync(join(ROOT, path), "utf8");
const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/release.yml", ".github/workflows/pf2e-watch.yml"];
const release = read(".github/workflows/release.yml");
const watch = read(".github/workflows/pf2e-watch.yml");

/** The jobs of a workflow, by name: each job's block of text (its lines up to the next job). */
function jobs(text) {
    const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
    const result = {};
    let name = null;
    for (const line of body.split("\n")) {
        const header = /^ {2}([\w-]+):\s*$/.exec(line);
        if (header) result[(name = header[1])] = "";
        else if (name) result[name] += `${line}\n`;
    }
    return result;
}

/** The steps of a job: each step's block of text. */
const steps = (job) => job.split(/\n(?= {6}- )/).filter((step) => /^ {6}- /m.test(step));
const stepNamed = (job, pattern) => steps(job).find((step) => pattern.test(step));

/** Every `sparse-checkout: |` list in a workflow, as arrays of paths. */
function sparseLists(text) {
    return [...text.matchAll(/sparse-checkout: \|\n((?: {12}\S.*\n)+)/g)].map((match) => match[1].trim().split("\n").map((line) => line.trim()));
}

test("every action in every workflow is pinned by a commit SHA, with the release named, and the same SHA everywhere", () => {
    const pins = new Map();
    for (const file of WORKFLOWS) {
        for (const match of read(file).matchAll(/uses:\s*(\S+)(.*)$/gm)) {
            const [, ref, rest] = match;
            const pinned = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{40})$/.exec(ref);
            assert.ok(pinned, `${file}: ${ref} is not pinned by a commit SHA`);
            assert.match(rest, /^ # v\d+\.\d+\.\d+$/, `${file}: ${ref} names no release`);
            assert.equal(pins.get(pinned[1]) ?? pinned[2], pinned[2], `${file}: ${pinned[1]} pinned to another SHA than elsewhere`);
            pins.set(pinned[1], pinned[2]);
        }
    }
    assert.deepEqual([...pins.keys()].sort(), ["actions/checkout", "actions/setup-node"]);
});

test("every workflow uses Node 24", () => {
    for (const file of WORKFLOWS) {
        const versions = [...read(file).matchAll(/node-version:\s*(\S+)/g)].map((match) => match[1]);
        assert.ok(versions.length, file);
        for (const version of versions) assert.equal(version, "24", file);
    }
});

test("the release workflow runs on a published release, read-only except the package job, one run per tag", () => {
    assert.match(release, /^on:\n {2}release:\n {4}types: \[published\]\n/m);
    assert.match(release, /^permissions:\n {2}contents: read\n/m);
    assert.match(release, /^concurrency:\n {2}group: release-\$\{\{ github\.event\.release\.tag_name \}\}\n {2}cancel-in-progress: false\n/m);
    const all = jobs(release);
    assert.deepEqual(Object.keys(all), ["plan", "check", "registry", "package", "publish"]);
    for (const [name, job] of Object.entries(all)) {
        const writes = /permissions:\n\s+contents: write/.test(job);
        assert.equal(writes, name === "package", `${name}: contents: write`);
        if (writes) assert.doesNotMatch(job, /npm (ci|install)/, "the job that can write installs nothing");
    }
    assert.match(all.check, /needs: plan\n/);
    assert.match(all.registry, /needs: plan\n/);
    assert.match(all.package, /needs: \[plan, check, registry\]\n/);
    assert.match(all.publish, /needs: \[plan, package\]\n/);
});

test("the plan job's outputs are the ones release-plan.mjs writes, and the jobs read only those", () => {
    const written = outputLines(releasePlan({ release: { tag_name: "1.0.0", prerelease: false } }).plan).map((line) => line.split("=")[0]);
    const declared = [...jobs(release).plan.matchAll(/^ {6}([\w-]+): \$\{\{ steps\.plan\.outputs\.([\w-]+) \}\}$/gm)];
    assert.deepEqual(declared.map((match) => match[1]), written);
    for (const match of declared) assert.equal(match[1], match[2]);
    for (const match of release.matchAll(/needs\.plan\.outputs\.([\w-]+)/g)) assert.ok(written.includes(match[1]), match[1]);
    const plan = stepNamed(jobs(release).plan, /id: plan/);
    assert.match(plan, /run: node tools\/release-plan\.mjs\n/);
    assert.match(plan, /FOUNDRY_TOKEN_PRESENT: \$\{\{ secrets\.FOUNDRY_RELEASE_TOKEN != '' \}\}/, "only whether the secret exists");
});

test("the strings gate runs in the plan's mode: enforce for a stable release, report for a pre-release", () => {
    const gate = stepNamed(jobs(release).check, /Strings gate/);
    assert.match(gate, /run: node tools\/check-strings\.mjs --mode "\$STRINGS_MODE"\n/);
    assert.match(gate, /STRINGS_MODE: \$\{\{ needs\.plan\.outputs\.strings-mode \}\}/);
    assert.equal(releasePlan({ release: { tag_name: "1.0.0", prerelease: false } }).plan.stringsMode, "enforce");
    assert.equal(releasePlan({ release: { tag_name: "1.0.0-rc.1", prerelease: true } }).plan.stringsMode, "report");
    for (const step of ["npm run lint", "npm test", "npm run check:assets", "npm run check:manifest"]) assert.ok(jobs(release).check.includes(`run: ${step}\n`), step);
});

test("the registry completeness check is enforced exactly when the plan says enforce", () => {
    const registry = stepNamed(jobs(release).registry, /Registry validation/);
    assert.match(registry, /REGISTRY_MODE: \$\{\{ needs\.plan\.outputs\.registry-mode \}\}/);
    assert.match(registry, /if \[ "\$REGISTRY_MODE" = enforce \]; then\n\s+node tools\/validate-registry\.mjs --pf2e \.\.\/pf2e --enforce\n\s+else\n\s+node tools\/validate-registry\.mjs --pf2e \.\.\/pf2e\n\s+fi/);
    assert.equal(registry.match(/--enforce/g).length, 1);
    assert.match(jobs(release).registry, /run: npm test\n\s+env:\n\s+PF2E_SRC: \.\.\/pf2e/);
});

test("the package job stamps with the plan's version and channel and uploads both files to that release", () => {
    const build = stepNamed(jobs(release).package, /package-release\.mjs/);
    assert.match(build, /if \[ "\$PRERELEASE" = true \]; then\n\s+node tools\/package-release\.mjs --version "\$VERSION" --prerelease --out dist\n\s+else\n\s+node tools\/package-release\.mjs --version "\$VERSION" --out dist\n/);
    assert.match(build, /VERSION: \$\{\{ needs\.plan\.outputs\.version \}\}/);
    assert.match(build, /PRERELEASE: \$\{\{ needs\.plan\.outputs\.prerelease \}\}/);
    const upload = stepNamed(jobs(release).package, /gh release upload/);
    assert.match(upload, /run: gh release upload "\$VERSION" dist\/module\.json dist\/module\.zip --clobber --repo "\$GITHUB_REPOSITORY"\n/);
    assert.match(upload, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test("only the publish job sees the token, and it runs only when the plan says publish", () => {
    const all = jobs(release);
    assert.match(all.publish, /^ {4}if: needs\.plan\.outputs\.publish == 'true'$/m);
    for (const [name, job] of Object.entries(all)) {
        assert.equal(/\$\{\{ secrets\.FOUNDRY_RELEASE_TOKEN \}\}/.test(job), name === "publish", name);
    }
    assert.match(all.publish, /run: node tools\/publish-foundry\.mjs --version "\$VERSION" --notes "\$NOTES_URL"\n/);
    assert.match(all.publish, /FOUNDRY_RELEASE_LIVE: \$\{\{ vars\.FOUNDRY_RELEASE_LIVE \}\}/);
});

test("no run step interpolates an expression into the shell (values reach scripts through env)", () => {
    for (const file of WORKFLOWS) {
        for (const step of read(file).split(/\n(?= {6}- )/)) {
            const run = /^ {8}run: (?:\|\n((?: {10}.*\n?)+)|(.*))$/m.exec(step);
            if (run) assert.doesNotMatch(run[1] ?? run[2], /\$\{\{/, `${file}: ${run[0].slice(0, 80)}`);
        }
    }
});

test("the three workflows check out the same pf2e paths, release.yml at CI's pin", () => {
    const ci = sparseLists(read(".github/workflows/ci.yml"));
    assert.equal(ci.length, 1);
    const lists = [...sparseLists(release), ...sparseLists(watch)];
    assert.equal(lists.length, 4, "release.yml's registry job, and the watch's pinned, newest and dev checkouts");
    for (const list of lists) assert.deepEqual(list, ci[0]);
    const pin = /repository: foundryvtt\/pf2e\n\s+ref: (\S+ # \S+)\n/;
    assert.equal(pin.exec(release)[1], pin.exec(read(".github/workflows/ci.yml"))[1]);
});

test("the pf2e checkout holds every pack folder and source file a PF2E_SRC test reads", () => {
    const list = sparseLists(read(".github/workflows/ci.yml"))[0];
    const covered = (path) => list.some((entry) => (entry.endsWith("/") ? `/${path}/`.startsWith(entry) || `/${path}`.startsWith(entry) : `/${path}` === entry));
    const reads = [];
    const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith(".mjs") ? [`${dir}/${entry.name}`] : []));
    for (const file of walk("test")) {
        const text = readFileSync(join(ROOT, file), "utf8");
        if (!text.includes("PF2E_SRC")) continue;
        for (const match of text.matchAll(/\bpack(?:Ids|Items)\("([\w-]+)"\)/g)) reads.push([file, `packs/pf2e/${match[1]}`]);
        for (const match of text.matchAll(/\bsource\("((?:packs|src)\/[^"]+)"\)/g)) reads.push([file, match[1]]);
    }
    assert.ok(reads.some(([, path]) => path === "packs/pf2e/journals"), "the M9a harness test reads the journals pack");
    for (const [file, path] of reads) assert.ok(covered(path), `${file} reads ${path}, which the pf2e checkout leaves out`);
});

test("the churn watch: daily and on demand, issues permission only on its job, nothing installed, outputs as the script writes them", () => {
    assert.match(watch, /^on:\n {2}schedule:\n {4}- cron: "[^"]+"\n {2}workflow_dispatch:\n/m);
    assert.match(watch, /^permissions:\n {2}contents: read\n/m);
    assert.match(jobs(watch).watch, /permissions:\n\s+contents: read\n\s+issues: write\n/);
    assert.doesNotMatch(watch, /npm (ci|install)/);
    for (const match of watch.matchAll(/steps\.collect\.outputs\.([\w-]+)/g)) {
        assert.ok(["pinned-sha", "newest-sha", "dev-sha", "pinned-tag", "newest-tag", "dev-branch"].includes(match[1]), match[1]);
    }
    assert.match(watch, /if: steps\.report\.outputs\.changed == 'true'\n\s+run: node tools\/pf2e-watch\.mjs issue --dir \.\.\/watch\n/);
    for (const target of ["pinned", "newest", "dev"]) assert.match(watch, new RegExp(`path: pf2e-${target}\\n`));
});

test("issue forms: no blank issues, and a bug report must give the module version, Foundry build, pf2e version, host, modules and console", () => {
    assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /^blank_issues_enabled: false$/m);
    const bug = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    const fields = Object.fromEntries(bug.split(/\n(?= {2}- type: )/).slice(1).map((block) => [/id: ([\w-]+)/.exec(block)?.[1], block]));
    for (const id of ["module-version", "foundry", "pf2e", "host", "modules", "console", "what-happened", "steps"]) {
        assert.ok(fields[id], `bug report field ${id}`);
        assert.match(fields[id], /validations:\n\s+required: true/, `${id} is required`);
    }
    for (const option of ["The Forge", "Self-hosted"]) assert.ok(fields.host.includes(option), option);
    const files = readdirSync(join(ROOT, ".github/ISSUE_TEMPLATE")).sort();
    assert.deepEqual(files, ["bug_report.yml", "config.yml", "feature_request.yml", "translation.yml"]);
    assert.match(read(".github/ISSUE_TEMPLATE/translation.yml"), /fluently[\s\S]*required: true/);
});
