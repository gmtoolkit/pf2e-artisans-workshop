/**
 * One tab per user (DESIGN.md 5.6) and one coin plan at a time per user (5.4), through the Web Locks API.
 *
 * - The lease `pf2e-artisans-workshop-lease-<userId>` is held for the life of the tab. A user's other tabs in
 *   the same browser queue for it and get it when the holder closes. Only the holder acts on hook-driven
 *   writes and prompts.
 * - The coin mutex `pf2e-artisans-workshop-coins-<userId>` serialises coin plans across those tabs, so a
 *   client never sends a second plan before the first resolves.
 *
 * Web Locks exist only in secure contexts (https, or localhost). A table reached over plain http on a LAN has
 * no `navigator.locks`: then every tab counts as holding the lease, the mutex covers one tab only, and
 * duplicates across tabs are stopped by the lock-first batches, as across devices.
 */
import { MODULE_ID } from "../constants.mjs";

let holder = false;
let tail = Promise.resolve();

/** Whether this tab holds its user's lease. */
export function holdsLease() {
    return holder;
}

/**
 * Ask for the lease. `onGranted` runs when this tab gets it, now or when another tab closes; the lock is then
 * held until the tab goes away (its callback's promise never settles).
 */
export function requestLease(userId, onGranted = () => {}) {
    const locks = navigator.locks;
    if (!locks) {
        holder = true;
        onGranted();
        return;
    }
    locks.request(`${MODULE_ID}-lease-${userId}`, () => {
        holder = true;
        onGranted();
        return new Promise(() => {});
    });
}

/** Run `task` while holding the user's coin mutex; resolves to what `task` returns. */
export function withCoinMutex(userId, task) {
    const locks = navigator.locks;
    if (locks) return locks.request(`${MODULE_ID}-coins-${userId}`, () => task());
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
}

/** For tests only. */
export function resetLease() {
    holder = false;
    tail = Promise.resolve();
}
