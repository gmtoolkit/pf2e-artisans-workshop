/**
 * The request form (DESIGN.md 10.3, 10.6, 4.2.3): the item (dropped from a sheet, the compendium browser, the sidebar
 * or a chat link, or found by name), who asks and who it is for, the quantity and how it splits into batches, an
 * optional crafter, a gift flag and a note; and, before filing, the members who can make it with their formula route,
 * setup, DC, daily reduction and days to zero.
 *
 * M5 adds what the request is (4.2.1 `craftType`, 4.5): a Craft of the item; an upgrade of one of the requester's items
 * to the chosen stronger grade; a rune etched onto one of the requester's items; a rune transferred between two of them;
 * or a service (Repair, affix a talisman or take one off, Identify Alchemy) of one of the requester's items. Formula jobs
 * are filed from the Formulas tab.
 *
 * Searching by name reads the pf2e equipment compendium's index, so every drag has a keyboard alternative (10.9). A
 * re-render keeps the focused field and its caret (`focus.mjs`), so typing on after the search's re-render goes on where
 * it was. Opened from the Workshop, the form is its child and opens in the same browser window. The Queue's magnifying
 * glass opens it with the search focused (F, As built in M4.1), and "Browse" opens pf2e's own Compendium Browser on its
 * equipment tab, to drag an item from: the module builds no item search of its own beyond this one.
 *
 * M9: a tattoo or a graft (6.14) asks whose it is (the subject, who receives it) and, optionally, which tattoo or graft
 * the subject has that it upgrades. The form keeps its fields in `draft`, never in ApplicationV2's own `state`.
 */
import { MODULE_ID } from "../constants.mjs";
import { DEGREE } from "../logic/core.mjs";
import { splitIntoBatches } from "../logic/batches.mjs";
import { familyKey } from "../logic/families.mjs";
import { incomePerDay } from "../logic/income.mjs";
import { daysToZero } from "../logic/progress.mjs";
import { isRuneItemOf, normalRunes, runeOf, usageFits } from "../logic/runes.mjs";
import { estimateOf } from "../logic/views.mjs";
import { actingChoices, requestOrder } from "../foundry/orders.mjs";
import { crafterFacts, gatesFor, liveItemFacts, productFacts } from "../foundry/products.mjs";
import { members } from "../foundry/roster.mjs";
import { searchCatalogue } from "../foundry/catalogue.mjs";
import { requestService } from "../foundry/services.mjs";
import { rulesFromSettings } from "../foundry/settings.mjs";
import { canWrite } from "../foundry/state.mjs";
import { setting } from "../foundry/settings.mjs";
import { subjectTypeOf } from "../logic/crafts.mjs";
import { showDcs } from "./context.mjs";
import { focusState, restoreFocus } from "./focus.mjs";
import { gateText, money, number, report } from "./format.mjs";
import { CRAFT_TYPE, ROUTE, SERVICE } from "./labels.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** How many matches the search lists. */
const MATCHES = 12;
/** What a request can be (M5). */
const KINDS = Object.freeze(["item", "upgrade", "rune-etch", "rune-transfer", "service"]);
/** Kinds that work on one of the requester's items. */
const ON_ITEM = new Set(["upgrade", "rune-etch", "rune-transfer"]);
/** Services the form files (4.5); a formula copy is asked from the Formulas tab. */
const SERVICE_KINDS = Object.freeze(["repair", "affix", "unaffix", "identify-alchemy"]);

const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const traitsOf = (item) => new Set(item.traits ?? item.system?.traits?.value ?? []);

/**
 * The requester's items a request can work on, by kind (M5): a lower grade of the product's family to upgrade, an item a
 * rune fits, an item that holds the rune (a transfer's source, or the rune's own item: `isRuneItemOf`), a damaged item to repair, a talisman or
 * spellheart, a host, an affixed talisman.
 */
