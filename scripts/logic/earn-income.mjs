/**
 * Earn Income jobs (DESIGN.md 4.9, 6.10; Player Core p.228, GM Core p.53): task levels and settlement
 * profiles, the DC, what each degree pays, Experienced Professional's failure pay, resuming a job, the
 * idempotent wage key, the downtime-check guardrail and cost of living.
 *
 * Degree conversions that items and feats make through rule elements (Experienced Professional's and the
 * Tradecraft Tattoo's critical failure to failure) happen in the system's roll, which the module's own roll
 * gives `action:earn-income` so they fire; the degree passed here is already adjusted, and nothing here
 * converts it a second time.
 */
import { COST_OF_LIVING } from "../data/services.mjs";
import { SETTLEMENT_TASK_LEVELS, TASK_LEVEL_MAX, TASK_LEVEL_MIN } from "../data/settlements.mjs";
import { DEGREE, RANK, liveRows, requireInteger } from "./core.mjs";
import { levelDC } from "./dc.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { incomePerDay } from "./income.mjs";

/** Whether a skill slug is a Lore: pf2e lore skill slugs end in "-lore". */
export const isLore = (skill) => skill.endsWith("-lore");

/** The skills that Earn Income at the ordinary DC: Crafting, Performance and any Lore (Player Core p.228). */
export const isUsualIncomeSkill = (skill) => skill === "crafting" || skill === "performance" || isLore(skill);

/**
 * A settlement profile with the default highest task level for its size (GM Core p.53): the top of the
 * size's range. The GM edits profiles in the settings; `caps` holds per-skill exceptions (a port's Sailing
 * Lore).
 */
export function defaultSettlementProfile(size) {
    const range = SETTLEMENT_TASK_LEVELS[size];
    if (!range) throw new RangeError(`unknown settlement size ${size}`);
    return { size, level: range[1], caps: {} };
}

/** The highest task level a profile offers for a skill: its exception for that skill, else its level. */
export function maxTaskLevel(profile, skill) {
    return profile.caps?.[skill] ?? profile.level;
}

/**
 * Whether the earner may take a job at `taskLevel` (6.10): 0..20, and at most the current settlement
 * profile's highest level for the skill; lower levels are always allowed. With no profile set, any level
 * is allowed and the job is marked `unconfirmed` (OQ-17).
 *
 * @returns {{ok: boolean, reason?: string, data?: object, unconfirmed: boolean}}
 */
export function checkTaskLevel({ taskLevel, skill, profile = null }) {
    requireInteger(taskLevel, "taskLevel");
    if (taskLevel < TASK_LEVEL_MIN || taskLevel > TASK_LEVEL_MAX) {
        return { ok: false, reason: "task-level-range", data: { min: TASK_LEVEL_MIN, max: TASK_LEVEL_MAX }, unconfirmed: false };
    }
    if (!profile) return { ok: true, unconfirmed: true };
    const max = maxTaskLevel(profile, skill);
    if (taskLevel > max) return { ok: false, reason: "task-level-cap", data: { max }, unconfirmed: false };
    return { ok: true, unconfirmed: false };
}

/**
 * The DC of an Earn Income job: the task level's DC (Proficiency without Level applies), plus the GM's
 * adjustments, plus the "other skill" bump (`earnIncomeOtherSkillDc`, default +5, OQ-17) for skills other
 * than Crafting, Performance and Lore (Player Core p.228: "significantly higher").
 */
export function earnIncomeDC({ taskLevel, skill, pwol = false, adjust = 0 }, rules = DEFAULT_RULES) {
    const otherSkill = isUsualIncomeSkill(skill) ? 0 : rules.earnIncomeOtherSkillDc;
    return levelDC(taskLevel, { pwol }) + adjust + otherSkill;
}

