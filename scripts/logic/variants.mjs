/**
 * Treasure Vault (Remastered) crafting variants (DESIGN.md 6.16), the pure parts: which groups are on (the one-group
 * notice), Complex Crafting's rushed finishing and its flat check, crafting downtime events and their cadence, Critical
 * Crafting's trigger and money rule, Deconstruct's gates and credit, Grow's skills and seasons, gardens of wonder, bestowed
 * gifts, crafting quests and crafting items with adjustments. Numbers come from `scripts/data/variants.mjs`; nothing here
 * reads Foundry, and nothing returns user-facing text (codes only, 6.1 As built).
 *
 * Every variant is a world setting that is off by default (14.4): each function that acts reads its switch from `rules`
 * and does nothing while it is off, so a table that never turns one on pays nothing for it.
 */
import {
    COMPONENTS_RUIN_PCT, CURSE_PENALTY_DEFAULT, DECONSTRUCT_LOSS_PCT, DECONSTRUCT_PCT, EVENT_GM_CORE_MAX, GARDEN_LEVELS_ABOVE,
    GARDEN_PCS_PER_GARDEN, PERMANENT_PRICE_MAX, QUEST_FLOOR_PCT, QUEST_FREE_ASSEMBLY, QUEST_REDUCTION_PCT, QUEST_THREATS,
    RUSH_FINISH_MULTIPLIER, RUSH_FLAT_BASE, THREAT_COLUMN, TREASURE_BY_ENCOUNTER, VARIANT_GROUPS,
} from "../data/variants.mjs";
import { COMPLEX_SUBDAY_HOURS } from "../data/complex-crafting.mjs";
import { DEGREE, FEAT, RANK, RARITIES, clamp, hasTrait, isMagical, rarityRank, requireCp, requireDegree, requireInteger } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import {
    gateAvailable, gateFeats, gateLevel, gateProficiency, gateTools, gateTrained,
} from "./gates.mjs";
import { hashId, idemKey } from "./ids.mjs";
import { incomePerDay } from "./income.mjs";
import { componentsCp, materialsCp } from "./materials.mjs";

const pass = (id) => ({ id, ok: true, reason: null, data: null, unlock: null });
const fail = (id, reason, data = {}, unlock = null) => ({ id, ok: false, reason, data, unlock });

/** The variant switches of `rules` (14.4), with the defaults for any it lacks. */
const variantsOf = (rules) => ({ ...DEFAULT_RULES.variants, ...(rules?.variants ?? {}) });

/* -------------------------------------------- */
/*  One group at a time (TV-R p.157)             */
/* -------------------------------------------- */

/** The groups (`VARIANT_GROUPS`) with at least one variant on, in the book's order. */
export function variantGroupsOn(rules = DEFAULT_RULES) {
    const v = variantsOf(rules);
    return Object.entries(VARIANT_GROUPS).filter(([, keys]) => keys.some((key) => v[key] === true)).map(([group]) => group);
}

/** Whether variants from more than one group are on: Settings says the book advises one at a time; nothing is blocked. */
export const mixedGroups = (rules = DEFAULT_RULES) => variantGroupsOn(rules).length > 1;

/** Whether any variant is on. */
export const anyVariantOn = (rules = DEFAULT_RULES) => variantGroupsOn(rules).length > 0;

/** Craft types the variants add (4.2.1); each exists only while its variant is on. */
export const VARIANT_CRAFT_TYPES = Object.freeze({ deconstruct: "deconstruct", grow: "grow", quest: "quests" });

/** Whether a variant craft type is open now (its variant on); any other type is. */
export function craftTypeOn(craftType, rules = DEFAULT_RULES) {
    const key = VARIANT_CRAFT_TYPES[craftType];
    return !key || variantsOf(rules)[key] === true;
}

/* -------------------------------------------- */
/*  Complex Crafting: rushed finishing (6.16.1)  */
/* -------------------------------------------- */

/**
 * The rushed finish's flat check DC (TV-R p.158): 10 + the item's level − the crafter's Crafting proficiency bonus (the
 * `proficiency` modifier of pf2e's Crafting statistic). Under Proficiency without Level that bonus is the rank's alone, so
 * the item-level term is dropped too (interpretation, OQ-42).
 */
export function rushedFinishDC({ itemLevel, proficiency, pwol = false }) {
    requireInteger(itemLevel, "itemLevel");
    requireInteger(proficiency, "proficiency");
    return RUSH_FLAT_BASE + (pwol ? 0 : itemLevel) - proficiency;
}

/**
 * The degree of a flat check (Player Core: a d20 with no modifiers against a DC). A DC of 1 or lower succeeds without a
 * roll and one of 21 or higher fails; otherwise degrees go by 10 over or under the DC, then one step for a natural 20 or 1.
 */
