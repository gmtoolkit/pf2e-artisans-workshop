/**
 * Record the author's sign-off for rewritten strings (DESIGN.md 16.4).
 *
 *   node tools/signoff-strings.mjs --keys <key> [<key> ...]   sign off these keys
 *   node tools/signoff-strings.mjs --all                       sign off every current string
 *
 * Keys are `lang/en.json` keys, `file:README.md`, `file:docs/package-description.md`,
 * `module.json:title` and `module.json:description`. Several keys may be given separated by spaces
 * or commas, and a key ending in `*` matches every key with that prefix. `npm run check:strings`
 * lists what still needs sign-off.
 *
 * The author runs this only for strings they have rewritten themselves, and commits the result: the
 * gate proves sign-off, not authorship. Entries for keys that no longer exist are dropped.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIGNOFF_FILE, collectStrings, hashString, readSignoff } from "./check-strings.mjs";

/**
 * Resolve the requested keys against the current strings.
 * @returns {{keys: string[], unknown: string[]}}
 */
export function resolveKeys(requested, strings) {
    const keys = new Set();
    const unknown = [];
    for (const pattern of requested) {
        const matches = pattern.endsWith("*")
            ? [...strings.keys()].filter((key) => key.startsWith(pattern.slice(0, -1)))
            : [pattern].filter((key) => strings.has(key));
        if (!matches.length) unknown.push(pattern);
        for (const key of matches) keys.add(key);
    }
    return { keys: [...keys], unknown };
}

/** The new sign-off object: current entries kept, `keys` hashed, stale entries dropped, sorted by key. */
export function updateSignoff(signoff, strings, keys) {
    const next = {};
    for (const [key, hash] of Object.entries(signoff)) if (strings.has(key)) next[key] = hash;
    for (const key of keys) next[key] = hashString(strings.get(key));
    // Plain code-unit order, so the file sorts the same on every machine.
    return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Run the command and return the exit code. `log` receives each output line. */
export function run(root, args = [], log = console.log) {
    const all = args.includes("--all");
    const requested = keysArgument(args);
    if (all === (requested.length > 0)) {
        log("Usage: signoff-strings.mjs --keys <key> [<key> ...] | --all");
        return 2;
    }

    const { strings, errors } = collectStrings(root);
    const signoff = readSignoff(root, errors);
    if (errors.length) {
        for (const error of errors) log(`error: ${error}`);
        return 1;
    }

    const { keys, unknown } = all ? { keys: [...strings.keys()], unknown: [] } : resolveKeys(requested, strings);
    if (unknown.length) {
        for (const key of unknown) log(`error: no string matches "${key}"`);
        log("Nothing written.");
        return 1;
    }

    const next = updateSignoff(signoff, strings, keys);
    writeFileSync(join(root, SIGNOFF_FILE), `${JSON.stringify(next, null, 2)}\n`);

    log(`Signed off ${keys.length} string${keys.length === 1 ? "" : "s"} in ${SIGNOFF_FILE}:`);
    for (const key of keys) log(`  ${key}`);
    const dropped = Object.keys(signoff).filter((key) => !(key in next));
    for (const key of dropped) log(`  removed stale entry ${key}`);
    return 0;
}

/** Everything after `--keys` up to the next option, split on commas. */
function keysArgument(args) {
    const start = args.indexOf("--keys");
    if (start === -1) return [];
    const values = [];
    for (const arg of args.slice(start + 1)) {
        if (arg.startsWith("--")) break;
        values.push(...arg.split(",").map((key) => key.trim()).filter(Boolean));
    }
    return values;
}

if (import.meta.main) {
    process.exitCode = run(join(import.meta.dirname, ".."), process.argv.slice(2));
}
