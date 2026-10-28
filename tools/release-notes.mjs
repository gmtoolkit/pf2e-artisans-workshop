/**
 * The notes the Release button creates a release with (DESIGN.md 16.9): CHANGELOG.md's section for the version, or its
 * Unreleased section while there is none, then the manifest URL to install the release by (GitHub's "latest" for a stable
 * release, the version's own for a pre-release). A release published by hand keeps the notes its author typed; the
 * workflow writes these only for a release it creates.
 *
 *   node tools/release-notes.mjs --version <x.y.z> [--prerelease] [--out <file>]
 *
 * Prints the notes, or writes them to `--out`. Notices (no section of the version's own, notes cut to fit) go to the log,
 * as annotations under GitHub Actions. Usage errors exit 2; a version that cannot be released, or no CHANGELOG.md, exit 1.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LATEST_MANIFEST, REPOSITORY, releaseUrl } from "./check-manifest.mjs";
import { versionProblems } from "./package-release.mjs";

/** GitHub refuses a release body over 125,000 characters; the notes stay under this, with room for the footer. */
export const MAX_NOTES = 120_000;

/** The body of CHANGELOG `text`'s `## [<name>]` section (the heading may go on, as in "## [1.0.0] - 2026-11-01"), or null. */
export function changelogSection(text, name) {
    const lines = text.split("\n");
    const start = lines.findIndex((line) => line.startsWith(`## [${name}]`) && /^(?:\s|-|$)/.test(line.slice(`## [${name}]`.length)));
    if (start === -1) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^## /.test(line) || /^\[[^\]]+\]: /.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** @returns {{notes: string, notices: string[]}} the release notes for `version` from CHANGELOG `text` */
export function releaseNotes(text, { version, prerelease }) {
    const notices = [];
    let body = changelogSection(text, version);
    if (body === "") {
        notices.push(`CHANGELOG.md's "## [${version}]" section is empty, so the notes hold only the manifest URL.`);
    } else if (body === null) {
        body = changelogSection(text, "Unreleased");
        if (body) notices.push(`CHANGELOG.md has no "## [${version}]" section yet, so the notes are its Unreleased section.`);
        else if (body === "") notices.push(`CHANGELOG.md has no "## [${version}]" section and its Unreleased section is empty, so the notes hold only the manifest URL.`);
        else notices.push(`CHANGELOG.md has neither a "## [${version}]" nor an Unreleased section, so the notes hold only the manifest URL.`);
        body ??= "";
    }
    const manifest = prerelease ? releaseUrl(version, "module.json") : LATEST_MANIFEST;
    const footer = `Manifest URL: ${manifest}`;
    if (body.length > MAX_NOTES) {
        const cut = body.lastIndexOf("\n", MAX_NOTES);
        body = `${body.slice(0, cut > 0 ? cut : MAX_NOTES)}\n\n(Cut to fit; the full list is in [CHANGELOG.md](${REPOSITORY}/blob/${version}/CHANGELOG.md).)`;
        notices.push(`The changelog section is over ${MAX_NOTES} characters, so the notes are cut and link to CHANGELOG.md.`);
    }
    return { notes: body ? `${body}\n\n${footer}\n` : `${footer}\n`, notices };
}

/** Run the command and return the exit code. `log` receives each output line. */
export function run(args = [], { root = process.cwd(), env = process.env, log = console.log } = {}) {
    let values;
    try {
        ({ values } = parseArgs({ args, options: { version: { type: "string" }, prerelease: { type: "boolean" }, out: { type: "string" } } }));
    } catch {
        values = null;
    }
    if (!values?.version) {
        log("Usage: release-notes.mjs --version <x.y.z> [--prerelease] [--out <file>]");
        return 2;
    }
    const prerelease = values.prerelease === true;
    const problems = versionProblems(values.version, { prerelease });
    let text;
    try {
        text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    } catch (error) {
        problems.push(`CHANGELOG.md: ${error.message}`);
    }
    for (const problem of problems) log(env.GITHUB_ACTIONS ? `::error title=Release notes::${problem}` : `error: ${problem}`);
    if (problems.length) return 1;
    const { notes, notices } = releaseNotes(text, { version: values.version, prerelease });
    for (const notice of notices) log(env.GITHUB_ACTIONS ? `::warning title=Release notes::${notice}` : notice);
    if (values.out) writeFileSync(values.out, notes);
    else log(notes);
    return 0;
}

if (import.meta.main) {
    process.exitCode = run(process.argv.slice(2));
}
