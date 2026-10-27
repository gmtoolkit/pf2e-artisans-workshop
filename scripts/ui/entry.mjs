/**
 * Where the Workshop opens from (DESIGN.md 10.4, 11.1). M4 shipped the Actors directory's header button, the Party sheet's
 * header button and `api.ui.open`; M11 adds the rest. Every one is thin, append-only and null-guarded: it adds its own
 * element and never changes pf2e's, so a sheet that changes shape only loses the addition, and the header buttons, the
 * macros and the keybinding still open the Workshop.
 *
 * - **Character sheet header**: a "Workshop" button, through `getCharacterSheetPF2eHeaderButtons` (pf2e 8.6.1's sheets are
 *   Application V1) and `getHeaderControlsCharacterSheetPF2e` (the ApplicationV2 hook a later pf2e will fire, OQ-30). It
 *   opens the Workshop acting as that character.
 * - **Crafting tab strip**: one `section` prepended to `.tab.crafting.crafting-pane` in `renderCharacterSheetPF2e`, for a
 *   member the user owns: the character's Workshop jobs, its shelf, its pending downtime days and whether a rest left it
 *   waiting to prepare, and buttons (Workshop, Request, Morning). It holds no `li`, no `.formula-item` and no
 *   `data-item-*` or `data-action` attribute, so PF2e Toolbelt's sort buttons (prepended to the formula headers) and PF2e
 *   Workbench's rarity colouring (`.crafting-pane .formula-item`) never see it, and pf2e's own sheet listeners never bind it.
 * - **Party sheet**: the header button (M4), and a summary card in the Overview region (`renderPartySheetPF2e`). pf2e renders
 *   that region again on its own whenever a member changes (`render(false, {actors: true})`, no render hook), so a
 *   `MutationObserver` on the region puts the card back. Players for whom pf2e hides the Overview tab (`partyStats` off) get
 *   the header button only.
 * - **Actors directory**: the header button (M4), and "Open Workshop" in the context menu of the party and of each member
 *   (`getActorContextOptions`); a member's opens the Workshop acting as that character.
 * - **Keybinding**: "Open Workshop", unbound by default (the Bandolier's and Quick Alchemy's are M8's, `combat-entry.mjs`).
 *
 * The strip and the card are told again whenever the ledger or the strongbox changes, in place, without a sheet render;
 * a button of theirs that had focus has it again (M11 review, 10.9: live updates never steal focus). The sheet additions
 * follow the world setting `features.sheetEntryPoints` (14.1) and the master switch: either change renders the open sheets
 * again (M11 review). The directory's follow the master switch. A button that opens a window from these puts keyboard focus
 * in it (M11 review), as does the keybinding.
 */
import { MODULE_ID } from "../constants.mjs";
import { partyCardView, stripView } from "../logic/entry.mjs";
import { holdingsOf, valueCp } from "../logic/coins.mjs";
import { shelfItemsFor } from "../foundry/claims.mjs";
import { coinStacks } from "../foundry/coins.mjs";
import { downtimeOn, pendingOf } from "../foundry/downtime.mjs";
import { morningOn, waitingToPrepare } from "../foundry/morning.mjs";
import { actingChoices, allOrders } from "../foundry/orders.mjs";
import { members } from "../foundry/roster.mjs";
import { isEnabled, renderEntrySheets, setting } from "../foundry/settings.mjs";
import { shared, status } from "../foundry/state.mjs";
import { money, number } from "./format.mjs";
import { openWorkshop } from "./workshop.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** The directory button's class, so a re-render does not add a second one. */
const BUTTON_CLASS = "pf2e-artisans-workshop-open";
/** The Crafting tab strip's and the Party card's classes. */
export const STRIP_CLASS = "pf2e-artisans-workshop-strip";
export const CARD_CLASS = "pf2e-artisans-workshop-party-card";
/** The attribute our buttons on pf2e's sheets carry (never `data-action`, which pf2e's sheet listeners read). */
const ENTRY_ATTR = "data-pf2e-artisans-workshop-entry";

/** Whether the sheet entry points are on (14.1 `features.sheetEntryPoints`, with the master switch). */
export function sheetEntriesOn() {
    return isEnabled() && setting("features.sheetEntryPoints") !== false;
}

/** A render hook's html as an element: Application V1 passes jQuery, V2 an HTMLElement (10.4). */
export function elementOf(html) {
    const element = html?.jquery ? html[0] : html;
    return element && foundry.utils.isElementInstanceOf(element, HTMLElement) ? element : null;
}

