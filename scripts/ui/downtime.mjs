/**
 * The Downtime tab (DESIGN.md 10.1, 4.8, 6.7, 6.10, 9, M6) and the helpers section of an order's detail.
 *
 * - The workshop day and the world date, days logged ahead of the clock (a GM may move the clock to match), and a clock
 *   that was set back.
 * - One row per PC: a player sees their own characters, a GM every member. In downtime or not (the owner switches it),
 *   the current activity (the owner chooses it: an order the PC crafts, one it helps with, an Earn Income job, or another
 *   activity), the days pending and the last day resolved, a helper's lock, and "Resolve" (the day resolver for that PC).
 * - "Advance days": the wizard (`advance.mjs`), which any member may run.
 * - The current settlement, which any member sets, with who set it; for a GM, the settlement profiles that cap task levels.
 * - Earn Income jobs (own for a player, all for a GM): skill, task level, DC (when pf2e shows DCs), the check, pay per day,
 *   days paid, roll, roll again after a level or rank change, end, undo; and the form that starts one.
 *
 * The window keeps the tab's state (`app.downtime`): the job form's choices and the settlement profile a GM is editing.
 */
import { helperRate } from "../logic/communal.mjs";
import { DEGREE, liveRows } from "../logic/core.mjs";
import { activityKey, helperLockOf, parseActivity, lockOf } from "../logic/downtime.mjs";
import { daysPaid, maxTaskLevel, wagePerDay } from "../logic/earn-income.mjs";
import { jobActions, SETTLEMENT_SIZES } from "../logic/jobs.mjs";
import { CLOSED } from "../logic/orders.mjs";
import { eligibility, helpSkills, joinOrder, leaveOrder, acceptHelper, rollHelp } from "../foundry/communal.mjs";
import {
    advanceClockToMatch, downtimeOn, nextDayOf, pendingOf, resolvedOf, setActivity, setDowntime, statusOf, today, worldDate,
} from "../foundry/downtime.mjs";
import {
    deleteProfile, earnerNow, endJob, incomeOn, jobDC, profiles, rerollJob, rollJob, saveProfile, setSettlement, settlement, settlementRecord,
    startJob, undoJob, workedOn,
} from "../foundry/jobs.mjs";
import { owns, viewer as currentViewer } from "../foundry/orders.mjs";
import { activityChoices } from "../foundry/extensions.mjs";
import { members } from "../foundry/roster.mjs";
import { rulesFromSettings } from "../foundry/settings.mjs";
import { canWrite } from "../foundry/state.mjs";
import { read, records } from "../foundry/store.mjs";
import { showDcs } from "./context.mjs";
import { activityText, orderName } from "./days.mjs";
import { money, number, rankName, report, skillName, userName, when } from "./format.mjs";
import { ACTIVITY, DEGREE_CLASS, DEGREE_KEY, HELPER_REASON, JOB_STATUS, SETTLEMENT_SIZE } from "./labels.mjs";
import { askChoice, confirm } from "./prompts.mjs";
import { harvestView } from "./variants.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const plural = (n, key) => (n === 1 ? `${key}One` : key);
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);

/** Activities without an order or job that the tab offers (the others are not built yet, 4.8). */
const PLAIN_ACTIVITIES = Object.freeze(["subsist", "retrain", "other"]);
/** Order states in which a crafter's days go to the order. */
const WORKING = Object.freeze(["setup", "check", "rolled", "finishing"]);

/** Whether other members' ranks may be shown to this user (4.10: hidden while pf2e's party stats are off). */
const showRanks = () => game.user.isGM || game.pf2e?.settings?.metagame?.partyStats !== false;

/** The tab's state, with defaults. */
export function downtimeState(app) {
    app.downtime ??= { jobActor: null, jobSkill: null, jobLevel: null, profile: null, capSkill: null, capLevel: null };
    return app.downtime;
}

/**
 * The activities a PC's days can go to (4.8), as select options: the orders it crafts that take days, the orders it helps
 * with, the tattoo or graft it sits for (M9), its open Earn Income jobs, and the plain activities; `extra` adds the wizard's "leave for the owner" and "not
 * downtime".
 */
