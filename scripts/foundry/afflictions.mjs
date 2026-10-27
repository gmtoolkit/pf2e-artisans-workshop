/**
 * The affliction tracker on this client (DESIGN.md 8.10, M8a): exposure claims, saves rolled with the source item, their
 * recording, the tracker items and their stage conditions, timing in and out of combat, pending saves, manual changes and
 * the stage guard. The rules are pure (`scripts/logic/affliction.mjs`); definitions, the backend and DCs are in
 * `affliction-defs.mjs`; coatings and Strikes in `coatings.mjs`; Affliction Forge in `forge.mjs`.
 *
 * - **Exposure** (8.10.3): a claim `{kind: "exposure", target, source, defKey, dc, delivery, mods, combat, run, by, at}`
 *   keyed `expose:<message or nonce>:<target>`, applied by the target's responsible client (the active GM's for a hand-off
 *   to Affliction Forge) in `at` order; a later claim of the same definition waits behind an open earlier one. It rolls the
 *   initial save (prompted on the roller's client, or rolled at once); the claim stays open, and is the pending save, until
 *   the save is recorded.
 * - **Saves** (8.10.8) go through `actor.saves[type].roll` with the source item (an ephemeral item at the affliction's level)
 *   so pf2e applies incapacitation and the bonuses against poisons, and the link option `<MOD>:affliction:<run>:<seq>`. The
 *   message's author records it (`createChatMessage`), behind a lock page per run, save and result, so the first result for a
 *   save stands and a Hero Point reroll replaces it only once pf2e has deleted the original.
 * - **Trackers** (8.10.1): the effect backend keeps the affliction in an `effect` item with a stage badge; stage conditions
 *   are granted by it, the six expiring ones and unlinked ones detached, the rest cascading. The native backend (once pf2e
 *   ships the type) creates an `affliction` item when the first stage takes effect and lets pf2e apply its stages, applying a
 *   repeated stage itself.
 * - **Timing** (8.10.7): world time, read through the affliction clock (logged days count as elapsed); in an encounter, the
 *   pf2e initiative convention (`combatTurnChange` on every client, the victim's responsible client acting). Catch-up rolls or
 *   prompts the due saves one at a time, pausing after `afflictions.catchUpLimit`.
 * - **Manual changes** (8.10.9) record their author and can be undone; the stage guard turns effects-panel clicks and other
 *   writes the module did not make into manual adjusts (an update) or a recorded manual end (a deletion).
 */
