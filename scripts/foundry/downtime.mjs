/**
 * Downtime on this client (DESIGN.md 4.8, 9, M6): the workshop day, each PC's status, the day resolver, the Advance days
 * wizard's commit, the one prompt a PC's owner gets when days accrue, and the catch-up of wages a day record owes. The
 * rules are `scripts/logic/downtime.mjs`.
 *
 * Who writes what (4.2.4, P2, P3): a PC's status (`pcs.<actorId>`) only its owner; day records whoever resolves the day,
 * the PC's owner or the wizard runner, who may be any member; an order's status only the crafter's owner (a setup the
 * runner's records completed is moved to `check` by the crafter's responsible client, `scripts/foundry/orders.mjs`); a
 * wage the earner's responsible client mints, and anyone else files a wage claim (`payWage`, 6.10). A PC's days are
 * written in one request behind a lock page named by the PC and the first day (`days:<actorId>:<day>`), so of two
 * resolutions planned from the same copy (two devices, the wizard and the owner) only the first lands; the other is
 * refused ("taken") and plans again from what landed. Every resolver writes the same content for a day, so a span already
 * logged plans nothing, and running the wizard again changes nothing.
 *
 * Time passing writes nothing (9.1): pending days are derived. When the workshop day moves (the clock, or the wizard's
 * logged days), each PC in downtime with pending days gets one prompt, on its responsible client only (5.6): a
 * notification once per day and PC on this client, and the Downtime tab's badge. An owner who was offline gets it at
 * their next login.
 */
import { MODULE_ID } from "../constants.mjs";
import { liveRows } from "../logic/core.mjs";
import {
    asSettled, clockDayOf, componentsOffset, firstOpenDay, helperLockOf, isDayRecord, openDaysThrough, pcStatusOf, PC_VERSION, pendingDays, planDays,
    resolvedThrough, secondsPerDayOf, wageDaysOf, wizardSpan, workshopDay, worldClockOffset,
} from "../logic/downtime.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { subjectLockOf } from "../logic/crafts.mjs";
import { closedAs } from "../logic/orders.mjs";
import { postDaysCard } from "../ui/chat.mjs";
import { planFacts, postRow, resolvePlan } from "./extensions.mjs";
import { lockedWrite } from "./money.mjs";
import { ranksOf } from "./registry.mjs";
import { isElected, isResponsibleFor } from "./responsible.mjs";
import { payWage, settleOrder } from "./rolls.mjs";
import { members } from "./roster.mjs";
import { rulesFromSettings, setting } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { newId, read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/** Calendar modules whose date replaces pf2e's World Clock (4.8, OQ-18). */
const CALENDAR_MODULES = Object.freeze(["calendaria", "foundryvtt-simple-calendar", "simple-calendar-reborn", "seasons-and-stars", "simple-timekeeping"]);

/** Whether a calendar module is active, so its date, not pf2e's World Clock's, is the one the table sees. */
const calendarModuleActive = () => CALENDAR_MODULES.some((id) => game.modules.get(id)?.active);

/** Whether the downtime features are on (14.1 `features.downtime`). */
export const downtimeOn = () => setting("features.downtime") !== false;

/** An actor by UUID, or null. */
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid) : null);

/* -------------------------------------------- */
/*  The workshop day                             */
/* -------------------------------------------- */

/** Seconds per day of the world's calendar. */
export function secondsPerDay() {
    return secondsPerDayOf(game.time.calendar?.days);
}

/**
 * The day offset as it would be computed now (4.8): with no calendar module, from pf2e's World Clock date (its
 * `worldCreatedOn`); otherwise from the calendar's own time of day at world time 0.
 */
export function computeDayOffset() {
    const calendarModule = calendarModuleActive();
    const created = game.pf2e?.settings?.worldClock?.worldCreatedOn ?? null;
    if (!calendarModule && created) {
        const offset = worldClockOffset(created);
        if (offset !== null) return offset;
    }
    try {
        return componentsOffset(game.time.calendar?.timeToComponents?.(0) ?? {}, game.time.calendar?.days);
    } catch {
        return 0;
    }
}

/** The day offset every client uses: frozen in `meta.dayOffset` the first time it is computed (4.8). */
export function dayOffset() {
    const stored = read("meta.dayOffset");
    return Number.isInteger(stored) ? stored : computeDayOffset();
}

