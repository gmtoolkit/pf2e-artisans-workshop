/**
 * The affliction tracker's interface (DESIGN.md 8.10.9, 10.2, 10.4, 10.5, M8a):
 *
 * - **The Afflictions window** (the drawer of 8.10.9, a window of its own so it can stay open beside the encounter): for
 *   each of the user's creatures (every creature for a GM), its pending saves (an exposure whose initial save waits, a stage
 *   save due) and its afflictions: the stage list (parsed values; a stage the parser could not map shows the source item's own
 *   paragraph, rendered at display time), the next save time and the maximum duration, and for owners and GMs "reduce stage",
 *   "end", "end the onset", undo of the last manual change and repair. A manual end can be undone. Opened from the Workshop
 *   header's pending count, the Bandolier, `api.afflictions.open` and the cards.
 * - **Cards** (10.5): the save prompt (Roll save, Fail voluntarily for a drug, "no piercing or slashing damage got through"
 *   for an injury exposure, "held breath" for an inhaled one, "roll for them" for a GM while the owner is offline, Continue
 *   after the catch-up pause), the stage change, the coating applied, spent or kept with Sticky Poison's checks, and the
 *   inhaled cloud with Expose for each creature that enters. Buttons carry `data-pf2e-artisans-workshop-op`, never
 *   `data-action`, and are hidden from users who may not use them; a prompt whose save was rolled says so.
 * - **The item card augment** (10.4): under a pf2e card of an item with stage text, Expose (the delivery its traits imply:
 *   ingested, the user; contact, a target; inhaled, the cloud), Apply poison (injury, contact and ingested), and Touched or
 *   Eaten on a coated item. When nothing parses, Expose opens the world-definition form (8.10.2).
 */
import { MODULE_ID } from "../constants.mjs";
import { isCandidate, parseAffliction } from "../logic/affliction-parse.mjs";
import { deliveryOf } from "../logic/affliction.mjs";
import { backend, definitionOf, defineWorld, sourceUuidOf } from "../foundry/affliction-defs.mjs";
import * as afflictions from "../foundry/afflictions.mjs";
import { applyDelivery, applyPoison, coatingOf, coatingSpent, touchCoating, unleash, voidExposure } from "../foundry/coatings.mjs";
import { heldKeysOf } from "../foundry/registry.mjs";
import { setting } from "../foundry/settings.mjs";
import { shared } from "../foundry/state.mjs";
import { read, write } from "../foundry/store.mjs";
import { rerenderShown } from "./chat.mjs";
import { whisperFor } from "./combat-cards.mjs";
import { focusState, keepControlKeys, restoreFocus } from "./focus.mjs";
import { withTheme } from "./theme.mjs";
import { number, report } from "./format.mjs";
import { askChoice, confirm } from "./prompts.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const actorOf = (value) => (typeof value === "string" ? fromUuidSync(value, { strict: false }) : value ?? null);
const CARD = "modules/pf2e-artisans-workshop/templates/chat/affliction.hbs";
const DEFINE = "modules/pf2e-artisans-workshop/templates/afflictions/define.hbs";

/** The card kinds of the tracker (`flags.MOD.card.kind`). */
export const AFFLICTION_CARDS = Object.freeze(["affliction-prompt", "affliction-stage", "affliction-coating", "affliction-cloud"]);

/* -------------------------------------------- */
/*  Words                                        */
/* -------------------------------------------- */

/** When something happens, from now, in words (8.10.9): in rounds below a minute, then minutes, hours, days. */
export function inText(seconds) {
    if (!Number.isFinite(seconds)) return null;
    if (seconds <= 0) return loc("pf2e-artisans-workshop.Affliction.In.Now");
    // M11: one of a unit is said as one ("in 1 round"), the M8a follow-up on "in 1 rounds".
    const say = (n, one, many) => (n === 1 ? loc(one) : fmt(many, { n: number(n) }));
    if (seconds < 60) return say(Math.ceil(seconds / 6), "pf2e-artisans-workshop.Affliction.In.RoundsOne", "pf2e-artisans-workshop.Affliction.In.Rounds");
    if (seconds < 3600) return say(Math.ceil(seconds / 60), "pf2e-artisans-workshop.Affliction.In.MinutesOne", "pf2e-artisans-workshop.Affliction.In.Minutes");
    if (seconds < 86400) return say(Math.ceil(seconds / 3600), "pf2e-artisans-workshop.Affliction.In.HoursOne", "pf2e-artisans-workshop.Affliction.In.Hours");
    return say(Math.ceil(seconds / 86400), "pf2e-artisans-workshop.Affliction.In.DaysOne", "pf2e-artisans-workshop.Affliction.In.Days");
}

/** A condition's name as pf2e labels it. */
const conditionName = (slug) => {
    const key = CONFIG.PF2E?.conditionTypes?.[slug];
    return key ? loc(key) : slug;
};

/** A damage type's name as pf2e labels it. */
const damageName = (type) => {
    const key = CONFIG.PF2E?.damageTypes?.[type];
    return key ? loc(key) : type;
};

/** A stage's parsed parts in words: its damage and conditions. */
function partsText(stage) {
    const damage = (stage?.damage ?? []).map((d) => fmt("pf2e-artisans-workshop.Affliction.DamagePart", { formula: d.formula, type: damageName(d.damageType) }));
    const conditions = (stage?.conditions ?? []).map((c) => (c.value ? `${conditionName(c.slug)} ${c.value}` : conditionName(c.slug)));
    return [...damage, ...conditions].join(", ");
}

