/**
 * Rest ordering (DESIGN.md 7.8, M7): what the module does after Rest for the Night, and when.
 *
 * pf2e's rest (pf2e source, verified) makes its writes in three steps (temporary items deleted; frequencies, resources and
 * `dailyCraftingComplete` in one batched update; prepared formulas un-expended), then fires `pf2e.restForTheNight` on the
 * resting client only and creates one chat message per character with the creation option `restForTheNight`, which every
 * client sees. pf2e-dailies, when active, wraps the whole rest: after the system returns, it runs its own cleanup and sets
 * `flags["pf2e-dailies"].rested = true` in one batched update, after both system signals.
 *
 * The post-rest pipeline (a new preparation cycle with its expiry claim, 7.7, and one Morning prompt; a character in
 * downtime with no standing routine gets the prompt only, 7.2) runs on the rested character's responsible client (5.6), so
 * a GM resting the whole party from the party sheet prompts each character's own player:
 * - without pf2e-dailies: on `createChatMessage` with `options.restForTheNight`, once the actor's updates stop
 *   (`SETTLE_MS` after the last one, `SETTLE_LIMIT_MS` at most);
 * - with pf2e-dailies: when its `rested` flag becomes true, with a fallback `DAILIES_FALLBACK_MS` after the rest message.
 * The rest's message id is the cycle's key, so the same rest never raises the cycle twice.
 *
 * With pf2e-dailies, its interface records the Morning choice (`dailies.mjs`); when the interface has run (its `rested`
 * flag goes back to false), the character's responsible client applies the choice through the system methods (7.9, OQ-20).
 */
import { MODULE_ID } from "../constants.mjs";
import { TALISMAN_POOLS, afterRest, talismanPicksOf } from "../logic/morning.mjs";
import { statusOf } from "./downtime.mjs";
import { beginCycle, expiryOn } from "./expiry.mjs";
import { applyMorning, dailiesActive, hasDailySources, isApplying, morningOf, morningOn, stampSheetCrafting } from "./morning.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { canWrite } from "./state.mjs";

/** Quiet time after the rested actor's last update before the pipeline runs (7.8 "a short settle"). */
export const SETTLE_MS = 750;
/** The longest the settle waits for updates to stop. */
export const SETTLE_LIMIT_MS = 5000;
/** How long after the rest message to wait for pf2e-dailies' `rested` flag (7.8: default 5 seconds). */
export const DAILIES_FALLBACK_MS = 5000;
/** Quiet time after pf2e's own daily crafting before its items are stamped (they arrive after its flag). */
export const SHEET_SETTLE_MS = 1500;

/** Rests waiting for their pipeline on this client, by actor id: `{key, dailies, timer, since}`. */
const pending = new Map();
/** Sheet daily crafting waiting to be stamped, by actor id. */
const sheetTimers = new Map();

/** The Morning prompt (7.8): one notification on this (the responsible) client, and the Morning tab's badge. */
function prompt(actor) {
    ui.notifications.info("pf2e-artisans-workshop.Morning.Prompt", { format: { actor: actor.name } });
    Hooks.callAll("pf2e-artisans-workshop.morningPrompt", actor);
}

/**
 * The post-rest pipeline for one rest (7.8): a new cycle unless the character is in downtime without a standing routine
 * (7.2), then the prompt. Returns what it did.
 */
export async function afterRestFor(actor, key) {
    pending.delete(actor.id);
    if (!canWrite() || !isResponsibleFor(actor)) return { ok: false, reason: "not-responsible" };
    const step = afterRest(statusOf(actor));
    // Only a character that makes things at its preparations (a daily pool or versatile vials) has a cycle worth raising:
    // nothing else is ever stamped with it, so a fighter's rest writes nothing.
    const sources = hasDailySources(actor);
    let cycle = null;
    if (step.cycle && sources && (expiryOn() || morningOn())) cycle = await beginCycle(actor, { key, reason: "rest" });
    const prompted = step.prompt && sources && morningOn();
    if (prompted) prompt(actor);
    return { ok: true, cycle, prompted };
}

/** Run a waiting rest now. */
function runNow(actorId) {
    const entry = pending.get(actorId);
    const actor = game.actors.get(actorId);
    if (!entry || !actor) return;
    clearTimeout(entry.timer);
    afterRestFor(actor, entry.key).catch((error) => console.error(`${MODULE_ID} | the post-rest pipeline failed`, error));
}

/** (Re)start a waiting rest's timer. */
function arm(actorId, ms) {
    const entry = pending.get(actorId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => runNow(actorId), ms);
}