/** Freeze the day offset in the ledger, once (any client that may write; two writing at once write the same). */
export async function freezeDayOffset() {
    if (!canWrite() || Number.isInteger(read("meta.dayOffset"))) return false;
    return write({ set: { "meta.dayOffset": computeDayOffset() } });
}

/** The clock's day now. */
export function clockDayNow() {
    return clockDayOf(game.time.worldTime ?? 0, { secondsPerDay: secondsPerDay(), offset: dayOffset() });
}

/** The workshop day now (4.8): `{day, clockDay, manualDay, ahead}`, and `behind` when the clock was set back. */
export function today() {
    const now = workshopDay({ clockDay: clockDayNow(), manual: read("meta.manual") ?? {} });
    const high = read("meta.clockHigh");
    return { ...now, behind: Number.isInteger(high) && high > now.clockDay ? high - now.clockDay : 0 };
}

/**
 * Remember the highest clock day seen (`meta.clockHigh`), so the Downtime tab can say when the clock was set back (4.8:
 * nothing is undone). Timer-driven shared work, so only the elected client writes it (5.6).
 */
async function noteClockHigh() {
    if (!canWrite() || !isElected()) return;
    const clock = clockDayNow();
    const high = read("meta.clockHigh");
    if (!Number.isInteger(high) || clock > high) await write({ set: { "meta.clockHigh": clock } });
}

/**
 * The date the table sees, for the header and the Downtime tab (10.2): pf2e's World Clock's (`dateAsString`, its own
 * words for the date), or null when a calendar module shows the date instead, or there is no World Clock.
 */
export function worldDate() {
    if (calendarModuleActive()) return null;
    try {
        const date = game.pf2e?.worldClock?.dateAsString;
        return typeof date === "string" && date ? date : null;
    } catch {
        return null;
    }
}

/**
 * A watcher of the clock's day: whether it changed since the watcher last looked (true the first time). World time moves
 * every combat round and with a calendar module's running clock; only a new day changes the workshop day (9.1), so the
 * `updateWorldTime` handlers do their work only then.
 */
export function dayWatcher() {
    let last = null;
    return () => {
        let day;
        try {
            day = clockDayNow();
        } catch {
            return true;
        }
        if (day === last) return false;
        last = day;
        return true;
    };
}

/* -------------------------------------------- */
/*  A PC's status                                */
/* -------------------------------------------- */

/** A PC's status (4.8). */
export function statusOf(actor) {
    return pcStatusOf(read("pcs") ?? {}, actor.id);
}

/** A PC's resolved-through day, from its day records. */
export function resolvedOf(actor) {
    return resolvedThrough(actor.id, records("days"));
}

/** A PC's pending days now: `{from, to, count}`. */
export function pendingOf(actor, now = today()) {
    return pendingDays({ status: statusOf(actor), resolved: resolvedOf(actor), day: now.day });
}

/** The day a PC's next resolution covers. */
export function nextDayOf(actor, now = today()) {
    return firstOpenDay({ status: statusOf(actor), resolved: resolvedOf(actor), day: now.day });
}

/** The status fields written with every change, so the record is never a stub (5.3.3). */
const statusBase = (actor, stamp) => ({ [`pcs.${actor.id}.id`]: actor.id, [`pcs.${actor.id}.v`]: PC_VERSION, [`pcs.${actor.id}.by`]: stamp.by,
    [`pcs.${actor.id}.at`]: stamp.at });

/**
 * Put a PC in downtime or take it out (4.8), as its owner. In: its downtime starts after today. Out: refused as `helping`
 * while the PC is a Communal Crafting helper (6.7: helpers stay for the whole Craft; leave the order first), as `subject`
 * (M9) while it sits for a tattoo or graft (6.14); with days
 * still pending, refused as `days-pending` (with the count) unless `notDowntime`, which records the pending span as one
 * "not downtime" record, with no effects; resolve them first otherwise.
 */
