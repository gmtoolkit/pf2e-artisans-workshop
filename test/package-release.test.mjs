/**
 * The release package (tools/package-release.mjs, DESIGN.md 16.2, 16.3, 16.9): the stamped manifest's fields per channel, what
 * the zip holds and leaves out, the refusals, the placeholder gate, and the dry run against this repository.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import { SHIPPED, listFiles } from "../tools/check-assets.mjs";
import { LATEST_MANIFEST, checkManifest, releaseUrl } from "../tools/check-manifest.mjs";
import {
    NEVER_SHIPPED, PLACEHOLDER, ZIP_PATHS, missingFromZip, packageRelease, run, ships, stampManifest, versionProblems,
} from "../tools/package-release.mjs";
import { readZip } from "../tools/zip.mjs";
import { ROOT, logger, tempDir } from "./helpers.mjs";

const SOURCE = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));

/** A module checkout: the manifest's files, and files of every kind that must never ship. */
const FILES = {
    "module.json": SOURCE,
    "LICENSE": "MIT\n",
    "NOTICE": "Notices\n",
    "README.md": "# Readme\n",
    "CHANGELOG.md": "# Changelog\n",
    "scripts/module.mjs": "export {};\n",
    "scripts/logic/core.mjs": "export const x = 1;\n",
    "templates/workshop/queue.hbs": "<div>{{localize \"pf2e-artisans-workshop.Queue.Title\"}}</div>\n",
    "styles/workshop.css": ".x {}\n",
    "lang/en.json": { [`${MODULE_ID}.Queue.Title`]: "Queue" },
    "lang/review/en.signoff.json": {},
    "docs/package-description.md": "Description.\n",
    "docs/screenshots/README.txt": "not an image\n",
    "tools/check-assets.mjs": "// tool\n",
    "tools/harness/run-live.mjs": "// harness\n",
    "test/smoke.test.mjs": "// test\n",
    "node_modules/eslint/index.js": "// dependency\n",
    "macros/open-workshop.js": "// macro\n",
    ".github/workflows/release.yml": "name: Release\n",
    "DESIGN.md": "# Design\n",
    "DECISIONS.md": "# Decisions\n",
    "CLAUDE.md": "# Notes\n",
    "CONTRIBUTING.md": "# Contributing\n",
    "package.json": "{}\n",
    "eslint.config.mjs": "export default [];\n",
};
const EXPECTED = [
    "CHANGELOG.md", "LICENSE", "NOTICE", "README.md", "lang/en.json", "module.json", "scripts/logic/core.mjs", "scripts/module.mjs",
    "styles/workshop.css", "templates/workshop/queue.hbs",
];
const NEVER = ["docs/", "tools/", "test/", "node_modules/", "macros/", "lang/review/", ".github/", "DESIGN.md", "DECISIONS.md", "CLAUDE.md",
    "CONTRIBUTING.md", "package.json", "eslint.config.mjs"];

function moduleDir(t, extra = {}) {
    const files = { ...FILES, ...extra };
    return { root: tempDir(t, files), files: Object.keys(files) };
}

const zipNames = (path) => readZip(readFileSync(path)).filter((entry) => !entry.folder).map((entry) => entry.name);

test("a stable release's manifest: its version, the releases/latest manifest URL, its own zip, no unreleased marker", () => {
    const stamped = stampManifest(SOURCE, { version: "1.2.3", prerelease: false });
    assert.equal(stamped.version, "1.2.3");
    assert.equal(stamped.manifest, LATEST_MANIFEST);
    assert.equal(stamped.download, releaseUrl("1.2.3", "module.zip"));
    assert.equal(stamped.download, `https://github.com/gmtoolkit/${MODULE_ID}/releases/download/1.2.3/module.zip`);
    assert.equal(stamped.flags?.[MODULE_ID]?.unreleased, undefined);
    assert.deepEqual(Object.keys(stamped).filter((key) => key !== "flags"), Object.keys(SOURCE).filter((key) => key !== "flags"), "key order kept");
    assert.deepEqual(stamped.compatibility, SOURCE.compatibility);
    assert.equal(SOURCE.version, "0.0.0", "the source manifest is not changed");
    assert.deepEqual(checkManifest(stamped, ROOT), []);
});

test("a pre-release's manifest points at its own release, so testers stay on the pre-release channel", () => {
    const stamped = stampManifest(SOURCE, { version: "0.12.0-rc.1", prerelease: true });
    assert.equal(stamped.manifest, releaseUrl("0.12.0-rc.1", "module.json"));
    assert.notEqual(stamped.manifest, LATEST_MANIFEST);
    assert.equal(stamped.download, releaseUrl("0.12.0-rc.1", "module.zip"));
    assert.deepEqual(checkManifest(stamped, ROOT), []);
});

