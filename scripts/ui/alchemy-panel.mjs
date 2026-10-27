/**
 * The Quick Alchemy panel (DESIGN.md 8.3, 8.4, 8.6, 10.9, M8): a searchable list of what the character can make with
 * Quick Alchemy (in the book or covered by family, at most the ability's level, an alchemical consumable), one pick (two
 * with Double Brew, which may be two of the same item: a picked row picked again adds a second, shown with a count), the
 * additive (only those that fit the first pick; none once this round's is spent; Combine Elixirs and Balm Bomb ask for
 * their second item), what it costs in vials, which of pf2e's Strike variants (the multiple attack penalty) a throw uses,
 * and Create. With Quick Bomber (`bombs`) it lists bombs and throws the one made through pf2e's Strike.
 *
 * Keyboard (10.9): type in the search field to filter; the arrow keys move into and through the list; Space picks the
 * item the list has focus on (in the search field Space types a space); Enter creates; Esc closes. The list is a listbox
 * with a roving tab stop; typing renders only the list and the plan, so the search field keeps focus and its caret.
 *
 * The panel's own state lives in its own fields (`query`, `active`, `picks`, `additive`, `combine`, `then`, `map`), never
 * in ApplicationV2's read-only `state`.
 */
import { additivesFor, brewPlan, combineFits, moveIndex, searchChoices } from "../logic/alchemy.mjs";
import { alchemyFacts, quickAbilityOf, quickAlchemy } from "../foundry/alchemy.mjs";
import { combatOffReason } from "../foundry/combat.mjs";
import { focusState, restoreFocus } from "./focus.mjs";
import { featName, number, refusalText, report } from "./format.mjs";
import { OFF_TEXT } from "./bandolier.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const T = (name) => `modules/pf2e-artisans-workshop/templates/combat/${name}.hbs`;

/** How many matches the list shows at once: the search narrows it (8.3). */
export const LIST_LIMIT = 60;

/** pf2e's three Strike variants (the multiple attack penalty), in words, for a throw before the item exists (8.4). */
const MAP_LABEL = Object.freeze([
    "pf2e-artisans-workshop.QuickAlchemy.MapFirst",
    "pf2e-artisans-workshop.QuickAlchemy.MapSecond",
    "pf2e-artisans-workshop.QuickAlchemy.MapThird",
]);

/** A route in words (6.4). */
const ROUTE = Object.freeze({
    known: "pf2e-artisans-workshop.QuickAlchemy.Route.Known",
    family: "pf2e-artisans-workshop.QuickAlchemy.Route.Family",
});

export class QuickAlchemyPanel extends HandlebarsApplicationMixin(ApplicationV2) {
    /** The open panel, if any: one per client. */
    static instance = null;

    static DEFAULT_OPTIONS = {
        id: "pf2e-artisans-workshop-quick-alchemy",
        classes: ["pf2e-artisans-workshop", "workshop-quick-alchemy"],
        window: { title: "pf2e-artisans-workshop.QuickAlchemy.Title", icon: "fa-solid fa-mortar-pestle", resizable: true },
        position: { width: 420, height: 560 },
    };

    static PARTS = {
        search: { template: T("quick-alchemy-search") },
        list: { template: T("quick-alchemy-list"), scrollable: [".qa-list"] },
        plan: { template: T("quick-alchemy-plan") },
    };

    /**
     * The character (a UUID), the search, the list's active row, the picks (UUIDs, a UUID twice for two of one item), the
     * additive, its second item, what then, and the Strike variant of a throw (0, 1 or 2: pf2e's multiple attack penalty).
     */
    actorUuid = null;
    query = "";
    active = 0;
    picks = [];
    additive = "";
    combine = "";
    then = "hand";
    map = 0;
    bombs = false;
    /** The facts of the last render, which the keys read. */
    facts = null;
    visible = [];

    /** The character, as a document. */
    get alchemist() {
        return this.actorUuid ? fromUuidSync(this.actorUuid, { strict: false }) : null;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const why = combatOffReason();
        if (why) return Object.assign(context, { off: loc(OFF_TEXT[why]) });
        const actor = this.alchemist;
        if (!actor || !quickAbilityOf(actor)) return Object.assign(context, { off: loc("pf2e-artisans-workshop.Refusal.NoQuickAlchemy") });
        this.facts = await alchemyFacts(actor);
        return Object.assign(context, panelContext(this, this.facts));
    }

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        QuickAlchemyPanel.instance = this;
        this.element.addEventListener("input", (event) => this.#onInput(event));
        this.element.addEventListener("change", (event) => this.#onChange(event));
        this.element.addEventListener("keydown", (event) => this.#onKeydown(event));
        this.element.addEventListener("click", (event) => this.#onClick(event));
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        if (options.isFirstRender || !this.element.contains(this.element.ownerDocument.activeElement)) {
            this.element.querySelector("[data-quick='search']")?.focus({ preventScroll: true });
        }
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
        if (QuickAlchemyPanel.instance === this) QuickAlchemyPanel.instance = null;
    }

    /** Render the list and the plan (typing, picking): the search field keeps focus. */
    renderList() {
        return this.render({ parts: ["list", "plan"] });
    }

    #onInput(event) {
        const target = event.target;
        if (target?.dataset?.quick !== "search") return;
        this.query = target.value ?? "";
        this.active = 0;
        this.renderList();
    }

    #onChange(event) {
        const target = event.target;
        const what = target?.dataset?.quick;
        if (what === "additive") this.additive = target.value ?? "";
        else if (what === "combine") this.combine = target.value ?? "";
        else if (what === "then") this.then = target.value === "strike" ? "strike" : "hand";
        else if (what === "map") this.map = Math.min(Math.max(Number(target.value) || 0, 0), 2);
        else return;
        this.render({ parts: ["plan"] });
    }

    async #onClick(event) {
        const option = event.target?.closest?.("[data-quick='option']");
        if (option) {
            this.active = Number(option.dataset.index) || 0;
            this.toggle(option.dataset.uuid);
            return;
        }
        const button = event.target?.closest?.("button[data-quick]");
        if (!button || button.disabled) return;
        if (button.dataset.quick === "create") await this.create(button);
        else if (button.dataset.quick === "unpick") this.unpick(Number(button.dataset.index));
    }

