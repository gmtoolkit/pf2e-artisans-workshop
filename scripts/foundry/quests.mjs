/**
 * Story-based crafting: crafting quests (DESIGN.md 6.16.9, Treasure Vault (Remastered) pp.170-175, M9a) on this client. A
 * quest order is earned, not paid for: its components are found through encounters (low to severe threat), any member marks
 * one found, and once every one is, the quest is assembled: with no check for a quest of at least three encounters in
 * different locations, otherwise with the chosen skill against the item's level DC with its rarity, whose degree decides
 * what is delivered. No money moves; the item's equivalent cost against party treasure is shown in the Queue.
 *
 * Who writes what (4.2.3, 4.2.4): the crafter's owner configures the quest before the start and starts it (`gathering`);
 * any member marks a component found, writing only that component's `found`; leaving `gathering` is derived: the
 * crafter's responsible client moves the order on when it sees the last mark (status only to `check`, or the delivery in a
 * lock-first batch keyed `deliver:<orderId>:<attempt>`), so two members marking the last two components at once leave it
 * once. The assembly check settles through the quest row of 4.2.3 and posts no money rows.
 */
import { MODULE_ID } from "../constants.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { closedAs, lastEntry, settlementRecord, transitionChange } from "../logic/orders.mjs";
import { allFound, assemblyOutcome, makeQuest, questUnderway } from "../logic/variants.mjs";
import { QUEST_THREATS } from "../data/variants.mjs";
import { lockedWrite, moveCoins } from "./money.mjs";
import { finishOutputs } from "./outputs.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { members } from "./roster.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite } from "./state.mjs";
import { read, records, stampNow, write } from "./store.mjs";
import { today } from "./downtime.mjs";
import { registerVariantSweep, variantOn } from "./variants.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const owns = (uuid) => actorOf(uuid)?.isOwner === true;

/** Whether an order is a quest under way (`questUnderway`) that its log does not say is closed. */
export const questGoing = (order) => questUnderway(order) && !closedAs(order);

/**
 * A quest order, or a refusal (`variant-off`, `no-order`, `state` for a closed one). With `going`, a quest that has started
 * keeps going once the variant is off: its components are still marked and it is still moved on, since nothing else could
 * finish it (review fix of M9a); a new quest and its configuration need the variant on.
 */
function questFor(id, { going = false } = {}) {
    if (!canWrite()) return { refusal: refuse("not-ready") };
    const order = read(`orders.${id}`);
    if (!variantOn("quests") && !(going && questGoing(order))) return { refusal: refuse("variant-off") };
    if (!order || order.craftType !== "quest") return { refusal: refuse("no-order") };
    const closed = closedAs(order);
    return closed ? { refusal: refuse("state", { status: closed }) } : { order };
}

/**
 * Configure a quest before it starts (6.16.9): how many encounters, each one's threat (low, moderate or severe: TV-R p.172;
 * the form offers only those) and label, whether they are in different locations, whether an assembly check is needed (by
 * default not for three or more in different locations) and its skill. The crafter's owner, or the requester's while no one
 * has taken it. Refused: `variant-off`, `state`, `not-owner`, `encounters`.
 */
export async function configureQuest(orderId, { encounters, threats = [], labels = [], differentLocations = true, assemblyCheck = null, assemblySkill = "crafting" } = {}) {
    const { order, refusal } = questFor(orderId);
    if (refusal) return refusal;
    if (!["requested", "accepted"].includes(order.status)) return refuse("state", { status: order.status });
    const may = order.crafter ? owns(order.crafter) : owns(order.requester);
    if (!(may || game.user.isGM)) return refuse("not-owner");
    if (!Number.isInteger(encounters) || encounters < 1 || encounters > 20) return refuse("encounters");
    const quest = makeQuest({ encounters, threats: threats.map((t) => (QUEST_THREATS.includes(t) ? t : "moderate")), labels, differentLocations, assemblyCheck,
        assemblySkill: typeof assemblySkill === "string" && assemblySkill ? assemblySkill : "crafting" });
    await write({ replace: { [`orders.${orderId}.variant.quest`]: quest } });
    return { ok: true, quest };
}

