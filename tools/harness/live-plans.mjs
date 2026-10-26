/**
 * What `run-live.mjs` runs in the world: the preparation of the world, one plan per M2 scenario of
 * `sync-scenarios.mjs` (DESIGN.md 15.3), and checks of single behaviours that only a live world can settle.
 *
 * A plan is `async (h, world) => detail`: `h` is the harness (`only`, `step`, `together`, `evaluate`, `settle`,
 * `check`), `world` what `prepareWorld` found (user ids, the two player characters, the fixture actors). Every
 * plan starts from `resetWorld`: only the GM online, fresh shared documents, the same coins in both purses.
 *
 * The functions named `page*` run inside a browser page (`h.evaluate`), so they use only their argument and
 * Foundry's globals. A few import the module's own files by URL to read state or call a function the scenarios
 * do not expose; the browser hands back the module instance already loaded, so nothing runs twice. They read and
 * write world data only through the Foundry API.
 */
import { hashId } from "../../scripts/logic/ids.mjs";
import { applyMarkId } from "../../scripts/logic/lock-first.mjs";
import { PENDING_GRACE_MS } from "../../scripts/logic/reconcile.mjs";
import { FEAT, FIXTURES, FIXTURE_MARK, FOLDER_MARK, MARK_SCOPE } from "./fixtures.mjs";

const MOD = "pf2e-artisans-workshop";

/** The two player characters (fixtures 3 and 6, DESIGN.md 15.4) and the assistant GM user the plans need. */
const ASSIGN = [
    { role: "p1", user: "Player One", actor: "Fixture 3: Bomber alchemist, Talisman Dabbler" },
    { role: "p2", user: "Player Two", actor: "Fixture 6: Fighter crafter" },
];
const ASSISTANT = "Assistant GM";

/** The purse every plan starts with: 100 gp, 50 sp, 100 cp (10,600 cp). */
const COINS = { gp: 100, sp: 50, cp: 100 };

/** A compendium item to put in the strongbox: Elixir of Life (Minor), as in `sync-scenarios.mjs`. */
const ELIXIR = "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------- */
/*  In the page                                  */
/* -------------------------------------------- */

/**
 * GM: the assistant GM user, characters with OWNER, both in the party; what the plans need to know. Fixture actors
 * and their folder without a mark where `fixtures.mjs` puts it (`flags.world.<MODULE_ID>-fixture`, out of the purge's
 * reach) get it first, found by the names the fixture tools give them (`fixtures` holds `[id, name, npc]`): actors
 * built before the marks moved carry theirs in the module's flags, which a purge removes.
 */
async function pagePrepare({ mod, assistant, assign, fixtures, mark }) {
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const remarked = [];
    for (const [id, name, npc] of fixtures) {
        const actor = game.actors.find((a) => (npc ? a.name.startsWith(`${name} (`) : a.name === name) && a.type === (npc ? "npc" : "character"));
        if (actor && actor.flags?.[mark.scope]?.[mark.fixture] !== id) {
            await actor.update({ [`flags.${mark.scope}.${mark.fixture}`]: id });
            remarked.push(id);
        }
    }
    const folder = game.folders.find((f) => f.type === "Actor" && f.name === "Workshop fixtures");
    if (folder && !folder.flags?.[mark.scope]?.[mark.folder]) {
        await folder.update({ [`flags.${mark.scope}.${mark.folder}`]: true });
        remarked.push("folder");   // reported, so a folder the fixture tools made without the mark shows up
    }
    const created = [];
    if (!game.users.getName(assistant)) {
        await User.implementation.create({ name: assistant, role: CONST.USER_ROLES.ASSISTANT });
        created.push(assistant);
    }
    const pcs = {};
    for (const { role, user: userName, actor: actorName } of assign) {
        const user = game.users.getName(userName);
        const actor = game.actors.getName(actorName);
        if (!user || !actor) throw new Error(`world lacks ${userName} or ${actorName}`);
        if (actor.ownership[user.id] !== OWNER) await actor.update({ [`ownership.${user.id}`]: OWNER });
        if (user.character?.id !== actor.id) await user.update({ character: actor.id });
        pcs[role] = { id: actor.id, uuid: actor.uuid, name: actor.name };
    }
    const party = game.actors.party;
    const missing = Object.values(pcs).map((pc) => game.actors.get(pc.id)).filter((actor) => !party.members.includes(actor));
    if (missing.length) await party.addMembers(...missing);
    return {
        created, pcs, remarked,
        party: { id: party.id, members: party.members.map((m) => m.name), items: party.items.map((i) => i.id) },
        fixtures: game.actors.filter((a) => a.flags?.[mark.scope]?.[mark.fixture]).map((a) => [a.id, a.flags[mark.scope][mark.fixture]]),
        dev: game.settings.get(mod, "dev"),
    };
}

/**
 * GM: start a plan from a known world. The switch goes off; the shared documents (and strongboxes an earlier
 * purge left behind as plain loot actors) are deleted through the module's guard with its `internal` option; both
 * purses get `coins` and lose items earlier runs delivered; the party stash loses what a purge moved there; then,
 * with `enable`, the switch goes on and this GM creates the documents again. The fixture actors' marks need no
 * repair: they are outside the module's flags, which is all a purge removes.
 */
async function pageReset({ mod, pcIds, coins, enable, strays, party }) {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const internal = { [mod]: { internal: true } };
    if (game.settings.get(mod, "enabled")) {
        await game.settings.set(mod, "enabled", false);
        await wait(1000);
    }
    for (const doc of game.journal.filter((d) => d.flags?.[mod]?.role)) await doc.delete(internal);
    for (const doc of game.actors.filter((d) => d.flags?.[mod]?.role || strays.includes(d.id))) await doc.delete(internal);
    for (const folder of game.folders.filter((f) => f.flags?.[mod]?.role === "folder")) await folder.delete();
    await game.settings.set(mod, "docs", {});
    for (const id of pcIds) {
        const actor = game.actors.get(id);
        const old = actor.items.filter((i) => (i.type === "treasure" && i.isCoinage) || i.flags?.[mod]?.delivered).map((i) => i.id);
        if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
        await actor.inventory.addCurrency(coins);
    }
    const stash = game.actors.get(party.id);
    const moved = stash.items.filter((i) => !party.items.includes(i.id)).map((i) => i.id);
    if (moved.length) await stash.deleteEmbeddedDocuments("Item", moved);
    if (enable) await game.settings.set(mod, "enabled", true);
    const want = enable ? "ready" : "disabled";
    const end = Date.now() + 20000;
    while (Date.now() < end && game.modules.get(mod).dev.scenarios.snapshot().status !== want) await wait(200);
    return { status: game.modules.get(mod).dev.scenarios.snapshot().status, stashRemoved: moved.length };
}

/**
 * What the server holds, read back with a `get` request (the world as a client that loads now would see it),
 * summarised: the shared documents, rows, claims, reconciliation, and the given actors' coins and deliveries.
 */
async function pageServerView({ mod, actorIds, partyId = null }) {
    const UNIT = { pp: 1000, gp: 100, sp: 10, cp: 1 };
    const value = (item) => Object.entries(item.system?.price?.value ?? {}).reduce((sum, [d, n]) => sum + (UNIT[d] ?? 0) * n, 0);
    const coinCp = (items) => items.filter((i) => i.type === "treasure" && i.system?.category === "coin")
        .reduce((sum, i) => sum + (i.system.quantity ?? 0) * value(i), 0);
    const fetchAll = async (cls) => (await cls.database.get(cls, { query: {} })).map((doc) => doc.toObject());
    const oldest = (a, b) => (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0) || (a._id < b._id ? -1 : 1);
    const journals = (await fetchAll(JournalEntry.implementation)).filter((j) => j.flags?.[mod]?.role === "ledger").sort(oldest);
    const actors = await fetchAll(Actor.implementation);
    const boxes = actors.filter((a) => a.flags?.[mod]?.role === "strongbox").sort(oldest);
    const ledger = journals[0] ?? null;
    const box = boxes[0] ?? null;
    const flags = ledger?.flags?.[mod] ?? {};
    const live = (collection) => Object.values(collection ?? {}).filter((r) => r && r.id && r.v);
    const rows = live(flags.rows);
    const summary = (a) => (a ? {
        name: a.name, coinsCp: coinCp(a.items), items: a.items.length, flagged: !!a.flags?.[mod],
        delivered: a.items.filter((i) => i.flags?.[mod]?.delivered).map((i) => ({ id: i._id, name: i.name, row: i.flags[mod].delivered.row })),
    } : null);
    return {
        ledgers: journals.map((j) => ({ id: j._id, schema: j.flags[mod].schema ?? null, ownership: j.ownership, pages: j.pages.length, migration: j.flags[mod].meta?.migration ?? null })),
        strongboxes: boxes.map((a) => ({ id: a._id, schema: a.flags[mod].schema ?? null, ownership: a.ownership, coinsCp: coinCp(a.items), items: a.items.length,
            shelf: a.items.filter((i) => i.flags?.[mod]?.shelf).length })),
        pages: ledger ? ledger.pages.map((p) => ({ id: p._id, lock: p.flags?.[mod]?.lock ?? null, move: !!p.flags?.[mod]?.move })) : [],
        rows: rows.map(({ id, kind, state, cp, box: b, purse, idem, actor, author, at, stopped }) => ({ id, kind, state, cp, box: b, purse, idem, actor, author, at, stopped: stopped ?? null })),
        claims: live(flags.claims).map(({ id, kind, actor, cp, idem, at, resolved }) => ({ id, kind, actor, cp, idem, at, resolved: resolved ?? null })),
        roster: Object.keys(flags.roster ?? {}),
        expectedCp: rows.reduce((sum, r) => sum + (r.box ?? 0), 0),
        actualCp: box ? coinCp(box.items) : 0,
        actors: Object.fromEntries(actorIds.map((id) => [id, summary(actors.find((a) => a._id === id))])),
        party: partyId ? summary(actors.find((a) => a._id === partyId)) : null,
        partyItems: partyId ? (actors.find((a) => a._id === partyId)?.items ?? []).map((i) => ({ name: i.name, type: i.type, quantity: i.system?.quantity, flagged: !!i.flags?.[mod] })) : null,
        settings: { enabled: game.settings.get(mod, "enabled"), docs: game.settings.get(mod, "docs") },
    };
}

