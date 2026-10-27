/**
 * Tattoos, grafts and the remaining crafts (DESIGN.md 1.1, 6.14, 7.1, M9). Pure: plain data in, records and refusals out;
 * the Foundry side is `scripts/foundry/crafts.mjs`.
 *
 * - **Subjects** (6.14). A tattoo or graft order (`craftType` "tattoo" or "graft") names its subject (`order.target`, an
 *   actor UUID), who is also its recipient. The subject's owner consents (`order.subject`, a key only they write); under a
 *   process that needs the subject present (the Secrets of Magic tattoo process with `rules.tattooSubjectLocked`, and every
 *   graft) the subject is then locked to the order like a Communal Crafting helper: its downtime days are spent as the
 *   subject (activity `subject`) until the order closes or the consent is withdrawn before the Craft starts. A crafter who
 *   is their own subject needs neither.
 * - **One at a time** (6.14): a tattooist under the Secrets of Magic process, and every implanter, has at most one tattoo
 *   (graft) order in progress (G11). The limit is on the crafter, not the subject (Secrets of Magic p.164; Howl of the
 *   Wild p.97).
 * - **Investiture** (6.14): each magical tattoo and each graft lowers its subject's invest limit by one; a new one fails
 *   only when that limit is already zero: a tattoo stays decorative for good, a graft is inactive until the limit rises
 *   again. Tattooed Historian lets some magical tattoos not count (`investitureExempt`, from the registry).
 * - **Healing** (6.14): under the Secrets of Magic process a tattoo is delivered uninvested and works once its healing
 *   period ends (`rules.tattooHealingDays`, default 30); recorded magical or alchemical healing ends it after at least a
 *   day. The simple toggle and grafts have none.
 * - **Legendary Tattoo Artist** (Treasure Vault (Remastered)): a magical tattoo at least 3 levels below its tattooist gets +1
 *   to the attack and DC values of its activated abilities and to its resistances, written on the created item.
 * - **Fulus** (Secrets of Magic p.158): a fulu takes its creator's tradition trait and lasts a year (a `world` expiry stamp).
 * - **Missives** (Treasure Vault (Remastered) p.84): crafted blank, then composed (Compose Missive, 10 minutes) one at a time.
 * - **Quick-deploy snares** (7.1): a prepared snare pool's ledger, with giant and broad snares costing two slots.
 */
import { asSet, hasTrait, isMagical, requireInteger } from "./core.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";
import { CLOSED } from "./orders.mjs";

/** Craft types with a subject (6.14). */
export const SUBJECT_TYPES = Object.freeze(["tattoo", "graft"]);
/** States in which a subject order is under way: the subject is being worked on (one at a time, 6.14). */
export const IN_PROGRESS = Object.freeze(["setup", "check", "rolled", "finishing", "paused"]);
/** States in which a subject may give or withdraw consent: before the Craft starts, or after it failed. */
export const CONSENT_STATUSES = Object.freeze(["requested", "accepted", "failed"]);
/** The four magic traditions, one of which a fulu takes (Secrets of Magic p.158). */
export const TRADITIONS = Object.freeze(["arcane", "divine", "occult", "primal"]);
/** How long a fulu lasts, in days (Secrets of Magic p.158: one year). */
export const FULU_DAYS = 365;

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/** The craft type a product's traits call for: "tattoo", "graft", or null. */
export function subjectTypeOf(product) {
    if (hasTrait(product ?? {}, "tattoo")) return "tattoo";
    if (hasTrait(product ?? {}, "graft")) return "graft";
    return null;
}

/**
 * How a subject order runs (6.14): `{process, presence, oneAtATime, healingDays, fails, invested}`. A tattoo follows the
 * process frozen at its start (`frozen`), else `rules.tattooProcess`; a graft has one way. `fails` is what a new one becomes
 * when the subject's invest limit is already zero ("decorative", "inactive"), null when investiture is not checked;
 * `invested` whether it is delivered invested.
 */
export function subjectProcess(craftType, rules = DEFAULT_RULES, frozen = null) {
    if (craftType === "graft") return { process: "graft", presence: true, oneAtATime: true, healingDays: 0, fails: "inactive", invested: false };
    if (craftType !== "tattoo") return null;
    if ((frozen ?? rules.tattooProcess) === "simple") {
        return { process: "simple", presence: false, oneAtATime: false, healingDays: 0, fails: null, invested: true };
    }
    return { process: "secrets-of-magic", presence: rules.tattooSubjectLocked !== false, oneAtATime: true,
        healingDays: Math.max(0, Math.trunc(rules.tattooHealingDays ?? 30)), fails: "decorative", invested: false };
}

