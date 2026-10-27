/**
 * Earn Income jobs and settlement profiles in the Downtime tab (DESIGN.md 4.9, 6.10, 14.2, M6): starting a job at a task
 * level the current settlement allows, its transition log (rolled again, ended, undone), who may do what, and the
 * settlement profiles the GM keeps. The rules of the job itself (DC, pay, Experienced Professional, resuming) are M1's
 * `earn-income.mjs`; recording its check is `rolls.mjs`. Pure.
 *
 * Transition log. As an order's (4.2.3), every transition of a job writes `jobs.<id>.log.<seq>` = `{seq, event, prev, by,
 * at}` in the request that changes it, behind the lock page of its slot (`jobLogLockId`), so of two transitions planned
 * from the same copy only the first lands; undo restores `prev` of the last entry, for the user who made it, an owner of
 * the earner, or a GM.
 */
import { SETTLEMENT_TASK_LEVELS, TASK_LEVEL_MAX, TASK_LEVEL_MIN } from "../data/settlements.mjs";
import { checkTaskLevel, defaultSettlementProfile, resumeJob } from "./earn-income.mjs";
import { hashId, idemKey } from "./ids.mjs";
import { isPlainObject } from "./keypath.mjs";

/** Settlement sizes (GM Core p.53), smallest first. */
export const SETTLEMENT_SIZES = Object.freeze(Object.keys(SETTLEMENT_TASK_LEVELS));

/** Transitions of a job undo can take back. */
export const JOB_UNDOABLE = Object.freeze(["start", "reroll", "end"]);

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/* -------------------------------------------- */
/*  Settlement profiles                          */
/* -------------------------------------------- */

/**
 * A settlement profile as stored in the world setting `settlements` (14.2): `{id, name, size, level, caps: {[skill]:
 * max}, notes}`. The level is the highest task level offered (default the top of the size's range); `caps` are per-skill
 * exceptions. Throws on a value that is not one (a bug in the caller: the form checks first).
 */
export function makeProfile({ id, name = "", size = "town", level = null, caps = {}, notes = "" }) {
    if (typeof id !== "string" || !id) throw new TypeError("a settlement profile needs an id");
    const base = defaultSettlementProfile(size);
    const lvl = level ?? base.level;
    const inRange = (n) => Number.isInteger(n) && n >= TASK_LEVEL_MIN && n <= TASK_LEVEL_MAX;
    if (!inRange(lvl)) throw new RangeError(`a settlement's task level must be ${TASK_LEVEL_MIN}-${TASK_LEVEL_MAX}, got ${lvl}`);
    const cleanCaps = {};
    for (const [skill, max] of Object.entries(caps ?? {})) {
        if (!/^[a-z0-9-]+$/.test(skill)) throw new TypeError(`bad skill slug ${skill}`);
        if (!inRange(max)) throw new RangeError(`a task level must be ${TASK_LEVEL_MIN}-${TASK_LEVEL_MAX}, got ${max}`);
        cleanCaps[skill] = max;
    }
    return { id, name: String(name ?? "").trim(), size, level: lvl, caps: cleanCaps, notes: String(notes ?? "") };
}

/** The stored profiles (the setting's value) as a list, sorted by name, leaving out anything that is not a profile. */
export function profilesOf(setting) {
    const list = Object.values(isPlainObject(setting) ? setting : {})
        .filter((p) => isPlainObject(p) && typeof p.id === "string" && SETTLEMENT_SIZES.includes(p.size) && Number.isInteger(p.level));
    return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
}

/** The party's current profile, from `meta.settlement.profileId` (any member sets it, 6.10), or null. */
export function currentProfile(setting, current) {
    const id = current?.profileId ?? null;
    return id ? profilesOf(setting).find((p) => p.id === id) ?? null : null;
}

/* -------------------------------------------- */
/*  Starting a job                               */
/* -------------------------------------------- */

/**
 * Whether a job may start (6.10): the earner is trained in the skill (Earn Income is a trained action), and the task
 * level is one the current settlement offers for it. With no settlement set any level is allowed and the job is marked
 * unconfirmed (OQ-17). Refused: `untrained`, `task-level-range`, `task-level-cap` (with the cap).
 * @returns {{ok: true, unconfirmed: boolean} | {ok: false, reason: string, data: object}}
 */
