/**
 * The Workshop window (DESIGN.md 10.1-10.3, 10.6-10.9): one ApplicationV2 with Handlebars parts, so a change re-renders
 * only what it touches, debounced (never `requestAnimationFrame`). M4 builds the Queue and Funds tabs; the others come
 * with their milestones.
 *
 * - Header: party, strongbox balance, the pickup shelf for the user's characters (click it to collect), "acting as".
 * - Queue: filters, a magnifying glass that opens the request form's item search, every order of the party with its
 *   status chip, progress bar, blockers, days to zero and "finish now" amount, the actions the viewer may take, a detail
 *   drawer (requirements in plain words, work days, what a finished order cost and where its item went); drop an item on
 *   it to request it.
 * - Funds: fund accounting (M4.1): the strongbox as the unallocated party fund plus what is earmarked per order by
 *   source, and what each order spent; each member's balance, the ledger with authors and reversal; for a GM,
 *   reconciliation and adjustments. Every amount is typed as pp, gp, sp and cp (`prompts.mjs`).
 * - Downtime (M6, `downtime.mjs`): the workshop day, each PC's downtime status, activity and pending days, the day resolver
 *   and the Advance days wizard (`advance.mjs`), the current settlement and (for a GM) the settlement profiles, and Earn
 *   Income jobs; the tab's button carries a badge while the user's characters have days to resolve (9.1). An order's
 *   detail lists its Communal Crafting helpers (6.7).
 * - Morning (M7, `morning.mjs`): one character's daily preparations: its pools and their sources, vials, talisman pickers,
 *   loadouts, standing orders, the affix board and what will expire; the tab's button carries a badge while a rest has left
 *   the user's characters waiting to prepare (7.8).
 * - Status bar: an `aria-live` region for queue events, and the banner when the shared documents are not usable.
 *
 * Detached-window safe: listeners are delegated from the window's own element, elements are tested with
 * `foundry.utils.isElementInstanceOf`, the document is `element.ownerDocument`, and the request form and the dialogs
 * open in the window the Workshop is in.
 *
 * Live updates never take focus away (10.9): a re-render gives focus back to the control that had it, found by its data
 * attributes, with its caret (`focus.mjs`), and the order rows' roving tab stop stays on the row that had it.
 */
import { MODULE_ID } from "../constants.mjs";
import { unallocatedCp } from "../logic/funds.mjs";
import { CLOSED, logEntries, withdrawableCp } from "../logic/orders.mjs";
import {
    DEFAULT_FILTERS, fundWithdrawableCp, fundsView, passesFilters, queueOrder, queueSummary, rowLabel,
} from "../logic/views.mjs";
import { holdingsOf, valueCp } from "../logic/coins.mjs";
import { coinStacks } from "../foundry/coins.mjs";
import { shelfItemsFor } from "../foundry/claims.mjs";
import * as funds from "../foundry/funds.mjs";
import * as orders from "../foundry/orders.mjs";
import { reconciliationReport, bookAdjustment } from "../foundry/reconcile.mjs";
import { resolvePending } from "../foundry/money.mjs";
import { members } from "../foundry/roster.mjs";
import { rulesFromSettings, setting } from "../foundry/settings.mjs";
import { canWrite, shared, status } from "../foundry/state.mjs";
import { read, records } from "../foundry/store.mjs";
import { orderContext } from "./context.mjs";
import { focusState, restoreFocus } from "./focus.mjs";
import { money, nameOf, number, report, sourceName, userName, when } from "./format.mjs";
import { EVENT, ROW_KIND, STATUS } from "./labels.mjs";
import { askMoney, confirm } from "./prompts.mjs";
import { openRequestForm } from "./request.mjs";
import { detailExtras, kindText, onCustodyOp, onPledgeOp, onServiceOp, servicesView, targetText } from "./extras.mjs";
import { onCraftOp } from "./crafts.mjs";
import { fundsVariants, onVariantOp } from "./variants.mjs";
import { formulasContext, formulasOn, onFormulaChange, onFormulaDrop, onFormulaOp, onFormulaSearch } from "./formulas.mjs";
import { allServices } from "../foundry/services.mjs";
import { dayWatcher, downtimeOn, today, worldDate } from "../foundry/downtime.mjs";
import { downtimeContext, helpersContext, onDowntimeChange, onDowntimeInput, onDowntimeOp, onHelperOp, pendingBadge } from "./downtime.mjs";
import { morningBadge, morningContext, onMorningChange, onMorningInput, onMorningOp } from "./morning.mjs";
import { afflictionsOn } from "../foundry/afflictions.mjs";
import { openAfflictions, pendingBadge as afflictionBadge } from "./afflictions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const T = (name) => `modules/pf2e-artisans-workshop/templates/workshop/${name}.hbs`;

/** The longest a press in the window holds renders back (`renderParts`): a human click is far shorter. */
export const PRESS_HOLD_MS = 1500;

/** The fund prompt's opening sentence by what the order needs next (`shortfallOf` phases). */
const SHORT_INTRO = Object.freeze({
    upfront: "pf2e-artisans-workshop.Prompt.Intro.Upfront",
    retry: "pf2e-artisans-workshop.Prompt.Intro.Retry",
    finish: "pf2e-artisans-workshop.Prompt.Intro.Finish",
});

/** Partials the window and the chat cards share (`registerWindowHooks` loads them for the cards). */
export const PARTIALS = Object.freeze([
    "modules/pf2e-artisans-workshop/templates/partials/progress.hbs",
    "modules/pf2e-artisans-workshop/templates/partials/status.hbs",
]);

/** The banner for each status that is not "ready" (10.2). */
const BANNER = Object.freeze({
    disabled: "pf2e-artisans-workshop.Window.Banner.Disabled",
    missing: "pf2e-artisans-workshop.Window.Banner.Missing",
    newer: "pf2e-artisans-workshop.Window.Banner.Newer",
    migrating: "pf2e-artisans-workshop.Window.Banner.Migrating",
    stale: "pf2e-artisans-workshop.Window.Banner.Stale",
});

