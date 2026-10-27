/**
 * Treasure Vault (Remastered) crafting variants on this client (DESIGN.md 6.16, M9a): the one-group notice in Settings,
 * Complex Crafting's rush choices, sub-day setups and rushed finishing, crafting downtime events, Critical Crafting and
 * bestowed gifts, and the catch-up of what the variants derive (events, Grow's season checks, quests that have every
 * component, gardens whose seed cost is funded). Deconstruct is in `deconstruct.mjs`, Grow and gardens in `nature.mjs`,
 * quests in `quests.mjs`; the pure parts are `scripts/logic/variants.mjs`.
 *
 * Every variant is a world setting that is off by default (14.4). While one is off its functions refuse as `off` and its
 * hooks and sweep steps return at once, so it writes nothing and shows nothing.
 *
 * Who writes what (4.2.4, P2): the crafter's owner chooses the rush, records a sub-day setup, rolls the rushed finish's
 * flat check (with the finish) and records a Critical Crafting result; the requester or the crafter marks an order
 * special before it starts; any member resolves an event; a GM may reveal a secret check; an item's holder records a gift
 * and names its heir. Events are rolled by the crafter's responsible client (5.6), once per key (`event:<orderId>:<attempt>:
 * <k>`) behind its lock page, so a day resolved twice rolls nothing new.
 */
import { MODULE_ID } from "../constants.mjs";
import { DEGREE, RANK } from "../logic/core.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { closedAs } from "../logic/orders.mjs";
import { setupDaysDone } from "../logic/progress.mjs";
import {
    anyVariantOn, canRushFinish, curseEffectData, eventKey, eventRecord, eventResult, eventSlot, eventsDue, eventsOf, flatCheckDegree, giftDormant, giftRecord,
    mixedGroups, rushFinishOutcome, rushedFinishDC, setupHoursRecord, variantGroupsOn, workedDays,
} from "../logic/variants.mjs";
import { VARIANT_UUIDS } from "../data/variants.mjs";
import { today } from "./downtime.mjs";
import { lockedWrite } from "./money.mjs";
import { isElected, isResponsibleFor } from "./responsible.mjs";
import { members } from "./roster.mjs";
import { rulesFromSettings, setting } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const owns = (uuid) => actorOf(uuid)?.isOwner === true;

/** The variant switches now (14.4). */
export const variantsNow = () => rulesFromSettings().variants;
/** Whether one variant is on. */
export const variantOn = (key) => variantsNow()[key] === true;

/** The order, or a refusal: none, closed by its log, or its variant off. */
function orderFor(id, variant = null) {
    if (!canWrite()) return { refusal: refuse("not-ready") };
    if (variant && !variantOn(variant)) return { refusal: refuse("variant-off") };
    const order = read(`orders.${id}`);
    if (!order) return { refusal: refuse("no-order") };
    const closed = closedAs(order);
    return closed ? { refusal: refuse("state", { status: closed }) } : { order };
}

/** The crafter's rank in the order's skill, from the actor. */
function crafterRank(order) {
    const crafter = actorOf(order.crafter);
    return crafter?.skills?.[order.skill ?? "crafting"]?.rank ?? RANK.untrained;
}

/** Who a variant card goes to: GMs and the owners of the actors named, or everyone (`chat.visibility`). */
export function whisperTo(uuids) {
    if (setting("chat.visibility") === "public") return [];
    const users = new Set(game.users.filter((u) => u.isGM).map((u) => u.id));
    for (const uuid of uuids.filter(Boolean)) {
        const actor = actorOf(uuid);
        for (const user of game.users) if (actor && !user.isGM && actor.testUserPermission(user, "OWNER")) users.add(user.id);
    }
    users.add(game.user.id);
    return [...users];
}

