/**
 * Service orders (DESIGN.md 4.5, 6.13, M5): short jobs party members ask each other for, with their own lightweight
 * record. Pure: the record, who may act on it, the Repair outcome and the affix rule. The Foundry side
 * (`scripts/foundry/services.mjs`) rolls, writes the items and the records.
 *
 * `services.<id> = {id, v, kind, party, requester, performer, target, uuid, status, result, note, created, log, by, at}`:
 * `requester` and `performer` are actor UUIDs (`performer` null until a member offers), `target` the item a repair or an
 * affix works on (an item UUID), `uuid` the formula a `formula-copy` copies, `status` "open", "done", "failed" or
 * "cancelled". A rune transfer is not a service record: it runs on the order machine (`craftType: "rune-transfer"`).
 */
import { REPAIR_HP, TALISMANS_PER_HOST } from "../data/services.mjs";
import { DEGREE, RANK, requireDegree, requireInteger } from "./core.mjs";

export const SERVICE_VERSION = 1;

/** Service kinds (4.5); `unaffix` takes a talisman off its host. */
export const SERVICE_KINDS = Object.freeze(["repair", "affix", "unaffix", "identify-alchemy", "formula-copy"]);
/** Service states. */
export const SERVICE_STATUS = Object.freeze(["open", "done", "failed", "cancelled"]);
/** Kinds that work on an item the performer must hold (4.5). */
export const ITEM_SERVICES = Object.freeze(["repair", "affix", "unaffix"]);

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/**
 * A service record (4.5). A performer the filing user owns takes it at once.
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.kind
 * @param {string} p.requester       actor UUID
 * @param {string|null} [p.performer]
 * @param {string|null} [p.target]   an item UUID (repair, affix: the talisman; unaffix: the talisman)
 * @param {string|null} [p.host]     affix: the host item's UUID
 * @param {string|null} [p.uuid]     formula-copy: the formula
 */
export function makeService({ id, kind, party = null, requester, performer = null, target = null, host = null, uuid = null, note = "" }, stamp) {
    if (!SERVICE_KINDS.includes(kind)) throw new RangeError(`unknown service kind ${kind}`);
    if (typeof requester !== "string" || !requester) throw new TypeError("a service needs its requester");
    if (kind === "formula-copy" && !uuid) throw new TypeError("a formula copy names its formula");
    if (ITEM_SERVICES.includes(kind) && !target) throw new TypeError(`a ${kind} names its item`);
    return {
        id, v: SERVICE_VERSION, kind, party, requester, performer, target, host, uuid, status: "open", result: null,
        note: note ?? "", created: stamp.at, log: {}, ...stamp,
    };
}

/** Offer to perform an open service as `performer` (an actor UUID). */
export function offerService(service, performer) {
    if (service.status !== "open") return refuse("state", { status: service.status });
    if (service.performer) return refuse("taken");
    return { ok: true, patch: { performer } };
}

/** Close a service with what happened: "done" or "failed", and its result. */
export function closeService(service, status, result = null) {
    if (service.status !== "open") return refuse("state", { status: service.status });
    if (status !== "done" && status !== "failed") throw new RangeError(`a service closes as done or failed, not ${status}`);
    return { ok: true, patch: { status, result } };
}

/** Cancel an open service. */
export function cancelService(service) {
    if (service.status !== "open") return refuse("state", { status: service.status });
    return { ok: true, patch: { status: "cancelled" } };
}

/**
 * Who may do what with a service (4.2.4's rule for orders): offer, any member with a character while it has no
 * performer; perform, the performer's owners; cancel, the requester's or the performer's owners, or a GM.
 * @param {{isGM: boolean, owns: (uuid: string|null) => boolean, hasCharacter: boolean}} viewer
 */
export function serviceActions(service, viewer) {
    const open = service.status === "open";
    const performer = !!service.performer && viewer.owns(service.performer);
    return {
        offer: open && !service.performer && viewer.hasCharacter,
        perform: open && performer,
        cancel: open && (viewer.isGM || viewer.owns(service.requester) || performer),
    };
}

/* -------------------------------------------- */
/*  Repair                                       */
/* -------------------------------------------- */

/**
 * Hit Points a Repair restores (Player Core p.236; 6.13): `base + perRank × rank` on a success or a critical success,
 * with the Crafter's Eyepiece's numbers when the repairer wears it (`eyepiece`: `{success, critSuccess}` per rank and
 * base). Repair is an untrained use of Crafting, so an untrained repairer (rank 0) restores the base (5, 10 on a
 * critical success), as pf2e's own repair action does. Nothing on a failure; a critical failure damages the item
 * instead (`repairDamage`).
 */