/**
 * The default size (10.8): `clamp(720, innerWidth - 380, 1180)` by `clamp(600, innerHeight - 120, 860)`, from the main
 * window, which the sidebar lives in (a detached Workshop keeps the size it had).
 */
function defaultSize() {
    const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
    const view = ui.sidebar?.element?.ownerDocument?.defaultView;
    const width = view?.innerWidth ?? 1440;
    const height = view?.innerHeight ?? 900;
    return { width: clamp(width - 380, 720, 1180), height: clamp(height - 120, 600, 860) };
}

export class WorkshopApp extends HandlebarsApplicationMixin(ApplicationV2) {
    /** The open window, if any: there is one Workshop per client. */
    static instance = null;

    static DEFAULT_OPTIONS = {
        id: "pf2e-artisans-workshop",
        classes: ["pf2e-artisans-workshop", "workshop-window"],
        window: { title: "pf2e-artisans-workshop.Window.Title", icon: "fa-solid fa-hammer", resizable: true, contentClasses: ["workshop-body"] },
        actions: {
            request: WorkshopApp.#onRequest,
            findItem: WorkshopApp.#onFindItem,
            select: WorkshopApp.#onSelect,
            closeDetail: WorkshopApp.#onCloseDetail,
            op: WorkshopApp.#onOrderOp,
            fund: WorkshopApp.#onFund,
            returnToFund: WorkshopApp.#onReturnToFund,
            withdraw: WorkshopApp.#onWithdraw,
            deposit: WorkshopApp.#onDeposit,
            withdrawFund: WorkshopApp.#onWithdrawFund,
            reverse: WorkshopApp.#onReverse,
            take: WorkshopApp.#onTake,
            closeRow: WorkshopApp.#onCloseRow,
            adjust: WorkshopApp.#onAdjust,
            clearFilters: WorkshopApp.#onClearFilters,
            // M5: the Formulas tab, casting pledges, custody and service orders.
            formula: WorkshopApp.#onFormula,
            pledgeOp: WorkshopApp.#onPledgeOp,
            custody: WorkshopApp.#onCustody,
            service: WorkshopApp.#onService,
            // M6: the Downtime tab, and the helpers of an order (Communal Crafting).
            downtime: WorkshopApp.#onDowntime,
            helper: WorkshopApp.#onHelper,
            // M7: the Morning tab.
            morning: WorkshopApp.#onMorning,
            // M8a: the Afflictions window, from the header's pending count (10.2).
            afflictions: WorkshopApp.#onAfflictions,
            // M9: a tattoo's subject, a fulu's tradition, healing, missives.
            craft: WorkshopApp.#onCraft,
            // M9a: the Treasure Vault (Remastered) variants (6.16).
            variant: WorkshopApp.#onVariant,
        },
    };

    static PARTS = {
        header: { template: T("header") },
        nav: { template: T("nav") },
        queue: { template: T("queue"), scrollable: [".queue-main", ".order-detail"], templates: PARTIALS },
        funds: { template: T("funds"), scrollable: [""] },
        morning: { template: T("morning"), scrollable: [""] },
        formulas: { template: T("formulas"), scrollable: [".codex-main", ".codex-learn"] },
        downtime: { template: T("downtime"), scrollable: [""] },
        status: { template: T("status") },
    };

    static TABS = {
        primary: {
            tabs: [
                { id: "queue", icon: "fa-solid fa-list-check", label: "pf2e-artisans-workshop.Window.Tab.Queue" },
                { id: "funds", icon: "fa-solid fa-coins", label: "pf2e-artisans-workshop.Window.Tab.Funds" },
                { id: "morning", icon: "fa-solid fa-sun", label: "pf2e-artisans-workshop.Window.Tab.Morning" },
                { id: "formulas", icon: "fa-solid fa-book-open", label: "pf2e-artisans-workshop.Window.Tab.Formulas" },
                { id: "downtime", icon: "fa-solid fa-calendar-days", label: "pf2e-artisans-workshop.Window.Tab.Downtime" },
            ],
            initial: "queue",
        },
    };

    /**
     * Queue filters (10.3), the order whose detail is open, the order row that is the list's tab stop (10.9), whether
     * the detail's list of met requirements is expanded (kept across live re-renders), the character this user acts as,
     * the last event.
     */
    filters = { ...DEFAULT_FILTERS };
    selected = null;
    activeRow = null;
    metOpen = false;
    acting = null;
    lastEvent = "";

    constructor(options = {}) {
        super(foundry.utils.mergeObject({ position: defaultSize() }, options));
        const last = setting("ui.lastTab");
        if (WorkshopApp.TABS.primary.tabs.some((tab) => tab.id === last)) this.tabGroups.primary = last;
    }

    /** The Downtime tab's badge as last rendered: the nav renders again only when it changes (9.1). */
    lastBadge = 0;

    /** The Morning tab's badge as last rendered (7.8). */
    lastMorningBadge = 0;

    /** Whether a tab badge changed since the nav last rendered. */
    badgesMoved() {
        return pendingBadge() !== this.lastBadge || morningBadge() !== this.lastMorningBadge;
    }

    /** Re-render after store changes stop for a moment (10.1). */
    refresh = foundry.utils.debounce(() => {
        if (!this.rendered) return;
        const parts = ["header", "queue", "funds", "formulas", "downtime", "status"];
        if (this.tabGroups.primary === "morning") parts.push("morning");
        if (this.badgesMoved()) parts.push("nav");
        this.renderParts(parts);
    }, 150);

    /** Re-render what a new day changes (9.1): the day in the header, the Downtime tab, and the badge if its count moved. */
    refreshDay = foundry.utils.debounce(() => {
        if (!this.rendered) return;
        const parts = ["header", "downtime"];
        if (this.tabGroups.primary === "morning") parts.push("morning");
        if (this.badgesMoved()) parts.push("nav");
        this.renderParts(parts);
    }, 150);

    /** Whether a pointer is pressed in the window (a click under way), and the parts held back until it is released. */
    #pressed = false;
    #held = null;