test("the stamp keeps the module's other flags and drops only the unreleased marker", () => {
    const source = { ...SOURCE, flags: { [MODULE_ID]: { unreleased: true, keep: 1 }, other: { x: 1 } } };
    assert.deepEqual(stampManifest(source, { version: "1.0.0", prerelease: false }).flags, { [MODULE_ID]: { keep: 1 }, other: { x: 1 } });
    assert.equal("flags" in stampManifest({ ...SOURCE, flags: { [MODULE_ID]: { unreleased: true } } }, { version: "1.0.0" }), false);
});

test("versions: the bare semver tag only, never 0.0.0, and no pre-release suffix on a stable release", () => {
    assert.deepEqual(versionProblems("0.12.0", { prerelease: true }), []);
    assert.deepEqual(versionProblems("1.0.0", { prerelease: false }), []);
    assert.deepEqual(versionProblems("0.12.0-rc.1", { prerelease: true }), []);
    assert.match(versionProblems("v1.0.0", { prerelease: false })[0], /bare version/);
    assert.match(versionProblems("1.0", { prerelease: false })[0], /bare version/);
    assert.match(versionProblems(undefined, { prerelease: false })[0], /bare version/);
    assert.match(versionProblems("0.0.0", { prerelease: true })[0], /scaffold/);
    assert.match(versionProblems("1.0.0-rc.1", { prerelease: false })[0], /pre-release suffix/);
});

test("which paths ship: the manifest, the notices, the docs a user reads, and the module's code, strings and styles", () => {
    for (const file of EXPECTED) assert.equal(ships(file), true, file);
    for (const path of NEVER) assert.equal(ships(path.endsWith("/") ? `${path}x.mjs` : path), false, path);
    assert.deepEqual(NEVER_SHIPPED, ["lang/review/"]);
    assert.equal(ships("scripts"), false, "a folder name alone is not a file under it");
    assert.equal(ships("scriptsx/a.mjs"), false);
});

test("the asset check covers everything the zip ships (its SHIPPED list is the zip's plus the listing and macros)", () => {
    for (const path of ZIP_PATHS) assert.ok(SHIPPED.includes(path), path);
    assert.deepEqual(SHIPPED.filter((path) => !ZIP_PATHS.includes(path)), ["docs/package-description.md", "macros/"]);
});

test("the package: the stamped manifest beside the zip and inside it, exactly the shipped files, nothing excluded", (t) => {
    const { root, files } = moduleDir(t);
    const out = join(tempDir(t), "dist");
    const result = packageRelease(root, { version: "0.12.0", prerelease: true, out, files });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.shipped, EXPECTED);
    const names = zipNames(join(out, "module.zip"));
    assert.deepEqual(names, EXPECTED);
    for (const name of names) for (const path of NEVER) assert.ok(!(path.endsWith("/") ? name.startsWith(path) : name === path), `${name} ships`);

    const entries = readZip(readFileSync(join(out, "module.zip")));
    const folders = entries.filter((entry) => entry.folder).map((entry) => entry.name);
    assert.deepEqual(folders, ["lang/", "scripts/", "scripts/logic/", "styles/", "templates/", "templates/workshop/"]);
    for (const entry of entries.filter((e) => !e.folder)) {
        const folder = entry.name.includes("/") ? entry.name.slice(0, entry.name.lastIndexOf("/") + 1) : null;
        if (folder) assert.ok(entries.findIndex((e) => e.name === folder) < entries.indexOf(entry), `${folder} before ${entry.name}`);
    }

    const beside = readFileSync(join(out, "module.json"), "utf8");
    assert.equal(entries.find((entry) => entry.name === "module.json").data.toString("utf8"), beside);
    const manifest = JSON.parse(beside);
    assert.equal(manifest.version, "0.12.0");
    assert.equal(manifest.manifest, releaseUrl("0.12.0", "module.json"));
    assert.equal(manifest.download, releaseUrl("0.12.0", "module.zip"));
    assert.equal(manifest.flags?.[MODULE_ID]?.unreleased, undefined);
    assert.equal(entries.find((entry) => entry.name === "scripts/module.mjs").data.toString("utf8"), "export {};\n");
    assert.equal(result.sha256, createHash("sha256").update(readFileSync(join(out, "module.zip"))).digest("hex"));
});

