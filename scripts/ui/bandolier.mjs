/**
 * The Bandolier (DESIGN.md 8.1, 10.9, M8): a compact ApplicationV2 window, docked above the hotbar the first time,
 * draggable, its position remembered per user (`bandolier.position`). It shows one alchemist's combat alchemy: the vial
 * pips and tier, the field-vial damage type and the Advanced Vials material, Quick Alchemy (the panel), a quick vial (and
 * Abundant Vials' extra one), Healing Bomb, Double Brew, whether this round's additive is spent, the ready bombs and
 * elixirs with their potency and splash numbers, and the vial buttons (gather reagents, Improvise Admixture, the
 * Alchemist's Haversack). Every Strike button runs pf2e's own Strike for that item, so the multiple attack penalty,
 * modifiers and damage cards are the system's.
 *
 * It opens by itself when an encounter starts, for the responsible user (5.6) of an alchemist combatant
 * (`bandolier.autoOpen`); `api.alchemy.openBandolier`, the keybinding and the token HUD palette open it too. It steps aside
 * with the other combat features while Duct Tape is active (8). Controls carry `data-bandolier`, never `data-action`
 * handlers of their own, and are found again after a render by it (10.9). Detached-window safe: listeners are delegated
 * from the window's element and elements are tested with `isElementInstanceOf`.
 */
import { MODULE_ID } from "../constants.mjs";
import { alchemyFacts, healingBomb, quickAbilityOf, quickVial, throwHealingBomb } from "../foundry/alchemy.mjs";
import { combatOffReason, combatOn, combatantOf, strikeWith } from "../foundry/combat.mjs";
import { inertFlag } from "../foundry/item-facts.mjs";
import { isResponsibleFor } from "../foundry/responsible.mjs";
import { setting } from "../foundry/settings.mjs";
import { gatherReagents, haversackVial, improviseAdmixture, vialFacts } from "../foundry/vials.mjs";
import { focusState, restoreFocus } from "./focus.mjs";
import { featName, number, report } from "./format.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** Why the combat features are off, in words (8: Settings and the Bandolier say why). */
export const OFF_TEXT = Object.freeze({
    disabled: "pf2e-artisans-workshop.Combat.Off.Disabled",
    off: "pf2e-artisans-workshop.Combat.Off.Feature",
    "duct-tape": "pf2e-artisans-workshop.Combat.Off.DuctTape",
});

/** An item's potency in words (8.1 "potency countdown"). */
export function potencyText(potency) {
    if (!potency) return null;
    if (potency.kind === "seconds") return fmt("pf2e-artisans-workshop.Bandolier.Potency.Seconds", { n: number(potency.seconds) });
    return loc({
        "turn-start": "pf2e-artisans-workshop.Bandolier.Potency.TurnStart",
        "turn-end-current": "pf2e-artisans-workshop.Bandolier.Potency.TurnEndCurrent",
        "turn-end-next": "pf2e-artisans-workshop.Bandolier.Potency.TurnEndNext",
        prep: "pf2e-artisans-workshop.Bandolier.Potency.Prep",
    }[potency.kind] ?? "pf2e-artisans-workshop.Bandolier.Potency.Prep");
}

/** A bomb's splash numbers in words (8.8): damage, its bonus, the radius or cone, the primary-target option. */
export function splashText(splash) {
    if (!splash) return null;
    const parts = [fmt(splash.bonus ? "pf2e-artisans-workshop.Bandolier.SplashBonus" : "pf2e-artisans-workshop.Bandolier.Splash",
        { damage: number(splash.damage), bonus: number(splash.bonus), radius: number(splash.radius) })];
    if (splash.cone) parts.push(fmt("pf2e-artisans-workshop.Bandolier.Cone", { feet: number(splash.cone) }));
    if (splash.primaryOnly) parts.push(loc("pf2e-artisans-workshop.Bandolier.PrimaryOnly"));
    return parts.join(" · ");
}

/**
 * An additive in words, with its second item when it has one (Combine Elixirs' elixir, Balm Bomb's healing elixir, 8.6),
 * read by UUID from the compendium.
 */
