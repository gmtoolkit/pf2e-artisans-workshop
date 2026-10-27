/**
 * Macros and the macro shelf (DESIGN.md 11.1, 10.2, 10.6, M11).
 *
 * - **Running a macro** (`runMacro`, the API's `macros.run`): the catalogue (`scripts/logic/macros.mjs`) names the API
 *   member and its arguments; a run calls it and tells the user what came of it: a refusal as a warning, a step already
 *   taken as "Already done" (11.1: a double click is harmless). A run without an argument the macro needs asks for it
 *   instead (`interactive`): the request form, the order's funding prompt, the tab where the choice is made, or a question.
 * - **The shelf** (`MacroShelf`): every macro of the catalogue whose feature is on, as a tile with what it calls. A tile
 *   can be run, dragged onto the hotbar, or added to the hotbar's first free slot with a button (the drag's keyboard
 *   alternative, 10.9). It opens from the Workshop's status bar and `api.ui.macros()`.
 * - **The hotbar** (`hotbarDrop`): a tile dropped on a slot becomes a world script macro holding the catalogue's one line
 *   (`macroCommand`), flagged with the macro's id; the user's own macro of that id is reused, so dragging a tile twice
 *   makes one macro. Script macros need core's `MACRO_SCRIPT` permission (Player by default); without it the shelf says so
 *   and offers Run only.
 */
import { MODULE_ID } from "../constants.mjs";
import { familyBaseName } from "../logic/families.mjs";
import { deliveryOf } from "../logic/affliction.mjs";
import { GROUP_KEY, WHO_KEY, apiCallText, macroArgs, macroById, macroCommand, missingArgs, shelfGroups } from "../logic/macros.mjs";
import { finishableOrders } from "../logic/entry.mjs";
import { queueOrder } from "../logic/views.mjs";
import { afflictionsOn } from "../foundry/afflictions.mjs";
import { combatOn } from "../foundry/combat.mjs";
import { consumablesOn } from "../foundry/consumables.mjs";
import { downtimeOn } from "../foundry/downtime.mjs";
import { familyOfItem, physicalOf, traitsOf, usableConsumable } from "../foundry/item-facts.mjs";
import { incomeOn } from "../foundry/jobs.mjs";
import { morningOn } from "../foundry/morning.mjs";
import { allOrders } from "../foundry/orders.mjs";
import { isEnabled } from "../foundry/settings.mjs";
import { refusalText } from "./format.mjs";
import { formulasOn } from "./formulas.mjs";
import { askChoice } from "./prompts.mjs";
import { focusState, keepControlKeys, restoreFocus } from "./focus.mjs";
import { withTheme } from "./theme.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** The drag data type of a shelf tile, which the `hotbarDrop` handler takes. */
export const DRAG_TYPE = `${MODULE_ID}.macro`;

/** Whether a catalogue feature is on (14.1): the shelf leaves out the macros of a feature that is off. */
const FEATURE_ON = Object.freeze({
    "features.morning": () => morningOn(),
    "features.downtime": () => downtimeOn(),
    "features.income": () => downtimeOn() && incomeOn(),
    "features.formulas": () => formulasOn(),
    // Off while Duct Tape is active too (8): its macros would only refuse.
    "features.combat": () => combatOn(),
    "features.consumables": () => consumablesOn(),
    "features.afflictions": () => afflictionsOn(),
});
export const featureOn = (feature) => (FEATURE_ON[feature] ?? (() => true))();

/** The actor a run is about (11.1): the given one (document or UUID), the single controlled token's, the user's character. */
function actorFor(ref) {
    if (ref) return typeof ref === "string" ? fromUuidSync(ref, { strict: false }) : ref;
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length === 1) return controlled[0].actor;
    return game.user.character ?? null;
}

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/**
 * Tell the user what a run came to: a refusal (`ok: false`) as a warning with its sentence; a step that was already taken
 * (`outcome: "already"`) as "Already done". Anything else (an opened window, a made item) says nothing.
 */
export function reportRun(result) {
    if (result?.ok === false) ui.notifications.warn(refusalText(result));
    else if (result?.outcome === "already" || result?.already === true) ui.notifications.info("pf2e-artisans-workshop.Macro.Already", { localize: true });
    return result;
}

/** Call the API member a catalogue entry names, with `args`. */
function callApi(api, entry, args) {
    const [namespace, member] = entry.call.split(".");
    const fn = api?.[namespace]?.[member];
    if (typeof fn !== "function") return refuse("no-macro");
    return fn(args);
}

/** Ask which of `options` (`{value, name}`) to use; null when the user closes the question or there is nothing to choose. */
const ask = (title, label, options, button, icon) => askChoice({ title, label, options, button, icon });

