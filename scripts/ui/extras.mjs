/**
 * What the Queue shows of M5 (DESIGN.md 4.5, 6.6, 6.9, 6.13, 10.3): on an order's detail, its casting pledges (6.9)
 * with "pledge a casting", "mark cast", "withdraw" and "buy a casting"; the items handed over for it (a target to etch or
 * upgrade, a rune's source, an item to reverse-engineer, precious stock) with "hand over" and "give back"; and below the
 * orders, the service orders (4.5) with "offer", "hand over", "perform" and "cancel". Each button carries `data-action`
 * ("pledgeOp", "custody", "service") and `data-op`; the handlers ask what they need in a dialog and run the Foundry side.
 *
 * As built in M5 on M4.1: money is asked for as M4.1 asks for it (`askMoney`): a bought casting asks where its price is
 * paid from (the party fund or a character's purse), and "Mark cast" asks for a spell's cost, if it has one, in pp, gp,
 * sp and cp with the same choice of source. The words follow M4.1's: a casting is offered, not pledged, and an item
 * handed over is given back to its owner.
 *
 * As built in M9 (`crafts.mjs`): a tattoo's or graft's subject, a fulu's tradition, a finished missive order's blank
 * missives, and the castings an item lists; offering or buying a listed casting picks the entry it supplies.
 */
import { stockMaterial } from "../logic/materials.mjs";
import { TARGETED, WITH_SUBJECT } from "../logic/orders.mjs";
import { castingsOf, livePledges, spellGate, spellSupply } from "../logic/pledges.mjs";
import { serviceActions } from "../logic/services.mjs";
import { STOCK_STATUSES, giveBack, handOver, heldLines } from "../foundry/custody.mjs";
import { actingChoices, viewer as currentViewer } from "../foundry/orders.mjs";
import { buyCasting, castingPrice, fulfilPledge, pledgeCasting, withdrawPledge } from "../foundry/pledges.mjs";
import { custodyLine, inCustody, liveItemFacts, productFacts, targetOf } from "../foundry/products.mjs";
import { fundAvailableCp } from "../foundry/purchases.mjs";
import * as services from "../foundry/services.mjs";
import { read } from "../foundry/store.mjs";
import { money, nameOf, number, report, sourceName } from "./format.mjs";
import { CRAFT_TYPE, PLEDGE_STATUS, PURPOSE, SERVICE, SERVICE_STATUS } from "./labels.mjs";
import { askChoice, askMoney } from "./prompts.mjs";
import { entriesView, listedBuyOptions, listedPledgeOptions, missiveView, subjectView, traditionView } from "./crafts.mjs";
import { variantDetail } from "./variants.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const owns = (uuid) => actorOf(uuid)?.isOwner === true;

/** The kind of an order, when it is not a plain Craft of an item (M5). */
export function kindText(order) {
    if (order.product?.type === "formula") return loc(CRAFT_TYPE.formula);
    const type = order.craftType ?? "item";
    return type === "item" ? null : loc(CRAFT_TYPE[type] ?? CRAFT_TYPE.item);
}

/** The name of the item an order works on (an etching's, an upgrade's, a transfer's target); M9: a tattoo's subject. */
export function targetText(order) {
    if (WITH_SUBJECT.includes(order.craftType)) return actorOf(order.target)?.name ?? null;
    if (!TARGETED.includes(order.craftType) && order.craftType !== "deconstruct") return null;
    return targetOf(order)?.name ?? actorOf(order.target)?.name ?? null;
}

/* -------------------------------------------- */
/*  An order's detail                            */
/* -------------------------------------------- */

