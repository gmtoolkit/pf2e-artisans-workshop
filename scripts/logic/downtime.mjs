/**
 * Downtime (DESIGN.md 4.8, 9): the workshop day, each PC's downtime status and pending days, and the day planner that
 * the day resolver, the Advance days wizard and an order's "Work a day" share. Pure: plain data in, records out.
 *
 * Days. The workshop day is the number of the latest day that has happened: `max(clockDay, manualDay)`. A PC who goes
 * into downtime on day D starts after it: days D+1 onwards are its downtime days, each pending once the workshop day
 * reaches it and until a day record covers it. So a clock advanced by one day, or the wizard advancing one day, gives
 * every PC in downtime one pending day. Nothing is written as time passes; only resolving writes.
 *
 * Records. A PC's day record is `days.<actorId>-<day>` (4.8), one per PC per resolved day; a span with nothing to record
 * ("not downtime") is one record with `toDay` set. The planner computes the same content for a day wherever it runs, so
 * a day resolved twice is one record.
 */
import { DEGREE, requireInteger } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { wageKey, wageSeq } from "./earn-income.mjs";
import { hashId } from "./ids.mjs";
import { CLOSED, DAY_VERSION, workDayRecord } from "./orders.mjs";
import { remainingCp, setupComplete, setupDaysDone } from "./progress.mjs";
import { subjectLockOf } from "./crafts.mjs";
import { eventPause, madeDespite, settledAsSuccess, setupAnywhere } from "./variants.mjs";

/** Seconds in a day of the core calendar. */
export const SECONDS_PER_DAY = 86400;

/** The per-PC status record's version (`pcs.<actorId>`). */
export const PC_VERSION = 1;

/**
 * Activities a PC's downtime day can be spent on (4.8). M6 resolves `craft` (an order the PC crafts), `help` (an order
 * the PC helps with, 6.7) and `earn` (an Earn Income job); the others are recorded as the day's activity and change
 * nothing else (`formula` is an acquisition that takes a day, `ext` an extension's, M10). M9 adds `subject`: the days a
 * tattoo's or graft's subject sits for it (6.14).
 */
export const ACTIVITY_KINDS = Object.freeze(["craft", "help", "earn", "subject", "formula", "subsist", "retrain", "prep-only", "other", "ext"]);
/** Activities that name an order or a job (`ref`). */
export const REF_KINDS = Object.freeze(["craft", "help", "earn", "subject"]);

/* -------------------------------------------- */
/*  The workshop day                             */
/* -------------------------------------------- */

/** Seconds per day of a calendar's `days` config (`hoursPerDay × minutesPerHour × secondsPerMinute`), 86,400 by default. */
export function secondsPerDayOf(days = {}) {
    const seconds = (days?.hoursPerDay ?? 24) * (days?.minutesPerHour ?? 60) * (days?.secondsPerMinute ?? 60);
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : SECONDS_PER_DAY;
}

/**
 * The day offset of pf2e's World Clock (4.8): its date is `worldCreatedOn` plus the world time, and `worldCreatedOn` was
 * captured at an arbitrary time of day (UTC), so the day boundary falls that many seconds into world time. Null when the
 * date does not parse.
 * @param {string|null} iso   `game.pf2e.settings.worldClock.worldCreatedOn`
 */
