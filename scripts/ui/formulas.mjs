/**
 * The Formulas tab (DESIGN.md 10.1, 4.13, 6.4, 6.8, M5): the Formula Codex of one character (owned characters for a
 * player, any member for a GM): the book grouped by family with a provenance badge on each formula and the grades each
 * family covers; the formulas its features give it without a book (virtual lists from the registry); the picks its
 * features still owe it, by level, each with a "choose"; the party's families from the roster snapshots; and "Learn a
 * formula": a search (or a dropped item) with every route the character has to it, what each costs and takes, the
 * break-even of buying it, and a button for each (buy, copy from an NPC, ask an ally, invent, reverse-engineer, scan,
 * craft a copy for someone else's book, take it for an owed pick).
 *
 * The window keeps this tab's state (`app.codex`): the character, the search text, the formula being looked at, the pick
 * being chosen for, the "a seller is available" confirmation and the copy's recipient.
 *
 * As built in M5 on M4.1: a route that costs money (Buy, Copy from an NPC, Ask an ally when copying costs anything) asks
 * where it is paid from, as "Fund this order" does: the party fund's unallocated money or a character's purse, the price
 * in view. "Browse" beside the search opens pf2e's Compendium Browser to drag an item from (the item picker of M4.1).
 */
import { MODULE_ID } from "../constants.mjs";
import { pickFits } from "../logic/codex.mjs";
import { acquire, codexData, routesFor } from "../foundry/formulas.mjs";
import { requestOrder } from "../foundry/orders.mjs";
import { productFacts } from "../foundry/products.mjs";
import { members } from "../foundry/roster.mjs";
import { fundAvailableCp } from "../foundry/purchases.mjs";
import { requestService, serviceCostCp } from "../foundry/services.mjs";
import { catalogue, searchCatalogue } from "../foundry/catalogue.mjs";
import { rulesFromSettings } from "../foundry/settings.mjs";
import { canWrite } from "../foundry/state.mjs";
import { featName, money, number, report } from "./format.mjs";
import { ACQUIRE_ROUTE, PROVENANCE } from "./labels.mjs";
import { askMoney } from "./prompts.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** How many items a virtual list or a family's covered grades show before "and N more". */
const SHOWN = 12;

/** The characters whose Codex this user may open: their own; every member for a GM (10.1). */
export function codexChoices() {
    return members().filter((actor) => actor.isOwner);
}

/** The tab's state, with defaults. */
export function codexState(app) {
    app.codex ??= { actor: null, search: "", uuid: null, pick: null, seller: false, recipient: null };
    return app.codex;
}

/** The character the Codex shows: the chosen one, else the window's acting character, else the first choice. */
export function codexActor(app) {
    const state = codexState(app);
    const choices = codexChoices();
    return choices.find((a) => a.uuid === state.actor) ?? choices.find((a) => a.uuid === app.actingActor?.()?.uuid) ?? choices[0] ?? null;
}

const rarityLabel = (rarity) => (CONFIG.PF2E?.rarityTraits?.[rarity] ? loc(CONFIG.PF2E.rarityTraits[rarity]) : rarity);

/** An item's facts as the template shows them. */
const itemView = (item) => ({ uuid: item.uuid, name: item.name, img: item.img, level: item.level, rarity: item.rarity, rarityLabel: rarityLabel(item.rarity) });

/** "A, B, C and 4 more" over a list of items. */
function namesOf(items) {
    const shown = items.slice(0, SHOWN).map((i) => fmt("pf2e-artisans-workshop.Formulas.NameLevel", { name: i.name, level: String(i.level) }));
    const more = items.length - shown.length;
    return { shown, more: more > 0 ? fmt("pf2e-artisans-workshop.Formulas.AndMore", { n: number(more) }) : null };
}

/** A route's time: minutes, or setup days. */
function timeText(route) {
    if (Number.isInteger(route.minutes)) return fmt("pf2e-artisans-workshop.Formulas.Minutes", { n: number(route.minutes) });
    if (Number.isInteger(route.setupDays)) return fmt(route.setupDays === 1 ? "pf2e-artisans-workshop.Formulas.SetupDay" : "pf2e-artisans-workshop.Formulas.SetupDays",
        { n: number(route.setupDays) });
    return "";
}