export function activityOptions(actor, current, { extra = [] } = {}) {
    const options = [];
    for (const order of records("orders")) {
        if (order.crafter === actor.uuid && WORKING.includes(order.status)) options.push({ kind: "craft", ref: order.id });
        const helper = order.helpers?.[actor.id];
        if (helper && helper.leftDay == null && !CLOSED.includes(order.status)) options.push({ kind: "help", ref: order.id });
        // M9 (6.14): the tattoo or graft this PC sits for.
        if (order.subject?.consented && order.target === actor.uuid && order.crafter !== actor.uuid && !CLOSED.includes(order.status)) {
            options.push({ kind: "subject", ref: order.id });
        }
    }
    if (incomeOn()) for (const job of records("jobs")) if (job.actor === actor.uuid && job.status === "open") options.push({ kind: "earn", ref: job.id });
    // M10 (12.2): the extensions' downtime activities, and an Aid to another member whose days go to one that has an Aid.
    for (const { def } of activityChoices(actor)) {
        options.push({ kind: "ext", ref: def.id });
        if (!def.aid) continue;
        for (const other of members()) {
            const theirs = other.id !== actor.id ? statusOf(other).activity : null;
            if (theirs?.kind === "ext" && theirs.ref === def.id && !theirs.aid) options.push({ kind: "ext", ref: def.id, aid: other.id });
        }
    }
    for (const kind of PLAIN_ACTIVITIES) options.push({ kind, ref: null });
    const key = typeof current === "string" ? current : activityKey(current);
    return [
        ...extra.map((value) => ({ value, label: loc(ACTIVITY[value]), selected: key === value })),
        ...options.map((a) => ({ value: activityKey(a), label: activityText(a), selected: key === activityKey(a) })),
    ];
}

/* -------------------------------------------- */
/*  The tab                                      */
/* -------------------------------------------- */

/** One PC's row. */
function pcRow(actor, now) {
    const status = statusOf(actor);
    const pending = pendingOf(actor, now);
    const resolved = resolvedOf(actor);
    const lock = lockOf(records("orders"), actor.id, actor.uuid);
    const owner = actor.isOwner;
    return {
        uuid: actor.uuid, id: actor.id, name: actor.name, img: actor.img, owner,
        inDowntime: status.inDowntime,
        sinceText: status.inDowntime && Number.isInteger(status.since) ? fmt("pf2e-artisans-workshop.Downtime.Since", { day: number(status.since) }) : null,
        pending: pending.count,
        pendingText: pending.count ? fmt(plural(pending.count, "pf2e-artisans-workshop.Downtime.Pending"), { n: number(pending.count) }) : null,
        resolvedText: resolved === null ? null : fmt("pf2e-artisans-workshop.Downtime.Resolved", { day: number(resolved) }),
        nextText: fmt("pf2e-artisans-workshop.Downtime.Next", { day: number(nextDayOf(actor, now)) }),
        activityText: activityText(status.activity),
        activityOptions: owner ? activityOptions(actor, status.activity, { extra: ["none"] }).map((o) => (o.value === "none" ? { ...o, value: "" } : o)) : null,
        locked: lock ? fmt(helperLockOf(records("orders"), actor.id) ? "pf2e-artisans-workshop.Downtime.Locked" : "pf2e-artisans-workshop.Downtime.Sitting",
            { item: orderName(lock) }) : null,
        canResolve: pending.count > 0 && canWrite(),
        // Days to resolve and nothing to spend them on: say so beside Resolve, whose window asks for an activity.
        noActivity: pending.count > 0 && !status.activity,
    };
}

/** An Earn Income job's row. */
function jobRow(job, viewer, rows) {
    const actor = actorOf(job.actor);
    const status = JOB_STATUS[job.status] ?? JOB_STATUS.open;
    const paid = liveRows(rows).filter((r) => r.kind === "wage" && r.job === job.id).reduce((sum, r) => sum + (r.cp ?? 0), 0);
    const profile = job.settlement ? profiles().find((p) => p.id === job.settlement) : null;
    return {
        id: job.id, actor: actor?.name ?? loc("pf2e-artisans-workshop.Common.Unknown"), skill: skillName(job.skill), taskLevel: job.taskLevel,
        dc: showDcs() ? job.dc : null, status: job.status, statusIcon: status.icon, statusWord: loc(status.key), unconfirmed: !!job.unconfirmed,
        settlementName: profile?.name || null,
        checkText: job.check ? loc(DEGREE_KEY[job.check.degree]) : null, checkClass: job.check ? DEGREE_CLASS[job.check.degree] : null,
        perDay: job.check ? money(job.perDayCp ?? 0) : null, shortened: !!job.shortened, conflict: !!job.conflict,
        daysText: fmt(plural(daysPaid(rows, job.id), "pf2e-artisans-workshop.Job.DaysPaid"), { n: number(daysPaid(rows, job.id)), amount: money(paid) }),
        actions: jobActions(job, viewer, { now: earnerNow(job), worked: workedOn(job.id) }),
    };
}

