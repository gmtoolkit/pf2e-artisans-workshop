/**
 * Vial gathering on this client (DESIGN.md 8.7, M8): versatile vials regained during the day, written through pf2e's own
 * resource (`actor.updateResource("versatile-vials", n)`, which clamps to the maximum and keeps the vial item's quantity,
 * the count pf2e reads). The vial item is never deleted or made again (7.3).
 *
 * - **As world time passes** (`features.vialGathering`, off by default, P10): on `updateWorldTime`, which fires on every
 *   client, each character's responsible client (5.6) adds 2 vials per full 10 minutes (3 with Alchemical Expertise),
 *   carrying the remainder in `flags.MOD.vialClock`; never while the character is in a started encounter or in downtime,
 *   and only for a character with a source that regains (the registry's `vialSource {regain: true}`).
 * - **Buttons** (with the combat features on): "Gather reagents (10 minutes)", logged to chat; Improvise Admixture (a
 *   Crafting check against the character's level DC: 3, 2, 1 or no vials, once a day through the feat's own frequency);
 *   the Alchemist's Haversack's daily vial (once a preparation cycle). Extra Vial is not in pf2e's familiar abilities
 *   (OQ-28), so it has no button.
 * - **The cap.** The value is read again just before writing and written with `updateResource`, which clamps: a second
 *   click or a second client never pushes past the maximum. Advanced Vials' buckets follow the new count (plain vials).
 */
import { MODULE_ID } from "../constants.mjs";
import { VIAL_RESOURCE } from "../logic/alchemy.mjs";
import { levelDC } from "../logic/dc.mjs";
import { vialSources } from "../logic/morning.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { admixtureVials, gatherOver, gatherRate, regainTo, regains } from "../logic/vials.mjs";
import { runRequest } from "./batch.mjs";
import { combatRefusal, inCombat } from "./combat.mjs";
import { statusOf } from "./downtime.mjs";
import { syncVials, vialsOf } from "./morning.mjs";
import { heldKeysOf } from "./registry.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { rulesFromSettings, setting } from "./settings.mjs";
import { canWrite } from "./state.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (value) => (typeof value === "string" ? fromUuidSync(value, { strict: false }) : value ?? null);

/** Whether vials regain as world time passes (14.1 `features.vialGathering`, with the combat features on). */
export const gatheringOn = () => combatRefusal() === null && setting("features.vialGathering") === true;

/** What a character's vials can do during the day (8.7): the resource, its sources, whether they regain, the rate. */
export function vialFacts(actor) {
    const held = heldKeysOf(actor);
    const sources = vialSources(held, rulesFromSettings());
    const admixture = [...(actor?.items ?? [])].find((item) => item.slug === "improvise-admixture" && item.type === "feat") ?? null;
    return {
        vials: vialsOf(actor), sources, regains: regains(sources), per10: gatherRate(held, rulesFromSettings()),
        clock: Number(actor?.flags?.[MODULE_ID]?.vialClock ?? 0) || 0,
        admixture: admixture ? { id: admixture.id, value: admixture.frequency?.value ?? admixture.system?.frequency?.value ?? 0,
            max: admixture.frequency?.max ?? admixture.system?.frequency?.max ?? 1 } : null,
        haversack: held.includes("alchemists-haversack"),
        haversackUsed: actor?.flags?.[MODULE_ID]?.combat?.haversack === (statusOf(actor).prepCycle ?? 0),
    };
}

/**
 * Add `add` vials to a character (8.7), reading the resource again just before writing; `updateResource` clamps to the
 * maximum. Returns `{from, to, gained}`.
 */
async function regain(actor, add) {
    const resource = actor.getResource?.(VIAL_RESOURCE);
    if (!resource) return { from: 0, to: 0, gained: 0 };
    const { to, gained } = regainTo({ value: resource.value ?? 0, max: resource.max ?? 0, add });
    if (gained > 0) {
        await actor.updateResource(VIAL_RESOURCE, to);
        await syncVials(actor);
    }
    return { from: resource.value ?? 0, to: actor.getResource?.(VIAL_RESOURCE)?.value ?? to, gained };
}

/** The common checks of a button (8.7). */
function buttonRefusal(actor) {
    const off = combatRefusal();
    if (off) return off;
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    if (!vialsOf(actor)) return refuse("no-vials-resource");
    return null;
}

/**
 * "Gather reagents" (8.7, macro 16): `minutes` of gathering in exploration, 2 vials per full 10 (3 with Alchemical
 * Expertise), up to the maximum, logged to chat. Refused: `combat-off`, `duct-tape`, `no-actor`, `not-owner`,
 * `no-vials-resource`, `no-regain`, `in-combat`, `full`, `minutes`.
 */
export async function gatherReagents(actorRef, { minutes = 10 } = {}) {
    const actor = actorOf(actorRef);
    const no = buttonRefusal(actor);
    if (no) return no;
    const facts = vialFacts(actor);
    if (!facts.regains) return refuse("no-regain");
    if (inCombat(actor)) return refuse("in-combat");
    if (facts.vials.value >= facts.vials.max) return refuse("full");
    const add = Math.floor((Number(minutes) || 0) / 10) * facts.per10;
    if (add <= 0) return refuse("minutes");
    const result = await regain(actor, add);
    Hooks.callAll(`${MODULE_ID}.vialsRegained`, Object.freeze({ actor, ...result, why: "gather", minutes }));
    return { ok: true, ...result };
}