/**
 * This client's own copies against the server's: the ledger's flags and pages, the strongbox's items, and its
 * user's character's items with their quantities. After a lost lock request nothing local should differ.
 */
async function pageLocalVsServer({ mod }) {
    const canon = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
    const one = async (cls, id) => (await cls.database.get(cls, { query: { _id: id } }))[0]?.toObject() ?? null;
    const ledger = game.journal.find((j) => j.flags?.[mod]?.role === "ledger");
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const pc = game.user.character;
    const [sLedger, sBox, sPc] = await Promise.all([one(JournalEntry.implementation, ledger.id), one(Actor.implementation, box.id), pc ? one(Actor.implementation, pc.id) : null]);
    const ids = (list) => list.map((d) => d._id ?? d.id).sort();
    const quantities = (items) => canon(items.map((i) => [i._id ?? i.id, i.system?.quantity ?? null]).sort());
    return {
        ledgerFlags: canon(ledger.toObject().flags[mod]) === canon(sLedger.flags[mod]),
        pages: canon(ids([...ledger.pages])) === canon(ids(sLedger.pages)),
        strongboxItems: canon(ids([...box.items])) === canon(ids(sBox.items)),
        purse: pc ? quantities(pc.items.map((i) => i.toObject())) === quantities(sPc.items) : null,
        status: game.modules.get(mod).dev.scenarios.snapshot().status,
    };
}

/** The shared documents this client's module uses (`state.mjs`), whether they still exist here, and its status. */
async function pageSharedIds(mod) {
    const { shared, status } = await import(`/modules/${mod}/scripts/foundry/state.mjs`);
    const { ledger, strongbox } = shared();
    return { ledger: ledger?.id ?? null, strongbox: strongbox?.id ?? null, strongboxExists: !!strongbox && game.actors.has(strongbox.id), status: status() };
}

/** A ledger claim as this client has it. */
function pageClaim({ mod, id }) {
    const ledger = game.journal.find((j) => j.flags?.[mod]?.role === "ledger");
    return ledger?.flags?.[mod]?.claims?.[id] ?? null;
}

/** Wait until every open client has the ledger claim `id`, so steps that race on it start from the same state. */
async function claimEverywhere(h, id) {
    const end = Date.now() + 10000;
    for (const name of h.clients.keys()) {
        while (Date.now() < end && !(await h.clients.get(name).page.evaluate(pageClaim, { mod: MOD, id }))) await sleep(50);
    }
}

/** This client's user's auto-claim setting (`claims.auto`, user scope), set to `on`; returns the value before. */
async function pageAutoClaim({ mod, on }) {
    const before = game.settings.get(mod, "claims.auto");
    await game.settings.set(mod, "claims.auto", on);
    return before;
}

/**
 * Run `race` with Player One's auto-claim off, then put it back. A claim for Player One's character is applied by
 * Player One's own sweep half a second after it appears; a race of two clients applying it by hand has to start
 * before that, which a slow page (the canvas on) does not always manage, and the sweep then wins it instead.
 */
async function withoutPlayerOneSweep(h, race) {
    await h.evaluate("p1", pageAutoClaim, { mod: MOD, on: false }, "auto-claim off");
    try {
        return await race();
    } finally {
        await h.evaluate("p1", pageAutoClaim, { mod: MOD, on: true }, "auto-claim on");
    }
}

/** The fixture marks (`fixtures.mjs`) on this client's actors and folders: `[actor id, fixture id]` pairs, and a folder count. */
function pageFixtureMarks({ scope, fixture, folder }) {
    return {
        actors: game.actors.filter((a) => a.flags?.[scope]?.[fixture]).map((a) => [a.id, a.flags[scope][fixture]]).sort(),
        folders: game.folders.filter((f) => f.flags?.[scope]?.[folder]).length,
    };
}

/** The module's status on this client. */
const pageStatus = (mod) => game.modules.get(mod).dev.scenarios.snapshot().status;

/** Player: a deposit into the party fund through the module's own `pledge` (no order). */
async function pageDeposit({ mod, cp }) {
    const { pledge } = await import(`/modules/${mod}/scripts/foundry/money.mjs`);
    const { newId } = await import(`/modules/${mod}/scripts/foundry/store.mjs`);
    const result = await pledge({ actor: game.user.character, cp, nonce: newId() });
    return { ok: result.ok, outcome: result.outcome ?? result.reason };
}

/** Any owner: put a plain item (not a shelf item) in the strongbox. */
async function pageStoreItem({ mod, uuid }) {
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const source = (await fromUuid(uuid)).toObject();
    delete source._id;
    const [item] = await box.createEmbeddedDocuments("Item", [source]);
    return { id: item.id, name: item.name };
}

/* -------------------------------------------- */
/*  Shared plan steps                            */
/* -------------------------------------------- */

/** Prepare the world (idempotent) and read the user ids again, since it may create the assistant GM user. */
export async function prepareWorld(h) {
    await h.only(["gm"]);
    const fixtures = FIXTURES.map((f) => [f.id, f.name, !!f.npc]);
    const mark = { scope: MARK_SCOPE, fixture: FIXTURE_MARK, folder: FOLDER_MARK };
    const prepared = await h.evaluate("gm", pagePrepare, { mod: MOD, assistant: ASSISTANT, assign: ASSIGN, fixtures, mark });
    if (prepared.error) throw new Error(`prepare failed: ${prepared.error}`);
    await h.closeAll();
    const users = await h.refreshUserIds();
    const world = { ...prepared, users, strays: [] };
    h.check("world prepared: dev setting on, both characters assigned and in the party", prepared.dev === true && prepared.party.members.length >= 2, prepared);
    return world;
}

/** Only the GM online, and the world as every plan starts it (`pageReset`). */
export async function resetWorld(h, world, { enable = true } = {}) {
    await h.only(["gm"]);
    const result = await h.evaluate("gm", pageReset, {
        mod: MOD, pcIds: Object.values(world.pcs).map((pc) => pc.id), coins: COINS, enable, strays: world.strays, party: world.party,
    });
    world.strays = [];
    if (result.status !== (enable ? "ready" : "disabled")) throw new Error(`reset left the GM at ${JSON.stringify(result)}`);
    return result;
}

/**
 * Leave the world as the plans found it, give or take fresh shared documents: switch on, the strongboxes purges
 * left behind deleted, the purses refilled.
 */
export async function finishWorld(h, world) {
    const result = await resetWorld(h, world);
    await h.closeAll();
    return result;
}

/** The server's view, read from `client`. */
function serverView(h, client, world) {
    return h.evaluate(client, pageServerView, { mod: MOD, actorIds: Object.values(world.pcs).map((pc) => pc.id), partyId: world.party.id });
}

/** Rows of the server view whose idempotency key starts with `prefix`. */
const rowsWith = (view, prefix) => view.rows.filter((row) => row.idem.startsWith(prefix));

/** The server reconciles: expected and actual coins agree, nothing pending. */
function checkReconciles(h, view, label = "server: the strongbox reconciles and nothing is pending") {
    const pending = view.rows.filter((r) => r.state === "pending");
    return h.check(label, view.expectedCp === view.actualCp && pending.length === 0,
        { expectedCp: view.expectedCp, actualCp: view.actualCp, pending });
}

/** Every open client reports `status`, and none is stale. */
async function checkStatuses(h, status = "ready", label = `every client is ${status}`) {
    const seen = {};
    for (const name of h.clients.keys()) seen[name] = await h.evaluate(name, pageStatus, MOD, "status");
    return h.check(label, Object.values(seen).every((s) => s === status), seen);
}

/** What the open pages recorded since the last time (notifications, dry-run hooks), by client. */
const takeNotes = (h) => h.collectPages();

/** GM: the scenario's purge, remembering a strongbox it leaves as a plain loot actor. */
async function purge(h, world, returns) {
    const before = await h.evaluate("gm", (mod) => game.actors.find((a) => a.flags?.[mod]?.role === "strongbox")?.id ?? null, MOD, "strongbox id");
    const result = await h.step("gm", "9", "purge", { returns });
    const left = await h.evaluate("gm", (id) => !!game.actors.get(id), before, "strongbox left");
    if (before && left === true) world.strays.push(before);
    return result;
}

/* -------------------------------------------- */
/*  Scenario plans                               */
/* -------------------------------------------- */