/** Duration words by pf2e unit. */
const UNIT = Object.freeze({
    rounds: "pf2e-artisans-workshop.Affliction.Unit.Rounds", minutes: "pf2e-artisans-workshop.Affliction.Unit.Minutes",
    hours: "pf2e-artisans-workshop.Affliction.Unit.Hours", days: "pf2e-artisans-workshop.Affliction.Unit.Days",
});
/** One of each unit (M11). */
const UNIT_ONE = Object.freeze({
    rounds: "pf2e-artisans-workshop.Affliction.Unit.RoundsOne", minutes: "pf2e-artisans-workshop.Affliction.Unit.MinutesOne",
    hours: "pf2e-artisans-workshop.Affliction.Unit.HoursOne", days: "pf2e-artisans-workshop.Affliction.Unit.DaysOne",
});

/** A duration in words. */
function durationText(duration) {
    if (!duration || !UNIT[duration.unit]) return null;
    if (!duration.formula && duration.value === 1) return loc(UNIT_ONE[duration.unit]);
    return fmt(UNIT[duration.unit], { n: duration.formula ?? number(duration.value) });
}

/** Words for the kinds of save, the reasons a save waits, a stage change and a coating's fate. */
const PENDING_KIND = Object.freeze({ initial: "pf2e-artisans-workshop.Affliction.PendingKind.Initial", "re-exposure": "pf2e-artisans-workshop.Affliction.PendingKind.ReExposure" });
const SAVE_KIND = Object.freeze({ initial: "pf2e-artisans-workshop.Affliction.SaveKind.Initial", "re-exposure": "pf2e-artisans-workshop.Affliction.SaveKind.ReExposure",
    stage: "pf2e-artisans-workshop.Affliction.SaveKind.Stage" });
const WAITING = Object.freeze({ owner: "pf2e-artisans-workshop.Affliction.Waiting.Owner", gm: "pf2e-artisans-workshop.Affliction.Waiting.Gm",
    forge: "pf2e-artisans-workshop.Affliction.Waiting.Forge" });
const END = Object.freeze({ "max-duration": "pf2e-artisans-workshop.Affliction.Change.End.Max", manual: "pf2e-artisans-workshop.Affliction.Change.End.Manual",
    other: "pf2e-artisans-workshop.Affliction.Change.End.Recovered" });
const COATING = Object.freeze({ double: "pf2e-artisans-workshop.Affliction.Coating.Double", kept: "pf2e-artisans-workshop.Affliction.Coating.Kept",
    spent: "pf2e-artisans-workshop.Affliction.Coating.Spent", applied: "pf2e-artisans-workshop.Affliction.Coating.Applied" });

/** The name a user sees for an affliction's source: generic on a player-owned creature while the source is unidentified (8.10.8). */
function sourceName(source, victim) {
    if (source?.identified === false && afflictions.playerOwned(victim) && !game.user.isGM) return loc("pf2e-artisans-workshop.Affliction.Generic");
    return source?.name ?? loc("pf2e-artisans-workshop.Affliction.Generic");
}

/** Whether pf2e shows DCs to this user (its metagame setting), GMs always. */
const showDcs = () => game.user.isGM || game.pf2e?.settings?.metagame?.dcs !== false;

/** The source paragraph of stage `n`, from the source item's description (8.10.2: an unparsed part shown, never stored). */
async function stageParagraph(source, n) {
    const doc = await fromUuid(source?.uuid ?? "").catch(() => null) ?? await fromUuid(source?.itemUuid ?? "").catch(() => null);
    const html = doc?.system?.description?.value ?? "";
    for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
        const label = /^\s*<strong>([^<]*)<\/strong>/i.exec(match[1])?.[1] ?? "";
        const range = /(\d+)(?:\s*[–—-]\s*(\d+))?/.exec(label);
        if (!range || !/stage/i.test(label)) continue;
        const from = Number(range[1]);
        const to = range[2] ? Number(range[2]) : from;
        if (n >= from && n <= to) {
            const TextEditor = foundry.applications.ux?.TextEditor?.implementation;
            return TextEditor ? TextEditor.enrichHTML(match[1], { async: true }) : match[1];
        }
    }
    return null;
}

/* -------------------------------------------- */
/*  The Afflictions window                       */
/* -------------------------------------------- */

/** The creatures this user sees in the window: every one for a GM, the ones they own otherwise. */
function viewedActors() {
    return afflictions.afflictionActors().filter((actor) => game.user.isGM || actor.isOwner);
}

