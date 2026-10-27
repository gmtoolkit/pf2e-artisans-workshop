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
    // M5 on M4.1: paying for a formula, a casting or a formula copy, and a spell's cost when a casting is marked done.
    purchase: { title: "pf2e-artisans-workshop.Prompt.Purchase.Title", button: "pf2e-artisans-workshop.Prompt.Purchase.Button", icon: "fa-solid fa-cart-shopping" },
    cast: { title: "pf2e-artisans-workshop.Prompt.Cast.Title", button: "pf2e-artisans-workshop.Prompt.Cast.Button", icon: "fa-solid fa-wand-magic-sparkles" },
});

/**
 * How the two sources read (A, M4.1): funding an order moves no coins from the party fund and moves a purse's into the
 * strongbox; paying for something (M5 on M4.1) takes the coins out of the strongbox or straight out of the purse.
 */
const SOURCE_LABELS = Object.freeze({
    fund: { fund: "pf2e-artisans-workshop.Prompt.SourceFund", purse: "pf2e-artisans-workshop.Prompt.SourcePurse", purseOf: "pf2e-artisans-workshop.Prompt.SourcePurseOf" },
    pay: { fund: "pf2e-artisans-workshop.Prompt.SourceFundPay", purse: "pf2e-artisans-workshop.Prompt.SourcePursePay", purseOf: "pf2e-artisans-workshop.Prompt.SourcePurseOfPay" },
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
 * As built in M5 on M4.1: `fixedCp` asks only where a price is paid from (a formula, a casting bought), the price said
 * above the choice and no fields to type; `optional` lets the four fields stay empty as 0 (a spell's cost when a
 * casting is marked done: most spells have none).
 *
 * @param {object} p
 * @param {"fund"|"finish"|"retry"|"deposit"|"withdraw"|"return"|"purchase"|"cast"} p.kind
 * @param {Actor[]} [p.actors]   characters the coins may come from (or go to); a purse source needs one
 * @param {string|null} [p.actor]  the character chosen first
 * @param {number|null} [p.maxCp]  the most that may be entered (for a purse source; the party fund's is `sources.fundCp`)
 * @param {number|null} [p.minCp]  the least (a finish's shortfall)
 * @param {{cp: number, key: string}|null} [p.fill]  "Fill the shortfall": the amount, and the button's key
 * @param {boolean} [p.prefill]  start with the fill amount in the fields
 * @param {{fundCp: number}|null} [p.sources]  offer the party fund (holding `fundCp` unallocated) or a purse
 * @param {string|null} [p.intro]  a sentence above the fields, already localized
 * @param {number|null} [p.fixedCp]  the price to pay: no fields, only the source (M5 on M4.1)
 * @param {boolean} [p.optional]   nothing typed is 0, not a problem (M5 on M4.1)
 * @param {object|null} [p.app]    the window that asks
 * @returns {Promise<{cp: number, actor: string|null, source: "fund"|"purse"|null}|null>}
 */
export async function askMoney({ kind, actors = [], actor = null, maxCp = null, minCp = null, fill = null, prefill = false,
    sources = null, intro = null, fixedCp = null, optional = false, app = null }) {
    const config = KINDS[kind];
    const fundOk = !!sources && sources.fundCp > 0;
    const fixed = Number.isSafeInteger(fixedCp) && fixedCp > 0 ? fixedCp : null;
    if (fixed !== null) {
        // A price is paid in full: the fields hold it, hidden, so the same checks name a party fund that cannot cover it.
        minCp = fixed;
        maxCp = fixed;
        fill = null;
    }
    // Giving a share back to the party fund names no character; every other amount comes from or goes to one.
    if (kind !== "return" && !actors.length && !fundOk) {
        ui.notifications.warn("pf2e-artisans-workshop.Refusal.NoCharacter", { localize: true });
        return null;
    }
    const start = fixed !== null ? coinFields(fixed) : prefill && fill?.cp > 0 ? coinFields(fill.cp) : null;
    const needCp = Math.max(optional ? 0 : 1, minCp ?? 0, start ? fixed ?? fill.cp : 0);
    // A spell's cost is the caster's to pay (GM Core p.262), so marking a casting done starts on the caster's purse.
    const source = !sources ? null : kind === "cast" && actors.length ? "purse" : firstSource({ fundCp: sources.fundCp, needCp, hasPurse: actors.length > 0 });
    // One character: the purse option names them, so choosing the party fund never reads as that character paying.
    const single = actors.length === 1 ? actors[0] : null;
    const labels = kind === "purchase" || kind === "cast" ? SOURCE_LABELS.pay : SOURCE_LABELS.fund;
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
        intro,
        sources: sources ? [
            { value: "fund", checked: source === "fund", disabled: !fundOk,
                label: game.i18n.format(labels.fund, { amount: money(Math.max(0, sources.fundCp)) }) },
            { value: "purse", checked: source === "purse", disabled: !actors.length,
                label: single ? game.i18n.format(labels.purseOf, { name: single.name }) : game.i18n.localize(labels.purse) },
        ] : null,
        actors: actors.map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === actor })),
        single: !!single,
        from: single && !sources ? game.i18n.format("pf2e-artisans-workshop.Prompt.From", { name: single.name }) : null,
        // The gold field has focus when the dialog opens (its confirm button, which DialogV2 would focus, starts disabled).
        coins: DENOMINATIONS.map((d) => ({ denomination: d, value: start ? String(start[d] || "") : "", autofocus: d === "gp" && fixed === null,
            label: game.i18n.localize(`PF2E.CurrencyAbbreviations.${d}`) })),
        fixed: fixed === null ? null : game.i18n.format("pf2e-artisans-workshop.Prompt.Price", { amount: money(fixed) }),
        fill: fill?.cp > 0 ? { ...coinFields(fill.cp), label: game.i18n.format(fill.key, { amount: money(fill.cp) }) } : null,
        max: maxCp === null || fixed !== null ? null : money(maxCp),
    });
    const limits = (form) => (sourceOf(form) === "fund"
        ? { minCp, maxCp: fixed ?? sources.fundCp, fundCp: sources.fundCp, optional }
        : { minCp, maxCp, fundCp: null, optional });
    const answer = await dialogs().prompt({
        window: { title: config.title, icon: config.icon },
        content,
        ok: {
            label: config.button, icon: config.icon,
            callback: (_event, button) => {
                const form = button.form;
                const check = checkForm(form, limits(form));
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
 * Whether the form's amount can be used (`checkAmount` within `limit`), and, from the party fund, whether the fund
 * covers it: a price (M5 on M4.1) is the least and the most at once, so one the fund cannot cover reads as the fund
 * short of what is needed, pointing at a purse.
 */
function checkForm(form, limit) {
    const check = checkAmount(fieldsOf(form), limit);
    if (check.ok && Number.isFinite(limit.fundCp) && check.cp > limit.fundCp) return { ok: false, reason: "too-little", minCp: check.cp };
    return check;
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
        const check = checkForm(form, limit);
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

/** One localized paragraph of dialog content, formatted with `data` when given. */
const paragraph = (key, data = null) => ["<p>", foundry.utils.escapeHTML(data ? game.i18n.format(key, data) : game.i18n.localize(key)), "</p>"].join("");

/**
 * Ask the user to confirm an action that cannot be undone, in the browser window `app` (the window that asks) is in.
 * `content` is one key, or several paragraphs as `{key, data}` (M9: what agreeing to sit for a tattoo or graft means).
 */
export function confirm({ title, content, app = null }) {
    const html = (Array.isArray(content) ? content : [{ key: content }]).map(({ key, data = null }) => paragraph(key, data)).join("");
    return dialogs().confirm({ window: { title }, content: html, rejectClose: false, renderOptions: inWindowOf(app) });
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