export const SCENARIOS = {
    /** Two players, no GM: a refund claim for the offline Player One waits, and Player One's ready sweep applies it. */
    async 1(h, w) {
        await resetWorld(h, w);
        await h.only(["p2"]);
        await h.settle("ready");
        const before = await serverView(h, "p2", w);
        const created = await h.step("p2", "1", "create", { actor: w.pcs.p1.uuid, cp: 10 });
        h.check("1/create: the claim is recorded and not applied (Player One offline, no GM)", created.claim && created.resolved === false, created);
        await sleep(3000);
        const waiting = await h.evaluate("p2", pageClaim, { mod: MOD, id: created.claim }, "claim");
        h.check("1/create: still unapplied 3 s later", waiting && !waiting.resolved, waiting);
        await h.only(["p2", "p1"]);
        const login = await h.step("p1", "1", "login", { claim: created.claim });
        h.check("1/login: applied by Player One's ready sweep", login.applied === true && login.by === w.users.p1, login);
        await sleep(1500);
        const after = await serverView(h, "p1", w);
        const claim = after.claims.find((c) => c.id === created.claim);
        h.check("server: one applied refund row for the claim", rowsWith(after, claim?.idem ?? "-").filter((r) => r.state === "applied").length === 1, rowsWith(after, claim?.idem ?? "-"));
        h.check("server: Player One's purse is 10 cp up", after.actors[w.pcs.p1.id].coinsCp - before.actors[w.pcs.p1.id].coinsCp === 10,
            { before: before.actors[w.pcs.p1.id].coinsCp, after: after.actors[w.pcs.p1.id].coinsCp });
        checkReconciles(h, after);
        await checkStatuses(h);
        return { created, login, server: after };
    },

    /** GM and players: the GM applies a claim for the offline Player One; relay "deliver now" for a shelf item. */
    async 2(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p2"]);
        await h.settle("ready");
        const before = await serverView(h, "gm", w);
        const fallback = await h.step("p2", "2", "fallback", { actor: w.pcs.p1.uuid, cp: 10 });
        h.check("2/fallback: applied by the GM's client", fallback.applied === true && fallback.by === "Gamemaster", fallback);
        const relay = await h.step("p2", "2", "relay", { actor: w.pcs.p1.uuid });
        const answer = relay.answer?.results?.find((r) => r.id === relay.shelf?.item);
        h.check("2/relay: the GM answered and the shelf item is delivered (by the relay or the GM's sweep)",
            relay.answer?.ok === true && (answer ? answer.ok === true : true), relay);
        await sleep(3000);
        const after = await serverView(h, "gm", w);
        const rowId = hashId(relay.shelf.key);
        const delivered = after.actors[w.pcs.p1.id].delivered.filter((d) => d.row === rowId);
        h.check("server: the shelf item left the strongbox", after.strongboxes[0]?.shelf === 0, after.strongboxes);
        h.check("server: Player One's character received it exactly once", delivered.length === 1, after.actors[w.pcs.p1.id].delivered);
        h.check("server: one applied delivered row", after.rows.filter((r) => r.id === rowId && r.state === "applied").length === 1, after.rows.filter((r) => r.id === rowId));
        h.check("server: Player One's purse is 10 cp up", after.actors[w.pcs.p1.id].coinsCp - before.actors[w.pcs.p1.id].coinsCp === 10);
        checkReconciles(h, after);
        await checkStatuses(h);
        return { fallback, relay, winner: answer?.outcome ?? "sweep", server: after };
    },

    /** GM and assistant GM online (the GM in two tabs): every hook-driven write happens once. */
    async 3(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "gm#2", "assistant"]);
        await h.settle("ready");
        const actor = w.pcs.p1.uuid;   // its owner is offline, so the active GM (Gamemaster) is responsible
        await h.step("gm", "3", "watch", { actor });
        await h.step("assistant", "3", "touch", { actor });
        const quiet = await h.step("gm", "3", "count");
        h.check("3/touch: a change the snapshot ignores writes nothing", Object.keys(quiet.writers ?? {}).length === 0, quiet);
        await h.step("gm", "3", "watch", { actor });
        await h.step("assistant", "3", "crafting", { actor });
        const once = await h.step("gm", "3", "count");
        h.check("3/crafting by the assistant: one roster write, by the Gamemaster's lease tab", JSON.stringify(once.writers) === JSON.stringify({ Gamemaster: 1 }), once);
        await h.step("assistant", "3", "watch", { actor });
        await h.step("gm#2", "3", "crafting", { actor });
        const twice = await h.step("assistant", "3", "count");
        h.check("3/crafting from the GM's second tab: still one write", JSON.stringify(twice.writers) === JSON.stringify({ Gamemaster: 1 }), twice);
        await h.only(["gm", "gm#2", "assistant", "p2"]);
        await h.settle("ready");
        const claim = await h.step("p2", "3", "claim", { actor, cp: 10 });
        const after = await serverView(h, "gm", w);
        const claimRows = rowsWith(after, after.claims.find((c) => c.id === claim.claim)?.idem ?? "-");
        h.check("3/claim: applied once (one row on the client and on the server, the purse 10 cp up)",
            claim.claimRows === 1 && claimRows.length === 1 && claim.purseDelta === 10, { claim, claimRows });
        checkReconciles(h, after);
        await checkStatuses(h);
        return { quiet, once, twice, claim };
    },

    /** The GM in two tabs and a player in two tabs; then the player on two devices moving coins in one purse at once. */
    async "3b"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "gm#2", "p1", "p1#2"]);
        await h.settle("ready");
        const actor = w.pcs.p1.uuid;   // Player One is online in two tabs: the tab holding the lease writes
        await h.step("gm", "3", "watch", { actor });
        await h.step("p1", "3", "crafting", { actor });
        const fromFirst = await h.step("gm", "3", "count");
        h.check("3b/crafting in the player's first tab: one write, by Player One", JSON.stringify(fromFirst.writers) === JSON.stringify({ "Player One": 1 }), fromFirst);
        await h.step("gm", "3", "watch", { actor });
        await h.step("p1#2", "3", "crafting", { actor });
        const fromSecond = await h.step("gm", "3", "count");
        h.check("3b/crafting in the player's second tab: one write, by Player One", JSON.stringify(fromSecond.writers) === JSON.stringify({ "Player One": 1 }), fromSecond);
        await h.only(["gm", "gm#2", "p1", "p1#2", "p2"]);
        await h.settle("ready");
        const claim = await h.step("p2", "3", "claim", { actor, cp: 10 });
        const claimed = await serverView(h, "gm", w);
        const claimRows = rowsWith(claimed, claimed.claims.find((c) => c.id === claim.claim)?.idem ?? "-");
        h.check("3b/claim with Player One in two tabs: applied once (one row on the client and on the server)",
            claim.claimRows === 1 && claimRows.length === 1 && claim.purseDelta === 10, { claim, claimRows });

        // One player, two devices: each holds its own lease and coin mutex, so only the purse stack locks stop
        // two moves planned from the same coins.
        await h.only(["gm", "p1", "p1@2"]);
        await h.settle("ready");
        const races = {};
        for (const [name, a, b] of [["wage+pledge", "wage", "pledge"], ["wage+wage", "wage", "wage"], ["pledge+pledge", "pledge", "pledge"]]) {
            const before = await h.step("p1", "3", "purseBefore", { actor });
            const outcomes = await h.together([["p1", "3", a, { actor, cp: 10 }], ["p1@2", "3", b, { actor, cp: 10 }]]);
            const after = await h.step("p1", "3", "purseAfter", { actor, before: before.cp, rows: before.rows });
            h.check(`3b/${name} on two devices: the purse moved by exactly the applied rows`, after.ok === true, { outcomes, after });
            races[name] = { outcomes, after };
        }
        const view = await serverView(h, "gm", w);
        checkReconciles(h, view);
        await checkStatuses(h);
        return { fromFirst, fromSecond, claim, races };
    },

    /** Two players pledge to one order at the same moment, then one fires two pledges at once. */
    async "3c"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        const order = "test-order";
        const before = await serverView(h, "gm", w);
        const pair = await h.together([["p1", "3c", "pledge", { order, cp: 120 }], ["p2", "3c", "pledge", { order, cp: 120 }]]);
        h.check("3c/pledge at the same moment: both ok", pair.every((r) => r.outcome === "ok"), pair);
        const burst = await h.step("p1", "3c", "burst", { order, cp: 120 });
        h.check("3c/burst: both pledges ok", burst.outcomes?.every((o) => o === "ok"), burst);
        const checks = await h.together([["gm", "3c", "check"], ["p1", "3c", "check"], ["p2", "3c", "check"]]);
        h.check("3c/check on every client: no difference, nothing pending", checks.every((c) => c.ok === true), checks);
        const after = await serverView(h, "gm", w);
        const pledged = (role) => before.actors[w.pcs[role].id].coinsCp - after.actors[w.pcs[role].id].coinsCp;
        h.check("server: four pledge rows, all applied", rowsWith(after, "pledge:").filter((r) => r.state === "applied").length === 4, rowsWith(after, "pledge:"));
        h.check("server: Player One paid 360 cp (one pledge and a burst of two) and Player Two 120 cp", pledged("p1") === 360 && pledged("p2") === 120, { p1: pledged("p1"), p2: pledged("p2") });
        checkReconciles(h, after);
        await checkStatuses(h);
        return { pair, burst, checks };
    },

    /** Claim races, refunds collected at once, and a batch with an injected failure. */
    async 7(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        // The strongbox starts empty: the GM's `prepare` and `refunds` fill it from the claim's own character first.
        const race = await withoutPlayerOneSweep(h, async () => {
            const { claim } = await h.step("gm", "7", "prepare", { actor: w.pcs.p1.uuid, cp: 10 });
            h.check("7/prepare: the GM's claim is recorded (the GM, with no character, filled the strongbox)", typeof claim === "string", claim);
            await claimEverywhere(h, claim);
            return { claim, results: await h.together([["gm", "7", "race", { claim }], ["p1", "7", "race", { claim }]]) };
        });
        const { claim } = race;
        // The loser stops at its lock ("conflict": before sending, at the dry run or in the real pass) or, when the
        // winner's row reached it first, at the fast path ("already").
        const winners = race.results.filter((r) => r.outcome === "ok");
        const losers = race.results.filter((r) => r.outcome === "already" || (r.outcome === "conflict" && ["locked", "dry-run", "first", "gone"].includes(r.lostAt)));
        h.check("7/race: one winner, one loser that stopped before moving anything", winners.length === 1 && losers.length === 1, race.results);
        h.check("7/race: one row, the purse 10 cp up on both clients", race.results.every((r) => r.rows === 1 && r.purseDelta === 10), race.results);
        h.check("7/race: neither client is stale", race.results.every((r) => r.status === "ready"), race.results.map((r) => r.status));
        const pages = await takeNotes(h);
        const check = await h.step("gm", "7", "check", { claim });
        h.check("7/check: the claim's row exists once and the balance reconciles", check.ok === true, check);

        const { claims } = await h.step("gm", "7", "refunds", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], cp: 10 });
        const written = await serverView(h, "gm", w);
        const refundRows = written.claims.filter((c) => claims.includes(c.id));
        h.check("7/refunds: both claims written in one go (one stamp)", refundRows.length === 2 && new Set(refundRows.map((c) => JSON.stringify(c.at))).size === 1, refundRows);
        const collected = await h.together([["p1", "7", "collected", { claims }], ["p2", "7", "collected", { claims }]]);
        h.check("7/collected: each owner's refund applied once, neither client stale",
            collected.every((c) => c.resolved === true && c.rows.every((n) => n === 1) && c.status === "ready"), collected);

        const inject = await h.step("p1", "7", "inject", { actor: w.pcs.p1.uuid });
        h.check("7/inject: the move stops after its lock", inject.result?.outcome === "stopped" && inject.result?.phase === "apply", inject.result);
        h.check("7/inject: its row is left pending and reconciliation lists it", inject.state === "pending" && inject.pending?.some((p) => p.id === inject.row), { state: inject.state, pending: inject.pending });
        const view = await serverView(h, "gm", w);
        h.check("server: the injected row is pending with its lock page held", view.rows.some((r) => r.id === inject.row && r.state === "pending") && view.pages.some((p) => p.id === inject.row),
            { row: view.rows.find((r) => r.id === inject.row) });
        h.check("server: the only difference is the injected row's 1 cp", view.expectedCp - view.actualCp === 1, { expectedCp: view.expectedCp, actualCp: view.actualCp });
        return { race: race.results, dryRunHooks: Object.fromEntries(Object.entries(pages).map(([c, p]) => [c, p.dryRun])), collected, inject: inject.result };
    },

    /** The strongbox deleted and re-created: OWNER again, and players can pledge, shelve and have items delivered. */
    async "7b"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        const recreate = await h.step("gm", "7b", "recreate");
        h.check("7b/recreate: a new strongbox, default ownership OWNER", recreate.recreated === true && recreate.ownerDefault === 3 && recreate.status === "ready", recreate);
        // Right after the re-creation, before the players' debounced re-check: what they would write to.
        const justAfter = { p1: await h.evaluate("p1", pageSharedIds, MOD, "shared ids"), p2: await h.evaluate("p2", pageSharedIds, MOD, "shared ids") };
        h.check("7b: no player is ready while it still uses the deleted strongbox", Object.values(justAfter).every((s) => s.status !== "ready" || s.strongboxExists), justAfter);
        const fresh = (await serverView(h, "gm", w)).strongboxes[0]?.id;
        const end = Date.now() + 15000;
        let seen = justAfter;
        while (Date.now() < end && !Object.values(seen).every((s) => s.strongbox === fresh && s.status === "ready")) {
            await sleep(250);
            seen = { p1: await h.evaluate("p1", pageSharedIds, MOD, "shared ids"), p2: await h.evaluate("p2", pageSharedIds, MOD, "shared ids") };
        }
        h.check("7b: both players move to the new strongbox", Object.values(seen).every((s) => s.strongbox === fresh && s.status === "ready"), { fresh, seen });
        const p1 = await h.step("p1", "7b", "player", { actor: w.pcs.p2.uuid });
        h.check("7b/player (Player One for Player Two): deposit ok and the shelf item delivered", p1.deposit === "ok" && p1.delivered === true, p1);
        const p2 = await h.step("p2", "7b", "player", { actor: w.pcs.p1.uuid });
        h.check("7b/player (Player Two for Player One): deposit ok and the shelf item delivered", p2.deposit === "ok" && p2.delivered === true, p2);
        await sleep(1500);
        const view = await serverView(h, "gm", w);
        h.check("server: one strongbox, owned by every player", view.strongboxes.length === 1 && view.strongboxes[0].ownership.default === 3, view.strongboxes);
        h.check("server: each character received its item once", [w.pcs.p1.id, w.pcs.p2.id].every((id) => view.actors[id].delivered.length === 1),
            { p1: view.actors[w.pcs.p1.id].delivered, p2: view.actors[w.pcs.p2.id].delivered });
        h.check("server: the new strongbox holds the two deposits", view.actualCp === 20, { actualCp: view.actualCp });
        await checkStatuses(h);
        return { recreate, justAfter, p1, p2 };
    },

    /** The master switch off and on, a migration from schema 0, and the purge. */
    async 9(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        const toggle = await h.step("gm", "9", "toggle");
        h.check("9/toggle: off, then ready again on the GM", toggle.off === true && toggle.on === true, toggle);
        await h.settle("ready");
        const statuses = await h.together([["p1", "9", "status"], ["p2", "9", "status"]]);
        h.check("9/status after the toggle: every player ready", statuses.every((s) => s.status === "ready"), statuses.map((s) => s.status));
        const migrated = await h.step("gm", "9", "oldSchema");
        h.check("9/oldSchema: migrated by the elected client", migrated.migrated === true && migrated.status === "ready", migrated);
        await h.settle("ready");
        const afterMigration = await h.together([["p1", "9", "status"], ["p2", "9", "status"]]);
        h.check("9/status after the migration: every player ready", afterMigration.every((s) => s.status === "ready"), afterMigration.map((s) => s.status));
        await h.step("p1", "3c", "pledge", { order: "purge-order", cp: 120 });
        const marks = { scope: MARK_SCOPE, fixture: FIXTURE_MARK, folder: FOLDER_MARK };
        const marked = () => h.evaluate("gm", pageFixtureMarks, marks, "fixture marks");
        const marksBefore = await marked();
        const purged = await purge(h, w, "keep");
        h.check("9/purge: done, no flagged document left, the switch off", purged.result === "done" && purged.flaggedDocumentsLeft === 0 && purged.enabled === false, purged);
        const marksAfter = await marked();
        const everyFixture = new Set(marksBefore.actors.map(([, id]) => id)).size === FIXTURES.length && marksBefore.folders === 1;
        h.check("9/purge: every fixture actor and the fixtures' folder keep their marks",
            everyFixture && JSON.stringify(marksAfter) === JSON.stringify(marksBefore), { marksBefore, marksAfter });
        await sleep(5000);
        const view = await serverView(h, "gm", w);
        h.check("server: nothing re-created after the purge", view.ledgers.length === 0 && view.strongboxes.length === 0, { ledgers: view.ledgers, strongboxes: view.strongboxes });
        await checkStatuses(h, "disabled");
        return { toggle, migrated, purged };
    },
};

