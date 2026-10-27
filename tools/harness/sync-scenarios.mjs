/**
 * Live-harness scenarios for storage and sync (DESIGN.md 15.3), the parts milestone M2 covers:
 *
 *   1    two players, no GM: a claim for an offline player waits, and is applied at their login
 *   2    GM and players: the GM's client applies claims for an offline owner; relay "deliver now"
 *   3    GM and assistant GM online: every hook-driven write happens exactly once
 *   3b   the same GM in two tabs, a player in two tabs: every hook-driven write and claim happens once; the
 *        same player on two devices moving coins in and out of one purse at once loses no coins
 *   3c   two players pledge to one order at the same moment, and one client fires two pledges at once:
 *        the strongbox balance equals the sum of the rows
 *   7    a batch with an injected failure stops part-way and leaves a pending row reconciliation shows;
 *        two clients resolving the same claim at once: the loser stops at its lock and moves nothing; two
 *        players collecting refunds at once: both are paid and neither client goes stale
 *   7b   strongbox creation and re-creation: ownership OWNER; a player can pledge, shelve and claim
 *   9    module switched off and on; migration from an older schema; purge
 *   m3   the roll wrapper and the Earn Income roll (M3, `roll-scenarios.mjs`)
 *   m4   the order lifecycle, the Queue and Funds tabs, their races and screenshots (M4, `order-scenarios.mjs`)
 *   m5   formulas, formula jobs, runes, materials, pledges, services and the Formulas tab (M5, `formula-scenarios.mjs`)
 *   m6   downtime: the clock and its prompt, the day resolver and the wizard, helpers, Earn Income, settlements (M6,
 *        `downtime-scenarios.mjs`)
 *   m7   daily preparations: the Morning, loadouts, standing orders, expiry, rest ordering with and without pf2e-dailies,
 *        affixing (M7, `morning-scenarios.mjs`)
 *
 * They run in a dev world (`game.settings.set("pf2e-artisans-workshop", "dev", true)`), in each user's own
 * browser profile, from the console or from Playwright through `page.evaluate`:
 *
 *   const { scenarios } = game.modules.get("pf2e-artisans-workshop").dev;
 *   scenarios.list();                                    // ids, roles and what each step does
 *   await scenarios.run("3c", "pledge", { order: "test-order", cp: 120 });
 *   await scenarios.run("3c", "check");                  // any client: {ok, details}
 *
 * Steps that must happen "at the same moment" are started on each client by the driver without waiting for
 * the others; the check step reads the shared state afterwards. A step returns plain data (JSON-safe) so a
 * driver can compare clients. Users are expected to have an assigned character (`game.user.character`);
 * `params.actor` (a UUID) overrides it. Console output only: this is a developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { holdingsOf, valueCp } from "../../scripts/logic/coins.mjs";
import { hashId, idemKey } from "../../scripts/logic/ids.mjs";
import { flagUpdate } from "../../scripts/logic/keypath.mjs";
import { lockFirstBatch } from "../../scripts/logic/lock-first.mjs";
import { makeRow } from "../../scripts/logic/rows.mjs";
import { runLockFirst } from "../../scripts/foundry/batch.mjs";
import { applyClaim, createClaims } from "../../scripts/foundry/claims.mjs";
import { coinStacks } from "../../scripts/foundry/coins.mjs";
import { pledge } from "../../scripts/foundry/money.mjs";
import { runPurge } from "../../scripts/foundry/purge.mjs";
import { reconciliationReport } from "../../scripts/foundry/reconcile.mjs";
import { requestApplyNow } from "../../scripts/foundry/relay.mjs";
import { locateShared } from "../../scripts/foundry/shared-docs.mjs";
import { status, shared } from "../../scripts/foundry/state.mjs";
import { newId, read, records, stampNow } from "../../scripts/foundry/store.mjs";
import { refresh } from "../../scripts/foundry/sync.mjs";
import { DOWNTIME_SCENARIOS } from "./downtime-scenarios.mjs";
import { FORMULA_SCENARIOS } from "./formula-scenarios.mjs";
import { MORNING_SCENARIOS } from "./morning-scenarios.mjs";
import { ORDER_SCENARIOS } from "./order-scenarios.mjs";
import { ROLL_SCENARIOS } from "./roll-scenarios.mjs";

/** A compendium item for shelf deliveries: Elixir of Life (Minor), pf2e `packs/pf2e/equipment/elixir-of-life-minor.json`. */
const SHELF_ITEM = "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318";