/** The window's view of one creature, or null when it has nothing to show. */
async function actorView(actor) {
    const now = afflictions.clockNow();
    const pending = afflictions.pendingOf(actor).filter((p) => p.kind !== "stage").map((p) => {
        const claim = p.claim;
        const traits = claim?.source?.traits ?? [];
        return {
            runId: p.runId, seq: p.seq, claim: claim?.id ?? null,
            text: fmt(PENDING_KIND[p.kind] ?? PENDING_KIND.initial, { name: sourceName(p.source, actor) }),
            canRoll: actor.isOwner && !!claim?.pending,
            canFail: actor.isOwner && p.kind === "initial" && traits.includes("drug"),
            canVoid: actor.isOwner && claim?.delivery === "injury",
            canBreath: actor.isOwner && claim?.delivery === "inhaled" && p.kind === "initial",
            waitingText: !claim?.pending ? loc("pf2e-artisans-workshop.Affliction.Waiting.Claim") : null,
        };
    });
    const trackers = [];
    for (const tracker of afflictions.trackersOf(actor)) {
        const run = afflictions.runOf(tracker);
        const def = await afflictions.definitionOfRun(run, tracker);
        const stages = [];
        for (const [i, stage] of (def?.stages ?? []).entries()) {
            const n = i + 1;
            stages.push({ label: fmt("PF2E.Item.Affliction.Stage", { stage: n }), current: run.phase === "active" && run.stage === n, parts: partsText(stage),
                interval: durationText(stage.duration), html: stage.unparsed && (run.source?.identified !== false || game.user.isGM) ? await stageParagraph(run.source, n) : null });
        }
        const next = run.phase === "onset" ? run.onsetEndsAt : run.nextDueAt;
        trackers.push({
            runId: tracker.id, uuid: tracker.uuid, name: sourceName(run.source, actor), img: tracker.img, stage: run.stage, onset: run.phase === "onset",
            stageText: run.phase === "onset" ? loc("PF2E.Item.Affliction.OnsetLabel") : fmt("pf2e-artisans-workshop.Affliction.StageOf", { n: number(run.stage), max: number(def?.stages.length ?? 1) }),
            nextText: Number.isFinite(next) ? fmt(run.phase === "onset" ? "pf2e-artisans-workshop.Affliction.OnsetEnds" : "pf2e-artisans-workshop.Affliction.NextSave", { when: inText(next - now) }) : null,
            maxText: Number.isFinite(run.maxEndsAt) ? fmt("pf2e-artisans-workshop.Affliction.MaxEnds", { when: inText(run.maxEndsAt - now) }) : null,
            pendingText: run.pending ? loc("pf2e-artisans-workshop.Affliction.SaveDue") : null,
            seq: run.pending?.seq ?? null, canRoll: actor.isOwner && !!run.pending, canEdit: actor.isOwner,
            undo: Object.keys(run.manual ?? {}).length > 0, repair: run.phase === "active", partial: def?.confidence !== "full" || def?.stages?.some((s) => s.unparsed),
            stages,
        });
    }
    const ended = Object.entries(actor.flags?.[MODULE_ID]?.afflictionEnded ?? {}).filter(([id]) => !actor.items.get(id)).slice(-3)
        .map(([runId, snap]) => ({ runId, text: fmt("pf2e-artisans-workshop.Affliction.Ended", { name: sourceName(snap.source?.flags?.[MODULE_ID]?.affliction?.run?.source, actor) }) }));
    if (!pending.length && !trackers.length && !ended.length) return null;
    return { uuid: actor.uuid, name: actor.name, img: actor.img, pending, trackers, ended };
}

/** The window's view (8.10.9): whether the tracker is on, the backend, and each creature this user sees with something to show. */
export async function afflictionsView() {
    const actors = [];
    for (const actor of viewedActors()) {
        const view = await actorView(actor);
        if (view) actors.push(view);
    }
    return { on: afflictions.afflictionsOn(), actors,
        backendText: loc(backend() === "native" ? "pf2e-artisans-workshop.Affliction.Backend.Native" : "pf2e-artisans-workshop.Affliction.Backend.Effect") };
}

export class AfflictionsApp extends HandlebarsApplicationMixin(ApplicationV2) {
    /** The open window, if any: one per client. */
    static instance = null;

    static DEFAULT_OPTIONS = {
        id: "pf2e-artisans-workshop-afflictions",
        classes: ["pf2e-artisans-workshop", "workshop-afflictions-window"],
        window: { title: "pf2e-artisans-workshop.Affliction.Title", icon: "fa-solid fa-skull-crossbones", resizable: true },
        position: { width: 480, height: 640 },
    };

    static PARTS = {
        body: { template: "modules/pf2e-artisans-workshop/templates/afflictions/drawer.hbs", scrollable: [""] },
    };

    /** Parchment's classes while the setting is on (M11 review). */
    constructor(options = {}) {
        super(withTheme(options));
    }

    /** Re-render after changes stop for a moment (10.1). */
    refresh = foundry.utils.debounce(() => {
        if (this.rendered) this.render({ parts: ["body"] });
    }, 200);

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return Object.assign(context, await afflictionsView());
    }

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        AfflictionsApp.instance = this;
        this.element.addEventListener("click", (event) => this.#onClick(event));
        // M11 review: Tab, Space and Enter belong to the focused control, never to core's keybindings (token cycling, pause).
        this.element.addEventListener("keydown", keepControlKeys);
    }

    _preSyncPartState(partId, newElement, priorElement, state) {
        super._preSyncPartState(partId, newElement, priorElement, state);
        state.workshopFocus = focusState(priorElement);
    }

    _syncPartState(partId, newElement, priorElement, state) {
        super._syncPartState(partId, newElement, priorElement, state);
        restoreFocus(newElement, state.workshopFocus);
    }

    _onClose(options) {
        super._onClose?.(options);
        if (AfflictionsApp.instance === this) AfflictionsApp.instance = null;
    }

    async #onClick(event) {
        const button = event.target?.closest?.("button[data-affliction]");
        if (!button || button.disabled) return;
        event.preventDefault();
        button.disabled = true;
        try {
            report(await runOp(button.dataset.affliction, button.dataset, this));
        } finally {
            if (button.isConnected) button.disabled = false;
        }
        this.refresh();
    }
}

