import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import { SIGNOFF_FILE, hashString, run as check } from "../tools/check-strings.mjs";
import { resolveKeys, run as signoff } from "../tools/signoff-strings.mjs";
import { logger, tempDir, writeFiles } from "./helpers.mjs";

const key = (name) => `${MODULE_ID}.${name}`;

function moduleDir(t, signed = {}) {
    return tempDir(t, {
        "lang/en.json": {
            [key("Settings.A.Name")]: "First",
            [key("Settings.B.Name")]: "Second",
            [key("Queue.Title")]: "Third",
        },
        "module.json": { id: MODULE_ID, title: "Title", description: "Description" },
        "README.md": "# Readme\n",
        "docs/package-description.md": "Description.\n",
        [SIGNOFF_FILE]: signed,
    });
}

const readSignoff = (dir) => JSON.parse(readFileSync(join(dir, SIGNOFF_FILE), "utf8"));

test("--keys records the hash of each named string", (t) => {
    const dir = moduleDir(t);
    assert.equal(signoff(dir, ["--keys", key("Settings.A.Name"), "file:README.md"], logger()), 0);
    assert.deepEqual(readSignoff(dir), {
        "file:README.md": hashString("# Readme"),
        [key("Settings.A.Name")]: hashString("First"),
    });
});

test("keys may be comma-separated and a trailing * matches a prefix", (t) => {
    const strings = new Map([[key("Settings.A.Name"), ""], [key("Settings.B.Name"), ""], [key("Queue.Title"), ""]]);
    assert.deepEqual(resolveKeys([key("Settings.*")], strings).keys, [key("Settings.A.Name"), key("Settings.B.Name")]);

    const dir = moduleDir(t);
    signoff(dir, ["--keys", `${key("Queue.Title")},module.json:title`], logger());
    assert.deepEqual(Object.keys(readSignoff(dir)), ["module.json:title", key("Queue.Title")]);
});

test("an unknown key writes nothing", (t) => {
    const dir = moduleDir(t);
    const log = logger();
    assert.equal(signoff(dir, ["--keys", key("Settings.A.Name"), key("Nope")], log), 1);
    assert.match(log.text(), /no string matches/);
    assert.deepEqual(readSignoff(dir), {});
});

test("--all signs off everything, after which the gate passes in enforce mode", (t) => {
    const dir = moduleDir(t);
    assert.equal(check(dir, ["--mode", "enforce"], logger()), 1);
    assert.equal(signoff(dir, ["--all"], logger()), 0);
    assert.equal(check(dir, ["--mode", "enforce"], logger()), 0);
});

test("a changed string needs a new sign-off, and stale entries are dropped", (t) => {
    const dir = moduleDir(t, { [key("Gone")]: hashString("old") });
    signoff(dir, ["--all"], logger());
    writeFiles(dir, { "lang/en.json": { [key("Settings.A.Name")]: "First, rewritten", [key("Settings.B.Name")]: "Second", [key("Queue.Title")]: "Third" } });

    const log = logger();
    assert.equal(check(dir, ["--mode", "enforce"], log), 1);
    assert.match(log.text(), new RegExp(`changed +${RegExp.escape(key("Settings.A.Name"))}`));

    signoff(dir, ["--keys", key("Settings.A.Name")], logger());
    assert.equal(check(dir, ["--mode", "enforce"], logger()), 0);
    assert.equal(readSignoff(dir)[key("Gone")], undefined);
});

test("usage errors: neither or both of --keys and --all", (t) => {
    const dir = moduleDir(t);
    assert.equal(signoff(dir, [], logger()), 2);
    assert.equal(signoff(dir, ["--all", "--keys", key("Queue.Title")], logger()), 2);
});
