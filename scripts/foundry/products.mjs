/**
 * What the order lifecycle and the Queue need to know about a product and a crafter (DESIGN.md 4.2.1, 4.3, 6.3, 6.5):
 * plain facts read from pf2e documents, so the gates, routes and batch limits of `scripts/logic/` can run on them.
 *
 * Product facts come from an unsaved copy of the compendium item, prepared by pf2e, so its Price, traits and roll
 * options are the system's own (OQ-2). They are cached by UUID for the session: compendium items do not change while
 * a world runs. Crafter facts are read from the actor every time.
 *
 * M5 adds the other kinds of order (4.2.1 `craftType`, `product.type`): a formula job (invent, reverse-engineer, craft a
 * copy; 6.8), an upgrade to a stronger grade (the difference of the two grades' Prices), a rune etched onto an item (the
 * rune's Price, or the difference to the rune it upgrades, from pf2e's rune items) and a rune transferred between items
 * (6.13), a spell-supplied item with its casting pledges (6.9), and the precious-material share of the up-front materials
 * from the stock earmarked to the order (6.6).
 */
import { MODULE_ID } from "../constants.mjs";
import { batchMax } from "../logic/batches.mjs";
import { ROUTES_WITH_FORMULA, isMagical } from "../logic/core.mjs";
import { craftCost, setupPlan } from "../logic/craft.mjs";
import { craftDC } from "../logic/dc.mjs";
import { familyKey, formulaCoverage } from "../logic/families.mjs";
import { craftRoute, formulaJobPlan, formulaOrderGates } from "../logic/formula-jobs.mjs";
import { craftGates } from "../logic/gates.mjs";
import { materialsCp, orderPrecious, runeLevelProblem } from "../logic/materials.mjs";
import { CLOSED, TARGETED, escrowCp } from "../logic/orders.mjs";
import { castingsOf, spellGate, spellSupply } from "../logic/pledges.mjs";
import {
    batchMultiplier, consumableFix, craftOptions, heldKeys, routeInputs, tools, unlocks,
} from "../logic/registry.mjs";
import {
    etchCheck, etchPriceCp, isRuneItemOf, priceDifferenceCp, runeOf, runeSlug, runesAfterEtch, transferCostCp, transferRunes, usageFits,
} from "../logic/runes.mjs";
import { catalogue } from "./catalogue.mjs";
import { heldKeysOf, ranksOf, toolKeysOf } from "./registry.mjs";
import { shared } from "./state.mjs";
import { records } from "./store.mjs";

const facts = new Map();

/** Scrolls and wands are pf2e's base items by rank (`CONFIG.PF2E.spellcastingItems`): `{kind, rank}` or null. */
function spellcastingOf(uuid) {
    for (const [kind, data] of Object.entries(CONFIG.PF2E?.spellcastingItems ?? {})) {
        if (data?.cantripsOnly) continue;
        for (const [rank, candidate] of Object.entries(data?.compendiumUuids ?? {})) {
            if (candidate === uuid) return { kind, rank: Number(rank) };
        }
    }
    return null;
}

/** The copper value of a prepared item's Price, per item. */
const unitPriceCp = (item) => Math.round((item.price?.value?.copperValue ?? 0) / Math.max(1, item.price?.per ?? 1));

/**
 * Plain facts about a physical item by UUID, or null if it is not one: `{uuid, name, img, type, slug, level, rarity,
 * traits, category, priceCp, per, options, isArtifact, consumableFix, book, usage, spellcasting, material, magical,
 * runes, isSpecific}`. `priceCp` is the prepared item's Price for `per` items.
 */
