/**
 * Small dialogs the Workshop asks with (DESIGN.md 10): an amount of money and, where it applies, where it comes from or
 * which character it goes to; and a confirmation. DialogV2, with their content rendered from a template, so every word is
 * a key in `lang/en.json`. Asked from a window (`app`), a dialog opens in the browser window that window is in, so a
 * detached Workshop asks in its own window (10.1).
 *
 * Money is always typed as four whole-number fields, pp, gp, sp and cp (B, As built in M4.1): a single number was read as
 * copper, and "18" meant 18 cp to a player who meant 18 gp. "Fill the shortfall" fills them with what the order still
 * needs; the confirm button stays disabled, with the reason beside it, while the amount cannot be used.
 */
import { DENOMINATIONS } from "../data/coins.mjs";
import { checkAmount, coinFields, fieldsToCp } from "../logic/funds.mjs";
import { money } from "./format.mjs";

/** Core's DialogV2, read when asked, so this file loads without Foundry (tests). */
const dialogs = () => foundry.applications.api.DialogV2;

/** Render options that put a dialog in the browser window `app` is in (a detached one), or none. */
export const inWindowOf = (app) => (app?.window?.windowId ? { window: { windowId: app.window.windowId } } : {});

const TEMPLATE = "modules/pf2e-artisans-workshop/templates/prompts/amount.hbs";

/** Titles and buttons by kind of amount. */
const KINDS = Object.freeze({
    fund: { title: "pf2e-artisans-workshop.Prompt.Fund.Title", button: "pf2e-artisans-workshop.Prompt.Fund.Button", icon: "fa-solid fa-coins" },
    finish: { title: "pf2e-artisans-workshop.Prompt.Finish.Title", button: "pf2e-artisans-workshop.Prompt.Finish.Button", icon: "fa-solid fa-flag-checkered" },
    retry: { title: "pf2e-artisans-workshop.Prompt.Retry.Title", button: "pf2e-artisans-workshop.Prompt.Retry.Button", icon: "fa-solid fa-rotate-right" },
    deposit: { title: "pf2e-artisans-workshop.Prompt.Deposit.Title", button: "pf2e-artisans-workshop.Prompt.Deposit.Button", icon: "fa-solid fa-piggy-bank" },
    withdraw: { title: "pf2e-artisans-workshop.Prompt.Withdraw.Title", button: "pf2e-artisans-workshop.Prompt.Withdraw.Button", icon: "fa-solid fa-hand-holding-dollar" },
    return: { title: "pf2e-artisans-workshop.Prompt.Return.Title", button: "pf2e-artisans-workshop.Prompt.Return.Button", icon: "fa-solid fa-rotate-left" },
});

/** Why an amount cannot be used, as the hint beside the confirm button (`checkAmount` reasons). */
const PROBLEM = Object.freeze({
    "bad-number": "pf2e-artisans-workshop.Prompt.Problem.BadNumber",
    nothing: "pf2e-artisans-workshop.Prompt.Problem.Nothing",
    "too-much": "pf2e-artisans-workshop.Prompt.Problem.TooMuch",
    "too-little": "pf2e-artisans-workshop.Prompt.Problem.TooLittle",
});

/**
 * The hint for an amount's problem, or "" when it can be used. `fundCp` is what the party fund holds unallocated while it
 * is the source chosen: an amount it cannot cover then says so and points at a purse, instead of a bare "At most X" and
 * "At least Y" that leave the user going back and forth between the two (review fix of M4.1).
 */
export function problemText(check, fundCp = null) {
    if (check.ok) return "";
    const amounts = { max: money(check.maxCp ?? fundCp ?? 0), min: money(check.minCp ?? 0) };
    if (fundCp !== null && check.reason === "too-much") return game.i18n.format("pf2e-artisans-workshop.Prompt.Problem.FundShort", amounts);
    if (fundCp !== null && check.reason === "too-little" && fundCp < check.minCp) {
        return game.i18n.format("pf2e-artisans-workshop.Prompt.Problem.FundShortNeed", { ...amounts, max: money(fundCp) });
    }
    return game.i18n.format(PROBLEM[check.reason] ?? PROBLEM.nothing, amounts);
}

