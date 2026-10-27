/**
 * Vial gathering (DESIGN.md 8.7, M8). Pure: how many versatile vials gathering reagents regains over elapsed time, with
 * the remainder carried to the next time the clock moves (`flags.MOD.vialClock`), how many Improvise Admixture regains by
 * degree, and the cap. The Foundry side (`scripts/foundry/vials.mjs`) reads the resource again at write time and writes it
 * with `actor.updateResource`, which clamps to the maximum, so a second click or a second client never goes past it.
 *
 * Only sources the registry marks as regaining do so during the day (`vialSource {regain: true}`: the alchemist's
 * Versatile Vials and Firework Technician, Player Core 2 p.173).
 */
import { DEGREE } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { heldEffects } from "./registry.mjs";

/** Gathering reagents takes 10 minutes of exploration (Player Core 2). */
export const GATHER_SECONDS = 600;

/** Vials regained per 10 minutes of gathering: 2, or the registry's `gather {per10}` (Alchemical Expertise: 3). */
export function gatherRate(held, rules = DEFAULT_RULES) {
    return Math.max(2, ...heldEffects(held, "gather", rules).map(({ effect }) => effect.per10 ?? 2));
}

/** Whether any of a character's vial sources regains during the day (`vialSources` of `scripts/logic/morning.mjs`). */
export const regains = (sources) => sources.some((s) => s.regain === true);

/**
 * Vials regained over `elapsed` seconds of world time with `clock` seconds carried from before (8.7): `per` vials for
 * every full 10 minutes; the remainder is carried. Time going back (a negative `elapsed`) gathers nothing and keeps the
 * clock.
 *
 * @returns {{add: number, clock: number}}
 */
export function gatherOver({ elapsed, clock = 0, per = 2 }) {
    const carried = Number.isFinite(clock) && clock > 0 ? clock : 0;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return { add: 0, clock: carried };
    const total = carried + elapsed;
    const tens = Math.floor(total / GATHER_SECONDS);
    return { add: tens * per, clock: total - tens * GATHER_SECONDS };
}

/** The vials a character ends with when it regains `add` (never past `max`), and how many that is. */
export function regainTo({ value = 0, max = 0, add = 0 }) {
    const to = Math.min(max, Math.max(value, value + Math.max(0, add)));
    return { to, gained: Math.max(0, to - value) };
}

/** Improvise Admixture (Player Core 2): 3 vials on a critical success, 2 on a success, 1 on a failure, none on a critical failure. */
export function admixtureVials(degree) {
    return { [DEGREE.critSuccess]: 3, [DEGREE.success]: 2, [DEGREE.fail]: 1, [DEGREE.critFail]: 0 }[degree] ?? 0;
}