export async function setDowntime(actorUuid, on, { notDowntime = false } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const status = statusOf(actor);
    const stamp = stampNow();
    if (on) {
        if (status.inDowntime) return { ok: true, outcome: "already" };
        await write({ set: { ...statusBase(actor, stamp), [`pcs.${actor.id}.inDowntime`]: true, [`pcs.${actor.id}.since`]: today().day } });
        return { ok: true, outcome: "ok" };
    }
    if (!status.inDowntime) return { ok: true, outcome: "already" };
    const lock = helperLockOf(records("orders"), actor.id);
    if (lock) return refuse("helping", { order: lock });
    // M9 (6.14): a tattoo's or graft's subject sits for it until it is done, or withdraws its consent before it starts.
    const subject = subjectLockOf(records("orders"), actor.uuid);
    if (subject) return refuse("subject", { order: subject });
    const pending = pendingOf(actor);
    if (pending.count > 0 && !notDowntime) return refuse("days-pending", { count: pending.count });
    const off = { ...statusBase(actor, stamp), [`pcs.${actor.id}.inDowntime`]: false };
    if (pending.count === 0) {
        await write({ set: off });
        return { ok: true, outcome: "ok" };
    }
    const plan = planDays({ actorId: actor.id, actorUuid: actor.uuid, days: [pending.from, pending.to], activity: null }, stamp);
    return writePlan(actor, plan, { extra: off });
}

/** Set a PC's current activity (4.8), as its owner: what its days continue by default. */
export async function setActivity(actorUuid, activity) {
    if (!canWrite()) return refuse("not-ready");
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    // M10: an Aid to another PC's run of an extension activity keeps whom it aids.
    const value = activity ? { kind: activity.kind, ref: activity.ref ?? null, ...(activity.kind === "ext" && activity.aid ? { aid: activity.aid } : {}) } : null;
    const set = { ...statusBase(actor, stampNow()), ...(value ? {} : { [`pcs.${actor.id}.activity`]: null }) };
    await write({ set, replace: value ? { [`pcs.${actor.id}.activity`]: value } : {} });
    return { ok: true };
}

/* -------------------------------------------- */
/*  Resolving days                               */
/* -------------------------------------------- */

/**
 * A PC's level and ranks for the planner: from the actor when this user may read it, else from its roster snapshot
 * (4.10), which every member can read.
 */
function factsOf(actor) {
    if (actor.isOwner || game.user.isGM) return { level: actor.level ?? 0, ranks: ranksOf(actor) };
    const roster = read(`roster.${actor.id}`);
    return { level: roster?.level ?? actor.level ?? 0, ranks: roster?.skills ?? {} };
}

/** Whether this user settles an order before its next day (4.2.3): it is `rolled` and this user owns its crafter. */
const settlesFirst = (order) => order?.status === "rolled" && actorOf(order.crafter)?.isOwner === true && !closedAs(order);

/**
 * What resolving a PC's days with an activity would write, without settling or writing anything (the wizard's review).
 * An order this user settles first (`settlesFirst`) is previewed as its settlement leaves it (`asSettled`); everyone else
 * sees the days stop at `settle`, as they will.
 */
export function previewDays(actor, days, activity, { simulate = true } = {}) {
    const orders = records("orders").map((o) => (simulate && activity?.kind === "craft" && o.id === activity.ref && settlesFirst(o) ? asSettled(o) : o));
    return planDays({
        actorId: actor.id, actorUuid: actor.uuid, days, activity, orders, jobs: records("jobs"), records: records("days"),
        rows: records("rows"), facts: factsOf(actor), ext: planFacts(actor),
    }, stampNow(), rulesFromSettings());
}

/**
 * Plan a PC's days with one activity (`planDays`). An order whose check is recorded but not settled is settled first
 * when this user owns its crafter (4.2.3: settlement comes with the order's next day); for anyone else the planner stops
 * at `settle` and the days wait for the crafter's owner, so no day is written at a degree a reroll could still replace.
 */
async function planFor(actor, days, activity) {
    if (activity?.kind === "craft") {
        const order = read(`orders.${activity.ref}`);
        if (settlesFirst(order)) {
            const settled = await settleOrder(order.id);
            if (!settled.ok) return { refusal: settled };
        }
    }
    return { plan: previewDays(actor, days, activity, { simulate: false }) };
}

/**
 * Write a PC's planned days in one request behind its lock page (`days:<actorId>:<first day>`): the day records, an
 * order's move to `check` when this user owns its crafter, and `extra` keys (a status change). Then each wage: minted by
 * the earner's responsible client, a claim otherwise (`payWage`); a wage that does not land is paid by the sweep
 * (`sweepWages`), since the day record says what it owes. M10: the extension runs the plan finishes are resolved first
 * (`resolvePlan`): their store writes go in the same request, their rows (and the per-day income sources') on the
 * records, posted after the write (`postRow`) and by the sweep (`sweepExtRows`) if they do not land.
 */
