/**
 * Two of the extension hooks (DESIGN.md 12.3, M10) that every ledger write can cause, announced in one place: the write
 * path itself (`store.write`, and each ledger operation of a batch request in `batch.mjs`). Before a request goes out,
 * `announceAfter(update)` notes which rows and orders it touches and how they stood; once it has landed, the function it
 * returned compares and fires, on this client only (the one that performed the write), once per write:
 *
 * - `ledgerPosted` `{rows}`: the rows this write made `applied` (a bookkeeping row written applied, or a coin move's rows
 *   settled by its apply request; a lock request's rows are still `pending` and are announced when they settle);
 * - `orderStatusChanged` `{order, from, to}`: each order whose `status` this write changed (`from` null for a new order).
 *
 * Payloads are frozen copies. A request that did not land announces nothing.
 */
import { MODULE_ID } from "../constants.mjs";
import { readPath } from "../logic/keypath.mjs";
import { shared } from "./state.mjs";

const PREFIX = `flags.${MODULE_ID}.`;

/** A deep-frozen copy of plain data. */
export function frozenCopy(value) {
    const copy = structuredClone(value);
    const freeze = (v) => {
        if (v && typeof v === "object" && !Object.isFrozen(v)) {
            Object.freeze(v);
            for (const inner of Object.values(v)) freeze(inner);
        }
        return v;
    };
    return freeze(copy);
}

const ledgerFlags = () => shared().ledger?.flags?.[MODULE_ID] ?? {};
const nothing = () => {};

/**
 * What a ledger update touches that the hooks announce, and a function that announces it once the update landed. The update
 * is the flat Foundry update (`flags.<MOD>.rows.<id>`, `flags.<MOD>.orders.<id>.status`, ...).
 * @returns {() => void}
 */
export function announceAfter(update) {
    const rows = new Map();
    const orders = new Map();
    const flags = ledgerFlags();
    for (const key of Object.keys(update ?? {})) {
        if (!key.startsWith(PREFIX)) continue;
        const [top, id, field] = key.slice(PREFIX.length).split(".");
        if (!id) continue;
        if (top === "rows" && (field === undefined || field === "state")) rows.set(id, readPath(flags, `rows.${id}.state`) ?? null);
        if (top === "orders" && (field === undefined || field === "status")) orders.set(id, readPath(flags, `orders.${id}.status`) ?? null);
    }
    if (!rows.size && !orders.size) return nothing;
    return () => {
        const now = ledgerFlags();
        const posted = [...rows].filter(([id, was]) => was !== "applied" && readPath(now, `rows.${id}.state`) === "applied")
            .map(([id]) => readPath(now, `rows.${id}`));
        if (posted.length) Hooks.callAll(`${MODULE_ID}.ledgerPosted`, frozenCopy({ rows: posted }));
        for (const [id, from] of orders) {
            const order = readPath(now, `orders.${id}`);
            const to = order?.status ?? null;
            if (order && to !== from) Hooks.callAll(`${MODULE_ID}.orderStatusChanged`, frozenCopy({ order, from, to }));
        }
    };
}
