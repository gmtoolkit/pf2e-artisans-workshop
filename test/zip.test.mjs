/**
 * The release zip's writer and reader (tools/zip.mjs, DESIGN.md 16.9): what goes in comes out, the same input gives the same
 * bytes, folders and files carry Unix permissions, damage is caught, and the system's unzip (where installed) agrees.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createZip, readZip } from "../tools/zip.mjs";
import { tempDir } from "./helpers.mjs";

const ENTRIES = [
    { name: "lang/" },
    { name: "lang/en.json", data: JSON.stringify({ "pf2e-artisans-workshop.A": "Ä naïve café ".repeat(200) }) },
    { name: "module.json", data: "{}\n" },
    { name: "scripts/" },
    { name: "scripts/empty.mjs", data: "" },
    { name: "scripts/tiny.mjs", data: "x" },
];

test("what goes in comes out: names, contents, folders, permissions, and deflate only where it helps", () => {
    const entries = readZip(createZip(ENTRIES));
    assert.deepEqual(entries.map((entry) => entry.name), ENTRIES.map((entry) => entry.name));
    for (const [i, entry] of entries.entries()) {
        assert.equal(entry.data.toString("utf8"), ENTRIES[i].data ?? "", entry.name);
        assert.equal(entry.folder, ENTRIES[i].name.endsWith("/"));
        assert.equal(entry.mode, entry.folder ? 0o040755 : 0o100644, entry.name);
    }
    assert.equal(entries.find((entry) => entry.name === "lang/en.json").method, 8, "a long repetitive file is deflated");
    assert.equal(entries.find((entry) => entry.name === "scripts/tiny.mjs").method, 0, "a one-byte file is stored");
});

test("the same entries give the same bytes (fixed timestamps), so a dry run's SHA-256 matches CI's for the same files", () => {
    assert.deepEqual(createZip(ENTRIES), createZip(ENTRIES.map((entry) => ({ ...entry }))));
});

test("names must be relative, '/'-separated and stay inside the archive", () => {
    for (const name of ["/abs.txt", "../up.txt", "a/../../b", "win\\path.txt", ""]) {
        assert.throws(() => createZip([{ name, data: "x" }]), /not a relative/, name);
    }
});

test("the reader catches a damaged entry", () => {
    const zip = createZip([{ name: "a.txt", data: "hello hello hello hello hello hello" }]);
    const damaged = Buffer.from(zip);
    damaged[30 + "a.txt".length + 2] ^= 0xff; // a byte of the deflated body
    assert.throws(() => readZip(damaged), /zip: a\.txt/);
    assert.throws(() => readZip(Buffer.from("not a zip at all, just some text that is long enough")), /no end of central directory/);
});

test("the system's unzip reads the archive and finds it sound", (t) => {
    let unzip = true;
    try {
        execFileSync("unzip", ["-v"], { stdio: "ignore" });
    } catch {
        unzip = false;
    }
    if (!unzip) {
        t.skip("unzip is not installed");
        return;
    }
    const dir = tempDir(t);
    const path = join(dir, "test.zip");
    writeFileSync(path, createZip(ENTRIES));
    assert.match(execFileSync("unzip", ["-t", path], { encoding: "utf8" }), /No errors detected/);
    assert.deepEqual(execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n"), ENTRIES.map((entry) => entry.name));
});
