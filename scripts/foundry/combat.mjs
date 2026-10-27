/**
 * The combat features' switch and their reads of the encounter (DESIGN.md 8, 8.8, 13, M8).
 *
 * - **The switch.** Section 8.1-8.8 (the Bandolier, the token HUD palette, the Quick Alchemy panel, quick vials, Quick
 *   Bomber, Healing Bomb, additives, vial gathering and turn expiry) runs only while the master switch and
 *   `features.combat` are on, and steps aside entirely while PF2e Alchemist Remaster Duct Tape is active (DECISIONS
 *   2026-10-25, Duct Tape step-aside). "Use best consumable" (8.9) has its own toggle and stays.
 * - **The encounter.** A character's place in a started encounter, as a Quick Alchemy stamp records it (`combatOf`), and
 *   a stamp's encounter as the expiry reads it now (`turnStateOf`): its round and turn, and the creator's turn index.
 * - **Strikes** always go through pf2e's own Strike for the item (`strikeWith`): its multiple attack penalty variant, its
 *   modifiers and its attack and damage cards are the system's. The pf2e toggles a thrown item needs (the bomber's field
 *   vials, Advanced Vials' material, an additive's own toggle, OQ-27) are set first.
 */
import { MODULE_ID } from "../constants.mjs";
import { additivesOf, takeFromBucket } from "../logic/alchemy.mjs";
import { heldEffects } from "../logic/registry.mjs";
import { heldKeysOf } from "./registry.mjs";
import { isEnabled, rulesFromSettings, setting } from "./settings.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/** PF2e Alchemist Remaster Duct Tape's package id (13). */
export const DUCT_TAPE = "pf2e-alchemist-remaster-ducttape";

/** Whether Duct Tape is active: then the combat features step aside (8). */
export const ductTapeActive = () => game.modules?.get(DUCT_TAPE)?.active === true;

/** Why the combat features are off, or null while they are on: `disabled` (master switch), `off` (`features.combat`), `duct-tape`. */
export function combatOffReason() {
    if (!isEnabled()) return "disabled";
    if (setting("features.combat") === false) return "off";
    if (ductTapeActive()) return "duct-tape";
    return null;
}

/** Whether the combat features run (8). */
export const combatOn = () => combatOffReason() === null;

/** The refusal of a combat action while the features are off: `duct-tape`, or `combat-off` (the switch or the toggle). */
export const combatRefusal = () => {
    const why = combatOffReason();
    return why ? refuse(why === "duct-tape" ? "duct-tape" : "combat-off") : null;
};

/* -------------------------------------------- */
/*  The encounter                                */
/* -------------------------------------------- */

/**
 * The combatant of `actor` in `combat`: its actor (a linked token's, or a token-less combatant's) is `actor`, or, for a
 * combatant whose token is not on the viewed scene, its actor id is.
 */
export function combatantOf(combat, actor) {
    if (!combat || !actor) return null;
    return combat.combatants?.find?.((c) => c.actor === actor || (!c.token && c.actorId === actor.id)) ?? null;
}

/** The started encounters `actor` is a combatant in, the active one first. */
function encountersOf(actor) {
    const all = [...(game.combats ?? [])].filter((c) => c.started && combatantOf(c, actor));
    return all.sort((a, b) => Number(b.active === true) - Number(a.active === true));
}

/**
 * Where `actor` stands in a started encounter now, as a Quick Alchemy stamp records it (8.8): `{id, combatant, round,
 * turn}`, or null outside one.
 */
export function combatOf(actor) {
    const combat = encountersOf(actor)[0];
    if (!combat) return null;
    return { id: combat.id, combatant: combatantOf(combat, actor).id, round: combat.round, turn: combat.turn ?? 0 };
}

/** Whether `actor` is in a started encounter (vial gathering stops then, 8.7). */
export const inCombat = (actor) => encountersOf(actor).length > 0;

/**
 * A stamp's encounter as the expiry reads it now (8.8): `{position: {round, turn}, creatorTurn}`, the creator's turn
 * index being null once its combatant has left; `{gone: true}` once the encounter has ended (deleted).
 */
