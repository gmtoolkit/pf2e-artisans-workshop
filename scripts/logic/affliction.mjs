/**
 * The affliction tracker's rules engine (DESIGN.md 8.10, M8a). Pure: definitions, one step of an affliction for a degree
 * of success, the time function and the due events, the DC order and the DC stamp, coatings, Double Poison, the grant
 * flags of stage conditions, the recording of saves and rerolls, and the tracker item's source. `scripts/foundry/
 * afflictions.mjs` reads the documents and writes them; `scripts/logic/affliction-parse.mjs` reads the stages from a
 * description.
 *
 * The rules (Player Core pp.430-431; GM Core p.248), paraphrased: an initial save (success: unaffected; failure: stage 1;
 * critical failure: stage 2), an onset before the first stage's effects, a maximum duration that starts when the first
 * stage takes effect (an interpretation the data supports: some onsets are longer than the maximum, OQ-39), a save at the
 * end of each stage's interval (success -1, critical success -2, failure +1, critical failure +2; below stage 1 it ends;
 * past the highest stage the highest repeats), virulent (two successes in a row for -1, a critical success -1), and a
 * poison's further exposure (a failed save adds 1 stage, 2 on a critical failure, without changing the maximum duration,
 * even during the onset).
 *
 * The run state lives on the tracker item (`flags.MOD.affliction.run`):
 *
 *   {v, id, source: {uuid, name, level, traits, img?}, defKey, dc: {value, type, source, creator?},
 *    phase: "onset" | "active" | "ended", stage, streak, onsetEndsAt, maxEndsAt, nextDueAt, anchor, interval: {seconds,
 *    formula?}, exposures: {[claimId]: {at, degree}}, saves: {[seq]: {kind, dueAt, degree, fromStage, toStage, messageId,
 *    before, rolls}}, seq, pending: {seq, kind, dueAt} | null, mods, by, at, endedAt?, endReason?}
 *
 * Times are world seconds; null means "never" (no maximum duration, no further save).
 */
import { DEGREE } from "./core.mjs";
import { UNIT_SECONDS, durationSeconds } from "./affliction-parse.mjs";

export const RUN_VERSION = 1;

/** Conditions pf2e's affliction leaves in place when it ends or changes stage (`EXPIRING_CONDITIONS`, verified). */
export const EXPIRING_CONDITIONS = Object.freeze(["frightened", "sickened", "drained", "doomed", "stunned", "unconscious"]);

/** The run fields a save changes, kept in `saves.<seq>.before` so a reroll can restore them (8.10.8). */
const BEFORE_FIELDS = Object.freeze(["phase", "stage", "streak", "interval", "nextDueAt", "onsetEndsAt", "maxEndsAt", "anchor", "endedAt", "endReason"]);

/** One round of world time, in seconds (pf2e's round time, `init.ts`). */
export const ROUND = 6;

/* -------------------------------------------- */
/*  Definitions                                  */
/* -------------------------------------------- */

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * A parsed definition with an override merged in (8.10.2, `scripts/data/afflictions.mjs`): save, onset and maximum duration
 * replaced; stage parts replaced; prose stages kept for the table; kinds added; the item's own rules (`reExposure`,
 * `keepsCoating`).
 */
export function applyOverride(def, override) {
    if (!override) return def;
    const out = clone(def);
    if (override.save) {
        out.save = { ...out.save, ...clone(override.save) };
        if (Number.isInteger(override.save.value)) out.dcFixed = override.save.value;   // the printed DC is wrong or missing (8.10.4 rung 1)
    }
    if ("onset" in override) out.onset = clone(override.onset);
    if (override.duration) out.duration = { ...clone(override.duration), expiry: null };
    for (const [n, part] of Object.entries(override.stages ?? {})) {
        const index = Number(n) - 1;
        while (out.stages.length <= index) out.stages.push({ damage: [], conditions: [], effects: [], duration: null, unparsed: true });
        out.stages[index] = { ...out.stages[index], ...clone(part) };
        if (out.stages[index].duration && !(override.prose ?? []).includes(Number(n))) delete out.stages[index].unparsed;
    }
    out.prose = [...new Set([...(out.prose ?? []), ...(override.prose ?? [])])];
    for (const n of out.prose) if (out.stages[n - 1]) out.stages[n - 1].unparsed = true;
    if (override.traits) out.traits = [...new Set([...out.traits, ...override.traits])];
    if (override.reExposure) out.reExposure = override.reExposure;
    if (override.keepsCoating) out.keepsCoating = true;
    // Rules an intro sets for a stage condition (8.10.2): `cumulative` values add up with each failed save and never go down
    // while it lasts (King's Sleep's drained); `detach` conditions outlast their stage and the affliction (Nethershade's
    // enfeebled); `intro: "table"` marks an intro whose rule the table applies, reviewed.
    if (override.cumulative) out.cumulative = [...override.cumulative];
    if (override.detach) out.detach = [...override.detach];
    if (override.intro) out.intro = { ...(out.intro ?? {}), rule: override.intro };
    out.overridden = true;
    out.problems = (out.problems ?? []).filter((p) => !/^(?:stage|interval)-\d+$/.test(p) || out.stages[Number(p.split("-")[1]) - 1]?.unparsed);
    if (override.save) out.problems = out.problems.filter((p) => p !== "save");
    if (override.duration) out.problems = out.problems.filter((p) => p !== "duration");
    if ("onset" in override) out.problems = out.problems.filter((p) => p !== "onset");
    return out;
}

/**
 * The definition that applies (8.10.2): a world definition, then an override merged onto the parse, then the parse.
 * Each carries where it came from (`origin`).
 */