async function writePlan(actor, plan, { extra = {} } = {}) {
    const moves = {};
    for (const [id, next] of Object.entries(plan.status)) {
        const order = read(`orders.${id}`);
        if (order && !closedAs(order) && actorOf(order.crafter)?.isOwner) moves[`orders.${id}.status`] = next;
    }
    if (!plan.records.length) {
        // No day to write, but a setup earlier records completed is moved on now (the derived move of 4.2.3).
        if (Object.keys(moves).length) await write({ set: moves });
        return { ok: true, outcome: plan.stop ? "stopped" : "nothing", records: [], stop: plan.stop, wages: [] };
    }
    const set = { ...extra, ...moves };
    const ext = await resolvePlan(actor, plan);
    const replace = Object.fromEntries(plan.records.map((record) => [`days.${record.id}`, record]));
    const lock = hashId(idemKey("days", actor.id, plan.records[0].day));
    const written = await lockedWrite([lock], [], { set, replace, scopes: ext.scopes });
    if (!written.ok) return written;
    const wages = [];
    for (const wage of plan.wages) wages.push({ ...wage, result: await payWage(wage.job, wage.day, { cp: wage.cp }) });
    const extRows = [];
    for (const input of ext.rows) extRows.push({ idem: input.idem, result: await postRow(input) });
    return { ok: true, outcome: "ok", records: plan.records, stop: plan.stop, wages, extRows };
}

/** The hook payloads of 12.3 for a set of plans, by day: who is resolved that day, with what. */
function dayHooks(entries, mode) {
    const byDay = new Map();
    for (const { actor, activity, plan } of entries) {
        for (const record of plan.records) {
            const list = byDay.get(record.day) ?? [];
            list.push({ actor, activity, record });
            byDay.set(record.day, list);
        }
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, list]) => ({
        start: Object.freeze({ day, mode, actors: list.map((e) => e.actor.uuid),
            assignments: Object.fromEntries(list.map((e) => [e.actor.id, e.activity ? { ...e.activity } : null])) }),
        // Made when it fires, after the write: an extension run's rows and notes are on the record by then (M10).
        end: () => Object.freeze({ day, results: Object.fromEntries(list.map((e) => [e.actor.id, { activity: e.activity ? { ...e.activity } : null,
            rows: [...(e.record.rows ?? []), ...(e.record.extRows ?? []).map((r) => hashId(r.idem))],
            // M10: an extension run's notes on its last day (`resolve(ctx).notes`); otherwise the day's result code.
            notes: e.record.extNotes ? [...e.record.extNotes] : e.record.result ?? null,
            ...(e.record.ext ? { ext: { ...e.record.ext } } : {}) }])) }),
    }));
}

/** An assignment as the planner takes it: an activity, null for "not downtime", or undefined to leave the days alone. */
function activityOfChoice(choice) {
    if (choice === "not-downtime") return null;
    if (choice && typeof choice === "object" && choice.kind) {
        return { kind: choice.kind, ref: choice.ref ?? null, ...(choice.kind === "ext" && choice.aid ? { aid: choice.aid } : {}) };
    }
    return undefined;
}

/**
 * Resolve a PC's days (9.1): its pending days (or `count` of them, or through `through`) with one activity, by default its
 * current one ("not-downtime" records them as not downtime). Writes as `writePlan`; stops where `planDays` stops, leaving
 * the rest pending. Any member may resolve any PC's days (the wizard runner's right, 9.2); the PC's status stays its
 * owner's. `mode` "work" is an order's "Work a day" (no summary card). Refused: `not-ready`, `no-actor`, `no-activity`,
 * `no-days`, and the write's refusals ("taken": another resolution of these days landed first).
 * @returns {Promise<{ok: boolean, records?: object[], stop?: object|null, wages?: object[]}>}
 */
export async function resolveDays({ actor: actorRef, activity = undefined, count = null, through = null, mode = "resolver" } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const actor = typeof actorRef === "string" ? actorOf(actorRef) : actorRef;
    if (!actor) return refuse("no-actor");
    const chosen = activityOfChoice(activity === undefined ? statusOf(actor).activity : activity);
    if (chosen === undefined) return refuse("no-activity");
    const now = today();
    const from = nextDayOf(actor, now);
    const to = through ?? (Number.isInteger(count) && count > 0 ? from + count - 1 : pendingOf(actor, now).to);
    if (!Number.isInteger(to) || to < from) return refuse("no-days");
    const days = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const planned = await planFor(actor, days, chosen);
    if (planned.refusal) return planned.refusal;
    const hooks = dayHooks([{ actor, activity: chosen, plan: planned.plan }], mode);
    for (const { start } of hooks) Hooks.callAll("pf2e-artisans-workshop.downtimeDayStart", start);
    const result = await writePlan(actor, planned.plan);
    if (result.ok && result.records.length) {
        for (const { end } of hooks) Hooks.callAll("pf2e-artisans-workshop.downtimeDayEnd", end());
        if (mode !== "work") await postDaysCard([{ actor, ...result }], { toDay: to });
    }
    return result;
}

