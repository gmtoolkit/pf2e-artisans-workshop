/**
 * What the entry points on pf2e's sheets show (DESIGN.md 10.4, M11). Pure: the character sheet's Crafting tab strip (a
 * character's Workshop jobs, its pickup shelf and its downtime and Morning status) and the Party sheet's summary card
 * (the party's orders by state, what waits for a crafter, the shelf for the user's characters). Counts only: the strip
 * and the card are thin, and the Workshop window holds the detail.
 */
import { CLOSED } from "./orders.mjs";

/** An order the crafter is working on: accepted and not closed or failed (the Queue's own "working" states, and `accepted`). */
const WORKING = Object.freeze(["accepted", "setup", "gathering", "check", "rolled", "finishing", "paused"]);

/** States where the crafter's next step is theirs to take now: roll the check, settle it, or finish. */
const DUE = Object.freeze(["check", "rolled"]);

const open = (order) => !CLOSED.includes(order.status);

/**
 * The strip for one character (10.4 Crafting tab): orders it crafts, of which how many need its roll or settlement now, orders
 * filed for it (a gift hidden from it is not counted: its owners must not learn of it), items on the shelf, pending downtime
 * days and whether a rest left it waiting to prepare. `empty` when there is nothing to say, so the strip shows only its
 * buttons.
 *
 * @param {object[]} orders          every order of the ledger
 * @param {string} actorUuid
 * @param {{shelf?: number, pendingDays?: number, morningWaiting?: boolean}} [extra]
 */
export function stripView(orders, actorUuid, { shelf = 0, pendingDays = 0, morningWaiting = false } = {}) {
    const crafting = orders.filter((o) => o.crafter === actorUuid && WORKING.includes(o.status));
    const due = crafting.filter((o) => DUE.includes(o.status)).length;
    const forYou = orders.filter((o) => open(o) && o.visibility !== "gift" && o.recipient?.kind === "actor" && o.recipient.uuid === actorUuid).length;
    const view = { crafting: crafting.length, due, forYou, shelf, pendingDays, morningWaiting: morningWaiting === true };
    return { ...view, empty: !view.crafting && !view.forYou && !view.shelf && !view.pendingDays && !view.morningWaiting };
}

/**
 * The Party sheet's card (10.4): open orders, what is requested with no crafter yet, what is being worked on, what finished,
 * and the shelf for the user's characters.
 *
 * @param {object[]} orders
 * @param {{shelf?: number}} [extra]
 */
export function partyCardView(orders, { shelf = 0 } = {}) {
    const list = orders.filter((o) => o.status !== "archived");
    return {
        open: list.filter(open).length,
        unclaimed: list.filter((o) => o.status === "requested" && !o.crafter).length,
        working: list.filter((o) => WORKING.includes(o.status) && o.status !== "accepted").length,
        complete: list.filter((o) => o.status === "complete").length,
        shelf,
    };
}

/**
 * The queue summary a macro posts (11.1 macro 19): the open orders, oldest first, each with its number, product (a gift's
 * hidden as `null` unless `seeGift` says the viewer may see it), quantity, status, crafter and recipient uuids.
 *
 * @param {{order: object, no: number}[]} numbered   `queueOrder`'s output
 * @param {(order: object) => boolean} [seeGift]
 */
export function summaryLines(numbered, seeGift = () => false) {
    return numbered.filter(({ order }) => open(order)).map(({ order, no }) => ({
        no, id: order.id, name: order.visibility === "gift" && !seeGift(order) ? null : order.product?.snapshot?.name ?? null,
        quantity: order.quantity ?? 1, status: order.status, crafter: order.crafter ?? null,
        recipient: order.recipient?.kind === "actor" ? order.recipient.uuid : null, toStrongbox: order.recipient?.kind === "strongbox",
    }));
}

/**
 * The order a crafter's "Roll Craft check" macro rolls when none is named (11.1 macro 4): the actor's oldest order waiting
 * for its check. `numbered` is `queueOrder`'s output (filing order).
 */
export function nextCheckOrder(numbered, actorUuid) {
    return numbered.find(({ order }) => order.crafter === actorUuid && order.status === "check")?.order ?? null;
}

/**
 * The orders a crafter's "Finish order" macro can mean when none is named (11.1 macro 5): the actor's orders a finish can
 * close (`rolled` with a success, or `finishing`).
 */
export function finishableOrders(numbered, actorUuid) {
    return numbered.filter(({ order }) => order.crafter === actorUuid && ["rolled", "finishing"].includes(order.status)).map(({ order }) => order);
}