/** The form that starts a job: the character, a trained skill, the task level the settlement allows, DC and pay. */
function jobForm(state) {
    const actors = members().filter((a) => a.isOwner);
    const actor = actors.find((a) => a.uuid === state.jobActor) ?? actors.find((a) => a === game.user.character) ?? actors[0] ?? null;
    if (!actor) return null;
    const skills = Object.values(actor.skills ?? {}).filter((s) => s.rank >= 1).sort((a, b) => (a.label < b.label ? -1 : 1));
    const skill = skills.find((s) => s.slug === state.jobSkill) ?? skills.find((s) => s.slug === "crafting") ?? skills[0] ?? null;
    if (!skill) return { actors: actors.map((a) => ({ uuid: a.uuid, name: a.name, selected: a === actor })), skills: [], noSkill: true };
    const profile = settlement();
    const max = profile ? maxTaskLevel(profile, skill.slug) : 20;
    // What the user typed stands, above the cap too, so Start refuses it with the cap rather than quietly lowering it.
    const level = Number.isInteger(state.jobLevel) ? state.jobLevel : Math.min(max, actor.level ?? 0);
    const pay = (degree) => money(wagePerDay({ taskLevel: level, rank: skill.rank, degree, skill: skill.slug }));
    const dc = showDcs() ? jobDC(level, skill.slug) : null;
    const preview = fmt("pf2e-artisans-workshop.Job.Preview", { crit: pay(DEGREE.critSuccess), success: pay(DEGREE.success), fail: pay(DEGREE.fail) });
    return {
        actors: actors.map((a) => ({ uuid: a.uuid, name: a.name, selected: a === actor })),
        skills: skills.map((s) => ({ slug: s.slug, label: s.label, rank: rankName(s.rank), selected: s === skill })),
        level, max, dc, unconfirmed: !profile,
        preview: dc ? `${fmt("pf2e-artisans-workshop.Job.PreviewDc", { dc })} ${preview}` : preview,
        ready: canWrite(),
    };
}

/**
 * The task level typed in the job form: kept in the tab's state, and the DC and pay it leads to updated in place. Not a
 * render: one as the field loses focus would replace "Take this job" between the press and the click, and the click would
 * be lost (10.9; the wizard's number of days works the same way).
 */
function jobLevelTyped(app, target) {
    const state = downtimeState(app);
    state.jobLevel = whole(target.value);
    const line = target.closest?.(".job-form")?.querySelector(".job-preview");
    const form = line ? jobForm(state) : null;
    if (line && form?.preview) line.textContent = form.preview;
}

/**
 * A settlement's highest task level typed in the profile form: kept, and the exception's level field, while the user has
 * not typed one, follows it in place. Not a render, for the same reason as `jobLevelTyped` ("Save settlement").
 */
function profileLevelTyped(app, target) {
    const state = downtimeState(app);
    if (!state.profile) return;
    state.profile.level = whole(target.value) ?? state.profile.level;
    const cap = target.closest?.(".profile-form")?.querySelector("input[name='capLevel']");
    if (cap && !Number.isInteger(state.capLevel)) cap.value = String(state.profile.level);
}

/** The current settlement and the choice of it. */
function settlementView() {
    const current = settlement();
    const record = settlementRecord();
    return {
        options: [{ value: "", label: loc("pf2e-artisans-workshop.Settlement.None"), selected: !current },
            ...profiles().map((p) => ({ value: p.id, label: p.name || loc(SETTLEMENT_SIZE[p.size]), selected: p.id === current?.id }))],
        capText: current ? fmt("pf2e-artisans-workshop.Settlement.Cap", { level: String(current.level), size: loc(SETTLEMENT_SIZE[current.size]) })
            : loc("pf2e-artisans-workshop.Settlement.NoneHint"),
        caps: current ? Object.entries(current.caps).map(([skill, max]) => fmt("pf2e-artisans-workshop.Settlement.Exception", { skill: skillName(skill), level: String(max) })) : [],
        notes: current?.notes || null,
        setBy: record?.by ? fmt("pf2e-artisans-workshop.Settlement.SetBy", { user: userName(record.by), when: when(record.at) }) : null,
        canSet: canWrite() && currentViewer().hasCharacter,
    };
}

