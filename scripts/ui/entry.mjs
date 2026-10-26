/**
 * Where the Workshop opens from (DESIGN.md 10.4, 11.1), the minimal set M4 ships; M11 adds the rest. Thin,
 * append-only and null-guarded, so a sheet that changes shape only loses its button:
 *
 * - a "Workshop" button in the Actors directory's header, for everyone (Foundry's own ApplicationV2 sidebar, which
 *   pf2e 8.6.1 extends without changing the header);
 * - a "Workshop" button in the header of the pf2e Party sheet (Application V1 in pf2e 8.6.1, hence its
 *   `get<Class>HeaderButtons` hook);
 * - `game.modules.get("pf2e-artisans-workshop").api.ui.open()`, for macros and the console.
 */
import { isEnabled } from "../foundry/settings.mjs";
import { openWorkshop } from "./workshop.mjs";

/** The directory button's class, so a re-render does not add a second one. */
const BUTTON_CLASS = "pf2e-artisans-workshop-open";

/** Register the entry points, at `init`. */
export function registerEntryPoints() {
    Hooks.on("renderActorDirectory", (_app, html) => addDirectoryButton(html));
    // The button shows only while the Workshop is switched on, so the directory follows the master switch.
    let last = null;
    Hooks.on("pf2e-artisans-workshop.status", (now) => {
        const on = now !== "disabled";
        if (on !== last && last !== null) ui.actors?.render();
        last = on;
    });
    Hooks.on("getPartySheetPF2eHeaderButtons", (sheet, buttons) => {
        if (!isEnabled() || !Array.isArray(buttons)) return;
        buttons.unshift({
            label: "pf2e-artisans-workshop.Entry.Button", class: BUTTON_CLASS, icon: "fa-solid fa-hammer",
            onclick: () => openWorkshop({ tab: "queue" }),
        });
    });
}

/** Add the button to the Actors directory's header actions, once. */
export function addDirectoryButton(html) {
    if (!isEnabled() || !foundry.utils.isElementInstanceOf(html, HTMLElement)) return;
    const actions = html.querySelector(".directory-header .header-actions");
    if (!actions || actions.querySelector(`.${BUTTON_CLASS}`)) return;
    const button = actions.ownerDocument.createElement("button");
    button.type = "button";
    button.classList.add(BUTTON_CLASS);
    const icon = actions.ownerDocument.createElement("i");
    icon.className = "fa-solid fa-hammer";
    icon.inert = true;
    const label = actions.ownerDocument.createElement("span");
    label.textContent = game.i18n.localize("pf2e-artisans-workshop.Entry.Button");
    button.append(icon, label);
    button.dataset.tooltip = game.i18n.localize("pf2e-artisans-workshop.Entry.Tooltip");
    button.addEventListener("click", () => openWorkshop({ tab: "queue" }));
    actions.append(button);
}