import { MODULE_ID } from "../constants.mjs";
import { DEGREE, DEGREE_FROM_OUTCOME } from "../logic/core.mjs";
import {
    advance, afflictionLink, afflictionNow, anchorFor, badgeOf, exposureKind, forgeRoute, initialSaveModifiers, kindOf, latestSeq, manualEntry,
    newRun, parseAfflictionLink, recordSave, rollerFor, runnable, saveLockKey, stageConditionPlan, stageEffects, systemSource, trackerSource,
    undoManual, waitsBehind,
} from "../logic/affliction.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { heldEffects } from "../logic/registry.mjs";
import { backend, definitionOf, exposureDc, sourceUuidOf } from "./affliction-defs.mjs";
import { runLockFirst, runRequest } from "./batch.mjs";
import { createClaims, registerClaimKind, sweepClaims } from "./claims.mjs";
import { dayOffset, secondsPerDay, today } from "./downtime.mjs";
import { forgeActive, forgeControllerFor, forgeSettings, forgeTemplateFor, handOff } from "./forge.mjs";
import { holdsLease } from "./lease.mjs";
import { heldKeysOf } from "./registry.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { isEnabled, rulesFromSettings, setting } from "./settings.mjs";
import { canWrite } from "./state.mjs";
import { newId, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (value) => (typeof value === "string" ? fromUuidSync(value, { strict: false }) : value ?? null);

/**
 * The operation options the module's own writes to a tracker carry, so the stage guard lets them through (8.10.1). A new
 * object each time: Foundry writes `parent` and `pack` into the operation it is given (`Document#update`,
 * `createEmbeddedDocuments`, 14.368), so a shared or frozen one would carry them over or throw.
 */
export const ownWrite = (extra = {}) => ({ [MODULE_ID]: { affliction: true }, ...extra });

/* -------------------------------------------- */
/*  Switches and settings (14.5)                 */
/* -------------------------------------------- */

/** Whether the tracker runs: the master switch and `features.afflictions` (independent of the combat features and Duct Tape). */
export const afflictionsOn = () => isEnabled() && setting("features.afflictions") !== false;

/** The settings of 14.5 the rules read. */
export function afflictionSettings() {
    return {
        pcSaves: setting("afflictions.pcSaves") ?? "prompt", npcSaves: setting("afflictions.npcSaves") ?? "auto",
        gmRollsForOfflinePCs: setting("afflictions.gmRollsForOfflinePCs") === true, autoApplyDamage: setting("afflictions.autoApplyDamage") === true,
        catchUp: setting("afflictions.catchUp") ?? "roll-each", catchUpLimit: Number(setting("afflictions.catchUpLimit") ?? 20) || 20,
        combatAnchor: setting("afflictions.combatAnchor") ?? "exposure-turn",
    };
}

/* -------------------------------------------- */
/*  Trackers on actors                           */
/* -------------------------------------------- */

/** A tracker item's run state, or null. */
export const runOf = (item) => item?.flags?.[MODULE_ID]?.affliction?.run ?? null;

/** Whether an item is a tracker. */
export const isTracker = (item) => !!runOf(item);

/** An actor's live trackers. */
export const trackersOf = (actor) => [...(actor?.items ?? [])].filter((item) => isTracker(item) && runOf(item).phase !== "ended");

/** Every actor that can hold a tracker: the world's actors and the synthetic actors of unlinked tokens. */
export function afflictionActors() {
    const out = new Map();
    for (const actor of game.actors ?? []) out.set(actor.uuid, actor);
    for (const scene of game.scenes ?? []) {
        for (const token of scene.tokens ?? []) {
            if (!token.actorLink && token.actor) out.set(token.actor.uuid, token.actor);
        }
    }
    return [...out.values()];
}

/** Whether a player (not a GM) owns an actor (8.10.8: who rolls is keyed on ownership, not actor type). */
export const playerOwned = (actor) => game.users.some((u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER"));

/** Whether a player owner of an actor is connected. */
const ownerOnline = (actor) => game.users.some((u) => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER"));

/** The definition a run follows: its own snapshot (Double Poison, a world definition), else the source's. */
export async function definitionOfRun(run, tracker = null) {
    const snapshot = tracker?.flags?.[MODULE_ID]?.affliction?.def ?? null;
    if (snapshot) return snapshot;
    return definitionOf(run.source?.uuid ?? null);
}

/* -------------------------------------------- */
/*  The clock (8.10.7)                           */
/* -------------------------------------------- */

/** The highest logged day (4.8), or null when none is logged or the ledger cannot be read. */
function loggedDay() {
    try {
        return today().manualDay ?? null;
    } catch {
        return null;
    }
}

/** The affliction clock now: world time, or the end of the last logged day if later. */
export function clockNow() {
    const manualDay = loggedDay();
    return afflictionNow({ worldTime: game.time.worldTime ?? 0, manualDay, secondsPerDay: secondsPerDay(), offset: dayOffset() });
}

/** The anchor's encounter as it is now (`isDue`), or null when it is over. */
function combatState(anchor) {
    const combat = anchor?.combatId ? game.combats?.get?.(anchor.combatId) : null;
    if (!combat?.started) return null;
    return { id: combat.id, initiative: combat.combatant?.initiative ?? null };
}

/** The started encounter an actor is a combatant in, and its combatant. */
function encounterOf(actor) {
    for (const combat of game.combats ?? []) {
        if (!combat.started) continue;
        const combatant = combat.combatants?.find?.((c) => c.actor === actor || (!c.token && c.actorId === actor?.id) || c.token?.actor === actor) ?? null;
        if (combatant) return { combat, combatant };
    }
    return null;
}

/** The anchor a stage that starts now takes (8.10.7). `origin` is the initiative the exposure recorded. */
function anchorNow(victim, origin = null) {
    const found = encounterOf(victim);
    if (!found) return null;
    return anchorFor({ combatId: found.combat.id, origin, current: found.combat.combatant?.initiative ?? null, victim: found.combatant.initiative ?? null },
        afflictionSettings().combatAnchor);
}

/* -------------------------------------------- */
/*  Modifiers (8.10.6)                           */
/* -------------------------------------------- */

/** The `afflictionModifier` effects an actor holds `as` a role. */
function modsHeld(actor, as) {
    if (!actor) return [];
    return heldEffects(heldKeysOf(actor), "afflictionModifier", rulesFromSettings()).filter(({ effect }) => effect.as === as).map(({ effect }) => effect);
}

/**
 * The modifiers an exposure carries (8.10.6): the creator's (Tenacious Toxins; the toxicologist's acid for an infused poison,
 * kept only against a poison-immune target), the deliverer's (Pinpoint Poisoner, kept only against an off-guard target;
 * Blowgun Poisoner's critical), the poison's additive (Pernicious Poison, Combustible Poison), and holding one's breath.
 */
export function exposureMods({ item = null, creator = null, deliverer = null, delivery = null, crit = false, blowgun = false, heldBreath = false } = {}) {
    const mods = [];
    const traits = [...(item?.system?.traits?.value ?? [])];
    for (const effect of modsHeld(creator, "creator")) {
        if (effect.mod === "tenacious-toxins") mods.push({ slug: "tenacious-toxins" });
        if (effect.mod === "toxicologist-acid" && traits.includes("infused")) mods.push({ slug: "toxicologist-acid", requires: "immune" });
    }
    for (const effect of modsHeld(deliverer, "deliverer")) {
        // Off-guard whatever the delivery (Player Core 2): at the hit for a Strike, when the claim is applied for a cloud.
        if (effect.mod === "pinpoint-poisoner") mods.push({ slug: "pinpoint-poisoner", requires: "off-guard" });
        if (effect.mod === "blowgun-poisoner" && blowgun && crit) mods.push({ slug: "blowgun-crit" });
    }
    const additive = item?.flags?.[MODULE_ID]?.quick?.additive ?? null;
    if (additive === "pernicious-poison") mods.push({ slug: "pernicious-poison" });
    if (additive === "combustible-poison") mods.push({ slug: "combustible-poison" });
    if (heldBreath && delivery === "inhaled") mods.push({ slug: "held-breath" });
    return mods;
}

/** Whether a creature is immune to an affliction's kind (8.10.3). */
const immuneTo = (actor, kind) => !!kind && (actor?.attributes?.immunities ?? actor?.system?.attributes?.immunities ?? []).some((i) => (i?.type ?? i) === kind);

/**
 * The modifiers that hold for this target (an off-guard target, persistent fire, immunity). Off-guard is the Strike's, read
 * from its roll options at the hit (`offGuard`, flanking included: pf2e gives the target's clone an ephemeral off-guard);
 * without a Strike (a cloud), the target's own condition when the claim is applied.
 */
function modsForTarget(mods, target, def, offGuard = null) {
    const out = [];
    for (const mod of mods ?? []) {
        if (mod.requires === "off-guard" && !(typeof offGuard === "boolean" ? offGuard : !!target?.hasCondition?.("off-guard"))) continue;
        if (mod.requires === "immune" && !immuneTo(target, kindOf(def))) continue;
        out.push({ slug: mod.slug });
    }
    if (out.some((m) => m.slug === "combustible-poison") && (target?.itemTypes?.condition ?? []).some((c) => c.slug === "persistent-damage" &&
        c.system?.persistent?.damageType === "fire")) out.push({ slug: "combustible-fire" });
    return out;
}

/* -------------------------------------------- */
/*  Exposure (8.10.3)                            */
/* -------------------------------------------- */

/** Whether a source UUID is a compendium document's, whose description can always be read again (8.10.2). */
export const isCompendiumSource = (uuid) => typeof uuid === "string" && uuid.startsWith("Compendium.");

/** A definition as a run keeps it: its numbers, slugs and UUIDs (8.10.2, P9), without the parser's working fields. */
export function snapshotOf(def) {
    if (!def) return null;
    const out = JSON.parse(JSON.stringify(def));
    delete out.problems;
    delete out.intro;
    return out;
}

/** A source snapshot of the item behind an exposure. */
function sourceFacts(item, def) {
    const sourceUuid = sourceUuidOf(item);
    return {
        uuid: sourceUuid, itemUuid: item?.uuid ?? null, name: item?.name ?? "", img: item?.img ?? null,
        level: item?.system?.level?.value ?? def?.level ?? 0, traits: [...new Set([...(item?.system?.traits?.value ?? []), ...(def?.traits ?? [])])],
        identified: item?.isIdentified !== false, type: item?.type ?? "consumable", rarity: item?.system?.traits?.rarity ?? "common",
    };
}

/**
 * Expose creatures to an item's affliction (8.10.3, 11.1 macro 22): one exposure claim per target, keyed by the message
 * (or a nonce fixed when a manual Expose is confirmed), so a hook seen twice exposes once. `dc` is a DC typed on a manual
 * Expose (a trap, a creature, a spell). Refused: `off`, `not-ready`, `no-item`, `no-targets`, `no-definition` (nothing
 * parses: a world definition is needed), `no-dc`.
 *
 * A coating or cloud (`coating`) carries its own source, DC and modifiers, and its definition when it has no compendium source,
 * so it exposes after its last dose is gone. `offGuard` is the Strike's (its roll options at the hit, Pinpoint Poisoner).
 *
 * @param {{item: object|string, targets: object[], delivery?: string|null, dc?: number|null, key?: string|null,
 *   deliverer?: object|null, crit?: boolean, blowgun?: boolean, heldBreath?: boolean, def?: object|null, coating?: object|null,
 *   offGuard?: boolean|null}} p
 */
export async function expose({ item: itemRef, targets = [], delivery = null, dc = null, key = null, deliverer = null, crit = false, blowgun = false,
    heldBreath = false, def: given = null, coating = null, offGuard = null } = {}) {
    if (!afflictionsOn()) return refuse("afflictions-off");
    if (!canWrite()) return refuse("not-ready");
    const item = typeof itemRef === "string" ? await fromUuid(itemRef).catch(() => null) : itemRef;
    if (!item && !given && !coating?.def) return refuse("no-item");
    const victims = targets.map(actorOf).filter(Boolean);
    if (!victims.length) return refuse("no-targets");
    const def = given ?? coating?.def ?? await definitionOf(item);
    if (!runnable(def)) return refuse("no-definition", { item: item?.name ?? coating?.source?.name ?? "" });
    const frozen = coating?.dc ?? exposureDc({ def, item, holder: deliverer ?? item?.actor ?? null, manual: dc });
    if (!frozen) return refuse("no-dc", { item: item?.name ?? "" });
    const creator = actorOf(item?.flags?.[MODULE_ID]?.dcStamp?.creator ?? item?.flags?.[MODULE_ID]?.expiry?.creator ?? coating?.creator ?? null);
    // A coating carries its creator's and additive's modifiers from when it was applied; the deliverer's are the Strike's.
    const mods = coating ? [...(coating.mods ?? []), ...exposureMods({ deliverer, delivery, crit, blowgun, heldBreath })]
        : exposureMods({ item, creator, deliverer, delivery, crit, blowgun, heldBreath });
    const source = coating?.source ?? sourceFacts(item, def);
    // A definition with no compendium source (a homebrew poison, a world item) cannot be read again once its item is gone:
    // the claim, and the tracker after it, keep it (numbers and slugs only, P9).
    const snapshot = given ?? coating?.def ?? (isCompendiumSource(source.uuid) ? null : snapshotOf(def));
    const template = forgeActive() ? await forgeTemplateFor(item, source.uuid) : null;
    const nonce = key ?? newId();
    const found = deliverer ? encounterOf(deliverer) : null;
    const now = clockNow();
    const inputs = victims.map((victim) => ({
        kind: "exposure", idem: idemKey("expose", nonce, hashId(victim.uuid)), actor: victim.uuid, parties: [deliverer?.uuid, creator?.uuid].filter(Boolean),
        source, defKey: coating?.defKey ?? def.key ?? `uuid:${source.uuid}`, ...(snapshot ? { def: snapshot } : {}), dc: frozen, delivery, mods,
        ...(typeof offGuard === "boolean" ? { offGuard } : {}),
        combat: found ? { id: found.combat.id, round: found.combat.round, initiative: found.combatant.initiative ?? null } : null,
        run: newId(), exposedAt: now, ...(template ? { forge: { template } } : {}),
        // A coated Strike's exposure keeps the coating it spent, so a voided exposure can give it back (Sticky Poison, 8.10.5).
        ...(coating?.restore ? { restore: coating.restore, coating: Object.fromEntries(Object.entries(coating).filter(([k]) => k !== "restore")) } : {}),
    }));
    const created = await createClaims(inputs);
    sweepClaims().catch((error) => console.warn(`${MODULE_ID} | exposure sweep failed`, error));
    return { ok: true, claims: created.map((c) => c.id), count: inputs.length };
}

/** The open exposure claims, earliest first. */
export const openExposures = () => records("claims").filter((c) => c.kind === "exposure" && !c.resolved);

/** Resolve a claim with an outcome (and the run it created, if any). */
async function resolveClaim(claim, outcome, extra = {}) {
    await write({ set: { [`claims.${claim.id}.resolved`]: stampNow(), [`claims.${claim.id}.outcome`]: outcome, ...Object.fromEntries(
        Object.entries(extra).map(([k, v]) => [`claims.${claim.id}.${k}`, v])) } });
    return { ok: true, outcome };
}

/** Who applies an exposure claim (5.5, 8.10.11): the active GM for a hand-off to Affliction Forge, else the target's responsible client. */
function exposureResponsible(claim, actor) {
    if (claim.forge?.template && forgeActive() && forgeSettings().handOff && game.users.activeGM) {
        return holdsLease() && game.users.activeGM.id === game.user.id;
    }
    return isResponsibleFor(actor);
}

/**
 * Apply an exposure claim on this client (8.10.3): Affliction Forge's route, immunity, the same affliction twice, the
 * item's own rule for another exposure; otherwise the save is pending and prompted (or rolled). Returns `pending` while the
 * save waits.
 */
export async function applyExposure(claim, actor) {
    if (!afflictionsOn()) return refuse("afflictions-off");
    if (waitsBehind(claim, openExposures())) return { ok: false, outcome: "waiting" };
    const def = claim.def ?? await definitionOf(claim.source?.uuid ?? null);
    if (!runnable(def)) return resolveClaim(claim, "no-definition");
    const { handOff: wantHandOff, withoutGm } = forgeSettings();
    const route = forgeRoute({ active: forgeActive(), controllerOnTarget: await forgeControllerFor(actor, claim.source?.uuid), template: claim.forge?.template ?? null,
        handOff: wantHandOff, gmConnected: !!game.users.activeGM, withoutGm });
    if (route === "skip") return resolveClaim(claim, "forge-owns");
    if (route === "wait") {
        Hooks.callAll(`${MODULE_ID}.afflictionPrompt`, Object.freeze({ victim: actor, claim, waiting: "forge" }));
        return { ok: false, outcome: "pending" };
    }
    if (route === "forge") {
        const handed = await handOff({ template: claim.forge.template, target: actor, dc: claim.dc?.value ?? null });
        return handed.ok ? resolveClaim(claim, "forge") : handed;
    }
    const mods = modsForTarget(claim.mods, actor, def, claim.offGuard ?? null);
    if (immuneTo(actor, kindOf(def)) && !mods.some((m) => m.slug === "toxicologist-acid")) return resolveClaim(claim, "immune");
    const active = trackersOf(actor).find((t) => runOf(t).defKey === claim.defKey) ?? null;
    const kind = exposureKind(active ? runOf(active) : null, def);
    if (kind === "no-effect" || kind === "no-save") {
        if (active) await recordExposure(active, claim, null);
        return resolveClaim(claim, kind);
    }
    let pending = claim.pending ?? null;
    if (!pending && kind === "re-exposure") {
        // Time order (8.10.8): a stage save that is pending, or already due, comes before this exposure; it waits until that
        // save is recorded (the record sweeps the claims again).
        const run = runOf(active);
        const due = advance(run, await definitionOfRun(run, active), clockNow(), { combat: combatState(run.anchor), anchor: run.anchor ?? null });
        if (run.pending || due.save || due.steps.length) {
            if (!run.pending) scheduleProcess(0);
            return { ok: false, outcome: "waiting" };
        }
    }
    if (!pending) {
        pending = kind === "initial" ? { kind: "initial", runId: claim.run, seq: 1 } : { kind: "re-exposure", runId: active.id, seq: nextSeq(runOf(active), active.id) };
        await write({ set: { [`claims.${claim.id}.pending`]: pending, [`claims.${claim.id}.applied`]: mods } });
    }
    await promptSave({ victim: actor, runId: pending.runId, seq: pending.seq, kind: pending.kind, claim, def });
    return { ok: false, outcome: "pending" };
}

/**
 * The next save number of a run (8.10.8): past every recorded save, its pending save and the pending saves of open exposure
 * claims against it, so two saves never share one (the link `<run>:<seq>` and the lock page are keyed by it).
 */
function nextSeq(run, runId) {
    const reserved = openExposures().filter((c) => c.pending?.runId === runId).map((c) => c.pending.seq);
    return Math.max(run?.seq ?? 0, latestSeq(run) ?? 0, run?.pending?.seq ?? 0, ...reserved.filter(Number.isInteger)) + 1;
}

/** Note an exposure on a run without a save (`reExposure` "none" or a curse already affecting the creature). */
async function recordExposure(tracker, claim, degree) {
    const run = runOf(tracker);
    const exposures = { ...(run.exposures ?? {}), [claim.id]: { at: claim.exposedAt ?? clockNow(), degree } };
    await tracker.update({ [`flags.${MODULE_ID}.affliction.run.exposures`]: _replace(exposures) }, ownWrite());
}

/* -------------------------------------------- */
/*  Prompting and rolling saves (8.10.8)         */
/* -------------------------------------------- */

/** The labels of the initial save's circumstance modifiers (8.10.6). */
const MOD_LABEL = Object.freeze({
    "pinpoint-poisoner": "pf2e-artisans-workshop.Affliction.Mod.Pinpoint",
    "combustible-poison": "pf2e-artisans-workshop.Affliction.Mod.Combustible",
    "held-breath": "pf2e-artisans-workshop.Affliction.Mod.HeldBreath",
});

/** Saves this client prompted or rolled, so a sweep never asks twice (and the cards say so on reload). */
const asked = new Set();
/** Saves being rolled automatically now. */
const rolling = new Set();
/** Consecutive automatic saves per tracker in one catch-up (8.10.7). */
const catchUps = new Map();

/**
 * Prompt (or roll) a pending save on the client responsible for the victim (8.10.8): the owner's (a card and a notification,
 * or a roll at once under `pcSaves: auto`); the active GM's for a victim with no player owner (rolled at once under
 * `npcSaves: auto`); with the owner offline, the save waits and a GM sees "roll for them" (or rolls it, with
 * `gmRollsForOfflinePCs`).
 */
export async function promptSave({ victim, runId, seq, kind, claim = null, def = null, dueAt = null }) {
    const key = `${runId}:${seq}`;
    const settings = afflictionSettings();
    const who = rollerFor({ playerOwned: playerOwned(victim), ownerConnected: ownerOnline(victim), gmConnected: !!game.users.activeGM }, settings);
    const mine = (who.roller === "owner" && !game.user.isGM && victim.isOwner) || (who.roller === "gm" && game.user.isGM);
    if (who.auto && mine && !rolling.has(key) && !asked.has(key)) {
        const tracker = victim.items?.get?.(runId) ?? null;
        // Catch-up (8.10.7): consecutive automatic stage saves of one affliction, each falling due as the last resolves.
        // `roll-each` stops to ask after `catchUpLimit`; `pause` after the first.
        const count = (catchUps.get(runId) ?? 0) + 1;
        const limit = settings.catchUp === "pause" ? 1 : settings.catchUpLimit;
        if (kind === "stage" && count > limit) {
            asked.add(key);
            Hooks.callAll(`${MODULE_ID}.afflictionPrompt`, Object.freeze({ victim, runId, seq, kind, claim, tracker, def, dueAt, paused: true, roller: who.roller }));
            return { ok: true, outcome: "paused" };
        }
        if (kind === "stage") catchUps.set(runId, count);
        rolling.add(key);
        asked.add(key);
        try {
            return await rollSave(victim, { runId, seq }, { skipDialog: true, auto: true });
        } finally {
            rolling.delete(key);
        }
    }
    if (asked.has(key)) return { ok: true, outcome: "asked" };
    asked.add(key);
    Hooks.callAll(`${MODULE_ID}.afflictionPrompt`, Object.freeze({ victim, runId, seq, kind, claim, def, dueAt, waiting: who.waiting ?? null, roller: who.roller }));
    return { ok: true, outcome: "prompted" };
}

/** The save a victim has pending for `runId:seq`: its kind, the claim or tracker behind it, the definition and the DC. */
export async function pendingSave(victim, { runId, seq }) {
    const tracker = victim?.items?.get?.(runId) ?? null;
    const run = runOf(tracker);
    const claim = records("claims").find((c) => c.kind === "exposure" && c.pending?.runId === runId && c.pending?.seq === seq && c.actor === victim?.uuid) ?? null;
    if (claim && !claim.resolved) {
        const def = claim.def ?? await definitionOf(claim.source?.uuid ?? null);
        return { kind: claim.pending.kind, claim, tracker, run, def, dc: claim.dc, source: claim.source, mods: claim.applied ?? [], dueAt: claim.exposedAt ?? clockNow() };
    }
    if (run?.pending?.seq === seq) {
        return { kind: run.pending.kind, claim: null, tracker, run, def: await definitionOfRun(run, tracker), dc: run.dc, source: run.source, mods: [], dueAt: run.pending.dueAt };
    }
    return null;
}

/**
 * The ephemeral item a save is rolled with (8.10.8): the source item at the affliction's level, owned by the victim and never
 * saved, so pf2e applies incapacitation at the item's level and its bonuses against poisons; a weapon-type source (a bomb) as
 * a consumable with its traits and level, so it never becomes the check's weapon context item.
 */
export async function saveItemFor(victim, source) {
    const doc = await fromUuid(source.itemUuid ?? "").catch(() => null) ?? await fromUuid(source.uuid ?? "").catch(() => null);
    const base = doc?.toObject?.() ?? { name: source.name, img: source.img, type: source.type ?? "consumable",
        system: { traits: { value: [...(source.traits ?? [])], rarity: source.rarity ?? "common" } } };
    const data = base.type === "weapon" || base.type === "ammo"
        ? { name: base.name, img: base.img, type: "consumable", system: { category: "poison", traits: { value: [...(source.traits ?? [])], rarity: source.rarity ?? "common" } } }
        : base;
    delete data._id;
    data.system = { ...(data.system ?? {}), level: { value: source.level ?? 0 } };
    return new CONFIG.Item.documentClass(data, { parent: victim });
}

/**
 * Roll a pending save (8.10.8, the cards' Roll button, `api.afflictions.rollPending`): the victim's save statistic with the
 * frozen DC, the ephemeral source item, its roll options and the link option, the initial save's circumstance modifiers.
 * `voluntaryFail` records a failure without a roll (a drug, 8.10.6). Refused: `no-save`, `not-owner`, `no-statistic`,
 * `cancelled`.
 */
export async function rollSave(victimRef, { runId, seq }, { skipDialog, voluntaryFail = false, auto = false } = {}) {
    const victim = actorOf(victimRef);
    if (!victim) return refuse("no-actor");
    if (!victim.isOwner) return refuse("not-owner");
    // A save rolled by hand (Continue after the catch-up pause, a card, the window) starts the count again.
    if (!auto) catchUps.delete(runId);
    const pending = await pendingSave(victim, { runId, seq });
    if (!pending) return refuse("no-save");
    if (voluntaryFail) {
        if (!pending.def?.voluntaryFail || pending.kind !== "initial") return refuse("no-voluntary");
        return recordResult({ victim, runId, seq, degree: DEGREE.fail, messageId: null, isReroll: false });
    }
    const statistic = victim.saves?.[pending.def.save.type] ?? null;
    if (!statistic) return refuse("no-statistic");
    const item = await saveItemFor(victim, pending.source);
    // A re-exposure's save is the initial save against a new exposure (Player Core p.431): its modifiers count too.
    const modifiers = pending.kind === "initial" || pending.kind === "re-exposure" ? initialSaveModifiers(pending.mods).map((m) => new game.pf2e.Modifier({
        slug: m.slug, label: game.i18n.localize(MOD_LABEL[m.slug] ?? "pf2e-artisans-workshop.Affliction.Title"), modifier: m.value, type: "circumstance" })) : [];
    const roll = await statistic.roll({
        dc: { value: pending.dc?.value ?? pending.def.save.value ?? 10, label: game.i18n.localize("pf2e-artisans-workshop.Affliction.SaveDc") },
        item, extraRollOptions: [...(item.getRollOptions?.("item") ?? []), afflictionLink(runId, seq)], modifiers,
        traits: (pending.def.traits ?? []).filter((t) => ["poison", "disease", "curse", "incapacitation", "virulent"].includes(t)),
        label: game.i18n.format("pf2e-artisans-workshop.Affliction.SaveLabel", { name: pending.source?.identified === false && playerOwned(victim)
            ? game.i18n.localize("pf2e-artisans-workshop.Affliction.Generic") : pending.source?.name ?? "" }),
        skipDialog, createMessage: true,
    });
    return roll ? { ok: true, total: roll.total } : refuse("cancelled");
}

/* -------------------------------------------- */
/*  Recording (8.10.8)                           */
/* -------------------------------------------- */

/** `createChatMessage` on every client: the author's tab that holds the lease records an affliction save. */
export async function onAfflictionMessage(message) {
    const context = message.flags?.pf2e?.context;
    const link = parseAfflictionLink(context?.options);
    if (!link || message.author?.id !== game.user.id || !holdsLease()) return null;
    if (!canWrite()) return refuse("not-ready");
    const degree = DEGREE_FROM_OUTCOME[context?.outcome];
    if (degree === undefined) return refuse("no-outcome");
    const victim = message.actor ?? actorOf(context?.actor) ?? null;
    if (!victim) return refuse("no-actor");
    return recordResult({ victim, runId: link.runId, seq: link.seq, degree, messageId: message.id, isReroll: context?.isReroll === true });
}

/** A condition item's facts for the stage plan. */
const conditionFacts = (actor) => [...(actor?.items ?? [])].filter((i) => i.type === "condition").map((c) => ({
    id: c.id, slug: c.slug ?? c.system?.slug, value: c.system?.value?.value ?? null, grantedBy: c.flags?.pf2e?.grantedBy?.id ?? null,
    linked: !!c.system?.references?.parent?.id,
}));

/** The localized stage labels the badge uses. */
const stageLabels = () => ({
    stage: (n) => game.i18n.format("PF2E.Item.Affliction.Stage", { stage: n }),
    onset: game.i18n.localize("PF2E.Item.Affliction.OnsetLabel"),
});

/** A condition item's source, granted by a tracker (8.10.1). */
function conditionSource({ slug, value, linked, onDelete }, trackerId, seq) {
    const condition = game.pf2e?.ConditionManager?.getCondition?.(slug);
    if (!condition) return null;
    const src = condition.toObject();
    src._id = newId();
    if (value !== null && value !== undefined && src.system?.value?.isValued !== false && src.system?.value) src.system.value.value = value;
    src.flags = { ...(src.flags ?? {}), pf2e: { ...(src.flags?.pf2e ?? {}), grantedBy: { id: trackerId, onDelete } },
        [MODULE_ID]: { affliction: { granted: trackerId, seq } } };
    if (linked) src.system = { ...(src.system ?? {}), references: { ...(src.system?.references ?? {}), parent: { id: trackerId } } };
    return src;
}

/** An effect item's source from a stage's effect link, granted by the tracker and removed at the next stage. */
async function stageEffectSource(uuid, trackerId, seq) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) return null;
    const src = doc.toObject();
    src._id = newId();
    src.flags = { ...(src.flags ?? {}), pf2e: { ...(src.flags?.pf2e ?? {}), grantedBy: { id: trackerId, onDelete: "cascade" } },
        [MODULE_ID]: { affliction: { granted: trackerId, seq, stageEffect: true } } };
    return src;
}

/**
 * The item operations that take a victim from its conditions now to a stage's (8.10.1): delete the tracker's linked
 * conditions and stage effects that do not expire on their own, create or update the stage's, and the tracker's own
 * `itemGrants` (always `detach`). `drop` are extra ids to delete first (a superseded result's conditions, 8.10.8).
 */
async function stageOps(victim, trackerId, effects, seq, { drop = [] } = {}) {
    const existing = conditionFacts(victim).filter((c) => !drop.includes(c.id));
    const plan = stageConditionPlan(trackerId, effects?.conditions ?? [], existing, { cumulative: effects?.cumulative ?? [], failed: !!effects?.failed });
    const oldEffects = [...(victim.items ?? [])].filter((i) => i.flags?.[MODULE_ID]?.affliction?.stageEffect && i.flags[MODULE_ID].affliction.granted === trackerId)
        .map((i) => i.id).filter((id) => !drop.includes(id));
    const creates = [];
    const grants = {};
    for (const c of plan.creates) {
        const src = conditionSource(c, trackerId, seq);
        if (!src) continue;
        creates.push(src);
        grants[`flags.pf2e.itemGrants.aff${src._id}`] = { id: src._id, onDelete: "detach" };
    }
    for (const e of effects?.effects ?? []) {
        const src = await stageEffectSource(e.uuid, trackerId, seq);
        if (!src) continue;
        creates.push(src);
        grants[`flags.pf2e.itemGrants.aff${src._id}`] = { id: src._id, onDelete: "detach" };
    }
    const deletes = [...new Set([...drop, ...plan.deletes, ...oldEffects])];
    for (const id of deletes) grants[`flags.pf2e.itemGrants.aff${id}`] = _del;
    const updates = plan.updates.map((u) => ({ _id: u.id, "system.value.value": u.value }));
    return { creates, updates, deletes, grants };
}

/** The items a tracker's deletion takes with it (8.10.1): every grantee whose `grantedBy.onDelete` is `cascade`. */
const cascadeOf = (victim, trackerId) => [...(victim.items ?? [])]
    .filter((i) => i.flags?.pf2e?.grantedBy?.id === trackerId && i.flags.pf2e.grantedBy.onDelete === "cascade").map((i) => i.id);

/** The tracker item data for a run (effect backend, 8.10.1). */
function trackerItem({ id, def, run, victim, snapshot = null }) {
    const source = run.source ?? {};
    const hidden = source.identified === false && playerOwned(victim);
    const allowed = Object.keys(CONFIG.PF2E?.effectTraits ?? {});
    const data = trackerSource({ id, def, run, name: source.name, img: source.img ?? "icons/svg/poison.svg", labels: stageLabels(),
        allowedTraits: allowed.length ? allowed : null, hidden, unidentified: source.identified === false && !playerOwned(victim),
        genericName: game.i18n.localize("pf2e-artisans-workshop.Affliction.Generic"), genericImg: "icons/svg/poison.svg" });
    data.flags[MODULE_ID] = { affliction: { v: 1, run, system: systemSource(def, run), ...(snapshot ? { def: snapshot } : {}) } };
    return data;
}

/** The tracker's update for a run (its run state, badge and the affliction schema). */
function trackerUpdate(tracker, def, run) {
    return {
        _id: tracker.id, [`flags.${MODULE_ID}.affliction.run`]: _replace(run), [`flags.${MODULE_ID}.affliction.system`]: _replace(systemSource(def, run)),
        ...(tracker.type === "effect" ? { "system.badge": badgeOf(def, run, stageLabels()) } : { "system.status.stage": Math.max(1, run.stage || 1),
            "system.status.progress": run.streak ?? 0 }),
    };
}

/**
 * Record a save's result (8.10.8) on the client of the user who rolled it (the owner or a GM, who may write the victim): the
 * first result for a save stands; a reroll replaces it once the original message is gone; then, behind the save's lock page,
 * the claim is resolved and the tracker created, changed or ended with its stage conditions. Damage is posted after, as a
 * pf2e damage roll.
 */
export async function recordResult({ victim, runId, seq, degree, messageId, isReroll = false }) {
    const tracker = victim.items?.get?.(runId) ?? null;
    const claim = records("claims").find((c) => c.kind === "exposure" && c.pending?.runId === runId && c.pending?.seq === seq && c.actor === victim.uuid) ?? null;
    const run0 = runOf(tracker);
    const had = run0?.saves?.[seq] ?? null;
    let kind = claim?.pending?.kind ?? (run0?.pending?.seq === seq ? run0.pending.kind : had?.kind ?? null);
    if (!kind && claim?.save && isReroll) kind = claim.pending?.kind ?? "initial";
    if (!kind) return refuse("no-save");
    // The affliction a re-exposure was rolled against ended before the save was recorded: the exposure starts it again, as a
    // new initial exposure (8.10.3), on a tracker of the same id.
    if (kind === "re-exposure" && (!run0 || run0.phase === "ended")) kind = "initial";
    if (claim?.resolved && !isReroll && !tracker) return refuse("already");
    const def = claim?.def ?? await definitionOfRun(run0 ?? { source: claim?.source }, tracker);
    if (!runnable(def)) return refuse("no-definition");
    const recordedId = had?.messageId ?? claim?.save?.messageId ?? null;
    const originalGone = !recordedId || !game.messages?.get?.(recordedId);
    if (claim?.save && !had && !isReroll) return refuse("already");
    if (claim?.save && !had && isReroll && !originalGone) return refuse("already");
    const base = run0 ?? newRun({ id: runId, source: claim.source, defKey: claim.defKey, dc: claim.dc, mods: claim.applied ?? [], by: claim.by, at: claim.at });
    const dueAt = kind === "stage" ? run0?.pending?.dueAt ?? had?.dueAt ?? clockNow() : claim?.exposedAt ?? had?.dueAt ?? clockNow();
    const origin = claim?.combat?.initiative ?? base.anchor?.initiative ?? null;
    const result = recordSave(base, def, { seq, kind, degree, dueAt, messageId, isReroll, originalGone },
        { anchor: anchorNow(victim, origin), ...(kind === "re-exposure" && claim ? { mods: claim.applied ?? [] } : {}) });
    if (!result.ok) {
        Hooks.callAll(`${MODULE_ID}.afflictionNotice`, Object.freeze({ victim, reason: result.reason, runId, seq }));
        return result;
    }
    const rolls = (had?.rolls ?? (claim?.save ? claim.save.rolls ?? 1 : 0));
    const run = { ...result.run, by: game.user.id };
    if (claim) run.exposures = { ...(run.exposures ?? {}), [claim.id]: { at: dueAt, degree: result.run.saves[seq].degree } };
    const superseded = result.superseded ? [...(victim.items ?? [])].filter((i) => i.flags?.[MODULE_ID]?.affliction?.granted === runId &&
        i.flags[MODULE_ID].affliction.seq === seq).map((i) => i.id) : [];
    const lockId = hashId(saveLockKey(runId, seq, rolls));
    const ledger = claim ? { set: { [`claims.${claim.id}.resolved`]: stampNow(), [`claims.${claim.id}.outcome`]: result.ended ? "unaffected" : "afflicted",
        [`claims.${claim.id}.save`]: { degree: result.run.saves[seq].degree, messageId, rolls: rolls + 1 } } } : null;
    const lock = [{ op: "lock", ids: [lockId] }, ...(ledger ? [{ op: "ledger", change: ledger }] : [])];
    const apply = [];
    const ended = result.run.phase === "ended";
    let posted = null;
    if (ended) {
        if (tracker) apply.push({ op: "deleteItems", target: victim.uuid, ids: [...new Set([tracker.id, ...cascadeOf(victim, tracker.id), ...superseded])], options: ownWrite() });
    } else if (backend() === "native" && run.phase === "active" && (!tracker || tracker.type === "effect")) {
        // Native backend (8.10.1): the native item is created once the first stage takes effect; pf2e applies its stage.
        const native = nativeItem({ id: tracker ? newId() : runId, def, run, victim, claim });
        if (tracker) apply.push({ op: "deleteItems", target: victim.uuid, ids: [tracker.id, ...cascadeOf(victim, tracker.id)], options: ownWrite() });
        apply.push({ op: "createItems", target: victim.uuid, data: [native], options: ownWrite() });
        posted = "native";
    } else {
        const ops = result.effects && (tracker?.type !== "affliction" || result.effects.repeat) ? await stageOps(victim, runId, result.effects, seq, { drop: superseded }) : null;
        if (!tracker) {
            const data = trackerItem({ id: runId, def, run, victim, snapshot: claim?.def ?? null });
            Object.assign(data.flags.pf2e.itemGrants, Object.fromEntries(Object.entries(ops?.grants ?? {}).filter(([, v]) => v !== _del)
                .map(([k, v]) => [k.replace("flags.pf2e.itemGrants.", ""), v])));
            apply.push({ op: "createItems", target: victim.uuid, data: [data, ...(ops?.creates ?? [])], options: ownWrite() });
        } else {
            apply.push({ op: "updateItems", target: victim.uuid, updates: [{ ...trackerUpdate(tracker, def, run), ...(ops?.grants ?? {}) }, ...(ops?.updates ?? [])], options: ownWrite() });
            if (ops?.creates.length) apply.push({ op: "createItems", target: victim.uuid, data: ops.creates, options: ownWrite() });
            if (ops?.deletes.length) apply.push({ op: "deleteItems", target: victim.uuid, ids: ops.deletes, options: ownWrite() });
        }
    }
    const outcome = await runLockFirst({ lock, apply });
    if (outcome.outcome === "conflict") {
        Hooks.callAll(`${MODULE_ID}.afflictionNotice`, Object.freeze({ victim, reason: "already", runId, seq }));
        return refuse("already");
    }
    if (outcome.outcome !== "ok") return refuse(outcome.reason ?? "error", { outcome: outcome.outcome });
    catchUps.set(runId, kind === "stage" ? catchUps.get(runId) ?? 0 : 0);
    const now = victim.items?.get?.(runId) ?? null;
    if (result.effects && posted !== "native" && !(now?.type === "affliction" && !result.effects.repeat)) await postStageDamage(victim, run, result.effects, seq);
    if (result.effects?.repeat && now?.type === "affliction") await now.createStageMessage?.();
    if (result.extras?.length) await postDamage(victim, run, result.extras, { seq, label: "pf2e-artisans-workshop.Affliction.Extra" });
    const reason = kind === "stage" ? "stage" : kind;
    Hooks.callAll(`${MODULE_ID}.afflictionChanged`, Object.freeze({ actor: victim, affliction: runId, from: result.run.saves[seq].fromStage,
        to: ended ? 0 : run.stage, reason, run, seq, degree: result.run.saves[seq].degree, reroll: !!result.superseded, phase: run.phase }));
    scheduleProcess(0);
    sweepWaiting(victim);
    return { ok: true, run, ended };
}

/** An exposure of a victim that waited behind its affliction's due events (a re-exposure, 8.10.8) goes on once they are applied. */
function sweepWaiting(victim) {
    if (openExposures().some((c) => c.actor === victim.uuid && !c.pending)) sweepClaims().catch((error) => console.warn(`${MODULE_ID} | exposure sweep failed`, error));
}

/** The native item for a run (8.10.1, native backend): the schema, the run state, created once a stage is active. */
function nativeItem({ id, def, run: given, victim, claim }) {
    const run = { ...given, id };
    const source = run.source ?? {};
    return {
        _id: id, type: "affliction", name: source.identified === false && playerOwned(victim) ? game.i18n.localize("pf2e-artisans-workshop.Affliction.Generic") : source.name,
        img: source.img ?? "icons/svg/poison.svg", system: systemSource(def, run),
        flags: { [MODULE_ID]: { affliction: { v: 1, run, system: systemSource(def, run), ...(claim?.def ? { def: claim.def } : {}) } } },
    };
}

/* -------------------------------------------- */
/*  Damage (8.10.1)                              */
/* -------------------------------------------- */

/** A pf2e damage roll formula from damage entries: `{(1d4)[poison],(1d6)[persistent,fire]}`. */
export function damageFormula(damage) {
    const instances = damage.map((d) => `(${d.formula})[${[d.category, d.damageType].filter(Boolean).join(",")}]`);
    return instances.length ? `{${instances.join(",")}}` : null;
}

/** Post a stage's damage as a pf2e damage roll card (applied by the system's buttons; `autoApplyDamage` applies it). */
async function postStageDamage(victim, run, effects, seq) {
    if (!effects?.damage?.length) return null;
    return postDamage(victim, run, effects.damage, { seq, stage: effects.stage });
}

/** Post damage entries as a pf2e damage roll message, flagged with the run and save so a reroll can mark it superseded. */
async function postDamage(victim, run, damage, { seq, stage = null, label = null }) {
    const formula = damageFormula(damage);
    if (!formula) return null;
    try {
        const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll") ?? Roll;
        const roll = await new DamageRoll(formula).evaluate();
        const name = run.source?.identified === false && playerOwned(victim) ? game.i18n.localize("pf2e-artisans-workshop.Affliction.Generic") : run.source?.name ?? "";
        const flavor = label ? game.i18n.format(label, { name }) : game.i18n.format("pf2e-artisans-workshop.Affliction.DamageFlavor", { name, stage: String(stage ?? run.stage) });
        const message = await roll.toMessage({
            speaker: ChatMessage.implementation.getSpeaker({ actor: victim }), flavor,
            flags: { pf2e: { context: { type: "damage-roll", sourceType: "save", outcome: "failure", domains: [], options: [], traits: [...(run.source?.traits ?? [])] } },
                [MODULE_ID]: { affliction: { run: run.id, seq, rolls: run.saves?.[seq]?.rolls ?? 1, damage: true } } },
        });
        if (afflictionSettings().autoApplyDamage && typeof victim.applyDamage === "function") {
            const token = victim.getActiveTokens?.(true, true)?.[0]?.document ?? victim.prototypeToken ?? null;
            await victim.applyDamage({ damage: roll, token, skipIWR: false });
        }
        return message;
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post affliction damage`, error);
        return null;
    }
}

/* -------------------------------------------- */
/*  Timing (8.10.7)                              */
/* -------------------------------------------- */

/** The processing running on this client, and whether another was asked for meanwhile (single-flight, as expiry's sweep). */
let processing = null;
let again = false;

/**
 * Process every tracker this tab is responsible for (8.10.7): onset ends and maximum durations at their own moments, in time
 * order, then the first stage save that is due (pending, prompted or rolled). Idempotent (P5).
 * @returns {Promise<{applied: object[], due: object[]}>}
 */
export function processAfflictions() {
    if (processing) {
        again = true;
        return processing;
    }
    processing = (async () => {
        const out = { applied: [], due: [] };
        try {
            do {
                again = false;
                const pass = await processOnce();
                out.applied.push(...pass.applied);
                out.due.push(...pass.due);
            } while (again);
            return out;
        } finally {
            processing = null;
        }
    })();
    return processing;
}

/** One pass of `processAfflictions`. */
async function processOnce() {
    const out = { applied: [], due: [] };
    if (!afflictionsOn() || !canWrite()) return out;
    const now = clockNow();
    for (const victim of afflictionActors()) {
        const trackers = trackersOf(victim);
        if (!trackers.length || !isResponsibleFor(victim)) continue;
        for (const tracker of trackers) {
            try {
                const result = await processTracker(victim, tracker, now);
                if (result?.applied?.length) out.applied.push(...result.applied);
                if (result?.due) out.due.push(result.due);
            } catch (error) {
                console.warn(`${MODULE_ID} | could not process an affliction on ${victim.name}`, error);
            }
        }
    }
    return out;
}

/** Process one tracker: its automatic events, then its first due save. */
async function processTracker(victim, tracker, now) {
    let run = runOf(tracker);
    const def = await definitionOfRun(run, tracker);
    if (!runnable(def)) return null;
    // A pending save another client recorded meanwhile (its result replaced the run, and this client's pending landed after
    // it): it is stale, so it goes, and the next due save follows (8.10.8).
    if (run.pending && run.saves?.[run.pending.seq]) {
        await tracker.update({ [`flags.${MODULE_ID}.affliction.run.pending`]: null }, ownWrite());
        run = { ...run, pending: null };
    }
    if (run.pending) {
        await promptSave({ victim, runId: tracker.id, seq: run.pending.seq, kind: run.pending.kind, def, dueAt: run.pending.dueAt });
        return { due: { victim: victim.uuid, tracker: tracker.id, seq: run.pending.seq } };
    }
    // A re-exposure whose save is pending came first (8.10.8): the clock's events wait until it is recorded.
    if (openExposures().some((c) => c.pending?.runId === tracker.id && c.pending.kind === "re-exposure")) return { applied: [] };
    const step = advance(run, def, now, { combat: combatState(run.anchor), anchor: run.anchor ?? anchorNow(victim) });
    const applied = [];
    const current = step.run;
    if (step.steps.length) {
        for (const s of step.steps) applied.push({ victim: victim.uuid, tracker: tracker.id, kind: s.kind, at: s.at });
        if (current.phase === "ended") {
            await endTracker(victim, tracker, { reason: "max-duration" });
            Hooks.callAll(`${MODULE_ID}.afflictionChanged`, Object.freeze({ actor: victim, affliction: tracker.id, from: run.stage, to: 0, reason: "max-duration", run: current }));
            sweepWaiting(victim);
            return { applied };
        }
        const entered = step.steps.findLast((s) => s.effects);
        const fresh = victim.items.get(tracker.id);
        if (!fresh || !sameProgress(runOf(fresh), run)) return { applied: [] };   // another client moved it meanwhile: the next pass decides
        await writeTransition(victim, fresh, def, current, entered?.effects ?? null, { reason: "onset" });
        Hooks.callAll(`${MODULE_ID}.afflictionChanged`, Object.freeze({ actor: victim, affliction: tracker.id, from: run.stage, to: current.stage, reason: "onset", run: current }));
        if (!step.save) sweepWaiting(victim);
    }
    if (step.save) {
        const seq = nextSeq(current, tracker.id);
        const pending = { seq, kind: "stage", dueAt: step.save.at };
        // Only the pending key is written, never the run whole: a result another client records at the same moment replaces
        // the run, and must not be overwritten by this client's older copy of it.
        const fresh = victim.items.get(tracker.id);
        if (!fresh || !sameProgress(runOf(fresh), current)) return { applied };
        await fresh.update({ [`flags.${MODULE_ID}.affliction.run.pending`]: pending }, ownWrite());
        await promptSave({ victim, runId: tracker.id, seq, kind: "stage", def, dueAt: step.save.at });
        return { applied, due: { victim: victim.uuid, tracker: tracker.id, seq } };
    }
    catchUps.delete(tracker.id);
    return { applied };
}

/** Whether two copies of a run are at the same point (phase, stage and recorded saves): nothing landed between the two reads. */
const sameProgress = (a, b) => !!a && !!b && a.phase === b.phase && a.stage === b.stage &&
    Object.keys(a.saves ?? {}).length === Object.keys(b.saves ?? {}).length && (a.seq ?? 0) === (b.seq ?? 0);

/** Write a transition the clock made (an onset ending): the run, and the stage's conditions and damage. */
async function writeTransition(victim, tracker, def, run, effects, { reason }) {
    if (backend() === "native" && run.phase === "active" && tracker.type === "effect") {
        await runRequest([
            { op: "deleteItems", target: victim.uuid, ids: [tracker.id, ...cascadeOf(victim, tracker.id)], options: ownWrite() },
            { op: "createItems", target: victim.uuid, data: [nativeItem({ id: newId(), def, run, victim, claim: null })], options: ownWrite() },
        ]);
        return;
    }
    // A native item applies a changed stage itself (pf2e's `handleStageChange`); a repeated one, and every effect-backed one, is
    // the module's (8.10.1, native constraints).
    const native = tracker.type === "affliction";
    const ops = effects && (!native || effects.repeat) ? await stageOps(victim, tracker.id, effects, run.seq ?? 0) : null;
    await runRequest([
        { op: "updateItems", target: victim.uuid, updates: [{ ...trackerUpdate(tracker, def, run), ...(ops?.grants ?? {}) }, ...(ops?.updates ?? [])], options: ownWrite() },
        ...(ops?.creates.length ? [{ op: "createItems", target: victim.uuid, data: ops.creates, options: ownWrite() }] : []),
        ...(ops?.deletes.length ? [{ op: "deleteItems", target: victim.uuid, ids: ops.deletes, options: ownWrite() }] : []),
    ]);
    if (native && effects?.repeat && reason === "onset") await victim.items.get(tracker.id)?.createStageMessage?.();
    else if (!native && effects && reason === "onset") await postStageDamage(victim, run, effects, run.seq ?? 0);
}

/**
 * End a tracker (8.10.6, 8.10.10): delete it and what it granted that cascades; the six expiring conditions and unlinked ones
 * stay, as the rules say (drained 1 outlives a poison whose maximum duration ran out).
 */
export async function endTracker(victim, tracker, { reason = "manual" } = {}) {
    const ids = [tracker.id, ...cascadeOf(victim, tracker.id)];
    await victim.deleteEmbeddedDocuments("Item", ids, ownWrite({ [MODULE_ID]: { affliction: true, reason } }));
    catchUps.delete(tracker.id);
    return { ok: true };
}

/** Process once changes stop for a moment (world time moves in small steps). */
let timer = null;
export function scheduleProcess(ms = 300) {
    clearTimeout(timer);
    timer = setTimeout(() => {
        processAfflictions().catch((error) => console.error(`${MODULE_ID} | affliction processing failed`, error));
    }, ms);
}

/* -------------------------------------------- */
/*  Manual changes and the stage guard (8.10.9)  */
/* -------------------------------------------- */

/**
 * A manual change to an affliction (8.10.9, `api.afflictions.adjust`, the drawer's reduce and end, the stage guard): `stage`
 * moves it to that stage (its conditions applied from the run, no damage rolled), `end` ends it, `endOnset` ends an onset
 * now, `undo` takes the last manual change back. Its author is recorded; every manual change can be undone. Refused:
 * `no-affliction`, `not-owner`, `nothing`.
 */
export async function adjust(trackerRef, { stage = null, end = false, endOnset = false, undo = false } = {}) {
    const tracker = typeof trackerRef === "string" ? fromUuidSync(trackerRef, { strict: false }) : trackerRef;
    const victim = tracker?.parent ?? null;
    const run = runOf(tracker);
    if (!tracker || !victim || !run) return refuse("no-affliction");
    if (!victim.isOwner) return refuse("not-owner");
    const def = await definitionOfRun(run, tracker);
    const stamp = stampNow();
    if (end) {
        await snapshotEnded(victim, tracker, stamp);
        await endTracker(victim, tracker, { reason: "manual" });
        Hooks.callAll(`${MODULE_ID}.afflictionChanged`, Object.freeze({ actor: victim, affliction: tracker.id, from: run.stage, to: 0, reason: "manual", run, by: game.user.id }));
        return { ok: true, outcome: "ended" };
    }
    const log = { ...(run.manual ?? {}) };
    let next;
    let effects;
    if (undo) {
        const last = Object.keys(log).map(Number).sort((a, b) => b - a)[0];
        if (!Number.isInteger(last)) return refuse("nothing");
        next = undoManual(run, log[last]);
        delete log[last];
        effects = next.phase === "active" ? { stage: next.stage, ...stageEffects(def, next.stage, next.mods) } : null;
    } else if (endOnset) {
        if (run.phase !== "onset") return refuse("nothing");
        const entry = manualEntry(run, { kind: "end-onset", toStage: run.stage, by: game.user.id, at: stamp.at });
        const { enterStage } = await import("../logic/affliction.mjs");
        const step = enterStage(run, def, Math.max(1, run.stage), clockNow(), { anchor: anchorNow(victim, run.anchor?.initiative ?? null) });
        next = step.run;
        effects = step.effects;
        log[Object.keys(log).length + 1] = entry;
    } else {
        const target = Math.round(Number(stage));
        if (!Number.isInteger(target)) return refuse("nothing");
        if (target < 1) return adjust(tracker, { end: true });
        const max = def.stages.length || 1;
        const to = Math.min(max, target);
        if (to === run.stage && run.phase === "active") return refuse("nothing");
        const entry = manualEntry(run, { kind: "stage", toStage: to, by: game.user.id, at: stamp.at });
        next = { ...run, stage: to, phase: run.phase === "onset" ? "onset" : "active" };
        effects = next.phase === "active" ? { stage: to, ...stageEffects(def, to, run.mods) } : null;
        log[Object.keys(log).length + 1] = entry;
    }
    next = { ...next, manual: log, pending: run.pending };
    await writeTransition(victim, tracker, def, next, effects, { reason: "manual" });
    Hooks.callAll(`${MODULE_ID}.afflictionChanged`, Object.freeze({ actor: victim, affliction: tracker.id, from: run.stage, to: next.stage, reason: "manual", run: next, by: game.user.id }));
    return { ok: true, outcome: undo ? "undone" : "adjusted", stage: next.stage };
}

/** Keep an ended tracker's source on its actor, so a manual end can be undone (8.10.9). */
async function snapshotEnded(victim, tracker, stamp) {
    const source = tracker.toObject();
    await victim.update({ [`flags.${MODULE_ID}.afflictionEnded.${tracker.id}`]: { source, by: stamp.by, at: stamp.at } });
}

/** Undo a manual end (8.10.9): the tracker is created again from its snapshot, and its stage's conditions re-applied. */
export async function undoEnd(victimRef, runId) {
    const victim = actorOf(victimRef);
    const snap = victim?.flags?.[MODULE_ID]?.afflictionEnded?.[runId];
    if (!victim || !snap) return refuse("nothing");
    if (!victim.isOwner) return refuse("not-owner");
    if (victim.items.get(runId)) return refuse("nothing");
    await victim.createEmbeddedDocuments("Item", [snap.source], ownWrite({ keepId: true }));
    await victim.update({ [`flags.${MODULE_ID}.afflictionEnded.${runId}`]: _del });
    const tracker = victim.items.get(runId);
    if (tracker) await repair(tracker);
    return { ok: true, outcome: "restored" };
}

/** Repair (8.10.10): the current stage's conditions re-applied from the run state, without rolling damage again. */
export async function repair(trackerRef) {
    const tracker = typeof trackerRef === "string" ? fromUuidSync(trackerRef, { strict: false }) : trackerRef;
    const victim = tracker?.parent;
    const run = runOf(tracker);
    if (!tracker || !victim || !run) return refuse("no-affliction");
    if (!victim.isOwner) return refuse("not-owner");
    if (run.phase !== "active") return refuse("nothing");
    const def = await definitionOfRun(run, tracker);
    const ops = await stageOps(victim, tracker.id, { stage: run.stage, ...stageEffects(def, run.stage, run.mods) }, run.seq ?? 0);
    await runRequest([
        { op: "updateItems", target: victim.uuid, updates: [{ _id: tracker.id, ...ops.grants }, ...ops.updates], options: ownWrite() },
        ...(ops.creates.length ? [{ op: "createItems", target: victim.uuid, data: ops.creates, options: ownWrite() }] : []),
    ]);
    return { ok: true, outcome: "repaired" };
}

/** The stage a change to a tracker asks for, or null when it does not touch the stage (8.10.1, the stage guard). */
function requestedStage(item, changed) {
    const system = changed?.system ?? {};
    if (system.badge && Number.isFinite(system.badge.value)) return { stage: system.badge.value };
    if (system.status && Number.isFinite(system.status.stage)) return { stage: system.status.stage };
    // pf2e's native `increase()` ends an onset by deleting `system.onset` (8.10.1): an "end onset" adjust.
    if (item.type === "affliction" && "onset" in system) return { endOnset: true };
    return null;
}

/** Hooks at `init`: claims, recording, timing, the stage guard. */
export function registerAfflictionHooks() {
    registerClaimKind("exposure", (claim, actor) => applyExposure(claim, actor), { responsible: exposureResponsible });
    Hooks.on("createChatMessage", (message) => {
        onAfflictionMessage(message).catch((error) => console.error(`${MODULE_ID} | could not record an affliction save`, error));
    });
    Hooks.on("updateWorldTime", () => {
        if (afflictionsOn()) scheduleProcess(500);
    });
    Hooks.on("combatTurnChange", () => {
        if (afflictionsOn()) scheduleProcess(0);
    });
    Hooks.on("deleteCombat", () => {
        if (afflictionsOn()) scheduleProcess(0);
    });
    // Days logged by the wizard move the affliction clock (8.10.7).
    Hooks.on("updateJournalEntry", (doc, changed) => {
        const flags = changed?.flags?.[MODULE_ID] ?? {};
        if (afflictionsOn() && "manual" in (flags.meta ?? {})) scheduleProcess(200);
    });
    Hooks.on("userConnected", () => {
        if (afflictionsOn()) {
            asked.clear();
            scheduleProcess(500);
        }
    });
    // The stage guard (8.10.1): a change to a tracker the module did not make, on the client that makes it.
    Hooks.on("preUpdateItem", (item, changed, options, userId) => {
        if (!isTracker(item) || options?.[MODULE_ID]?.affliction || userId !== game.user.id) return true;
        const request = requestedStage(item, changed);
        if (!request) return true;
        adjust(item, request).catch((error) => console.warn(`${MODULE_ID} | could not adjust an affliction`, error));
        return false;
    });
    Hooks.on("preDeleteItem", (item, options, userId) => {
        if (!isTracker(item) || options?.[MODULE_ID]?.affliction || userId !== game.user.id) return true;
        const victim = item.parent;
        const run = runOf(item);
        snapshotEnded(victim, item, stampNow()).catch(() => null);
        Hooks.callAll(`${MODULE_ID}.afflictionChanged`, Object.freeze({ actor: victim, affliction: item.id, from: run?.stage ?? 0, to: 0, reason: "manual", run, by: game.user.id }));
        return true;
    });
}

/** At `ready`: the catch-up (8.10.8: pending saves and claims for every actor this client is responsible for) and the migration. */
export async function readyAfflictions() {
    if (!afflictionsOn()) return;
    await migrateToNative().catch((error) => console.warn(`${MODULE_ID} | affliction migration failed`, error));
    scheduleProcess(1000);
}

/**
 * The migration to native items (8.10.1, 4.14, OQ-44), the first time a GM loads a world where pf2e ships the type: each
 * effect-backed tracker with an active stage is deleted together with the conditions it granted that are not expiring, then
 * created as a native item (whose `_onCreate` re-applies the stage and posts its damage once more).
 */
export async function migrateToNative() {
    if (backend() !== "native" || !game.user.isGM || game.users.activeGM?.id !== game.user.id) return 0;
    let moved = 0;
    for (const victim of afflictionActors()) {
        for (const tracker of trackersOf(victim).filter((t) => t.type === "effect" && runOf(t).phase === "active")) {
            const run = runOf(tracker);
            const def = await definitionOfRun(run, tracker);
            await runRequest([
                { op: "deleteItems", target: victim.uuid, ids: [tracker.id, ...cascadeOf(victim, tracker.id)], options: ownWrite() },
                { op: "createItems", target: victim.uuid, data: [nativeItem({ id: newId(), def, run: { ...run, migrated: true }, victim, claim: null })], options: ownWrite() },
            ]);
            moved += 1;
        }
    }
    return moved;
}

/* -------------------------------------------- */
/*  Reads for the interface and the API          */
/* -------------------------------------------- */

/** The pending saves of an actor: exposure claims waiting for their initial save, and trackers with a save due (8.10.8). */
export function pendingOf(actor) {
    const out = [];
    for (const claim of openExposures().filter((c) => c.actor === actor?.uuid)) out.push({ kind: claim.pending?.kind ?? "initial", claim, runId: claim.pending?.runId ?? claim.run,
        seq: claim.pending?.seq ?? 1, source: claim.source });
    for (const tracker of trackersOf(actor).filter((t) => runOf(t).pending)) {
        const run = runOf(tracker);
        out.push({ kind: run.pending.kind, tracker, runId: tracker.id, seq: run.pending.seq, source: run.source, dueAt: run.pending.dueAt });
    }
    return out;
}

/** How many saves the user's characters have pending (the Workshop header, 10.2). */
export function pendingCount(actors) {
    return actors.reduce((n, actor) => n + pendingOf(actor).length, 0);
}

/** Roll every pending save of an actor this user may roll, in order (11.1 macro 23). */
export async function rollPending(actorRef, { skipDialog } = {}) {
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    const results = [];
    for (const p of pendingOf(actor)) results.push(await rollSave(actor, { runId: p.runId, seq: p.seq }, { skipDialog }));
    return { ok: true, results };
}

/** For tests only. */
export function resetAfflictions() {
    asked.clear();
    rolling.clear();
    catchUps.clear();
    clearTimeout(timer);
    timer = null;
    processing = null;
    again = false;
}
