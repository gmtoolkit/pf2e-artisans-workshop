import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import { compareStrings, hashString, normalise, run } from "../tools/check-strings.mjs";
import { ROOT, logger, tempDir } from "./helpers.mjs";

const KEY = `${MODULE_ID}.Example.Label`;

/** A module directory with everything the gate reads. */
function moduleDir(t, { lang = { [KEY]: "Example label" }, signoff } = {}) {
    const files = {
        "lang/en.json": lang,
        "module.json": { id: MODULE_ID, title: "Title", description: "Description" },
        "README.md": "# Readme\n",
        "docs/package-description.md": "Description.\n",
    };
    if (signoff) files["lang/review/en.signoff.json"] = signoff;
    return tempDir(t, files);
}

test("normalise trims, applies NFC and collapses whitespace", () => {
    assert.equal(normalise("  Craft\t\n an   item  "), "Craft an item");
    assert.equal(normalise("Café"), "Café");
});

test("hashString is SHA-256 of the normalised text", () => {
    // printf 'Craft an item' | sha256sum
    assert.equal(hashString(" Craft  an\nitem "), "a0ef79813f2563ee0a322d4df16557fb26aa686c10671b7ad030d4d6ee4b1a02");
    assert.equal(hashString("x"), "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");
});

test("compareStrings separates new, changed and stale keys", () => {
    const strings = new Map([["a", "one"], ["b", "two"], ["c", "three"]]);
    const signoff = { a: hashString("one"), b: hashString("old two"), gone: hashString("x") };
    assert.deepEqual(compareStrings(strings, signoff), { unsigned: ["c"], changed: ["b"], stale: ["gone"] });
});

test("report mode lists what needs sign-off and exits 0", (t) => {
    const log = logger();
    assert.equal(run(moduleDir(t), ["--mode", "report"], log), 0);
    assert.match(log.text(), /5 strings, 0 signed off, 5 need sign-off/);
    for (const key of [KEY, "file:README.md", "file:docs/package-description.md", "module.json:title", "module.json:description"]) {
        assert.match(log.text(), new RegExp(`new +${RegExp.escape(key)}`));
    }
});

test("enforce mode fails while anything is unsigned or changed, and passes once all is signed", (t) => {
    const signed = {
        [KEY]: hashString("Example label"),
        "file:README.md": hashString("# Readme"),
        "file:docs/package-description.md": hashString("Description."),
        "module.json:title": hashString("Title"),
        "module.json:description": hashString("Description"),
    };
    assert.equal(run(moduleDir(t), ["--mode", "enforce"], logger()), 1);
    assert.equal(run(moduleDir(t, { signoff: signed }), ["--mode", "enforce"], logger()), 0);

    const log = logger();
    const edited = moduleDir(t, { lang: { [KEY]: "Example label, edited" }, signoff: signed });
    assert.equal(run(edited, ["--mode", "enforce"], log), 1);
    assert.match(log.text(), new RegExp(`changed +${RegExp.escape(KEY)}`));
});

test("whitespace-only edits do not need a new sign-off", (t) => {
    const signoff = { [KEY]: hashString("Example label") };
    const dir = moduleDir(t, { lang: { [KEY]: "  Example\n   label " }, signoff });
    const log = logger();
    run(dir, [], log);
    assert.doesNotMatch(log.text(), new RegExp(`${RegExp.escape(KEY)}`));
});

test("a malformed language or sign-off file fails in every mode", (t) => {
    const cases = [
        [{ lang: { [MODULE_ID]: { Nested: "x" } } }, /^error: lang\/en\.json: .*keys must be flat/m],
        [{ lang: { "OTHER.Key": "x" } }, /^error: lang\/en\.json: .*namespace/m],
        [{ lang: { [`${MODULE_ID}.queue.title`]: "x" } }, /^error: lang\/en\.json: .*capital letter/m],
        [{ lang: null }, /^error: lang\/en\.json: must be a JSON object/m],
        [{ lang: [] }, /^error: lang\/en\.json: must be a JSON object/m],
        [{ signoff: [] }, /^error: lang\/review\/en\.signoff\.json: must be a JSON object/m],
    ];
    for (const [files, message] of cases) {
        for (const mode of ["report", "enforce"]) {
            const log = logger();
            assert.equal(run(moduleDir(t, files), ["--mode", mode], log), 1, `${JSON.stringify(files)} in ${mode}`);
            assert.match(log.text(), message);
        }
    }
});

test("usage errors exit 2 instead of falling back to report mode", (t) => {
    for (const args of [["--mode", "strict"], ["--mode", "warn"], ["--mode"], ["--enforce"], ["enforce"], ["--mode", "report", "--mode", "enforce"]]) {
        assert.equal(run(moduleDir(t), args, logger()), 2, args.join(" "));
    }
    assert.equal(run(moduleDir(t), ["--mode=enforce"], logger()), 1);
});

test("the npm scripts run report mode by default and let a release override it", (t) => {
    const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const args = (script) => script.split("tools/check-strings.mjs")[1].trim().split(/\s+/).filter(Boolean);
    const dir = moduleDir(t);
    assert.equal(run(dir, args(scripts["check:strings"]), logger()), 0);
    assert.equal(run(dir, args(scripts["check:strings:enforce"]), logger()), 1);
    // `npm run check:strings -- --mode enforce` appends the arguments to the script's own.
    assert.equal(run(dir, [...args(scripts["check:strings"]), "--mode", "enforce"], logger()), 1);
});

test("the repository passes in report mode", () => {
    assert.equal(run(ROOT, ["--mode", "report"], logger()), 0);
});