/** An element of `doc` with classes, attributes and children (text nodes from strings). */
function make(doc, tag, { classes = [], attrs = {}, text = null } = {}, children = []) {
    const element = doc.createElement(tag);
    if (classes.length) element.classList.add(...classes);
    for (const [name, value] of Object.entries(attrs)) if (value !== null && value !== undefined) element.setAttribute(name, String(value));
    if (text !== null) element.textContent = text;
    for (const child of children.filter(Boolean)) element.append(child);
    return element;
}

/** A Font Awesome icon, hidden from assistive technology. */
function icon(doc, classes) {
    const i = make(doc, "i", { classes: classes.split(" ") });
    i.inert = true;
    i.setAttribute("aria-hidden", "true");
    return i;
}

/** A button of ours on a pf2e sheet: a real `<button type="button">` with an icon, a word and its own attribute. */
function entryButton(doc, op, iconClass, labelKey, onClick, ariaLabel = null) {
    const button = make(doc, "button", { classes: ["paw-entry-button"], attrs: { type: "button", [ENTRY_ATTR]: op, "aria-label": ariaLabel } },
        [icon(doc, iconClass), make(doc, "span", { text: loc(labelKey) })]);
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}

/* -------------------------------------------- */
/*  Header buttons                               */
/* -------------------------------------------- */

/** The header buttons of pf2e's V1 sheets (`get<Class>HeaderButtons`): ours first, so it is never folded away. */
export function addHeaderButton(sheet, buttons, { actor = null } = {}) {
    if (!sheetEntriesOn() || !Array.isArray(buttons) || buttons.some((b) => b?.class === BUTTON_CLASS)) return false;
    buttons.unshift({
        label: "pf2e-artisans-workshop.Entry.Button", class: BUTTON_CLASS, icon: "fa-solid fa-hammer",
        onclick: () => openWorkshop({ tab: "queue", actor: actor?.uuid ?? null }),
    });
    return true;
}

/** The header controls of an ApplicationV2 character sheet (OQ-30): the same button, as a control. */
export function addHeaderControl(sheet, controls) {
    if (!sheetEntriesOn() || !Array.isArray(controls) || controls.some((c) => c?.action === BUTTON_CLASS)) return false;
    controls.push({
        action: BUTTON_CLASS, icon: "fa-solid fa-hammer", label: "pf2e-artisans-workshop.Entry.Button",
        onClick: () => openWorkshop({ tab: "queue", actor: sheet?.actor?.uuid ?? sheet?.document?.uuid ?? null }),
    });
    return true;
}

/* -------------------------------------------- */
/*  Crafting tab strip                           */
/* -------------------------------------------- */

/** The strip's facts for `actor`, from the ledger and this client's view of downtime and the Morning. */
function stripFacts(actor) {
    const ready = status() === "ready";
    let pendingDays = 0;
    let morningWaiting = false;
    try {
        if (ready && downtimeOn()) pendingDays = pendingOf(actor).count ?? 0;
        if (ready && morningOn()) morningWaiting = waitingToPrepare().includes(actor);
    } catch {
        // a sheet strip is a courtesy: its counts never stop the sheet from rendering
    }
    return stripView(ready ? allOrders() : [], actor.uuid, { shelf: ready ? shelfItemsFor(actor.uuid).length : 0, pendingDays, morningWaiting });
}

/** Which of our buttons in `container` has focus (its entry attribute), or null. */
function focusedEntry(container) {
    const active = container.ownerDocument?.activeElement;
    return active && active !== container && container.contains(active) ? active.getAttribute?.(ENTRY_ATTR) ?? null : null;
}

/** Give focus back to the button of `op` in a refilled container (the first of ours if it is gone), without scrolling. */
function refocusEntry(container, op) {
    if (!op) return;
    const button = container.querySelector(`[${ENTRY_ATTR}="${op}"]`) ?? container.querySelector(`[${ENTRY_ATTR}]`);
    button?.focus({ preventScroll: true });
}

