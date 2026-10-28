/**
 * The Release button's notes (tools/release-notes.mjs, DESIGN.md 16.9): CHANGELOG.md's section for the version, or its
 * Unreleased section while there is none, then the manifest URL of the release's channel, cut to fit GitHub's limit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LATEST_MANIFEST, releaseUrl } from "../tools/check-manifest.mjs";
import { MAX_NOTES, changelogSection, releaseNotes, run } from "../tools/release-notes.mjs";
import { ROOT, logger, tempDir } from "./helpers.mjs";

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

### Added

- Something new.

## [1.0.0] - 2026-11-01

### Added

- The first release.

## [1.0.0-rc.1]

- The candidate.

[Unreleased]: https://github.com/gmtoolkit/pf2e-artisans-workshop/compare/1.0.0...HEAD
`;

test("a section is its heading's body, up to the next section or the link definitions, and only for that exact name", () => {
    assert.equal(changelogSection(CHANGELOG, "Unreleased"), "### Added\n\n- Something new.");
    assert.equal(changelogSection(CHANGELOG, "1.0.0"), "### Added\n\n- The first release.");
    assert.equal(changelogSection(CHANGELOG, "1.0.0-rc.1"), "- The candidate.");
    assert.equal(changelogSection(CHANGELOG, "1.0"), null);
    assert.equal(changelogSection(CHANGELOG, "2.0.0"), null);
});

test("the notes: the version's own section, else Unreleased with a notice, then the channel's manifest URL", () => {
    const stable = releaseNotes(CHANGELOG, { version: "1.0.0", prerelease: false });
    assert.equal(stable.notes, `### Added\n\n- The first release.\n\nManifest URL: ${LATEST_MANIFEST}\n`);
    assert.deepEqual(stable.notices, []);

    const pre = releaseNotes(CHANGELOG, { version: "1.1.0-rc.1", prerelease: true });
    assert.equal(pre.notes, `### Added\n\n- Something new.\n\nManifest URL: ${releaseUrl("1.1.0-rc.1", "module.json")}\n`);
    assert.match(pre.notices[0], /no "## \[1\.1\.0-rc\.1\]" section yet/);

    const bare = releaseNotes("# Changelog\n", { version: "1.0.0", prerelease: false });
    assert.equal(bare.notes, `Manifest URL: ${LATEST_MANIFEST}\n`);
    assert.match(bare.notices[0], /neither/);
});

test("an empty section is said to be empty: the version's own is not swapped for Unreleased, and an empty Unreleased is not 'missing'", () => {
    const emptyOwn = releaseNotes("## [Unreleased]\n\n- Later.\n\n## [1.0.0]\n\n## [0.9.0]\n\n- Old.\n", { version: "1.0.0", prerelease: false });
    assert.equal(emptyOwn.notes, `Manifest URL: ${LATEST_MANIFEST}\n`);
    assert.match(emptyOwn.notices[0], /"## \[1\.0\.0\]" section is empty/);
    const emptyUnreleased = releaseNotes("## [Unreleased]\n\n## [0.9.0]\n\n- Old.\n", { version: "1.0.0", prerelease: false });
    assert.equal(emptyUnreleased.notes, `Manifest URL: ${LATEST_MANIFEST}\n`);
    assert.match(emptyUnreleased.notices[0], /Unreleased section is empty/);
});

test("notes over GitHub's limit are cut at a line and link to the version's CHANGELOG.md", () => {
    const long = `## [Unreleased]\n\n${"- A line of changes.\n".repeat(Math.ceil((MAX_NOTES * 1.5) / 21))}`;
    const { notes, notices } = releaseNotes(long, { version: "1.0.0", prerelease: false });
    assert.ok(notes.length < 125_000, String(notes.length));
    assert.match(notes, /- A line of changes\.\n\n\(Cut to fit; the full list is in \[CHANGELOG\.md\]\(https:\/\/github\.com\/gmtoolkit\/pf2e-artisans-workshop\/blob\/1\.0\.0\/CHANGELOG\.md\)\.\)\n\nManifest URL: /);
    assert.match(notices.at(-1), /cut/);
});

test("the repository's own CHANGELOG.md gives notes for the next release that fit", () => {
    const { notes } = releaseNotes(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"), { version: "1.0.0", prerelease: false });
    assert.ok(notes.length > 100 && notes.length < 125_000);
    assert.ok(notes.endsWith(`Manifest URL: ${LATEST_MANIFEST}\n`));
});

test("the command writes the notes to --out, warns as an annotation, and refuses a bad version or usage", (t) => {
    const dir = tempDir(t, { "CHANGELOG.md": CHANGELOG });
    const out = join(dir, "notes.md");
    const log = logger();
    assert.equal(run(["--version", "1.1.0", "--out", out], { root: dir, env: { GITHUB_ACTIONS: "true" }, log }), 0);
    assert.equal(readFileSync(out, "utf8"), `### Added\n\n- Something new.\n\nManifest URL: ${LATEST_MANIFEST}\n`);
    assert.match(log.text(), /^::warning title=Release notes::CHANGELOG\.md has no "## \[1\.1\.0\]" section yet/m);

    const printed = logger();
    assert.equal(run(["--version", "1.0.0-rc.1", "--prerelease"], { root: dir, env: {}, log: printed }), 0);
    assert.match(printed.text(), /- The candidate\.\n\nManifest URL: .*\/releases\/download\/1\.0\.0-rc\.1\/module\.json/);

    const refused = logger();
    assert.equal(run(["--version", "v1.0.0"], { root: dir, env: { GITHUB_ACTIONS: "true" }, log: refused }), 1);
    assert.match(refused.text(), /^::error title=Release notes::the tag must be the bare version/m);
    assert.equal(run(["--version", "1.0.0"], { root: tempDir(t), env: {}, log: logger() }), 1, "no CHANGELOG.md");
    assert.equal(run([], { root: dir, env: {}, log: logger() }), 2);
    assert.equal(run(["--nope"], { root: dir, env: {}, log: logger() }), 2);
});