/**
 * Change one component before the start (6.16.9): its threat (low, moderate or severe) and its label. Who may configure the
 * quest. Refused: `variant-off`, `state`, `not-owner`, `no-component`.
 */
export async function setComponent(orderId, componentId, { threat = null, label = null } = {}) {
    const { order, refusal } = questFor(orderId);
    if (refusal) return refusal;
    if (!["requested", "accepted"].includes(order.status)) return refuse("state", { status: order.status });
    const may = order.crafter ? owns(order.crafter) : owns(order.requester);
    if (!(may || game.user.isGM)) return refuse("not-owner");
    if (!order.variant?.quest?.components?.[componentId]) return refuse("no-component");
    const base = `orders.${orderId}.variant.quest.components.${componentId}`;
    const set = {};
    if (QUEST_THREATS.includes(threat)) set[`${base}.threat`] = threat;
    if (typeof label === "string") set[`${base}.label`] = label;
    if (Object.keys(set).length) await write({ set });
    return { ok: true };
}

/**
 * Mark a quest's component found (6.16.9): any member, writing only that component's `found = {by, actor, day}`; the mark
 * names its author (5.10). Refused: `variant-off`, `state` (not gathering), `no-component`, `found` (already), `not-member`.
 */
export async function markFound(orderId, componentId, { actor = null } = {}) {
    const { order, refusal } = questFor(orderId, { going: true });
    if (refusal) return refusal;
    if (order.status !== "gathering") return refuse("state", { status: order.status });
    const component = order.variant?.quest?.components?.[componentId];
    if (!component) return refuse("no-component");
    if (component.found) return refuse("found");
    if (!game.user.isGM && !members().some((a) => a.isOwner)) return refuse("not-member");
    await write({ replace: { [`orders.${orderId}.variant.quest.components.${componentId}.found`]: { actor, day: today().day, ...stampNow() } } });
    return { ok: true };
}

/**
 * Take a mark back (a mistake): the user who made it, or a GM, while the quest is still gathering. Refused: `variant-off`, `state`,
 * `no-component`, `not-yours`.
 */
export async function unmarkFound(orderId, componentId) {
    const { order, refusal } = questFor(orderId, { going: true });
    if (refusal) return refusal;
    if (order.status !== "gathering") return refuse("state", { status: order.status });
    const found = order.variant?.quest?.components?.[componentId]?.found;
    if (!found) return refuse("no-component");
    if (!game.user.isGM && found.by !== game.user.id) return refuse("not-yours");
    await write({ set: { [`orders.${orderId}.variant.quest.components.${componentId}.found`]: null } });
    return { ok: true };
}

/**
 * Deliver a quest's item (6.16.9): what a finish makes (`finishOutputs`: the item on the pickup shelf for an actor
 * recipient, a gift binding when the order is bestowed), with a quirk or a curse note when the assembly said so, and the
 * order complete, in one lock-first move whose lock request takes the order's log slot and the page of
 * `deliver:<orderId>:<attempt>`, so writing it twice delivers once. No money rows.
 */
async function deliver(order, { event, patch = {}, flags = {} }) {
    const outputs = await finishOutputs(order, { flags });
    if (outputs.refuse) return refuse(outputs.refuse);
    const stamp = stampNow();
    const change = transitionChange(order, event, { ...patch, status: "complete" }, { rows: outputs.rows.map((row) => hashId(row.idem)) }, stamp);
    const result = await moveCoins(() => ({
        rows: outputs.rows, debits: outputs.debits, items: outputs.items, itemUpdates: outputs.itemUpdates,
        locks: [change.lock, hashId(idemKey("deliver", order.id, order.attempt)), ...outputs.locks],
        ledger: { set: { ...change.set, ...outputs.marks }, replace: change.replace },
    }), {}, outputs.rows.slice(0, 1));
    return result.ok || result.outcome === "already" ? { ok: true, outcome: result.outcome } : result;
}

