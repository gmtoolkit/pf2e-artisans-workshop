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
 * The day resolver is the same window for one PC and its pending days (steps 2-5); it asks for an activity when the PC has
 * none, rather than offering to leave the days.
 *
 * The span is fixed when the user leaves the first step: the later steps show it and the commit writes it, whatever the
 * clock or another user does meanwhile. If the workshop day moved before the commit, the wizard writes nothing and goes
 * back to the first step (`advanceDays` refuses as `moved`), so two people advancing a day at once never advance two.
 *
 * Live updates (a check recorded, another user's days, a new day on the clock) render the window again after a moment,
 * but not while a field has focus (a render would close an open menu or swallow the click that blurs it); focus stays on
 * the control that had it (`focus.mjs`), and moves to the new step's first control when the step changes (10.9).
 *
 * Daily preparations (9.2 step 4), affliction saves and the variants' checks come with M7, M8a and M9a.
 */
import { activityKey, openDaysThrough, parseActivity, wizardSpan } from "../logic/downtime.mjs";
import { rollCraft } from "../foundry/rolls.mjs";
import { rollHelp } from "../foundry/communal.mjs";
import {
    advanceDays, dayWatcher, downtimeMembers, previewDays, resolveDays, resolvedOf, statusOf, today,
} from "../foundry/downtime.mjs";
import { rollJob } from "../foundry/jobs.mjs";
import { isResponsibleFor } from "../foundry/responsible.mjs";
import { canWrite, shared } from "../foundry/state.mjs";
import { read } from "../foundry/store.mjs";
import { activityOptions } from "./downtime.mjs";
import { dayLines, extActivityName, jobName, orderName, spanText, stopText } from "./days.mjs";
import { rollActivity } from "../foundry/extensions.mjs";
import { focusState, keepControlKeys, restoreFocus } from "./focus.mjs";
import { withTheme } from "./theme.mjs";
import { money, number, refusalText, report } from "./format.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);

const STEPS = Object.freeze({ advance: ["span", "who", "checks", "review", "done"], resolve: ["who", "checks", "review", "done"] });
const STEP_KEY = Object.freeze({
    span: "pf2e-artisans-workshop.Wizard.Step.Span", who: "pf2e-artisans-workshop.Wizard.Step.Who", checks: "pf2e-artisans-workshop.Wizard.Step.Checks",
    review: "pf2e-artisans-workshop.Wizard.Step.Review", done: "pf2e-artisans-workshop.Wizard.Step.Done",
});

/** An assignment from its select value: an activity object, "skip" / "not-downtime", or null when none is chosen yet. */
const choiceOf = (value) => (value === "skip" || value === "not-downtime" ? value : parseActivity(value) ?? (value ? "skip" : null));

/** Fields whose focus holds off a live re-render (10.9). */
const FIELDS = Object.freeze(["SELECT", "INPUT", "TEXTAREA"]);

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
    constructor({ mode = "advance", actor = null, count = 1, advanceClock = false, ...options } = {}) {
        super(withTheme(options));
        // Not `state`: that is ApplicationV2's render state, a getter with no setter (Foundry 14). `count` and `advanceClock`
        // prefill the first step (M11: the "Advance days" macro's `days` and `advanceClock`, 11.1); moving the clock stays a GM's.
        this.wizard = {
            mode, actor, step: STEPS[mode][0], kind: "days", count: Number.isInteger(count) && count > 0 ? count : 1,
            advanceClock: advanceClock === true && game.user.isGM, assignments: {}, result: null, toDay: null, busy: false,
            pin: null, notice: null, skipped: [],
        };
    }

    /** The hooks that render the window again: the ledger changing, the clock reaching a new day. */
    #hooks = [];

    /** A live update arrived while a field had focus: render once focus leaves it. */
    #stale = false;

    /** The step changed: focus goes to the new step's first control, not back to the button that was pressed. */
    #stepFocus = false;

    /** Render again after live updates stop for a moment, but not while a field has focus (10.9). */
    refresh = foundry.utils.debounce(() => {
        if (!this.rendered || this.wizard.busy) return;
        const active = this.element?.ownerDocument?.activeElement;
        if (active && FIELDS.includes(active.tagName) && this.element.contains(active)) {
            this.#stale = true;
            return;
        }
        this.#stale = false;
        this.render();
    }, 150);

    get steps() {
        return STEPS[this.wizard.mode];
    }

    /** The resolver says whose days it resolves (the wizard's title otherwise). */
    get title() {
        if (this.wizard?.mode !== "resolve") return super.title;
        return fmt("pf2e-artisans-workshop.Wizard.ResolveTitle", { name: actorOf(this.wizard.actor)?.name ?? "" });
    }

    /**
     * The span the wizard covers: once committed, through the day that commit reached ("Resolve the rest" never advances
     * again); past the first step, the span fixed when the user left it; else the resolver's days through today, or the
     * wizard's count of days from today.
     */
    span(now) {
        if (this.wizard.toDay !== null) return { fromDay: null, toDay: this.wizard.toDay, advances: 0 };
        if (this.wizard.pin) return this.wizard.pin.span;
        if (this.wizard.mode === "resolve") return { fromDay: null, toDay: now.day, advances: 0 };
        try {
            return wizardSpan({ day: now.day, kind: this.wizard.kind, count: Math.max(1, this.wizard.count) });
        } catch {
            return wizardSpan({ day: now.day, kind: "days", count: 1 });
        }
    }

    /** The PCs the wizard covers, with their days in the span, their assignment, and what it would write. */
    entries(now, span) {
        const pcs = this.wizard.mode === "resolve" ? [actorOf(this.wizard.actor)].filter(Boolean) : downtimeMembers();
        return pcs.map((actor) => {
            const status = statusOf(actor);
            const days = openDaysThrough({ status, resolved: resolvedOf(actor), day: now.day, toDay: span.toDay });
            // The wizard leaves a PC with no activity to its owner; the resolver asks for one.
            const value = this.wizard.assignments[actor.id] ?? (activityKey(status.activity) || (this.wizard.mode === "resolve" ? "" : "skip"));
            const choice = choiceOf(value);
            const activity = choice === "not-downtime" ? null : choice === "skip" || choice === null ? undefined : choice;
            const plan = days.length && activity !== undefined ? previewDays(actor, days, activity) : null;
            return { actor, status, days, value, activity, plan, needsChoice: choice === null };
        }).filter((e) => e.days.length);
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const now = today();
        const span = this.span(now);
        const entries = this.entries(now, span);
        const step = this.wizard.step;
        const index = this.steps.indexOf(step);
        return Object.assign(context, {
            step, ready: canWrite(), isGM: game.user.isGM, mode: this.wizard.mode, busy: this.wizard.busy,
            stepper: this.steps.map((s, i) => ({ id: s, label: loc(STEP_KEY[s]), current: s === step, done: i < index, n: number(i + 1) })),
            first: index === 0, lastBeforeDone: step === "review", isDone: step === "done",
            blocked: step === "who" && entries.some((e) => e.needsChoice),
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
            kind: this.wizard.kind, count: this.wizard.count, advanceClock: this.wizard.advanceClock,
            from: fmt("pf2e-artisans-workshop.Wizard.Today", { day: number(now.day) }),
            to: span.advances > 0 ? fmt("pf2e-artisans-workshop.Wizard.Becomes", { day: number(span.toDay) }) : loc("pf2e-artisans-workshop.Wizard.Stays"),
            ahead: now.ahead > 0 ? fmt("pf2e-artisans-workshop.Wizard.Ahead", { n: number(now.ahead) }) : null,
            notice: this.wizard.notice,
        };
    }

    #whoContext(entries) {
        const resolve = this.wizard.mode === "resolve";
        return entries.map(({ actor, days, value, plan, needsChoice }) => {
            const locked = ["locked", "sitting"].includes(plan?.stop?.reason) ? plan.stop.ref : null;
            const options = activityOptions(actor, value, { extra: resolve ? ["not-downtime"] : ["skip", "not-downtime"] });
            return {
                id: actor.id, name: actor.name, img: actor.img,
                span: fmt(days.length === 1 ? "pf2e-artisans-workshop.Days.SpanOne" : "pf2e-artisans-workshop.Days.Span",
                    { n: number(days.length), from: number(days[0]), to: number(days.at(-1)), day: number(days[0]) }),
                options: needsChoice ? [{ value: "", label: loc("pf2e-artisans-workshop.Wizard.Choose"), selected: true }, ...options] : options,
                choose: needsChoice ? fmt("pf2e-artisans-workshop.Wizard.ChooseHint", { name: actor.name }) : null,
                willWrite: plan ? spanText(plan.records) : null,
                stop: plan?.stop ? stopText(plan.stop) : null,
                locked: locked ? fmt(plan.stop.reason === "sitting" ? "pf2e-artisans-workshop.Downtime.Sitting" : "pf2e-artisans-workshop.Downtime.Locked",
                    { item: orderName(locked) }) : null,
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
            // M10 (12.2): an extension activity's run (or Aid) whose last day needs its check: rollable now, whatever comes before it.
            if (plan?.stop && ["ext-check", "ext-aid-check"].includes(plan.stop.reason)) {
                const stop = plan.stop;
                due.push({ kind: "ext", ref: stop.activity, from: stop.from, aid: stop.aid ?? "", actor: actor.uuid, canRoll: actor.isOwner,
                    text: fmt(stop.aid ? "pf2e-artisans-workshop.Wizard.Due.ExtAid" : "pf2e-artisans-workshop.Wizard.Due.Ext",
                        { name: actor.name, activity: extActivityName(stop.activity), other: game.actors?.get(stop.aid)?.name ?? "" }) });
            }
            if (plan?.stop && ["check", "income-check"].includes(plan.stop.reason) && plan.records.length) later.push(fmt("pf2e-artisans-workshop.Wizard.Due.Later", { name: actor.name, stop: stopText(plan.stop) }));
        }
        return { due, later, none: !due.length && !later.length };
    }

    /** Per PC: the days and what they amount to, the wages paid now or claimed, and where it stops (9.2 step 6). */
    #reviewContext(entries) {
        const skipped = loc("pf2e-artisans-workshop.Wizard.Skipped");
        return entries.map(({ actor, plan, value }) => (value === "skip" ? { name: actor.name, skipped, lines: [], wages: [] } : {
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
        const result = this.wizard.result;
        if (!result) return null;
        if (!result.ok) return { refused: true };
        return {
            toDay: Number.isInteger(result.toDay) ? fmt("pf2e-artisans-workshop.Wizard.NowDay", { day: number(result.toDay) }) : null,
            clock: result.clock !== null && result.clock !== undefined ? loc("pf2e-artisans-workshop.Wizard.ClockMoved") : null,
            pcs: [...(result.results ?? []).map((r) => ({
                name: r.actor.name, span: spanText(r.records ?? []), lines: dayLines(r.records ?? []), stop: r.stop ? stopText(r.stop) : null,
                refused: r.ok === false ? (r.reason === "taken" ? loc("pf2e-artisans-workshop.Wizard.Taken") : loc("pf2e-artisans-workshop.Refusal.Other")) : null,
            })), ...this.wizard.skipped.map((name) => ({ name, skipped: loc("pf2e-artisans-workshop.Wizard.Skipped"), lines: [] }))],
            rest: (result.results ?? []).some((r) => r.stop),
        };
    }

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        AdvanceDaysApp.instance = this;
        this.element.addEventListener("change", (event) => {
            if (this.fieldChanged(event.target)) this.render();
        });
        this.element.addEventListener("input", (event) => {
            if (event.target?.name === "count") this.fieldChanged(event.target);
        });
        // M11 review: Tab, Space and Enter belong to the focused control, never to core's keybindings (token cycling, pause).
        this.element.addEventListener("keydown", keepControlKeys);
        this.element.addEventListener("keydown", (event) => {
            // Enter in the number of days goes on, as in a form.
            if (event.key !== "Enter" || event.target?.name !== "count") return;
            event.preventDefault();
            this.fieldChanged(event.target);
            AdvanceDaysApp.#onNext.call(this);
        });
        this.element.addEventListener("focusout", () => {
            if (this.#stale) this.refresh();
        });
        const dayMoved = dayWatcher();
        dayMoved();
        this.#hooks = [
            ["updateJournalEntry", Hooks.on("updateJournalEntry", (doc) => {
                if (doc === shared().ledger) this.refresh();
            })],
            ["updateWorldTime", Hooks.on("updateWorldTime", () => {
                if (dayMoved()) this.refresh();
            })],
        ];
    }

    _onClose(options) {
        super._onClose?.(options);
        for (const [name, id] of this.#hooks) Hooks.off(name, id);
        this.#hooks = [];
        if (AdvanceDaysApp.instance === this) AdvanceDaysApp.instance = null;
    }

    /** Before the body is replaced: which control has focus (none after a step change), and its caret (10.9). */
    _preSyncPartState(partId, newElement, priorElement, state) {
        super._preSyncPartState?.(partId, newElement, priorElement, state);
        state.wizardFocus = this.#stepFocus ? null : focusState(priorElement);
    }

    /** After: that control has focus again, with its caret where it was. */
    _syncPartState(partId, newElement, priorElement, state) {
        super._syncPartState?.(partId, newElement, priorElement, state);
        restoreFocus(newElement, state.wizardFocus);
    }

    /** After a step change, focus the new step's first control, or its main button. */
    async _onRender(context, options) {
        await super._onRender?.(context, options);
        if (!this.#stepFocus) return;
        this.#stepFocus = false;
        const target = this.element.querySelector(".wizard-body :is(select, input, button):not([disabled])")
            ?? this.element.querySelector(".wizard-buttons button.primary:not([disabled])");
        target?.focus({ preventScroll: true });
    }

    /**
     * A field changed (or, for the number of days, is being typed in). Returns whether the window should render again. The
     * number of days only updates the day it leads to, in place: a render as the field loses focus would replace the Next
     * button between the press and the click.
     */
    fieldChanged(target) {
        switch (target?.name) {
            case "kind":
                this.wizard.kind = target.value === "since" ? "since" : "days";
                return true;
            case "count": {
                this.wizard.count = Math.max(1, Math.min(365, Number.parseInt(target.value, 10) || 1));
                const now = today();
                const span = this.#spanContext(now, this.span(now));
                const line = this.element?.querySelector?.(".wizard-span-day");
                if (line) line.textContent = `${span.from} ${span.to}`;
                return false;
            }
            case "advanceClock":
                this.wizard.advanceClock = target.checked === true;
                return false;
            case "assign":
                if (!target.dataset?.actor) return false;
                this.wizard.assignments[target.dataset.actor] = target.value;
                return true;
            default:
                return false;
        }
    }

    /** Leave a step: the span is fixed when leaving the first one; the resolver waits for an activity to be chosen. */
    static #onNext() {
        const index = this.steps.indexOf(this.wizard.step);
        const now = today();
        if (this.wizard.step === "who" && this.entries(now, this.span(now)).some((e) => e.needsChoice)) return null;
        if (index === 0 && this.wizard.toDay === null) this.wizard.pin = { base: now.day, span: this.span(now) };
        this.wizard.notice = null;
        this.wizard.step = this.steps[Math.min(index + 1, this.steps.length - 1)];
        this.#stepFocus = true;
        return this.render();
    }

    static #onBack() {
        const index = this.steps.indexOf(this.wizard.step);
        this.wizard.step = this.steps[Math.max(index - 1, 0)];
        if (index - 1 <= 0 && this.wizard.toDay === null) this.wizard.pin = null;
        this.#stepFocus = true;
        return this.render();
    }

    /**
     * Commit (9.2 step 7): every PC's days through the span the user reviewed, then the logged-day mark and, for a GM who
     * asked, the clock. If the day moved on meanwhile, nothing is written and the wizard goes back to the span.
     */
    static async #onCommit() {
        if (this.wizard.busy) return null;
        this.wizard.busy = true;
        try {
            const now = today();
            const span = this.span(now);
            const entries = this.entries(now, span);
            const assignments = {};
            for (const entry of entries) assignments[entry.actor.id] = choiceOf(entry.value);
            let result;
            if (this.wizard.mode === "resolve") {
                const actor = actorOf(this.wizard.actor);
                const choice = assignments[actor?.id] ?? null;
                const single = choice && choice !== "skip" ? await resolveDays({ actor, activity: choice, through: span.toDay }) : { ok: true, records: [], stop: null };
                result = { ok: single.ok !== false, toDay: null, clock: null, results: actor ? [{ actor, ...single }] : [] };
            } else {
                // Once committed, "Resolve the rest" resolves through the day the first commit reached; it never advances again.
                const again = this.wizard.toDay !== null;
                result = await advanceDays({ through: span.toDay, base: again ? null : this.wizard.pin?.base ?? null, assignments,
                    advanceClock: !again && this.wizard.advanceClock });
                if (result.ok && !again) this.wizard.toDay = result.toDay;
                if (result.ok && !again) this.wizard.skipped = entries.filter((e) => e.value === "skip").map((e) => e.actor.name);
            }
            report(result);
            if (result.reason === "moved") {
                // Someone else moved the days on: back to the span, counted again from the day it is now.
                Object.assign(this.wizard, { pin: null, step: this.steps[0], notice: refusalText(result) });
            } else {
                this.wizard.result = result;
                this.wizard.step = "done";
            }
            this.#stepFocus = true;
        } finally {
            this.wizard.busy = false;
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
            // M10: an extension activity's check (or an Aid's) for the run starting on `from`.
            if (kind === "ext") return report(await rollActivity({ actor, activity: ref, from: Number(target.dataset.from), aid: target.dataset.aid || null }));
            return null;
        } finally {
            if (target.isConnected) target.disabled = false;
        }
    }

    /** "Resolve the rest": back to the checks with the same span, since days already written are skipped. */
    static #onAgain() {
        this.wizard.result = null;
        this.wizard.skipped = [];
        this.wizard.step = "checks";
        this.#stepFocus = true;
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
export async function openAdvance({ mode = "advance", actor = null, parent = null, count = 1, advanceClock = false } = {}) {
    // One wizard at a time, under one id: the old window is gone before the new one renders.
    await AdvanceDaysApp.instance?.close({ animate: false });
    const app = new AdvanceDaysApp({ mode, actor, count, advanceClock });
    // Resolved once the window is open (M11 live pass): `api.macros.run("advance-days")` answers with a rendered wizard, and a
    // second run finds this one as the instance to close rather than rendering a second window under the same id.
    if (parent?.renderChild) await parent.renderChild(app);
    else await app.render({ force: true });
    return app;
}
