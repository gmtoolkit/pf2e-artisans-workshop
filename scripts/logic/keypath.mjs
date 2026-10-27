/**
 * The write rule of the shared ledger (DESIGN.md 5.3, P3): every write is a key-path update into the
 * module's flags, collections are objects keyed by id, nothing rewrites a whole collection, and deletions use
 * Foundry's `_del` operator. This file checks paths and builds the update objects; the Foundry side
 * (`scripts/foundry/store.mjs`) sends them.
 *
 * Foundry merges a flag update into the stored document key by key on the server (`ObjectField#_updateDiff`
 * diffs, then `mergeObject` with `applyOperators`), so two clients writing different keys at the same moment
 * both land. Two writes to the same key are last-write-wins (5.3.2).
 */

/**
 * The ledger's top-level keys (5.1) and how many path segments a write or a deletion needs at least. A
 * collection needs its id (`rows.<id>`); `formulas.<actorId>.<hash>` and `meta.manual.<runId>` are collections one level
 * down. The longest matching prefix decides. M10 adds `extRuns` (an extension activity's runs, 12.2), `spends` (the log
 * of items spent through a consumable sink) and `incomes` (an income source's payments, recorded once per key); an
 * extension's own data is not here but in the ledger's flags under the extension's module id (12.4, `scopeUpdate`).
 */
const MIN_DEPTH = new Map([
    ["schema", 1], ["role", 1],
    ["meta", 2], ["meta.manual", 3],
    ["orders", 2], ["services", 2], ["rows", 2], ["claims", 2], ["pcs", 2], ["days", 2], ["jobs", 2],
    ["roster", 2], ["standing", 2], ["gardens", 2], ["afflictionDefs", 2],
    ["formulas", 3], ["extRuns", 2], ["spends", 2], ["incomes", 2],
]);

/** A path segment: an id, a slug or a camelCase name. Dots separate segments; "=" (the banned -= and == keys) never appears. */
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/**
 * The segments of a ledger path, after checking it: known top-level key, valid segments, deep enough.
 * @param {string} path  e.g. "rows.k2v9q0w1e3r5t7y8.state"
 * @returns {string[]}
 */
export function checkPath(path) {
    if (typeof path !== "string" || path === "") throw new TypeError("a ledger path must be a non-empty string");
    const segments = path.split(".");
    for (const segment of segments) {
        if (!SEGMENT.test(segment) || FORBIDDEN.has(segment)) throw new TypeError(`bad ledger path segment in "${path}"`);
    }
    let depth = null;
    for (let n = segments.length; n > 0 && depth === null; n--) depth = MIN_DEPTH.get(segments.slice(0, n).join(".")) ?? null;
    if (depth === null) throw new TypeError(`"${path}" is not under a known ledger key`);
    if (segments.length < depth) throw new TypeError(`"${path}" would rewrite a whole collection (P3)`);
    return segments;
}

/** The document key of a path in a module's flags: `flags.<scope>.<path>`. */
export function flagKey(scope, path) {
    return `flags.${scope}.${path}`;
}

/**
 * One key-path update for the module's flags.
 *
 * @param {string} scope  the flag scope (the module id)
 * @param {object} change
 * @param {Record<string, *>} [change.set]      path to value, merged into what is stored
 * @param {Record<string, *>} [change.replace]  path to value, replacing what is stored (no merge)
 * @param {string[]} [change.del]               paths to delete
 * @param {object} operators  Foundry's data operators: `{deletion: _del, replacement: _replace}`
 * @returns {Record<string, *>}  the update object, without `_id`
 */
export function flagUpdate(scope, { set = {}, replace = {}, del = [] } = {}, { deletion, replacement }, check = checkPath) {
    const entries = [
        ...Object.entries(set).map(([path, value]) => [path, value]),
        ...Object.entries(replace).map(([path, value]) => [path, replacement(value)]),
        ...del.map((path) => [path, deletion]),
    ];
    const paths = entries.map(([path]) => path);
    for (const path of paths) check(path);
    for (const a of paths) {
        for (const b of paths) {
            if (a !== b && b.startsWith(`${a}.`)) throw new TypeError(`"${a}" and "${b}" overlap in one update`);
        }
    }
    if (new Set(paths).size !== paths.length) throw new TypeError("a path appears twice in one update");
    return Object.fromEntries(entries.map(([path, value]) => [flagKey(scope, path), value]));
}

/**
 * A path inside an extension's own flag scope on the ledger (12.4, M10): dot-separated segments of letters, digits, `_` and
 * `-`, at least one. Unlike the Workshop's own paths there are no known top-level keys: the layout is the extension's.
 */
export function checkScopePath(path) {
    if (typeof path !== "string" || path === "") throw new TypeError("an extension store path must be a non-empty string");
    const segments = path.split(".");
    for (const segment of segments) {
        if (!SEGMENT.test(segment) || FORBIDDEN.has(segment)) throw new TypeError(`bad extension store path segment in "${path}"`);
    }
    return segments;
}

/**
 * One key-path update for an extension's own flag scope on the ledger (12.4): as `flagUpdate`, with the scope's own paths.
 * `scope` must be a package id other than the Workshop's (`reserved` names the scopes refused).
 */
export function scopeUpdate(scope, change, operators, reserved = []) {
    if (typeof scope !== "string" || !/^[A-Za-z0-9_-]+$/.test(scope) || reserved.includes(scope)) throw new TypeError(`"${scope}" is not an extension's flag scope`);
    return flagUpdate(scope, change, operators, checkScopePath);
}

/** Whether a stored value is a plain object (a record or a collection). */
export const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The live records of a collection (5.3.3): a record without `id` or an integer `v` is a stub that a late
 * key-path write re-created after the record was archived (for example a `reversedBy`), and is ignored.
 *
 * @param {Record<string, object>|undefined} collection
 * @returns {object[]}
 */
export function liveRecords(collection) {
    if (!isPlainObject(collection)) return [];
    return Object.values(collection).filter((record) => isPlainObject(record) &&
        typeof record.id === "string" && record.id !== "" && Number.isInteger(record.v));
}

/** The value at a dotted path in a plain object, or undefined. */
export function readPath(object, path) {
    let value = object;
    for (const segment of path.split(".")) {
        if (!isPlainObject(value)) return undefined;
        value = value[segment];
    }
    return value;
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The key-path writes that turn `before` into `after` (used to write a migration's result, 4.14): changed or
 * new leaves are set, removed keys deleted. Objects are compared key by key; arrays and other values are
 * compared whole and written whole (arrays only hold small values written once, 5.3.1).
 *
 * @returns {{set: Record<string, *>, del: string[]}}
 */
export function keyPathDiff(before, after, prefix = "") {
    const set = {};
    const del = [];
    const at = (key) => (prefix ? `${prefix}.${key}` : key);
    for (const [key, value] of Object.entries(after ?? {})) {
        const old = before?.[key];
        if (isPlainObject(value) && (isPlainObject(old) || old === undefined)) {
            const inner = keyPathDiff(old ?? {}, value, at(key));   // a new object is written leaf by leaf
            Object.assign(set, inner.set);
            del.push(...inner.del);
        } else if (!sameValue(old, value)) {
            set[at(key)] = value;
        }
    }
    for (const key of Object.keys(before ?? {})) {
        if (!(key in (after ?? {}))) del.push(at(key));
    }
    return { set, del };
}
