/**
 * What a pf2e character holds of the rules registry (DESIGN.md 6.11): the Foundry side of `heldKeys`
 * (`scripts/logic/registry.mjs`). Items are matched by compendium source UUID (`item.sourceId`), else by slug, and a
 * choice feat carries its selection (`flags.pf2e.rulesSelections`).
 */
import { heldKeys } from "../logic/registry.mjs";

/** The plain data `heldKeys` reads from one item. */
const itemFacts = (item) => ({ sourceId: item.sourceId ?? null, slug: item.slug ?? null, selections: item.flags?.pf2e?.rulesSelections ?? {} });

/**
 * Whether an item counts toward the character's own effects: anything that is not physical (feats, features), and
 * physical gear that is equipped as its usage requires and, when it must be invested, invested; the system ignores
 * the rule elements of gear that is not, and so does the module.
 */
function inUse(item) {
    if (!item.isOfType?.("physical")) return true;
    return item.isEquipped === true && item.isInvested !== false;
}

/** The registry keys of the character's feats, features and gear in use (6.11). */
export function heldKeysOf(actor) {
    return heldKeys(actor.items.filter(inUse).map(itemFacts));
}

/**
 * The registry keys that can provide or waive a Craft's tool (G7): feats, features and every item the actor
 * carries, used or not, since a tool counts if it is on the crafter or in the strongbox.
 */
export function toolKeysOf(actor) {
    return heldKeys(actor.items.map(itemFacts));
}

/** The registry keys of the character's feats and features only: what its roster snapshot publishes (4.10). */
export function featKeysOf(actor) {
    return heldKeys(actor.items.filter((item) => item.type === "feat").map(itemFacts));
}

/** The character's proficiency ranks by skill slug, for registry modifiers raised at a rank. */
export function ranksOf(actor) {
    return Object.fromEntries(Object.values(actor.skills ?? {}).map((skill) => [skill.slug, skill.rank ?? 0]));
}
