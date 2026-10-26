/**
 * Manifest check (DESIGN.md 3.1, 16.2, 16.3): `module.json` against the manifest policy.
 *
 *   node tools/check-manifest.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_ID } from "../scripts/constants.mjs";

export const REPOSITORY = `https://github.com/gmtoolkit/${MODULE_ID}`;
export const LATEST_MANIFEST = `${REPOSITORY}/releases/latest/download/module.json`;

/** `module.json` and `module.zip` of the release tagged `version` (the tag is the bare version). */
export const releaseUrl = (version, file) => `${REPOSITORY}/releases/download/${version}/${file}`;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FOUNDRY_BUILD = /^\d+\.\d+$/; // generation.build, e.g. "14.361"

/** @returns {string[]} one line per problem with `manifest`, read from `root` */
export function checkManifest(manifest, root) {
    const problems = [];
    const fail = (message) => problems.push(message);
    const exists = (path) => typeof path === "string" && existsSync(join(root, path));

    // Identity
    if (manifest.id !== MODULE_ID) fail(`id must be "${MODULE_ID}" (scripts/constants.mjs), not "${manifest.id}"`);
    if (typeof manifest.title !== "string" || !manifest.title.trim()) fail("title is missing");
    else if (/pathfinder|paizo/i.test(manifest.title)) fail('title must say "PF2e", never "Pathfinder" or "Paizo" (DESIGN.md 16.6)');
    if (typeof manifest.description !== "string" || !manifest.description.trim()) fail("description is missing");
    if (!Array.isArray(manifest.authors) || !manifest.authors.length) fail("authors is missing");

    // Version, and the unreleased marker of the 0.0.0 scaffold
    const version = manifest.version;
    if (typeof version !== "string" || !SEMVER.test(version)) {
        fail(`version must be semver without a "v" (got ${JSON.stringify(version)})`);
    }
    const unreleased = manifest.flags?.[MODULE_ID]?.unreleased === true;
    if (unreleased !== (version === "0.0.0")) {
        fail(`flags.${MODULE_ID}.unreleased must be true exactly when version is 0.0.0`);
    }

    // Foundry compatibility (3.1)
    const { minimum = "", verified = "", maximum = "" } = manifest.compatibility ?? {};
    const minimumOk = FOUNDRY_BUILD.test(minimum);
    const verifiedOk = FOUNDRY_BUILD.test(verified);
    const maximumOk = /^\d+$/.test(maximum);
    if (!minimumOk) fail(`compatibility.minimum must be a Foundry build like "14.361" (got "${minimum}")`);
    if (!verifiedOk) fail(`compatibility.verified must be a Foundry build like "14.369" (got "${verified}")`);
    if (!maximumOk) fail(`compatibility.maximum must be a generation only, like "14" (got "${maximum}")`);
    if (minimumOk && verifiedOk && maximumOk) {
        const [minGen, minBuild] = minimum.split(".").map(Number);
        const [verGen, verBuild] = verified.split(".").map(Number);
        if (verGen < minGen || (verGen === minGen && verBuild < minBuild)) fail("compatibility.verified is older than minimum");
        if (verGen > Number(maximum)) fail("compatibility.verified is newer than maximum");
    }

    // Relationships (3.1)
    const systems = manifest.relationships?.systems ?? [];
    const pf2e = systems.find((system) => system.id === "pf2e");
    if (systems.length !== 1 || !pf2e || pf2e.type !== "system") fail("relationships.systems must list exactly the pf2e system");
    else {
        if (!SEMVER.test(pf2e.compatibility?.minimum ?? "")) fail("relationships.systems[pf2e].compatibility.minimum must be a pf2e version");
        if (pf2e.compatibility?.maximum !== undefined) fail("relationships.systems[pf2e].compatibility.maximum must be unset");
    }
    if (manifest.relationships?.requires?.length) fail("relationships.requires must be empty (zero hard dependencies, P12)");

    // Contents
    if (manifest.socket !== false) fail("socket must be false (DESIGN.md 3.1)");
    if (manifest.packs?.length) fail("packs must be empty: the module ships no compendium packs (DESIGN.md 1.2)");
    if (manifest.scripts?.length) fail("scripts must be empty: ES modules only (P12)");
    if (!Array.isArray(manifest.esmodules) || !manifest.esmodules.length) fail("esmodules is missing");
    for (const path of manifest.esmodules ?? []) if (!exists(path)) fail(`esmodules: ${path} does not exist`);
    for (const style of manifest.styles ?? []) {
        const path = typeof style === "string" ? style : style?.src;
        if (!exists(path)) fail(`styles: ${path} does not exist`);
    }
    const languages = manifest.languages ?? [];
    if (!languages.some((language) => language.lang === "en")) fail("languages must include en");
    for (const language of languages) {
        if (!exists(language.path)) fail(`languages: ${language.path} does not exist`);
        else {
            try {
                const strings = JSON.parse(readFileSync(join(root, language.path), "utf8"));
                if (strings === null || typeof strings !== "object" || Array.isArray(strings)) {
                    fail(`languages: ${language.path} must be a JSON object of key to string`);
                }
            } catch (error) {
                fail(`languages: ${language.path} is not valid JSON (${error.message})`);
            }
        }
    }
    if (typeof manifest.license === "string" && !/^https?:/.test(manifest.license) && !exists(manifest.license)) {
        fail(`license: ${manifest.license} does not exist`);
    }

    // URLs (16.3)
    if (manifest.url !== REPOSITORY) fail(`url must be ${REPOSITORY}`);
    if (manifest.bugs !== `${REPOSITORY}/issues`) fail(`bugs must be ${REPOSITORY}/issues`);
    if (manifest.manifest !== LATEST_MANIFEST && manifest.manifest !== releaseUrl(version, "module.json")) {
        fail(`manifest must be ${LATEST_MANIFEST} (stable) or this version's release URL (pre-release)`);
    }
    if (manifest.download !== releaseUrl(version, "module.zip")) fail(`download must be ${releaseUrl(version, "module.zip")}`);

    return problems;
}

/** Run the check and return the exit code. `log` receives each output line. */
export function run(root, log = console.log) {
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
    } catch (error) {
        log(`error: module.json: ${error.message}`);
        return 1;
    }
    const problems = checkManifest(manifest, root);
    for (const problem of problems) log(`error: module.json: ${problem}`);
    log(problems.length ? `Manifest check failed: ${problems.length} problem(s).` : "Manifest check passed.");
    return problems.length ? 1 : 0;
}

if (import.meta.main) {
    process.exitCode = run(join(import.meta.dirname, ".."));
}