export function additiveText(additive, combine = null) {
    const second = combine ? fromUuidSync(combine, { strict: false })?.name ?? null : null;
    return second ? fmt("pf2e-artisans-workshop.Bandolier.AdditiveWith", { additive: featName(additive), item: second })
        : fmt("pf2e-artisans-workshop.Bandolier.Additive", { additive: featName(additive) });
}

/** pf2e's Strike variants of an item, as buttons: the label pf2e gives each (its modifier and multiple attack penalty). */
export function strikeButtons(actor, item) {
    const strike = actor?.system?.actions?.find?.((a) => a?.item?.id === item.id && a.type === "strike");
    return (strike?.variants ?? []).slice(0, 3).map((variant, map) => ({ map, label: variant.label ?? String(map) }));
}

/** The characters this user may open the Bandolier for: those they own with pf2e's Quick Alchemy. */
export function bandolierChoices() {
    return [...(game.actors ?? [])].filter((a) => a.type === "character" && a.isOwner && quickAbilityOf(a));
}

/** The character the Bandolier shows: the chosen one, else the user's own, else the one controlled token's, else the first. */
function actorFor(app) {
    const choices = bandolierChoices();
    const chosen = app.actorUuid ? choices.find((a) => a.uuid === app.actorUuid) : null;
    const controlled = (canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter((a) => choices.includes(a));
    return chosen ?? choices.find((a) => a === game.user.character) ?? (controlled.length === 1 ? controlled[0] : null) ?? choices[0] ?? null;
}

/** The Bandolier's context (8.1). */
export async function bandolierContext(app) {
    const why = combatOffReason();
    if (why) return { off: loc(OFF_TEXT[why]) };
    const actor = actorFor(app);
    if (!actor) return { off: null, none: true };
    const facts = await alchemyFacts(actor, { withChoices: false });
    const vial = vialFacts(actor);
    const v = facts.vials;
    const f = facts.features;
    const choices = bandolierChoices();
    return {
        actor: { uuid: actor.uuid, name: actor.name, img: actor.img ?? null },
        choices: choices.length > 1 ? choices.map((a) => ({ uuid: a.uuid, name: a.name, selected: a === actor })) : null,
        vials: v ? {
            text: fmt("pf2e-artisans-workshop.Bandolier.Vials", { value: number(v.value), max: number(v.max) }),
            pips: Array.from({ length: Math.max(0, v.max) }, (_x, i) => ({ full: i < v.value })),
            level: v.level === null ? null : fmt("pf2e-artisans-workshop.Bandolier.Tier", { level: number(v.level) }),
            buckets: v.buckets ? Object.entries(v.buckets).map(([material, n]) => ({ material, n: number(n) })) : null,
        } : null,
        canQuick: facts.canQuick && (v?.value ?? 0) > 0,
        noVials: facts.canQuick && (v?.value ?? 0) <= 0,
        canVial: facts.canQuick && !!v?.item,
        abundant: f.abundant ? { disabled: facts.quickenedSpent || !facts.combat || !v?.item } : null,
        healingBomb: f.healingBomb && facts.canQuick && (v?.value ?? 0) > 0,
        quickBomber: f.quickBomber,
        brew: f.brew > 1 ? loc("pf2e-artisans-workshop.Bandolier.DoubleBrew") : null,
        additive: f.additives.length ? loc(facts.additiveSpent ? "pf2e-artisans-workshop.Bandolier.AdditiveSpent" : "pf2e-artisans-workshop.Bandolier.AdditiveFree") : null,
        fieldVial: f.fieldVial ? {
            choices: [{ value: "", label: loc("pf2e-artisans-workshop.Bandolier.FieldVialDefault"), selected: !app.damageType },
                ...f.fieldVial.choices.map((c) => ({ value: c, label: game.i18n.localize(CONFIG.PF2E?.damageTypes?.[c] ?? c), selected: app.damageType === c }))],
        } : null,
        material: f.vialMaterial ? {
            choices: [{ value: "", label: loc("pf2e-artisans-workshop.Bandolier.MaterialPlain"), selected: !app.material },
                ...f.vialMaterial.materials.map((m) => ({ value: m, label: game.i18n.localize(CONFIG.PF2E?.preciousMaterials?.[m] ?? m), selected: app.material === m }))],
        } : null,
        combat: facts.combat ? fmt("pf2e-artisans-workshop.Bandolier.Round", { round: number(facts.combat.round) }) : null,
        ready: facts.ready.map((r) => {
            const item = actor.items.get(r.id);
            return {
                id: r.id, name: r.name, img: r.img, qty: number(r.qty), potency: potencyText(r.potency), splash: splashText(r.splash),
                additive: r.additive ? additiveText(r.additive, r.quick?.combine ?? null) : null,
                strikes: r.bomb && !r.healingBomb ? strikeButtons(actor, item) : [],
                throw: r.healingBomb, use: r.elixir && !r.healingBomb && item?.type === "consumable", quick: !!r.quick,
            };
        }),
        gather: vial.regains, full: v ? v.value >= v.max : true,
        admixture: vial.admixture ? { left: number(vial.admixture.value), disabled: vial.admixture.value <= 0 || !v || v.value >= v.max } : null,
        haversack: vial.haversack ? { disabled: vial.haversackUsed || !v || v.value >= v.max } : null,
    };
}

/** The saved position (8.1), or one docked above the hotbar. */
function startPosition() {
    const saved = setting("bandolier.position") ?? {};
    if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) return { left: saved.left, top: saved.top };
    const bar = ui.hotbar?.element?.getBoundingClientRect?.();
    return bar ? { left: Math.max(0, bar.left), top: Math.max(0, bar.top - 260) } : {};
}