test("the package refuses a manifest that names a file which would not ship", (t) => {
    const { root, files } = moduleDir(t, { "module.json": { ...SOURCE, esmodules: ["scripts/module.mjs", "tools/check-assets.mjs"] } });
    const result = packageRelease(root, { version: "0.12.0", prerelease: true, out: join(tempDir(t), "dist"), files });
    assert.deepEqual(result.problems, ["module.json names tools/check-assets.mjs, which would not be in the zip"]);
    assert.deepEqual(missingFromZip({ ...SOURCE, license: "LICENSE" }, ["LICENSE"]).sort(), [...SOURCE.esmodules, ...SOURCE.styles, "lang/en.json"].sort());
});

test("the package refuses a stamped manifest the manifest check rejects", (t) => {
    const { root, files } = moduleDir(t, { "module.json": { ...SOURCE, socket: true } });
    const out = join(tempDir(t), "dist");
    const result = packageRelease(root, { version: "0.12.0", prerelease: true, out, files });
    assert.deepEqual(result.problems, ["stamped module.json: socket must be false (DESIGN.md 3.1)"]);
    assert.equal(existsSync(out), false, "nothing is written");
});

test("a notice placeholder blocks a stable release and only warns on a pre-release", (t) => {
    const { root, files } = moduleDir(t, {
        "NOTICE": `ORC\n[${PLACEHOLDER}: paste it]\n`, "docs/package-description.md": `x\ny [${PLACEHOLDER}: z]\n`,
        "tools/check-assets.mjs": `// ${PLACEHOLDER} in a tool never ships, so it does not count\n`,
    });
    const stable = packageRelease(root, { version: "1.0.0", prerelease: false, out: join(tempDir(t), "stable"), files });
    assert.equal(stable.problems.length, 2);
    assert.match(stable.problems[0], /^NOTICE: AUTHOR-TODO placeholder on line 2 /);
    assert.match(stable.problems[1], /^docs\/package-description\.md: AUTHOR-TODO placeholder on line 2 /);
    assert.equal(stable.zipPath, undefined);

    const pre = packageRelease(root, { version: "1.0.0-rc.1", prerelease: true, out: join(tempDir(t), "pre"), files });
    assert.deepEqual(pre.problems, []);
    assert.equal(pre.warnings.length, 2);
    assert.ok(existsSync(pre.zipPath));
});

test("the command: usage errors exit 2, refusals exit 1 and write nothing, --out never the repository", (t) => {
    assert.equal(run(ROOT, [], logger()), 2);
    assert.equal(run(ROOT, ["--version"], logger()), 2);
    assert.equal(run(ROOT, ["--version", "1.0.0", "--bogus"], logger()), 2);
    assert.equal(run(ROOT, ["--version", "1.0.0", "--out", ROOT], logger()), 2);
    const out = join(tempDir(t), "dist");
    const log = logger();
    assert.equal(run(ROOT, ["--version", "v1.0.0", "--out", out], log), 1);
    assert.match(log.text(), /bare version/);
    assert.equal(existsSync(out), false);
});

test("the dry run of this repository: a scratch folder with the stamped manifest and the zip of the shipped files only", (t) => {
    const log = logger();
    assert.equal(run(ROOT, ["--version", "0.12.0", "--prerelease"], log), 0, log.text());
    const out = /^Dry run: release 0\.12\.0 \(pre-release\) in (.+)$/m.exec(log.text())?.[1];
    assert.ok(out && existsSync(join(out, "module.zip")), log.text());
    t.after(() => rmSync(out, { recursive: true, force: true }));
    assert.deepEqual(readdirSync(out).sort(), ["module.json", "module.zip"]);

    const names = zipNames(join(out, "module.zip"));
    const tracked = listFiles(ROOT);
    const expected = [...new Set([...tracked.filter(ships), "module.json"])].sort();
    assert.deepEqual(names, expected);
    for (const path of ["module.json", "LICENSE", "NOTICE", "README.md", "CHANGELOG.md", "scripts/module.mjs", "lang/en.json", "styles/workshop.css"]) {
        assert.ok(names.includes(path), path);
    }
    for (const name of names) {
        assert.doesNotMatch(name, /^(?:docs|tools|test|node_modules|macros|lang\/review|\.github)\//, name);
        assert.ok(!["DESIGN.md", "DECISIONS.md", "CLAUDE.md", "CONTRIBUTING.md", "package.json", "package-lock.json"].includes(name), name);
    }
    const manifest = JSON.parse(readFileSync(join(out, "module.json"), "utf8"));
    assert.equal(manifest.version, "0.12.0");
    assert.equal(manifest.manifest, releaseUrl("0.12.0", "module.json"));
    assert.deepEqual(missingFromZip(manifest, names), []);
    assert.match(log.text(), new RegExp(`module\\.zip: ${names.length} files, \\d+ bytes, SHA-256 [0-9a-f]{64}`));
});
