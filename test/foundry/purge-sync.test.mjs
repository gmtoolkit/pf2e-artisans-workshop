/**
 * Purge all data (DESIGN.md 5.9) and the sync's catch-up sweep (P5) over the fake world: refunds per allocation
 * that let a second run finish, balances read when the purge runs, the switch turned off before anything is
 * deleted (so no client re-creates it), and a move to the party stash that stops rather than duplicates.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { MOD, OWNER, addDocument, coin, flagsOf, installFoundry, resetWorld, setUsers, world } from "./stubs.mjs";

installFoundry();
const { hashId } = await import("../../scripts/logic/ids.mjs");
const { registerBatchWatcher } = await import("../../scripts/foundry/batch.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const money = await import("../../scripts/foundry/money.mjs");
const purge = await import("../../scripts/foundry/purge.mjs");
const { createShared, locateShared, resetMaintenance } = await import("../../scripts/foundry/shared-docs.mjs");
const claimsModule = await import("../../scripts/foundry/claims.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const { read, records } = await import("../../scripts/foundry/store.mjs");
const { memberBalances } = await import("../../scripts/logic/reconcile.mjs");
const { holdingsOf, valueCp } = await import("../../scripts/logic/coins.mjs");
const { coinStacks } = await import("../../scripts/foundry/coins.mjs");
const sync = await import("../../scripts/foundry/sync.mjs");

sync.initSync();
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

let vera;
let docs;
/** Let the promise chains a fired timer started run to the end. */
const settle = async () => { for (let i = 0; i < 200; i++) await new Promise((resolve) => setImmediate(resolve)); };
const cpOf = (actor) => valueCp(holdingsOf(coinStacks(actor)));

beforeEach(async () => {
    resetWorld();
    state.resetState();
    resetLease();
    resetMaintenance();
    claimsModule.resetClaims();
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    mock.timers.enable({ apis: ["setTimeout"] });   // the sync's debounced refresh and sweep never fire on their own
    setCoinTemplates(Object.fromEntries(["pp", "gp", "sp", "cp"].map((d) => [d, coin(d, 0)])));
    vera = addDocument("Actor", { name: "Vera", ownership: { default: OWNER }, items: [coin("gp", 20)], flags: { [MOD]: { loadouts: {} } } });
    setUsers([{ id: "gm00000000000000", isGM: true }, { id: "p1", character: vera, active: false }]);
    requestLease(game.user.id);
    registerBatchWatcher();
    world.settings.set(`${MOD}.enabled`, true);
    docs = await createShared();
    await sync.refresh();
    await money.pledge({ actor: vera, cp: 700, order: "o1", nonce: "n" });
});
afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    mock.timers.reset();
});

test("the purge menu is a GM-only settings button whose class opens the dialog", async () => {
    const menu = world.menus.get(`${MOD}.purge`);
    assert.equal(menu.restricted, true);
    assert.equal(menu.type, purge.PurgeMenu);
    let opened = 0;
    world.dialog = () => { opened++; return "cancel"; };
    await new purge.PurgeMenu().render(true);
    assert.equal(opened, 1);
});

test("a wrong world name purges nothing", async () => {
    world.dialog = () => ({ confirm: "Not The World", returns: "keep", chat: false });
    await purge.openPurge();
    assert.ok(world.notes.some(([, key]) => key === "pf2e-artisans-workshop.Purge.Mismatch"));
    assert.ok(game.journal.get(docs.ledger.id));
});

test("refunds first: one claim per member and allocation, issued once; once collected, the next run finishes", async () => {
    await money.pledge({ actor: vera, cp: 300, nonce: "fund" });   // a share of the party fund too
    world.dialog = (config) => {
        assert.match(config.content, /Purge\.Balance/);
        return { confirm: "Test World", returns: "refunds", chat: false };
    };
    await purge.openPurge();
    await purge.openPurge();
    const claims = Object.values(flagsOf(docs.ledger).claims);
    assert.deepEqual(claims.map((c) => [c.kind, c.actor, c.cp, c.order]).sort(), [["refund", vera.uuid, 300, null], ["refund", vera.uuid, 700, "o1"]]);
    const issued = world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Purge.RefundsIssued").map(([, , o]) => o.format);
    assert.deepEqual(issued, [{ count: "2", waiting: "0" }, { count: "0", waiting: "2" }]);
    assert.ok(game.journal.get(docs.ledger.id), "nothing is deleted until the refunds are collected");
    // With the owner away, this GM's sweep applies them.
    await sync.sweep();
    assert.ok(claims.every((c) => read(`claims.${c.id}.resolved`)));
    assert.equal(docs.strongbox.items.size, 0);
    assert.deepEqual(memberBalances(records("rows")).byActor, [], "each refund paid its own allocation back");
    assert.equal(await purge.runPurge({ returns: "refunds", settleMs: 0 }), "done");
    assert.equal(cpOf(vera), 2000);
});

test("a garden's refund carries the garden, so it pays the garden's allocation back", async () => {
    await money.pledge({ actor: vera, cp: 200, garden: "g1", nonce: "g" });
    assert.equal(await purge.runPurge({ returns: "refunds", settleMs: 0 }), "refunds");
    assert.ok(Object.values(flagsOf(docs.ledger).claims).some((c) => c.garden === "g1" && c.cp === 200));
    await sync.sweep();
    assert.deepEqual(memberBalances(records("rows")).byActor, []);
});

