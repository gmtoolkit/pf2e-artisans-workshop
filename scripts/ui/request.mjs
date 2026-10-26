/**
 * The request form (DESIGN.md 10.3, 10.6, 4.2.3): the item (dropped from a sheet, the compendium browser, the sidebar
 * or a chat link, or found by name), who asks and who it is for, the quantity and how it splits into batches, an
 * optional crafter, a gift flag and a note; and, before filing, the members who can make it with their formula route,
 * setup, DC, daily reduction and days to zero.
 *
 * Searching by name reads the pf2e equipment compendium's index, so every drag has a keyboard alternative (10.9). A
 * re-render keeps the focused field and its caret (`focus.mjs`), so typing on after the search's re-render goes on where
 * it was. Opened from the Workshop, the form is its child and opens in the same browser window. The Queue's magnifying
 * glass opens it with the search focused (F, As built in M4.1), and "Browse" opens pf2e's own Compendium Browser on its
 * equipment tab, to drag an item from: the module builds no item search of its own beyond this one.
 */
import { MODULE_ID } from "../constants.mjs";
import { DEGREE } from "../logic/core.mjs";
import { splitIntoBatches } from "../logic/batches.mjs";
import { incomePerDay } from "../logic/income.mjs";
import { daysToZero } from "../logic/progress.mjs";
import { estimateOf } from "../logic/views.mjs";
import { actingChoices, requestOrder } from "../foundry/orders.mjs";
import { crafterFacts, gatesFor, productFacts } from "../foundry/products.mjs";
import { members } from "../foundry/roster.mjs";
import { rulesFromSettings } from "../foundry/settings.mjs";
import { canWrite } from "../foundry/state.mjs";
import { showDcs } from "./context.mjs";
import { focusState, restoreFocus } from "./focus.mjs";
import { gateText, money, number, report } from "./format.mjs";
import { ROUTE } from "./labels.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The compendium searched by name. */
const PACK = "pf2e.equipment-srd";
/** How many matches the search lists. */
const MATCHES = 12;