export function turnStateOf(stamp) {
    const combat = game.combats?.get?.(stamp?.combat?.id);
    if (!combat) return { gone: true };
    const index = (combat.turns ?? []).findIndex((c) => c.id === stamp.combat.combatant);
    return { position: { round: combat.round, turn: combat.turn ?? 0 }, creatorTurn: index >= 0 ? index : null };
}

/* -------------------------------------------- */
/*  Strikes                                      */
/* -------------------------------------------- */

/** pf2e's Strike of an item on its actor (`actor.system.actions`), once the actor's data has the item. */
export async function strikeOf(actor, item, ms = 1500) {
    const find = () => actor?.system?.actions?.find?.((action) => action?.item?.id === item?.id && action.type === "strike") ?? null;
    const end = Date.now() + ms;
    let strike = find();
    while (!strike && Date.now() < end) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        strike = find();
    }
    return strike;
}

/** The registry effect of a kind the actor holds, first one (`fieldVial`, `vialMaterial`). */
const heldEffect = (held, kind) => heldEffects(held, kind, rulesFromSettings())[0]?.effect ?? null;

/** Whether an item is a versatile vial (the resource's own item or a quick vial made from it): pf2e's slug. */
export const isVial = (item) => (item?.slug ?? item?.system?.slug) === "versatile-vial";

/**
 * Set the pf2e toggles a Strike with `item` needs (OQ-27: the system's own, actor-wide toggles), before the Strike: the
 * bomber's field-vial damage type for a versatile vial (`damageType`, or the quick vial's own), Advanced Vials' material
 * (`material`, or the quick vial's own; for the resource's vials, one is taken from the chosen bucket, 7.3), and each
 * additive's own toggle on for the additive the item carries and off for the others. Returns what was set.
 */
export async function setStrikeToggles(actor, item, { damageType = null, material = null } = {}) {
    const held = heldKeysOf(actor);
    const quick = item.flags?.[MODULE_ID]?.quick ?? {};
    const set = {};
    if (isVial(item)) {
        const field = heldEffect(held, "fieldVial");
        const type = damageType ?? quick.damageType ?? null;
        if (field && (type === null || field.choices.includes(type))) {
            await actor.toggleRollOption("all", field.option, null, type !== null, type);
            set.damageType = type;
        }
        const advanced = heldEffect(held, "vialMaterial");
        if (advanced) {
            let thrown = quick.material ?? null;
            if (!quick.source) {
                const taken = takeFromBucket(item.flags?.[MODULE_ID]?.vialMaterials ?? {}, material);
                if (taken) {
                    thrown = taken.material;
                    await item.update({ [`flags.${MODULE_ID}.vialMaterials`]: _replace(taken.buckets) });
                } else thrown = material ?? null;   // no buckets recorded yet (none chosen at preparation): the choice now
            } else if (material) thrown = material;
            await actor.toggleRollOption("all", advanced.option, null, thrown !== null, thrown);
            set.material = thrown;
        }
    }
    for (const additive of additivesOf(held, rulesFromSettings()).filter((a) => a.toggle)) {
        const on = quick.additive === additive.key;
        if (on || actor.rollOptions?.[additive.toggle.domain]?.[additive.toggle.option]) {
            await actor.toggleRollOption(additive.toggle.domain, additive.toggle.option, null, on);
            if (on) set.additive = additive.key;
        }
    }
    return set;
}

/**
 * Strike with an item through pf2e's own Strike (8.1, 8.4): the multiple attack penalty variant `map` (0, 1 or 2), with
 * the toggles set first (`setStrikeToggles`). pf2e targets the user's current target and posts its own attack card,
 * whose damage buttons are the system's. Refused: `no-actor`, `not-owner`, `inert`, `no-strike`, `cancelled`.
 */
export async function strikeWith(actor, item, { map = 0, event = null, damageType = null, material = null } = {}) {
    if (!actor || !item) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    if (item.flags?.[MODULE_ID]?.inert === true) return refuse("inert");
    const strike = await strikeOf(actor, item);
    const variant = strike?.variants?.[Math.min(Math.max(Number(map) || 0, 0), 2)] ?? null;
    if (!variant) return refuse("no-strike");
    const toggles = await setStrikeToggles(actor, item, { damageType, material });
    const roll = await variant.roll({ event });
    return roll ? { ok: true, total: roll.total ?? null, toggles } : refuse("cancelled");
}
