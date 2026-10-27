/**
 * Template data for an order, shared by the Workshop window and the chat cards (DESIGN.md 10.3, 10.5): the pure view
 * model of `scripts/logic/views.mjs`, with the crafter's gates and the words and amounts a template shows. As built in
 * M4.1 it adds the requirements in plain words, what the order still needs ("Fill the shortfall"), the work days with
 * what each took off, what a finished order cost, and where its item went.
 */
import { MODULE_ID } from "../constants.mjs";
import { CLOSED } from "../logic/orders.mjs";
import { orderView } from "../logic/views.mjs";
import { checkHidden, shownDegree } from "../logic/variants.mjs";
import { shelfItemsFor } from "../foundry/claims.mjs";
import { orderDays, orderRows, owns, viewer as currentViewer } from "../foundry/orders.mjs";
import { crafterFacts, gatesFor, planEstimate, productFacts } from "../foundry/products.mjs";
import { rulesFromSettings } from "../foundry/settings.mjs";
import { gateText, money, nameOf, number, requirementName, sourceName } from "./format.mjs";
import { DEGREE_CLASS, DEGREE_KEY, DELIVERY, ROUTE, STATUS } from "./labels.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** A check's degree as the Queue shows it (`checkText`, `checkClass`), or nothing. */
const degreeText = (degree) => ({ checkText: degree === null ? null : loc(DEGREE_KEY[degree]), checkClass: degree === null ? null : DEGREE_CLASS[degree] });

/** The crafter's level and rank in the order's skill today, or null. */
function crafterToday(order) {
    const actor = order.crafter ? fromUuidSync(order.crafter, { strict: false }) : null;
    if (!actor?.skills) return null;
    return { level: actor.level ?? 0, rank: actor.skills[order.skill ?? "crafting"]?.rank ?? 0 };
}

/** The gates of an accepted order with a crafter and the plan they judged (6.5), or null. */
async function gatesOf(order, rows, rules) {
    if (order.status !== "accepted" || !order.crafter) return null;
    const actor = fromUuidSync(order.crafter, { strict: false });
    const product = await productFacts(order.product?.uuid);
    if (!actor || !product) return null;
    return gatesFor(order, crafterFacts(actor), product, rows, rules);
}

/** How many of a finished order's items wait on the pickup shelf now. */
function shelfCountOf(order) {
    if (order.status !== "complete" || order.recipient?.kind !== "actor") return 0;
    return shelfItemsFor(order.recipient.uuid).filter((item) => item.flags?.[MODULE_ID]?.shelf?.order === order.id).length;
}

/**
 * Everything a template needs about one order. `rows` and `days` are the order's own (`orderRows`, `orderDays`) when the
 * caller has them already: the Queue groups the ledger's once for all its orders (M12 performance pass), where reading them
 * per order read every row of the ledger once per order.
 * @param {object} order
 * @param {{no?: number, rules?: object, viewer?: object, rows?: object[], days?: object[]}} [options]
 */
export async function orderContext(order, { no = null, rules = rulesFromSettings(), viewer = currentViewer(), rows = orderRows(order.id),
    days = orderDays(order.id) } = {}) {
    const judged = await gatesOf(order, rows, rules);
    // Before start, the plan the order would freeze, as G8 judges it (M5 on M4.1): a formula job, an upgrade, a rune, a
    // transfer or a free crafter's order is measured against half its own Price, not half of the item's.
    const plan = judged ? (judged.plan?.ok ? judged.plan : null) : await planEstimate(order, rules);
    const view = orderView(order, { rows, days, gates: judged?.gates ?? null, plan, crafterToday: crafterToday(order), viewer, nameOf, no, rules,
        shelfCount: shelfCountOf(order) });
    return decorate(view, order);
}

/** Whether this user may see Craft DCs: a GM, or pf2e's "show DCs" metagame setting (10.9). */
export const showDcs = () => game.user.isGM || game.pf2e?.settings?.metagame?.dcs !== false;

/** What the order still lacks for its next step, as a sentence, or null when it lacks nothing (M4.1). */
const SHORTFALL = Object.freeze({
    upfront: "pf2e-artisans-workshop.Detail.ShortUpfront",
    retry: "pf2e-artisans-workshop.Detail.ShortRetry",
    finish: "pf2e-artisans-workshop.Detail.ShortFinish",
});

/** The requirements of an accepted order in words: "10 of 12 met", the met ones by name, the unmet ones with why. */
function requirementsText(requirements) {
    if (!requirements) return null;
    return {
        ...requirements,
        countText: fmt(requirements.allMet ? "pf2e-artisans-workshop.Detail.RequirementsAllMet" : "pf2e-artisans-workshop.Detail.RequirementsMet",
            { met: number(requirements.met), total: number(requirements.total) }),
        metList: requirements.metList.map((gate) => ({ id: gate.id, name: requirementName(gate) })),
        unmet: requirements.unmet.map((gate) => ({ id: gate.id, name: requirementName(gate), text: gateText(gate), action: gate.action,
            fillCp: gate.action === "fund" ? gate.data?.shortCp ?? null : null })),
    };
}

