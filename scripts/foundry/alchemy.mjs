/**
 * Quick Alchemy, quick vials, Quick Bomber and Healing Bomb on this client (DESIGN.md 8.3-8.6, 8.8, M8), through pf2e's
 * own crafting model.
 *
 * - **What a character can make** (8.3): pf2e's `quick-alchemy` `CraftingAbility` (its predicates and item level) over the
 *   equipment catalogue, with a formula in the book or covering the item by family (`quickChoices`).
 * - **Making it** (8.3): `CraftingAbility#craft(uuid, {consume: true, destination: "hand"})`, which takes one versatile vial
 *   through the resource. `craft` checks neither the formula nor the predicate, and pf2e's own chat path crafts for free
 *   at 0 vials, so the gate is here (`brewPlan`): the formula, the item level, the vials, Double Brew's second item, the
 *   additive (one per item, one per round, never on a quick vial). An item that merged into an existing stack (pf2e's
 *   stack test compares only `system` data, 7.1) is split off into an item of its own before it is stamped, so its
 *   potency never mixes with another's. Each item gets its stamp (`flags.MOD.expiry`, 4.12, 8.8) and
 *   `flags.MOD.quick = {source, additive?, combine?, damageType?, material?, at, by}`.
 * - **Quick vials** (8.5): the system cannot craft its own resource item, so the module makes the quick vial: a temporary,
 *   infused copy of the vial item at its current level whose source identity is cleared, since pf2e reads the vial count
 *   from the first item whose source is the Versatile Vial and a matching copy would change it. Free; Abundant Vials'
 *   extra action makes one a turn.
 * - **Quick Bomber** (8.4): the best ready bomb of a family (held, then worn, then stowed; the soonest-expiring infused
 *   first), or one made with Quick Alchemy, then pf2e's Strike (`strikeWith`). One bomb, even with Double Brew.
 * - **Healing Bomb** (8.6): an elixir of life made with Quick Alchemy takes the additive; thrown, it is used through the
 *   system (`item.consume()`, whose healing card the target's owner applies) and a card lists the living creatures
 *   adjacent to the target, each regaining the elixir's number of damage dice in Hit Points, applied by that creature's
 *   owner or a GM, once each.
 * - **The 10-minute cap** (8.8): an effect created from a Quick Alchemy item (its pf2e origin) is clamped to 10 minutes on
 *   the client that creates it, unless the registry's `uncapped` rule lets the creator's own item outlast it.
 *
 * Every write here is to the acting character (its owner's client) or, for a Healing Bomb's healing, the healed actor
 * (its owner or a GM): nothing waits on a GM and nothing touches the shared documents.
 */
import { MODULE_ID } from "../constants.mjs";
import {
    QUICK_ALCHEMY, VIAL_RESOURCE, additiveSpent, additivesOf, bestOfFamily, brewPlan, cappedDuration, chooseBest, damageDiceCount,
    isTurnStamp, mergeSplash, quickChoices, quickStamp, quickenedSpent, splashNumbers, uncapped, vialSplash,
} from "../logic/alchemy.mjs";
import { carryOf } from "../logic/consumables.mjs";
import { familyKey } from "../logic/families.mjs";
import { heldEffects } from "../logic/registry.mjs";
import { runRequest } from "./batch.mjs";
import { catalogue } from "./catalogue.mjs";
import { combatOf, combatRefusal, isVial, strikeWith } from "./combat.mjs";
import { statusOf } from "./downtime.mjs";
import { bookOf } from "./formulas.mjs";
import { candidateOf, familyOfItem, inertFlag as isInert, physicalOf, stampFlag as stampOf, traitsOf } from "./item-facts.mjs";
import { vialsOf } from "./morning.mjs";
import { heldKeysOf } from "./registry.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { newId, stampNow } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (value) => (typeof value === "string" ? fromUuidSync(value, { strict: false }) : value ?? null);

/** An item's module flags of Quick Alchemy (`flags.MOD.quick`), or null. */
export const quickOf = (item) => item?.flags?.[MODULE_ID]?.quick ?? null;

/** pf2e's Quick Alchemy ability of a character, or null. */
export const quickAbilityOf = (actor) => actor?.crafting?.abilities?.get?.(QUICK_ALCHEMY) ?? null;