export async function productFacts(uuid) {
    if (facts.has(uuid)) return facts.get(uuid);
    const doc = typeof uuid === "string" ? await fromUuid(uuid).catch(() => null) : null;
    if (!doc?.isOfType?.("physical")) return null;
    const item = new CONFIG.Item.documentClass(doc.toObject(), {});
    const traits = [...(item.traits ?? [])];
    const result = Object.freeze({
        uuid, name: item.name, img: item.img, type: item.type, slug: item.slug ?? null, level: item.level ?? 0,
        rarity: item.rarity ?? "common", traits, category: item.category ?? null,
        priceCp: item.price?.value?.copperValue ?? 0, per: Math.max(1, item.price?.per ?? 1),
        options: [...item.getRollOptions("item")], isArtifact: traits.includes("artifact"), consumableFix: consumableFix(uuid),
        book: item.system?.publication?.title ?? null, usage: item.system?.usage?.value ?? null, spellcasting: spellcastingOf(uuid),
        material: { type: item.system?.material?.type ?? null, grade: item.system?.material?.grade ?? null }, magical: isMagical({ traits }),
        runes: item.system?.runes ? structuredClone(item.system.runes) : null, isSpecific: !!item.isSpecific,
    });
    facts.set(uuid, result);
    return result;
}

/** The snapshot an order freezes for display and pricing (4.2.1). */
export function snapshotOf(product) {
    const { name, img, level, rarity, traits, priceCp, per } = product;
    return { name, img, level, rarity, traits: [...traits], priceCp, per };
}

/**
 * Plain facts about an item on an actor (a target to upgrade or etch, a rune's source): its runes, material, Hit
 * Points, where it is, and its prepared Price per item. Null when there is no such item.
 */
export function liveItemFacts(item) {
    if (!item?.isOfType?.("physical")) return null;
    return {
        uuid: item.uuid, id: item.id, actorUuid: item.parent?.uuid ?? null, name: item.name, img: item.img, type: item.type,
        slug: item.slug ?? null, sourceId: item.sourceId ?? item._stats?.compendiumSource ?? null, level: item.level ?? 0,
        rarity: item.rarity ?? "common", traits: [...(item.traits ?? [])], usage: item.system?.usage?.value ?? null,
        runes: item.system?.runes ? structuredClone(item.system.runes) : null,
        material: { type: item.system?.material?.type ?? null, grade: item.system?.material?.grade ?? null },
        isSpecific: !!item.isSpecific, priceCp: unitPriceCp(item), quantity: item.quantity ?? 1,
        hp: item.system?.hp ? { value: item.system.hp.value ?? 0, max: item.system.hp.max ?? 0 } : null, hardness: item.system?.hardness ?? 0,
        // What a rune's usage reads (`usageFits`): a weapon's range and damage type, a weapon's or armor's category,
        // group and base item.
        range: item.system?.range ?? null, damageType: item.system?.damage?.damageType ?? null, category: item.system?.category ?? null,
        group: item.system?.group ?? null, baseItem: item.system?.baseItem ?? null,
    };
}

/**
 * Whether pf2e knows a property rune by its key: an unsaved copy of the item, made non-specific and given +4 potency so
 * pf2e values its runes and drops its own Price either way, is dearer with the key than without it. pf2e keeps a key it
 * does not know with no effect and no Price (17 compendium runes have none, among them Energy-Resistant), so etching
 * one would charge for nothing.
 */
function pf2eKnowsProperty(source, key) {
    const probe = (property) => {
        const data = foundry.utils.mergeObject(foundry.utils.deepClone(source), { system: { specific: null, quantity: 1, runes: { potency: 4, property } } },
            { inplace: false });
        delete data._id;
        return unitPriceCp(new CONFIG.Item.documentClass(data, {}));
    };
    return probe([key]) > probe([]);
}

/**
 * The Price of one of pf2e's rune items (`runeOf`'s shape) from the equipment catalogue, by its slug and an etched-onto
 * usage; null when the compendium has no such rune.
 */
async function runePriceCp(rune) {
    const slug = runeSlug(rune);
    const item = (await catalogue()).find((facts) => facts.slug === slug && (facts.usage ?? "").startsWith("etched-onto"));
    return item ? item.priceCp : null;
}