export function resolveDefinition({ world = null, override = null, parsed = null }) {
    if (world) return { ...clone(world), origin: "world" };
    if (parsed && override) return { ...applyOverride(parsed, override), origin: "override" };
    if (parsed) return { ...clone(parsed), origin: "parse" };
    return null;
}

/** Whether a definition can run: at least one stage and a save type. */
export const runnable = (def) => !!def && Array.isArray(def.stages) && def.stages.length > 0 && !!def.save?.type;

/** The kind of affliction (poison, disease, curse), or null. */
export const kindOf = (def) => ["poison", "disease", "curse"].find((k) => (def?.traits ?? []).includes(k)) ?? null;

/** How an item delivers its affliction (8.10.3), from its traits: injury, contact, ingested or inhaled, or null. */
export const deliveryOf = (traits = []) => ["injury", "contact", "ingested", "inhaled"].find((t) => traits.includes(t)) ?? null;

/* -------------------------------------------- */
/*  Dice and time                                */
/* -------------------------------------------- */

/** Roll a formula of the parser's grammar (`XdY`, `XdY+Z`, `(XdY)*N`, a number) with `random` (0 <= r < 1). */
export function rollFormula(formula, random = Math.random) {
    const text = String(formula).replace(/\s+/g, "");
    const scaled = /^\((.*)\)\*(\d+)$/.exec(text);
    if (scaled) return rollFormula(scaled[1], random) * Number(scaled[2]);
    const match = /^(?:(\d+)d(\d+))?([+-]\d+)?$/.exec(text);
    if (!match || (!match[1] && !match[3])) {
        if (/^\d+$/.test(text)) return Number(text);
        throw new RangeError(`not a formula the tracker rolls: ${formula}`);
    }
    let total = Number(match[3] ?? 0);
    for (let i = 0; i < Number(match[1] ?? 0); i++) total += 1 + Math.floor(random() * Number(match[2]));
    return total;
}

/** The average of a formula of the parser's grammar. */
export function averageFormula(formula) {
    const text = String(formula).replace(/\s+/g, "");
    const scaled = /^\((.*)\)\*(\d+)$/.exec(text);
    if (scaled) return averageFormula(scaled[1]) * Number(scaled[2]);
    const match = /^(?:(\d+)d(\d+))?([+-]\d+)?$/.exec(text);
    if (!match) return Number(text) || 0;
    return Number(match[1] ?? 0) * (Number(match[2] ?? 0) + 1) / 2 + Number(match[3] ?? 0);
}

/**
 * A duration as world seconds, rolled once when it starts (8.10.2: a dice onset is rolled at exposure, a dice interval each
 * time its stage starts): `{seconds, formula?, rolled?}`; `seconds` null for none or unlimited.
 */
