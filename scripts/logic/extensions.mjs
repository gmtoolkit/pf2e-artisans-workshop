/**
 * The extension API's pure parts (DESIGN.md 12, M10): the registry other modules fill during the Workshop's `setup` hook,
 * the four interfaces it takes (DowntimeActivity, IncomeSource, ConsumableSink, CheckModifierSource) checked and
 * normalised, the selectors a roll offers check-modifier sources, the modifier data they return, the ids and keys of an
 * extension activity's runs and rows, and the income split. Pure: definitions and plain data in, records and decisions out.
 * `scripts/foundry/extensions.mjs` is the Foundry side.
 *
 * Ids. Every registered object's id is `<moduleId>.<slug>`: the module id as Foundry allows package ids (letters, digits,
 * `-` and `_`), a dot, and a slug of lowercase letters, digits and `-`. The module is the extension's own; its data lives
 * in the Workshop ledger's flags under that module id (12.4), and its rows carry `source: "<moduleId>:<slug>"` (4.6).
 *
 * Registration (12.1). The registry is open from the Workshop's `setup` hook until `ready`; later calls are refused and
 * warned. A duplicate id is refused. An extension that declares `requiresApi` with another major than the Workshop's
 * `apiVersion` is ignored as a whole, and the Workshop warns its GM.
 */
import { DEGREE, requireCp } from "./core.mjs";
import { hashId, idemKey } from "./ids.mjs";

/** The extension interfaces' version (11.3): an integer that changes only when an interface or a hook payload breaks. */
export const API_VERSION = 1;

/**
 * The Workshop's module id (`scripts/constants.mjs`, which this folder may not import; a test keeps the two equal): never an
 * extension's scope, nor are core's, the world's or the system's flag scopes.
 */
export const WORKSHOP_ID = "pf2e-artisans-workshop";
export const RESERVED_SCOPES = Object.freeze(["core", "world", "pf2e", WORKSHOP_ID]);

/** A package id as Foundry 14.368 allows it (`BasePackage.validateId`). */
const PACKAGE_ID = /^[A-Za-z0-9_-]+$/;
/** The slug after the module id. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
/** A key an extension gives a row, a spend or an income event: no `:` (the separator of idempotency keys) and no spaces. */
const KEY = /^[A-Za-z0-9_.-]+$/;

/** The four registries, by the name of the method that fills each. */
export const KINDS = Object.freeze(["downtimeActivity", "incomeSource", "consumableSink", "checkModifierSource"]);
/** How often an income source pays (12.2). */
export const CADENCES = Object.freeze(["perDay", "perEvent", "perWeek"]);
/** Where an income source's money goes (12.2): the party fund in the strongbox, one character's purse, or split among members. */
export const DISTRIBUTIONS = Object.freeze(["strongbox", "actor", "split"]);
/** pf2e's modifier types (`MODIFIER_TYPES`, pf2e 8.6.1 `module/actor/modifiers.ts`). */
export const MODIFIER_TYPES = Object.freeze(["ability", "circumstance", "item", "potency", "proficiency", "status", "untyped"]);
/** What a downtime activity's DC may be besides a number or a function: the party's or the actor's level-based DC. */
export const DC_KINDS = Object.freeze(["partyLevel", "actorLevel"]);

const refuse = (reason, field = null) => ({ ok: false, reason, ...(field ? { field } : {}) });
const isFn = (value) => typeof value === "function";
const isText = (value) => typeof value === "string" && value.trim() !== "";

/** Whether `id` may be an extension's module id: a Foundry package id, not a reserved scope. */
export function isExtensionScope(id) {
    return typeof id === "string" && PACKAGE_ID.test(id) && !RESERVED_SCOPES.includes(id);
}

/** `<moduleId>.<slug>` split, or null when it is not one. */
export function splitId(id) {
    if (typeof id !== "string") return null;
    const dot = id.indexOf(".");
    if (dot <= 0) return null;
    const moduleId = id.slice(0, dot);
    const slug = id.slice(dot + 1);
    return isExtensionScope(moduleId) && SLUG.test(slug) ? { moduleId, slug } : null;
}

/** Whether `key` may be part of an extension's idempotency key. */
export const isKey = (key) => typeof key === "string" && KEY.test(key) && key.length <= 200;