export function jobStart({ taskLevel, skill, rank, profile = null }) {
    if (!(rank >= 1)) return refuse("untrained", { skill });
    const level = checkTaskLevel({ taskLevel, skill, profile });
    if (!level.ok) return refuse(level.reason, level.data);
    return { ok: true, unconfirmed: level.unconfirmed };
}

/* -------------------------------------------- */
/*  The transition log                           */
/* -------------------------------------------- */

/** A job's log entries, oldest first. */
export function jobLog(job) {
    return Object.values(job?.log ?? {}).filter((e) => isPlainObject(e) && Number.isInteger(e.seq)).sort((a, b) => a.seq - b.seq);
}

/** The lock page of a job's log slot `seq` (as an order's, `logLockId`). */
export const jobLogLockId = (jobId, seq) => hashId(idemKey("job-log", jobId, seq));

/**
 * The key-path change that applies a transition to a job and logs it: plain values set, objects replaced, `prev` what the
 * changed fields held. `lock` is the log slot's page, which the request must take.
 */
export function jobTransitionChange(job, event, patch, stamp) {
    const base = `jobs.${job.id}`;
    const seq = (jobLog(job).at(-1)?.seq ?? 0) + 1;
    const prev = Object.fromEntries(Object.keys(patch).map((key) => [key, job[key] ?? null]));
    const set = { [`${base}.by`]: stamp.by, [`${base}.at`]: stamp.at };
    const replace = { [`${base}.log.${seq}`]: { seq, event, prev, ...stamp } };
    for (const [key, value] of Object.entries(patch)) {
        if (isPlainObject(value)) replace[`${base}.${key}`] = value;
        else set[`${base}.${key}`] = value;
    }
    return { set, replace, lock: jobLogLockId(job.id, seq), seq };
}

/**
 * Whether the earner may roll a resumed job again (Player Core p.228, 6.10): it is open, has a check, and the earner's
 * level or rank in the skill changed since it was rolled.
 */
export function mayRerollJob(job, now) {
    if (job?.status !== "open" || !job.check) return false;
    return resumeJob(job, now).mayReroll === true;
}

/** The patch of rolling a job again: a new round, no check, no pay until it is rolled. */
export function rerollPatch(job) {
    return { round: (job.round ?? 1) + 1, check: null, perDayCp: 0, shortened: false };
}

/**
 * What undoing a job's last transition would do (4.2.3 for jobs, 10.1): restore what it changed. A start is undone by
 * removing the job, only while nothing was paid and no day was spent on it (`delete`). Refused: `nothing`,
 * `not-undoable`, `not-yours`, `moved-on` (a start with days or wages since).
 *
 * @param {object} job
 * @param {{userId: string, isGM: boolean, owns: (uuid: string) => boolean}} viewer
 * @param {{worked?: number}} [facts]  days spent on the job, and wages paid or claimed
 */
export function jobUndoPlan(job, viewer, { worked = 0 } = {}) {
    const entry = jobLog(job).at(-1);
    if (!entry || entry.event === "undo") return refuse("nothing");
    if (!JOB_UNDOABLE.includes(entry.event)) return refuse("not-undoable", { event: entry.event });
    if (!(viewer.isGM || entry.by === viewer.userId || viewer.owns(job.actor))) return refuse("not-yours");
    if (entry.event === "start") return worked > 0 ? refuse("moved-on", { status: job.status }) : { ok: true, entry, delete: true };
    return { ok: true, entry, patch: { ...entry.prev } };
}

/**
 * The actions open to a viewer on a job: the earner's owners (a GM owns every actor) roll it once, roll it again after a
 * level or rank change, end it, and undo per `jobUndoPlan`.
 */
export function jobActions(job, viewer, { now = null, worked = 0 } = {}) {
    const mine = viewer.owns(job.actor);
    return {
        roll: mine && job.status === "open" && !job.check,
        reroll: mine && !!now && mayRerollJob(job, now),
        end: mine && job.status !== "ended",
        undo: jobUndoPlan(job, viewer, { worked }).ok,
    };
}