export function flatCheckDegree(die, dc) {
    requireInteger(die, "die");
    requireInteger(dc, "dc");
    if (dc <= 1) return DEGREE.success;
    const base = die - dc >= 10 ? DEGREE.critSuccess : dc - die >= 10 ? DEGREE.critFail : die >= dc ? DEGREE.success : DEGREE.fail;
    const step = die === 20 ? 1 : die === 1 ? -1 : 0;
    const degree = clamp(base + step, DEGREE.critFail, DEGREE.critSuccess);
    return dc >= 21 ? Math.min(degree, DEGREE.fail) : degree;
}

/**
 * What a rushed finish's flat check means for the item (TV-R p.158): `fine` on a success, `quirk` on a failure (a minor
 * quirk the GM chooses), and on a critical failure `ruined` or `cursed` by `variants.complexRushCritFail`.
 */
export function rushFinishOutcome(degree, rules = DEFAULT_RULES) {
    requireDegree(degree, "degree");
    if (degree >= DEGREE.success) return "fine";
    if (degree === DEGREE.fail) return "quirk";
    return variantsOf(rules).complexRushCritFail === "cursed" ? "cursed" : "ruined";
}

/** Whether the crafter may rush the finishing (TV-R p.158): Complex Crafting on, expert or better. */
export function canRushFinish(rank, rules = DEFAULT_RULES) {
    return variantsOf(rules).complexCrafting === true && rank >= RANK.expert;
}

/**
 * An extra-day record rushed (TV-R p.158): the crafter's reduction twice the Income Earned amount, the helpers' unchanged
 * (interpretation, OQ-42), marked `rushed`. A crafter below expert, or with Complex Crafting off, does not rush.
 */
export function rushDay(record, rank, rules = DEFAULT_RULES) {
    if (!record || record.kind !== "extra" || !canRushFinish(rank, rules)) return record;
    return { ...record, rushed: true, crafterCp: (record.crafterCp ?? 0) * RUSH_FINISH_MULTIPLIER };
}

/** Whether any extra day of the order's current attempt was rushed, so its finish rolls the flat check first. */
export function rushedInAttempt(order, days = []) {
    return days.some((d) => d.order === order.id && d.attempt === order.attempt && d.kind === "extra" && d.rushed === true);
}

/**
 * A sub-day setup's record (6.16.1, 4.8): keyed `<actorId>-<day>-<orderId>`, so it never collides with the crafter's day
 * record of an adventuring day or of the crafter's other activity that day. It completes the setup (`setupComplete`).
 */
export function setupHoursRecord({ actorId, day, order, hours, worldTime = null }, stamp) {
    requireInteger(day, "day");
    return {
        id: variantRecordId(actorId, day, order.id), v: 1, actor: actorId, day, toDay: day, activity: null, order: order.id,
        attempt: order.attempt, kind: "setup-hours", hours, world: worldTime, rows: [], result: "setup-hours", ...stamp,
    };
}

/**
 * Whether a sub-day setup may be recorded outside the crafter's downtime day on the order ("Set up now", 6.16.1): only Quick
 * Setup's 2-hour setup of a batch of consumables, which the feat lets the crafter do "during an adventuring day" (TV-R p.159).
 * Any other setup of hours (a consumable's 4 hours, Quick Setup's 4 hours for a permanent item) takes the crafter's downtime
 * day on the order, which the day planner writes as its `setup-hours` record (review fix of M9a).
 */
export function setupAnywhere(order) {
    return order?.variant?.complex?.quick === true && order.setup?.days === 0 && order.setup?.hours === COMPLEX_SUBDAY_HOURS.quickConsumable;
}

/** The hours of sub-day setups `actorId` has recorded on `day`, over every order (`setup-hours` records, 6.16.1). */
export function setupHoursOn(days, actorId, day) {
    return days.filter((d) => d?.kind === "setup-hours" && d.actor === actorId && d.day === day).reduce((sum, d) => sum + (Number(d.hours) || 0), 0);
}

/** The id of a variant record (4.8): for an order other than the one a PC's day record is about. */
export const variantRecordId = (actorId, day, orderId) => `${actorId}-${day}-${orderId}`;

/* -------------------------------------------- */
/*  Crafting downtime events (6.16.3)            */
/* -------------------------------------------- */

/**
 * How many events an attempt has due after `worked` downtime days on it (GM Core p.46: one for a week or a month, about
 * four for a year or more): the first on the `eventsFirstDay`-th day, one more every `eventsEveryDays` days after.
 */
export function eventsDue(worked, rules = DEFAULT_RULES) {
    const v = variantsOf(rules);
    if (!v.events || !Number.isInteger(worked) || worked < v.eventsFirstDay) return 0;
    return 1 + Math.floor((worked - v.eventsFirstDay) / Math.max(1, v.eventsEveryDays));
}

/** The idempotency key of an order's `k`th event in an attempt (6.16.3): a day resolved twice rolls nothing new. */
export const eventKey = (orderId, attempt, k) => idemKey("event", orderId, attempt, k);