/** The PCs in downtime, of the Workshop's members. */
export function downtimeMembers() {
    return members().filter((actor) => statusOf(actor).inDowntime);
}

/**
 * The Advance days wizard's commit (9.2): for every PC in downtime, its open days through the span's last day with the
 * activity assigned to it (`assignments[actorId]`: an activity, "not-downtime", or "skip" to leave its days to
 * its owner; its current activity by default, and "skip" when it has none), written per PC; then the logged-day mark `meta.manual.<runId>` when the
 * span advances the day, and, for a GM who asks, the world clock moved to match (only GMs and assistant GMs may move it,
 * 9.1). A span already logged writes nothing. One summary card.
 *
 * The wizard passes the span its user reviewed: `through`, its last day, and `base`, the workshop day it was counted
 * from. If the day moved on meanwhile (another user's run, the clock), nothing is written and the commit is refused as
 * `moved` (with the day now), so two people advancing "one day" at once never advance two.
 *
 * @param {object} p
 * @param {"days"|"since"} [p.kind]
 * @param {number} [p.count]
 * @param {number|null} [p.through]   the span's last day (instead of `kind` and `count`)
 * @param {number|null} [p.base]      the workshop day the span was counted from
 * @param {Record<string, object|null|"skip">} [p.assignments]
 * @param {boolean} [p.advanceClock]
 */
export async function advanceDays({ kind = "days", count = 1, through = null, base = null, assignments = {}, advanceClock = false } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const now = today();
    if (Number.isInteger(base) && base !== now.day) return refuse("moved", { day: now.day });
    let span;
    if (Number.isInteger(through)) {
        span = { fromDay: now.day + 1, toDay: through, advances: Math.max(0, through - now.day) };
    } else {
        try {
            span = wizardSpan({ day: now.day, kind, count });
        } catch {
            return refuse("no-days");
        }
    }
    const planned = [];
    for (const actor of downtimeMembers()) {
        // Its current activity by default; with none, or "skip", its days are left to its owner.
        const choice = activityOfChoice(Object.hasOwn(assignments, actor.id) ? assignments[actor.id] : statusOf(actor).activity);
        if (choice === undefined) continue;
        const days = openDaysThrough({ status: statusOf(actor), resolved: resolvedOf(actor), day: now.day, toDay: span.toDay });
        if (!days.length) continue;
        const result = await planFor(actor, days, choice);
        planned.push({ actor, activity: choice, plan: result.plan ?? null, refusal: result.refusal ?? null });
    }
    for (const { start } of dayHooks(planned.filter((p) => p.plan), "wizard")) Hooks.callAll("pf2e-artisans-workshop.downtimeDayStart", start);
    const results = [];
    // M10 review: `downtimeDayEnd` tells only of the days this client wrote; a PC whose write was refused ("taken": another
    // client resolved those days first, and announced them) or failed is left out, and a day nobody's write landed for
    // ends with no hook.
    const written = [];
    for (const entry of planned) {
        const result = entry.refusal ?? await writePlan(entry.actor, entry.plan);
        results.push({ actor: entry.actor, ...result });
        if (!entry.refusal && result.ok && result.records?.length) written.push(entry);
    }
    const hooks = dayHooks(written, "wizard");
    if (span.advances > 0) {
        const runId = newId();
        await write({ set: { [`meta.manual.${runId}`]: { id: runId, v: 1, fromDay: span.fromDay, toDay: span.toDay, ...stampNow() } } });
    }
    let clock = null;
    if (advanceClock && game.user.isGM && span.toDay > now.clockDay) {
        await game.time.advance((span.toDay - now.clockDay) * secondsPerDay());
        clock = span.toDay;
    }
    for (const { end } of hooks) Hooks.callAll("pf2e-artisans-workshop.downtimeDayEnd", end());
    if (results.some((r) => r.records?.length)) await postDaysCard(results, { toDay: span.toDay });
    return { ok: true, toDay: span.toDay, clock, results };
}

