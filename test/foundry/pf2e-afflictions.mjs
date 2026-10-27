/**
 * A fake of the pf2e pieces the affliction tracker touches (DESIGN.md 8.10, M8a), as the pf2e source runs them (dev head
 * be4ab21b; 8.6.1 by DESIGN 3.3):
 * - `actor.saves[type].roll(params)`: records what it was given (the item, its roll options, the DC, the modifiers) and
 *   creates the chat message pf2e would, with `flags.pf2e.context` (`options`, `outcome`, `isReroll`) and its author, which
 *   the test then hands to the recorder; the outcome is the next of `world.outcomes`;
 * - `Statistic#roll`'s incapacitation reads a physical `item`'s level (`item.isOfType("physical") ? item.level`): the ephemeral
 *   item class records whether it is physical and its level;
 * - `game.pf2e.ConditionManager.getCondition(slug)` and condition items with `system.slug` and `system.value`;
 * - `CONFIG.Dice.rolls`' `DamageRoll` (`evaluate`, `toMessage`) and a `Roll` for flat checks (the next of `world.flats`);
 * - `actor.deleteEmbeddedDocuments` with core's `preDeleteItem` hook, `hasCondition`, immunities;
 * - Item updates through `item.update` fire core's `preUpdateItem` first (cancelled when a listener returns false).
 */
import { addDocument, world } from "./stubs.mjs";

const VALUED = ["clumsy", "doomed", "drained", "dying", "enfeebled", "frightened", "sickened", "slowed", "stunned", "stupefied", "wounded"];

/** Install the pf2e globals the tracker reads. */
export function installPf2eAfflictions() {
    world.outcomes = [];
    world.flats = [];
    world.saveRolls = [];
    world.damageMessages = [];
    world.forgeCalls = [];
    game.pf2e = {
        ...(game.pf2e ?? {}),
        ConditionManager: {
            getCondition: (slug) => ({ toObject: () => ({ type: "condition", name: slug, img: "c.webp",
                system: { slug, value: { isValued: VALUED.includes(slug), value: VALUED.includes(slug) ? 1 : null }, references: {} }, flags: {} }) }),
        },
        Modifier: class { constructor(data) { Object.assign(this, data); } },
        settings: { ...(game.pf2e?.settings ?? {}), metagame: { dcs: true } },
    };
    globalThis.CONFIG.Item = {
        documentClass: class EphemeralItem {
            constructor(data, { parent }) {
                Object.assign(this, structuredClone(data));
                this.parent = parent;
            }
            get level() { return this.system?.level?.value ?? 0; }
            isOfType(kind) { return kind === "physical"; }
            getRollOptions() {
                return [`item:type:${this.type}`, ...(this.system?.traits?.value ?? []).map((t) => `item:trait:${t}`), `item:level:${this.level}`];
            }
        },
        dataModels: {},
    };
    globalThis.CONFIG.PF2E = { effectTraits: { poison: "", disease: "", curse: "", virulent: "", incapacitation: "" }, conditionTypes: {}, damageTypes: {}, saves: {} };
    globalThis.CONFIG.Dice = {
        rolls: [class DamageRoll {
            constructor(formula) { this.formula = formula; }
            async evaluate() { this.total = 4; return this; }
            async toMessage(data) {
                world.damageMessages.push({ formula: this.formula, ...data });
                return addDocument("ChatMessage", { flags: data.flags });
            }
        }],
    };
    globalThis.Roll = class {
        constructor(formula) { this.formula = formula; }
        async evaluate() { this.total = world.flats.shift() ?? 10; return this; }
    };
    game.system = { version: "8.6.1", documentTypes: { Item: ["effect", "condition", "consumable", "weapon"] } };
    game.scenes = [];
}

