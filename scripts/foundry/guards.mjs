/**
 * Deletion guards (DESIGN.md 5.2): the shared documents and the ledger's pages are the module's, so deleting
 * them by hand is refused on the client that tries. Pre-hooks fire only on the client that asks for the
 * deletion and cancel it when they return false.
 *
 * - A player deleting the ledger or the strongbox is told why and stopped. (Journal deletion needs only OWNER,
 *   which players have; actor deletion needs an assistant GM, but the guard explains it either way.)
 * - A GM gets a confirmation that offers the purge (5.9) instead, or deleting just that document.
 * - Pages of the ledger (lock and archive pages) are deleted only by the module itself.
 * The module's own deletions pass `{"pf2e-artisans-workshop": {internal: true}}` in the operation options.
 * Guards prevent accidents, not determined tampering (5.10).
 */
import { MODULE_ID } from "../constants.mjs";
import { openPurge } from "./purge.mjs";
import { roleOf } from "./shared-docs.mjs";

/** M12b: the Crafting Log (5.3.3) is guarded as the ledger is. */
const SHARED_ROLES = new Set(["ledger", "strongbox", "archive"]);

/** Fresh operation options that let the module's own deletion through its guards. */
export const internal = () => ({ [MODULE_ID]: { internal: true } });
const isInternal = (options) => options?.[MODULE_ID]?.internal === true;

/** Register the guards, at `init`. */
export function registerGuards() {
    Hooks.on("preDeleteJournalEntry", (doc, options) => guardShared(doc, options));
    Hooks.on("preDeleteActor", (doc, options) => guardShared(doc, options));
    Hooks.on("preDeleteJournalEntryPage", (page, options) => guardPage(page, options));
}

/** false cancels the deletion. */
export function guardShared(doc, options) {
    if (!SHARED_ROLES.has(roleOf(doc)) || isInternal(options)) return true;
    if (!game.user.isGM) {
        ui.notifications.warn("pf2e-artisans-workshop.Guard.SharedDocument", { localize: true });
        return false;
    }
    confirmDelete(doc);
    return false;
}

/** Pages of the ledger and of the Crafting Log are module data. */
export function guardPage(page, options) {
    if (!["ledger", "archive"].includes(roleOf(page.parent)) || isInternal(options)) return true;
    ui.notifications.warn("pf2e-artisans-workshop.Guard.LedgerPage", { localize: true });
    return false;
}

/** A GM's choice: purge everything, delete only this document, or keep it. */
async function confirmDelete(doc) {
    const text = game.i18n.format("pf2e-artisans-workshop.Guard.Confirm.Content", { name: foundry.utils.escapeHTML(doc.name) });
    const content = `<p>${text}</p>`;
    const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "pf2e-artisans-workshop.Guard.Confirm.Title" },
        content,
        buttons: [
            { action: "purge", label: "pf2e-artisans-workshop.Guard.Confirm.Purge", icon: "fa-solid fa-broom", default: true },
            { action: "delete", label: "pf2e-artisans-workshop.Guard.Confirm.Delete", icon: "fa-solid fa-trash" },
            { action: "cancel", label: "COMMON.Cancel", type: "button" },
        ],
    });
    if (choice === "purge") await openPurge();
    else if (choice === "delete") await doc.delete(internal());
}