/** Fill a strip element (new or live) for `actor`. */
function fillStrip(strip, actor) {
    const doc = strip.ownerDocument;
    const view = stripFacts(actor);
    const facts = [];
    const fact = (iconClass, text, extra = []) => facts.push(make(doc, "li", { classes: ["strip-fact", ...extra] }, [icon(doc, iconClass), make(doc, "span", { text })]));
    if (view.crafting) fact("fa-solid fa-hammer", fmt("pf2e-artisans-workshop.Entry.Strip.Crafting", { n: number(view.crafting) }));
    if (view.due) fact("fa-solid fa-dice-d20", fmt("pf2e-artisans-workshop.Entry.Strip.Due", { n: number(view.due) }), ["waiting"]);
    if (view.forYou) fact("fa-solid fa-gift", fmt("pf2e-artisans-workshop.Entry.Strip.ForYou", { n: number(view.forYou) }));
    if (view.shelf) fact("fa-solid fa-box-open", fmt("pf2e-artisans-workshop.Entry.Strip.Shelf", { n: number(view.shelf) }), ["waiting"]);
    if (view.pendingDays) fact("fa-solid fa-calendar-days", fmt("pf2e-artisans-workshop.Entry.Strip.Days", { n: number(view.pendingDays) }), ["waiting"]);
    if (view.morningWaiting) fact("fa-solid fa-sun", loc("pf2e-artisans-workshop.Entry.Strip.Morning"), ["waiting"]);
    if (view.empty) fact("fa-solid fa-mug-hot", loc("pf2e-artisans-workshop.Entry.Strip.Nothing"));
    const heading = make(doc, "h3", { classes: ["strip-heading"], attrs: { id: `${strip.id}-heading` } }, [icon(doc, "fa-solid fa-hammer"),
        make(doc, "span", { text: loc("pf2e-artisans-workshop.Entry.Strip.Heading") })]);
    const actions = make(doc, "div", { classes: ["strip-actions"] }, [
        entryButton(doc, "open", "fa-solid fa-up-right-from-square", "pf2e-artisans-workshop.Entry.Button",
            () => openWorkshop({ tab: "queue", actor: actor.uuid, focus: true }), fmt("pf2e-artisans-workshop.Entry.OpenAs", { name: actor.name })),
        entryButton(doc, "request", "fa-solid fa-plus", "pf2e-artisans-workshop.Queue.Request", async () => {
            const { openRequestForm } = await import("./request.mjs");
            openRequestForm({ requester: actor.uuid });
        }),
        morningOn() ? entryButton(doc, "morning", "fa-solid fa-sun", "pf2e-artisans-workshop.Window.Tab.Morning",
            () => openWorkshop({ tab: "morning", actor: actor.uuid, focus: true })) : null,
    ]);
    const focused = focusedEntry(strip);
    strip.replaceChildren(heading, make(doc, "ul", { classes: ["strip-facts"], attrs: { "aria-label": loc("pf2e-artisans-workshop.Entry.Strip.Heading") } }, facts), actions);
    refocusEntry(strip, focused);
    return strip;
}

/**
 * The Crafting tab strip (10.4): prepended to the tab, once, for a Workshop member the user owns. Returns the strip, or
 * null when nothing was added (off, not a member, not the owner, or no Crafting tab: the header button stays).
 */
export function addCraftingStrip(sheet, html) {
    const actor = sheet?.actor;
    const root = elementOf(html);
    if (!sheetEntriesOn() || !root || actor?.type !== "character" || !actor.isOwner || !members().includes(actor)) return null;
    const pane = root.querySelector(".tab.crafting.crafting-pane") ?? root.querySelector(".tab[data-tab='crafting']");
    if (!pane) return null;
    pane.querySelector(`:scope > .${STRIP_CLASS}`)?.remove();
    const strip = make(pane.ownerDocument, "section", { classes: [STRIP_CLASS, "pf2e-artisans-workshop-entry"],
        attrs: { id: `${MODULE_ID}-strip-${actor.id}`, "aria-labelledby": `${MODULE_ID}-strip-${actor.id}-heading` } });
    fillStrip(strip, actor);
    pane.prepend(strip);
    track(strip, () => fillStrip(strip, actor));
    return strip;
}

/* -------------------------------------------- */
/*  Party sheet card                             */
/* -------------------------------------------- */