/** Everything the Formulas tab shows. */
export async function formulasContext(app) {
    const state = codexState(app);
    const actor = codexActor(app);
    const choices = codexChoices().map((a) => ({ uuid: a.uuid, name: a.name, selected: a === actor }));
    if (!actor) return { codex: { choices, actor: null } };
    const rules = rulesFromSettings();
    const data = await codexData(actor, rules);
    const counts = {};
    for (const entry of data.entries) counts[entry.route] = (counts[entry.route] ?? 0) + 1;
    const families = data.families.map((family) => ({
        key: family.key, name: family.name,
        known: family.known.map((entry) => ({ ...itemView(entry), route: entry.route, badge: PROVENANCE[entry.route] ?? PROVENANCE.unrecorded,
            source: entry.source && entry.route === "granted" ? featName(entry.source) : null })),
        covered: namesOf(family.covered),
        coveredCount: family.covered.length,
    }));
    const virtual = data.virtual.map((list) => ({ key: list.key, name: featName(list.key), count: number(list.items.length), items: namesOf(list.items) }));
    const owed = data.owed.entries.filter((e) => e.owed > 0).map((e) => ({
        key: e.key, level: e.level, name: featName(e.key), owed: number(e.owed), count: number(e.count),
        maxLevel: e.maxLevel === null ? null : String(e.maxLevel), choosing: state.pick?.key === e.key && state.pick?.level === e.level,
    }));
    const party = data.party.map((f) => ({ name: f.name, members: f.members.map((m) => m.name).join(", "), levels: f.levels.join(", ") }));
    return {
        codex: {
            choices, actor: { uuid: actor.uuid, name: actor.name, level: actor.level }, total: number(data.entries.length),
            badges: Object.entries(counts).map(([route, n]) => ({ route, n: number(n), label: PROVENANCE[route] ?? PROVENANCE.unrecorded })),
            families, virtual, owed, owedTotal: number(data.owed.owed), party, noCatalogue: data.catalogueSize === 0,
            learn: await learnContext(state, actor, data, rules),
        },
    };
}

/** The "Learn a formula" panel: the search, the matches, and the routes for the formula being looked at. */
async function learnContext(state, actor, data, rules) {
    const pick = state.pick ? data.owed.entries.find((e) => e.key === state.pick.key && e.level === state.pick.level && e.owed > 0) ?? null : null;
    if (state.pick && !pick) state.pick = null;
    let matches;
    if (pick) {
        const text = state.search.trim().toLowerCase();
        matches = (await catalogue()).filter((item) => pickFits(pick, item) && (!text || item.name.toLowerCase().includes(text))).slice(0, 30);
    } else {
        matches = await searchCatalogue(state.search, 12);
    }
    const learn = {
        search: state.search, pick: pick ? { name: featName(pick.key), level: pick.level, maxLevel: pick.maxLevel } : null,
        matches: matches.map(itemView), selected: null, ready: canWrite(), canBrowse: !!game.pf2e?.compendiumBrowser,
    };
    if (!state.uuid) return learn;
    const info = await routesFor(actor, state.uuid, rules);
    if (!info) return learn;
    const known = data.entries.some((e) => e.uuid === state.uuid);
    // On its way: a claim filed for the book that the character's own client has not written yet (5.5).
    const pending = !known && data.pending.includes(state.uuid);
    const fits = pick ? pickFits(pick, info.product) : false;
    const others = members().filter((m) => m !== actor);
    learn.selected = {
        ...itemView(info.product), known, pending, route: info.route,
        routeText: info.route ? loc(ACQUIRE_ROUTE[info.route] ?? ACQUIRE_ROUTE.none) : loc("pf2e-artisans-workshop.Formulas.NeedsFormula"),
        routes: known || pending ? [] : info.routes.filter((r) => !["known", "family", "virtual"].includes(r.route)).map((r) => ({
            route: r.route, label: ACQUIRE_ROUTE[r.route] ?? r.route, cost: r.costCp ? money(r.costCp) : loc("pf2e-artisans-workshop.Formulas.Free"), costCp: r.costCp ?? 0,
            time: timeText(r), check: r.check === "craft", needsSeller: r.needs.includes("seller"), hint: r.hintCp ? money(r.hintCp) : null,
            action: r.route !== "none",
        })),
        allies: info.allies, seller: state.seller, needsSeller: !known && !pending && info.routes.some((r) => r.needs.includes("seller")),
        breakEven: info.breakEven ? {
            needed: info.breakEven.needed, formula: money(info.breakEven.formulaCp), day: money(info.breakEven.daySavedCp),
            crafts: info.breakEven.crafts === null ? null : number(info.breakEven.crafts), craftsOne: info.breakEven.crafts === 1,
        } : null,
        copy: info.copy && others.length ? { cost: money(info.copy.costCp), recipients: others.map((m) => ({ uuid: m.uuid, name: m.name, selected: m.uuid === state.recipient })) } : null,
        pickable: !!pick && fits && !known && !pending,
    };
    return learn;
}

/* -------------------------------------------- */
/*  Actions                                      */
/* -------------------------------------------- */

/**
 * A learned formula's result, told: when the learner's own client writes it (`claimed`: this tab is not the one
 * responsible for that character), say so, since the book does not change here yet (5.5).
 */
function told(result, actor) {
    if (result?.ok && result.outcome === "claimed") ui.notifications.info(fmt("pf2e-artisans-workshop.Formulas.Claimed", { name: actor?.name ?? "" }));
    return report(result);
}

/** The data a Formulas-tab button carries. */
const dataOf = (target) => target.closest("[data-op]")?.dataset ?? {};

/**
 * Where a formula's price is paid from (As built in M5 on M4.1): the party fund or a character's purse, asked as "Fund
 * this order" asks, the price in view and the learner's purse first among the user's characters. `{paidFrom: "purse",
 * payer}` with nothing to pay; null when the user closes the dialog.
 */
