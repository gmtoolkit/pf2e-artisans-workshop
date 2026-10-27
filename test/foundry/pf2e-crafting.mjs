/**
 * A small fake of pf2e's crafting model for the M7 stub tests (DESIGN.md 7.1), as `src/module/actor/character/crafting/`
 * runs it (pf2e dev head be4ab21b, cross-checked against 8.6.1 by DESIGN 7.1):
 * - `CraftingAbility`: `getPreparedCraftingFormulas` drops prepared formulas the book does not know; `setFormulaQuantity`
 *   refuses an increase or a new formula once the slots are spent, clamps an increase to the slots left and refuses one
 *   the pool cannot craft, and rounds an existing formula's quantity up to whole batches (0 unprepares);
 *   `updateFormulas` replaces the prepared list; `toggleFormulaExpended(index, value)` is the sheet's expend toggle;
 *   `craft(uuid, {consume, destination})` makes one batch of a temporary item (nothing for a snare, as pf2e),
 *   infused when alchemical, and adds to an identical stack WITHOUT waiting for the update (pf2e does not await it). With a
 *   `resource` (M8: Quick Alchemy's versatile vials) and `consume`, it takes one through `actor.updateResource`, and makes
 *   nothing, with pf2e's warning, at 0; `destination: "hand"` makes it held, and a held item stacks only with a held stack
 *   of quantity 0 (pf2e's `isStackableWith`).
 * - `CharacterCrafting#performDailyCrafting`: every daily pool's prepared, unexpended formulas, made at once (nothing, with a
 *   warning, when any pool asks for more than its slots); formulas expended; `flags.pf2e.dailyCraftingComplete` set; items added with stacking that compares only `system` data, so a
 *   new output merges into an identical stack whatever its flags (7.1).
 * - Compendium items (`compendiumItem`) with `toObject`, `getRollOptions("item")`, `slug`, `level`, and Foundry's `clone(data,
 *   {keepId})` (14.368 `Document#clone`: the source with `data` merged in, below the top level new keys included, as an
 *   in-memory document of the same pack), which `craft` accepts in place of a UUID as pf2e's does (it makes the new item from
 *   the item's `toObject`).
 */
import { world } from "./stubs.mjs";

/** A predicate over item options, as pf2e's `Predicate#test`: every option in `all`. */
export const predicate = (...all) => ({ test: (options) => all.every((o) => (options.has ? options.has(o) : options.includes(o))) });

/** A compendium item registered for `fromUuid` / `fromUuidSync`. */
export function compendiumItem({ id, name, level = 1, type = "consumable", category = "elixir", traits = ["alchemical", "consumable"], slug = null,
    rarity = "common", description = "", otherTags = [], usage = null, book = "Pathfinder Player Core 2" }) {
    const uuid = `Compendium.pf2e.equipment-srd.Item.${id}`;
    const item = {
        uuid, id, name, type, level, rarity, category, img: `icons/${id}.webp`,
        slug: slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        system: { slug: null, level: { value: level }, traits: { value: [...traits], rarity, otherTags }, category, description: { value: description },
            quantity: 1, temporary: false, usage: { value: usage }, publication: { title: book }, price: { value: { gp: level }, per: 1 } },
        get isAlchemical() { return traits.includes("alchemical"); },
        getRollOptions: () => [`item:type:${type}`, `item:slug:${item.slug}`, ...traits.map((t) => `item:trait:${t}`), `item:level:${level}`,
            `item:rarity:${rarity}`, `item:category:${category}`, ...otherTags.map((t) => `item:tag:${t}`)],
        toObject() {
            return structuredClone({ _id: id, name, type, img: item.img, system: { ...item.system, slug: item.slug }, flags: {} });
        },
        clone(changes = {}, { keepId = false } = {}) {
            const source = mergeSource(item.toObject(), structuredClone(changes));
            if (!keepId) delete source._id;
            return { ...item, uuid: keepId ? uuid : null, system: source.system, flags: source.flags, toObject: () => structuredClone(source), clone: undefined };
        },
    };
    world.uuids.set(uuid, item);
    (world.compendium ??= {})[uuid] = item;
    (world.index ??= []).push({ uuid, name, img: item.img, type, system: { level: { value: level }, traits: { value: [...traits], rarity, otherTags },
        category, slug: item.slug, usage: { value: usage }, publication: { title: book }, price: { value: { gp: level }, per: 1 }, material: {} } });
    return item;
}

/** Foundry's `mergeObject` as `clone` uses it: objects merged, anything else (arrays included) replaced. */
function mergeSource(target, changes) {
    for (const [key, value] of Object.entries(changes)) {
        const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
        if (plain(value) && plain(target[key])) mergeSource(target[key], value);
        else target[key] = value;
    }
    return target;
}