/**
 * Move a quest on once every component is found (6.16.9, the derived transition of 4.2.3): to `check` when an assembly
 * check is needed (status only; writing it twice is harmless), otherwise delivered. The crafter's responsible client, or
 * the crafter's owner. Refused: `variant-off`, `state`, `missing` (a component is still to be found).
 */
export async function advanceQuest(orderId) {
    const { order, refusal } = questFor(orderId, { going: true });
    if (refusal) return refusal;
    if (order.status !== "gathering") return refuse("state", { status: order.status });
    if (!allFound(order.variant?.quest)) return refuse("missing");
    if (order.variant.quest.assemblyCheck) {
        await write({ set: { [`orders.${orderId}.status`]: "check" } });
        return { ok: true, status: "check" };
    }
    const result = await deliver(order, { event: "assemble" });
    return result.ok ? { ok: true, status: "complete" } : result;
}

/**
 * Settle a quest's assembly check (6.16.9, the `rolled (quest)` row of 4.2.3): no money rows. A success delivers the item; a
 * failure delivers it with a quirk note (`flags.MOD.quirk`); a critical failure fails the order (the item is destroyed) or
 * delivers it cursed (`flags.MOD.curse`), by `variants.questsCritFail`.
 */
export async function settleQuest(order) {
    if (!canWrite()) return refuse("not-ready");
    if (order.status !== "rolled" || !order.check) return refuse("state", { status: order.status });
    if (order.check.settled) return refuse("settled");
    if (!owns(order.crafter)) return refuse("not-owner");
    const outcome = assemblyOutcome(order.check.degree, rulesFromSettings());
    const stamp = stampNow();
    const check = { ...order.check, settled: true, outcome };
    const crafterName = actorOf(order.crafter)?.name ?? "";
    if (outcome === "destroyed") {
        const patch = { check, status: "failed" };
        patch.settlement = settlementRecord(order, patch, [], stamp);
        const change = transitionChange(order, "settle", patch, {}, stamp);
        const written = await lockedWrite([change.lock], [], { set: change.set, replace: change.replace });
        return written.ok ? { ok: true, status: "failed", outcome } : written;
    }
    const flags = outcome === "quirk" ? { quirk: { from: "quest-assembly", order: order.id, note: "" } }
        : outcome === "cursed" ? { curse: { from: "quest-assembly", order: order.id, crafter: crafterName, note: "" } } : {};
    const patch = { check };
    patch.settlement = settlementRecord(order, { check, status: "complete" }, [], stamp);
    const result = await deliver(order, { event: "assemble", patch, flags });
    return result.ok ? { ok: true, status: "complete", outcome } : result;
}

/**
 * Quests whose components are all found and that still say `gathering` (P5): moved on by the crafter's responsible
 * client. Returns how many moved. A quest that started while the variant was on is still moved on once it is off (review fix
 * of M9a); with no quest going, nothing is read or written.
 */
export async function questSweep() {
    if (!canWrite()) return 0;
    let moved = 0;
    for (const order of records("orders")) {
        if (order.craftType !== "quest" || order.status !== "gathering" || closedAs(order) || !allFound(order.variant?.quest)) continue;
        const crafter = actorOf(order.crafter);
        if (!crafter || !isResponsibleFor(crafter)) continue;
        const result = await advanceQuest(order.id);
        if (result.ok) moved += 1;
    }
    return moved;
}

/** The quest hooks, at `init`: the derived transition runs in the variants' catch-up, after every ledger change. */
export function registerQuestHooks() {
    registerVariantSweep("quests", () => questSweep());
}

/** The last transition of an order (for the window's history). */
export const lastQuestEntry = (order) => lastEntry(order);

/** Where a quest's item made its flags (the quirk or curse note), for tests. */
export const QUEST_FLAGS = Object.freeze(["quirk", "curse"].map((k) => `flags.${MODULE_ID}.${k}`));
