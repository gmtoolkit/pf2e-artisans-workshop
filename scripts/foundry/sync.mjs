/**
 * Storage and sync, wired into Foundry (DESIGN.md 5): what `init` registers and what `ready` (and later events)
 * check and catch up on.
 *
 * `init`: settings and the purge menu, the GM relay query, the deletion guards, the batch watcher, and the
 * hooks that fire on every client (each guarded by the responsible-client check where it writes; a check's chat
 * message is recorded by its author's tab that holds the lease, `rolls.mjs`).
 *
 * `refresh` (at `ready`, when the master switch or the shared documents change): with the switch on, the active
 * GM creates or repairs the shared documents; every client locates them, checks the schema (migrating if it is
 * the elected client) and sets its status, then fires `pf2e-artisans-workshop.status` (the Workshop window and the
 * entry points follow it, M4). Nothing is written while the switch is off (P10).
 *
 * The sweep (P5), on the tab holding the lease, after `refresh`, when a user connects or disconnects, when the
 * lease passes to this tab, and when claims or shelf items appear: apply claims and deliveries this tab is
 * responsible for, finish lost deliveries, publish roster snapshots, resume coin moves whose apply request never
 * landed, pay wages that day records owe and repair orders the hook missed (M6), and tell the user about their own rows that did not finish. Every
 * step is idempotent, so running it again is always safe. A move too young to resume yet, and a row of the user's own left out of the notice while it is
 * in flight, bring the sweep back when they are due.
 */
import { MODULE_ID } from "../constants.mjs";
import { compareIds } from "../logic/ids.mjs";
import { registerBatchWatcher } from "./batch.mjs";
import { sweepWages } from "./downtime.mjs";
import { sweepClaims, sweepDeliveries } from "./claims.mjs";
import { resumeFormulaClaims } from "./formulas.mjs";
import { loadCoinTemplates } from "./coins.mjs";
import { sweepOrderRepairs } from "./orders.mjs";
import { resumeStalled } from "./money.mjs";
import { registerGuards } from "./guards.mjs";
import { holdsLease, requestLease } from "./lease.mjs";
import { ensureSchema } from "./migrate.mjs";
import { PurgeMenu } from "./purge.mjs";
import { reportOwnPending } from "./reconcile.mjs";
import { registerRelay } from "./relay.mjs";
import { registerRollHooks } from "./rolls.mjs";
import { publishAll, registerRosterHooks } from "./roster.mjs";
import { isEnabled, registerSettings } from "./settings.mjs";
import { gmMaintenance, locateShared } from "./shared-docs.mjs";
import { canWrite, setShared, shared, status } from "./state.mjs";

/** The sweep waits this long after a change, plus `SWEEP_STAGGER_MS` for each connected user ahead of this one. */
export const SWEEP_DELAY_MS = 500;
export const SWEEP_STAGGER_MS = 600;
/** How often a client waiting for someone else's migration looks again (the migrating client may have gone). */
export const MIGRATION_RECHECK_MS = 60 * 1000;

/**
 * Run `task` once after calls stop for `delay()` ms: every call starts a timer, and only the latest one runs it.
 */
function debounced(task, delay) {
    let latest = 0;
    return () => {
        const mine = ++latest;
        setTimeout(() => {
            if (mine === latest) task();
        }, delay());
    };
}

/**
 * This client's sweep delay. Every client sweeps after the same change (a new claim, a user connecting), so
 * each waits its turn in user-id order: a client then usually sees the locks of those before it and plans
 * around them, instead of racing them to the server (5.4, 5.5).
 */
function sweepDelay() {
    const ids = game.users.filter((u) => u.active).map((u) => u.id).sort(compareIds);
    return SWEEP_DELAY_MS + Math.max(0, ids.indexOf(game.user.id)) * SWEEP_STAGGER_MS;
}

const scheduleSweep = debounced(() => sweep(), sweepDelay);
const scheduleRefresh = debounced(() => refresh(), () => 250);

/**
 * `task` one run at a time: a call while it runs makes it run once more afterwards, so no change is missed, and
 * every caller waits for the run that covers its call.
 */
function singleFlight(task) {
    let running = null;
    let again = false;
    return async function run() {
        if (running) {
            again = true;
            return running;
        }
        running = (async () => {
            let result;
            do {
                again = false;
                result = await task();
            } while (again);
            return result;
        })();
        try {
            return await running;
        } finally {
            running = null;
        }
    };
}

/** Everything `init` registers. */
export function initSync() {
    registerSettings({ enabled: () => scheduleRefresh(), docs: scheduleRefresh });
    game.settings.registerMenu(MODULE_ID, "purge", {
        name: "pf2e-artisans-workshop.Settings.Purge.Name",
        label: "pf2e-artisans-workshop.Settings.Purge.Label",
        hint: "pf2e-artisans-workshop.Settings.Purge.Hint",
        icon: "fa-solid fa-broom", type: PurgeMenu, restricted: true,
    });
    registerRelay();
    registerGuards();
    registerBatchWatcher();
    registerRosterHooks();
    registerRollHooks();
    Hooks.on("updateJournalEntry", (doc, changed) => onSharedUpdate(doc, changed));
    Hooks.on("updateActor", (doc, changed) => onSharedUpdate(doc, changed));
    Hooks.on("deleteJournalEntry", (doc) => onSharedDelete(doc));
    Hooks.on("deleteActor", (doc) => onSharedDelete(doc));
    Hooks.on("createItem", (item) => onStrongboxItem(item));
    Hooks.on("userConnected", () => onUserConnected());
}