/* -------------------------------------------- */
/*  Behaviours only a live world settles         */
/* -------------------------------------------- */

/** GM and Player One apply the same refund claim at once, `times` times; what each loser left behind. */
async function lostLock(h, w) {
    await resetWorld(h, w);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await h.step("p2", "3c", "pledge", { order: "seed", cp: 1000 });
    await takeNotes(h);
    const rounds = [];
    for (let i = 0; i < 8; i++) {
        const [gm, p1] = await withoutPlayerOneSweep(h, async () => {
            const { claim } = await h.step("gm", "7", "prepare", { actor: w.pcs.p1.uuid, cp: 5 });
            await claimEverywhere(h, claim);
            return h.together([["gm", "7", "race", { claim }], ["p1", "7", "race", { claim }]]);
        });
        const pages = await takeNotes(h);
        const loserName = gm.outcome === "conflict" ? "gm" : p1.outcome === "conflict" ? "p1" : null;
        const local = loserName ? await h.evaluate(loserName, pageLocalVsServer, { mod: MOD }, "local vs server") : null;
        rounds.push({ outcomes: { gm: gm.outcome, p1: p1.outcome }, lostAt: (loserName === "gm" ? gm : p1)?.lostAt ?? null, loser: loserName,
            loserDryRunHooks: loserName ? pages[loserName].dryRun : [], loserErrors: loserName ? pages[loserName].notes.filter((n) => n.type === "error") : [], local });
    }
    for (const round of rounds.filter((r) => r.loser)) {
        const clean = round.local && Object.entries(round.local).every(([k, v]) => (k === "status" ? v === "ready" : v !== false));
        h.check(`lost at "${round.lostAt}": the loser's copies match the server and it is not stale`, clean, round);
        if (round.lostAt === "dry-run") {
            h.check("lost at the dry run: the replayed hooks carried options.dryRun", round.loserDryRunHooks.length > 0, round.loserDryRunHooks);
        }
    }
    h.check("every round had exactly one winner", rounds.every((r) => Object.values(r.outcomes).filter((o) => o === "ok").length === 1), rounds.map((r) => r.outcomes));
    return { rounds, lostAt: rounds.map((r) => r.lostAt) };
}

/**
 * pf2e's `ItemPF2e.deleteDocuments` drops ids of items the actor no longer holds, so a batch would go out
 * without the deletion; the module's check before sending must refuse such a move.
 */
async function pageDropProbe({ mod, uuid }) {
    const { runLockFirst } = await import(`/modules/${mod}/scripts/foundry/batch.mjs`);
    const { deliver } = await import(`/modules/${mod}/scripts/foundry/claims.mjs`);
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const ledger = game.journal.find((j) => j.flags?.[mod]?.role === "ledger");
    const actor = game.user.character;
    const source = (await fromUuid(uuid)).toObject();
    delete source._id;
    const [item] = await box.createEmbeddedDocuments("Item", [source]);
    const goneId = item.id;
    await box.deleteEmbeddedDocuments("Item", [goneId]);

    // 1. Core with pf2e: a batch deleting the gone item and updating the character.
    const ops = [
        { action: "delete", documentName: "Item", parent: box, ids: [goneId] },
        { action: "update", documentName: "Actor", updates: [{ _id: actor.id, "system.details.biography.appearance": `drop probe ${Date.now()}` }] },
    ];
    const results = await foundry.documents.modifyBatch(ops);
    const raw = { idsSent: ops[0].ids, applied: results.map((r) => r.map((d) => d.documentName ?? typeof d)) };

    // 2. The module's lock-first move with that deletion: refused before its lock request is sent.
    const pagesBefore = ledger.pages.size;
    const move = await runLockFirst({ lock: [{ op: "lock", ids: [foundry.utils.randomID()] }], apply: [{ op: "deleteItems", target: "strongbox", ids: [goneId] }] });
    const pagesAfter = ledger.pages.size;

    // 3. A delivery of a shelf item someone took by hand (no row): looked up again inside the mutex, refused.
    const shelfSource = (await fromUuid(uuid)).toObject();
    delete shelfSource._id;
    foundry.utils.setProperty(shelfSource, `flags.${mod}.shelf`, { for: actor.uuid, from: actor.uuid, order: null, claimKey: `deliver:probe:${foundry.utils.randomID()}`, at: Date.now() });
    // created and deleted by the GM-less path: this client owns the strongbox
    const [shelf] = await box.createEmbeddedDocuments("Item", [shelfSource], { render: false });
    const stale = shelf;   // a reference a sweep might still hold
    await box.deleteEmbeddedDocuments("Item", [shelf.id]);
    const delivery = await deliver(stale, actor);
    return { raw, move, lockPagesAdded: pagesAfter - pagesBefore, delivery };
}

