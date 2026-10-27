/**
 * The spells an item's Craft needs (DESIGN.md 6.9, M9): read from the item's own description in the installed compendium,
 * at runtime, so no rules text ships (P9). Pure: the Foundry side (`productFacts`) hands it the description's HTML.
 *
 * - A staff or a coda instrument lists its spells by rank (`<li><strong>Cantrip|1st|2nd…</strong> @UUID[…], …</li>`), and
 *   its Craft Requirements ask for one casting of every listed rank of every listed spell (GM Core p.282; staff Craft
 *   Requirements): one entry per spell and rank, cantrips included.
 * - A spellheart needs the spells it can cast (Secrets of Magic p.170: "Crafting a spellheart requires the spells the
 *   spellheart can cast"): one entry per "You cast [Nth-rank] @UUID[…]" in its description; a spell with no rank named is
 *   cast at its own rank.
 * - A specialty wand (the wand trait, not one of pf2e's base wands) takes one casting of a spell of its rank, read from its
 *   name ("(3rd-Rank Spell)", "(Rank 2)"), as a magic wand does (GM Core p.282).
 * - Any other item whose Craft Requirements supply castings names them there: one entry per spell link in that paragraph
 *   (its rank from "(Nth rank)" right after the link, else the spell's own); a paragraph that asks for castings without
 *   linking a spell asks for one casting the crafter's table reads from the text (`any`).
 *
 * An entry is `{key, uuid, rank, cantrip}`: `key` is `<uuid>@<rank>` (`@c` for a cantrip, `@base` for the spell's own rank),
 * which a pledge names (`entry`) to say which listed casting it supplies.
 */
import { hasTrait } from "./core.mjs";

/** The kinds of spell-supplied item this reads (6.9): pf2e's base scrolls and wands are `spellSupply`'s own. */
export const LIST_KINDS = Object.freeze(["staff", "spellheart", "wand-special", "named"]);

/** A spell link in compendium HTML: `@UUID[<uuid>]` with an optional `{label}`; only links into a spells pack count. */
const LINK = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;
const isSpellLink = (uuid) => /^Compendium\.[^.]+\.[^.]*spells[^.]*\.Item\./.test(uuid);

/** "1st", "2nd", "3rd", "10th" as a number, "Cantrip(s)" as 0, anything else null. */
export function rankWord(word) {
    const text = String(word ?? "").trim().toLowerCase();
    if (/^cantrips?$/.test(text)) return 0;
    const match = /^(\d+)(?:st|nd|rd|th)$/.exec(text);
    return match ? Number(match[1]) : null;
}

/** The text of an HTML fragment: tags dropped, entities left alone (only numbers and words are read from it). */
const textOf = (html) => String(html ?? "").replace(/<[^>]+>/g, " ");

/** The Craft Requirements paragraph of an item's description, as HTML, or null. */
export function craftRequirementsOf(html) {
    const match = /Craft Requirements\s*<\/strong>([\s\S]*?)(?:<\/p>|$)/i.exec(String(html ?? ""));
    return match ? match[1] : null;
}

/** An entry for a spell at a rank (null: the spell's own rank). */
export function spellEntry(uuid, rank) {
    const cantrip = rank === 0;
    return { key: `${uuid}@${cantrip ? "c" : rank === null ? "base" : rank}`, uuid, rank: cantrip ? 0 : rank, cantrip };
}

/** Entries without repeats, in the order first met. */
const unique = (entries) => [...new Map(entries.map((entry) => [entry.key, entry])).values()];

/**
 * A staff's or coda's listed spells (6.9): every spell link in each `<li><strong>Rank</strong> …</li>` line, at that
 * line's rank. Empty when the description has no list.
 */
export function parseSpellList(html) {
    const entries = [];
    for (const line of String(html ?? "").matchAll(/<li>\s*<strong>([^<]*)<\/strong>([\s\S]*?)<\/li>/gi)) {
        const rank = rankWord(line[1]);
        if (rank === null) continue;
        for (const link of line[2].matchAll(LINK)) if (isSpellLink(link[1])) entries.push(spellEntry(link[1], rank));
    }
    return unique(entries);
}

/** The spells a spellheart casts (6.9): each "You cast [Nth-rank] @UUID[…]", at that rank or the spell's own. */
export function parseCastSpells(html) {
    const entries = [];
    const pattern = /You cast\s+(?:an?\s+)?(?:(\d+)(?:st|nd|rd|th)[-\s]rank\s+)?@UUID\[([^\]]+)\]/gi;
    for (const match of String(html ?? "").matchAll(pattern)) {
        if (isSpellLink(match[2])) entries.push(spellEntry(match[2], match[1] ? Number(match[1]) : null));
    }
    return unique(entries);
}