export function itemChoices(actor, kind, product, { serviceKind = null, source = null } = {}) {
    const items = (actor?.items ?? []).filter((i) => i.isOfType?.("physical"));
    const view = (i) => ({ uuid: i.uuid, name: i.name });
    if (kind === "upgrade" && product) {
        const key = familyKey(product);
        return items.filter((i) => familyKey({ name: (i.sourceId ? actorOf(i.sourceId)?.name : null) ?? i.name, type: i.type, category: product.category }) === key &&
            (i.level ?? 0) < product.level).map(view);
    }
    const rune = product ? runeOf({ slug: product.slug, usage: product.usage }) : null;
    const holds = (i) => {
        const runes = normalRunes(i.system?.runes ?? {});
        return rune && (rune.kind === "property" ? runes.property.includes(rune.value) : runes[rune.slot] === rune.value);
    };
    const fits = (i) => i.type === rune.target && usageFits(product.usage, liveItemFacts(i));
    if (kind === "rune-etch") return rune ? items.filter(fits).map(view) : [];
    const runeItem = (i) => isRuneItemOf({ sourceId: i.sourceId ?? i._stats?.compendiumSource ?? null, slug: i.slug ?? null, usage: i.system?.usage?.value ?? null }, product);
    if (kind === "rune-transfer" && source === "pick") return rune ? items.filter((i) => holds(i) || runeItem(i)).map(view) : [];
    if (kind === "rune-transfer") return rune ? items.filter((i) => fits(i) && !holds(i)).map(view) : [];
    if (kind === "service") {
        if (serviceKind === "repair") return items.filter((i) => (i.system?.hp?.max ?? 0) > 0 && (i.system.hp.value ?? 0) < i.system.hp.max).map(view);
        if (serviceKind === "affix") return items.filter((i) => ["talisman", "spellheart"].some((t) => traitsOf(i).has(t))).map(view);
        if (serviceKind === "unaffix") return items.filter((i) => i.flags?.[MODULE_ID]?.affix).map(view);
        if (serviceKind === "host") return items.filter((i) => ["armor", "shield", "weapon"].includes(i.type)).map(view);
    }
    return [];
}

/**
 * The tattoos or grafts a subject has that a product could upgrade (6.14): the same family, a lower level. Read from the
 * subject's items, which every client has.
 */
