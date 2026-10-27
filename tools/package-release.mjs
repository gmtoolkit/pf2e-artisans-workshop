/**
 * The release package (DESIGN.md 16.2, 16.3, 16.9): `module.json` stamped with the release's version and URLs, and
 * `module.zip` holding only the files that ship, with that stamped manifest inside. The release workflow
 * (`.github/workflows/release.yml`) runs it with `--out dist` and uploads both files to the GitHub release. Run without
 * `--out` it is the local dry run: it writes both into a new scratch folder and prints where, what the zip holds, and
 * its SHA-256 (`npm run release:dry-run -- --version 0.12.0 --prerelease`).
 *
 *   node tools/package-release.mjs --version <x.y.z> [--prerelease] [--out <dir>]
 *
 * It refuses (exit 1) a tag that is not the bare version, `0.0.0` (the unreleased scaffold's), a stable release with a
 * pre-release suffix, a stamped manifest that fails `tools/check-manifest.mjs`, a file the manifest names that would
 * not ship, and, for a stable release, a notice placeholder left in any file that ships or is published (pre-releases
 * only warn about those). Usage errors exit 2.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { MODULE_ID } from "../scripts/constants.mjs";
import { listFiles } from "./check-assets.mjs";
import { LATEST_MANIFEST, SEMVER, checkManifest, releaseUrl } from "./check-manifest.mjs";
import { createZip, readZip } from "./zip.mjs";

/** What the zip holds (16.2): these files, and every file under these folders. */
export const ZIP_PATHS = Object.freeze([
    "module.json", "LICENSE", "NOTICE", "README.md", "CHANGELOG.md", "scripts/", "templates/", "styles/", "lang/",
]);

/** Folders inside ZIP_PATHS that never ship: the strings gate's sign-off hashes are the release gate's, not the module's. */
export const NEVER_SHIPPED = Object.freeze(["lang/review/"]);

/** Files published beside the zip (the listing's text), checked for placeholders like the zip's. */
export const PUBLISHED = Object.freeze(["docs/package-description.md"]);

/**
 * Where the author still has to paste text the module cannot write for them (the licensors' notices, 16.6). A stable
 * release refuses to package while any shipped or published file holds it.
 */
export const PLACEHOLDER = "AUTHOR-TODO";

const under = (file, paths) => paths.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path));

/** Whether a repository path goes into the zip. */
export const ships = (file) => under(file, ZIP_PATHS) && !under(file, NEVER_SHIPPED);

/** @returns {string[]} why `version` cannot be released on this channel; empty when it can */
export function versionProblems(version, { prerelease }) {
    if (typeof version !== "string" || !SEMVER.test(version)) {
        return [`the tag must be the bare version, like 0.12.0 or 0.12.0-rc.1, with no "v" (got ${JSON.stringify(version)})`];
    }
    if (version === "0.0.0") return ["0.0.0 is the unreleased scaffold's version, never a release's"];
    if (!prerelease && version.includes("-")) {
        return [`${version} has a pre-release suffix: publish it as a GitHub pre-release, or tag the stable release without one`];
    }
    return [];
}

/**
 * `manifest` as the release ships it: its version, the manifest URL of its channel (GitHub's "latest" for a stable
 * release, its own release's for a pre-release, so testers stay on the pre-release channel), the zip's download URL, and
 * no unreleased marker. Everything else, key order included, is kept.
 */
export function stampManifest(manifest, { version, prerelease }) {
    const stamped = structuredClone(manifest);
    stamped.version = version;
    stamped.manifest = prerelease ? releaseUrl(version, "module.json") : LATEST_MANIFEST;
    stamped.download = releaseUrl(version, "module.zip");
    const own = stamped.flags?.[MODULE_ID];
    if (own) {
        delete own.unreleased;
        if (!Object.keys(own).length) delete stamped.flags[MODULE_ID];
        if (!Object.keys(stamped.flags).length) delete stamped.flags;
    }
    return stamped;
}

/** The paths the manifest names (code, styles, languages, licence) that are not in `shipped`. */
export function missingFromZip(manifest, shipped) {
    const named = [
        ...(manifest.esmodules ?? []),
        ...(manifest.styles ?? []).map((style) => (typeof style === "string" ? style : style?.src)),
        ...(manifest.languages ?? []).map((language) => language.path),
        ...(typeof manifest.license === "string" && !/^https?:/.test(manifest.license) ? [manifest.license] : []),
    ];
    return named.filter((path) => !shipped.includes(path));
}

/** The zip's entries: every shipped file (the stamped manifest for `module.json`), each folder once before its files. */
export function zipEntries(root, shipped, manifestText) {
    const names = new Set();
    for (const file of shipped) {
        const parts = file.split("/");
        for (let i = 1; i < parts.length; i++) names.add(`${parts.slice(0, i).join("/")}/`);
        names.add(file);
    }
    // Plain code-unit order: a folder sorts before everything in it.
    return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((name) => ({
        name,
        data: name.endsWith("/") ? undefined : name === "module.json" ? Buffer.from(manifestText) : readFileSync(join(root, name)),
    }));
}