/** Whether a pf2e ability's predicates accept an item's options. */
function abilityAccepts(ability, options) {
    const set = options instanceof Set ? options : new Set(options ?? []);
    return (ability?.craftableItems ?? []).some((c) => c.predicate?.test?.(set) ?? false);
}

/** Wait until `test()` holds, at most `ms`. */
async function until(test, ms = 2000) {
    const end = Date.now() + ms;
    while (!test() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
    return test();
}

/** The character's Intelligence modifier, as pf2e prepares it. */
const intOf = (actor) => actor?.abilities?.int?.mod ?? actor?.system?.abilities?.int?.mod ?? 0;

/* -------------------------------------------- */
/*  What a character can make (8.3)              */
/* -------------------------------------------- */

/** The items `actor` can make with Quick Alchemy now (8.3), from the catalogue. */
export async function quickChoicesOf(actor, ability = quickAbilityOf(actor)) {
    if (!ability) return [];
    const items = await catalogue();
    const byUuid = new Map(items.map((item) => [item.uuid, item]));
    const known = bookOf(actor).map((uuid) => byUuid.get(uuid)).filter(Boolean);
    const maxLevel = Number.isFinite(ability.maxItemLevel) && ability.maxItemLevel > 0 ? ability.maxItemLevel : actor.level ?? 1;
    return quickChoices(items, { known, maxLevel, accepts: (options) => abilityAccepts(ability, options) }, rulesFromSettings());
}

/** The registry's combat features of a character (8.3-8.8). */
export function featuresOf(actor) {
    const held = heldKeysOf(actor);
    const rules = rulesFromSettings();
    const effects = (kind) => heldEffects(held, kind, rules).map(({ key, effect }) => ({ key, ...effect }));
    const expiryRules = effects("expiryRule");
    const additives = additivesOf(held, rules);
    return {
        held, additives,
        brew: Math.max(1, ...effects("brew").map((e) => e.count)),
        enduring: expiryRules.filter((e) => e.rule === "enduring"),
        uncapped: expiryRules.filter((e) => e.rule === "uncapped"),
        quickBomber: effects("quickBomber").length > 0,
        abundant: effects("quickVial").some((e) => e.quickened),
        healingBomb: additives.some((a) => a.key === "healing-bomb"),
        splash: mergeSplash(effects("splash")),
        fieldVial: effects("fieldVial")[0] ?? null,
        vialMaterial: effects("vialMaterial")[0] ?? null,
    };
}

/** How potent a Quick Alchemy (or prepared) item is, for the Bandolier's countdown (8.1). */
function potencyOf(stamp, worldTime) {
    if (!stamp) return null;
    if (isTurnStamp(stamp)) {
        if (stamp.combat) return { kind: stamp.rule === "turn-start" ? "turn-start" : stamp.when === "current" ? "turn-end-current" : "turn-end-next" };
        return { kind: "seconds", seconds: Math.max(0, Math.ceil((stamp.at ?? 0) - worldTime)) };
    }
    if (Number.isFinite(stamp.at)) return { kind: "seconds", seconds: Math.max(0, Math.ceil(stamp.at - worldTime)) };
    return { kind: "prep" };
}

/** The splash numbers of a bomb in a character's hands (8.8). */
export function splashOf(actor, item, features = featuresOf(actor)) {
    const base = isVial(item) ? vialSplash(item.level ?? item.system?.level?.value ?? 1) : item.system?.splashDamage?.value ?? 0;
    if (!traitsOf(item).includes("splash") && !isVial(item)) return null;
    return splashNumbers({ base, int: intOf(actor), splash: features.splash });
}

/** A ready item in brief: bombs and elixirs at hand, with their potency (8.1). */
function readyBrief(actor, item, features, worldTime) {
    const traits = traitsOf(item);
    const stamp = stampOf(item);
    const quick = quickOf(item);
    return {
        id: item.id, uuid: item.uuid, name: item.name, img: item.img ?? null, qty: item.quantity ?? 1, carry: carryOf(item.system?.equipped ?? {}),
        bomb: item.type === "weapon" && traits.includes("bomb"), elixir: traits.includes("elixir"), vial: isVial(item), infused: traits.includes("infused"),
        stamp, potency: potencyOf(stamp, worldTime), quick, additive: quick?.additive ?? null, healingBomb: quick?.additive === "healing-bomb",
        splash: traits.includes("bomb") ? splashOf(actor, item, features) : null, inert: isInert(item),
    };
}

/**
 * Everything the Bandolier, the HUD palette and the Quick Alchemy panel read about a character (8.1-8.3): pf2e's Quick
 * Alchemy ability, the vials (the resource, which counts, 7.3), its combat features, what it can make (`choices`, only
 * with `withChoices`: it reads the catalogue), its ready bombs and elixirs with their potency, whether this round's
 * additive and this turn's quickened quick vial are spent, and its encounter.
 */
export async function alchemyFacts(actorRef, { withChoices = true } = {}) {
    const facts = readyFacts(actorRef);
    if (facts && withChoices && facts.ability) facts.choices = await quickChoicesOf(facts.actor, facts.ability);
    return facts;
}

/**
 * `alchemyFacts` without what the character can make, read at once (no catalogue): the token HUD needs its palette in
 * place before core's render finishes (its `_postRender` reopens the palette that was open), so it cannot wait.
 */
export function readyFacts(actorRef) {
    const actor = actorOf(actorRef);
    if (!actor) return null;
    const ability = quickAbilityOf(actor);
    const features = featuresOf(actor);
    const combat = combatOf(actor);
    const worldTime = game.time?.worldTime ?? 0;
    const flags = actor.flags?.[MODULE_ID]?.combat ?? {};
    const items = physicalOf(actor).filter((item) => !isInert(item));
    const ready = items.filter((item) => {
        const traits = traitsOf(item);
        return (item.type === "weapon" && traits.includes("bomb")) || traits.includes("elixir") || !!quickOf(item);
    }).map((item) => readyBrief(actor, item, features, worldTime))
        .sort((a, b) => Number(!a.quick) - Number(!b.quick) || a.name.localeCompare(b.name, "en"));
    return {
        actor, ability, canQuick: !!ability, features, combat, worldTime,
        vials: vialsOf(actor), choices: [],
        ready, additiveSpent: additiveSpent(flags.additive ?? null, { combat, worldTime }), quickenedSpent: quickenedSpent(flags.quickened ?? null, combat),
        cycle: statusOf(actor).prepCycle ?? 0,
    };
}

/* -------------------------------------------- */
/*  Making an item (8.3)                         */
/* -------------------------------------------- */

/** Characters this client is making something for: a second click waits for the first. */
const busy = new Set();

/**
 * Make one item with pf2e's `craft` and give it its stamp and Quick Alchemy flags (8.3). pf2e adds to an identical stack
 * without waiting for the update, and its stack test reads only `system` data, so an item that merged into a stack is
 * split off into its own (one request: the copy with this item's flags, the stack set back to its earlier quantity),
 * as M7 does with daily preparations (7.1). Returns the item, or null when pf2e made nothing.
 */
async function craftOne(actor, ability, uuid, flags) {
    const before = new Map(physicalOf(actor).map((item) => [item.id, item.quantity ?? 1]));
    const made = await ability.craft(uuid, { consume: true, destination: "hand" });
    if (!made) return null;
    const was = before.get(made.id);
    if (was === undefined) {
        await actor.updateEmbeddedDocuments("Item", [{ _id: made.id, [`flags.${MODULE_ID}.expiry`]: flags.expiry, [`flags.${MODULE_ID}.quick`]: flags.quick }]);
        return actor.items.get(made.id) ?? null;
    }
    await until(() => (actor.items.get(made.id)?.quantity ?? 0) > was);
    const stack = actor.items.get(made.id);
    const added = (stack?.quantity ?? was) - was;
    if (!stack || added <= 0) return null;
    const copy = stack.toObject();
    copy._id = newId();
    copy.system.quantity = added;
    copy.flags = { ...(copy.flags ?? {}), [MODULE_ID]: { expiry: flags.expiry, quick: flags.quick } };
    const split = await runRequest([
        { op: "createItems", target: actor.uuid, data: [copy] },
        { op: "updateItems", target: actor.uuid, updates: [{ _id: stack.id, "system.quantity": was }] },
    ]);
    return split.outcome === "ok" ? actor.items.get(copy._id) ?? null : null;
}

/**
 * Use Quick Alchemy (8.3, 11.1 macro 12): make `uuid` (and `second` with Double Brew), with an optional `additive` on the
 * first item (Combine Elixirs takes `combine`, the second elixir), held in hand; `then: "strike"` throws the first bomb
 * at once through pf2e's Strike (`map` its multiple attack penalty variant). One vial per consumable, and the additive's
 * own vials, all checked before anything is made. Posts the Quick Alchemy card.
 *
 * Refused: `combat-off`, `duct-tape`, `no-actor`, `not-owner`, `no-quick-alchemy`, `alchemy-busy`, `cannot-make` (no
 * formula, above the ability's level or not an alchemical consumable), `nothing-picked`, `double-brew`, `additive-unknown`,
 * `additive-fit`, `additive-round`, `combine-pick`, `combine-fit`, `no-vials`, `vials`, `craft-failed` (pf2e made nothing).
 *
 * @returns {Promise<{ok: boolean, items?: object[], strike?: object, reason?: string, data?: object}>}
 */
export async function quickAlchemy(actorRef, { uuid, second = null, additive = null, combine = null, then = "hand", map = 0, event = null } = {}) {
    const off = combatRefusal();
    if (off) return off;
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    const ability = quickAbilityOf(actor);
    if (!ability) return refuse("no-quick-alchemy");
    if (busy.has(actor.id)) return refuse("alchemy-busy");
    busy.add(actor.id);
    try {
        const facts = await alchemyFacts(actor);
        const choice = (u) => facts.choices.find((c) => c.uuid === u) ?? null;
        const wanted = [uuid, second].filter(Boolean);
        const picks = wanted.map(choice);
        const missing = wanted.find((u, i) => !picks[i]);
        if (missing) return refuse("cannot-make", { item: fromUuidSync(missing, { strict: false })?.name ?? missing });
        const plan = brewPlan({ picks, vials: facts.vials?.value ?? 0, brew: facts.features.brew, additive, additives: facts.features.additives,
            additiveSpent: facts.additiveSpent, combine: combine ? choice(combine) : null });
        if (!plan.ok) return refuse(plan.problems[0].reason, { ...plan.problems[0].data, problems: plan.problems });
        const made = [];
        for (const [i, pick] of picks.entries()) {
            const expiry = quickStamp({ creator: actor.uuid, cycle: facts.cycle, options: pick.options, enduring: facts.features.enduring, combat: facts.combat,
                worldTime: game.time.worldTime });
            const quick = { source: "quick-alchemy", additive: i === 0 ? additive : null, combine: i === 0 && combine ? combine : null, at: game.time.worldTime, by: game.user.id };
            const item = await craftOne(actor, ability, pick.uuid, { expiry, quick });
            if (!item) break;
            made.push(item);
        }
        if (!made.length) return refuse("craft-failed");
        // The additive's own vials (Combine Elixirs), read again at write time; and this round's additive spent (8.6).
        const extra = additive ? facts.features.additives.find((a) => a.key === additive)?.vials ?? 0 : 0;
        if (extra > 0) {
            const now = actor.getResource?.(VIAL_RESOURCE)?.value ?? 0;
            await actor.updateResource(VIAL_RESOURCE, Math.max(0, now - extra));
        }
        if (additive) {
            await actor.update({ [`flags.${MODULE_ID}.combat.additive`]: { combat: facts.combat?.id ?? null, round: facts.combat?.round ?? null, at: game.time.worldTime } });
        }
        const items = made.map((item) => ({ id: item.id, uuid: item.uuid, name: item.name, bomb: item.type === "weapon" && traitsOf(item).includes("bomb") }));
        Hooks.callAll(`${MODULE_ID}.quickAlchemy`, Object.freeze({ actor, items, additive, kind: "quick-alchemy" }));
        const result = { ok: true, items, cost: plan.cost };
        if (then === "strike") {
            const bomb = made.find((item) => item.type === "weapon");
            if (bomb) result.strike = await strikeWith(actor, bomb, { map, event });
        }
        return result;
    } finally {
        busy.delete(actor.id);
    }
}

/**
 * Make a quick vial (8.5, macro 14): free, usable only as a bomb or for the field-vial option, potent until the end of
 * the current turn. `damageType` and `material` are the bomber's field-vial type and Advanced Vials' material, set as
 * pf2e's toggles when it is thrown; `quickened` spends Abundant Vials' extra action, once a turn. Refused: `combat-off`,
 * `duct-tape`, `no-actor`, `not-owner`, `no-quick-alchemy`, `no-vial-item`, `bad-choice`, `no-feat`, `not-in-combat`,
 * `quickened`, `craft-failed`.
 */
export async function quickVial(actorRef, { damageType = null, material = null, quickened = false, then = "hand", map = 0, event = null } = {}) {
    const off = combatRefusal();
    if (off) return off;
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    if (!quickAbilityOf(actor)) return refuse("no-quick-alchemy");
    const vials = vialsOf(actor);
    const vial = vials?.item ? actor.items.get(vials.item) : null;
    if (!vial) return refuse("no-vial-item");
    const features = featuresOf(actor);
    if (damageType && !features.fieldVial?.choices.includes(damageType)) return refuse("bad-choice", { item: damageType });
    if (material && !features.vialMaterial?.materials.includes(material)) return refuse("bad-choice", { item: material });
    const combat = combatOf(actor);
    if (quickened) {
        if (!features.abundant) return refuse("no-feat");
        if (!combat) return refuse("not-in-combat");
        if (quickenedSpent(actor.flags?.[MODULE_ID]?.combat?.quickened ?? null, combat)) return refuse("quickened");
    }
    const source = vial.toObject();
    delete source._id;
    // A different source identity: pf2e counts the vials from the first item whose source is the Versatile Vial.
    source._stats = { ...(source._stats ?? {}), compendiumSource: null, duplicateSource: null };
    source.system.quantity = 1;
    source.system.temporary = true;
    source.system.equipped = { carryType: "held", handsHeld: 1 };
    const traits = new Set(source.system.traits?.value ?? []);
    traits.add("infused");
    source.system.traits = { ...(source.system.traits ?? {}), value: [...traits].sort() };
    const expiry = quickStamp({ creator: actor.uuid, cycle: statusOf(actor).prepCycle ?? 0, quickVial: true, combat, worldTime: game.time.worldTime });
    source.flags = { ...(source.flags ?? {}), [MODULE_ID]: { expiry, quick: { source: "quick-vial", damageType, material, quickened: !!quickened, at: game.time.worldTime, by: game.user.id } } };
    const [item] = await actor.createEmbeddedDocuments("Item", [source]);
    if (!item) return refuse("craft-failed");
    if (quickened) await actor.update({ [`flags.${MODULE_ID}.combat.quickened`]: { combat: combat.id, round: combat.round, turn: combat.turn } });
    const items = [{ id: item.id, uuid: item.uuid, name: item.name, bomb: true }];
    Hooks.callAll(`${MODULE_ID}.quickAlchemy`, Object.freeze({ actor, items, additive: null, kind: "quick-vial" }));
    const result = { ok: true, items };
    if (then === "strike") result.strike = await strikeWith(actor, item, { map, event });
    return result;
}

/* -------------------------------------------- */
/*  Quick Bomber (8.4)                           */
/* -------------------------------------------- */

/**
 * Quick Bomber (8.4, macro 13): draw the best ready bomb of `family` (a quick or versatile vial when `family` is
 * `"vial"`), or make one with Quick Alchemy (`createIfNone`, the best grade of the family the character can make), then
 * Strike with it through pf2e. One bomb, even with Double Brew. Refused as `quickAlchemy` is, and `no-feat` (Quick
 * Bomber), `none` (no bomb of the family, and none to make).
 */
export async function quickBomb(actorRef, { family = null, uuid = null, damageType = null, material = null, createIfNone = true, map = 0, event = null } = {}) {
    const off = combatRefusal();
    if (off) return off;
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    if (!featuresOf(actor).quickBomber) return refuse("no-feat");
    // A UUID's family from the catalogue's facts, as the held bombs' own (their category included).
    const facts = uuid ? (await catalogue()).find((i) => i.uuid === uuid) ?? null : null;
    const wanted = family ?? (facts ? familyKey(facts) : null);
    const bombs = physicalOf(actor).filter((item) => item.type === "weapon" && traitsOf(item).includes("bomb") && (item.quantity ?? 1) > 0)
        .filter((item) => (wanted === "vial" ? isVial(item) : !wanted || familyOfItem(item) === wanted));
    const { best } = chooseBest(bombs.map(candidateOf), game.time.worldTime);
    if (best) return { ...(await strikeWith(actor, best.item, { map, event, damageType, material })), drawn: best.item.id };
    if (!createIfNone || wanted === "vial") return refuse("none");
    const choices = await quickChoicesOf(actor);
    const make = uuid ? choices.find((c) => c.uuid === uuid) : bestOfFamily(choices.filter((c) => c.bomb), wanted);
    if (!make) return refuse("none");
    return quickAlchemy(actor, { uuid: make.uuid, then: "strike", map, event });
}

/* -------------------------------------------- */
/*  Healing Bomb (8.6)                           */
/* -------------------------------------------- */

/** The elixir of life family (`familyKey`), which Healing Bomb takes (8.6). */
export const ELIXIR_OF_LIFE = "consumable|elixir|elixir of life";

/**
 * Healing Bomb (8.6, macro 15): make an elixir of life with Quick Alchemy with the Healing Bomb additive (`grade`
 * "best": the highest the character can make; or a UUID). It is then thrown with `throwHealingBomb`. Refused as
 * `quickAlchemy` is, and `no-feat`, `none`.
 */
export async function healingBomb(actorRef, { grade = "best" } = {}) {
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    const off = combatRefusal();
    if (off) return off;
    if (!featuresOf(actor).healingBomb) return refuse("no-feat");
    const choices = await quickChoicesOf(actor);
    const pick = grade === "best" ? bestOfFamily(choices, ELIXIR_OF_LIFE) : choices.find((c) => c.uuid === grade);
    if (!pick) return refuse("none");
    return quickAlchemy(actor, { uuid: pick.uuid, additive: "healing-bomb" });
}

/** A creature's token as the card names it, or null. */
const tokenOf = (value) => {
    const doc = actorOf(value);
    if (!doc) return null;
    if (doc.documentName === "Token") return doc.object ?? null;
    return doc.getActiveTokens?.(true, false)?.[0] ?? null;
};

/**
 * The living creatures adjacent to a Healing Bomb's target, from the canvas (8.6): tokens within 5 feet of it, other
 * than the target, whose actor is living (pf2e's `modeOfBeing`). Without a canvas none are known: the card then lets
 * each owner apply the healing to their own selected tokens.
 */
function adjacentLiving(targetToken) {
    if (!targetToken || !canvas?.ready) return [];
    const reach = canvas.grid?.distance ?? 5;
    return [...(canvas.tokens?.placeables ?? [])].filter((token) => token !== targetToken && token.actor && token.actor.modeOfBeing === "living" &&
        (token.distanceTo?.(targetToken) ?? Infinity) <= reach);
}

/**
 * Throw a Healing Bomb (8.6): the elixir the character holds with the additive, at `target` (a token, actor or UUID; by
 * default the user's one target), as an Interact within 20 feet. The target is affected as though it drank the elixir:
 * the item is used through the system (`item.consume()`, its healing card applied by the target's owner); the card lists
 * the living creatures adjacent to the target with the Hit Points each regains. Refused: `combat-off`, `duct-tape`, `no-actor`,
 * `not-owner`, `item-gone`, `not-healing-bomb`, `inert`, `no-creature`, `range`.
 */
export async function throwHealingBomb(actorRef, itemId, { target = null } = {}) {
    const off = combatRefusal();
    if (off) return off;
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    const item = actor.items.get(itemId);
    if (!item) return refuse("item-gone");
    if (quickOf(item)?.additive !== "healing-bomb") return refuse("not-healing-bomb");
    if (isInert(item)) return refuse("inert");
    const token = target ? tokenOf(target) : [...(game.user.targets ?? [])][0] ?? null;
    const targetActor = token?.actor ?? actorOf(target);
    if (!targetActor) return refuse("no-creature");
    const thrower = actor.getActiveTokens?.(true, false)?.[0] ?? null;
    if (thrower && token && (thrower.distanceTo?.(token) ?? 0) > 20) return refuse("range");
    const hp = damageDiceCount(item.system?.damage?.formula ?? "");
    const adjacent = adjacentLiving(token).map((t) => ({ actor: t.actor.uuid, token: t.document?.uuid ?? null, name: t.name ?? t.actor.name }));
    await item.consume();
    const card = { kind: "healing-bomb", thrower: actor.uuid, item: item.name, target: { actor: targetActor.uuid, name: token?.name ?? targetActor.name }, hp, adjacent };
    Hooks.callAll(`${MODULE_ID}.healingBomb`, Object.freeze({ actor, card }));
    return { ok: true, ...card };
}

/**
 * Heal one creature from a Healing Bomb card (8.6): the creature's owner or a GM applies it, through pf2e's own
 * `applyDamage` (negative damage heals), once per card and creature: the healed actor records the card
 * (`flags.MOD.healed.<messageId>`). Refused: `not-owner`, `no-actor`, `already`.
 */
export async function applyHealingBomb(messageId, { actor: actorRef, token: tokenRef = null, hp }) {
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    if (actor.flags?.[MODULE_ID]?.healed?.[messageId]) return refuse("already");
    await actor.update({ [`flags.${MODULE_ID}.healed.${messageId}`]: stampNow() });
    const token = tokenRef ? fromUuidSync(tokenRef, { strict: false }) : null;
    await actor.applyDamage({ damage: -Math.abs(Number(hp) || 0), token: token ?? actor.getActiveTokens?.(true, true)?.[0] ?? null });
    return { ok: true, actor: actor.uuid, hp };
}

/* -------------------------------------------- */
/*  The 10-minute cap (8.8)                      */
/* -------------------------------------------- */

/**
 * Clamp an effect made from a Quick Alchemy item to 10 minutes, as it is created (8.8, OQ-19): `preCreateItem` on the
 * creating client, for an effect whose pf2e origin (`system.context.origin.item`) is an item stamped by Quick Alchemy
 * that still exists. The registry's `uncapped` rules (Eternal Elixir at half the creator's level or lower, Persistent
 * Mutagen) leave the creator's own effect alone. Returns the new duration, or null.
 */
export function clampEffect(effect, data) {
    if (data?.type !== "effect" || combatRefusal()) return null;
    const originUuid = data.system?.context?.origin?.item ?? null;
    const origin = originUuid ? fromUuidSync(originUuid, { strict: false }) : null;
    if (!origin || !quickOf(origin)) return null;
    const creator = actorOf(stampOf(origin)?.creator ?? null);
    const holder = effect?.parent ?? null;
    const own = !!creator && holder === creator;
    const free = creator ? uncapped(featuresOf(creator).uncapped, { options: origin.getRollOptions?.("item") ?? [], level: origin.level ?? 0, creatorLevel: creator.level ?? 1, own }) : false;
    return cappedDuration(data.system?.duration ?? null, { uncapped: free });
}

/**
 * Stamp what pf2e's own Quick Alchemy action made (8.8): its chat path crafts with `craft(..., {destination: "hand"})` and
 * stamps nothing, so on the creating client a new, unstamped, temporary, infused, held item that the character's Quick
 * Alchemy can make gets the stamp the module's panel would give it (and `flags.MOD.quick.source` "system"). The panel's
 * own items are stamped by the panel (its character is busy meanwhile) and quick vials are made stamped.
 * @returns {Promise<boolean>} whether it stamped the item
 */
export async function stampSystemQuickAlchemy(item, userId) {
    if (userId !== game.user.id || combatRefusal()) return false;
    const actor = item?.parent;
    const ability = quickAbilityOf(actor);
    if (!ability || !actor.isOwner || busy.has(actor.id)) return false;
    if (stampOf(item) || isInert(item) || item.system?.temporary !== true || item.system?.equipped?.carryType !== "held") return false;
    if (!traitsOf(item).includes("infused")) return false;
    const options = item.getRollOptions?.("item") ?? [];
    if (!abilityAccepts(ability, options)) return false;
    const expiry = quickStamp({ creator: actor.uuid, cycle: statusOf(actor).prepCycle ?? 0, options, enduring: featuresOf(actor).enduring, combat: combatOf(actor),
        worldTime: game.time.worldTime });
    await item.update({ [`flags.${MODULE_ID}.expiry`]: expiry, [`flags.${MODULE_ID}.quick`]: { source: "system", additive: null, at: game.time.worldTime, by: game.user.id } });
    return true;
}

/** Hooks at `init`: the 10-minute cap on effects, and stamps on what pf2e's own Quick Alchemy action makes (8.8). */
export function registerAlchemyHooks() {
    Hooks.on("createItem", (item, _options, userId) => {
        stampSystemQuickAlchemy(item, userId).catch((error) => console.warn(`${MODULE_ID} | could not stamp a Quick Alchemy item`, error));
    });
    Hooks.on("preCreateItem", (item, data) => {
        try {
            const capped = clampEffect(item, data);
            if (capped) item.updateSource({ "system.duration": capped });
        } catch (error) {
            console.warn(`${MODULE_ID} | could not cap an effect's duration`, error);
        }
    });
}

/** For tests only. */
export function resetAlchemy() {
    busy.clear();
}