/**
 * The pay for each day of a job (6.10): a critical success pays task level + 1 (at 20, the extra row), a
 * success the task level, a failure the failure column, a critical failure nothing.
 *
 * Experienced Professional doubles failure pay when the skill is a Lore, the earner is expert or better in
 * it, and the roll was not originally a critical failure (`unadjusted`, pf2e's
 * `flags.pf2e.context.unadjustedOutcome` as a degree). The system's dialog skips the rank check.
 *
 * @param {object} p
 * @param {number} p.taskLevel
 * @param {number} p.rank        the earner's rank in the skill
 * @param {number} p.degree      the adjusted degree
 * @param {number} [p.unadjusted]
 * @param {string} p.skill
 * @param {boolean} [p.experiencedProfessional]  the earner has the feat (`FEAT.experiencedProfessional`)
 */
export function wagePerDay({ taskLevel, rank, degree, unadjusted = degree, skill, experiencedProfessional = false }) {
    const pay = incomePerDay(taskLevel, rank, degree);
    const doubles = degree === DEGREE.fail && experiencedProfessional && isLore(skill) &&
        rank >= RANK.expert && unadjusted !== DEGREE.critFail;
    return doubles ? pay * 2 : pay;
}

/**
 * A job's status after its roll (6.10): a critical failure gets the earner fired; a failure keeps the job
 * but marks it as likely to be shortened (a note; the GM can end it).
 */
export function jobAfterRoll(degree) {
    if (degree === DEGREE.critFail) return { status: "fired", shortened: false };
    return { status: "open", shortened: degree === DEGREE.fail };
}

/**
 * Resuming a paused job (Player Core p.228): the roll is kept, and the earner may roll again only if their
 * level or rank in the skill changed since. A fired earner cannot resume.
 *
 * @param {{status: string, check: {level: number, rank: number}}} job
 * @param {{level: number, rank: number}} now
 */
export function resumeJob(job, now) {
    if (job.status === "fired") return { ok: false, reason: "fired" };
    const changed = now.level !== job.check.level || now.rank !== job.check.rank;
    return { ok: true, keepCheck: true, mayReroll: changed };
}

/**
 * The idempotency key of one day's wage (4.6, 6.10): `wage:<jobId>:<day>:<seq>`. The row id is a hash of it
 * (M2). `seq` is `wageSeq`: 0 for the first payment of the day, one more after each undo, so a corrected
 * wage gets a fresh key and lock page while two clients paying the same day still agree on one.
 */
export function wageKey(jobId, day, seq) {
    return `wage:${jobId}:${requireInteger(day, "day")}:${requireInteger(seq, "seq")}`;
}

/** How many of a job's wages for `day` have been reversed (undone), from its rows: the next wage's `seq`. */
export function wageSeq(rows, jobId, day) {
    const live = new Set(liveRows(rows));
    return rows.filter((r) => r.kind === "wage" && r.job === jobId && r.day === day && !live.has(r)).length;
}

/**
 * Days a job has paid, from its `wage` rows: one per distinct day (4.9). Rows are `{id, kind, job, day}`;
 * reversed rows and reversals do not count (`liveRows`).
 */
export function daysPaid(rows, jobId) {
    return new Set(liveRows(rows).filter((r) => r.kind === "wage" && r.job === jobId).map((r) => r.day)).size;
}

/**
 * What to do when a downtime check would use a fortune effect (a Hero Point reroll is one) or an activated
 * bonus, which GM Core p.46 rules out: "warn" (default) or "block" by `downtimeRerolls`; null otherwise.
 */
export function downtimeCheckGuard({ fortune = false, activated = false }, rules = DEFAULT_RULES) {
    return fortune || activated ? rules.downtimeRerolls : null;
}

/**
 * Cost of living for a standard and a period (Player Core p.295), in cp; deducted after income when the
 * `costOfLiving` setting is on (GM Core p.50). Subsisting costs nothing and is not a standard.
 */
export function costOfLivingCp(standard, period = "week") {
    const cost = COST_OF_LIVING[standard]?.[period];
    if (cost === undefined) throw new RangeError(`unknown cost of living ${standard}/${period}`);
    return cost;
}