/** The crafter's facts for the gates and the plan: level, ranks, registry keys, tools and known formulas. */
export function crafterFacts(actor) {
    const held = heldKeysOf(actor);
    return {
        actorId: actor.id, uuid: actor.uuid, name: actor.name, level: actor.level ?? 0, ranks: ranksOf(actor), held,
        toolKeys: toolKeysOf(actor), unlocks: unlocks(held),
        formulas: (actor.system?.crafting?.formulas ?? []).map((formula) => formula.uuid),
        free: actor.flags?.pf2e?.freeCrafting === true,
        items: actor.items ?? [],
    };
}

/** Registry keys of the gear in the strongbox, which counts for tools wherever the crafter is (G7). */
function strongboxToolKeys() {
    const box = shared().strongbox;
    if (!box) return [];
    return heldKeys(box.items.map((item) => ({ sourceId: item.sourceId ?? null, slug: item.slug ?? null, selections: {} })));
}

/* -------------------------------------------- */
/*  Custody (G10)                                */
/* -------------------------------------------- */

/** The order's custody line for a purpose ("target", "source", "possession"), if an item was handed over (M5). */
export const custodyLine = (order, purpose) =>
    Object.values(order?.custody ?? {}).find((line) => line?.purpose === purpose && !line.returned) ?? null;

/**
 * The item an order works on: the one handed over to the strongbox for it, else the one named at filing (an item the
 * crafter holds). `slot` "target" for the item etched, upgraded or receiving a rune; "source" for the item a rune is
 * transferred from.
 */
export function targetOf(order, slot = "target") {
    const line = custodyLine(order, slot);
    const uuid = line?.uuid ?? (slot === "target" ? order.target : order.variant?.transfer?.source ?? null);
    return typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null;
}

/**
 * Whether an item is in the order's custody (G10, GM Core p.225): on the crafter, or in the strongbox earmarked to this
 * order.
 */
export function inCustody(order, item) {
    if (!item) return false;
    if (order.crafter && item.parent?.uuid === order.crafter) return true;
    return item.parent === shared().strongbox && item.flags?.[MODULE_ID]?.earmark?.order === order.id;
}

/** Whether the crafter holds the item to reverse-engineer: one made from the formula's UUID, or one handed over (6.8). */
function possesses(order, crafter, uuid) {
    const line = custodyLine(order, "possession");
    if (line && inCustody(order, fromUuidSync(line.uuid, { strict: false }))) return true;
    return (crafter.items ?? []).some((item) => (item.sourceId ?? item._stats?.compendiumSource) === uuid);
}

/** Whether another open etching order works on the same item (G12: one rune etched at a time, GM Core p.225). */
function etchingElsewhere(order, itemUuid) {
    return records("orders").some((other) => other.id !== order.id && other.craftType === "rune-etch" && !CLOSED.includes(other.status) &&
        ["setup", "check", "rolled", "finishing", "paused"].includes(other.status) && (targetOf(other)?.uuid ?? other.target) === itemUuid);
}

/* -------------------------------------------- */
/*  Routes and plans                             */
/* -------------------------------------------- */

/**
 * The route a crafter would take for a product (4.3): its own formula, one of its family (6.4), a virtual formula, or
 * none (common items, or access through the registry). Family candidates are found by name first and only then
 * loaded, so a long formula book is not read whole.
 */
export async function routeFor(crafter, product, rules) {
    const known = crafter.formulas.includes(product.uuid);
    let family = false;
    if (!known) {
        const target = { ...product, ownFormulaPerType: false };
        const key = familyKey({ name: product.name, type: product.type, category: product.category ?? "" });
        const candidates = [];
        for (const uuid of crafter.formulas) {
            const entry = fromUuidSync(uuid, { strict: false });
            if (!entry?.name || familyKey({ name: entry.name, type: entry.type, category: product.category ?? "" }) !== key) continue;
            const facts = await productFacts(uuid);
            if (facts) candidates.push(facts);
        }
        family = formulaCoverage(candidates, target, rules)?.route === "family";
    }
    const options = craftOptions({ item: product.options, held: crafter.held });
    const inputs = routeInputs(crafter.held, product, options, crafter.level, rules);
    return craftRoute({ known, family, virtual: inputs.virtual, rarity: product.rarity, accessGrant: inputs.accessGrant }, rules);
}