/** A rest's chat message (every client sees it): its character's responsible client waits for the rest to settle. */
export function onRestMessage(message, options) {
    if (!options?.restForTheNight) return;
    const actor = game.actors.get(message.speaker?.actor ?? "");
    if (!actor || actor.type !== "character" || !isResponsibleFor(actor)) return;
    const dailies = dailiesActive();
    pending.set(actor.id, { key: message.id, dailies, timer: null, since: Date.now() });
    arm(actor.id, dailies ? DAILIES_FALLBACK_MS : SETTLE_MS);
}

/**
 * The rested actor's updates: without pf2e-dailies each one puts the pipeline off until they stop (at most
 * `SETTLE_LIMIT_MS` after the message); with it, `rested: true` runs it at once. pf2e-dailies' `rested: false` means its
 * interface has run: the recorded Morning choice is applied. pf2e's own daily crafting from the sheet is stamped once its
 * items settle.
 */
export function onActorUpdate(actor, changed) {
    const entry = pending.get(actor.id);
    const rested = changed?.flags?.["pf2e-dailies"]?.rested;
    if (entry) {
        if (entry.dailies && rested === true) runNow(actor.id);
        else if (!entry.dailies) arm(actor.id, Math.max(0, Math.min(SETTLE_MS, SETTLE_LIMIT_MS - (Date.now() - entry.since))));
    }
    if (rested === false && isResponsibleFor(actor)) applyChoiceSoon(actor);
    if (changed?.flags?.pf2e?.dailyCraftingComplete === true && isResponsibleFor(actor) && !isApplying(actor)) {
        clearTimeout(sheetTimers.get(actor.id));
        sheetTimers.set(actor.id, setTimeout(() => {
            sheetTimers.delete(actor.id);
            stampSheetCrafting(actor).catch((error) => console.error(`${MODULE_ID} | stamping the sheet's daily crafting failed`, error));
        }, SHEET_SETTLE_MS));
    }
}

/**
 * Apply a Morning choice recorded in pf2e-dailies' interface (7.9), once, for the cycle it was made in: each pool keeps its
 * preparation or takes the loadout chosen; a talisman pool kept makes again the virtual talismans of the last preparation
 * (they are never in pf2e's prepared list, 7.4). A pool left for the Workshop means nothing is made now (the prompt
 * stands, and the row says so).
 */
export async function applyChoice(actor) {
    const morning = morningOf(actor);
    const choice = morning.choice;
    if (!choice || choice.applied || !morningOn()) return { ok: false, reason: "no-choice" };
    if (choice.cycle !== statusOf(actor).prepCycle) return { ok: false, reason: "stale-choice" };
    const pools = {};
    const talismans = {};
    const last = talismanPicksOf(morning.talismans);
    for (const [slug, value] of Object.entries(choice.pools ?? {})) {
        if (value === "later") return { ok: false, reason: "later" };
        pools[slug] = value === "keep" ? { mode: "keep" } : { mode: "loadout", id: value };
        if (value === "keep" && TALISMAN_POOLS.includes(slug) && last[slug]?.length) talismans[slug] = last[slug];
    }
    // pf2e-dailies' window does not ask where the character prepares (Herbalist): the last preparation's answer stands.
    return applyMorning(actor, { pools, talismans, standing: choice.standing === false ? [] : "due", choice: true, wilderness: morning.wilderness === true });
}

/** Choices waiting to be applied, by actor id: one timer each, so a party's choices never cancel each other. */
const choiceTimers = new Map();
function applyChoiceSoon(actor) {
    clearTimeout(choiceTimers.get(actor.id));
    choiceTimers.set(actor.id, setTimeout(() => {
        choiceTimers.delete(actor.id);
        applyChoice(actor).then((result) => {
            if (result.ok) ui.notifications.info("pf2e-artisans-workshop.Morning.Applied", { format: { actor: actor.name } });
        }).catch((error) => console.error(`${MODULE_ID} | applying the Morning choice failed`, error));
    }, SETTLE_MS));
}

/** Hooks at `init`. */
export function registerRestHooks() {
    Hooks.on("createChatMessage", (message, options) => onRestMessage(message, options));
    Hooks.on("updateActor", (actor, changed) => onActorUpdate(actor, changed));
}

/** For tests only. */
export function resetRest() {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
    for (const timer of sheetTimers.values()) clearTimeout(timer);
    sheetTimers.clear();
    for (const timer of choiceTimers.values()) clearTimeout(timer);
    choiceTimers.clear();
}

/** For tests only: the rests waiting on this client. */
export const pendingRests = () => [...pending.keys()];