    /**
     * Render `parts` now, or once a press in the window is released. A field's change event fires as the field loses
     * focus, which is on the press of the button the user is clicking; a render then replaces that button before the
     * release, and the click is lost (M7 live pass: a talisman count typed, then "Make daily preparations" at once; M6 had
     * the same with a job's task level). The release's click runs first, then the held parts render.
     */
    renderParts(parts) {
        if (!this.#pressed) return this.render({ parts });
        this.#held = [...new Set([...(this.#held ?? []), ...parts])];
        return null;
    }

    /** A press in the window: hold renders until it is released (or `PRESS_HOLD_MS` at most, a press that never ends). */
    #onPress() {
        if (this.#pressed) return;
        this.#pressed = true;
        const doc = this.element?.ownerDocument;
        let done = false;
        const release = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            doc?.removeEventListener("pointerup", release, true);
            doc?.removeEventListener("pointercancel", release, true);
            // A timeout: the click a release makes is dispatched in the same task, before this runs.
            setTimeout(() => {
                this.#pressed = false;
                const parts = this.#held;
                this.#held = null;
                if (parts?.length && this.rendered) this.render({ parts });
            }, 0);
        };
        const timer = setTimeout(release, PRESS_HOLD_MS);
        doc?.addEventListener("pointerup", release, true);
        doc?.addEventListener("pointercancel", release, true);
    }

    /** Announce an event in the status bar's live region (10.2) without moving focus. */
    announce(text) {
        this.lastEvent = text;
        const region = this.element?.querySelector(".workshop-live");
        if (region) region.textContent = text;
    }

    /** The character this user acts as: the chosen one, else their assigned one, else their first. */
    actingActor() {
        const choices = orders.actingChoices();
        return choices.find((a) => a.uuid === this.acting) ?? choices.find((a) => a === game.user.character) ?? choices[0] ?? null;
    }