test("the purge reads the balances when it runs, not when the dialog opened", async () => {
    world.dialog = async () => {
        await money.pledge({ actor: vera, cp: 100, order: "o1", nonce: "late" });   // while the GM types the name
        return { confirm: "Test World", returns: "refunds", chat: false };
    };
    await purge.openPurge();
    assert.deepEqual(Object.values(flagsOf(docs.ledger).claims).map((c) => c.cp), [800]);
});

test("finishing: flags removed everywhere, the ledger deleted, an empty strongbox deleted, settings reset", async () => {
    await money.payout({ actor: vera, row: { kind: "withdraw", idem: "withdraw:o1:x:1", cp: 700, actor: vera.uuid, order: "o1" } });
    const result = await purge.runPurge({ returns: "keep", settleMs: 0 });
    assert.equal(result, "done");
    assert.equal(game.journal.get(docs.ledger.id), undefined);
    assert.equal(game.actors.get(docs.strongbox.id), undefined);
    assert.equal(vera.flags[MOD], undefined);
    assert.equal(game.settings.get(MOD, "enabled"), false);
    assert.equal(game.folders.size, 0, "the empty module-data folder goes too");
    assert.ok(game.actors.get(vera.id), "characters stay");
});

test("the switch goes off first, so a slow purge does not re-create what it just deleted", async () => {
    await money.payout({ actor: vera, row: { kind: "withdraw", idem: "withdraw:o1:x:1", cp: 700, actor: vera.uuid, order: "o1" } });
    const deleteBox = docs.strongbox.delete.bind(docs.strongbox);
    docs.strongbox.delete = async (options) => {   // a hosted server: the ledger's deletion hook fires a refresh first
        mock.timers.tick(300);
        await settle();
        return deleteBox(options);
    };
    assert.equal(await purge.runPurge({ returns: "keep", settleMs: 0 }), "done");
    const found = locateShared();
    assert.deepEqual([found.ledger, found.strongbox], [null, null]);
    assert.equal(game.folders.size, 0);
});

test("a strongbox that still holds coins stays, as an ordinary loot actor", async () => {
    await purge.runPurge({ returns: "keep", settleMs: 0 });
    const box = game.actors.get(docs.strongbox.id);
    assert.ok(box);
    assert.equal(box.flags[MOD], undefined);
    assert.equal(box.items.size, 1);
});

test("moving everything to the party stash empties the strongbox first", async () => {
    const party = addDocument("Actor", { name: "Party", type: "party", ownership: { default: OWNER } });
    game.actors.party = party;
    await purge.runPurge({ returns: "party", settleMs: 0 });
    delete game.actors.party;
    assert.equal(game.actors.get(docs.strongbox.id), undefined);
    assert.equal(party.items.size, 1);
    assert.equal(party.items.contents[0].flags[MOD], undefined);
    assert.deepEqual(world.batches.at(-1).map((op) => op.action), ["delete", "create"], "deleted first, so a stop never leaves a copy in both");
});

test("a move to the party stash that does not apply in full stops the purge before anything is deleted", async (t) => {
    t.mock.method(console, "error", () => {});
    await money.pledge({ actor: vera, cp: 200, order: "o2", nonce: "two" });
    const party = addDocument("Actor", { name: "Party", type: "party", ownership: { default: OWNER } });
    game.actors.party = party;
    const [spent] = docs.strongbox.items.contents;
    world.server.beforeApply = (i, op) => {   // a move still in flight spends a stack between the dry run and the real pass
        if (i === 0 && op.action === "delete") docs.strongbox.items.delete(spent.id);
    };
    const result = await purge.runPurge({ returns: "party", settleMs: 0 });
    delete game.actors.party;
    assert.equal(result, "stopped");
    assert.equal(party.items.size, 0, "no copies");
    assert.ok(game.journal.get(docs.ledger.id), "the ledger stays");
    assert.equal(game.settings.get(MOD, "enabled"), true, "and the Workshop is back on");
    assert.ok(world.notes.some(([, key]) => key === "pf2e-artisans-workshop.Purge.MoveStopped"));
});

test("the sweep applies claims for absent owners on the GM's tab, and not on a tab without the lease", async () => {
    const idem = `refund:o1:${vera.uuid}:0`;
    await (await import("../../scripts/foundry/claims.mjs")).createClaims([{ kind: "refund", idem, actor: vera.uuid, cp: 100, parties: [vera.uuid] }]);
    resetLease();
    await sync.sweep();
    assert.equal(read(`claims.${hashId(idem)}.resolved`), undefined, "no lease, no sweep");
    requestLease(game.user.id);
    await sync.sweep();
    assert.ok(read(`claims.${hashId(idem)}.resolved`));
    assert.equal(records("rows").filter((r) => r.kind === "refund").length, 1);
});

test("switching the module off makes every client inert", async () => {
    await game.settings.set(MOD, "enabled", false);
    assert.equal(await sync.refresh(), "disabled");
    assert.equal(state.canWrite(), false);
    assert.equal((await money.pledge({ actor: vera, cp: 10, nonce: "x" })).reason, "not-ready");
});