export function repairHp({ rank, degree, eyepiece = null }) {
    requireDegree(degree, "degree");
    requireInteger(rank, "rank");
    if (rank < RANK.untrained || rank > RANK.legendary) throw new RangeError(`a proficiency rank is 0 to 4, not ${rank}`);
    const table = eyepiece
        ? { success: { base: eyepiece.success, perRank: eyepiece.success }, critSuccess: { base: eyepiece.critSuccess, perRank: eyepiece.critSuccess } }
        : REPAIR_HP;
    if (degree === DEGREE.critSuccess) return table.critSuccess.base + table.critSuccess.perRank * rank;
    if (degree === DEGREE.success) return table.success.base + table.success.perRank * rank;
    return 0;
}

/** Damage a critical failure deals the item: the 2d6 rolled less its Hardness, never below 0 (Player Core p.236). */
export function repairDamage(rolled, hardness = 0) {
    return Math.max(0, requireInteger(rolled, "rolled") - Math.max(0, hardness ?? 0));
}

/**
 * The item's Hit Points after a Repair, or a refusal: a destroyed item (0 HP) cannot be repaired; one at full HP has
 * nothing to repair. `restored` and `damage` are what changed.
 *
 * @param {{value: number, max: number}} hp
 * @param {number} degree
 * @param {{rank: number, eyepiece?: object|null, rolled?: number, hardness?: number}} p
 */
export function repairResult(hp, degree, { rank, eyepiece = null, rolled = 0, hardness = 0 }) {
    if (!(hp?.max > 0)) return refuse("no-hp");
    if (hp.value <= 0) return refuse("destroyed");
    if (hp.value >= hp.max) return refuse("undamaged");
    if (degree === DEGREE.critFail) {
        const damage = repairDamage(rolled, hardness);
        return { ok: true, hp: Math.max(0, hp.value - damage), restored: 0, damage };
    }
    const restored = Math.min(hp.max - hp.value, repairHp({ rank, degree, eyepiece }));
    return { ok: true, hp: hp.value + restored, restored, damage: 0 };
}

/* -------------------------------------------- */
/*  Affixing talismans                           */
/* -------------------------------------------- */

/**
 * Words of a talisman's usage that name a kind of host item, and the item type each means: `affixed-to-armor-or-a-weapon`
 * names armor and weapons, `affixed-to-a-shield-or-weapon` shields and weapons, `affixed-to-firearm` and
 * `affixed-to-a-magical-staff` weapons (pf2e's staves are weapons), `affixed-to-armor-or-travelers-clothing` armor,
 * `affixed-to-headgear` worn equipment. Narrower qualifiers (metal, melee, ranged, two-handed, a staff's trait) are not
 * read (DESIGN.md 10.11 Follow-ups).
 */
const HOST_WORDS = Object.freeze([
    ["armor", "armor"], ["clothing", "armor"], ["unarmored", "armor"], ["shield", "shield"], ["weapon", "weapon"], ["firearm", "weapon"],
    ["crossbow", "weapon"], ["staff", "weapon"], ["headgear", "equipment"],
]);

/**
 * The item types a talisman's usage names as its host (`affixed-to-armor-or-a-weapon`: armor and weapons), or null when it
 * names none (any armor, shield or weapon).
 */
export function affixHostKinds(usage = "") {
    if (!usage.startsWith("affixed-to")) return null;
    const words = new Set(usage.split("-"));
    const kinds = [...new Set(HOST_WORDS.filter(([word]) => words.has(word)).map(([, kind]) => kind))];
    return kinds.length ? kinds : null;
}

/**
 * Why a talisman or spellhearts cannot be affixed to a host, or null (7.4, GM Core): it must be a talisman or a
 * spellheart; the host must be an item of a type its usage names (`affixHostKinds`), any armor, shield or weapon when it
 * names none (bombs are left out while `talismanHostsExcludeBombs` is on: they are consumed); the host holds one
 * talisman or spellheart, two with Talismanic Sage; both on the same actor.
 *
 * @param {object} p
 * @param {{traits: string[], usage?: string, actor: string}} p.talisman
 * @param {{type: string, traits: string[], actor: string}} p.host
 * @param {number} p.onHost         talismans and spellhearts already affixed to the host
 * @param {boolean} [p.talismanicSage]
 * @param {boolean} [p.excludeBombs]
 */
export function affixProblem({ talisman, host, onHost = 0, talismanicSage = false, excludeBombs = true }) {
    const traits = talisman.traits ?? [];
    if (!traits.includes("talisman") && !traits.includes("spellheart")) return { reason: "not-talisman" };
    if (talisman.actor !== host.actor) return { reason: "not-together" };
    const kinds = affixHostKinds(talisman.usage);
    if (![...new Set(["armor", "shield", "weapon", ...(kinds ?? [])])].includes(host.type)) return { reason: "not-host" };
    if (excludeBombs && (host.traits ?? []).includes("bomb")) return { reason: "not-host" };
    if (kinds && !kinds.includes(host.type)) return { reason: "wrong-host", data: { kinds } };
    if (onHost >= TALISMANS_PER_HOST * (talismanicSage ? 2 : 1)) return { reason: "host-taken" };
    return null;
}