/** Fill the Party sheet's card (new or live). */
function fillCard(card) {
    const doc = card.ownerDocument;
    const ready = status() === "ready";
    const shelf = ready ? actingChoices().flatMap((a) => shelfItemsFor(a.uuid)).length : 0;
    const view = partyCardView(ready ? allOrders() : [], { shelf });
    const strongbox = ready ? shared().strongbox : null;
    const pairs = [
        ["pf2e-artisans-workshop.Entry.Card.Open", number(view.open)],
        ["pf2e-artisans-workshop.Entry.Card.Unclaimed", number(view.unclaimed)],
        ["pf2e-artisans-workshop.Entry.Card.Working", number(view.working)],
        ["pf2e-artisans-workshop.Entry.Card.Complete", number(view.complete)],
        ["pf2e-artisans-workshop.Entry.Card.Shelf", number(view.shelf)],
        strongbox ? ["pf2e-artisans-workshop.Window.Strongbox", money(valueCp(holdingsOf(coinStacks(strongbox))))] : null,
    ].filter(Boolean);
    const facts = make(doc, "dl", { classes: ["card-facts"] }, pairs.flatMap(([key, value]) => [make(doc, "dt", { text: loc(key) }), make(doc, "dd", { text: value })]));
    const header = make(doc, "header", { classes: ["card-heading"] }, [
        icon(doc, "fa-solid fa-hammer"),
        make(doc, "h3", { attrs: { id: `${MODULE_ID}-party-card-heading` }, text: loc("pf2e-artisans-workshop.Window.Title") }),
        entryButton(doc, "open", "fa-solid fa-up-right-from-square", "pf2e-artisans-workshop.Entry.Button", () => openWorkshop({ tab: "queue", focus: true }),
            loc("pf2e-artisans-workshop.Entry.Tooltip")),
    ]);
    const body = ready ? facts : make(doc, "p", { classes: ["hint"], text: loc("pf2e-artisans-workshop.Window.Banner.Disabled") });
    const focused = focusedEntry(card);
    card.replaceChildren(header, body);
    refocusEntry(card, focused);
    return card;
}

/** Put the card into the Overview region, after pf2e's summary (or first), unless it is there. */
function placeCard(region) {
    if (!region?.isConnected || region.querySelector(`.${CARD_CLASS}`)) return null;
    const content = region.querySelector(":scope > .content") ?? region;
    const card = make(region.ownerDocument, "section", { classes: [CARD_CLASS, "pf2e-artisans-workshop-entry"],
        attrs: { "aria-labelledby": `${MODULE_ID}-party-card-heading` } });
    fillCard(card);
    const summary = content.querySelector(":scope > section.summary");
    if (summary) summary.after(card);
    else content.prepend(card);
    track(card, () => fillCard(card));
    return card;
}

/** Overview regions this client watches, so a region is observed once however often the sheet renders. */
const watched = new WeakSet();

/**
 * The Party sheet's summary card (10.4), in the Overview region. pf2e replaces the region's content without a render hook
 * when a member changes; the region's observer puts the card back.
 */
export function addPartyCard(sheet, html) {
    const root = elementOf(html);
    if (!sheetEntriesOn() || !root || sheet?.actor?.type !== "party") return null;
    const region = root.querySelector("[data-region='overview']");
    if (!region) return null;
    const card = placeCard(region);
    if (!watched.has(region) && typeof MutationObserver === "function") {
        watched.add(region);
        new MutationObserver(() => placeCard(region)).observe(region, { childList: true });
    }
    return card ?? region.querySelector(`.${CARD_CLASS}`);
}

/* -------------------------------------------- */
/*  Keeping the strip and the card current       */
/* -------------------------------------------- */

/** The strips and cards on open sheets, filled again in place when the Workshop's state changes. */
const live = new Set();

/** Keep an element current; those of sheets that rendered again or closed are let go first. */
function track(element, refill) {
    for (const entry of [...live]) if (!entry.element.isConnected) live.delete(entry);
    live.add({ element, refill });
}

/** Fill every live strip and card again; forget those whose sheet is gone. */
export function refreshEntries() {
    for (const entry of [...live]) {
        if (!entry.element.isConnected) {
            live.delete(entry);
            continue;
        }
        try {
            entry.refill();
        } catch (error) {
            console.warn(`${MODULE_ID} | could not refresh a sheet entry`, error);
        }
    }
}

const refreshSoon = foundry.utils.debounce(refreshEntries, 250);

/* -------------------------------------------- */
/*  Actors directory                             */
/* -------------------------------------------- */

/** The actor a directory entry stands for. */
const actorOfEntry = (li) => game.actors.get(li?.closest?.("[data-entry-id]")?.dataset.entryId ?? "") ?? null;