/** Skills a settlement exception can name: pf2e's skills, and the Lores the members have. */
function exceptionSkills() {
    const slugs = new Set(Object.keys(CONFIG.PF2E?.skills ?? {}));
    for (const snapshot of records("roster")) for (const slug of Object.keys(snapshot.skills ?? {})) if (slug.endsWith("-lore")) slugs.add(slug);
    return [...slugs].map((slug) => ({ slug, label: skillName(slug) })).sort((a, b) => (a.label < b.label ? -1 : 1));
}

/** For a GM: the settlement profiles, and the one being edited. */
function profilesView(state) {
    if (!game.user.isGM) return null;
    const draft = state.profile;
    return {
        list: profiles().map((p) => ({
            id: p.id, name: p.name || loc(SETTLEMENT_SIZE[p.size]), size: loc(SETTLEMENT_SIZE[p.size]), level: p.level,
            caps: Object.entries(p.caps).map(([skill, max]) => fmt("pf2e-artisans-workshop.Settlement.Exception", { skill: skillName(skill), level: String(max) })),
        })),
        draft: draft ? {
            ...draft,
            sizes: SETTLEMENT_SIZES.map((size) => ({ value: size, label: loc(SETTLEMENT_SIZE[size]), selected: size === draft.size })),
            caps: Object.entries(draft.caps ?? {}).map(([skill, max]) => ({ skill, label: skillName(skill), max })),
            skills: exceptionSkills().map((s) => ({ ...s, selected: s.slug === state.capSkill })),
            capLevel: Number.isInteger(state.capLevel) ? state.capLevel : draft.level,
        } : null,
    };
}

/** Everything the Downtime tab shows. */
export function downtimeContext(app) {
    if (!downtimeOn()) return { downtimeOff: true };
    const state = downtimeState(app);
    const now = today();
    const viewer = currentViewer();
    const rows = records("rows");
    const pcs = members().filter((a) => game.user.isGM || a.isOwner).map((actor) => pcRow(actor, now));
    const jobs = incomeOn() ? records("jobs").filter((job) => game.user.isGM || owns(job.actor)).map((job) => jobRow(job, viewer, rows)) : null;
    return {
        downtime: {
            dayText: fmt("pf2e-artisans-workshop.Downtime.Day", { day: number(now.day) }), worldDate: worldDate(),
            aheadText: now.ahead > 0 ? fmt(plural(now.ahead, "pf2e-artisans-workshop.Downtime.Ahead"), { n: number(now.ahead) }) : null,
            behindText: now.behind > 0 ? fmt(plural(now.behind, "pf2e-artisans-workshop.Downtime.Behind"), { n: number(now.behind) }) : null,
            canMatch: game.user.isGM && now.ahead > 0 && canWrite(),
            pcs, pending: pcs.reduce((sum, pc) => sum + pc.pending, 0), canAdvance: canWrite() && viewer.hasCharacter,
            settlement: settlementView(), profiles: profilesView(state),
            income: incomeOn(), jobs, jobForm: incomeOn() ? jobForm(state) : null,
            // M9a (6.16.7): today's harvests of the party's gardens, while the gardens variant is on.
            harvests: harvestView(app.actingActor?.() ?? null),
        },
    };
}

/** How many of this user's characters have pending days: the Downtime tab's badge (9.1). */
export function pendingBadge() {
    if (!downtimeOn()) return 0;
    const now = today();
    return members().filter((a) => a.isOwner && (!game.user.isGM || !a.hasPlayerOwner) && pendingOf(a, now).count > 0).length;
}

/* -------------------------------------------- */
/*  The tab's controls                           */
/* -------------------------------------------- */