const pwolOn = () => game.pf2e?.settings?.variants?.pwol?.enabled === true;

/** The runes an item would have with only `rune` on it: what a runestone holds for a transfer. */
const runeAlone = (rune) => (rune.kind === "property" ? { property: [rune.value] } : { [rune.slot]: rune.value });

/** The plan of a Craft-like formula job (6.8): the formula's Price, the job's setup, the item's DC. */
function formulaPlan(order, crafter, product) {
    const plan = formulaJobPlan(order.route, { item: { level: product.level, rarity: product.rarity },
        feats: crafter.held, ranks: crafter.ranks, pwol: pwolOn() });
    const free = crafter.free;
    return { ok: true, priceCp: free ? 0 : plan.priceCp, upfrontCp: free ? 0 : plan.upfrontCp, listPriceCp: plan.priceCp, free,
        setup: plan.setup, dc: plan.dc, route: order.route, batchMax: 1, modifiers: plan.modifiers };
}

/**
 * The Price and DC of an order that changes an item instead of making one (6.13): an upgrade costs the full Price
 * difference at the new level's DC; an etching the rune's Price (less the Price of the rune it upgrades), at the rune's
 * DC; a transfer 10% of the rune's Price (nothing from a runestone), at the rune's DC. A refusal names what is wrong.
 */
async function changePlan(order, product) {
    const target = liveItemFacts(targetOf(order));
    if (!target) return { ok: false, reason: "no-target" };
    // One item, never a stack: the Price is per item and the finish changes, replaces or uses up the item it holds.
    // Handing an item over takes one from its stack (`custody.mjs`); a stack on the crafter must be split first.
    if (target.quantity > 1) return { ok: false, reason: "target-stack", data: { qty: target.quantity } };
    if (order.craftType === "upgrade") {
        const sourceName = target.sourceId ? fromUuidSync(target.sourceId, { strict: false })?.name : null;
        const sameFamily = familyKey({ ...product }) === familyKey({ name: sourceName ?? target.name, type: target.type, category: product.category });
        if (!sameFamily || product.level <= target.level) return { ok: false, reason: "not-upgrade" };
        const diff = priceDifferenceCp(target.priceCp, Math.round(product.priceCp / product.per));
        return diff === null ? { ok: false, reason: "no-price" } : { ok: true, unitCp: diff, level: product.level, rarity: product.rarity, target };
    }
    const rune = runeOf({ slug: product.slug, usage: product.usage });
    if (!rune) return { ok: false, reason: "not-rune" };
    // A rune goes only on an item its usage allows (a melee weapon, light armor, ...): an etching or a transfer onto
    // another is refused (GM Core p.225 makes such a transfer an automatic critical failure).
    if (!usageFits(product.usage, target)) return { ok: false, reason: "wrong-item" };
    // A low- or standard-grade precious item holds runes only up to its grade's level (GM Core p.253).
    const capped = runeLevelProblem(target.material, product.level);
    if (capped) return { ok: false, ...capped };
    if (order.craftType === "rune-etch") {
        const after = runesAfterEtch(target, rune);
        if (!after.ok) return after;
        const source = targetOf(order)?.toObject?.();
        if (rune.kind === "property" && source && !pf2eKnowsProperty(source, rune.value)) return { ok: false, reason: "rune-unsupported", data: { name: product.name } };
        const replacedCp = after.replaces ? await runePriceCp(after.replaces) : 0;
        const diff = replacedCp === null ? null : etchPriceCp({ runeCp: Math.round(product.priceCp / product.per), replacedCp });
        if (diff === null) return { ok: false, reason: "no-price" };
        return { ok: true, unitCp: diff, level: product.level, rarity: product.rarity, target, rune, runes: after.runes,
            check: etchCheck(target, rune, { etching: etchingElsewhere(order, target.uuid), replaces: after.replaces }) };
    }
    const from = liveItemFacts(targetOf(order, "source"));
    if (!from) return { ok: false, reason: "no-source" };
    if (from.quantity > 1) return { ok: false, reason: "target-stack", data: { qty: from.quantity } };
    const transfer = order.variant?.transfer ?? {};
    // The rune's own item (pf2e's rune on a runestone, `isRuneItemOf`) holds the one rune the order names (GM Core p.225:
    // transferring from it is free); it has no `system.runes`, and it is used up rather than changed (`outputs.mjs`). A
    // blank runestone holds nothing, so a transfer from it is refused as `not-there`.
    const fromRunestone = isRuneItemOf(from, product);
    const holder = fromRunestone ? { ...from, type: target.type, runes: runeAlone(rune) } : from;
    const moved = transferRunes({ from: holder, to: target, rune, swap: !fromRunestone && !!transfer.swap, swapWith: transfer.swapWith ?? null });
    if (!moved.ok) return moved;
    const cost = transferCostCp({ runePriceCp: product.priceCp, otherPriceCp: transfer.swapPriceCp ?? 0, fromRunestone });
    const level = Math.max(product.level, transfer.swapLevel ?? 0);
    return { ok: true, unitCp: cost, level, rarity: product.rarity, target, from, fromRunestone, rune, runes: moved.toRunes, fromRunes: moved.fromRunes,
        check: etchCheck({ ...target, runes: { ...target.runes, property: (target.runes?.property ?? []).filter((p) => p !== transfer.swapWith) } }, rune, {
            etching: etchingElsewhere(order, target.uuid), replaces: moved.replaces }) };
}