/** "Open Workshop" in the Actors directory's context menu (10.4): on the party, and as a member the user owns. */
export function addContextOption(_app, options) {
    if (!Array.isArray(options) || options.some((o) => o?.label === "pf2e-artisans-workshop.Entry.ContextOpen")) return false;
    options.push({
        label: "pf2e-artisans-workshop.Entry.ContextOpen", icon: "fa-solid fa-hammer",
        visible: (li) => {
            if (!isEnabled()) return false;
            const actor = actorOfEntry(li);
            return !!actor && (actor.type === "party" || (actor.isOwner && members().includes(actor)));
        },
        onClick: (_event, li) => {
            const actor = actorOfEntry(li);
            return openWorkshop({ tab: "queue", actor: actor && actor.type !== "party" ? actor.uuid : null, focus: true });
        },
    });
    return true;
}

/** Add the button to the Actors directory's header actions, once. */
export function addDirectoryButton(html) {
    if (!isEnabled() || !foundry.utils.isElementInstanceOf(html, HTMLElement)) return;
    const actions = html.querySelector(".directory-header .header-actions");
    if (!actions || actions.querySelector(`.${BUTTON_CLASS}`)) return;
    const button = actions.ownerDocument.createElement("button");
    button.type = "button";
    button.classList.add(BUTTON_CLASS);
    const glyph = actions.ownerDocument.createElement("i");
    glyph.className = "fa-solid fa-hammer";
    glyph.inert = true;
    const label = actions.ownerDocument.createElement("span");
    label.textContent = game.i18n.localize("pf2e-artisans-workshop.Entry.Button");
    button.append(glyph, label);
    button.dataset.tooltip = game.i18n.localize("pf2e-artisans-workshop.Entry.Tooltip");
    button.addEventListener("click", () => openWorkshop({ tab: "queue" }));
    actions.append(button);
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

/** Run a sheet addition; an error is logged, never thrown into pf2e's render (10.4: null-guarded). */
function guarded(name, fn) {
    return (...args) => {
        try {
            fn(...args);
        } catch (error) {
            console.warn(`${MODULE_ID} | ${name} not added`, error);
        }
    };
}

/** Register the entry points, at `init`. */
export function registerEntryPoints() {
    Hooks.on("renderActorDirectory", (_app, html) => addDirectoryButton(html));
    // The button shows only while the Workshop is switched on, so the directory follows the master switch; so do the open
    // character and party sheets' header buttons, strips and cards (M11 review, 10.18), which their render adds or leaves out.
    let last = null;
    Hooks.on("pf2e-artisans-workshop.status", (now) => {
        const on = now !== "disabled";
        if (on !== last && last !== null) {
            ui.actors?.render();
            renderEntrySheets();
        }
        last = on;
        refreshSoon();
    });
    Hooks.on("getPartySheetPF2eHeaderButtons", guarded("party header button", (sheet, buttons) => addHeaderButton(sheet, buttons)));
    Hooks.on("getCharacterSheetPF2eHeaderButtons", guarded("character header button", (sheet, buttons) => addHeaderButton(sheet, buttons, { actor: sheet?.actor })));
    Hooks.on("getHeaderControlsCharacterSheetPF2e", guarded("character header control", addHeaderControl));
    Hooks.on("renderCharacterSheetPF2e", guarded("crafting strip", addCraftingStrip));
    Hooks.on("renderPartySheetPF2e", guarded("party card", addPartyCard));
    Hooks.on("getActorContextOptions", guarded("context option", addContextOption));
    // The strip and the card follow the ledger, the strongbox and the members' items (the shelf, a delivery).
    const sharedDoc = (doc) => {
        const { ledger, strongbox } = shared();
        return doc === ledger || doc === strongbox || doc?.parent === strongbox || doc?.parent === ledger;
    };
    for (const name of ["updateJournalEntry", "createItem", "updateItem", "deleteItem"]) {
        Hooks.on(name, (doc) => {
            if (live.size && sharedDoc(doc)) refreshSoon();
        });
    }
    Hooks.on("updateWorldTime", () => {
        if (live.size) refreshSoon();
    });
    Hooks.on("pf2e-artisans-workshop.morningPrompt", () => live.size && refreshSoon());
    Hooks.on("pf2e-artisans-workshop.preparationCompleted", () => live.size && refreshSoon());
    game.keybindings?.register?.(MODULE_ID, "openWorkshop", {
        name: "pf2e-artisans-workshop.Keybinding.Workshop", hint: "pf2e-artisans-workshop.Keybinding.WorkshopHint", editable: [],
        onDown: () => {
            if (!isEnabled()) return false;
            // Focus goes into the window (M11 review): a keyboard user lands on its active tab, not where they were.
            openWorkshop({ focus: true });
            return true;
        },
    });
}