/** `ready`: ask for the lease (when it is granted, this tab checks again and sweeps), then check the shared documents. */
export async function readySync() {
    requestLease(game.user.id, () => scheduleRefresh());
    await refresh();
}

/**
 * Locate and check the shared documents and set this client's status (`state.mjs`). The master switch's
 * `onChange` runs on every client and only schedules this; the active GM's run is what creates the documents.
 * @returns {Promise<string>} the status
 */
export const refresh = singleFlight(checkShared);

let warnedNewer = false;
let recheck = null;

async function checkShared() {
    if (!isEnabled()) {
        setShared({ status: "disabled" });
        Hooks.callAll("pf2e-artisans-workshop.status", status());
        return status();
    }
    try {
        await loadCoinTemplates();
        await gmMaintenance();
    } catch (error) {
        console.error(`${MODULE_ID} | could not prepare the shared documents`, error);
    }
    const found = locateShared();
    if (!found.ready) {
        setShared({ ...found, status: "missing" });
        Hooks.callAll("pf2e-artisans-workshop.status", status());
        return status();
    }
    setShared({ ...found, status: "migrating" });   // no writes until the schema is checked
    const schema = await ensureSchema(found);
    setShared({ ...found, status: schema === "newer" || schema === "migrating" ? schema : "ready" });
    if (schema === "newer" && !warnedNewer) {
        warnedNewer = true;
        ui.notifications.warn("pf2e-artisans-workshop.Sync.Newer", { localize: true });
    }
    if (schema === "migrating") recheckLater();
    if (canWrite()) scheduleSweep();
    Hooks.callAll("pf2e-artisans-workshop.status", status());
    return status();
}

/** While someone else migrates, look again in a while: their client may die with the lock held (4.14). */
function recheckLater() {
    clearTimeout(recheck);
    recheck = setTimeout(() => scheduleRefresh(), MIGRATION_RECHECK_MS);
}

const due = new Map();

/**
 * Sweep again in `ms` (nothing when null), for a step whose work changes with time alone: one timer per step, each run
 * of the step replacing the one before, since each run looks at everything that step is waiting for.
 */
function sweepAgainIn(step, ms) {
    if (ms === null) return;
    clearTimeout(due.get(step));
    due.set(step, setTimeout(() => scheduleSweep(), ms));
}

/**
 * The steps of the catch-up sweep (P5), each on its own so a failure in one does not skip the others. "resume" comes
 * back when the next move too young to judge is due; "pending rows" when the next of the user's own rows it left out
 * of the notice while in flight is (`reportOwnPending`): a resume that stops part-way, say, is in flight for the
 * grace time after it took its mark, and then needs a hand, with nothing else to set off the notice.
 */
const SWEEP_STEPS = [
    ["claims", () => sweepClaims()],
    ["deliveries", () => sweepDeliveries()],
    ["formula claims", () => resumeFormulaClaims()],
    ["roster", () => publishAll()],
    // M6: wages that day records owe and that never landed (the earner's responsible client mints them, 6.10).
    ["wages", () => sweepWages()],
    // M6: order repairs the hook missed, such as a setup a runner's day records completed while nobody was responsible.
    ["orders", () => sweepOrderRepairs()],
    ["resume", async () => sweepAgainIn("resume", (await resumeStalled()).dueInMs)],
    ["pending rows", () => sweepAgainIn("pending rows", reportOwnPending().dueInMs)],
];

/** The catch-up sweep (P5), one run at a time. */
export const sweep = singleFlight(async () => {
    for (const [name, step] of SWEEP_STEPS) {
        if (!canWrite() || !holdsLease()) return;
        try {
            await step();
        } catch (error) {
            console.error(`${MODULE_ID} | sweep step "${name}" failed`, error);
        }
    }
});

/**
 * A user connected or disconnected (`userConnected` fires on every other client): sweep, since claims for that
 * user's characters change hands; and re-check while waiting for a migration, whose client may be the one gone.
 */
function onUserConnected() {
    scheduleSweep();
    if (status() === "migrating") scheduleRefresh();
}

/** A shared document changed: re-check on schema, migration or ownership changes; sweep on new claims. */
function onSharedUpdate(doc, changed) {
    const { ledger, strongbox } = shared();
    if (doc !== ledger && doc !== strongbox) return;
    const flags = changed.flags?.[MODULE_ID] ?? {};
    // Only the migration marker of `meta` matters here; M6's logged days, settlement and day offset live there too.
    if ("ownership" in changed || "schema" in flags || "migration" in (flags.meta ?? {}) || status() === "migrating") scheduleRefresh();
    if ("claims" in flags) scheduleSweep();
}

/**
 * A shared document was deleted: this client goes to "missing" at once, no longer using it, and re-checks shortly
 * (a GM may be re-creating it). `status()` would say "missing" anyway once the document has left its collection;
 * this also drops the reference, so nothing reads the deleted copy meanwhile.
 */
function onSharedDelete(doc) {
    const { ledger, strongbox } = shared();
    if (doc !== ledger && doc !== strongbox) return;
    setShared({ ledger: doc === ledger ? null : ledger, strongbox: doc === strongbox ? null : strongbox, status: "missing" });
    scheduleRefresh();
}

/** A shelf item appeared in the strongbox: its recipient's client delivers it. */
function onStrongboxItem(item) {
    if (item.parent && item.parent === shared().strongbox && item.flags?.[MODULE_ID]?.shelf) scheduleSweep();
}