/** The flag key of an event on its order (`orders.<id>.events.<slot>`): attempt and number, never a dot. */
export const eventSlot = (attempt, k) => `${attempt}-${k}`;

/** The order's events of an attempt (its current one by default), by number. */
export function eventsOf(order, attempt = order?.attempt) {
    return Object.values(order?.events ?? {}).filter((e) => e && e.attempt === attempt && Number.isInteger(e.k)).sort((a, b) => a.k - b.k);
}

/** The first open event of the order's current attempt, or null. */
export const openEvent = (order) => eventsOf(order).find((e) => e.status === "open") ?? null;

/** What a d20 on Table 5-2 points to (TV-R p.159): 1-3 an event from the GM Core, 4-20 the table's own row. */
export function eventResult(roll) {
    requireInteger(roll, "roll");
    return { roll, gmCore: roll <= EVENT_GM_CORE_MAX, row: roll };
}

/** The days an order's current attempt has had worked on it: its setup and extra days (each one downtime day). */
export function workedDays(order, days = []) {
    const seen = new Set();
    for (const d of days) {
        if (d.order !== order.id || d.attempt !== order.attempt || (d.kind !== "setup" && d.kind !== "extra")) continue;
        seen.add(`${d.actor}|${d.day}`);
    }
    return seen.size;
}

/**
 * Whether the order's days must stop for an event (6.16.3): with `eventsPauses` on, an open event pauses the order, and so
 * does an event that is due and not rolled yet (the crafter's client rolls it, then any member resolves it).
 */
export function eventPause(order, days = [], rules = DEFAULT_RULES) {
    const v = variantsOf(rules);
    if (!v.events || !v.eventsPauses) return null;
    if (openEvent(order)) return "event";
    return eventsDue(workedDays(order, days), rules) > eventsOf(order).length ? "event-due" : null;
}

/** The record of a rolled event (`orders.<id>.events.<slot>`). */
export function eventRecord({ order, k, day, roll, tableResult = null }, stamp) {
    requireInteger(k, "k");
    return { k, attempt: order.attempt, key: eventKey(order.id, order.attempt, k), day, roll, gmCore: roll <= EVENT_GM_CORE_MAX,
        tableResult, note: "", status: "open", ...stamp };
}

/* -------------------------------------------- */
/*  Critical Crafting (6.16.4)                   */
/* -------------------------------------------- */

/** The categories the Critical Crafting panel offers (author's words in `lang/en.json`; no book text). */
export const CRITICAL_CATEGORIES = Object.freeze({
    success: Object.freeze(["intelligent", "beyond-level", "minor-ability", "durable", "beautiful", "distracting", "relic", "other"]),
    failure: Object.freeze(["secret-curse", "life-drain", "lasting-harm", "malevolent", "fails-in-use", "crafter-cursed", "pollution", "other"]),
});

/**
 * Critical failure categories whose book example still makes the item (TV-R p.162: secretly cursed, draining the crafter,
 * completed by a malevolent mind, failing when used). Recording one makes the item by default (review fix of M9a); the
 * crafter or a GM may say otherwise, and may make the item under any other category too.
 */
export const MADE_DESPITE = Object.freeze(["secret-curse", "life-drain", "malevolent", "fails-in-use"]);

/** Whether a critical failure's category makes the item by default (`MADE_DESPITE`). */
export const madeByDefault = (category) => MADE_DESPITE.includes(category);

/** Whether a Critical Crafting record makes the item despite the critical failure (6.16.4, its `made` choice). */
export const madeDespite = (critical) => critical?.kind === "failure" && critical.made === true;

/**
 * Whether a settled check counts as a success for the order's materials and days (6.2.3, 6.16.4): a success, or a critical
 * failure whose Critical Crafting record makes the item anyway, whose extra days then run at the success rate.
 */
export const settledAsSuccess = (check) => !!check?.settled && (check.degree >= DEGREE.success || madeDespite(check.critical));

/**
 * The degree a viewer reads for a check (6.16.4): a secret check's critical failure that made the item reads as a success to
 * players, as the book's secretly cursed item looks fine, until a GM reveals it; anyone else reads the degree rolled.
 */
export function shownDegree(check, viewer) {
    if (madeDespite(check?.critical) && check.secret && !check.revealed && !viewer?.isGM) return DEGREE.success;
    return check?.degree ?? null;
}

/**
 * Whether a settled critical failure can still be made into the item (6.16.4, review fix of M9a): the order failed by this
 * attempt's settlement, which its log has not moved past (no retry, no cancel), and its record does not make it yet.
 */
export function canMakeDespite(order) {
    const check = order?.check;
    return order?.status === "failed" && !!check?.settled && check.critical?.kind === "failure" && !madeDespite(check.critical) &&
        order.settlement?.attempt === order.attempt && order.settlement.status === "failed";
}

/** Whether a viewer is kept from a check's Critical Crafting record (6.16.4): a secret critical failure that made the item. */
export const criticalHidden = (check, viewer) => shownDegree(check, viewer) !== (check?.degree ?? null);

