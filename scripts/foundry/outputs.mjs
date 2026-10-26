/**
 * What finishing an order makes (DESIGN.md 4.2.3 finish, 5.5, 6.8, 6.9, 6.13, M5), as the parts of the finish's one
 * lock-first move: items created, items updated or deleted, rows, ledger marks and formula claims.
 *
 * - An item (and a batch): the compendium item on the pickup shelf, as in M4.
 * - A scroll or wand: pf2e's base "Scroll/Wand of Nth-rank Spell" item with the pledged spell in it, built as pf2e builds
 *   one (its own builder is not exported, OQ-15): the spell's source as `system.spell` at the item's rank, the name from
 *   pf2e's own template, the spell's traits and rarity.
 * - A formula job (6.8): no item; a formula claim for the learner (invented, reverse-engineered, or copied into another
 *   book), which the learner's client applies.
 * - An etching, an upgrade or a transfer (6.13): the item worked on, changed, goes to its recipient. On the crafter, for
 *   the crafter, it is changed in place; in the strongbox it is changed there and put on the shelf for the recipient;
 *   on the crafter for someone else it moves to the shelf. An upgrade replaces the item with the stronger grade.
 * - Items handed over for the order and not consumed go back to where they came from (a reverse-engineered item is
 *   kept, Player Core p.294); precious-material stock is consumed (6.6).
 */
import { MODULE_ID } from "../constants.mjs";
import { PROVENANCE } from "../logic/formula-jobs.mjs";
import { idemKey } from "../logic/ids.mjs";
import { stackLockId } from "../logic/lock-first.mjs";
import { pledgedSpell, spellSupply } from "../logic/pledges.mjs";
import { runesUpdate } from "../logic/runes.mjs";
import { itemVersion } from "./coins.mjs";
import { givingBack, heldLines } from "./custody.mjs";
import { formulaClaimInput } from "./formulas.mjs";
import { crafterFacts, inCustody, planFor, productFacts, targetOf } from "./products.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { shared } from "./state.mjs";
import { stampNow } from "./store.mjs";

const empty = () => ({ items: [], itemUpdates: [], debits: [], rows: [], marks: {}, claims: [], locks: [] });

/** The shelf flag of a finished order's item for an actor recipient (5.5). */
function shelfFlag(order) {
    return { for: order.recipient.uuid, from: order.crafter, order: order.id, claimKey: idemKey("deliver", order.id, order.attempt), at: stampNow().at };
}

/** The flags a finished order's item carries: who made it, and the shelf for an actor recipient. */
function madeFlags(order) {
    const flags = { crafted: { order: order.id, attempt: order.attempt, crafter: order.crafter } };
    if (order.recipient?.kind === "actor") flags.shelf = shelfFlag(order);
    return flags;
}

/** A compendium item's source for a finished order: no id, its quantity, its compendium source, the order's flags. */
async function sourceOf(uuid, quantity, order) {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const source = doc.toObject();
    delete source._id;
    source.system = { ...source.system, quantity };
    foundry.utils.setProperty(source, "_stats.compendiumSource", uuid);
    foundry.utils.setProperty(source, `flags.${MODULE_ID}`, madeFlags(order));
    return source;
}

/**
 * A scroll or wand with the pledged spell in it (6.9), from pf2e's base item source: the spell's source as `system.spell`
 * heightened to the item's rank, pf2e's name template, the spell's traits (without `magical` beside a tradition, as pf2e
 * does) and its rarity, and a link to the spell before the base description. Null without a spell.
 */
export async function spellItemSource(base, order, supply) {
    const pledged = pledgedSpell(order);
    const spell = pledged ? (await fromUuid(pledged.source ?? pledged.uuid).catch(() => null)) ?? (await fromUuid(pledged.uuid).catch(() => null)) : null;
    if (!spell) return null;
    const config = CONFIG.PF2E?.spellcastingItems?.[supply.kind];
    const traditions = new Set(Object.keys(CONFIG.PF2E?.magicTraditions ?? {}));
    const source = foundry.utils.deepClone(base);
    const traits = new Set([...(source.system?.traits?.value ?? []), ...(spell.system?.traits?.value ?? [])]);
    if (traits.has("magical") && [...traits].some((t) => traditions.has(t))) traits.delete("magical");
    source.system.traits = { ...source.system.traits, value: [...traits].sort(), rarity: spell.rarity ?? spell.system?.traits?.rarity ?? "common" };
    source.name = config?.nameTemplate ? game.i18n.format(config.nameTemplate, { name: spell.name, level: supply.rank }) : source.name;
    const sourceId = spell.sourceId ?? spell._stats?.compendiumSource ?? spell.uuid;
    source.system.description = { ...source.system.description, value: `<p>@UUID[${sourceId}]{${spell.name}}</p><hr>${source.system.description?.value ?? ""}` };
    source.system.spell = foundry.utils.mergeObject(spell.toObject(), { _id: foundry.utils.randomID(), system: { location: { value: null, heightenedLevel: supply.rank } } },
        { inplace: false });
    return source;
}

