/**
 * Theming of the module's windows (DESIGN.md 10.9, M11). The windows follow Foundry's application colour scheme by
 * default: core puts `theme-dark` or `theme-light` on `body`, and the stylesheet's `--paw-*` tokens follow it. The client
 * setting "Parchment" (`ui.parchment`, 14.3) gives them the pf2e character sheet's look in either scheme: core's own
 * `themed theme-light` classes (so Foundry's light colours apply inside the window whatever the scheme) and the module's
 * `paw-parchment`, which lays pf2e's sheet background under it.
 *
 * The window's size is remembered per client (`ui.windowSize`, 14.3): a resize is saved, debounced, and the next window
 * opens at that size, clamped to the screen it opens on.
 */
import { MODULE_ID } from "../constants.mjs";

/** Whether the Parchment setting is on (false before the setting is registered, as in a test without it). */
export function parchmentOn() {
    try {
        return game.settings.get(MODULE_ID, "ui.parchment") === true;
    } catch {
        return false;
    }
}

/** The classes a module window adds for its theme: Parchment's, or none (the application scheme applies). */
export const themeClasses = () => (parchmentOn() ? ["themed", "theme-light", "paw-parchment"] : []);

/** Whole pixels between `low` and `high`. */
const clamp = (value, low, high) => Math.round(Math.min(Math.max(value, low), high));

/**
 * The size to open at (10.8): the remembered one when there is one, else `fallback`; never wider or taller than the view
 * allows, nor smaller than the narrow tier's minimum.
 *
 * @param {{width?: number, height?: number}|null} saved
 * @param {{width: number, height: number}} fallback
 * @param {{width: number, height: number}} view   the browser window's inner size
 */
export function openingSize(saved, fallback, view) {
    const ok = (n) => Number.isFinite(n) && n > 0;
    const width = ok(saved?.width) ? saved.width : fallback.width;
    const height = ok(saved?.height) ? saved.height : fallback.height;
    return {
        width: clamp(width, Math.min(480, view.width), Math.max(480, view.width - 20)),
        height: clamp(height, Math.min(400, view.height), Math.max(400, view.height - 20)),
    };
}

/** The remembered size, or null. */
export function savedSize() {
    try {
        const value = game.settings.get(MODULE_ID, "ui.windowSize");
        return value && Number.isFinite(value.width) && Number.isFinite(value.height) ? value : null;
    } catch {
        return null;
    }
}

/**
 * Remember a window's size when it changes (`_onPosition`); only whole sizes, and only a change, so a drag that moves the
 * window writes nothing.
 */
export function rememberSize(position) {
    const width = Math.round(position?.width);
    const height = Math.round(position?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    const saved = savedSize();
    if (saved && saved.width === width && saved.height === height) return false;
    game.settings.set(MODULE_ID, "ui.windowSize", { width, height });
    return true;
}

/** The classes Parchment puts on a window. */
const PARCHMENT = Object.freeze(["themed", "theme-light", "paw-parchment"]);

/**
 * The Parchment setting changed (`onChange`, this client only): every open window of the module takes or drops its classes
 * at once, so nothing needs to be closed and opened again.
 */
export function applyParchment(on = parchmentOn()) {
    const apps = foundry.applications?.instances?.values?.() ?? [];
    for (const app of apps) {
        const element = app?.element;
        if (!element?.classList?.contains("pf2e-artisans-workshop")) continue;
        for (const name of PARCHMENT) element.classList.toggle(name, on);
    }
}