/** A Downtime tab button (`data-action="downtime"`, `data-op`). Returns a result for `report`, or null. */
export async function onDowntimeOp(app, target) {
    const state = downtimeState(app);
    const data = target.closest("[data-op]")?.dataset ?? {};
    const actor = data.actor ? actorOf(data.actor) : null;
    switch (data.op) {
        case "toggle": {
            if (!actor) return null;
            const on = !statusOf(actor).inDowntime;
            const result = await setDowntime(actor.uuid, on);
            if (result.ok || result.reason !== "days-pending") return report(result);
            const ok = await confirm({ title: "pf2e-artisans-workshop.Prompt.NotDowntime.Title", content: "pf2e-artisans-workshop.Prompt.NotDowntime.Content", app });
            return ok ? report(await setDowntime(actor.uuid, false, { notDowntime: true })) : null;
        }
        case "resolve":
        case "advance": {
            const { openAdvance } = await import("./advance.mjs");
            await openAdvance({ mode: data.op, actor: actor?.uuid ?? null, parent: app });
            return null;
        }
        case "match": return report(await advanceClockToMatch());
        case "job-start": {
            const form = jobForm(state);
            if (!form?.skills?.length) return null;
            const skill = form.skills.find((s) => s.selected)?.slug;
            return report(await startJob({ actor: form.actors.find((a) => a.selected)?.uuid, skill, taskLevel: form.level }));
        }
        case "job-roll": return report(await rollJob(data.job));
        case "job-reroll": return report(await rerollJob(data.job));
        case "job-end": {
            const ok = await confirm({ title: "pf2e-artisans-workshop.Prompt.EndJob.Title", content: "pf2e-artisans-workshop.Prompt.EndJob.Content", app });
            return ok ? report(await endJob(data.job)) : null;
        }
        case "job-undo": return report(await undoJob(data.job));
        case "profile-new":
            state.profile = { id: null, name: "", size: "town", level: 4, caps: {}, notes: "" };
            return null;
        case "profile-edit": {
            const profile = profiles().find((p) => p.id === data.profile);
            state.profile = profile ? structuredClone(profile) : null;
            return null;
        }
        case "profile-cancel":
            state.profile = null;
            return null;
        case "profile-save": {
            const result = report(await saveProfile(state.profile ?? {}));
            if (result?.ok) state.profile = null;
            return result;
        }
        case "profile-delete": {
            const ok = await confirm({ title: "pf2e-artisans-workshop.Prompt.DeleteProfile.Title", content: "pf2e-artisans-workshop.Prompt.DeleteProfile.Content", app });
            return ok ? report(await deleteProfile(data.profile)) : null;
        }
        case "cap-add": {
            const skill = state.capSkill ?? exceptionSkills()[0]?.slug;
            if (state.profile && skill) state.profile.caps = { ...state.profile.caps, [skill]: Number.isInteger(state.capLevel) ? state.capLevel : state.profile.level };
            return null;
        }
        case "cap-remove":
            if (state.profile) {
                const caps = { ...state.profile.caps };
                delete caps[data.skill];
                state.profile.caps = caps;
            }
            return null;
        default: return null;
    }
}

/** A whole number from a field, or null. */
const whole = (value) => (/^\d+$/.test(String(value ?? "").trim()) ? Number(value) : null);

/**
 * Typing in a Downtime tab field (`input`): kept in the tab's state as it is typed, without rendering, so a live update
 * that renders the tab meanwhile does not lose it (10.9). Returns whether the field was the tab's.
 */
export function onDowntimeInput(app, target) {
    const state = downtimeState(app);
    switch (target.name) {
        case "profileName":
        case "profileNotes":
            if (state.profile) state.profile[target.name === "profileName" ? "name" : "notes"] = target.value;
            return true;
        case "profileLevel":
            profileLevelTyped(app, target);
            return true;
        case "capLevel":
            state.capLevel = whole(target.value);
            return true;
        case "jobLevel":
            jobLevelTyped(app, target);
            return true;
        default:
            return false;
    }
}

/** A Downtime tab field changed. Returns whether the tab should render again. */
export async function onDowntimeChange(app, target) {
    const state = downtimeState(app);
    switch (target.name) {
        case "dtActivity": {
            const actor = actorOf(target.dataset.actor);
            if (actor) report(await setActivity(actor.uuid, parseActivity(target.value)));
            return true;
        }
        case "dtSettlement":
            report(await setSettlement(target.value || null));
            return true;
        case "jobActor":
            Object.assign(state, { jobActor: target.value, jobSkill: null, jobLevel: null });
            return true;
        case "jobSkill":
            Object.assign(state, { jobSkill: target.value, jobLevel: null });
            return true;
        case "jobLevel":
            jobLevelTyped(app, target);
            return false;
        case "profileName":
        case "profileNotes":
            if (state.profile) state.profile[target.name === "profileName" ? "name" : "notes"] = target.value;
            return false;
        case "profileSize":
            if (state.profile) state.profile.size = target.value;
            return true;
        case "profileLevel":
            profileLevelTyped(app, target);
            return false;
        case "capSkill":
            state.capSkill = target.value;
            return false;
        case "capLevel":
            state.capLevel = whole(target.value);
            return false;
        default:
            return null;
    }
}