/* -------------------------------------------- */
/*  Helpers                                      */
/* -------------------------------------------- */

const purseCp = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const boxCp = () => valueCp(holdingsOf(coinStacks(shared().strongbox)));

function actorOf(params) {
    const actor = params.actor ? fromUuidSync(params.actor) : game.user.character;
    if (!actor) throw new Error(`${MODULE_ID} | scenario needs params.actor or an assigned character`);
    return actor;
}

/** Wait until `test()` is truthy, checking every 200 ms, up to `ms`. */
async function waitFor(test, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await test()) return true;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
}

/** The shared state in brief, for comparing clients. */
function snapshot() {
    const report = reconciliationReport();
    return {
        user: game.user.name, status: status(), rows: records("rows").length,
        expectedCp: report.expectedCp, actualCp: report.actualCp, differenceCp: report.differenceCp,
        pending: report.pending.map((row) => ({ id: row.id, kind: row.kind, stopped: row.stopped ?? null })),
        lockPages: shared().ledger?.pages.size ?? 0,
    };
}

/** Rows whose idempotency key starts with `prefix`. */
const rowsWith = (prefix) => records("rows").filter((row) => row.idem.startsWith(prefix));

/** Count ledger updates by user while a step runs elsewhere: start, then read. */
const watched = new Map();
let watching = null;
function startWatch(pathPrefix) {
    watched.clear();
    watching = pathPrefix;
    Hooks.on("updateJournalEntry", onWatchedUpdate);
    return { watching: pathPrefix };
}
function onWatchedUpdate(doc, changed, _options, userId) {
    if (!watching || doc !== shared().ledger) return;
    const flat = foundry.utils.flattenObject(changed.flags?.[MODULE_ID] ?? {});
    if (Object.keys(flat).some((key) => key.startsWith(watching))) watched.set(userId, (watched.get(userId) ?? 0) + 1);
}
function stopWatch() {
    Hooks.off("updateJournalEntry", onWatchedUpdate);
    watching = null;
    return Object.fromEntries([...watched].map(([userId, count]) => [game.users.get(userId)?.name ?? userId, count]));
}

/** The `createClaims` input of a refund claim from the strongbox to `actor` (standing in for a cancelled order). */
function refundInput(actor, cp, tag) {
    const idem = idemKey("refund", "scenario", actor.uuid, tag);
    return { kind: "refund", idem, actor: actor.uuid, cp, parties: [actor.uuid] };
}

/**
 * Make sure the strongbox holds `cp`: if it holds less, `from` deposits the difference first. A GM has no character
 * of their own, so a GM's step passes the refund's own actor, whose purse a GM may write.
 */
async function fillStrongbox(cp, from) {
    const short = cp - boxCp();
    if (short > 0) await pledge({ actor: from, cp: short, nonce: newId() });
}

/** One refund claim to `actor`, created by the current user, the strongbox filled first if it is short. */
async function refundClaim(actor, cp, tag) {
    await fillStrongbox(cp, game.user.character ?? actor);
    const input = refundInput(actor, cp, tag);
    await createClaims([input]);
    return read(`claims.${hashId(input.idem)}`);
}

