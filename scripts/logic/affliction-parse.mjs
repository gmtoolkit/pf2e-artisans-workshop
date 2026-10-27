/**
 * The affliction definition parser (DESIGN.md 8.10.2, M8a). Pure: compendium items carry their afflictions only as
 * description text, so the tracker reads the stages from the installed compendium's description at runtime and ships
 * none of it. The result is shaped like pf2e's `AfflictionSystemSource` (numbers, slugs and UUIDs only, P9), plus
 * `confidence` ("full", "partial", "none") and `unparsed: true` on each stage whose text the grammar could not map. A
 * partial definition still runs (timing, saves and stage changes); the unparsed part of a stage is shown by rendering the
 * source item's own paragraph at display time.
 *
 * | Part | Read from |
 * |---|---|
 * | save type and DC | the first inline `@Check[<save>|dc:<n>...]` (language-independent); `against:` a statistic leaves the DC to the user |
 * | onset | the Onset paragraph: a value and unit, or a dice formula (an inline `[[/r ...]]` roll), rolled once at exposure |
 * | maximum duration | the Maximum Duration paragraph |
 * | stages | `<strong>Stage N</strong>` paragraphs, and ranges (`Stages 1–5`), whose stages share their effects and interval |
 * | interval | the stage's last parenthesised duration (or one in its label: `Stage 1 (9 Days)`), dice included |
 * | damage | `@Damage[...]` terms (type and category), and plain "1d6 poison damage" |
 * | conditions | `@UUID[Compendium.pf2e.conditionitems.Item.<Name>]{<Label> n}` links and bare condition names with a value |
 * | effects | `@UUID` links to effect items |
 * | "as stage N" | a copy of that stage's parsed effects |
 *
 * Weeks, months and years become days (7, 30 and 365): pf2e's effect units stop at days.
 */

/** Seconds per pf2e effect time unit (`DURATION_UNITS`, `src/module/item/abstract-effect/values.ts`). */
export const UNIT_SECONDS = Object.freeze({ rounds: 6, minutes: 60, hours: 3600, days: 86400 });

/** Words for time units, to a pf2e unit and a multiplier. */
const UNIT_WORDS = Object.freeze({
    round: ["rounds", 1], rounds: ["rounds", 1], minute: ["minutes", 1], minutes: ["minutes", 1], hour: ["hours", 1], hours: ["hours", 1],
    day: ["days", 1], days: ["days", 1], week: ["days", 7], weeks: ["days", 7], month: ["days", 30], months: ["days", 30],
    year: ["days", 365], years: ["days", 365],
});

/** pf2e's condition slugs (`CONDITION_SLUGS`, `src/module/item/condition/values.ts`). */
export const CONDITION_SLUGS = Object.freeze([
    "blinded", "broken", "clumsy", "concealed", "confused", "controlled", "cursebound", "dazzled", "deafened", "doomed", "drained",
    "dying", "encumbered", "enfeebled", "fascinated", "fatigued", "fleeing", "friendly", "frightened", "grabbed", "helpful", "hidden",
    "hostile", "immobilized", "indifferent", "invisible", "malevolence", "observed", "off-guard", "paralyzed", "persistent-damage",
    "petrified", "prone", "quickened", "restrained", "sickened", "slowed", "stunned", "stupefied", "unconscious", "undetected",
    "unfriendly", "unnoticed", "wounded",
]);

/** Conditions that carry a value (pf2e's valued conditions). */
export const VALUED_CONDITIONS = Object.freeze([
    "clumsy", "cursebound", "doomed", "drained", "dying", "enfeebled", "frightened", "malevolence", "sickened", "slowed", "stunned", "stupefied",
    "wounded",
]);

/** Conditions a stage text names that the parser maps when they stand bare (the rest only as links). */
const BARE_CONDITIONS = Object.freeze([
    "blinded", "clumsy", "concealed", "confused", "controlled", "dazzled", "deafened", "doomed", "drained", "enfeebled", "fascinated",
    "fatigued", "fleeing", "frightened", "hidden", "immobilized", "off-guard", "paralyzed", "petrified", "prone", "quickened", "restrained",
    "sickened", "slowed", "stunned", "stupefied", "unconscious",
]);