/* -------------------------------------------- */
/*  The interfaces                               */
/* -------------------------------------------- */

/** The common fields: an id `<moduleId>.<slug>` and, where the interface has one, a label (an i18n key or text). */
function base(def, { label = true } = {}) {
    if (!def || typeof def !== "object") return refuse("not-object");
    const parts = splitId(def.id);
    if (!parts) return refuse("bad-id", "id");
    if (label && !isText(def.label)) return refuse("no-label", "label");
    return { ok: true, parts };
}

/** A DowntimeActivity's check (12.2): a statistic (a slug or a function of the actor), a DC, traits and roll options. */
function checkOf(check) {
    if (check === undefined || check === null) return { ok: true, value: null };
    if (typeof check !== "object") return refuse("bad-check", "check");
    if (!isText(check.statistic) && !isFn(check.statistic)) return refuse("bad-statistic", "check.statistic");
    const dc = check.dc;
    if (!(Number.isInteger(dc) || DC_KINDS.includes(dc) || isFn(dc))) return refuse("bad-dc", "check.dc");
    const strings = (list) => (Array.isArray(list) && list.every(isText) ? [...list] : null);
    const traits = check.traits === undefined ? [] : strings(check.traits);
    const rollOptions = check.rollOptions === undefined ? [] : strings(check.rollOptions);
    if (!traits) return refuse("bad-traits", "check.traits");
    if (!rollOptions) return refuse("bad-roll-options", "check.rollOptions");
    return { ok: true, value: { statistic: check.statistic, dc, traits, rollOptions } };
}

/** A DowntimeActivity's Aid (12.2): how many days the aide spends, the aide's statistic and DC, and the bonus on a success. */
function aidOf(aid) {
    if (aid === undefined || aid === null) return { ok: true, value: null };
    if (typeof aid !== "object") return refuse("bad-aid", "aid");
    if (!Number.isInteger(aid.days) || aid.days < 1) return refuse("bad-aid-days", "aid.days");
    if (!isText(aid.statistic)) return refuse("bad-aid-statistic", "aid.statistic");
    if (!Number.isInteger(aid.dc)) return refuse("bad-aid-dc", "aid.dc");
    if (!Number.isInteger(aid.bonus) || aid.bonus < 0) return refuse("bad-aid-bonus", "aid.bonus");
    return { ok: true, value: { days: aid.days, statistic: aid.statistic, dc: aid.dc, bonus: aid.bonus } };
}

/**
 * A DowntimeActivity checked and normalised (12.2): `days` a whole number of days from 1, `consecutive` whether a break
 * starts the block again, `eligible(actor)`, the `check`, the `aid`, the system's own action (`compendiumUuid`), and
 * `resolve(ctx)`, which returns the writes and the Workshop applies them.
 */
export function normaliseActivity(def) {
    const start = base(def);
    if (!start.ok) return start;
    if (!Number.isInteger(def.days) || def.days < 1 || def.days > 365) return refuse("bad-days", "days");
    if (def.eligible !== undefined && !isFn(def.eligible)) return refuse("bad-eligible", "eligible");
    if (!isFn(def.resolve)) return refuse("no-resolve", "resolve");
    if (def.icon !== undefined && !isText(def.icon)) return refuse("bad-icon", "icon");
    if (def.compendiumUuid !== undefined && !isText(def.compendiumUuid)) return refuse("bad-uuid", "compendiumUuid");
    const check = checkOf(def.check);
    if (!check.ok) return check;
    const aid = aidOf(def.aid);
    if (!aid.ok) return aid;
    return { ok: true, value: Object.freeze({
        kind: "downtimeActivity", id: def.id, moduleId: start.parts.moduleId, slug: start.parts.slug, label: def.label,
        icon: def.icon ?? null, days: def.days, consecutive: def.consecutive === true, eligible: def.eligible ?? null,
        check: check.value ? Object.freeze(check.value) : null, aid: aid.value ? Object.freeze(aid.value) : null,
        compendiumUuid: def.compendiumUuid ?? null, resolve: def.resolve,
    }) };
}

