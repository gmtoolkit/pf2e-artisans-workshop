/**
 * "Use best consumable" (DESIGN.md 8.9, M8). Pure: the choice within a family (held, then worn, then stowed; the
 * soonest-expiring infused item first; inert items skipped; ask only when two are equally good: `chooseBest` of
 * `scripts/logic/alchemy.mjs`), and the roster's summary of a character's consumables by family (4.10), which the party
 * view reads. Families come from the compendium data (6.4 `familyKey`), never from slug lists, so Remaster items, quick
 * vials and versatile vials are families like any other.
 */
import { compareIds } from "./ids.mjs";

/**
 * Where an item is carried, as `chooseBest` ranks it: `held`, `worn`, `stowed` (in a container, or carried in none of the
 * other ways) or `dropped`.
 *
 * @param {{carryType?: string|null, inContainer?: boolean}} equipped
 */
export function carryOf({ carryType = null, inContainer = false } = {}) {
    if (inContainer) return "stowed";
    if (carryType === "held" || carryType === "worn" || carryType === "dropped") return carryType;
    return "stowed";
}

/**
 * A character's consumables by family for its roster snapshot (4.10, 8.9): `{[family]: {qty, soonestExpiry}}`, where
 * `soonestExpiry` is the earliest world-time deadline (`at`) among the family's stamped items, or null. Inert items do not
 * count.
 *
 * @param {{family: string, qty: number, inert?: boolean, stamp?: object|null}[]} items
 */
export function familySummary(items) {
    const out = {};
    for (const item of items) {
        if (item.inert || !item.family || !(item.qty > 0)) continue;
        const entry = out[item.family] ??= { qty: 0, soonestExpiry: null };
        entry.qty += item.qty;
        const at = Number.isFinite(item.stamp?.at) ? item.stamp.at : null;
        if (at !== null && (entry.soonestExpiry === null || at < entry.soonestExpiry)) entry.soonestExpiry = at;
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compareIds(a, b)));
}

/**
 * Who holds a family (8.9 party view), from the roster snapshots: `[{actor, name, qty, soonestExpiry}]`, most first. The
 * module never moves another player's item: handing one over is pf2e's trade or the strongbox.
 */
export function holdersOf(snapshots, family) {
    return snapshots.filter((s) => s?.consumables?.[family]?.qty > 0)
        .map((s) => ({ actor: s.id, name: s.name, qty: s.consumables[family].qty, soonestExpiry: s.consumables[family].soonestExpiry ?? null }))
        .sort((a, b) => b.qty - a.qty || compareIds(a.actor, b.actor));
}