/** Where a changed item goes (6.13): in place, changed in the strongbox and shelved, or moved to the shelf. */
function placeChanged(order, item, { change = null, replacement = null }) {
    const out = empty();
    const box = shared().strongbox;
    const toActor = order.recipient?.kind === "actor" ? order.recipient.uuid : null;
    const onCrafter = item.parent?.uuid === order.crafter;
    if (onCrafter && toActor === order.crafter) {
        if (replacement) {
            out.debits.push({ target: order.crafter, plan: { deletes: [item.id] } });
            out.locks.push(stackLockId(item.id, itemVersion(item)));
            const own = foundry.utils.deepClone(replacement);
            delete own.flags[MODULE_ID].shelf;
            out.items.push({ target: order.crafter, data: [own] });
        } else {
            out.itemUpdates.push({ target: order.crafter, updates: [{ _id: item.id, ...change }] });
        }
        return out;
    }
    if (item.parent === box) {
        if (replacement) {
            out.debits.push({ target: "strongbox", plan: { deletes: [item.id] } });
            out.items.push({ target: "strongbox", data: [replacement] });
        } else {
            const flags = { [MODULE_ID]: { earmark: null, ...(toActor ? { shelf: shelfFlag(order) } : {}) } };
            out.itemUpdates.push({ target: "strongbox", updates: [{ _id: item.id, ...change, flags }] });
        }
        return out;
    }
    // On the crafter, for someone else (or the strongbox): it leaves the crafter for the shelf.
    out.debits.push({ target: order.crafter, plan: { deletes: [item.id] } });
    out.locks.push(stackLockId(item.id, itemVersion(item)));
    const moved = replacement ?? foundry.utils.mergeObject(item.toObject(), change ?? {}, { inplace: false });
    delete moved._id;
    foundry.utils.setProperty(moved, `flags.${MODULE_ID}`, { ...(moved.flags?.[MODULE_ID] ?? {}), ...madeFlags(order), earmark: null });
    out.items.push({ target: "strongbox", data: [moved] });
    return out;
}

/** Two sets of outputs as one. */
function merge(a, b) {
    return {
        items: [...a.items, ...b.items], itemUpdates: [...a.itemUpdates, ...b.itemUpdates], debits: [...a.debits, ...b.debits],
        rows: [...a.rows, ...b.rows], marks: { ...a.marks, ...b.marks }, claims: [...a.claims, ...b.claims], locks: [...a.locks, ...b.locks],
    };
}

/**
 * The outputs of finishing an order, or `{refuse}`: "no-product", "no-spell" (a scroll or wand with no spell pledged),
 * "no-target" (the item an etching, upgrade or transfer works on is gone or out of custody), or the plan's reason.
 */
