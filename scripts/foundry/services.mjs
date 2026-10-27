/**
 * Service orders on this client (DESIGN.md 4.5, 6.13, M5): a member asks for a Repair, a talisman affixed or taken off,
 * an Identify Alchemy, or a formula copied from an ally's book; any member with a character offers to perform it, and the
 * performer's owner performs it. Every step is a user's own action, so none has a responsible-client guard (5.6); each
 * writes only what that user may (4.2.4): the performer's owner closes the record and writes the performer's own items or
 * items handed over to the strongbox for the service; a formula copy becomes a formula claim the learner's client applies.
 *
 * Closing takes the lock page `service:<id>:close`, so a double click, or the same user on two devices, closes it once;
 * the item is written after the close. A rune transfer is an order (`craftType: "rune-transfer"`), not a service record.
 *
 * Repair rolls Crafting through the system's Statistic with `action:repair` and the item's traits as `target:trait:`
 * options (as pf2e's own Repair action does), against the item's level DC with no rarity adjustment (GM Core p.53), and
 * restores Hit Points by Player Core p.236 or the Crafter's Eyepiece (6.13); a critical failure deals 2d6 less Hardness.
 * The performer must carry a repair toolkit (Improvise Tool waives it for Repair, not for affixing); one in the strongbox
 * does not count (4.5).
 *
 * A formula copy's cost (`rules.allyCopyCostCp`, 0 by default) is paid when it is asked for, from the source the
 * requester picks (As built in M5 on M4.1, `payPurchase`): a purse, or the party fund. A cancel refunds it to that source
 * (the payment row reversed) when the user cancelling may move it back: anyone for the party fund, the purse's owner for
 * a purse; otherwise its payer reverses it in the Funds ledger.
 */