/** Items this user could hand over for an order: the target, a transfer's source, an item to reverse-engineer. */
function handOverChoices(order) {
    const out = [];
    const offer = (item, purpose) => {
        if (!item?.parent || item.parent.uuid === order.crafter || !item.parent.isOwner || inCustody(order, item)) return;
        out.push({ uuid: item.uuid, name: item.name, purpose, purposeText: loc(PURPOSE[purpose]) });
    };
    if (TARGETED.includes(order.craftType) || order.craftType === "deconstruct") {
        if (!custodyLine(order, "target")) offer(targetOf(order), "target");
        if (order.craftType === "rune-transfer" && !custodyLine(order, "source")) offer(targetOf(order, "source"), "source");
    }
    if (order.product?.type === "formula" && order.route === "reverse-engineer" && !custodyLine(order, "possession")) {
        const crafter = actorOf(order.crafter);
        const crafterHolds = (crafter?.items ?? []).some((i) => (i.sourceId ?? i._stats?.compendiumSource) === order.product.uuid);
        if (!crafterHolds) {
            for (const actor of actingChoices()) {
                if (actor.uuid === order.crafter) continue;
                for (const item of actor.items) if ((item.sourceId ?? item._stats?.compendiumSource) === order.product.uuid) offer(item, "possession");
            }
        }
    }
    return out;
}

/** What an order's detail drawer shows beyond M4: pledges, spell supply, custody and stock, and what this user may do. */
export async function detailExtras(order) {
    const viewer = currentViewer();
    const product = await productFacts(order.product?.uuid);
    const supply = product && order.product?.type !== "formula" ? spellSupply(product) : null;
    const open = !["complete", "cancelled", "archived", "rolled"].includes(order.status);
    const extras = { kind: kindText(order), target: targetText(order), supply: null, pledges: [], custody: [], handOver: [], stock: false };
    if (supply) {
        const gate = spellGate(order, supply);
        extras.supply = {
            text: fmt("pf2e-artisans-workshop.Pledge.Supply", { kind: loc(CRAFT_TYPE["spell-item"]), needed: number(gate.needed), fulfilled: number(gate.fulfilled) }),
            canPledge: open && actingChoices().some((a) => a.items.some((i) => i.type === "spell")), canBuy: open && viewer.hasCharacter,
        };
        extras.pledges = livePledges(order).concat(Object.values(order.pledges ?? {}).filter((p) => p?.status === "withdrawn")).map((p) => ({
            id: p.id, caster: p.caster ? nameOf(p.caster) : loc("pf2e-artisans-workshop.Pledge.Service"), spell: p.spell?.name ?? "",
            rank: p.rank ?? "", castings: number(p.castings), status: loc(PLEDGE_STATUS[p.status] ?? PLEDGE_STATUS.offered), statusKey: p.status,
            // What it cost and who paid (M5 on M4.1): the party fund, or a member's purse.
            cost: p.costCp ? fmt("pf2e-artisans-workshop.Pledge.CostFrom", { amount: money(p.costCp), source: sourceName(paidBy(p)) }) : null,
            canFulfil: open && p.status === "offered" && owns(p.caster), canWithdraw: open && p.status === "offered" && (viewer.isGM || owns(p.caster)),
            // A wand's spell cost is not paid (GM Core p.282): marking it cast asks for nothing.
            askCost: supply.kind !== "wand" && supply.kind !== "wand-special",
        }));
    }
    const lines = heldLines(order);
    extras.custody = lines.map((line) => ({
        id: line.id, name: line.name, purpose: loc(PURPOSE[line.purpose] ?? PURPOSE.target), from: nameOf(line.from),
        value: line.purpose === "material" ? money(line.valueCp) : null,
        canGiveBack: ["requested", "accepted", "failed"].includes(order.status) && (viewer.isGM || owns(line.from) || owns(order.requester) || owns(order.crafter)),
    }));
    if (open) extras.handOver = handOverChoices(order);
    extras.stock = STOCK_STATUSES.includes(order.status) && !!product?.material?.type && actingChoices().some((a) => stockItems(a).length > 0);
    extras.castings = supply ? number(castingsOf(order)) : null;
    // M9: the subject, a fulu's tradition, missives to compose, the listed castings.
    extras.subject = subjectView(order);
    extras.tradition = traditionView(order, product);
    extras.missives = missiveView(order, product);
    extras.entries = supply ? entriesView(order, supply) : [];
    // M9a (6.16): what the variants that are on add to the detail (null while every one is off).
    extras.variants = await variantDetail(order, product);
    return extras;
}