/**
 * What a run without a required argument does instead (11.1's "opens the form unless every field is given"): the window,
 * tab or question that asks for it. Returns a result for `reportRun`.
 */
async function interactive(api, entry, args) {
    const { openWorkshop, WorkshopApp } = await import("./workshop.mjs");
    const actor = actorFor(args.actor ?? null);
    switch (entry.id) {
        case "request-item": return callApi(api, entry, args);   // the API opens the request form without a uuid
        case "pledge": {
            // An order named: its funding prompt, with the shortfall filled in. None: the open orders, to pick one.
            if (!args.order) return openWorkshop({ tab: "queue", filter: "open" });
            const app = await openWorkshop({ tab: "queue", order: args.order });
            return (app ?? WorkshopApp.instance)?.fundPrompt(args.order, { prefill: true }) ?? null;
        }
        case "finish-order": {
            if (!actor) return refuse("no-actor");
            // The crafter's one finishable order opens on its detail, where Finish asks where any shortfall comes from.
            const candidates = finishableOrders(queueOrder(allOrders()), actor.uuid);
            if (!candidates.length) return refuse("nothing-to-finish", { actor: actor.name });
            if (candidates.length === 1) return openWorkshop({ tab: "queue", order: candidates[0].id, actor: actor.uuid });
            return openWorkshop({ tab: "queue", filter: "mine", actor: actor.uuid });
        }
        case "earn-income": return actor ? openWorkshop({ tab: "downtime", actor: actor.uuid }) : refuse("no-actor");
        case "learn-formula": return actor ? openWorkshop({ tab: "formulas", actor: actor.uuid }) : refuse("no-actor");
        case "quick-bomb": return api.alchemy.openPanel({ actor, bombs: true });
        case "use-best": {
            if (!actor) return refuse("no-actor");
            const families = new Map();
            for (const item of physicalOf(actor).filter(usableConsumable)) {
                const family = familyOfItem(item);
                if (family && !families.has(family)) families.set(family, familyBaseName(item.name));
            }
            const answer = await ask("pf2e-artisans-workshop.Macro.UseBest.Name", "pf2e-artisans-workshop.Macro.Ask.Family",
                [...families].map(([value, name]) => ({ value, name })), "pf2e-artisans-workshop.Consumables.Use", "fa-solid fa-hand-sparkles");
            return answer?.value ? callApi(api, entry, { ...args, family: answer.value, actor }) : null;
        }
        case "apply-poison": {
            if (!actor && !args.poison) return refuse("no-actor");
            const { applyPoisonFlow } = await import("./afflictions.mjs");
            const { applyDelivery } = await import("../foundry/coatings.mjs");
            let poison = typeof args.poison === "string" ? fromUuidSync(args.poison, { strict: false }) ?? actor?.items?.get(args.poison) : args.poison;
            if (!poison) {
                const poisons = physicalOf(actor).filter((item) => applyDelivery(item));
                const answer = await ask("pf2e-artisans-workshop.Affliction.Apply", "pf2e-artisans-workshop.Macro.Ask.Poison",
                    poisons.map((p) => ({ value: p.id, name: p.name })), "pf2e-artisans-workshop.Affliction.Apply", "fa-solid fa-droplet");
                poison = answer?.value ? actor.items.get(answer.value) : null;
            }
            return poison ? applyPoisonFlow(poison, poison.actor ?? actor) : null;
        }
        case "expose": {
            if (!actor) return refuse("no-actor");
            const { exposeFlow } = await import("./afflictions.mjs");
            // Items with a delivery trait (a poison, a drug, a disease vector): what a definition can be read from.
            const items = physicalOf(actor).filter((item) => deliveryOf(traitsOf(item)) || traitsOf(item).includes("poison"));
            const answer = await ask("pf2e-artisans-workshop.Affliction.Expose", "pf2e-artisans-workshop.Macro.Ask.Item",
                items.map((i) => ({ value: i.id, name: i.name })), "pf2e-artisans-workshop.Affliction.Expose", "fa-solid fa-skull-crossbones");
            return answer?.value ? exposeFlow(actor.items.get(answer.value)) : null;
        }
        default: return refuse("no-macro");
    }
}

/**
 * Run a macro of the catalogue (`api.macros.run`): its API call with `args` over its defaults, the wizard for "Advance
 * days" (11.1: it opens the wizard), the Morning tab for "Affix talismans", or the interactive path when a required
 * argument is missing. Every result is reported (`reportRun`) and returned.
 */
