/**
 * Coatings, Strikes and the other deliveries of a poison on this client (DESIGN.md 8.10.3, 8.10.5, M8a).
 *
 * - **Apply poison** (11.1 macro 21): an injury poison on a weapon or a piece of ammunition, a contact poison on any item, an
 *   ingested one on food or drink, written by the host's owner as `flags.MOD.coating = {id, source, def?, dc, delivery, mods,
 *   stamp?, creator, by, at, sticky?, parts?}`. The dose is spent through a quantity update; the DC is frozen now (8.10.4);
 *   an infused poison's expiry stamp is copied, so the coating is voided with it (the weapon itself is never marked inert).
 *   One injury poison per weapon or piece of ammunition: another replaces it (`replace`), or, with Double Poison, merges with
 *   it. A coating on a stack of ammunition sits on one piece split off.
 * - **Strikes**, on the attacker's responsible client, from pf2e's own message flags: the attack roll spends a coating on a
 *   critical failure, keeps it on a failure and arms it on a hit; the hit's damage roll exposes the target when it holds
 *   piercing or slashing damage (or a blowgun's Strike with Blowgun Poisoner) and spends the coating; otherwise the coating is
 *   spent with no exposure. Sticky Poison's flat checks (DC 17 after an exposure, DC 5 when it is spent with no save) keep it.
 *   A target whose resistance cut that damage to 0 voids the exposure from its save prompt; the attacker's client then rolls
 *   Sticky Poison's DC 5 check and restores the coating on a success.
 * - **Touched and eaten**: the toucher's or eater's owner exposes their creature behind a lock page `coating:<id>` (only the
 *   first creature is exposed) with a coating-spend claim that the host's responsible client applies (5.5).
 * - **Inhaled**: unleashing spends the dose and posts a cloud card whose Expose button exposes each creature that enters.
 * - Weapons that carry Affliction Forge references are its own: never coated or read here (8.10.11).
 */