export function worldClockOffset(iso) {
    const ms = Date.parse(iso ?? "");
    if (!Number.isFinite(ms)) return null;
    const seconds = Math.floor(ms / 1000);
    return ((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

/**
 * The day offset of a calendar (4.8): how far into its day world time 0 falls, from the calendar's own components of
 * time 0 (`game.time.calendar.timeToComponents(0)`), so the day boundary is midnight of the date the table sees.
 */
export function componentsOffset({ hour = 0, minute = 0, second = 0 } = {}, days = {}) {
    const perMinute = days?.secondsPerMinute ?? 60;
    const perHour = (days?.minutesPerHour ?? 60) * perMinute;
    const offset = hour * perHour + minute * perMinute + second;
    return Number.isSafeInteger(offset) && offset >= 0 ? offset % secondsPerDayOf(days) : 0;
}

/** The clock's day: whole days of world time from the offset's midnight (4.8). */
export function clockDayOf(worldTime, { secondsPerDay = SECONDS_PER_DAY, offset = 0 } = {}) {
    if (!Number.isFinite(worldTime)) throw new TypeError(`world time must be a number, got ${worldTime}`);
    return Math.floor((worldTime + offset) / secondsPerDay);
}

/** The highest day the Advance days wizard logged (`meta.manual.<runId>.toDay`), or null. */
export function manualDayOf(manual = {}) {
    let max = null;
    for (const run of Object.values(manual ?? {})) {
        if (Number.isInteger(run?.toDay)) max = max === null ? run.toDay : Math.max(max, run.toDay);
    }
    return max;
}

/**
 * The workshop day (4.8): the maximum of the clock's day and the logged days, never the sum, so a clock advance that
 * lands inside logged days adds nothing. `ahead` is how many days the log runs ahead of the clock.
 * @returns {{day: number, clockDay: number, manualDay: number|null, ahead: number}}
 */
export function workshopDay({ clockDay, manual = {} }) {
    requireInteger(clockDay, "clockDay");
    const manualDay = manualDayOf(manual);
    return { day: manualDay === null ? clockDay : Math.max(clockDay, manualDay), clockDay, manualDay,
        ahead: manualDay === null ? 0 : Math.max(0, manualDay - clockDay) };
}

/* -------------------------------------------- */
/*  A PC's status and pending days               */
/* -------------------------------------------- */

/** A PC's status (`pcs.<actorId>`, 4.8), with defaults: not in downtime, no activity. */
export function pcStatusOf(pcs, actorId) {
    const stored = pcs?.[actorId];
    return {
        id: actorId, v: PC_VERSION, inDowntime: false, since: null, activity: null, standingRoutine: false, lockedBy: null, prepCycle: 0,
        ...(stored && typeof stored === "object" ? stored : {}),
    };
}

/** Whether a record is a PC's day record (`<actorId>-<day>`), not a variant record keyed per order (4.8). */
export const isDayRecord = (record) => !!record && typeof record.actor === "string" && Number.isInteger(record.day) &&
    record.id === `${record.actor}-${record.day}`;

/** A PC's day records, by day. */
export function dayRecordsOf(actorId, days = []) {
    return days.filter((d) => isDayRecord(d) && d.actor === actorId).sort((a, b) => a.day - b.day);
}

/** The highest day a PC's day records cover (`toDay`), or null: `resolvedThrough` of 4.8, derived, never stored. */
export function resolvedThrough(actorId, days = []) {
    let max = null;
    for (const d of dayRecordsOf(actorId, days)) {
        const to = Number.isInteger(d.toDay) ? d.toDay : d.day;
        max = max === null ? to : Math.max(max, to);
    }
    return max;
}

/**
 * The day a PC's next resolution covers: the day after its downtime started or after its last resolved day, whichever is
 * later; for a PC not in downtime (an order's "Work a day"), the day after today or after its last resolved day.
 */
export function firstOpenDay({ status, resolved = null, day }) {
    const base = status?.inDowntime && Number.isInteger(status.since) ? status.since : day;
    return Math.max(base, resolved ?? -Infinity) + 1;
}

/**
 * A PC's pending days (4.8): from its first open day through the workshop day, while it is in downtime.
 * @returns {{from: number|null, to: number|null, count: number}}
 */
export function pendingDays({ status, resolved = null, day }) {
    if (!status?.inDowntime || !Number.isInteger(status.since)) return { from: null, to: null, count: 0 };
    const from = firstOpenDay({ status, resolved, day });
    return from <= day ? { from, to: day, count: day - from + 1 } : { from: null, to: null, count: 0 };
}

/** The days from `from` through `to`, ascending; none when `to` is before `from`. */
export function daySpan(from, to) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return [];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** An activity as a key for a select (`craft:<orderId>`, `other`), and back. */
export const activityKey = (activity) => (activity ? (activity.ref ? `${activity.kind}:${activity.ref}` : activity.kind) : "");
export function parseActivity(key) {
    if (typeof key !== "string" || !key) return null;
    const [kind, ref = null] = key.split(":");
    if (!ACTIVITY_KINDS.includes(kind)) return null;
    if (REF_KINDS.includes(kind) && !ref) return null;
    return { kind, ref: REF_KINDS.includes(kind) ? ref : null };
}

/* -------------------------------------------- */
/*  Communal Crafting locks                      */
/* -------------------------------------------- */

/**
 * The order a PC is locked to as a Communal Crafting helper (6.7: from joining to the end of the Craft): an open order
 * with the PC among its helpers who has not left. Null otherwise.
 */
export function helperLockOf(orders, actorId) {
    for (const order of orders) {
        const helper = order?.helpers?.[actorId];
        if (helper && helper.leftDay == null && !CLOSED.includes(order.status)) return order.id;
    }
    return null;
}

/**
 * The order a PC is locked to (M9): as a Communal Crafting helper (`helperLockOf`), else as the subject of a tattoo or
 * graft that needs it present (`subjectLockOf`, 6.14). Null otherwise.
 */
export function lockOf(orders, actorId, actorUuid) {
    return helperLockOf(orders, actorId) ?? (actorUuid ? subjectLockOf(orders, actorUuid) : null);
}

/** Whether an activity is the one a PC's lock asks for: helping on, or sitting for, that order. */
const lockActivity = (activity, lock) => (activity?.kind === "help" || activity?.kind === "subject") && activity.ref === lock;

/* -------------------------------------------- */
/*  The day planner                              */
/* -------------------------------------------- */

/** The record of a span spent outside downtime (4.8): one record, `toDay` set, no effects. */
export function notDowntimeRecord(actorId, from, to, stamp) {
    requireInteger(from, "from");
    requireInteger(to, "to");
    return { id: `${actorId}-${from}`, v: DAY_VERSION, actor: actorId, day: from, toDay: to, activity: null, rows: [], result: "not-downtime", ...stamp };
}

/**
 * Plan a PC's days (9.1, 9.2): one day record per day, in order, for one activity, and what they cause. The planner stops
 * at the first day the activity cannot go on, and that day and the rest stay pending:
 * - `locked`: the PC is a Communal Crafting helper on another order (6.7) and must leave it first; a helper's days are
 *   never "not downtime" either, since their share is in the crafter's days (6.7: helpers stay for the whole activity);
 * - `sitting` (M9): likewise a tattoo's or graft's subject, locked to the order it consented to (6.14);
 * - `no-order`, `order-state`: the order is gone, closed, not the PC's to craft, or in a state that takes no days
 *   (accepted, paused, failed);
 * - `check`: the Craft check is due (the order reached `check`, here or earlier in the span, or its day records already
 *   complete the setup while its status still says `setup`): roll it, then go on;
 * - `settle`: the check is recorded but not settled. Its crafter's owner settles it first (the resolver does, 4.2.3), so
 *   no day is ever written at a degree a reroll could still replace (6.2.3);
 * - `paid-off`: the check settled as a success and nothing is left to take off: finish the order;
 * - `not-helping`: the PC is not (or no longer) a helper on that order;
 * - `not-subject` (M9): the PC is not the consenting subject of that order, or the order is over;
 * - `no-job`, `job-ended`: the job is gone, not the PC's, ended, or fired before this day;
 * - `income-check`: the job's Earn Income check is due (6.10: rolled after the first day; every day pays its result);
 * - `event`, `event-due` (M9a, 6.16.3): with `variants.eventsPauses`, a crafting event is open, or due and not rolled yet;
 * - `setup-hours` (M9a, 6.16.1): Quick Setup's 2-hour consumable setup waits for its "Set up now" (it takes no downtime day);
 *   any other setup of hours takes the day itself, as its `setup-hours` record.
 *
 * A craft day is the order's setup or extra day (`workDayRecord`, 6.2.3); a setup day that completes the setup moves the
 * order to `check` (`status`, for the crafter's owner to write; the crafter's responsible client writes it otherwise). A
 * help day records the
 * day spent helping: the helper's share is in the crafter's extra-day record. An earn day pays the job's daily wage
 * (`wages`, keyed `wage:<jobId>:<day>:<seq>`, 4.6); a day of a job the roll fired the earner from pays nothing.
 *
 * @param {object} p
 * @param {string} p.actorId
 * @param {string} p.actorUuid
 * @param {number[]} p.days                 the days to resolve, ascending
 * @param {{kind: string, ref?: string|null}|null} p.activity   null: the days were not downtime
 * @param {object[]} [p.orders]             every live order
 * @param {object[]} [p.jobs]               every live job
 * @param {object[]} [p.records]            every day record so far
 * @param {object[]} [p.rows]               the ledger rows (a wage's correction sequence)
 * @param {{level: number, ranks: Record<string, number>}} [p.facts]   the PC today (a crafter's rate)
 * @param {Record<string, number|null>} [p.rateLevels]  registry rate levels by order id
 * @param {{by: string, at: object}} stamp
 * @returns {{records: object[], status: Record<string, string>, wages: {job: string, day: number, cp: number, idem: string}[],
 *   stop: {day: number, reason: string, ref?: string, status?: string}|null}}
 */
export function planDays({ actorId, actorUuid, days, activity, orders = [], jobs = [], records = [], rows = [], facts = {}, rateLevels = {} },
    stamp, rules = DEFAULT_RULES) {
    const out = { records: [], status: {}, wages: [], stop: null };
    if (!days.length) return out;
    days.forEach((d) => requireInteger(d, "day"));
    const stop = (day, reason, data = {}) => {
        out.stop = { day, reason, ...data };
        return out;
    };
    const lock = lockOf(orders, actorId, actorUuid);
    // A helper is "locked"; a tattoo's or graft's subject (M9) is "sitting", so each is told in its own words.
    const locked = lock && !helperLockOf(orders, actorId) ? "sitting" : "locked";
    if (!activity) {
        if (lock) return stop(days[0], locked, { ref: lock });
        out.records.push(notDowntimeRecord(actorId, days[0], days.at(-1), stamp));
        return out;
    }
    const byId = (list) => new Map(list.map((x) => [x.id, x]));
    const orderMap = byId(orders);
    const jobMap = byId(jobs);
    const simulated = new Map();
    const orderOf = (id) => {
        if (!simulated.has(id)) simulated.set(id, orderMap.has(id) ? { ...orderMap.get(id) } : null);
        return simulated.get(id);
    };
    const all = [...records];
    for (const day of days) {
        if (lock && !lockActivity(activity, lock)) return stop(day, locked, { ref: lock });
        const base = {
            id: `${actorId}-${day}`, v: DAY_VERSION, actor: actorId, day, toDay: day,
            activity: { kind: activity.kind, ref: activity.ref ?? null }, rows: [], result: null, ...stamp,
        };
        let record = base;
        if (activity.kind === "craft") {
            const order = orderOf(activity.ref);
            if (!order || order.crafter !== actorUuid || CLOSED.includes(order.status)) return stop(day, "no-order", { ref: activity.ref });
            if (order.status === "check") return stop(day, "check", { ref: order.id });
            if (order.status === "rolled") return stop(day, "settle", { ref: order.id });
            const orderDays = all.filter((d) => d.order === order.id);
            // M9a (6.16.3): with `eventsPauses`, an open event (or one due and not rolled yet) pauses the order.
            const paused = eventPause(order, orderDays, rules);
            if (paused) return stop(day, paused, { ref: order.id });
            // M9a (6.16.1): a setup rushed below one day. Quick Setup's 2-hour consumable setup fits into an adventuring day: it takes
            // no downtime day, and its crafter records it with "Set up now". Any other (4 hours) takes this downtime day on the order,
            // recorded as the day's `setup-hours` record (review fix of M9a).
            if (order.status === "setup" && (order.setup?.hours ?? 0) > 0 && setupDaysDone(order, orderDays) >= order.setup.days &&
                !setupComplete(order, orderDays)) {
                if (setupAnywhere(order)) return stop(day, "setup-hours", { ref: order.id });
                record = { ...base, order: order.id, attempt: order.attempt, kind: "setup-hours", hours: order.setup.hours, result: "setup-hours" };
                order.status = "check";
                out.status[order.id] = "check";
                out.records.push(record);
                all.push(record);
                continue;
            }
            if (order.status === "setup" && order.setup && setupComplete(order, orderDays)) {
                // Day records completed the setup, and the crafter's client has not moved the order on yet: no more setup days.
                out.status[order.id] = "check";
                return stop(day, "check", { ref: order.id });
            }
            const settledSuccess = settledAsSuccess(order.check);
            if (order.status === "finishing" && settledSuccess && remainingCp(order, all, rules) <= 0) return stop(day, "paid-off", { ref: order.id });
            const crafter = { actorId, level: facts.level ?? 0, rank: facts.ranks?.[order.skill ?? "crafting"] ?? 0, rateLevel: rateLevels[order.id] ?? null };
            const work = ["setup", "finishing"].includes(order.status) ? workDayRecord(order, day, crafter, orderDays, stamp, rules) : null;
            if (!work) return stop(day, "order-state", { ref: order.id, status: order.status });
            record = work.record;
            if (work.patch.status) {
                order.status = work.patch.status;
                out.status[order.id] = work.patch.status;
            }
        } else if (activity.kind === "help") {
            const order = orderMap.get(activity.ref);
            const helper = order?.helpers?.[actorId];
            if (!order || !helper || CLOSED.includes(order.status) || (helper.leftDay != null && day >= helper.leftDay)) {
                return stop(day, "not-helping", { ref: activity.ref });
            }
            record = { ...base, order: order.id, result: "help" };
        } else if (activity.kind === "subject") {
            // M9 (6.14): a day the subject sits for its tattoo or graft; nothing else happens on it.
            const order = orderMap.get(activity.ref);
            if (!order || order.target !== actorUuid || !order.subject?.consented || CLOSED.includes(order.status)) {
                return stop(day, "not-subject", { ref: activity.ref });
            }
            record = { ...base, order: order.id, result: "subject" };
        } else if (activity.kind === "earn") {
            const job = jobMap.get(activity.ref);
            if (!job || job.actor !== actorUuid) return stop(day, "no-job", { ref: activity.ref });
            if (job.status === "ended") return stop(day, "job-ended", { ref: job.id });
            if (!job.check) return stop(day, "income-check", { ref: job.id });
            const fired = job.status === "fired";
            if (fired && all.some((d) => isDayRecord(d) && d.job === job.id)) return stop(day, "job-ended", { ref: job.id });
            const cp = fired ? 0 : Math.max(0, job.perDayCp ?? 0);
            const idem = cp > 0 ? wageKey(job.id, day, wageSeq(rows, job.id, day)) : null;
            record = { ...base, job: job.id, wageCp: cp, rows: idem ? [hashId(idem)] : [], result: fired ? "fired" : null };
            if (idem) out.wages.push({ job: job.id, day, cp, idem });
        }
        out.records.push(record);
        all.push(record);
    }
    return out;
}

/**
 * An order in `rolled` as settling its recorded check leaves it (4.2.3, 6.2.3): the check settled, `finishing` on a
 * success and `failed` otherwise. Only for a preview by a user who settles it first (the crafter's owner); what is
 * written always follows the real settlement. Any other order is returned as it is.
 */
export function asSettled(order) {
    if (order?.status !== "rolled" || !order.check) return order;
    const made = order.check.degree >= DEGREE.success || madeDespite(order.check.critical);   // M9a (6.16.4): made despite a critical failure
    return { ...order, check: { ...order.check, settled: true }, status: made ? "finishing" : "failed" };
}

/**
 * The span the Advance days wizard covers (9.2): "since last resolved" stops at the workshop day; a number of days
 * advances it by that many. `fromDay` is the first new day (none when nothing advances).
 * @returns {{fromDay: number|null, toDay: number, advances: number}}
 */
export function wizardSpan({ day, kind = "days", count = 1 }) {
    requireInteger(day, "day");
    if (kind === "since") return { fromDay: null, toDay: day, advances: 0 };
    requireInteger(count, "count");
    if (count < 1) throw new RangeError("the wizard advances at least one day");
    return { fromDay: day + 1, toDay: day + count, advances: count };
}

/**
 * The days of a PC the wizard (or the resolver) covers through `toDay` (9.2): its open days from its first open day.
 * Only PCs in downtime have them; a span already logged gives none, so running it again changes nothing.
 */
export function openDaysThrough({ status, resolved = null, day, toDay }) {
    if (!status?.inDowntime || !Number.isInteger(status.since)) return [];
    return daySpan(firstOpenDay({ status, resolved, day }), toDay);
}

/**
 * Wage days a job has paid or has been promised (6.10, the 6.12 follow-up): its live `wage` rows' days, and the days of
 * open wage claims for it, which pay a day at the rate it was filed at.
 * @param {object[]} live    the live ledger rows (`liveRows`)
 * @param {object[]} claims  the ledger's claims
 */
export function wageDaysOf(live, claims, jobId) {
    const days = new Set(live.filter((r) => r.kind === "wage" && r.job === jobId).map((r) => r.day));
    for (const claim of claims ?? []) {
        if (claim.kind === "wage" && claim.job === jobId && !claim.resolved && Number.isInteger(claim.day)) days.add(claim.day);
    }
    return days;
}

/**
 * What a PC's day records amount to, for a summary (the day card, the wizard's review, M6): the days covered, and one part
 * per activity and order or job, in the order first met, with its day count and money: an extra day's amount off the
 * Price (the crafter's and the helpers', before any limit or forfeit), a job's wages.
 * @returns {{days: number, from: number|null, to: number|null, parts: {kind: string, ref: string|null, n: number, cp: number}[]}}
 */
export function daysSummary(records = []) {
    const parts = new Map();
    let days = 0;
    let from = null;
    let to = null;
    for (const record of records) {
        const last = Number.isInteger(record.toDay) ? record.toDay : record.day;
        const n = last - record.day + 1;
        days += n;
        from = from === null ? record.day : Math.min(from, record.day);
        to = to === null ? last : Math.max(to, last);
        const kind = record.result === "not-downtime" ? "not-downtime"
            : record.kind === "setup" || record.kind === "extra" ? record.kind : record.activity?.kind ?? "other";
        const ref = record.order ?? record.job ?? null;
        const key = `${kind}:${ref ?? ""}`;
        const part = parts.get(key) ?? { kind, ref, n: 0, cp: 0 };
        part.n += n;
        if (kind === "extra") part.cp += (record.crafterCp ?? 0) + Object.values(record.helpers ?? {}).reduce((s, cp) => s + cp, 0);
        if (kind === "earn") part.cp += record.wageCp ?? 0;
        parts.set(key, part);
    }
    return { days, from, to, parts: [...parts.values()] };
}
