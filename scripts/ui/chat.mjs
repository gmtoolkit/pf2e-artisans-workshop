/**
 * Chat cards (DESIGN.md 10.5). A card is a chat message whose content is a short summary its author wrote, inside a
 * `.pf2e.chat-card.pf2e-artisans-workshop-card` wrapper, flagged `flags.MOD.card = {kind, order}`. Its live part (state,
 * amounts, buttons) is rendered on each client in `renderChatMessageHTML` from the ledger as it is now, and rendered
 * again locally with `ui.chat.updateMessage` when the order changes, so nobody edits another user's message and the
 * card is never authoritative. Only a message the log (or its popout) shows is rendered again: core would post one it
 * does not show at the bottom of the log, and `renderChatMessageHTML` brings it up to date when the log shows it. The
 * log's first messages render before the ledger is read, so every shown card is rendered again once this client's
 * status turns "ready".
 *
 * Buttons carry `data-pf2e-artisans-workshop-op`, never `data-action`: pf2e binds every `data-action` button of every
 * message with a global debounce (`ChatCards.listen`). The Craft check augment goes under pf2e's own check card for a
 * roll the wrapper linked to an order (6.12): its degree, what it means for the money, a Settle button while the order
 * is `rolled`, and a notice when a roll arrived after the order settled.
 *
 * The completion card says where the item went (As built in M4.1): delivered into the recipient's inventory, waiting on
 * the pickup shelf with Collect for the recipient's owners, on its way, or kept in the strongbox, and what the order
 * cost (paid up front, what the work days took off, paid at the finish).
 *
 * Cards are whispered to the people involved (the owners of the requester, the recipient, the crafter and the
 * contributors, and GMs); a request goes to every member's owners, since any of them may offer to craft it. The world
 * setting `chat.visibility` "public" posts them to everyone.
 */
import { MODULE_ID } from "../constants.mjs";
import { DEGREE } from "../logic/core.mjs";
import { critFailRuinCp } from "../logic/craft.mjs";
import { lastEntry, undoPlan } from "../logic/orders.mjs";
import { parseLink } from "../logic/rolls.mjs";
import { allocationsByContributor } from "../logic/split.mjs";
import * as orders from "../foundry/orders.mjs";
import { members } from "../foundry/roster.mjs";
import { setting } from "../foundry/settings.mjs";
import { canWrite } from "../foundry/state.mjs";
import { read, records } from "../foundry/store.mjs";
import { sweepClaims } from "../foundry/claims.mjs";
import { shortfallNow, fundOrder } from "../foundry/funds.mjs";
import { unallocatedCp } from "../logic/funds.mjs";
import { orderContext } from "./context.mjs";
import { money, report } from "./format.mjs";
import { DEGREE_CLASS, DEGREE_KEY, PROVENANCE } from "./labels.mjs";
import { askMoney } from "./prompts.mjs";
import { dayLines, spanText, stopText } from "./days.mjs";

const TEMPLATES = Object.freeze({
    days: "modules/pf2e-artisans-workshop/templates/chat/days.hbs",
    card: "modules/pf2e-artisans-workshop/templates/chat/order-card.hbs",
    augment: "modules/pf2e-artisans-workshop/templates/chat/check-augment.hbs",
    summary: "modules/pf2e-artisans-workshop/templates/chat/summary.hbs",
    morning: "modules/pf2e-artisans-workshop/templates/chat/morning.hbs",
});

/** The summary line each card kind writes into its message, for the log as its author saw it. */
const SUMMARY = Object.freeze({
    request: "pf2e-artisans-workshop.Card.Summary.Request",
    accepted: "pf2e-artisans-workshop.Card.Summary.Accepted",
    started: "pf2e-artisans-workshop.Card.Summary.Started",
    complete: "pf2e-artisans-workshop.Card.Summary.Complete",
    cancelled: "pf2e-artisans-workshop.Card.Summary.Cancelled",
});

