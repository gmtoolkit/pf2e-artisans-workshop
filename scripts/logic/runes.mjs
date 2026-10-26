/**
 * Runes on items (DESIGN.md 6.13, GM Core pp.223-225, M5): which part of an item's `system.runes` a rune item fills,
 * the runes an item has after an etching or a transfer, and what an etching and a transfer cost. Pure: the Foundry side
 * reads the Prices of the rune items from pf2e's compendium (the module never re-implements pf2e's rune price table,
 * 6.13). An etching is priced from the runes, not from the item's prepared Price: pf2e drops a mundane item's own Price
 * once it has runes and ignores the runes of a specific item, so the item's Price before and after says nothing of the
 * rune's.
 *
 * pf2e keeps runes as `system.runes`: a weapon `{potency, striking, property: []}`, armor `{potency, resilient,
 * property: []}`, a shield `{reinforcing}`. Rune items in the equipment compendium are named by slug: `weapon-potency-2`,
 * `striking-greater`, `armor-potency-1`, `resilient-major`, `reinforcing-rune-moderate`, and property runes such as
 * `flaming-greater`, whose key in `system.runes.property` is camelCase with the grade first (`greaterFlaming`).
 */
import { RUNE_TRANSFER_PCT } from "../data/services.mjs";
import { requireCp } from "./core.mjs";

/** Grades of striking and resilient runes, in order. */
const SECONDARY = Object.freeze({ "": 1, greater: 2, major: 3 });
/** Grades of reinforcing runes, in order. GM Core p.233. */
const REINFORCING = Object.freeze(["minor", "lesser", "moderate", "greater", "major", "supreme"]);
/** Grade words that move to the front of a property rune's key. */
const GRADE_WORDS = Object.freeze(["greater", "major", "true", "lesser", "minor", "moderate", "supreme"]);

/** The kind of item a rune is etched onto, from its usage (`etched-onto-a-weapon`, `etched-onto-armor`, ...). */
export function runeTargetType(usage = "") {
    if (!usage.startsWith("etched-onto")) return null;
    if (usage.includes("shield")) return "shield";
    if (usage.includes("armor")) return "armor";
    if (usage.includes("weapon") || usage.includes("dagger")) return "weapon";
    return null;
}

/** Grades of a property rune, weakest first, by the word its key starts with; a key without one is the base grade. */
const PROPERTY_GRADE = Object.freeze({ lesser: 0, minor: 0, "": 1, moderate: 1, greater: 2, major: 3, true: 4, supreme: 5 });

/**
 * A property rune key's grade and the rune it is a grade of: `greaterFlaming` is `{grade: "greater", base: "flaming",
 * rank: 2}`, `flaming` the base grade. pf2e keeps only the strongest grade of a rune on an item (`prunePropertyRunes`).
 */
export function propertyGrade(key) {
    const graded = /^(lesser|minor|moderate|greater|major|true|supreme)([A-Z].*)$/.exec(key);
    if (!graded) return { grade: "", base: key, rank: PROPERTY_GRADE[""] };
    return { grade: graded[1], base: graded[2].charAt(0).toLowerCase() + graded[2].slice(1), rank: PROPERTY_GRADE[graded[1]] };
}

/** Weapon property runes that cannot share an item: the `-wo-<rune>-rune` usages name the rune itself (pf2e's labels). */
const OPPOSED = Object.freeze({ holy: "unholy", unholy: "holy", anarchic: "axiomatic", axiomatic: "anarchic" });
/** Armor groups made of metal (GM Core p.274): chain, composite and plate. pf2e has no metal flag on armor. */
const METAL_ARMOR_GROUPS = Object.freeze(["chain", "composite", "plate"]);
/** Damage types a weapon can deal, from its damage type and versatile traits (`versatile-s`). */
const VERSATILE = Object.freeze({ b: "bludgeoning", p: "piercing", s: "slashing" });

/**
 * Whether a rune's usage fits an item beyond its type (GM Core p.224: a rune is etched only onto an item it can go on;
 * p.225: a transfer to an item that cannot take the rune is an automatic critical failure, which the module refuses
 * instead): melee (no range) or thrown weapons, the damage types it names (a versatile trait counts), monk weapons, the
 * clan dagger, a weapon without the opposed holy or unholy (anarchic or axiomatic) rune; light, medium or heavy armor,
 * metal (chain, composite, plate, or the `metal` trait) or not. A usage that is no rune's fits anything.
 *
 * @param {string|null} usage   the rune item's `system.usage.value`
 * @param {{type: string, range?: number|null, damageType?: string|null, traits?: string[], category?: string|null,
 *   group?: string|null, baseItem?: string|null, runes?: object|null}} item   `liveItemFacts`
 */
