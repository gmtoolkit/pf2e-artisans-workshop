/**
 * Formatting for the Workshop's interface (DESIGN.md 10, 16.7): money in pf2e's coin abbreviations, gate reasons and
 * refusals as sentences from `lang/en.json`, and names read from documents at runtime. Every sentence is one key with
 * named placeholders; nothing is built by joining words.
 */
import { REGISTRY } from "../data/registry.mjs";
import { coinParts } from "../logic/views.mjs";
import { GATE, RANK_KEY, REFUSAL, STATUS, TOOL } from "./labels.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** Whole numbers with the interface language's grouping. */
export function number(n) {
    return new Intl.NumberFormat(game.i18n.lang || "en").format(n);
}

/** An amount of copper as coins: "1,045 gp 3 sp". */
export function money(cp) {
    if (!Number.isSafeInteger(cp)) return "";
    return coinParts(cp).map(({ unit, n }) => fmt("pf2e-artisans-workshop.Money.Part", {
        n: number(n), unit: loc(`PF2E.CurrencyAbbreviations.${unit}`),
    })).join(" ");
}

/** A parsed amount: "12 gp 5 sp", "12.5 gp", "125 sp", "1250" (copper), or null. */
export function parseMoney(text) {
    const value = String(text ?? "").trim().toLowerCase().replace(/,/g, "");
    if (!value) return null;
    if (/^\d+$/.test(value)) return Number(value);
    const rates = { pp: 1000, gp: 100, sp: 10, cp: 1 };
    let total = 0;
    let rest = value;
    for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*(pp|gp|sp|cp)\b/g)) {
        total += Number(match[1]) * rates[match[2]];
        rest = rest.replace(match[0], "");
    }
    if (rest.trim() || !Number.isFinite(total)) return null;
    const cp = Math.round(total);
    return Math.abs(total - cp) < 1e-9 ? cp : null;
}

/** An actor's name by UUID, or the fallback word. */
export function nameOf(uuid) {
    if (!uuid) return null;
    return fromUuidSync(uuid, { strict: false })?.name ?? loc("pf2e-artisans-workshop.Common.Unknown");
}

/** A user's name by id. */
export const userName = (id) => game.users.get(id)?.name ?? loc("pf2e-artisans-workshop.Common.Unknown");

/** A skill's name (pf2e's label, or a Lore's own slug). */
export function skillName(slug) {
    const label = CONFIG.PF2E?.skills?.[slug]?.label;
    return label ? loc(label) : slug;
}

/** A proficiency rank's name. */
export const rankName = (rank) => loc(RANK_KEY[rank] ?? RANK_KEY[0]);

/** A registry key's compendium name (P9), or the key. */
function featName(key) {
    const entry = REGISTRY[key.split(":")[0]];
    return (entry && fromUuidSync(entry.uuid, { strict: false })?.name) ?? key;
}

/** A gate's reason as a sentence (6.5): which requirement fails and what it needs. */
export function gateText(gate) {
    const key = GATE[gate.reason] ?? GATE.other;
    const data = gate.data ?? {};
    const parts = {
        skill: data.skill ? skillName(data.skill) : "", level: String(data.level ?? ""), rank: rankName(data.rank ?? 0),
        feats: [
            ...(data.feats ?? []).map(featName),
            ...Object.entries(data.ranks ?? {}).map(([skill, rank]) => fmt("pf2e-artisans-workshop.Gate.SkillRank", { skill: skillName(skill), rank: rankName(rank) })),
        ].join(", "),
        rarity: data.rarity ?? "", short: money(data.shortCp ?? 0),
        tool: TOOL[data.tool] ? loc(TOOL[data.tool]) : data.tool ?? "", max: String(data.max ?? ""), reason: gate.reason ?? "",
    };
    return fmt(key, parts);
}

/** A refusal as a notice, with its numbers. */
export function refusalText(result) {
    // A coin move's `reason` is often a transport detail ("locked", "dry-run"); its `outcome` says what it means.
    const reason = [result?.reason, result?.outcome].find((code) => code && REFUSAL[code]) ?? result?.reason ?? "other";
    const key = REFUSAL[reason] ?? REFUSAL.other;
    const data = result?.data ?? {};
    return fmt(key, {
        reason, status: STATUS[data.status] ? loc(STATUS[data.status].key) : "",
        short: money(data.shortCp ?? 0), max: money(data.maxCp ?? 0),
        gates: (data.gates ?? []).map(gateText).join(" "),
    });
}

/** Tell the user why an action did not happen. Results that are fine say nothing. */
export function report(result) {
    if (!result || result.ok) return result;
    ui.notifications.warn(refusalText(result));
    return result;
}

/** When a stamp was written, by its author's own clock (`at.real`, 4.1), in the user's locale. */
export function when(at) {
    const real = at?.real;
    if (!Number.isFinite(real)) return "";
    return new Intl.DateTimeFormat(game.i18n.lang || "en", { dateStyle: "short", timeStyle: "short" }).format(new Date(real));
}