    /* -------------------------------------------- */
    /*  Context                                      */
    /* -------------------------------------------- */

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const current = status();
        const strongbox = shared().strongbox;
        const acting = this.actingActor();
        const shelf = orders.actingChoices().flatMap((actor) => shelfItemsFor(actor.uuid));
        // The workshop day and the world date (10.2, M6).
        const day = current === "ready" && downtimeOn() ? today() : null;
        return Object.assign(context, {
            dayText: day ? game.i18n.format("pf2e-artisans-workshop.Window.Day", { day: number(day.day) }) : null, worldDate: day ? worldDate() : null,
            isGM: game.user.isGM,
            ready: current === "ready",
            readable: ["ready", "newer", "migrating", "stale"].includes(current),
            banner: current === "ready" ? null : BANNER[current] ?? BANNER.missing,
            party: game.actors.party?.name ?? null,
            strongboxText: strongbox ? money(valueCp(holdingsOf(coinStacks(strongbox)))) : null,
            shelfCount: shelf.length,
            // M8a (10.2): pending affliction saves of the user's characters; the button opens the Afflictions window.
            afflictionCount: current === "ready" ? afflictionBadge(orders.actingChoices()) : 0,
            afflictionsOn: current === "ready" && afflictionsOn(),
            acting: orders.actingChoices().map((a) => ({ uuid: a.uuid, name: a.name, level: a.level, selected: a === acting })),
            actingUuid: acting?.uuid ?? null,
            lastEvent: this.lastEvent,
        });
    }

    async _preparePartContext(partId, context, options) {
        const part = await super._preparePartContext(partId, context, options);
        part.tab = context.tabs?.[partId] ?? null;
        if (partId === "queue" && context.readable) Object.assign(part, await this.#queueContext());
        if (partId === "funds" && context.readable) Object.assign(part, this.#fundsContext());
        if (partId === "downtime" && context.readable) Object.assign(part, downtimeContext(this));
        if (partId === "nav") {
            this.lastBadge = context.readable ? pendingBadge() : 0;
            this.lastMorningBadge = context.readable ? morningBadge() : 0;
            part.badges = { downtime: this.lastBadge || null, morning: this.lastMorningBadge || null };
            part.badgeLabels = {
                downtime: this.lastBadge ? game.i18n.format("pf2e-artisans-workshop.Downtime.Badge", { n: number(this.lastBadge) }) : null,
                morning: this.lastMorningBadge ? game.i18n.format(this.lastMorningBadge === 1 ? "pf2e-artisans-workshop.Morning.BadgeOne" : "pf2e-artisans-workshop.Morning.Badge",
                    { n: number(this.lastMorningBadge) }) : null,
            };
        }
        // The Morning tab reads every character's pools and the equipment catalogue: built only while its tab is shown.
        if (partId === "morning" && context.readable) {
            Object.assign(part, this.tabGroups.primary === "morning" ? await morningContext(this) : { morningPending: true });
        }
        // The Codex scans the equipment catalogue, so it is built only while its tab is shown (changeTab renders it then).
        if (partId === "formulas" && context.readable) {
            Object.assign(part, !formulasOn() ? { formulasOff: true } : this.tabGroups.primary === "formulas" ? await formulasContext(this) : { formulasPending: true });
        }
        return part;
    }

    async #queueContext() {
        const all = orders.allOrders();
        const viewer = orders.viewer();
        const views = [];
        for (const { order, no } of queueOrder(all)) {
            const view = await orderContext(order, { no, viewer });
            if (passesFilters(view, order, this.filters)) views.push({ ...view, kindText: kindText(order), targetText: targetText(order) });
        }
        // One row is the list's tab stop (roving tabindex, 10.9): the one the user was on, else the first.
        const stop = views.some((v) => v.id === this.activeRow) ? this.activeRow : views[0]?.id ?? null;
        for (const view of views) view.tabStop = view.id === stop;
        let selected = null;
        if (this.selected) {
            const order = read(`orders.${this.selected}`);
            if (order) selected = await this.#detailContext(order, views.find((v) => v.id === order.id));
            else this.selected = null;
        }
        const option = (value, label, current) => ({ value, label, selected: value === current });
        const people = members();
        return {
            orders: views, selected, total: all.length, summary: queueSummary(all), services: servicesView(allServices()),
            filters: this.filters, filtered: views.length !== all.length,
            scopeOptions: [
                option("all", "pf2e-artisans-workshop.Queue.Filter.All", this.filters.scope),
                option("mine", "pf2e-artisans-workshop.Queue.Filter.Mine", this.filters.scope),
                option("open", "pf2e-artisans-workshop.Queue.Filter.Open", this.filters.scope),
                option("blocked", "pf2e-artisans-workshop.Queue.Filter.Blocked", this.filters.scope),
            ],
            statusOptions: [option("any", "pf2e-artisans-workshop.Queue.Filter.AnyStatus", this.filters.status),
                // M9a (6.16.9): `gathering` exists only while crafting quests are on.
                ...Object.entries(STATUS).filter(([id]) => id !== "archived" && (id !== "gathering" || rulesFromSettings().variants.quests))
                    .map(([id, s]) => option(id, s.key, this.filters.status))],
            crafterOptions: [option("any", "pf2e-artisans-workshop.Queue.Filter.AnyCrafter", this.filters.crafter),
                option("none", "pf2e-artisans-workshop.Queue.Filter.NoCrafter", this.filters.crafter),
                ...people.map((a) => ({ value: a.uuid, name: a.name, selected: a.uuid === this.filters.crafter }))],
            recipientOptions: [option("any", "pf2e-artisans-workshop.Queue.Filter.AnyRecipient", this.filters.recipient),
                option("strongbox", "pf2e-artisans-workshop.Queue.ForStrongbox", this.filters.recipient),
                ...people.map((a) => ({ value: a.uuid, name: a.name, selected: a.uuid === this.filters.recipient }))],
        };
    }

    /**
     * The detail drawer of one order: its requirements in plain words (from the view), earmarked money by source, work
     * days, history and rows.
     */
    async #detailContext(order, listed) {
        const view = listed ?? await orderContext(order, { viewer: orders.viewer() });
        const rows = orders.orderRows(order.id);
        return {
            ...view,
            extras: await detailExtras(order),
            helpers: helpersContext(order),
            history: logEntries(order).reverse().map((entry) => ({
                event: entry.event, by: userName(entry.by), when: when(entry.at), eventLabel: EVENT[entry.event] ?? EVENT.other,
            })),
            rows: rows.sort((a, b) => (b.at?.real ?? 0) - (a.at?.real ?? 0)).map((row) => {
                const label = rowLabel(row);
                return {
                    kind: ROW_KIND[label.code] ?? row.kind, amount: label.items ? null : money(row.cp ?? 0),
                    actor: row.actor ? nameOf(row.actor) : null, by: userName(row.author), state: row.state, reversed: !!row.reversedBy,
                };
            }),
            requesterName: nameOf(order.requester),
            metOpen: this.metOpen,
        };
    }

    #fundsContext() {
        const viewer = orders.viewer();
        const rows = records("rows");
        const strongbox = shared().strongbox;
        const ordersById = Object.fromEntries(orders.allOrders().map((order) => [order.id, order]));
        const view = fundsView({
            rows, actualCp: strongbox ? valueCp(holdingsOf(coinStacks(strongbox))) : 0, orders: ordersById, viewer, nameOf, userName,
        });
        const acting = this.actingActor();
        const recon = game.user.isGM ? reconciliationReport() : null;
        const a = view.accounts;
        const orderName = (id) => {
            const order = ordersById[id];
            return order?.visibility === "gift" ? game.i18n.localize("pf2e-artisans-workshop.Queue.Gift") : order?.product?.snapshot?.name ?? null;
        };
        const parts = { total: money(view.actualCp), expected: money(a.expectedCp), unallocated: money(a.unallocatedCp),
            earmarked: money(a.earmarkedCp), difference: money(view.differenceCp) };
        return {
            // M9a (6.16.7, 6.16.8): the gardens and the bestowed gifts, while their variants are on.
            variantFunds: fundsVariants(),
            funds: {
                ...view,
                actualText: money(view.actualCp), expectedText: money(view.expectedCp), differenceText: money(view.differenceCp),
                fundText: money(view.fundCp), unassignedText: money(view.unassignedCp),
                balanced: view.differenceCp === 0,
                // Fund accounting (M4.1): the strongbox is the unallocated fund plus what is earmarked, said in one line.
                // A difference from the coins counted is flagged; its amount, like reconciliation, is a GM's (10.10).
                identityText: game.i18n.format(view.differenceCp === 0 && a.balanced ? "pf2e-artisans-workshop.Funds.Identity"
                    : game.user.isGM ? "pf2e-artisans-workshop.Funds.IdentityOff" : "pf2e-artisans-workshop.Funds.IdentityOffPlayer", parts),
                earmarkedText: money(a.earmarkedCp), spentText: money(a.spentCp),
                accountOrders: a.orders.map((o) => ({
                    id: o.id, name: orderName(o.id), statusWord: STATUS[o.status] ? game.i18n.localize(STATUS[o.status].key) : null,
                    refundsWaiting: o.refundsWaiting,
                    earmarked: [
                        ...o.earmarked.map((e) => ({ name: sourceName(e.actor), amount: money(e.cp), fund: e.actor === null })),
                        // Material stock beside the money, by who handed it over (M5 on M4.1); items, not in the totals.
                        ...(o.stock ?? []).map((e) => ({ name: game.i18n.format("pf2e-artisans-workshop.Detail.StockFrom", { name: sourceName(e.actor) }),
                            amount: money(e.cp), stock: true })),
                    ],
                    earmarkedText: money(o.earmarkedCp),
                    spent: o.spent.map((e) => ({ name: sourceName(e.actor), amount: money(e.cp) })),
                    spentText: o.spentCp ? money(o.spentCp) : null,
                })),
                // Each member: their own purse's money in orders, and their share of the party fund split as the cards
                // above split the fund, unallocated and earmarked for orders (review fix of M4.1).
                members: view.members.map((m) => ({
                    ...m, total: money(m.cp), inOrders: money(m.ownCp),
                    fundUnallocated: money(m.fundUnallocatedCp), fundEarmarked: money(m.fundEarmarkedCp),
                })),
                ledger: view.ledger.map((row) => ({
                    ...row, kindLabel: ROW_KIND[row.code] ?? row.kind, amount: row.items ? null : money(row.cp), box: row.box,
                    boxText: row.box ? money(row.box) : null, when: row.at ? when({ real: row.at }) : "",
                })),
                withdrawable: acting ? fundWithdrawableCp(rows, acting.uuid) : 0,
                reconciliation: recon ? {
                    needsHand: recon.needsHand.map((row) => ({ id: row.id, kind: ROW_KIND[row.kind] ?? row.kind, amount: money(row.cp ?? 0), by: userName(row.author) })),
                    inFlight: recon.inFlight.length, resumable: recon.resumable.length, lockedStacks: recon.lockedStacks.length,
                    owed: money(recon.owedBoxCp), canAdjust: recon.differenceCp + recon.owedBoxCp !== 0,
                } : null,
            },
        };
    }

    /* -------------------------------------------- */
    /*  Rendering                                    */
    /* -------------------------------------------- */

    _onFirstRender(context, options) {
        super._onFirstRender?.(context, options);
        WorkshopApp.instance = this;
        // In the capture phase: the press is known before the focused field's change event that it causes.
        this.element.addEventListener("pointerdown", () => this.#onPress(), true);
        this.element.addEventListener("change", (event) => this.#onChange(event));
        this.element.addEventListener("input", (event) => this.#onInput(event));
        this.element.addEventListener("keydown", (event) => this.#onKeydown(event));
        this.element.addEventListener("click", (event) => this.#onRowClick(event));
        this.element.addEventListener("focusin", (event) => this.#onFocusIn(event));
        // `toggle` does not bubble: listen in the capture phase.
        this.element.addEventListener("toggle", (event) => this.#onToggle(event), true);
    }

    /** Before a part is replaced: which control has focus, by its data attributes, and its caret (10.9). */
    _preSyncPartState(partId, newElement, priorElement, state) {
        super._preSyncPartState(partId, newElement, priorElement, state);
        state.workshopFocus = focusState(priorElement);
    }

    /** After: that control has focus again, with its caret where it was (core's own restore puts it at the start). */
    _syncPartState(partId, newElement, priorElement, state) {
        super._syncPartState(partId, newElement, priorElement, state);
        restoreFocus(newElement, state.workshopFocus);
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        const queue = this.element.querySelector(".workshop-queue");
        if (queue) {
            new foundry.applications.ux.DragDrop.implementation({
                dropSelector: ".workshop-queue",
                permissions: { drop: () => canWrite() },
                callbacks: { drop: (event) => this.#onDrop(event) },
            }).bind(this.element);
        }
        if (this.element.querySelector(".workshop-formulas")) {
            new foundry.applications.ux.DragDrop.implementation({
                dropSelector: ".workshop-formulas",
                callbacks: { drop: async (event) => {
                    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
                    if (await onFormulaDrop(this, data)) this.render({ parts: ["formulas"] });
                } },
            }).bind(this.element);
        }
        this.#syncTabs();
    }

    _onClose(options) {
        super._onClose?.(options);
        if (WorkshopApp.instance === this) WorkshopApp.instance = null;
    }

    /** Keep the tab buttons' ARIA state with the active tab (`aria-selected`; core's `aria-pressed` is not for tabs). */
    #syncTabs() {
        const active = this.tabGroups.primary;
        for (const button of this.element.querySelectorAll(".workshop-tabs [data-tab]")) {
            const on = button.dataset.tab === active;
            button.setAttribute("aria-selected", String(on));
            button.removeAttribute("aria-pressed");
            button.tabIndex = on ? 0 : -1;
        }
    }

    /** Core's tab change (it finds the buttons in the `.tabs` nav), then the ARIA state, and remember it (14.3 `ui.lastTab`). */
    changeTab(tab, group, options) {
        super.changeTab(tab, group, options);
        this.#syncTabs();
        if (tab === "formulas") this.render({ parts: ["formulas"] });
        if (tab === "morning") this.render({ parts: ["morning"] });
        if (setting("ui.lastTab") !== tab) game.settings.set(MODULE_ID, "ui.lastTab", tab);
    }

    /** Open the window on a tab, and optionally on an order's detail. */
    async show({ tab = null, order = null } = {}) {
        if (order) {
            this.selected = order;
            tab ??= "queue";
        }
        if (tab && WorkshopApp.TABS.primary.tabs.some((t) => t.id === tab)) this.tabGroups.primary = tab;
        await this.render({ force: true });
        if (this.rendered && tab) this.#syncTabs();
        return this;
    }

    /* -------------------------------------------- */
    /*  Listeners                                    */
    /* -------------------------------------------- */

    /** A field changed: what it changes renders, after the click that made it lose focus, if any (`renderParts`). */
    async #onChange(event) {
        const target = event.target;
        if (onFormulaChange(this, target)) {
            this.renderParts(["formulas"]);
            return;
        }
        if (target.closest?.(".workshop-morning")) {
            if (onMorningChange(this, target)) this.renderParts(["morning"]);
            return;
        }
        if (target.closest?.(".workshop-downtime")) {
            const again = await onDowntimeChange(this, target);
            if (again) this.renderParts(["downtime"]);
            if (again !== null) return;
        }
        if (target.name === "acting") {
            this.acting = target.value;
            this.renderParts(["header", "queue", "funds"]);
            return;
        }
        const filter = target.dataset?.filter;
        if (filter && filter !== "search") {
            this.filters = { ...this.filters, [filter]: target.value };
            this.renderParts(["queue"]);
        }
    }

    #searchDebounce = foundry.utils.debounce(() => this.render({ parts: ["queue"] }), 250);

    #formulaSearchDebounce = foundry.utils.debounce(() => this.render({ parts: ["formulas"] }), 250);

    #onInput(event) {
        if (event.target.closest?.(".workshop-morning") && onMorningInput(this, event.target)) return;
        if (event.target.closest?.(".workshop-downtime") && onDowntimeInput(this, event.target)) return;
        if (event.target.dataset?.codex === "search") {
            onFormulaSearch(this, event.target.value);
            this.#formulaSearchDebounce();
            return;
        }
        if (event.target.dataset?.filter !== "search") return;
        this.filters = { ...this.filters, search: event.target.value };
        this.#searchDebounce();
    }

    /** The met requirements' list stays as the user left it, open or closed, when a live update re-renders the detail. */
    #onToggle(event) {
        if (event.target?.classList?.contains("detail-met")) this.metOpen = event.target.open === true;
    }

    /** The row focus lands on, by keyboard or mouse, becomes the list's tab stop. */
    #onFocusIn(event) {
        const row = event.target.closest?.(".order-row");
        if (row && event.target === row) this.#makeTabStop(row);
    }

    /** Make `row` the order list's one tab stop, here and in the next render. */
    #makeTabStop(row) {
        this.activeRow = row.dataset.orderId;
        for (const r of this.element.querySelectorAll(".order-row")) r.tabIndex = r === row ? 0 : -1;
    }

    /** A click on an order row's free space opens its detail; buttons and links keep their own meaning. */
    #onRowClick(event) {
        const row = event.target.closest?.(".order-row");
        if (!row || event.target.closest("button, a, input, select, label")) return;
        this.#select(row.dataset.orderId);
    }

    /**
     * Keyboard (10.3, 10.9): a roving tabindex over the order rows (Up and Down, Home and End move; Enter or Space opens the
     * detail); Escape closes the detail and returns focus to its row; Left and Right move between the tabs.
     */
    #onKeydown(event) {
        const row = event.target.closest?.(".order-row");
        if (row && event.target === row) {
            const rows = [...this.element.querySelectorAll(".order-row")];
            const index = rows.indexOf(row);
            const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: rows.length - 1 }[event.key];
            if (move !== undefined) {
                event.preventDefault();
                const next = rows[Math.max(0, Math.min(rows.length - 1, move))];
                this.#makeTabStop(next);
                next.focus();
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.#select(row.dataset.orderId);
                return;
            }
        }
        if (event.key === "Escape" && this.selected && event.target.closest?.(".order-detail")) {
            event.preventDefault();
            event.stopPropagation();
            this.#closeDetail();
            return;
        }
        const tab = event.target.closest?.(".workshop-tabs [data-tab]");
        if (tab && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            const tabs = [...this.element.querySelectorAll(".workshop-tabs [data-tab]")];
            const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
            const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
            this.changeTab(next.dataset.tab, "primary");
            next.focus();
        }
    }

    async #select(id) {
        this.selected = id;
        this.activeRow = id ?? this.activeRow;
        await this.render({ parts: ["queue"] });
        this.element.querySelector(".order-detail")?.focus();
    }

    async #closeDetail() {
        const id = this.selected;
        this.selected = null;
        this.activeRow = id ?? this.activeRow;
        await this.render({ parts: ["queue"] });
        const row = this.element.querySelector(`.order-row[data-order-id="${id}"]`);
        if (row) {
            this.#makeTabStop(row);
            row.focus();
        }
    }

    /** Drop an item (from a sheet, the compendium browser, the sidebar or a chat link) to request it (10.6). */
    async #onDrop(event) {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if (data?.type !== "Item" || !data.uuid) return;
        const item = await fromUuid(data.uuid);
        const uuid = item?._stats?.compendiumSource ?? item?.sourceId ?? data.uuid;
        await openRequestForm({ uuid, requester: this.actingActor()?.uuid ?? null, parent: this });
    }

    /* -------------------------------------------- */
    /*  Actions                                      */
    /* -------------------------------------------- */

    /** Run an action and tell the user why it did not happen, if it did not. */
    async #run(promise, done = null) {
        const result = report(await promise);
        if (result?.ok && done) this.announce(game.i18n.localize(done));
        return result;
    }

    static #onRequest() {
        return openRequestForm({ requester: this.actingActor()?.uuid ?? null, parent: this });
    }

    /** The magnifying glass (F): the request form, its item search focused. Searching items is the form's, not the filter's. */
    static #onFindItem() {
        return openRequestForm({ requester: this.actingActor()?.uuid ?? null, parent: this, focusSearch: true });
    }

    static #onSelect(_event, target) {
        return this.#select(target.closest("[data-order-id]")?.dataset.orderId);
    }

    static #onCloseDetail() {
        return this.#closeDetail();
    }

    static #onClearFilters() {
        this.filters = { ...DEFAULT_FILTERS };
        return this.render({ parts: ["queue"] });
    }

    /** The order buttons: `data-op` names the lifecycle step (4.2.3). */
    static async #onOrderOp(_event, target) {
        const id = target.closest("[data-order-id]")?.dataset.orderId;
        const op = target.dataset.op;
        if (!id || !op) return;
        target.disabled = true;
        try {
            switch (op) {
                case "accept": {
                    const actor = this.actingActor();
                    return await this.#run(actor ? orders.accept(id, actor.uuid) : { ok: false, reason: "not-owner" }, "pf2e-artisans-workshop.Event.Accept");
                }
                case "release": return await this.#run(orders.release(id), "pf2e-artisans-workshop.Event.Release");
                case "start": return await this.#run(orders.start(id), "pf2e-artisans-workshop.Event.Start");
                case "work": return await this.#run(orders.workDay(id), "pf2e-artisans-workshop.Event.Work");
                case "roll": return await this.#run(orders.roll(id));
                case "settle": return await this.#run(orders.settle(id), "pf2e-artisans-workshop.Event.Settle");
                case "finish": return await this.#finish(id);
                case "pause": return await this.#run(orders.pause(id), "pf2e-artisans-workshop.Event.Pause");
                case "resume": return await this.#run(orders.resume(id), "pf2e-artisans-workshop.Event.Resume");
                case "retry": return await this.#retry(id);
                case "undo": return await this.#run(orders.undo(id), "pf2e-artisans-workshop.Event.Undo");
                case "cancel": {
                    const ok = await confirm({ title: "pf2e-artisans-workshop.Prompt.Cancel.Title", content: "pf2e-artisans-workshop.Prompt.Cancel.Content", app: this });
                    return ok ? await this.#run(orders.cancel(id), "pf2e-artisans-workshop.Event.Cancel") : null;
                }
                default: return null;
            }
        } finally {
            if (target.isConnected) target.disabled = false;
        }
    }

    /** The prompt's opening sentence for what an order still needs (A, M4.1). */
    static #shortIntro(short) {
        const key = short.shortCp > 0 ? SHORT_INTRO[short.phase] : null;
        return game.i18n.format(key ?? "pf2e-artisans-workshop.Prompt.Intro.Covered",
            { need: money(short.needCp), holds: money(short.holdsCp), short: money(short.shortCp) });
    }

    /**
     * "Fund this order" (A, B, As built in M4.1): where the money comes from (the party fund, or the purse of one of the
     * user's characters) and how much, as pp, gp, sp and cp, with "Fill the shortfall" ready; `prefill` starts with it
     * filled in (the requirement's own button).
     */
    async fundPrompt(id, { prefill = false } = {}) {
        // Before start, against the plan the order would freeze, as G8 judges it (M5 on M4.1).
        const short = await funds.shortfallNow(id);
        if (!short) return null;
        const answer = await askMoney({
            kind: "fund", actors: orders.actingChoices(), actor: this.actingActor()?.uuid ?? null,
            sources: { fundCp: unallocatedCp(records("rows")) },
            fill: short.shortCp > 0 ? { cp: short.shortCp, key: "pf2e-artisans-workshop.Prompt.Fill" } : null, prefill,
            intro: WorkshopApp.#shortIntro(short), app: this,
        });
        if (!answer) return null;
        return this.#run(funds.fundOrder(id, answer),
            answer.source === "fund" ? "pf2e-artisans-workshop.Event.Earmark" : "pf2e-artisans-workshop.Event.Pledge");
    }

    /**
     * A crafter's step the order's earmarked money must cover (Finish, Retry; A, D): with nothing short, at once;
     * otherwise first ask where the rest comes from (the party fund or a purse), the shortfall filled in and required,
     * then draw it and take the step.
     */
    async #drawThen(id, { kind, step, drawn, done }) {
        const short = funds.shortfallFor(id);
        if (!short || short.shortCp <= 0) return this.#run(step(), done);
        const answer = await askMoney({
            kind, actors: orders.actingChoices(), actor: this.actingActor()?.uuid ?? null,
            sources: { fundCp: unallocatedCp(records("rows")) }, minCp: short.shortCp,
            fill: { cp: short.shortCp, key: "pf2e-artisans-workshop.Prompt.Fill" }, prefill: true,
            intro: WorkshopApp.#shortIntro(short), app: this,
        });
        if (!answer) return null;
        return this.#run(drawn(answer), done);
    }

    /** Finish (D, A): pay what is left, drawing any shortfall from the source the user picks. */
    #finish(id) {
        return this.#drawThen(id, { kind: "finish", step: () => orders.finish(id), drawn: (draw) => funds.finishOrder(id, { draw }),
            done: "pf2e-artisans-workshop.Event.Finish" });
    }

    /** Retry after a failure: a critical failure ruined some materials, so the new attempt may need more up front. */
    #retry(id) {
        return this.#drawThen(id, { kind: "retry", step: () => orders.retry(id), drawn: (draw) => funds.retryOrder(id, { draw }),
            done: "pf2e-artisans-workshop.Event.Retry" });
    }

    static async #onFund(_event, target) {
        const id = target.closest("[data-order-id]")?.dataset.orderId;
        if (id) await this.fundPrompt(id, { prefill: target.dataset.fill === "short" });
    }

    /**
     * Give the order's party-fund share back to the unallocated fund: what is not committed, or all of it on a closed
     * order (`returnableFor`, the limit `returnToParty` applies, so the dialog never refuses what the detail offers).
     */
    static async #onReturnToFund(_event, target) {
        const id = target.closest("[data-order-id]")?.dataset.orderId;
        if (!id || !read(`orders.${id}`)) return;
        const max = funds.returnableFor(id);
        const answer = await askMoney({ kind: "return", maxCp: max, fill: { cp: max, key: "pf2e-artisans-workshop.Prompt.FillAll" }, prefill: true, app: this });
        if (answer) await this.#run(funds.returnToParty(id, answer.cp), "pf2e-artisans-workshop.Event.ReturnToFund");
    }

    static async #onWithdraw(_event, target) {
        const id = target.closest("[data-order-id]")?.dataset.orderId;
        const order = read(`orders.${id}`);
        if (!order) return;
        const rows = orders.orderRows(id);
        const actors = orders.actingChoices().filter((a) => withdrawableCp(order, rows, a.uuid) > 0);
        const max = Math.max(0, ...actors.map((a) => withdrawableCp(order, rows, a.uuid)));
        const answer = await askMoney({ kind: "withdraw", actors, maxCp: max, fill: { cp: max, key: "pf2e-artisans-workshop.Prompt.FillAll" }, app: this });
        if (answer) await this.#run(orders.withdrawFrom(id, answer.actor, answer.cp), "pf2e-artisans-workshop.Event.Withdraw");
    }

    /** "Add to party fund": coins from a purse into the unallocated fund (A). */
    static async #onDeposit() {
        const answer = await askMoney({ kind: "deposit", actors: orders.actingChoices(), actor: this.actingActor()?.uuid ?? null, app: this });
        if (answer) await this.#run(funds.deposit(answer.actor, answer.cp), "pf2e-artisans-workshop.Event.Deposit");
    }

    static async #onWithdrawFund() {
        const rows = records("rows");
        const actors = orders.actingChoices().filter((a) => fundWithdrawableCp(rows, a.uuid) > 0);
        const max = Math.max(0, ...actors.map((a) => fundWithdrawableCp(rows, a.uuid)));
        const answer = await askMoney({ kind: "withdraw", actors, maxCp: max, fill: { cp: max, key: "pf2e-artisans-workshop.Prompt.FillAll" }, app: this });
        if (answer) await this.#run(funds.withdrawFund(answer.actor, answer.cp), "pf2e-artisans-workshop.Event.Withdraw");
    }

    static async #onReverse(_event, target) {
        const ok = await confirm({ title: "pf2e-artisans-workshop.Prompt.Reverse.Title", content: "pf2e-artisans-workshop.Prompt.Reverse.Content", app: this });
        if (ok) await this.#run(funds.reverse(target.closest("[data-row-id]")?.dataset.rowId), "pf2e-artisans-workshop.Event.Reverse");
    }

    static async #onTake() {
        await this.#run(funds.takeAll(), "pf2e-artisans-workshop.Event.Take");
    }

    static async #onCloseRow(_event, target) {
        await this.#run(resolvePending(target.closest("[data-row-id]")?.dataset.rowId), "pf2e-artisans-workshop.Event.Close");
    }

    static async #onAdjust() {
        await this.#run(bookAdjustment(), "pf2e-artisans-workshop.Event.Adjust");
    }

    /** A Formulas-tab button (M5): choose a formula or a pick, or act on a route. */
    static async #onFormula(_event, target) {
        target.disabled = true;
        try {
            const result = await onFormulaOp(this, target);
            if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Formula"));
        } finally {
            if (target.isConnected) target.disabled = false;
        }
        return this.render({ parts: ["formulas", "queue"] });
    }

    /**
     * A casting button on an order's detail (M5, 6.9). Its own announcement: "Event.Pledge" is money from a purse since
     * M4.1, so the castings say "Event.Casting".
     */
    static async #onPledgeOp(_event, target) {
        const result = await onPledgeOp(this, target);
        if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Casting"));
    }

    /** An M9 button: a subject agrees or withdraws, a fulu's tradition, healing recorded, a missive composed. */
    static async #onCraft(_event, target) {
        target.disabled = true;
        try {
            const result = await onCraftOp(this, target);
            if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Craft"));
        } finally {
            if (target.isConnected) target.disabled = false;
        }
    }

    /** A variant button (M9a, 6.16): on an order's detail, the Funds tab's gardens and gifts, the Downtime tab's harvests. */
    static async #onVariant(_event, target) {
        target.disabled = true;
        try {
            const result = await onVariantOp(this, target);
            if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Variant"));
        } finally {
            if (target.isConnected) target.disabled = false;
        }
        return this.render({ parts: ["queue", "funds", "downtime"] });
    }

    /** A custody button: hand over an item, add stock, give one back (M5). */
    static async #onCustody(_event, target) {
        target.disabled = true;
        try {
            const result = await onCustodyOp(this, target);
            if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Custody"));
        } finally {
            if (target.isConnected) target.disabled = false;
        }
    }

    /** A service button (M5, 4.5). */
    static async #onService(_event, target) {
        target.disabled = true;
        try {
            const result = await onServiceOp(this, target);
            if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Service"));
        } finally {
            if (target.isConnected) target.disabled = false;
        }
    }

    /** A Downtime tab button (M6). */
    static async #onDowntime(_event, target) {
        target.disabled = true;
        try {
            const result = await onDowntimeOp(this, target);
            if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Downtime"));
        } finally {
            if (target.isConnected) target.disabled = false;
        }
        return this.render({ parts: ["downtime"] });
    }

    /** A Morning tab button (M7). */
    static async #onMorning(_event, target) {
        target.disabled = true;
        try {
            const result = await onMorningOp(this, target);
            if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Morning"));
        } finally {
            if (target.isConnected) target.disabled = false;
        }
        return this.render({ parts: ["morning", "nav"] });
    }

    /** The header's pending affliction saves (M8a, 10.2): open the Afflictions window. */
    static #onAfflictions() {
        return openAfflictions();
    }

    /** A helpers button on an order's detail (M6, 6.7). */
    static async #onHelper(_event, target) {
        target.disabled = true;
        try {
            const result = await onHelperOp(this, target);
            if (result?.ok) this.announce(game.i18n.localize("pf2e-artisans-workshop.Event.Helper"));
        } finally {
            if (target.isConnected) target.disabled = false;
        }
    }
}