/**
 * The source a money prompt starts on: the party fund while it can cover what is needed (the money the party set aside is
 * what an order should use), else a character's purse when there is one, else the fund for what it has.
 * @param {{fundCp: number, needCp: number, hasPurse: boolean}} p
 */
export function firstSource({ fundCp, needCp, hasPurse }) {
    if (fundCp > 0 && fundCp >= needCp) return "fund";
    return hasPurse || !(fundCp > 0) ? "purse" : "fund";
}

/** The four fields' values in a form, by denomination. */
const fieldsOf = (form) => Object.fromEntries(DENOMINATIONS.map((d) => [d, form.elements.namedItem(d)?.value ?? ""]));

/** The source chosen in a form ("fund" or "purse"), or null when the dialog offers none. */
const sourceOf = (form) => form.querySelector("input[name='source']:checked")?.value ?? null;

/**
 * Ask for an amount of money, and where it comes from (B and A, As built in M4.1).
 *
 * @param {object} p
 * @param {"fund"|"finish"|"retry"|"deposit"|"withdraw"|"return"} p.kind
 * @param {Actor[]} [p.actors]   characters the coins may come from (or go to); a purse source needs one
 * @param {string|null} [p.actor]  the character chosen first
 * @param {number|null} [p.maxCp]  the most that may be entered (for a purse source; the party fund's is `sources.fundCp`)
 * @param {number|null} [p.minCp]  the least (a finish's shortfall)
 * @param {{cp: number, key: string}|null} [p.fill]  "Fill the shortfall": the amount, and the button's key
 * @param {boolean} [p.prefill]  start with the fill amount in the fields
 * @param {{fundCp: number}|null} [p.sources]  offer the party fund (holding `fundCp` unallocated) or a purse
 * @param {string|null} [p.intro]  a sentence above the fields, already localized
 * @param {object|null} [p.app]    the window that asks
 * @returns {Promise<{cp: number, actor: string|null, source: "fund"|"purse"|null}|null>}
 */