export class BandolierApp extends HandlebarsApplicationMixin(ApplicationV2) {
    /** The open Bandolier, if any: one per client. */
    static instance = null;

    static DEFAULT_OPTIONS = {
        id: "pf2e-artisans-workshop-bandolier",
        classes: ["pf2e-artisans-workshop", "workshop-bandolier"],
        window: { title: "pf2e-artisans-workshop.Bandolier.Title", icon: "fa-solid fa-flask-vial", resizable: false, minimizable: true },
        position: { width: 340, height: "auto" },
    };

    static PARTS = {
        body: { template: "modules/pf2e-artisans-workshop/templates/combat/bandolier.hbs" },
    };

    /** The character shown (a UUID), and the field-vial type and material chosen for the next throw. */
    actorUuid = null;
    damageType = null;
    material = null;

    constructor(options = {}) {
        super(foundry.utils.mergeObject({ position: startPosition() }, options));
    }

    /** Re-render after changes stop for a moment (10.1). */
    refresh = foundry.utils.debounce(() => {
        if (this.rendered) this.render({ parts: ["body"] });
    }, 150);

    /** The position, saved per user once dragging stops (8.1). */
    savePosition = foundry.utils.debounce((position) => {
        if (!Number.isFinite(position?.left) || !Number.isFinite(position?.top)) return;
        game.settings.set(MODULE_ID, "bandolier.position", { left: Math.round(position.left), top: Math.round(position.top) });
    }, 500);

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return Object.assign(context, await bandolierContext(this));
    }

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        BandolierApp.instance = this;
        this.element.addEventListener("click", (event) => this.#onClick(event));
        this.element.addEventListener("change", (event) => this.#onChange(event));
    }

    _onPosition(position) {
        super._onPosition?.(position);
        this.savePosition(position);
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
        if (BandolierApp.instance === this) BandolierApp.instance = null;
    }

    /** The character shown, as a document. */
    get actor() {
        return this.actorUuid ? fromUuidSync(this.actorUuid, { strict: false }) : actorFor(this);
    }

    #onChange(event) {
        const target = event.target;
        if (!foundry.utils.isElementInstanceOf(target, HTMLElement)) return;
        const what = target.dataset.bandolier;
        if (what === "actor") this.actorUuid = target.value || null;
        else if (what === "damage-type") this.damageType = target.value || null;
        else if (what === "material") this.material = target.value || null;
        else return;
        this.render({ parts: ["body"] });
    }

    async #onClick(event) {
        const button = event.target?.closest?.("button[data-bandolier]");
        if (!button || button.disabled) return;
        event.preventDefault();
        button.disabled = true;
        try {
            report(await this.run(button.dataset.bandolier, button.dataset, event));
        } finally {
            if (button.isConnected) button.disabled = false;
        }
        this.render({ parts: ["body"] });
    }

    /** One Bandolier button (8.1). */
    async run(what, data = {}, event = null) {
        const actor = this.actor ?? actorFor(this);
        if (!actor) return null;
        const item = data.item ? actor.items.get(data.item) : null;
        switch (what) {
            case "panel": {
                const { openQuickAlchemy } = await import("./alchemy-panel.mjs");
                return openQuickAlchemy({ actor });
            }
            case "quick-vial": return quickVial(actor, { damageType: this.damageType, material: this.material, quickened: data.quickened === "true" });
            case "healing-bomb": return healingBomb(actor);
            // Quick Bomber (8.4): the panel's bombs, thrown through pf2e's Strike as soon as one is made.
            case "quick-bomber": {
                const { openQuickAlchemy } = await import("./alchemy-panel.mjs");
                return openQuickAlchemy({ actor, bombs: true });
            }
            case "strike": return item ? strikeWith(actor, item, { map: Number(data.map) || 0, event, damageType: this.damageType, material: this.material }) : null;
            case "throw": return item ? throwHealingBomb(actor, item.id) : null;
            // An elixir at hand, used through the system (its own card).
            case "use": {
                if (!item || inertFlag(item) || typeof item.consume !== "function") return null;
                await item.consume();
                return { ok: true };
            }
            case "gather": return gatherReagents(actor, { minutes: 10 });
            case "admixture": return improviseAdmixture(actor);
            case "haversack": return haversackVial(actor);
            default: return null;
        }
    }
}