/**
 * Whether a check triggers Critical Crafting (6.16.4): the variant on; with `criticalSpecialOnly`, only an order flagged
 * special; a critical success or failure, and under `criticalTrigger` "natural" (the book's suggested limit) only one that
 * came with a natural 20 or 1. Null when it does not; `{kind, natural}` when it does.
 */
export function criticalOf(check, order, rules = DEFAULT_RULES) {
    const v = variantsOf(rules);
    if (!v.criticalCrafting || !check) return null;
    if (v.criticalSpecialOnly && order?.variant?.special !== true) return null;
    const kind = check.degree === DEGREE.critSuccess ? "success" : check.degree === DEGREE.critFail ? "failure" : null;
    if (!kind) return null;
    const natural = kind === "success" ? check.die === 20 : check.die === 1;
    if (v.criticalTrigger !== "any" && !natural) return null;
    return { kind, natural };
}

/**
 * The Critical Crafting record a settlement stamps on the check when it triggers (6.16.4): its kind, whether it was
 * natural, and the mode copied from the setting now, so a later settings change changes nothing; the category and note
 * come from the panel. An existing record is kept.
 */
export function criticalRecord(check, order, rules = DEFAULT_RULES, stamp = {}) {
    if (check?.critical) return check.critical;
    const triggered = criticalOf(check, order, rules);
    if (!triggered) return null;
    return { ...triggered, category: null, note: "", mode: variantsOf(rules).criticalMode === "replace" ? "replace" : "alongside", ...stamp };
}

/**
 * The degree the money follows (6.16.4): under `replace` the special effect takes the critical's place, so a critical
 * success pays the success rate and a critical failure ruins nothing; otherwise the check's own degree.
 */
export function moneyDegree(check) {
    const degree = check?.degree;
    if (check?.critical?.mode !== "replace") return degree;
    if (degree === DEGREE.critSuccess) return DEGREE.success;
    if (degree === DEGREE.critFail) return DEGREE.fail;
    return degree;
}

/**
 * Whether a Craft check is rolled blind (6.16.4): Critical Crafting and its secret rolls on, an order it would apply to
 * (a special one under `criticalSpecialOnly`), and a GM connected to see it (P2: with no GM it has no effect).
 */
export function secretRoll(order, rules = DEFAULT_RULES, gmConnected = false) {
    const v = variantsOf(rules);
    if (!v.criticalCrafting || !v.criticalSecret || !gmConnected) return false;
    return !v.criticalSpecialOnly || order?.variant?.special === true;
}

/** Whether a viewer sees "rolled (secret)" instead of the degree (6.16.4): a secret check not settled or revealed, to a player. */
export function checkHidden(check, viewer) {
    return !!check?.secret && !check.settled && !check.revealed && !viewer?.isGM;
}

/**
 * The crafter's curse as an effect item's data (6.16.4): a status penalty to Crafting checks of `size` (1 by default),
 * until a critical success at a Craft check (the roll wrapper removes it) or a 4th-rank cleanse affliction (anyone who owns
 * the crafter removes it). `name` comes from the interface.
 */
export function curseEffectData({ name, size = CURSE_PENALTY_DEFAULT, order, img }) {
    const penalty = Math.max(1, Math.trunc(Number(size) || CURSE_PENALTY_DEFAULT));
    return {
        type: "effect", name, img,
        system: {
            rules: [{ key: "FlatModifier", selector: "crafting", type: "status", value: -penalty, slug: "artisans-workshop-crafter-curse" }],
            duration: { value: -1, unit: "unlimited", expiry: null, sustained: false }, tokenIcon: { show: true },
        },
        flags: { "pf2e-artisans-workshop": { curse: { order, size: penalty } } },
    };
}

/* -------------------------------------------- */
/*  Deconstruct (6.16.5)                         */
/* -------------------------------------------- */

/** Traits that make an item too hard to destroy to deconstruct (D3): cursed items and artifacts. */
const HARD_TO_DESTROY = Object.freeze(["artifact", "cursed"]);

/**
 * The credit a Deconstruct gives (TV-R p.162): its purpose's share of the item's Price at the check's degree, applied to
 * the value left after any loss (`lossPct`: 5 for each retry of a damaged item without repair, interpretation OQ-45).
 * Nothing below a success.
 */
export function deconstructCredit({ priceCp, degree, purpose, lossPct = 0 }) {
    requireCp(priceCp, "priceCp");
    requireDegree(degree, "degree");
    if (degree < DEGREE.success) return 0;
    const pct = DECONSTRUCT_PCT[purpose === "similar" ? "similar" : "raw"][degree];
    const kept = clamp(100 - (Number(lossPct) || 0), 0, 100);
    return Math.floor((priceCp * kept * pct) / 10000);
}

/** What a retry of a damaged item without repair adds to `lossPct` (TV-R p.162). */
export const DECONSTRUCT_RETRY_LOSS = DECONSTRUCT_LOSS_PCT;