/** pf2e's damage types (`DAMAGE_TYPES`), plus `untyped`. */
export const DAMAGE_TYPES = Object.freeze([
    "acid", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison", "slashing", "sonic", "spirit",
    "vitality", "void", "bleed", "untyped",
]);

/** Damage categories pf2e keeps on an instance (`DAMAGE_CATEGORIES_UNIQUE`). */
const DAMAGE_CATEGORIES = Object.freeze(["persistent", "precision", "splash"]);

/** Effect packs a stage's effect link may point into. */
const EFFECT_PACKS = Object.freeze(["equipment-effects", "other-effects", "spell-effects", "bestiary-effects", "feat-effects", "campaign-effects"]);

/** The saving throws (`SAVE_TYPES`). */
export const SAVE_TYPES = Object.freeze(["fortitude", "reflex", "will"]);

/** Traits of the item that make it an affliction of a kind, and that describe how it is delivered. */
export const AFFLICTION_TYPES = Object.freeze(["poison", "disease", "curse"]);
export const DELIVERY_TRAITS = Object.freeze(["contact", "ingested", "inhaled", "injury"]);

/** The default English labels; callers pass the localized ones (`PF2E.Item.Affliction.StageLabel`, `OnsetLabel`). */
export const DEFAULT_LABELS = Object.freeze({ stage: ["Stage"], onset: ["Onset"], maxDuration: ["Maximum Duration"], save: ["Saving Throw"], level: ["Level"] });

/** Words an intro uses when it changes the rule for further exposure (8.10.2: flagged for review). */
const RE_EXPOSURE_WORDS = /\b(?:further|additional|multiple|subsequent|repeated)\s+(?:exposures?|doses?)\b|\bexposed\s+again\b/i;

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** pf2e's `sluggify` for a condition name (`Off-Guard` to `off-guard`). */
const slugOf = (name) => name.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** HTML to text: tags removed, entities a parser meets decoded, whitespace collapsed. */
function textOf(html) {
    return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
}