/**
 * Open the Bandolier (8.1, `api.alchemy.openBandolier`, the keybinding), on a character (a document or UUID) if given.
 * Refused while the combat features are off, with why.
 */
export async function openBandolier({ actor = null } = {}) {
    const why = combatOffReason();
    if (why) return report({ ok: false, reason: why === "duct-tape" ? "duct-tape" : "combat-off" });
    const app = BandolierApp.instance ?? new BandolierApp();
    if (actor) app.actorUuid = typeof actor === "string" ? actor : actor.uuid;
    await app.render({ force: true });
    return { ok: true, app };
}

/**
 * Whether an encounter starting should open this user's Bandolier (8.1): `bandolier.autoOpen` is on and this tab is the
 * responsible client of an alchemist combatant (one with pf2e's Quick Alchemy) this user owns.
 */
export function autoOpenFor(combat) {
    if (!combatOn() || setting("bandolier.autoOpen") === false) return null;
    for (const combatant of combat?.combatants ?? []) {
        const actor = combatant.actor;
        if (actor?.type === "character" && actor.isOwner && quickAbilityOf(actor) && isResponsibleFor(actor) && combatantOf(combat, actor)) return actor;
    }
    return null;
}

/** Hooks at `init`: open at an encounter's start; keep the window current. */
export function registerBandolierHooks() {
    // `combatTurnChange` fires on every client; its first change of an encounter comes from round 0.
    Hooks.on("combatTurnChange", (combat, previous, current) => {
        BandolierApp.instance?.refresh();
        if ((previous?.round ?? 0) > 0 || !(current?.round >= 1)) return;
        const actor = autoOpenFor(combat);
        if (actor && !BandolierApp.instance) openBandolier({ actor }).catch((error) => console.warn(`${MODULE_ID} | could not open the Bandolier`, error));
    });
    for (const name of ["updateActor", "createItem", "updateItem", "deleteItem", "updateCombat", "deleteCombat", "controlToken"]) {
        Hooks.on(name, () => BandolierApp.instance?.refresh());
    }
    Hooks.on("updateWorldTime", () => BandolierApp.instance?.refresh());
}
