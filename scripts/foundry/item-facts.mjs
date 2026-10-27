/**
 * Plain facts about a character's items that M8 reads in several places (DESIGN.md 8.1, 8.4, 8.9, 4.10): its physical
 * items, an item's traits, its family (6.4, from its compendium source's name), how close at hand it is, and what the
 * module wrote on it (the expiry stamp and the inert mark, 4.12, 7.7). Kept apart, with no imports from the rest of
 * `scripts/foundry/`, so the roster snapshot (4.10) can read them without loading the combat code.
 */
import { MODULE_ID } from "../constants.mjs";
import { carryOf } from "../logic/consumables.mjs";
import { familyKey } from "../logic/families.mjs";

/** Physical items of an actor. */
export const physicalOf = (actor) => [...(actor?.items ?? [])].filter((item) => item.isOfType?.("physical") ??
    ["consumable", "equipment", "weapon", "armor", "shield", "ammo", "treasure", "backpack"].includes(item.type));

/** An item's traits as a list. */
export const traitsOf = (item) => [...(item?.system?.traits?.value ?? [])];

/** An item's expiry stamp (4.12), or null. */
export const stampFlag = (item) => item?.flags?.[MODULE_ID]?.expiry ?? null;

/** Whether an item is inert (7.7). */
export const inertFlag = (item) => item?.flags?.[MODULE_ID]?.inert === true;

/** The family of an item a character holds (6.4): from its compendium source's name, else its own (the "(inert)" suffix aside). */
export function familyOfItem(item) {
    const source = item?.sourceId ? fromUuidSync(item.sourceId, { strict: false }) : null;
    const name = source?.name ?? item?.flags?.[MODULE_ID]?.inertFrom?.name ?? item?.name ?? "";
    return familyKey({ name, type: item?.type, category: item?.system?.category ?? source?.system?.category ?? null });
}

/** Whether a character can use an item as a consumable: a consumable, or a weapon with the consumable trait (a bomb). */
export function usableConsumable(item) {
    return (item.type === "consumable" || (item.type === "weapon" && traitsOf(item).includes("consumable"))) && (item.quantity ?? 1) > 0;
}

/** A held item as `chooseBest` (`scripts/logic/alchemy.mjs`) reads it. */
export const candidateOf = (item) => ({ id: item.id, item, carry: carryOf(item.system?.equipped ?? {}), infused: traitsOf(item).includes("infused"),
    inert: inertFlag(item), stamp: stampFlag(item) });
