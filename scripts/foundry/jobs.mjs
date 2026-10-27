/**
 * Earn Income jobs and settlements on this client (DESIGN.md 4.9, 6.10, 14.2, M6): starting a job, rolling it (the roll
 * wrapper's `rollEarnIncome`), rolling it again after a level or rank change, ending it and undoing the last of these;
 * the party's current settlement, which any member sets; and the settlement profiles, which a GM keeps. The rules are
 * `scripts/logic/jobs.mjs` and `earn-income.mjs`.
 *
 * Money: each day a job is worked pays its wage (`payWage`, through the day resolver or the wizard): minted into the
 * earner's purse by the earner's responsible client, a wage claim otherwise; so it works with no GM online (P2). The
 * earner's owner writes the job (4.1: "the earner's owner"); a GM sets only the profiles, which cap the task levels.
 */
import { MODULE_ID } from "../constants.mjs";
import { liveRows } from "../logic/core.mjs";
import { PC_VERSION, isDayRecord, wageDaysOf } from "../logic/downtime.mjs";
import { earnIncomeDC } from "../logic/earn-income.mjs";
import {
    currentProfile, jobStart, jobTransitionChange, jobUndoPlan, makeProfile, mayRerollJob, profilesOf, rerollPatch,
} from "../logic/jobs.mjs";
import { makeJob } from "../logic/rolls.mjs";
import { nextDayOf, statusOf } from "./downtime.mjs";
import { lockedWrite } from "./money.mjs";
import { rollEarnIncome } from "./rolls.mjs";
import { rulesFromSettings, setting } from "./settings.mjs";
import { canWrite } from "./state.mjs";
import { newId, read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid) : null);
const pwolOn = () => game.pf2e?.settings?.variants?.pwol?.enabled === true;

/** Whether Earn Income jobs are on (14.1 `features.income`). */
export const incomeOn = () => setting("features.income") !== false;

/* -------------------------------------------- */
/*  Settlements                                  */
/* -------------------------------------------- */

/** The settlement profiles (14.2 `settlements`), sorted by name. */
export function profiles() {
    return profilesOf(setting("settlements"));
}

/** The party's current settlement profile (`meta.settlement`), or null. */
export function settlement() {
    return currentProfile(setting("settlements"), read("meta.settlement"));
}

/** Who set the current settlement and when (`meta.settlement`), or null. */
export const settlementRecord = () => read("meta.settlement") ?? null;

/**
 * Set the party's current settlement (6.10): any member, with no GM online, since it lives in the ledger; null for none.
 * Refused: `not-ready`, `no-profile`.
 */
export async function setSettlement(profileId) {
    if (!canWrite()) return refuse("not-ready");
    if (profileId && !profiles().some((p) => p.id === profileId)) return refuse("no-profile");
    await write({ replace: { "meta.settlement": { profileId: profileId ?? null, ...stampNow() } } });
    return { ok: true };
}

/** Save a settlement profile (a GM: world settings need `SETTINGS_MODIFY`). Returns its id. Refused: `not-gm`, `bad-profile`. */
export async function saveProfile(input) {
    if (!game.user.isGM) return refuse("not-gm");
    let profile;
    try {
        profile = makeProfile({ ...input, id: input.id || newId() });
    } catch {
        return refuse("bad-profile");
    }
    const all = { ...(setting("settlements") ?? {}), [profile.id]: profile };
    await game.settings.set(MODULE_ID, "settlements", all);
    return { ok: true, id: profile.id };
}

/** Delete a settlement profile (a GM). A job keeps the id of the profile it was taken in. */
export async function deleteProfile(id) {
    if (!game.user.isGM) return refuse("not-gm");
    const all = { ...(setting("settlements") ?? {}) };
    if (!all[id]) return refuse("no-profile");
    delete all[id];
    await game.settings.set(MODULE_ID, "settlements", all);
    return { ok: true };
}

/* -------------------------------------------- */
/*  Jobs                                         */
/* -------------------------------------------- */

/** The days spent on a job and the wages paid or claimed for it: what keeps its start from being undone. */
export function workedOn(jobId) {
    const days = records("days").filter((d) => isDayRecord(d) && d.job === jobId).length;
    return days + wageDaysOf(liveRows(records("rows")), records("claims"), jobId).size;
}

/** The earner's level and rank in the job's skill now (a resumed job may be rolled again after either changes). */
export function earnerNow(job) {
    const actor = actorOf(job.actor);
    if (!actor?.skills) return null;
    return { level: actor.level ?? 0, rank: actor.skills[job.skill]?.rank ?? 0 };
}

/** The DC a job at `taskLevel` in `skill` would have now (6.10). */
export function jobDC(taskLevel, skill) {
    return earnIncomeDC({ taskLevel, skill, pwol: pwolOn() }, rulesFromSettings());
}

/**
 * Start an Earn Income job (6.10), as the earner's owner: at a task level the current settlement allows for the skill
 * (any level with no settlement, marked unconfirmed, OQ-17), its DC frozen, from the earner's next open day; the earner's
 * activity becomes this job. Refused: `not-ready`, `not-owner`, `no-skill`, `untrained`, `task-level-range`,
 * `task-level-cap` (with the cap).
 * @returns {Promise<{ok: boolean, job?: string}>}
 */