/**
 * A batch the server refuses at its dry run, built so that every other operation passes it: a ledger page that
 * exists on the server is forgotten here first (as when the winner's broadcast has not arrived yet), and the batch
 * also updates a coin stack and the character, and creates an item on the character and one in the strongbox.
 * What the requesting client then processes (the "dry-run replay", DESIGN.md 5.4) is read back here.
 */
async function pageDryRunReplay({ mod, uuid }) {
    const ledger = game.journal.find((j) => j.flags?.[mod]?.role === "ledger");
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const { status } = await import(`/modules/${mod}/scripts/foundry/state.mjs`);
    const actor = game.user.character;
    const stack = actor.itemTypes.treasure.find((i) => i.isCoinage && i.unit === "cp");
    const pageId = foundry.utils.randomID();
    await ledger.createEmbeddedDocuments("JournalEntryPage", [{ _id: pageId, name: pageId, type: "text" }], { keepId: true });
    ledger.pages.delete(pageId);   // this client only
    const source = (await fromUuid(uuid)).toObject();
    delete source._id;
    source.name = `replay probe ${pageId}`;
    const before = { quantity: stack.quantity, items: actor.items.size, boxItems: box.items.size, status: status() };
    const ops = [
        { action: "update", documentName: "Item", parent: actor, updates: [{ _id: stack.id, "system.quantity": stack.quantity + 7 }] },
        { action: "create", documentName: "Item", parent: actor, data: [source] },
        { action: "create", documentName: "Item", parent: box, data: [source] },
        { action: "update", documentName: "Actor", updates: [{ _id: actor.id, "system.details.biography.appearance": `replay probe ${pageId}` }] },
        { action: "create", documentName: "JournalEntryPage", parent: ledger, keepId: true, data: [{ _id: pageId, name: pageId, type: "text" }] },
    ];
    const results = await foundry.documents.modifyBatch(ops);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = { quantity: stack.quantity, items: actor.items.size, boxItems: box.items.size, status: status(),
        probeItemsHere: actor.items.filter((i) => i.name === source.name).length + box.items.filter((i) => i.name === source.name).length };
    return { pageId, name: source.name, actorId: actor.id, stackId: stack.id, results: results.length, before, after };
}

/** Player One's coin stack written three times directly and once in a batch; the version every client sees. */
async function pageBumpStack() {
    const actor = game.user.character;
    const stack = actor.itemTypes.treasure.find((i) => i.isCoinage && i.unit === "cp");
    const steps = [];
    for (let i = 0; i < 3; i++) {
        const before = stack._stats.modifiedTime;
        await stack.update({ "system.quantity": stack.quantity + 1 });
        steps.push({ via: "update", before, after: stack._stats.modifiedTime });
    }
    const before = stack._stats.modifiedTime;
    await foundry.documents.modifyBatch([{ action: "update", documentName: "Item", parent: actor, updates: [{ _id: stack.id, "system.quantity": stack.quantity - 3 }] }]);
    steps.push({ via: "modifyBatch", before, after: stack._stats.modifiedTime });
    const source = stack.toObject();
    delete source._id;
    source.system.quantity = 1;
    const [created] = await foundry.documents.modifyBatch([{ action: "create", documentName: "Item", parent: actor, data: [source] }]);
    const fresh = created[0];
    const createdVersion = fresh._stats.modifiedTime;
    await actor.deleteEmbeddedDocuments("Item", [fresh.id]);
    return { actorId: actor.id, stackId: stack.id, final: stack._stats.modifiedTime, steps, createdVersion };
}

/** The version (`_stats.modifiedTime`) of one embedded item on this client. */
const pageItemVersion = ({ actorId, itemId }) => game.actors.get(actorId)?.items.get(itemId)?._stats?.modifiedTime ?? null;

/** The version of one embedded item on the server. */
async function pageServerItemVersion({ actorId, itemId }) {
    const [actor] = await Actor.implementation.database.get(Actor.implementation, { query: { _id: actorId } });
    return actor?.items.get(itemId)?._stats?.modifiedTime ?? null;
}

/**
 * This client's server time, wall clock and launch (`game.world.lastPlayed`), and, with `write`, a write's server
 * stamp (`_stats.modifiedTime`, the server's own clock) against the module's `serverNow` before and after it.
 */
async function pageServerTime({ mod, write = false }) {
    const { serverNow } = await import(`/modules/${mod}/scripts/foundry/store.mjs`);
    const sample = { serverTime: game.time.serverTime, now: Date.now(), lastPlayed: game.world.lastPlayed, launch: Date.parse(game.world.lastPlayed) };
    if (!write) return sample;
    const actor = game.user.character;
    const t0 = serverNow();
    await actor.update({ "system.details.biography.appearance": `time probe ${Date.now()}` });
    const t1 = serverNow();
    return { ...sample, t0, stamp: actor._stats.modifiedTime, t1 };
}

/**
 * Player One takes the migration lock as a client does before migrating (`takeLock` in `migrate.mjs`): a lock page
 * and the marker, stamped by the module's own `stampNow`, then the documents read as schema 0. The stamp is made as
 * of `agoMs` ago on a client whose clock runs `skewMs` fast: for that one synchronous call, `Date.now`,
 * `game.time.serverTime` and `game.world.lastPlayed` give what that client had then, and are put back at once. With
 * `ranLongerMs`, "then" is in an earlier launch of the world that had run that much longer than this one has so
 * far, so the stamp's server time is ahead of today's. A stamp without its launch, or with a launch taken from the
 * client's own clock, is then off by the skew, and the lock is not broken when it should be.
 */
async function pageTakeMigrationLock({ mod, agoMs, ranLongerMs = 0, skewMs = 0 }) {
    const { hashId } = await import(`/modules/${mod}/scripts/logic/ids.mjs`);
    const { SCHEMA_VERSION } = await import(`/modules/${mod}/scripts/logic/migrations.mjs`);
    const { stampNow } = await import(`/modules/${mod}/scripts/foundry/store.mjs`);
    const ledger = game.journal.find((j) => j.flags?.[mod]?.role === "ledger");
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const id = hashId(`migration:${SCHEMA_VERSION}`);
    // The moment of the stamp on the server's clock, and the launch and server time a client had at that moment.
    const launch = Date.parse(game.world.lastPlayed);
    const moment = launch + game.time.serverTime - agoMs;
    const thenLaunch = ranLongerMs ? Math.floor((moment - game.time.serverTime - ranLongerMs) / 1000) * 1000 : launch;
    const thenServerTime = moment - thenLaunch;
    const realNow = Date.now;
    const lastPlayed = game.world.lastPlayed;
    let stamp;
    Date.now = () => moment + skewMs;
    game.world.lastPlayed = new Date(thenLaunch).toString();
    Object.defineProperty(game.time, "serverTime", { get: () => thenServerTime, configurable: true });
    try {
        stamp = stampNow();
    } finally {
        Date.now = realNow;
        game.world.lastPlayed = lastPlayed;
        delete game.time.serverTime;
    }
    const restored = Date.parse(game.world.lastPlayed) === launch && Math.abs(Date.now() - (launch + game.time.serverTime)) < 5000;
    const lock = { to: SCHEMA_VERSION, ...stamp };
    await ledger.createEmbeddedDocuments("JournalEntryPage", [{ _id: id, name: id, type: "text", flags: { [mod]: { lock } } }], { keepId: true });
    await ledger.update({ [`flags.${mod}.meta.migration`]: lock, [`flags.${mod}.schema`]: 0 });
    await box.update({ [`flags.${mod}.schema`]: 0 });
    return { page: id, lock, moment, thenLaunch, thenServerTime, restored };
}

/** The lock's stamp is `stampNow`'s: on the server's clock (its launch plus its server time) at the moment asked for. */
function checkLockStamp(h, taken, label) {
    const at = taken.lock?.at ?? {};
    return h.check(`${label}: stamped by stampNow, at the moment asked for on the server's clock, the client clock 3 h fast, the clocks put back`,
        at.launch === taken.thenLaunch && at.launch + at.server === taken.moment && at.real === taken.moment + SKEW_MS && taken.restored === true, taken);
}

/** How far the clock of a client that writes a stamp in `migration-lock` and `relaunch-stamp` runs fast. */
const SKEW_MS = 3 * 60 * 60 * 1000;

/**
 * Player One's deposit while every batch answer from the server comes `delayMs` late, as from a busy server. The
 * database backend's own `modifyDocumentBatch` (which `foundry.documents.modifyBatch` calls; that namespace is
 * read-only) runs at once and only its answer is held back, through an own property on the backend instance that is
 * deleted afterwards, so the server and this client's copies are as usual. The move should wait for both answers
 * and complete (DESIGN.md 5.4).
 */
async function pageSlowAnswer({ mod, delayMs }) {
    const { pledge } = await import(`/modules/${mod}/scripts/foundry/money.mjs`);
    const { newId } = await import(`/modules/${mod}/scripts/foundry/store.mjs`);
    const { status } = await import(`/modules/${mod}/scripts/foundry/state.mjs`);
    const backend = CONFIG.DatabaseBackend;
    const real = backend.modifyDocumentBatch;
    const answers = [];
    backend.modifyDocumentBatch = async function (operations) {
        const sent = operations.map((op) => `${op.action} ${op.documentName}`);
        const answer = await real.call(this, operations);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        answers.push(sent);
        return answer;
    };
    const t0 = Date.now();
    try {
        const result = await pledge({ actor: game.user.character, cp: 10, nonce: newId() });
        return { outcome: result.outcome ?? result.reason, reason: result.reason ?? null, ms: Date.now() - t0, answers, status: status() };
    } finally {
        delete backend.modifyDocumentBatch;
    }
}

