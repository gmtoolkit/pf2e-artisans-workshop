/**
 * "Use best consumable" on this client (DESIGN.md 8.9, M8): a family-aware picker in place of PF2e Convenient
 * Consumables (whose code has no licence and is not reused). Not combat-specific: it does not step aside for Duct Tape,
 * and has its own toggle (`features.consumables`).
 *
 * - **Choice** (`chooseBest`): within the family, held, then worn, then stowed; among equals the soonest-expiring infused
 *   item first; inert items (7.7) skipped; the user is asked only when two choices are equally good.
 * - **Use** goes through the system: a weapon (a bomb) through pf2e's Strike (`strikeWith`), anything else through
 *   `item.consume()`, which posts pf2e's own card (healing with its apply buttons).
 * - **Party view** (`holders`): who holds one, from the roster snapshots' `consumables` (4.10). Handing one over is pf2e's
 *   trade or the strongbox; the module never moves another player's item.
 * - **The roster's summary** (`consumablesOf`): a character's consumables by family, which its snapshot publishes.
 */
import { MODULE_ID } from "../constants.mjs";
import { chooseBest } from "../logic/alchemy.mjs";
import { familySummary, holdersOf } from "../logic/consumables.mjs";
import { strikeWith } from "./combat.mjs";
import { candidateOf, familyOfItem, inertFlag, physicalOf, stampFlag, usableConsumable } from "./item-facts.mjs";
import { isEnabled, setting } from "./settings.mjs";
import { records } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (value) => (typeof value === "string" ? fromUuidSync(value, { strict: false }) : value ?? null);

/** Whether "Use best consumable" is on (14.1 `features.consumables`, with the master switch). */
export const consumablesOn = () => isEnabled() && setting("features.consumables") !== false;

/** A character's candidates of a family (8.9), as `chooseBest` reads them. */
export function candidatesOf(actor, family) {
    return physicalOf(actor).filter((item) => usableConsumable(item) && familyOfItem(item) === family).map(candidateOf);
}

/** A character's consumables by family, for its roster snapshot (4.10). */
export function consumablesOf(actor) {
    return familySummary(physicalOf(actor).filter(usableConsumable).map((item) => ({
        family: familyOfItem(item), qty: item.quantity ?? 1, inert: inertFlag(item), stamp: stampFlag(item),
    })));
}

/** Who holds one of a family (the party view, 8.9), from the roster snapshots. */
export const holders = (family) => holdersOf(records("roster"), family);

/**
 * Ask which of equally good items to use (8.9): the candidates' names with their quantities. Returns the chosen
 * candidate, or null when the user closes the prompt.
 */
async function askWhich(ties) {
    const { askChoice } = await import("../ui/prompts.mjs");
    const answer = await askChoice({
        title: "pf2e-artisans-workshop.Consumables.Which", label: "pf2e-artisans-workshop.Consumables.WhichLabel",
        options: ties.map((t) => ({ value: t.id, name: game.i18n.format("pf2e-artisans-workshop.Consumables.Option", { item: t.item.name, qty: String(t.item.quantity ?? 1) }) })),
        button: "pf2e-artisans-workshop.Consumables.Use", icon: "fa-solid fa-hand-sparkles",
    });
    return answer?.value ? ties.find((t) => t.id === answer.value) ?? null : null;
}

/**
 * Use the best consumable of a family (8.9, macro 20; `api.consumables.useBest`): `family` is a `familyKey` (from
 * compendium data, so Remaster items, quick vials and versatile vials are families too). With `partyWide`, a character
 * holding none returns who does instead. Refused: `consumables-off`, `no-actor`, `not-owner`, `none` (with `data.holders`),
 * `not-chosen` (the user closed the question).
 */
export async function useBest({ family, actor: actorRef = null, map = 0, partyWide = false, choose = askWhich } = {}) {
    if (!consumablesOn()) return refuse("consumables-off");
    const actor = actorOf(actorRef);
    if (!actor) return refuse("no-actor");
    if (!actor.isOwner) return refuse("not-owner");
    const { best, ties } = chooseBest(candidatesOf(actor, family), game.time?.worldTime ?? 0);
    if (!best) return refuse("none", partyWide ? { holders: holders(family).filter((h) => h.actor !== actor.id) } : {});
    const pick = ties.length > 1 ? await choose(ties) : best;
    if (!pick) return refuse("not-chosen");
    const item = pick.item;
    if (item.type === "weapon") return { ...(await strikeWith(actor, item, { map })), item: item.id, name: item.name };
    await item.consume();
    Hooks.callAll(`${MODULE_ID}.consumableUsed`, Object.freeze({ actor, item: item.id, family }));
    return { ok: true, item: item.id, name: item.name };
}
