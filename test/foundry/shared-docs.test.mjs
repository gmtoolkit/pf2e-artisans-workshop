/**
 * The shared documents (DESIGN.md 5.2, P10), the schema check and migration (4.14), the deletion guards, and
 * the sync's status over the fake world.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { LIMITED, MOD, OWNER, addDocument, flagsOf, installFoundry, resetWorld, setUsers, world } from "./stubs.mjs";

installFoundry();
const { hashId } = await import("../../scripts/logic/ids.mjs");
const shared = await import("../../scripts/foundry/shared-docs.mjs");
const { ensureSchema } = await import("../../scripts/foundry/migrate.mjs");
const guards = await import("../../scripts/foundry/guards.mjs");
const { registerSettings, isEnabled } = await import("../../scripts/foundry/settings.mjs");
const { setCoinTemplates } = await import("../../scripts/foundry/coins.mjs");
const { requestLease, resetLease } = await import("../../scripts/foundry/lease.mjs");
const state = await import("../../scripts/foundry/state.mjs");
const sync = await import("../../scripts/foundry/sync.mjs");

let enabledCalls;
registerSettings({ enabled: (value, userId) => enabledCalls.push([value, userId]), docs: () => {} });
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

beforeEach(() => {
    resetWorld();
    state.resetState();
    resetLease();
    shared.resetMaintenance();
    enabledCalls = [];
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    setCoinTemplates({ pp: {}, gp: {}, sp: {}, cp: {} });
    requestLease(game.user.id);
});
afterEach(() => Object.defineProperty(globalThis, "navigator", realNavigator));

test("with the master switch off, a GM's ready writes nothing (P10)", async () => {
    assert.equal(isEnabled(), false);
    await shared.gmMaintenance();
    assert.equal(await sync.refresh(), "disabled");
    assert.deepEqual(world.calls, [], "no document or setting writes");
});

test("turning it on creates the ledger and strongbox; the loot actor's forced LIMITED is repaired to OWNER", async () => {
    await game.settings.set(MOD, "enabled", true);
    assert.deepEqual(enabledCalls, [[true, "gm00000000000000"]], "onChange gets the changing user");
    const { ledger, strongbox } = await shared.createShared();
    assert.equal(ledger.ownership.default, OWNER);
    assert.equal(strongbox.ownership.default, OWNER);
    assert.deepEqual(flagsOf(ledger), { role: "ledger", schema: 1 });
    assert.deepEqual(flagsOf(strongbox), { role: "strongbox", schema: 1 });
    assert.ok(world.calls.some(([kind, doc, , update]) => kind === "update" && doc === "Actor" && update["ownership.default"] === OWNER));
    assert.equal(game.folders.get(ledger.folder)?.flags[MOD].role, "folder");
    assert.deepEqual(game.settings.get(MOD, "docs"), { ledger: ledger.id, strongbox: strongbox.id });
    assert.equal(await sync.refresh(), "ready");
});

test("a GM tab without its user's lease (the second tab) creates and repairs nothing", async () => {
    await game.settings.set(MOD, "enabled", true);
    resetLease();
    world.calls.length = 0;
    await shared.gmMaintenance();
    assert.equal(await sync.refresh(), "missing");
    assert.deepEqual(world.calls, []);
});

test("a player cannot create them; a non-OWNER strongbox counts as missing until a GM repairs it", async () => {
    await game.settings.set(MOD, "enabled", true);
    const { strongbox } = await shared.createShared();
    strongbox.ownership.default = LIMITED;
    setUsers([{ id: "p1" }, { id: "gm00000000000000", isGM: true, active: false }], "p1");
    resetLease();
    requestLease("p1");
    await assert.rejects(shared.createShared(), /only a GM/);
    assert.equal(await sync.refresh(), "missing");
    world.currentUser = "gm00000000000000";
    game.users.get("gm00000000000000").active = true;
    assert.equal(await sync.refresh(), "ready");
    assert.equal(strongbox.ownership.default, OWNER);
});

test("deleted documents are re-created by the active GM at ready; duplicates: the oldest wins, GMs are told once", async () => {
    await game.settings.set(MOD, "enabled", true);
    const first = await shared.createShared();
    await first.strongbox.delete({ [MOD]: { internal: true } });
    await sync.refresh();
    const again = shared.locateShared();
    assert.ok(again.strongbox && again.strongbox.id !== first.strongbox.id);
    const late = addDocument("JournalEntry", { name: "Ledger 2", ownership: { default: OWNER }, flags: { [MOD]: { role: "ledger", schema: 1 } } });
    assert.equal(shared.locateShared().ledger, first.ledger, "the oldest");
    await shared.gmMaintenance();
    await shared.gmMaintenance();
    assert.equal(world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Sync.Duplicate").length, 1);
    assert.equal(late.flags[MOD].role, "ledger");
});

test("schema: current is ready; a newer document is read-only (said once); an older one is migrated by the elected client", async () => {
    await game.settings.set(MOD, "enabled", true);
    const { ledger, strongbox } = await shared.createShared();
    assert.equal(await ensureSchema({ ledger, strongbox }), "current");
    flagsOf(strongbox).schema = 2;
    assert.equal(await sync.refresh(), "newer");
    assert.equal(await sync.refresh(), "newer");
    assert.equal(world.notes.filter(([, key]) => key === "pf2e-artisans-workshop.Sync.Newer").length, 1);
    flagsOf(strongbox).schema = 1;
    delete flagsOf(ledger).schema;
    assert.equal(await ensureSchema({ ledger, strongbox }), "migrated");
    assert.equal(flagsOf(ledger).schema, 1);
    assert.equal(flagsOf(ledger).meta?.migration, undefined, "the marker is removed");
    assert.ok(ledger.pages.has(hashId("migration:1")), "the lock page names the target version");
});

test("a client that is not elected waits while migration is needed", async () => {
    await game.settings.set(MOD, "enabled", true);
    const { ledger, strongbox } = await shared.createShared();
    delete flagsOf(ledger).schema;
    setUsers([{ id: "p1" }, { id: "gm00000000000000", isGM: true }], "p1");
    assert.equal(await ensureSchema({ ledger, strongbox }), "migrating");
    assert.equal(flagsOf(ledger).schema, undefined);
});

test("a player a GM gave less than OWNER on one document only reads; the GM's check leaves that alone", async () => {
    await game.settings.set(MOD, "enabled", true);
    const { strongbox } = await shared.createShared();
    strongbox.ownership = { default: OWNER, p1: 2 };   // observer, to stop p1 taking coins
    setUsers([{ id: "p1" }, { id: "gm00000000000000", isGM: true }], "p1");
    resetLease();
    requestLease("p1");
    assert.equal(shared.locateShared().ready, false);
    assert.equal(await sync.refresh(), "missing");
    world.currentUser = "gm00000000000000";
    assert.equal(await sync.refresh(), "ready", "everyone else still writes");
    assert.deepEqual(strongbox.ownership, { default: OWNER, p1: 2 });
});

test("a player who loses OWNER on a shared document stops writing at once, even if no update hook reaches it", async () => {
    await game.settings.set(MOD, "enabled", true);
    const { strongbox } = await shared.createShared();
    setUsers([{ id: "p1" }, { id: "gm00000000000000", isGM: true }], "p1");
    resetLease();
    requestLease("p1");
    assert.equal(await sync.refresh(), "ready");
    // A GM lowers this player to OBSERVER. Without a canvas, core's Actor#_onUpdate throws on this client before any
    // updateActor hook, but its copy of the actor has the new ownership (seen live), so nothing re-checks the status.
    strongbox.ownership = { default: OWNER, p1: 2 };
    assert.equal(state.status(), "missing");
    assert.equal(state.canWrite(), false);
    strongbox.ownership = { default: OWNER };
    assert.equal(state.status(), "ready", "and back to ready once it is restored");
});

test("ownership is repaired once per session, and the GM is told; a restriction made later stands until the next", async () => {
    await game.settings.set(MOD, "enabled", true);
    const { ledger } = await shared.createShared();
    assert.equal(await sync.refresh(), "ready", "this session's check: nothing to repair");
    ledger.ownership.default = LIMITED;   // a GM freezes the Workshop on purpose
    assert.equal(await sync.refresh(), "missing");
    assert.equal(ledger.ownership.default, LIMITED, "not reverted at once");
    shared.resetMaintenance();   // the next session
    assert.equal(await sync.refresh(), "ready");
    assert.ok(world.notes.some(([, key]) => key === "pf2e-artisans-workshop.Sync.OwnershipRepaired"));
});

test("only the active GM creates the shared documents: an assistant turning the switch on, two calls at once", async () => {
    setUsers([{ id: "gm00000000000000", isGM: true }, { id: "agm0000000000000", isGM: true, role: 3 }], "agm0000000000000");
    resetLease();
    requestLease("agm0000000000000");
    await game.settings.set(MOD, "enabled", true);
    assert.equal(await sync.refresh(), "missing", "the assistant creates nothing while the GM is online");
    assert.equal(game.journal.size + game.actors.size, 0);
    world.currentUser = "gm00000000000000";
    resetLease();
    requestLease("gm00000000000000");
    await Promise.all([shared.createShared(), shared.createShared(), sync.refresh()]);
    // M12b: the ledger and the Crafting Log, each once.
    assert.deepEqual([game.journal.size, game.actors.size, game.folders.size], [2, 1, 1]);
    assert.deepEqual(game.journal.map((j) => j.flags[MOD].role).sort(), ["archive", "ledger"]);
    const log = shared.locateArchive();
    assert.equal(log.ownership.default, 2, "every player reads the Crafting Log (OBSERVER); only a GM writes it");
    assert.equal(log.folder, game.journal.find((j) => j.flags[MOD].role === "ledger").folder, "in the module's folder");
});

test("deletion guards: players are stopped; a GM is asked; the module's own deletions pass", async () => {
    await game.settings.set(MOD, "enabled", true);
    const { ledger, strongbox } = await shared.createShared();
    guards.registerGuards();
    setUsers([{ id: "p1" }], "p1");
    assert.equal(await ledger.delete(), undefined);
    assert.ok(world.notes.some(([, key]) => key === "pf2e-artisans-workshop.Guard.SharedDocument"));
    const page = (await ledger.createEmbeddedDocuments("JournalEntryPage", [{ _id: "lockpage00000001", name: "x" }], { keepId: true }))[0];
    assert.equal(await page.delete(), undefined, "a lock page by hand");
    assert.ok(await page.delete(guards.internal()), "the module's own");
    setUsers([{ id: "gm00000000000000", isGM: true }]);
    let asked = null;
    world.dialog = (config) => { asked = config; return "cancel"; };
    assert.equal(await strongbox.delete(), undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(asked.buttons.map((b) => b.action), ["purge", "delete", "cancel"]);
    assert.ok(game.actors.get(strongbox.id), "kept");
    world.dialog = () => "delete";
    await strongbox.delete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(game.actors.get(strongbox.id), undefined, "deleted after the GM chose to");
    const other = addDocument("JournalEntry", { name: "Notes" });
    assert.ok(await other.delete(), "other journals are not guarded");
});