/** Every line of a shipped or published file that still holds the placeholder. */
export function findPlaceholders(root, files) {
    const found = [];
    for (const file of files) {
        const path = join(root, file);
        if (!existsSync(path)) continue;
        readFileSync(path, "utf8").split("\n").forEach((line, i) => {
            if (line.includes(PLACEHOLDER)) found.push({ file, line: i + 1 });
        });
    }
    return found;
}

/**
 * Build the package into `out`.
 * @returns {{problems: string[], warnings: string[], manifest?: object, shipped?: string[], zipPath?: string,
 *   manifestPath?: string, sha256?: string, bytes?: number}}
 */
export function packageRelease(root, { version, prerelease, out, files = listFiles(root) }) {
    const problems = versionProblems(version, { prerelease });
    const warnings = [];
    if (problems.length) return { problems, warnings };

    let source;
    try {
        source = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
    } catch (error) {
        return { problems: [`module.json: ${error.message}`], warnings };
    }
    const manifest = stampManifest(source, { version, prerelease });
    problems.push(...checkManifest(manifest, root).map((problem) => `stamped module.json: ${problem}`));

    const shipped = [...new Set([...files.filter(ships), "module.json"])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const path of missingFromZip(manifest, shipped)) problems.push(`module.json names ${path}, which would not be in the zip`);

    const placeholders = findPlaceholders(root, [...shipped.filter((file) => file !== "module.json"), ...PUBLISHED]);
    for (const file of new Set(placeholders.map((found) => found.file))) {
        const lines = placeholders.filter((found) => found.file === file).map((found) => found.line);
        const message = `${file}: ${PLACEHOLDER} placeholder on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")} ` +
            "(notice text the author still has to paste, DESIGN.md 16.6)";
        (prerelease ? warnings : problems).push(message);
    }
    if (problems.length) return { problems, warnings };

    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const zip = createZip(zipEntries(root, shipped, manifestText));
    // Read it back: every entry is there, intact, and the manifest inside is the stamped one.
    const back = readZip(zip).filter((entry) => !entry.folder);
    if (back.length !== shipped.length || back.some((entry, i) => entry.name !== shipped[i])) {
        return { problems: ["the zip does not hold exactly the shipped files"], warnings };
    }
    if (back.find((entry) => entry.name === "module.json").data.toString("utf8") !== manifestText) {
        return { problems: ["the zip's module.json is not the stamped manifest"], warnings };
    }

    mkdirSync(out, { recursive: true });
    const manifestPath = join(out, "module.json");
    const zipPath = join(out, "module.zip");
    writeFileSync(manifestPath, manifestText);
    writeFileSync(zipPath, zip);
    return {
        problems, warnings, manifest, shipped, manifestPath, zipPath, bytes: zip.length,
        sha256: createHash("sha256").update(zip).digest("hex"),
    };
}

/** Run the command and return the exit code. `log` receives each output line. */
export function run(root, args = [], log = console.log) {
    let values;
    try {
        ({ values } = parseArgs({ args, options: {
            version: { type: "string" }, prerelease: { type: "boolean", default: false }, out: { type: "string" },
        } }));
    } catch {
        values = null;
    }
    if (!values?.version) {
        log("Usage: package-release.mjs --version <x.y.z> [--prerelease] [--out <dir>]   (no --out: a dry run into a scratch folder)");
        return 2;
    }
    const dryRun = !values.out;
    const out = dryRun ? mkdtempSync(join(tmpdir(), `${MODULE_ID}-release-`)) : resolve(values.out);
    if (out === resolve(root)) {
        log("error: --out must not be the repository itself (it would overwrite module.json)");
        return 2;
    }

    const result = packageRelease(root, { version: values.version, prerelease: values.prerelease, out });
    for (const warning of result.warnings) log(`warning: ${warning}`);
    for (const problem of result.problems) log(`error: ${problem}`);
    if (result.problems.length) {
        if (dryRun) rmSync(out, { recursive: true, force: true });
        log(`Release package not built: ${result.problems.length} problem(s).`);
        return 1;
    }
    const { manifest } = result;
    log(`${dryRun ? "Dry run: release" : "Release"} ${manifest.version} (${values.prerelease ? "pre-release" : "stable"}) in ${out}`);
    log(`  manifest  ${manifest.manifest}`);
    log(`  download  ${manifest.download}`);
    log(`  module.zip: ${result.shipped.length} files, ${result.bytes} bytes, SHA-256 ${result.sha256}`);
    const top = [...new Set(result.shipped.map((file) => (file.includes("/") ? `${file.split("/")[0]}/` : file)))];
    for (const path of top) log(`    ${path}${path.endsWith("/") ? ` (${result.shipped.filter((file) => file.startsWith(path)).length} files)` : ""}`);
    return 0;
}

if (import.meta.main) {
    process.exitCode = run(join(import.meta.dirname, ".."), process.argv.slice(2));
}
