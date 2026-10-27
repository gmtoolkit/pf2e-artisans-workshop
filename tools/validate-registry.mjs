/**
 * Registry validation (DESIGN.md 6.11, 15.2): checks the rules registry (`scripts/data/registry.mjs`) and its ignore
 * list (`scripts/data/registry-ignore.mjs`) against a pf2e source checkout.
 *
 *   node tools/validate-registry.mjs --pf2e <checkout> [--enforce] [--json <file>] [--limit <n>]
 *
 * Fails (exit 1) when an entry no longer matches the compendium: its UUID does not resolve, its slug or document
 * type changed, its publication's remaster flag changed, a rule element it relies on lost the shape the module
 * relies on (`relies`), a UUID its effects name does not resolve, or an ignored UUID is gone or also in the registry, or
 * is an item whose Crafting bonus predicates an option only the roll wrapper can add (`wrapperOptions`), which needs a
 * registry entry with a `rollOptions` effect instead. It also fails when a predicate names an item option no physical
 * item in the checkout has (`checkReferences`: a trait, tag, slug, category, usage or type that pf2e renamed or that was
 * mistyped), a `books` title no item has, or a `correction` that pf2e has fixed (a talisman with the consumable trait now,
 * or a daily pool's `CraftingAbility` rule that no longer reads as the correction's `bug` says).
 *
 * Completeness: every item of every Item pack in the checkout whose description mentions crafting, formulas, daily
 * preparations or Earn Income must be in the registry or on the ignore list. Those that are in neither are reported;
 * with `--enforce` (the stable-release workflow, 16.2) they fail the run. A sparse checkout's missing packs are
 * named as skipped, and the run fails when a registry entry or ignored UUID is in one of them (or, with `--enforce`,
 * when any Item pack is missing), so a check never passes by reading nothing.
 *
 * Afflictions (M8a, 8.10.2): the parser runs over every candidate in the checkout's Item packs; each parses fully, has an
 * override (`scripts/data/afflictions.mjs`) or is on its ignore list, or the run fails (`checkAfflictions`). With
 * `--affliction-baseline <json>` (an earlier run's `--json` output) it also lists the candidates whose parse changed.
 *
 * `PF2E_SRC=<checkout> npm test` runs the same checks (`test/validate-registry.test.mjs`).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { REGISTRY, SPECIALTY_DEFAULTS } from "../scripts/data/registry.mjs";
import { IGNORE_REASONS, REGISTRY_IGNORE } from "../scripts/data/registry-ignore.mjs";
import { AFFLICTION_IGNORE, AFFLICTION_IGNORE_REASONS, AFFLICTION_OVERRIDES } from "../scripts/data/afflictions.mjs";
import { isCandidate, parseAffliction } from "../scripts/logic/affliction-parse.mjs";
import { applyOverride, definitionDigest, kindOf } from "../scripts/logic/affliction.mjs";

/* -------------------------------------------- */
/*  pf2e's own rules                             */
/* -------------------------------------------- */

const wordCharacter = String.raw`[\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]`;
const nonWordCharacterRE = new RegExp(String.raw`[^\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]`, "gu");
const lowerThenUpperRE = new RegExp(String.raw`(\p{Lowercase_Letter})(\p{Uppercase_Letter}(?=^|$|${wordCharacter}))`, "gu");

