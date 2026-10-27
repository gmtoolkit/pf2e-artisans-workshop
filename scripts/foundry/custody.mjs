/**
 * Custody (DESIGN.md 4.7 Earmarked materials, 6.5 G10, 6.6, 10.6, M5): items handed over to the strongbox for an order or
 * a service, and given back. A member hands over an item from a character they own: the item to etch, upgrade or
 * reverse-engineer, the item a rune is transferred from, an item to repair, or precious-material stock counted toward the
 * up-front materials at its Price. The crafter's client can then write it, whoever owns the crafter, since every player
 * owns the strongbox (5.1); nothing waits on the item's owner afterwards.
 *
 * Handing over is one lock-first coin move (5.4) with no coins: a `custody-in` row (or `material-in` for stock, 4.6; both
 * with no amount, the value is the line's), the item deleted from its owner's actor and created in the strongbox with
 * its own id (so the lock request can name its UUID) flagged `flags.MOD.earmark = {order | service, line, purpose, from,
 * by}`, and the line written to the order (`custody.<line>`, or `materials.<line>` for stock) or the service
 * (`custody.<line>`). The lock takes the item at the version it was planned from, so a second hand-over of the same item
 * loses at the lock. Giving back puts the item on the pickup shelf for the actor it came from (5.5), whose client
 * collects it; `deliveredSource` drops the earmark on the way.
 */
import { MODULE_ID } from "../constants.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { stackLockId } from "../logic/lock-first.mjs";
import { stockMaterial } from "../logic/materials.mjs";
import { CLOSED } from "../logic/orders.mjs";
import { itemVersion } from "./coins.mjs";
import { moveCoins } from "./money.mjs";
import { liveItemFacts } from "./products.mjs";
import { componentsExpired } from "../logic/variants.mjs";
import { today } from "./downtime.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { newId, read, stampNow } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/** Purposes an item is handed over for. */
export const PURPOSES = Object.freeze(["target", "source", "possession", "material", "service"]);

/**
 * Order states that take material stock (6.6): those whose next step counts it, the start or a retry (the commit is the
 * up-front half less the stock). Stock handed over once an attempt has committed would lower nothing and be used up at
 * the finish all the same.
 */
export const STOCK_STATUSES = Object.freeze(["requested", "accepted", "failed"]);

/** The record an item is handed over to: `orders.<id>` or `services.<id>`. */
const holderOf = ({ order = null, service = null }) => (order ? { path: `orders.${order}`, key: "order", id: order } : { path: `services.${service}`, key: "service", id: service });

/** The shelf flag that gives an earmarked item back to `from` (or delivers it to a recipient), as a nested update. */
export function shelfUpdate(item, { to, from, order = null, key }) {
    return {
        _id: item.id,
        flags: { [MODULE_ID]: { earmark: null, shelf: { for: to, from, order, claimKey: key, at: stampNow().at } } },
    };
}

/**
 * Hand an item over to the strongbox, earmarked to an order or a service. The user must own the item's actor. A
 * `material` must be precious stock (an ingot, chunk, lumber or branch), handed over before an attempt commits
 * (`STOCK_STATUSES`); its line counts at the item's Price. `quantity` hands over part of a stack (the rest stays with
 * its owner), so stock is used up only as far as it was handed over; stock goes whole by default, any other item one
 * at a time (an etching, a transfer, a repair works on one item, never a stack).
 *
 * @param {{order?: string, service?: string, item: string, purpose: string, quantity?: number|null, nonce?: string}} p
 *        `item`: its UUID
 * @returns {Promise<{ok: boolean, line?: string, uuid?: string, reason?: string}>}
 */
