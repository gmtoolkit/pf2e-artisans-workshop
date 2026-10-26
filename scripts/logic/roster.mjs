/**
 * Roster snapshots (DESIGN.md 4.10): what each member's responsible client publishes to
 * `roster.<actorId>` so that players, who cannot see each other's sheets, can see who can craft what and who
 * can help. Pure: the Foundry side extracts plain data from the actor (`scripts/foundry/roster.mjs`).
 */
import { compareIds } from "./ids.mjs";

export const ROSTER_VERSION = 1;

/** Sorted copy, so the same actor always gives the same snapshot (and an unchanged one is not rewritten). */
const sorted = (values) => [...new Set(values)].sort(compareIds);
const sortedObject = (object) => Object.fromEntries(Object.entries(object ?? {}).sort(([a], [b]) => compareIds(a, b)));

/**
 * The snapshot of one actor.
 *
 * @param {object} actor  plain data read from the actor
 * @param {string} actor.id
 * @param {string} actor.name
 * @param {string} actor.img
 * @param {number} actor.level
 * @param {string} actor.size
 * @param {Record<string, number>} actor.skills    skill slug to rank, trained or better
 * @param {string[]} actor.feats      registry slugs of the feats the rules read
 * @param {string[]} actor.formulas   UUIDs in the formula book
 * @param {{slug: string, maxSlots: number, maxItemLevel: number, resource: string|null}[]} actor.abilities
 * @param {{value: number, max: number}|null} actor.vials
 * @param {{value: number, max: number}|null} actor.investiture
 * @param {Record<string, {qty: number, soonestExpiry: number|null}>} [actor.consumables]  by family (8.9)
 * @param {{by: string, at: {real: number}}} stamp
 */
export function rosterSnapshot(actor, stamp) {
    return {
        id: actor.id,
        v: ROSTER_VERSION,
        name: actor.name,
        img: actor.img,
        level: actor.level,
        size: actor.size,
        crafting: { rank: actor.skills.crafting ?? 0 },
        skills: sortedObject(actor.skills),
        feats: sorted(actor.feats),
        formulas: sorted(actor.formulas),
        abilities: [...actor.abilities].sort((a, b) => compareIds(a.slug, b.slug))
            .map(({ slug, maxSlots, maxItemLevel, resource }) => ({ slug, maxSlots, maxItemLevel, resource: resource ?? null })),
        vials: actor.vials ? { value: actor.vials.value, max: actor.vials.max } : null,
        investiture: actor.investiture ? { value: actor.investiture.value, max: actor.investiture.max } : null,
        consumables: sortedObject(actor.consumables),
        updatedAt: stamp.at.real,
        by: stamp.by,
    };
}

/** Whether two snapshots say the same thing, ignoring when and by whom they were written. */
export function sameRoster(a, b) {
    if (!a || !b) return false;
    const strip = (snapshot) => {
        const rest = { ...snapshot };
        delete rest.updatedAt;
        delete rest.by;
        return rest;
    };
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
