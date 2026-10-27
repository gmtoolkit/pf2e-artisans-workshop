/**
 * The extension API on this client (DESIGN.md 12, M10): the registry other modules fill in the Workshop's `setup` hook,
 * each extension's store under its own flag scope on the ledger, the modifiers check-modifier sources add to the
 * Workshop's rolls, an extension activity's checks and runs, the rows extensions post, income sources and consumable
 * sinks. The rules are `scripts/logic/extensions.mjs`; the day planner's part is in `scripts/logic/downtime.mjs`.
 *
 * Who writes what (P2, P3, P5): an extension writes only through what the Workshop applies. An activity's `resolve(ctx)`
 * returns its writes, and the day resolver writes them in the same request as the day records, behind the PC's day lock,
 * so a day resolved twice writes them once; its rows are kept on the run's last day record and posted after it (a row the
 * write did not land is posted by the sweep, on the PC's responsible client). Rows are keyed by the extension (`ext:<module>
 * :<slug>:<key>`), so posting one twice posts it once. Income into a purse the user does not own becomes an `income` claim
 * that the owner's client applies, as a wage does. A spend decrements the item on its owner's client, behind a lock page
 * named by the spend's key, so a double click spends one item.
 */
import { MODULE_ID } from "../constants.mjs";
import { DEGREE } from "../logic/core.mjs";
import { levelDC } from "../logic/dc.mjs";
import {
    activityResult, aidModifier, answers, API_VERSION, cadenceKey, createRegistry, extRowInput, extRowKey, extRunId, incomeResult, incomeRowInputs,
    isExtensionScope, isKey, KINDS, modifierList, partyLevelOf, pathsOverlap, rollSelectors, RUN_VERSION,
} from "../logic/extensions.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { checkScopePath, readPath } from "../logic/keypath.mjs";
import { extLink } from "../logic/rolls.mjs";
import { planStrongboxCredit, planStrongboxDebit } from "../logic/coins.mjs";
import { fundSlotLockId, unallocatedCp } from "../logic/funds.mjs";
import { isDayRecord } from "../logic/downtime.mjs";
import { stackLockId } from "../logic/lock-first.mjs";
import { runRequest } from "./batch.mjs";
import { createClaims } from "./claims.mjs";
import { itemVersion } from "./coins.mjs";
import { expiredWhy, isInert } from "./expiry.mjs";
import { frozenCopy } from "./events.mjs";
import { freeStacks, lockedWrite, mint, moveCoins } from "./money.mjs";
import { mayUseFund } from "./purchases.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { members } from "./roster.mjs";
import { canWrite, shared } from "./state.mjs";
import { exists, newId, read, readScope, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const loc = (key) => game.i18n.localize(key);
const actorOf = (ref) => (typeof ref === "string" ? fromUuidSync(ref, { strict: false }) : ref ?? null);

/* -------------------------------------------- */
/*  The registry                                 */
/* -------------------------------------------- */

/** A `requiresApi` an extension declares in its manifest: `flags["pf2e-artisans-workshop"].requiresApi`. */
function manifestApi(moduleId) {
    const wants = game.modules.get(moduleId)?.flags?.[MODULE_ID]?.requiresApi;
    return Number.isInteger(wants) ? wants : null;
}

const newRegistry = () => createRegistry({
    apiVersion: API_VERSION,
    isActive: (id) => game.modules.get(id)?.active === true,
    manifestApi,
    warn: (problem) => console.warn(`${MODULE_ID} | extension registration refused: ${problem.reason}`, problem),
});

let registry = newRegistry();

/**
 * Open the registry and fire the registration hook (12.1), in the Workshop's `setup` hook: after every module's `init`, so
 * an extension subscribes there with `Hooks.once("pf2e-artisans-workshop.register", (registry) => ...)`.
 */
export function openRegistration() {
    registry.open();
    Hooks.callAll(`${MODULE_ID}.register`, registry.facade);
}

/**
 * Close the registry at `ready` (12.1): later calls are refused. A GM is told about every extension ignored for another API
 * major, once per session (12.1: "a GM-visible warning"); everyone else finds the reasons in the console.
 */
export function closeRegistration() {
    registry.close();
    if (!game.user?.isGM) return;
    for (const m of registry.modules().filter((x) => x.ignored)) {
        ui.notifications?.warn("pf2e-artisans-workshop.Ext.ApiMismatch", { format: {
            module: game.modules.get(m.module)?.title ?? m.module, wants: String(m.requiresApi), has: String(API_VERSION),
        } });
    }
}

/** For tests only: a fresh registry, open or not. */
export function resetExtensions({ open = false } = {}) {
    registry = newRegistry();
    if (open) registry.open();
    return registry.facade;
}

/** Every registered object of a kind (12.2), in registration order. */
export const registered = (kind) => registry.list(kind);
/** A registered object, or null. */
export const registeredOne = (kind, id) => registry.get(kind, id);
/** An extension's downtime activity, or null. */
export const activityOf = (id) => registry.get("downtimeActivity", id);
/** The modules that declared or registered, and whether each is ignored. */
export const extensionModules = () => registry.modules();
/** The registration problems seen, for the console and the tests. */
export const registrationProblems = () => registry.problems();
export { KINDS };

/* -------------------------------------------- */
/*  The extension store                          */
/* -------------------------------------------- */

const checkScope = (moduleId) => {
    if (!isExtensionScope(moduleId)) throw new TypeError(`"${moduleId}" is not an extension's module id`);
    return moduleId;
};

/** A read-only view of an extension's store, for the `ctx` of its callbacks. */
export function storeView(moduleId) {
    checkScope(moduleId);
    return Object.freeze({
        moduleId,
        get: (path) => {
            const value = readScope(moduleId, checkScopePath(path).join("."));
            return value === undefined ? undefined : structuredClone(value);
        },
    });
}

/**
 * An extension's store (12.4): its own flag scope on the Workshop ledger, which every player owns, read and written by key
 * path with the Workshop's rules (no whole rewrites, `_del` for deletions, refused unless this client may write). `get`
 * returns a copy. `write({set, replace, del})` writes several paths in one update. `exclusive(lockKey, change)` writes
 * only if no write with the same lock key landed before (a lock page): of two clients doing the same once-only step, one
 * lands and the other is refused as `taken`. Running totals should be derived from keyed records (5.3.1), not stored.
 */
export function extStore(moduleId) {
    const view = storeView(moduleId);
    const scoped = (change) => ({ scopes: { [moduleId]: change } });
    return Object.freeze({
        ...view,
        set: (path, value) => write(scoped({ set: { [path]: value } })),
        delete: (path) => write(scoped({ del: [path] })),
        write: ({ set = {}, replace = {}, del = [] } = {}) => write(scoped({ set, replace, del })),
        exclusive: (lockKey, { set = {}, replace = {}, del = [] } = {}) => {
            if (!isKey(lockKey)) return Promise.resolve(refuse("bad-key"));
            return lockedWrite([hashId(idemKey("ext-lock", moduleId, lockKey))], [], scoped({ set, replace, del }));
        },
    });
}

/** The party level (GM Core p.75): the Workshop members' levels, averaged and rounded; 1 with no member. */
export const partyLevel = () => partyLevelOf(members().map((a) => a.level)) ?? 1;

/** The pure rules extensions may use in their callbacks (`ctx.rules`, 12.2). */
const RULES = Object.freeze({ levelDC: (level) => levelDC(level, { pwol: game.pf2e?.settings?.variants?.pwol?.enabled === true }) });

/* -------------------------------------------- */
/*  Check modifiers                              */
/* -------------------------------------------- */

/**
 * The modifiers registered check-modifier sources add to a roll of `statistic` (12.2): each source whose selectors meet the
 * roll's (`rollSelectors`) is asked with `ctx` `{actor, statistic, selectors, kind, rollOptions, ...extra, store, rules}`;
 * what it returns is checked (`modifierList`), and a source that throws adds nothing. `kind` says which roll: `craft`,
 * `earn-income`, `help`, `season`, `service`, `activity`, `aid` or `extension` (an extension's own roll).
 * @returns {Promise<object[]>}  modifier data `{slug, label, modifier, type, predicate?, source}`
 */
export async function modifierData({ actor, statistic, kind, rollOptions = [], extra = {} }) {
    const selectors = rollSelectors(statistic);
    const out = [];
    for (const source of registry.list("checkModifierSource")) {
        if (!answers(source, selectors)) continue;
        try {
            const list = await source.modifiers(Object.freeze({ actor, statistic, selectors, kind, rollOptions: [...rollOptions], ...extra,
                store: storeView(source.moduleId), rules: RULES }));
            out.push(...modifierList(list, source.id).modifiers);
        } catch (error) {
            console.warn(`${MODULE_ID} | check modifier source ${source.id} failed`, error);
        }
    }
    return out;
}

/** Modifier data as pf2e modifiers, their labels localized (an extension's key, or its text). */
export function pf2eModifiers(data) {
    return data.map((m) => new game.pf2e.Modifier({ slug: m.slug, label: loc(m.label), modifier: m.modifier, type: m.type,
        ...(m.predicate ? { predicate: m.predicate } : {}) }));
}

/** The registered sources' modifiers for one of the Workshop's own rolls, as pf2e modifiers (none without a source). */
export async function extensionModifiers(args) {
    if (!registry.list("checkModifierSource").length) return [];
    return pf2eModifiers(await modifierData(args));
}

/* -------------------------------------------- */
/*  Downtime activities                          */
/* -------------------------------------------- */

/** An activity's `eligible(actor)`, safely: `{ok, reason}`. */
function eligibility(def, actor) {
    if (!def.eligible) return { ok: true };
    try {
        const answer = def.eligible(actor);
        return answer && typeof answer === "object" ? { ok: answer.ok !== false, reason: answer.reason ?? null } : { ok: answer !== false };
    } catch (error) {
        console.warn(`${MODULE_ID} | ${def.id} eligible() failed`, error);
        return { ok: false, reason: null };
    }
}

/** What the day planner needs about the registered activities and the recorded runs (`planDays`'s `ext`), for one PC. */
export function planFacts(actor) {
    const activities = {};
    for (const def of registry.list("downtimeActivity")) {
        activities[def.id] = { days: def.days, consecutive: def.consecutive, hasCheck: !!def.check, aid: def.aid ? { days: def.aid.days } : null,
            eligible: eligibility(def, actor) };
    }
    const runs = Object.fromEntries(records("extRuns").map((run) => [run.id, run]));
    return { activities, runs };
}

/** The activities a PC may choose (the Downtime tab, the wizard): every registered one, with whether it may start now. */
export function activityChoices(actor) {
    return registry.list("downtimeActivity").map((def) => ({ def, eligible: eligibility(def, actor) }));
}

/** An activity's DC for an actor (12.2 `check.dc`): a number, the party's or the actor's level-based DC, or its function's. */
function dcOf(def, actor, ctx) {
    const dc = def.check.dc;
    if (Number.isInteger(dc)) return dc;
    if (dc === "partyLevel") return RULES.levelDC(partyLevel());
    if (dc === "actorLevel") return RULES.levelDC(actor.level ?? 0);
    const value = dc(ctx);
    return Number.isInteger(value) ? value : null;
}

/** A statistic of an actor by slug: pf2e's `getStatistic` (skills, Lores, saves, Perception), or its skills. */
const statisticOf = (actor, slug) => actor?.getStatistic?.(slug) ?? actor?.skills?.[slug] ?? null;

/** Whether the last day of a run is written (the run's result is in). */
const runResolved = (runId) => records("days").some((d) => isDayRecord(d) && d.ext?.run === runId && d.ext.n === d.ext.of);

/**
 * The Aid runs that would add to a PC's check of an activity: runs of other PCs aiding this PC in it, their check recorded,
 * not used by another check yet.
 */
export function openAids(actor, activityId) {
    return records("extRuns").filter((run) => run.aidFor === actor.id && run.activity === activityId && run.check && !run.usedBy);
}

/**
 * Roll an extension activity's check for a run (12.2 `check`), or an Aid's (`aid`: the id of the PC aided): the activity's
 * statistic against its DC (the Aid's statistic and DC), with the registered sources' modifiers and, for the activity's
 * own check, every open Aid's. The run's record (`extRuns.<id>`) is written first and the check is recorded on it when its
 * message is created (`recordExtCheck`). Refused: `not-ready`, `ext-unknown`, `no-actor`, `not-owner`, `no-check`,
 * `no-skill`, `no-dc`, `resolved` (the run's last day is written), `cancelled`.
 * @param {{actor, activity: string, from: number, aid?: string|null, skipDialog?: boolean}} p
 */
export async function rollActivity({ actor: actorRef, activity, from, aid = null, skipDialog } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const def = activityOf(activity);
    if (!def || (aid && !def.aid)) return refuse("ext-unknown");
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    if (!aid && !def.check) return refuse("ext-no-check");
    if (!Number.isInteger(from)) return refuse("no-days");
    const runId = extRunId(actor.id, def.id, from, aid);
    if (runResolved(runId)) return refuse("resolved");
    const ctx = Object.freeze({ actor, activity: def, from, partyLevel: partyLevel(), store: storeView(def.moduleId), rules: RULES });
    const slug = aid ? def.aid.statistic : typeof def.check.statistic === "function" ? def.check.statistic(actor) : def.check.statistic;
    const statistic = statisticOf(actor, slug);
    if (!statistic) return refuse("no-skill", { skill: slug });
    const dc = aid ? def.aid.dc : dcOf(def, actor, ctx);
    if (!Number.isInteger(dc)) return refuse("no-dc");
    const aids = aid ? [] : openAids(actor, def.id);
    const aidData = aids.map((run) => aidModifier(run.check.degree, def.aid.bonus, { slug: `aid-${run.actorId}`.toLowerCase(), label: "pf2e-artisans-workshop.Ext.AidModifier" }))
        .filter(Boolean).map((m) => ({ ...m, source: MODULE_ID }));
    const rollOptions = [...(aid ? [] : def.check.rollOptions), `${MODULE_ID}:activity:${def.id}`];
    const data = [...aidData, ...await modifierData({ actor, statistic: slug, kind: aid ? "aid" : "activity", rollOptions, extra: { activity: def.id, from } })];
    const stamp = stampNow();
    const stored = read(`extRuns.${runId}`);
    const base = `extRuns.${runId}`;
    await write(stored
        ? { set: { [`${base}.dc`]: dc, [`${base}.aids`]: aids.map((r) => r.id), [`${base}.by`]: stamp.by, [`${base}.at`]: stamp.at } }
        : { replace: { [base]: { id: runId, v: RUN_VERSION, actor: actor.uuid, actorId: actor.id, activity: def.id, aidFor: aid, from, dc,
            aids: aids.map((r) => r.id), check: null, ...stamp } } });
    const roll = await statistic.roll({
        dc: { value: dc, label: game.i18n.format("pf2e-artisans-workshop.Ext.RollDC", { activity: loc(def.label) }) },
        extraRollOptions: [extLink(runId), ...rollOptions],
        modifiers: pf2eModifiers(data),
        traits: ["downtime", ...(aid ? [] : def.check.traits)],
        label: game.i18n.format(aid ? "pf2e-artisans-workshop.Ext.RollAid" : "pf2e-artisans-workshop.Ext.Roll", { activity: loc(def.label) }),
        skipDialog,
        createMessage: true,
    });
    return roll ? { ok: true, total: roll.total, run: runId } : refuse("cancelled");
}

/**
 * Record a run's check from its message (12.2; `onCheckMessage` in `rolls.mjs`, on the message author's tab): the degree,
 * the roller's level and rank, the DC. A reroll replaces it until the run's last day is written; a reroll after that is kept
 * as `conflict` and changes nothing; a second roll that is no reroll is kept nowhere. The Aid runs the roll counted are
 * marked used by it, so one Aid helps one check.
 */
export async function recordExtCheck({ id }, check, actor) {
    const run = read(`extRuns.${id}`);
    if (!run) return refuse("no-run");
    if (runResolved(id)) {
        await write({ replace: { [`extRuns.${id}.conflict`]: { ...check, ...stampNow() } } });
        return refuse("resolved");
    }
    if (run.check && !check.rerolled) {
        ui.notifications.warn("pf2e-artisans-workshop.Roll.AlreadyRolled", { localize: true });
        return refuse("rolled");
    }
    const roller = actor ?? actorOf(run.actor);
    const def = activityOf(run.activity);
    const slug = run.aidFor ? def?.aid?.statistic : typeof def?.check?.statistic === "string" ? def.check.statistic : null;
    const full = { ...check, dc: run.dc ?? null, level: roller?.level ?? null, rank: slug ? statisticOf(roller, slug)?.rank ?? null : null };
    const used = Object.fromEntries((run.aids ?? []).filter((aidRun) => read(`extRuns.${aidRun}`)).map((aidRun) => [`extRuns.${aidRun}.usedBy`, id]));
    await write({ replace: { [`extRuns.${id}.check`]: full }, set: used });
    return { ok: true, check: full };
}

/** An activity's `resolve(ctx)` safely, its result checked (`activityResult`). */
async function resolveRun(def, ctx, { source, runId, day }) {
    try {
        return activityResult(await def.resolve(ctx), { source, runId, day });
    } catch (error) {
        console.warn(`${MODULE_ID} | ${def.id} resolve() failed`, error);
        return activityResult(null, { source, runId, day });
    }
}

/**
 * What the runs a plan finishes write (`plan.ext`, 12.2): each activity's `resolve(ctx)` with `ctx` `{actor, activity, run,
 * check, degree, from, to, day, aids, partyLevel, store, rules}`; its store writes go into `scopes` (written with the day
 * records), its rows and notes onto the run's last record (`extRows`, `extNotes`), which the plan's records are changed to
 * carry. An Aid's last day resolves nothing: its check is the result. Then the income sources paid per day or per week
 * (`cadenceRows`).
 * @returns {Promise<{scopes: object, rows: object[]}>}
 */
export async function resolvePlan(actor, plan) {
    const scopes = {};
    const rows = [];
    const recordOf = (id) => plan.records.find((r) => r.id === id);
    for (const block of plan.ext ?? []) {
        if (block.aid) continue;
        const def = activityOf(block.activity);
        const record = recordOf(block.record);
        if (!def || !record) continue;
        const run = read(`extRuns.${block.run}`) ?? null;
        const aids = (run?.aids ?? []).map((id) => read(`extRuns.${id}`)).filter(Boolean);
        const ctx = Object.freeze({
            actor, actorId: actor.id, activity: def, run: run ? frozenCopy(run) : null, check: run?.check ? frozenCopy(run.check) : null,
            degree: run?.check?.degree ?? null, from: block.from, to: block.to, day: block.to, aids: frozenCopy(aids), partyLevel: partyLevel(),
            store: storeView(def.moduleId), rules: RULES,
        });
        const result = await resolveRun(def, ctx, { source: `${def.moduleId}:${def.slug}`, runId: block.run, day: block.to });
        if (Object.keys(result.ext).length) {
            const into = (scopes[def.moduleId] ??= { set: {} }).set;
            for (const [path, value] of Object.entries(result.ext)) {
                // A later run writing the same path wins, as its day is later; one writing inside (or around) an earlier run's
                // path would make the day's whole write fail, so it is dropped (M10 review).
                if (Object.keys(into).some((other) => other !== path && pathsOverlap(path, other))) {
                    console.warn(`${MODULE_ID} | ${def.id} resolve() wrote "${path}", which overlaps a path an earlier run of these days wrote; dropped`);
                } else into[path] = value;
            }
        }
        if (result.rows.length) record.extRows = [...(record.extRows ?? []), ...result.rows];
        if (result.notes.length) record.extNotes = result.notes;
        rows.push(...result.rows);
    }
    rows.push(...await cadenceRows(actor, plan.records));
    return { scopes, rows };
}

/* -------------------------------------------- */
/*  Rows, income and expenses                    */
/* -------------------------------------------- */

/** Whether a module may post rows: it registered something, or declared itself, and is not ignored. */
const mayPost = (source) => {
    const moduleId = typeof source === "string" ? source.split(":")[0] : null;
    return !!moduleId && registry.knows(moduleId);
};

/**
 * Post one extension row (`extRowInput` already made): income minted into the strongbox, or into a purse (minted when this
 * user owns it, an `income` claim for its owner's client otherwise), or an expense out of the party fund behind the fund
 * slot. A row already written is `already`. Refused: `not-ready`, `no-actor`, `not-owner`, `fund-short` (with `maxCp`),
 * `strongbox-short`, and the coin move's.
 */
export async function postRow(input) {
    if (!canWrite()) return refuse("not-ready");
    if (exists(`rows.${hashId(input.idem)}`)) return { ok: true, outcome: "already" };
    if (input.kind === "expense") return payExpense(input);
    if (input.how?.via === "box") {
        return moveCoins(() => ({ rows: [input], credits: [{ target: "strongbox", plan: planStrongboxCredit(input.cp) }] }), {}, [input]);
    }
    const actor = actorOf(input.actor);
    if (!actor) return refuse("no-actor");
    if (actor.isOwner) return mint({ actor, row: input });
    const created = await createClaims([{ kind: "income", idem: input.idem, actor: input.actor, cp: input.cp, day: input.day ?? null, source: input.source,
        note: input.note ?? null, parties: [] }]);
    return { ok: true, outcome: created.length ? "claimed" : "already" };
}

/** An expense out of the unallocated party fund (4.6 `expense`): the strongbox's coins out, the fund slot taken. */
function payExpense(input) {
    if (!mayUseFund()) return Promise.resolve(refuse("not-owner"));
    const available = () => Math.max(0, unallocatedCp(records("rows")));
    if (input.cp > available()) return Promise.resolve(refuse("fund-short", { maxCp: available() }));
    return moveCoins((strongbox) => {
        const rows = records("rows");
        if (input.cp > unallocatedCp(rows)) return { refuse: "fund-short" };
        const box = planStrongboxDebit(freeStacks(strongbox), input.cp);
        if (!box) return { refuse: "strongbox-short" };
        return { rows: [input], debits: [{ target: "strongbox", plan: box }], locks: [fundSlotLockId(rows)] };
    }, {}, [input]).then((result) => (result.reason === "fund-short" ? { ...result, data: { maxCp: available() } } : result));
}

/**
 * `api.funds.post(row)` (12.4): an extension posts a row of its own, `{kind: "income"|"expense", cp | amount, key, source:
 * "<moduleId>:<slug>", via?, actor?, note?, day?}`. Refused besides `postRow`'s: `unknown-extension` (the module registered
 * nothing, or is ignored), and the row's own (`bad-kind`, `bad-amount`, `nothing`, `bad-key`, `bad-source`, `bad-via`, ...).
 */
export async function postExtRow(row = {}) {
    if (!mayPost(row?.source)) return refuse("unknown-extension");
    const actor = row.actor ? actorOf(row.actor)?.uuid ?? row.actor : null;
    const made = extRowInput({ ...row, actor, cp: row.cp ?? row.amount });
    if (!made.ok) return refuse(made.reason);
    return postRow(made.input);
}

/**
 * An extension's row by its key (`api.funds.posted({source, key})`, M10 review): `{id, kind, cp, state, reversed}`, or null
 * when no row with that key was written. `reversed` says whether a member reversed it in the Funds tab (a reversal row
 * names it, or it is marked `reversedBy`): an extension that sells something for an `expense` treats it as bought only while
 * its row stands, and buys it again under a new key.
 */
export function postedRow({ source, key } = {}) {
    let idem;
    try {
        idem = extRowKey(source, key);
    } catch {
        return null;
    }
    const row = read(`rows.${hashId(idem)}`);
    if (!row) return null;
    const reversed = !!row.reversedBy || records("rows").some((r) => r.kind === "reversal" && r.reverses === row.id);
    return { id: row.id, kind: row.kind, cp: row.cp, state: row.state ?? null, reversed };
}

/** An income source's `compute(ctx)` safely: its checked result, or null. */
async function computeIncome(source, ctx) {
    try {
        return incomeResult(await source.compute(ctx));
    } catch (error) {
        console.warn(`${MODULE_ID} | ${source.id} compute() failed`, error);
        return null;
    }
}

/**
 * The `incomeComputed` hook (12.3), once per computed payment, before it is posted: `{source, actor, day, key, result: {cp,
 * breakdown}}`, frozen but for `result`, which listeners may change (house rules); what they leave there is posted.
 */
function announceIncome(source, actor, day, key, result) {
    const payload = Object.freeze({ source: source.id, actor: actor?.uuid ?? null, day, key, result: { cp: result.cp, breakdown: [...result.breakdown] } });
    Hooks.callAll(`${MODULE_ID}.incomeComputed`, payload);
    return incomeResult(payload.result) ?? result;
}

/** The income payment record version (`incomes.<id>`). */
const INCOME_VERSION = 1;

/** The id of an income source's payment with `key` (`incomes.<id>`, and the lock page that writes it once). */
const incomeId = (sourceId, key) => hashId(idemKey("income", sourceId, key));

/** A recorded payment's rows posted again (each is idempotent): what a second call with its key does. */
async function repostIncome(recorded) {
    const results = [];
    for (const input of recorded.rows ?? []) results.push(await postRow(input));
    return { ok: results.every((r) => r.ok), outcome: "already", cp: recorded.cp, breakdown: recorded.breakdown ?? [], results };
}

/**
 * Pay an income source once (12.2, `api.ext.income`): `compute(ctx)` with `ctx` `{source, actor, day, key, data, party,
 * partyLevel, store, rules}`, the `incomeComputed` hook, then its rows by `distribute`: into the party fund, `actor`'s purse,
 * or split evenly among `recipients` (UUIDs; the Workshop's members by default). `key` makes the payment idempotent: the
 * payment is recorded once (`incomes.<id> = {id, v, source, key, cp, breakdown, distribute, rows, by, at}`, behind a lock
 * page named by the source and the key) before its rows are posted, and paying the same key again computes nothing and
 * posts exactly the recorded rows (each once), whatever the members or `recipients` are now (`outcome` "already"); of two
 * clients paying it at once, the one whose record lands pays. Refused: `no-income-source`, `bad-key`, `no-actor` (an
 * `actor` source without one), `bad-result`, the record's write (`error`, ...), and each row's.
 * @returns {Promise<{ok: boolean, outcome?: "ok"|"already", cp?: number, breakdown?: object[], results?: object[]}>}
 */
export async function postIncome(sourceId, { key, actor: actorRef = null, day = null, data = {}, recipients = null, note = null } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const source = registry.get("incomeSource", sourceId);
    if (!source) return refuse("no-income-source");
    if (!isKey(key)) return refuse("bad-key");
    const id = incomeId(sourceId, key);
    const recorded = read(`incomes.${id}`);
    if (recorded) return repostIncome(recorded);
    const actor = actorOf(actorRef);
    if (source.distribute === "actor" && !actor) return refuse("no-actor");
    const party = members();
    const computed = await computeIncome(source, Object.freeze({ source, actor, day, key, data: frozenCopy(data ?? {}), party, partyLevel: partyLevel(),
        store: storeView(source.moduleId), rules: RULES }));
    if (!computed) return refuse("bad-result");
    const result = announceIncome(source, actor, day, key, computed);
    const inputs = incomeRowInputs({ source: `${source.moduleId}:${source.slug}`, key, cp: result.cp, distribute: source.distribute, actor: actor?.uuid ?? null,
        recipients: recipients ?? party.map((a) => a.uuid), day, note });
    const bad = inputs.find((made) => !made.ok);
    if (bad) return refuse(bad.reason);
    const record = { id, v: INCOME_VERSION, source: sourceId, key, cp: result.cp, breakdown: result.breakdown, distribute: source.distribute,
        rows: inputs.map((made) => made.input), ...stampNow() };
    const landed = await lockedWrite([id], [], { set: { [`incomes.${id}`]: record } });
    if (!landed.ok) {
        // Another client recorded this payment first: its rows are the payment.
        const other = landed.reason === "taken" ? read(`incomes.${id}`) : null;
        return other ? repostIncome(other) : refuse(landed.reason ?? "error", { outcome: landed.outcome });
    }
    const results = [];
    for (const input of record.rows) results.push(await postRow(input));
    return { ok: results.every((r) => r.ok), outcome: "ok", cp: result.cp, breakdown: result.breakdown, results };
}

/**
 * Whether an income source's payment with `key` is made (`api.ext.incomePaid`): recorded, and each of its rows is in the
 * ledger or waiting as a claim for its purse's owner. False for a payment never made, and for one whose rows did not all post
 * (paying the key again posts them).
 */
export function incomePaid(sourceId, key) {
    if (!isKey(key)) return false;
    const recorded = read(`incomes.${incomeId(sourceId, key)}`);
    if (!recorded) return false;
    return (recorded.rows ?? []).every((input) => exists(`rows.${hashId(input.idem)}`) || exists(`claims.${hashId(input.idem)}`));
}

/**
 * The rows the per-day and per-week income sources owe for a PC's day records (12.2 cadences): each record of a day spent in
 * downtime asks every `perDay` source, and each record on the last day of a seven-day week every `perWeek` source, with `ctx`
 * `{source, actor, day, record, ...}`. A payment's rows are kept on its record (`extRows`) as the resolver writes it.
 */
async function cadenceRows(actor, dayRecords) {
    const sources = registry.list("incomeSource").filter((s) => s.cadence !== "perEvent");
    if (!sources.length) return [];
    const rows = [];
    const party = members();
    for (const record of dayRecords) {
        if (!record.activity) continue;
        for (const source of sources) {
            const key = cadenceKey(source.cadence, actor.id, record.day);
            if (!key) continue;
            const computed = await computeIncome(source, Object.freeze({ source, actor, day: record.day, key, record: frozenCopy(record), data: {}, party,
                partyLevel: partyLevel(), store: storeView(source.moduleId), rules: RULES }));
            if (!computed) continue;
            const result = announceIncome(source, actor, record.day, key, computed);
            const inputs = incomeRowInputs({ source: `${source.moduleId}:${source.slug}`, key, cp: result.cp, distribute: source.distribute, actor: actor.uuid,
                recipients: party.map((a) => a.uuid), day: record.day }).filter((made) => made.ok).map((made) => made.input);
            if (inputs.length) record.extRows = [...(record.extRows ?? []), ...inputs];
            rows.push(...inputs);
        }
    }
    return rows;
}

/**
 * Post what day records owe (P5, a sweep step): the rows on records (`extRows`, an activity's result or a per-day income)
 * that are not in the ledger, on the PC's responsible client only.
 * @returns {Promise<number>}  rows posted
 */
export async function sweepExtRows() {
    if (!canWrite()) return 0;
    let posted = 0;
    for (const record of records("days")) {
        if (!Array.isArray(record.extRows) || !record.extRows.length) continue;
        const actor = game.actors.get(record.actor);
        if (!actor || !isResponsibleFor(actor)) continue;
        for (const input of record.extRows) {
            if (exists(`rows.${hashId(input.idem)}`)) continue;
            const result = await postRow(input);
            if (result.ok && result.outcome !== "already") posted += 1;
        }
    }
    return posted;
}

/* -------------------------------------------- */
/*  Consumable sinks                             */
/* -------------------------------------------- */

/** A sink's `accepts(item)` safely. */
function accepts(sink, item) {
    try {
        return sink.accepts(item) === true;
    } catch (error) {
        console.warn(`${MODULE_ID} | ${sink.id} accepts() failed`, error);
        return false;
    }
}

/** Whether an item may be spent now: held, not inert, not expired (the Morning's and the Bandolier's expiry, 7.7, 8.8). */
const spendable = (item) => (item?.quantity ?? 1) > 0 && !isInert(item) && !expiredWhy(item);

/** The registered sinks that take an item (the Bandolier's "Spend on"). */
export const sinksFor = (item) => (spendable(item) ? registry.list("consumableSink").filter((sink) => accepts(sink, item)) : []);

/** The items of an actor a sink takes now, not inert or expired. */
export function sinkItems(sinkId, actor) {
    const sink = registry.get("consumableSink", sinkId);
    if (!sink || !actor) return [];
    return [...(actor.items ?? [])].filter((item) => spendable(item) && accepts(sink, item));
}

/** The spend version (`spends.<id>`). */
const SPEND_VERSION = 1;

/**
 * Spend an item through a consumable sink (12.2): the sink's `spend(ctx)` says what it gives (`{modifiers, notes}`), and the
 * Workshop takes one of the item off its holder and logs it (`spends.<id>`), behind a lock page named by the spend, so the
 * same `key` spends one item however often it is sent. `ctx` is `{actor, item, sink, key, data, store, rules}`. The
 * `consumableSpent` hook then fires on this client with the log record. The stack is locked at the version its quantity was
 * read from, so two spends with different keys planned from the same copy take two items or the second is refused. A spend
 * with the same key that landed first answers `already`. Refused: `not-ready`, `no-sink`, `no-actor`, `not-owner`, `no-item`,
 * `inert` (inert or expired), `not-accepted`, `bad-key`, `sink-error`, `conflict` (the stack changed meanwhile: try again).
 * @returns {Promise<{ok: boolean, outcome?: "ok"|"already", modifiers?: object[], notes?: string[], record?: object}>}
 */
export async function spendItem(sinkId, { actor: actorRef = null, item: itemRef = null, key = null, data = {}, source = "api" } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const sink = registry.get("consumableSink", sinkId);
    if (!sink) return refuse("no-sink");
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    const item = typeof itemRef === "string" ? actor.items.get(itemRef) ?? actor.items.find((i) => i.uuid === itemRef) : itemRef;
    if (!item || item.parent !== actor) return refuse("no-item");
    const spendKey = key ?? newId();
    if (!isKey(spendKey)) return refuse("bad-key");
    const id = hashId(idemKey("spend", sinkId, spendKey));
    const logged = read(`spends.${id}`);
    if (logged) return { ok: true, outcome: "already", modifiers: logged.modifiers ?? [], notes: logged.notes ?? [], record: logged };
    if (!spendable(item)) return refuse("inert", { item: item.name });
    if (!accepts(sink, item)) return refuse("not-accepted", { item: item.name });
    let given;
    try {
        given = await sink.spend(Object.freeze({ actor, item, sink, key: spendKey, data: frozenCopy(data ?? {}), store: storeView(sink.moduleId), rules: RULES }));
    } catch (error) {
        console.warn(`${MODULE_ID} | ${sink.id} spend() failed`, error);
        return refuse("sink-error");
    }
    const { modifiers } = modifierList(given?.modifiers ?? [], sink.id);
    const notes = (Array.isArray(given?.notes) ? given.notes : []).filter((n) => typeof n === "string" && n.trim());
    const record = { id, v: SPEND_VERSION, sink: sinkId, key: spendKey, actor: actor.uuid, item: { id: item.id, uuid: item.uuid, name: item.name,
        img: item.img ?? null, sourceId: item._stats?.compendiumSource ?? item.sourceId ?? null }, modifiers, notes, source, ...stampNow() };
    const quantity = item.quantity ?? 1;
    const take = quantity > 1 ? { op: "updateItems", target: actor.uuid, updates: [{ _id: item.id, "system.quantity": quantity - 1 }] }
        : { op: "deleteItems", target: actor.uuid, ids: [item.id] };
    // The spend's own page (a key sent twice spends once) and the stack's at the version this quantity was read from, as the
    // Workshop's own item moves lock it: of two spends planned from the same copy of the stack, the second is refused rather
    // than writing the same decrement again (M10 review).
    const locks = [id, stackLockId(item.id, itemVersion(item))];
    const result = await runRequest([{ op: "lock", ids: locks }, take, { op: "ledger", change: { set: { [`spends.${id}`]: record } } }]);
    if (result.outcome === "refused") {
        const landed = read(`spends.${id}`);
        if (landed) return { ok: true, outcome: "already", modifiers: landed.modifiers ?? [], notes: landed.notes ?? [], record: landed };
        return refuse("conflict", { item: item.name });
    }
    if (result.outcome !== "ok") return refuse(result.reason ?? "error", { outcome: result.outcome });
    Hooks.callAll(`${MODULE_ID}.consumableSpent`, frozenCopy({ sink: sinkId, actor: actor.uuid, item: record.item, key: spendKey, modifiers, notes, record }));
    return { ok: true, outcome: "ok", modifiers, notes, record };
}

/** Every spend logged, newest first, optionally of one sink or actor. */
export function spends({ sink = null, actor = null } = {}) {
    return records("spends").filter((s) => (!sink || s.sink === sink) && (!actor || s.actor === actor)).sort((a, b) => (b.at?.world ?? 0) - (a.at?.world ?? 0));
}

/** For a modifier list (a spend's, an Aid's): the total a roll gets, for display. */
export const modifierTotal = (list) => (list ?? []).reduce((sum, m) => sum + (m.modifier ?? 0), 0);

/** Whether a degree is a success, for callers that read a run's check. */
export const isSuccess = (degree) => degree >= DEGREE.success;

/** A copy of a run's record, or null. */
export const runOf = (id) => {
    const run = read(`extRuns.${id}`);
    return run ? structuredClone(run) : null;
};

/** Paths of an extension's store, for its window (the same as `extStore(moduleId).get`). */
export const readStore = (moduleId, path) => readPath(shared().ledger?.flags?.[checkScope(moduleId)] ?? {}, checkScopePath(path).join("."));
