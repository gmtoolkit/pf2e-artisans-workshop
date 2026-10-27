/**
 * The pf2e-dailies custom daily (DESIGN.md 7.9, 13, M7). When pf2e-dailies is active, the module registers one custom
 * daily, `pf2e-artisans-workshop.morning`, through `game.dailies.api.registerCustomDailies` (pf2e-dailies 4.23.1 keeps its
 * API at `game.dailies.api`; `registerCustomDailies` accepts a daily with `key`, `rows`, `process` and a `condition`).
 *
 * - Shown when the character has a daily-preparation crafting pool or versatile vials (`condition`).
 * - Rows: a select per pool ("keep current preparation", each saved loadout, "prepare in the Workshop later"), and a
 *   notify row listing the standing orders due today.
 * - `process` only records the choice on the actor (`flags.MOD.morning.choice = {pools, standing, cycle, at}`); it never
 *   creates items inside the pf2e-dailies flow, so the two modules' item bookkeeping never mixes. When pf2e-dailies has
 *   finished (its `rested` flag goes back to false), the character's responsible client applies the choice through the
 *   system's methods (`rest.mjs`, OQ-20).
 * - Its rows do not use pf2e-dailies' `save` (its flags are keyed by the daily's key, which holds a dot here); the
 *   Workshop keeps its own record.
 * Features pf2e-dailies already covers (scroll caches, staves, Root Magic and the like) are never duplicated: the Morning
 * tab shows them as handled by pf2e-dailies (7.10 `dailyGap` flow `dailies`).
 */
import { MODULE_ID } from "../constants.mjs";
import { standingDue } from "../logic/morning.mjs";
import { statusOf, today } from "./downtime.mjs";
import { dailiesActive, hasDailySources, loadoutsOf, morningOn } from "./morning.mjs";
import { records, stampNow } from "./store.mjs";

/** The custom daily's key (7.9). */
export const DAILY_KEY = "pf2e-artisans-workshop.morning";

/** A pool's label as pf2e gives it (an i18n key or text). */
const labelOf = (label) => (typeof label === "string" && game.i18n.has?.(label) ? game.i18n.localize(label) : label ?? "");

/** The daily pools of a character. */
const poolsOf = (actor) => [...(actor?.crafting?.abilities ?? [])].filter((a) => a.isDailyPrep);

/** The standing orders a character fills today, in words for the notify row. */
function standingText(actor) {
    let day;
    try {
        day = today().day;
    } catch {
        day = 0;
    }
    const due = standingDue(records("standing"), { crafter: actor.uuid, day });
    if (!due.length) return null;
    const lines = due.map((s) => game.i18n.format("pf2e-artisans-workshop.Dailies.StandingLine", {
        qty: String(s.qty), item: s.name || s.family, recipient: fromUuidSync(s.recipient, { strict: false })?.name ?? "",
    }));
    return game.i18n.format("pf2e-artisans-workshop.Dailies.Standing", { orders: lines.join("; ") });
}

/** The rows of the custom daily (7.9). */
export function dailyRows(actor) {
    const loadouts = Object.values(loadoutsOf(actor));
    const rows = poolsOf(actor).map((pool) => ({
        type: "select", slug: pool.slug, label: labelOf(pool.label),
        options: [
            { value: "keep", label: game.i18n.localize("pf2e-artisans-workshop.Dailies.Keep") },
            ...loadouts.filter((l) => l.pools?.[pool.slug] || l.talismans?.[pool.slug]).map((l) => ({ value: l.id, label: l.name })),
            { value: "later", label: game.i18n.localize("pf2e-artisans-workshop.Dailies.Later") },
        ],
    }));
    const standing = standingText(actor);
    if (standing) rows.push({ type: "notify", slug: "standing", message: standing });
    return rows;
}

/** The custom daily object pf2e-dailies registers (7.9). */
export function morningDaily() {
    return {
        key: DAILY_KEY,
        label: "pf2e-artisans-workshop.Dailies.Label",
        condition: (actor) => morningOn() && hasDailySources(actor),
        rows: (actor) => dailyRows(actor),
        process: async ({ actor, rows }) => {
            const pools = {};
            for (const pool of poolsOf(actor)) {
                const value = rows?.[pool.slug];
                if (typeof value === "string" && value) pools[pool.slug] = value;
            }
            await actor.update({ [`flags.${MODULE_ID}.morning.choice`]: { pools, standing: true, cycle: statusOf(actor).prepCycle, ...stampNow(), applied: null } });
        },
    };
}

/** Register the custom daily, at `ready`, when pf2e-dailies is active and exposes its API. Returns whether it did. */
export function registerDailies() {
    if (!dailiesActive()) return false;
    const api = game.dailies?.api;
    if (typeof api?.registerCustomDailies !== "function") {
        console.warn(`${MODULE_ID} | pf2e-dailies is active but game.dailies.api.registerCustomDailies is missing; the Morning daily is not registered`);
        return false;
    }
    api.registerCustomDailies([morningDaily()]);
    return true;
}