/** pf2e's `sluggify` (`src/util/misc.ts`, default style): how an item without `system.slug` gets its slug. */
export function sluggify(text) {
    if (text === "-") return text;
    return text.replace(lowerThenUpperRE, "$1-$2").toLowerCase().replace(/['’]/g, "")
        .replace(nonWordCharacterRE, " ").trim().replace(/[-\s]+/g, "-");
}

/** An item's slug as pf2e reads it: `system.slug`, else its name sluggified (the pack build does the same). */
export const slugOf = (doc) => doc.system?.slug || sluggify(doc.name);

/* -------------------------------------------- */
/*  The checkout                                 */
/* -------------------------------------------- */

/**
 * The Item packs of a pf2e checkout, read on demand: `get(uuid)` returns the document, undefined when its pack
 * has no such id, or null when `system.pf2e.json` lists the pack but the (sparse) checkout lacks its folder;
 * `items()` every document of every Item pack present, each with `__uuid`; `skipped` the packs left out.
 */
export function loadSource(root) {
    const manifest = JSON.parse(readFileSync(join(root, "system.pf2e.json"), "utf8"));
    const itemPacks = manifest.packs.filter((pack) => pack.type === "Item");
    const folders = new Map(itemPacks.map((pack) => [pack.name, pack.path.split("/").pop()]));
    const loaded = new Map();
    const skipped = new Set();
    function pack(name) {
        if (!loaded.has(name)) {
            const dir = join(root, "packs", "pf2e", folders.get(name));
            loaded.set(name, existsSync(dir) ? readPack(dir, name) : null);
            if (!loaded.get(name)) skipped.add(name);
        }
        return loaded.get(name);
    }
    function get(uuid) {
        const match = /^Compendium\.pf2e\.([^.]+)\.Item\.([A-Za-z0-9]{16})$/.exec(uuid ?? "");
        if (!match || !folders.has(match[1])) return undefined;
        const docs = pack(match[1]);
        return docs === null ? null : docs.get(match[2]);
    }
    function* items() {
        for (const name of folders.keys()) yield* pack(name)?.values() ?? [];
    }
    return { get, items, skipped };
}

/** The documents of one pack folder (subfolders included), by `_id`. */
function readPack(dir, name) {
    const docs = new Map();
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith("_")) continue;
        const doc = JSON.parse(readFileSync(join(entry.parentPath, entry.name), "utf8"));
        if (doc._id) docs.set(doc._id, Object.assign(doc, { __uuid: `Compendium.pf2e.${name}.Item.${doc._id}` }));
    }
    return docs;
}

/* -------------------------------------------- */
/*  Entry checks                                 */
/* -------------------------------------------- */

/** Whether `value` contains `match`: equal leaves, every key of an object, every element of an array in order. */
export function contains(value, match) {
    if (Array.isArray(match)) return Array.isArray(value) && value.length === match.length && match.every((m, i) => contains(value[i], m));
    if (match && typeof match === "object") {
        return !!value && typeof value === "object" && Object.entries(match).every(([key, m]) => contains(value[key], m));
    }
    return value === match;
}

/** The UUIDs an entry's effects name (virtual lists and formula grants). */
const effectUuids = (entry) => entry.effects.flatMap((effect) => effect.uuids ?? []);

/** Every string in a nested value (a predicate's options). */
const stringLeaves = (value) => (typeof value === "string" ? [value]
    : Array.isArray(value) ? value.flatMap(stringLeaves)
        : value && typeof value === "object" ? Object.values(value).flatMap(stringLeaves) : []);

/**
 * The options a document's Crafting rule elements predicate that nothing in pf2e sets for a Craft, so only the roll
 * wrapper can supply them (a registry `rollOptions` effect): bare options (`snare`) and trade options
 * (`action:craft:alchemical`). Options the item's own RollOption rules set are left out.
 */
export function wrapperOptions(doc) {
    const rules = doc.system?.rules ?? [];
    const own = new Set(rules.filter((rule) => rule.key === "RollOption").map((rule) => rule.option));
    const crafting = rules.filter((rule) => [rule.selector].flat().includes("crafting"));
    const options = crafting.flatMap((rule) => stringLeaves(rule.predicate ?? []));
    return [...new Set(options)].filter((option) => (!option.includes(":") || option.startsWith("action:craft:")) && !own.has(option));
}

/** Ignore reasons whose items need wrapper options only from a later milestone (Repair's options arrive with M5). */
const DEFERRED_REASONS = new Set(["repair"]);

/**
 * Every way the registry and the ignore list disagree with the checkout, as `{key, problem}`; and the registry keys
 * and ignored UUIDs whose pack the checkout lacks (`unchecked`), which the command line fails on.
 */