export async function handOver({ order = null, service = null, item: itemUuid, purpose, quantity = null, nonce = newId() }) {
    if (!canWrite()) return refuse("not-ready");
    if (!PURPOSES.includes(purpose)) throw new RangeError(`unknown custody purpose ${purpose}`);
    const holder = holderOf({ order, service });
    const record = read(holder.path);
    if (!record) return refuse(order ? "no-order" : "no-service");
    // An order takes items until it closes (a failed one may still be retried); a service only while it is open.
    if (order ? CLOSED.includes(record.status) : record.status !== "open") return refuse("state", { status: record.status });
    if (order && purpose === "material" && !STOCK_STATUSES.includes(record.status)) return refuse("state", { status: record.status });
    const item = fromUuidSync(itemUuid, { strict: false });
    const owner = item?.parent;
    if (!item?.isOfType?.("physical") || !owner) return refuse("no-item");
    if (owner === shared().strongbox) return refuse("in-strongbox");
    if (!owner.isOwner) return refuse("not-owner");
    const facts = liveItemFacts(item);
    // M9a (6.16.5): a deconstructed item's components count as raw materials for one later order, at their credit.
    const components = purpose === "material" && order ? item.flags?.[MODULE_ID]?.components ?? null : null;
    const material = purpose === "material" && !components ? stockMaterial({ slug: facts.slug, traits: facts.traits }) : null;
    if (purpose === "material" && !material && !components) return refuse("not-stock");
    if (components) {
        if (rulesFromSettings().variants.deconstruct !== true) return refuse("variant-off");
        if (componentsExpired(components, today().day)) return refuse("expired");
        if (heldLines(record).some((line) => line.components)) return refuse("one-components");
    }
    const stack = Math.max(1, facts.quantity);
    const qty = components ? 1 : quantity ?? (purpose === "material" ? stack : 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > stack) return refuse("stack", { max: stack });
    const box = shared().strongbox;
    const id = newId();
    const line = newId();
    // A components line counts at its raw credit until the crafter confirms the product similar (`lineValueCp`).
    const valueCp = components ? components.rawCp : facts.priceCp * qty;
    const source = item.toObject();
    source._id = id;
    source.system = { ...source.system, quantity: qty };
    if (source.system.containerId) source.system.containerId = null;
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.earmark`, { [holder.key]: holder.id, line, purpose, from: owner.uuid, by: game.user.id });
    const entry = {
        id: line, purpose, itemId: id, uuid: `${box.uuid}.Item.${id}`, from: owner.uuid, name: item.name, img: item.img, sourceId: facts.sourceId,
        qty, valueCp, material, returned: null, used: null, ...stampNow(),
        ...(components ? { components: { valueCp: components.valueCp, rawCp: components.rawCp, purpose: components.purpose, from: components.from,
            order: components.order } } : {}),
    };
    const field = purpose === "material" ? "materials" : "custody";
    const row = {
        kind: purpose === "material" ? "material-in" : "custody-in", idem: idemKey("custody-in", holder.id, item.id, nonce), cp: 0, actor: owner.uuid,
        order, items: [{ uuid: facts.sourceId, name: item.name, qty, valueCp }],
    };
    // Part of a stack: the owner's stack is reduced (a quantity update, as for coins); the whole stack: it is deleted.
    const debit = qty < stack ? { updates: [{ id: item.id, quantity: stack - qty }] } : { deletes: [item.id] };
    const moved = await moveCoins(() => ({
        rows: [row], debits: [{ target: owner.uuid, plan: debit }], items: [{ target: "strongbox", data: [source] }],
        locks: [stackLockId(item.id, itemVersion(item))],
        ledger: { set: { [`${holder.path}.${field}.${line}`]: entry } },
    }), {}, [row]);
    return moved.ok ? { ok: true, line, uuid: entry.uuid } : moved;
}

/**
 * The item updates and rows that give a record's earmarked items back to where they came from (or, for consumed stock,
 * delete it): what a cancel, a finish or a "give back" writes in its move. `lines` are custody or material lines;
 * `consume` deletes stock instead of returning it (materials used by a success, 6.2.4). Lines whose item is gone from
 * the strongbox are left out (`missing`).
 *
 * @returns {{updates: object[], deletes: string[], rows: object[], marks: object, missing: string[]}}
 */
export function givingBack(holder, lines, { consume = false, ref }) {
    const box = shared().strongbox;
    const updates = [];
    const deletes = [];
    const rows = [];
    const marks = {};
    const missing = [];
    const stamp = stampNow();
    for (const line of lines) {
        const item = box?.items.get(line.itemId);
        if (!item) {
            missing.push(line.id);
            continue;
        }
        const field = line.purpose === "material" ? "materials" : "custody";
        const used = consume && line.purpose === "material";
        if (used) deletes.push(item.id);
        else updates.push(shelfUpdate(item, { to: line.from, from: line.from, order: holder.key === "order" ? holder.id : null, key: idemKey("return", holder.id, line.id, ref) }));
        rows.push({
            kind: line.purpose === "material" ? "material-out" : "custody-out", idem: idemKey(used ? "material-out" : "custody-out", holder.id, line.id, ref), cp: 0,
            actor: line.from, order: holder.key === "order" ? holder.id : null, items: [{ uuid: line.sourceId ?? null, name: line.name, qty: line.qty, valueCp: line.valueCp }],
        });
        marks[`${holder.path}.${field}.${line.id}.${used ? "used" : "returned"}`] = stamp;
    }
    return { updates, deletes, rows, marks, missing };
}

/**
 * Give one handed-over item back before its record needs it (a target an order no longer works on, stock not wanted):
 * the order's requester's or crafter's owners, the item's former owner, or a GM, while the order has not started (or has
 * failed) or the service is open. One coin move with no coins: the item goes on the pickup shelf for its former owner.
 */
export async function giveBack({ order = null, service = null, line: lineId }) {
    if (!canWrite()) return refuse("not-ready");
    const holder = holderOf({ order, service });
    const record = read(holder.path);
    if (!record) return refuse(order ? "no-order" : "no-service");
    const line = record.custody?.[lineId] ?? record.materials?.[lineId];
    if (!line || line.returned || line.used) return refuse("no-line");
    const owns = (uuid) => !!uuid && fromUuidSync(uuid, { strict: false })?.isOwner === true;
    if (!(game.user.isGM || owns(line.from) || owns(record.requester) || owns(record.crafter ?? record.performer))) return refuse("not-owner");
    if (order && !["requested", "accepted", "failed", "cancelled", "complete"].includes(record.status)) return refuse("state", { status: record.status });
    const back = givingBack(holder, [line], { ref: newId() });
    if (back.missing.length) return refuse("gone");
    // One give-back per line: a second (a double click, two users at once) loses at this lock.
    const moved = await moveCoins(() => ({
        rows: back.rows, itemUpdates: [{ target: "strongbox", updates: back.updates }], ledger: { set: back.marks },
        locks: [hashId(idemKey("give-back", holder.id, line.id))],
    }), {}, back.rows);
    return moved.ok ? { ok: true } : moved;
}

/** The live custody and material lines of an order or a service (not given back, not used). */
export function heldLines(record) {
    return [...Object.values(record?.custody ?? {}), ...Object.values(record?.materials ?? {})]
        .filter((line) => line && !line.returned && !line.used);
}
