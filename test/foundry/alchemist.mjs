/**
 * A fake pf2e alchemist for the M8 stub tests (DESIGN.md 8), on top of `pf2e-crafting.mjs`, as the pf2e source runs it
 * (dev head be4ab21b; 8.6.1 by DESIGN 3.3):
 * - versatile vials as pf2e's `SpecialResource` with an `itemUUID` keeps them: the value is the quantity of the first item
 *   whose `sourceId` is the Versatile Vial (`_stats.duplicateSource ?? _stats.compendiumSource`), and `updateResource`
 *   clamps to the maximum and writes that item's quantity;
 * - the `quick-alchemy` `CraftingAbility` with its resource (`craft` takes a vial, and makes nothing at 0);
 * - `system.actions`: a Strike for each weapon, with pf2e's three multiple attack penalty variants, whose `roll` records
 *   what it was given and the roll options the actor had then;
 * - `toggleRollOption(domain, option, itemId, value, suboption)` and `rollOptions`, `applyDamage`, `skills.crafting.roll`;
 * - items with `sourceId` (from `_stats`, unless the data names one), `level`, `getRollOptions("item")` and `consume()`;
 * - `createEmbeddedDocuments` fires core's `createItem` for each item made, with the creating user's id, as the client that
 *   created them sees it.
 */
import { world } from "./stubs.mjs";
import { asCharacter, compendiumItem, predicate } from "./pf2e-crafting.mjs";

export const VIAL_UUID = "Compendium.pf2e.equipment-srd.Item.ljT5pe8D7rudJqus";

/** The compendium M8 tests read: elixirs of life, a bomb, a mutagen, a potion (not alchemical). */
export function seedCombatCompendium() {
    world.index = [];
    world.compendium = {};
    const healing = ["alchemical", "consumable", "elixir", "healing"];
    const elixir = (id, grade, level, formula) => {
        const item = compendiumItem({ id, name: `Elixir of Life (${grade})`, level, traits: healing });
        item.system.damage = { formula, kind: "healing", type: "untyped" };
        return item;
    };
    const fire = compendiumItem({ id: "alchemistsFire01", name: "Alchemist's Fire (Lesser)", level: 1, type: "weapon", category: "bomb",
        traits: ["alchemical", "bomb", "consumable", "fire", "splash"] });
    fire.system.splashDamage = { value: 1 };
    return {
        minor: elixir("elixirMinor00001", "Minor", 1, "1d6"),
        lesser: elixir("elixirLesser0001", "Lesser", 5, "3d6+6"),
        moderate: elixir("elixirModerate01", "Moderate", 9, "5d6+12"),
        greater: elixir("elixirGreater001", "Greater", 13, "7d6+18"),
        fire,
        mutagen: compendiumItem({ id: "bestialMutagen01", name: "Bestial Mutagen (Lesser)", level: 1, category: "mutagen", traits: ["alchemical", "consumable", "elixir", "mutagen"] }),
        potion: compendiumItem({ id: "healingPotion001", name: "Healing Potion (Minor)", level: 1, category: "potion", traits: ["consumable", "healing", "magical", "potion"] }),
    };
}

/** Give items pf2e's `sourceId`, `level`, `getRollOptions` and `consume` (the fake world's items have none of them). */
export function physicalItems(actor) {
    const add = actor.addItem.bind(actor);
    actor.addItem = (data) => {
        const item = add(data);
        if (!Object.hasOwn(item, "sourceId")) {
            Object.defineProperty(item, "sourceId", { get: () => item._stats?.duplicateSource ?? item._stats?.compendiumSource ?? null, configurable: true });
        }
        Object.defineProperty(item, "level", { get: () => item.system?.level?.value ?? 0, configurable: true });
        // Methods, not data: `toObject` copies an item's own enumerable properties.
        const method = (name, fn) => Object.defineProperty(item, name, { value: fn, configurable: true, enumerable: false });
        method("getRollOptions", () => [`item:type:${item.type}`, `item:slug:${item.slug}`, ...(item.system?.traits?.value ?? []).map((t) => `item:trait:${t}`),
            `item:level:${item.level}`]);
        method("consume", async () => {
            world.consumed.push([actor.id, item.id, item.name]);
            if (item.quantity <= 1) await item.delete();
            else await item.update({ "system.quantity": item.quantity - 1 });
        });
        return item;
    };
    const create = actor.createEmbeddedDocuments.bind(actor);
    actor.createEmbeddedDocuments = async (name, data, options = {}) => {
        const made = await create(name, data, options);
        for (const item of made) Hooks.callAll("createItem", item, options, game.user.id);
        return made;
    };
    return actor;
}