/**
 * Improvise Admixture (8.7, macro 17): a Crafting check against the character's level DC (pf2e's own check, its own
 * dialog), regaining 3, 2, 1 or no vials by degree up to the maximum; the feat's frequency is used. Refused as the
 * buttons are, and `no-feat`, `frequency`, `full`, `cancelled`.
 */
export async function improviseAdmixture(actorRef, { skipDialog } = {}) {
    const actor = actorOf(actorRef);
    const no = buttonRefusal(actor);
    if (no) return no;
    const facts = vialFacts(actor);
    if (!facts.admixture) return refuse("no-feat");
    if (facts.admixture.value <= 0) return refuse("frequency");
    if (facts.vials.value >= facts.vials.max) return refuse("full");
    const statistic = actor.skills?.crafting;
    if (!statistic) return refuse("no-skill", { skill: "crafting" });
    const dc = levelDC(actor.level ?? 1, { pwol: game.pf2e?.settings?.variants?.pwol?.enabled === true });
    const roll = await statistic.roll({
        dc: { value: dc }, label: game.i18n.localize("pf2e-artisans-workshop.Vials.Admixture"), skipDialog, createMessage: true,
        extraRollOptions: ["action:improvise-admixture"],
    });
    if (!roll) return refuse("cancelled");
    const feat = actor.items.get(facts.admixture.id);
    await feat?.update({ "system.frequency.value": Math.max(0, facts.admixture.value - 1) });
    const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess ?? null;
    const result = await regain(actor, admixtureVials(degree));
    Hooks.callAll(`${MODULE_ID}.vialsRegained`, Object.freeze({ actor, ...result, why: "admixture", degree }));
    return { ok: true, degree, ...result };
}

/**
 * The Alchemist's Haversack's daily vial (8.7): one vial from its second compartment, once each preparation cycle, while
 * the haversack is worn and invested. Refused as the buttons are, and `no-item`, `frequency`, `full`.
 */
export async function haversackVial(actorRef) {
    const actor = actorOf(actorRef);
    const no = buttonRefusal(actor);
    if (no) return no;
    const facts = vialFacts(actor);
    if (!facts.haversack) return refuse("no-item");
    if (facts.haversackUsed) return refuse("frequency");
    if (facts.vials.value >= facts.vials.max) return refuse("full");
    await actor.update({ [`flags.${MODULE_ID}.combat.haversack`]: statusOf(actor).prepCycle ?? 0 });
    const result = await regain(actor, 1);
    Hooks.callAll(`${MODULE_ID}.vialsRegained`, Object.freeze({ actor, ...result, why: "haversack" }));
    return { ok: true, ...result };
}

/* -------------------------------------------- */
/*  As world time passes                         */
/* -------------------------------------------- */

/** The lock page that lets one device gather a character's vials at one moment of world time. */
export const gatherLockId = (actorId, worldTime) => hashId(idemKey("gather", actorId, String(worldTime)));

/**
 * World time moved by `delta` seconds (8.7): each character this tab is responsible for that regains vials, outside an
 * encounter and downtime, gathers over the time (with what was carried); the remainder is carried. Nothing is written for
 * a character that gains nothing and carries the same.
 */
export async function onWorldTime(delta) {
    if (!gatheringOn() || !(delta > 0)) return [];
    const out = [];
    for (const actor of game.actors ?? []) {
        if (actor.type !== "character" || !vialsOf(actor) || !isResponsibleFor(actor)) continue;
        const facts = vialFacts(actor);
        if (!facts.regains || inCombat(actor) || statusOf(actor).inDowntime) continue;
        const { add, clock } = gatherOver({ elapsed: delta, clock: facts.clock, per: facts.per10 });
        const full = facts.vials.value >= facts.vials.max;
        // A user's second device sees the same move of the clock: the lock page of this character and this moment lets
        // one of them gather (5.6, across devices).
        if (add > 0 && !full && canWrite()) {
            const lock = await runRequest([{ op: "lock", ids: [gatherLockId(actor.id, game.time.worldTime)] }]);
            if (lock.outcome !== "ok") continue;
        }
        const result = add > 0 && !full ? await regain(actor, add) : { gained: 0 };
        // A full character carries no time: the next gathering starts when it has a vial to make.
        const carried = full ? 0 : clock;
        if (carried !== facts.clock) await actor.update({ [`flags.${MODULE_ID}.vialClock`]: carried });
        if (result.gained > 0) {
            out.push({ actor: actor.uuid, ...result });
            Hooks.callAll(`${MODULE_ID}.vialsRegained`, Object.freeze({ actor, ...result, why: "clock" }));
        }
    }
    return out;
}

/** Hooks at `init`: world time (8.7). */
export function registerVialHooks() {
    Hooks.on("updateWorldTime", (_worldTime, delta) => {
        onWorldTime(delta).catch((error) => console.error(`${MODULE_ID} | vial gathering failed`, error));
    });
}