/** One of the window's buttons, or a card's (the same operations). */
async function runOp(op, data, app = null) {
    const tracker = data.uuid ? fromUuidSync(data.uuid, { strict: false }) : null;
    switch (op) {
        case "roll": return afflictions.rollSave(data.actor, { runId: data.run, seq: Number(data.seq) });
        case "fail": return afflictions.rollSave(data.actor, { runId: data.run, seq: Number(data.seq) }, { voluntaryFail: true });
        case "void": return voidExposure(data.claim);
        case "breath": return holdBreath(data.claim);
        case "reduce": return afflictions.adjust(tracker, { stage: Number(data.stage) - 1 });
        case "end": {
            const ok = await confirm({ title: "pf2e-artisans-workshop.Affliction.End", content: "pf2e-artisans-workshop.Affliction.EndConfirm", app });
            return ok ? afflictions.adjust(tracker, { end: true }) : null;
        }
        case "end-onset": return afflictions.adjust(tracker, { endOnset: true });
        case "undo": return afflictions.adjust(tracker, { undo: true });
        case "repair": return afflictions.repair(tracker);
        case "undo-end": return afflictions.undoEnd(data.actor, data.run);
        default: return null;
    }
}

/** "Held breath" (8.10.3): +2 circumstance to the initial save of an inhaled exposure, written on its claim before the roll. */
async function holdBreath(claimId) {
    const claim = read(`claims.${claimId}`);
    if (!claim || claim.resolved) return { ok: false, reason: "no-save" };
    if (!actorOf(claim.actor)?.isOwner) return { ok: false, reason: "not-owner" };
    const applied = [...(claim.applied ?? [])];
    if (!applied.some((m) => m.slug === "held-breath")) applied.push({ slug: "held-breath" });
    await write({ replace: { [`claims.${claimId}.applied`]: applied } });
    return { ok: true };
}

/** Open the Afflictions window (`api.afflictions.open`, the Workshop header, the Bandolier, the cards). */
export async function openAfflictions() {
    const app = AfflictionsApp.instance ?? new AfflictionsApp();
    await app.render({ force: true });
    return { ok: true, app };
}

/** The Workshop header's count (10.2): pending saves of the user's characters. */
export function pendingBadge(actors) {
    return afflictions.afflictionsOn() ? afflictions.pendingCount(actors) : 0;
}

/* -------------------------------------------- */
/*  Cards                                        */
/* -------------------------------------------- */

