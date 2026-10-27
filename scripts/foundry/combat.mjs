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
 *   vials, Advanced Vials' material, an additive's own toggle, OQ-27) are set first, but only where the module has a value
 *   of its own for them (a field-vial type or material chosen, the item's additive): a toggle the player set on pf2e's
 *   sheet is left alone, and one the module changed is put back as the player had it at the next Strike that has no
 *   value for it (`flags.MOD.combat.toggled`). While the combat features are off (Duct Tape) a Strike is pf2e's alone.
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
 * turn, own, ahead}`, or null outside one. `own`: it is the actor's turn; `ahead`: it is not, and the actor has still to
 * act this round. These, not the turn index, are what the deadline is read from later (`turnDeadline`): Foundry renumbers
 * the turns when a combatant is added, removed or re-sorted, keeping the current combatant.
 */
export function combatOf(actor) {
    const combat = encountersOf(actor)[0];
    if (!combat) return null;
    const mine = combatantOf(combat, actor);
    const turns = combat.turns ?? [];
    const turn = combat.turn ?? 0;
    const current = combat.combatant ?? turns[turn] ?? null;
    const own = !!current && current.id === mine.id;
    const ahead = !own && turns.findIndex((c) => c.id === mine.id) > turn;
    return { id: combat.id, combatant: mine.id, round: combat.round, turn, own, ahead };
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

/** The key of a pf2e toggle in `flags.MOD.combat.toggled` (no dots: Foundry would expand them). */
const toggleKey = (domain, option) => `${domain}|${option}`.replaceAll(".", "_");

/**
 * A pf2e toggle as it stands on the actor now: whether it is on, and its suboption (pf2e's RollOption puts
 * `option:suboption` beside `option` in `actor.rollOptions[domain]` while it is on, and removes both when it is off).
 */
function toggleState(actor, domain, option) {
    const record = actor.rollOptions?.[domain] ?? {};
    const on = !!record[option];
    const prefix = `${option}:`;
    const sub = on ? Object.keys(record).find((key) => key.startsWith(prefix) && record[key])?.slice(prefix.length) ?? null : null;
    return { on, sub };
}

/**
 * Set the pf2e toggles a Strike with `item` needs (OQ-27: the system's own, actor-wide toggles), before the Strike, where
 * the module has a value of its own for them: the bomber's field-vial damage type for a versatile vial (`damageType`, or the
 * quick vial's own), Advanced Vials' material (`material`, or the quick vial's own; for the resource's vials, one is taken
 * from the chosen bucket, 7.3, whose plain vials turn it off), and the toggle of the additive the item carries. A toggle the
 * module has no value for is the player's: it is left as pf2e's sheet set it. When the module changes one, the player's
 * setting is kept in `flags.MOD.combat.toggled` and put back at the next Strike through the module that has no value for
 * it (not at once: pf2e reads the toggles again when the damage is rolled from the attack card). Nothing is set while the
 * combat features are off (Duct Tape): a Strike is then pf2e's alone. Returns what was set.
 */
export async function setStrikeToggles(actor, item, { damageType = null, material = null } = {}) {
    if (!combatOn()) return {};
    const held = heldKeysOf(actor);
    const quick = item.flags?.[MODULE_ID]?.quick ?? {};
    const want = new Map();
    const set = {};
    const wanted = (domain, option, on, sub = null) => want.set(toggleKey(domain, option), { domain, option, on, sub });
    if (isVial(item)) {
        const field = heldEffect(held, "fieldVial");
        const type = damageType ?? quick.damageType ?? null;
        if (field && type !== null && field.choices.includes(type)) {
            wanted("all", field.option, true, type);
            set.damageType = type;
        }
        const advanced = heldEffect(held, "vialMaterial");
        if (advanced) {
            let thrown;
            if (!quick.source) {
                const taken = takeFromBucket(item.flags?.[MODULE_ID]?.vialMaterials ?? {}, material);
                if (taken) {
                    thrown = taken.material;
                    await item.update({ [`flags.${MODULE_ID}.vialMaterials`]: _replace(taken.buckets) });
                } else thrown = material ?? undefined;   // no buckets recorded yet (none chosen at preparation): the choice now
            } else thrown = material ?? quick.material ?? undefined;
            if (thrown !== undefined) {
                wanted("all", advanced.option, thrown !== null, thrown);
                set.material = thrown;
            }
        }
    }
    for (const additive of additivesOf(held, rulesFromSettings()).filter((a) => a.toggle)) {
        if (quick.additive !== additive.key) continue;
        wanted(additive.toggle.domain, additive.toggle.option, true);
        set.additive = additive.key;
    }
    const kept = actor.flags?.[MODULE_ID]?.combat?.toggled ?? {};
    const record = {};
    // The player's toggles the module changed for an earlier Strike, which this one has no value for, go back.
    for (const [key, was] of Object.entries(kept)) {
        if (want.has(key) || !was?.domain || !was?.option) continue;
        await actor.toggleRollOption(was.domain, was.option, null, !!was.on, was.on ? was.sub ?? null : null);
        record[`flags.${MODULE_ID}.combat.toggled.${key}`] = _del;
    }
    for (const [key, w] of want) {
        const now = toggleState(actor, w.domain, w.option);
        if (now.on === w.on && (!w.on || w.sub === null || now.sub === w.sub)) continue;
        if (!(key in kept)) record[`flags.${MODULE_ID}.combat.toggled.${key}`] = { domain: w.domain, option: w.option, on: now.on, sub: now.sub };
        await actor.toggleRollOption(w.domain, w.option, null, w.on, w.sub);
    }
    if (Object.keys(record).length) await actor.update(record);
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
