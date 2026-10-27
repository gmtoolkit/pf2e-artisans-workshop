/**
 * The Advance days wizard and the day resolver (DESIGN.md 9.1, 9.2, M6): one window, step by step.
 *
 * Advance days (any member; there is no GM-only option, 9.2):
 *   1. Span: a number of days, or "since last resolved"; the workshop day it leads to. A GM may also move the world clock.
 *   2. Who: every PC in downtime with days in the span, the activity its days go to (its current one by default; "leave
 *      for its owner" or "not downtime" instead), what that would write, and where it would stop. A Communal Crafting
 *      helper shows as locked to the order.
 *   3. Checks due: Craft checks, Earn Income checks and helper checks due now, with Roll for the characters this user
 *      owns; the others are left for their owners ("check pending"); and the checks that come due within the span.
 *   4. Review: per PC, the days and what they amount to, the wages and whether they are paid now or claimed by the
 *      earner's owner.
 *   5. Done: what was written, where each PC stopped, and "Resolve the rest" once the checks are rolled.
 * The day resolver is the same window for one PC and its pending days (steps 2-5).
 *
 * Daily preparations (9.2 step 4), affliction saves and the variants' checks come with M7, M8a and M9a.
 */
import { activityKey, openDaysThrough, parseActivity, wizardSpan } from "../logic/downtime.mjs";
import { rollCraft } from "../foundry/rolls.mjs";
import { rollHelp } from "../foundry/communal.mjs";
import {
    advanceDays, downtimeMembers, previewDays, resolveDays, resolvedOf, statusOf, today,
} from "../foundry/downtime.mjs";
import { rollJob } from "../foundry/jobs.mjs";
import { isResponsibleFor } from "../foundry/responsible.mjs";
import { canWrite, shared } from "../foundry/state.mjs";
import { read } from "../foundry/store.mjs";
import { activityOptions } from "./downtime.mjs";
import { dayLines, jobName, orderName, spanText, stopText } from "./days.mjs";
import { money, number, report } from "./format.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);

const STEPS = Object.freeze({ advance: ["span", "who", "checks", "review", "done"], resolve: ["who", "checks", "review", "done"] });
const STEP_KEY = Object.freeze({
    span: "pf2e-artisans-workshop.Wizard.Step.Span", who: "pf2e-artisans-workshop.Wizard.Step.Who", checks: "pf2e-artisans-workshop.Wizard.Step.Checks",
    review: "pf2e-artisans-workshop.Wizard.Step.Review", done: "pf2e-artisans-workshop.Wizard.Step.Done",
});

/** An assignment from its select value: an activity object, or "skip" / "not-downtime". */
const choiceOf = (value) => (value === "skip" || value === "not-downtime" ? value : parseActivity(value) ?? "skip");

