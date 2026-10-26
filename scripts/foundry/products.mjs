/**
 * What the order lifecycle and the Queue need to know about a product and a crafter (DESIGN.md 4.2.1, 4.3, 6.3, 6.5):
 * plain facts read from pf2e documents, so the gates, routes and batch limits of `scripts/logic/` can run on them.
 *
 * Product facts come from an unsaved copy of the compendium item, prepared by pf2e, so its Price, traits and roll
 * options are the system's own (OQ-2). They are cached by UUID for the session: compendium items do not change while
 * a world runs. Crafter facts are read from the actor every time.
 */
import { batchMax } from "../logic/batches.mjs";
import { ROUTES_WITH_FORMULA } from "../logic/core.mjs";
import { craftCost, setupPlan } from "../logic/craft.mjs";
import { craftDC } from "../logic/dc.mjs";
import { familyKey, formulaCoverage } from "../logic/families.mjs";
import { craftRoute } from "../logic/formula-jobs.mjs";
import { craftGates } from "../logic/gates.mjs";
import { escrowCp } from "../logic/orders.mjs";
import {
    batchMultiplier, consumableFix, craftOptions, heldKeys, routeInputs, tools, unlocks,
} from "../logic/registry.mjs";
import { heldKeysOf, ranksOf, toolKeysOf } from "./registry.mjs";
import { shared } from "./state.mjs";

const facts = new Map();

/**
 * Plain facts about a physical item by UUID, or null if it is not one: `{uuid, name, img, type, slug, level, rarity,
 * traits, category, priceCp, per, options, isArtifact, consumableFix, book}`. `priceCp` is the prepared item's Price
 * for `per` items.
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
        book: item.system?.publication?.title ?? null,
    });
    facts.set(uuid, result);
    return result;
}

/** The snapshot an order freezes for display and pricing (4.2.1). */
export function snapshotOf(product) {
    const { name, img, level, rarity, traits, priceCp, per } = product;
    return { name, img, level, rarity, traits: [...traits], priceCp, per };
}

/** The crafter's facts for the gates and the plan: level, ranks, registry keys, tools and known formulas. */
export function crafterFacts(actor) {
    const held = heldKeysOf(actor);
    return {
        actorId: actor.id, uuid: actor.uuid, name: actor.name, level: actor.level ?? 0, ranks: ranksOf(actor), held,
        toolKeys: toolKeysOf(actor), unlocks: unlocks(held),
        formulas: (actor.system?.crafting?.formulas ?? []).map((formula) => formula.uuid),
        free: actor.flags?.pf2e?.freeCrafting === true,
    };
}

/** Registry keys of the gear in the strongbox, which counts for tools wherever the crafter is (G7). */
function strongboxToolKeys() {
    const box = shared().strongbox;
    if (!box) return [];
    return heldKeys(box.items.map((item) => ({ sourceId: item.sourceId ?? null, slug: item.slug ?? null, selections: {} })));
}

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

/**
 * The plan an order would freeze at start (6.2.2) for this crafter: Price and up-front half, setup and DC, the batch
 * limit and route, or a refusal (`quantity`, `no-price`).
 */
export async function planFor(order, crafter, product, rules) {
    const route = await routeFor(crafter, product, rules);
    const options = craftOptions({ item: product.options, held: crafter.held, route });
    const max = batchMax({ ...product, per: product.per }, { multiplier: batchMultiplier(crafter.held, options, rules) }, rules);
    if (!Number.isInteger(order.quantity) || order.quantity < 1 || order.quantity > max) {
        return { ok: false, reason: "quantity", data: { max }, route, batchMax: max };
    }
    const cost = craftCost({ unitPriceCp: product.priceCp, per: product.per, quantity: order.quantity, free: crafter.free });
    if (!cost.ok) return { ...cost, route, batchMax: max };
    const pwol = game.pf2e?.settings?.variants?.pwol?.enabled === true;
    return {
        ...cost, route, batchMax: max, setup: setupPlan({ route }, rules),
        dc: craftDC({ level: product.level, rarity: product.rarity, pwol }, rules),
    };
}

/**
 * The gates (6.5) for this crafter starting this order, with the plan they were judged against. In M4 the narrative
 * Craft Requirements checklist (G9) has nothing to confirm yet, custody (G10) applies only to craft types M5 adds, and
 * no crafter is locked as a helper (G11, M6).
 */
export async function gatesFor(order, crafter, product, orderRows, rules) {
    const plan = await planFor(order, crafter, product, rules);
    const options = craftOptions({ item: product.options, held: crafter.held, route: plan.route });
    const available = tools([...new Set([...crafter.toolKeys, ...strongboxToolKeys()])], options, rules);
    const upfrontCp = plan.ok ? plan.upfrontCp : Math.ceil(Math.round((product.priceCp * order.quantity) / product.per) / 2);
    const gates = craftGates({
        crafter: { level: crafter.level, ranks: crafter.ranks, feats: crafter.held, unlocks: crafter.unlocks, lockedBy: null },
        item: { level: product.level, rarity: product.rarity, traits: product.traits, priceCp: product.priceCp, isArtifact: product.isArtifact },
        orderId: order.id, route: plan.route, accessGrant: routeInputs(crafter.held, product, options, crafter.level, rules).accessGrant,
        tools: { available }, escrowCp: Math.max(0, escrowCp(orderRows)), upfrontCp,
    }, rules);
    if (!plan.ok && plan.reason === "quantity") gates.push({ id: "batch", ok: false, reason: "quantity", data: plan.data, unlock: null });
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
