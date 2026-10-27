/**
 * Combat alchemy (DESIGN.md 8.1-8.6, 8.8, M8). Pure: what Quick Alchemy can make for a character (8.3), what one use of
 * it costs and why it would be refused (Double Brew, additives, the vials, 8.3, 8.6), the potency stamp an item it makes
 * gets and when that stamp has run out in an encounter (8.8), the splash numbers a bomb shows (8.8), the healing a Healing
 * Bomb's adjacent creatures regain (8.6), the 10-minute cap on effects (8.8), and which ready bomb Quick Bomber draws
 * (8.4). The Foundry side (`scripts/foundry/alchemy.mjs`, `combat.mjs`, `expiry.mjs`) reads the actors and calls pf2e.
 *
 * A Quick Alchemy stamp (4.12) is `flags.MOD.expiry = {creator, cycle, rule, when?, quick, combat, at?}`:
 * - `rule`: `turn-start` (potent until the start of the creator's next turn), or `turn-end` with `when` `next` (until the
 *   end of the creator's next turn: tools and elixirs with Enduring Alchemy) or `current` (until the end of the creator's
 *   current turn: quick vials);
 * - `quick`: what made it, `quick-alchemy` or `quick-vial`;
 * - `combat`: `{id, combatant, round, turn}` when it was made in a started encounter the creator is in: the encounter,
 *   the creator's combatant, and the encounter's round and turn index at that moment; else null, and `at` (world
 *   seconds) is one round (6 s) after it was made.
 */
import { familyKey, formulaCoverage } from "./families.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { heldEffects, testPredicate } from "./registry.mjs";

/** The pf2e crafting ability and resource Quick Alchemy uses (`quick-alchemy`, `versatile-vials`). */
export const QUICK_ALCHEMY = "quick-alchemy";
export const VIAL_RESOURCE = "versatile-vials";

/** One round of world time (Player Core: 6 seconds), and the 10-minute cap on Quick Alchemy effects (8.8). */
export const ROUND_SECONDS = 6;
export const EFFECT_CAP_SECONDS = 600;

const asSet = (options) => (options instanceof Set ? options : new Set(options ?? []));

/* -------------------------------------------- */
/*  What Quick Alchemy can make (8.3)            */
/* -------------------------------------------- */

/**
 * The items a character can make with Quick Alchemy (8.3): every catalogue item the `quick-alchemy` ability's predicates
 * accept (`accepts`, pf2e's `craftableItems`: alchemical consumables), of the ability's item level or lower (the
 * character's level), with a formula: in the book (`known`), or covered by its family (one formula makes any level of
 * the item, Player Core 2; the same setting as every other route, 6.4). Sorted by name.
 *
 * @param {object[]} items    catalogue facts (`scripts/foundry/catalogue.mjs`): `{uuid, name, type, category, level, rarity, traits, options}`
 * @param {object} p
 * @param {object[]} p.known      the catalogue facts of the formulas in the book
 * @param {number} p.maxLevel     the ability's item level
 * @param {(options: Set<string>) => boolean} p.accepts
 * @returns {{uuid: string, name: string, img: string|null, level: number, route: "known"|"family", family: string, traits: string[],
 *   options: string[], bomb: boolean, elixir: boolean, tool: boolean}[]}
 */
export function quickChoices(items, { known, maxLevel, accepts }, rules = DEFAULT_RULES) {
    const out = [];
    for (const item of items) {
        if (!Number.isFinite(item.level) || item.level > maxLevel) continue;
        const options = asSet(item.options);
        if (!accepts(options)) continue;
        const coverage = formulaCoverage(known, item, rules);
        if (!coverage) continue;
        const traits = item.traits ?? [];
        out.push({
            uuid: item.uuid, name: item.name, img: item.img ?? null, level: item.level, route: coverage.route, family: familyKey(item), traits,
            options: [...options], bomb: traits.includes("bomb"), elixir: traits.includes("elixir"), tool: options.has("item:tag:alchemical-tool"),
        });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "en") || a.level - b.level);
}

/**
 * The choices whose name holds every word of `query` (case and accents ignored), in their order: the panel's "type to
 * filter" (8.3).
 */