/** An order's consent record (`order.subject`), or null. */
export const consentOf = (order) => (order?.subject && typeof order.subject === "object" ? order.subject : null);

/** Whether an order's subject is its crafter, who needs no consent and is present by crafting. */
export const selfSubject = (order) => !!order?.crafter && order.crafter === order.target;

/**
 * The open order a PC is locked to as a subject (6.14), or null: one it consented to under a process that needs it present,
 * that has not closed, and whose crafter is someone else.
 * @param {object[]} orders
 * @param {string} actorUuid
 */
export function subjectLockOf(orders, actorUuid) {
    for (const order of orders ?? []) {
        const consent = consentOf(order);
        if (!consent?.consented || !consent.presence || consent.actor !== actorUuid || order.target !== actorUuid) continue;
        if (order.crafter === actorUuid || CLOSED.includes(order.status)) continue;
        return order.id;
    }
    return null;
}

/**
 * The other order of the same kind the crafter has in progress (6.14: one tattoo, or one graft, at a time), or null.
 * @param {object[]} orders
 * @param {{id: string, crafter: string, craftType: string}} order
 */
export function busyWith(orders, order) {
    const other = (orders ?? []).find((o) => o.id !== order.id && o.crafter === order.crafter && o.craftType === order.craftType &&
        IN_PROGRESS.includes(o.status));
    return other?.id ?? null;
}

/**
 * G10 for a subject order (6.14): whether its subject consented, and whether it is present and locked where the process
 * needs it. `status` is the subject's downtime status (`pcs.<id>`).
 * @returns {{subjectConsented: boolean, subjectLocked: boolean}}
 */
export function subjectCustody(order, process, status = null) {
    if (selfSubject(order)) return { subjectConsented: true, subjectLocked: true };
    const consent = consentOf(order);
    const consented = !!consent?.consented && consent.actor === order.target;
    if (!process?.presence) return { subjectConsented: consented, subjectLocked: consented };
    const present = !!status?.inDowntime && status.activity?.kind === "subject" && status.activity.ref === order.id;
    return { subjectConsented: consented, subjectLocked: consented && !!consent.presence && present };
}

/**
 * Why the subject's owner may not consent now, or null (6.14): the order is gone or closed, under way, the actor is not
 * its subject, or the subject is locked to another order (a helper or a subject elsewhere).
 */
export function consentProblem(order, actorUuid, otherLock = null) {
    if (!order) return refuse("no-order");
    if (order.target !== actorUuid) return refuse("not-subject");
    if (!CONSENT_STATUSES.includes(order.status)) return refuse("state", { status: order.status });
    if (otherLock && otherLock !== order.id) return refuse("subject-locked", { order: otherLock });
    return null;
}

/* -------------------------------------------- */
/*  Investiture                                  */
/* -------------------------------------------- */

/**
 * Whether a new magical tattoo or a graft works on its subject (6.14; Secrets of Magic p.164, Howl of the Wild p.97): the
 * subject's invest limit is `max` less one for each magical tattoo and graft it has (Tattooed Historian's `exempt` tattoos
 * aside); the new one fails only when that limit is already zero. `over` says the subject now invests more items than its
 * lowered limit allows, and must stop investing one.
 *
 * @param {object} p
 * @param {"tattoo"|"graft"} p.kind
 * @param {number} p.max           the subject's investiture maximum (pf2e's `system.resources.investiture.max`)
 * @param {number} [p.tattoos]     magical tattoos it already has that work (not decorative)
 * @param {number} [p.grafts]      grafts it already has that count
 * @param {number} [p.exempt]      magical tattoos that do not count (Tattooed Historian)
 * @param {number} [p.otherInvested]  other invested items it wears today
 * @returns {{works: boolean, limit: number, exempt: boolean, over: boolean}}
 */
export function investitureCheck({ kind, max, tattoos = 0, grafts = 0, exempt = 0, otherInvested = 0 }) {
    requireInteger(max, "max");
    const free = kind === "tattoo" && exempt > tattoos;
    const limit = max - Math.max(0, tattoos - exempt) - grafts;
    const works = free || limit > 0;
    const after = free ? limit : limit - 1;
    return { works, limit, exempt: free, over: works && otherInvested > Math.max(0, after) };
}

/* -------------------------------------------- */
/*  Healing and the item's record                */
/* -------------------------------------------- */