/** An IncomeSource checked and normalised (12.2). */
export function normaliseIncomeSource(def) {
    const start = base(def);
    if (!start.ok) return start;
    if (!CADENCES.includes(def.cadence)) return refuse("bad-cadence", "cadence");
    if (!DISTRIBUTIONS.includes(def.distribute)) return refuse("bad-distribute", "distribute");
    if (!isFn(def.compute)) return refuse("no-compute", "compute");
    return { ok: true, value: Object.freeze({
        kind: "incomeSource", id: def.id, moduleId: start.parts.moduleId, slug: start.parts.slug, label: def.label,
        cadence: def.cadence, distribute: def.distribute, compute: def.compute,
    }) };
}

/** A ConsumableSink checked and normalised (12.2): which items it takes (`accepts`) and what spending one gives (`spend`). */
export function normaliseSink(def) {
    const start = base(def);
    if (!start.ok) return start;
    if (!isFn(def.accepts)) return refuse("no-accepts", "accepts");
    if (!isFn(def.spend)) return refuse("no-spend", "spend");
    return { ok: true, value: Object.freeze({
        kind: "consumableSink", id: def.id, moduleId: start.parts.moduleId, slug: start.parts.slug, label: def.label,
        accepts: def.accepts, spend: def.spend,
    }) };
}

/** A CheckModifierSource checked and normalised (12.2): the pf2e selectors it answers and its `modifiers(ctx)`. */
export function normaliseModifierSource(def) {
    const start = base(def, { label: false });
    if (!start.ok) return start;
    if (!Array.isArray(def.selectors) || !def.selectors.length || !def.selectors.every(isText)) return refuse("bad-selectors", "selectors");
    if (!isFn(def.modifiers)) return refuse("no-modifiers", "modifiers");
    return { ok: true, value: Object.freeze({
        kind: "checkModifierSource", id: def.id, moduleId: start.parts.moduleId, slug: start.parts.slug, label: def.label ?? null,
        selectors: Object.freeze([...new Set(def.selectors)]), modifiers: def.modifiers,
    }) };
}

const NORMALISE = Object.freeze({
    downtimeActivity: normaliseActivity, incomeSource: normaliseIncomeSource, consumableSink: normaliseSink, checkModifierSource: normaliseModifierSource,
});

/* -------------------------------------------- */
/*  The registry                                 */
/* -------------------------------------------- */

/**
 * The registry (12.1). `isActive(moduleId)` says whether a module is an active package; `manifestApi(moduleId)` reads a
 * `requiresApi` declared in the extension's manifest (`flags["pf2e-artisans-workshop"].requiresApi`); `warn(problem)` hears
 * every refusal. `facade` is what the registration hook hands extensions.
 */