export function searchChoices(choices, query) {
    const fold = (text) => String(text ?? "").normalize("NFD").replace(/\p{Mark}/gu, "").toLowerCase();
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return choices;
    return choices.filter((choice) => {
        const name = fold(choice.name);
        return words.every((word) => name.includes(word));
    });
}

/** The index the arrow keys move to in a list of `length` (8.3 keyboard): clamped, never past either end. */
export function moveIndex(index, delta, length) {
    if (length <= 0) return -1;
    const from = Number.isInteger(index) && index >= 0 ? index : delta > 0 ? -1 : length;
    return Math.min(Math.max(from + delta, 0), length - 1);
}

/** The best grade of a family a character can make (Healing Bomb's "best" elixir of life, Quick Bomber's bomb). */
export function bestOfFamily(choices, family) {
    return choices.filter((c) => c.family === family).sort((a, b) => b.level - a.level)[0] ?? null;
}

/* -------------------------------------------- */
/*  Additives (8.6)                              */
/* -------------------------------------------- */

/**
 * The additives a character holds (6.11 `additive`): `{key, when, vials, toggle}`. `when` is the items it fits, `vials`
 * the extra versatile vials it costs (Combine Elixirs), `toggle` the pf2e roll option a Strike with the item turns on
 * (OQ-27: the system's own toggles).
 */
export function additivesOf(held, rules = DEFAULT_RULES) {
    return heldEffects(held, "additive", rules).map(({ key, effect }) => ({
        key, when: effect.when ?? null, vials: Number.isInteger(effect.vials) ? effect.vials : 0, toggle: effect.toggle ?? null,
        combine: effect.combine === true,
    }));
}

/** The additives that fit an item (its roll options): the picker lists only these (8.6). */
export function additivesFor(additives, options) {
    const set = asSet(options);
    return additives.filter((additive) => testPredicate(additive.when, set));
}

/**
 * Whether the character's one additive of this round is spent (8.6: at most one per round per actor): `record` is
 * `flags.MOD.combat.additive = {combat, round, at}`. In an encounter it counts for the same encounter and round; outside
 * one, for a round of world time.
 *
 * @param {{combat?: string|null, round?: number|null, at?: number}|null} record
 * @param {{combat: {id: string, round: number}|null, worldTime: number}} now
 */
export function additiveSpent(record, { combat = null, worldTime = 0 } = {}) {
    if (!record || typeof record !== "object") return false;
    if (combat) return record.combat === combat.id && record.round === combat.round;
    return !record.combat && Number.isFinite(record.at) && worldTime - record.at < ROUND_SECONDS;
}

/**
 * Whether Abundant Vials' extra action has made its quick vial this turn (8.5): `record` is `flags.MOD.combat.quickened =
 * {combat, round, turn}`; outside an encounter there is no extra action to spend.
 */
export function quickenedSpent(record, combat) {
    if (!combat || !record) return false;
    return record.combat === combat.id && record.round === combat.round && record.turn === combat.turn;
}

/* -------------------------------------------- */
/*  One use of Quick Alchemy (8.3, 8.6)          */
/* -------------------------------------------- */

/**
 * What one Quick Alchemy action costs and why it would be refused (8.3, 8.6), before anything is made. pf2e's own path
 * crafts for free at 0 vials, so the gate is here.
 *
 * @param {object} p
 * @param {object[]} p.picks          the choices picked (`quickChoices` entries), one, or two with Double Brew
 * @param {number} p.vials            versatile vials the character has (the resource, which counts, 7.3)
 * @param {number} [p.brew]           how many items one action makes (2 with Double Brew)
 * @param {string|null} [p.additive]  the additive's key, put on the first pick
 * @param {object[]} [p.additives]    `additivesOf` the character
 * @param {boolean} [p.additiveSpent] whether this round's additive is spent (`additiveSpent`)
 * @param {object|null} [p.combine]   Combine Elixirs' second elixir (a choice)
 * @returns {{ok: boolean, cost: number, problems: {reason: string, data?: object}[]}}
 */
