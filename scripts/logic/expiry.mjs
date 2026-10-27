/**
 * Expiry stamps and party-wide expiry (DESIGN.md 4.12, 7.1, 7.7, M7). Pure: the stamp an output gets, whether a stamped
 * item has expired, which outputs of a preparation run are new or merged into an existing stack (and must be split off
 * before stamping), and Food Preservation's designations. The Foundry side (`scripts/foundry/expiry.mjs`,
 * `scripts/foundry/morning.mjs`) reads the actors and writes the flags.
 *
 * A stamp is `flags.MOD.expiry = {creator, cycle, rule, pool?, at?, atDay?, exempt?}`:
 * - `creator`: the creator's actor UUID; `cycle`: the creator's daily-preparation counter (`pcs.<actorId>.prepCycle`) when
 *   the item was made. A `prep` stamp expires once the creator's counter is past it: at the creator's next daily
 *   preparations, wherever the item is (7.7).
 * - Advanced Alchemy items also carry `at` (world seconds, 24 hours after creation) and `atDay` (the workshop day after
 *   the day of creation): whichever comes first ends them (Player Core 2, Advanced Alchemy). `atDay` counts only days
 *   logged ahead of the clock (the wizard's days, 4.8): a clock that crosses midnight is not 24 hours, and `at` covers it.
 * - `exempt`: a feat's exception (Food Preservation's designation, 7.7), `{key, id, n, at}`; an exempt item never expires
 *   on these rules while its designation stands. Food Preservation's designations are kept on the creator
 *   (`flags.MOD.morning.preserved`, wherever the food has gone): one the creator's later designations push past the cap
 *   has spoiled, and the food expires at once (`spoiled`).
 */
import { isTurnStamp, turnExpired } from "./alchemy.mjs";
import { RANK } from "./core.mjs";

/** Stamp rules (4.12); M7 writes `prep` stamps, M8 the turn rules (8.8), gardens and fulus the `world` rule. */
export const EXPIRY_RULES = Object.freeze(["prep", "turn-start", "turn-end", "world"]);

/** How long an Advanced Alchemy item lasts at most, in world seconds (Player Core 2: 24 hours). */
export const ADVANCED_ALCHEMY_SECONDS = 86400;

/** The crafting pool whose items carry the 24-hour deadline (7.7). */
export const ADVANCED_POOL = "advanced-alchemy";

/**
 * The stamp a daily-preparation output gets (7.7): the creator, its current cycle, and for Advanced Alchemy the 24-hour
 * deadline and the next logged day.
 *
 * @param {object} p
 * @param {string} p.creator      the creator's actor UUID
 * @param {number} p.cycle        the creator's `prepCycle` now
 * @param {string|null} [p.pool]  the crafting ability the item came from
 * @param {number} [p.worldTime]  world seconds now (needed for Advanced Alchemy)
 * @param {number} [p.day]        the workshop day now (needed for Advanced Alchemy)
 */
export function prepStamp({ creator, cycle, pool = null, worldTime = null, day = null }) {
    if (typeof creator !== "string" || !creator) throw new TypeError("a stamp names its creator");
    if (!Number.isInteger(cycle) || cycle < 0) throw new RangeError(`a cycle is a whole number, not ${cycle}`);
    const stamp = { creator, cycle, rule: "prep", pool };
    if (pool === ADVANCED_POOL) {
        if (!Number.isFinite(worldTime) || !Number.isInteger(day)) throw new TypeError("an Advanced Alchemy stamp needs the time and the day");
        stamp.at = worldTime + ADVANCED_ALCHEMY_SECONDS;
        stamp.atDay = day + 1;
    }
    return stamp;
}

/** Whether two stamps say the same (a stack may hold items of one stamp only, 4.12). Null and undefined are no stamp. */
export function sameStamp(a, b) {
    if (!a || !b) return !a && !b;
    return a.creator === b.creator && a.cycle === b.cycle && a.rule === b.rule && (a.at ?? null) === (b.at ?? null) &&
        (a.atDay ?? null) === (b.atDay ?? null) && !!a.exempt === !!b.exempt;
}

/**
 * Why a stamped item has expired, or null while it has not (7.7, 8.8):
 * - `cycle`: the creator made daily preparations since (its counter is past the stamp's);
 * - `time`: world time reached `at`;
 * - `day`: the days logged ahead of the clock reached `atDay`;
 * - `spoiled`: a preserved food whose designation the creator no longer holds (Food Preservation: "the previous item
 *   becomes inedible");
 * - `turn` (M8): a Quick Alchemy item made in an encounter whose potency ran out with a turn (`turnExpired`), read from the
 *   encounter's state now (`turn(stamp)` gives `{position, creatorTurn}`, or `{gone: true}` once the encounter is over);
 * - `combat-end` (M8): such an item when its encounter has ended and `combatEnd` is on (`expiry.quickAlchemyAtCombatEnd`).
 *   With it off the Foundry side gives the item a round of world time instead (`at`, 8.8).
 * A Quick Alchemy item made outside an encounter lasts one round of world time (`at`, `time`).
 * Exempt items whose designation stands (or cannot be read: `designations` null) and items already inert never expire
 * here.
 *
 * @param {object|null} stamp
 * @param {{creatorCycle?: number|null, worldTime?: number|null, loggedDay?: number|null, inert?: boolean,
 *   designations?: Set<string>|null, turn?: ((stamp: object) => object|null)|null, combatEnd?: boolean}} now
 *   `designations`: the ids of the creator's designations that stand
 */