/** A source an actor's item makes from a compendium item, as `ability.calculateDailyCrafting` and `craft` build it. */
function sourceOf(item, quantity) {
    const source = item.toObject();
    delete source._id;
    source.system.quantity = quantity;
    source.system.temporary = true;
    if (item.isAlchemical) source.system.traits.value = [...source.system.traits.value, "infused"].sort();
    return source;
}

/** pf2e's stack test: same type and the same `system` data but the quantity (flags are never compared, 7.1). */
function stackOf(actor, source) {
    const key = (system) => JSON.stringify({ ...system, quantity: 0, equipped: undefined });
    return actor.items.find((i) => i.type === source.type && key(i.system) === key(source.system)) ?? null;
}

export class FakeAbility {
    constructor(actor, { slug, label = slug, isDailyPrep = true, isPrepared = true, maxSlots = 4, maxItemLevel = 20, batchSize = 1,
        craftableItems = [predicate("item:trait:alchemical")], prepared = [], resource = null }) {
        Object.assign(this, { actor, slug, label, isDailyPrep, isPrepared, maxSlots, maxItemLevel, batchSize, resource,
            craftableItems: craftableItems.map((c) => (c.predicate ? c : { predicate: c })), preparedFormulaData: prepared.map((p) => ({ ...p })) });
        this.calls = [];
    }

    known() {
        return new Set((this.actor.system.crafting?.formulas ?? []).map((f) => f.uuid));
    }

    batchFor(item) {
        const options = new Set(item.getRollOptions("item"));
        return this.craftableItems.find((c) => c.predicate.test(options))?.batchSize ?? this.batchSize;
    }

    async getPreparedCraftingFormulas() {
        const known = this.known();
        return this.preparedFormulaData.filter((p) => known.has(p.uuid)).map((p) => {
            const item = world.compendium[p.uuid];
            const batchSize = this.batchFor(item);
            const batches = Math.ceil((p.quantity || 1) / batchSize);
            return { uuid: p.uuid, item, batchSize, batches, quantity: batches * batchSize, expended: !!p.expended };
        });
    }

    /** pf2e's `canCraft`: the pool's predicates and its item level. */
    canCraft(item) {
        const options = new Set(item.getRollOptions("item"));
        return this.craftableItems.some((c) => c.predicate.test(options)) && item.level <= this.maxItemLevel;
    }

    /**
     * pf2e's `setFormulaQuantity` (ability.ts): an increase (or a new formula) is refused once the slots are spent, and
     * clamped to the slots left (`validMaxQuantity`); a new formula keeps the clamped quantity as it is, an existing one is
     * rounded up to whole batches; 0 unprepares.
     */
    async setFormulaQuantity(uuid, value) {
        this.calls.push(["setFormulaQuantity", uuid, value]);
        const prepared = await this.getPreparedCraftingFormulas();
        const consumed = prepared.reduce((sum, p) => sum + p.batches, 0);
        const data = this.preparedFormulaData.find((p) => p.uuid === uuid);
        const item = world.compendium[uuid];
        const batch = item ? this.batchFor(item) : 1;
        const current = data?.quantity ?? 0;
        const increasing = !data || value > current;
        if (consumed >= this.maxSlots && increasing) {
            ui.notifications.warn("PF2E.CraftingTab.Alerts.MaxSlots");
            return;
        }
        const validMax = this.maxSlots ? current + (this.maxSlots - consumed) * batch : Infinity;
        const quantity = Math.min(Math.max(value, 0), validMax);
        if (quantity > current && (!item || !this.canCraft(item))) return;
        if (quantity === 0) {
            this.preparedFormulaData = this.preparedFormulaData.filter((p) => p.uuid !== uuid);
            return;
        }
        if (data) data.quantity = Math.ceil(Math.min(Math.max(quantity, batch), batch * 50) / batch) * batch;
        else this.preparedFormulaData.push({ uuid, quantity });
    }

    async updateFormulas(formulas) {
        this.calls.push(["updateFormulas", formulas]);
        this.preparedFormulaData = formulas.map((f) => ({ ...f }));
    }

    /** pf2e's `toggleFormulaExpended(index, value)`: the sheet's expend toggle on a prepared entry. */
    async toggleFormulaExpended(index, value) {
        this.calls.push(["toggleFormulaExpended", index, value ?? null]);
        const data = this.preparedFormulaData[index];
        data.expended = value ?? !data.expended;
    }