/**
 * Deconstruct's gates (6.16.5, TV-R p.162), as the Craft gates name them: G1 trained, G2 the item's level at most the
 * crafter's (D1), G3 master from 9, legendary from `legendaryItemLevel` (D2), G4 Alchemical Crafting for an alchemical item
 * and Magical Crafting for a magic one (D7), G7 the tools (D6), G9 the workshop confirmed (D6), G10 the item with the
 * crafter or earmarked (custody), G11 available, G12 not cursed, an artifact or a consumable, and with a Price (D3-D5). No
 * formula or access is needed.
 *
 * @param {object} p
 * @param {{level: number, ranks: object, feats: string[], lockedBy?: string|null}} p.crafter
 * @param {{level: number, traits: string[], priceCp: number, consumableFix?: boolean}} p.item
 */
export function deconstructGates({ crafter, item, tools = {}, held = false, workshop = false, orderId = null }, rules = DEFAULT_RULES) {
    const feats = [];
    const traits = item.traits ?? [];
    if (hasTrait(item, "alchemical")) feats.push(FEAT.alchemicalCrafting);
    if (isMagical(item)) feats.push(FEAT.magicalCrafting);
    // Only these two feats (D7): the Craft's own feat rules (snares, tattoos, talismans) are not Deconstruct's, so the gate
    // is asked about nothing else.
    const featGate = gateFeats(crafter, { traits: ["gadget"] }, "item", rules, feats);
    let product = pass("G12");
    if (HARD_TO_DESTROY.some((t) => traits.includes(t))) product = fail("G12", "hard-to-destroy");
    else if (hasTrait(item, "consumable") || item.consumableFix === true) product = fail("G12", "consumable");
    else if (!(item.priceCp > 0)) product = fail("G12", "no-price");
    return [
        gateTrained(crafter),
        gateLevel(crafter, item),
        gateProficiency(crafter, item, "crafting", rules),
        featGate,
        gateTools(item, tools, rules),
        workshop ? pass("G9") : fail("G9", "workshop", {}, "checklist"),
        held ? pass("G10") : fail("G10", "target-not-held", {}, "custody"),
        gateAvailable(crafter, orderId),
        product,
    ];
}

/**
 * The components record a successful Deconstruct writes on the item (6.16.5): the credit at its purpose (`valueCp`) and at
 * the raw percentages (`rawCp`, used when a later order is not confirmed similar), what it was, which order made it, and
 * when it expires (`deconstructExpiryDays`, 0: never).
 */
export function componentsRecord({ priceCp, degree, purpose, similarTo = null, lossPct = 0, order, from, day }, stamp, rules = DEFAULT_RULES) {
    const valueCp = deconstructCredit({ priceCp, degree, purpose, lossPct });
    const rawCp = deconstructCredit({ priceCp, degree, purpose: "raw", lossPct });
    const days = variantsOf(rules).deconstructExpiryDays;
    return { valueCp, rawCp, purpose: purpose === "similar" ? "similar" : "raw", similarTo, from, order, day, lossPct,
        expiresDay: Number.isInteger(days) && days > 0 && Number.isInteger(day) ? day + days : null, ...stamp };
}

/** Whether components have expired on `day` (`deconstructExpiryDays`). */
export const componentsExpired = (components, day) => Number.isInteger(components?.expiresDay) && Number.isInteger(day) && day > components.expiresDay;

/**
 * What a Craft's components line may still take off (6.16.5): the share ruined by a critical failure (10% of the line,
 * rounded up) off the credit the line counts for.
 */
export const componentsRuinCp = (creditCp) => Math.ceil((requireCp(creditCp, "creditCp") * COMPONENTS_RUIN_PCT) / 100);

/**
 * The part of a components credit that pays the remainder at the finish (6.16.5): the credit covers the up-front half
 * first, then the remainder, and anything above the Price is lost. Zero for an order with no components line.
 */
export function componentsExcessCp(order) {
    const credit = componentsCp(order);
    if (!(credit > 0) || !Number.isInteger(order?.priceCp) || !Number.isInteger(order?.upfrontCp)) return 0;
    const covered = Math.min(materialsCp(order, { includeUsed: true }), order.priceCp);
    return Math.min(credit, Math.max(0, covered - order.upfrontCp));
}

/**
 * The follow-on's setup credit a successful Deconstruct for a similar item writes (6.16.5, TV-R p.162): a `setup` variant
 * record for the follow-on's current attempt, or the attempt its start will create when it has not started yet, keyed
 * `<actorId>-<day>-<followOnId>` for the deconstruct day.
 */
export function followOnCredit({ actorId, day, followOn, from }, stamp) {
    requireInteger(day, "day");
    const started = ["setup", "check", "rolled", "finishing", "paused", "failed"].includes(followOn.status);
    return {
        id: variantRecordId(actorId, day, followOn.id), v: 1, actor: actorId, day, toDay: day, activity: null, order: followOn.id,
        attempt: started ? followOn.attempt : (followOn.attempt ?? 0) + 1, kind: "setup", rows: [], result: "deconstruct", from, ...stamp,
    };
}