/** Post a card, whispered to the owners of the creatures involved and GMs (or public). Never throws: a card is a courtesy. */
async function post(actor, kind, data, flags = {}, involved = [actor]) {
    try {
        const content = await foundry.applications.handlebars.renderTemplate(CARD, { kind, ...data });
        return await ChatMessage.implementation.create({
            content, speaker: ChatMessage.implementation.getSpeaker({ actor }), whisper: whisperFor(involved.filter(Boolean)),
            flags: { [MODULE_ID]: { card: { kind, order: null }, affliction: flags } },
        });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post a ${kind} card`, error);
        return null;
    }
}

/** Whether this user is told about an affliction of `actor` (`afflictions.notify`, U). */
function notifies(actor) {
    const level = setting("afflictions.notify") ?? "mine";
    return level === "all" || (level === "mine" && actor?.isOwner && (!game.user.isGM || !afflictions.playerOwned(actor)));
}

/**
 * The save prompt (10.5, 8.10.8): the save due, its DC where pf2e shows DCs, and its buttons; posted once per save (a reload
 * or a second sweep finds the card already there), with a notification for the user who should roll it.
 */
export async function postPromptCard({ victim, runId, seq, kind, claim = null, tracker = null, def = null, waiting = null, paused = false }) {
    const key = `${runId}:${seq}`;
    // One card per save and state: a "waiting for the player" card is followed by the player's own once they connect.
    const there = !paused && (game.messages ?? []).some?.((m) => m.flags?.[MODULE_ID]?.affliction?.prompt === key && !m.flags[MODULE_ID].affliction.paused &&
        (m.flags[MODULE_ID].affliction.waiting ?? null) === (waiting ?? null));
    const source = claim?.source ?? afflictions.runOf(tracker ?? victim.items?.get?.(runId))?.source ?? null;
    const name = source?.identified === false && afflictions.playerOwned(victim) ? loc("pf2e-artisans-workshop.Affliction.Generic") : source?.name ?? "";
    if (notifies(victim) && !waiting) ui.notifications.info(fmt("pf2e-artisans-workshop.Affliction.Notify.Due", { actor: victim.name, name }));
    if (there) return null;
    const traits = source?.traits ?? [];
    const dc = claim?.dc?.value ?? afflictions.runOf(tracker ?? victim.items?.get?.(runId))?.dc?.value ?? null;
    const lines = [{ icon: "fa-solid fa-dice-d20", text: loc(SAVE_KIND[kind] ?? SAVE_KIND.initial) }];
    if (Number.isInteger(dc)) lines.push({ icon: "fa-solid fa-bullseye", text: fmt("pf2e-artisans-workshop.Affliction.DcLine", { dc: String(dc), save: def?.save?.type ? loc(CONFIG.PF2E?.saves?.[def.save.type] ?? def.save.type) : "" }), dc: true });
    if (waiting) lines.push({ icon: "fa-solid fa-hourglass-half", text: loc(WAITING[waiting] ?? WAITING.owner) });
    if (paused) lines.push({ icon: "fa-solid fa-pause", text: fmt("pf2e-artisans-workshop.Affliction.Paused", { n: number(afflictions.afflictionSettings().catchUpLimit) }) });
    if (def?.reExposure === "table") lines.push({ icon: "fa-solid fa-book", text: loc("pf2e-artisans-workshop.Affliction.OwnRule") });
    const buttons = [];
    if (waiting !== "forge") {
        buttons.push({ op: "roll", actor: victim.uuid, run: runId, seq, icon: "fa-solid fa-dice-d20",
            label: loc(waiting === "owner" ? "pf2e-artisans-workshop.Affliction.RollForThem" : paused ? "pf2e-artisans-workshop.Affliction.Continue" : "pf2e-artisans-workshop.Affliction.Roll"),
            gm: waiting === "owner" });
    }
    if (kind === "initial" && traits.includes("drug")) buttons.push({ op: "fail", actor: victim.uuid, run: runId, seq, icon: "fa-solid fa-face-dizzy", label: loc("pf2e-artisans-workshop.Affliction.FailVoluntarily") });
    if (claim?.delivery === "injury") buttons.push({ op: "void", actor: victim.uuid, claim: claim.id, icon: "fa-solid fa-shield", label: loc("pf2e-artisans-workshop.Affliction.NoDamageThrough") });
    if (claim?.delivery === "inhaled" && kind === "initial") buttons.push({ op: "breath", actor: victim.uuid, claim: claim.id, icon: "fa-solid fa-wind", label: loc("pf2e-artisans-workshop.Affliction.HeldBreath") });
    return post(victim, "affliction-prompt", {
        heading: fmt("pf2e-artisans-workshop.Affliction.PromptHeading", { name }), img: source?.identified === false ? "icons/svg/poison.svg" : source?.img ?? null,
        summary: fmt("pf2e-artisans-workshop.Affliction.PromptSummary", { actor: victim.name, name }), lines: lines.filter((l) => !l.dc || showDcs()), buttons,
    }, { prompt: key, actor: victim.uuid, run: runId, seq, claim: claim?.id ?? null, paused, waiting: waiting ?? null });
}

/** The stage card (10.5): an onset ending, a stage change, an end, with the next save time. */
export async function postStageCard({ actor, from, to, reason, run }) {
    // A successful initial save changes nothing: pf2e's own save card says so.
    if (!actor || !run || (reason === "initial" && to === 0)) return null;
    const name = sourceName(run.source, actor);
    const key = to === 0 ? END[reason] ?? END.other
        : reason === "onset" ? "pf2e-artisans-workshop.Affliction.Change.Onset" : reason === "manual" ? "pf2e-artisans-workshop.Affliction.Change.Manual"
            : from === to ? "pf2e-artisans-workshop.Affliction.Change.Repeat" : "pf2e-artisans-workshop.Affliction.Change.Stage";
    const lines = [];
    const next = run.phase === "onset" ? run.onsetEndsAt : run.nextDueAt;
    if (to > 0 && Number.isFinite(next)) lines.push({ icon: "fa-solid fa-clock", text: fmt("pf2e-artisans-workshop.Affliction.NextSave", { when: inText(next - afflictions.clockNow()) }) });
    return post(actor, "affliction-stage", { heading: fmt("pf2e-artisans-workshop.Affliction.StageHeading", { name }), img: null,
        summary: fmt(key, { actor: actor.name, name, from: number(from ?? 0), to: number(to ?? 0) }), lines, buttons: [] }, { stage: true, actor: actor.uuid, run: run.id });
}

/** The coating card (10.5): applied, spent or kept, with Sticky Poison's flat check. */
export async function postCoatingCard({ actor, host, coating, kind, check = null, target = null, loaded = null }) {
    const name = coating?.source?.name ?? "";
    const lines = [];
    // A coated piece of ammunition (8.10.5): the launchers that now fire it, or a reminder to load it.
    if (Array.isArray(loaded)) {
        lines.push(loaded.length ? { icon: "fa-solid fa-crosshairs", text: fmt("pf2e-artisans-workshop.Affliction.Coating.Loaded", { weapons: loaded.join(", ") }) }
            : { icon: "fa-solid fa-crosshairs", text: loc("pf2e-artisans-workshop.Affliction.Coating.Load") });
    }
    if (check) lines.push({ icon: "fa-solid fa-dice-d20", text: fmt("pf2e-artisans-workshop.Affliction.Coating.Check", { total: String(check.total), dc: String(check.dc) }) });
    if (target) lines.push({ icon: "fa-solid fa-bullseye", text: fmt("pf2e-artisans-workshop.Affliction.Coating.Target", { target }) });
    if (kind === "applied" && Number.isInteger(coating?.dc?.value) && showDcs()) lines.push({ icon: "fa-solid fa-bullseye", text: fmt("pf2e-artisans-workshop.Affliction.DcLine", { dc: String(coating.dc.value), save: "" }) });
    const summary = fmt(COATING[kind] ?? COATING.applied, { actor: actor?.name ?? "", host, name });
    return post(actor, "affliction-coating", { heading: loc("pf2e-artisans-workshop.Affliction.Coating.Heading"), img: coating?.source?.img ?? null, summary, lines, buttons: [] },
        { coating: coating?.id ?? null });
}

/** The cloud card (10.5): an inhaled poison unleashed, with Expose for each creature that enters while it lasts. */
export async function postCloudCard({ actor, cloud }) {
    return post(actor, "affliction-cloud", {
        heading: fmt("pf2e-artisans-workshop.Affliction.Cloud.Heading", { name: cloud.source.name }), img: cloud.source.img ?? null,
        summary: fmt("pf2e-artisans-workshop.Affliction.Cloud.Summary", { actor: actor?.name ?? "", name: cloud.source.name }),
        lines: [{ icon: "fa-solid fa-clock", text: fmt("pf2e-artisans-workshop.Affliction.Cloud.Until", { when: inText(cloud.until - (game.time.worldTime ?? 0)) }) }],
        buttons: [{ op: "cloud", actor: actor?.uuid ?? null, icon: "fa-solid fa-wind", label: loc("pf2e-artisans-workshop.Affliction.Cloud.Expose") }],
    }, { cloud }, [actor]);
}

/** Creatures a user may pick as targets without a canvas: the party and the encounters' combatants. */
function candidates(actor = null) {
    const out = [];
    const add = (a) => {
        if (a && !out.includes(a)) out.push(a);
    };
    for (const member of game.actors?.party?.members ?? []) add(member);
    for (const combat of game.combats ?? []) for (const c of combat.combatants ?? []) add(c.actor);
    if (actor) add(actor);
    return out;
}

/** The creatures an exposure goes to: the user's targets, else one picked from the party and the encounters. */
async function pickTargets(actor = null) {
    const targeted = [...(game.user.targets ?? [])].map((t) => t.actor).filter(Boolean);
    if (targeted.length) return targeted;
    const list = candidates(actor);
    const answer = await askChoice({ title: "pf2e-artisans-workshop.Affliction.Expose", label: "pf2e-artisans-workshop.Affliction.WhichCreature",
        options: list.map((a) => ({ value: a.uuid, name: a.name })), button: "pf2e-artisans-workshop.Affliction.Expose", icon: "fa-solid fa-skull-crossbones" });
    return answer?.value ? [actorOf(answer.value)].filter(Boolean) : [];
}

/** Whether this user may use a card button. */
function mayUse(message, button) {
    if (button.dataset.gm === "true") return game.user.isGM;
    const actor = actorOf(button.dataset.actor);
    if (button.dataset.pf2eArtisansWorkshopOp === "cloud") return true;
    return !!actor?.isOwner;
}

/** One card button. */
async function runCardOp(message, button) {
    const op = button.dataset.pf2eArtisansWorkshopOp;
    if (op === "cloud") {
        const cloud = message.flags?.[MODULE_ID]?.affliction?.cloud;
        if (!cloud || (game.time.worldTime ?? 0) > cloud.until) return { ok: false, reason: "cloud-gone" };
        const targets = await pickTargets();
        return afflictions.expose({ item: cloud.source.uuid, targets, delivery: "inhaled", key: `${cloud.id}-${afflictions.clockNow()}`, coating: cloud,
            deliverer: actorOf(button.dataset.actor) });
    }
    return runOp(op, button.dataset);
}

/**
 * Whether a prompt card's save has been rolled (its claim resolved, or the run recorded the save). Unknown (null) while this
 * client has not found the ledger yet: the chat log renders at load before the module does (M8a live pass), and a pending
 * initial save, read from its claim, would read as rolled.
 */
function promptDone(message) {
    const flags = message.flags?.[MODULE_ID]?.affliction ?? {};
    const victim = actorOf(flags.actor);
    if (!victim) return true;
    if (!shared().ledger) return null;
    return !afflictions.pendingOf(victim).some((p) => p.runId === flags.run && p.seq === flags.seq);
}

/** Prompt cards as this client last rendered them: rolled or not, by message id, so a change re-renders only those. */
const shownDone = new Map();

/** Wire an affliction card's buttons on this client: hidden from users who may not use them; a rolled prompt says so. */
export function renderAfflictionCard(message, html) {
    const card = message.flags?.[MODULE_ID]?.card;
    if (!card || !AFFLICTION_CARDS.includes(card.kind) || !foundry.utils.isElementInstanceOf(html, HTMLElement)) return false;
    const done = card.kind === "affliction-prompt" ? promptDone(message) === true : false;
    if (card.kind === "affliction-prompt") shownDone.set(message.id, done);
    if (done) {
        for (const button of html.querySelectorAll("button[data-pf2e-artisans-workshop-op]")) button.hidden = true;
        const state = html.querySelector(".card-state");
        if (state) {
            state.hidden = false;
            state.textContent = loc("pf2e-artisans-workshop.Affliction.Rolled");
        }
        return true;
    }
    for (const button of html.querySelectorAll("button[data-pf2e-artisans-workshop-op]")) {
        if (!mayUse(message, button)) {
            button.hidden = true;
            continue;
        }
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            if (button.disabled) return;
            button.disabled = true;
            try {
                report(await runCardOp(message, button));
            } finally {
                button.disabled = false;
            }
        });
    }
    return true;
}

/* -------------------------------------------- */
/*  The item card augment (10.4, 8.10.3)         */
/* -------------------------------------------- */

/** Whether an item has stage text (or an override), so its card offers Expose. */
function hasStages(item) {
    return isCandidate(item?.system?.description?.value ?? "");
}

/** The items a poison can coat on its holder (8.10.5). */
function hostsFor(actor, poison) {
    const delivery = applyDelivery(poison);
    return [...(actor?.items ?? [])].filter((i) => i !== poison && (delivery === "injury" ? ["weapon", "ammo"].includes(i.type)
        : delivery === "ingested" ? i.type === "consumable" && ([...(i.system?.traits?.value ?? [])].some((t) => ["food", "drink"].includes(t)) || ["food", "drink"].includes(i.system?.category))
            : i.isOfType?.("physical") ?? ["weapon", "armor", "equipment", "consumable", "ammo", "treasure", "backpack", "shield"].includes(i.type)));
}

/**
 * Apply a poison from the interface (8.10.5): the item to coat is asked for; a coated weapon asks whether to replace the
 * coating, or, with Double Poison, merge the two.
 */
export async function applyPoisonFlow(poison, actor = poison?.actor, app = null) {
    const hosts = hostsFor(actor, poison);
    const answer = await askChoice({ title: "pf2e-artisans-workshop.Affliction.Apply", label: "pf2e-artisans-workshop.Affliction.WhichItem",
        options: hosts.map((h) => ({ value: h.id, name: coatingOf(h) ? fmt("pf2e-artisans-workshop.Affliction.Coated", { item: h.name, name: coatingOf(h).source?.name ?? "" }) : h.name })),
        button: "pf2e-artisans-workshop.Affliction.Apply", icon: "fa-solid fa-droplet", app });
    if (!answer?.value) return null;
    const host = actor.items.get(answer.value);
    let result = await applyPoison({ poison, weapon: host, actor });
    if (result?.reason === "coated") {
        if (heldKeysOf(actor).includes("double-poison") && applyDelivery(poison) === "injury" && host.type === "weapon") {
            const pick = await askChoice({ title: "pf2e-artisans-workshop.Affliction.Apply", label: "pf2e-artisans-workshop.Affliction.CoatedChoice",
                options: [{ value: "replace", name: loc("pf2e-artisans-workshop.Affliction.Replace") }, { value: "double", name: loc("pf2e-artisans-workshop.Affliction.DoublePoison") }],
                button: "pf2e-artisans-workshop.Affliction.Apply", icon: "fa-solid fa-droplet", app });
            if (!pick?.value) return null;
            result = await applyPoison({ poison, weapon: host, actor, replace: pick.value === "replace", double: pick.value === "double" });
        } else if (await confirm({ title: "pf2e-artisans-workshop.Affliction.Apply", content: "pf2e-artisans-workshop.Affliction.ReplaceConfirm", app })) {
            result = await applyPoison({ poison, weapon: host, actor, replace: true });
        } else return null;
    }
    return result;
}

/**
 * Expose from the interface (8.10.3): ingested exposes the item's holder, the others the user's targets (or one picked); a
 * save `against` a statistic asks for the DC; an item nothing parses opens the world-definition form first.
 */
export async function exposeFlow(item) {
    let def = await definitionOf(item);
    if (!def?.stages?.length || !def.save?.type) {
        const defined = await defineFlow(item);
        if (!defined?.ok) return defined;
        def = await definitionOf(item);
    }
    const delivery = deliveryOf([...(item.system?.traits?.value ?? []), ...(def?.traits ?? [])]);
    let dc = null;
    if (!Number.isInteger(def.save?.value) && !item.flags?.[MODULE_ID]?.dcStamp) {
        const answer = await askChoice({ title: "pf2e-artisans-workshop.Affliction.Expose", number: { label: "pf2e-artisans-workshop.Affliction.SaveDc", min: 1, value: 15 },
            button: "pf2e-artisans-workshop.Affliction.Expose", icon: "fa-solid fa-skull-crossbones" });
        if (!answer?.number) return null;
        dc = answer.number;
    }
    if (delivery === "inhaled") return unleash({ poison: item, actor: item.actor, targets: await pickTargets(item.actor) });
    const targets = delivery === "ingested" && item.actor ? [item.actor] : await pickTargets(item.actor);
    return afflictions.expose({ item, targets, delivery, dc, deliverer: item.actor ?? game.user.character ?? null });
}

/**
 * The world-definition form (8.10.2): stages, intervals, save, onset and maximum duration, each stage's conditions and damage
 * in plain words ("drained 1, 1d6 poison"), read by the same grammar as compendium text. Any member may fill it in; it is
 * stored in the ledger with its author and the whole party reuses it.
 */
export async function defineFlow(item) {
    const sourceUuid = sourceUuidOf(item);
    const saves = ["fortitude", "reflex", "will"].map((value) => ({ value, label: CONFIG.PF2E?.saves?.[value] ?? value, selected: value === "fortitude" }));
    const stages = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, label: fmt("PF2E.Item.Affliction.Stage", { stage: i + 1 }), text: "", interval: "" }));
    const content = await foundry.applications.handlebars.renderTemplate(DEFINE, { saves, dc: "", onset: "", max: "", stages });
    const answer = await foundry.applications.api.DialogV2.prompt({
        window: { title: "pf2e-artisans-workshop.Affliction.Define.Title", icon: "fa-solid fa-pen" }, content,
        ok: { label: "pf2e-artisans-workshop.Affliction.Define.Save", icon: "fa-solid fa-check", callback: (_event, target) => new foundry.applications.ux.FormDataExtended(target.form).object },
        rejectClose: false,
    });
    if (!answer) return null;
    // The table's own words, read by the compendium grammar: never shipped, stored only in this world's ledger.
    const p = (label, rest) => (rest ? `<p><strong>${label}</strong> ${foundry.utils.escapeHTML(String(rest))}</p>` : "");
    let html = p("Saving Throw", `@Check[${answer.save}|dc:${Number(answer.dc) || 0}]`) + p("Onset", answer.onset) + p("Maximum Duration", answer.max);
    for (let n = 1; n <= 6; n++) {
        if (answer[`stage${n}`] || answer[`interval${n}`]) html += p(`Stage ${n}`, `${answer[`stage${n}`] ?? ""} (${answer[`interval${n}`] || "1 round"})`);
    }
    const def = parseAffliction(html, { level: item.system?.level?.value ?? 0, traits: [...(item.system?.traits?.value ?? [])] });
    if (def.confidence !== "full" || !Number.isInteger(def.save.value) || def.save.value < 1) return { ok: false, reason: "bad-definition", data: { problems: def.problems } };
    return defineWorld(sourceUuid, def);
}

/** Add the augment under a pf2e item card whose item has stage text or a coating. */
export function augmentItemCard(message, html) {
    if (!afflictions.afflictionsOn() || !foundry.utils.isElementInstanceOf(html, HTMLElement)) return false;
    if (message.flags?.[MODULE_ID]?.card) return false;
    const uuid = message.flags?.pf2e?.origin?.uuid ?? null;
    if (!uuid || message.flags?.pf2e?.context?.type) return false;
    const item = fromUuidSync(uuid, { strict: false });
    if (!item || html.querySelector(".pf2e-artisans-workshop-affliction-augment")) return false;
    const buttons = [];
    const button = (key, icon, run) => {
        const el = html.ownerDocument.createElement("button");
        el.type = "button";
        el.dataset.pf2eArtisansWorkshopOp = "affliction";
        el.innerHTML = `<i class="${icon}" inert></i> `;
        el.append(loc(key));
        el.addEventListener("click", async (event) => {
            event.preventDefault();
            el.disabled = true;
            try {
                report(await run());
            } finally {
                el.disabled = false;
            }
        });
        buttons.push(el);
    };
    const owned = item.isOwner;
    if (owned && hasStages(item)) {
        button("pf2e-artisans-workshop.Affliction.Expose", "fa-solid fa-skull-crossbones", () => exposeFlow(item));
        if (applyDelivery(item) && item.actor) button("pf2e-artisans-workshop.Affliction.Apply", "fa-solid fa-droplet", () => applyPoisonFlow(item));
    }
    const coating = coatingOf(item);
    if (coating && coating.delivery !== "injury" && !coatingSpent(coating)) {
        const toucher = game.user.character ?? canvas?.tokens?.controlled?.[0]?.actor ?? null;
        if (toucher) button(coating.delivery === "ingested" ? "pf2e-artisans-workshop.Affliction.Eaten" : "pf2e-artisans-workshop.Affliction.Touched", "fa-solid fa-hand",
            () => touchCoating({ host: item, toucher }));
    }
    if (!buttons.length) return false;
    const div = html.ownerDocument.createElement("div");
    div.className = "card-buttons pf2e-artisans-workshop-affliction-augment";
    div.append(...buttons);
    (html.querySelector(".card-content") ?? html.querySelector(".message-content") ?? html).append(div);
    return true;
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

/** Hooks at `init`: the cards from the client that did the thing, their buttons on every client, the augment, live updates. */
export function registerAfflictionUi() {
    Hooks.on(`${MODULE_ID}.afflictionPrompt`, (payload) => {
        postPromptCard(payload).catch((error) => console.warn(`${MODULE_ID} | could not post a save prompt`, error));
    });
    Hooks.on(`${MODULE_ID}.afflictionChanged`, (payload) => {
        postStageCard(payload).catch((error) => console.warn(`${MODULE_ID} | could not post a stage card`, error));
        AfflictionsApp.instance?.refresh();
    });
    // A save recorded anywhere: the prompt cards of that affliction shown here say "rolled" (rendered again locally, 10.5).
    // Also once this client finds the ledger: a card rendered before it showed its buttons, and one now rolled says so.
    const rerender = () => {
        for (const message of game.messages ?? []) {
            if (message.flags?.[MODULE_ID]?.card?.kind !== "affliction-prompt" || !shownDone.has(message.id) || !ui.chat) continue;
            if (shownDone.get(message.id) !== (promptDone(message) === true)) rerenderShown(message);
        }
    };
    Hooks.on(`${MODULE_ID}.status`, rerender);
    for (const name of ["updateItem", "createItem", "deleteItem"]) {
        Hooks.on(name, (item) => {
            if (item?.flags?.[MODULE_ID]?.affliction?.run) rerender();
        });
    }
    Hooks.on("updateJournalEntry", (doc, changed) => {
        if (changed?.flags?.[MODULE_ID]?.claims) rerender();
    });
    Hooks.on(`${MODULE_ID}.afflictionCoating`, (payload) => {
        postCoatingCard(payload).catch(() => null);
    });
    Hooks.on(`${MODULE_ID}.afflictionCloud`, (payload) => {
        postCloudCard(payload).catch(() => null);
    });
    Hooks.on(`${MODULE_ID}.afflictionNotice`, ({ reason }) => {
        ui.notifications.warn(reason === "conflict" ? "pf2e-artisans-workshop.Affliction.Conflict" : "pf2e-artisans-workshop.Affliction.AlreadyRolled", { localize: true });
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        try {
            renderAfflictionCard(message, html);
            augmentItemCard(message, html);
        } catch (error) {
            console.warn(`${MODULE_ID} | could not render an affliction card`, error);
        }
    });
    for (const name of ["createItem", "updateItem", "deleteItem", "updateWorldTime", "combatTurnChange", "updateJournalEntry"]) {
        Hooks.on(name, () => AfflictionsApp.instance?.refresh());
    }
}