import { MODULE_ID } from "../constants.mjs";
import { DEGREE, DEGREE_FROM_OUTCOME } from "../logic/core.mjs";
import { canDoublePoison, coatingAfterAttack, coatingAfterDamage, deliveryOf, mergeDoublePoison, runnable, stickyDc } from "../logic/affliction.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { lockKeyId } from "../logic/locks.mjs";
import { makeClaim } from "../logic/claims.mjs";
import { definitionOf, exposureDc, sourceUuidOf } from "./affliction-defs.mjs";
import { afflictionsOn, clockNow, expose, exposureMods, isCompendiumSource, snapshotOf } from "./afflictions.mjs";
import { runRequest } from "./batch.mjs";
import { registerClaimKind } from "./claims.mjs";
import { forgeReferences } from "./forge.mjs";
import { heldKeysOf } from "./registry.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { canWrite, shared } from "./state.mjs";
import { newId, read, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (value) => (typeof value === "string" ? fromUuidSync(value, { strict: false }) : value ?? null);
const traitsOf = (item) => [...(item?.system?.traits?.value ?? [])];

/** An item's coating, or null. */
export const coatingOf = (item) => item?.flags?.[MODULE_ID]?.coating ?? null;

/** The lock page that spends a contact or ingested coating once (8.10.5). */
export const coatingLockId = (coatingId, toucher = null) => lockKeyId(toucher ? idemKey("coating", coatingId, hashId(toucher)) : idemKey("coating", coatingId));

/** Whether a coating is spent as far as this client knows: its lock page exists (8.10.5). */
export function coatingSpent(coating) {
    const ledger = shared().ledger;
    return !!coating && !coating.keeps && !!ledger?.pages?.has?.(coatingLockId(coating.id));
}

/** How a poison is applied (8.10.3): `injury`, `contact` or `ingested`; inhaled poisons are unleashed instead. */
export function applyDelivery(poison) {
    const delivery = deliveryOf(traitsOf(poison));
    return ["injury", "contact", "ingested"].includes(delivery) ? delivery : null;
}

/** Whether an item can take a coating of a delivery (8.10.5): a weapon or ammunition for injury; food or drink for ingested. */
function hostFits(host, delivery) {
    if (delivery === "injury") return host.type === "weapon" || host.type === "ammo";
    if (delivery === "ingested") return host.type === "consumable" && (traitsOf(host).includes("food") || traitsOf(host).includes("drink") ||
        ["food", "drink"].includes(host.system?.category ?? ""));
    return true;
}

/** A source snapshot of a poison. */
const poisonFacts = (poison, def) => ({
    uuid: sourceUuidOf(poison), itemUuid: poison.uuid, name: poison.name, img: poison.img ?? null, level: poison.system?.level?.value ?? def.level ?? 0,
    traits: [...new Set([...traitsOf(poison), ...(def.traits ?? [])])], identified: poison.isIdentified !== false, type: poison.type,
    rarity: poison.system?.traits?.rarity ?? "common",
});

/**
 * Apply a poison (8.10.5, 11.1 macro 21). Refused: `afflictions-off`, `not-owner`, `no-item`, `not-poison` (no injury,
 * contact or ingested delivery), `inert`, `bad-host`, `forge-coats`, `coated` (`replace` to replace it), the Double Poison
 * refusals of `canDoublePoison`, `no-definition`, `no-dc`.
 *
 * @param {{poison: object|string, weapon: object|string, actor?: object|null, replace?: boolean, double?: boolean, saveType?: string|null}} p
 */
export async function applyPoison({ poison: poisonRef, weapon: hostRef, actor = null, replace = false, double = false, saveType = null } = {}) {
    if (!afflictionsOn()) return refuse("afflictions-off");
    const poison = typeof poisonRef === "string" ? fromUuidSync(poisonRef, { strict: false }) ?? actor?.items?.get(poisonRef) : poisonRef;
    const host = typeof hostRef === "string" ? fromUuidSync(hostRef, { strict: false }) ?? actor?.items?.get(hostRef) : hostRef;
    if (!poison || !host) return refuse("no-item");
    const applier = actor ?? poison.actor ?? host.actor;
    if (!poison.isOwner || !host.isOwner) return refuse("not-owner");
    if (poison.flags?.[MODULE_ID]?.inert === true) return refuse("inert");
    const delivery = applyDelivery(poison);
    if (!delivery) return refuse("not-poison");
    if (!hostFits(host, delivery)) return refuse("bad-host");
    if (forgeReferences(host).length) return refuse("forge-coats");
    const def = await definitionOf(poison);
    if (!runnable(def)) return refuse("no-definition", { item: poison.name });
    const dc = exposureDc({ def, item: poison, holder: applier });
    if (!dc) return refuse("no-dc", { item: poison.name });
    const creator = poison.flags?.[MODULE_ID]?.dcStamp?.creator ?? poison.flags?.[MODULE_ID]?.expiry?.creator ?? null;
    const stamp = poison.flags?.[MODULE_ID]?.expiry ?? null;
    const source = poisonFacts(poison, def);
    // A poison with no compendium source cannot be read again once its last dose is gone: the coating keeps its definition.
    let coating = {
        id: newId(), source, defKey: def.key, ...(isCompendiumSource(source.uuid) ? {} : { def: snapshotOf(def) }), dc, delivery,
        mods: exposureMods({ item: poison, creator: actorOf(creator) }), ...(stamp ? { stamp } : {}), creator, keeps: !!def.keepsCoating, ...stampNow(),
    };
    const existing = coatingOf(host);
    if (existing && double) {
        const first = existing;
        const facts = (c) => ({ uuid: c.source.uuid, traits: c.source.traits, level: c.source.level });
        const ok = canDoublePoison({ first: facts(first), second: facts(coating), alchemistLevel: applier?.level ?? 0, ammunition: host.type === "ammo" });
        if (!ok.ok) return ok;
        if (!heldKeysOf(applier).includes("double-poison")) return refuse("no-feat");
        const defA = first.def ?? await definitionOf(first.source.uuid);
        const merged = mergeDoublePoison(defA, def, { saveType });
        coating = { ...coating, def: merged, defKey: `double:${first.source.uuid}:${coating.source.uuid}`,
            dc: { value: Math.min(first.dc.value, dc.value), source: "double" }, parts: [first, { ...coating }],
            source: { ...coating.source, name: `${first.source.name} + ${coating.source.name}` } };
    } else if (existing && !replace) return refuse("coated", { item: host.name });
    // Ammunition: the coating sits on one piece, split off the stack. The launchers that had the stack selected as their
    // ammunition take the coated piece instead, so their next shot fires it (8.10.5); a launcher that loads its ammunition
    // (pf2e's subitems) needs the piece loaded, which the card says.
    let target = host;
    const ops = [];
    let loaded = [];
    if (host.type === "ammo" && (host.quantity ?? 1) > 1) {
        const piece = host.toObject();
        piece._id = newId();
        piece.system.quantity = 1;
        piece.flags = { ...(piece.flags ?? {}), [MODULE_ID]: { ...(piece.flags?.[MODULE_ID] ?? {}), coating } };
        ops.push({ op: "createItems", target: host.actor.uuid, data: [piece] }, { op: "updateItems", target: host.actor.uuid, updates: [{ _id: host.id, "system.quantity": host.quantity - 1 }] });
        loaded = [...(host.actor.items ?? [])].filter((w) => w.type === "weapon" && w.system?.selectedAmmoId === host.id);
        if (loaded.length) ops.push({ op: "updateItems", target: host.actor.uuid, updates: loaded.map((w) => ({ _id: w.id, "system.selectedAmmoId": piece._id })) });
        target = { id: piece._id, name: host.name };
    } else {
        ops.push({ op: "updateItems", target: host.actor.uuid, updates: [{ _id: host.id, [`flags.${MODULE_ID}.coating`]: _replace(coating) }] });
        if (host.type === "ammo") loaded = [...(host.actor.items ?? [])].filter((w) => w.type === "weapon" && w.system?.selectedAmmoId === host.id);
    }
    // The dose, through a quantity update (8.10.3).
    const left = (poison.quantity ?? poison.system?.quantity ?? 1) - 1;
    const poisonOps = left > 0 ? [{ op: "updateItems", target: poison.actor.uuid, updates: [{ _id: poison.id, "system.quantity": left }] }]
        : [{ op: "deleteItems", target: poison.actor.uuid, ids: [poison.id] }];
    const result = await runRequest([...ops, ...poisonOps]);
    if (result.outcome !== "ok") return refuse(result.reason ?? "error", { outcome: result.outcome });
    Hooks.callAll(`${MODULE_ID}.afflictionCoating`, Object.freeze({ actor: host.actor, host: target.name ?? host.name, coating, kind: existing && double ? "double" : "applied",
        ...(host.type === "ammo" ? { loaded: loaded.map((w) => w.name) } : {}) }));
    return { ok: true, coating: coating.id, host: target.id, ...(host.type === "ammo" ? { loaded: loaded.map((w) => w.id) } : {}) };
}

/** Roll a flat check (Sticky Poison), shown with the coating card. */
async function flatCheck(dc) {
    const roll = await new Roll("1d20").evaluate();
    return { total: roll.total, dc, success: roll.total >= dc };
}

/** Remove a host's coating (spent or voided), or set `kept` with Sticky Poison's deadline. */
async function setCoating(host, coating) {
    await host.update({ [`flags.${MODULE_ID}.coating`]: coating ? _replace(coating) : _del });
}

/** Sticky Poison's hold: until the end of the attacker's next turn in an encounter, else a round of world time. */
function stickyUntil(attacker) {
    for (const combat of game.combats ?? []) {
        if (!combat.started) continue;
        const combatant = combat.combatants?.find?.((c) => c.actor === attacker) ?? null;
        if (combatant) return { combat: combat.id, combatant: combatant.id, round: combat.round + 1 };
    }
    return { at: (game.time.worldTime ?? 0) + 6 };
}

/**
 * Spend a coating with no exposure (8.10.5 step 1's critical failure, step 2's hit without piercing or slashing damage): with
 * Sticky Poison a DC 5 flat check keeps it.
 */
async function spendNoSave(attacker, host, coating, why) {
    if (heldKeysOf(attacker).includes("sticky-poison")) {
        const check = await flatCheck(stickyDc(false));
        if (check.success) {
            Hooks.callAll(`${MODULE_ID}.afflictionCoating`, Object.freeze({ actor: attacker, host: host.name, coating, kind: "kept", check, why }));
            return { kept: true, check };
        }
        Hooks.callAll(`${MODULE_ID}.afflictionCoating`, Object.freeze({ actor: attacker, host: host.name, coating, kind: "spent", check, why }));
    } else Hooks.callAll(`${MODULE_ID}.afflictionCoating`, Object.freeze({ actor: attacker, host: host.name, coating, kind: "spent", why }));
    await setCoating(host, null);
    return { kept: false };
}

/** Whether a host's item is a blowgun (Blowgun Poisoner). */
const isBlowgun = (item) => (item?.system?.baseItem ?? item?.slug) === "blowgun";

/**
 * The ammunition a launcher's Strike fired: the piece its roll options name (pf2e's `item:ammo:id:<id>`, an actor item or a
 * loaded subitem), else the launcher's ammunition now (`weapon.ammo`, or its selected piece).
 */
function ammoUsed(host, options = []) {
    const id = (options ?? []).map((o) => (typeof o === "string" ? /^item:ammo:id:(.+)$/.exec(o)?.[1] : null)).find(Boolean) ?? null;
    const loaded = (() => {
        try {
            return host.ammo ?? null;
        } catch {
            return null;
        }
    })();
    if (id) return host.actor?.items?.get?.(id) ?? host.subitems?.get?.(id) ?? (loaded?.id === id ? loaded : null);
    return loaded ?? (host.system?.selectedAmmoId ? host.actor?.items?.get?.(host.system.selectedAmmoId) ?? null : null);
}

/** The flag that holds a fired piece's coating on its launcher between the hit and its damage roll (8.10.5). */
const AMMO_STRIKE = "ammoStrike";
const ammoStrikeOf = (host) => host?.flags?.[MODULE_ID]?.[AMMO_STRIKE] ?? null;

/**
 * The damage types of a pf2e damage message (8.10.5): the instances of its damage rolls. pf2e 8.6.1 writes no
 * `flags.pf2e.damageRoll` on a Strike's damage message (M8a live pass), so that legacy flag is only read as well.
 */
export function damageTypesOf(message) {
    const types = new Set();
    for (const roll of message?.rolls ?? []) {
        if (roll?.kinds && !roll.kinds.has?.("damage")) continue;
        for (const instance of roll?.instances ?? []) if (instance?.type) types.add(instance.type);
    }
    for (const type of Object.keys(message?.flags?.pf2e?.damageRoll?.types ?? {})) types.add(type);
    return [...types];
}

/**
 * A Strike's chat message (8.10.5), on the attacker's responsible client: the attack roll arms, keeps or spends the coating;
 * the hit's damage roll exposes the target and spends it. A launcher's Strike uses its ammunition's coating: the piece leaves
 * with the shot (pf2e consumes it), so a hit arms the coating on the launcher for the Strike's damage roll and a miss takes it
 * away with the piece. The attack roll also records whether the target was off-guard (its roll options, flanking included:
 * Pinpoint Poisoner). Returns what happened, or null for a message that is not about a coated item this client handles.
 */
export async function onStrikeMessage(message) {
    if (!afflictionsOn() || !canWrite()) return null;
    const context = message.flags?.pf2e?.context;
    const type = context?.type;
    if (type !== "attack-roll" && type !== "damage-roll") return null;
    const originUuid = message.flags?.pf2e?.origin?.uuid ?? null;
    const host = originUuid ? fromUuidSync(originUuid, { strict: false }) : null;
    if (!host || forgeReferences(host).length) return null;
    const attacker = host.actor;
    if (type === "attack-roll") {
        // A new attack: a fired piece's coating armed by an earlier hit whose damage was never rolled goes with that piece.
        if (ammoStrikeOf(host) && attacker && isResponsibleFor(attacker)) await host.update({ [`flags.${MODULE_ID}.${AMMO_STRIKE}`]: _del });
        let coating = coatingOf(host);
        let ammo = null;
        if (coating?.delivery !== "injury") {
            ammo = ammoUsed(host, context.options);
            coating = coatingOf(ammo);
            if (!ammo || forgeReferences(ammo).length) return null;
        }
        if (coating?.delivery !== "injury" || !attacker || !isResponsibleFor(attacker)) return null;
        const degree = DEGREE_FROM_OUTCOME[context.outcome];
        if (degree === undefined) return null;
        const what = coatingAfterAttack(degree);
        const armed = { message: message.id, target: context.target?.actor ?? null, crit: degree === DEGREE.critSuccess, at: stampNow().at,
            offGuard: (context.options ?? []).includes("target:condition:off-guard") };
        if (ammo) {
            if (what !== "arm") return { outcome: "spent", ammo: ammo.id };
            await host.update({ [`flags.${MODULE_ID}.${AMMO_STRIKE}`]: _replace({ ...coating, armed, ammo: ammo.id }) });
            return { outcome: "armed", ammo: ammo.id };
        }
        if (what === "keep") return { outcome: "kept" };
        if (what === "spend") return { outcome: "spent", ...(await spendNoSave(attacker, host, coating, "crit-fail")) };
        await setCoating(host, { ...coating, armed });
        return { outcome: "armed" };
    }
    const fromAmmo = !coatingOf(host)?.armed && !!ammoStrikeOf(host)?.armed;
    const coating = fromAmmo ? ammoStrikeOf(host) : coatingOf(host);
    if (!coating?.armed || coating.delivery !== "injury" || !attacker || !isResponsibleFor(attacker)) return null;
    const targetUuid = context.target?.actor ?? coating.armed.target ?? null;
    const target = targetUuid ? fromUuidSync(targetUuid, { strict: false }) : null;
    const types = damageTypesOf(message);
    const blowgun = isBlowgun(host) && heldKeysOf(attacker).includes("blowgun-poisoner");
    const result = coatingAfterDamage({ types, blowgun, keepsCoating: coating.keeps });
    const disarmed = { ...coating, armed: null };
    delete disarmed.ammo;
    if (fromAmmo) {
        // The piece is gone with the shot: its coating exposes on a hit with piercing or slashing damage, and is spent either way.
        await host.update({ [`flags.${MODULE_ID}.${AMMO_STRIKE}`]: _del });
        const exposed = result.expose && target ? await expose({ item: coating.source.uuid, targets: [target], delivery: "injury", key: message.id, deliverer: attacker,
            crit: !!coating.armed.crit, blowgun, offGuard: coating.armed.offGuard ?? null, coating: disarmed }) : null;
        Hooks.callAll(`${MODULE_ID}.afflictionCoating`, Object.freeze({ actor: attacker, host: host.name, coating: disarmed, kind: "spent", why: exposed ? "exposed" : "no-damage-type",
            ...(exposed ? { target: target.name } : {}) }));
        return { outcome: exposed ? "exposed" : "spent", exposed, kept: false };
    }
    if (!result.expose || !target) return { outcome: "spent", ...(await spendNoSave(attacker, host, disarmed, "no-damage-type")) };
    const exposed = await expose({ item: coating.source.uuid, targets: [target], delivery: "injury", key: message.id, deliverer: attacker, crit: !!coating.armed.crit,
        blowgun, offGuard: coating.armed.offGuard ?? null, coating: { ...disarmed, restore: { host: host.uuid } } });
    let kept = false;
    let check = null;
    if (!result.spend) kept = true;
    else if (heldKeysOf(attacker).includes("sticky-poison")) {
        check = await flatCheck(stickyDc(true));
        kept = check.success;
    }
    await setCoating(host, kept ? { ...disarmed, ...(check ? { sticky: stickyUntil(attacker) } : {}) } : null);
    Hooks.callAll(`${MODULE_ID}.afflictionCoating`, Object.freeze({ actor: attacker, host: host.name, coating: disarmed, kind: kept ? "kept" : "spent", check, why: "exposed",
        target: target.name }));
    return { outcome: "exposed", exposed, kept };
}

/**
 * A target's "no piercing or slashing damage got through" (8.10.5 step 3), from its save prompt: the exposure is voided (its
 * claim resolved `voided`). The attacker's client rolls Sticky Poison's DC 5 check and restores the coating on a success
 * (`onVoided`, when the claim changes).
 */
export async function voidExposure(claimId) {
    const claim = read(`claims.${claimId}`);
    if (!claim || claim.resolved) return refuse("no-save");
    const target = actorOf(claim.actor);
    if (!target?.isOwner) return refuse("not-owner");
    await write({ set: { [`claims.${claimId}.resolved`]: stampNow(), [`claims.${claimId}.outcome`]: "voided" } });
    return { ok: true, outcome: "voided" };
}

/** A voided exposure seen by the attacker's responsible client: Sticky Poison's DC 5 check restores a spent coating. */
async function onVoided(claim) {
    const host = claim.restore?.host ? fromUuidSync(claim.restore.host, { strict: false }) : null;
    const attacker = host?.actor;
    if (!host || !attacker || !isResponsibleFor(attacker) || !heldKeysOf(attacker).includes("sticky-poison")) return null;
    if (handledVoids.has(claim.id)) return null;
    handledVoids.add(claim.id);
    const check = await flatCheck(stickyDc(false));
    if (check.success && !coatingOf(host)) {
        const coating = claim.coating ?? null;
        if (coating?.id) await setCoating(host, coating);
    }
    Hooks.callAll(`${MODULE_ID}.afflictionCoating`, Object.freeze({ actor: attacker, host: host.name, coating: claim.coating ?? null, kind: check.success ? "kept" : "spent",
        check, why: "voided" }));
    return check;
}
const handledVoids = new Set();

/**
 * Touch or eat a coated item (8.10.5): the toucher's (or eater's) owner exposes their creature behind the coating's lock page,
 * so only the first creature is exposed (each one, for an item that keeps its potency), with a coating-spend claim the host's
 * responsible client applies. Refused: `no-coating`, `not-owner`, `spent`, `afflictions-off`.
 */
export async function touchCoating({ host: hostRef, toucher: toucherRef }) {
    if (!afflictionsOn()) return refuse("afflictions-off");
    if (!canWrite()) return refuse("not-ready");
    const host = typeof hostRef === "string" ? fromUuidSync(hostRef, { strict: false }) : hostRef;
    const toucher = actorOf(toucherRef);
    const coating = coatingOf(host);
    if (!host || !coating || coating.delivery === "injury") return refuse("no-coating");
    if (!toucher?.isOwner) return refuse("not-owner");
    const lockId = coatingLockId(coating.id, coating.keeps ? toucher.uuid : null);
    if (shared().ledger?.pages?.has?.(lockId)) return refuse("spent");
    const stamp = stampNow();
    const exposure = makeClaim({ kind: "exposure", idem: idemKey("expose", coating.id, hashId(toucher.uuid)), actor: toucher.uuid, parties: [host.actor?.uuid].filter(Boolean),
        source: coating.source, defKey: coating.defKey, ...(coating.def ? { def: coating.def } : {}), dc: coating.dc, delivery: coating.delivery, mods: coating.mods ?? [],
        combat: null, run: newId(), exposedAt: clockNow() }, stamp);
    const set = { [`claims.${exposure.id}`]: exposure };
    if (!coating.keeps) {
        const spend = makeClaim({ kind: "coating-spend", idem: idemKey("coating-spend", coating.id), actor: host.actor.uuid, parties: [toucher.uuid], host: host.uuid, coating: coating.id }, stamp);
        set[`claims.${spend.id}`] = spend;
    }
    const result = await runRequest([{ op: "lock", ids: [lockId] }, { op: "ledger", change: { set } }]);
    if (result.outcome === "refused") return refuse("spent");
    if (result.outcome !== "ok") return refuse(result.reason ?? "error", { outcome: result.outcome });
    const { sweepClaims } = await import("./claims.mjs");
    sweepClaims().catch(() => null);
    return { ok: true, claim: exposure.id };
}

/** The coating-spend claim's applier (5.5), on the host's responsible client: the coating is removed. */
async function applySpend(claim) {
    const host = claim.host ? fromUuidSync(claim.host, { strict: false }) : null;
    if (host && coatingOf(host)?.id === claim.coating) await setCoating(host, null);
    await write({ set: { [`claims.${claim.id}.resolved`]: stampNow() } });
    return { ok: true, outcome: "ok" };
}

/**
 * Unleash an inhaled poison (8.10.3): the dose is spent, the creatures given are exposed, and a cloud card lets each creature
 * that enters be exposed for the next minute. Refused: `not-poison`, `not-owner`, `no-definition`, `no-dc`.
 */
export async function unleash({ poison: poisonRef, actor = null, targets = [] }) {
    if (!afflictionsOn()) return refuse("afflictions-off");
    const poison = typeof poisonRef === "string" ? fromUuidSync(poisonRef, { strict: false }) : poisonRef;
    if (!poison) return refuse("no-item");
    if (!poison.isOwner) return refuse("not-owner");
    if (deliveryOf(traitsOf(poison)) !== "inhaled") return refuse("not-poison");
    const def = await definitionOf(poison);
    if (!runnable(def)) return refuse("no-definition", { item: poison.name });
    const holder = actor ?? poison.actor;
    const dc = exposureDc({ def, item: poison, holder });
    if (!dc) return refuse("no-dc", { item: poison.name });
    const creator = poison.flags?.[MODULE_ID]?.dcStamp?.creator ?? poison.flags?.[MODULE_ID]?.expiry?.creator ?? null;
    const source = poisonFacts(poison, def);
    // The dose is gone before anyone breathes the cloud: a poison with no compendium source keeps its definition in the cloud.
    const cloud = { id: newId(), source, defKey: def.key, ...(isCompendiumSource(source.uuid) ? {} : { def: snapshotOf(def) }), dc, delivery: "inhaled",
        mods: exposureMods({ item: poison, creator: actorOf(creator) }), until: (game.time.worldTime ?? 0) + 60, by: game.user.id };
    const left = (poison.quantity ?? 1) - 1;
    if (left > 0) await poison.update({ "system.quantity": left });
    else await poison.delete();
    if (targets.length) await expose({ item: cloud.source.uuid, targets, delivery: "inhaled", key: cloud.id, deliverer: holder, coating: cloud });
    Hooks.callAll(`${MODULE_ID}.afflictionCloud`, Object.freeze({ actor: holder, cloud }));
    return { ok: true, cloud: cloud.id };
}

/** Sticky Poison's hold has run out (the end of the attacker's next turn): the coating goes (8.10.5). */
async function sweepSticky() {
    if (!afflictionsOn()) return;
    for (const actor of game.actors ?? []) {
        if (!isResponsibleFor(actor)) continue;
        for (const item of actor.items ?? []) {
            const sticky = coatingOf(item)?.sticky;
            if (!sticky) continue;
            const combat = sticky.combat ? game.combats?.get?.(sticky.combat) : null;
            const over = sticky.combat ? !combat || combat.round > sticky.round || (combat.round === sticky.round && combat.combatant?.id !== sticky.combatant &&
                (combat.turns ?? []).findIndex((c) => c.id === sticky.combatant) < (combat.turn ?? 0)) : (game.time.worldTime ?? 0) >= (sticky.at ?? 0);
            if (over) await setCoating(item, null);
        }
    }
}

/** Hooks at `init`: Strikes, spends, voided exposures, Sticky Poison's hold. */
export function registerCoatingHooks() {
    registerClaimKind("coating-spend", (claim) => applySpend(claim));
    Hooks.on("createChatMessage", (message) => {
        onStrikeMessage(message).catch((error) => console.warn(`${MODULE_ID} | could not handle a coated Strike`, error));
    });
    Hooks.on("updateJournalEntry", (doc, changed) => {
        if (doc !== shared().ledger || !afflictionsOn()) return;
        const claims = changed?.flags?.[MODULE_ID]?.claims ?? {};
        for (const id of Object.keys(claims)) {
            const claim = read(`claims.${id}`);
            if (claim?.kind === "exposure" && claim.outcome === "voided" && claim.restore) onVoided(claim).catch(() => null);
        }
    });
    Hooks.on("combatTurnChange", () => {
        sweepSticky().catch(() => null);
    });
    Hooks.on("updateWorldTime", () => {
        sweepSticky().catch(() => null);
    });
}

/** For tests only. */
export function resetCoatings() {
    handledVoids.clear();
}