export function brewPlan({ picks = [], vials = 0, brew = 1, additive = null, additives = [], additiveSpent: spent = false, combine = null }) {
    const problems = [];
    const add = (reason, data = {}) => problems.push({ reason, data });
    if (!picks.length) add("nothing-picked");
    if (picks.length > Math.max(1, brew)) add("double-brew");
    let cost = picks.length;
    if (additive) {
        const held = additives.find((a) => a.key === additive);
        const first = picks[0];
        if (!held) add("additive-unknown", { additive });
        else if (!first || !testPredicate(held.when, asSet(first.options))) add("additive-fit", { additive });
        else if (spent) add("additive-round", { additive });
        if (held?.combine) {
            if (!combine) add("combine-pick");
            else if (!combine.elixir || combine.level > (first?.level ?? -1)) add("combine-fit", { level: first?.level ?? null });
        }
        cost += held?.vials ?? 0;
    }
    if (vials <= 0) add("no-vials");
    else if (cost > vials) add("vials", { n: cost, have: vials });
    return { ok: problems.length === 0, cost, problems };
}

/* -------------------------------------------- */
/*  Potency and turn expiry (8.8)                */
/* -------------------------------------------- */

/**
 * The potency rule of an item Quick Alchemy makes (8.3, 8.5, 8.8): a quick vial lasts until the end of the current turn;
 * a tool or elixir made by a character with Enduring Alchemy until the end of the next turn; everything else until the
 * start of the next turn.
 *
 * @param {Set<string>|string[]} options   the item's roll options
 * @param {{quickVial?: boolean, enduring?: {when: object}[]}} p   `enduring`: the character's `expiryRule {rule: "enduring"}` effects
 * @returns {{rule: "turn-start"|"turn-end", when?: "current"|"next"}}
 */
export function potencyRule(options, { quickVial = false, enduring = [] } = {}) {
    if (quickVial) return { rule: "turn-end", when: "current" };
    const set = asSet(options);
    if (enduring.some((e) => testPredicate(e.when, set))) return { rule: "turn-end", when: "next" };
    return { rule: "turn-start" };
}

/**
 * The stamp an item Quick Alchemy makes gets (4.12, 8.8). `combat` is `{id, combatant, round, turn}` of the started
 * encounter the creator is a combatant in, or null: then the item lasts one round of world time (`at`).
 */
export function quickStamp({ creator, cycle = 0, options = [], quickVial = false, enduring = [], combat = null, worldTime = 0 }) {
    if (typeof creator !== "string" || !creator) throw new TypeError("a stamp names its creator");
    const stamp = { creator, cycle: Number.isInteger(cycle) ? cycle : 0, ...potencyRule(options, { quickVial, enduring }), quick: quickVial ? "quick-vial" : "quick-alchemy" };
    if (combat) stamp.combat = { id: combat.id, combatant: combat.combatant, round: combat.round, turn: combat.turn };
    else {
        stamp.combat = null;
        stamp.at = worldTime + ROUND_SECONDS;
    }
    return stamp;
}

/** Whether a stamp is one of the turn rules (8.8). */
export const isTurnStamp = (stamp) => stamp?.rule === "turn-start" || stamp?.rule === "turn-end";

/** Two positions in an encounter, `{round, turn}`, compared: negative when `a` comes first. */
export function comparePosition(a, b) {
    return (a.round - b.round) || ((a.turn ?? 0) - (b.turn ?? 0));
}

/**
 * The position at which a turn stamp's item stops being potent (8.8), with the creator's turn index in the encounter
 * now: the first turn of the creator that starts after the item was made (the start of its next turn), or, for a quick
 * vial made in the creator's own turn, that turn. `after: true` means the item lasts through that turn (it ends when the
 * turn does); `false` that it ends as the turn starts.
 *
 * @returns {{round: number, turn: number, after: boolean} | null}  null when the creator has no turn in the encounter
 */
export function turnDeadline(stamp, creatorTurn) {
    if (!isTurnStamp(stamp) || !stamp.combat || !Number.isInteger(creatorTurn) || creatorTurn < 0) return null;
    const made = { round: stamp.combat.round, turn: stamp.combat.turn ?? 0 };
    const ownTurn = made.turn === creatorTurn;
    const next = made.turn < creatorTurn ? { round: made.round, turn: creatorTurn } : { round: made.round + 1, turn: creatorTurn };
    if (stamp.rule === "turn-start") return { ...next, after: false };
    if (stamp.when === "current" && ownTurn) return { round: made.round, turn: creatorTurn, after: true };
    return { ...next, after: true };
}