/** Put a compendium item on the pickup shelf for `recipient`. */
async function shelve(recipient, from) {
    const item = await fromUuid(SHELF_ITEM);
    const source = item.toObject();
    delete source._id;
    const key = idemKey("deliver", "scenario", newId());
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.shelf`, { for: recipient.uuid, from: from.uuid, order: null, claimKey: key, at: stampNow().at });
    const [created] = await shared().strongbox.createEmbeddedDocuments("Item", [source]);
    return { item: created.id, key };
}

/* -------------------------------------------- */
/*  Scenarios                                    */
/* -------------------------------------------- */

const SCENARIOS = {
    1: {
        about: "Two players, no GM: a refund claim for an offline player's PC waits until that player logs in.",
        create: { about: "player 2: claim a refund to player 1's PC (params.actor), then wait", run: async (p) => {
            const actor = actorOf(p);
            const claim = await refundClaim(actor, p.cp ?? 10, p.tag ?? newId());
            return { claim: claim?.id, resolved: !!read(`claims.${claim?.id}.resolved`) };
        } },
        login: { about: "player 1, after logging in: the ready sweep applied it", run: async (p) => ({
            applied: await waitFor(() => read(`claims.${p.claim}.resolved`)), by: read(`claims.${p.claim}.resolved.by`) ?? null,
        }) },
    },
    2: {
        about: "GM and players: the GM's client applies claims for an offline owner; relay apply-now.",
        fallback: { about: "player 2: claim a refund to offline player 1's PC; the GM's sweep applies it", run: async (p) => {
            const claim = await refundClaim(actorOf(p), p.cp ?? 10, p.tag ?? newId());
            const applied = await waitFor(() => read(`claims.${claim.id}.resolved`));
            return { claim: claim.id, applied, by: game.users.get(read(`claims.${claim.id}.resolved.by`))?.name ?? null };
        } },
        relay: { about: "player 2: shelve an item for offline player 1's PC and ask the GM to deliver it now", run: async (p) => {
            const shelf = await shelve(actorOf(p), game.user.character);
            return { shelf, answer: await requestApplyNow(p.actor) };
        } },
    },
    3: {
        about: "GM and assistant GM (3b: also two tabs each): hook-driven writes happen once.",
        watch: { about: "any client: start counting ledger writes to roster.<actorId>", run: (p) => startWatch(`roster.${actorOf(p).id}`) },
        touch: { about: "any owner: change the PC in a way the snapshot ignores (expect no write)", run: async (p) => {
            const actor = actorOf(p);
            await actor.update({ "system.details.biography.appearance": `scenario ${newId()}` });
            return { actor: actor.uuid };
        } },
        crafting: { about: "any owner: change something the snapshot holds (a formula): one write, by the responsible tab", run: async (p) => {
            const actor = actorOf(p);
            const formulas = actor.system.crafting.formulas;
            const has = formulas.some((f) => f.uuid === SHELF_ITEM);
            await actor.update({ "system.crafting.formulas": has ? formulas.filter((f) => f.uuid !== SHELF_ITEM) : [...formulas, { uuid: SHELF_ITEM }] });
            return { formulaAdded: !has };
        } },
        count: { about: "the watching client, after ~3 s: writers and counts (expect one writer, once)", run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            return { writers: stopWatch() };
        } },
        purseBefore: { about: "3b, the player's first device: its PC's purse and rows now (pass them to purseAfter)", run: (p) => {
            const actor = actorOf(p);
            return { cp: purseCp(actor), rows: records("rows").filter((row) => row.actor === actor.uuid).map((row) => row.id) };
        } },
        wage: { about: "3b, each of the player's devices at the same moment: mint params.cp into its own PC as a wage claim", run: async (p) => {
            const actor = actorOf(p);
            const idem = idemKey("wage", "scenario", newId(), "0");
            const [claim] = await createClaims([{ kind: "wage", idem, actor: actor.uuid, cp: p.cp ?? 10, job: "scenario", day: 0, parties: [actor.uuid] }]);
            const result = await applyClaim(claim, actor);
            return { claim: claim.id, outcome: result.outcome ?? result.reason };
        } },
        pledge: { about: "3b, one device while the other runs `wage`: pledge params.cp from the same PC", run: async (p) => {
            const result = await pledge({ actor: actorOf(p), cp: p.cp ?? 10, order: "scenario-order", nonce: newId() });
            return { outcome: result.outcome ?? result.reason };
        } },
        purseAfter: { about: "3b, after the sweeps settle: the purse moved by exactly the rows applied since (params.before and params.rows from purseBefore)", run: async (p) => {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const actor = actorOf(p);
            // The rows that are new since purseBefore, by id: their stamps come from two devices, whose estimates
            // of the server's time differ by some milliseconds, so a cut-off by time can miss one.
            const earlier = new Set(p.rows ?? []);
            const rows = records("rows").filter((row) => row.actor === actor.uuid && row.state === "applied" && !earlier.has(row.id));
            const expected = (p.before ?? 0) + rows.reduce((sum, row) => sum + row.purse, 0);
            return { ok: purseCp(actor) === expected, purse: purseCp(actor), expected, rows: rows.length };
        } },
        claim: { about: "player: claim a refund to an offline PC with GM and assistant (and two GM tabs) online", run: async (p) => {
            const actor = actorOf(p);
            const before = purseCp(actor);
            const claim = await refundClaim(actor, p.cp ?? 10, p.tag ?? newId());
            await waitFor(() => read(`claims.${claim.id}.resolved`));
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return { ...snapshot(), claim: claim.id, claimRows: rowsWith(claim.idem).length, purseDelta: purseCp(actor) - before };
        } },
    },
    "3c": {
        about: "Concurrent pledges to one order: the strongbox balance equals the sum of the rows.",
        pledge: { about: "each player at the same moment: one pledge of params.cp to params.order", run: async (p) => {
            const result = await pledge({ actor: actorOf(p), cp: p.cp ?? 120, order: p.order ?? "scenario-order", nonce: newId() });
            return { outcome: result.outcome ?? result.reason };
        } },
        burst: { about: "one player: two pledges fired without waiting (the coin mutex serialises them)", run: async (p) => {
            const actor = actorOf(p);
            const results = await Promise.all([1, 2].map(() => pledge({ actor, cp: p.cp ?? 120, order: p.order ?? "scenario-order", nonce: newId() })));
            return { outcomes: results.map((r) => r.outcome ?? r.reason) };
        } },
        check: { about: "any client, after the pledges: no difference, nothing pending", run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const s = snapshot();
            return { ok: s.differenceCp === 0 && s.pending.length === 0, ...s };
        } },
    },
    7: {
        about: "Injected failure and claim races.",
        inject: { about: "any player: a move with a duplicate delete after its lock: it stops part-way", run: async (p) => {
            const actor = actorOf(p);
            const [dummy] = await shared().strongbox.createEmbeddedDocuments("Item", [(await fromUuid(SHELF_ITEM)).toObject()]);
            const row = makeRow({ kind: "deposit", idem: idemKey("deposit", "fund", actor.uuid, newId()), cp: 1, actor: actor.uuid }, stampNow());
            const batch = lockFirstBatch({ rowIds: [row.id], ledger: { set: { [`rows.${row.id}`]: row } } });
            // Two deletions of the same item both pass the dry run; the second fails in the real pass.
            batch.apply.unshift({ op: "deleteItems", target: "strongbox", ids: [dummy.id] }, { op: "deleteItems", target: "strongbox", ids: [dummy.id] });
            const result = await runLockFirst(batch);
            return { result, row: row.id, state: read(`rows.${row.id}.state`) ?? null, ...snapshot() };
        } },
        prepare: { about: "GM: a refund claim to params.actor, for two clients to race on", run: async (p) => {
            const claim = await refundClaim(actorOf(p), p.cp ?? 10, p.tag ?? newId());
            return { claim: claim.id };
        } },
        race: { about: "GM and the owner at the same moment: apply params.claim directly (bypassing the guard); reports where the loser lost", run: async (p) => {
            await waitFor(() => read(`claims.${p.claim}`), 5000);   // the GM's write may still be on its way to this client
            const claim = read(`claims.${p.claim}`);
            const actor = fromUuidSync(claim.actor);
            const before = purseCp(actor);
            const result = await applyClaim(claim, actor);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return { outcome: result.outcome ?? result.reason, lostAt: result.reason ?? null, purseDelta: purseCp(actor) - before,
                rows: rowsWith(claim.idem).length, status: status() };
        } },
        refunds: { about: "GM: one refund claim to each of params.actors (UUIDs) in one write, for their owners to collect at once", run: async (p) => {
            const tag = p.tag ?? newId();
            const cp = p.cp ?? 10;
            const actors = (p.actors ?? []).map((uuid) => fromUuidSync(uuid));
            await fillStrongbox(cp * actors.length, game.user.character ?? actors[0]);
            const inputs = actors.map((actor) => refundInput(actor, cp, tag));
            await createClaims(inputs);
            return { claims: inputs.map((input) => hashId(input.idem)) };
        } },
        collected: { about: "each owner, after the refunds: its claim resolved once, its client not stale", run: async (p) => {
            const mine = (p.claims ?? []).filter((id) => fromUuidSync(read(`claims.${id}.actor`))?.isOwner);
            const resolved = await waitFor(() => mine.every((id) => read(`claims.${id}.resolved`)));
            return { resolved, rows: mine.map((id) => rowsWith(read(`claims.${id}.idem`)).length), status: status() };
        } },
        check: { about: "any client: the claim's row exists once and the balance reconciles", run: async (p) => {
            const claim = read(`claims.${p.claim}`);
            const s = snapshot();
            return { ok: rowsWith(claim.idem).length === 1 && s.differenceCp === 0, ...s };
        } },
    },
    "7b": {
        about: "Strongbox creation and re-creation; a player can pledge, shelve and claim.",
        recreate: { about: "GM: delete the strongbox, re-create it, and check its ownership", run: async () => {
            const old = shared().strongbox;
            if (old) await old.delete({ [MODULE_ID]: { internal: true } });
            await refresh();
            const { strongbox } = locateShared();
            return { recreated: !!strongbox && strongbox.id !== old?.id, ownerDefault: strongbox?.ownership.default ?? null, status: status() };
        } },
        player: { about: "player: deposit 1 sp, shelve an item for params.actor, and see it delivered", run: async (p) => {
            const deposit = await pledge({ actor: game.user.character, cp: 10, nonce: newId() });
            const shelf = await shelve(actorOf(p), game.user.character);
            const delivered = await waitFor(() => !shared().strongbox.items.has(shelf.item));
            return { deposit: deposit.outcome ?? deposit.reason, shelf, delivered, ...snapshot() };
        } },
    },
    9: {
        about: "Switch off and on, migration from schema 0, purge.",
        toggle: { about: "GM: turn the master switch off, then on; status follows on every client", run: async () => {
            await game.settings.set(MODULE_ID, "enabled", false);
            const off = await waitFor(() => status() === "disabled", 5000);
            await game.settings.set(MODULE_ID, "enabled", true);
            const on = await waitFor(() => status() === "ready", 10000);
            return { off, on };
        } },
        oldSchema: { about: "GM: mark both shared documents as schema 0; the elected client migrates them", run: async () => {
            const { ledger, strongbox } = shared();
            const operators = { deletion: _del, replacement: _replace };
            for (const doc of [ledger, strongbox]) await doc.update(flagUpdate(MODULE_ID, { set: { schema: 0 } }, operators), { diff: false });
            const migrated = await waitFor(() => ledger.flags[MODULE_ID].schema === 1 && strongbox.flags[MODULE_ID].schema === 1 && !ledger.flags[MODULE_ID].meta?.migration);
            return { migrated, status: status() };
        } },
        status: { about: "any client: its status (expect ready after a migration)", run: () => ({ status: status(), ...snapshot() }) },
        purge: { about: "GM: purge without returning anything (params.returns: keep or party)", run: async (p) => {
            const result = await runPurge({ returns: p.returns ?? "keep" });
            const left = game.actors.filter((a) => a.flags?.[MODULE_ID]).length + game.journal.filter((j) => j.flags?.[MODULE_ID]).length;
            return { result, flaggedDocumentsLeft: left, enabled: game.settings.get(MODULE_ID, "enabled") };
        } },
    },
    ...ROLL_SCENARIOS,
    ...ORDER_SCENARIOS,
    ...FORMULA_SCENARIOS,
    ...DOWNTIME_SCENARIOS,
    ...MORNING_SCENARIOS,
};

/** Every scenario, its steps and what each does. */
function list() {
    const rows = Object.entries(SCENARIOS).flatMap(([id, scenario]) => Object.entries(scenario)
        .filter(([, step]) => typeof step === "object")
        .map(([step, { about }]) => ({ id, step, about })));
    console.table(rows);
    return rows;
}

/** Run one step on this client. */
async function run(id, step, params = {}) {
    const action = SCENARIOS[id]?.[step];
    if (typeof action?.run !== "function") throw new Error(`${MODULE_ID} | no scenario step ${id}/${step}`);
    if (game.settings.get(MODULE_ID, "dev") !== true) throw new Error(`${MODULE_ID} | the dev setting is off`);
    const result = await action.run(params);
    console.log(`${MODULE_ID} | scenario ${id}/${step} on ${game.user.name}`, result);
    return result;
}

export const scenarios = { list, run, definitions: SCENARIOS, snapshot };