/* -------------------------------------------- */
/*  Helpers on an order's detail (6.7)           */
/* -------------------------------------------- */

/**
 * The helpers section of an order's detail: each helper with their skill, rank (when party stats show), check, the amount
 * they take off each extra day, when they joined and left (and whether they forfeited), and the buttons this user may use
 * (roll the helper check, leave, accept a helper who brings the feat); and "Help with this order" for this user's
 * characters who could.
 */
export function helpersContext(order) {
    if (!downtimeOn()) return null;
    const rules = rulesFromSettings();
    const open = !CLOSED.includes(order.status);
    const list = Object.entries(order.helpers ?? {}).map(([id, h]) => {
        const actor = game.actors.get(id);
        const mine = !!actor?.isOwner;
        const degree = Number.isInteger(h.degree) ? h.degree : null;
        return {
            id, uuid: actor?.uuid ?? null, name: actor?.name ?? loc("pf2e-artisans-workshop.Common.Unknown"), skill: skillName(h.skill),
            rank: showRanks() || mine ? rankName(h.rank ?? 0) : null,
            degreeText: degree === null ? null : loc(DEGREE_KEY[degree]), degreeClass: degree === null ? null : DEGREE_CLASS[degree],
            rate: degree === null ? null : money(helperRate(h, rules)),
            joined: number(h.joinedDay), left: h.leftDay == null ? null : number(h.leftDay),
            forfeited: h.leftDay != null && rules.communal.helperLeaveRetroactive, waiting: h.accepted === false,
            canRoll: mine && open && h.leftDay == null && !!order.dc?.final && !h.check && canWrite(),
            canLeave: mine && open && h.leftDay == null && canWrite(),
            canAccept: h.accepted === false && h.leftDay == null && owns(order.crafter) && canWrite(),
        };
    });
    const candidates = open && order.crafter && order.status !== "requested"
        ? members().filter((a) => a.isOwner && a.uuid !== order.crafter && !order.helpers?.[a.id] && helpSkills(order, a).length) : [];
    return { list, canJoin: candidates.length > 0 && canWrite(), dc: showDcs() ? order.dc?.final ?? null : null };
}

/** A helpers button in an order's detail (`data-action="helper"`, `data-op`). */
export async function onHelperOp(app, target) {
    const id = target.closest("[data-order-id]")?.dataset.orderId;
    const order = id ? read(`orders.${id}`) : null;
    if (!order) return null;
    const data = target.dataset;
    switch (data.op) {
        case "join": {
            const options = members().filter((a) => a.isOwner && a.uuid !== order.crafter && !order.helpers?.[a.id])
                .flatMap((a) => helpSkills(order, a).map((skill) => {
                    const check = eligibility(order, a, skill);
                    const why = check.ok ? "" : check.reasons.map((r) => loc(HELPER_REASON[r])).join(" ");
                    return { value: `${a.uuid}|${skill}`, name: fmt(check.ok ? "pf2e-artisans-workshop.Helper.Choice" : "pf2e-artisans-workshop.Helper.ChoiceBlocked",
                        { name: a.name, skill: skillName(skill), why }) };
                }));
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Helper.JoinTitle", label: "pf2e-artisans-workshop.Helper.JoinLabel", options,
                hint: "pf2e-artisans-workshop.Helper.JoinHint", button: "pf2e-artisans-workshop.Helper.Join", icon: "fa-solid fa-people-carry-box", app });
            if (!answer?.value) return null;
            const [uuid, skill] = answer.value.split("|");
            return report(await joinOrder(id, uuid, skill));
        }
        case "roll": return report(await rollHelp(id, data.actor));
        case "leave": {
            const ok = await confirm({ title: "pf2e-artisans-workshop.Prompt.LeaveHelp.Title",
                content: rulesFromSettings().communal.helperLeaveRetroactive ? "pf2e-artisans-workshop.Prompt.LeaveHelp.Forfeit" : "pf2e-artisans-workshop.Prompt.LeaveHelp.Keep", app });
            return ok ? report(await leaveOrder(id, data.actor)) : null;
        }
        case "accept": return report(await acceptHelper(id, data.helper));
        default: return null;
    }
}