/** The work days as lines: "Setup day 1 of 2", "Day 3: -8 gp 7 sp", or a day that has not counted yet (D, M4.1). */
function workDaysText(workDays) {
    return workDays.map((d) => {
        if (d.kind === "setup") return fmt("pf2e-artisans-workshop.Detail.SetupDay", { n: number(d.n), of: number(d.of) });
        if (!d.counted) return fmt("pf2e-artisans-workshop.Detail.ExtraDayPending", { n: number(d.n) });
        return fmt("pf2e-artisans-workshop.Detail.ExtraDay", { n: number(d.n), amount: money(d.cp) });
    });
}

/**
 * What a finished order cost, as one sentence, and one more for ruined materials (D, M4.1), for the material stock it
 * used up and for what was bought for it (M5 on M4.1).
 */
function costText(cost) {
    if (!cost) return null;
    const key = cost.workDays === 1 ? "pf2e-artisans-workshop.Detail.CostSummaryOneDay" : "pf2e-artisans-workshop.Detail.CostSummary";
    const summary = fmt(key, { upfront: money(cost.upfrontCp), days: number(cost.workDays), work: money(cost.workCp),
        finish: money(cost.finishCp), total: money(cost.totalCp) });
    const ruined = cost.ruinedCp > 0 ? fmt("pf2e-artisans-workshop.Detail.CostRuined", { amount: money(cost.ruinedCp) }) : null;
    const stock = cost.stockCp > 0 ? fmt("pf2e-artisans-workshop.Detail.CostStock", { amount: money(cost.stockCp) }) : null;
    const bought = cost.purchasesCp > 0 ? fmt("pf2e-artisans-workshop.Detail.CostBought", { amount: money(cost.purchasesCp) }) : null;
    return { summary, ruined, stock, bought };
}

/** The view model with its words: status, money, progress sentence, blockers, and M4.1's additions. */
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
    const short = view.shortfall;
    const delivery = view.delivery;
    // Only a user who can collect the item is told to (the Collect button is beside the sentence); everyone else reads
    // whom it waits for (review fix of M4.1).
    const canCollect = delivery?.state === "shelf" && !!delivery.to && owns(delivery.to);
    const deliveryKey = canCollect ? DELIVERY.shelfYours : DELIVERY[delivery?.state];
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
        fundReturnText: view.fundReturnableCp > 0 ? money(view.fundReturnableCp) : null,
        // M9a (6.16.4): a secret check reads "rolled (secret)" to players until it settles or a GM reveals it; one whose critical
        // failure made the item anyway reads as a success to them (review fix of M9a).
        ...(checkHidden(order.check, currentViewer())
            ? { checkText: loc("pf2e-artisans-workshop.Variant.Critical.Secret"), checkClass: null, secretCheck: true }
            : degreeText(view.check ? shownDegree(order.check, currentViewer()) : null)),
        conflictText: view.conflict ? loc(DEGREE_KEY[view.conflict.degree]) : null,
        contributorsText: view.contributors.map((c) => ({ ...c, amount: money(c.cp), name: sourceName(c.actor) })),
        // Material stock earmarked for the order, by who handed it over, at Price (M5 on M4.1).
        stockText: (view.stock ?? []).map((s) => ({ amount: money(s.cp),
            name: fmt("pf2e-artisans-workshop.Detail.StockFrom", { name: s.actor ? nameOf(s.actor) : loc("pf2e-artisans-workshop.Funds.PartyFund") }) })),
        // M11: in a fixed order, the party fund first and then by name (two runs of one staging showed either order).
        spentText: view.spent.map((s) => ({ fund: s.actor === null, name: sourceName(s.actor), amount: money(s.cp) }))
            .sort((a, b) => Number(b.fund) - Number(a.fund) || a.name.localeCompare(b.name, game.i18n.lang || "en")),
        shortText: short && short.shortCp > 0 && SHORTFALL[short.phase] ? fmt(SHORTFALL[short.phase], { short: money(short.shortCp) }) : null,
        shortCp: short?.shortCp ?? 0,
        requirementsText: requirementsText(view.requirements),
        workDaysText: workDaysText(view.workDays),
        // The rule behind the work days, for an order that has them or is about to (D).
        showWorkRule: ["accepted", "setup", "check", "rolled", "finishing", "paused"].includes(view.status),
        costText: costText(view.cost),
        deliveryText: delivery ? fmt(deliveryKey, { name: delivery.to ? nameOf(delivery.to) : "" }) : null,
        deliveryState: delivery?.state ?? null,
        canCollect,
        isClosed: CLOSED.includes(view.status),
        notes: order.notes ?? "",
    };
}