/* -------------------------------------------- */
/*  Grow (6.16.6)                                */
/* -------------------------------------------- */

/** The skill Grow uses (TV-R p.165, `natureSkills`): Crafting, or Nature under `nature` and `nature-arcana`. */
export function growSkill(rules = DEFAULT_RULES) {
    return variantsOf(rules).natureSkills === "crafting" ? "crafting" : "nature";
}

/**
 * The skill every other Craft uses (TV-R p.165): Arcana in place of Crafting in the book's hybrid (`nature-arcana`, while
 * Grow is on), Crafting otherwise.
 */
export function craftSkill(rules = DEFAULT_RULES) {
    const v = variantsOf(rules);
    return v.grow && v.natureSkills === "nature-arcana" ? "arcana" : "crafting";
}

/** A season by day count (6.16.6): the index of the `seasonDays`-long season `day` falls in, counted from `startDay`. */
export function seasonIndexOf(day, { startDay, seasonDays }) {
    requireInteger(day, "day");
    return Math.floor((day - startDay) / Math.max(1, seasonDays));
}

/**
 * The reduction a season check gives (6.16.6, interpretation of "the corresponding amount", OQ-43): one day of Income
 * Earned at the crafter's level and rank, level + 1 on a critical success; nothing below a success.
 */
export function seasonCp(degree, level, rank) {
    requireDegree(degree, "degree");
    return degree >= DEGREE.success ? incomePerDay(level, rank, degree) : 0;
}

/**
 * The season checks an untended Grow order has due (6.16.6): every season that has ended (`seasonOf(today)` past it),
 * that ended on or after the day the order was left untended, in which the crafter spent at least one downtime day on it
 * (its setup or extra days in the current attempt), and that has no season record yet. Each `{season, endDay}`.
 *
 * @param {object} p
 * @param {object} p.order          a Grow order in `finishing`, `variant.grow = {mode: "untended", since}`
 * @param {object[]} p.days         the order's day and variant records
 * @param {number} p.today          the workshop day
 * @param {(day: number) => number} p.seasonOf  the season index of a day (calendar seasons, or by day count)
 */
export function seasonsDue({ order, days = [], today, seasonOf }) {
    const grow = order?.variant?.grow;
    if (order?.craftType !== "grow" || order.status !== "finishing" || grow?.mode !== "untended") return [];
    if (!settledAsSuccess(order.check)) return [];
    const current = seasonOf(today);
    const recorded = new Set(days.filter((d) => d.order === order.id && d.attempt === order.attempt && d.kind === "season").map((d) => d.season));
    const worked = days.filter((d) => d.order === order.id && d.attempt === order.attempt && (d.kind === "setup" || d.kind === "extra"));
    const bySeason = new Map();
    for (const d of worked) {
        const s = seasonOf(d.day);
        if (s >= current || recorded.has(s)) continue;
        bySeason.set(s, Math.max(bySeason.get(s) ?? -Infinity, d.day));
    }
    const out = [];
    for (const [season, lastWorked] of [...bySeason].sort((a, b) => a[0] - b[0])) {
        let endDay = lastWorked;
        while (endDay < today && seasonOf(endDay + 1) === season) endDay += 1;
        if (Number.isInteger(grow.since) && endDay < grow.since) continue;
        out.push({ season, endDay });
    }
    return out;
}

/** A season check's record (6.16.6, 4.8): a `season` variant record keyed `<actorId>-<endDay>-<orderId>`. */
export function seasonRecord({ actorId, order, season, endDay, degree, level, rank, messageId = null }, stamp) {
    return {
        id: variantRecordId(actorId, endDay, order.id), v: 1, actor: actorId, day: endDay, toDay: endDay, activity: null, order: order.id,
        attempt: order.attempt, kind: "season", season, degree, crafterCp: seasonCp(degree, level, rank), messageId, rows: [], result: "season",
        ...stamp,
    };
}

/** The idempotency key of a season check (6.16.6). */
export const seasonKey = (orderId, season) => idemKey("season", orderId, season);

/* -------------------------------------------- */
/*  Gardens of Wonder (6.16.7)                   */
/* -------------------------------------------- */

/**
 * A garden's seed cost (TV-R p.167): the top of the permanent magic item price range for a level 2 above its consumable's
 * (GM Core p.133). Levels past 20 use 20's (interpretation, OQ-43).
 */
export function gardenSeedCostCp(productLevel) {
    requireInteger(productLevel, "productLevel");
    return PERMANENT_PRICE_MAX[clamp(productLevel + GARDEN_LEVELS_ABOVE, 1, PERMANENT_PRICE_MAX.length) - 1];
}

/** How many gardens a party may keep (TV-R p.167): half its PCs, rounded down. */
export const gardenLimit = (pcCount) => Math.floor(Math.max(0, pcCount) / GARDEN_PCS_PER_GARDEN);

