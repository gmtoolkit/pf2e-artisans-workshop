/**
 * Talismans at daily preparation (DESIGN.md 7.4, M7). Pure: the Talisman Dabbler DC stamp, the time affixing takes, and
 * the affix board (which talismans sit on which host, and whether they work). The Foundry side
 * (`scripts/foundry/morning.mjs`) reads the actor and writes the flags; the affix rule itself (what may go on what) is
 * M5's `affixProblem` (`scripts/logic/services.mjs`).
 *
 * Affix records are `flags.MOD.affix = {host, at, by}` on the talisman or spellheart, `host` an item id on the same actor.
 * A host holds one talisman or spellheart; more than one suppresses them all (GM Core, Affix a Talisman), except two on
 * the one item a Talismanic Sage has treated (`flags.MOD.sageHost` on the actor: treating a new item ends the old one's).
 */

/** Minutes Affix a Talisman takes (GM Core). */
export const AFFIX_MINUTES = 10;

/**
 * The DC a Talisman Dabbler's temporary talisman uses (Player Core 2): the highest of the creator's class DC and spell
 * DC, or null when the creator has neither (the talisman keeps its own then).
 */
export function dabblerDc({ classDc = null, spellDc = null } = {}) {
    const dcs = [classDc, spellDc].filter((dc) => Number.isInteger(dc) && dc > 0);
    return dcs.length ? Math.max(...dcs) : null;
}

/** An inline check: `@Check[...]`, its parameters separated by `|` (pf2e's `text-editor.ts`). */
const INLINE_CHECK = /@Check\[([^\]]*)\]/g;
/** A plain DC parameter; a resolved one (`dc:resolve(...)`) is left alone. */
const DC_PARAM = /^(\s*dc\s*:\s*)(\d+)(\s*)$/i;

/**
 * Rewrite a talisman's inline check DCs to `dc` where `dc` is higher (7.4, 8.10.4: the stamp is written only when the
 * creator's DC beats the printed one). Returns the new text, how many checks changed, and the printed DCs.
 *
 * @param {string} text   the item's description HTML
 * @param {number|null} dc
 * @returns {{text: string, changed: number, printed: number[]}}
 */
export function stampInlineChecks(text, dc) {
    const printed = [];
    let changed = 0;
    if (typeof text !== "string" || !text) return { text: text ?? "", changed, printed };
    const out = text.replace(INLINE_CHECK, (whole, inner) => {
        const params = inner.split("|");
        let touched = false;
        const next = params.map((param) => {
            const match = DC_PARAM.exec(param);
            if (!match) return param;
            const value = Number(match[2]);
            printed.push(value);
            if (!Number.isInteger(dc) || dc <= value) return param;
            touched = true;
            return `${match[1]}${dc}${match[3]}`;
        });
        if (!touched) return whole;
        changed += 1;
        return `@Check[${next.join("|")}]`;
    });
    return { text: out, changed, printed };
}

/**
 * Minutes affixing `count` talismans takes (7.4): 10 minutes each (GM Core); 1 minute each with Rapid Affixture; a
 * Talisman Dabbler affixes up to four in 10 minutes, and with Quick Fix up to four in 1 minute. The fastest that applies.
 *
 * @param {number} count
 * @param {{rapidAffixture?: boolean, dabbler?: boolean, quickFix?: boolean}} feats
 */
export function affixMinutes(count, { rapidAffixture = false, dabbler = false, quickFix = false } = {}) {
    if (!Number.isInteger(count) || count <= 0) return 0;
    const ways = [count * AFFIX_MINUTES];
    if (rapidAffixture || quickFix) ways.push(count);
    if (dabbler) ways.push(Math.ceil(count / 4) * AFFIX_MINUTES);
    if (quickFix) ways.push(Math.ceil(count / 4));
    return Math.min(...ways);
}

/** The daily-preparation window affixing must fit in, in minutes (GM Core p.35: 30 to 60 minutes of preparation). */
export const PREP_WINDOW = Object.freeze({ min: 30, max: 60 });

/**
 * The affix board (7.4): each host with what is affixed to it and whether it works, and the talismans affixed nowhere.
 * - `state`: `empty`; `active` (one, or two on the Talismanic Sage's treated item); `suppressed` (more than that: none
 *   of them work, GM Core).
 * - `usable`: the host is wielded or worn, which a talisman needs to be activated (the card warns otherwise).
 *
 * @param {object} p
 * @param {{id: string, name: string, host: string|null}[]} p.talismans   talismans and spellhearts, with their affix host
 * @param {{id: string, name: string, usable: boolean}[]} p.hosts         items that could take one
 * @param {string|null} [p.sageHost]       the item a Talismanic Sage has treated
 * @param {boolean} [p.talismanicSage]     whether the actor has Talismanic Sage
 */
export function affixBoard({ talismans, hosts, sageHost = null, talismanicSage = false }) {
    const byHost = new Map(hosts.map((host) => [host.id, []]));
    const loose = [];
    for (const talisman of talismans) {
        if (talisman.host && byHost.has(talisman.host)) byHost.get(talisman.host).push(talisman);
        else loose.push({ ...talisman, orphan: !!talisman.host });
    }
    const board = hosts.map((host) => {
        const on = byHost.get(host.id);
        const sage = talismanicSage && host.id === sageHost;
        const limit = sage ? 2 : 1;
        const state = on.length === 0 ? "empty" : on.length <= limit ? "active" : "suppressed";
        return { ...host, talismans: on, count: on.length, sage, limit, state, warn: on.length > 0 && !host.usable };
    });
    return { hosts: board, loose, suppressed: board.filter((h) => h.state === "suppressed").length };
}
