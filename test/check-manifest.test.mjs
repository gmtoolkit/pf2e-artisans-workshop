import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LATEST_MANIFEST, checkManifest, releaseUrl, run } from "../tools/check-manifest.mjs";
import { ROOT, logger, tempDir } from "./helpers.mjs";

const manifest = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));

/** Problems for module.json after `change`, checked against the repository's files. */
function problemsAfter(change) {
    const copy = structuredClone(manifest);
    change(copy);
    return checkManifest(copy, ROOT);
}

test("the repository's module.json passes", () => {
    const log = logger();
    assert.equal(run(ROOT, log), 0, log.text());
});

test("each policy rule catches its violation", () => {
    const cases = {
        "id must be": (m) => (m.id = "pf2e-workshop"),
        "title must say": (m) => (m.title = "Pathfinder Artisan's Workshop"),
        "version must be semver": (m) => (m.version = "v1.0.0"),
        "unreleased must be true exactly when": (m) => delete m.flags,
        "compatibility.minimum must be": (m) => (m.compatibility.minimum = "14"),
        "compatibility.maximum must be a generation": (m) => (m.compatibility.maximum = "14.369"),
        "verified is older than minimum": (m) => (m.compatibility.verified = "14.300"),
        "verified is newer than maximum": (m) => (m.compatibility.verified = "15.300"),
        "exactly the pf2e system": (m) => (m.relationships.systems = []),
        "maximum must be unset": (m) => (m.relationships.systems[0].compatibility.maximum = "8.7.0"),
        "requires must be empty": (m) => (m.relationships.requires = [{ id: "lib-wrapper", type: "module" }]),
        "socket must be false": (m) => (m.socket = true),
        "packs must be empty": (m) => (m.packs = [{ name: "items", type: "Item", label: "Items", path: "packs/items" }]),
        "scripts must be empty": (m) => (m.scripts = ["scripts/old.js"]),
        "does not exist": (m) => m.esmodules.push("scripts/missing.mjs"),
        "languages must include en": (m) => (m.languages = []),
        "url must be": (m) => (m.url = "https://example.com"),
        "bugs must be": (m) => delete m.bugs,
        "manifest must be": (m) => (m.manifest = "https://example.com/module.json"),
        "download must be": (m) => (m.download = "https://github.com/gmtoolkit/pf2e-artisans-workshop/archive/main.zip"),
    };
    for (const [message, change] of Object.entries(cases)) {
        const problems = problemsAfter(change);
        assert.ok(problems.some((problem) => problem.includes(message)), `${message}: got ${JSON.stringify(problems)}`);
    }
});

test("each language file must be a JSON object", (t) => {
    for (const content of ["null", "[]", "{ not json"]) {
        const dir = tempDir(t, { "scripts/module.mjs": "", "lang/en.json": content, LICENSE: "" });
        const problems = checkManifest(manifest, dir);
        assert.ok(problems.some((problem) => problem.startsWith("languages: lang/en.json")), `${content}: ${JSON.stringify(problems)}`);
    }
});

test("a released version drops the unreleased flag and points at its own release", () => {
    const problems = problemsAfter((m) => {
        m.version = "0.3.0";
        delete m.flags;
        m.download = releaseUrl("0.3.0", "module.zip");
    });
    assert.deepEqual(problems, []);
});

test("a pre-release may use its version-specific manifest URL", () => {
    const problems = problemsAfter((m) => {
        m.version = "0.3.0-rc.1";
        delete m.flags;
        m.manifest = releaseUrl("0.3.0-rc.1", "module.json");
        m.download = releaseUrl("0.3.0-rc.1", "module.zip");
    });
    assert.deepEqual(problems, []);
    assert.notEqual(LATEST_MANIFEST, releaseUrl("0.3.0-rc.1", "module.json"));
});