/** Roll a die and post it as an ordinary roll card (the event's d20, the rushed finish's flat check). */
async function rollDie(faces, { flavor, whisper, actor = null, flags = {} }) {
    const roll = await new Roll(`1d${faces}`).evaluate();
    if (typeof roll.toMessage === "function") {
        await roll.toMessage({ flavor, whisper, speaker: ChatMessage.implementation.getSpeaker(actor ? { actor } : {}), flags: { [MODULE_ID]: flags } })
            .catch((error) => console.warn(`${MODULE_ID} | could not post a roll`, error));
    }
    return roll.total;
}

/* -------------------------------------------- */
/*  Settings: one group at a time                */
/* -------------------------------------------- */

/** The groups' names in the notice. */
const GROUP = Object.freeze({
    alternate: "pf2e-artisans-workshop.Settings.Variants.Group.Alternate",
    nature: "pf2e-artisans-workshop.Settings.Variants.Group.Nature",
    story: "pf2e-artisans-workshop.Settings.Variants.Group.Story",
});

/**
 * The notice Settings shows when variants of more than one group are on (6.16, TV-R p.157): the book advises one
 * subsection at a time; nothing is blocked. Null when it does not apply.
 */
export function groupNotice(rules = rulesFromSettings()) {
    if (!mixedGroups(rules)) return null;
    const groups = variantGroupsOn(rules).map((g) => game.i18n.localize(GROUP[g])).join(", ");
    return game.i18n.format("pf2e-artisans-workshop.Settings.Variants.Notice", { groups });
}

/** `renderSettingsConfig`: the notice at the top of this module's section, for whoever sees the variants (a GM). */
export function onRenderSettings(_app, element) {
    const root = typeof element?.querySelector === "function" ? element : element?.[0];
    const section = root?.querySelector?.(`[data-category="${MODULE_ID}"]`);
    if (!section) return;
    section.querySelector(".pf2e-artisans-workshop-variant-notice")?.remove();
    const text = groupNotice();
    if (!text) return;
    const note = root.ownerDocument.createElement("p");
    note.className = "notification warning pf2e-artisans-workshop-variant-notice";
    note.textContent = text;
    section.prepend(note);
}

/* -------------------------------------------- */
/*  Complex Crafting (6.16.1)                    */
/* -------------------------------------------- */

/**
 * The rush the crafter chooses on the start form (6.16.1): days taken off the setup for +5 DC each, frozen at start.
 * Refused: `variant-off`, `state` (only before the start), `not-owner`, `rush` (not a whole number from 0 to 3).
 */
export async function chooseRush(orderId, rush) {
    const { order, refusal } = orderFor(orderId, "complexCrafting");
    if (refusal) return refusal;
    if (order.status !== "accepted" && order.status !== "requested") return refuse("state", { status: order.status });
    if (!order.crafter || !owns(order.crafter)) return refuse("not-owner");
    if (!Number.isInteger(rush) || rush < 0 || rush > 3) return refuse("rush");
    await write({ set: { [`orders.${orderId}.variant.rushRequest`]: rush } });
    return { ok: true, rush };
}

/**
 * Rush the finishing, or stop (6.16.1): while on, each extra day the crafter works is a rushed day (twice the reduction, and
 * a flat check when the item is finished). The crafter's choice, kept on the order, so whoever resolves the day writes
 * what the crafter chose; the day record keeps it (`rushed`), so a run can mix rushed and normal days. Refused: `variant-off`,
 * `not-owner`, `state` (not started, or closed), `rank` (below expert).
 */
export async function setRushFinish(orderId, on) {
    const { order, refusal } = orderFor(orderId, "complexCrafting");
    if (refusal) return refusal;
    if (!owns(order.crafter)) return refuse("not-owner");
    if (!["setup", "check", "rolled", "finishing", "paused"].includes(order.status)) return refuse("state", { status: order.status });
    if (on && !canRushFinish(crafterRank(order), rulesFromSettings())) return refuse("rank");
    await write({ set: { [`orders.${orderId}.variant.rushFinish`]: on === true } });
    return { ok: true, on: on === true };
}