export function checkEntries({ registry = REGISTRY, ignore = REGISTRY_IGNORE, reasons = IGNORE_REASONS, source }) {
    const problems = [];
    const unchecked = [];
    const seen = new Map();
    for (const [key, entry] of Object.entries(registry)) {
        const report = (problem) => problems.push({ key, problem });
        if (seen.has(entry.uuid)) report(`same UUID as ${seen.get(entry.uuid)}`);
        seen.set(entry.uuid, key);
        const doc = source.get(entry.uuid);
        if (doc === null) {
            unchecked.push(key);
            continue;
        }
        if (!doc) {
            report(`${entry.uuid} does not resolve`);
            continue;
        }
        const slug = key.split("@")[0];
        if (slugOf(doc) !== slug) report(`slug is now ${slugOf(doc)}`);
        if (doc.type !== entry.type) report(`type is now ${doc.type}`);
        const remaster = doc.system?.publication?.remaster === true;
        if (remaster !== entry.remaster) report(`remaster flag is now ${remaster}`);
        for (const { key: rule, match } of entry.relies ?? []) {
            const found = (doc.system?.rules ?? []).some((r) => r.key === rule && contains(r, match));
            if (!found) report(`no ${rule} rule with ${JSON.stringify(match)}`);
        }
        for (const uuid of effectUuids(entry)) {
            if (source.get(uuid) === undefined) report(`effect UUID ${uuid} does not resolve`);
        }
        const fixed = entry.effects.some((effect) => effect.kind === "correction" && effect.consumable) &&
            (doc.system?.traits?.value ?? []).includes("consumable");
        if (fixed) report("has the consumable trait now, so its correction is stale");
        for (const effect of entry.effects.filter((e) => e.kind === "correction" && e.bug)) {
            const still = (doc.system?.rules ?? []).some((r) => r.key === "CraftingAbility" && contains(r, effect.bug));
            if (!still) report(`its CraftingAbility rule no longer reads ${JSON.stringify(effect.bug)}: check whether the ${effect.pool} correction is still needed`);
        }
    }
    for (const [uuid, reason] of Object.entries(ignore)) {
        const report = (problem) => problems.push({ key: uuid, problem });
        if (!(reason in reasons)) report(`unknown ignore reason ${reason}`);
        if (seen.has(uuid)) report(`ignored and in the registry as ${seen.get(uuid)}`);
        const doc = source.get(uuid);
        if (doc === undefined) report("ignored UUID does not resolve");
        if (doc === null) unchecked.push(uuid);
        const needed = doc && !DEFERRED_REASONS.has(reason) ? wrapperOptions(doc) : [];
        if (needed.length) report(`ignored, but its Crafting bonus needs options only the roll wrapper adds: ${needed.join(", ")}`);
    }
    return { problems, unchecked };
}

/** pf2e's physical item types (`src/module/item/physical/values.ts`): the items a Craft can make. */
const PHYSICAL_TYPES = new Set(["ammo", "armor", "backpack", "book", "consumable", "equipment", "shield", "treasure", "weapon"]);

/** The item option kinds a predicate may name, each read from a compendium document as pf2e builds its options. */
const OPTION_FACTS = {
    slug: (doc) => [slugOf(doc)],
    trait: (doc) => doc.system?.traits?.value ?? [],
    tag: (doc) => doc.system?.traits?.otherTags ?? [],
    category: (doc) => [doc.system?.category],
    usage: (doc) => [doc.system?.usage?.value],
    type: (doc) => [doc.type],
    rarity: (doc) => [doc.system?.traits?.rarity],
};
/** Item option kinds that hold numbers or ids, which a registry predicate may name without a check. */
const UNCHECKED_KINDS = new Set(["level", "id"]);

/**
 * Every item option a registry predicate (or `SPECIALTY_DEFAULTS`) names that no physical item in the checkout has,
 * as `{key, problem}`, so a typo or a pf2e rename cannot turn an effect into a silent no-op; likewise every `books`
 * title no physical item has. An option the registry itself adds with a `rollOptions` effect (Seasoned's
 * `item:tag:food`) counts as present.
 */