export function replaceChoices(subject, product) {
    if (!subject || !product) return [];
    const key = familyKey(product);
    return (subject.items ?? []).filter((i) => i.isOfType?.("physical") && (traitsOf(i).has("tattoo") || traitsOf(i).has("graft")) && (i.level ?? 0) < product.level &&
        familyKey({ name: (i.sourceId ? actorOf(i.sourceId)?.name : null) ?? i.name, type: i.type, category: product.category }) === key)
        .map((i) => ({ uuid: i.uuid, name: i.name }));
}

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

    /**
     * The form's fields between renders. Not `state`: ApplicationV2 has a `state` of its own (its render state), which a
     * field of that name would shadow.
     */
    draft = {
        uuid: null, quantity: 1, requester: null, recipient: null, crafter: "", gift: false, note: "", search: "",
        kind: "item", target: "", source: "", serviceKind: "repair", host: "", performer: "", subject: "", replaces: "",
    };

    /** Whether the next render puts focus in the item search (the Queue's magnifying glass). */
    #focusSearch = false;

    constructor({ uuid = null, requester = null, kind = null, focusSearch = false, ...options } = {}) {
        super(options);
        this.#focusSearch = focusSearch && !uuid;
        const choices = actingChoices();
        this.draft.uuid = uuid;
        this.draft.requester = requester ?? choices.find((a) => a === game.user.character)?.uuid ?? choices[0]?.uuid ?? null;
        this.draft.recipient = this.draft.requester;
        if (KINDS.includes(kind)) this.draft.kind = kind;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const s = this.draft;
        const service = s.kind === "service";
        const product = !service && s.uuid ? await productFacts(s.uuid) : null;
        // M9: a tattoo or graft is made on a subject, who receives it (6.14).
        const subjectType = product && s.kind === "item" && setting("features.tattoos") !== false ? subjectTypeOf(product) : null;
        const people = members();
        const own = actingChoices();
        const single = ON_ITEM.has(s.kind);
        const quantity = single ? 1 : Math.max(1, Number(s.quantity) || 1);
        const order = { id: "preview", quantity, product: { snapshot: product ?? {} } };
        const estimate = product && !single ? estimateOf(order) : null;
        const requester = actorOf(s.requester);
        const option = (value, label, current) => ({ value, label, selected: value === current });
        const items = (opts) => itemChoices(requester, s.kind, product, opts).map((i) => ({ ...i, selected: false }));
        const mark = (list, current) => list.map((i) => ({ ...i, selected: i.uuid === current }));
        return Object.assign(context, {
            formId: this.id, ready: canWrite(), state: s, product, service, single, canBrowse: !!game.pf2e?.compendiumBrowser,
            kinds: KINDS.map((k) => option(k, k === "service" ? "pf2e-artisans-workshop.Request.Kind.Service" : CRAFT_TYPE[k], s.kind)),
            serviceKinds: SERVICE_KINDS.map((k) => option(k, SERVICE[k], s.serviceKind)),
            targets: single ? mark(items({}), s.target) : service && s.serviceKind !== "identify-alchemy"
                ? mark(itemChoices(requester, "service", null, { serviceKind: s.serviceKind }), s.target) : [],
            sources: s.kind === "rune-transfer" ? mark(items({ source: "pick" }), s.source) : [],
            hosts: service && s.serviceKind === "affix" ? mark(itemChoices(requester, "service", null, { serviceKind: "host" }), s.host) : [],
            performers: people.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === s.performer })),
            needsTarget: single || (service && s.serviceKind !== "identify-alchemy"),
            rarityLabel: product && CONFIG.PF2E?.rarityTraits?.[product.rarity] ? game.i18n.localize(CONFIG.PF2E.rarityTraits[product.rarity]) : null,
            priceText: product ? money(product.priceCp) : null, perText: product?.per > 1 ? number(product.per) : null,
            estimate: estimate ? { price: money(estimate.priceCp), upfront: money(estimate.upfrontCp) } : null,
            requesters: own.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === s.requester })),
            recipients: [
                ...people.map((a) => ({ value: a.uuid, name: a.name, selected: a.uuid === s.recipient })),
                { value: "strongbox", label: "pf2e-artisans-workshop.Queue.ForStrongbox", selected: s.recipient === "strongbox" },
            ],
            crafters: own.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === s.crafter })),
            subjectType, subjects: subjectType ? people.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === (s.subject || s.requester) })) : [],
            replaceable: subjectType ? replaceChoices(actorOf(s.subject || s.requester), product).map((i) => ({ ...i, selected: i.uuid === s.replaces })) : [],
            candidates: product && (!single || s.target) ? await this.#candidates(product, quantity, people, subjectType) : [],
            matches: service ? [] : await this.#matches(),
        });
    }

    /** Every member with Crafting, and how they would make the item at this quantity (4.3, 4.4, 6.5). */
    async #candidates(product, quantity, people, subjectType = null) {
        const rules = rulesFromSettings();
        const s = this.draft;
        const single = ON_ITEM.has(s.kind) || !!subjectType;
        const probe = {
            id: "preview", quantity: 1, craftType: subjectType ?? s.kind, target: subjectType ? s.subject || s.requester : single ? s.target || null : null,
            variant: s.kind === "rune-transfer" ? { transfer: { source: s.source || null } } : subjectType && s.replaces ? { replaces: s.replaces } : {},
            custody: {}, pledges: {},
        };
        const out = [];
        for (const actor of people) {
            const crafter = crafterFacts(actor);
            if (!(crafter.ranks.crafting > 0)) continue;
            const { gates, plan } = await gatesFor(probe, crafter, product, [], rules);
            const blocking = gates.filter((g) => !g.ok && !["G7", "G8", "G9", "G10", "G11", "batch"].includes(g.id) && g.reason !== "fulu-tradition");
            const batches = splitIntoBatches(quantity, Math.max(1, plan.batchMax ?? 1));
            const perDay = incomePerDay(crafter.level, crafter.ranks.crafting, DEGREE.success);
            const priceCp = single ? (plan.priceCp ?? 0) : Math.round((product.priceCp * batches[0]) / product.per);
            const days = daysToZero(priceCp - Math.ceil(priceCp / 2), perDay);
            out.push({
                name: actor.name, ok: blocking.length === 0, reasons: blocking.map(gateText),
                route: plan.route ? game.i18n.localize(ROUTE[plan.route] ?? ROUTE.none) : null,
                setup: plan.setup ? number(plan.setup.days) : null, dc: showDcs() ? plan.dc?.final ?? null : null,
                batchMax: number(plan.batchMax ?? 1), batches: number(batches.length),
                perDay: money(perDay), daysToZero: Number.isFinite(days) ? number(days) : null,
                price: single && plan.ok ? money(plan.priceCp) : null,
            });
        }
        return out;
    }

    /** Items in the equipment compendium whose name contains the search text (the cached catalogue, M5). */
    async #matches() {
        return (await searchCatalogue(this.draft.search, MATCHES)).map(({ uuid, name, img, level }) => ({ uuid, name, img, level }));
    }

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        this.element.addEventListener("change", (event) => this.#onChange(event));
        this.element.addEventListener("input", (event) => {
            if (event.target.name !== "search") return;
            this.draft.search = event.target.value;
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
        this.draft[name] = type === "checkbox" ? checked : value;
        if (name === "kind" || name === "serviceKind" || name === "requester") Object.assign(this.draft, { target: "", source: "", host: "" });
        if (name === "subject") this.draft.replaces = "";
        if (["quantity", "crafter", "recipient", "requester", "kind", "serviceKind", "target", "source", "host", "subject", "replaces"].includes(name)) this.render();
    }

    async #onDrop(event) {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if (data?.type !== "Item" || !data.uuid) return;
        const item = await fromUuid(data.uuid);
        this.draft.uuid = item?._stats?.compendiumSource ?? item?.sourceId ?? data.uuid;
        this.render();
    }

    static #onPick(_event, target) {
        this.draft.uuid = target.dataset.uuid;
        this.draft.search = "";
        return this.render();
    }

    static #onClear() {
        this.draft.uuid = null;
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
        const s = this.draft;
        if (s.kind === "service") {
            const result = report(await requestService({ kind: s.serviceKind, requester: s.requester, performer: s.performer || null,
                target: s.target || null, host: s.host || null, note: s.note }));
            if (result?.ok) {
                ui.notifications.info("pf2e-artisans-workshop.Request.ServiceFiled", { localize: true });
                await this.close();
            }
            return;
        }
        if (!s.uuid) {
            ui.notifications.warn("pf2e-artisans-workshop.Request.NoItem", { localize: true });
            return;
        }
        const single = ON_ITEM.has(s.kind);
        if (single && (!s.target || (s.kind === "rune-transfer" && !s.source))) {
            ui.notifications.warn("pf2e-artisans-workshop.Request.NoTarget", { localize: true });
            return;
        }
        const product = await productFacts(s.uuid);
        const subjectType = product && s.kind === "item" && setting("features.tattoos") !== false ? subjectTypeOf(product) : null;
        if (subjectType) {
            // M9 (6.14): a tattoo or graft for its subject, who receives it; one at a time.
            const subject = s.subject || s.requester;
            const result = report(await requestOrder({ uuid: s.uuid, quantity: 1, requester: s.requester, recipient: { kind: "actor", uuid: subject },
                crafter: s.crafter || null, note: s.note, gift: s.gift === true, target: subject, variant: s.replaces ? { replaces: s.replaces } : {} }));
            if (result?.ok) {
                ui.notifications.info("pf2e-artisans-workshop.Request.Filed", { format: { count: String(result.orders.length) } });
                await this.close();
            }
            return;
        }
        const recipient = s.recipient === "strongbox" ? { kind: "strongbox" } : { kind: "actor", uuid: s.recipient || s.requester };
        const result = report(await requestOrder({
            uuid: s.uuid, quantity: single ? 1 : Math.max(1, Number(s.quantity) || 1), requester: s.requester, recipient,
            crafter: s.crafter || null, note: s.note, gift: s.gift === true, craftType: s.kind === "item" ? null : s.kind,
            target: single ? s.target : null, variant: s.kind === "rune-transfer" ? { transfer: { source: s.source } } : {},
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
export function openRequestForm({ uuid = null, requester = null, parent = null, kind = null, focusSearch = false } = {}) {
    const form = new RequestForm({ uuid, requester, kind, focusSearch });
    return parent ? parent.renderChild(form) : form.render({ force: true });
}
