/**
 * The equipment catalogue (DESIGN.md 6.4, 6.8, M5): plain facts about every item of pf2e's equipment compendium, read
 * from its index (never the documents), for the Formula Codex's families and virtual lists, the picks a feature owes and
 * the search of the request form and the Formulas tab. Names, images and levels come from the installed compendium at
 * runtime (P9). Read once per session: the compendium does not change while the world runs.
 */
import { itemOptions } from "../logic/registry.mjs";

/** The compendium the catalogue reads. */
export const EQUIPMENT_PACK = "pf2e.equipment-srd";

/** Index fields the facts need. */
const FIELDS = [
    "system.level.value", "system.traits", "system.category", "system.slug", "system.usage.value", "system.publication.title",
    "system.price", "system.material",
];

const RATES = { pp: 1000, gp: 100, sp: 10, cp: 1 };

let loading = null;

/** A Price as pf2e stores it (`{value: {gp: 5}, per}`), in copper per item. */
export function priceCpOf(price) {
    const value = price?.value ?? {};
    const total = Object.entries(RATES).reduce((sum, [unit, rate]) => sum + rate * (Number(value[unit]) || 0), 0);
    return Math.round(total / Math.max(1, price?.per ?? 1));
}

/** pf2e's slug for a name, as the system makes one when `system.slug` is empty. */
function slugOf(entry) {
    if (entry.system?.slug) return entry.system.slug;
    return game.pf2e?.system?.sluggify?.(entry.name) ?? entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The facts of one index entry. */
export function factsOfEntry(entry) {
    const traits = [...(entry.system?.traits?.value ?? [])];
    const facts = {
        uuid: entry.uuid, name: entry.name, img: entry.img ?? null, type: entry.type, level: entry.system?.level?.value ?? 0,
        rarity: entry.system?.traits?.rarity ?? "common", traits, category: entry.system?.category ?? null, slug: slugOf(entry),
        usage: entry.system?.usage?.value ?? null, book: entry.system?.publication?.title ?? null,
        otherTags: [...(entry.system?.traits?.otherTags ?? [])], priceCp: priceCpOf(entry.system?.price),
        material: { type: entry.system?.material?.type ?? null, grade: entry.system?.material?.grade ?? null },
    };
    return { ...facts, options: [...itemOptions(facts)] };
}

/**
 * Every physical item of the equipment compendium as facts, in the index's order. An empty list when the pack is
 * missing (a world without pf2e's packs), so the Codex still shows the book.
 * @returns {Promise<object[]>}
 */
export function catalogue() {
    loading ??= (async () => {
        const pack = game.packs?.get(EQUIPMENT_PACK);
        if (!pack) return [];
        const index = await pack.getIndex({ fields: FIELDS });
        return [...index].filter((entry) => entry.type !== "kit").map(factsOfEntry);
    })().catch((error) => {
        console.warn("pf2e-artisans-workshop | the equipment index could not be read", error);
        loading = null;
        return [];
    });
    return loading;
}

/** The catalogue by UUID. */
export async function catalogueByUuid() {
    return new Map((await catalogue()).map((facts) => [facts.uuid, facts]));
}

/** Items whose name contains `text` (two letters at least), at most `limit`. */
export async function searchCatalogue(text, limit = 12) {
    const needle = String(text ?? "").trim().toLowerCase();
    if (needle.length < 2) return [];
    return (await catalogue()).filter((item) => item.name.toLowerCase().includes(needle)).slice(0, limit);
}

/** For tests only. */
export function resetCatalogue() {
    loading = null;
}
