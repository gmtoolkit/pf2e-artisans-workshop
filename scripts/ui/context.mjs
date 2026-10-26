/**
 * Template data for an order, shared by the Workshop window and the chat cards (DESIGN.md 10.3, 10.5): the pure view
 * model of `scripts/logic/views.mjs`, with the crafter's gates and the words and amounts a template shows.
 */
import { CLOSED } from "../logic/orders.mjs";
import { orderView } from "../logic/views.mjs";
import { orderDays, orderRows, viewer as currentViewer } from "../foundry/orders.mjs";
import { crafterFacts, gatesFor, productFacts } from "../foundry/products.mjs";
import { rulesFromSettings } from "../foundry/settings.mjs";
import { gateText, money, nameOf, number } from "./format.mjs";
import { DEGREE_CLASS, DEGREE_KEY, ROUTE, STATUS } from "./labels.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** The crafter's level and rank in the order's skill today, or null. */
function crafterToday(order) {
    const actor = order.crafter ? fromUuidSync(order.crafter, { strict: false }) : null;
    if (!actor?.skills) return null;
    return { level: actor.level ?? 0, rank: actor.skills[order.skill ?? "crafting"]?.rank ?? 0 };
}

/** The gates of an accepted order with a crafter, or null (6.5). */
async function gatesOf(order, rows, rules) {
    if (order.status !== "accepted" || !order.crafter) return null;
    const actor = fromUuidSync(order.crafter, { strict: false });
    const product = await productFacts(order.product?.uuid);
    if (!actor || !product) return null;
    return (await gatesFor(order, crafterFacts(actor), product, rows, rules)).gates;
}

/**
 * Everything a template needs about one order.
 * @param {object} order
 * @param {{no?: number, rules?: object, viewer?: object}} [options]
 */
export async function orderContext(order, { no = null, rules = rulesFromSettings(), viewer = currentViewer() } = {}) {
    const rows = orderRows(order.id);
    const days = orderDays(order.id);
    const gates = await gatesOf(order, rows, rules);
    const view = orderView(order, { rows, days, gates, crafterToday: crafterToday(order), viewer, nameOf, no, rules });
    return decorate(view, order);
}

/** Whether this user may see Craft DCs: a GM, or pf2e's "show DCs" metagame setting (10.9). */
export const showDcs = () => game.user.isGM || game.pf2e?.settings?.metagame?.dcs !== false;

/** The view model with its words: status, money, progress sentence, blockers. */
export function decorate(view, order) {
    const status = STATUS[view.status] ?? STATUS.requested;
    const p = view.progress;
    const progressText = p.phase === "funding"
        ? fmt("pf2e-artisans-workshop.Queue.ProgressFunding", { escrow: money(p.escrowCp), upfront: money(p.upfrontCp), pct: String(p.pct) })
        : p.phase === "done"
            ? loc("pf2e-artisans-workshop.Queue.ProgressDone")
            : fmt("pf2e-artisans-workshop.Queue.ProgressCrafting", { pct: String(p.pct), paid: money(p.paidCp), earned: money(p.earnedCp), left: money(p.remainingCp) });
    const working = ["rolled", "finishing"].includes(view.status) || (view.status === "paused" && view.resumeTo === "finishing");
    const daysText = working && Number.isFinite(view.daysToZero)
        ? fmt("pf2e-artisans-workshop.Queue.DaysOf", { done: number(view.extraDays), total: number(view.extraDays + view.daysToZero) })
        : null;
    const statusWord = view.status === "setup" && view.setup
        ? fmt("pf2e-artisans-workshop.Queue.SetupOf", { word: loc(status.key), done: number(view.setup.done), days: number(view.setup.days) })
        : loc(status.key);
    return {
        ...view,
        dc: showDcs() ? view.dc : null,
        statusIcon: status.icon,
        statusWord,
        blockedText: view.blocked.map(gateText),
        title: view.giftHidden ? loc("pf2e-artisans-workshop.Queue.Gift") : view.name,
        quantityText: view.quantity > 1 ? fmt("pf2e-artisans-workshop.Queue.Quantity", { n: number(view.quantity) }) : null,
        forText: view.toStrongbox ? loc("pf2e-artisans-workshop.Queue.ForStrongbox") : view.recipient,
        routeText: view.route ? loc(ROUTE[view.route] ?? ROUTE.none) : null,
        rarityLabel: CONFIG.PF2E?.rarityTraits?.[view.rarity] ? loc(CONFIG.PF2E.rarityTraits[view.rarity]) : view.rarity,
        progressText, daysText,
        segments: p.segments.filter((s) => s.pct > 0),
        priceText: money(p.priceCp), upfrontText: money(p.upfrontCp), escrowText: money(p.escrowCp),
        finishText: money(view.finishCp), perDayText: Number.isFinite(view.perDayCp) ? money(view.perDayCp) : null,
        // What `finishCp` is: the cost to finish once crafting, before that what the up-front half still lacks.
        finishLabel: p.phase === "crafting" ? "pf2e-artisans-workshop.Detail.FinishNow" : "pf2e-artisans-workshop.Detail.StillNeeded",
        withdrawText: view.withdrawableCp > 0 ? money(view.withdrawableCp) : null,
        checkText: view.check ? loc(DEGREE_KEY[view.check.degree]) : null, checkClass: view.check ? DEGREE_CLASS[view.check.degree] : null,
        conflictText: view.conflict ? loc(DEGREE_KEY[view.conflict.degree]) : null,
        contributorsText: view.contributors.map((c) => ({ ...c, amount: money(c.cp), name: c.name ?? loc("pf2e-artisans-workshop.Funds.PartyFund") })),
        isClosed: CLOSED.includes(view.status),
        notes: order.notes ?? "",
    };
}