/** The card's heading, by kind. */
const HEADING = Object.freeze({
    request: "pf2e-artisans-workshop.Card.Request",
    accepted: "pf2e-artisans-workshop.Card.Accepted",
    started: "pf2e-artisans-workshop.Card.Started",
    complete: "pf2e-artisans-workshop.Card.Complete",
    cancelled: "pf2e-artisans-workshop.Card.Cancelled",
});

const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);

/** The users who own an actor (players), for whispers. */
const ownersOf = (actor) => (actor ? game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")) : []);

/** Who a card goes to (10.5, 10.7): the involved users and GMs, or everyone. */
function recipientsFor(kind, order) {
    if (setting("chat.visibility") === "public") return [];
    const uuids = kind === "request"
        ? members().map((actor) => actor.uuid)
        : [order.requester, order.crafter, order.recipient?.uuid, ...allocationsByContributor(orders.orderRows(order.id)).map((a) => a.actor)];
    const users = new Set(game.users.filter((u) => u.isGM).map((u) => u.id));
    for (const uuid of uuids.filter(Boolean)) for (const user of ownersOf(actorOf(uuid))) users.add(user.id);
    users.add(game.user.id);
    return [...users];
}

/** Post a card for an order. Never throws: a card is a courtesy, the ledger already holds the change. */
export async function postCard(kind, order, extra = {}) {
    try {
        if (!order || !HEADING[kind]) return null;
        const name = order.visibility === "gift" ? game.i18n.localize("pf2e-artisans-workshop.Queue.Gift") : order.product?.snapshot?.name ?? "";
        const summary = game.i18n.format(SUMMARY[kind], {
            item: name, requester: actorOf(order.requester)?.name ?? "", crafter: actorOf(order.crafter)?.name ?? "",
            quantity: String(order.quantity), refunds: String(extra.refunds ?? 0),
        });
        const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.summary, {
            kind, order: order.id, heading: game.i18n.localize(HEADING[kind]), img: order.visibility === "gift" ? null : order.product?.snapshot?.img,
            name, summary,
        });
        const whisper = recipientsFor(kind, order);
        return await ChatMessage.implementation.create({
            content, speaker: ChatMessage.implementation.getSpeaker({ actor: actorOf(order.crafter ?? order.requester) }),
            whisper: setting("chat.visibility") === "public" ? [] : whisper,
            flags: { [MODULE_ID]: { card: { kind, order: order.id } } },
        });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post a ${kind} card`, error);
        return null;
    }
}

/* -------------------------------------------- */
/*  Rendering                                    */
/* -------------------------------------------- */

/** `renderChatMessageHTML`: our cards and the check augment, rendered from stored state. */
export function registerChatHooks() {
    Hooks.on("renderChatMessageHTML", (message, html) => {
        onRender(message, html).catch((error) => console.warn(`${MODULE_ID} | could not render a Workshop card`, error));
    });
    Hooks.on("updateJournalEntry", (doc, changed) => onLedgerChange(doc, changed));
    Hooks.on("deleteItem", (item) => {
        const shelf = item.flags?.[MODULE_ID]?.shelf;
        if (shelf?.order) ordersChanged([shelf.order]);
    });
    // The log renders its first messages before `ready` reads the ledger, so they show only their summaries until now.
    Hooks.on("pf2e-artisans-workshop.status", (now) => {
        if (now === "ready") everyOrderChanged();
    });
    // M5: a "Formula learned" card (10.5) from the client that wrote the formula (12.3: the hook fires only there).
    Hooks.on("pf2e-artisans-workshop.formulaAcquired", ({ actor, uuid, route, added }) => {
        if (added) postFormulaCard(actor, uuid, route);
    });
    // M7: the Morning summary (after a preparation) and the Expiry card (items marked inert), from the client that wrote them.
    Hooks.on("pf2e-artisans-workshop.morningSummary", ({ actor, result }) => postMorningCard(actor, result));
    Hooks.on("pf2e-artisans-workshop.itemsExpired", ({ holder, items }) => postExpiryCard(holder, items));
}

/** Why an item expired, in words (7.7). */
const EXPIRY_REASON = Object.freeze({
    cycle: "pf2e-artisans-workshop.Expiry.Reason.Cycle",
    time: "pf2e-artisans-workshop.Expiry.Reason.Time",
    day: "pf2e-artisans-workshop.Expiry.Reason.Day",
    spoiled: "pf2e-artisans-workshop.Expiry.Reason.Spoiled",
    turn: "pf2e-artisans-workshop.Expiry.Reason.Turn",
    "combat-end": "pf2e-artisans-workshop.Expiry.Reason.CombatEnd",
});

/** Who a Morning or Expiry card goes to: the actor's owners and GMs, or everyone (`chat.visibility`). */
function whisperFor(actor) {
    if (setting("chat.visibility") === "public") return [];
    return [...new Set([...game.users.filter((u) => u.isGM).map((u) => u.id), ...ownersOf(actor).map((u) => u.id), game.user.id])];
}

/**
 * The Morning summary card (10.5, M7): what the preparation made, by item, the DC stamp, the standing orders delivered
 * and when it all expires. A summary only, from the client that prepared.
 */
export async function postMorningCard(actor, result) {
    try {
        const counts = new Map();
        for (const c of result.created ?? []) counts.set(c.name, (counts.get(c.name) ?? 0) + (c.qty ?? 0));
        const lines = [...counts].map(([item, qty]) => game.i18n.format("pf2e-artisans-workshop.Card.MorningLine", { item, qty: String(qty) }));
        const notes = [];
        if (Number.isInteger(result.dc)) notes.push({ icon: "fa-solid fa-stamp", text: game.i18n.format("pf2e-artisans-workshop.Card.MorningDc", { dc: String(result.dc) }) });
        for (const d of (result.deliveries ?? []).filter((x) => x.ok && x.outcome !== "already" && x.outcome !== "self")) {
            notes.push({ icon: "fa-solid fa-truck-ramp-box", text: game.i18n.format(d.direct ? "pf2e-artisans-workshop.Card.MorningDelivered" : "pf2e-artisans-workshop.Card.MorningShelved",
                { item: d.name ?? "", qty: String(d.qty ?? 0), recipient: d.recipient ?? "" }) });
        }
        if (lines.length) notes.push({ icon: "fa-solid fa-hourglass-end", text: game.i18n.localize("pf2e-artisans-workshop.Card.MorningExpiry") });
        const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.morning, {
            kind: "morning", heading: game.i18n.localize("pf2e-artisans-workshop.Card.Morning"), img: actor.img ?? null,
            summary: game.i18n.format(lines.length ? "pf2e-artisans-workshop.Card.Summary.Morning" : "pf2e-artisans-workshop.Card.Summary.MorningNothing", { actor: actor.name }),
            lines, notes,
        });
        return await ChatMessage.implementation.create({
            content, speaker: ChatMessage.implementation.getSpeaker({ actor }), whisper: whisperFor(actor),
            flags: { [MODULE_ID]: { card: { kind: "morning", order: null } } },
        });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post a Morning card`, error);
        return null;
    }
}