export function rollDuration(duration, random = Math.random) {
    if (!duration || duration.unit === "unlimited" || duration.unit === "encounter") return { seconds: null };
    if (duration.formula) {
        const rolled = rollFormula(duration.formula, random);
        return { seconds: rolled * (UNIT_SECONDS[duration.unit] ?? 0), formula: `${duration.formula} ${duration.unit}`, rolled };
    }
    const seconds = durationSeconds(duration);
    return { seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
}

/** A duration's seconds for a comparison (a dice one at its average), or null. */
export function typicalSeconds(duration) {
    if (!duration || duration.unit === "unlimited") return null;
    if (duration.formula) return averageFormula(duration.formula) * (UNIT_SECONDS[duration.unit] ?? 0);
    const seconds = durationSeconds(duration);
    return Number.isFinite(seconds) ? seconds : null;
}

/**
 * The tracker's clock (8.10.7): world time, moved on by the whole days the Advance days wizard's log runs ahead of the clock's
 * day, `afflictionNow = worldTime + max(0, manualDay − clockDay) × secondsPerDay`. While the log is ahead it reads the
 * workshop day (4.8, the same max rule) at the world's time of day, so rounds, minutes and hours still move it; once the
 * clock's day reaches the log ("advance clock to match", which keeps the time of day) it is world time, with no jump. A
 * midnight the world clock crosses while the log is still ahead lands inside the logged days and adds nothing, as for the
 * workshop day: the clock reads a day less, and, as for a clock set back, due times wait (8.10.7).
 */
export function afflictionNow({ worldTime, manualDay = null, secondsPerDay = 86400, offset = 0 }) {
    if (!Number.isInteger(manualDay)) return worldTime;
    const clockDay = Math.floor((worldTime + offset) / secondsPerDay);
    return worldTime + Math.max(0, manualDay - clockDay) * secondsPerDay;
}

/**
 * Whether a moment `at` has come (8.10.7). Outside an encounter, or with no anchor in this encounter: once the clock
 * reaches it. In the anchor's encounter, by pf2e's effect convention: after it, or at it once the anchor's turn has ended
 * (the current initiative is below the anchor's, pf2e `calculateRemainingDuration` with `turn-end`).
 *
 * @param {number|null} at
 * @param {number} now
 * @param {{combatId: string, initiative: number|null}|null} anchor
 * @param {{id: string, initiative: number|null}|null} combat  the anchor's encounter as it is now, or null when it is over
 */
export function isDue(at, now, anchor = null, combat = null) {
    if (!Number.isFinite(at)) return false;
    if (now > at) return true;
    if (now < at) return false;
    if (!anchor || !combat || combat.id !== anchor.combatId || !Number.isFinite(anchor.initiative)) return true;
    return Number.isFinite(combat.initiative) && combat.initiative < anchor.initiative;
}

/**
 * The next event of a run: `{kind: "onset" | "max" | "save", at}`, or null. At the same moment the maximum duration comes
 * first (8.10.6: when it passes the affliction ends, even if a save falls due then).
 */
export function nextEvent(run) {
    if (!run || run.phase === "ended") return null;
    if (run.phase === "onset") return Number.isFinite(run.onsetEndsAt) ? { kind: "onset", at: run.onsetEndsAt } : null;
    const events = [];
    if (Number.isFinite(run.maxEndsAt)) events.push({ kind: "max", at: run.maxEndsAt });
    if (Number.isFinite(run.nextDueAt)) events.push({ kind: "save", at: run.nextDueAt });
    events.sort((a, b) => a.at - b.at || (a.kind === "max" ? -1 : 1));
    return events[0] ?? null;
}

/* -------------------------------------------- */
/*  Modifiers (6.11 `afflictionModifier`)        */
/* -------------------------------------------- */

/**
 * The feats that change an affliction, as `run.mods` names them (8.10.6): `tenacious-toxins`, `pernicious-poison`,
 * `combustible-poison`, `pinpoint-poisoner`, `blowgun-crit`, `held-breath`, `toxicologist-acid`, `combustible-fire`
 * (the target already takes persistent fire). Each `{slug}`.
 */
export const MODIFIER_SLUGS = Object.freeze(["tenacious-toxins", "pernicious-poison", "combustible-poison", "pinpoint-poisoner", "blowgun-crit",
    "held-breath", "toxicologist-acid", "combustible-fire"]);

const hasMod = (mods, slug) => (mods ?? []).some((m) => m?.slug === slug);

/** The maximum duration in seconds with the modifiers: Tenacious Toxins adds the stage-1 interval, at most twice the maximum. */
export function maxSeconds(def, mods = []) {
    const base = typicalSeconds(def?.duration);
    if (!Number.isFinite(base)) return null;
    if (!hasMod(mods, "tenacious-toxins")) return base;
    const first = typicalSeconds(def.stages?.[0]?.duration) ?? 0;
    return Math.min(base + first, base * 2);
}

/**
 * The circumstance modifiers of an initial save (8.10.6): Pinpoint Poisoner −2, Combustible Poison's −1 against a target
 * already taking persistent fire, holding one's breath +2 (inhaled). `[{slug, value}]`.
 */
export function initialSaveModifiers(mods = []) {
    const out = [];
    if (hasMod(mods, "pinpoint-poisoner")) out.push({ slug: "pinpoint-poisoner", value: -2 });
    if (hasMod(mods, "combustible-poison") && hasMod(mods, "combustible-fire")) out.push({ slug: "combustible-poison", value: -1 });
    if (hasMod(mods, "held-breath")) out.push({ slug: "held-breath", value: 2 });
    return out;
}

/** The degree an initial save counts as: Blowgun Poisoner's critical hit makes it one degree worse (a misfortune effect). */
export function initialDegree(degree, mods = []) {
    return hasMod(mods, "blowgun-crit") ? Math.max(DEGREE.critFail, degree - 1) : degree;
}

/**
 * Damage the initial save's result causes besides the stages (8.10.6): Pernicious Poison's poison damage equal to the
 * poison's level on a success (nothing on a critical success); Combustible Poison's 1d4 persistent fire on a failure
 * (unless the target already took persistent fire, which made the save harder instead).
 */
export function initialExtras(degree, level, mods = []) {
    if (degree === DEGREE.success && hasMod(mods, "pernicious-poison") && level > 0) {
        return [{ formula: String(level), damageType: "poison", category: null }];
    }
    if (degree <= DEGREE.fail && hasMod(mods, "combustible-poison") && !hasMod(mods, "combustible-fire")) {
        return [{ formula: "1d4", damageType: "fire", category: "persistent" }];
    }
    return [];
}

/* -------------------------------------------- */
/*  One step                                     */
/* -------------------------------------------- */

/** A new run for an exposure, before its initial save is applied. */
export function newRun({ id, source, defKey, dc, mods = [], by = null, at = null }) {
    return {
        v: RUN_VERSION, id, source: clone(source), defKey, dc: clone(dc), phase: "onset", stage: 0, streak: 0,
        onsetEndsAt: null, maxEndsAt: null, nextDueAt: null, anchor: null, interval: null,
        exposures: {}, saves: {}, seq: 0, pending: null, mods: clone(mods), by, at,
    };
}

/** What a stage does when it is reached (8.10.1): its conditions, effects and damage, with the modifiers' damage type. */
export function stageEffects(def, stage, mods = []) {
    const data = def.stages?.[stage - 1];
    if (!data) return { conditions: [], effects: [], damage: [], unparsed: false, cumulative: [] };
    const acid = hasMod(mods, "toxicologist-acid");
    const detach = def.detach ?? [];
    return {
        conditions: clone(data.conditions ?? []).map((c) => (detach.includes(c.slug) ? { ...c, linked: false } : c)), effects: clone(data.effects ?? []),
        damage: (data.damage ?? []).map((d) => ({ ...d, damageType: acid && d.damageType === "poison" ? "acid" : d.damageType })),
        unparsed: !!data.unparsed, cumulative: [...(def.cumulative ?? [])],
    };
}

/** The run once it has ended. */
export function ended(run, reason = "saved", now = null) {
    return { ...run, phase: "ended", nextDueAt: null, pending: null, endedAt: now, endReason: reason };
}

/**
 * Enter (or repeat) a stage at `now` (8.10.6 `enterStage`): its interval starts; the maximum duration starts with the first.
 * `failed`: a failed save brought it here (a `cumulative` condition adds its value then, 8.10.2).
 */
export function enterStage(run, def, stage, now, ctx = {}, { keepMax = false, failed = false } = {}) {
    const first = run.phase !== "active";
    const repeat = !first && run.stage === stage;
    const interval = rollDuration(def.stages[stage - 1]?.duration ?? null, ctx.random);
    const max = maxSeconds(def, run.mods);
    const maxEndsAt = keepMax && !first ? run.maxEndsAt : Number.isFinite(max) ? now + max : null;
    return {
        run: {
            ...run, phase: "active", stage, interval, nextDueAt: Number.isFinite(interval.seconds) ? now + interval.seconds : null,
            maxEndsAt, onsetEndsAt: null, anchor: ctx.anchor ?? null, enteredAt: now,
        },
        effects: { stage, repeat, failed, ...stageEffects(def, stage, run.mods) },
    };
}

/** Start an onset at `now` (8.10.6): the target stage waits; nothing takes effect; the onset is rolled once. */
export function startOnset(run, def, stage, now, ctx = {}) {
    const onset = rollDuration(def.onset, ctx.random);
    const seconds = Number.isFinite(onset.seconds) ? onset.seconds : 0;
    return {
        run: { ...run, phase: "onset", stage, onsetEndsAt: now + seconds, onset, nextDueAt: null, maxEndsAt: null, anchor: ctx.anchor ?? null },
        effects: null,
    };
}

/**
 * One step of an affliction (8.10.6): the new run state and what the step applies. `kind` is "initial", "re-exposure" or
 * "stage"; `degree` the save's degree (pf2e's, after its own adjustments: incapacitation comes from passing the item).
 * `ctx`: `{random, anchor}`. `effects` is null when nothing takes effect now, else `{stage, repeat, conditions, effects,
 * damage, unparsed}`; `extras` is damage the initial save's result causes (8.10.6 modifiers); `ended` when it ends.
 */
export function applyDegree(run, def, degree, kind, now, ctx = {}) {
    const max = def.stages.length || 1;
    const virulent = def.traits.includes("virulent");
    if (kind === "initial") {
        const counted = initialDegree(degree, run.mods);
        const extras = initialExtras(counted, run.source?.level ?? def.level ?? 0, run.mods);
        if (counted >= DEGREE.success) return { run: ended(run, "saved", now), effects: null, extras, ended: true, degree: counted };
        const stage = Math.min(max, counted === DEGREE.critFail ? 2 : 1);   // a single-stage affliction stays at 1
        const step = def.onset ? startOnset(run, def, stage, now, ctx) : enterStage(run, def, stage, now, ctx, { failed: true });
        return { ...step, extras, ended: false, degree: counted };
    }
    if (kind === "re-exposure") {
        if (def.reExposure === "none" || def.reExposure === "table") return { run, effects: null, extras: [], ended: false, noSave: true };
        // A re-exposure's save is the initial save against a new exposure (Player Core p.431): that exposure's own modifiers
        // (`ctx.mods`, the claim's) count as they do for an initial save: Blowgun Poisoner's degree, Pernicious Poison's and
        // Combustible Poison's damage.
        const mods = ctx.mods ?? run.mods;
        const counted = initialDegree(degree, mods);
        const extras = initialExtras(counted, run.source?.level ?? def.level ?? 0, mods);
        let next = run;
        if (def.reExposure === "reset-max" && run.phase === "active") {
            const seconds = maxSeconds(def, run.mods);
            next = { ...run, maxEndsAt: Number.isFinite(seconds) ? now + seconds : null };
        }
        if (kindOf(def) !== "poison" || counted >= DEGREE.success) return { run: next, effects: null, extras, ended: false, degree: counted };
        const stage = Math.min(max, next.stage + (counted === DEGREE.critFail ? 2 : 1));
        if (next.phase === "onset") return { run: { ...next, stage }, effects: null, extras, ended: false, degree: counted };   // the onset's length stands
        return { ...enterStage(next, def, stage, now, ctx, { keepMax: true, failed: true }), extras, ended: false, degree: counted };
    }
    // A stage save at the end of an interval.
    let { stage, streak = 0 } = run;
    if (degree === DEGREE.critSuccess) {
        stage -= virulent ? 1 : 2;
        streak = 0;
    } else if (degree === DEGREE.success) {
        if (virulent) {
            streak += 1;
            if (streak >= 2) {
                stage -= 1;
                streak = 0;
            }
        } else stage -= 1;
    } else {
        stage += degree === DEGREE.critFail ? 2 : 1;
        streak = 0;
    }
    if (stage < 1) return { run: ended({ ...run, streak }, "recovered", now), effects: null, extras: [], ended: true };
    // Past the highest stage, or a virulent success that changed nothing: that stage's effects repeat and its interval
    // restarts (Player Core p.430; the virulent case is an interpretation, OQ-39).
    return { ...enterStage({ ...run, streak }, def, Math.min(stage, max), now, ctx, { keepMax: true, failed: degree <= DEGREE.fail }), extras: [], ended: false };
}

/**
 * The automatic events of a run that are due by `now` (8.10.7): onset ends and the maximum duration, each applied at its
 * own moment, in time order, stopping at the first stage save that is due (it needs a roll). Returns the run, the steps
 * applied (`[{kind, at, effects, ended}]`) and the save due (`{at}`) or null.
 *
 * @param {{random?: Function, anchor?: object|null, combat?: object|null, limit?: number}} ctx  `combat`: the anchor's
 *   encounter now (`isDue`); `anchor`: the anchor a stage entered now takes
 */
export function advance(run, def, now, ctx = {}) {
    let current = run;
    const steps = [];
    for (let guard = 0; guard < (ctx.limit ?? 1000); guard++) {
        const event = nextEvent(current);
        if (!event || !isDue(event.at, now, current.anchor, ctx.combat ?? null)) return { run: current, steps, save: null };
        if (event.kind === "save") return { run: current, steps, save: { at: event.at } };
        if (event.kind === "max") {
            current = ended(current, "max-duration", event.at);
            steps.push({ kind: "max", at: event.at, effects: null, ended: true });
            return { run: current, steps, save: null };
        }
        // The onset ends: the stage it waited for takes effect at that moment.
        const step = enterStage(current, def, Math.max(1, current.stage), event.at, { ...ctx, anchor: current.anchor ?? ctx.anchor ?? null }, { failed: true });
        current = step.run;
        steps.push({ kind: "onset", at: event.at, effects: step.effects, ended: false });
    }
    return { run: current, steps, save: null };
}

/* -------------------------------------------- */
/*  Recording saves (8.10.8)                     */
/* -------------------------------------------- */

const pick = (run) => Object.fromEntries(BEFORE_FIELDS.map((key) => [key, clone(run[key]) ?? null]));

/** The latest save of a run (by seq), or null. */
export const latestSeq = (run) => {
    const seqs = Object.keys(run?.saves ?? {}).map(Number).filter(Number.isInteger);
    return seqs.length ? Math.max(...seqs) : null;
};

/**
 * Record a save on a run (8.10.8). The first result recorded for a `seq` stands; a later message for the same `seq` that
 * is not a reroll is `already`. A reroll (`isReroll`) replaces the result only when the message recorded for that seq is
 * gone (`originalGone`: pf2e deletes the original before posting the reroll) and it is the run's latest save; it restores
 * the run from `before` and recomputes. A reroll of an earlier save is a `conflict`.
 *
 * @param {object} run
 * @param {object} def
 * @param {{seq: number, kind: string, degree: number, dueAt: number, messageId: string, isReroll?: boolean,
 *   originalGone?: boolean}} save
 * @param {object} [ctx]  as `applyDegree`'s
 * @returns {{ok: true, run, effects, extras, ended, superseded: object|null} | {ok: false, reason: "already"|"conflict"|"stale"}}
 */
export function recordSave(run, def, { seq, kind, degree, dueAt, messageId, isReroll = false, originalGone = false }, ctx = {}) {
    const had = run.saves?.[seq] ?? null;
    if (had && !isReroll) return { ok: false, reason: "already" };
    if (had && isReroll && !originalGone) return { ok: false, reason: "already" };
    if (had && isReroll && seq !== latestSeq(run)) return { ok: false, reason: "conflict" };
    if (!had && isReroll && Number.isInteger(latestSeq(run)) && seq < latestSeq(run)) return { ok: false, reason: "conflict" };
    const base = had ? { ...run, ...clone(had.before) } : run;
    const before = had ? clone(had.before) : pick(run);
    const fromStage = base.stage;
    const step = applyDegree(base, def, degree, kind, dueAt, ctx);
    const record = { kind, dueAt, degree: step.degree ?? degree, fromStage, toStage: step.run.phase === "ended" ? 0 : step.run.stage, messageId, before,
        rolls: (had?.rolls ?? 0) + 1 };
    const saves = { ...(run.saves ?? {}), [seq]: record };
    const pending = run.pending && run.pending.seq !== seq ? run.pending : null;
    return {
        ok: true, run: { ...step.run, saves, seq: Math.max(run.seq ?? 0, seq), pending }, effects: step.effects, extras: step.extras ?? [],
        ended: step.ended, noSave: !!step.noSave, superseded: had,
    };
}

/* -------------------------------------------- */
/*  Exposure (8.10.3, 8.10.6)                    */
/* -------------------------------------------- */

/**
 * What a new exposure is for a target (8.10.6): `initial` (no active run of that definition), `re-exposure` (a poison's, a
 * save rolled), `no-save` (the item's own rule: `reExposure` "none" or "table", recorded, nothing rolled) or `no-effect`
 * (a curse or disease already affecting the creature).
 */
export function exposureKind(active, def) {
    if (!active || active.phase === "ended") return "initial";
    if (def?.reExposure === "none" || def?.reExposure === "table") return "no-save";
    if (kindOf(def) !== "poison") return "no-effect";
    return "re-exposure";
}

/** Claims for one target in order (5.5, 8.10.3): by `at` (world, then real time), then id. */
export function claimOrder(a, b) {
    const world = (a.at?.world ?? 0) - (b.at?.world ?? 0);
    if (world) return world;
    const real = (a.at?.real ?? 0) - (b.at?.real ?? 0);
    if (real) return real;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Whether an exposure claim must wait (8.10.3): a later claim of the same definition waits until the earlier one on the
 * same target is resolved.
 */
export function waitsBehind(claim, open) {
    return open.some((other) => other.id !== claim.id && other.actor === claim.actor && other.defKey === claim.defKey && !other.resolved &&
        claimOrder(other, claim) < 0);
}

/* -------------------------------------------- */
/*  The DC (8.10.4)                              */
/* -------------------------------------------- */

/**
 * The DC an exposure uses, the first that applies (8.10.4): a world definition's or override's DC, a DC typed on a manual
 * Expose, the item's DC stamp, the inline DC as pf2e resolves it for the holder, the parsed printed DC. `{value, source}`
 * or null when none is known (a creature's `against:` save with no DC given).
 */
export function chooseDc({ fixed = null, manual = null, stamp = null, inline = null, printed = null } = {}) {
    const candidates = [["definition", fixed], ["manual", manual], ["stamp", stamp], ["inline", inline], ["printed", printed]];
    for (const [source, value] of candidates) if (Number.isInteger(value) && value > 0) return { value, source };
    return null;
}

/**
 * The Powerful Alchemy DC stamp (8.10.4, Player Core 2): an infused item that allows a save takes the higher of its printed
 * DC and the creator's class DC, written only when the class DC is higher (pf2e applies it as an upgrade). Returns the
 * stamp's value, or null when nothing is written.
 */
export function powerfulAlchemyDc({ printed = [], classDc = null, infused = false } = {}) {
    if (!infused || !Number.isInteger(classDc) || !printed.length) return null;
    const highest = Math.max(...printed);
    return classDc > highest ? classDc : null;
}

/** The legacy Potent Poisoner stamp (badged): up to 4 above the printed DC, at most the class DC; null when it raises nothing. */
export function potentPoisonerDc({ printed = [], classDc = null } = {}) {
    if (!Number.isInteger(classDc) || !printed.length) return null;
    const highest = Math.max(...printed);
    const raised = Math.min(highest + 4, classDc);
    return raised > highest ? raised : null;
}

/** The inline save DCs a description prints (`@Check[fortitude|dc:18]`), in order. */
export function printedSaveDcs(html) {
    const out = [];
    for (const match of String(html ?? "").matchAll(/@Check\[([^\]]*)\]/g)) {
        const params = match[1].split("|").map((p) => p.trim());
        if (!["fortitude", "reflex", "will"].includes(params[0]?.toLowerCase())) continue;
        const dc = params.map((p) => /^dc:\s*(\d+)$/i.exec(p)?.[1]).find(Boolean);
        if (dc) out.push(Number(dc));
    }
    return out;
}

/* -------------------------------------------- */
/*  Coatings and Strikes (8.10.5)                */
/* -------------------------------------------- */

/** What an attack roll does to an armed coating (8.10.5 step 1): critical failure spends it, failure keeps it, a hit arms it. */
export function coatingAfterAttack(degree) {
    if (degree === DEGREE.critFail) return "spend";
    if (degree === DEGREE.fail) return "keep";
    return "arm";
}

/**
 * What a hit's damage roll does to an armed coating (8.10.5 step 2): piercing or slashing damage (or a blowgun's Strike with
 * Blowgun Poisoner) exposes the target; the coating is spent unless the item stays potent (`keepsCoating`). Otherwise it is
 * spent with no exposure.
 */
export function coatingAfterDamage({ types = [], blowgun = false, keepsCoating = false } = {}) {
    const expose = blowgun || types.includes("piercing") || types.includes("slashing");
    return { expose, spend: !keepsCoating };
}

/** Sticky Poison's flat check (8.10.5): DC 17 after an exposure, DC 5 when the coating would be spent with no save. */
export const stickyDc = (afterExposure) => (afterExposure ? 17 : 5);

/**
 * Whether two poisons can be merged with Double Poison (Player Core 2, 8.10.5): both infused injury poisons, different, each
 * at least 2 levels below the alchemist's level, on a weapon (not ammunition). `{ok}` or `{ok: false, reason}`.
 */
export function canDoublePoison({ first, second, alchemistLevel, ammunition = false }) {
    if (ammunition) return { ok: false, reason: "double-ammo" };
    if (!first || !second) return { ok: false, reason: "double-two" };
    if (first.uuid === second.uuid) return { ok: false, reason: "double-same" };
    for (const p of [first, second]) {
        if (!p.traits?.includes("infused") || !p.traits?.includes("injury")) return { ok: false, reason: "double-infused" };
        if (!(p.level <= alchemistLevel - 2)) return { ok: false, reason: "double-level" };
    }
    return { ok: true };
}

/**
 * The definition Double Poison makes of two (8.10.5): the lower number of stages, each stage's effects combined and its
 * interval the longer of the two for that stage, virulent only if both are, the save type the applier chose when they
 * differ, the longer maximum duration and onset (an interpretation: the feat names neither).
 */
export function mergeDoublePoison(a, b, { saveType = null } = {}) {
    const count = Math.min(a.stages.length, b.stages.length);
    const longer = (x, y) => ((typicalSeconds(x) ?? -1) >= (typicalSeconds(y) ?? -1) ? x : y);
    const stages = [];
    for (let i = 0; i < count; i++) {
        const sa = a.stages[i];
        const sb = b.stages[i];
        stages.push({
            damage: [...clone(sa.damage), ...clone(sb.damage)],
            conditions: mergeConditionLists(sa.conditions, sb.conditions),
            effects: [...clone(sa.effects), ...clone(sb.effects)],
            duration: clone(longer(sa.duration, sb.duration)),
            ...(sa.unparsed || sb.unparsed ? { unparsed: true } : {}),
        });
    }
    const virulent = a.traits.includes("virulent") && b.traits.includes("virulent");
    const traits = [...new Set([...a.traits, ...b.traits])].filter((t) => t !== "virulent" || virulent);
    const type = a.save.type === b.save.type ? a.save.type : saveType ?? a.save.type;
    return {
        v: 1, level: Math.max(a.level ?? 0, b.level ?? 0), traits, save: { type, value: null }, onset: clone(longer(a.onset, b.onset)),
        duration: clone(longer(a.duration, b.duration)), stages, confidence: a.confidence === "full" && b.confidence === "full" ? "full" : "partial",
        problems: [], double: true,
    };
}

/** Two stages' conditions as one list: one per slug, the higher value. */
function mergeConditionLists(x = [], y = []) {
    const out = new Map();
    for (const c of [...x, ...y]) {
        const had = out.get(c.slug);
        if (!had || (c.value ?? 0) > (had.value ?? 0)) out.set(c.slug, clone(c));
    }
    return [...out.values()];
}

/* -------------------------------------------- */
/*  Stage conditions (8.10.1)                    */
/* -------------------------------------------- */

/**
 * How a stage condition is granted by the tracker (8.10.1): the six expiring conditions and unlinked ones outlast it
 * (`detach`), every other one goes with it (`cascade`). The tracker's own `itemGrants` entries are always `detach`.
 */
export function grantOnDelete(condition) {
    return EXPIRING_CONDITIONS.includes(condition.slug) || condition.linked === false ? "detach" : "cascade";
}

/**
 * The condition changes entering a stage makes (8.10.1, as pf2e's `handleStageChange`): delete the tracker's linked
 * conditions that do not expire on their own, then create or update the new stage's. `existing` are the actor's conditions
 * as `{id, slug, value, grantedBy, linked}` (`grantedBy` the tracker's id when it granted them). A `cumulative` condition
 * (8.10.2, King's Sleep's drained) adds the stage's value to the one it has on each failed save (`failed`) and never goes
 * down while the affliction lasts.
 *
 * @param {{cumulative?: string[], failed?: boolean}} [rules]
 * @returns {{deletes: string[], updates: {id: string, value: number|null}[], creates: {slug, value, linked, onDelete}[]}}
 */
export function stageConditionPlan(trackerId, conditions, existing, { cumulative = [], failed = false } = {}) {
    const mine = existing.filter((c) => c.grantedBy === trackerId);
    const deletes = mine.filter((c) => c.linked !== false && !EXPIRING_CONDITIONS.includes(c.slug) && !cumulative.includes(c.slug)).map((c) => c.id);
    const kept = mine.filter((c) => !deletes.includes(c.id));
    const updates = [];
    const creates = [];
    for (const data of conditions) {
        const had = kept.find((c) => c.slug === data.slug);
        if (had && cumulative.includes(data.slug)) {
            if (failed && Number.isFinite(data.value)) updates.push({ id: had.id, value: (had.value ?? 0) + data.value });
            continue;
        }
        if (had) {
            if (data.value !== null && data.value !== had.value) updates.push({ id: had.id, value: data.value });
            continue;
        }
        creates.push({ slug: data.slug, value: data.value ?? null, linked: data.linked !== false, onDelete: grantOnDelete(data) });
    }
    return { deletes, updates, creates };
}

/* -------------------------------------------- */
/*  The tracker item (8.10.1)                    */
/* -------------------------------------------- */

/** The tracker's `AfflictionSystemSource` from a definition and a run (8.10.1, the schema `flags.MOD.affliction.system` keeps). */
export function systemSource(def, run) {
    return {
        level: { value: run.source?.level ?? def.level ?? 1 },
        traits: { value: [...(def.traits ?? [])], otherTags: [] },
        save: { type: def.save?.type ?? "fortitude", value: run.dc?.value ?? def.save?.value ?? 0 },
        status: { onset: run.phase === "onset", stage: Math.max(1, run.stage || 1), progress: run.streak ?? 0 },
        onset: null,   // never written (8.10.1, native constraints): the run holds the onset
        stages: (def.stages ?? []).map((s) => ({
            damage: clone(s.damage ?? []), conditions: (s.conditions ?? []).map((c) => ({ slug: c.slug, value: c.value ?? null, linked: c.linked !== false })),
            effects: clone(s.effects ?? []), duration: s.duration?.formula ? { value: 1, unit: s.duration.unit } : clone(s.duration ?? { value: -1, unit: "unlimited" }),
        })),
        duration: clone(def.duration ?? { value: -1, unit: "unlimited", expiry: null }),
        start: { value: run.enteredAt ?? run.at?.world ?? 0, initiative: run.anchor?.initiative ?? null },
        fromSpell: false,
    };
}

/**
 * The effect item that carries an affliction in the effect backend (8.10.1): the source's traits and image, unlimited
 * duration (the system's effect tracker never removes it), a counter badge whose labels are the stage names (during the
 * onset every label is the onset's), and the affliction in `flags.MOD.affliction`. `labels`: `{stage(n), onset}` localized;
 * `hidden`: the source is unidentified, so the name and image are generic (8.10.8).
 */
export function trackerSource({ id, def, run, name, img, labels, allowedTraits = null, hidden = false, unidentified = false, genericName, genericImg }) {
    const count = Math.max(1, def.stages.length);
    const stageLabels = Array.from({ length: count }, (_, i) => (run.phase === "onset" ? labels.onset : labels.stage(i + 1)));
    const traits = (def.traits ?? []).filter((t) => !allowedTraits || allowedTraits.includes(t));
    return {
        _id: id, type: "effect", name: hidden ? genericName : name, img: hidden ? genericImg : img,
        system: {
            level: { value: run.source?.level ?? def.level ?? 1 }, traits: { value: traits, otherTags: [] },
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
            badge: { type: "counter", value: Math.min(count, Math.max(1, run.stage || 1)), labels: stageLabels },
            start: { value: run.at?.world ?? 0, initiative: run.anchor?.initiative ?? null },
            tokenIcon: { show: true }, unidentified: !!unidentified, slug: null,
        },
        flags: { pf2e: { itemGrants: {} } },
    };
}

/** The badge a tracker shows for a run: its value and labels (`trackerSource`'s). */
export function badgeOf(def, run, labels) {
    const count = Math.max(1, def.stages.length);
    return { type: "counter", value: Math.min(count, Math.max(1, run.stage || 1)),
        labels: Array.from({ length: count }, (_, i) => (run.phase === "onset" ? labels.onset : labels.stage(i + 1))) };
}

/* -------------------------------------------- */
/*  Who rolls (8.10.8) and the backend (8.10.1)  */
/* -------------------------------------------- */

/**
 * Who rolls a save for a victim (8.10.8): `{roller: "owner" | "gm" | "nobody", auto, waiting?}`. A victim with a player owner
 * is the owner's (prompted, or rolled at once under `pcSaves: auto`); while the owner is offline it waits, unless a GM may
 * roll (`gmRollsForOfflinePCs`). A victim with no player owner is the active GM's (`npcSaves`), waiting without one.
 */
export function rollerFor({ playerOwned, ownerConnected, gmConnected }, settings = {}) {
    const { pcSaves = "prompt", npcSaves = "auto", gmRollsForOfflinePCs = false } = settings;
    if (playerOwned) {
        if (ownerConnected) return { roller: "owner", auto: pcSaves === "auto" };
        if (gmRollsForOfflinePCs && gmConnected) return { roller: "gm", auto: npcSaves === "auto" };
        return { roller: "nobody", auto: false, waiting: "owner" };
    }
    if (gmConnected) return { roller: "gm", auto: npcSaves === "auto" };
    return { roller: "nobody", auto: false, waiting: "gm" };
}

/**
 * The backend (8.10.1, OQ-47): `native` when pf2e registers a data model for the affliction type and lists the type,
 * otherwise `effect` (every release to date: release builds delete the type and its constructor throws).
 */
export function chooseBackend({ dataModels = {}, documentTypes = [] } = {}) {
    return dataModels?.affliction && (Array.isArray(documentTypes) ? documentTypes : Object.keys(documentTypes ?? {})).includes("affliction") ? "native" : "effect";
}

/* -------------------------------------------- */
/*  Affliction Forge (8.10.11)                   */
/* -------------------------------------------- */

/**
 * Where an exposure goes while Affliction Forge is active (8.10.11): `skip` when the target already has a Forge controller
 * for that source (one engine per affliction); `forge` when the source has a linked template and the hand-off setting is on,
 * with a GM connected; `wait` or `workshop` (`forgeWithoutGm`) when no GM is; otherwise `workshop`.
 */
export function forgeRoute({ active, controllerOnTarget = false, template = null, handOff = true, gmConnected = false, withoutGm = "workshop" }) {
    if (!active) return "workshop";
    if (controllerOnTarget) return "skip";
    if (!template || !handOff) return "workshop";
    if (gmConnected) return "forge";
    return withoutGm === "wait" ? "wait" : "workshop";
}

/** A short digest of a definition (numbers and slugs), so a churn watch can report a changed parse between pf2e tags (15.2). */
export function definitionDigest(def) {
    const body = JSON.stringify([def?.save, def?.onset, def?.duration, def?.traits, (def?.stages ?? []).map((s) => [s.damage, s.conditions, s.effects, s.duration, !!s.unparsed])]);
    let hash = 0x811c9dc5;
    for (let i = 0; i < body.length; i++) hash = Math.imul(hash ^ body.charCodeAt(i), 0x01000193) >>> 0;
    return hash.toString(36);
}

/* -------------------------------------------- */
/*  The save's link option (8.10.8)              */
/* -------------------------------------------- */

/** The prefix of the link options: the module id (`scripts/constants.mjs`, which this folder may not import). */
export const AFFLICTION_LINK_PREFIX = "pf2e-artisans-workshop:affliction";

/** The roll option that ties a save's chat message to its affliction and save: `<MOD>:affliction:<runId>:<seq>` (8.10.8). */
export function afflictionLink(runId, seq) {
    if (!/^[A-Za-z0-9]{16}$/.test(runId ?? "") || !Number.isInteger(seq) || seq < 1) throw new RangeError(`bad affliction link ${runId}:${seq}`);
    return `${AFFLICTION_LINK_PREFIX}:${runId}:${seq}`;
}

/** The affliction and save a roll's options link to, `{runId, seq}`, or null. */
export function parseAfflictionLink(options = []) {
    for (const option of options ?? []) {
        if (typeof option !== "string" || !option.startsWith(`${AFFLICTION_LINK_PREFIX}:`)) continue;
        const [runId, seq] = option.slice(AFFLICTION_LINK_PREFIX.length + 1).split(":");
        if (/^[A-Za-z0-9]{16}$/.test(runId ?? "") && /^\d+$/.test(seq ?? "")) return { runId, seq: Number(seq) };
    }
    return null;
}

/** The lock page of a recorded save (8.10.8): one per run, save and result, so the first result for a seq stands. */
export const saveLockKey = (runId, seq, rolls = 0) => `afflict:${runId}:${seq}:${rolls}`;

/**
 * Where the anchor of a stage that starts now comes from (8.10.7, OQ-40): under `exposure-turn` the initiative of the
 * origin's combatant (the creature that exposed the victim), else the current combatant's; under `victim-turn` the
 * victim's own. Null outside an encounter the victim is in.
 */
export function anchorFor({ combatId = null, origin = null, current = null, victim = null }, mode = "exposure-turn") {
    if (!combatId) return null;
    const initiative = mode === "victim-turn" ? victim : origin ?? current;
    return Number.isFinite(initiative) ? { combatId, initiative } : { combatId, initiative: null };
}

/** The undo entry of a manual change (8.10.9): the run fields it changed and who made it. */
export function manualEntry(run, { kind, toStage = null, by = null, at = null }) {
    return { kind, toStage, fromStage: run.stage, before: pick(run), by, at };
}

/** A run restored from a manual change's undo entry. */
export const undoManual = (run, entry) => ({ ...run, ...clone(entry.before) });