/**
 * The castings a Craft Requirements paragraph supplies (6.9): each spell link, at the rank written right after it
 * ("(4th rank)") or the spell's own; `any` 1 when the paragraph asks to supply castings without linking a spell, else 0.
 */
export function parseRequirementSpells(paragraph) {
    const html = String(paragraph ?? "");
    const entries = [];
    for (const link of html.matchAll(LINK)) {
        if (!isSpellLink(link[1])) continue;
        const after = textOf(html.slice(link.index + link[0].length, link.index + link[0].length + 40));
        const rank = /^\s*\((\d+)(?:st|nd|rd|th)[-\s]rank\)/i.exec(after);
        entries.push(spellEntry(link[1], rank ? Number(rank[1]) : null));
    }
    const supplies = /\bsuppl(?:y|ying)\b[^.]*?\bcastings?\b/i.test(textOf(html));
    return { entries: unique(entries), any: supplies && !entries.length ? 1 : 0 };
}

/** A specialty wand's rank from its name: "(3rd-Rank Spell)" or "(Rank 2)"; null when the name names none. */
export function wandRankOf(name) {
    const text = String(name ?? "");
    const ordinal = /\((\d+)(?:st|nd|rd|th)-Rank Spell\)/i.exec(text);
    if (ordinal) return Number(ordinal[1]);
    const plain = /\(Rank (\d+)\)/i.exec(text);
    return plain ? Number(plain[1]) : null;
}

/**
 * The spells a product's Craft needs, from its description (6.9, M9), or null when it needs none (or is one of pf2e's base
 * scrolls and wands, which `spellSupply` reads from `CONFIG.PF2E.spellcastingItems`): `{kind, rank, entries, any}`.
 * `kind` is one of `LIST_KINDS`; `rank` a specialty wand's; `any` the castings asked for that no entry names.
 *
 * @param {{html?: string, traits?: string[], name?: string, spellcasting?: object|null}} p
 */
export function spellNeedsOf({ html = "", traits = [], name = "", spellcasting = null } = {}) {
    if (spellcasting) return null;
    const item = { traits };
    const requirements = craftRequirementsOf(html);
    const fromRequirements = parseRequirementSpells(requirements);
    if (hasTrait(item, "staff")) {
        const entries = parseSpellList(html);
        // A staff that asks for something besides its list ("plus one casting of shillelagh") names it in its requirements.
        const extra = fromRequirements.entries.filter((entry) => !entries.some((e) => e.uuid === entry.uuid));
        if (entries.length || extra.length) return { kind: "staff", rank: null, entries: unique([...entries, ...extra]), any: 0 };
        return requirements && /cast/i.test(textOf(requirements)) ? { kind: "staff", rank: null, entries: [], any: 1 } : null;
    }
    if (hasTrait(item, "spellheart")) {
        const entries = parseCastSpells(html);
        return entries.length ? { kind: "spellheart", rank: null, entries, any: 0 } : null;
    }
    if (hasTrait(item, "wand")) {
        const rank = wandRankOf(name);
        if (rank === null && !fromRequirements.entries.length && !fromRequirements.any) return null;
        const entries = fromRequirements.entries.map((entry) => (rank !== null && entry.rank === null ? spellEntry(entry.uuid, rank) : entry));
        return { kind: "wand-special", rank, entries, any: entries.length ? 0 : 1 };
    }
    if (!fromRequirements.entries.length && !fromRequirements.any) return null;
    return { kind: "named", rank: null, entries: fromRequirements.entries, any: fromRequirements.any };
}

/**
 * Whether a caster's spell is the one an entry names: its compendium source is the entry's UUID, or (a description
 * whose links still name spells, as pf2e's source does before its build) the entry's last segment is the spell's name.
 *
 * @param {{key: string, uuid: string}} entry
 * @param {{uuid?: string, source?: string|null, name?: string}} spell
 */
export function entryMatches(entry, spell) {
    if (!entry || !spell) return false;
    if (spell.source === entry.uuid || spell.uuid === entry.uuid) return true;
    const last = entry.uuid.split(".").pop();
    return !/^[A-Za-z0-9]{16}$/.test(last) && typeof spell.name === "string" && last.toLowerCase() === spell.name.toLowerCase();
}