/**
 * A pf2e alchemist: Quick Alchemy with its versatile vials (`vials` of `max`), the feats named by registry key (their
 * compendium UUIDs), the formulas, and a Strike for each weapon.
 */
export function asAlchemist(actor, { level = 10, formulas = [], feats = [], vials = 5, max = 6, int = 4, vialLevel = 4, registry } = {}) {
    physicalItems(actor);
    asCharacter(actor, { level, formulas });
    for (const key of feats) actor.addItem({ type: "feat", name: key, sourceId: registry[key].uuid, system: { slug: key } });
    if (vials !== null) {
        actor.addItem({ type: "weapon", name: "Versatile Vial", _stats: { compendiumSource: VIAL_UUID }, system: { slug: "versatile-vial", quantity: vials,
            level: { value: vialLevel }, traits: { value: ["acid", "alchemical", "bomb", "consumable", "infused", "splash"] }, equipped: { carryType: "worn" } } });
    }
    const vialItem = () => actor.items.find((i) => i.sourceId === VIAL_UUID) ?? null;
    actor.synthetics = { resources: vials === null ? {} : { versatileVials: { itemUUID: VIAL_UUID } } };
    actor.getResource = (slug) => (slug === "versatile-vials" && vials !== null ? { slug, value: Math.min(vialItem()?.quantity ?? 0, max), max, label: "Versatile Vials" } : null);
    actor.updateResource = async (slug, value) => {
        world.calls.push(["updateResource", actor.id, slug, value]);
        const item = vialItem();
        if (item) await item.update({ "system.quantity": Math.min(Math.max(value, 0), max) });
    };
    actor.crafting.add({ slug: "quick-alchemy", label: "Quick Alchemy", isDailyPrep: false, isPrepared: false, maxSlots: 0, maxItemLevel: level, batchSize: 1,
        resource: "versatile-vials", craftableItems: [predicate("item:trait:alchemical", "item:trait:consumable")] });
    actor.abilities = { int: { mod: int } };
    actor.rollOptions = {};
    actor.toggleRollOption = async (domain, option, itemId, value, suboption = null) => {
        world.toggles.push([actor.id, domain, option, value, suboption]);
        (actor.rollOptions[domain] ??= {})[option] = value;
        return value;
    };
    actor.applyDamage = async ({ damage, token }) => {
        world.damage.push([actor.id, damage, token?.id ?? null]);
        return actor;
    };
    actor.getActiveTokens = () => [];
    actor.skills = { crafting: { slug: "crafting", rank: 2, roll: async (params) => {
        world.checks.push([actor.id, params]);
        return world.nextCheck ?? { total: 20, degreeOfSuccess: 2 };
    } } };
    Object.defineProperty(actor.system, "actions", { configurable: true, get: () => actor.items.filter((i) => i.type === "weapon").map((item) => ({
        type: "strike", item, variants: [0, 1, 2].map((map) => ({
            label: map ? `+${10 - 5 * map} (MAP -${5 * map})` : "+10",
            roll: async (params) => {
                world.strikes.push({ actor: actor.id, item: item.id, map, params, options: structuredClone(actor.rollOptions) });
                return { total: 18 };
            },
        })),
    })) });
    return actor;
}

/** An encounter of token-less combatants in initiative order, started, at round 1 turn 0, in `game.combats`. */
export function encounter(id, actors) {
    const combatants = actors.map((actor, i) => ({ id: `${id}k${i}`, actor, actorId: actor.id, token: null }));
    const combat = { id, started: true, active: true, round: 1, turn: 0, combatants, turns: combatants };
    game.combats.set(id, combat);
    return combat;
}

/** Move an encounter to `round` and `turn`, and fire core's `combatTurnChange` on this client. */
export function turnTo(combat, round, turn) {
    const previous = { round: combat.round, turn: combat.turn, combatantId: combat.turns[combat.turn]?.id ?? null };
    Object.assign(combat, { round, turn });
    Hooks.callAll("combatTurnChange", combat, previous, { round, turn, combatantId: combat.turns[turn]?.id ?? null });
}