/**
 * GM: rebuild fixture actors with the fixture tools (`fixtures.create({only, reset: true})`), recording every pf2e
 * choice prompt (a `PickAThingPrompt`: an ApplicationV2 with `resolveSelection`) that renders meanwhile. A prompt is
 * closed at once, unanswered, so the build cannot hang on it. Reads back the cleric's Domain Initiate (DESIGN.md
 * 15.4: answered two grants deep) and whether the compendium copy the builder answered it on was put back.
 */
async function pageRebuildFixtures({ mod, only, domainInitiate }) {
    const prompts = [];
    const onRender = (app) => {
        if (typeof app.resolveSelection !== "function") return;
        prompts.push({ app: app.constructor.name, title: app.title, prompt: app.prompt ?? null, choices: (app.choices ?? []).map((c) => c.label ?? c.value) });
        app.close();
    };
    const hook = Hooks.on("renderApplicationV2", onRender);
    try {
        const report = await game.modules.get(mod).dev.fixtures.create({ only, reset: true });
        const built = report.map((row) => {
            const actor = fromUuidSync(row.uuid);
            const feats = actor.items.filter((i) => i.sourceId === domainInitiate);
            return { ...row, name: actor.name, level: actor.level,
                domainInitiate: feats.map((i) => ({ name: i.name, selection: i.system.rules.find((r) => r.key === "ChoiceSet")?.selection ?? null })),
                doctrines: actor.items.filter((i) => /Doctrine/.test(i.name)).map((i) => i.name) };
        });
        const copy = (await fromUuid(domainInitiate)).toObject().system.rules.find((r) => r.key === "ChoiceSet");
        const sameName = game.actors.filter((a) => built.some((b) => b.name === a.name)).length;
        return { report: built, prompts, copySelection: copy?.selection ?? null, actorsWithThatName: sameName };
    } finally {
        Hooks.off("renderApplicationV2", hook);
    }
}

/**
 * Player One: a deposit whose lock request lands and whose answer is lost with the connection, so the apply request
 * is never sent, as when a tab closes or the connection drops between the two requests (DESIGN.md 5.4, As built:
 * Resume). socket.io hands the answer to the acknowledgement Foundry gave it (`SocketInterface.dispatch`); that
 * acknowledgement is swapped, for this one request, for one that closes the transport instead, so the server is
 * known to have applied the lock request and this client never hears it. Foundry reconnects by itself within a
 * second; the client is then stale. This reaches `game.socket`, which the module itself may not
 * (`eslint.config.mjs`).
 */
async function pageStrandDeposit({ mod, cp }) {
    const { pledge } = await import(`/modules/${mod}/scripts/foundry/money.mjs`);
    const { newId } = await import(`/modules/${mod}/scripts/foundry/store.mjs`);
    const { status } = await import(`/modules/${mod}/scripts/foundry/state.mjs`);
    const socket = game.socket;
    const own = Object.hasOwn(socket, "emit");
    const emit = socket.emit;
    let dropped = 0;
    socket.emit = function (event, ...args) {
        if (event === "modifyDocumentBatch" && dropped === 0 && typeof args.at(-1) === "function") {
            dropped += 1;
            args[args.length - 1] = () => socket.io.engine.close();
        }
        return emit.call(this, event, ...args);
    };
    let result;
    try {
        result = await pledge({ actor: game.user.character, cp, nonce: newId() });
    } finally {
        if (own) socket.emit = emit;
        else delete socket.emit;
    }
    const end = Date.now() + 15000;
    while (!socket.connected && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 200));
    return { outcome: result.outcome ?? result.reason, reason: result.reason ?? null, row: result.rows?.[0]?.id ?? null, dropped,
        status: status(), connected: socket.connected };
}

/** Any client: run the module's catch-up sweep now (`sync.mjs`). */
async function pageSweep({ mod }) {
    const { sweep } = await import(`/modules/${mod}/scripts/foundry/sync.mjs`);
    await sweep();
    return true;
}

/** Player Two: shelve an item for Player One, wait `delayMs`, then ask the GM to deliver it now. */
async function pageShelveThenRelay({ mod, uuid, recipient, delayMs }) {
    const { requestApplyNow } = await import(`/modules/${mod}/scripts/foundry/relay.mjs`);
    const { newId, stampNow } = await import(`/modules/${mod}/scripts/foundry/store.mjs`);
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const source = (await fromUuid(uuid)).toObject();
    delete source._id;
    const key = `deliver:scenario:${newId()}`;
    foundry.utils.setProperty(source, `flags.${mod}.shelf`, { for: recipient, from: game.user.character.uuid, order: null, claimKey: key, at: stampNow().at });
    const [item] = await box.createEmbeddedDocuments("Item", [source]);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const answer = await requestApplyNow(recipient);
    return { item: item.id, key, answer: JSON.parse(JSON.stringify(answer)) };
}