export async function askMoney({ kind, actors = [], actor = null, maxCp = null, minCp = null, fill = null, prefill = false,
    sources = null, intro = null, app = null }) {
    const config = KINDS[kind];
    const fundOk = !!sources && sources.fundCp > 0;
    // Giving a share back to the party fund names no character; every other amount comes from or goes to one.
    if (kind !== "return" && !actors.length && !fundOk) {
        ui.notifications.warn("pf2e-artisans-workshop.Refusal.NoCharacter", { localize: true });
        return null;
    }
    const start = prefill && fill?.cp > 0 ? coinFields(fill.cp) : null;
    const needCp = Math.max(1, minCp ?? 0, start ? fill.cp : 0);
    const source = sources ? firstSource({ fundCp: sources.fundCp, needCp, hasPurse: actors.length > 0 }) : null;
    // One character: the purse option names them, so choosing the party fund never reads as that character paying.
    const single = actors.length === 1 ? actors[0] : null;
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
        intro,
        sources: sources ? [
            { value: "fund", checked: source === "fund", disabled: !fundOk,
                label: game.i18n.format("pf2e-artisans-workshop.Prompt.SourceFund", { amount: money(Math.max(0, sources.fundCp)) }) },
            { value: "purse", checked: source === "purse", disabled: !actors.length,
                label: single ? game.i18n.format("pf2e-artisans-workshop.Prompt.SourcePurseOf", { name: single.name })
                    : game.i18n.localize("pf2e-artisans-workshop.Prompt.SourcePurse") },
        ] : null,
        actors: actors.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === actor })),
        single: !!single,
        from: single && !sources ? game.i18n.format("pf2e-artisans-workshop.Prompt.From", { name: single.name }) : null,
        // The gold field has focus when the dialog opens (its confirm button, which DialogV2 would focus, starts disabled).
        coins: DENOMINATIONS.map((d) => ({ denomination: d, value: start ? String(start[d] || "") : "", autofocus: d === "gp",
            label: game.i18n.localize(`PF2E.CurrencyAbbreviations.${d}`) })),
        fill: fill?.cp > 0 ? { ...coinFields(fill.cp), label: game.i18n.format(fill.key, { amount: money(fill.cp) }) } : null,
        max: maxCp === null ? null : money(maxCp),
    });
    const limits = (form) => (sourceOf(form) === "fund" ? { minCp, maxCp: sources.fundCp, fundCp: sources.fundCp } : { minCp, maxCp, fundCp: null });
    const answer = await dialogs().prompt({
        window: { title: config.title, icon: config.icon },
        content,
        ok: {
            label: config.button, icon: config.icon,
            callback: (_event, button) => {
                const form = button.form;
                const check = checkAmount(fieldsOf(form), limits(form));
                if (!check.ok) return { problem: check, fundCp: limits(form).fundCp };
                return { cp: check.cp, actor: form.elements.namedItem("actor")?.value || null, source: sourceOf(form) };
            },
        },
        render: (_event, dialog) => wireAmountForm(dialog.element, limits),
        rejectClose: false,
        renderOptions: inWindowOf(app),
    });
    if (!answer) return null;
    if (answer.problem) {
        ui.notifications.warn(problemText(answer.problem, answer.fundCp ?? null));
        return null;
    }
    return { cp: answer.cp, actor: answer.source === "fund" ? null : answer.actor ?? actors[0]?.uuid ?? null, source: answer.source };
}

/**
 * The amount form's behaviour, once rendered: "Fill the shortfall" fills the four fields, with no more than the chosen
 * source's limit (the party fund's unallocated money); the character list is for a purse only; and the confirm button is
 * enabled only while the amount can be used, the reason shown beside it.
 * @param {HTMLElement} root   the dialog's element
 * @param {(form: HTMLFormElement) => {minCp: number|null, maxCp: number|null, fundCp?: number|null}} limits
 */
export function wireAmountForm(root, limits) {
    const form = root?.querySelector("form") ?? root;
    const box = root?.querySelector(".pf2e-artisans-workshop-amount");
    if (!form || !box) return;
    const confirm = root.querySelector("button[data-action='ok']");
    const problem = box.querySelector(".amount-problem");
    const update = () => {
        const limit = limits(form);
        const check = checkAmount(fieldsOf(form), limit);
        if (confirm) confirm.disabled = !check.ok;
        if (problem) problem.textContent = problemText(check, limit.fundCp ?? null);
        const select = box.querySelector("select[name='actor']");
        if (select) select.disabled = sourceOf(form) === "fund";
    };
    box.querySelector("button[data-fill]")?.addEventListener("click", (event) => {
        const wanted = fieldsToCp(event.currentTarget.dataset);
        if (!wanted.ok) return;
        const { maxCp } = limits(form);
        const fields = coinFields(Number.isFinite(maxCp) ? Math.min(wanted.cp, Math.max(0, maxCp)) : wanted.cp);
        for (const d of DENOMINATIONS) {
            const input = form.elements.namedItem(d);
            if (input) input.value = fields[d] ? String(fields[d]) : "";
        }
        update();
    });
    box.addEventListener("input", update);
    box.addEventListener("change", update);
    update();
}

/** One localized paragraph of dialog content. */
const paragraph = (key) => ["<p>", foundry.utils.escapeHTML(game.i18n.localize(key)), "</p>"].join("");

/** Ask the user to confirm an action that cannot be undone, in the browser window `app` (the window that asks) is in. */
export function confirm({ title, content, app = null }) {
    return dialogs().confirm({ window: { title }, content: paragraph(content), rejectClose: false, renderOptions: inWindowOf(app) });
}