/** Inline rolls (`[[/r 1d4 #days]]{1d4 days}`, `[[/gmr 1d4]] minutes`) as their label, else their formula. */
export function flattenInlineRolls(text) {
    return text.replace(/\[\[\/(?:r|roll|gmr|gmroll|br|blindroll|sr|selfroll|pr|publicroll)\s+([^\]#]*?)(?:\s*#[^\]]*)?\]\](?:\{([^}]*)\})?/gi,
        (_whole, formula, label) => (label ?? formula).trim());
}

/** A dice formula a parser accepts: `XdY`, `XdY+Z`, `XdY-Z`, a whole number. */
const DICE = String.raw`\d+d\d+(?:\s*[+-]\s*\d+)?`;

/**
 * A duration in words, or null: `{value, unit}` for a fixed one, `{formula, unit}` for dice ("1d4 hours"); weeks, months
 * and years as days. A duration with anything else in it ("6 rounds (but see stage 3)") is null.
 */
export function parseDuration(text) {
    if (typeof text !== "string") return null;
    const clean = flattenInlineRolls(textOf(text)).replace(/[.;]+$/, "").trim().toLowerCase();
    const match = new RegExp(String.raw`^(${DICE}|\d+)\s+([a-z]+)$`).exec(clean);
    if (!match) return null;
    const unit = UNIT_WORDS[match[2]];
    if (!unit) return null;
    const [pf2eUnit, times] = unit;
    const amount = match[1].replace(/\s+/g, "");
    if (/^\d+$/.test(amount)) return { value: Number(amount) * times, unit: pf2eUnit };
    return { formula: times === 1 ? amount : `(${amount})*${times}`, unit: pf2eUnit };
}

/** Seconds of a fixed duration, null for a dice one or none; Infinity for `unlimited`. */
export function durationSeconds(duration) {
    if (!duration) return null;
    if (duration.unit === "unlimited") return Infinity;
    if (!Number.isFinite(duration.value) || !(duration.unit in UNIT_SECONDS)) return null;
    return duration.value * UNIT_SECONDS[duration.unit];
}

/* -------------------------------------------- */
/*  Paragraphs                                   */
/* -------------------------------------------- */

/** The paragraphs of a description (`<p>`, `<li>` and lines between `<hr>`), as HTML. */
function paragraphsOf(html) {
    const out = [];
    for (const match of html.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) out.push(match[2]);
    return out.length ? out : html.split(/<hr\s*\/?>/i);
}

/** A paragraph's leading `<strong>` label and the rest, or null. */
function labelled(paragraph) {
    const match = /^\s*<strong>([\s\S]*?)<\/strong>\s*:?\s*([\s\S]*)$/i.exec(paragraph);
    return match ? { label: textOf(match[1]), rest: match[2] } : null;
}

/** Whether a label is one of `words` (case-insensitive, an optional trailing colon). */
const isLabel = (label, words) => words.some((w) => new RegExp(`^${escapeRe(w)}\\s*:?$`, "i").test(label));

/**
 * A stage label: `Stage 3`, `Stages 1–5`, `Stage 1 (9 Days)`, with the localized stage word. Returns `{from, to, interval}`
 * or null.
 */
function stageLabel(label, words) {
    const word = words.map(escapeRe).join("|");
    const match = new RegExp(String.raw`^(?:${word})s?\s+(\d+)(?:\s*[–—-]\s*(\d+))?\s*(?:\(([^)]*)\))?\s*:?$`, "i").exec(label);
    if (!match) return null;
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    return to >= from ? { from, to, interval: match[3] ?? null } : null;
}

/* -------------------------------------------- */
/*  Stage text                                   */
/* -------------------------------------------- */

/** `@Damage[...]` instances: `1d4[poison]`, `(3d6+2)[persistent,fire]`, several separated by commas. */
function damageInstances(text) {
    const inner = text.split("|")[0];   // `@Damage[1d6[poison]|traits:poison]`: the options after the formula are pf2e's
    const parts = [];
    let depth = 0;
    let current = "";
    for (const ch of inner) {
        if (ch === "[" || ch === "(") depth += 1;
        if (ch === "]" || ch === ")") depth -= 1;
        if (ch === "," && depth === 0) {
            parts.push(current);
            current = "";
        } else current += ch;
    }
    if (current) parts.push(current);
    const out = [];
    for (const part of parts) {
        const match = /^\s*\(?\s*([^[\]]+?)\s*\)?\s*\[([^\]]*)\]\s*$/.exec(part);
        if (!match) return null;
        const formula = match[1].replace(/\s+/g, "").replace(/^\((.*)\)$/, "$1");
        if (!new RegExp(String.raw`^(?:${DICE}|\d+)$`).test(formula)) return null;
        const flavor = match[2].split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
        const type = flavor.find((f) => DAMAGE_TYPES.includes(f)) ?? "untyped";
        let category = flavor.find((f) => DAMAGE_CATEGORIES.includes(f)) ?? null;
        if (type === "bleed") category = "persistent";
        if (flavor.some((f) => !DAMAGE_TYPES.includes(f) && !DAMAGE_CATEGORIES.includes(f))) return null;
        out.push({ formula, damageType: type, category });
    }
    return out;
}

/** The value a condition link or name is followed by: `{Sickened 2}`, or ` 2` right after. */
const valueIn = (label) => {
    const match = /(\d+)\s*$/.exec(label ?? "");
    return match ? Number(match[1]) : null;
};

/**
 * Parse one stage's text (HTML, without its label). Returns `{damage, conditions, effects, duration, asStage, unparsed}`;
 * `asStage` names a stage whose effects this one copies.
 */
function parseStageText(html, labelInterval) {
    let text = flattenInlineRolls(html.replace(/<[^>]+>/g, " ")).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const damage = [];
    const conditions = [];
    const effects = [];
    let unparsed = false;

    // The interval: the last parenthesised duration, at the end (or in the label).
    let duration = labelInterval ? parseDuration(labelInterval) : null;
    if (labelInterval && !duration) unparsed = true;
    const tail = /\(([^()]*(?:\([^()]*\))?[^()]*)\)\s*[.,;]?\s*$/.exec(text);
    if (tail) {
        const parsed = parseDuration(tail[1]);
        if (parsed && !duration) {
            duration = parsed;
            text = text.slice(0, tail.index);
        }
    }

    // Damage links.
    text = text.replace(/@Damage\[((?:[^[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?(\s+damage)?/gi, (whole, inner) => {
        const parsed = damageInstances(inner);
        if (!parsed) return ` ${whole} `;
        damage.push(...parsed);
        return " ";
    });

    // Condition and effect links.
    text = text.replace(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?(?:\s+(\d+)\b)?/g, (whole, uuid, label, after) => {
        const condition = /^Compendium\.pf2e\.conditionitems\.Item\.(.+)$/.exec(uuid);
        if (condition) {
            const slug = slugOf(condition[1]);
            if (!CONDITION_SLUGS.includes(slug)) return ` ${whole} `;
            const value = valueIn(label) ?? (after ? Number(after) : null);
            if (VALUED_CONDITIONS.includes(slug) && value === null) return ` ${whole} `;
            conditions.push({ slug, value: VALUED_CONDITIONS.includes(slug) ? value : null, linked: true });
            return " ";
        }
        const pack = /^Compendium\.pf2e\.([a-z-]+)\.Item\./.exec(uuid)?.[1];
        if (pack && EFFECT_PACKS.includes(pack)) {
            effects.push({ uuid });
            return " ";
        }
        return ` ${whole} `;
    });

    // Plain damage: "1d6 poison damage", "1d6 poison", "persistent 2d6 fire damage".
    const typeWords = DAMAGE_TYPES.filter((t) => t !== "untyped").join("|");
    text = text.replace(new RegExp(String.raw`\b(persistent\s+)?(${DICE})\s+(persistent\s+)?(${typeWords})(\s+damage)?\b`, "gi"), (_whole, before, formula, after, type) => {
        const damageType = type.toLowerCase();
        damage.push({ formula: formula.replace(/\s+/g, ""), damageType,
            category: before || after || damageType === "bleed" ? "persistent" : null });
        return " ";
    });

    // Bare condition names, with a value where the condition takes one.
    const names = BARE_CONDITIONS.map(escapeRe).join("|");
    text = text.replace(new RegExp(String.raw`\b(${names})(?:\s+(\d+))?\b(?!-)`, "gi"), (whole, name, value) => {
        const slug = name.toLowerCase();
        if (VALUED_CONDITIONS.includes(slug) && value === undefined) return ` ${whole} `;
        conditions.push({ slug, value: VALUED_CONDITIONS.includes(slug) ? Number(value) : null, linked: true });
        return " ";
    });

    // "as stage N", and the phrases that say a stage does nothing.
    let asStage = null;
    text = text.replace(/\bas stage (\d+)\b/i, (_whole, n) => {
        asStage = Number(n);
        return " ";
    });
    text = text.replace(/\b(?:carrier with )?no (?:ill )?effects?\b|\bno adjustment\b/gi, " ");

    // What is left must be connectors only.
    const leftover = text.replace(/\b(?:damage|and)\b/gi, " ").replace(/[,.;:]/g, " ").trim();
    if (leftover) unparsed = true;
    return { damage, conditions, effects, duration, asStage, unparsed };
}

/** Merge conditions: one entry per slug, the highest value. */
function mergeConditions(list) {
    const bySlug = new Map();
    for (const c of list) {
        const had = bySlug.get(c.slug);
        if (!had || (c.value ?? 0) > (had.value ?? 0)) bySlug.set(c.slug, { ...c });
    }
    return [...bySlug.values()];
}

/* -------------------------------------------- */
/*  The whole description                        */
/* -------------------------------------------- */

/**
 * The save of an affliction: the first inline saving throw check, preferring the Saving Throw paragraph's. `{type, value}`;
 * `value` null when the check is `against:` a statistic (the creature's class or spell DC: the user gives it). `traits` are
 * the check's own (`traits:disease,virulent`).
 */
function parseSave(html, saveParagraph) {
    const scan = (text) => {
        for (const match of (text ?? "").matchAll(/@Check\[([^\]]*)\]/g)) {
            const params = match[1].split("|").map((p) => p.trim());
            const type = (params[0]?.includes(":") ? params.map((p) => /^type:(.*)$/i.exec(p)?.[1]).find(Boolean) : params[0])?.toLowerCase();
            if (!SAVE_TYPES.includes(type)) continue;
            const dc = params.map((p) => /^dc:\s*(\d+)$/i.exec(p)?.[1]).find(Boolean);
            // `dc:` left empty: a creature ability whose DC is its creature's (the user gives it, 8.10.4 rung 2).
            const blank = params.some((p) => /^dc:\s*$/i.test(p));
            const against = params.map((p) => /^against:(.*)$/i.exec(p)?.[1]).find(Boolean) ?? (blank ? "creature" : null);
            const traits = (params.map((p) => /^traits:(.*)$/i.exec(p)?.[1]).find(Boolean) ?? "").split(",").map((t) => t.trim()).filter(Boolean);
            return { type, value: dc ? Number(dc) : null, against, traits };
        }
        return null;
    };
    // A plain-text save in the Saving Throw paragraph: "DC 32 Fortitude", or "Fortitude" alone (a spell's: its caster's DC).
    const plain = () => {
        const text = textOf(saveParagraph ?? "").toLowerCase();
        const type = SAVE_TYPES.find((t) => new RegExp(`\\b${t}\\b`).test(text));
        if (!type) return null;
        const dc = /\bdc\s*(\d+)\b/.exec(text)?.[1];
        return { type, value: dc ? Number(dc) : null, against: dc ? null : "spell", traits: [] };
    };
    return scan(saveParagraph) ?? scan(html) ?? plain();
}

/**
 * Parse an item's description into an affliction definition (8.10.2), or a definition with `confidence: "none"` when the
 * text has no stages. `item` gives the facts the description lacks: `{level, traits}` (its delivery, virulent, its kind).
 *
 * @param {string} html
 * @param {{level?: number, traits?: string[]}} [item]
 * @param {{stage?: string[], onset?: string[], maxDuration?: string[], save?: string[]}} [labels]  localized labels
 * @returns {object}  `{v, level, traits, save, onset, duration, stages, confidence, problems, intro: {reExposure}}`
 */
export function parseAffliction(html, { level = 0, traits = [], save: saveHint = null } = {}, labels = DEFAULT_LABELS) {
    const words = { ...DEFAULT_LABELS, ...labels };
    const paragraphs = paragraphsOf(typeof html === "string" ? html : "");
    const problems = [];
    let onset = null;
    let duration = { value: -1, unit: "unlimited", expiry: null };
    let saveParagraph = null;
    let ownLevel = null;
    const raw = new Map();
    let firstLabelled = -1;
    paragraphs.forEach((paragraph, index) => {
        const l = labelled(paragraph);
        if (!l) return;
        const stage = stageLabel(l.label, words.stage);
        const known = stage || isLabel(l.label, words.onset) || isLabel(l.label, words.maxDuration) || isLabel(l.label, words.save);
        if (known && firstLabelled < 0) firstLabelled = index;
        if (stage) {
            for (let n = stage.from; n <= stage.to; n++) if (!raw.has(n)) raw.set(n, { html: l.rest, interval: stage.interval });
        } else if (isLabel(l.label, words.onset)) {
            onset = parseDuration(l.rest);
            if (!onset) problems.push("onset");
        } else if (isLabel(l.label, words.maxDuration)) {
            const parsed = parseDuration(l.rest);
            if (parsed) duration = { ...parsed, expiry: null };
            else problems.push("duration");
        } else if (isLabel(l.label, words.save)) {
            saveParagraph = l.rest;
        } else if (isLabel(l.label, words.level ?? ["Level"]) && /^\s*\d+\s*$/.test(textOf(l.rest))) {
            ownLevel = Number(textOf(l.rest));   // an affliction a spell or ability names gives its own level
        }
    });
    const intro = paragraphs.slice(0, firstLabelled < 0 ? paragraphs.length : firstLabelled).map(textOf).join(" ");
    // A spell's save is its defense (`system.defense.save`), against its caster's spell DC; an item's is its inline check.
    const save = parseSave(paragraphs.join(" "), saveParagraph) ??
        (saveHint && SAVE_TYPES.includes(saveHint.type) ? { type: saveHint.type, value: null, against: saveHint.against ?? "spell", traits: [] } : null);
    if (!save) problems.push("save");
    else if (save.value === null && !save.against) problems.push("save");
    const kinds = [...new Set([...(traits ?? []), ...(save?.traits ?? [])])];
    const numbers = [...raw.keys()].sort((a, b) => a - b);
    const count = numbers.length ? numbers.at(-1) : 0;
    const stages = [];
    for (let n = 1; n <= count; n++) {
        const entry = raw.get(n);
        if (!entry) {
            stages.push({ damage: [], conditions: [], effects: [], duration: null, unparsed: true });
            problems.push(`stage-${n}`);
            continue;
        }
        const parsed = parseStageText(entry.html, entry.interval);
        stages.push(parsed);
    }
    // "as stage N": the copy's effects, plus what this stage adds; its own interval, or the copy's.
    for (const [i, stage] of stages.entries()) {
        if (!stage.asStage) continue;
        const from = stages[stage.asStage - 1];
        if (!from || stage.asStage === i + 1 || from.asStage) {
            stage.unparsed = true;
            continue;
        }
        stage.damage = [...from.damage, ...stage.damage];
        stage.conditions = mergeConditions([...from.conditions, ...stage.conditions]);
        stage.effects = [...from.effects, ...stage.effects];
        stage.duration ??= from.duration;
    }
    const out = stages.map((s, i) => {
        const missingInterval = !s.duration;
        if (s.unparsed) problems.push(`stage-${i + 1}`);
        else if (missingInterval) problems.push(`interval-${i + 1}`);
        return {
            damage: s.damage, conditions: mergeConditions(s.conditions), effects: s.effects,
            duration: s.duration ? { ...s.duration } : null, ...(s.unparsed || missingInterval ? { unparsed: true } : {}),
        };
    });
    const unique = [...new Set(problems)];
    const confidence = out.length === 0 ? "none" : unique.length === 0 ? "full" : "partial";
    return {
        v: 1, level: Number.isInteger(ownLevel) ? ownLevel : Number.isInteger(level) ? level : 0, traits: kinds,
        save: save ? { type: save.type, value: save.value, ...(save.against ? { against: save.against } : {}) } : { type: null, value: null },
        onset, duration, stages: out, confidence, problems: unique,
        voluntaryFail: kinds.includes("drug"),
        intro: { reExposure: RE_EXPOSURE_WORDS.test(intro) },
    };
}

/** Whether a description is a candidate for the corpus check (8.10.2): any Stage or Stages label, an Onset or Maximum Duration paragraph. */
export function isCandidate(html, labels = DEFAULT_LABELS) {
    const words = { ...DEFAULT_LABELS, ...labels };
    return paragraphsOf(typeof html === "string" ? html : "").some((paragraph) => {
        const l = labelled(paragraph);
        return !!l && (!!stageLabel(l.label, words.stage) || isLabel(l.label, words.onset) || isLabel(l.label, words.maxDuration));
    });
}