/**
 * The Expiry card (10.5, M7): the items a holder lost to expiry in one sweep, whispered to its owners and GMs. Quick
 * Alchemy items, which run out every turn or two (8.8), are left off it: the Bandolier shows them.
 */
export async function postExpiryCard(holder, list) {
    try {
        const items = (list ?? []).filter((i) => !i.quick);
        if (!items.length) return null;
        const lines = items.map((i) => game.i18n.format("pf2e-artisans-workshop.Card.ExpiryLine", {
            item: i.name, creator: fromUuidSync(i.creator ?? "", { strict: false })?.name ?? "",
            why: game.i18n.localize(EXPIRY_REASON[i.reason] ?? EXPIRY_REASON.cycle),
        }));
        const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.morning, {
            kind: "expiry", heading: game.i18n.localize("pf2e-artisans-workshop.Card.Expiry"), img: null,
            summary: game.i18n.format("pf2e-artisans-workshop.Card.Summary.Expiry", { holder: holder.name, n: String(items.length) }), lines, notes: [],
        });
        return await ChatMessage.implementation.create({
            content, speaker: ChatMessage.implementation.getSpeaker({ alias: game.i18n.localize("pf2e-artisans-workshop.Window.Title") }),
            whisper: whisperFor(holder), flags: { [MODULE_ID]: { card: { kind: "expiry", order: null } } },
        });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post an Expiry card`, error);
        return null;
    }
}

/**
 * The "Formula learned" card (10.5, M5): the formula, whose book and how it came (provenance, 4.13). A summary only, from
 * the client that wrote the formula, whispered to the learner's owners and GMs (or public by `chat.visibility`).
 */
export async function postFormulaCard(actor, uuid, route) {
    try {
        const item = fromUuidSync(uuid, { strict: false });
        const name = item?.name ?? uuid;
        const how = game.i18n.localize(PROVENANCE[route]?.key ?? PROVENANCE.unrecorded.key);
        const summary = game.i18n.format("pf2e-artisans-workshop.Card.Summary.Formula", { actor: actor?.name ?? "", item: name, how });
        const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.summary, {
            kind: "formula", order: "", heading: game.i18n.localize("pf2e-artisans-workshop.Card.Formula"), img: item?.img ?? null, name, summary,
        });
        const publicCards = setting("chat.visibility") === "public";
        const whisper = publicCards ? [] : [...new Set([...game.users.filter((u) => u.isGM).map((u) => u.id), ...ownersOf(actor).map((u) => u.id), game.user.id])];
        return await ChatMessage.implementation.create({
            content, speaker: ChatMessage.implementation.getSpeaker({ actor }), whisper,
            flags: { [MODULE_ID]: { card: { kind: "formula", order: null } } },
        });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post a formula card`, error);
        return null;
    }
}