export function createRegistry({ apiVersion = API_VERSION, isActive = () => true, manifestApi = () => null, warn = () => {} } = {}) {
    let open = false;
    let closed = false;
    const entries = Object.fromEntries(KINDS.map((kind) => [kind, new Map()]));
    /** Per extension module: `{requiresApi, ignored}`. */
    const modules = new Map();
    const problems = [];
    const note = (problem) => {
        problems.push(problem);
        warn(problem);
        return { ok: false, ...problem };
    };

    /** Whether an extension's declared API major matches; the first declaration (or the manifest's) decides. */
    function declare(moduleId, requiresApi = null) {
        if (!isExtensionScope(moduleId)) return note({ reason: "bad-module", module: String(moduleId) });
        if (!isActive(moduleId)) return note({ reason: "inactive", module: moduleId });
        if (!modules.has(moduleId)) {
            const wants = requiresApi ?? manifestApi(moduleId) ?? null;
            const ignored = wants !== null && wants !== apiVersion;
            modules.set(moduleId, { requiresApi: wants, ignored });
            if (ignored) note({ reason: "api-mismatch", module: moduleId, wants, has: apiVersion });
        }
        return modules.get(moduleId).ignored ? { ok: false, reason: "ignored", module: moduleId } : { ok: true };
    }

    function add(kind, def) {
        if (closed) return note({ reason: "closed", kind, id: def?.id ?? null });
        if (!open) return note({ reason: "not-open", kind, id: def?.id ?? null });
        const result = NORMALISE[kind](def);
        if (!result.ok) return note({ reason: result.reason, field: result.field ?? null, kind, id: def?.id ?? null });
        const declared = declare(result.value.moduleId);
        if (!declared.ok) return declared;
        if (entries[kind].has(result.value.id)) return note({ reason: "duplicate", kind, id: result.value.id });
        entries[kind].set(result.value.id, result.value);
        return { ok: true, id: result.value.id };
    }

    const facade = Object.freeze({
        apiVersion,
        /** Declare an extension (`requiresApi`) and get registration methods for it; null when it is ignored or invalid. */
        extension(moduleId, { requiresApi = null } = {}) {
            const declared = declare(moduleId, requiresApi);
            if (!declared.ok) return null;
            const own = (kind) => (def) => (splitId(def?.id)?.moduleId === moduleId ? add(kind, def) : note({ reason: "foreign-id", kind, id: def?.id ?? null, module: moduleId }));
            return Object.freeze(Object.fromEntries(KINDS.map((kind) => [kind, own(kind)])));
        },
        downtimeActivity: (def) => add("downtimeActivity", def),
        incomeSource: (def) => add("incomeSource", def),
        consumableSink: (def) => add("consumableSink", def),
        checkModifierSource: (def) => add("checkModifierSource", def),
    });

    return {
        facade,
        /** Open the registry (the Workshop's `setup`). */
        open: () => { if (!closed) open = true; },
        /** Close it (`ready`): later calls are refused. */
        close: () => { open = false; closed = true; },
        get isOpen() { return open; },
        get isClosed() { return closed; },
        /** A registered object by kind and id, or null. Objects of an ignored extension are never registered. */
        get: (kind, id) => entries[kind]?.get(id) ?? null,
        /** Every registered object of a kind, in registration order. */
        list: (kind) => [...(entries[kind]?.values() ?? [])],
        /** The extension modules seen, `[{module, requiresApi, ignored}]`. */
        modules: () => [...modules.entries()].map(([module, m]) => ({ module, ...m })),
        /** Whether a module registered anything, or was declared and not ignored. */
        knows: (moduleId) => modules.has(moduleId) && !modules.get(moduleId).ignored,
        problems: () => [...problems],
    };
}

/* -------------------------------------------- */
/*  Check modifiers                              */
/* -------------------------------------------- */

const SAVES = Object.freeze(["fortitude", "reflex", "will"]);

/**
 * The pf2e selectors a roll of `statistic` answers (12.2 CheckModifierSource): the statistic's own slug, then the wider
 * ones pf2e uses for it. A skill or Lore: `<slug>`, `skill-check`, `check`, `all`; a save: `<slug>`, `saving-throw`,
 * `check`, `all`; Perception: `perception`, `check`, `all`.
 */
export function rollSelectors(statistic) {
    if (!isText(statistic)) return ["check", "all"];
    if (SAVES.includes(statistic)) return [statistic, "saving-throw", "check", "all"];
    if (statistic === "perception") return ["perception", "check", "all"];
    return [statistic, "skill-check", "check", "all"];
}

/** Whether a source answers any of a roll's selectors. */
export const answers = (source, selectors) => source.selectors.some((s) => selectors.includes(s));

/**
 * One modifier a source returned, checked: `{slug, label, modifier, type, predicate?}` with a slug, a label (an i18n key or
 * text), a whole-number modifier and one of pf2e's types (`untyped` when left out). Null when it is not one.
 */
export function modifierData(data, sourceId) {
    if (!data || typeof data !== "object") return null;
    if (!isText(data.slug) || !/^[a-z0-9][a-z0-9-]*$/.test(data.slug)) return null;
    if (!Number.isInteger(data.modifier) || data.modifier === 0) return null;
    const type = data.type ?? "untyped";
    if (!MODIFIER_TYPES.includes(type)) return null;
    if (data.predicate !== undefined && !Array.isArray(data.predicate)) return null;
    return { slug: data.slug, label: isText(data.label) ? data.label : data.slug, modifier: data.modifier, type,
        ...(data.predicate ? { predicate: [...data.predicate] } : {}), source: sourceId };
}