/**
 * "Set up now" (6.16.1): a setup rushed below one day takes hours, not a downtime day. The crafter's owner records it as a
 * `setup-hours` variant record for today, keyed `days.<actorId>-<day>-<orderId>` so it never overwrites the crafter's
 * own day record (an adventuring day, or a day spent on another activity), stamped with world time; it completes the setup
 * and the order moves to `check` in the same write. The module never moves the clock. Behind a lock per attempt, so it
 * is recorded once. Refused: `variant-off`, `not-owner`, `state`, `no-hours` (the setup takes days), `setup-days` (setup days are
 * still owed first).
 */
export async function setUpNow(orderId) {
    const { order, refusal } = orderFor(orderId, "complexCrafting");
    if (refusal) return refusal;
    const crafter = actorOf(order.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    if (order.status !== "setup") return refuse("state", { status: order.status });
    if (!((order.setup?.hours ?? 0) > 0)) return refuse("no-hours");
    const days = records("days").filter((d) => d.order === orderId);
    if (setupDaysDone(order, days) < order.setup.days) return refuse("setup-days");
    const day = today().day;
    const record = setupHoursRecord({ actorId: crafter.id, day, order, hours: order.setup.hours, worldTime: game.time.worldTime ?? 0 }, stampNow());
    const written = await lockedWrite([hashId(idemKey("setup-hours", orderId, order.attempt))], [],
        { set: { [`orders.${orderId}.status`]: "check" }, replace: { [`days.${record.id}`]: record } });
    return written.ok ? { ok: true, day, hours: order.setup.hours } : written;
}

/** The crafter's Crafting proficiency bonus (pf2e's `proficiency` modifier of the skill's statistic), or null. */
export function proficiencyBonus(actor, skill = "crafting") {
    const modifiers = actor?.skills?.[skill]?.modifiers ?? [];
    const found = modifiers.find?.((m) => m.slug === "proficiency");
    return Number.isInteger(found?.modifier) ? found.modifier : null;
}

/**
 * The rushed finish's flat check (6.16.1), rolled when an order with a rushed day in its current attempt is finished, and
 * kept on the check (`check.rushFlat = {attempt, dc, die, degree, outcome}`) so a finish refused afterwards (short of
 * money) never rolls it again. Returns the record, or a refusal.
 */
export async function rushFlatCheck(order) {
    const kept = order.check?.rushFlat;
    if (kept && kept.attempt === order.attempt) return { ok: true, flat: kept };
    const crafter = actorOf(order.crafter);
    const proficiency = proficiencyBonus(crafter, order.skill ?? "crafting");
    if (!crafter || proficiency === null) return refuse("no-skill", { skill: order.skill ?? "crafting" });
    const pwol = game.pf2e?.settings?.variants?.pwol?.enabled === true;
    const dc = rushedFinishDC({ itemLevel: order.dc?.level ?? order.product?.snapshot?.level ?? 0, proficiency, pwol });
    const item = order.product?.snapshot?.name ?? "";
    const die = dc <= 1 ? null : await rollDie(20, { flavor: game.i18n.format("pf2e-artisans-workshop.Variant.Rush.Flavor", { item, dc: String(dc) }),
        whisper: whisperTo([order.crafter, order.requester, order.recipient?.uuid]), actor: crafter, flags: { rushFlat: { order: order.id } } });
    const degree = die === null ? DEGREE.success : flatCheckDegree(die, dc);
    const flat = { attempt: order.attempt, dc, die, degree, outcome: rushFinishOutcome(degree, rulesFromSettings()), ...stampNow() };
    await write({ replace: { [`orders.${order.id}.check.rushFlat`]: flat } });
    return { ok: true, flat };
}

/* -------------------------------------------- */
/*  Crafting downtime events (6.16.3)            */
/* -------------------------------------------- */

/** States in which an order's crafting days count toward its events. */
const WORKING = Object.freeze(["setup", "check", "rolled", "finishing", "paused"]);

/** A world RollTable named by `variants.events.table`, or null. */
function eventTable() {
    const uuid = variantsNow().eventsTable;
    if (!uuid) return null;
    const table = fromUuidSync(uuid, { strict: false });
    return table?.documentName === "RollTable" && typeof table.draw === "function" ? table : null;
}

/**
 * Roll an order's next event (6.16.3), or its `k`th: a d20 on Table 5-2 posted as an ordinary roll card (1-3 point to the
 * GM Core's events through the GM Screen's "Downtime Events" page, 4-20 name the table's row), or a draw from the world
 * table the GM built, whispered to the GMs and the crafter's side. Recorded at `orders.<id>.events.<attempt>-<k>` behind
 * the lock page of `event:<orderId>:<attempt>:<k>`, and the card posted only once the record landed. The crafter's owner
 * ("Roll event") or the crafter's responsible client (when a day makes one due). Refused: `variant-off`, `not-owner`, `state`,
 * `taken` (another client rolled it first).
 */
export async function rollEvent(orderId, { k = null, auto = false } = {}) {
    const { order, refusal } = orderFor(orderId, "events");
    if (refusal) return refusal;
    const crafter = actorOf(order.crafter);
    if (!crafter || (!auto && !crafter.isOwner)) return refuse("not-owner");
    if (!WORKING.includes(order.status)) return refuse("state", { status: order.status });
    const n = k ?? eventsOf(order).length + 1;
    if (eventsOf(order).some((e) => e.k === n)) return { ok: true, outcome: "already", k: n };
    const table = eventTable();
    let roll;
    let tableResult = null;
    let drawn = null;
    if (table) {
        drawn = await table.draw({ displayChat: false });
        roll = drawn?.roll ?? null;
        tableResult = drawn?.results?.map((r) => r.name ?? r.description ?? r.text ?? "").filter(Boolean).join(", ") || null;
    } else {
        roll = await new Roll("1d20").evaluate();
    }
    const day = today().day;
    const record = eventRecord({ order, k: n, day, roll: roll?.total ?? 0, tableResult }, stampNow());
    const written = await lockedWrite([hashId(eventKey(orderId, order.attempt, n))], [], { replace: { [`orders.${orderId}.events.${eventSlot(order.attempt, n)}`]: record } });
    if (!written.ok) return written;
    await postEvent(order, record, crafter, { table, drawn, roll });
    return { ok: true, outcome: "ok", k: n, roll: record.roll, tableResult };
}

/**
 * Post an event's card once its record landed: the table's own draw card, or the d20 as an ordinary roll card saying what
 * it points to (the GM Core's downtime events for 1-3, Table 5-2's row otherwise). Never throws: the ledger holds it.
 */
async function postEvent(order, record, crafter, { table, drawn, roll }) {
    const whisper = whisperTo([order.crafter]);
    const speaker = ChatMessage.implementation.getSpeaker({ actor: crafter });
    const item = order.product?.snapshot?.name ?? "";
    try {
        if (table && drawn) {
            await table.toMessage(drawn.results, { roll: drawn.roll, messageData: { whisper, speaker } });
            return;
        }
        const result = eventResult(record.roll);
        const flavor = result.gmCore
            ? game.i18n.format("pf2e-artisans-workshop.Variant.Event.GmCore", { item })
            : game.i18n.format("pf2e-artisans-workshop.Variant.Event.Row", { item, row: String(result.row) });
        if (typeof roll?.toMessage === "function") {
            await roll.toMessage({ flavor, whisper, speaker, flags: { [MODULE_ID]: { card: { kind: "event", order: order.id } } } });
        }
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post an event card`, error);
    }
}

/** The GM Core's downtime events the d20's 1-3 point to: the GM Screen journal's page (6.16.3), for a content link. */
export const DOWNTIME_EVENTS_UUID = VARIANT_UUIDS.downtimeEvents;

/**
 * Mark an event resolved (6.16.3), with an optional note: any member, since events are narrative and nothing waits on a
 * GM. With `variants.events.pauses`, this lets the order's days go on. Refused: `variant-off`, `no-event`, `not-member`.
 */
export async function resolveEvent(orderId, slot, { note = "" } = {}) {
    const { order, refusal } = orderFor(orderId, "events");
    if (refusal) return refusal;
    const event = order.events?.[slot];
    if (!event) return refuse("no-event");
    if (!game.user.isGM && !members().some((a) => a.isOwner)) return refuse("not-member");
    const base = `orders.${orderId}.events.${slot}`;
    await write({ set: { [`${base}.status`]: "resolved", [`${base}.note`]: String(note ?? ""), [`${base}.resolved`]: stampNow() } });
    return { ok: true };
}

/**
 * The events due now (6.16.3), rolled on the crafter's responsible client for every working order whose attempt has had
 * enough downtime days. Returns how many were rolled. Nothing while the variant is off.
 */
export async function eventSweep() {
    if (!canWrite() || !variantOn("events")) return 0;
    const rules = rulesFromSettings();
    const days = records("days");
    let rolled = 0;
    for (const order of records("orders")) {
        if (!WORKING.includes(order.status) || closedAs(order)) continue;
        const crafter = actorOf(order.crafter);
        if (!crafter || !isResponsibleFor(crafter)) continue;
        const due = eventsDue(workedDays(order, days.filter((d) => d.order === order.id)), rules);
        for (let k = eventsOf(order).length + 1; k <= due; k++) {
            const result = await rollEvent(order.id, { k, auto: true });
            if (result.ok && result.outcome === "ok") rolled += 1;
            else break;
        }
    }
    return rolled;
}

/* -------------------------------------------- */
/*  Critical Crafting (6.16.4)                   */
/* -------------------------------------------- */

/**
 * Mark an order as a special item, or not (6.16.4): the requester or the crafter, before the start. With
 * `criticalSpecialOnly`, only special orders get Critical Crafting (and secret rolls). Refused: `variant-off`, `state`, `not-owner`.
 */
export async function setSpecial(orderId, on) {
    const { order, refusal } = orderFor(orderId, "criticalCrafting");
    if (refusal) return refusal;
    if (!["requested", "accepted"].includes(order.status)) return refuse("state", { status: order.status });
    if (!(game.user.isGM || owns(order.requester) || (order.crafter && owns(order.crafter)))) return refuse("not-owner");
    await write({ set: { [`orders.${orderId}.variant.special`]: on === true } });
    return { ok: true, on: on === true };
}

/**
 * Record a Critical Crafting result (6.16.4): its category (from the author's list) and a note, on the critical the
 * settlement stamped. The crafter's owner, or a GM. Refused: `variant-off`, `no-critical`, `not-owner`.
 */
export async function recordCritical(orderId, { category = null, note = "" } = {}) {
    const { order, refusal } = orderFor(orderId, "criticalCrafting");
    if (refusal && refusal.reason !== "state") return refusal;
    const current = order ?? read(`orders.${orderId}`);
    const critical = current?.check?.critical;
    if (!critical) return refuse("no-critical");
    if (!(game.user.isGM || owns(current.crafter))) return refuse("not-owner");
    const stamp = stampNow();
    await write({ set: { [`orders.${orderId}.check.critical.category`]: category, [`orders.${orderId}.check.critical.note`]: String(note ?? ""),
        [`orders.${orderId}.check.critical.by`]: stamp.by, [`orders.${orderId}.check.critical.at`]: stamp.at } });
    return { ok: true };
}

/** The crafter's curse effects on an actor (6.16.4). */
export const curseEffects = (actor) => (actor?.items ?? []).filter((i) => i.type === "effect" && i.flags?.[MODULE_ID]?.curse);

/**
 * Curse the crafter (6.16.4's one automated example): an effect on the crafter with a status penalty to Crafting checks of
 * `size` (1 by default), which the roll wrapper removes at the crafter's next critical success at a Craft check, and anyone
 * who owns the crafter can remove after a 4th-rank cleanse affliction. The crafter's owner, on a critical failure. Refused:
 * `off`, `no-critical`, `not-owner`, `cursed` (one already).
 */
export async function curseCrafter(orderId, size = 1) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("criticalCrafting")) return refuse("variant-off");
    const order = read(`orders.${orderId}`);
    if (order?.check?.critical?.kind !== "failure") return refuse("no-critical");
    const crafter = actorOf(order.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    if (curseEffects(crafter).length) return refuse("cursed");
    const data = curseEffectData({ name: game.i18n.localize("pf2e-artisans-workshop.Variant.Critical.CurseName"), size, order: orderId,
        img: "icons/svg/skull.svg" });
    await crafter.createEmbeddedDocuments("Item", [data]);
    await write({ set: { [`orders.${orderId}.check.critical.curse`]: { size: data.flags[MODULE_ID].curse.size, ...stampNow() } } });
    return { ok: true };
}

/**
 * A critical success at a Craft check lifts the crafter's curse (6.16.4): the roll wrapper's recorder calls this on the
 * rolling user's client, which owns the crafter. Nothing while Critical Crafting is off.
 */
export async function liftCurse(actor) {
    if (!actor?.isOwner || !variantOn("criticalCrafting")) return 0;
    const ids = curseEffects(actor).map((i) => i.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
    return ids.length;
}

/** Reveal a secret check to the players before it settles (6.16.4): a GM. Refused: `variant-off`, `not-gm`, `no-check`. */
export async function revealCheck(orderId) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("criticalCrafting")) return refuse("variant-off");
    if (!game.user.isGM) return refuse("not-gm");
    if (!read(`orders.${orderId}.check`)) return refuse("no-check");
    await write({ set: { [`orders.${orderId}.check.revealed`]: true } });
    return { ok: true };
}

/**
 * A note on what a variant did to the item (6.16.1, 6.16.4, 6.16.9): the quirk a rushed finish or an assembly left, the
 * curse, a critical's story effect; the crafter's card asks for it. The crafter's owner, or a GM. Refused: `no-order`,
 * `not-owner`.
 */
export async function recordNote(orderId, text) {
    if (!canWrite()) return refuse("not-ready");
    const order = read(`orders.${orderId}`);
    if (!order) return refuse("no-order");
    if (!(game.user.isGM || owns(order.crafter))) return refuse("not-owner");
    await write({ replace: { [`orders.${orderId}.variantNote`]: { text: String(text ?? ""), ...stampNow() } } });
    return { ok: true };
}

/* -------------------------------------------- */
/*  Bestowed gifts (6.16.8)                      */
/* -------------------------------------------- */

/** An item's gift binding (`flags.MOD.gift`), or null. */
export const giftOf = (item) => item?.flags?.[MODULE_ID]?.gift ?? null;

/** Whether an item is a dormant gift where it is now (TV-R p.166): bound to someone else, and no heir holds it. */
export function isDormantGift(item) {
    const gift = giftOf(item);
    return !!gift && variantOn("gifts") && giftDormant(gift, item.parent?.uuid ?? null);
}

/**
 * Record an item as a bestowed gift (6.16.8): bound to its holder, with the giver's name (free text). The holder's owner.
 * Refused: `variant-off`, `no-item`, `not-owner`, `gifted` (already a gift).
 */
export async function bestow(itemUuid, { giver = "" } = {}) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("gifts")) return refuse("variant-off");
    const item = fromUuidSync(itemUuid, { strict: false });
    const holder = item?.parent;
    if (!item?.isOfType?.("physical") || !holder) return refuse("no-item");
    if (!holder.isOwner) return refuse("not-owner");
    if (giftOf(item)) return refuse("gifted");
    await item.update({ [`flags.${MODULE_ID}.gift`]: giftRecord({ bound: holder.uuid, giver }, stampNow()) });
    return { ok: true };
}

/**
 * Name an heir (6.16.8): a true inheritance is the current holder's act, and only a holder for whom the gift works (its
 * bound recipient or an heir) can pass it on. Refused: `variant-off`, `no-item`, `not-owner`, `dormant`.
 */
export async function nameHeir(itemUuid, heirUuid) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("gifts")) return refuse("variant-off");
    const item = fromUuidSync(itemUuid, { strict: false });
    const gift = giftOf(item);
    if (!gift || !item.parent) return refuse("no-item");
    if (!item.parent.isOwner) return refuse("not-owner");
    if (giftDormant(gift, item.parent.uuid)) return refuse("dormant");
    if (!actorOf(heirUuid)) return refuse("no-actor");
    const heirs = [...new Set([...(gift.heirs ?? []), heirUuid])];
    await item.update({ [`flags.${MODULE_ID}.gift.heirs`]: heirs });
    return { ok: true, heirs };
}

/** Every gift the party's members hold (6.16.8, the Funds tab), with its Price: `{item, holder, gift, dormant, priceCp}`. */
export function partyGifts() {
    const out = [];
    for (const actor of members()) {
        for (const item of actor.items ?? []) {
            const gift = giftOf(item);
            if (!gift) continue;
            const priceCp = Math.round((item.price?.value?.copperValue ?? 0) / Math.max(1, item.price?.per ?? 1)) * (item.quantity ?? 1);
            out.push({ item, holder: actor, gift, dormant: giftDormant(gift, actor.uuid), priceCp });
        }
    }
    return out;
}

/* -------------------------------------------- */
/*  The catch-up                                 */
/* -------------------------------------------- */

/** The sweeps of the other variant modules, registered by them (no import cycle). */
const SWEEPS = new Map();

/** Register a variant's sweep step (`nature.mjs`, `quests.mjs`). */
export function registerVariantSweep(name, fn) {
    SWEEPS.set(name, fn);
}

/**
 * The variants' catch-up (P5, a sweep step): events due, then each registered step (Grow's season prompts, quests with every
 * component found, funded gardens). Each step returns at once while its variant is off.
 */
export async function variantSweep() {
    if (!canWrite()) return {};
    const out = { events: await eventSweep() };
    for (const [name, fn] of SWEEPS) {
        try {
            out[name] = await fn();
        } catch (error) {
            console.error(`${MODULE_ID} | variant sweep "${name}" failed`, error);
        }
    }
    return out;
}

let sweepTimer = null;
/** Run the variants' catch-up once changes settle. */
function scheduleVariantSweep(ms = 800) {
    if (!anyVariantOn(rulesFromSettings())) return;
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => {
        variantSweep().catch((error) => console.error(`${MODULE_ID} | variant sweep failed`, error));
    }, ms);
}

/**
 * The variant hooks, at `init`: Settings' notice; and a ledger change touching orders, day records or rows runs the
 * variants' catch-up (each step guarded by its variant and the responsible client), so a day that makes an event due, a
 * last component marked found or a garden's last coin rolls, moves or plants once, on one client.
 */
export function registerVariantHooks() {
    Hooks.on("renderSettingsConfig", (app, element) => {
        try {
            onRenderSettings(app, element);
        } catch (error) {
            console.warn(`${MODULE_ID} | could not show the variants notice`, error);
        }
    });
    Hooks.on("updateJournalEntry", (doc, changed) => {
        if (doc !== shared().ledger) return;
        const flags = changed.flags?.[MODULE_ID] ?? {};
        if ("orders" in flags || "days" in flags || "rows" in flags || "gardens" in flags) scheduleVariantSweep();
    });
    Hooks.on("updateWorldTime", () => scheduleVariantSweep(1500));
}

/** Whether this client runs the shared parts of the catch-up (gardens): the elected one (5.6). */
export const electedForVariants = () => isElected();

/** For tests only. */
export function resetVariants() {
    clearTimeout(sweepTimer);
    sweepTimer = null;
}