export function usageFits(usage, item) {
    const type = runeTargetType(usage ?? "");
    if (!type) return true;
    if (item.type !== type) return false;
    const words = new Set(usage.slice("etched-onto-".length).split("-"));
    const traits = item.traits ?? [];
    if (type === "weapon") {
        if (words.has("melee") && item.range) return false;
        if (words.has("thrown") && !traits.some((t) => t === "thrown" || t.startsWith("thrown-"))) return false;
        const named = Object.values(VERSATILE).filter((damage) => words.has(damage));
        const deals = [item.damageType, ...traits.filter((t) => t.startsWith("versatile-")).map((t) => VERSATILE[t.slice(10)] ?? t.slice(10))];
        if (named.length && !named.some((damage) => deals.includes(damage))) return false;
        if (words.has("monk") && !traits.includes("monk")) return false;
        if (words.has("clan") && item.baseItem !== "clan-dagger") return false;
        const without = /-wo-(\w+)-rune$/.exec(usage)?.[1];
        if (OPPOSED[without] && normalRunes(item.runes).property.some((key) => propertyGrade(key).base === OPPOSED[without])) return false;
    }
    if (type === "armor") {
        const category = item.category ?? "";
        const allowed = words.has("lm") ? ["light", "medium"] : ["light", "medium", "heavy"].filter((c) => words.has(c) || (c === "medium" && words.has("med")));
        if (allowed.length && !allowed.some((c) => category === c || category.startsWith(`${c}-`))) return false;
        const metal = METAL_ARMOR_GROUPS.includes(item.group) || traits.includes("metal");
        if ((words.has("nonmetal") && metal) || (words.has("metal") && !metal)) return false;
    }
    return true;
}

/** A property rune's key in `system.runes.property` from its slug: `flaming-greater` is `greaterFlaming`. */
export function propertyKey(slug) {
    const words = slug.split("-");
    const grades = words.filter((w) => GRADE_WORDS.includes(w));
    const rest = words.filter((w) => !GRADE_WORDS.includes(w));
    return [...grades, ...rest].map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
}

/**
 * What a rune item puts on an item, or null when it is not a rune: `{target: "weapon"|"armor"|"shield", kind:
 * "fundamental"|"reinforcing"|"property", slot: "potency"|"striking"|"resilient"|"reinforcing"|"property", value}`.
 * `value` is the grade number of a fundamental or reinforcing rune, a property rune's key.
 *
 * @param {{slug: string, usage?: string}} rune
 */
export function runeOf({ slug, usage = "" }) {
    if (typeof slug !== "string" || !slug) return null;
    const potency = /^(weapon|armor)-potency-(\d)$/.exec(slug);
    if (potency) return { target: potency[1], kind: "fundamental", slot: "potency", value: Number(potency[2]) };
    const secondary = /^(striking|resilient)(?:-(greater|major))?$/.exec(slug);
    if (secondary) {
        return { target: secondary[1] === "striking" ? "weapon" : "armor", kind: "fundamental", slot: secondary[1], value: SECONDARY[secondary[2] ?? ""] };
    }
    const reinforcing = /^reinforcing-rune-(\w+)$/.exec(slug);
    if (reinforcing && REINFORCING.includes(reinforcing[1])) {
        return { target: "shield", kind: "reinforcing", slot: "reinforcing", value: REINFORCING.indexOf(reinforcing[1]) + 1 };
    }
    const target = runeTargetType(usage);
    if (!target || target === "shield") return null;
    return { target, kind: "property", slot: "property", value: propertyKey(slug) };
}

/** The slug of the compendium item of a rune (`runeOf`'s shape): `weapon-potency-2`, `striking-greater`, `flaming-greater`. */
export function runeSlug({ target, slot, value }) {
    if (slot === "potency") return `${target}-potency-${value}`;
    if (slot === "striking" || slot === "resilient") return [slot, Object.keys(SECONDARY).find((grade) => SECONDARY[grade] === value)].filter(Boolean).join("-");
    if (slot === "reinforcing") return `reinforcing-rune-${REINFORCING[value - 1]}`;
    const { grade, base } = propertyGrade(value);
    return [base.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), grade].filter(Boolean).join("-");
}