/**
 * The plan an order would freeze at start (6.2.2) for this crafter: Price and up-front half, setup and DC, the batch
 * limit and route, or a refusal (`quantity`, `no-price`, and for an order that changes an item `no-target`, `no-source`,
 * `target-stack`, `not-upgrade`, `not-rune`, `wrong-item`, `grade-rune-level`, `rune-unsupported`, `not-stronger`,
 * `has-rune`, `not-there`, `occupied`).
 */
export async function planFor(order, crafter, product, rules) {
    if (order.product?.type === "formula") return formulaPlan(order, crafter, product);
    const craftType = order.craftType ?? "item";
    const route = await routeFor(crafter, product, rules);
    const options = craftOptions({ item: product.options, held: crafter.held, route, craftType });
    const targeted = TARGETED.includes(craftType);
    const max = targeted ? 1 : batchMax({ ...product, per: product.per },
        { multiplier: batchMultiplier(crafter.held, options, rules), pledgedCastings: ["probe", "preview"].includes(order.id) ? 4 : castingsOf(order) }, rules);
    if (!Number.isInteger(order.quantity) || order.quantity < 1 || order.quantity > max) {
        return { ok: false, reason: "quantity", data: { max }, route, batchMax: max };
    }
    let cost;
    let level = product.level;
    let rarity = product.rarity;
    let change = null;
    if (targeted) {
        change = await changePlan(order, product);
        if (!change.ok) return { ...change, route, batchMax: max };
        ({ level, rarity } = change);
        cost = change.unitCp === 0 && craftType === "rune-transfer"
            ? { ok: true, priceCp: 0, upfrontCp: 0, listPriceCp: 0, free: false }
            : craftCost({ unitPriceCp: change.unitCp, quantity: 1, free: crafter.free });
    } else {
        cost = craftCost({ unitPriceCp: product.priceCp, per: product.per, quantity: order.quantity, free: crafter.free });
    }
    if (!cost.ok) return { ...cost, route, batchMax: max };
    return {
        ...cost, route, batchMax: max, setup: setupPlan({ route, craftType }, rules), change,
        dc: craftDC({ level, rarity, pwol: pwolOn() }, rules),
    };
}

/** G7's tools for this crafter and Craft: theirs and the strongbox's. */
function toolsFor(crafter, options, rules) {
    return tools([...new Set([...crafter.toolKeys, ...strongboxToolKeys()])], options, rules);
}

