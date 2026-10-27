/**
 * Where the combat tools open from (DESIGN.md 8, 10.4, 13, M8): the keybindings (Open Bandolier, Quick Alchemy; unbound
 * by default), the token HUD palette (`hud.mjs`), the Bandolier's own hooks (`bandolier.mjs`), the combat cards
 * (`combat-cards.mjs`), and, in the settings window, why the combat features are off while PF2e Alchemist Remaster Duct
 * Tape is active (8: "Settings shows why"). Thin and null-guarded: a settings window that changes shape only loses the note.
 */
import { MODULE_ID } from "../constants.mjs";
import { ductTapeActive } from "../foundry/combat.mjs";
import { openBandolier, registerBandolierHooks } from "./bandolier.mjs";
import { openQuickAlchemy } from "./alchemy-panel.mjs";
import { registerCombatCards } from "./combat-cards.mjs";
import { registerHudHooks } from "./hud.mjs";

const NOTE_CLASS = `${MODULE_ID}-duct-tape`;

/** Under `features.combat` in the settings window: why the combat features are off, while Duct Tape is active. */
export function noteDuctTape(html) {
    if (!ductTapeActive() || !foundry.utils.isElementInstanceOf(html, HTMLElement)) return false;
    const field = html.querySelector(`[name="${MODULE_ID}.features.combat"]`);
    const group = field?.closest?.(".form-group");
    if (!group || group.querySelector(`.${NOTE_CLASS}`)) return false;
    const note = group.ownerDocument.createElement("p");
    note.classList.add("hint", NOTE_CLASS);
    note.textContent = game.i18n.localize("pf2e-artisans-workshop.Combat.Off.DuctTape");
    group.append(note);
    return true;
}

/** Register the combat entry points, at `init`. */
export function registerCombatEntry() {
    game.keybindings?.register?.(MODULE_ID, "openBandolier", {
        name: "pf2e-artisans-workshop.Keybinding.Bandolier", editable: [],
        onDown: () => {
            openBandolier();
            return true;
        },
    });
    game.keybindings?.register?.(MODULE_ID, "quickAlchemy", {
        name: "pf2e-artisans-workshop.Keybinding.QuickAlchemy", editable: [],
        onDown: () => {
            const controlled = canvas?.tokens?.controlled ?? [];
            openQuickAlchemy({ actor: controlled.length === 1 ? controlled[0].actor : game.user.character });
            return true;
        },
    });
    Hooks.on("renderSettingsConfig", (_app, html) => noteDuctTape(html));
    registerBandolierHooks();
    registerHudHooks();
    registerCombatCards();
}