/**
 * The record a delivered tattoo or graft carries (`flags.MOD.subject`): what it is, whose, under which process, its
 * healing window (`from` the workshop day it was finished, `until` the day it works) and its state: "healing" (not working
 * yet), "invested", "decorative" (a tattoo that found no invest limit left; for good), "inactive" (a graft waiting for the
 * limit to rise), "mundane" (not magical: nothing to invest).
 */
export function subjectRecord({ kind, order, subject, crafter, process, magical, day, replaces = null }) {
    requireInteger(day, "day");
    const until = day + (process?.healingDays ?? 0);
    const state = !magical ? "mundane" : process?.invested ? "invested" : "healing";
    return { kind, order, subject, crafter, process: process?.process ?? null, magical: !!magical, from: day, until, healed: null, state, replaces };
}

/** The day healing recorded on `day` ends a healing period (6.14): that day, but never before the day after the finish. */
export function healedUntil(record, day) {
    requireInteger(day, "day");
    return Math.max(record.from + 1, Math.min(record.until, day));
}

/**
 * What a tattoo or graft becomes now (6.14), or null when nothing changes: once healed, invested if the subject's limit
 * allows, else decorative (a tattoo) or inactive (a graft); an inactive graft is checked again each time.
 * @param {object} record   `flags.MOD.subject`
 * @param {{day: number, check: () => {works: boolean}}} now   `check` runs `investitureCheck` for this item
 */
export function settleSubject(record, { day, check }) {
    if (!record || !["healing", "inactive"].includes(record.state)) return null;
    if (record.state === "healing" && day < record.until) return null;
    const { works } = check();
    if (works) return { state: "invested", invested: true };
    if (record.state === "inactive") return null;
    return { state: record.kind === "graft" ? "inactive" : "decorative", invested: false };
}

/** States in which a delivered tattoo or graft does not work, so it is never invested: still healing, decorative, inactive. */
export const NOT_WORKING = Object.freeze(["healing", "decorative", "inactive"]);

/**
 * A decorative tattoo's traits (6.14; Secrets of Magic p.164: the magic fails to take hold and it "becomes a non-magical
 * tattoo"): `magical`, `invested` and any magic tradition dropped, so pf2e neither offers to invest it nor counts it as
 * magical. Its rule elements go too (`settleActor`), since pf2e applies a worn item's rules when it needs no investment.
 */
export function decorativeTraits(traits = []) {
    return [...traits].filter((t) => t !== "magical" && t !== "invested" && !TRADITIONS.includes(t));
}

/** Whether a decorative tattoo still carries what makes pf2e treat it as a magic item (traits from before `decorativeTraits`). */
export const stillMagical = (traits = []) => decorativeTraits(traits).length !== [...traits].length;

/* -------------------------------------------- */
/*  Legendary Tattoo Artist                      */
/* -------------------------------------------- */

/**
 * The crafter mark a made item gets (6.14), or null: the first of `marks` (`crafterMarks`, the registry's: Legendary Tattoo
 * Artist's for a tattoo) that the item's level is far enough below the crafter's for, on a magical item.
 * @param {{mark: string, by: number, below: number}[]} marks
 */
export function markFor(marks, { crafterLevel, item }) {
    if (!isMagical(item)) return null;
    return (marks ?? []).find((m) => item.level <= crafterLevel - (m.below ?? 0)) ?? null;
}

/**
 * A tattoo's description with the attack and DC values of its activated abilities raised by `by` (Legendary Tattoo
 * Artist): every inline check's `dc:N` and every plain "DC N" from the first "Activate" on. Text before it (what the tattoo
 * does while worn) is left alone. `raised` counts the values changed.
 */
export function raiseActivated(html, by = 1) {
    const text = String(html ?? "");
    const start = text.search(/Activate/);
    if (start < 0) return { html: text, raised: 0 };
    let raised = 0;
    const tail = text.slice(start)
        .replace(/(@Check\[[^\]]*?\bdc:)(\d+)/g, (_m, head, n) => {
            raised += 1;
            return `${head}${Number(n) + by}`;
        })
        .replace(/(\bDC\s)(\d+)\b/g, (_m, head, n) => {
            raised += 1;
            return `${head}${Number(n) + by}`;
        })
        .replace(/(\battack (?:modifier|roll) of \+)(\d+)/gi, (_m, head, n) => {
            raised += 1;
            return `${head}${Number(n) + by}`;
        });
    return { html: text.slice(0, start) + tail, raised };
}