/**
 * Whether a turn stamp's item has stopped being potent at `position` (the encounter's `{round, turn}` now), the creator's
 * turn index being `creatorTurn` (8.8). It reads only the encounter's state now, so a turn skipped, several turns at
 * once, or a client that missed the change all give the same answer. A creator who has left the encounter ends it.
 */
export function turnExpired(stamp, { position, creatorTurn }) {
    if (!position || !Number.isInteger(position.round)) return false;
    const deadline = turnDeadline(stamp, creatorTurn);
    if (!deadline) return true;
    const cmp = comparePosition(position, deadline);
    return deadline.after ? cmp > 0 : cmp >= 0;
}

/* -------------------------------------------- */
/*  Splash (8.8) and Healing Bomb (8.6)          */
/* -------------------------------------------- */

/**
 * The splash numbers a bomb shows (8.8; numbers only, no template, OQ-29): the splash damage (the bomb's own, or the
 * Intelligence modifier, minimum 1, with the bomber's field discovery), Expanded Splash's status bonus (the Intelligence
 * modifier again), the radius (5 feet; 10 with Expanded Splash or the bomber's greater field discovery, 15 with both),
 * Directional Bombs' cone (15 feet, 20 with a larger radius), and the bomber's primary-target-only option.
 *
 * @param {object} p
 * @param {number} p.base           the bomb's own splash damage
 * @param {number} p.int            the creator's Intelligence modifier
 * @param {object} [p.splash]       the creator's `splash` registry effects, merged: `{intDamage, bonusInt, radius, greater, cone, primaryOnly}`
 */
export function splashNumbers({ base = 0, int = 0, splash = {} }) {
    const damage = splash.intDamage ? Math.max(1, int) : Math.max(0, base);
    const bonus = splash.bonusInt ? Math.max(0, int) : 0;
    const wider = !!splash.bonusInt;
    const radius = splash.greater ? (wider ? 15 : 10) : wider ? 10 : 5;
    return { damage, bonus, total: damage + bonus, radius, cone: splash.cone ? (radius > 5 ? 20 : 15) : null, primaryOnly: !!splash.primaryOnly };
}

/** Several `splash` effects as one (`splashNumbers`' `splash`). */
export function mergeSplash(effects) {
    const out = {};
    for (const e of effects) {
        if (e.intDamage) out.intDamage = true;
        if (e.bonusInt) out.bonusInt = true;
        if (e.greater) out.greater = true;
        if (e.cone) out.cone = true;
        if (e.primaryOnly) out.primaryOnly = true;
    }
    return out;
}

/** A versatile vial's splash at its level, as its own rule element raises it (1, 2 at 4th, 3 at 12th, 4 at 18th). */
export function vialSplash(level) {
    if (level >= 18) return 4;
    if (level >= 12) return 3;
    if (level >= 4) return 2;
    return 1;
}

/**
 * The number of damage dice in a formula (`"3d6+6"` has 3): the Hit Points each living creature adjacent to a Healing
 * Bomb's target regains (8.6), read from the elixir's own healing formula, never a table.
 */
export function damageDiceCount(formula) {
    let n = 0;
    for (const match of String(formula ?? "").matchAll(/(\d*)d\d+/gi)) n += match[1] === "" ? 1 : Number(match[1]);
    return n;
}

/* -------------------------------------------- */
/*  The 10-minute cap (8.8)                      */
/* -------------------------------------------- */

/** Seconds in one of pf2e's duration units, or null for "unlimited" and "encounter". */
const UNIT_SECONDS = Object.freeze({ rounds: 6, minutes: 60, hours: 3600, days: 86400 });

/**
 * An effect's duration clamped to Quick Alchemy's 10 minutes (8.8): pf2e's `{value, unit}`; an unlimited one is capped
 * too, an encounter-long one is left (no encounter lasts that long). Returns the new duration, or null when it already
 * fits (or `uncapped`: Eternal Elixir, Persistent Mutagen).
 */