/** An item's runes as plain data, with the defaults pf2e fills in (none for an item without `system.runes`). */
export function normalRunes(runes) {
    runes ??= {};
    return {
        potency: runes.potency ?? 0, striking: runes.striking ?? 0, resilient: runes.resilient ?? 0,
        reinforcing: runes.reinforcing ?? 0, property: [...(runes.property ?? [])],
    };
}

/**
 * The runes an item has once `rune` is etched onto it (GM Core p.224), or a refusal: `wrong-item` (a weapon rune on
 * armor), `not-stronger` (a rune no better than the one there: etching a stronger fundamental rune, or a stronger grade of
 * a property rune, `flaming` to `greaterFlaming`, replaces it in its slot), `has-rune` (that property rune is there
 * already). Slots, shields and specific items are G12's (`runeProblem`). `replaces` is the rune the etching upgrades
 * (`runeOf`'s shape), or null, for its Price (`etchPriceCp`) and the slot count (`etchCheck`).
 *
 * @param {{type: string, runes: object}} item   `type`: "weapon", "armor" or "shield"
 * @param {object} rune   `runeOf`
 */
export function runesAfterEtch(item, rune) {
    if (!rune || rune.target !== item.type) return { ok: false, reason: "wrong-item" };
    const runes = normalRunes(item.runes);
    if (rune.kind === "property") {
        if (runes.property.includes(rune.value)) return { ok: false, reason: "has-rune" };
        const other = otherGrade(runes.property, rune.value);
        if (other === null) return { ok: true, runes: { ...runes, property: [...runes.property, rune.value] }, replaces: null };
        if (propertyGrade(other).rank >= propertyGrade(rune.value).rank) return { ok: false, reason: "not-stronger" };
        return { ok: true, runes: { ...runes, property: runes.property.map((p) => (p === other ? rune.value : p)) }, replaces: { ...rune, value: other } };
    }
    if (runes[rune.slot] >= rune.value) return { ok: false, reason: "not-stronger" };
    return { ok: true, runes: { ...runes, [rune.slot]: rune.value }, replaces: runes[rune.slot] > 0 ? { ...rune, value: runes[rune.slot] } : null };
}

/** Another grade of the property rune `key` among `keys` (`flaming` for `greaterFlaming`), or null. */
function otherGrade(keys, key) {
    const { base } = propertyGrade(key);
    return keys.find((other) => other !== key && propertyGrade(other).base === base) ?? null;
}

/**
 * What etching a rune costs (GM Core p.224): the rune's Price; upgrading a rune to a stronger one, the difference
 * between the two runes' Prices. Null when that is not more than nothing (no Price to Craft).
 */
export function etchPriceCp({ runeCp, replacedCp = 0 }) {
    const diff = requireCp(runeCp, "runeCp") - requireCp(replacedCp, "replacedCp");
    return diff > 0 ? diff : null;
}

/**
 * What G12's rune rules (`runeProblem`, gates.mjs) read about an etching (GM Core pp.224-225): the rune's kind and the
 * target item: already being etched by another open order, a shield, a specific item, a staff, its potency and property
 * runes, and orichalcum (+1 slot). A property rune that `replaces` a weaker grade of itself takes that one's slot.
 */
export function etchCheck(item, rune, { etching = false, replaces = null } = {}) {
    const runes = normalRunes(item.runes);
    if (replaces?.kind === "property") runes.property = runes.property.filter((p) => p !== replaces.value);
    return {
        kind: rune.kind,
        target: {
            etching, isShield: item.type === "shield", isSpecific: !!item.isSpecific, isStaff: (item.traits ?? []).includes("staff"),
            potency: runes.potency, propertyRunes: runes.property.length, orichalcum: item.material?.type === "orichalcum",
        },
    };
}