    /**
     * Pick an item (Space, a click). One pick: a picked row is unpicked, another replaces it. With Double Brew, picks may
     * repeat (two of one item, its most common use): while there is room a row is added again, even a picked one; once
     * full, a picked row gives one back and another row replaces the oldest pick. The plan's chips take one off each.
     */
    toggle(uuid) {
        if (!uuid) return;
        const brew = Math.max(1, this.facts?.features?.brew ?? 1);
        const last = this.picks.lastIndexOf(uuid);
        if (brew === 1) this.picks = last >= 0 ? [] : [uuid];
        else if (this.picks.length < brew) this.picks = [...this.picks, uuid];
        else if (last >= 0) this.picks = this.picks.filter((_u, i) => i !== last);
        else this.picks = [...this.picks, uuid].slice(-brew);
        if (!this.picks.length) this.additive = "";
        this.renderList();
    }

    /** Take one pick off (the plan's chips). */
    unpick(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.picks.length) return;
        this.picks = this.picks.filter((_u, i) => i !== index);
        if (!this.picks.length) this.additive = "";
        this.renderList();
    }

    /** Move the list's active row and focus it (10.9: the roving tab stop). */
    async move(delta) {
        this.active = moveIndex(this.active, delta, this.visible.length);
        await this.renderList();
        this.element.querySelector(`[data-quick='option'][data-index='${this.active}']`)?.focus({ preventScroll: false });
    }

    #onKeydown(event) {
        const target = event.target;
        const inSearch = target?.dataset?.quick === "search";
        const inList = target?.dataset?.quick === "option";
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (!inSearch && !inList) return;
            event.preventDefault();
            // From the search field the first arrow goes into the list, onto its active row.
            this.move(inSearch ? 0 : event.key === "ArrowDown" ? 1 : -1);
            return;
        }
        if (event.key === " " && inList) {
            event.preventDefault();
            this.toggle(target.dataset.uuid);
            return;
        }
        if (event.key === "Enter" && (inSearch || inList)) {
            event.preventDefault();
            // Enter with nothing picked creates the item the list shows first (or has focus on).
            if (!this.picks.length && this.visible[this.active]) this.picks = [this.visible[this.active].uuid];
            this.create(null);
        }
    }

    /** Create (8.3): Quick Alchemy through pf2e, then the panel closes; a refusal says why and keeps it open. */
    async create(button) {
        const actor = this.alchemist;
        if (!actor || !this.picks.length) return null;
        if (button) button.disabled = true;
        try {
            const result = await quickAlchemy(actor, { uuid: this.picks[0], second: this.picks[1] ?? null, additive: this.additive || null,
                combine: this.combine || null, then: this.bombs ? "strike" : this.then, map: this.map });
            report(result);
            if (result?.ok) {
                this.picks = [];
                this.additive = "";
                this.combine = "";
                this.map = 0;
                await this.close();
            } else this.render({ parts: ["plan"] });
            return result;
        } finally {
            if (button?.isConnected) button.disabled = false;
        }
    }
}

/**
 * The panel's context (8.3): the matches of the search (at most `LIST_LIMIT`, picks first among equals), each with its
 * level and route and whether it is picked or active; the picks; the additives that fit the first pick (and Combine
 * Elixirs' second elixir); what it costs; and the plan's first problem in words.
 */