/** Who paid for a casting: null for the party fund, else the purse's actor (the caster's, by default). */
const paidBy = (pledge) => (pledge.paidFrom === "fund" ? null : pledge.payer ?? pledge.caster ?? null);

/** Precious-material stock a character carries (6.6). */
function stockItems(actor) {
    return actor.items.filter((item) => item.isOfType?.("physical") && stockMaterial({ slug: item.slug, traits: [...(item.traits ?? [])] }));
}

/* -------------------------------------------- */
/*  Services                                     */
/* -------------------------------------------- */

/** What a closed service did, in a sentence. */
function resultText(service) {
    const r = service.result;
    if (!r) return null;
    if (service.kind === "repair") {
        return r.damage ? fmt("pf2e-artisans-workshop.Service.Damaged", { n: number(r.damage), item: r.item ?? "" })
            : fmt("pf2e-artisans-workshop.Service.Restored", { n: number(r.restored ?? 0), item: r.item ?? "" });
    }
    if (service.kind === "affix") return fmt("pf2e-artisans-workshop.Service.Affixed", { item: r.item ?? "", host: r.host ?? "" });
    return null;
}

/** The service orders as the Queue lists them: open ones first, oldest first; then the latest closed ones. */
export function servicesView(all) {
    const viewer = currentViewer();
    const open = all.filter((s) => s.status === "open").sort((a, b) => (a.created?.real ?? 0) - (b.created?.real ?? 0));
    const closed = all.filter((s) => s.status !== "open").sort((a, b) => (b.closed?.real ?? b.at?.real ?? 0) - (a.closed?.real ?? a.at?.real ?? 0)).slice(0, 10);
    return [...open, ...closed].map((service) => {
        const actions = serviceActions(service, viewer);
        const item = actorOf(service.target);
        const status = SERVICE_STATUS[service.status] ?? SERVICE_STATUS.open;
        const handOverItem = service.status === "open" && service.kind === "repair" && item?.parent && item.parent.isOwner &&
            item.parent.uuid !== service.performer && !heldLines(service).length;
        return {
            id: service.id, kind: loc(SERVICE[service.kind] ?? SERVICE.repair), status: service.status, statusWord: loc(status.key), statusIcon: status.icon,
            requester: nameOf(service.requester), performer: service.performer ? nameOf(service.performer) : null,
            item: item?.name ?? (service.uuid ? fromUuidSync(service.uuid, { strict: false })?.name ?? null : null),
            host: service.host ? actorOf(service.host)?.name ?? null : null, note: service.note || null, result: resultText(service),
            actions: { ...actions, handOver: !!handOverItem }, closed: service.status !== "open",
        };
    });
}

/* -------------------------------------------- */
/*  Actions                                      */
/* -------------------------------------------- */

const dataOf = (target) => target.closest("[data-op]")?.dataset ?? {};
const orderOf = (target) => target.closest("[data-order-id]")?.dataset.orderId ?? null;