async function askPayment(app, { cp, actor, intro }) {
    if (!(cp > 0)) return { paidFrom: "purse", payer: actor?.uuid ?? null };
    const actors = codexChoices().filter((a) => a.isOwner);
    const answer = await askMoney({ kind: "purchase", fixedCp: cp, actors, actor: actor?.uuid ?? null, sources: { fundCp: fundAvailableCp() },
        intro, app });
    return answer ? { paidFrom: answer.source === "fund" ? "fund" : "purse", payer: answer.actor } : null;
}

/** "Browse": pf2e's Compendium Browser on its equipment tab, to drag an item from onto the tab (F, M4.1). */
async function browse() {
    const browser = game.pf2e?.compendiumBrowser;
    if (!browser) return;
    try {
        await browser.openTab("equipment");
    } catch (error) {
        console.warn(`${MODULE_ID} | could not open the Compendium Browser`, error);
        await browser.render({ force: true });
    }
}

/**
 * A Formulas-tab button (`data-action="formula"`, `data-op`, the attribute `focus.mjs` finds a control by after a
 * re-render, 10.9): choose a formula, a pick, or act on a route.
 * Returns a result for `report`, or null.
 */
export async function onFormulaOp(app, target) {
    const state = codexState(app);
    const data = dataOf(target);
    const actor = codexActor(app);
    switch (data.op) {
        case "select":
            state.uuid = data.uuid ?? null;
            return null;
        case "clear":
            state.uuid = null;
            state.pick = null;
            return null;
        case "pick":
            state.pick = { key: data.key, level: Number(data.level) };
            state.uuid = null;
            state.search = "";
            return null;
        case "browse":
            await browse();
            return null;
        case "buy":
        case "copy-npc":
        case "scanner": {
            const cp = Number(data.cost) || 0;
            const name = (await productFacts(state.uuid))?.name ?? "";
            const pay = await askPayment(app, { cp, actor, intro: fmt("pf2e-artisans-workshop.Prompt.Intro.Formula", { name, amount: money(cp) }) });
            if (!pay) return null;
            return told(await acquire({ learner: actor?.uuid, uuid: state.uuid, route: data.op, ...pay, confirm: state.seller ? ["seller"] : [] }), actor);
        }
        case "grant": {
            const result = told(await acquire({ learner: actor?.uuid, uuid: state.uuid, route: "grant", source: app.codex.pick?.key ?? null,
                pickLevel: app.codex.pick?.level ?? null }), actor);
            if (result?.ok) state.pick = null;
            return result;
        }
        case "ask": {
            const cp = serviceCostCp("formula-copy");
            const name = cp > 0 ? (await productFacts(state.uuid))?.name ?? "" : "";
            const pay = await askPayment(app, { cp, actor, intro: fmt("pf2e-artisans-workshop.Prompt.Intro.FormulaCopy", { name, amount: money(cp) }) });
            if (!pay) return null;
            return report(await requestService({ kind: "formula-copy", requester: actor?.uuid, performer: data.ally, uuid: state.uuid, ...pay }));
        }
        case "invent":
        case "reverse-engineer":
            return report(await requestOrder({ uuid: state.uuid, quantity: 1, requester: actor?.uuid, recipient: { kind: "actor", uuid: actor?.uuid },
                crafter: actor?.uuid, productType: "formula", route: data.op }));
        case "craft-copy": {
            if (!state.recipient) return report({ ok: false, reason: "no-recipient" });
            return report(await requestOrder({ uuid: state.uuid, quantity: 1, requester: actor?.uuid, recipient: { kind: "actor", uuid: state.recipient },
                crafter: actor?.uuid, productType: "formula", route: "craft-copy" }));
        }
        default:
            return null;
    }
}

/** A Formulas-tab field changed: the character, the seller confirmation, the copy's recipient. */
export function onFormulaChange(app, target) {
    const state = codexState(app);
    if (target.name === "codexActor") {
        Object.assign(state, { actor: target.value, uuid: null, pick: null, search: "" });
        return true;
    }
    if (target.name === "codexSeller") {
        state.seller = target.checked;
        return true;
    }
    if (target.name === "codexRecipient") {
        state.recipient = target.value || null;
        return true;
    }
    return false;
}

/** The Formulas tab's search text. */
export function onFormulaSearch(app, value) {
    codexState(app).search = value;
}

/** An item dropped on the Formulas tab (10.6): look at it in "Learn a formula". */
export async function onFormulaDrop(app, data) {
    if (data?.type !== "Item" || !data.uuid) return false;
    const item = await fromUuid(data.uuid);
    const state = codexState(app);
    state.uuid = item?._stats?.compendiumSource ?? item?.sourceId ?? data.uuid;
    state.pick = null;
    return true;
}

/** Whether the Formulas tab is on (14.1 `features.formulas`). */
export const formulasOn = () => game.settings.get(MODULE_ID, "features.formulas") !== false;