/** A new garden record (`gardens.<id>`, 6.16.7). */
export function makeGarden({ id, party = null, name, kind = "", product }, stamp) {
    requireInteger(product?.level, "product.level");
    return { id, v: 1, party, name: String(name ?? ""), kind: String(kind ?? ""), product: { uuid: product.uuid, level: product.level, name: product.name ?? "",
        img: product.img ?? null }, perDay: 1, seedCostCp: gardenSeedCostCp(product.level), plantedDay: null, harvests: {}, ...stamp };
}

/** Whether another garden may be added: the party is below its limit. */
export function gardenRoom(gardens, pcCount, party = null) {
    const kept = gardens.filter((g) => g && (party === null || g.party === party || g.party === null)).length;
    return kept < gardenLimit(pcCount) ? { ok: true } : { ok: false, reason: "garden-limit", data: { max: gardenLimit(pcCount) } };
}

/**
 * A garden's slot (review fix of M9a): the lock page taken by every write that takes money off a garden (a member's take-back,
 * the party fund's share given back) and by its planting, which spends what it holds. Its slot is the number of the garden's
 * rows that took money off it so far, so two such writes planned from the same copy name the same page and only the first
 * lands: a take-back and a planting cannot both spend the same coins.
 */
export function gardenSlotLockId(gardenId, rows) {
    const takenOff = rows.filter((row) => row.garden === gardenId && (row.alloc ?? 0) < 0).length;
    return hashId(idemKey("garden-slot", gardenId, takenOff));
}

/** The lock keys of a garden's planting and of a day's harvest (6.16.7). */
export const plantKey = (gardenId) => idemKey("plant", gardenId);
export const harvestKey = (gardenId, day) => idemKey("harvest", gardenId, day);

/**
 * The expiry stamp of a garden's produce (4.12, 6.16.7): a `world` stamp ending with the harvest day, at world time and by
 * logged days; no preservation applies (no `exempt`).
 */
export function produceStamp({ creator, day, secondsPerDay, offset = 0, garden }) {
    requireInteger(day, "day");
    return { creator, cycle: null, rule: "world", garden, at: (day + 1) * secondsPerDay - offset, atDay: day + 1 };
}

/* -------------------------------------------- */
/*  Bestowed gifts (6.16.8)                      */
/* -------------------------------------------- */

/** A gift binding (`flags.MOD.gift`, 6.16.8). */
export function giftRecord({ bound, heirs = [], giver = "" }, stamp) {
    return { bound, heirs: [...new Set(heirs.filter(Boolean))], giver: String(giver ?? ""), ...stamp };
}

/** Whether a gift is dormant in `holder`'s hands (TV-R p.166): held by anyone but its bound recipient or an heir. */
export function giftDormant(gift, holderUuid) {
    if (!gift?.bound) return false;
    return holderUuid !== gift.bound && !(gift.heirs ?? []).includes(holderUuid);
}

/* -------------------------------------------- */
/*  Crafting quests (6.16.9)                     */
/* -------------------------------------------- */

/**
 * A quest's cost (TV-R p.172): the item's equivalent cost against party treasure drops by 10% of its Price per required
 * encounter, never below half; that is spread evenly across the encounters, each one's treasure reduced by its share.
 */
export function questCost(priceCp, encounters) {
    requireCp(priceCp, "priceCp");
    requireInteger(encounters, "encounters");
    const n = Math.max(0, encounters);
    const floor = Math.ceil((priceCp * QUEST_FLOOR_PCT) / 100);
    const equivalentCp = Math.max(floor, Math.round((priceCp * Math.max(0, 100 - QUEST_REDUCTION_PCT * n)) / 100));
    return { equivalentCp, perEncounterCp: Math.round(equivalentCp / Math.max(1, n)), reductionCp: priceCp - equivalentCp };
}

/** The treasure of one encounter at a party level and threat (TV-R p.171 Table 5-3), in cp. */
export function encounterBudgetCp(level, threat) {
    requireInteger(level, "level");
    const column = THREAT_COLUMN[threat];
    if (column === undefined) throw new RangeError(`unknown threat ${threat}`);
    return TREASURE_BY_ENCOUNTER[clamp(level, 1, TREASURE_BY_ENCOUNTER.length) - 1][column];
}

/** Whether a quest needs an assembly check (TV-R p.172): not for one of at least three encounters in different locations. */
export const assemblyNeeded = ({ encounters, differentLocations = true }) => !(encounters >= QUEST_FREE_ASSEMBLY && differentLocations);

/**
 * A new quest (`variant.quest`, 6.16.9): `encounters` components, each low, moderate or severe (TV-R p.172; the form
 * offers only those), none found; the assembly check by `assemblyNeeded` unless set.
 */