export async function finishOutputs(order) {
    let out = empty();
    const holder = { path: `orders.${order.id}`, key: "order", id: order.id };
    const lines = heldLines(order);
    const ref = `${order.attempt}`;
    const craftType = order.craftType ?? "item";
    if (order.product?.type === "formula") {
        const learner = order.recipient?.uuid;
        if (!learner) return { refuse: "no-actor" };
        out.claims.push(formulaClaimInput({ learner, uuid: order.product.uuid, route: PROVENANCE[order.route], source: order.crafter, order: order.id,
            ref: order.id, parties: [order.requester, order.crafter].filter(Boolean) }));
    } else if (["upgrade", "rune-etch", "rune-transfer"].includes(craftType)) {
        const product = await productFacts(order.product.uuid);
        const crafter = fromUuidSync(order.crafter, { strict: false });
        if (!product || !crafter) return { refuse: "no-product" };
        const plan = await planFor(order, crafterFacts(crafter), product, rulesFromSettings());
        if (!plan.ok) return { refuse: plan.reason };
        const target = targetOf(order);
        if (!target || !inCustody(order, target)) return { refuse: "no-target" };
        if (craftType === "upgrade") {
            const replacement = await sourceOf(order.product.uuid, 1, order);
            if (!replacement) return { refuse: "no-product" };
            out = merge(out, placeChanged(order, target, { replacement }));
        } else {
            out = merge(out, placeChanged(order, target, { change: { system: { runes: runesUpdate(target.type, plan.change.runes) } } }));
            if (craftType === "rune-transfer") {
                const from = targetOf(order, "source");
                if (!from || !inCustody(order, from)) return { refuse: "no-source" };
                const fromChange = { system: { runes: runesUpdate(from.type, plan.change.fromRunes) } };
                if (plan.change.fromRunestone) {
                    // A runestone is used up by the transfer, not left holding an empty set of runes.
                    const inBox = from.parent === shared().strongbox;
                    out.debits.push({ target: inBox ? "strongbox" : from.parent.uuid, plan: { deletes: [from.id] } });
                    if (!inBox) out.locks.push(stackLockId(from.id, itemVersion(from)));
                    const line = lines.find((l) => l.purpose === "source");
                    if (line) {
                        out.marks[`orders.${order.id}.custody.${line.id}.used`] = stampNow();
                        lines.splice(lines.indexOf(line), 1);
                    }
                } else if (from.parent === shared().strongbox) {
                    // The rune's old home goes back to whoever handed it over (6.13), as the order gives back custody.
                    out.itemUpdates.push({ target: "strongbox", updates: [{ _id: from.id, ...fromChange }] });
                } else {
                    out.itemUpdates.push({ target: from.parent.uuid, updates: [{ _id: from.id, ...fromChange }] });
                }
            }
        }
        out.rows.push({ kind: "shelved", idem: idemKey("shelve", order.id, order.attempt), cp: 0, order: order.id,
            actor: order.recipient?.kind === "actor" ? order.recipient.uuid : null, items: [{ uuid: order.product.uuid, name: target.name, qty: 1 }] });
    } else {
        const base = await sourceOf(order.product.uuid, order.quantity, order);
        if (!base) return { refuse: "no-product" };
        const supply = spellSupply(await productFacts(order.product.uuid) ?? {});
        const made = supply && (supply.kind === "scroll" || supply.kind === "wand") ? await spellItemSource(base, order, supply) : base;
        if (!made) return { refuse: "no-spell" };
        out.items.push({ target: "strongbox", data: [made] });
        out.rows.push({ kind: "shelved", idem: idemKey("shelve", order.id, order.attempt), cp: 0, order: order.id,
            actor: order.recipient?.kind === "actor" ? order.recipient.uuid : null, items: [{ uuid: order.product.uuid, name: made.name, qty: order.quantity }] });
    }
    // Handed-over items not changed above go back; the target and source were placed or changed already.
    const back = givingBack(holder, lines.filter((line) => !["target"].includes(line.purpose)), { consume: true, ref });
    const sourceLine = lines.find((line) => line.purpose === "source");
    if (sourceLine) {
        // The source item was updated above; its return to its owner is a shelf flag on the same item.
        const update = back.updates.find((u) => u._id === sourceLine.itemId);
        const changed = out.itemUpdates.find((u) => u.target === "strongbox" && u.updates.some((x) => x._id === sourceLine.itemId));
        if (update && changed) {
            changed.updates = changed.updates.map((x) => (x._id === sourceLine.itemId ? foundry.utils.mergeObject(x, { flags: update.flags }, { inplace: false }) : x));
            back.updates = back.updates.filter((u) => u._id !== sourceLine.itemId);
        }
    }
    const targetLine = lines.find((line) => line.purpose === "target");
    const marks = { ...back.marks, ...(targetLine ? { [`orders.${order.id}.custody.${targetLine.id}.returned`]: stampNow() } : {}) };
    out = merge(out, {
        items: [], itemUpdates: back.updates.length ? [{ target: "strongbox", updates: back.updates }] : [],
        debits: back.deletes.length ? [{ target: "strongbox", plan: { deletes: back.deletes } }] : [], rows: back.rows, marks, claims: [], locks: [],
    });
    return out;
}