/** Pledge buttons (`data-action="pledgeOp"`): pledge a casting, mark one cast, withdraw one, buy one. */
export async function onPledgeOp(app, target) {
    const id = orderOf(target);
    const { op, pledge } = dataOf(target);
    // M9: an item that lists its castings (a staff, a spellheart) is offered or bought one listed casting at a time.
    const order = read(`orders.${id}`);
    const product = order ? await productFacts(order.product?.uuid) : null;
    const supply = product ? spellSupply(product) : null;
    const listed = !!supply?.entries?.length;
    switch (op) {
        case "pledge": {
            if (listed) {
                const options = listedPledgeOptions(order, supply);
                const answer = await askChoice({ title: "pf2e-artisans-workshop.Pledge.Title", label: "pf2e-artisans-workshop.Pledge.Entry", options,
                    button: "pf2e-artisans-workshop.Pledge.Button", icon: "fa-solid fa-scroll", app });
                if (!answer?.value) return null;
                const [spell, entry] = answer.value.split("|");
                const caster = options.find((o) => o.value === answer.value)?.caster;
                return report(await pledgeCasting(id, { caster, spell, castings: 1, entry }));
            }
            const options = actingChoices().flatMap((actor) => actor.items.filter((i) => i.type === "spell")
                .map((spell) => ({ value: spell.uuid, name: fmt("pf2e-artisans-workshop.Pledge.CasterSpell", { caster: actor.name, spell: spell.name }), caster: actor.uuid })));
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Pledge.Title", label: "pf2e-artisans-workshop.Pledge.Spell", options,
                number: { label: "pf2e-artisans-workshop.Pledge.Castings", value: 1, min: 1 }, button: "pf2e-artisans-workshop.Pledge.Button", icon: "fa-solid fa-scroll", app });
            if (!answer?.value) return null;
            const caster = options.find((o) => o.value === answer.value)?.caster;
            return report(await pledgeCasting(id, { caster, spell: answer.value, castings: answer.number || 1 }));
        }
        case "fulfil": {
            // A wand's spell cost is not paid, so there is nothing to ask (GM Core p.282).
            if (!target.closest("[data-cost]")) return report(await fulfilPledge(id, pledge));
            const record = read(`orders.${id}.pledges.${pledge}`);
            const caster = record?.payer ?? record?.caster ?? null;
            // A spell's cost, if it has one, in pp, gp, sp and cp, and who pays it (M5 on M4.1); nothing typed is no cost.
            const answer = await askMoney({ kind: "cast", optional: true, actors: actingChoices(), actor: caster,
                sources: { fundCp: fundAvailableCp() }, intro: loc("pf2e-artisans-workshop.Pledge.CostHint"), app });
            if (!answer) return null;
            return report(await fulfilPledge(id, pledge, { costCp: answer.cp, paidFrom: answer.source === "fund" ? "fund" : "purse", payer: answer.actor }));
        }
        case "withdraw":
            return report(await withdrawPledge(id, pledge));
        case "buy": {
            if (listed) {
                const pick = await askChoice({ title: "pf2e-artisans-workshop.Pledge.BuyTitle", label: "pf2e-artisans-workshop.Pledge.Entry",
                    options: listedBuyOptions(order, supply), hint: "pf2e-artisans-workshop.Pledge.BuyHint", button: "pf2e-artisans-workshop.Pledge.BuyNext",
                    icon: "fa-solid fa-coins", app });
                if (!pick?.value) return null;
                const [spell, entry] = pick.value.split("|");
                const price = await castingPrice(id, { spell, castings: 1, entry });
                if (!price.ok) return report(price);
                const pay = await askMoney({ kind: "purchase", fixedCp: price.cp, actors: actingChoices(), actor: app.actingActor?.()?.uuid ?? null,
                    sources: { fundCp: fundAvailableCp() }, app,
                    intro: fmt("pf2e-artisans-workshop.Prompt.Intro.Casting", { castings: number(1), spell: price.spell.name, rank: String(price.rank), amount: money(price.cp) }) });
                if (!pay) return null;
                return report(await buyCasting(id, { payer: pay.actor, paidFrom: pay.source === "fund" ? "fund" : "purse", spell, castings: 1, entry }));
            }
            // The spell and how many castings first; then its price, and where that is paid from (M5 on M4.1).
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Pledge.BuyTitle", text: { label: "pf2e-artisans-workshop.Pledge.SpellName" },
                number: { label: "pf2e-artisans-workshop.Pledge.Castings", value: 1, min: 1 }, hint: "pf2e-artisans-workshop.Pledge.BuyHint",
                button: "pf2e-artisans-workshop.Pledge.BuyNext", icon: "fa-solid fa-coins", app });
            if (!answer?.text) return null;
            const spell = await findSpell(answer.text);
            if (!spell) return report({ ok: false, reason: "no-spell" });
            const castings = answer.number || 1;
            const price = await castingPrice(id, { spell, castings });
            if (!price.ok) return report(price);
            const pay = await askMoney({ kind: "purchase", fixedCp: price.cp, actors: actingChoices(), actor: app.actingActor?.()?.uuid ?? null,
                sources: { fundCp: fundAvailableCp() }, app,
                intro: fmt("pf2e-artisans-workshop.Prompt.Intro.Casting", { castings: number(castings), spell: price.spell.name, rank: String(price.rank),
                    amount: money(price.cp) }) });
            if (!pay) return null;
            return report(await buyCasting(id, { payer: pay.actor, paidFrom: pay.source === "fund" ? "fund" : "purse", spell, castings }));
        }
        default: return null;
    }
}