import { MODULE_ID } from "../constants.mjs";
import { REPAIR_CRIT_FAIL_DICE } from "../data/services.mjs";
import { liveRows } from "../logic/core.mjs";
import { levelDC } from "../logic/dc.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { repairEyepiece, tools } from "../logic/registry.mjs";
import { affixProblem, cancelService as cancelRecord, closeService, makeService, offerService, repairResult } from "../logic/services.mjs";
import { givingBack, heldLines } from "./custody.mjs";
import { bookOf, formulaClaimInput, applyIfResponsible, knownState } from "./formulas.mjs";
import { makeClaim } from "../logic/claims.mjs";
import { lockedWrite, moveCoins, reverseRows } from "./money.mjs";
import { payPurchase } from "./purchases.mjs";
import { heldKeysOf, ranksOf, toolKeysOf } from "./registry.mjs";
import { rulesFromSettings, setting } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { exists, newId, read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const owns = (uuid) => actorOf(uuid)?.isOwner === true;

/** The lock page that closes a service once. */
export const closeLockId = (id) => hashId(idemKey("service", id, "close"));

/** Every live service record. */
export const allServices = () => records("services");

/** The open service, or a refusal. */
function openService(id) {
    if (!canWrite()) return { refusal: refuse("not-ready") };
    const service = read(`services.${id}`);
    if (!service) return { refusal: refuse("no-service") };
    if (service.status !== "open") return { refusal: refuse("state", { status: service.status }) };
    return { service };
}

/** What a formula copy costs (`rules.allyCopyCostCp`), and 0 for every other service. */
export const serviceCostCp = (kind) => (kind === "formula-copy" ? rulesFromSettings().allyCopyCostCp : 0);

/**
 * Ask for a service (4.5). The requester is one of this user's characters; a named performer may be anyone's. A formula
 * copy names the formula (`uuid`) and its ally (`performer`), and costs `rules.allyCopyCostCp` (0 by default, the
 * author's decision), paid now as a `purchase` row when it is more: from `paidFrom` (As built in M5 on M4.1), `purse`
 * (`payer`'s, the requester's by default) or `fund`, the party fund. The record keeps the payment (`payment: {row,
 * source, cp}`) so a cancel can refund it. Repair and affix name the item (`target`); affix its host (`host`).
 */
export async function requestService({ kind, requester, performer = null, target = null, host = null, uuid = null, note = "",
    paidFrom = "purse", payer = null, nonce = newId() }) {
    if (!canWrite()) return refuse("not-ready");
    if (!owns(requester)) return refuse("not-owner");
    const already = kind === "formula-copy" ? knownState(actorOf(requester), uuid) : null;
    if (already) return refuse(already);
    let service;
    try {
        service = makeService({ id: newId(), kind, party: game.actors.party?.id ?? null, requester, performer, target, host, uuid, note }, stampNow());
    } catch {
        return refuse("bad-service");
    }
    const cost = serviceCostCp(kind);
    if (cost > 0) {
        const source = paidFrom === "fund" ? "fund" : "purse";
        const idem = idemKey("purchase", "formula-copy", service.id, nonce);
        const paid = { ...service, payment: { row: hashId(idem), source, cp: cost } };
        const moved = await payPurchase({ source, payer: source === "purse" ? payer ?? requester : null, cp: cost, idem,
            ledger: { set: { [`services.${service.id}`]: paid } } });
        return moved.ok ? { ok: true, service: service.id } : moved;
    }
    await write({ set: { [`services.${service.id}`]: service } });
    return { ok: true, service: service.id };
}

/** Offer to perform an open service as one of this user's characters. */
export async function offer(id, performer) {
    const { service, refusal } = openService(id);
    if (refusal) return refusal;
    if (!owns(performer)) return refuse("not-owner");
    const result = offerService(service, performer);
    if (!result.ok) return result;
    await write({ set: { [`services.${id}.performer`]: performer, [`services.${id}.by`]: game.user.id } });
    return { ok: true };
}

/** Close a service behind its close lock, with other ledger keys (`extra`) and optional claim records. */
function close(service, status, result, extra = {}) {
    const step = closeService(service, status, result);
    if (!step.ok) return Promise.resolve(step);
    const stamp = stampNow();
    return lockedWrite([closeLockId(service.id)], [], { set: { [`services.${service.id}.status`]: status, [`services.${service.id}.result`]: result,
        [`services.${service.id}.closed`]: stamp, ...extra } });
}

/**
 * Cancel an open service: the requester's or the performer's owners, or a GM. Items handed over for it go back, and a
 * formula copy's cost goes back to where it came from (`refundPayment`).
 */
export async function cancel(id) {
    const { service, refusal } = openService(id);
    if (refusal) return refusal;
    if (!(game.user.isGM || owns(service.requester) || owns(service.performer))) return refuse("not-owner");
    const step = cancelRecord(service);
    if (!step.ok) return step;
    const lines = heldLines(service);
    const set = { [`services.${id}.status`]: "cancelled", [`services.${id}.closed`]: stampNow() };
    const back = lines.length ? givingBack({ path: `services.${id}`, key: "service", id }, lines, { ref: "cancel" }) : null;
    const closed = back?.rows.length
        ? await moveCoins(() => ({ rows: back.rows, itemUpdates: [{ target: "strongbox", updates: back.updates }], locks: [closeLockId(id)],
            ledger: { set: { ...set, ...back.marks } } }), {}, back.rows.slice(0, 1))
        : await lockedWrite([closeLockId(id)], [], { set });
    if (!closed.ok) return closed;
    const refunded = await refundPayment(service);
    return { ...closed, refunded };
}

/**
 * Refund a cancelled service's payment to its source (As built in M5 on M4.1): the `purchase` row reversed, so the coins
 * go back into the purse they left, or into the strongbox and the unallocated party fund. Only when this user may move
 * them back (the party fund: anyone; a purse: its owner); otherwise the payer reverses it in the Funds ledger. Returns
 * whether it was refunded.
 */
async function refundPayment(service) {
    const row = service.payment?.row ? read(`rows.${service.payment.row}`) : null;
    if (!row || row.state !== "applied" || !liveRows(records("rows")).some((r) => r.id === row.id)) return false;
    if ((row.purse ?? 0) !== 0 && !owns(row.actor)) return false;
    return (await reverseRows([row], {}, null)).ok === true;
}

/** The item a service works on, if the performer may work it: on the performer, or handed over to the strongbox for it. */
function serviceItem(service, uuid) {
    const line = heldLines(service).find((l) => l.purpose === "service");
    const item = actorOf(line?.uuid ?? uuid);
    if (!item) return null;
    if (item.parent?.uuid === service.performer) return item;
    return item.parent === shared().strongbox && item.flags?.[MODULE_ID]?.earmark?.service === service.id ? item : null;
}

/** The tool ids the performer carries for an action (4.5): a toolkit in the strongbox does not count. */
const carried = (actor, action) => tools(toolKeysOf(actor), new Set([`action:${action}`]), rulesFromSettings());

/**
 * Perform an open service as its performer (the performer's owners). `skipDialog` passes to pf2e's check dialog
 * (Repair). Refusals: `not-ready`, `no-service`, `state`, `not-owner`, `no-item` (not on the performer, nor handed over),
 * `tool` (no repair toolkit), `destroyed`, `undamaged`, `no-hp`, `cancelled` (the dialog closed), the affix rule codes,
 * `talisman-manager` (PF2e Talisman Manager owns affixing, 13), `formula-unknown`, `no-action`.
 */
export async function perform(id, { skipDialog } = {}) {
    const { service, refusal } = openService(id);
    if (refusal) return refusal;
    const performer = actorOf(service.performer);
    if (!performer?.isOwner) return refuse("not-owner");
    switch (service.kind) {
        case "repair": return performRepair(service, performer, { skipDialog });
        case "affix":
        case "unaffix": return performAffix(service, performer);
        case "identify-alchemy": return performIdentify(service, performer, { skipDialog });
        case "formula-copy": return performCopy(service, performer);
        default: return refuse("bad-service");
    }
}

async function performRepair(service, performer, { skipDialog }) {
    const item = serviceItem(service, service.target);
    if (!item) return refuse("no-item");
    if (!carried(performer, "repair").includes("repair-toolkit")) return refuse("tool", { tool: "repair-toolkit" });
    const hp = item.system?.hp;
    const pre = repairResult({ value: hp?.value ?? 0, max: hp?.max ?? 0 }, 2, { rank: 1 });
    if (!pre.ok) return pre;
    const statistic = performer.skills?.crafting;
    if (!statistic) return refuse("no-skill", { skill: "crafting" });
    const pwol = game.pf2e?.settings?.variants?.pwol?.enabled === true;
    const roll = await statistic.roll({
        dc: { value: levelDC(item.level ?? 0, { pwol }), label: game.i18n.localize("pf2e-artisans-workshop.Service.RepairDC") },
        extraRollOptions: ["action:repair", ...[...(item.traits ?? [])].map((trait) => `target:trait:${trait}`)],
        traits: ["exploration", "manipulate"], label: game.i18n.format("pf2e-artisans-workshop.Service.RepairRoll", { item: item.name }),
        skipDialog, createMessage: true,
    });
    if (!roll) return refuse("cancelled");
    const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess;
    if (![0, 1, 2, 3].includes(degree)) return refuse("no-outcome");
    const rolled = degree === 0 ? (await new Roll(REPAIR_CRIT_FAIL_DICE).evaluate()).total : 0;
    const rank = ranksOf(performer).crafting ?? 0;
    const result = repairResult({ value: hp.value, max: hp.max }, degree, { rank, eyepiece: repairEyepiece(heldKeysOf(performer)), rolled,
        hardness: item.system?.hardness ?? 0 });
    if (!result.ok) return result;
    const record = { degree, before: hp.value, after: result.hp, restored: result.restored, damage: result.damage, item: item.name };
    const closed = await close(service, degree >= 2 ? "done" : "failed", record);
    if (!closed.ok) return closed;
    await item.update({ "system.hp.value": result.hp });
    await giveBackAfter(service);
    return { ok: true, ...record };
}

/** Give back what was handed over for a closed service: its items go on the shelf for whoever handed them over. */
async function giveBackAfter(service) {
    const current = read(`services.${service.id}`);
    const lines = heldLines(current);
    if (!lines.length) return { ok: true };
    const back = givingBack({ path: `services.${service.id}`, key: "service", id: service.id }, lines, { ref: "done" });
    if (!back.rows.length) return { ok: true };
    return moveCoins(() => ({ rows: back.rows, itemUpdates: [{ target: "strongbox", updates: back.updates }], ledger: { set: back.marks } }), {}, back.rows.slice(0, 1));
}

/** PF2e Talisman Manager owns affixing when it is active (13). */
const TALISMAN_MANAGER = "pf2e-talisman-manager";

async function performAffix(service, performer) {
    if (game.modules.get(TALISMAN_MANAGER)?.active) return refuse("talisman-manager");
    const talisman = actorOf(service.target);
    if (talisman?.parent !== performer) return refuse("no-item");
    if (!carried(performer, "affix-talisman").includes("repair-toolkit")) return refuse("tool", { tool: "repair-toolkit" });
    if (service.kind === "unaffix") {
        const closed = await close(service, "done", { item: talisman.name });
        if (!closed.ok) return closed;
        await talisman.update({ [`flags.${MODULE_ID}.affix`]: null });
        return { ok: true };
    }
    const host = actorOf(service.host);
    if (!host) return refuse("no-item");
    const onHost = performer.items.filter((i) => i.id !== talisman.id && i.flags?.[MODULE_ID]?.affix?.host === host.id).length;
    const held = heldKeysOf(performer);
    const problem = affixProblem({
        talisman: { traits: [...(talisman.traits ?? [])], usage: talisman.system?.usage?.value ?? "", actor: talisman.parent?.uuid },
        host: { type: host.type, traits: [...(host.traits ?? [])], actor: host.parent?.uuid }, onHost,
        talismanicSage: held.includes("talismanic-sage"), excludeBombs: setting("rules.talismanHostsExcludeBombs") !== false,
    });
    if (problem) return refuse(problem.reason, problem.data ?? {});
    const closed = await close(service, "done", { item: talisman.name, host: host.name });
    if (!closed.ok) return closed;
    await talisman.update({ [`flags.${MODULE_ID}.affix`]: { host: host.id, at: stampNow().at, by: game.user.id } });
    return { ok: true };
}

async function performIdentify(service, performer, { skipDialog } = {}) {
    const action = game.pf2e?.actions?.get?.("identify-alchemy");
    if (!action?.use) return refuse("no-action");
    // pf2e's action reads the dialog choice from an event (Shift inverts the user's "show check dialogs"); `skipDialog`
    // (the harness, a macro) asks for the opposite of what the user's setting would show.
    const shows = game.user.settings?.showCheckDialogs !== false;
    const event = skipDialog === undefined ? undefined : Object.assign(new Event("click"), { shiftKey: skipDialog === shows, ctrlKey: false, metaKey: false });
    await action.use({ actors: [performer], event });
    return close(service, "done", null);
}

async function performCopy(service, performer) {
    if (!bookOf(performer).includes(service.uuid)) return refuse("formula-unknown");
    const input = formulaClaimInput({ learner: service.requester, uuid: service.uuid, route: "copied-ally", source: performer.uuid, service: service.id,
        ref: service.id, parties: [service.requester, performer.uuid] });
    const claim = makeClaim(input, stampNow());
    const extra = exists(`claims.${claim.id}`) ? {} : { [`claims.${claim.id}`]: claim };
    const closed = await close(service, "done", { uuid: service.uuid }, extra);
    if (!closed.ok) return closed;
    return applyIfResponsible(claim);
}
