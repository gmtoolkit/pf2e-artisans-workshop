/**
 * The token HUD palette (DESIGN.md 8.2, 13, OQ-33, M8): one `control-icon` button (a flask) in the token HUD's left
 * column with a `.palette[data-palette="pf2e-artisans-workshop-alchemy"]` beside it, which core's own `togglePalette`
 * action opens and closes. Shown only to an owner of an actor with pf2e's Quick Alchemy, while the combat features run.
 * It is the fallback when the Bandolier is closed: Quick Alchemy (the panel), a quick vial, Healing Bomb, the Bandolier,
 * and a Strike with each ready bomb (pf2e's own Strike).
 *
 * Null-guarded and tolerant of other HUDs (PF2e HUD, Token Action HUD): nothing happens when the hook's element is not an
 * element, has no left column (another module replaced the HUD), or already has the button (a second render). The
 * palette's entries are links with `data-pf2e-artisans-workshop-hud`, wired here, never `data-action` (the HUD's form
 * would look for a handler), and the palette holds no input, so the HUD's submit-on-change never sees it.
 */
import { MODULE_ID } from "../constants.mjs";
import { healingBomb, quickAbilityOf, quickVial, readyFacts } from "../foundry/alchemy.mjs";
import { combatOn, strikeWith } from "../foundry/combat.mjs";
import { report } from "./format.mjs";

/** The palette's id (`data-palette`), which core's `togglePalette` reads. */
export const PALETTE = `${MODULE_ID}-alchemy`;
const BUTTON_CLASS = `${MODULE_ID}-hud`;

/** The actor a token HUD is bound to, or null. */
function hudActor(app) {
    return app?.actor ?? app?.document?.actor ?? app?.object?.actor ?? null;
}

/** An element of `doc` with classes, data attributes and text. */
function element(doc, tag, { classes = [], data = {}, text = null, attrs = {} } = {}) {
    const el = doc.createElement(tag);
    if (classes.length) el.classList.add(...classes);
    for (const [key, value] of Object.entries(data)) el.dataset[key] = value;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== null) el.textContent = text;
    return el;
}

/** One palette entry: an icon and a label, with its op. */
function entry(doc, op, icon, label, data = {}) {
    const link = element(doc, "a", { classes: ["palette-list-entry"], data: { pf2eArtisansWorkshopHud: op, ...data }, attrs: { role: "button", tabindex: "0" } });
    const span = element(doc, "span");
    const i = element(doc, "i", { classes: [...icon.split(" "), "fa-fw"] });
    i.inert = true;
    span.append(i, doc.createTextNode(` ${label}`));
    link.append(span);
    return link;
}

/**
 * Add the palette to a rendered token HUD (`renderTokenHUD`, an HTMLElement in v14), at once: core's `_postRender` runs
 * right after the hook and reopens the palette that was open, ours included, so the palette must already be there.
 * Returns whether it was added.
 * @param {object} app    the TokenHUD
 * @param {HTMLElement} html
 */
export function injectPalette(app, html) {
    if (!foundry.utils.isElementInstanceOf(html, HTMLElement)) return false;
    const column = html.querySelector(".col.left");
    if (!column || column.querySelector(`.${BUTTON_CLASS}`)) return false;
    const actor = hudActor(app);
    if (!combatOn() || !actor?.isOwner || !quickAbilityOf(actor)) {
        keepPaletteSafe(app, column);
        return false;
    }
    const doc = html.ownerDocument;
    const facts = readyFacts(actor);
    const label = game.i18n.localize("pf2e-artisans-workshop.Hud.Button");
    const button = element(doc, "button", { classes: ["control-icon", BUTTON_CLASS], data: { action: "togglePalette", palette: PALETTE, tooltip: "" },
        attrs: { type: "button", "aria-label": label } });
    const icon = element(doc, "i", { classes: ["fa-solid", "fa-flask"] });
    icon.inert = true;
    button.append(icon);
    const palette = element(doc, "div", { classes: ["palette", "palette-list", `${MODULE_ID}-palette`], data: { palette: PALETTE } });
    const vials = facts.vials?.value ?? 0;
    if (vials > 0) palette.append(entry(doc, "quick-alchemy", "fa-solid fa-mortar-pestle", game.i18n.localize("pf2e-artisans-workshop.Bandolier.QuickAlchemy")));
    if (facts.vials?.item) palette.append(entry(doc, "quick-vial", "fa-solid fa-flask-vial", game.i18n.localize("pf2e-artisans-workshop.Bandolier.QuickVial")));
    if (facts.features.healingBomb && vials > 0) palette.append(entry(doc, "healing-bomb", "fa-solid fa-heart-pulse", game.i18n.localize("pf2e-artisans-workshop.Bandolier.HealingBomb")));
    for (const bomb of facts.ready.filter((r) => r.bomb && !r.healingBomb)) {
        palette.append(entry(doc, "strike", "fa-solid fa-bomb", game.i18n.format("pf2e-artisans-workshop.Hud.Strike", { item: bomb.name }), { item: bomb.id }));
    }
    palette.append(entry(doc, "bandolier", "fa-solid fa-flask-vial", game.i18n.localize("pf2e-artisans-workshop.Hud.Bandolier")));
    palette.addEventListener("click", (event) => onEntry(actor, event));
    palette.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") onEntry(actor, event);
    });
    column.append(button, palette);
    return true;
}

/**
 * Core reopens the palette that was open when the HUD renders again (`_postRender`) and does not check that its elements
 * are still there: when ours was open and the palette is no longer offered (the combat features were turned off), an
 * empty, hidden pair stands in for it so core's toggle finds what it looks for.
 */
function keepPaletteSafe(app, column) {
    if (app?.activePalette !== PALETTE) return;
    const doc = column.ownerDocument;
    const button = element(doc, "button", { classes: ["control-icon", BUTTON_CLASS], data: { palette: PALETTE }, attrs: { type: "button", hidden: "" } });
    const palette = element(doc, "div", { classes: ["palette", `${MODULE_ID}-palette`], data: { palette: PALETTE }, attrs: { hidden: "" } });
    column.append(button, palette);
}

/** A palette entry was used. */
async function onEntry(actor, event) {
    const link = event.target?.closest?.("[data-pf2e-artisans-workshop-hud]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const op = link.dataset.pf2eArtisansWorkshopHud;
    if (op === "quick-alchemy") {
        const { openQuickAlchemy } = await import("./alchemy-panel.mjs");
        return openQuickAlchemy({ actor });
    }
    if (op === "bandolier") {
        const { openBandolier } = await import("./bandolier.mjs");
        return openBandolier({ actor });
    }
    if (op === "quick-vial") return report(await quickVial(actor));
    if (op === "healing-bomb") return report(await healingBomb(actor));
    if (op === "strike") {
        const item = actor.items.get(link.dataset.item);
        return item ? report(await strikeWith(actor, item, { event })) : null;
    }
    return null;
}

/** Hooks at `init`: the palette on every token HUD render. */
export function registerHudHooks() {
    Hooks.on("renderTokenHUD", (app, html) => {
        try {
            injectPalette(app, html);
        } catch (error) {
            console.warn(`${MODULE_ID} | could not add the alchemy palette`, error);
        }
    });
}