export function expiryReason(stamp, { creatorCycle = null, worldTime = null, loggedDay = null, inert = false, designations = null, turn = null,
    combatEnd = true } = {}) {
    if (!stamp || typeof stamp !== "object" || inert) return null;
    if (stamp.exempt) return stamp.exempt.id && designations instanceof Set && !designations.has(stamp.exempt.id) ? "spoiled" : null;
    if (isTurnStamp(stamp)) {
        if (stamp.combat) {
            const state = typeof turn === "function" ? turn(stamp) : null;
            if (!state) return null;
            if (state.gone) return combatEnd ? "combat-end" : null;
            return turnExpired(stamp, state) ? "turn" : null;
        }
        return Number.isFinite(stamp.at) && Number.isFinite(worldTime) && worldTime >= stamp.at ? "time" : null;
    }
    if (stamp.rule === "prep") {
        if (Number.isInteger(creatorCycle) && Number.isInteger(stamp.cycle) && creatorCycle > stamp.cycle) return "cycle";
        if (Number.isFinite(stamp.at) && Number.isFinite(worldTime) && worldTime >= stamp.at) return "time";
        if (Number.isInteger(stamp.atDay) && Number.isInteger(loggedDay) && loggedDay >= stamp.atDay) return "day";
        return null;
    }
    if (stamp.rule === "world") return Number.isFinite(stamp.at) && Number.isFinite(worldTime) && worldTime >= stamp.at ? "time" : null;
    return null;
}

/** The actor id in an actor UUID (`Actor.<id>`), or null. */
export function actorIdOf(uuid) {
    if (typeof uuid !== "string") return null;
    const parts = uuid.split(".");
    return parts.length === 2 && parts[0] === "Actor" ? parts[1] : null;
}

/* -------------------------------------------- */
/*  Finding what a run created (7.1)             */
/* -------------------------------------------- */

/** An actor's physical items as `id → quantity`, before a run (7.1 step 1). */
export function snapshotOf(items) {
    return Object.fromEntries(items.map((item) => [item.id, item.quantity ?? 1]));
}

/**
 * What a run created (7.1 step 2): new ids, and the quantity added to stacks that existed. `merged` outputs went into an
 * existing stack, whose earlier quantity is `before`.
 *
 * @param {Record<string, number>} before   `snapshotOf` the items before the run
 * @param {{id: string, quantity: number}[]} after
 * @returns {{id: string, added: number, merged: boolean, before: number}[]}
 */
export function outputsOf(before, after) {
    const out = [];
    for (const { id, quantity = 1 } of after) {
        const was = before[id];
        if (was === undefined) out.push({ id, added: quantity, merged: false, before: 0 });
        else if (quantity > was) out.push({ id, added: quantity - was, merged: true, before: was });
    }
    return out;
}

/**
 * Whether an output must be split into its own item before stamping (7.1 step 3): it merged into a stack whose stamp is
 * not the one it gets (another creator's delivery, an earlier cycle, an unstamped stack it would stamp by mistake).
 */
export function needsSplit(output, existingStamp, stamp) {
    return output.merged && output.before > 0 && !sameStamp(existingStamp, stamp);
}

/* -------------------------------------------- */
/*  Food Preservation (7.7, 7.10)                */
/* -------------------------------------------- */

/**
 * How many alchemical foods a Food Preservation holder may designate at each preparation, and keep preserved at once
 * (Lost Omens Tian Xia Character Guide): one, two from expert (in Crafting or Cooking Lore), three at master, five at
 * legendary.
 */
export function preservationCap(rank) {
    if (rank >= RANK.legendary) return 5;
    if (rank >= RANK.master) return 3;
    if (rank >= RANK.expert) return 2;
    return 1;
}

/**
 * Designate foods (7.7 exception, Food Preservation): `count` new foods are designated at this preparation. At most `cap`
 * may be designated in one cycle, and at most `cap` stay preserved at once, counting the creator's designations wherever
 * the foods have gone: past that, the oldest spoil (the rule's "inedible").
 *
 * @param {{id: string, n: number, cycle: number}[]} designations   the creator's designations that stand, `n` increasing
 * @param {number} count    foods designated now
 * @param {number} cap      `preservationCap`
 * @param {number} cycle    the creator's preparation cycle now
 * @returns {{ok: true, spoil: string[]} | {ok: false, reason: "too-many", data: {cap: number, left: number}}}
 */
export function preservePlan(designations, count, cap, cycle) {
    const today = designations.filter((d) => d.cycle === cycle).length;
    if (count + today > cap) return { ok: false, reason: "too-many", data: { cap, left: Math.max(0, cap - today) } };
    const over = designations.length + count - cap;
    const oldest = [...designations].sort((a, b) => a.n - b.n);
    return { ok: true, spoil: over > 0 ? oldest.slice(0, over).map((d) => d.id) : [] };
}