export function cappedDuration(duration, { uncapped = false } = {}) {
    if (uncapped || !duration || typeof duration !== "object") return null;
    if (duration.unit === "encounter") return null;
    const seconds = duration.unit === "unlimited" ? Infinity : UNIT_SECONDS[duration.unit] * Number(duration.value ?? 0);
    if (!Number.isFinite(seconds) && duration.unit !== "unlimited") return null;
    if (seconds <= EFFECT_CAP_SECONDS) return null;
    return { value: EFFECT_CAP_SECONDS / 60, unit: "minutes", expiry: duration.expiry ?? "turn-start" };
}

/**
 * Whether an `expiryRule {rule: "uncapped"}` lets an effect outlast the cap (8.8): the creator consumed its own item, the
 * item matches the rule, and its level is at most half the creator's when the rule says so (Eternal Elixir).
 *
 * @param {{when?: object, maxLevel?: "half"}[]} rules   the creator's uncapped rules
 */
export function uncapped(rules, { options, level, creatorLevel, own }) {
    if (!own) return false;
    const set = asSet(options);
    return rules.some((r) => testPredicate(r.when, set) && (r.maxLevel !== "half" || level <= Math.floor(creatorLevel / 2)));
}

/* -------------------------------------------- */
/*  Which item to draw (8.4, 8.9)                */
/* -------------------------------------------- */

/** How close at hand an item is: held, then worn, then stowed (8.4, 8.9). */
export const CARRY_RANK = Object.freeze({ held: 0, worn: 1, stowed: 2, dropped: 3 });

/**
 * How soon a stamped item stops being potent, as a number to sort by (smaller is sooner), with world time `worldTime`:
 * a turn rule soonest, then a world-time deadline by its `at`, then one that lasts until its creator's next preparations;
 * an item with no stamp last.
 */
export function expirySortKey(stamp, worldTime = 0) {
    if (!stamp) return Number.MAX_SAFE_INTEGER;
    if (isTurnStamp(stamp) && stamp.combat) return -1;
    if (Number.isFinite(stamp.at)) return Math.max(0, stamp.at - worldTime);
    return Number.MAX_SAFE_INTEGER - 1;
}

/**
 * The best item among candidates (8.4, 8.9): held, then worn, then stowed; among equals the soonest-expiring infused item
 * first; inert items never. `ties` lists the candidates as good as the best (the picker asks only then, 8.9).
 *
 * @param {{id: string, carry: string, infused?: boolean, inert?: boolean, stamp?: object|null}[]} candidates
 * @returns {{best: object|null, ties: object[]}}
 */
export function chooseBest(candidates, worldTime = 0) {
    const live = candidates.filter((c) => !c.inert);
    const key = (c) => [CARRY_RANK[c.carry] ?? CARRY_RANK.stowed, c.infused ? expirySortKey(c.stamp, worldTime) : Number.MAX_SAFE_INTEGER];
    const sorted = [...live].sort((a, b) => {
        const [ca, ea] = key(a);
        const [cb, eb] = key(b);
        return ca - cb || ea - eb;
    });
    const best = sorted[0] ?? null;
    if (!best) return { best: null, ties: [] };
    const [cb, eb] = key(best);
    const ties = sorted.filter((c) => {
        const [cc, ec] = key(c);
        return cc === cb && ec === eb;
    });
    return { best, ties };
}

/* -------------------------------------------- */
/*  Advanced Vials (7.3, OQ-22)                  */
/* -------------------------------------------- */

/**
 * Take one vial from a material bucket for a throw (7.3): the chosen bucket when it has one, else plain. Returns the
 * buckets after the throw and the material thrown (null for plain), or null when no bucket holds a vial.
 */
export function takeFromBucket(buckets, material = null) {
    const out = { ...(buckets ?? {}) };
    const from = material && out[material] > 0 ? material : out.plain > 0 ? "plain" : null;
    if (!from) return null;
    out[from] -= 1;
    if (out[from] <= 0) delete out[from];
    return { buckets: out, material: from === "plain" ? null : from };
}