export async function startJob({ actor: actorUuid, skill, taskLevel }) {
    if (!canWrite()) return refuse("not-ready");
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const statistic = actor.skills?.[skill];
    if (!statistic) return refuse("no-skill", { skill });
    if (!Number.isInteger(taskLevel)) return refuse("task-level-range", { min: 0, max: 20 });
    const profile = settlement();
    const allowed = jobStart({ taskLevel, skill, rank: statistic.rank ?? 0, profile });
    if (!allowed.ok) return allowed;
    const stamp = stampNow();
    const job = makeJob({
        id: newId(), actor: actor.uuid, skill, taskLevel, dc: jobDC(taskLevel, skill), settlement: profile?.id ?? null,
        startDay: nextDayOf(actor), party: game.actors.party?.id ?? null, unconfirmed: allowed.unconfirmed,
    }, stamp);
    const change = jobTransitionChange(job, "start", {}, stamp);
    const written = await lockedWrite([change.lock], [], {
        replace: { [`jobs.${job.id}`]: { ...job, log: { [change.seq]: change.replace[`jobs.${job.id}.log.${change.seq}`] } },
            [`pcs.${actor.id}.activity`]: { kind: "earn", ref: job.id } },
        set: { [`pcs.${actor.id}.id`]: actor.id, [`pcs.${actor.id}.v`]: PC_VERSION },
    });
    return written.ok ? { ok: true, job: job.id, unconfirmed: allowed.unconfirmed } : written;
}

/** The job, or a refusal: none, or not this user's earner's (a GM owns every actor). */
function ownJob(id) {
    if (!canWrite()) return { refusal: refuse("not-ready") };
    const job = read(`jobs.${id}`);
    if (!job) return { refusal: refuse("no-job") };
    if (!actorOf(job.actor)?.isOwner) return { refusal: refuse("not-owner") };
    return { job };
}

/** Roll the job's Earn Income check (the roll wrapper; it records itself from its chat message). */
export function rollJob(id, options = {}) {
    return rollEarnIncome(id, options);
}

/** Write a job transition behind its log slot's lock. */
async function transition(job, event, patch) {
    const change = jobTransitionChange(job, event, patch, stampNow());
    const written = await lockedWrite([change.lock], [], { set: change.set, replace: change.replace });
    return written.ok ? { ok: true } : written;
}

/**
 * Roll a resumed job again (Player Core p.228): only after the earner's level or rank in the skill changed. A new round
 * with no check, so the next roll is recorded and a reroll of the old round's message is refused. Refused: `same`.
 */
export async function rerollJob(id) {
    const { job, refusal } = ownJob(id);
    if (refusal) return refusal;
    if (!mayRerollJob(job, earnerNow(job) ?? job.check ?? {})) return refuse("same");
    return transition(job, "reroll", rerollPatch(job));
}

/** End a job (the earner moves on, or the GM's fiction ends it); days stop paying. Refused: `state` when ended already. */
export async function endJob(id) {
    const { job, refusal } = ownJob(id);
    if (refusal) return refusal;
    if (job.status === "ended") return refuse("state", { status: job.status });
    const result = await transition(job, "end", { status: "ended" });
    if (result.ok) {
        const actor = actorOf(job.actor);
        const status = actor ? statusOf(actor) : null;
        if (status?.activity?.kind === "earn" && status.activity.ref === id) await write({ set: { [`pcs.${actor.id}.activity`]: null } });
    }
    return result;
}

/**
 * Undo a job's last transition (10.1, `jobUndoPlan`): an end reopens it, a roll-again restores the earlier round and its
 * check, a start removes the job while no day was spent on it and nothing paid. The user who made it, an owner of the
 * earner, or a GM.
 */
export async function undoJob(id) {
    if (!canWrite()) return refuse("not-ready");
    const job = read(`jobs.${id}`);
    if (!job) return refuse("no-job");
    const viewer = { userId: game.user.id, isGM: game.user.isGM, owns: (uuid) => actorOf(uuid)?.isOwner === true };
    const plan = jobUndoPlan(job, viewer, { worked: workedOn(id) });
    if (!plan.ok) return plan;
    if (plan.delete) {
        // Behind the next log slot's lock, so a transition planned from the same copy cannot land on a job that is gone.
        const change = jobTransitionChange(job, "undo", {}, stampNow());
        const earner = actorOf(job.actor);
        const status = earner ? statusOf(earner) : null;
        const clear = status?.activity?.kind === "earn" && status.activity.ref === id && earner.isOwner ? { [`pcs.${earner.id}.activity`]: null } : {};
        const written = await lockedWrite([change.lock], [], { del: [`jobs.${id}`], set: clear });
        return written.ok ? { ok: true, event: "start" } : written;
    }
    return { ...(await transition(job, "undo", plan.patch)), event: plan.entry.event };
}

/** Every live job, as stored. */
export const allJobs = () => records("jobs");