/** Every valid modifier in a list a source (or a sink's spend) returned, and how many were dropped. */
export function modifierList(list, sourceId) {
    if (!Array.isArray(list)) return { modifiers: [], dropped: list === undefined || list === null ? 0 : 1 };
    const modifiers = list.map((m) => modifierData(m, sourceId)).filter(Boolean);
    return { modifiers, dropped: list.length - modifiers.length };
}

/**
 * The modifier an Aid check gives (12.2 `aid`, the Aid action of Player Core p.416 with the activity's own bonus): `bonus`
 * on a success or a critical success, -1 on a critical failure, nothing on a failure. Circumstance, as Aid's is.
 */
export function aidModifier(degree, bonus, { slug = "aid", label = "aid" } = {}) {
    if (degree >= DEGREE.success) return bonus > 0 ? { slug, label, modifier: bonus, type: "circumstance" } : null;
    if (degree === DEGREE.critFail) return { slug, label, modifier: -1, type: "circumstance" };
    return null;
}

/* -------------------------------------------- */
/*  Activity runs, rows and income               */
/* -------------------------------------------- */

/** The ledger record version of an extension activity's run (`extRuns.<id>`). */
export const RUN_VERSION = 1;

/**
 * The id of one run of an extension activity (one block of days): a hash of the actor, the activity, the block's first day
 * and whom it aids (`self` for the activity itself), so every client names the same run.
 */
export function extRunId(actorId, activityId, fromDay, aidFor = null) {
    return hashId(idemKey("ext-run", actorId, activityId, fromDay, aidFor ?? "self"));
}

/** An extension activity as a select key and back: `ext:<activityId>` or, aiding a character, `ext:<activityId>:<actorId>`. */
export const extActivityKey = (activity) => (activity.aid ? `ext:${activity.ref}:${activity.aid}` : `ext:${activity.ref}`);

/**
 * The idempotency key of an extension row: `ext:<moduleId>:<slug>:<key>` (`source` is `<moduleId>:<slug>`), so an
 * extension's keys never meet the Workshop's, nor another extension's.
 */
export function extRowKey(source, key) {
    const [moduleId, slug, more] = typeof source === "string" ? source.split(":") : [];
    if (more !== undefined || !isExtensionScope(moduleId) || !SLUG.test(slug ?? "")) throw new TypeError(`bad extension row source ${source}`);
    if (!isKey(key)) throw new TypeError(`bad extension row key ${key}`);
    return idemKey("ext", moduleId, slug, key);
}

/**
 * A ledger row an extension posts (12.4, `api.funds.post`) checked and made `makeRow` input: `income` minted into the
 * strongbox's party fund (`via` "box", the default) or into a character's purse (`via` "purse" with `actor`), or an
 * `expense` out of the party fund. `source` is `<moduleId>:<slug>`; `key` makes it idempotent.
 * @returns {{ok: true, input: object} | {ok: false, reason: string}}
 */
export function extRowInput({ kind, cp, key, source, via = null, actor = null, note = null, day = null } = {}) {
    if (kind !== "income" && kind !== "expense") return refuse("bad-kind");
    try {
        requireCp(cp, "cp");
    } catch {
        return refuse("bad-amount");
    }
    if (cp === 0) return refuse("nothing");
    let idem;
    try {
        idem = extRowKey(source, key);
    } catch {
        return refuse(isKey(key) ? "bad-source" : "bad-key");
    }
    if (day !== null && !Number.isInteger(day)) return refuse("bad-day");
    if (note !== null && typeof note !== "string") return refuse("bad-note");
    if (kind === "expense") return { ok: true, input: { kind, idem, cp, actor: null, source, note, day } };
    const how = via ?? (actor ? "purse" : "box");
    if (how !== "box" && how !== "purse") return refuse("bad-via");
    if (how === "purse" && !isText(actor)) return refuse("no-actor");
    return { ok: true, input: { kind, idem, cp, how: { via: how }, actor: how === "purse" ? actor : null, source, note, day } };
}

/**
 * Split `cp` evenly among `recipients` (12.2 `distribute: "split"`), in whole copper: each gets the floor of its share and
 * the first ones in the given order one copper more until the remainder is gone (largest remainder with equal shares).
 */
export function splitEvenly(cp, recipients) {
    requireCp(cp, "cp");
    if (!recipients.length) return [];
    const share = Math.floor(cp / recipients.length);
    const extra = cp - share * recipients.length;
    return recipients.map((recipient, i) => ({ recipient, cp: share + (i < extra ? 1 : 0) }));
}

