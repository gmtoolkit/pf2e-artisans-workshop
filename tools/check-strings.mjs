/**
 * Strings sign-off gate (DESIGN.md 16.4).
 *
 * Every user-facing string is drafted by machine and rewritten by the author before listing. The
 * author records each rewritten string with `tools/signoff-strings.mjs`, which stores a hash of it in
 * `lang/review/en.signoff.json`. This check lists every string that is new or has changed since its
 * sign-off.
 *
 *   node tools/check-strings.mjs [--mode report|enforce]
 *
 * report (the default) prints the list and exits 0: pull requests and pre-releases
 * (`npm run check:strings`). enforce exits 1 if anything is listed: stable releases
 * (`npm run check:strings:enforce`). A malformed language or sign-off file fails in both modes, and
 * a usage error (an unknown argument, `--mode` without a value or given twice) exits 2, so a mistyped
 * release command cannot pass in report mode by accident.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MODULE_ID } from "../scripts/constants.mjs";

export const LANG_FILE = "lang/en.json";
export const SIGNOFF_FILE = "lang/review/en.signoff.json";

/** Whole files under the gate, hashed as one string each, under the key `file:<path>`. */
export const SIGNOFF_FILES = ["README.md", "docs/package-description.md"];

/** Manifest fields Foundry shows to users, under the key `module.json:<field>`. */
export const MANIFEST_FIELDS = ["title", "description"];

/** Trim, Unicode NFC, and collapse runs of whitespace, so reflowing a string is not a change. */
export function normalise(text) {
    return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** SHA-256 of the normalised text, as hex. */
export function hashString(text) {
    return createHash("sha256").update(normalise(text), "utf8").digest("hex");
}

/**
 * Every string under the gate, keyed as the sign-off file keys it.
 * @returns {{strings: Map<string, string>, errors: string[]}}
 */
export function collectStrings(root) {
    const errors = [];
    const strings = new Map();

    const lang = readObject(root, LANG_FILE, errors);
    for (const [key, value] of Object.entries(lang ?? {})) {
        if (typeof value !== "string") {
            errors.push(`${LANG_FILE}: "${key}" is not a string (keys must be flat)`);
        } else if (!key.startsWith(`${MODULE_ID}.`)) {
            errors.push(`${LANG_FILE}: "${key}" is not under the "${MODULE_ID}." namespace`);
        } else if (!/^[A-Z]/.test(key.slice(MODULE_ID.length + 1))) {
            // tools/check-source.mjs finds keys in code by their capital letter (hooks are lower case).
            errors.push(`${LANG_FILE}: "${key}" must continue with a capital letter after "${MODULE_ID}."`);
        } else {
            strings.set(key, value);
        }
    }

    const manifest = readObject(root, "module.json", errors);
    for (const field of MANIFEST_FIELDS) {
        if (typeof manifest?.[field] === "string") strings.set(`module.json:${field}`, manifest[field]);
        else if (manifest) errors.push(`module.json: "${field}" is missing`);
    }

    for (const file of SIGNOFF_FILES) {
        const path = join(root, file);
        if (existsSync(path)) strings.set(`file:${file}`, readFileSync(path, "utf8"));
        else errors.push(`${file} is missing`);
    }

    return { strings, errors };
}

/** The sign-off file as a plain object of key to hash (empty if the file does not exist yet). */
export function readSignoff(root, errors = []) {
    if (!existsSync(join(root, SIGNOFF_FILE))) return {};
    return readObject(root, SIGNOFF_FILE, errors) ?? {};
}

/**
 * Compare the strings with their sign-off hashes.
 * @returns {{unsigned: string[], changed: string[], stale: string[]}} unsigned: never signed off;
 *   changed: edited since sign-off; stale: signed-off keys that no longer exist (informational).
 */
export function compareStrings(strings, signoff) {
    const unsigned = [];
    const changed = [];
    for (const [key, text] of strings) {
        if (!(key in signoff)) unsigned.push(key);
        else if (signoff[key] !== hashString(text)) changed.push(key);
    }
    const stale = Object.keys(signoff).filter((key) => !strings.has(key));
    return { unsigned, changed, stale };
}

/** Run the check and return the exit code. `log` receives each output line. */
export function run(root, args = [], log = console.log) {
    const mode = modeArgument(args);
    if (!mode) {
        log("Usage: check-strings.mjs [--mode report|enforce]");
        return 2;
    }

    const { strings, errors } = collectStrings(root);
    const signoff = readSignoff(root, errors);
    if (errors.length) {
        for (const error of errors) log(`error: ${error}`);
        return 1;
    }

    const { unsigned, changed, stale } = compareStrings(strings, signoff);
    const pending = unsigned.length + changed.length;
    log(`Strings gate (${mode}): ${strings.size} strings, ${strings.size - pending} signed off, ${pending} need sign-off.`);
    for (const key of unsigned) log(`  new      ${key}`);
    for (const key of changed) log(`  changed  ${key}`);
    for (const key of stale) log(`  stale    ${key} (no longer exists; the next sign-off removes it)`);

    if (pending && process.env.GITHUB_ACTIONS) {
        const level = mode === "enforce" ? "error" : "warning";
        log(`::${level} title=Strings gate::${pending} strings need the author's sign-off (see the log).`);
    }
    return mode === "enforce" && pending ? 1 : 0;
}

/* -------------------------------------------- */

/** A JSON file that must hold an object, or null after adding an error. */
function readObject(root, file, errors) {
    let data;
    try {
        data = JSON.parse(readFileSync(join(root, file), "utf8"));
    } catch (error) {
        errors.push(`${file}: ${error.message}`);
        return null;
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        errors.push(`${file}: must be a JSON object`);
        return null;
    }
    return data;
}

/** The mode, "report" when none is given, or null for a usage error. */
function modeArgument(args) {
    let values;
    try {
        // parseArgs throws on an unknown argument and on --mode without a value.
        ({ values } = parseArgs({ args, options: { mode: { type: "string", multiple: true } } }));
    } catch {
        return null;
    }
    const modes = values.mode ?? ["report"];
    return modes.length === 1 && ["report", "enforce"].includes(modes[0]) ? modes[0] : null;
}

if (import.meta.main) {
    process.exitCode = run(join(import.meta.dirname, ".."), process.argv.slice(2));
}