/**
 * "Advance clock to match" (4.8), for a GM: move the world clock forward to the logged days. Refused: `not-gm`,
 * `nothing` (the clock is not behind the log).
 */
export async function advanceClockToMatch() {
    if (!game.user.isGM) return refuse("not-gm");
    const now = today();
    if (!(now.ahead > 0)) return refuse("nothing");
    await game.time.advance(now.ahead * secondsPerDay());
    return { ok: true, days: now.ahead };
}

/* -------------------------------------------- */
/*  Wages a day record owes                      */
/* -------------------------------------------- */

/**
 * Pay what day records owe (P5, a sweep step): a day record of an Earn Income job with a wage and neither a live wage
 * row nor an open wage claim for that day, written by a resolution whose wage did not land. Only the earner's
 * responsible client pays, by minting (`payWage`); every other client leaves it to that one.
 * @returns {Promise<number>}  wages paid
 */
export async function sweepWages() {
    if (!canWrite() || !downtimeOn()) return 0;
    const live = liveRows(records("rows"));
    const claims = records("claims");
    let paid = 0;
    const promised = new Map();
    for (const record of records("days")) {
        if (!isDayRecord(record) || !record.job || !(record.wageCp > 0)) continue;
        const job = read(`jobs.${record.job}`);
        const earner = job ? actorOf(job.actor) : null;
        if (!earner || !isResponsibleFor(earner)) continue;
        if (!promised.has(job.id)) promised.set(job.id, wageDaysOf(live, claims, job.id));
        if (promised.get(job.id).has(record.day)) continue;
        const result = await payWage(job.id, record.day, { cp: record.wageCp });
        if (result.ok && result.outcome === "ok") paid += 1;
    }
    return paid;
}

/* -------------------------------------------- */
/*  The prompt when days accrue                  */
/* -------------------------------------------- */

/** PCs and days this client has prompted about this session, as `<actorId>:<day>`. */
const prompted = new Set();

/**
 * Prompt about pending days (9.1): for each member PC in downtime with pending days whose responsible client this is,
 * one notification per workshop day on this client. Returns the PCs prompted.
 */
export function promptPending() {
    if (!canWrite() || !downtimeOn()) return [];
    const now = today();
    const out = [];
    for (const actor of members()) {
        const pending = pendingOf(actor, now);
        if (!pending.count || !isResponsibleFor(actor)) continue;
        const key = `${actor.id}:${now.day}`;
        if (prompted.has(key)) continue;
        prompted.add(key);
        out.push(actor);
        ui.notifications.info(pending.count === 1 ? "pf2e-artisans-workshop.Downtime.PromptOne" : "pf2e-artisans-workshop.Downtime.Prompt",
            { format: { actor: actor.name, count: String(pending.count) } });
    }
    return out;
}

let promptTimer = null;
/**
 * Prompt after changes settle: a clock advance and the wizard's writes arrive as several updates. A prompt already due
 * is not put off again, so a stream of updates (a running clock) cannot starve it.
 */
function schedulePrompt(delay = 1000) {
    if (promptTimer !== null) return;
    promptTimer = setTimeout(() => {
        promptTimer = null;
        noteClockHigh().catch((error) => console.warn(`${MODULE_ID} | could not note the clock`, error));
        promptPending();
    }, delay);
}

/**
 * The downtime hooks, at `init`: the world clock reaching a new day (`updateWorldTime`, every client), the ledger's logged days,
 * statuses or day records changing, and this client's status turning "ready" (the offset is frozen then, and an owner who
 * was away is told about the days that accrued meanwhile).
 */
export function registerDowntimeHooks() {
    const dayMoved = dayWatcher();
    Hooks.on("updateWorldTime", () => {
        if (dayMoved()) schedulePrompt();
    });
    Hooks.on("updateJournalEntry", (doc, changed) => {
        if (doc !== shared().ledger) return;
        const flags = changed.flags?.[MODULE_ID] ?? {};
        if ("pcs" in flags || "days" in flags || "manual" in (flags.meta ?? {})) schedulePrompt();
    });
    Hooks.on("pf2e-artisans-workshop.status", (now) => {
        if (now !== "ready") return;
        freezeDayOffset().catch((error) => console.warn(`${MODULE_ID} | could not freeze the day offset`, error));
        schedulePrompt(2000);
    });
}

/** For tests only. */
export function resetDowntime() {
    prompted.clear();
    clearTimeout(promptTimer);
    promptTimer = null;
}