export class RequestForm extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "pf2e-artisans-workshop-request-{id}",
        classes: ["pf2e-artisans-workshop", "workshop-request"],
        tag: "form",
        window: { title: "pf2e-artisans-workshop.Request.Title", icon: "fa-solid fa-file-circle-plus", resizable: true },
        position: { width: 560, height: "auto" },
        form: { handler: RequestForm.#onSubmit, closeOnSubmit: false, submitOnChange: false },
        actions: { pick: RequestForm.#onPick, clear: RequestForm.#onClear, browse: RequestForm.#onBrowse },
    };

    static PARTS = {
        form: { template: "modules/pf2e-artisans-workshop/templates/request/form.hbs", scrollable: [".request-matches"] },
    };

    /** The form's state between renders. */
    state = { uuid: null, quantity: 1, requester: null, recipient: null, crafter: "", gift: false, note: "", search: "" };

    /** Whether the next render puts focus in the item search (the Queue's magnifying glass). */
    #focusSearch = false;

    constructor({ uuid = null, requester = null, focusSearch = false, ...options } = {}) {
        super(options);
        this.#focusSearch = focusSearch && !uuid;
        const choices = actingChoices();
        this.state.uuid = uuid;
        this.state.requester = requester ?? choices.find((a) => a === game.user.character)?.uuid ?? choices[0]?.uuid ?? null;
        this.state.recipient = this.state.requester;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const product = this.state.uuid ? await productFacts(this.state.uuid) : null;
        const people = members();
        const own = actingChoices();
        const quantity = Math.max(1, Number(this.state.quantity) || 1);
        const order = { id: "preview", quantity, product: { snapshot: product ?? {} } };
        const estimate = product ? estimateOf(order) : null;
        return Object.assign(context, {
            formId: this.id, ready: canWrite(), state: this.state, product, canBrowse: !!game.pf2e?.compendiumBrowser,
            rarityLabel: product && CONFIG.PF2E?.rarityTraits?.[product.rarity] ? game.i18n.localize(CONFIG.PF2E.rarityTraits[product.rarity]) : null,
            priceText: product ? money(product.priceCp) : null, perText: product?.per > 1 ? number(product.per) : null,
            estimate: estimate ? { price: money(estimate.priceCp), upfront: money(estimate.upfrontCp) } : null,
            requesters: own.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === this.state.requester })),
            recipients: [
                ...people.map((a) => ({ value: a.uuid, name: a.name, selected: a.uuid === this.state.recipient })),
                { value: "strongbox", label: "pf2e-artisans-workshop.Queue.ForStrongbox", selected: this.state.recipient === "strongbox" },
            ],
            crafters: own.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === this.state.crafter })),
            candidates: product ? await this.#candidates(product, quantity, people) : [],
            matches: await this.#matches(),
        });
    }

    /** Every member with Crafting, and how they would make the item at this quantity (4.3, 4.4, 6.5). */
    async #candidates(product, quantity, people) {
        const rules = rulesFromSettings();
        const out = [];
        for (const actor of people) {
            const crafter = crafterFacts(actor);
            if (!(crafter.ranks.crafting > 0)) continue;
            const { gates, plan } = await gatesFor({ id: "preview", quantity: 1 }, crafter, product, [], rules);
            const blocking = gates.filter((g) => !g.ok && !["G7", "G8", "G9", "G10", "G11", "batch"].includes(g.id));
            const batches = splitIntoBatches(quantity, Math.max(1, plan.batchMax ?? 1));
            const perDay = incomePerDay(crafter.level, crafter.ranks.crafting, DEGREE.success);
            const priceCp = Math.round((product.priceCp * batches[0]) / product.per);
            const days = daysToZero(priceCp - Math.ceil(priceCp / 2), perDay);
            out.push({
                name: actor.name, ok: blocking.length === 0, reasons: blocking.map(gateText),
                route: plan.route ? game.i18n.localize(ROUTE[plan.route] ?? ROUTE.none) : null,
                setup: plan.setup ? number(plan.setup.days) : null, dc: showDcs() ? plan.dc?.final ?? null : null,
                batchMax: number(plan.batchMax ?? 1), batches: number(batches.length),
                perDay: money(perDay), daysToZero: Number.isFinite(days) ? number(days) : null,
            });
        }
        return out;
    }

    /** Items in the equipment compendium whose name contains the search text. */
    async #matches() {
        const text = this.state.search.trim().toLowerCase();
        if (text.length < 2) return [];
        const pack = game.packs.get(PACK);
        if (!pack) return [];
        const index = await pack.getIndex({ fields: ["system.level.value"] });
        return index.filter((entry) => entry.name.toLowerCase().includes(text)).slice(0, MATCHES)
            .map((entry) => ({ uuid: entry.uuid, name: entry.name, img: entry.img, level: entry.system?.level?.value ?? null }));
    }

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        this.element.addEventListener("change", (event) => this.#onChange(event));
        this.element.addEventListener("input", (event) => {
            if (event.target.name !== "search") return;
            this.state.search = event.target.value;
            this.#searchLater();
        });
        // Enter in the search box picks the first match instead of submitting a form that has no item yet.
        this.element.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" || event.target.name !== "search") return;
            event.preventDefault();
            this.element.querySelector(".request-matches [data-action='pick']")?.click();
        });
    }

    /** Before the form is replaced: the focused field and its caret (core gives focus back with the caret at the start). */
    _preSyncPartState(partId, newElement, priorElement, state) {
        super._preSyncPartState(partId, newElement, priorElement, state);
        state.workshopFocus = focusState(priorElement);
    }

    _syncPartState(partId, newElement, priorElement, state) {
        super._syncPartState(partId, newElement, priorElement, state);
        restoreFocus(newElement, state.workshopFocus);
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        new foundry.applications.ux.DragDrop.implementation({
            dropSelector: ".request-drop", callbacks: { drop: (event) => this.#onDrop(event) },
        }).bind(this.element);
        if (this.#focusSearch) {
            this.#focusSearch = false;
            this.element.querySelector("input[name='search']")?.focus();
        }
    }

    #searchLater = foundry.utils.debounce(() => this.render(), 300);

    #onChange(event) {
        const { name, value, checked, type } = event.target;
        if (!name || name === "search") return;
        this.state[name] = type === "checkbox" ? checked : value;
        if (["quantity", "crafter", "recipient", "requester"].includes(name)) this.render();
    }

    async #onDrop(event) {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if (data?.type !== "Item" || !data.uuid) return;
        const item = await fromUuid(data.uuid);
        this.state.uuid = item?._stats?.compendiumSource ?? item?.sourceId ?? data.uuid;
        this.render();
    }

    static #onPick(_event, target) {
        this.state.uuid = target.dataset.uuid;
        this.state.search = "";
        return this.render();
    }

    static #onClear() {
        this.state.uuid = null;
        return this.render();
    }

    /** "Browse": pf2e's Compendium Browser on its equipment tab; an item dragged from it onto the form is the request's. */
    static async #onBrowse() {
        const browser = game.pf2e?.compendiumBrowser;
        if (!browser) return;
        try {
            await browser.openTab("equipment");
        } catch (error) {
            console.warn(`${MODULE_ID} | could not open the Compendium Browser`, error);
            await browser.render({ force: true });
        }
    }

    static async #onSubmit() {
        const s = this.state;
        if (!s.uuid) {
            ui.notifications.warn("pf2e-artisans-workshop.Request.NoItem", { localize: true });
            return;
        }
        const recipient = s.recipient === "strongbox" ? { kind: "strongbox" } : { kind: "actor", uuid: s.recipient || s.requester };
        const result = report(await requestOrder({
            uuid: s.uuid, quantity: Math.max(1, Number(s.quantity) || 1), requester: s.requester, recipient,
            crafter: s.crafter || null, note: s.note, gift: s.gift === true,
        }));
        if (result?.ok) {
            ui.notifications.info("pf2e-artisans-workshop.Request.Filed", { format: { count: String(result.orders.length) } });
            await this.close();
        }
    }
}

/**
 * Open the request form, optionally with an item and a requester, and with `focusSearch` its item search focused. From a
 * window (`parent`, the Workshop) it is that window's child, so it opens in the browser window the Workshop is in,
 * detached or not.
 */
export function openRequestForm({ uuid = null, requester = null, parent = null, focusSearch = false } = {}) {
    const form = new RequestForm({ uuid, requester, focusSearch });
    return parent ? parent.renderChild(form) : form.render({ force: true });
}