export function checkReferences({ registry = REGISTRY, defaults = SPECIALTY_DEFAULTS, source }) {
    const present = Object.fromEntries(Object.keys(OPTION_FACTS).map((kind) => [kind, new Set()]));
    const titles = new Set();
    for (const doc of source.items()) {
        if (!PHYSICAL_TYPES.has(doc.type)) continue;
        for (const [kind, facts] of Object.entries(OPTION_FACTS)) for (const value of facts(doc)) if (value) present[kind].add(value);
        if (doc.system?.publication?.title) titles.add(doc.system.publication.title);
    }
    const injected = new Set(Object.values(registry).flatMap((entry) => entry.effects)
        .filter((effect) => effect.kind === "rollOptions").flatMap((effect) => effect.options));
    const problems = [];
    const check = (key, value) => {
        for (const option of stringLeaves(value)) {
            const match = /^item:([a-z]+):(.+)$/.exec(option);
            if (!match || injected.has(option) || UNCHECKED_KINDS.has(match[1])) continue;
            if (!(match[1] in OPTION_FACTS)) problems.push({ key, problem: `${option}: the validator cannot check item:${match[1]} options` });
            else if (!present[match[1]].has(match[2])) problems.push({ key, problem: `${option}: no physical item in this checkout has it` });
        }
    };
    for (const [key, entry] of Object.entries(registry)) {
        check(key, entry.effects);
        for (const book of entry.effects.flatMap((effect) => effect.books ?? [])) {
            if (!titles.has(book)) problems.push({ key, problem: `book "${book}": no physical item in this checkout is from it` });
        }
    }
    for (const [trade, predicate] of Object.entries(defaults)) check(`SPECIALTY_DEFAULTS.${trade}`, predicate);
    return problems;
}

/* -------------------------------------------- */
/*  Completeness                                 */
/* -------------------------------------------- */

/**
 * What makes a description a candidate (6.11, Completeness), in plain words for the report. The Craft
 * Requirements heading most items carry is removed first, so it does not make every item a candidate.
 */
export const CANDIDATE_PATTERNS = Object.freeze({
    crafting: /\bcraft(?:s|ed|ing|er|ers)?\b/i,
    formulas: /\bformulas?\b/i,
    "daily preparations": /\bdaily preparations?\b/i,
    "Earn Income": /\bearn(?:s|ed|ing)? income\b/i,
});

/** A description as plain text, without its Craft Requirements heading. */
export function plainText(html = "") {
    return html.replace(/<[^>]+>/g, " ").replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, "$1").replace(/\bCraft Requirements\b/g, " ");
}