export async function runMacro(api, id, args = {}) {
    const entry = macroById(id);
    if (!entry) return reportRun(refuse("no-macro"));
    if (!isEnabled()) return reportRun(refuse("not-ready"));
    const all = macroArgs(entry, args);
    let result;
    try {
        if (entry.feature && !featureOn(entry.feature)) result = refuse("macro-off");
        else if (entry.wizard) {
            const { openAdvance } = await import("./advance.mjs");
            result = await openAdvance({ mode: "advance", count: Number.isInteger(all.days) && all.days > 0 ? all.days : 1, advanceClock: all.advanceClock === true });
        } else if (missingArgs(entry, all).length) result = await interactive(api, entry, all);
        else if (entry.opens === "morning") {
            const actor = actorFor(all.actor);
            if (!actor) result = refuse("no-actor");
            else {
                const board = await callApi(api, entry, { ...all, actor });
                const { openWorkshop } = await import("./workshop.mjs");
                const app = await openWorkshop({ tab: "morning", actor: actor.uuid });
                app?.element?.querySelector?.(".morning-affix")?.scrollIntoView?.({ block: "start" });
                result = board ?? null;
            }
        } else result = await callApi(api, entry, all);
    } catch (error) {
        console.error(`${MODULE_ID} | macro ${id} failed`, error);
        result = refuse("macro-error");
    }
    return reportRun(result);
}

/* -------------------------------------------- */
/*  The hotbar                                   */
/* -------------------------------------------- */

/** Creations in flight on this client, by macro id: two quick drops of one tile make one macro. */
const creating = new Map();

/** The user's own macro of a catalogue entry (flagged with its id), or null. */
export function ownMacroOf(id) {
    return game.macros?.find((m) => m.flags?.[MODULE_ID]?.macro === id && (m._source?.author ?? m.author?.id ?? m.author) === game.user.id) ?? null;
}

/** The user's macro for a catalogue entry: theirs already, or a new world script macro holding the catalogue's line. */
async function macroFor(entry) {
    const existing = ownMacroOf(entry.id);
    if (existing) return existing;
    if (!creating.has(entry.id)) {
        const data = {
            name: loc(entry.nameKey), type: "script", img: entry.img, command: macroCommand(entry, MODULE_ID),
            flags: { [MODULE_ID]: { macro: entry.id } },
        };
        creating.set(entry.id, Promise.resolve(Macro.implementation.create(data, { renderSheet: false })).finally(() => creating.delete(entry.id)));
    }
    return creating.get(entry.id);
}

/**
 * Put a catalogue macro on the user's hotbar (10.6, 11.1): on `slot`, or the first free one. Refused: `no-macro` (no such
 * entry), `no-script` (the user's role cannot make script macros), `hotbar-full`.
 */
export async function addToHotbar(id, slot = null) {
    const entry = macroById(id);
    if (!entry) return refuse("no-macro");
    if (!game.user.can("MACRO_SCRIPT")) return refuse("no-script");
    const hotbar = game.user.hotbar ?? {};
    const free = Number.isInteger(slot) && slot >= 1 && slot <= 50 ? slot : Array.from({ length: 50 }, (_, i) => i + 1).find((n) => !hotbar[n]) ?? null;
    if (!free) return refuse("hotbar-full");
    const macro = await macroFor(entry);
    if (!macro) return refuse("no-macro");
    await game.user.assignHotbarMacro(macro, free);
    return { ok: true, macro: macro.id, slot: free };
}

/** `hotbarDrop`: a shelf tile dropped on a slot becomes (or reuses) the user's macro there. Other drops are core's. */
export function onHotbarDrop(_hotbar, data, slot) {
    if (data?.type !== DRAG_TYPE) return undefined;
    addToHotbar(data.macro, Number(slot)).then((result) => {
        if (result?.ok) ui.notifications.info(fmt("pf2e-artisans-workshop.Macro.Added", { name: loc(macroById(data.macro)?.nameKey ?? ""), slot: String(result.slot) }));
        else reportRun(result);
    }).catch((error) => console.error(`${MODULE_ID} | hotbar drop failed`, error));
    return false;
}

/* -------------------------------------------- */
/*  The shelf                                    */
/* -------------------------------------------- */

export class MacroShelf extends HandlebarsApplicationMixin(ApplicationV2) {
    /** The open shelf, if any. */
    static instance = null;