/**
 * A rune transfer (GM Core p.225): the runes of the item it leaves and the item it goes to, or a refusal. Fundamental
 * for fundamental and property for property: a fundamental rune replaces the target's in that slot only in a swap
 * (`swap`: the target's goes back the other way); a property rune moves into the target's list (`has-rune` if it is
 * there), replacing a weaker grade of itself there (`replaces`; `not-stronger` against an equal or stronger grade) and, in
 * a swap, the target's property rune `swapWith` comes back. `not-there` when the source lacks the rune.
 *
 * @param {object} p
 * @param {{type: string, runes: object}} p.from
 * @param {{type: string, runes: object}} p.to
 * @param {object} p.rune        `runeOf`, of the rune on `from`
 * @param {boolean} [p.swap]
 * @param {string|null} [p.swapWith]   the target's property rune key in a property swap
 */
export function transferRunes({ from, to, rune, swap = false, swapWith = null }) {
    if (!rune || rune.target !== to.type) return { ok: false, reason: "wrong-item" };
    const a = normalRunes(from.runes);
    const b = normalRunes(to.runes);
    if (rune.kind === "property") {
        if (!a.property.includes(rune.value)) return { ok: false, reason: "not-there" };
        if (b.property.includes(rune.value)) return { ok: false, reason: "has-rune" };
        const other = otherGrade(b.property, rune.value);
        if (other !== null && propertyGrade(other).rank >= propertyGrade(rune.value).rank) return { ok: false, reason: "not-stronger" };
        const fromProps = a.property.filter((p) => p !== rune.value);
        let toProps = other === null ? [...b.property, rune.value] : b.property.map((p) => (p === other ? rune.value : p));
        if (swap) {
            if (!swapWith || !b.property.includes(swapWith)) return { ok: false, reason: "not-there" };
            toProps = toProps.filter((p) => p !== swapWith);
            fromProps.push(swapWith);
        }
        return { ok: true, fromRunes: { ...a, property: fromProps }, toRunes: { ...b, property: toProps },
            replaces: other === null || other === swapWith ? null : { ...rune, value: other } };
    }
    if (a[rune.slot] !== rune.value) return { ok: false, reason: "not-there" };
    if (b[rune.slot] && !swap) return { ok: false, reason: "occupied" };
    return { ok: true, fromRunes: { ...a, [rune.slot]: swap ? b[rune.slot] : 0 }, toRunes: { ...b, [rune.slot]: rune.value } };
}

/**
 * Whether an item is the rune itself on its runestone (GM Core p.225): pf2e's rune items (`Striking`, `Flaming`) are the
 * rune on a stone, so a transfer from one is free and uses it up. The item must be made from the order's rune, or carry
 * its slug with an etched-onto usage. A blank `Runestone` holds no rune (an etching onto one is not built), so it is
 * never a source.
 *
 * @param {{sourceId?: string|null, slug?: string|null, usage?: string|null}} item
 * @param {{uuid: string, slug?: string|null}} product   the order's rune
 */
export function isRuneItemOf(item, product) {
    if (!item || !product) return false;
    if (item.sourceId && item.sourceId === product.uuid) return true;
    return !!product.slug && item.slug === product.slug && (item.usage ?? "").startsWith("etched-onto");
}

/**
 * What a transfer costs (GM Core p.225): 10% of the rune's Price, rounded up, nothing from a runestone; a swap takes the
 * higher Price of the two runes.
 */
export function transferCostCp({ runePriceCp, otherPriceCp = 0, fromRunestone = false }) {
    if (fromRunestone) return 0;
    const price = Math.max(requireCp(runePriceCp, "runePriceCp"), requireCp(otherPriceCp, "otherPriceCp"));
    return Math.ceil((price * RUNE_TRANSFER_PCT) / 100);
}

/** The Price of a change to an item: the prepared Price after less before (6.13, upgrades), or null when it is not dearer. */
export function priceDifferenceCp(beforeCp, afterCp) {
    requireCp(beforeCp, "beforeCp");
    requireCp(afterCp, "afterCp");
    return afterCp > beforeCp ? afterCp - beforeCp : null;
}

/** The `system.runes` update for an item of `type` with `runes` (`normalRunes`), as pf2e stores them. */
export function runesUpdate(type, runes) {
    if (type === "shield") return { reinforcing: runes.reinforcing };
    if (type === "armor") return { potency: runes.potency, resilient: runes.resilient, property: [...runes.property] };
    return { potency: runes.potency, striking: runes.striking, property: [...runes.property] };
}