/** A compendium spell by name, from pf2e's spells pack: an exact name first, else the first that contains it. */
async function findSpell(text) {
    const pack = game.packs?.get("pf2e.spells-srd");
    if (!pack) return null;
    const index = await pack.getIndex();
    const needle = text.trim().toLowerCase();
    const exact = index.find((e) => e.name.toLowerCase() === needle);
    return (exact ?? index.find((e) => e.name.toLowerCase().includes(needle)))?.uuid ?? null;
}

/** Custody buttons (`data-action="custody"`): hand over an item, add stock, give back a line. */
export async function onCustodyOp(app, target) {
    const id = orderOf(target);
    const service = target.closest("[data-service-id]")?.dataset.serviceId ?? null;
    const { op, item, purpose, line } = dataOf(target);
    switch (op) {
        case "hand-over":
            return report(await handOver({ order: service ? null : id, service, item, purpose }));
        case "stock": {
            // Part of a stack may go (6.6): only what is handed over counts, and only that is used up.
            const options = actingChoices().flatMap((actor) => stockItems(actor).map((i) => ({ value: i.uuid, name: fmt("pf2e-artisans-workshop.Custody.StockOf",
                { actor: actor.name, item: i.name, qty: number(Math.max(1, i.quantity ?? 1)), value: money(liveItemFacts(i).priceCp) }) })));
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Custody.StockTitle", label: "pf2e-artisans-workshop.Custody.Stock", options,
                number: { label: "pf2e-artisans-workshop.Custody.StockQuantity", min: 1, value: 1 }, hint: "pf2e-artisans-workshop.Custody.StockHint",
                button: "pf2e-artisans-workshop.Custody.HandOver", icon: "fa-solid fa-cubes", app });
            return answer?.value ? report(await handOver({ order: id, item: answer.value, purpose: "material", quantity: answer.number ?? 1 })) : null;
        }
        case "give-back":
            return report(await giveBack({ order: service ? null : id, service, line }));
        default: return null;
    }
}

/** Service buttons (`data-action="service"`): offer, hand over the item, perform, cancel. */
export async function onServiceOp(app, target) {
    const id = target.closest("[data-service-id]")?.dataset.serviceId;
    const { op } = dataOf(target);
    const service = read(`services.${id}`);
    if (!service) return null;
    switch (op) {
        case "offer": {
            const actor = app.actingActor();
            return report(actor ? await services.offer(id, actor.uuid) : { ok: false, reason: "not-owner" });
        }
        case "hand-over":
            return report(await handOver({ service: id, item: service.target, purpose: "service" }));
        case "perform":
            return report(await services.perform(id));
        case "cancel":
            return report(await services.cancel(id));
        default: return null;
    }
}