export class AdvanceDaysApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "pf2e-artisans-workshop-advance",
        classes: ["pf2e-artisans-workshop", "advance-window"],
        window: { title: "pf2e-artisans-workshop.Wizard.Title", icon: "fa-solid fa-forward-fast", resizable: true },
        position: { width: 620, height: "auto" },
        actions: {
            next: AdvanceDaysApp.#onNext, back: AdvanceDaysApp.#onBack, commit: AdvanceDaysApp.#onCommit, roll: AdvanceDaysApp.#onRoll,
            again: AdvanceDaysApp.#onAgain, finish: AdvanceDaysApp.#onFinish,
        },
    };

    static PARTS = { body: { template: "modules/pf2e-artisans-workshop/templates/advance/wizard.hbs", scrollable: [".wizard-body"] } };

    /** The one open wizard. */
    static instance = null;

    /**
     * @param {object} [options]
     * @param {"advance"|"resolve"} [options.mode]
     * @param {string|null} [options.actor]   the PC the resolver is for
     */
    constructor({ mode = "advance", actor = null, ...options } = {}) {
        super(options);
        this.state = { mode, actor, step: STEPS[mode][0], kind: "days", count: 1, advanceClock: false, assignments: {}, result: null, toDay: null, busy: false };
    }

    /** Re-render when the ledger changes (a check recorded, someone else's days written). */
    #hook = null;

    get steps() {
        return STEPS[this.state.mode];
    }

    /** The span the wizard covers now: in resolve mode, or once committed, through the workshop day it reached. */
    span(now) {
        if (this.state.mode === "resolve" || this.state.toDay !== null) return { fromDay: null, toDay: Math.max(now.day, this.state.toDay ?? now.day), advances: 0 };
        try {
            return wizardSpan({ day: now.day, kind: this.state.kind, count: Math.max(1, this.state.count) });
        } catch {
            return wizardSpan({ day: now.day, kind: "days", count: 1 });
        }
    }

    /** The PCs the wizard covers, with their days in the span, their assignment, and what it would write. */
    entries(now, span) {
        const pcs = this.state.mode === "resolve" ? [actorOf(this.state.actor)].filter(Boolean) : downtimeMembers();
        return pcs.map((actor) => {
            const status = statusOf(actor);
            const days = openDaysThrough({ status, resolved: resolvedOf(actor), day: now.day, toDay: span.toDay });
            const value = this.state.assignments[actor.id] ?? (activityKey(status.activity) || "skip");
            const choice = choiceOf(value);
            const activity = choice === "not-downtime" ? null : choice === "skip" ? undefined : choice;
            const plan = days.length && activity !== undefined ? previewDays(actor, days, activity) : null;
            return { actor, status, days, value, activity, plan };
        }).filter((e) => e.days.length);
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const now = today();
        const span = this.span(now);
        const entries = this.entries(now, span);
        const step = this.state.step;
        const index = this.steps.indexOf(step);
        return Object.assign(context, {
            step, ready: canWrite(), isGM: game.user.isGM, mode: this.state.mode, busy: this.state.busy,
            stepper: this.steps.map((s, i) => ({ id: s, label: loc(STEP_KEY[s]), current: s === step, done: i < index, n: number(i + 1) })),
            first: index === 0, lastBeforeDone: step === "review", isDone: step === "done",
            span: this.#spanContext(now, span),
            who: step === "who" ? this.#whoContext(entries) : null,
            checks: step === "checks" ? this.#checksContext(entries) : null,
            review: step === "review" ? this.#reviewContext(entries) : null,
            done: step === "done" ? this.#doneContext() : null,
            empty: !entries.length && step !== "span" && step !== "done",
        });
    }

    #spanContext(now, span) {
        return {
            kind: this.state.kind, count: this.state.count, advanceClock: this.state.advanceClock,
            from: fmt("pf2e-artisans-workshop.Wizard.Today", { day: number(now.day) }),
            to: span.advances > 0 ? fmt("pf2e-artisans-workshop.Wizard.Becomes", { day: number(span.toDay) }) : loc("pf2e-artisans-workshop.Wizard.Stays"),
            ahead: now.ahead > 0 ? fmt("pf2e-artisans-workshop.Wizard.Ahead", { n: number(now.ahead) }) : null,
        };
    }

    #whoContext(entries) {
        return entries.map(({ actor, days, value, plan }) => {
            const locked = plan?.stop?.reason === "locked" ? plan.stop.ref : null;
            return {
                id: actor.id, name: actor.name, img: actor.img,
                span: fmt(days.length === 1 ? "pf2e-artisans-workshop.Days.SpanOne" : "pf2e-artisans-workshop.Days.Span",
                    { n: number(days.length), from: number(days[0]), to: number(days.at(-1)), day: number(days[0]) }),
                options: activityOptions(actor, value, { extra: ["skip", "not-downtime"] }),
                willWrite: plan ? spanText(plan.records) : null,
                stop: plan?.stop ? stopText(plan.stop) : null,
                locked: locked ? fmt("pf2e-artisans-workshop.Downtime.Locked", { item: orderName(locked) }) : null,
                skipped: value === "skip",
            };
        });
    }

    /** Checks due now, rollable by this user or left for the owner, and those that come due within the span (9.2 step 3). */
    #checksContext(entries) {
        const due = [];
        const later = [];
        for (const { actor, activity, plan } of entries) {
            if (!activity) continue;
            if (activity.kind === "craft") {
                const order = read(`orders.${activity.ref}`);
                if (order?.status === "check") due.push({ kind: "craft", ref: order.id, actor: actor.uuid, text: fmt("pf2e-artisans-workshop.Wizard.Due.Craft", { name: actor.name, item: orderName(order.id) }), canRoll: actor.isOwner });
                else if (order?.status === "rolled") later.push(fmt(actor.isOwner ? "pf2e-artisans-workshop.Wizard.Due.Settles" : "pf2e-artisans-workshop.Wizard.Due.SettlesOwner", { name: actor.name, item: orderName(order.id) }));
            }
            if (activity.kind === "earn") {
                const job = read(`jobs.${activity.ref}`);
                if (job && !job.check && job.status === "open") due.push({ kind: "earn", ref: job.id, actor: actor.uuid, text: fmt("pf2e-artisans-workshop.Wizard.Due.Earn", { name: actor.name, job: jobName(job.id) }), canRoll: actor.isOwner });
            }
            if (activity.kind === "help") {
                const order = read(`orders.${activity.ref}`);
                const helper = order?.helpers?.[actor.id];
                if (helper && !helper.check && order.dc?.final) due.push({ kind: "help", ref: order.id, actor: actor.uuid, text: fmt("pf2e-artisans-workshop.Wizard.Due.Help", { name: actor.name, item: orderName(order.id) }), canRoll: actor.isOwner });
            }
            if (plan?.stop && ["check", "income-check"].includes(plan.stop.reason) && plan.records.length) later.push(fmt("pf2e-artisans-workshop.Wizard.Due.Later", { name: actor.name, stop: stopText(plan.stop) }));
        }
        return { due, later, none: !due.length && !later.length };
    }

    /** Per PC: the days and what they amount to, the wages paid now or claimed, and where it stops (9.2 step 6). */
    #reviewContext(entries) {
        return entries.filter((e) => e.value !== "skip").map(({ actor, plan }) => ({
            name: actor.name, span: plan ? spanText(plan.records) : null, lines: plan ? dayLines(plan.records) : [],
            wages: (plan?.wages ?? []).map((w) => {
                const earner = actorOf(read(`jobs.${w.job}`)?.actor);
                return fmt(earner && isResponsibleFor(earner) ? "pf2e-artisans-workshop.Wizard.WagePaid" : "pf2e-artisans-workshop.Wizard.WageClaim",
                    { day: number(w.day), amount: money(w.cp), name: earner?.name ?? "" });
            }),
            stop: plan?.stop ? stopText(plan.stop) : null,
            nothing: !plan?.records.length,
        }));
    }

    #doneContext() {
        const result = this.state.result;
        if (!result) return null;
        if (!result.ok) return { refused: true };
        return {
            toDay: Number.isInteger(result.toDay) ? fmt("pf2e-artisans-workshop.Wizard.NowDay", { day: number(result.toDay) }) : null,
            clock: result.clock !== null && result.clock !== undefined ? loc("pf2e-artisans-workshop.Wizard.ClockMoved") : null,
            pcs: (result.results ?? []).map((r) => ({
                name: r.actor.name, span: spanText(r.records ?? []), lines: dayLines(r.records ?? []), stop: r.stop ? stopText(r.stop) : null,
                refused: r.ok === false ? (r.reason === "taken" ? loc("pf2e-artisans-workshop.Wizard.Taken") : loc("pf2e-artisans-workshop.Refusal.Other")) : null,
            })),
            rest: (result.results ?? []).some((r) => r.stop),
        };
    }

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        AdvanceDaysApp.instance = this;
        this.element.addEventListener("change", (event) => this.#onChange(event));
        this.#hook = Hooks.on("updateJournalEntry", (doc) => {
            if (doc === shared().ledger && this.rendered && !this.state.busy) this.render();
        });
    }

    _onClose(options) {
        super._onClose?.(options);
        if (this.#hook !== null) Hooks.off("updateJournalEntry", this.#hook);
        if (AdvanceDaysApp.instance === this) AdvanceDaysApp.instance = null;
    }

    #onChange(event) {
        const target = event.target;
        if (target.name === "kind") this.state.kind = target.value === "since" ? "since" : "days";
        else if (target.name === "count") this.state.count = Math.max(1, Math.min(365, Number.parseInt(target.value, 10) || 1));
        else if (target.name === "advanceClock") this.state.advanceClock = target.checked === true;
        else if (target.name === "assign" && target.dataset.actor) this.state.assignments[target.dataset.actor] = target.value;
        else return;
        this.render();
    }

    static #onNext() {
        const index = this.steps.indexOf(this.state.step);
        this.state.step = this.steps[Math.min(index + 1, this.steps.length - 1)];
        return this.render();
    }

    static #onBack() {
        const index = this.steps.indexOf(this.state.step);
        this.state.step = this.steps[Math.max(index - 1, 0)];
        return this.render();
    }

    /** Commit (9.2 step 7): every PC's days, then the logged-day mark and, for a GM who asked, the clock. */
    static async #onCommit() {
        if (this.state.busy) return null;
        this.state.busy = true;
        try {
            const now = today();
            const assignments = {};
            for (const entry of this.entries(now, this.span(now))) assignments[entry.actor.id] = choiceOf(entry.value);
            let result;
            if (this.state.mode === "resolve") {
                const actor = actorOf(this.state.actor);
                const choice = assignments[actor?.id] ?? "skip";
                const single = choice === "skip" ? { ok: true, records: [], stop: null } : await resolveDays({ actor, activity: choice });
                result = { ok: single.ok !== false, toDay: null, clock: null, results: actor ? [{ actor, ...single }] : [] };
            } else {
                // Once committed, "Resolve the rest" resolves through the day the first commit reached; it never advances again.
                const again = this.state.toDay !== null;
                result = await advanceDays({ kind: again ? "since" : this.state.kind, count: this.state.count, assignments,
                    advanceClock: !again && this.state.advanceClock });
                if (result.ok && !again) this.state.toDay = result.toDay;
            }
            report(result);
            this.state.result = result;
            this.state.step = "done";
        } finally {
            this.state.busy = false;
        }
        return this.render();
    }

    /** Roll a check that is due (step 3, or after a stop): this user's character only; pf2e's dialog as the user has it. */
    static async #onRoll(_event, target) {
        const { kind, ref, actor } = target.dataset;
        target.disabled = true;
        try {
            if (kind === "craft") return report(await rollCraft(ref));
            if (kind === "earn") return report(await rollJob(ref));
            if (kind === "help") return report(await rollHelp(ref, actor));
            return null;
        } finally {
            if (target.isConnected) target.disabled = false;
        }
    }

    /** "Resolve the rest": back to the checks with the same span, since days already written are skipped. */
    static #onAgain() {
        this.state.result = null;
        this.state.step = "checks";
        return this.render();
    }

    static #onFinish() {
        return this.close();
    }
}

/**
 * Open the wizard (`mode` "advance") or the day resolver for one PC (`mode` "resolve"). From the Workshop (`parent`) it is
 * that window's child, so it opens in the browser window the Workshop is in (10.1, detached windows).
 */
export async function openAdvance({ mode = "advance", actor = null, parent = null } = {}) {
    // One wizard at a time, under one id: the old window is gone before the new one renders.
    await AdvanceDaysApp.instance?.close({ animate: false });
    const app = new AdvanceDaysApp({ mode, actor });
    if (parent?.renderChild) parent.renderChild(app);
    else app.render({ force: true });
    return app;
}