export function makeQuest({ encounters, threats = [], labels = [], differentLocations = true, assemblyCheck = null, assemblySkill = "crafting" }) {
    requireInteger(encounters, "encounters");
    if (encounters < 1) throw new RangeError("a quest has at least one encounter");
    const components = {};
    for (let i = 1; i <= encounters; i++) {
        const threat = QUEST_THREATS.includes(threats[i - 1]) ? threats[i - 1] : "moderate";
        components[`c${i}`] = { id: `c${i}`, n: i, label: String(labels[i - 1] ?? ""), threat, found: null };
    }
    return { encounters, components, differentLocations: differentLocations !== false,
        assemblyCheck: assemblyCheck ?? assemblyNeeded({ encounters, differentLocations }), assemblySkill };
}

/** The states of a quest that has started and is not over (6.16.9): it gathers its components, then is assembled. */
export const QUEST_GOING = Object.freeze(["gathering", "check", "rolled"]);

/**
 * Whether an order is a quest under way (`QUEST_GOING`): one that started while crafting quests were on keeps going once they
 * are off, since nothing else could finish it (review fix of M9a).
 */
export const questUnderway = (order) => order?.craftType === "quest" && QUEST_GOING.includes(order?.status);

/** A quest's components, by number. */
export const questComponents = (quest) => Object.values(quest?.components ?? {}).filter(Boolean).sort((a, b) => (a.n ?? 0) - (b.n ?? 0));

/** Whether every component of a quest has been found. */
export function allFound(quest) {
    const list = questComponents(quest);
    return list.length > 0 && list.every((c) => !!c.found);
}

/**
 * The quest's encounters against Table 5-3 (6.16.9): each component's share of the equivalent cost and its encounter's
 * treasure at the party level, and whether the reduction exceeds it (`over`).
 */
export function questBudget(quest, { priceCp, level }) {
    const list = questComponents(quest);
    const { perEncounterCp } = questCost(priceCp, list.length);
    return list.map((c) => {
        const budgetCp = encounterBudgetCp(level, c.threat);
        return { id: c.id, threat: c.threat, shareCp: perEncounterCp, budgetCp, over: perEncounterCp > budgetCp };
    });
}

/**
 * What an assembly check's degree does (TV-R p.172): `deliver` on a success, `quirk` on a failure (delivered with a quirk
 * note), and on a critical failure `destroyed` (the order fails) or `cursed` (delivered with a curse note) by
 * `questsCritFail`.
 */
export function assemblyOutcome(degree, rules = DEFAULT_RULES) {
    requireDegree(degree, "degree");
    if (degree >= DEGREE.success) return "deliver";
    if (degree === DEGREE.fail) return "quirk";
    return variantsOf(rules).questsCritFail === "cursed" ? "cursed" : "destroyed";
}

/* -------------------------------------------- */
/*  Crafting items with adjustments (6.16.2)     */
/* -------------------------------------------- */

/** The item type an adjustment's usage names (pf2e `usage`: "applied-to-armor", "affixed-to-a-ranged-weapon", ...). */
function adjustmentTarget(usage) {
    const words = (usage ?? "").split("-");
    if (words.includes("shield") || words.includes("buckler")) return "shield";
    if (words.includes("weapon")) return "weapon";
    if (words.includes("armor") || words.includes("clothing")) return "armor";
    return null;
}

/**
 * Whether an adjustment fits a base item (6.16.2): the `adjustment` trait, and its usage names the base's type (armor,
 * a shield, a weapon), a melee or ranged weapon by its range, medium or heavy armor by its category. A usage the module
 * cannot read fits anything.
 */
export function adjustmentFits(adjustment, base) {
    if (!hasTrait(adjustment, "adjustment")) return false;
    const target = adjustmentTarget(adjustment.usage);
    if (!target) return true;
    if (base.type !== target) return false;
    const words = new Set((adjustment.usage ?? "").split("-"));
    if (target === "weapon") {
        if (words.has("melee") && base.range) return false;
        if (words.has("ranged") && !base.range) return false;
    }
    if (target === "armor" && (words.has("medium") || words.has("heavy")) && !words.has("light")) {
        const category = base.category ?? "";
        if (!["medium", "heavy"].some((c) => category === c)) return false;
    }
    return true;
}

/**
 * One Craft for an item and its adjustments (6.16.2, TV-R p.159): the Price is the sum of the parts' Prices; the level for
 * G2, G3 and the DC is the highest part's (interpretation, OQ-45), and so is the rarity the DC adds.
 * @param {{priceCp: number, level: number, rarity?: string}[]} parts  the base first, then each adjustment (unit Prices)
 */
export function adjustmentsPlan(parts) {
    if (!parts.length) throw new RangeError("an item with adjustments has a base");
    const priceCp = parts.reduce((sum, p) => sum + requireCp(p.priceCp, "priceCp"), 0);
    const level = Math.max(...parts.map((p) => requireInteger(p.level, "level")));
    const rarity = RARITIES[Math.max(...parts.map((p) => rarityRank(p.rarity ?? "common")))];
    return { priceCp, level, rarity };
}