/** Which patterns a document's description matches. */
export function mentions(doc) {
    const text = plainText(doc.system?.description?.value ?? "");
    return Object.entries(CANDIDATE_PATTERNS).filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** Candidates in neither the registry nor the ignore list: `{uuid, name, type, mentions}`, sorted by UUID. */
export function unlisted({ registry = REGISTRY, ignore = REGISTRY_IGNORE, source }) {
    const listed = new Set([...Object.values(registry).map((entry) => entry.uuid), ...Object.keys(ignore)]);
    const out = [];
    for (const doc of source.items()) {
        if (listed.has(doc.__uuid)) continue;
        const found = mentions(doc);
        if (found.length) out.push({ uuid: doc.__uuid, name: doc.name, type: doc.type, mentions: found });
    }
    return out.sort((a, b) => (a.uuid < b.uuid ? -1 : 1));
}

/* -------------------------------------------- */
/*  Afflictions (8.10.2, 15.2)                   */
/* -------------------------------------------- */

/** The affliction parse of a compendium document, with its override merged in when it has one. */
export function afflictionOf(doc, override = null) {
    const statistic = doc.system?.defense?.save?.statistic ?? null;
    const parsed = parseAffliction(doc.system?.description?.value ?? "", { level: doc.system?.level?.value ?? 0, traits: doc.system?.traits?.value ?? [],
        save: statistic ? { type: statistic, against: "spell" } : null });
    return override ? applyOverride(parsed, override) : parsed;
}

/**
 * The affliction corpus check (8.10.2, 15.2): the parser over every candidate item of every Item pack in the checkout (any
 * Stage or Stages label, or an Onset or Maximum Duration paragraph). Each must parse fully, have an override, or be on the
 * affliction ignore list; an intro that mentions further, additional or multiple exposure needs an entry too, as does a
 * candidate with no affliction kind (poison, disease or curse) among its traits. Overrides and ignored UUIDs are checked
 * like registry entries (they resolve, the slug matches, not both). `baseline` (`{uuid: digest}`, from an earlier run's
 * `--json`) reports every candidate whose parse changed between two pf2e tags, for the churn watch (3.3).
 *
 * @returns {{problems: {key, problem}[], unchecked: string[], summary: object, digests: Record<string, string>,
 *   changed: {uuid, name}[], notes: {key, note}[]}}
 */
export function checkAfflictions({ source, overrides = AFFLICTION_OVERRIDES, ignore = AFFLICTION_IGNORE, reasons = AFFLICTION_IGNORE_REASONS, baseline = null }) {
    const problems = [];
    const unchecked = [];
    const notes = [];
    const byUuid = new Map();
    for (const [key, entry] of Object.entries(overrides)) {
        const report = (problem) => problems.push({ key, problem });
        if (byUuid.has(entry.uuid)) report(`same UUID as ${byUuid.get(entry.uuid)}`);
        byUuid.set(entry.uuid, key);
        if (entry.uuid in ignore) report("overridden and on the affliction ignore list");
        const doc = source.get(entry.uuid);
        if (doc === null) unchecked.push(key);
        else if (!doc) report(`${entry.uuid} does not resolve`);
        else if (slugOf(doc) !== key) report(`slug is now ${slugOf(doc)}`);
    }
    for (const [uuid, reason] of Object.entries(ignore)) {
        if (!(reason in reasons)) problems.push({ key: uuid, problem: `unknown affliction ignore reason ${reason}` });
        const doc = source.get(uuid);
        if (doc === null) unchecked.push(uuid);
        else if (!doc) problems.push({ key: uuid, problem: "ignored affliction UUID does not resolve" });
    }
    const summary = { candidates: 0, full: 0, overridden: 0, ignored: 0, failed: 0, poisons: { candidates: 0, full: 0, overridden: 0, ignored: 0 } };
    const digests = {};
    const changed = [];
    for (const doc of source.items()) {
        const html = doc.system?.description?.value ?? "";
        if (!isCandidate(html)) continue;
        summary.candidates += 1;
        const poison = (doc.system?.traits?.value ?? []).includes("poison");
        if (poison) summary.poisons.candidates += 1;
        const count = (field) => {
            summary[field] += 1;
            if (poison) summary.poisons[field] += 1;
        };
        if (doc.__uuid in ignore) {
            count("ignored");
            continue;
        }
        const key = byUuid.get(doc.__uuid) ?? null;
        const override = key ? overrides[key] : null;
        const parsed = afflictionOf(doc);
        const def = override ? applyOverride(parsed, override) : parsed;
        digests[doc.__uuid] = definitionDigest(def);
        if (baseline && baseline[doc.__uuid] && baseline[doc.__uuid] !== digests[doc.__uuid]) changed.push({ uuid: doc.__uuid, name: doc.name });
        const report = (problem) => {
            problems.push({ key: doc.__uuid, problem: `${doc.name}: ${problem}` });
            summary.failed += 1;
        };
        if (override) {
            count("overridden");
            if (parsed.confidence === "full" && !override.traits && !override.reExposure && !override.keepsCoating && !override.save) {
                notes.push({ key, note: "parses fully now: check whether its override is still needed" });
            }
            continue;
        }
        if (parsed.confidence !== "full") report(`does not parse fully (${parsed.problems.join(", ")}): add an override or an ignore-list entry`);
        else if (parsed.intro.reExposure) report("its intro changes what further exposure does: review it and add an override or an ignore-list entry");
        else if (!kindOf(parsed)) report("no affliction kind (poison, disease, curse) in its traits: add an override or an ignore-list entry");
        else count("full");
    }
    return { problems, unchecked, summary, digests, changed, notes };
}

/* -------------------------------------------- */
/*  Command line                                 */
/* -------------------------------------------- */

/** The command line; `data` replaces the shipped registry, ignore list and specialty defaults (tests). */
export function main(argv = process.argv.slice(2), log = console.log, data = {}) {
    const { registry = REGISTRY, ignore = REGISTRY_IGNORE, reasons = IGNORE_REASONS, defaults = SPECIALTY_DEFAULTS } = data;
    const afflictions = data.afflictions ?? { overrides: AFFLICTION_OVERRIDES, ignore: AFFLICTION_IGNORE, reasons: AFFLICTION_IGNORE_REASONS };
    const { values } = parseArgs({
        args: argv,
        options: {
            pf2e: { type: "string", default: process.env.PF2E_SRC ?? "" },
            enforce: { type: "boolean", default: false },
            json: { type: "string" },
            limit: { type: "string", default: "40" },
            "affliction-baseline": { type: "string" },
        },
    });
    if (!values.pf2e) {
        log("validate-registry: pass --pf2e <pf2e checkout> (or set PF2E_SRC)");
        return 2;
    }
    const source = loadSource(values.pf2e);
    const { problems, unchecked } = checkEntries({ registry, ignore, reasons, source });
    problems.push(...checkReferences({ registry, defaults, source }));
    const missing = unlisted({ registry, ignore, source });
    const baseline = values["affliction-baseline"] ? JSON.parse(readFileSync(values["affliction-baseline"], "utf8")).afflictions?.digests ?? null : null;
    const ailing = checkAfflictions({ source, ...afflictions, baseline });
    problems.push(...ailing.problems);
    unchecked.push(...ailing.unchecked);
    log(`registry: ${Object.keys(registry).length} entries, ${Object.keys(ignore).length} ignored UUIDs`);
    if (source.skipped.size) log(`not in this checkout, so not checked: ${[...source.skipped].sort().join(", ")}`);
    if (unchecked.length) log(`FAIL ${unchecked.length} entries and ignored UUIDs are in packs this checkout lacks, so were not checked`);
    if (values.enforce && source.skipped.size) log("FAIL enforce mode needs every Item pack");
    for (const { key, problem } of problems) log(`FAIL ${key}: ${problem}`);
    log(`completeness: ${missing.length} candidate items in neither the registry nor the ignore list${values.enforce ? "" : " (report only)"}`);
    for (const item of missing.slice(0, Number(values.limit))) log(`  ${item.uuid} ${item.name} [${item.mentions.join(", ")}]`);
    if (missing.length > Number(values.limit)) log(`  ... and ${missing.length - Number(values.limit)} more (--json for all)`);
    const a = ailing.summary;
    log(`afflictions: ${a.candidates} candidates: ${a.full} parse fully, ${a.overridden} have an override, ${a.ignored} ignored, ${a.failed} fail; ` +
        `poisons ${a.poisons.candidates}: ${a.poisons.full} parse fully, ${a.poisons.overridden} have an override, ${a.poisons.ignored} ignored`);
    for (const { key, note } of ailing.notes) log(`  note ${key}: ${note}`);
    for (const { uuid, name } of ailing.changed) log(`  changed parse since the baseline: ${uuid} ${name}`);
    if (values.json) {
        writeFileSync(values.json, JSON.stringify({ problems, unchecked, unlisted: missing, skipped: [...source.skipped],
            afflictions: { summary: a, digests: ailing.digests, changed: ailing.changed, notes: ailing.notes } }, null, 2));
    }
    const incomplete = unchecked.length > 0 || (values.enforce && (missing.length > 0 || source.skipped.size > 0));
    return problems.length || incomplete ? 1 : 0;
}

if (import.meta.main) process.exitCode = main();