/** Give an actor pf2e's saves, conditions, immunities and deletions. */
export function asCreature(actor, { level = 5, immunities = [] } = {}) {
    actor.level = level;
    // pf2e's items know their actor (`item.actor`).
    const add = actor.addItem.bind(actor);
    actor.addItem = (data) => {
        const item = add(data);
        Object.defineProperty(item, "actor", { get: () => actor, configurable: true });
        Object.defineProperty(item, "quantity", { get: () => item.system?.quantity ?? 1, configurable: true });
        return item;
    };
    for (const item of actor.items) Object.defineProperty(item, "actor", { get: () => actor, configurable: true });
    actor.attributes = { immunities: immunities.map((type) => ({ type })) };
    const save = (type) => ({
        roll: async (params) => {
            world.saveRolls.push({ actor: actor.id, type, params });
            const outcome = world.outcomes.shift() ?? "failure";
            const message = addDocument("ChatMessage", {
                flags: { pf2e: { context: { type: "saving-throw", options: [...params.extraRollOptions], outcome, isReroll: false, actor: actor.uuid } } },
            });
            message.author = game.user;
            message.actor = actor;
            world.lastMessage = message;
            return { total: 15, message };
        },
    });
    actor.saves = { fortitude: save("fortitude"), reflex: save("reflex"), will: save("will") };
    actor.hasCondition = (slug) => actor.items.some((i) => i.type === "condition" && i.system?.slug === slug);
    Object.defineProperty(actor, "itemTypes", { configurable: true, get: () => ({ condition: actor.items.filter((i) => i.type === "condition"),
        treasure: actor.items.filter((i) => i.type === "treasure"), feat: actor.items.filter((i) => i.type === "feat") }) });
    actor.deleteEmbeddedDocuments = async (_name, ids, options = {}) => {
        options.parent = actor;   // as 14.368's `deleteEmbeddedDocuments`
        const out = [];
        for (const id of ids) {
            const item = actor.items.get(id);
            if (!item) continue;
            if (Hooks.call("preDeleteItem", item, options, game.user.id) === false) continue;
            actor.items.delete(id);
            Hooks.callAll("deleteItem", item, options, game.user.id);
            out.push(item);
        }
        return out;
    };
    actor.applyDamage = async ({ damage }) => world.damageApplied?.push([actor.id, damage.total]);
    return actor;
}

/** An item update as the client makes it: core's `preUpdateItem` first, cancelled when a listener returns false. */
export async function clientUpdate(item, changes, options = {}) {
    if (Hooks.call("preUpdateItem", item, structuredClone(changes), options, game.user.id) === false) return null;
    return item.update(changes, options);
}

/** A rerolled message: pf2e deletes the original and posts the reroll with `isReroll`. */
export function reroll(original, outcome) {
    world.collections.ChatMessage.delete(original.id);
    const message = addDocument("ChatMessage", { flags: { pf2e: { context: { ...original.flags.pf2e.context, outcome, isReroll: true } } } });
    message.author = game.user;
    message.actor = original.actor;
    return message;
}

/** A compendium poison in the compendium's markup (made up for the tests). */
export function compendiumPoison({ id = "toxinCompendium1", name = "Test Toxin", level = 2, traits = ["alchemical", "consumable", "injury", "poison"], html = null } = {}) {
    const p = (label, rest) => `<p><strong>${label}</strong> ${rest}</p>`;
    const description = html ?? [p("Saving Throw", "@Check[fortitude|dc:18]"), p("Maximum Duration", "6 rounds"),
        p("Stage 1", "@Damage[1d6[poison]] damage and @UUID[Compendium.pf2e.conditionitems.Item.Sickened]{Sickened 1} (1 round)"),
        p("Stage 2", "@Damage[2d6[poison]] damage, @UUID[Compendium.pf2e.conditionitems.Item.Slowed]{Slowed 1} and drained 1 (1 round)"),
        p("Stage 3", "@Damage[3d6[poison]] damage and @UUID[Compendium.pf2e.conditionitems.Item.Paralyzed] (1 round)")].join("");
    const uuid = `Compendium.pf2e.equipment-srd.Item.${id}`;
    const doc = {
        uuid, name, type: "consumable", img: "toxin.webp", system: { level: { value: level }, traits: { value: traits, rarity: "common" }, description: { value: description } },
        toObject() { return structuredClone({ name: this.name, type: this.type, img: this.img, system: this.system }); },
    };
    world.compendium = { ...(world.compendium ?? {}), [uuid]: doc };
    world.uuids.set(uuid, doc);
    return doc;
}