/** A tattoo's rule elements with every numeric `Resistance` value raised by `by` (Legendary Tattoo Artist). */
export function raiseResistances(rules = [], by = 1) {
    let raised = 0;
    const out = rules.map((rule) => {
        if (rule?.key !== "Resistance" || !Number.isInteger(rule.value)) return rule;
        raised += 1;
        return { ...rule, value: rule.value + by };
    });
    return { rules: out, raised };
}

/* -------------------------------------------- */
/*  Fulus and missives                           */
/* -------------------------------------------- */

/**
 * The tradition a fulu takes (Secrets of Magic p.158: its creator's): the one the crafter chose for the order, else the
 * crafter's only spellcasting tradition; null when it must be chosen (none, or several).
 */
export function fuluTradition({ chosen = null, traditions = [] }) {
    if (TRADITIONS.includes(chosen)) return chosen;
    const own = [...new Set(traditions.filter((t) => TRADITIONS.includes(t)))];
    return own.length === 1 ? own[0] : null;
}

/** A fulu's traits with its tradition: the tradition added and `magical` dropped beside it, as pf2e names magic items. */
export function fuluTraits(traits, tradition) {
    const out = new Set(traits ?? []);
    if (!TRADITIONS.includes(tradition)) return [...out].sort();
    for (const t of TRADITIONS) out.delete(t);
    out.add(tradition);
    out.delete("magical");
    return [...out].sort();
}

/**
 * A fulu's expiry stamp (4.12 `world`): a year of world time from its creation, and the same number of days logged ahead
 * of the clock.
 */
export function fuluStamp({ creator, worldTime, day, secondsPerDay = 86400 }) {
    if (typeof creator !== "string" || !creator) throw new TypeError("a stamp names its creator");
    requireInteger(day, "day");
    if (!Number.isFinite(worldTime)) throw new TypeError("a fulu stamp needs the world time");
    return { creator, cycle: null, rule: "world", fulu: true, at: worldTime + FULU_DAYS * secondsPerDay, atDay: day + FULU_DAYS };
}

/** Whether an item is a missive, and whether it is composed yet (`flags.MOD.missive.composed`). */
export const isMissive = (item) => hasTrait(item ?? {}, "missive");

/**
 * A missive's compose record (Compose Missive, 10 minutes): who composed it, as whom, when, and an optional note. Refused:
 * `not-missive`, `composed` (already).
 */
export function composePlan(item, { actor, by, at, note = "" }) {
    if (!isMissive(item)) return refuse("not-missive");
    if (item.composed) return refuse("composed");
    return { ok: true, record: { actor, by, at, note: String(note ?? "").trim() || null } };
}

/* -------------------------------------------- */
/*  Quick-deploy snares (7.1)                    */
/* -------------------------------------------- */

/** Marks a prepared snare may carry, by the registry's `quickDeploy` effects held (Giant Snare, Broad Snare). */
export const SNARE_MARKS = Object.freeze(["giant", "broad"]);

/** The keys of a prepared list's entries: `<uuid>#<n>`, the nth time that formula is prepared. */
export function entryKeys(prepared = []) {
    const seen = new Map();
    return prepared.map((p) => {
        const n = (seen.get(p.uuid) ?? 0) + 1;
        seen.set(p.uuid, n);
        return `${p.uuid}#${n}`;
    });
}

/**
 * A prepared snare pool's quick-deploy ledger (7.1, M9): each prepared snare with its mark and whether it is deployed
 * (pf2e's own `expended`), and the slots used. pf2e counts each prepared snare as one slot; a giant or broad snare costs
 * two (Giant Snare, Broad Snare), which the module counts. Marks the character may no longer make count as plain.
 *
 * @param {{maxSlots: number, prepared: {uuid: string, name?: string, expended?: boolean}[]}} pool
 * @param {Record<string, string>} [marks]   by entry key
 * @param {Iterable<string>} [allowed]       the marks the character's feats allow
 */
export function quickDeployLedger(pool, marks = {}, allowed = []) {
    const can = asSet(allowed);
    const keys = entryKeys(pool.prepared ?? []);
    const entries = (pool.prepared ?? []).map((p, i) => {
        const mark = can.has(marks?.[keys[i]]) ? marks[keys[i]] : null;
        return { key: keys[i], index: i, uuid: p.uuid, name: p.name ?? null, mark, cost: mark ? 2 : 1, deployed: !!p.expended };
    });
    const used = entries.reduce((sum, e) => sum + e.cost, 0);
    const max = Number.isInteger(pool.maxSlots) ? pool.maxSlots : null;
    return { entries, used, max, over: max !== null && used > max ? used - max : 0, deployed: entries.filter((e) => e.deployed).length,
        ready: entries.filter((e) => !e.deployed).length };
}
