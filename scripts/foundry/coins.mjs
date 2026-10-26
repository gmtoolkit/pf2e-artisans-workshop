/**
 * pf2e coin items for the coin planner (DESIGN.md 5.4): reading an actor's coin stacks, and the item data for
 * new stacks, made from the four coin items in `pf2e.equipment-srd` (resolved once at `ready`), as pf2e's own
 * `ActorInventory#addCurrency` makes them.
 */
import { MODULE_ID } from "../constants.mjs";
import { DENOMINATIONS } from "../data/coins.mjs";

/** pf2e `src/module/actor/inventory/index.ts` (`coinCompendiumUuids`). */
export const COIN_UUIDS = Object.freeze({
    pp: "Compendium.pf2e.equipment-srd.Item.JuNPeK5Qm1w6wpb4",
    gp: "Compendium.pf2e.equipment-srd.Item.B6B7tBWJSqOBz5zz",
    sp: "Compendium.pf2e.equipment-srd.Item.5Ew82vBF9YfaiY9f",
    cp: "Compendium.pf2e.equipment-srd.Item.lzJ8AVhRcbFul5fh",
});

let templates = null;

/** Load the coin items once; later calls return the same templates. Throws if one is missing. */
export async function loadCoinTemplates() {
    if (templates) return templates;
    const loaded = {};
    for (const denomination of DENOMINATIONS) {
        const item = await fromUuid(COIN_UUIDS[denomination]);
        if (!item) throw new Error(`${MODULE_ID} | coin item ${COIN_UUIDS[denomination]} not found`);
        const source = item.toObject();
        delete source._id;
        foundry.utils.setProperty(source, "_stats.compendiumSource", COIN_UUIDS[denomination]);
        loaded[denomination] = source;
    }
    templates = loaded;
    return templates;
}

/** Whether the coin items are loaded: every coin move needs them. */
export function coinsLoaded() {
    return templates !== null;
}

/**
 * Item data for a new stack. `lot` is the row a strongbox stack belongs to (`flags.MOD.lot = {row}`), null on
 * a purse.
 */
export function coinItemData(denomination, quantity, lot = null) {
    if (!templates) throw new Error(`${MODULE_ID} | coin items are not loaded yet`);
    const data = foundry.utils.deepClone(templates[denomination]);
    foundry.utils.setProperty(data, "system.quantity", quantity);
    if (lot) foundry.utils.setProperty(data, `flags.${MODULE_ID}.lot`, { row: lot });
    return data;
}

/**
 * The actor's coin stacks `{id, denomination, quantity, version}` in item order, wherever they are (a container
 * included), as pf2e's change-making reads them: treasure items of the coin category with one denomination.
 * `version` is when the stack last changed (`_stats.modifiedTime`, which the server sets on every write), for
 * the purse stack locks of 5.4.
 */
export function coinStacks(actor) {
    return actor.itemTypes.treasure
        .filter((item) => item.isCoinage && DENOMINATIONS.includes(item.unit))
        .map((item) => ({ id: item.id, denomination: item.unit, quantity: item.quantity, version: item._stats?.modifiedTime ?? 0 }));
}

/** For tests only. */
export function setCoinTemplates(value) {
    templates = value;
}
