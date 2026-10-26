/**
 * Notifications (DESIGN.md 10.7): when an order changes state, the users involved hear about it once, as a toast, and
 * in the open window's status bar. Each client watches the ledger itself and tells only its own user, by the user's
 * `notify.level` setting: "all" orders, "mine" (orders whose requester, recipient, crafter or contributor is one of the
 * user's characters), or "none". A user is not told about a change they made.
 */
import { MODULE_ID } from "../constants.mjs";
import { allocationsByContributor } from "../logic/split.mjs";
import { orderRows, viewer } from "../foundry/orders.mjs";
import { setting } from "../foundry/settings.mjs";
import { read, records } from "../foundry/store.mjs";
import { STATUS } from "./labels.mjs";

/** The last state this client saw of each order. */
const seen = new Map();

/** Remember every order's state now, so the first change after loading is the first one told. */
export function primeNotifications() {
    for (const order of records("orders")) seen.set(order.id, order.status);
}

/** Whether the order involves one of this user's characters. */
function involves(order) {
    const { isMine } = viewer();
    const uuids = [order.requester, order.crafter, order.recipient?.uuid, ...allocationsByContributor(orderRows(order.id)).map((a) => a.actor)];
    return uuids.some((uuid) => uuid && isMine(uuid));
}

/** `updateJournalEntry` on every client: tell this user about orders whose state changed. */
export function registerNotifications() {
    Hooks.on("updateJournalEntry", (doc, changed, _options, userId) => {
        if (doc.flags?.[MODULE_ID]?.role !== "ledger") return;
        const ids = Object.keys(changed.flags?.[MODULE_ID]?.orders ?? {});
        for (const id of ids) {
            const order = read(`orders.${id}`);
            if (!order) continue;
            const before = seen.get(id);
            seen.set(id, order.status);
            if (before === order.status || userId === game.user.id) continue;
            const level = setting("notify.level");
            if (level === "none" || (level === "mine" && !involves(order))) continue;
            const text = game.i18n.format("pf2e-artisans-workshop.Notify.Status", {
                item: order.visibility === "gift" ? game.i18n.localize("pf2e-artisans-workshop.Queue.Gift") : order.product?.snapshot?.name ?? "",
                status: game.i18n.localize(STATUS[order.status]?.key ?? STATUS.requested.key),
                user: game.users.get(userId)?.name ?? "",
            });
            ui.notifications.info(text);
            Hooks.callAll("pf2e-artisans-workshop.announce", text);
        }
    });
}