/**
 * The day summary card (10.5, M6), from the client that resolved the days: per PC, the days and what they amounted to
 * (setup days, days of work and what they took off, help, wages), and where a PC's days stopped, with what to do. A
 * summary only; whispered to the PCs' owners and GMs (or public by `chat.visibility`).
 * @param {{actor: Actor, records?: object[], stop?: object|null}[]} results
 */
export async function postDaysCard(results, { toDay = null } = {}) {
    try {
        const pcs = results.filter((r) => r.records?.length || r.stop).map((r) => ({
            name: r.actor.name, span: spanText(r.records ?? []), lines: dayLines(r.records ?? []), stop: stopText(r.stop),
        }));
        if (!pcs.length) return null;
        const content = await foundry.applications.handlebars.renderTemplate(TEMPLATES.days, {
            heading: game.i18n.localize("pf2e-artisans-workshop.Card.Days"),
            summary: Number.isInteger(toDay) ? game.i18n.format("pf2e-artisans-workshop.Card.Summary.Days", { day: String(toDay) }) : "",
            pcs,
        });
        const publicCards = setting("chat.visibility") === "public";
        const users = new Set([...game.users.filter((u) => u.isGM).map((u) => u.id), game.user.id]);
        for (const r of results) for (const user of ownersOf(r.actor)) users.add(user.id);
        return await ChatMessage.implementation.create({
            content, speaker: ChatMessage.implementation.getSpeaker({ alias: game.i18n.localize("pf2e-artisans-workshop.Window.Title") }),
            whisper: publicCards ? [] : [...users], flags: { [MODULE_ID]: { card: { kind: "days", order: null } } },
        });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post a day card`, error);
        return null;
    }
}

async function onRender(message, html) {
    if (!foundry.utils.isElementInstanceOf(html, HTMLElement)) return;
    const card = message.flags?.[MODULE_ID]?.card;
    if (card) return renderCard(message, html, card);
    const link = parseLink(message.flags?.pf2e?.context?.options);
    if (link?.kind === "order") return renderAugment(message, html, link);
    return null;
}

/** Replace a card's summary with its live part. */
async function renderCard(message, html, card) {
    const host = html.querySelector(".pf2e-artisans-workshop-card .pf2e-artisans-workshop-live");
    if (!host) return;
    const order = read(`orders.${card.order}`);
    if (!order) return;
    const context = await orderContext(order);
    // Where the item went (E, As built in M4.1): delivered (and to whom), on the shelf with Collect for the recipient's
    // owners, on its way, or kept in the strongbox. Collect stays until the item is delivered; then the card says so.
    const markup = await foundry.applications.handlebars.renderTemplate(TEMPLATES.card, {
        kind: card.kind, view: context, canCollect: context.canCollect, ready: canWrite(),
    });
    host.innerHTML = markup;
    bindOps(host, order.id);
}

/** The augment under pf2e's check card for an order's Craft check (6.12, 10.5). */
async function renderAugment(message, html, link) {
    const order = read(`orders.${link.id}`);
    if (!order) return;
    const content = html.querySelector(".message-content");
    if (!content) return;
    const context = await orderContext(order);
    const stored = order.check?.messageId === message.id ? order.check : order.conflict?.messageId === message.id ? order.conflict : null;
    const degree = stored?.degree ?? null;
    const sameAttempt = link.attempt === order.attempt;
    const settled = sameAttempt && order.settlement?.attempt === order.attempt;
    const isCheck = sameAttempt && order.check?.messageId === message.id;
    const notUsed = sameAttempt && !isCheck && settled;
    const committed = order.upfrontCp ?? 0;
    const markup = await foundry.applications.handlebars.renderTemplate(TEMPLATES.augment, {
        view: context,
        degreeText: degree === null ? null : game.i18n.localize(DEGREE_KEY[degree]), degreeClass: degree === null ? null : DEGREE_CLASS[degree],
        success: degree >= DEGREE.success, failure: degree === DEGREE.fail, critFailure: degree === DEGREE.critFail,
        salvage: money(committed), ruined: money(degree === DEGREE.critFail ? critFailRuinCp(committed) : 0),
        alchemical: (order.product?.snapshot?.traits ?? []).includes("alchemical"),
        fortune: !!stored?.warn, stale: !sameAttempt,
        canSettle: isCheck && order.status === "rolled" && orders.owns(order.crafter) && canWrite(),
        notUsed, conflict: order.conflict?.messageId === message.id && sameAttempt,
        // "Undo settlement" only while the settlement is the order's last transition (a pause after it is not undone here).
        canUndo: (notUsed || order.conflict?.messageId === message.id) && lastEntry(order)?.event === "settle"
            && undoPlan(order, orders.viewer()).ok && canWrite(),
    });
    content.querySelector(".pf2e-artisans-workshop-augment")?.remove();
    content.insertAdjacentHTML("beforeend", markup);
    bindOps(content.querySelector(".pf2e-artisans-workshop-augment"), order.id);
}

/* -------------------------------------------- */
/*  Buttons                                      */
/* -------------------------------------------- */

/** One click at a time per card: a button is disabled while its action runs. */
function bindOps(root, orderId) {
    if (!root) return;
    for (const button of root.querySelectorAll("button[data-pf2e-artisans-workshop-op]")) {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            if (button.disabled) return;
            button.disabled = true;
            try {
                report(await runOp(button.dataset.pf2eArtisansWorkshopOp, orderId, button));
            } finally {
                button.disabled = false;
            }
        });
    }
}

/**
 * The character a user acts as from a card: their assigned one if it is a member, else their only one. A user with
 * several and none assigned (a GM, say) chooses in the window instead, where "acting as" says who.
 */
function actingActor() {
    const choices = orders.actingChoices();
    return choices.find((actor) => actor === game.user.character) ?? (choices.length === 1 ? choices[0] : null);
}

async function runOp(op, orderId) {
    switch (op) {
        case "open": {
            const { openWorkshop } = await import("./workshop.mjs");
            return openWorkshop({ tab: "queue", order: orderId });
        }
        case "fund": {
            // "Fund this order" from the card: the same choice of source and the four coin fields as in the window (A, B).
            const short = await shortfallNow(orderId);
            if (!short) return null;
            const answer = await askMoney({ kind: "fund", actors: orders.actingChoices(), actor: actingActor()?.uuid ?? null,
                sources: { fundCp: unallocatedCp(records("rows")) },
                fill: short.shortCp > 0 ? { cp: short.shortCp, key: "pf2e-artisans-workshop.Prompt.Fill" } : null });
            return answer ? fundOrder(orderId, answer) : null;
        }
        case "accept": {
            const actor = actingActor();
            if (actor) return orders.accept(orderId, actor.uuid);
            const { openWorkshop } = await import("./workshop.mjs");
            await openWorkshop({ tab: "queue", order: orderId });
            return null;
        }
        case "settle": return orders.settle(orderId);
        case "undo": return orders.undo(orderId, { event: "settle" });
        case "take":
            await sweepClaims({ force: true });
            return { ok: true };
        default: return null;
    }
}

/* -------------------------------------------- */
/*  Keeping cards current                        */
/* -------------------------------------------- */

const changedOrders = new Set();
let everyOrder = false;
let debouncedRefresh = null;

/** The order a message is about: a card's, or the order a Craft check is linked to. */
function orderOfMessage(message) {
    const card = message.flags?.[MODULE_ID]?.card;
    if (card) return card.order ?? null;
    const link = parseLink(message.flags?.pf2e?.context?.options);
    return link?.kind === "order" ? link.id : null;
}

/**
 * Render a message again where it is shown: in the chat log (core then renders its notification and the popout's copy
 * too), or in the popout alone. A message shown nowhere is left alone: `updateMessage` would post it at the bottom of the
 * log, out of order, and the log renders it from the ledger as it is when it gets there.
 */
export function rerenderShown(message) {
    const selector = `.message[data-message-id="${message.id}"]`;
    if (ui.chat.element?.querySelector(selector)) return ui.chat.updateMessage(message);
    const popout = ui.chat.popout;
    if (popout?.rendered && popout.element?.querySelector(selector)) return popout.updateMessage(message);
    return null;
}

/** Re-render, on this client, the shown cards and augments of orders that changed (10.5). */
function rerenderChanged() {
    const ids = new Set(changedOrders);
    const all = everyOrder;
    changedOrders.clear();
    everyOrder = false;
    if (!ui.chat) return;
    for (const message of game.messages) {
        const id = orderOfMessage(message);
        if (id && (all || ids.has(id))) rerenderShown(message);
    }
}

function refreshSoon() {
    debouncedRefresh ??= foundry.utils.debounce(rerenderChanged, 250);
    debouncedRefresh();
}

/** Mark orders changed and re-render their cards shortly. */
export function ordersChanged(ids) {
    for (const id of ids) if (id) changedOrders.add(id);
    if (changedOrders.size) refreshSoon();
}

/** Re-render every shown card and augment shortly: the ledger has just become readable on this client. */
export function everyOrderChanged() {
    everyOrder = true;
    refreshSoon();
}

/** The orders a ledger change touches: their own keys, and the order of any row it writes. */
export function ordersInChange(changed) {
    const flags = changed.flags?.[MODULE_ID] ?? {};
    const ids = new Set(Object.keys(flags.orders ?? {}));
    for (const [rowId, row] of Object.entries(flags.rows ?? {})) {
        const order = row?.order ?? read(`rows.${rowId}`)?.order;
        if (order) ids.add(order);
    }
    return [...ids];
}

function onLedgerChange(doc, changed) {
    if (doc.flags?.[MODULE_ID]?.role !== "ledger") return;
    ordersChanged(ordersInChange(changed));
}