    static DEFAULT_OPTIONS = {
        id: "pf2e-artisans-workshop-macros",
        classes: ["pf2e-artisans-workshop", "macro-shelf-window"],
        window: { title: "pf2e-artisans-workshop.Macro.Shelf.Title", icon: "fa-solid fa-scroll", resizable: true },
        position: { width: 560, height: 640 },
        actions: { run: MacroShelf.#onRun, hotbar: MacroShelf.#onHotbar },
    };

    static PARTS = { body: { template: "modules/pf2e-artisans-workshop/templates/macros/shelf.hbs", scrollable: [".macro-shelf"] } };

    constructor(options = {}) {
        super(withTheme(options));
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const canScript = game.user.can("MACRO_SCRIPT") === true;
        return Object.assign(context, {
            canScript,
            groups: shelfGroups(featureOn).map(({ group, macros }) => ({
                group, heading: GROUP_KEY[group],
                macros: macros.map((m) => {
                    const name = loc(m.nameKey);
                    return {
                        id: m.id, no: m.no, icon: m.icon, name, hint: loc(m.hintKey), who: loc(WHO_KEY[m.who]), call: apiCallText(m),
                        onHotbar: !!ownMacroOf(m.id) && Object.values(game.user.hotbar ?? {}).includes(ownMacroOf(m.id).id),
                        runLabel: fmt("pf2e-artisans-workshop.Macro.RunLabel", { name }), hotbarLabel: fmt("pf2e-artisans-workshop.Macro.ToHotbarLabel", { name }),
                    };
                }),
            })),
        });
    }

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        MacroShelf.instance = this;
        // M11 review: Tab, Space and Enter belong to the focused control, never to core's keybindings.
        this.element.addEventListener("keydown", keepControlKeys);
    }

    /**
     * Before the shelf is replaced (Add to hotbar renders it again for the tile's badge): the focused button, told apart by
     * its tile (M11 review: core gives focus back only to an element with an id or a name, and the tiles' have neither).
     */
    _preSyncPartState(partId, newElement, priorElement, state) {
        super._preSyncPartState(partId, newElement, priorElement, state);
        state.workshopFocus = focusState(priorElement);
    }

    /** After: the same tile's button has focus again (10.9: a re-render never steals focus). */
    _syncPartState(partId, newElement, priorElement, state) {
        super._syncPartState(partId, newElement, priorElement, state);
        restoreFocus(newElement, state.workshopFocus);
    }

    /** Put keyboard focus on the first tile's Run button (opened from the keyboard, M11 review). */
    focusWindow() {
        const target = this.element?.querySelector("[data-macro] [data-action='run']");
        target?.focus({ preventScroll: true });
        return !!target;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        new foundry.applications.ux.DragDrop.implementation({
            dragSelector: ".macro-tile[draggable]",
            permissions: { dragstart: () => game.user.can("MACRO_SCRIPT") === true },
            callbacks: { dragstart: (event) => this.#onDragStart(event) },
        }).bind(this.element);
    }

    _onClose(options) {
        super._onClose?.(options);
        if (MacroShelf.instance === this) MacroShelf.instance = null;
    }

    /** A tile dragged: the hotbar's drop handler takes `{type, macro}`. */
    #onDragStart(event) {
        const tile = event.target.closest?.("[data-macro]");
        if (!tile) return;
        event.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, macro: tile.dataset.macro }));
    }

    static async #onRun(_event, target) {
        const id = target.closest("[data-macro]")?.dataset.macro;
        if (!id) return;
        target.disabled = true;
        try {
            await runMacro(game.modules.get(MODULE_ID).api, id, {});
        } finally {
            if (target.isConnected) target.disabled = false;
        }
    }

    /** "Add to hotbar": the drag's keyboard alternative (10.9), into the first free slot. */
    static async #onHotbar(_event, target) {
        const id = target.closest("[data-macro]")?.dataset.macro;
        if (!id) return;
        const result = await addToHotbar(id);
        if (result?.ok) ui.notifications.info(fmt("pf2e-artisans-workshop.Macro.Added", { name: loc(macroById(id).nameKey), slot: String(result.slot) }));
        else reportRun(result);
        if (this.rendered) this.render();
    }
}

/**
 * Open the shelf; from a window (`parent`), as its child, so it opens in the browser window that one is in (10.1). `focus`
 * (the status bar's Macros button) puts keyboard focus on its first tile (M11 review).
 */
export async function openShelf({ parent = null, focus = false } = {}) {
    let app = MacroShelf.instance;
    if (app?.rendered) app.bringToFront?.();
    else {
        app = new MacroShelf();
        if (parent?.renderChild) await parent.renderChild(app);
        else await app.render({ force: true });
    }
    if (focus && app.rendered) app.focusWindow();
    return app;
}

/** Register the hotbar drop handler, at `init`. */
export function registerMacroHooks() {
    Hooks.on("hotbarDrop", onHotbarDrop);
}