    async craft(itemOrUuid, { consume = true, destination } = {}) {
        const item = typeof itemOrUuid === "string" ? world.compendium[itemOrUuid] : itemOrUuid;
        this.calls.push(["craft", typeof itemOrUuid === "string" ? itemOrUuid : itemOrUuid?.uuid ?? null, consume, destination ?? null]);
        if (!item) return null;
        if (this.resource && consume) {
            const value = this.actor.getResource(this.resource)?.value ?? 0;
            if (!value) {
                ui.notifications.warn("PF2E.Actor.Character.Crafting.MissingResource", { localize: true });
                return null;
            }
            await this.actor.updateResource(this.resource, value - 1);
        }
        // pf2e: "Snares operate under entirely different rules", so `craft` makes nothing for one.
        if (item.system?.traits?.value?.includes("snare")) return null;
        const source = sourceOf(item, this.batchFor(item));
        if (destination === "hand") source.system.equipped = { carryType: "held", handsHeld: 1 };
        const held = (i) => i.system?.equipped?.carryType === "held";
        const stack = destination === "hand"
            ? this.actor.items.find((i) => held(i) && i.quantity === 0 && i.type === source.type && i.name === source.name) ?? null
            : stackOf(this.actor, source);
        if (stack) {
            // pf2e: `stackable.update({...})` without await, then returns the stack.
            setTimeout(() => stack.update({ "system.quantity": stack.quantity + source.system.quantity }), 5);
            return stack;
        }
        const [created] = await this.actor.createEmbeddedDocuments("Item", [source]);
        return created;
    }
}

/** `actor.crafting`: the abilities and daily crafting. */
export class FakeCrafting {
    constructor(actor) {
        this.actor = actor;
        this.abilities = new Map();
        this.abilities[Symbol.iterator] = function* () { yield* this.values(); };
        this.performed = 0;
    }

    add(data) {
        const ability = new FakeAbility(this.actor, data);
        this.abilities.set(ability.slug, ability);
        return ability;
    }

    async performDailyCrafting() {
        this.performed += 1;
        const sources = [];
        const daily = [...this.abilities.values()].filter((a) => a.isDailyPrep);
        let insufficient = false;
        for (const ability of daily) {
            const prepared = await ability.getPreparedCraftingFormulas();
            if (ability.maxSlots > 0 && prepared.reduce((n, p) => n + p.batches, 0) > ability.maxSlots) insufficient = true;
            for (const p of prepared) if (!p.expended) sources.push(sourceOf(p.item, p.quantity));
        }
        if (!sources.length) return;
        // pf2e: any pool asking for more than its slots stops the whole run, with a warning.
        if (insufficient) {
            ui.notifications.warn("PF2E.Actor.Character.Crafting.MissingResource", { localize: true });
            return;
        }
        for (const ability of daily) ability.preparedFormulaData = ability.preparedFormulaData.map((f) => ({ ...f, expended: true }));
        await this.actor.update({ "flags.pf2e.dailyCraftingComplete": true });
        // `inventory.add(items, {stack: true})`: stacks by `system` data, creates the rest.
        const creates = [];
        const updates = new Map();
        for (const source of sources) {
            const stack = stackOf(this.actor, source);
            if (stack) updates.set(stack.id, (updates.get(stack.id) ?? stack.quantity) + source.system.quantity);
            else creates.push(source);
        }
        if (updates.size) await this.actor.updateEmbeddedDocuments("Item", [...updates].map(([_id, quantity]) => ({ _id, "system.quantity": quantity })));
        if (creates.length) await this.actor.createEmbeddedDocuments("Item", creates);
    }
}

/** Give a fake actor pf2e's character surface the Morning reads. */
export function asCharacter(actor, { level = 5, formulas = [], classDc = null, spellDc = null, vials = null, rules = [] } = {}) {
    actor.level = level;
    actor.system = { ...(actor.system ?? {}), crafting: { formulas: formulas.map((uuid) => ({ uuid })) } };
    actor._source = { ...actor._source, system: { crafting: { formulas: formulas.map((uuid) => ({ uuid })) } } };
    actor.crafting = new FakeCrafting(actor);
    actor.classDC = classDc === null ? null : { dc: { value: classDc } };
    actor.spellcasting = { regular: spellDc === null ? [] : [{ statistic: { dc: { value: spellDc } } }] };
    actor.rules = rules;
    actor.synthetics = { resources: vials ? { versatileVials: { itemUUID: vials.itemUUID } } : {} };
    actor.getResource = (slug) => (slug === "versatile-vials" && vials ? { slug, value: vials.value, max: vials.max, label: "Versatile Vials" } : null);
    // Every Foundry actor has a prototype token (`name`, `actor`).
    actor.prototypeToken ??= { name: actor.name, get actor() { return actor; } };
    // pf2e's book is `system.crafting.formulas`; the module appends with `actor.update`, as the crafting tab does.
    const update = actor.update.bind(actor);
    actor.update = async (data, options) => {
        const result = await update(data, options);
        if (data["system.crafting.formulas"]) actor._source.system.crafting.formulas = structuredClone(data["system.crafting.formulas"]);
        return result;
    };
    actor.deleteEmbeddedDocuments = async (_name, ids) => {
        for (const id of ids) actor.items.get(id)?.delete();
        return ids;
    };
    return actor;
}