export const BEHAVIOURS = {
    /** A lock request lost at the dry run carries options.dryRun and leaves nothing local. */
    "lost-lock": lostLock,

    /** What a client is left with after the server refuses its batch at the dry run. */
    async "dry-run-replay"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1"]);
        await h.settle("ready");
        await takeNotes(h);
        const probe = await h.evaluate("p1", pageDryRunReplay, { mod: MOD, uuid: ELIXIR }, "dry-run replay");
        const pages = await takeNotes(h);
        const view = await serverView(h, "gm", w);
        const serverStack = await h.evaluate("gm", ({ actorId, itemId }) => game.actors.get(actorId)?.items.get(itemId)?.quantity ?? null,
            { actorId: probe.actorId, itemId: probe.stackId }, "stack quantity on the GM");
        h.check("the server applied nothing", serverStack === probe.before.quantity && view.actors[probe.actorId].items === probe.before.items, { serverStack, probe });
        h.check("nothing was committed or created on the requesting client", probe.after.quantity === probe.before.quantity && probe.after.probeItemsHere === 0, probe);
        h.check("the requesting client is not stale", probe.after.status === "ready", probe.after);
        return { probe, dryRunHooks: pages.p1?.dryRun ?? [], notifications: pages.p1?.notes ?? [] };
    },

    /** pf2e dropping the delete of an already-gone item is caught before sending. */
    async "pf2e-drop"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1"]);
        await h.settle("ready");
        const probe = await h.evaluate("p1", pageDropProbe, { mod: MOD, uuid: ELIXIR }, "drop probe");
        h.check("pf2e sends a batch without the deletion of an item the actor no longer holds", Array.isArray(probe.raw?.idsSent) && probe.raw.idsSent.length === 0, probe.raw);
        h.check("the module refuses such a move before its lock request (conflict, gone, no lock page)",
            probe.move?.outcome === "conflict" && probe.move?.reason === "gone" && probe.lockPagesAdded === 0, { move: probe.move, lockPagesAdded: probe.lockPagesAdded });
        h.check("a delivery of a shelf item taken by hand is refused as gone", probe.delivery?.ok === false && probe.delivery?.reason === "gone", probe.delivery);
        await checkStatuses(h);
        return probe;
    },

    /** _stats.modifiedTime of an embedded coin item changes on every write and reaches every client. */
    async "modified-time"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        const bump = await h.evaluate("p1", pageBumpStack, null, "bump stack");
        await sleep(1000);
        const ref = { actorId: bump.actorId, itemId: bump.stackId };
        const seen = {
            p1: await h.evaluate("p1", pageItemVersion, ref, "version"),
            p2: await h.evaluate("p2", pageItemVersion, ref, "version"),
            gm: await h.evaluate("gm", pageItemVersion, ref, "version"),
            server: await h.evaluate("gm", pageServerItemVersion, ref, "server version"),
        };
        h.check("every write gave the stack a later version on the writing client", bump.steps.every((s) => s.after > s.before), bump.steps);
        h.check("every client and the server hold the same version", new Set(Object.values(seen)).size === 1 && seen.server === bump.final, seen);
        h.check("a stack created in a batch has a version", typeof bump.createdVersion === "number" && bump.createdVersion > 0, bump.createdVersion);
        return { bump, seen };
    },

    /** game.time.serverTime agrees across clients and with the server's own stamps. */
    async "server-time"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "assistant", "p1", "p2"]);
        await h.settle("ready");
        // All pages run on this machine, so their wall clocks agree; `now - serverTime` is then the moment each
        // client takes the server's clock to have started.
        const samples = await Promise.all([...h.clients.keys()].map(async (name) => [name, await h.evaluate(name, pageServerTime, { mod: MOD }, "server time")]));
        const offsets = Object.fromEntries(samples.map(([name, s]) => [name, s.serverTime - s.now]));
        const spread = Math.max(...Object.values(offsets)) - Math.min(...Object.values(offsets));
        const launches = new Set(samples.map(([, s]) => s.launch));
        const write = await h.evaluate("p1", pageServerTime, { mod: MOD, write: true }, "server time with a write");
        const status = await fetch(`${h.url}/api/status`).then((r) => r.json());
        h.check("every client's serverTime is a number", Object.values(offsets).every(Number.isFinite), offsets);
        // Each client's serverTime is core's estimate (`GameTime#sync`: the server's time when it last answered, plus
        // half the average round trip), so a page busy when the answer came (the canvas loading) runs behind. Measured:
        // within 1 ms without a canvas, up to 0.4 s with one. The module's ages need far less than the 60 s grace.
        h.check("clients agree on serverTime within 1 s", spread <= 1000, { offsets, spread });
        // serverTime counts from the launch (Foundry 14.368 dist/components/activity.mjs), so it matches the server's
        // uptime, not its clock; the launch (game.world.lastPlayed, to the second) puts it on the server's clock.
        h.check("serverTime counts from the world's launch: it is about the server's uptime", Math.abs(write.serverTime - status.uptime) < 5000,
            { serverTime: write.serverTime, uptime: status.uptime });
        h.check("every client reads the same launch from game.world.lastPlayed", launches.size === 1 && Number.isFinite([...launches][0]),
            Object.fromEntries(samples.map(([name, s]) => [name, s.lastPlayed])));
        h.check("the launch plus serverTime (serverNow) is on the clock of the server's document stamps, within 2 s",
            write.stamp >= write.t0 - 2000 && write.stamp <= write.t1 + 2000, write);
        return { offsets, spread, write, serverUptimeMs: status.uptime, launch: new Date(write.launch).toISOString() };
    },

    /** Several players collect purge refunds, each sweeping in its turn: every refund applied once, no conflict. */
    async "sweep-stagger"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        for (const name of ["p1", "p2"]) {
            await h.step(name, "3c", "pledge", { order: "stagger-order", cp: 120 });
            await h.evaluate(name, pageDeposit, { mod: MOD, cp: 50 }, "deposit");
        }
        await takeNotes(h);
        const issued = await purge(h, w, "refunds");
        h.check("9/purge with refunds: refund claims issued, nothing purged yet", issued.result === "refunds", issued);
        // A claim is marked resolved with its lock, before its coins move, so wait for the rows to be applied too.
        const end = Date.now() + 30000;
        let view = await serverView(h, "gm", w);
        const open = (v) => v.claims.some((c) => c.idem.startsWith("purge-refund:") && (!c.resolved || !rowsWith(v, c.idem).every((r) => r.state === "applied")));
        while (Date.now() < end && open(view)) {
            await sleep(500);
            view = await serverView(h, "gm", w);
        }
        const refunds = view.claims.filter((c) => c.idem.startsWith("purge-refund:"));
        const createdAt = Math.min(...refunds.map((c) => c.at.server));
        const timeline = refunds.map((c) => ({ actor: c.actor, idem: c.idem, by: c.resolved?.by ?? null, afterMs: c.resolved ? c.resolved.at.server - createdAt : null,
            rows: rowsWith(view, c.idem).length }));
        const pages = await takeNotes(h);
        h.check("four refund claims (an order share and a fund share per player), all applied", refunds.length === 4 && refunds.every((c) => c.resolved), timeline);
        h.check("each refund wrote one row", timeline.every((t) => t.rows === 1), timeline);
        h.check("each refund applied by its owner's client", timeline.every((t) => t.by === (t.actor === w.pcs.p1.uuid ? w.users.p1 : w.users.p2)), timeline);
        const errors = Object.fromEntries(Object.entries(pages).map(([c, p]) => [c, p.notes.filter((n) => n.type === "error")]));
        h.check("no client showed an error (no lock conflict)", Object.values(errors).every((e) => e.length === 0), errors);
        await checkStatuses(h);
        checkReconciles(h, view, "server: after the refunds the strongbox reconciles");
        const done = await purge(h, w, "refunds");
        h.check("9/purge again with nothing left to refund: it goes on and purges", done.result === "done" && done.flaggedDocumentsLeft === 0, done);
        return { timeline, errors, done };
    },

    /** The purge moving everything to the party stash: the stash takes the items, nothing is re-created. */
    async "purge-party"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        await h.step("p1", "3c", "pledge", { order: "party-order", cp: 120 });
        await h.evaluate("p1", pageStoreItem, { mod: MOD, uuid: ELIXIR }, "store an item");
        const before = await serverView(h, "gm", w);
        const purged = await purge(h, w, "party");
        h.check("9/purge to the party stash: done", purged.result === "done" && purged.flaggedDocumentsLeft === 0, purged);
        await sleep(5000);
        const view = await serverView(h, "gm", w);
        const added = view.partyItems.length - w.party.items.length;
        h.check("server: the party stash took every strongbox item", added === before.strongboxes[0].items && view.party.coinsCp === before.strongboxes[0].coinsCp,
            { before: before.strongboxes[0], partyItems: view.partyItems, partyCoinsCp: view.party.coinsCp });
        h.check("server: no item in the stash keeps module flags", view.partyItems.every((i) => !i.flagged), view.partyItems);
        h.check("server: nothing re-created 5 s after the purge", view.ledgers.length === 0 && view.strongboxes.length === 0, { ledgers: view.ledgers, strongboxes: view.strongboxes });
        await checkStatuses(h, "disabled");
        return { purged, partyItems: view.partyItems };
    },

    /** The assistant GM turns the switch on while the GM (in two tabs) is online: one set of documents. */
    async "assistant-switch"(h, w) {
        await resetWorld(h, w, { enable: false });
        await h.only(["gm", "gm#2", "assistant"]);
        await h.settle("disabled");
        await h.evaluate("assistant", (mod) => game.settings.set(mod, "enabled", true).then(() => true), MOD, "assistant turns the switch on");
        await h.settle("ready");
        await sleep(3000);
        const view = await serverView(h, "gm", w);
        h.check("server: exactly one ledger and one strongbox", view.ledgers.length === 1 && view.strongboxes.length === 1, { ledgers: view.ledgers, strongboxes: view.strongboxes });
        h.check("the docs setting names them", view.settings.docs.ledger === view.ledgers[0]?.id && view.settings.docs.strongbox === view.strongboxes[0]?.id, view.settings);
        const pages = await takeNotes(h);
        const duplicates = Object.values(pages).flatMap((p) => p.notes).filter((n) => n.message.includes("Sync.Duplicate"));
        h.check("no duplicate warning", duplicates.length === 0, duplicates);
        await checkStatuses(h);
        return { view: { ledgers: view.ledgers, strongboxes: view.strongboxes } };
    },

    /** An OBSERVER player only reads; the GM's ownership repair happens, with its notice, once per session. */
    async "observer-strongbox"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        const OWNER = 3;
        const OBSERVER = 2;
        const LIMITED = 1;
        const setOwnership = (change) => h.evaluate("gm", ({ mod, change: c }) => game.actors.find((a) => a.flags?.[mod]?.role === "strongbox").update(c).then(() => true),
            { mod: MOD, change }, "strongbox ownership");
        const boxOwnership = async () => (await serverView(h, "gm", w)).strongboxes[0].ownership;
        const repairNotices = (pages) => (pages.gm?.notes ?? []).filter((n) => n.message === "pf2e-artisans-workshop.Sync.OwnershipRepaired").length;

        await setOwnership({ [`ownership.${w.users.p2}`]: OBSERVER });
        await sleep(1500);
        const p2Status = await h.evaluate("p2", pageStatus, MOD, "status");
        h.check("an OBSERVER player is read-only (status missing)", p2Status === "missing", p2Status);
        const refused = await h.step("p2", "3c", "pledge", { order: "observer-order", cp: 10 });
        h.check("its pledge is refused before anything is sent", refused.outcome === "not-ready", refused);
        const reads = await h.step("p2", "9", "status");
        h.check("it still reads the ledger", typeof reads.rows === "number" && reads.status === "missing", reads);
        h.check("the other player is unaffected", (await h.evaluate("p1", pageStatus, MOD, "status")) === "ready");

        // Session 1 is the GM page that created the documents (its repair is done). Lower the default in it: no
        // repair. Sessions 2 and 3 start by repairing it once; lowered again within the session, it stays lowered.
        await takeNotes(h);
        await setOwnership({ "ownership.default": LIMITED });
        await sleep(2500);
        const first = { default: (await boxOwnership()).default, notices: repairNotices(await takeNotes(h)) };
        h.check("session 1: lowered within the session, the default stays LIMITED and no notice", first.default === LIMITED && first.notices === 0, first);
        const sessions = [];
        for (const session of [2, 3]) {
            await h.close("gm");
            await h.open("gm");
            await sleep(2000);
            const atStart = await boxOwnership();
            await setOwnership({ "ownership.default": LIMITED });
            await sleep(2500);
            const later = await boxOwnership();
            const s = { session, atStart, later, notices: repairNotices(await takeNotes(h)) };
            sessions.push(s);
            h.check(`session ${session}: repaired to OWNER at its start`, atStart.default === OWNER, s);
            h.check(`session ${session}: one repair notice, and lowered again it stays LIMITED`, s.notices === 1 && later.default === LIMITED, s);
            h.check(`session ${session}: the player's own OBSERVER entry is left alone`, atStart[w.users.p2] === OBSERVER, s);
        }
        // The next plan's reset deletes this strongbox, OBSERVER entry and all.
        await setOwnership({ "ownership.default": OWNER });
        return { p2Status, refused, first, sessions };
    },

    /**
     * The client holding the migration lock disconnects: the lock is broken once it is stale, and the migration runs.
     * The lock is stamped by `stampNow` on a client whose clock runs three hours fast, so it is judged by its stamp on
     * the server's clock, not by that client's.
     */
    async "migration-lock"(h, w) {
        const runs = [];
        for (const backdateMs of [6 * 60 * 1000, 0]) {
            await resetWorld(h, w);
            await h.only(["gm", "p1", "p2"]);
            await h.settle("ready");
            const taken = await h.evaluate("p1", pageTakeMigrationLock, { mod: MOD, agoMs: backdateMs, skewMs: SKEW_MS }, "take the migration lock");
            checkLockStamp(h, taken, `lock backdated ${backdateMs / 60000} min`);
            await sleep(2000);
            const waiting = { gm: await h.evaluate("gm", pageStatus, MOD, "status"), p2: await h.evaluate("p2", pageStatus, MOD, "status") };
            h.check(`lock held (backdated ${backdateMs / 60000} min): the others wait`, waiting.gm === "migrating" && waiting.p2 === "migrating", waiting);
            const closedAt = Date.now();
            await h.close("p1");
            const limit = backdateMs ? 30 * 1000 : 8 * 60 * 1000;
            let statuses = waiting;
            while (Date.now() - closedAt < limit && !(statuses.gm === "ready" && statuses.p2 === "ready")) {
                await sleep(2000);
                statuses = { gm: await h.evaluate("gm", pageStatus, MOD, "status"), p2: await h.evaluate("p2", pageStatus, MOD, "status") };
            }
            const view = await serverView(h, "gm", w);
            const lockPage = view.pages.find((p) => p.id === taken.page);
            const run = { backdateMs, readyAfterMs: Date.now() - closedAt, statuses, schema: view.ledgers[0]?.schema, boxSchema: view.strongboxes[0]?.schema,
                marker: view.ledgers[0]?.migration, lockBy: lockPage?.lock?.by ?? null };
            h.check(`lock backdated ${backdateMs / 60000} min: after its holder left, both clients reached ready`, statuses.gm === "ready" && statuses.p2 === "ready", run);
            h.check(`lock backdated ${backdateMs / 60000} min: migrated (schema 1, marker gone, lock re-taken by the GM)`, run.schema === 1 && run.boxSchema === 1 && !run.marker && run.lockBy === w.users.gm, run);
            runs.push(run);
        }
        return { runs };
    },

    /**
     * A stamp written before the world was last launched. `game.time.serverTime` counts from the moment the server
     * launched the world (Foundry 14.368 `dist/components/activity.mjs`), so a stamp from a launch that ran longer
     * than this one has so far lies ahead of it; the stamp's launch puts it back in its place. Simulated with the
     * migration lock of a client that died 6 minutes ago in a launch that had run 10 hours more, stamped by `stampNow`
     * on that client with its clock three hours fast: the lock should be broken at once, as the 6-minute-old lock of
     * `migration-lock` is.
     */
    async "relaunch-stamp"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        const taken = await h.evaluate("p1", pageTakeMigrationLock, { mod: MOD, agoMs: 6 * 60 * 1000, ranLongerMs: 10 * 3600 * 1000, skewMs: SKEW_MS }, "take the migration lock");
        checkLockStamp(h, taken, "lock from a longer launch");
        await sleep(2000);
        await h.close("p1");
        const closedAt = Date.now();
        let statuses = {};
        while (Date.now() - closedAt < 30 * 1000) {
            await sleep(2000);
            statuses = { gm: await h.evaluate("gm", pageStatus, MOD, "status"), p2: await h.evaluate("p2", pageStatus, MOD, "status") };
            if (statuses.gm === "ready" && statuses.p2 === "ready") break;
        }
        const serverTime = await h.evaluate("gm", () => game.time.serverTime, null, "server time");
        h.check("a 6-minute-old lock whose holder left is broken although its server stamp is from a longer launch",
            statuses.gm === "ready" && statuses.p2 === "ready", { lock: taken.lock, serverTime, statuses, waitedMs: Date.now() - closedAt });
        return { lock: taken.lock, serverTime, statuses };
    },

    /**
     * The cleric fixture (DESIGN.md 15.4, build 13) rebuilt alone: no pf2e choice prompt opens, its Domain Initiate
     * (granted two grants deep) chose "family", and the compendium copy it was answered on is put back.
     */
    async "cleric-fixture"(h) {
        await h.only(["gm"]);
        const result = await h.evaluate("gm", pageRebuildFixtures, { mod: MOD, only: ["cleric-5"], domainInitiate: FEAT.domainInitiate }, "rebuild cleric-5");
        const [cleric] = result.report ?? [];
        h.check("cleric-5 rebuilt (the old actor replaced)", cleric?.status === "rebuilt" && result.actorsWithThatName === 1, result);
        h.check("no PickAThingPrompt rendered while it was built", Array.isArray(result.prompts) && result.prompts.length === 0, result.prompts);
        h.check("its Domain Initiate chose the fixture's domain (family)", cleric?.domainInitiate?.length === 1 && cleric.domainInitiate[0].selection === "family", cleric);
        h.check("the compendium copy of Domain Initiate is put back (no selection)", result.copySelection === null, result.copySelection);
        return result;
    },

    /** A server that answers late, not never: a move whose answers come 35 s late waits for them and completes. */
    async "slow-answer"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1"]);
        await h.settle("ready");
        const probe = await h.evaluate("p1", pageSlowAnswer, { mod: MOD, delayMs: 35 * 1000 }, "deposit with late answers");
        h.check("a deposit whose two answers each come 35 s late completes, and the client stays ready",
            probe.outcome === "ok" && probe.status === "ready" && probe.answers.length >= 2 && probe.ms >= 70 * 1000, probe);
        const view = await serverView(h, "gm", w);
        h.check("server: one applied deposit row", view.rows.filter((r) => r.kind === "deposit" && r.state === "applied").length === 1, view.rows);
        checkReconciles(h, view);
        return probe;
    },

    /**
     * A coin move whose lock request landed and whose apply request never did: the answer to Player One's deposit's
     * lock request is lost with the connection (`pageStrandDeposit`), which leaves its row pending, its lock held and
     * no coins moved, until the module resumes the move (DESIGN.md 5.4, As built: Resume) once the row is past the
     * grace time. Round 1, the author comes back: Player One reloads and opens a second device at the same moment,
     * and both resume when the move is due, racing at its apply mark. Round 2, the author leaves: the GM's client,
     * responsible for the purse with no owner connected, resumes it. Either way the coins move exactly once, and
     * sweeping again on every client moves nothing more. No client shows a module warning once the move is stranded
     * (Player One's stranded client is told it went stale, before): the device that loses the race at the mark sees
     * the move pending for a moment, and must not tell its user it did not finish. Each round waits out the 60 s grace
     * time.
     */
    async resume(h, w) {
        const rounds = [];
        for (const round of ["author returns", "author leaves"]) {
            await resetWorld(h, w);
            await h.only(["gm", "p1"]);
            await h.settle("ready");
            const before = await serverView(h, "gm", w);
            const strand = await h.evaluate("p1", pageStrandDeposit, { mod: MOD, cp: 10 }, "strand a deposit");
            h.check(`${round}: the lock request's answer is lost with the connection: unknown, and Player One's client is stale`,
                strand.outcome === "unknown" && strand.reason === "disconnected" && strand.status === "stale" && strand.dropped === 1 && strand.connected === true, strand);
            const markId = strand.row ? applyMarkId(strand.row) : null;
            const coins = (view) => ({ purse: view.actors[w.pcs.p1.id].coinsCp, box: view.actualCp });
            const stranded = await serverView(h, "gm", w);
            const row = stranded.rows.find((r) => r.id === strand.row);
            h.check(`${round}: stranded on the server: the row pending, its lock page holding the move, no apply mark, no coins moved`,
                row?.state === "pending" && !row.stopped && stranded.pages.some((p) => p.id === strand.row && p.move) && !stranded.pages.some((p) => p.id === markId)
                && JSON.stringify(coins(stranded)) === JSON.stringify(coins(before)), { row, before: coins(before), stranded: coins(stranded) });
            const strandNotes = await takeNotes(h);
            if (round === "author returns") {
                await h.close("p1");
                await Promise.all([h.open("p1"), h.open("p1@2")]);
            } else {
                await h.close("p1");
            }
            const strandedAt = row ? row.at.launch + row.at.server : 0;
            const end = Date.now() + PENDING_GRACE_MS + 60 * 1000;
            let view = stranded;
            while (Date.now() < end && view.rows.find((r) => r.id === strand.row)?.state !== "applied") {
                await sleep(2000);
                view = await serverView(h, "gm", w);
            }
            const settled = view.rows.find((r) => r.id === strand.row);
            const marks = view.pages.filter((p) => p.id === markId);
            const resumer = round === "author returns" ? w.users.p1 : w.users.gm;
            const appliedAfterMs = marks[0]?.lock?.at ? marks[0].lock.at.launch + marks[0].lock.at.server - strandedAt : null;
            h.check(`${round}: resumed once, past the grace time, by ${round === "author returns" ? "Player One" : "the GM"}`,
                settled?.state === "applied" && marks.length === 1 && marks[0].lock?.by === resumer && appliedAfterMs >= PENDING_GRACE_MS,
                { settled, marks, appliedAfterMs });
            h.check(`${round}: the coins moved exactly once (Player One's purse 10 cp down, the strongbox 10 cp up)`,
                coins(view).purse === coins(before).purse - 10 && coins(view).box === coins(before).box + 10, { before: coins(before), after: coins(view) });
            checkReconciles(h, view, `${round}: server: the strongbox reconciles and nothing is pending`);
            for (const name of h.clients.keys()) await h.evaluate(name, pageSweep, { mod: MOD }, "sweep");
            await sleep(3000);
            const later = await serverView(h, "gm", w);
            h.check(`${round}: sweeping again on every client moves nothing more`,
                JSON.stringify(coins(later)) === JSON.stringify(coins(view)) && later.pages.filter((p) => p.id === markId).length === 1 && later.rows.length === view.rows.length,
                { view: coins(view), later: coins(later) });
            await checkStatuses(h, "ready", `${round}: every client is ready`);
            const notes = await takeNotes(h);
            const warnings = Object.entries(notes).flatMap(([client, page]) => page.notes
                .filter((n) => n.type !== "info" && n.message.startsWith(`${MOD}.`)).map((n) => ({ client, ...n })));
            h.check(`${round}: no module warning on any client once the move was stranded`, warnings.length === 0, warnings);
            rounds.push({ round, strand, appliedAfterMs, resumedBy: marks[0]?.lock?.by ?? null, strandNotes, notes });
        }
        return { rounds };
    },

    /**
     * Relay "deliver now" racing the GM's own sweep (500 ms after the shelf item appears, the GM being first in id
     * order), asked at several delays around it, with the GM in two tabs: each shelf item delivered once.
     */
    async "relay-race"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "gm#2", "p2"]);
        await h.settle("ready");
        const rounds = [];
        for (const delayMs of [0, 300, 450, 500, 550, 650, 800]) {
            const r = await h.evaluate("p2", pageShelveThenRelay, { mod: MOD, uuid: ELIXIR, recipient: w.pcs.p1.uuid, delayMs }, "shelve then relay");
            await sleep(2500);
            const view = await serverView(h, "gm", w);
            const rowId = hashId(r.key);
            rounds.push({ delayMs, relay: r.answer?.results?.map((x) => x.outcome ?? x.reason) ?? r.answer, delivered: view.actors[w.pcs.p1.id].delivered.filter((d) => d.row === rowId).length,
                rows: view.rows.filter((row) => row.id === rowId).map((row) => row.state), shelfLeft: view.strongboxes[0].shelf });
        }
        h.check("every shelf item delivered exactly once, one applied row each", rounds.every((r) => r.delivered === 1 && r.rows.length === 1 && r.rows[0] === "applied" && r.shelfLeft === 0), rounds);
        const pages = await takeNotes(h);
        const errors = Object.fromEntries(Object.entries(pages).map(([c, p]) => [c, p.notes.filter((n) => n.type === "error")]));
        h.check("no error shown on either client", Object.values(errors).every((e) => e.length === 0), errors);
        await checkStatuses(h);
        return { rounds };
    },
};