/* -------------------------------------------- */
/*  Opening, and keeping it current              */
/* -------------------------------------------- */

/**
 * Open the Workshop (11.1 `api.ui.open`): on a tab, on an order's detail, as a character (`actor`, a UUID or document),
 * with a Queue filter.
 */
export async function openWorkshop({ tab = null, order = null, actor = null, filter = null } = {}) {
    const app = WorkshopApp.instance ?? new WorkshopApp();
    if (actor) app.acting = typeof actor === "string" ? actor : actor.uuid;
    if (filter && ["mine", "open", "blocked", "all"].includes(filter)) app.filters = { ...app.filters, scope: filter };
    return app.show({ tab, order });
}

/** Hooks that re-render the open window when the shared state changes (10.1). */
export function registerWindowHooks() {
    const touch = () => WorkshopApp.instance?.refresh();
    const sharedDoc = (doc) => {
        const { ledger, strongbox } = shared();
        return doc === ledger || doc === strongbox || doc?.parent === strongbox || doc?.parent === ledger;
    };
    for (const name of ["updateJournalEntry", "updateActor", "createItem", "updateItem", "deleteItem"]) {
        Hooks.on(name, (doc) => {
            if (sharedDoc(doc) || members().includes(doc) || members().includes(doc?.parent)) touch();
        });
    }
    Hooks.on("pf2e-artisans-workshop.status", touch);
    // M6: the clock reaching a new day changes the workshop day and pending days (9.1). It moves far more often (every
    // combat round, a calendar module's running clock), so other moves render nothing.
    const dayMoved = dayWatcher();
    Hooks.on("updateWorldTime", () => {
        if (dayMoved()) WorkshopApp.instance?.refreshDay();
    });
    Hooks.on("pf2e-artisans-workshop.announce", (text) => WorkshopApp.instance?.announce(text));
    // M7: a rest's Morning prompt and a preparation change the Morning tab and its badge (7.8).
    Hooks.on("pf2e-artisans-workshop.morningPrompt", touch);
    Hooks.on("pf2e-artisans-workshop.preparationCompleted", touch);
    // M8a: a save recorded or a stage changed moves the header's pending count (10.2).
    Hooks.on("pf2e-artisans-workshop.afflictionChanged", touch);
    // M9a: a variant turned on or off shows or hides what it adds (6.16).
    Hooks.on("pf2e-artisans-workshop.variantsChanged", touch);
    Hooks.once("setup", () => foundry.applications.handlebars.loadTemplates([...PARTIALS]));
}

/** Closed orders still listed: complete and cancelled ones stay in the Queue until archived (5.3.3). */
export const isClosed = (status) => CLOSED.includes(status);