/**
 * The rows an income source's computed result posts (12.2): `strongbox` one `income` row into the party fund, `actor` one
 * into `actor`'s purse, `split` one per recipient. Keys follow `key`, with the recipient's UUID for a split.
 */
export function incomeRowInputs({ source, key, cp, distribute, actor = null, recipients = [], day = null, note = null }) {
    if (!(cp > 0)) return [];
    if (distribute === "strongbox") return [extRowInput({ kind: "income", cp, key, source, via: "box", day, note })];
    if (distribute === "actor") return [extRowInput({ kind: "income", cp, key, source, via: "purse", actor, day, note })];
    return splitEvenly(cp, recipients).filter((s) => s.cp > 0)
        .map((s) => extRowInput({ kind: "income", cp: s.cp, key: `${key}.${s.recipient.replace(/[^A-Za-z0-9_.-]/g, "-")}`, source, via: "purse",
            actor: s.recipient, day, note }));
}

/** A computed income result checked: `{cp, breakdown: [{label, cp}]}` with whole copper. Null when it is not one. */
export function incomeResult(result) {
    if (!result || typeof result !== "object" || !Number.isSafeInteger(result.cp) || result.cp < 0) return null;
    const breakdown = Array.isArray(result.breakdown) ? result.breakdown.filter((line) => line && isText(line.label) && Number.isSafeInteger(line.cp))
        .map((line) => ({ label: line.label, cp: line.cp })) : [];
    return { cp: result.cp, breakdown };
}

/**
 * The idempotency key of an income source's payment on a day (12.2 cadences): `perDay` once per character and day, `perWeek`
 * once per character and week of seven workshop days (on the week's last day). Null on a day the cadence does not pay.
 */
export function cadenceKey(cadence, actorId, day) {
    if (cadence === "perDay") return `day.${actorId}.${day}`;
    if (cadence === "perWeek") return day % 7 === 6 ? `week.${actorId}.${Math.floor(day / 7)}` : null;
    return null;
}

/** The workshop's party level (GM Core p.75, "party level"): the members' levels, averaged and rounded. Null with no member. */
export function partyLevelOf(levels) {
    const list = levels.filter(Number.isInteger);
    return list.length ? Math.round(list.reduce((sum, l) => sum + l, 0) / list.length) : null;
}

/* -------------------------------------------- */
/*  Activity results                             */
/* -------------------------------------------- */

/**
 * What an activity's `resolve(ctx)` returned (12.2 `ActivityResult`), checked: `ext` the extension-store writes (paths
 * relative to its own scope, each a valid path), `ledger` its rows (each an `extRowInput`, keyed `run.<runId>.<n>` when it
 * gives no key), `notes` lines to show (i18n keys or text). Invalid parts are dropped and counted.
 */
export function activityResult(result, { source, runId, day }) {
    const out = { ext: {}, rows: [], notes: [], dropped: 0 };
    if (!result || typeof result !== "object") return { ...out, dropped: result === undefined || result === null ? 0 : 1 };
    for (const [path, value] of Object.entries(result.ext ?? {})) {
        if (isScopePath(path) && value !== undefined) out.ext[path] = value;
        else out.dropped += 1;
    }
    (Array.isArray(result.ledger) ? result.ledger : []).forEach((row, i) => {
        const made = extRowInput({ ...row, source: row?.source ?? source, key: row?.key ?? `run.${runId}.${i}`, day: row?.day ?? day });
        if (made.ok && made.input.source === source) out.rows.push(made.input);
        else out.dropped += 1;
    });
    for (const note of Array.isArray(result.notes) ? result.notes : []) {
        if (isText(note)) out.notes.push(note);
        else out.dropped += 1;
    }
    return out;
}

/** A path inside an extension's own flag scope (12.4): dot-separated segments of letters, digits, `_` and `-`. */
export function isScopePath(path) {
    if (typeof path !== "string" || !path) return false;
    return path.split(".").every((s) => /^[A-Za-z0-9_-]+$/.test(s) && !["__proto__", "constructor", "prototype"].includes(s));
}
