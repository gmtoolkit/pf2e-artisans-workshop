/**
 * Small dialogs the Workshop asks with (DESIGN.md 10): an amount of money from one of the user's characters (a pledge,
 * a deposit, a withdrawal), and a confirmation. DialogV2, with their content rendered from a template, so every word is
 * a key in `lang/en.json`. Asked from a window (`app`), a dialog opens in the browser window that window is in, so a
 * detached Workshop asks in its own window (10.1).
 */
import { money, parseMoney } from "./format.mjs";

/** Core's DialogV2, read when asked, so this file loads without Foundry (tests). */
const dialogs = () => foundry.applications.api.DialogV2;

/** Render options that put a dialog in the browser window `app` is in (a detached one), or none. */
export const inWindowOf = (app) => (app?.window?.windowId ? { window: { windowId: app.window.windowId } } : {});

const TEMPLATE = "modules/pf2e-artisans-workshop/templates/prompts/amount.hbs";

/** Titles and buttons by kind of amount. */
const KINDS = Object.freeze({
    pledge: { title: "pf2e-artisans-workshop.Prompt.Pledge.Title", button: "pf2e-artisans-workshop.Prompt.Pledge.Button", icon: "fa-solid fa-coins" },
    deposit: { title: "pf2e-artisans-workshop.Prompt.Deposit.Title", button: "pf2e-artisans-workshop.Prompt.Deposit.Button", icon: "fa-solid fa-piggy-bank" },
    withdraw: { title: "pf2e-artisans-workshop.Prompt.Withdraw.Title", button: "pf2e-artisans-workshop.Prompt.Withdraw.Button", icon: "fa-solid fa-hand-holding-dollar" },
});

/**
 * Ask for an amount and the character it comes from (or goes to).
 * @param {{kind: "pledge"|"deposit"|"withdraw", actors: Actor[], maxCp?: number|null, actor?: string|null, app?: object|null}} p
 *        `app`: the window that asks
 * @returns {Promise<{actor: string, cp: number}|null>}
 */
export async function askAmount({ kind, actors, maxCp = null, actor = null, app = null }) {
    const config = KINDS[kind];
    if (!actors.length) {
        ui.notifications.warn("pf2e-artisans-workshop.Refusal.NoCharacter", { localize: true });
        return null;
    }
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
        actors: actors.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === actor })),
        single: actors.length === 1, max: maxCp === null ? null : money(maxCp),
    });
    const answer = await dialogs().prompt({
        window: { title: config.title, icon: config.icon },
        content,
        ok: {
            label: config.button, icon: config.icon,
            callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
        },
        rejectClose: false,
        renderOptions: inWindowOf(app),
    });
    if (!answer) return null;
    const cp = parseMoney(answer.amount);
    if (!(cp > 0) || (maxCp !== null && cp > maxCp)) {
        ui.notifications.warn("pf2e-artisans-workshop.Prompt.BadAmount", { format: { max: maxCp === null ? "" : money(maxCp) } });
        return null;
    }
    return { actor: answer.actor ?? actors[0].uuid, cp };
}

/** One localized paragraph of dialog content. */
const paragraph = (key) => ["<p>", foundry.utils.escapeHTML(game.i18n.localize(key)), "</p>"].join("");

/** Ask the user to confirm an action that cannot be undone, in the browser window `app` (the window that asks) is in. */
export function confirm({ title, content, app = null }) {
    return dialogs().confirm({ window: { title }, content: paragraph(content), rejectClose: false, renderOptions: inWindowOf(app) });
}

const CHOOSE = "modules/pf2e-artisans-workshop/templates/prompts/choose.hbs";

/**
 * Ask for a choice (M5: the spell a caster pledges, the stock to hand over, a spell to buy a casting of), with an optional
 * number and text: `options` are `{value, name}` (names from documents), the labels i18n keys.
 * @returns {Promise<{value?: string, number?: number, text?: string}|null>}
 */
export async function askChoice({ title, label = null, options = null, number = null, text = null, hint = null, button, icon = "fa-solid fa-check", app = null }) {
    if (options && !options.length) {
        ui.notifications.warn("pf2e-artisans-workshop.Prompt.NothingToChoose", { localize: true });
        return null;
    }
    const content = await foundry.applications.handlebars.renderTemplate(CHOOSE, { label, options, number, text, hint });
    const answer = await dialogs().prompt({
        window: { title, icon }, content,
        ok: { label: button, icon, callback: (_event, target) => new foundry.applications.ux.FormDataExtended(target.form).object },
        rejectClose: false, renderOptions: inWindowOf(app),
    });
    if (!answer) return null;
    return { value: answer.value ?? null, number: answer.number === undefined ? null : Number(answer.number), text: answer.text ?? null };
}
