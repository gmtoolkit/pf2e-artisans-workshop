/**
 * Publishing roster snapshots (DESIGN.md 4.10): each member's responsible client writes `roster.<actorId>`
 * whenever the actor or one of its items changes (debounced), and at the `ready` sweep. The hooks fire on every
 * client, so each handler starts with the responsible-client guard (P4). An unchanged snapshot is not written.
 *
 * Members (`members` setting): the active pf2e party's characters, or every character with a player owner.
 * Feats are published by the registry slugs the rules read (`FEAT` in `scripts/logic/core.mjs`, until the M3
 * registry); skills, every one the character is trained in or better, since Earn Income may use any skill.
 */
import { FEAT } from "../logic/core.mjs";
import { rosterSnapshot, sameRoster } from "../logic/roster.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { setting } from "./settings.mjs";
import { canWrite } from "./state.mjs";
import { read, stampNow, write } from "./store.mjs";

/** How long a burst of changes to one actor is gathered before publishing. */
const DEBOUNCE_MS = 1000;
/** The latest scheduled publish per actor id: only that one runs. */
const latest = new Map();

/** The feat slugs the rules read; a choice feat (`slug:choice`) is matched by its slug. */
const KNOWN_FEATS = new Set(Object.values(FEAT).map((slug) => slug.split(":")[0]));

/** The Workshop's members. */
export function members() {
    if (setting("members") === "all") return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    return (game.actors.party?.members ?? []).filter((a) => a.type === "character");
}

const isMember = (actor) => actor?.type === "character" && members().includes(actor);

/** Plain data for `rosterSnapshot`, read from a pf2e character. */
export function rosterExtract(actor) {
    const vials = actor.getResource?.("versatile-vials") ?? null;
    return {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        level: actor.level,
        size: actor.size,
        skills: Object.fromEntries(Object.values(actor.skills ?? {}).filter((s) => s.rank >= 1).map((s) => [s.slug, s.rank])),
        feats: actor.itemTypes.feat.map((feat) => feat.slug).filter((slug) => KNOWN_FEATS.has(slug)),
        formulas: (actor.system.crafting?.formulas ?? []).map((formula) => formula.uuid),
        abilities: [...(actor.crafting?.abilities?.values() ?? [])].map((a) => ({
            slug: a.slug, maxSlots: a.maxSlots, maxItemLevel: a.maxItemLevel, resource: a.resource,
        })),
        vials: vials ? { value: vials.value, max: vials.max } : null,
        investiture: actor.inventory?.invested ?? null,
        consumables: {},   // filled by "Use best consumable" (8.9, M8)
    };
}

/** Publish one actor's snapshot if this tab is responsible for it and it changed. */
export async function publishRoster(actor) {
    if (!canWrite() || !isMember(actor) || !isResponsibleFor(actor)) return false;
    const snapshot = rosterSnapshot(rosterExtract(actor), stampNow());
    if (sameRoster(read(`roster.${actor.id}`), snapshot)) return false;
    return write({ replace: { [`roster.${actor.id}`]: snapshot } });
}

/** Publish after changes to `actor` have settled: each change starts a timer, and only the latest publishes. */
export function schedulePublish(actor) {
    if (!actor || actor.type !== "character") return;
    const mine = (latest.get(actor.id) ?? 0) + 1;
    latest.set(actor.id, mine);
    setTimeout(() => {
        if (latest.get(actor.id) === mine) publishRoster(actor);
    }, DEBOUNCE_MS);
}

/** Publish every member this tab is responsible for (the `ready` sweep). */
export async function publishAll() {
    let written = 0;
    for (const actor of members()) if (await publishRoster(actor)) written += 1;
    return written;
}

/** The hooks that republish, at `init`. */
export function registerRosterHooks() {
    Hooks.on("updateActor", (actor) => schedulePublish(actor));
    for (const event of ["createItem", "updateItem", "deleteItem"]) {
        Hooks.on(event, (item) => schedulePublish(item.parent));
    }
}