/**
 * The gates (6.5) for this crafter starting this order, with the plan they were judged against. The narrative Craft
 * Requirements checklist (G9) has nothing to confirm yet (its parse is a follow-up), so G9 reads the spells only; no
 * crafter is locked as a helper (G11, M6). A formula job uses its own gate set (6.8); an order that changes an item
 * reads custody (G10) and the rune rules (G12); a precious-material product reads the earmarked stock (6.6).
 */
export async function gatesFor(order, crafter, product, orderRows, rules) {
    const plan = await planFor(order, crafter, product, rules);
    const options = craftOptions({ item: product.options, held: crafter.held, route: plan.route, craftType: order.craftType ?? "item" });
    const available = toolsFor(crafter, options, rules);
    const upfrontCp = plan.ok ? plan.upfrontCp : Math.ceil(Math.round((product.priceCp * (order.quantity ?? 1)) / product.per) / 2);
    const coinCp = Math.max(0, escrowCp(orderRows));
    const escrow = coinCp + materialsCp(order);
    const item = { level: product.level, rarity: product.rarity, traits: product.traits, priceCp: product.priceCp, isArtifact: product.isArtifact };
    const crafterGate = { level: crafter.level, ranks: crafter.ranks, feats: crafter.held, unlocks: crafter.unlocks, lockedBy: null };
    if (order.product?.type === "formula") {
        const gates = formulaOrderGates(order.route, {
            crafter: crafterGate, item, tools: { available }, escrowCp: escrow, upfrontCp, orderId: order.id,
            itemHeld: possesses(order, crafter, product.uuid), knowsFormula: crafter.formulas.includes(product.uuid),
        }, rules);
        return { gates, plan };
    }
    const craftType = order.craftType ?? "item";
    const supply = spellSupply(product);
    const spells = supply ? spellGate(order, supply) : {};
    const precious = orderPrecious({ product, crafter: { level: crafter.level, rank: crafter.ranks?.crafting ?? 0 }, order, upfrontCp, coinCp }, rules);
    const custody = TARGETED.includes(craftType)
        ? { targetHeld: inCustody(order, targetOf(order)) && (craftType !== "rune-transfer" || inCustody(order, targetOf(order, "source"))) }
        : {};
    const changeLevel = plan.change?.level ?? product.level;
    const gates = craftGates({
        crafter: crafterGate, item: { ...item, level: changeLevel },
        orderId: order.id, craftType, route: plan.route, accessGrant: routeInputs(crafter.held, product, options, crafter.level, rules).accessGrant,
        tools: { available }, escrowCp: escrow, upfrontCp, precious, spells, custody,
        rune: plan.change?.check ?? null,
    }, rules).map((gate) => (craftType === "rune-transfer" && (gate.id === "G5" || gate.id === "G6")
        ? { id: gate.id, ok: true, reason: null, data: null, unlock: null } : gate));
    if (!plan.ok && plan.reason === "quantity") gates.push({ id: "batch", ok: false, reason: "quantity", data: plan.data, unlock: null });
    else if (!plan.ok && plan.reason !== "no-price") gates.push({ id: "G12", ok: false, reason: plan.reason, data: plan.data ?? {}, unlock: null });
    return { gates, plan };
}

/**
 * Members who could take a requested order now (10.3 "can make it"): their gates pass, leaving out the tools, the
 * materials and the checklist, which a crafter sorts out after accepting. Each `{uuid, name, route}`.
 */
export async function candidatesFor(order, product, members, rules) {
    const out = [];
    const ignored = new Set(["G7", "G8", "G9", "G10", "G11"]);
    for (const actor of members) {
        const crafter = crafterFacts(actor);
        const { gates, plan } = await gatesFor(order, crafter, product, [], rules);
        if (gates.filter((g) => !ignored.has(g.id)).every((g) => g.ok)) {
            out.push({ uuid: actor.uuid, name: actor.name, route: plan.route, formula: ROUTES_WITH_FORMULA.includes(plan.route) });
        }
    }
    return out;
}

/** For tests only. */
export function resetProducts() {
    facts.clear();
}