export function panelContext(app, facts) {
    const all = facts.choices.filter((c) => !app.bombs || c.bomb);
    const matches = searchChoices(all, app.query);
    app.visible = matches.slice(0, LIST_LIMIT);
    if (app.active >= app.visible.length) app.active = Math.max(0, app.visible.length - 1);
    const pickable = new Map(all.map((c) => [c.uuid, c]));
    // Any item the character can make, for an additive's second one (Balm Bomb's healing elixir beside a bomb).
    const byUuid = new Map(facts.choices.map((c) => [c.uuid, c]));
    app.picks = app.picks.filter((u) => pickable.has(u));
    const picks = app.picks.map((u) => pickable.get(u));
    const fitting = picks[0] ? additivesFor(facts.features.additives, picks[0].options) : [];
    if (app.additive && !fitting.some((a) => a.key === app.additive)) app.additive = "";
    const combineSpec = fitting.find((a) => a.key === app.additive)?.combine ?? null;
    const combineHeld = !!combineSpec;
    const combineChoices = combineHeld ? facts.choices.filter((c) => combineFits(combineSpec, c, picks[0])) : [];
    if (app.combine && !combineChoices.some((c) => c.uuid === app.combine)) app.combine = "";
    const strikes = app.bombs || (app.then === "strike" && picks.some((c) => c.bomb));
    const plan = brewPlan({ picks, vials: facts.vials?.value ?? 0, brew: facts.features.brew, additive: app.additive || null, additives: facts.features.additives,
        additiveSpent: facts.additiveSpent, combine: app.combine ? byUuid.get(app.combine) ?? null : null });
    const problem = plan.problems.find((p) => p.reason !== "nothing-picked") ?? null;
    return {
        actor: { name: facts.actor.name },
        query: app.query,
        vials: facts.vials ? fmt("pf2e-artisans-workshop.Bandolier.Vials", { value: number(facts.vials.value), max: number(facts.vials.max) }) : null,
        brew: facts.features.brew > 1 ? fmt("pf2e-artisans-workshop.QuickAlchemy.Brew", { n: number(facts.features.brew) }) : null,
        count: matches.length > app.visible.length ? fmt("pf2e-artisans-workshop.QuickAlchemy.More", { shown: number(app.visible.length), n: number(matches.length) }) : null,
        empty: !app.visible.length,
        options: app.visible.map((c, index) => {
            const n = app.picks.filter((u) => u === c.uuid).length;
            return {
                index, uuid: c.uuid, name: c.name, img: c.img, level: fmt("pf2e-artisans-workshop.QuickAlchemy.Level", { level: number(c.level) }),
                route: loc(ROUTE[c.route] ?? ROUTE.known), picked: n > 0, active: index === app.active, bomb: c.bomb,
                count: n > 1 ? fmt("pf2e-artisans-workshop.QuickAlchemy.Count", { n: number(n) }) : null,
            };
        }),
        picks: picks.map((c, index) => ({ index, uuid: c.uuid, name: c.name })),
        additives: picks.length ? [{ value: "", label: loc("pf2e-artisans-workshop.QuickAlchemy.NoAdditive"), selected: !app.additive },
            ...fitting.map((a) => ({ value: a.key, label: featName(a.key), selected: app.additive === a.key }))] : null,
        additiveSpent: facts.additiveSpent && fitting.length > 0,
        combine: combineHeld ? [{ value: "", label: loc("pf2e-artisans-workshop.QuickAlchemy.CombinePick"), selected: !app.combine },
            ...combineChoices.map((c) => ({ value: c.uuid, label: c.name, selected: app.combine === c.uuid }))] : null,
        bombs: app.bombs,
        then: picks.some((c) => c.bomb) && !app.bombs ? [{ value: "hand", label: loc("pf2e-artisans-workshop.QuickAlchemy.ThenHand"), selected: app.then !== "strike" },
            { value: "strike", label: loc("pf2e-artisans-workshop.QuickAlchemy.ThenStrike"), selected: app.then === "strike" }] : null,
        // pf2e does not track the multiple attack penalty: the throw's variant is chosen here, as the Bandolier's buttons do.
        map: strikes ? MAP_LABEL.map((key, value) => ({ value: String(value), label: loc(key), selected: app.map === value })) : null,
        cost: picks.length ? fmt(plan.cost === 1 ? "pf2e-artisans-workshop.QuickAlchemy.CostOne" : "pf2e-artisans-workshop.QuickAlchemy.Cost", { n: number(plan.cost) }) : null,
        problem: problem ? refusalText({ reason: problem.reason, data: problem.data }) : null,
        canCreate: plan.ok,
    };
}

/**
 * Open the Quick Alchemy panel (8.3, `api.alchemy.openPanel`, the keybinding, the Bandolier and the HUD palette) for a
 * character; `bombs` lists bombs only and throws the one made (Quick Bomber, 8.4).
 */
export async function openQuickAlchemy({ actor = null, bombs = false } = {}) {
    const why = combatOffReason();
    if (why) return report({ ok: false, reason: why === "duct-tape" ? "duct-tape" : "combat-off" });
    const who = typeof actor === "string" ? fromUuidSync(actor, { strict: false }) : actor ?? game.user.character ?? null;
    if (!who || !quickAbilityOf(who)) return report({ ok: false, reason: "no-quick-alchemy" });
    const app = QuickAlchemyPanel.instance ?? new QuickAlchemyPanel();
    if (app.actorUuid !== who.uuid) {
        app.picks = [];
        app.additive = "";
        app.combine = "";
        app.query = "";
        app.active = 0;
        app.map = 0;
    }
    app.actorUuid = who.uuid;
    app.bombs = !!bombs;
    await app.render({ force: true });
    return { ok: true, app };
}
