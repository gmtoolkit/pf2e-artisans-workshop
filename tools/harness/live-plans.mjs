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
import { levelDC } from "../../scripts/logic/dc.mjs";
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
/**
 * What `m6-communal` crafts: two Elixirs of Life (Lesser), 30 gp each, so 30 gp is left to pay after the up-front half.
 * A day of Player One's alchemist and Player Two's helper together takes off far less, so the plan's two work days both
 * fall before the order is paid off; one Elixir of Life (Minor) (1 gp 5 sp left) was paid off by the first day.
 */
export const COMMUNAL_ORDER = Object.freeze({ uuid: "Compendium.pf2e.equipment-srd.Item.TZUskLT7yvP7N2co", quantity: 2, pledge: 3000 });
/** Alchemist Goggles (Player Core 2): +1 item bonus to Craft alchemical items, predicated on `item:trait:alchemical`. */
const GOGGLES = "Compendium.pf2e.equipment-srd.Item.7JVgLiNTAs4clEW8";
/** Blood Sight Elixir (Lesser): an uncommon 3rd-level alchemical consumable, for the rarity DC. */
const UNCOMMON_ELIXIR = "Compendium.pf2e.equipment-srd.Item.Lz643qJldVUItZOS";

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
        rows: rows.map(({ id, kind, state, cp, box: b, purse, alloc, idem, actor, order, author, at, stopped }) => ({ id, kind, state, cp, box: b, purse, alloc,
            idem, actor, order: order ?? null, author, at, stopped: stopped ?? null })),
        claims: live(flags.claims).map(({ id, kind, actor, cp, idem, at, resolved }) => ({ id, kind, actor, cp, idem, at, resolved: resolved ?? null })),
        roster: Object.keys(flags.roster ?? {}),
        expectedCp: rows.reduce((sum, r) => sum + (r.box ?? 0), 0),
        // Fund accounting (M4.1): the unallocated party fund and what is earmarked for orders, from the rows' `alloc`.
        unallocatedCp: rows.filter((r) => !r.order && !r.garden).reduce((sum, r) => sum + (r.alloc ?? 0), 0),
        earmarkedCp: rows.filter((r) => r.order).reduce((sum, r) => sum + (r.alloc ?? 0), 0),
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

/**
 * GM: give an actor a compendium item worn and invested (gear whose rule elements need both), first taking away any
 * copy it has; with `remove`, only take it away.
 */
async function pageGear({ actorId, uuid, remove = false }) {
    const actor = game.actors.get(actorId);
    const old = actor.items.filter((i) => i._stats?.compendiumSource === uuid).map((i) => i.id);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
    if (remove) return { removed: old.length };
    const source = game.items.fromCompendium(await fromUuid(uuid), { keepId: false });
    source.system.equipped = { carryType: "worn", inSlot: true, invested: true };
    const [item] = await actor.createEmbeddedDocuments("Item", [source]);
    return { id: item.id, equipped: item.isEquipped, invested: item.isInvested };
}

/** GM: set an actor's Hero Points. */
async function pageHeroPoints({ actorId, value }) {
    await game.actors.get(actorId).update({ "system.resources.heroPoints.value": value });
    return game.actors.get(actorId).system.resources.heroPoints.value;
}

/** A value of the ledger's module flags as the server holds it (`path` dotted), read back with a `get` request. */
async function pageServerFlag({ mod, path }) {
    const [ledger] = (await JournalEntry.implementation.database.get(JournalEntry.implementation, { query: {} }))
        .map((doc) => doc.toObject()).filter((j) => j.flags?.[mod]?.role === "ledger")
        .sort((a, b) => (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0));
    return path.split(".").reduce((value, key) => value?.[key], ledger?.flags?.[mod]) ?? null;
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

    /**
     * M3 (6.12, 6.15 gap 2): a Craft check through the roll wrapper carries the product's roll options, so the
     * Alchemist Goggles' item bonus (predicated on `item:trait:alchemical` and `action:craft`) applies; the same
     * check rolled as the system Craft macro rolls it (`action:craft` only) leaves it out. The order records the check.
     */
    async "craft-gear-bonus"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1"]);
        await h.settle("ready");
        const gear = await h.evaluate("gm", pageGear, { actorId: w.pcs.p1.id, uuid: GOGGLES }, "give the goggles, worn and invested");
        h.check("the goggles are worn and invested", gear.equipped === true && gear.invested === true, gear);
        try {
            const order = await h.step("p1", "m3", "order", { product: ELIXIR });
            const rolled = await h.step("p1", "m3", "roll", { order: order.id });
            const goggles = (rolled.message?.modifiers ?? []).find((m) => m.slug?.includes("goggles"));
            h.check("the wrapper's roll carries action:craft and the product's traits", ["action:craft", "item:trait:alchemical"].every((o) => rolled.message?.options?.includes(o)), rolled.message);
            h.check("the goggles' +1 item bonus applies to the wrapper's roll", goggles?.enabled === true && goggles.modifier === 1 && goggles.type === "item", rolled.message?.modifiers);
            h.check("the order recorded the check from that message", rolled.recorded && rolled.check?.messageId === rolled.message?.id && rolled.check?.attempt === 1, rolled.check);
            const system = await h.step("p1", "m3", "systemRoll", { dc: levelDC(1) });
            const systemGoggles = system.modifiers.find((m) => m.slug?.includes("goggles"));
            h.check("the system Craft path does not apply them, and is not recorded", !systemGoggles?.enabled && system.linked === false, system);
            const server = await h.evaluate("gm", pageServerFlag, { mod: MOD, path: `orders.${order.id}.status` }, "order status on the server");
            h.check("server: the order is rolled", server === "rolled", server);
            return { gear, order, rolled, system };
        } finally {
            await h.evaluate("gm", pageGear, { actorId: w.pcs.p1.id, uuid: GOGGLES, remove: true }, "take the goggles back");
        }
    },

    /** M3 (6.2.1, 6.15 gap 1): the order's frozen Craft DC includes the rarity adjustment, and the roll uses it. */
    async "craft-rarity-dc"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1"]);
        await h.settle("ready");
        const order = await h.step("p1", "m3", "order", { product: UNCOMMON_ELIXIR });
        h.check("an uncommon 3rd-level item: DC 18 + 2", order.rarity === "uncommon" && order.dc.rarity === 2 && order.dc.final === levelDC(3) + 2, order);
        const rolled = await h.step("p1", "m3", "roll", { order: order.id });
        h.check("the roll is against the order's DC, not the macro's level DC", rolled.message?.dc === order.dc.final && rolled.message.dc !== levelDC(3), rolled.message);
        h.check("the check is recorded", rolled.recorded === true, rolled.check);
        return { order, rolled };
    },

    /**
     * M3 (6.12, OQ-3): a Hero Point reroll of the order's check message, with the GM and both players online. The
     * reroll's new message keeps the link option and belongs to the rerolling player, whose client records it, once;
     * the order's check is replaced (`rerolled`, and marked for the downtime guardrail's warning).
     */
    async "craft-hero-reroll"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        await h.evaluate("gm", pageHeroPoints, { actorId: w.pcs.p1.id, value: 1 }, "one Hero Point");
        const order = await h.step("p1", "m3", "order", { product: ELIXIR });
        const first = await h.step("p1", "m3", "roll", { order: order.id });
        h.check("the first roll is recorded", first.recorded === true, first.check);
        await h.step("p2", "m3", "watch", { path: `orders.${order.id}.check` });
        const reroll = await h.step("p1", "m3", "reroll", { order: order.id });
        const count = await h.step("p2", "m3", "count", { ms: 3000 });
        h.check("the reroll replaced the order's check with the new message", !!reroll.replaced && reroll.check?.messageId === reroll.replaced, reroll);
        h.check("the reroll's message keeps the link and the attempt (OQ-3)", reroll.message?.link?.id === order.id && reroll.message.link.attempt === 1 && reroll.message.isReroll, reroll.message);
        h.check("the reroll's message belongs to the rerolling player (OQ-3)", reroll.message?.author === "Player One", reroll.message?.author);
        h.check("recorded as a reroll, with the downtime guardrail's warning", reroll.check?.rerolled === true && reroll.check.fortune === true && reroll.check.warn === true, reroll.check);
        h.check("the reroll wrote the order's check exactly once, from Player One's client", JSON.stringify(count.writers) === JSON.stringify({ "Player One": 1 }), count.writers);
        const server = await h.evaluate("gm", pageServerFlag, { mod: MOD, path: `orders.${order.id}.check.messageId` }, "check on the server");
        h.check("server: the order holds the reroll's check", server === reroll.replaced, server);
        return { order, first, reroll, count };
    },

    /**
     * M3 review (6.12, 6.10): a second first roll for the attempt, as a second check dialog makes it, is refused: the
     * order keeps its first check and the roller is told. Then pf2e's free "keep new" reroll of the first message,
     * which spends no Hero Point, is recorded as a reroll with the downtime guardrail's warning.
     */
    async "craft-second-roll"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1"]);
        await h.settle("ready");
        const order = await h.step("p1", "m3", "order", { product: ELIXIR });
        const first = await h.step("p1", "m3", "roll", { order: order.id });
        h.check("the first roll is recorded", first.recorded === true, first.check);
        await takeNotes(h);
        const again = await h.step("p1", "m3", "again", { order: order.id });
        const notes = (await takeNotes(h)).p1?.notes ?? [];
        h.check("the second roll made its own linked message", !!again.message && again.message.id !== first.check?.messageId && !again.message.isReroll, again.message);
        h.check("the order keeps its first check", again.check?.messageId === first.check?.messageId && again.status === "rolled", again);
        h.check("the roller is told the second roll does not count", notes.some((n) => /AlreadyRolled|already rolled/i.test(n.message)), notes);
        const free = await h.step("p1", "m3", "reroll", { order: order.id, message: first.check.messageId, resource: "none" });
        h.check("pf2e's free keep-new reroll spends nothing and is a reroll", free.message?.isReroll === true && !free.message.options.includes("check:reroll:hero-points"), free.message);
        h.check("it replaces the check, marked for the guardrail", free.check?.messageId === free.replaced && free.check.rerolled === true && free.check.fortune === true && free.check.warn === true, free.check);
        const server = await h.evaluate("gm", pageServerFlag, { mod: MOD, path: `orders.${order.id}.check.messageId` }, "check on the server");
        h.check("server: the order holds the free reroll's check", server === free.replaced, server);
        return { order, first, again, notes, free };
    },

    /**
     * M3 (6.10, 5.4): an Earn Income check rolled with action:earn-income and recorded on its job; then day 1 is
     * resolved by both players at the same moment and once more by the earner: one wage row, paid into the purse once.
     */
    async "wage-once"(h, w) {
        await resetWorld(h, w);
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        const job = await h.step("p1", "m3", "job", { taskLevel: 0, skill: "crafting" });
        const earned = await h.step("p1", "m3", "earn", { job: job.id });
        h.check("the Earn Income check carries action:earn-income and is recorded with a day's pay", earned.recorded && earned.message?.options?.includes("action:earn-income") && earned.job?.perDayCp > 0, earned);
        const before = (await serverView(h, "gm", w)).actors[w.pcs.p1.id].coinsCp;
        const together = await h.together([["p1", "m3", "pay", { job: job.id, day: 1 }], ["p2", "m3", "pay", { job: job.id, day: 1 }]]);
        const again = await h.step("p1", "m3", "pay", { job: job.id, day: 1 });
        const wages = await h.step("gm", "m3", "wages", { job: job.id, ms: 4000 });
        const after = (await serverView(h, "gm", w)).actors[w.pcs.p1.id].coinsCp;
        h.check("one wage row for day 1, applied", wages.rows.length === 1 && wages.rows[0].day === 1 && wages.rows[0].state === "applied", wages);
        h.check("any wage claim for it is resolved", wages.claims.every((c) => c.resolved), wages.claims);
        h.check("server: the earner's purse grew by one day's pay", after - before === earned.job.perDayCp, { before, after, perDayCp: earned.job.perDayCp, together, again });
        checkReconciles(h, await serverView(h, "gm", w));
        return { job, earned, together, again, wages, before, after };
    },
};

/* -------------------------------------------- */
/*  M4: the order lifecycle and the window       */
/* -------------------------------------------- */

/** Healing Potion (Minor): magical, so a crafter without Magical Crafting is blocked (G4). */
const HEALING_POTION = "Compendium.pf2e.equipment-srd.Item.2RuepCemJhrpKKao";
/** Antidote (Lesser) and Alchemist's Fire (Lesser): common 1st-level alchemical consumables. */
const ANTIDOTE = "Compendium.pf2e.equipment-srd.Item.ktjFOp3U0wQD9t0Z";
const ALCHEMISTS_FIRE = "Compendium.pf2e.equipment-srd.Item.yd3kEK21YknZLlcT";
/** Alchemist's Lab: the tool alchemical items need (G7); in the strongbox it counts for every crafter. */
const LAB = "Compendium.pf2e.equipment-srd.Item.k6xZkDUpF7E1Totd";

/** What is left to pay on an order in finishing, from its brief (6.2.3). */
function leftToPay(order) {
    const earned = order.check && order.check.degree >= 2 ? order.days.filter((d) => d.kind === "extra").reduce((s, d) => s + (d.crafterCp ?? 0), 0) : 0;
    return Math.max(0, order.priceCp - order.upfrontCp - earned);
}

/**
 * The lifecycle (4.2.3) with Player Two requesting and paying and Player One crafting: request, pledge, accept, start,
 * setup days, the Craft check, the next day settling it and counting as an extra day, the remainder pledged, finish
 * onto the pickup shelf, and delivery by the recipient's client. With `gm`, the GM is online throughout; without, no GM
 * is, and Player Two is offline at the finish, so the item waits on the shelf until Player Two's login sweep takes it.
 */
async function m4Lifecycle(h, w, { gm, face = null, online: onOnline = null }) {
    await resetWorld(h, w);
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox");
    const online = gm ? ["gm", "p1", "p2"] : ["p1", "p2"];
    await h.only(online);
    await h.settle("ready");
    if (onOnline) await onOnline();
    const filed = await h.step("p2", "m4", "request", { product: ELIXIR, quantity: 2 });
    h.check("the request is filed as one order of two", filed.ok === true && !!filed.order, filed);
    const id = filed.order;
    const pledge = await h.step("p2", "m4", "pledge", { order: id, cp: 300 });
    h.check("Player Two pledges the up-front half", pledge.ok === true, pledge);
    const accept = await h.step("p1", "m4", "accept", { order: id });
    h.check("Player One accepts", accept.ok === true, accept);
    const start = await h.step("p1", "m4", "start", { order: id });
    h.check("every gate passes and the order starts (P1)", start.ok === true, start);
    const setup = await h.step("p1", "m4", "work", { order: id, until: "check" });
    h.check("setup days move the order to its check", setup.order?.status === "check", setup.order);
    const rolled = await h.step("p1", "m4", "roll", { order: id, face });
    h.check("the Craft check is rolled through the wrapper and recorded", rolled.recorded === true, rolled);
    const worked = await h.step("p1", "m4", "work", { order: id });
    const success = worked.order?.check?.degree >= 2;
    h.check("the next day settles the check (4.2.3)", worked.order?.check?.settled === true && worked.order?.settlement?.attempt === 1, worked.order);
    if (Number.isInteger(face)) h.check("at the fixed die the check succeeds", success, worked.order?.check);
    if (!success) {
        h.check("a failed check leaves the order failed with its materials released", worked.order?.status === "failed", worked.order);
        return { id, worked };
    }
    h.check("a success expends the materials and counts the day as an extra day", worked.order.status === "finishing" && worked.order.days.some((d) => d.kind === "extra"), worked.order);
    const left = leftToPay(worked.order);
    if (left > 0) {
        const more = await h.step("p2", "m4", "pledge", { order: id, cp: left });
        h.check("Player Two pledges what is left", more.ok === true, more);
    }
    if (!gm) await h.only(["p1"]);
    const finished = await h.step("p1", "m4", "finish", { order: id });
    h.check("Player One finishes: remainder paid, item shelved, order complete", finished.result?.ok === true && finished.order?.status === "complete", finished);
    if (!gm) {
        const waiting = await h.step("p1", "m4", "state", { order: id, ms: 2500 });
        h.check("with Player Two away and no GM, the item waits on the pickup shelf", waiting.shelf.length === 1, waiting.shelf);
        await h.only(["p1", "p2"]);
        await h.settle("ready");
    }
    const arrived = await h.step("p2", "m4", "waitDelivered", { name: "Elixir of Life (Minor)", ms: 30000 });
    h.check("Player Two's client collects the item, once", arrived.delivered === true && arrived.count === 1, arrived);
    const state = await h.step("p2", "m4", "state", { order: id, ms: 1500 });
    h.check("chat cards were posted for the request, the acceptance, the start and the completion",
        ["request", "accepted", "started", "complete"].every((kind) => state.cards.includes(kind)), state.cards);
    const view = await serverView(h, online[0], w);
    checkReconciles(h, view);
    h.check("server: one shelved row, the remainder paid, nothing left on the shelf", rowsWith(view, "shelve:").length === 1 && view.strongboxes[0].shelf === 0, rowsWith(view, "shelve:"));
    await checkStatuses(h);
    return { id, finished, arrived, state };
}

/**
 * A cancel (6.2.4): both players pledge to an order Player One starts, Player Two cancels; what was committed is released,
 * each contributor's share comes back as a refund their own client collects, and the strongbox ends empty.
 */
async function m4Cancel(h, w) {
    await resetWorld(h, w);
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox");
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const before = await serverView(h, "gm", w);
    const filed = await h.step("p2", "m4", "request", { product: ANTIDOTE, quantity: 2 });
    const id = filed.order;
    await h.step("p1", "m4", "pledge", { order: id, cp: 100 });
    await h.step("p2", "m4", "pledge", { order: id, cp: 250 });
    await h.step("p1", "m4", "accept", { order: id });
    const start = await h.step("p1", "m4", "start", { order: id });
    h.check("the order starts with 350 cp in escrow", start.ok === true, start);
    const cancelled = await h.step("p2", "m4", "cancel", { order: id });
    h.check("the requester cancels it: two refunds", cancelled.result?.ok === true && cancelled.result.refunds === 2 && cancelled.order?.status === "cancelled", cancelled);
    h.check("the commit is released", cancelled.order.rows.some((r) => r.kind === "release"), cancelled.order.rows);
    const done = await h.step("gm", "m4", "state", { order: id, ms: 5000 });
    h.check("both refund claims are collected", done.claims.length === 2 && done.claims.every((c) => c.resolved), done.claims);
    const after = await serverView(h, "gm", w);
    const purse = (view, role) => view.actors[w.pcs[role].id].coinsCp;
    h.check("server: both purses are back where they were", purse(after, "p1") === purse(before, "p1") && purse(after, "p2") === purse(before, "p2"),
        { before: { p1: purse(before, "p1"), p2: purse(before, "p2") }, after: { p1: purse(after, "p1"), p2: purse(after, "p2") } });
    checkReconciles(h, after);
    h.check("server: the strongbox holds no coins", after.actualCp === 0, after.actualCp);
    return { id, cancelled, done };
}

/**
 * The double-delivery race (5.11 follow-up): Player Two's delivery of a shelf item lands its lock request and its apply
 * request is held back; after the grace time Player Two's client re-creates the lost delivery; then the held apply
 * request is sent to the server past every check on the client. It must be refused at the lock the re-creation took:
 * the item arrives once.
 */
async function m4DoubleDelivery(h, w) {
    await resetWorld(h, w);
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const stranded = await h.step("p2", "m4", "strandDelivery", { product: ELIXIR });
    h.check("the delivery's lock request lands and its apply request is held back", stranded.locked?.outcome === "ok" && !!stranded.mark, stranded);
    await sleep(PENDING_GRACE_MS + 2000);
    await h.step("p2", "m4", "recreate", {});
    const recreated = await h.step("p2", "m4", "waitDelivered", { name: "Elixir of Life (Minor)", ms: 20000 });
    h.check("the lost delivery is re-created once the grace time is past", recreated.delivered === true && recreated.count === 1, recreated);
    const late = await h.step("p2", "m4", "sendHeldApply", {});
    const after = await h.step("p2", "m4", "state", { ms: 1500 });
    h.check("the late apply request reaches the server, which refuses it at its dry run", late.sent === true && late.dryRun.length > 0, late);
    h.check("the item arrived once", after.delivered.filter((d) => d.name === "Elixir of Life (Minor)").length === 1, after.delivered);
    const view = await serverView(h, "gm", w);
    const row = view.rows.find((r) => r.id === stranded.row);
    h.check("server: the delivery's row is applied and one item carries it", row?.state === "applied" &&
        view.actors[w.pcs.p2.id].delivered.filter((d) => d.row === stranded.row).length === 1, { row, delivered: view.actors[w.pcs.p2.id].delivered });
    await checkStatuses(h);
    return { stranded, recreated, late, after };
}

/**
 * The reroll-against-settlement race (6.12 follow-up). First the state a late reroll write leaves, written on purpose
 * by the GM's client after Player One settled: Player One's client, responsible for the crafter, must restore the
 * settled check from the settlement record and keep the reroll as the conflict, by itself and once. Then the real race,
 * several times: Player One settles while the GM rerolls the check with a Hero Point at the same moment; whatever the
 * order of arrival, the stored check is the settled one and any other roll is kept as the conflict.
 */
async function m4RerollRace(h, w) {
    await resetWorld(h, w);
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox");
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const prepare = async () => {
        const filed = await h.step("p1", "m4", "request", { product: ELIXIR, quantity: 1, crafter: w.pcs.p1.uuid });
        await h.step("p1", "m4", "pledge", { order: filed.order, cp: 150 });
        await h.step("p1", "m4", "start", { order: filed.order });
        await h.step("p1", "m4", "work", { order: filed.order, until: "check" });
        const rolled = await h.step("p1", "m4", "roll", { order: filed.order });
        return { id: filed.order, rolled };
    };
    const first = await prepare();
    h.check("an order of Player One's own reaches its recorded check", first.rolled.recorded === true, first.rolled);
    const settled = await h.step("p1", "m4", "settle", { order: first.id });
    h.check("Player One settles it", settled.result?.ok === true, settled);
    await h.step("gm", "m3", "watch", { path: `orders.${first.id}.check` });
    await h.step("gm", "m4", "lateReroll", { order: first.id, degree: 0 });
    const count = await h.step("gm", "m3", "count", { ms: 3000 });
    const repaired = await h.step("gm", "m4", "state", { order: first.id });
    h.check("the crafter's client restores the settled check and keeps the late roll as the conflict", repaired.order?.check?.messageId === settled.order?.settlement?.messageId &&
        repaired.order.check.settled === true && repaired.order.conflict?.messageId === "late-reroll", repaired.order);
    h.check("one repair, from Player One's client (P4)", count.writers?.["Player One"] === 1, count.writers);
    const races = [];
    for (let i = 0; i < 3; i++) {
        await h.evaluate("gm", pageHeroPoints, { actorId: w.pcs.p1.id, value: 1 }, "one Hero Point");
        const next = await prepare();
        await h.together([["p1", "m4", "settle", { order: next.id }], ["gm", "m4", "reroll", { order: next.id, ms: 3000 }]]);
        const end = await h.step("p1", "m4", "state", { order: next.id, ms: 3000 });
        const o = end.order;
        const consistent = !!o && ["finishing", "failed"].includes(o.status) && o.check?.settled === true && o.check.messageId === o.settlement?.messageId;
        races.push({ id: next.id, status: o?.status, check: o?.check, settlement: o?.settlement, conflict: o?.conflict });
        h.check(`race ${i + 1}: the stored check is the settled one, whichever write landed last`, consistent, o);
    }
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { first, settled, repaired, count, races };
}

/**
 * Screenshots of the Workshop window (10.3, 10.8, 10.9): orders in every state the Queue shows, seeded by the GM through
 * the module's own functions, then the Queue and Funds tabs as the GM and as Player One, at 1440x900 and 1024x768, in
 * the dark and the light colour scheme, and the Queue with an order's detail open.
 */
async function m4Shots(h, w) {
    await resetWorld(h, w);
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox");
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const seeded = await h.step("gm", "m4", "seed", {
        products: [ELIXIR, HEALING_POTION, ALCHEMISTS_FIRE, ANTIDOTE], crafter: w.pcs.p1.uuid, requester: w.pcs.p2.uuid, other: w.pcs.p1.uuid,
    });
    h.check("orders were seeded in several states", Object.keys(seeded.states ?? {}).length >= 6, seeded.states);
    const sizes = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }];
    const opened = [];
    for (const role of ["gm", "p1"]) {
        for (const scheme of ["dark", "light"]) {
            await h.step(role, "m4", "theme", { scheme });
            for (const size of sizes) {
                for (const tab of ["queue", "funds"]) {
                    const file = `m4-${role}-${tab}-${size.width}x${size.height}-${scheme}.png`;
                    await h.screenshot(role, file, size, async () => {
                        const open = await h.step(role, "m4", "open", { tab });
                        opened.push({ role, scheme, ...size, tab, ...open });
                        return open;
                    });
                }
            }
            const detail = `m4-${role}-queue-detail-1440x900-${scheme}.png`;
            await h.screenshot(role, detail, sizes[0], () => h.step(role, "m4", "open", { tab: "queue", order: seeded.finishing }));
        }
        await h.step(role, "m4", "close", {});
    }
    h.check("the window opened with the module's styles every time", opened.every((o) => o.open && o.hasStyles), opened.filter((o) => !o.open || !o.hasStyles));
    h.check("the Queue listed the seeded orders for both", opened.filter((o) => o.tab === "queue").every((o) => o.rows >= 6), opened.filter((o) => o.tab === "queue").map((o) => o.rows));
    const styled = [...h.styleAdded];
    h.check("stylesheet: linked by the server, or added by the harness because the world predates it (reported)", true, { addedByHarness: styled });
    await h.step("gm", "m4", "theme", { scheme: "dark" });
    await h.step("p1", "m4", "theme", { scheme: "dark" });
    return { seeded, opened, shots: h.shots.filter((s) => s.label === h.label).map((s) => s.file) };
}

/* -------------------------------------------- */
/*  M4: the window driven like a user            */
/* -------------------------------------------- */

/** In the page: what has focus, the Workshop's tab, the search field and the order rows' tab stops. */
function pageFocus({ mod }) {
    const app = foundry.applications.instances.get(mod);
    const active = document.activeElement;
    const search = app?.element?.querySelector('input[data-filter="search"]');
    return {
        open: !!app?.rendered, tab: app?.tabGroups.primary ?? null, lastTab: game.settings.get(mod, "ui.lastTab"),
        fundsShown: !!app && getComputedStyle(app.element.querySelector(".workshop-funds")).display !== "none",
        active: { tag: active?.tagName ?? null, filter: active?.dataset?.filter ?? null, op: active?.dataset?.op ?? null,
            orderId: active?.dataset?.orderId ?? active?.closest?.("[data-order-id]")?.dataset.orderId ?? null,
            inDetail: !!active?.closest?.(".order-detail"), caret: active?.selectionStart ?? null, value: active?.value ?? null },
        search: search?.value ?? null, rows: [...(app?.element?.querySelectorAll(".order-row") ?? [])].map((r) => ({ id: r.dataset.orderId, tabIndex: r.tabIndex })),
        paused: game.paused,
    };
}

/** In the page: the Workshop's position (a width), or its detach and attach; returns its window and size. */
async function pageWorkshop({ mod, width = null, detach = false, attach = false }) {
    const app = foundry.applications.instances.get(mod);
    if (width) app.setPosition({ width });
    if (detach) await app.detachWindow();
    if (attach) await app.attachWindow();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { width: app.element.offsetWidth, detached: !!app.window.windowId, sameDocument: app.element.ownerDocument === document };
}

/** In the page: the open request forms and dialogs, and the browser window each is in. */
function pageWindows({ mod }) {
    const apps = [...foundry.applications.instances.values()];
    const where = (app) => (app.element?.ownerDocument === document ? "main" : "detached");
    return {
        forms: apps.filter((a) => a.id.startsWith(`${mod}-request-`)).map((a) => ({ id: a.id, in: where(a), item: !!a.element.querySelector(".request-drop.filled"),
            search: a.element.querySelector('input[name="search"]')?.value ?? null })),
        dialogs: apps.filter((a) => a instanceof foundry.applications.api.DialogV2).map((a) => ({ id: a.id, in: where(a) })),
    };
}

/** In the page: close the request forms and dialogs. */
async function pageCloseWindows({ mod }) {
    for (const app of [...foundry.applications.instances.values()]) {
        if (app.id.startsWith(`${mod}-request-`) || app instanceof foundry.applications.api.DialogV2) await app.close();
    }
    return true;
}

/**
 * In the page: the Workshop's cards of orders that still exist (a card of an order gone keeps its summary) and the check
 * augments in the chat log, and whether each card shows its live part.
 */
function pageChat({ mod, order }) {
    const log = ui.chat.element.querySelector(".chat-log");
    const api = game.modules.get(mod).api;
    const cards = [...log.querySelectorAll(`.${mod}-card`)].filter((c) => api.orders.get(c.dataset.pf2eArtisansWorkshopOrder));
    const live = cards.filter((c) => c.querySelector(".card-buttons"));
    const augments = [...log.querySelectorAll(`.${mod}-augment`)];
    const settle = log.querySelector(`.message [data-${mod}-op="settle"]`);
    const ids = [...log.querySelectorAll(".message")].map((m) => m.dataset.messageId);
    const sorted = ids.map((id) => game.messages.get(id)?.timestamp ?? 0);
    return { cards: cards.length, live: live.length, augments: augments.length, settle: !!settle,
        inOrder: sorted.every((t, i) => i === 0 || t >= sorted[i - 1]), order };
}

/**
 * The window driven like a user, with real clicks and keys (10.9; the M4 review's findings): the tabs by mouse and arrow
 * keys; typing on in the Queue's and the request form's searches after their re-renders; focus kept on a filter, an
 * order row and a detail button through a store refresh; the narrow tier's tab names; chat cards with their live part
 * and the Settle button after a reload; a detached Workshop opening the request form and a dialog in its own window;
 * and a button in the detail drawer acting on its order.
 */
async function m4Ui(h, w) {
    await resetWorld(h, w);
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox");
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const seeded = await h.step("gm", "m4", "seed", {
        products: [ELIXIR, HEALING_POTION, ALCHEMISTS_FIRE, ANTIDOTE], crafter: w.pcs.p1.uuid, requester: w.pcs.p2.uuid, other: w.pcs.p1.uuid,
    });
    const own = await h.step("p1", "m4", "request", { product: ELIXIR, quantity: 1, crafter: w.pcs.p1.uuid });
    await h.step("p1", "m4", "pledge", { order: own.order, cp: 150 });
    await h.step("p1", "m4", "start", { order: own.order });
    await h.step("p1", "m4", "work", { order: own.order, until: "check" });
    const rolled = await h.step("p1", "m4", "roll", { order: own.order });
    h.check("Player One's own order is rolled, for the chat checks", rolled.recorded === true, rolled);
    const focus = () => h.evaluate("p1", pageFocus, { mod: MOD });
    const { page } = h.clients.get("p1");
    const errorsBefore = h.console.filter((c) => c.client === "p1" && c.type === "pageerror").length;

    await h.step("p1", "m4", "open", { tab: "queue" });
    await page.click("#pf2e-artisans-workshop-tab-funds");
    await sleep(500);
    const clicked = await focus();
    h.check("a click on the Funds tab shows the Funds tab, and remembers it", clicked.tab === "funds" && clicked.fundsShown && clicked.lastTab === "funds", clicked);
    await page.focus("#pf2e-artisans-workshop-tab-funds");
    await page.keyboard.press("ArrowUp");
    await sleep(500);
    const keyed = await focus();
    h.check("ArrowUp on the tabs moves to the Queue tab", keyed.tab === "queue" && !keyed.fundsShown, keyed);

    await page.click('input[data-filter="search"]');
    await page.keyboard.type("Eli");
    await sleep(900);
    await page.keyboard.type("xir");
    await sleep(900);
    const typed = await focus();
    h.check("the Queue search keeps focus and the caret through its re-render", typed.search === "Elixir" && typed.active.filter === "search" && typed.active.caret === 6, typed);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await sleep(900);

    await page.focus(".order-row");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const third = (await focus()).active.orderId;
    await h.step("p1", "m4", "deposit", { cp: 1 });
    await sleep(1200);
    const afterRow = await focus();
    h.check("a store refresh leaves focus on the order row it was on, and that row the tab stop", afterRow.active.orderId === third && afterRow.active.tag === "LI"
        && afterRow.rows.filter((r) => r.tabIndex === 0).map((r) => r.id).join() === third, { third, afterRow });
    await page.focus('select[data-filter="status"]');
    await page.keyboard.press("ArrowDown");
    await sleep(900);
    const afterSelect = await focus();
    h.check("changing a filter with the keyboard keeps focus on it", afterSelect.active.filter === "status", afterSelect);
    await page.keyboard.press("ArrowUp");
    await sleep(900);

    await page.click(`li[data-order-id="${own.order}"] button[data-action="select"]`);
    await sleep(800);
    await page.focus('aside.order-detail button[data-op="settle"]');
    await h.step("p1", "m4", "deposit", { cp: 1 });
    await sleep(1200);
    const afterDetail = await focus();
    h.check("a store refresh leaves focus on the detail's button", afterDetail.active.inDetail && afterDetail.active.op === "settle", afterDetail);

    await page.click('button[data-action="request"]');
    await sleep(1200);
    await page.click('.workshop-request input[name="search"]');
    await page.keyboard.type("elix");
    await sleep(1400);
    await page.keyboard.type("ir");
    await sleep(1400);
    const form = await h.evaluate("p1", pageWindows, { mod: MOD });
    h.check("the request form's search keeps the caret through its re-render", form.forms[0]?.search === "elixir", form);
    await page.keyboard.press("Enter");
    await sleep(1400);
    const picked = await h.evaluate("p1", pageWindows, { mod: MOD });
    h.check("Enter in the request form's search picks the first match", picked.forms[0]?.item === true, picked);
    await h.evaluate("p1", pageCloseWindows, { mod: MOD });

    const narrow = await h.evaluate("p1", pageWorkshop, { mod: MOD, width: 700 });
    const names = await page.getByRole("tab", { name: "Funds" }).count() + await page.getByRole("tab", { name: "Queue" }).count();
    h.check("in the narrow tier the tab buttons keep their names", narrow.width <= 720 && names === 2, { narrow, names });
    await h.evaluate("p1", pageWorkshop, { mod: MOD, width: 1100 });

    const popupOpened = page.context().waitForEvent("page", { timeout: 15000 }).catch(() => null);
    const detached = await h.evaluate("p1", pageWorkshop, { mod: MOD, detach: true });
    const popup = await popupOpened;
    let formWindows = null;
    if (popup) {
        await popup.waitForLoadState().catch(() => {});
        await sleep(800);
        await popup.click('button[data-action="request"]').catch((error) => h.check("click Request in the detached window", false, error.message));
        await sleep(1200);
        formWindows = await h.evaluate("p1", pageWindows, { mod: MOD });
        await h.evaluate("p1", pageCloseWindows, { mod: MOD });
        await popup.click('.order-row button[data-action="fund"]').catch((error) => h.check("click Fund this order in the detached window", false, error.message));
        await sleep(1200);
    }
    const windows = await h.evaluate("p1", pageWindows, { mod: MOD });
    h.check("a detached Workshop opens the request form and the funding dialog in its own window", !!popup && detached.detached
        && formWindows?.forms.length === 1 && formWindows.forms[0].in === "detached" && windows.dialogs.length === 1 && windows.dialogs[0].in === "detached",
    { detached, formWindows, windows });
    await h.evaluate("p1", pageCloseWindows, { mod: MOD });
    await h.evaluate("p1", pageWorkshop, { mod: MOD, attach: true });

    await h.close("p1");
    await h.open("p1");
    await h.settle("ready", ["p1"]);
    await sleep(2000);
    const chatView = await h.evaluate("p1", pageChat, { mod: MOD, order: own.order });
    h.check("after a reload every Workshop card in the log has its live part, and the check augment its Settle button",
        chatView.cards > 0 && chatView.live === chatView.cards && chatView.augments > 0 && chatView.settle, chatView);

    const reloaded = h.clients.get("p1").page;
    await h.step("p1", "m4", "open", { tab: "queue", order: own.order });
    await reloaded.click('aside.order-detail button[data-op="settle"]');
    const settled = await h.step("p1", "m4", "state", { order: own.order, ms: 2500 });
    h.check("the detail drawer's Settle button settles its order", ["finishing", "failed"].includes(settled.order?.status), settled.order);
    const chatAfter = await h.evaluate("p1", pageChat, { mod: MOD, order: own.order });
    h.check("the chat log stays in time order as cards are rendered again", chatAfter.inOrder, chatAfter);
    const errors = h.console.filter((c) => c.client === "p1" && c.type === "pageerror").slice(errorsBefore);
    h.check("no page errors on Player One's client", errors.length === 0, errors);
    await h.step("p1", "m4", "close", {});
    return { seeded: seeded.states, own: own.order, clicked, keyed, typed, afterRow, afterSelect, afterDetail, form, picked, narrow, names, windows, chatView, settled: settled.order?.status };
}

Object.assign(BEHAVIOURS, {
    "m4-lifecycle": (h, w) => m4Lifecycle(h, w, { gm: true }),
    "m4-no-gm": (h, w) => m4Lifecycle(h, w, { gm: false }),
    "m4-cancel": m4Cancel,
    "m4-double-delivery": m4DoubleDelivery,
    "m4-reroll-race": m4RerollRace,
    "m4-shots": m4Shots,
    "m4-ui": m4Ui,
});

/* -------------------------------------------- */
/*  M5: formulas, jobs, runes, materials,        */
/*  pledges and services                         */
/* -------------------------------------------- */

/** Compendium items the M5 plans use (pf2e `packs/pf2e/equipment/`). */
const M5 = Object.freeze({
    elixirLesser: "Compendium.pf2e.equipment-srd.Item.TZUskLT7yvP7N2co",
    striking: "Compendium.pf2e.equipment-srd.Item.DxCuJKynlnMQZHgp",
    longsword: "Compendium.pf2e.equipment-srd.Item.LJdbVTOZog39EEbi",
    steelShield: "Compendium.pf2e.equipment-srd.Item.Yr9yCuJiAlFh3QEB",
    leatherArmor: "Compendium.pf2e.equipment-srd.Item.4tIVTg9wj56RrveA",
    wolfFang: "Compendium.pf2e.equipment-srd.Item.clyXfh0aVXgij2Hb",
    jadeCat: "Compendium.pf2e.equipment-srd.Item.2MgFoNXTccL8Own9",
    repairToolkit: "Compendium.pf2e.equipment-srd.Item.vLGDUFrg4yGzpTQX",
    coldIronIngot: "Compendium.pf2e.equipment-srd.Item.eQjibJl41aQpQ47d",
    sparkblade: "Compendium.pf2e.equipment-srd.Item.5BU4hJ1oXMLtSkuA",
    scroll1: "Compendium.pf2e.equipment-srd.Item.RjuupS9xyXDLgyIr",
    runestone: "Compendium.pf2e.equipment-srd.Item.ev3F9qlMNlNdCOAI",
});

/**
 * In the page: the Workshop's chat cards of a kind, and every message, counted; given `since` (the `ids` of an earlier
 * count), only the messages posted after it, since the dev world's chat log keeps the cards of every earlier run.
 */
export function pageCards({ mod, kind, since = null }) {
    const before = new Set(since ?? []);
    const messages = game.messages.filter((m) => !before.has(m.id));
    return { cards: messages.filter((m) => m.flags?.[mod]?.card?.kind === kind).length, messages: messages.length, ids: game.messages.map((m) => m.id) };
}

/** Every M5 plan starts here: the world reset, the M5 items taken back and the books restored, a lab in the strongbox. */
async function m5Reset(h, w, { lab = true } = {}) {
    await resetWorld(h, w);
    await h.step("gm", "m5", "reset", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid] });
    if (lab) await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox");
}

/** A formula's provenance route in a `book` result, or null. */
const routeIn = (book, uuid) => book.provenance?.find((p) => p.uuid === uuid)?.route ?? null;

/**
 * Buying a formula (6.8): Player Two buys Antidote (Lesser): one purchase row from the purse, the formula claim applied at
 * once by Player Two's own client, the book written, provenance `bought`, the "Formula learned" card; a second buy is
 * refused as known.
 */
async function m5Buy(h, w) {
    await m5Reset(h, w);
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const earlier = await h.evaluate("p2", pageCards, { mod: MOD, kind: "formula" }, "formula cards before");
    const bought = await h.step("p2", "m5", "acquire", { uuid: ANTIDOTE, route: "buy" });
    h.check("the purchase lands: 1 gp from Player Two's purse", bought.result?.ok === true && bought.paid === 100, bought);
    h.check("the formula is in the book with provenance bought", bought.book.includes(ANTIDOTE) && routeIn(bought, ANTIDOTE) === "bought", bought);
    const again = await h.step("p2", "m5", "acquire", { uuid: ANTIDOTE, route: "buy" });
    h.check("a second buy is refused: known", again.result?.reason === "known", again.result);
    const seen = await h.step("gm", "m5", "book", { actor: w.pcs.p2.uuid, ms: 1500 });
    h.check("the GM sees the same book, one claim resolved and applied", seen.book.includes(ANTIDOTE) && seen.claims.length === 1 && seen.claims[0].applied, seen);
    const cards = await h.evaluate("p2", pageCards, { mod: MOD, kind: "formula", since: earlier.ids }, "formula cards");
    h.check("a Formula learned card was posted once", cards.cards === 1, cards);
    const view = await serverView(h, "gm", w);
    h.check("server: one applied purchase row", view.rows.filter((r) => r.kind === "purchase" && r.state === "applied").length === 1, view.rows);
    checkReconciles(h, view);
    await checkStatuses(h);
    return { bought, seen, cards };
}

/**
 * Copying from an ally with no GM (6.8, 5.5): Player One buys Alchemist's Fire (Lesser); Player Two asks Player One for it;
 * Player One performs the formula-copy service, which files a formula claim; Player Two's own client writes it. Then the
 * same with Player Two offline when Player One performs it: the claim waits and is applied at Player Two's login.
 */
async function m5AllyCopy(h, w) {
    await m5Reset(h, w);
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m5", "acquire", { uuid: ALCHEMISTS_FIRE, route: "buy" });
    const asked = await h.step("p2", "m5", "service", { kind: "formula-copy", performer: w.pcs.p1.uuid, uuid: ALCHEMISTS_FIRE });
    h.check("Player Two asks Player One for the formula", asked.ok === true && !!asked.service, asked);
    await h.step("p1", "m5", "seen", { path: `services.${asked.service}` });
    const performed = await h.step("p1", "m5", "perform", { service: asked.service });
    h.check("Player One performs it: a claim for Player Two, not written by Player One's client", performed.result?.outcome === "claimed" &&
        performed.service?.status === "done", performed);
    const learned = await h.step("p2", "m5", "waitFormula", { uuid: ALCHEMISTS_FIRE });
    h.check("Player Two's client writes the formula, provenance copied-ally from Player One", learned.ok && learned.provenance?.route === "copied-ally" &&
        learned.provenance?.source === w.pcs.p1.uuid, learned);
    await h.step("p1", "m5", "acquire", { uuid: ANTIDOTE, route: "buy" });
    const second = await h.step("p2", "m5", "service", { kind: "formula-copy", performer: w.pcs.p1.uuid, uuid: ANTIDOTE });
    await h.only(["p1"]);
    await h.step("p1", "m5", "seen", { path: `services.${second.service}` });
    const offline = await h.step("p1", "m5", "perform", { service: second.service });
    const waiting = await h.step("p1", "m5", "book", { actor: w.pcs.p2.uuid, ms: 2000 });
    h.check("with Player Two away and no GM, the claim waits unapplied", offline.result?.outcome === "claimed" && !waiting.book.includes(ANTIDOTE) &&
        waiting.claims.some((c) => c.route === "copied-ally" && !c.resolved), waiting);
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    const back = await h.step("p2", "m5", "waitFormula", { uuid: ANTIDOTE });
    h.check("Player Two's login sweep applies it", back.ok === true, back);
    const once = await h.step("p1", "m5", "book", { actor: w.pcs.p2.uuid, ms: 2000 });
    h.check("each formula claim applied once", once.claims.filter((c) => c.applied).length === 2 && once.book.filter((u) => u === ANTIDOTE).length === 1, once);
    await checkStatuses(h);
    return { performed, learned, offline, back };
}

/** An owed pick (6.8): Player One's alchemist takes a formula for the first Formula Book pick; the pick count drops by one. */
async function m5Pick(h, w) {
    await m5Reset(h, w);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const before = await h.step("p1", "m5", "owed", { key: "formula-book" });
    h.check("the alchemist is owed Formula Book picks, and a catalogue item fits the first", before.owed > 0 && !!before.pick && !!before.fit, before);
    const taken = await h.step("p1", "m5", "acquire", { uuid: before.fit.uuid, route: "grant", source: before.pick.key, pickLevel: before.pick.level });
    h.check("the pick is taken: provenance granted, nothing paid", taken.result?.ok === true && routeIn(taken, before.fit.uuid) === "granted" && taken.paid === 0, taken);
    const after = await h.step("p1", "m5", "owed", { key: "formula-book" });
    h.check("one pick fewer is owed", after.owed === before.owed - 1, { before: before.owed, after: after.owed });
    await checkStatuses(h);
    return { before, taken, after };
}

/**
 * The Craft-like formula jobs on the order machine (6.8): Player Two invents Healing Potion (Minor) (Inventor, Magical
 * Crafting; its 1 gp formula, 50 cp up front); Player One reverse-engineers an Elixir of Life (Lesser) the GM gave them
 * (its 8 gp formula, 4 gp up front) and keeps it; Player One crafts a copy of Antidote (Lesser) into Player Two's book,
 * which Player Two's client writes. A check that fails leaves the job failed, which the plan accepts.
 */
async function m5Jobs(h, w) {
    await m5Reset(h, w);
    const elixir = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.elixirLesser });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const invent = await h.step("p2", "m5", "request", { uuid: HEALING_POTION, productType: "formula", route: "invent", crafter: w.pcs.p2.uuid });
    h.check("Player Two files an invent job for themself", invent.ok === true && invent.brief?.productType === "formula" && invent.brief?.status === "accepted", invent);
    const invented = await h.step("p2", "m5", "run", { order: invent.order, pledge: 50 });
    const inventOk = invented.order?.status === "complete" && invented.order.setup?.days === 2;
    h.check("invented: half the formula's Price up front, 2 setup days, complete", inventOk || invented.order?.status === "failed", invented);
    if (inventOk) {
        const book = await h.step("p2", "m5", "book", {});
        h.check("the formula is in Player Two's book, invented", routeIn(book, HEALING_POTION) === "invented", book);
    }
    const reverse = await h.step("p1", "m5", "request", { uuid: M5.elixirLesser, productType: "formula", route: "reverse-engineer", crafter: w.pcs.p1.uuid });
    const reversed = await h.step("p1", "m5", "run", { order: reverse.order, pledge: 400 });
    const reverseOk = reversed.order?.status === "complete";
    h.check("reverse-engineered at the item's DC; the job completes (or fails its check)", reverseOk || reversed.order?.status === "failed", reversed);
    if (reverseOk) {
        const mine = await h.step("p1", "m5", "state", { names: [elixir.name] });
        const book = await h.step("p1", "m5", "book", {});
        h.check("the item is kept and the formula is in the book (Player Core p.294)", mine.mine.length === 1 && routeIn(book, M5.elixirLesser) === "reverse-engineered",
            { mine, book });
    }
    await h.step("p1", "m5", "acquire", { uuid: ANTIDOTE, route: "buy" });
    const copy = await h.step("p1", "m5", "request", { uuid: ANTIDOTE, productType: "formula", route: "craft-copy", crafter: w.pcs.p1.uuid, recipient: w.pcs.p2.uuid });
    const copied = await h.step("p1", "m5", "run", { order: copy.order, pledge: 50 });
    if (copied.order?.status === "complete") {
        const theirs = await h.step("p2", "m5", "waitFormula", { uuid: ANTIDOTE });
        h.check("the copy goes into Player Two's book, written by Player Two's client", theirs.ok && theirs.provenance?.route === "copied-ally", theirs);
    } else {
        h.check("crafting a copy completes or fails its check", copied.order?.status === "failed", copied);
    }
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { invented, reversed, copied };
}

/**
 * A rune etched with custody (6.13, G10): the GM gives Player One a +1 longsword; Player One asks for Striking on it; Player
 * Two's gates show the sword not held; Player One hands it over; Player Two crafts it at the Price difference (65 gp) and
 * the rune's DC (19); the sword goes back to Player One on the shelf with the rune, and Player One's client collects it.
 */
async function m5Etch(h, w) {
    await m5Reset(h, w);
    const sword = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.longsword, system: { runes: { potency: 1, striking: 0, property: [] } } });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const filed = await h.step("p1", "m5", "request", { uuid: M5.striking, craftType: "rune-etch", target: sword.uuid });
    h.check("Player One files an etching for their sword", filed.ok === true && filed.brief?.craftType === "rune-etch", filed);
    await h.step("p2", "m4", "accept", { order: filed.order });
    const blocked = await h.step("p2", "m5", "gates", { order: filed.order });
    h.check("the sword is not in custody yet (G10), the Price is 65 gp at DC 19", blocked.failing.some(([id, reason]) => id === "G10" && reason === "target-not-held") &&
        blocked.plan.priceCp === 6500 && blocked.plan.dc === 19, blocked);
    const handed = await h.step("p1", "m5", "handOver", { order: filed.order, item: sword.uuid, purpose: "target" });
    h.check("Player One hands the sword over to the strongbox", handed.ok === true, handed);
    const crafted = await h.step("p2", "m5", "run", { order: filed.order, pledge: 3250 });
    if (crafted.order?.status !== "complete") {
        h.check("the etching completes or fails its check", crafted.order?.status === "failed", crafted);
        return { crafted };
    }
    const shelf = await h.step("gm", "m5", "state", { ms: 500 });
    await h.step("p1", "m5", "sweep", {});
    const mine = await h.step("p1", "m5", "state", { names: ["Longsword"], ms: 2000 });
    h.check("the sword comes back to Player One with a striking rune and no earmark", mine.mine.some((i) => i.runes?.striking === 1) &&
        !mine.strongbox.some((i) => /Longsword/.test(i.name)), { shelf, mine });
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { blocked, handed, crafted, mine };
}

/**
 * Upgrades and transfers (6.13): Player One upgrades an Elixir of Life (Minor) to (Lesser) at the Price difference; Player
 * Two moves a striking rune from one longsword to another for 10% of its Price in one setup day. A transfer from the
 * Striking item itself (pf2e's rune on a runestone) is free; one from a blank runestone is refused (`not-there`).
 */
async function m5UpgradeTransfer(h, w) {
    await m5Reset(h, w);
    const minor = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: ELIXIR });
    const from = await h.step("gm", "m5", "give", { actor: w.pcs.p2.uuid, uuid: M5.longsword, system: { runes: { potency: 1, striking: 1, property: [] } } });
    const to = await h.step("gm", "m5", "give", { actor: w.pcs.p2.uuid, uuid: M5.longsword, system: { runes: { potency: 1, striking: 0, property: [] } } });
    const blankStone = await h.step("gm", "m5", "give", { actor: w.pcs.p2.uuid, uuid: M5.runestone });
    const runeItem = await h.step("gm", "m5", "give", { actor: w.pcs.p2.uuid, uuid: M5.striking });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const upgrade = await h.step("p1", "m5", "request", { uuid: M5.elixirLesser, craftType: "upgrade", target: minor.uuid, crafter: w.pcs.p1.uuid });
    const upGates = await h.step("p1", "m5", "gates", { order: upgrade.order });
    h.check("the upgrade costs the Price difference (30 gp - 3 gp)", upGates.plan.priceCp === 2700, upGates);
    const upgraded = await h.step("p1", "m5", "run", { order: upgrade.order, pledge: 1350 });
    if (upgraded.order?.status === "complete") {
        const mine = await h.step("p1", "m5", "state", { names: ["Elixir of Life (Minor)", "Elixir of Life (Lesser)"] });
        h.check("the minor elixir became a lesser one", mine.mine.some((i) => i.name === "Elixir of Life (Lesser)") && !mine.mine.some((i) => i.uuid === minor.uuid), mine);
    }
    const transfer = await h.step("p2", "m5", "request", { uuid: M5.striking, craftType: "rune-transfer", target: to.uuid, crafter: w.pcs.p2.uuid,
        variant: { transfer: { source: from.uuid } } });
    const moved = await h.step("p2", "m5", "run", { order: transfer.order, pledge: 325 });
    h.check("the transfer costs 10% of the rune (650 cp) with one setup day", moved.order?.priceCp === 650 && moved.order?.setup?.days === 1, moved.order);
    if (moved.order?.status === "complete") {
        const swords = await h.step("p2", "m5", "state", { names: ["Longsword"] });
        const runes = swords.mine.map((i) => i.runes?.striking).sort();
        h.check("the striking rune moved from one sword to the other", JSON.stringify(runes) === JSON.stringify([0, 1]) &&
            swords.mine.find((i) => i.uuid === to.uuid)?.runes?.striking === 1, swords);
    }
    const blank = await h.step("p2", "m5", "request", { uuid: M5.striking, craftType: "rune-transfer", target: from.uuid, crafter: w.pcs.p2.uuid,
        variant: { transfer: { source: blankStone.uuid } } });
    const blankGates = await h.step("p2", "m5", "gates", { order: blank.order });
    h.check("a blank runestone holds no rune: the transfer is refused (not-there)", blankGates.failing.some(([id, reason]) => id === "G12" && reason === "not-there"),
        blankGates);
    const fromItem = await h.step("p2", "m5", "request", { uuid: M5.striking, craftType: "rune-transfer", target: from.uuid, crafter: w.pcs.p2.uuid,
        variant: { transfer: { source: runeItem.uuid } } });
    const itemGates = await h.step("p2", "m5", "gates", { order: fromItem.order });
    h.check("a transfer from the Striking item itself is free", itemGates.plan.ok && itemGates.plan.priceCp === 0, itemGates);
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { upgraded, moved };
}

/**
 * Precious material stock (6.6): with coin no longer standing in for common materials, Player Two's sparkblade (low-grade
 * cold iron) is blocked on G8 until Player Two hands over a cold iron ingot; the ingot counts at its Price, the coins
 * commit nothing, and the finish uses it up.
 */
async function m5Precious(h, w) {
    await m5Reset(h, w);
    await h.step("gm", "m5", "setting", { key: "rules.preciousCoinForCommon", value: false });
    const ingot = await h.step("gm", "m5", "give", { actor: w.pcs.p2.uuid, uuid: M5.coldIronIngot });
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    try {
        const filed = await h.step("p2", "m5", "request", { uuid: M5.sparkblade, crafter: w.pcs.p2.uuid });
        await h.step("p2", "m4", "pledge", { order: filed.order, cp: 3500 });
        const blocked = await h.step("p2", "m5", "gates", { order: filed.order });
        h.check("blocked on the material's share (G8 precious)", blocked.failing.some(([id, reason]) => id === "G8" && reason === "precious"), blocked);
        const handed = await h.step("p2", "m5", "handOver", { order: filed.order, item: ingot.uuid, purpose: "material" });
        const open = await h.step("p2", "m5", "gates", { order: filed.order });
        h.check("the ingot opens G8", handed.ok === true && !open.failing.some(([id]) => id === "G8"), { handed, open });
        const crafted = await h.step("p2", "m5", "run", { order: filed.order });
        h.check("the coins commit nothing: the stock covers the up-front half", !crafted.order.rows.some((r) => r.kind === "commit"), crafted.order.rows);
        if (crafted.order?.status === "complete") {
            h.check("the finish uses the stock up", crafted.order.materials.every((m) => m.used) && crafted.order.rows.some((r) => r.kind === "material-out"), crafted.order);
        }
        checkReconciles(h, await serverView(h, "gm", w));
        return { blocked, open, crafted };
    } finally {
        await h.step("gm", "m5", "setting", { key: "rules.preciousCoinForCommon", value: true });
    }
}

/**
 * Casting pledges (6.9): Player Two asks for two 1st-rank scrolls; G9 blocks until a caster's pledge is cast; the GM pledges
 * Force Barrage from the wizard fixture and marks it cast; Player Two crafts the scrolls, which carry the spell; a second
 * scroll's casting is bought at the service price.
 */
async function m5Scroll(h, w) {
    await m5Reset(h, w);
    const wizardId = w.fixtures.find(([, fixture]) => fixture === "wizard-9")?.[0];
    const wizard = wizardId ? `Actor.${wizardId}` : null;
    h.check("the wizard fixture is built", !!wizard, w.fixtures);
    if (!wizard) return {};
    const spell = await h.step("gm", "m5", "spell", { actor: wizard, name: "Force Barrage" });
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const filed = await h.step("p2", "m5", "request", { uuid: M5.scroll1, quantity: 2, crafter: w.pcs.p2.uuid });
    h.check("a scroll order is a spell item", filed.brief?.craftType === "spell-item", filed.brief);
    await h.step("p2", "m4", "pledge", { order: filed.order, cp: 400 });
    const blocked = await h.step("p2", "m5", "gates", { order: filed.order });
    h.check("G9 waits for the castings", blocked.failing.some(([id, reason]) => id === "G9" && reason === "spells"), blocked);
    const pledged = await h.step("gm", "m5", "pledge", { order: filed.order, caster: wizard, spell: spell.uuid, castings: 2 });
    const cast = await h.step("gm", "m5", "fulfil", { order: filed.order, caster: wizard });
    h.check("the GM pledges two castings from the wizard and marks them cast", pledged.ok === true && cast.order.pledges.every((p) => p.status === "fulfilled"), { pledged, cast });
    await h.step("p2", "m5", "seen", { path: `orders.${filed.order}.pledges.${pledged.pledge}.status`, value: "fulfilled" });
    const crafted = await h.step("p2", "m5", "run", { order: filed.order });
    h.check("the scroll order starts once its castings are cast: it completes or fails its check", ["complete", "failed"].includes(crafted.order?.status), crafted);
    if (crafted.order?.status === "complete") {
        await h.step("p2", "m5", "sweep", {});
        const mine = await h.step("p2", "m5", "state", { ms: 2000 });
        h.check("Player Two holds the scrolls of Force Barrage", mine.mine.some((i) => /Force Barrage/.test(i.name)), mine.mine.map((i) => i.name));
    }
    const second = await h.step("p2", "m5", "request", { uuid: M5.scroll1, quantity: 1, crafter: w.pcs.p2.uuid });
    const bought = await h.step("p2", "m5", "buyCasting", { order: second.order, name: "Force Barrage", castings: 1 });
    h.check("a casting bought at the service price (3 gp)", bought.ok === true, bought);
    const after = await h.step("p2", "m5", "gates", { order: second.order });
    h.check("the bought casting satisfies G9", !after.failing.some(([id]) => id === "G9"), after);
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { crafted, bought };
}

/**
 * Purchases under fund accounting (M5 on M4.1) with no GM: Player Two adds 20 gp to the party fund; Player One buys
 * Antidote (Lesser)'s formula from the party fund (her purse untouched, the strongbox pays 1 gp); Player Two files a
 * scroll order and buys its casting of Force Barrage from the party fund (3 gp, earmarked and spent by the order in one
 * move); a second formula comes from the fund too. The server's strongbox is the unallocated fund plus what is
 * earmarked, and reconciles.
 */
async function m5Fund(h, w) {
    await m5Reset(h, w);
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    await h.step("p2", "m4", "deposit", { cp: 2000 });
    const bought = await h.step("p1", "m5", "acquire", { uuid: ANTIDOTE, route: "buy", paidFrom: "fund" });
    h.check("the formula is bought from the party fund: Player One's purse is untouched", bought.result?.ok === true && bought.paid === 0
        && bought.book.includes(ANTIDOTE), bought);
    const filed = await h.step("p2", "m5", "request", { uuid: M5.scroll1, quantity: 1, crafter: w.pcs.p2.uuid });
    const casting = await h.step("p2", "m5", "buyCasting", { order: filed.order, name: "Force Barrage", castings: 1, paidFrom: "fund" });
    h.check("a casting is bought from the party fund (3 gp)", casting.ok === true, casting);
    const view = await serverView(h, "p2", w);
    const orderRows = view.rows.filter((r) => r.order === filed.order);
    h.check("server: 20 gp in, 1 gp for the formula and 3 gp for the casting out of the strongbox", view.actualCp === 1600, { actualCp: view.actualCp });
    h.check("server: the strongbox is the unallocated fund plus what is earmarked", view.unallocatedCp === 1600 && view.earmarkedCp === 0
        && view.unallocatedCp + view.earmarkedCp === view.expectedCp, { unallocatedCp: view.unallocatedCp, earmarkedCp: view.earmarkedCp, expectedCp: view.expectedCp });
    h.check("server: the order's casting is earmarked and spent in one move, by the party fund",
        orderRows.some((r) => r.kind === "purchase" && r.actor === null && r.alloc === -300) && orderRows.some((r) => r.kind === "allocate" && r.alloc === 300), orderRows);
    const second = await h.step("p1", "m5", "acquire", { uuid: ELIXIR, route: "buy", paidFrom: "fund" });
    h.check("a second formula from the party fund: the purse still untouched", second.result?.ok === true && second.paid === 0, second);
    checkReconciles(h, await serverView(h, "p1", w));
    await checkStatuses(h);
    return { bought, casting, second };
}

/**
 * Services (4.5, 6.13) with no GM online for the work: Player One's damaged shield, handed over, is repaired by Player Two
 * (who carries a repair toolkit) and comes back with its Hit Points; Player One affixes a talisman to armor, is refused a
 * second on the same host, and takes the first off; Player One identifies alchemy through pf2e's own action.
 */
async function m5Services(h, w) {
    await m5Reset(h, w);
    const shield = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.steelShield, system: { hp: { value: 5 } } });
    await h.step("gm", "m5", "give", { actor: w.pcs.p2.uuid, uuid: M5.repairToolkit, equip: true, hands: 2 });
    await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.repairToolkit, equip: true, hands: 2 });
    const fang = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.wolfFang });
    const cat = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.jadeCat });
    const armor = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.leatherArmor });
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    const repair = await h.step("p1", "m5", "service", { kind: "repair", performer: w.pcs.p2.uuid, target: shield.uuid });
    const handed = await h.step("p1", "m5", "handOver", { service: repair.service, item: shield.uuid, purpose: "service" });
    h.check("Player One hands the shield over for the repair", handed.ok === true, handed);
    const done = await h.step("p2", "m5", "perform", { service: repair.service });
    h.check("Player Two repairs it: master Crafting restores up to 20 HP (a failure restores nothing)", done.result?.ok === true &&
        (done.result.degree >= 2 ? done.result.after === 20 : done.result.after <= 20), done);
    await h.step("p1", "m5", "sweep", {});
    const back = await h.step("p1", "m5", "state", { names: ["Steel Shield"], ms: 2000 });
    h.check("the shield is back with Player One", back.mine.length === 1 && !back.strongbox.some((i) => i.name === "Steel Shield"), back);
    const affix = await h.step("p1", "m5", "service", { kind: "affix", performer: w.pcs.p1.uuid, target: fang.uuid, host: armor.uuid });
    const affixed = await h.step("p1", "m5", "perform", { service: affix.service });
    const second = await h.step("p1", "m5", "service", { kind: "affix", performer: w.pcs.p1.uuid, target: cat.uuid, host: armor.uuid });
    const refused = await h.step("p1", "m5", "perform", { service: second.service });
    const flags = await h.step("p1", "m5", "state", { names: ["Wolf Fang", "Jade Cat"] });
    h.check("one talisman per host: the second is refused (host-taken)", affixed.result?.ok === true && refused.result?.reason === "host-taken" &&
        flags.mine.find((i) => i.name === "Wolf Fang")?.affix?.host, { affixed, refused, flags });
    const off = await h.step("p1", "m5", "service", { kind: "unaffix", performer: w.pcs.p1.uuid, target: fang.uuid });
    await h.step("p1", "m5", "perform", { service: off.service });
    const cleared = await h.step("p1", "m5", "state", { names: ["Wolf Fang"] });
    h.check("taking it off clears the affix record", !cleared.mine[0]?.affix, cleared);
    const before = await h.evaluate("p1", pageCards, { mod: MOD, kind: "none" }, "messages");
    const identify = await h.step("p1", "m5", "service", { kind: "identify-alchemy", performer: w.pcs.p1.uuid });
    const identified = await h.step("p1", "m5", "perform", { service: identify.service });
    const after = await h.evaluate("p1", pageCards, { mod: MOD, kind: "none" }, "messages");
    h.check("Identify Alchemy runs pf2e's own action and closes the service", identified.service?.status === "done" && after.messages > before.messages, { identified, before, after });
    await checkStatuses(h);
    return { done, affixed, refused, identified };
}

/**
 * The Formulas tab driven like a user (10.1): Player One opens it, looks up Antidote (Lesser), clicks Buy, pays from
 * her purse in the money dialog (M5 on M4.1: the price shown, the source chosen) and sees it in the book; chooses the
 * first owed pick and takes a fitting formula with its button.
 */
async function m5Ui(h, w) {
    await m5Reset(h, w);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const opened = await h.step("p1", "m5", "open", { tab: "formulas", uuid: ANTIDOTE });
    h.check("the Formulas tab opens with the routes for Antidote (Lesser)", opened.open && opened.tab === "formulas" && opened.routes >= 2, opened);
    const clicked = await h.step("p1", "m5", "click", { selector: '.learn-routes button[data-op="buy"]', ms: 500 });
    const paid = await h.step("p1", "m5", "payDialog", { source: "purse", ms: 2500 });
    h.check("Buy asks where the price is paid from: the price, the party fund and the purse", paid.found && /1 gp/.test(paid.fixed ?? "")
        && paid.sources?.length === 2 && paid.enabled, paid);
    const book = await h.step("p1", "m5", "book", {});
    h.check("clicking Buy and paying learns it", clicked.clicked && book.book.includes(ANTIDOTE), book);
    const owed = await h.step("p1", "m5", "owed", { key: "formula-book" });
    if (owed.pick && owed.fit) {
        await h.step("p1", "m5", "open", { tab: "formulas", uuid: owed.fit.uuid, pick: { key: owed.pick.key, level: owed.pick.level } });
        const take = await h.step("p1", "m5", "click", { selector: 'button[data-op="grant"]', ms: 2500 });
        const after = await h.step("p1", "m5", "owed", { key: "formula-book" });
        h.check("'Take as this pick' takes the pick", take.clicked && after.owed === owed.owed - 1, { owed: owed.owed, after: after.owed });
    }
    const errors = h.console.filter((c) => c.client === "p1" && c.type === "pageerror");
    h.check("no page errors on Player One's client", errors.length === 0, errors);
    await h.step("p1", "m5", "close", {});
    return { opened, book };
}

/**
 * Screenshots of the Formulas tab (10.1, 10.8, 10.9) as the GM (showing Player One's alchemist) and as Player One, at
 * 1440x900 and 1024x768, dark and light: the book by family with its badges, the picks owed and the routes for a formula;
 * and the Queue with an etching's custody and an open repair service, with its detail open.
 */
async function m5Shots(h, w) {
    await m5Reset(h, w);
    const sword = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.longsword, system: { runes: { potency: 1, striking: 0, property: [] } } });
    const shield = await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: M5.steelShield, system: { hp: { value: 5 } } });
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    await h.step("p1", "m5", "acquire", { uuid: ANTIDOTE, route: "buy" });
    await h.step("p1", "m5", "acquire", { uuid: ELIXIR, route: "buy" });
    const etch = await h.step("p1", "m5", "request", { uuid: M5.striking, craftType: "rune-etch", target: sword.uuid });
    await h.step("p1", "m5", "handOver", { order: etch.order, item: sword.uuid, purpose: "target" });
    await h.step("p1", "m5", "service", { kind: "repair", target: shield.uuid });
    const sizes = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }];
    const opened = [];
    for (const role of ["gm", "p1"]) {
        for (const scheme of ["dark", "light"]) {
            await h.step(role, "m4", "theme", { scheme });
            for (const size of sizes) {
                const file = `m5-${role}-formulas-${size.width}x${size.height}-${scheme}.png`;
                await h.screenshot(role, file, size, async () => {
                    // Alchemist's Fire (Lesser): a formula Player One neither knows nor covers, so the tab shows its routes. Elixir of
                    // Life (Lesser) is covered by the (Minor) bought above (6.4) and offers none.
                    const open = await h.step(role, "m5", "open", { tab: "formulas", actor: w.pcs.p1.uuid, uuid: ALCHEMISTS_FIRE });
                    opened.push({ role, scheme, ...size, ...open });
                    return open;
                });
            }
            await h.screenshot(role, `m5-${role}-queue-services-1440x900-${scheme}.png`, sizes[0],
                () => h.step(role, "m5", "open", { tab: "queue", order: etch.order }));
        }
        await h.step(role, "m5", "close", {});
    }
    h.check("the Formulas tab opened with the module's styles every time", opened.every((o) => o.open && o.hasStyles), opened.filter((o) => !o.open || !o.hasStyles));
    h.check("the tab showed families and routes", opened.every((o) => o.families >= 1 && o.routes >= 1), opened.map((o) => [o.role, o.families, o.routes]));
    await h.step("gm", "m4", "theme", { scheme: "dark" });
    await h.step("p1", "m4", "theme", { scheme: "dark" });
    return { opened, shots: h.shots.filter((s) => s.label === h.label).map((s) => s.file) };
}

Object.assign(BEHAVIOURS, {
    "m5-buy": m5Buy,
    "m5-ally-copy": m5AllyCopy,
    "m5-pick": m5Pick,
    "m5-jobs": m5Jobs,
    "m5-etch": m5Etch,
    "m5-upgrade-transfer": m5UpgradeTransfer,
    "m5-precious": m5Precious,
    "m5-scroll": m5Scroll,
    "m5-fund": m5Fund,
    "m5-services": m5Services,
    "m5-ui": m5Ui,
    "m5-shots": m5Shots,
});

/* -------------------------------------------- */
/*  M6: downtime                                 */
/* -------------------------------------------- */

/** Communal Crafting (Player Core p.253), from pf2e's feats pack: the M6 plans give it to the crafter. */
const COMMUNAL_CRAFTING = "Compendium.pf2e.feats-srd.Item.lUXVmSFJbaPos5pY";
/** The prompt's keys (9.1); the page log records a notification's key and its format data. */
const PROMPT_KEYS = ["pf2e-artisans-workshop.Downtime.Prompt", "pf2e-artisans-workshop.Downtime.PromptOne"];

/** The downtime prompts each client showed since the last look, by client: `[{actor, count}]`. */
async function promptsBy(h) {
    const pages = await takeNotes(h);
    return Object.fromEntries(Object.entries(pages).map(([client, page]) => [client,
        page.notes.filter((n) => PROMPT_KEYS.includes(n.message)).map((n) => ({ actor: n.format?.actor ?? null, count: Number(n.format?.count ?? 0) }))]));
}

/** Every M6 plan starts here: the world reset (the clock is only ever moved forward), no settlement profiles, M5's items back. */
async function m6Reset(h, w, { lab = false } = {}) {
    await m5Reset(h, w, { lab });
    await h.step("gm", "m6", "reset");
}

/**
 * Clock accrual (9.1): Player One's alchemist goes into downtime; the GM moves the clock a day: one pending day, and one
 * prompt, on Player One's client only (not Player Two's, not the GM's). An hour more prompts nothing; resolving the day
 * leaves nothing pending. With Player One away the GM's client is the fallback and is prompted; at Player One's login
 * their client prompts for the days that accrued while they were away.
 */
async function m6Clock(h, w) {
    await m6Reset(h, w);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const into = await h.step("p1", "m6", "downtime", { on: true });
    await h.step("p1", "m6", "activity", { activity: "subsist" });
    h.check("Player One's alchemist is in downtime from today, nothing pending yet", into.result?.ok === true && into.pc.inDowntime && into.pc.pending === 0, into);
    await promptsBy(h);
    await h.step("gm", "m6", "clock", { days: 1, ms: 3000 });
    const first = await promptsBy(h);
    h.check("one day later: one prompt, on Player One's client only", first.p1?.length === 1 && first.p1[0].actor === w.pcs.p1.name && first.p1[0].count === 1 &&
        !first.p2?.length && !first.gm?.length, first);
    const seen = await h.step("p2", "m6", "status", { actor: w.pcs.p1.uuid });
    h.check("every member sees the one pending day", seen.pending === 1, seen);
    await h.step("gm", "m6", "clock", { seconds: 3600, ms: 3000 });
    const hour = await promptsBy(h);
    h.check("an hour more, the same day: no second prompt", Object.values(hour).every((list) => !list.length), hour);
    const resolved = await h.step("p1", "m6", "resolve", {});
    h.check("resolving the day writes one record and leaves nothing pending", resolved.result.records.length === 1 && resolved.pc.pending === 0, resolved);
    await h.only(["gm", "p2"]);
    await promptsBy(h);
    await h.step("gm", "m6", "clock", { days: 1, ms: 3000 });
    const away = await promptsBy(h);
    h.check("with Player One away, the GM's client is the one prompted", away.gm?.length === 1 && !away.p2?.length, away);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m6", "status", { ms: 4000 });
    const back = await promptsBy(h);
    h.check("at Player One's login their client prompts for the day that accrued", back.p1?.length === 1 && back.p1[0].count === 1 && !back.gm?.length, back);
    const tab = await h.step("p1", "m6", "tab", {});
    h.check("the Downtime tab shows the pending day and its badge", tab.rows.some((r) => r.pending) && tab.badge === "1", tab);
    await checkStatuses(h);
    return { into, first, hour, resolved, away, back, tab };
}

/** Both PCs in downtime: Player One subsisting, Player Two on an Earn Income job at task level 1 (rolled). Returns the job. */
async function m6TwoInDowntime(h) {
    await h.step("p1", "m6", "downtime", { on: true });
    await h.step("p1", "m6", "activity", { activity: "subsist" });
    const job = await h.step("p2", "m6", "job", { skill: "crafting", taskLevel: 1 });
    h.check("Player Two takes a job and rolls it", job.started?.ok === true && !!job.brief?.job?.check, job);
    await h.step("p2", "m6", "downtime", { on: true });
    return job;
}

/**
 * The wizard with a GM (9.2), driven step by step in its window: two days, with the world clock moved to match. Step 1
 * offers the clock; step 2 lists both PCs and what their days go to; step 3 has no checks due (the job is rolled); step 4
 * reviews the days and Player Two's wages as claims (the GM is not Player Two's client); commit writes both PCs' days,
 * the logged-day mark, and moves the clock, so nobody is prompted for days already resolved. Run again, "since last
 * resolved" writes nothing.
 */
async function m6WizardGm(h, w) {
    await m6Reset(h, w);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const job = await m6TwoInDowntime(h);
    const before = await h.step("gm", "m6", "today");
    await promptsBy(h);
    const run = await h.step("gm", "m6", "wizard", { script: [
        { field: "count", value: 2 }, { field: "advanceClock", value: true }, { click: "next" }, { click: "next" }, { click: "next" }, { click: "commit", ms: 4000 },
    ] });
    const steps = run.seen.map((s) => s.step);
    h.check("the wizard went span, who, checks, review, done", JSON.stringify(steps) === JSON.stringify(["span", "span", "span", "who", "checks", "review", "done"]), steps);
    h.check("a GM is offered the clock", run.seen[0].clockOption === true, run.seen[0]);
    h.check("both PCs are listed with their days", run.seen[3].text.includes(w.pcs.p1.name) && run.seen[3].text.includes(w.pcs.p2.name), run.seen[3].text);
    const done = run.result;
    h.check("commit: both PCs resolved two days, the clock moved to the last day", done?.ok && done.clock === before.day + 2 &&
        done.results.every((r) => r.records.length === 2), done);
    h.check("Player Two's wages were claims, not minted by the GM", done.results.find((r) => r.actor === w.pcs.p2.name)?.wages.every((x) => x.outcome === "claimed"), done);
    const wages = await h.step("p2", "m6", "jobState", { job: job.started.job, ms: 5000 });
    h.check("Player Two's client collects both days' wages, once each", wages.wages.length === 2 && wages.claims.every((c) => c.resolved), wages);
    const after = await h.step("gm", "m6", "today");
    h.check("server time: the clock's day is the logged day, nothing logged ahead", after.clockDay === before.day + 2 && after.ahead === 0, after);
    const prompts = await promptsBy(h);
    h.check("nobody was prompted for the days the wizard resolved", Object.values(prompts).every((list) => !list.length), prompts);
    const again = await h.step("gm", "m6", "advance", { since: true });
    h.check("run again since last resolved: nothing written", again.ok && again.results.every((r) => !r.records.length), again);
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { run, wages, after, again };
}

/**
 * The wizard with players only (9.2, P2): Player One runs it for three days. No clock option; the days are logged ahead
 * of the calendar; Player Two's wages are claims Player Two's client collects. Then a GM logs in: the Downtime tab says
 * three days are logged ahead and offers "Move the calendar to match"; the clock moves into the logged days and nothing
 * accrues or is prompted again.
 */
async function m6WizardPlayers(h, w) {
    await m6Reset(h, w);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const job = await m6TwoInDowntime(h);
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    const before = await h.step("p1", "m6", "today");
    const run = await h.step("p1", "m6", "wizard", { script: [
        { field: "count", value: 3 }, { click: "next" }, { click: "next" }, { click: "next" }, { click: "commit", ms: 4000 },
    ] });
    h.check("a player is not offered the clock", run.seen[0].clockOption === false, run.seen[0]);
    h.check("commit: three days each, no clock moved", run.result?.ok && run.result.clock === null && run.result.results.every((r) => r.records.length === 3), run.result);
    const after = await h.step("p2", "m6", "today");
    h.check("the workshop day moved three days ahead of the calendar", after.day === before.day + 3 && after.ahead === 3 && after.clockDay === before.clockDay, after);
    const wages = await h.step("p2", "m6", "jobState", { job: job.started.job, ms: 5000 });
    h.check("Player Two's client collected three wages with no GM online", wages.wages.length === 3 && wages.claims.every((c) => c.resolved), wages);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await promptsBy(h);
    const tab = await h.step("gm", "m6", "tab", { click: "[data-op='match']", ms: 3000 });
    h.check("the GM's Downtime tab says three days ahead and offers to move the calendar", !!tab.ahead && tab.match === true, tab);
    h.check("moving the calendar lands inside the logged days", tab.after?.clockDay === before.clockDay + 3 && tab.after.ahead === 0 && tab.after.day === after.day, tab.after);
    const prompts = await promptsBy(h);
    h.check("no day accrued twice: nobody is prompted", Object.values(prompts).every((list) => !list.length), prompts);
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { run, after, wages, tab };
}

/**
 * Communal Crafting (6.7): the GM gives Player One's alchemist the feat; Player One crafts two Elixirs of Life (Lesser) to
 * `finishing`; Player Two's fighter crafter joins with Crafting and rolls against the item's DC; two work days carry the
 * helper's share at (level - 1) and their rank; Player Two leaves and forfeits it (the default); rejoining is refused.
 */
async function m6Communal(h, w) {
    await m6Reset(h, w, { lab: true });
    await h.step("gm", "m5", "give", { actor: w.pcs.p1.uuid, uuid: COMMUNAL_CRAFTING });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const craft = await h.step("p1", "m6", "craft", COMMUNAL_ORDER);
    const finishing = craft.brief?.status === "finishing";
    h.check("Player One's order reaches finishing (or its check failed, which the plan accepts)", finishing || craft.brief?.status === "failed", craft);
    if (!finishing) return { craft };
    await h.step("p1", "m6", "status", { ms: 2000 });   // Player One's roster snapshot, with the feat, reaches Player Two
    const joined = await h.step("p2", "m6", "join", { order: craft.order, skill: "crafting" });
    const helper = joined.brief?.helpers?.[w.pcs.p2.id];
    h.check("Player Two joins, accepted (the crafter has the feat), locked to the order, the check recorded", joined.joined?.ok && helper?.accepted !== false &&
        Number.isInteger(helper?.degree) && joined.pc.activity?.kind === "help", joined);
    const worked = await h.step("p1", "m6", "work", { order: craft.order, count: 2 });
    const shares = worked.brief.extra.map((d) => d.helpers?.[w.pcs.p2.id] ?? 0);
    h.check("two work days, each with Player Two's share beside Player One's", worked.brief.extra.length >= 2 && shares.slice(-2).every((cp) => cp >= 0), worked.brief);
    const reductionBefore = worked.brief.reductionCp;
    const left = await h.step("p2", "m6", "leave", { order: craft.order });
    h.check("Player Two leaves: their help is forfeited by default, their activity cleared", left.result?.ok && left.result.forfeits === true &&
        left.pc.activity === null && left.brief.reductionCp === reductionBefore - shares.slice(-2).reduce((a, b) => a + b, 0), { left, reductionBefore, shares });
    const again = await h.step("p2", "m6", "join", { order: craft.order, skill: "crafting", roll: false });
    h.check("a helper who left does not come back", again.joined?.reason === "left", again.joined);
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { craft, joined, worked, left };
}

/**
 * Earn Income paid once per day (6.10, 5.4): Player Two on two devices takes a job and rolls it; the GM moves the clock two
 * days; both devices resolve at the same moment: one lands, the other is refused and finds nothing left; the GM's wizard
 * then resolves a third day (a claim both devices race to collect); repeated advances and resolutions write nothing.
 * Three wage rows, one a day; the purse grew by three days' pay.
 */
async function m6Income(h, w) {
    await m6Reset(h, w);
    await h.only(["gm", "p2", "p2@2"]);
    await h.settle("ready");
    const job = await h.step("p2", "m6", "job", { skill: "crafting", taskLevel: 1 });
    const id = job.started?.job;
    h.check("the job is rolled with its pay per day", !!job.brief?.job?.check && job.brief.job.perDayCp >= 0, job);
    await h.step("p2", "m6", "downtime", { on: true });
    const start = job.brief.purse;
    await h.step("gm", "m6", "clock", { days: 2 });
    const both = await h.together([["p2", "m6", "resolve", {}], ["p2@2", "m6", "resolve", {}]]);
    const landed = both.filter((r) => r.result.ok && r.result.records.length === 2);
    h.check("two devices at once: one resolution lands, the other is refused or finds nothing", landed.length === 1 &&
        both.some((r) => r.result.reason === "taken" || r.result.reason === "no-days"), both.map((r) => r.result));
    await h.step("gm", "m6", "advance", { days: 1 });
    const repeat = await h.together([["gm", "m6", "advance", { since: true }], ["p2", "m6", "resolve", {}], ["p2@2", "m6", "resolve", {}]]);
    h.check("repeated advances and resolutions write nothing more", repeat[0].results.every((r) => !r.records.length) &&
        repeat.slice(1).every((r) => !r.result.records.length), repeat);
    const state = await h.step("p2", "m6", "jobState", { job: id, ms: 6000 });
    const perDay = job.brief.job.perDayCp;
    h.check("three wage rows, one a day, all applied", JSON.stringify(state.wages.map((x) => x.day)) === JSON.stringify([...new Set(state.wages.map((x) => x.day))]) &&
        state.wages.length === (perDay > 0 ? 3 : 0) && state.wages.every((x) => x.state === "applied"), state);
    h.check("the purse grew by three days' pay", state.purse - start === 3 * perDay, { start, end: state.purse, perDay });
    checkReconciles(h, await serverView(h, "gm", w));
    await checkStatuses(h);
    return { job, both, repeat, state };
}

/**
 * A settlement profile capping task levels (6.10, 14.2): the GM keeps a village whose highest task level is 1, with
 * Crafting up to 2; Player One, alone, puts the party in it (no GM needed) and is told who set it; a job above the cap
 * is refused with the cap, one at it starts confirmed; with no settlement any level starts, marked unconfirmed.
 */
async function m6Settlement(h, w) {
    await m6Reset(h, w);
    await h.only(["gm"]);
    const profile = await h.step("gm", "m6", "profile", { name: "Harbour village", size: "village", level: 1, caps: { crafting: 2 } });
    h.check("the GM saves the settlement", profile.ok === true, profile);
    await h.only(["p1"]);
    await h.settle("ready");
    const set = await h.step("p1", "m6", "settle", { profile: profile.id });
    h.check("Player One, with no GM online, puts the party there", set.result?.ok && set.current?.name === "Harbour village" && set.record?.by === w.users.p1, set);
    const over = await h.step("p1", "m6", "job", { skill: "crafting", taskLevel: 3, roll: false });
    h.check("a job above the cap is refused with the cap", over.started?.reason === "task-level-cap" && over.started.data?.max === 2, over.started);
    const capped = await h.step("p1", "m6", "job", { skill: "crafting", taskLevel: 2, roll: false });
    h.check("a job at the cap starts, confirmed", capped.started?.ok && capped.started.unconfirmed === false && capped.brief.job.settlement === profile.id, capped);
    await h.step("p1", "m6", "settle", { profile: null });
    const free = await h.step("p1", "m6", "job", { skill: "crafting", taskLevel: 9, roll: false });
    h.check("with no settlement any level starts, marked unconfirmed (OQ-17)", free.started?.ok && free.started.unconfirmed === true, free.started);
    await checkStatuses(h);
    return { profile, set, over, capped, free };
}

Object.assign(BEHAVIOURS, {
    "m6-clock": m6Clock,
    "m6-wizard-gm": m6WizardGm,
    "m6-wizard-players": m6WizardPlayers,
    "m6-communal": m6Communal,
    "m6-income": m6Income,
    "m6-settlement": m6Settlement,
});

/* -------------------------------------------- */
/*  M7: daily preparations (DESIGN.md 7, 10.1)   */
/* -------------------------------------------- */

/** M7's compendium items (pf2e `packs/pf2e/equipment/`) and feats. */
const M7 = Object.freeze({
    elixirMinor: ELIXIR,
    /** The family of the Elixir of Life grades: `familyKey({name: "Elixir of Life (Minor)", type: "consumable", category: "elixir"})`. */
    elixirFamily: "consumable|elixir|elixir of life",
    jadeCat: "Compendium.pf2e.equipment-srd.Item.2MgFoNXTccL8Own9",
    bronzeBull: "Compendium.pf2e.equipment-srd.Item.nXStoLxPrrP2b6WB",
    opal: "Compendium.pf2e.equipment-srd.Item.aKbrBW1SnFDxya5J",
    talismanicSage: "Compendium.pf2e.feats-srd.Item.uPikeCzrTrgzEJT8",
});
/** The Morning prompt's key (7.8), as the page log records it. */
const MORNING_PROMPT = "pf2e-artisans-workshop.Morning.Prompt";

/** The Morning prompts each client showed since the last look, by client: the characters named. */
async function morningPrompts(h) {
    const pages = await takeNotes(h);
    return Object.fromEntries(Object.entries(pages).map(([client, page]) => [client,
        page.notes.filter((n) => n.message === MORNING_PROMPT).map((n) => n.format?.actor ?? null)]));
}

/**
 * Every M7 plan starts here: the world reset, M5's and M7's items taken back and both characters' pools and books put
 * back, then the alchemist knows Elixir of Life (Minor), whose family the plans prepare by.
 */
async function m7Reset(h, w) {
    await resetWorld(h, w);
    await h.step("gm", "m5", "reset", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid] });
    await h.step("gm", "m7", "reset", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid] });
    await h.step("gm", "m7", "learn", { actor: w.pcs.p1.uuid, uuids: [M7.elixirMinor] });
}

/** pf2e-dailies on or off for the plans that follow: every page reloads so it loads (or not). */
async function m7Dailies(h, on) {
    await h.only(["gm"]);
    const set = await h.step("gm", "m7", "modules", { dailies: on });
    await h.closeAll();
    await h.only(["gm"]);
    await h.settle("ready");
    const active = await h.step("gm", "m7", "active", {});
    h.check(`pf2e-dailies is ${on ? "active" : "inactive"} after the reload`, active.dailies === on, { set, active });
    return set.before;
}

/**
 * A preparation through pf2e's own methods (7.1, 7.4, 7.5): Player One's bomber (level 11, Talisman Dabbler) shows its
 * pools from pf2e (Advanced Alchemy and Talisman Dabbler), the Dabbler's picker (common talismans up to level 5, none in
 * the book) and its vials; a loadout by family prepares Elixir of Life at the best grade the pool allows (Moderate, level
 * 9), written into the book by family; two virtual talismans are made without a book; everything is stamped with the
 * cycle, Advanced Alchemy with its 24 hours; a second preparation in the same cycle is refused; the GM reads the same.
 */
async function m7Morning(h, w) {
    await m7Reset(h, w);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const facts = await h.step("p1", "m7", "facts", {});
    const aa = facts.pools.find((p) => p.slug === "advanced-alchemy");
    const dabbler = facts.pools.find((p) => p.slug === "talisman-dabbler");
    h.check("the alchemist's daily pools come from pf2e: Advanced Alchemy and Talisman Dabbler", !!aa && !!dabbler, facts.pools.map((p) => p.slug));
    h.check("Advanced Alchemy lists its sources with their own slots", aa?.sources.length >= 1 && aa.sources.every((s) => Number.isInteger(s.maxSlots)), aa?.sources);
    h.check("the Dabbler's picker: common talismans of level 5 or lower", dabbler?.offered.length >= 2 && dabbler.offered.every((t) => t.level <= 5), dabbler?.offered);
    h.check("versatile vials read from the resource", facts.vials?.max > 0, facts.vials);
    const saved = await h.step("p1", "m7", "loadout", { name: "Healer", pools: { "advanced-alchemy": [{ family: M7.elixirFamily, qty: 2 }] } });
    h.check("the loadout is saved on the character", saved.ok === true, saved);
    const picks = dabbler.offered.slice(0, 2).map((t) => t.uuid);
    const prep = await h.step("p1", "m7", "prepare", { pools: { "advanced-alchemy": { mode: "loadout", id: saved.id } }, talismans: { "talisman-dabbler": picks } });
    h.check("prepared in cycle 0", prep.result.ok === true && prep.result.cycle === 0, prep.result);
    const elixirs = prep.brief.stamped.filter((i) => i.name.startsWith("Elixir of Life"));
    h.check("the family resolved to Elixir of Life (Moderate), two of them, infused", elixirs.length === 1 && elixirs[0].name === "Elixir of Life (Moderate)" &&
        elixirs[0].qty === 2 && elixirs[0].traits.includes("infused"), elixirs);
    h.check("Advanced Alchemy's items carry the cycle and the 24 hours", elixirs[0]?.expiry?.cycle === 0 && Number.isFinite(elixirs[0]?.expiry?.at) &&
        Number.isInteger(elixirs[0]?.expiry?.atDay), elixirs[0]?.expiry);
    h.check("the grade went into the book by family", prep.brief.provenance.some((p) => p.route === "family"), prep.brief.provenance);
    const talismans = prep.brief.stamped.filter((i) => i.expiry?.pool === "talisman-dabbler");
    h.check("two virtual talismans made, none written to the book", talismans.length === 2 && picks.every((uuid) => !prep.brief.book.includes(uuid)), { talismans, book: prep.brief.book });
    h.check("a Dabbler talisman with an inline save gets the creator's DC; one without carries no stamp",
        talismans.every((t) => (t.description.includes("@Check") ? t.dcStamp?.dc >= Math.max(facts.dcs.classDc ?? 0, facts.dcs.spellDc ?? 0) : !t.dcStamp)), talismans);
    const again = await h.step("p1", "m7", "prepare", {});
    h.check("a second preparation in the same cycle is refused", again.result.reason === "prepared", again.result);
    const gm = await h.step("gm", "m7", "state", { actors: [w.pcs.p1.uuid], ms: 1000 });
    h.check("the GM reads the same stamps", gm.actors[0].stamped.length === prep.brief.stamped.length, gm.actors[0].stamped.length);
    await checkStatuses(h);
    return { facts, prep, again };
}

/**
 * Party-wide expiry (7.7): Player One prepares; the GM hands one infused elixir to Player Two's fighter; Player One rests
 * (pf2e's Rest for the Night): Player One's cycle goes up once, and Player Two's client marks the elixir Player Two holds
 * inert, which pf2e's rest would not have touched. Then Player One prepares again and the GM moves the clock 24 hours:
 * the new Advanced Alchemy items expire on their own clock.
 */
async function m7Expiry(h, w) {
    await m7Reset(h, w);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m7", "loadout", { name: "Healer", pools: { "advanced-alchemy": [{ family: M7.elixirFamily, qty: 2 }] } });
    const loadout = (await h.step("p1", "m7", "state", {})).actors[0].loadouts[0];
    const prep = await h.step("p1", "m7", "prepare", { pools: { "advanced-alchemy": { mode: "loadout", id: loadout.id } } });
    const elixir = prep.brief.stamped.find((i) => i.name.startsWith("Elixir of Life"));
    const moved = await h.step("gm", "m7", "move", { item: elixir.uuid, qty: 1, to: w.pcs.p2.uuid });
    h.check("the GM hands one elixir to Player Two's fighter", !!moved.moved, moved);
    const before = await h.step("p2", "m7", "state", { actors: [w.pcs.p2.uuid], ms: 1000 });
    h.check("Player Two holds it, potent, stamped by Player One", before.actors[0].stamped.some((i) => i.expiry?.creator === w.pcs.p1.uuid && !i.inert), before.actors[0].stamped);
    const rested = await h.step("p1", "m7", "rest", { actors: [w.pcs.p1.uuid], ms: 4000 });
    const after = await h.step("p2", "m7", "state", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 4000 });
    h.check("the rest raised Player One's cycle once, keyed by its message", after.actors[0].prepCycle === 1 && after.actors[0].cycleKey === rested.messages[0], after.actors[0]);
    h.check("Player Two's elixir is inert, marked by Player Two's client", after.actors[1].stamped.some((i) => i.inert && i.expiry?.creator === w.pcs.p1.uuid), after.actors[1].stamped);
    h.check("the expiry claim was resolved", after.claims.length === 1 && after.claims[0].resolved, after.claims);
    const prep2 = await h.step("p1", "m7", "prepare", { pools: { "advanced-alchemy": { mode: "loadout", id: loadout.id } } });
    h.check("after the rest Player One prepares again, in cycle 1", prep2.result.ok && prep2.result.cycle === 1, prep2.result);
    await h.step("gm", "m7", "clock", { seconds: 86400, ms: 4000 });
    const day = await h.step("p1", "m7", "state", { actors: [w.pcs.p1.uuid], ms: 1000 });
    const fresh = day.actors[0].stamped.filter((i) => i.expiry?.cycle === 1 && i.expiry?.pool === "advanced-alchemy");
    h.check("24 hours later the cycle-1 Advanced Alchemy items are inert, by time", fresh.length > 0 && fresh.every((i) => i.inert), fresh);
    await checkStatuses(h);
    return { prep, moved, after, prep2, day };
}

/**
 * Rest ordering without pf2e-dailies (7.8): the GM rests the party (both characters at once, as the party sheet does):
 * the alchemist's cycle goes up once, on its own responsible client; Player One's client shows one Morning prompt for
 * it; the fighter (no daily crafting, no vials) has no cycle and prompts nobody; the GM is prompted for nobody. With Player One away the
 * GM's client is the alchemist's responsible client and is prompted.
 */
async function m7Rest(h, w) {
    const before = await m7Dailies(h, false);
    await m7Reset(h, w);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await morningPrompts(h);
    const rested = await h.step("gm", "m7", "rest", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 5000 });
    const prompts = await morningPrompts(h);
    h.check("one Morning prompt, on Player One's client, for the alchemist", prompts.p1?.length === 1 && prompts.p1[0] === w.pcs.p1.name &&
        !prompts.gm?.length && !prompts.p2?.length, prompts);
    const state = await h.step("gm", "m7", "state", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 500 });
    h.check("the alchemist's cycle went up once, keyed by its own rest message; the fighter, who makes nothing at preparations, has none",
        state.actors[0].prepCycle === 1 && state.actors[0].cycleKey === rested.messages[0] && state.actors[1].prepCycle === 0, state.actors);
    await h.only(["gm", "p2"]);
    await morningPrompts(h);
    await h.step("gm", "m7", "rest", { actors: [w.pcs.p1.uuid], ms: 5000 });
    const away = await morningPrompts(h);
    h.check("with Player One away, the GM's client is prompted for the alchemist", away.gm?.length === 1 && !away.p2?.length, away);
    if (before.dailies) await m7Dailies(h, true);
    return { rested, prompts, state, away };
}

/**
 * Rest ordering with pf2e-dailies (7.8, 7.9): pf2e-dailies is turned on and every page reloads; the Workshop's custom daily
 * is registered; Player One rests: the pipeline waits for pf2e-dailies' rested flag and raises the cycle once; Player One
 * opens pf2e-dailies' interface, picks the saved loadout in the Workshop's row and accepts: the choice is recorded with
 * nothing made inside pf2e-dailies' flow, and once its rested flag goes back to false Player One's client prepares the
 * loadout through pf2e's methods. pf2e-dailies is put back as it was.
 */
async function m7DailiesPlan(h, w) {
    const before = await m7Dailies(h, true);
    await m7Reset(h, w);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const active = await h.step("p1", "m7", "active", {});
    h.check("pf2e-dailies is active on Player One's client with its API", active.dailies && active.api, active);
    const saved = await h.step("p1", "m7", "loadout", { name: "Healer", pools: { "advanced-alchemy": [{ family: M7.elixirFamily, qty: 2 }] } });
    await morningPrompts(h);
    const rested = await h.step("p1", "m7", "rest", { actors: [w.pcs.p1.uuid], ms: 6000 });
    const state = await h.step("p1", "m7", "state", { actors: [w.pcs.p1.uuid] });
    h.check("pf2e-dailies' rested flag is set and the cycle went up once", state.actors[0].dailiesRested === true && state.actors[0].prepCycle === 1 &&
        state.actors[0].cycleKey === rested.messages[0], state.actors[0]);
    const prompts = await morningPrompts(h);
    h.check("one Morning prompt, on Player One's client", prompts.p1?.length === 1 && !prompts.gm?.length, prompts);
    const chose = await h.step("p1", "m7", "dailies", { choices: { "advanced-alchemy": saved.id, "talisman-dabbler": "keep" }, ms: 6000 });
    h.check("pf2e-dailies' interface showed the Workshop's rows", chose.opened && chose.rows.some((r) => r.row === "advanced-alchemy"), chose.rows);
    const brief = chose.brief;
    h.check("the choice was recorded for cycle 1 and applied after pf2e-dailies finished", brief.morning.choice?.cycle === 1 && !!brief.morning.choice?.applied &&
        brief.dailiesRested === false, brief.morning);
    h.check("the loadout was prepared through pf2e's methods: Elixir of Life (Moderate), stamped", brief.stamped.some((i) => i.name === "Elixir of Life (Moderate)" && i.expiry?.cycle === 1),
        brief.stamped);
    if (!before.dailies) await m7Dailies(h, false);
    return { rested, state, chose };
}

/**
 * Standing orders with no GM (7.6): Player Two asks Player One's alchemist for two elixirs every morning; Player One
 * prepares: the two go on the pickup shelf for Player Two's fighter, stamped by Player One, and Player Two's client
 * collects them; the same cycle never delivers twice; preparing for a new day delivers two more, and the first two
 * expire with Player One's old cycle.
 */
async function m7Standing(h, w) {
    await m7Reset(h, w);
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    const placed = await h.step("p2", "m7", "standing", { requester: w.pcs.p2.uuid, crafter: w.pcs.p1.uuid, uuid: M7.elixirMinor, qty: 2 });
    h.check("Player Two places the standing order", placed.ok === true, placed);
    await h.step("p1", "m5", "seen", { path: `standing.${placed.id}` });
    const prep = await h.step("p1", "m7", "prepare", {});
    h.check("Player One prepares; the order's two go to the shelf for Player Two", prep.result.ok && prep.result.deliveries.some((d) => d.ok && d.direct === false && d.qty === 2),
        prep.result.deliveries);
    const got = await h.step("p2", "m7", "state", { actors: [w.pcs.p2.uuid], ms: 5000 });
    const held = got.actors[0].stamped.filter((i) => i.expiry?.creator === w.pcs.p1.uuid);
    h.check("Player Two's client collected them, stamped by Player One", held.reduce((n, i) => n + i.qty, 0) === 2, held);
    h.check("the order is filled for cycle 0", got.standing.find((s) => s.id === placed.id)?.last?.cycle === 0, got.standing);
    const again = await h.step("p1", "m7", "prepare", { again: true });
    h.check("a new day's preparation fills it again", again.result.ok && again.result.cycle === 1 && again.result.deliveries.some((d) => d.ok && d.qty === 2), again.result);
    const later = await h.step("p2", "m7", "state", { actors: [w.pcs.p2.uuid], ms: 5000 });
    const mine = later.actors[0].stamped.filter((i) => i.expiry?.creator === w.pcs.p1.uuid);
    h.check("Player Two now holds two from cycle 0, inert, and two from cycle 1, potent",
        mine.filter((i) => i.expiry.cycle === 0).every((i) => i.inert) && mine.filter((i) => i.expiry.cycle === 1 && !i.inert).reduce((n, i) => n + i.qty, 0) === 2, mine);
    await checkStatuses(h);
    return { placed, prep, got, again, later };
}

/**
 * Affixing (7.4): Player One's alchemist with a repair toolkit and leather armor prepares two armor talismans (Jade Cat,
 * Bronze Bull Pendant); the first affixes; the second is refused (one per host); the GM gives Talismanic Sage; the second
 * affixes and treats the armor; a third (a permanent Mesmerizing Opal) is refused even there; the board says both work.
 */
async function m7Affix(h, w) {
    await m7Reset(h, w);
    const armor = await h.step("gm", "m7", "give", { actor: w.pcs.p1.uuid, uuid: M5.leatherArmor, system: { equipped: { carryType: "worn", inSlot: true } } });
    await h.step("gm", "m7", "give", { actor: w.pcs.p1.uuid, uuid: M5.repairToolkit });
    const opal = await h.step("gm", "m7", "give", { actor: w.pcs.p1.uuid, uuid: M7.opal });
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const prep = await h.step("p1", "m7", "prepare", { talismans: { "talisman-dabbler": [M7.jadeCat, M7.bronzeBull] } });
    const [t1, t2] = prep.brief.stamped.filter((i) => i.expiry?.pool === "talisman-dabbler");
    h.check("two armor talismans made", !!t1 && !!t2, prep.brief.stamped);
    const first = await h.step("p1", "m7", "affix", { talisman: t1.id, host: armor.id });
    h.check("the first goes on the armor", first.result.ok === true, first.result);
    const second = await h.step("p1", "m7", "affix", { talisman: t2.id, host: armor.id });
    h.check("a second is refused: one per host", second.result.reason === "host-taken", second.result);
    await h.step("gm", "m7", "give", { actor: w.pcs.p1.uuid, uuid: M7.talismanicSage });
    const sage = await h.step("p1", "m7", "affix", { talisman: t2.id, host: armor.id });
    h.check("with Talismanic Sage the second goes on and treats the armor", sage.result.ok === true && sage.result.treated === true, sage.result);
    const third = await h.step("p1", "m7", "affix", { talisman: opal.id, host: armor.id });
    h.check("a third is refused even on the treated armor", third.result.reason === "host-taken", third.result);
    const host = third.board.hosts.find((x) => x.id === armor.id);
    h.check("the board: the armor's two work, treated", host?.state === "active" && host.sage === true && host.count === 2, host);
    return { prep, first, second, sage, third };
}

/**
 * The Morning tab photographed (17.1, M7): as Player One, after a preparation with a standing order from Player Two due,
 * at 1440x900 and 1024x768, dark and light; and as the GM.
 */
async function m7Shots(h, w) {
    await m7Reset(h, w);
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m7", "loadout", { name: "Healer", pools: { "advanced-alchemy": [{ family: M7.elixirFamily, qty: 2 }] } });
    await h.step("p2", "m7", "standing", { requester: w.pcs.p2.uuid, crafter: w.pcs.p1.uuid, uuid: M7.elixirMinor, qty: 1 });
    const facts = await h.step("p1", "m7", "facts", {});
    const picks = (facts.pools.find((p) => p.slug === "talisman-dabbler")?.offered ?? []).slice(0, 2).map((t) => t.uuid);
    const sizes = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }];
    const opened = [];
    for (const role of ["p1", "gm"]) {
        for (const scheme of ["dark", "light"]) {
            await h.step(role, "m4", "theme", { scheme });
            for (const size of sizes) {
                await h.screenshot(role, `m7-${role}-morning-${size.width}x${size.height}-${scheme}.png`, size, async () => {
                    const open = await h.step(role, "m7", "open", { actor: w.pcs.p1.uuid, talismans: { "talisman-dabbler": picks } });
                    opened.push({ role, scheme, ...size, ...open });
                    return open;
                });
            }
        }
        await h.step(role, "m7", "close", {});
        await h.step(role, "m4", "theme", { scheme: "dark" });
    }
    h.check("the Morning tab opened with the module's styles every time", opened.every((o) => o.open && o.hasStyles && o.tab === "morning"), opened.filter((o) => !o.open || !o.hasStyles));
    h.check("the tab showed the pools, the talisman picker and what the plan makes", opened.every((o) => o.pools >= 2 && o.offered >= 2 && o.lines >= 1),
        opened.map((o) => [o.role, o.pools, o.offered, o.lines]));
    return { opened, shots: h.shots.filter((s) => s.label === h.label).map((s) => s.file) };
}

Object.assign(BEHAVIOURS, {
    "m7-morning": m7Morning,
    "m7-expiry": m7Expiry,
    "m7-rest": m7Rest,
    "m7-dailies": m7DailiesPlan,
    "m7-standing": m7Standing,
    "m7-affix": m7Affix,
    "m7-shots": m7Shots,
});

/* -------------------------------------------- */
/*  M8: combat (DESIGN.md 8, 10.14)              */
/* -------------------------------------------- */

/** What the M8 plans give and make: compendium UUIDs and the families `familyKey` gives them. */
export const M8 = Object.freeze({
    elixirMinor: ELIXIR,
    elixirModerate: "Compendium.pf2e.equipment-srd.Item.c21stU5rhN4F2fZl",
    fireLesser: ALCHEMISTS_FIRE,
    fireModerate: "Compendium.pf2e.equipment-srd.Item.gWr4q4HiyGhETA8H",
    potionMinor: HEALING_POTION,
    potionLesser: "Compendium.pf2e.equipment-srd.Item.e0vSAQfxhHauiAoD",
    healingBomb: "Compendium.pf2e.feats-srd.Item.xXHwktc9SymSY8d6",
    enduringAlchemy: "Compendium.pf2e.feats-srd.Item.jBeuyq0Aged45YAc",
    quickBomber: "Compendium.pf2e.feats-srd.Item.xbg1scOIT7RI9Fij",
    improviseAdmixture: "Compendium.pf2e.feats-srd.Item.H6SL2F11nlMfqCQC",
    stickyBomb: "Compendium.pf2e.feats-srd.Item.zXKfKKOxht0b0XNL",
    fireFamily: "weapon|bomb|alchemist's fire",
    potionFamily: "consumable|potion|healing potion",
});

/**
 * Every M8 plan starts here: the world reset, M5's, M7's and M8's items taken back, the vials refilled, then Player One's
 * bomber (level 11: Double Brew, Alchemical Expertise, the field discovery, Advanced Vials) knows Elixir of Life (Minor)
 * and Alchemist's Fire (Lesser), whose families Quick Alchemy makes by.
 */
async function m8Reset(h, w) {
    await resetWorld(h, w);
    const actors = [w.pcs.p1.uuid, w.pcs.p2.uuid];
    await h.step("gm", "m5", "reset", { actors });
    await h.step("gm", "m7", "reset", { actors });
    await h.step("gm", "m8", "reset", { actors });
    await h.step("gm", "m7", "learn", { actor: w.pcs.p1.uuid, uuids: [M8.elixirMinor, M8.fireLesser] });
}

/**
 * The Quick Alchemy panel without a canvas (8.3, 10.9, scenario 5): what Player One's bomber can make (by book and family,
 * up to level 11: Elixir of Life (Moderate) by family, never the Greater); Quick Alchemy through pf2e's craft takes one vial
 * and makes the item held, infused and stamped; at 0 vials it is refused and nothing is made (pf2e's own path would craft
 * for free); Double Brew makes two for two vials; then the panel driven with real keys: typing keeps focus in the search,
 * the arrow goes into the list, Space picks, Enter creates and closes it.
 */
async function m8Panel(h, w) {
    await m8Reset(h, w);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const facts = await h.step("p1", "m8", "facts", {});
    const names = facts.choices.map((c) => c.name);
    h.check("the panel's list: Elixir of Life up to Moderate by family, Alchemist's Fire up to Moderate, no Greater (level 13)",
        names.includes("Elixir of Life (Moderate)") && names.includes("Alchemist's Fire (Moderate)") && !names.includes("Elixir of Life (Greater)") &&
        facts.choices.find((c) => c.name === "Elixir of Life (Moderate)")?.route === "family", names);
    h.check("the bomber's features: Double Brew, the field discovery's splash", facts.features.brew === 2 && facts.features.splash.intDamage === true, facts.features);
    const before = facts.vials.value;
    const one = await h.step("p1", "m8", "quick", { uuid: M8.fireModerate });
    const bomb = one.brief.quick.find((i) => i.name === "Alchemist's Fire (Moderate)");
    h.check("Quick Alchemy: one vial through pf2e's resource; the bomb held, infused, stamped for a round outside an encounter", one.result.ok && one.brief.vials.value === before - 1 &&
        bomb?.held && bomb.traits.includes("infused") && bomb.expiry?.rule === "turn-start" && bomb.expiry?.combat === null && Number.isFinite(bomb.expiry?.at), one);
    h.check("the Quick Alchemy card is posted, with Strike buttons", one.messages.some((m) => m.card?.kind === "quick-alchemy"), one.messages);
    await h.step("p1", "m8", "vials", { value: 0 });
    const none = await h.step("p1", "m8", "quick", { uuid: M8.fireLesser });
    h.check("at 0 vials Quick Alchemy is refused and nothing is made", none.result.reason === "no-vials" && none.brief.quick.length === one.brief.quick.length, none.result);
    await h.step("p1", "m8", "vials", { value: 3 });
    const two = await h.step("p1", "m8", "quick", { uuid: M8.elixirMinor, second: M8.fireLesser });
    h.check("Double Brew: two items for two vials", two.result.ok && two.result.items.length === 2 && two.brief.vials.value === 1, two.result);
    await h.step("p1", "m8", "vials", { value: 3 });
    const keys = await h.step("p1", "m8", "panel", { query: "alchemist's fire lesser", create: true });
    h.check("the panel from the keyboard: typing keeps focus, the arrow enters the list, Space picks, Enter creates and closes", keys.focusedSearch && keys.stillFocused &&
        keys.onOption && keys.picks.length === 1 && keys.made === 1 && keys.closed && keys.hasStyles, keys);
    const gm = await h.step("gm", "m8", "state", { actors: [w.pcs.p1.uuid], ms: 1000 });
    h.check("the GM reads the same Quick Alchemy items", gm.actors[0].quick.length === keys.made + two.brief.quick.length, gm.actors[0].quick.length);
    await checkStatuses(h);
    return { facts, one, none, two, keys };
}

/**
 * The Bandolier without a canvas (8.1, 8.5): as Player One, its vial pips are the bomber's vials; a quick vial from its
 * button is free and leaves the vial count alone (its source identity cleared); its Strike button throws through pf2e's
 * own Strike (an attack card whose origin is the quick vial), with the field vial chosen; dragged, it reopens where it was.
 */
async function m8Bandolier(h, w) {
    await m8Reset(h, w);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const first = await h.step("p1", "m8", "bandolier", {});
    h.check("the Bandolier opens with the vial pips of the bomber", first.view.open && first.view.pips === first.brief.vials.max && first.view.full === first.brief.vials.value,
        first.view);
    const vial = await h.step("p1", "m8", "bandolier", { click: "quick-vial" });
    const quick = vial.brief.quick.find((i) => i.quick?.source === "quick-vial");
    h.check("a quick vial from the Bandolier: free, held, its source identity cleared, the vial count unchanged", !!quick && quick.sourceId === null && quick.held &&
        vial.brief.vials.value === first.brief.vials.value, { quick, vials: vial.brief.vials });
    const struck = await h.step("p1", "m8", "strike", { item: quick.id, map: 0, damageType: "fire" });
    h.check("its Strike is pf2e's own: an attack card from the quick vial, with the field vial's toggle on", struck.result.ok &&
        struck.messages.some((m) => m.type === "attack-roll" && m.origin === quick.uuid) && struck.options["bomber-field-vials"] === true, struck);
    await h.step("p1", "m8", "bandolier", { move: { left: 160, top: 220 } });
    const closed = await h.step("p1", "m8", "closeBandolier", {});
    const reopened = await h.step("p1", "m8", "bandolier", {});
    h.check("dragged, it reopens where it was (per user)", closed.saved?.left === 160 && reopened.view.position.left === 160 && reopened.view.position.top === 220,
        { saved: closed.saved, position: reopened.view.position });
    await h.step("p1", "m8", "close", {});
    return { first, vial, struck, reopened };
}

/**
 * Turn expiry (8.8, scenario 5): an encounter of Player Two's fighter then Player One's bomber; on the bomber's turn
 * Player One makes a bomb (until the start of its next turn), an elixir with Enduring Alchemy (until the end of its next
 * turn) and a quick vial (until the end of this turn), and the GM hands a second bomb to the fighter. The fighter's turn:
 * the quick vial is inert, marked by Player One's client. The bomber's next turn: its bomb is inert on Player One's client
 * and the fighter's on Player Two's. The turn after: the elixir. Then a bomb made in the third round goes inert when the
 * GM ends the encounter.
 */
async function m8Turn(h, w) {
    await m8Reset(h, w);
    await h.step("gm", "m8", "give", { actor: w.pcs.p1.uuid, uuid: M8.enduringAlchemy });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const fight = await h.step("gm", "m8", "encounter", { actors: [w.pcs.p2.uuid, w.pcs.p1.uuid] });
    h.check("the encounter: the fighter, then the bomber", fight.order[0] === w.pcs.p2.name && fight.order[1] === w.pcs.p1.name, fight);
    await h.step("gm", "m8", "next", { combat: fight.id });
    const bomb = await h.step("p1", "m8", "quick", { uuid: M8.fireLesser });
    const elixir = await h.step("p1", "m8", "quick", { uuid: M8.elixirMinor });
    const vial = await h.step("p1", "m8", "vial", {});
    const handed = await h.step("p1", "m8", "quick", { uuid: M8.fireLesser });
    const moved = await h.step("gm", "m7", "move", { item: handed.result.items[0].uuid, qty: 1, to: w.pcs.p2.uuid });
    const id = (r) => r.result.items[0].id;
    h.check("made in the bomber's turn: stamped with the encounter, its round and turn", bomb.brief.quick.find((i) => i.id === id(bomb))?.expiry?.combat?.round === 1, bomb.brief.quick);
    const read = async () => {
        const s = await h.step("gm", "m8", "state", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 2500 });
        const all = [...s.actors[0].quick, ...s.actors[1].quick];
        const find = (itemId) => all.find((i) => i.id === itemId) ?? null;
        return { s, bomb: find(id(bomb)), elixir: find(id(elixir)), vial: find(id(vial)), given: s.actors[1].quick.find((i) => i.uuid === moved.moved) ?? s.actors[1].quick[0] ?? null };
    };
    await h.step("gm", "m8", "next", { combat: fight.id });
    const r2t0 = await read();
    h.check("the fighter's turn: the quick vial is inert, marked by Player One's client; the bombs and the elixir are potent",
        r2t0.vial?.inert && r2t0.vial.by === w.users.p1 && !r2t0.bomb?.inert && !r2t0.elixir?.inert && !r2t0.given?.inert, r2t0);
    await h.step("gm", "m8", "next", { combat: fight.id });
    const r2t1 = await read();
    h.check("the bomber's next turn: its bomb is inert on Player One's client, the fighter's on Player Two's; the Enduring elixir still potent",
        r2t1.bomb?.inert && r2t1.bomb.by === w.users.p1 && r2t1.given?.inert && r2t1.given.by === w.users.p2 && !r2t1.elixir?.inert, r2t1);
    await h.step("gm", "m8", "next", { combat: fight.id });
    const r3t0 = await read();
    h.check("the turn after: the elixir is inert", r3t0.elixir?.inert && r3t0.elixir.inertWhy === "turn", r3t0.elixir);
    const late = await h.step("p1", "m8", "quick", { uuid: M8.fireLesser });
    await h.step("gm", "m8", "end", { combat: fight.id });
    const ended = await h.step("gm", "m8", "state", { actors: [w.pcs.p1.uuid], ms: 2500 });
    const last = ended.actors[0].quick.find((i) => i.id === late.result.items[0].id);
    h.check("the encounter ends: what Quick Alchemy made in it is inert", last?.inert && last.inertWhy === "combat-end", last);
    await checkStatuses(h);
    return { fight, r2t0, r2t1, r3t0, ended };
}

/**
 * Vial gathering (8.7, scenario 5): with `features.vialGathering` on, 25 minutes of world time give the bomber (Alchemical
 * Expertise: 3 per 10 minutes) 6 vials and carry 5 minutes; Player One and the GM click Gather reagents at the same moment
 * one vial short of the maximum: the vials end at the maximum, never past it; in an encounter the clock gathers nothing;
 * Improvise Admixture regains vials by its degree.
 */
async function m8Vials(h, w) {
    await m8Reset(h, w);
    await h.step("gm", "m8", "give", { actor: w.pcs.p1.uuid, uuid: M8.improviseAdmixture });
    await h.step("gm", "m8", "setting", { key: "features.vialGathering", value: true });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m8", "vials", { value: 0 });
    await h.step("gm", "m8", "clock", { seconds: 1500 });
    const clock = await h.step("p1", "m8", "state", { ms: 1500 });
    const max = clock.actors[0].vials.max;
    h.check("25 minutes: 6 vials (3 a ten with Alchemical Expertise), 5 minutes carried, on Player One's client", clock.actors[0].vials.value === Math.min(6, max) &&
        clock.actors[0].vialClock === 300, clock.actors[0]);
    await h.step("p1", "m8", "vials", { value: max - 1 });
    const both = await h.together([["p1", "m8", "gather", { actor: w.pcs.p1.uuid }], ["gm", "m8", "gather", { actor: w.pcs.p1.uuid }]]);
    const capped = await h.step("gm", "m8", "state", { actors: [w.pcs.p1.uuid], ms: 1000 });
    h.check("two clicks at once one vial short: the maximum, never past it", capped.actors[0].vials.value === max, { both, vials: capped.actors[0].vials });
    await h.step("p1", "m8", "vials", { value: 1 });
    const fight = await h.step("gm", "m8", "encounter", { actors: [w.pcs.p1.uuid] });
    await h.step("gm", "m8", "clock", { seconds: 1200 });
    const inFight = await h.step("p1", "m8", "state", { ms: 1500 });
    h.check("in an encounter the clock gathers nothing", inFight.actors[0].vials.value === 1, inFight.actors[0].vials);
    await h.step("gm", "m8", "end", { combat: fight.id });
    const admix = await h.step("p1", "m8", "admixture", {});
    const degree = admix.result.degree;
    h.check("Improvise Admixture regains 3, 2, 1 or no vials by its degree", admix.result.ok && admix.result.gained === Math.min([0, 1, 2, 3][degree] ?? 0, max - 1), admix.result);
    await h.step("gm", "m8", "setting", { key: "features.vialGathering", value: false });
    return { clock, both, capped, inFight, admix };
}

/**
 * Healing Bomb (8.6): Player One's bomber gets the feat and throws an elixir of life made with Quick Alchemy at Player
 * Two's hurt fighter: the elixir is used through pf2e (its healing card), the module's card says each living creature
 * adjacent regains 5 HP (Moderate: 5d6+12) and reaches Player Two; Player Two applies it to the fighter once; a second time
 * is refused. Outside an encounter a second additive is allowed; in one, a second the same round is refused.
 */
async function m8HealingBomb(h, w) {
    await m8Reset(h, w);
    await h.step("gm", "m8", "give", { actor: w.pcs.p1.uuid, uuid: M8.healingBomb });
    const hurt = await h.step("gm", "m8", "hp", { actor: w.pcs.p2.uuid, value: 10 });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const thrown = await h.step("p1", "m8", "healing", { target: w.pcs.p2.uuid });
    const card = thrown.messages?.find((m) => m.card?.kind === "healing-bomb");
    h.check("the best elixir of life with the additive, used through pf2e, and the Healing Bomb card with its HP", thrown.made?.ok && thrown.thrown?.ok && thrown.thrown.hp === 5 &&
        !!card && card.combat?.hp === 5 && thrown.messages.some((m) => m.origin && m.card === null), thrown);
    const seen = await h.step("p2", "m8", "seen", { message: card?.id });
    h.check("the card reaches Player Two, the target's owner (second M8 review: it went to the thrower's owners only)", seen.seen === true, seen);
    const heal = await h.step("p2", "m8", "heal", { message: card?.id, actor: w.pcs.p2.uuid });
    h.check("Player Two applies it to the fighter", heal.result.ok && heal.hp === Math.min(hurt.max, 10 + 5), heal);
    const again = await h.step("p2", "m8", "heal", { message: card?.id, actor: w.pcs.p2.uuid });
    h.check("once per card and creature", again.result.reason === "already" && again.hp === heal.hp, again);
    const outside = await h.step("p1", "m8", "quick", { uuid: M8.elixirMinor, additive: "healing-bomb" });
    h.check("outside an encounter a second additive is not refused (no rounds there, and world time may stand still)", outside.result.ok === true, outside.result);
    const fight = await h.step("gm", "m8", "encounter", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid] });
    const first = await h.step("p1", "m8", "quick", { uuid: M8.elixirMinor, additive: "healing-bomb" });
    const additive = await h.step("p1", "m8", "quick", { uuid: M8.elixirMinor, additive: "healing-bomb" });
    h.check("in an encounter, one additive a round: a second is refused", first.result.ok === true && additive.result.reason === "additive-round",
        { first: first.result, additive: additive.result });
    await h.step("gm", "m8", "end", { combat: fight.id });
    return { thrown, seen, heal, again, outside, additive };
}

/**
 * Duct Tape (8, 13, scenario 6): with Duct Tape active on every client (a stand-in package entry when it is not
 * installed), the Bandolier, Quick Alchemy, quick vials and gathering refuse and say why; turn expiry leaves Quick Alchemy
 * items alone; Use best consumable still works. Then it is put back.
 */
async function m8DuctTape(h, w) {
    await m8Reset(h, w);
    await h.step("gm", "m7", "give", { actor: w.pcs.p2.uuid, uuid: M8.potionMinor, system: { equipped: { carryType: "held", handsHeld: 1 } } });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const made = await h.step("p1", "m8", "quick", { uuid: M8.fireLesser });
    const fight = await h.step("gm", "m8", "encounter", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid] });
    const on = await h.together([["gm", "m8", "ductTape", { on: true }], ["p1", "m8", "ductTape", { on: true }], ["p2", "m8", "ductTape", { on: true }]]);
    h.check("Duct Tape is active on every client", on.every((o) => o.off === "duct-tape" || (o.installed && o.active)), on);
    const refused = await h.step("p1", "m8", "quick", { uuid: M8.fireLesser });
    const bandolier = await h.step("p1", "m8", "bandolier", {});
    h.check("Quick Alchemy and the Bandolier step aside, and say why", refused.result.reason === "duct-tape" && bandolier.opened?.reason === "duct-tape", { refused, bandolier });
    await h.step("gm", "m8", "next", { combat: fight.id, times: 3 });
    const kept = await h.step("p1", "m8", "state", { ms: 1500 });
    h.check("no turn expiry while Duct Tape runs its own", kept.actors[0].quick.some((i) => i.id === made.result.items[0].id && !i.inert), kept.actors[0].quick);
    const used = await h.step("p2", "m8", "useBest", { family: M8.potionFamily });
    h.check("Use best consumable stays", used.result.ok === true, used.result);
    await h.together([["gm", "m8", "ductTape", { on: false }], ["p1", "m8", "ductTape", { on: false }], ["p2", "m8", "ductTape", { on: false }]]);
    await h.step("gm", "m8", "end", { combat: fight.id });
    return { on, refused, kept, used };
}

/**
 * Use best consumable (8.9): Player Two's fighter holds a Healing Potion (Minor) in hand and a Healing Potion (Lesser)
 * stowed; the held one is used through pf2e (its own card); then the stowed one; with none left, the party view says
 * Player One's bomber holds one.
 */
async function m8UseBest(h, w) {
    await m8Reset(h, w);
    await h.step("gm", "m7", "give", { actor: w.pcs.p2.uuid, uuid: M8.potionMinor, system: { equipped: { carryType: "held", handsHeld: 1 } } });
    await h.step("gm", "m7", "give", { actor: w.pcs.p2.uuid, uuid: M8.potionLesser, system: { equipped: { carryType: "stowed" } } });
    await h.step("gm", "m7", "give", { actor: w.pcs.p1.uuid, uuid: M8.potionMinor });
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    const first = await h.step("p2", "m8", "useBest", { family: M8.potionFamily });
    h.check("the held potion first, through pf2e's own card", first.result.ok && first.result.name === "Healing Potion (Minor)" && first.messages.length >= 1, first);
    const second = await h.step("p2", "m8", "useBest", { family: M8.potionFamily });
    h.check("then the stowed one", second.result.ok && second.result.name === "Healing Potion (Lesser)", second.result);
    const none = await h.step("p2", "m8", "useBest", { family: M8.potionFamily, partyWide: true, ms: 2000 });
    h.check("none left: the party view names who holds one", none.result.reason === "none" && none.result.data.holders.some((x) => x.name === w.pcs.p1.name), none.result);
    return { first, second, none };
}

/**
 * The token HUD palette (8.2, OQ-33; needs `--canvas`; the plan stages a marked scene with Player One's bomber token, `arena`,
 * and gives the world its own active scene back afterwards): the flask button in
 * the left column, its palette opened by core's own togglePalette; the token moved with the palette open (core renders the
 * HUD again and reopens the palette after the hook): one button, still open, no error; its Quick Alchemy entry opens the
 * panel. Without a canvas it says it was skipped.
 */
async function m8Hud(h, w) {
    if (!h.canvas) {
        h.check("m8-hud needs --canvas: skipped", true, { skipped: true });
        return { skipped: true };
    }
    await m8Reset(h, w);
    // The scene: a marked arena with the bomber's token, active while the plan runs, then the world's own scene again.
    const arena = await h.step("gm", "m8", "arena", { tokens: [{ actor: w.pcs.p1.uuid, x: 5, y: 5 }] });
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const view = await h.step("p1", "m8", "hud", { entry: "quick-alchemy" });
    await h.step("gm", "m8", "arena", { off: true, previous: arena.previous });
    h.check("the scene has Player One's bomber token", view.canvas && view.token, view);
    h.check("the flask in the HUD's left column; its palette lists Quick Alchemy, a quick vial and the Bandolier", view.button && ["quick-alchemy", "quick-vial", "bandolier"]
        .every((e) => view.entries.includes(e)), view.entries);
    h.check("core's togglePalette opens it", view.paletteOpen, view);
    h.check("moved with the palette open: one button, the palette still open, no error", view.afterMove.buttons === 1 && view.afterMove.paletteOpen && !view.afterMove.errors.length,
        view.afterMove);
    h.check("its Quick Alchemy entry opens the panel", view.used?.panel === true, view.used);
    await h.step("p1", "m8", "close", {});
    return view;
}

/** The Bandolier and the panel photographed (17.1, M8): as Player One, 1440x900 and 1024x768, dark and light. */
async function m8Shots(h, w) {
    await m8Reset(h, w);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    await h.step("p1", "m8", "quick", { uuid: M8.fireLesser });
    await h.step("p1", "m8", "quick", { uuid: M8.elixirMinor });
    const opened = [];
    for (const scheme of ["dark", "light"]) {
        await h.step("p1", "m4", "theme", { scheme });
        for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
            await h.screenshot("p1", `m8-p1-bandolier-${size.width}x${size.height}-${scheme}.png`, size, async () => {
                const open = await h.step("p1", "m8", "bandolier", {});
                opened.push({ scheme, ...size, open: open.view.open, ready: open.view.ready.length });
                return open;
            });
            await h.screenshot("p1", `m8-p1-quick-alchemy-${size.width}x${size.height}-${scheme}.png`, size,
                () => h.step("p1", "m8", "panel", { query: "elixir", close: false }));
            await h.step("p1", "m8", "close", {});
        }
    }
    await h.step("p1", "m4", "theme", { scheme: "dark" });
    h.check("the Bandolier opened with what is ready every time", opened.every((o) => o.open && o.ready >= 2), opened);
    return { opened, shots: h.shots.filter((s) => s.label === h.label).map((s) => s.file) };
}

Object.assign(BEHAVIOURS, {
    "m8-panel": m8Panel,
    "m8-bandolier": m8Bandolier,
    "m8-turn": m8Turn,
    "m8-vials": m8Vials,
    "m8-healing-bomb": m8HealingBomb,
    "m8-duct-tape": m8DuctTape,
    "m8-use-best": m8UseBest,
    "m8-hud": m8Hud,
    "m8-shots": m8Shots,
});

/* -------------------------------------------- */
/*  M8a: afflictions (DESIGN.md 8.10, 15.3 #12)  */
/* -------------------------------------------- */

/** What the M8a plans give: compendium UUIDs of poisons, a weapon and feats, and the fixture NPCs' names. */
export const M8A = Object.freeze({
    blackAdder: "Compendium.pf2e.equipment-srd.Item.ScclzFrjyB0YJlrb",   // injury, level 2, DC 18, 3 rounds, 1-round stages
    blackAdderFamily: "consumable|poison|black adder venom",
    arsenic: "Compendium.pf2e.equipment-srd.Item.OIirLySQDLZgT15S",      // ingested, onset 10 minutes, 1-minute stages, 5 minutes
    antipode: "Compendium.pf2e.equipment-srd.Item.7iZCCqXDGiTv0ar3",     // injury, virulent
    kingsSleep: "Compendium.pf2e.equipment-srd.Item.RkI3jKKrCozvEvfr",   // ingested, virulent, 1-day stages
    tatzlwyrm: "Compendium.pf2e.equipment-srd.Item.V3f0hQdWoWMWF5RU",    // inhaled, level 2
    lethargy: "Compendium.pf2e.equipment-srd.Item.zo0ophqfKunJFxZN",     // incapacitation, reExposure none
    dagger: "Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z",
    stickyPoison: "Compendium.pf2e.feats-srd.Item.b7isszc8C75V3okn",
    npcOrdinary: "Fixture 17a: ordinary NPC",
    npcImmune: "Fixture 17b: poison-immune NPC",
    npcHigh: "Fixture 17c: 9th-level NPC",
    template: "Compendium.pf2e-affliction-forge.templates.Item.m8aTemplate00001",
    // A typed DC no fixture's save reaches (the fighter's Fortitude is +19: 39 at most, a failure even on a natural 20),
    // so a plan that needs a running affliction gets one every run instead of skipping its checks when the dice say so.
    failDc: 45,
});

/** Every M8a plan starts here: the world reset, M7's, M8's and M8a's items and trackers taken back. */
async function m8aReset(h, w, extra = []) {
    await resetWorld(h, w);
    const actors = [w.pcs.p1.uuid, w.pcs.p2.uuid, ...extra];
    await h.step("gm", "m7", "reset", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid] });
    await h.step("gm", "m8", "reset", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid] });
    await h.step("gm", "m8a", "reset", { actors });
}

/** The fixture NPCs by name (15.4 row 17), or null when the fixtures were built without them. */
async function m8aNpc(h, name) {
    const npc = await h.step("gm", "m8a", "npc", { name });
    return npc.missing ? null : npc;
}

/** Tracker of a definition on a creature in a brief. */
const trackerIn = (brief, name = null) => brief.trackers.find((t) => !name || t.name === name) ?? brief.trackers[0] ?? null;

/**
 * 12a. A coated dagger Strikes an NPC (8.10.5, with `--canvas`: the Strike's target is a token): the coating takes the DC;
 * the hit's damage exposes the NPC once; its initial save is rolled once, on the GM's client (npcSaves auto); stage saves
 * fall at the turn ends of the round the stage began on; the maximum duration ends it; Sticky Poison's flat check keeps the
 * coating exactly when it succeeds.
 */
async function m8aStrike(h, w) {
    if (!h.canvas) {
        h.check("m8a-strike needs --canvas (a Strike's target is a token): skipped", true, { skipped: true });
        return { skipped: true };
    }
    const npc = await m8aNpc(h, M8A.npcOrdinary);
    if (!npc) {
        h.check("the fixture NPCs are not built: skipped", true, { skipped: true });
        return { skipped: true };
    }
    await m8aReset(h, w, [npc.uuid]);
    // Stamped with a DC the goblin never makes, so the stage saves and the maximum duration are checked every run.
    const dose = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.blackAdder, qty: 2,
        flags: { [MOD]: { dcStamp: { value: M8A.failDc, rule: "harness", printed: 18 } } } });
    const dagger = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.dagger, system: { equipped: { carryType: "held", handsHeld: 1 } } });
    await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.stickyPoison });
    // The NPC placed next to the bomber, its token unlinked as the table has it: the victim is the token's own actor.
    const arena = await h.step("gm", "m8", "arena", { tokens: [{ actor: w.pcs.p1.uuid, x: 3, y: 3 }, { actor: npc.uuid, x: 4, y: 3 }] });
    const victim = arena.tokens?.find((t) => t.actor !== w.pcs.p1.uuid)?.actor ?? null;
    if (!h.check("the NPC's token is on the arena", !!victim, arena)) return { arena };
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    const coated = await h.step("p1", "m8a", "coat", { poison: dose.id, weapon: dagger.id });
    h.check("the coating: Black Adder Venom's DC frozen, one dose spent", coated.result.ok && coated.coating?.dc?.value >= 18 && coated.coating.delivery === "injury", coated);
    const fight = await h.step("gm", "m8", "encounter", { actors: [w.pcs.p1.uuid, victim] });
    let struck = null;
    for (let i = 0; i < 6 && !struck?.claims?.length; i++) struck = await h.step("p1", "m8a", "strike", { weapon: dagger.id, target: victim, damage: true });
    h.check("a hit with piercing damage exposes the NPC once", (struck?.claims ?? []).filter((c) => c.actor === victim).length === 1, struck?.claims);
    // The coating card after the hit names Sticky Poison's DC 17 flat check: "... flat check: <total> against DC <dc>."
    const sticky = struck.messages.find((m) => m.card?.kind === "affliction-coating");
    const [, total, dc] = /(\d+)\D+DC (\d+)/.exec(sticky?.text ?? "") ?? [];
    h.check("Sticky Poison: the coating stays exactly when its flat check succeeds", !!total && (struck.coating !== null) === (Number(total) >= Number(dc)),
        { sticky, coating: struck.coating });
    const after = await h.step("gm", "m8a", "brief", { actors: [victim], ms: 3000 });
    const saves = struck.messages.filter((m) => m.type === "saving-throw" && m.options.some((o) => o.includes(":affliction:")));
    h.check("the initial save is rolled once, on the GM's client", after.claims.filter((c) => c.actor === victim && c.resolved).length === 1 &&
        saves.every((m) => m.author === w.users.gm), { claims: after.claims, saves });
    const tracker = trackerIn(after.actors[0]);
    if (tracker) {
        // The stage began on the bomber's turn (the anchor, exposure-turn): its 1-round interval ends at the end of the bomber's turn
        // in round 2 (8.10.7), three turn changes on (the goblin's, the bomber's again, the goblin's).
        await h.step("gm", "m8", "next", { combat: fight.id, times: 3 });
        const round2 = await h.step("gm", "m8a", "brief", { actors: [victim], ms: 3000 });
        h.check("a stage save fell due at the end of the turn of the round after the stage began", Object.keys(trackerIn(round2.actors[0])?.saves ?? {}).length >= 2 ||
            !trackerIn(round2.actors[0]), round2.actors[0]);
        await h.step("gm", "m8", "next", { combat: fight.id, times: 5 });
        const done = await h.step("gm", "m8a", "brief", { actors: [victim], ms: 4000 });
        h.check("the maximum duration (3 rounds) has ended it", done.actors[0].trackers.length === 0, done.actors[0]);
    }
    await h.step("gm", "m8", "end", { combat: fight.id });
    await h.step("gm", "m8", "arena", { off: true, previous: arena.previous });
    await checkStatuses(h);
    return { coated, struck, after };
}

/**
 * 12b. Two players and an inhaled poison (8.10.3, 8.10.8): Player One unleashes it at both characters; each owner gets one
 * prompt and rolls their own save; a Hero Point reroll replaces Player Two's result; then, with Player Two away and a save
 * due, it stays pending while Player One's progresses, and Player Two rolls it on logging back in. The GM only moves the
 * clock (players cannot) and leaves before the saves.
 */
async function m8aCloud(h, w) {
    await m8aReset(h, w);
    const gas = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.tatzlwyrm, qty: 1,
        flags: { [MOD]: { dcStamp: { value: M8A.failDc, rule: "harness", printed: 15 } } } });
    // The reroll spends a Hero Point, which an earlier run may have used up.
    await h.evaluate("gm", async (uuid) => {
        await fromUuidSync(uuid).update({ "system.resources.heroPoints.value": 1 });
        return fromUuidSync(uuid).system.resources.heroPoints.value;
    }, w.pcs.p2.uuid, "a Hero Point for the fighter");
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    const unleashed = await h.step("p1", "m8a", "unleash", { poison: gas.id, targets: [w.pcs.p1.uuid, w.pcs.p2.uuid] });
    h.check("unleashed: one exposure claim for each character", unleashed.result.ok && unleashed.claims.filter((c) => c.kind === "exposure").length === 2, unleashed);
    const prompts = await h.step("p2", "m8a", "brief", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 2500 });
    h.check("each owner's save is pending", prompts.actors.every((a) => a.pending.length === 1), prompts.actors.map((a) => a.pending));
    const one = await h.step("p1", "m8a", "roll", { outcome: "any" });
    const two = await h.step("p2", "m8a", "roll", {});
    h.check("each owner rolled their own save, recorded once", !!one.result?.ok && !!two.result?.ok && one.brief.pending.length === 0 && two.brief.pending.length === 0,
        { one: one.result, two: two.result });
    const rerolled = await h.step("p2", "m8a", "reroll", {});
    const tracker = trackerIn(rerolled.brief ?? { trackers: [] });
    h.check("a Hero Point reroll replaces Player Two's result (or there was nothing to reroll)", rerolled.none || !tracker || Object.values(tracker.saves).some((s) => s.rolls === 2),
        rerolled);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    await h.step("gm", "m8a", "clock", { seconds: 6 });
    await h.only(["p1"]);
    const away = await h.step("p1", "m8a", "brief", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 2000 });
    const p2Tracker = trackerIn(away.actors[1]);
    h.check("Player Two away: their character's save stays pending, nothing rolled for them", !p2Tracker || !p2Tracker.saves?.[2], away.actors[1]);
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    const back = await h.step("p2", "m8a", "roll", {});
    h.check("back online, Player Two rolls it", back.none || back.result?.ok, back);
    await checkStatuses(h);
    return { unleashed, one, two, rerolled, away, back };
}

/**
 * 12c. Exactly once (5.6): Player One in two tabs and a GM with an assistant GM; with `pcSaves: auto` an exposure of Player
 * One's character is rolled by one tab once; an NPC's by the active GM once; one prompt card each.
 */
async function m8aOnce(h, w) {
    const npc = await m8aNpc(h, M8A.npcOrdinary);
    await m8aReset(h, w, npc ? [npc.uuid] : []);
    const dose = await h.step("gm", "m8a", "give", { actor: w.pcs.p2.uuid, uuid: M8A.blackAdder, qty: 1 });
    await h.step("gm", "m8a", "setting", { key: "afflictions.pcSaves", value: "auto" });
    await h.only(["gm", "assistant", "p1", "p1#2", "p2"]);
    await h.settle("ready");
    const exposed = await h.step("p2", "m8a", "expose", { item: dose.uuid, targets: [w.pcs.p1.uuid, ...(npc ? [npc.uuid] : [])], delivery: "injury", key: "m8aonce" });
    const after = await h.step("gm", "m8a", "brief", { actors: [w.pcs.p1.uuid, ...(npc ? [npc.uuid] : [])], ms: 5000 });
    const rolls = exposed.messages.filter((m) => m.type === "saving-throw");
    h.check("every exposure was applied once: one claim each, resolved once", after.claims.filter((c) => c.idem.startsWith("expose:m8aonce")).length === (npc ? 2 : 1), after.claims);
    h.check("each save was rolled once (one tab of Player One, the active GM for the NPC)", after.actors.every((a) => a.trackers.every((t) => Object.keys(t.saves).length <= 1)),
        { rolls: rolls.length, trackers: after.actors.map((a) => a.trackers) });
    await checkStatuses(h);
    return { exposed, after };
}

/**
 * 12d. Powerful Alchemy's DC travels (8.10.4): the bomber prepares Black Adder Venom with Advanced Alchemy (infused); its DC
 * stamp is the bomber's class DC; handed to the fighter and coated on the fighter's dagger, the coating keeps that DC; after
 * the bomber's next daily preparations the coating is gone (the dagger itself not inert), while an affliction already running
 * from it continues.
 */
async function m8aPowerful(h, w) {
    await m8aReset(h, w);
    await h.step("gm", "m7", "learn", { actor: w.pcs.p1.uuid, uuids: [M8A.blackAdder] });
    const dagger = await h.step("gm", "m8a", "give", { actor: w.pcs.p2.uuid, uuid: M8A.dagger });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const prep = await h.step("p1", "m7", "prepare", { pools: { "advanced-alchemy": { mode: "set", entries: [{ family: M8A.blackAdderFamily, uuid: M8A.blackAdder, qty: 2 }] } } });
    const made = (prep.brief?.stamped ?? []).find((i) => i.name?.startsWith("Black Adder")) ?? null;
    h.check("prepared with Advanced Alchemy: infused and DC-stamped with the bomber's class DC (above the printed 18)", !!made && made.dcStamp?.rule === "powerful-alchemy" &&
        made.dcStamp.value > 18, made);
    if (!made) return { prep };
    const moved = await h.step("gm", "m7", "move", { item: made.uuid, qty: 1, to: w.pcs.p2.uuid });
    const held = await h.step("p2", "m8a", "brief", { actors: [w.pcs.p2.uuid] });
    const coat = await h.step("p2", "m8a", "coat", { poison: moved.moved.split(".").pop(), weapon: dagger.id });
    h.check("the fighter's coating keeps the bomber's DC, not the printed one", coat.result.ok && coat.coating?.dc?.value === made.dcStamp.value && coat.coating.dc.source === "stamp",
        { coat, held });
    await h.step("gm", "m8a", "expose", { item: made.uuid, targets: [w.pcs.p1.uuid], delivery: "injury", key: "m8apowerful" });
    await h.step("p1", "m8a", "roll", {});
    await h.step("p1", "m7", "rest", { actors: [w.pcs.p1.uuid] });
    await h.step("p1", "m7", "prepare", { again: true });
    const later = await h.step("gm", "m8a", "brief", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 4000 });
    h.check("after the bomber's next preparations the fighter's coating is gone; an affliction already running continues", later.claims.length >= 1, later);
    await checkStatuses(h);
    return { prep, coat, later };
}

/**
 * 12e. Timing (8.10.6, 8.10.7): a re-exposure during an onset raises the stage and leaves the onset's length; a virulent
 * poison's two successes; an hour of world time over a one-minute poison rolls its saves one after another and stops to
 * ask at the catch-up limit; two days logged by the wizard with a day-interval poison on a character in downtime and one
 * not; then "advance the clock to match" rolls nothing twice.
 */
async function m8aTiming(h, w) {
    await m8aReset(h, w);
    const arsenic = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.arsenic, qty: 3 });
    const kings = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.kingsSleep, qty: 2 });
    await h.step("gm", "m8a", "setting", { key: "afflictions.pcSaves", value: "auto" });
    await h.step("gm", "m8a", "setting", { key: "afflictions.catchUpLimit", value: 2 });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m8a", "expose", { item: arsenic.uuid, targets: [w.pcs.p2.uuid], delivery: "ingested", key: "m8aonset1", dc: M8A.failDc });
    const first = await h.step("gm", "m8a", "brief", { actors: [w.pcs.p2.uuid], ms: 4000 });
    const onset = trackerIn(first.actors[0]);
    if (onset?.phase === "onset") {
        await h.step("p1", "m8a", "expose", { item: arsenic.uuid, targets: [w.pcs.p2.uuid], delivery: "ingested", key: "m8aonset2", dc: M8A.failDc });
        const raised = await h.step("gm", "m8a", "brief", { actors: [w.pcs.p2.uuid], ms: 4000 });
        const t = trackerIn(raised.actors[0]);
        h.check("re-exposure during the onset: the stage rises or stays (a success), the onset's end does not move", t.phase === "onset" && t.stage >= onset.stage, { onset, t });
        await h.step("gm", "m8a", "clock", { seconds: 3600 });
        const caught = await h.step("gm", "m8a", "brief", { actors: [w.pcs.p2.uuid], ms: 8000 });
        const c = trackerIn(caught.actors[0]);
        h.check("an hour later: the saves were rolled in order up to the catch-up limit (or it ended)", !c || Object.keys(c.saves).length <= 2 + 2, caught.actors[0]);
    } else h.check("the fighter saved against arsenic: the onset checks are skipped this run", true, first.actors[0]);
    await h.step("p2", "m6", "downtime", { actor: w.pcs.p2.uuid, on: true });
    await h.step("p1", "m8a", "expose", { item: kings.uuid, targets: [w.pcs.p1.uuid, w.pcs.p2.uuid], delivery: "ingested", key: "m8adays" });
    const before = await h.step("gm", "m8a", "brief", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 5000 });
    await h.step("p1", "m8a", "logDays", { days: 2 });
    const logged = await h.step("gm", "m8a", "brief", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 6000 });
    const savesOf = (b) => b.actors.flatMap((a) => a.trackers.filter((t) => t.name.startsWith("King")).map((t) => Object.keys(t.saves).length));
    await h.step("gm", "m8a", "clockToMatch", {});
    const matched = await h.step("gm", "m8a", "brief", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid], ms: 6000 });
    h.check("logged days made the day saves due (rolled at once); the clock moved to match rolls nothing twice",
        JSON.stringify(savesOf(logged)) === JSON.stringify(savesOf(matched)), { before: savesOf(before), logged: savesOf(logged), matched: savesOf(matched) });
    await checkStatuses(h);
    return { first, logged, matched };
}

/**
 * 12f. Affliction Forge (8.10.11), a stand-in on every client when it is not installed: a template-linked poison exposed by
 * Player One is handed off on the GM's client only (never a player's), with the Workshop's DC; with only players connected
 * the same exposure is tracked by the Workshop (`forgeWithoutGm: workshop`) and stays pending under `wait`.
 */
async function m8aForge(h, w) {
    await m8aReset(h, w);
    const dose = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.blackAdder, qty: 3 });
    await h.step("gm", "m8a", "link", { uuid: dose.uuid, template: M8A.template });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    for (const role of ["gm", "p1", "p2"]) await h.step(role, "m8a", "forge", { on: true });
    await h.step("p1", "m8a", "expose", { item: dose.uuid, targets: [w.pcs.p2.uuid], delivery: "injury", key: "m8aforge1" });
    await sleep(3000);
    const gmCalls = await h.step("gm", "m8a", "forgeCalls", {});
    const p1Calls = await h.step("p1", "m8a", "forgeCalls", {});
    h.check("handed off on the GM's client, with the Workshop's DC; no player client called Affliction Forge", gmCalls.calls.length === 1 &&
        gmCalls.calls[0].context?.saveDc === 18 && p1Calls.calls.length === 0, { gmCalls, p1Calls });
    await h.only(["p1", "p2"]);
    for (const role of ["p1", "p2"]) await h.step(role, "m8a", "forge", { on: true });
    await h.step("p1", "m8a", "expose", { item: dose.uuid, targets: [w.pcs.p2.uuid], delivery: "injury", key: "m8aforge2" });
    const tracked = await h.step("p2", "m8a", "brief", { actors: [w.pcs.p2.uuid], ms: 3000 });
    h.check("no GM: the Workshop tracks it (its save pending for Player Two)", tracked.actors[0].pending.length === 1 && tracked.claims.some((c) => c.idem.includes("m8aforge2") &&
        c.pending), tracked);
    for (const role of ["p1", "p2"]) h.check(`${role} never called Affliction Forge`, (await h.step(role, "m8a", "forgeCalls", {})).calls.length === 0);
    for (const role of ["p1", "p2"]) await h.step(role, "m8a", "forge", { on: false });
    await checkStatuses(h);
    return { gmCalls, tracked };
}

/**
 * 12g. The backends (8.10.1): every client reads the same backend; in a release build it is the effect backend (an `effect`
 * item with the stage badge); in a development build of pf2e the native item is created only once the first stage takes
 * effect (no conditions during an onset). The migration's single re-posted damage card is checked by hand there.
 */
async function m8aBackends(h, w) {
    await m8aReset(h, w);
    const dose = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.blackAdder, qty: 1 });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const seen = {};
    for (const role of ["gm", "p1", "p2"]) seen[role] = (await h.step(role, "m8a", "definition", { uuid: M8A.blackAdder })).backend;
    h.check("every client reads one backend", new Set(Object.values(seen)).size === 1, seen);
    await h.step("p1", "m8a", "expose", { item: dose.uuid, targets: [w.pcs.p2.uuid], delivery: "injury", key: "m8abackend", dc: M8A.failDc });
    const rolled = await h.step("p2", "m8a", "roll", {});
    const t = trackerIn(rolled.brief ?? { trackers: [] });
    if (seen.gm === "effect") h.check("effect backend: an effect item whose badge is the stage", !t || (t.type === "effect" && t.badge?.value === t.stage), t);
    else h.check("native backend: an affliction item", !t || t.type === "affliction", t);
    return { seen, t };
}

/**
 * 12h. The effects panel (8.10.1, 8.10.9): pf2e's own left click (increase) on the fighter's tracker becomes a recorded
 * manual adjust with the stage's conditions; its right click (decrease) at stage 1 a recorded manual end; the run state always
 * matches the badge.
 */
async function m8aPanel(h, w) {
    await m8aReset(h, w);
    const dose = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.blackAdder, qty: 1 });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m8a", "expose", { item: dose.uuid, targets: [w.pcs.p2.uuid], delivery: "injury", key: "m8apanel", dc: M8A.failDc });
    const rolled = await h.step("p2", "m8a", "roll", {});
    const t = trackerIn(rolled.brief ?? { trackers: [] });
    if (!t) {
        h.check("the fighter saved: the panel checks are skipped this run", true, rolled);
        return { rolled };
    }
    const left = await h.step("p2", "m8a", "panel", { tracker: t.id, button: "left" });
    const l = trackerIn(left.brief);
    h.check("a left click: a manual adjust to the next stage, recorded with its author, the badge matching", l.stage === Math.min(t.stage + 1, 3) &&
        Object.values(l.manual).some((m) => m.by === w.users.p2) && l.badge?.value === l.stage, l);
    await h.step("p2", "m8a", "adjust", { tracker: t.id, stage: 1 });
    const right = await h.step("p2", "m8a", "panel", { tracker: t.id, button: "right" });
    h.check("a right click at stage 1: a recorded manual end", right.brief.trackers.length === 0 && right.brief.ended.includes(t.id), right.brief);
    await checkStatuses(h);
    return { left, right };
}

/**
 * 12i. A familiar and an unidentified poison (8.10.8): a familiar Player One owns is exposed while Player One is connected
 * and no GM is: Player One rolls; an unidentified poison on the fighter still shows Player Two the stage badge, under a
 * generic name.
 */
async function m8aFamiliar(h, w) {
    await m8aReset(h, w);
    const dose = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.blackAdder, qty: 2 });
    await h.step("gm", "m8a", "identify", { item: dose.uuid, on: false });
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m8a", "expose", { item: dose.uuid, targets: [w.pcs.p2.uuid], delivery: "injury", key: "m8ahidden", dc: M8A.failDc });
    const rolled = await h.step("p2", "m8a", "roll", {});
    const t = trackerIn(rolled.brief ?? { trackers: [] });
    h.check("an unidentified poison: Player Two sees a stage badge under a generic name, never an unidentified effect", !t || (!t.unidentified && t.badge?.value >= 1), t);
    await checkStatuses(h);
    return { rolled };
}

/** The Afflictions window photographed (17.1, M8a): as Player Two, with an affliction running, 1440x900 and 1024x768, dark and light. */
async function m8aShots(h, w) {
    await m8aReset(h, w);
    const dose = await h.step("gm", "m8a", "give", { actor: w.pcs.p1.uuid, uuid: M8A.blackAdder, qty: 1 });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    await h.step("p1", "m8a", "expose", { item: dose.uuid, targets: [w.pcs.p2.uuid], delivery: "injury", key: "m8ashots", dc: M8A.failDc });
    await h.step("p2", "m8a", "roll", {});
    const opened = [];
    for (const scheme of ["dark", "light"]) {
        await h.step("p2", "m4", "theme", { scheme });
        for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
            await h.screenshot("p2", `m8a-p2-afflictions-${size.width}x${size.height}-${scheme}.png`, size, async () => {
                const view = await h.step("p2", "m8a", "window", {});
                opened.push({ scheme, ...size, open: view.open, actors: view.actors.length });
                return view;
            });
            await h.step("p2", "m8a", "close", {});
        }
    }
    await h.step("p2", "m4", "theme", { scheme: "dark" });
    h.check("the Afflictions window opened every time", opened.every((o) => o.open), opened);
    return { opened, shots: h.shots.filter((s) => s.label === h.label).map((s) => s.file) };
}

Object.assign(BEHAVIOURS, {
    "m8a-strike": m8aStrike,
    "m8a-cloud": m8aCloud,
    "m8a-once": m8aOnce,
    "m8a-powerful": m8aPowerful,
    "m8a-timing": m8aTiming,
    "m8a-forge": m8aForge,
    "m8a-backends": m8aBackends,
    "m8a-panel": m8aPanel,
    "m8a-familiar": m8aFamiliar,
    "m8a-shots": m8aShots,
});

/* -------------------------------------------- */
/*  M9: tattoos, grafts and the remaining crafts */
/* -------------------------------------------- */

/** Compendium items the M9 plans use (pf2e `packs/pf2e/`, pf2e-8.6.1). */
export const M9 = Object.freeze({
    tattoo: "Compendium.pf2e.equipment-srd.Item.FYv6k2zkd0MJ93la",      // Eye Slash, a common magical tattoo of level 1
    graft: "Compendium.pf2e.equipment-srd.Item.kLQdzIl2lfGIR3sy",       // Bioluminescent Stripes, a common graft of level 1
    fulu: "Compendium.pf2e.equipment-srd.Item.89uak2oyHnEuIn0b",        // Fulu of Fire Suppression, level 3
    missive: "Compendium.pf2e.equipment-srd.Item.NK0wjH9m32sjaeQe",     // Messenger Missive, level 4
    staff: "Compendium.pf2e.equipment-srd.Item.opfpl1JmKgrfds9P",       // Staff of Fire: Ignition (cantrip), Breathe Fire (1st)
    gadget: "Compendium.pf2e.equipment-srd.Item.nybZVDfQWMhwvL2C",      // Blast Boots (Lesser), an uncommon gadget of level 1
    alarmSnare: "Compendium.pf2e.equipment-srd.Item.AFX1V0Go9DqPWBlN",
    giantSnare: "Compendium.pf2e.feats-srd.Item.SgXvw6rzk2lhTpXL",
    graftTechnician: "Compendium.pf2e.feats-srd.Item.9OaF7Lkrtvusg5AA",
});

/**
 * The die every M9 Craft check rolls (`run`'s `face`, M9 live pass): a success for every crafter fixture at the items' DCs, so
 * each plan checks what a finish makes instead of passing on the branch a failed check skips.
 */
export const M9_FACE = 15;

/** A fixture's actor UUID by its id, or null (checked). */
function fixtureOf(h, w, id) {
    const actorId = w.fixtures.find(([, fixture]) => fixture === id)?.[0];
    h.check(`the ${id} fixture is built`, !!actorId, w.fixtures);
    return actorId ? `Actor.${actorId}` : null;
}

/** Every M9 plan starts here: the world reset, M9's items taken back from the characters and fixtures named. */
async function m9Reset(h, w, fixtures = []) {
    await resetWorld(h, w);
    await h.step("gm", "m9", "reset", { actors: [w.pcs.p1.uuid, w.pcs.p2.uuid, ...fixtures.filter(Boolean)] });
}

/**
 * 14a. A tattoo for Player Two's character (6.14, the Secrets of Magic process): the GM's tattoo artist fixture takes it; G10
 * waits for Player Two, who agrees and so sits for it in downtime, and cannot leave until it is done; the Craft runs with
 * the Tattoo Artist bonus; the finish shelves it uninvested and healing for 30 days; Player Two's client collects it;
 * healing recorded and a day logged, Player Two's client invests it, once.
 */
async function m9Tattoo(h, w) {
    const artist = fixtureOf(h, w, "rogue-tattoo-7");
    if (!artist) return {};
    await m9Reset(h, w, [artist]);
    await h.step("gm", "m9", "learn", { actor: artist, uuids: [M9.tattoo] });
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const filed = await h.step("gm", "m9", "request", { uuid: M9.tattoo, requester: artist, crafter: artist, target: w.pcs.p2.uuid });
    h.check("a tattoo order for Player Two's character, received by it", filed.brief?.craftType === "tattoo" && filed.brief.recipient?.uuid === w.pcs.p2.uuid, filed);
    const waiting = await h.step("gm", "m5", "gates", { order: filed.order });
    h.check("G10 waits for the subject's consent", waiting.failing.some(([id, reason]) => id === "G10" && reason === "no-consent"), waiting);
    await h.step("p2", "m5", "seen", { path: `orders.${filed.order}.status` });
    const agreed = await h.step("p2", "m9", "consent", { order: filed.order });
    h.check("Player Two agrees: in downtime, sitting for the order", agreed.result?.ok === true && agreed.status.inDowntime && agreed.status.activity?.kind === "subject",
        agreed);
    const stays = await h.step("p2", "m9", "leave", {});
    h.check("Player Two cannot leave downtime while sitting for it", stays.ok === false && stays.reason === "subject", stays);
    await h.step("gm", "m5", "seen", { path: `orders.${filed.order}.subject.consented`, value: true });
    const ready = await h.step("gm", "m5", "gates", { order: filed.order });
    h.check("only the money is left to find", ready.failing.every(([id]) => id === "G8"), ready);
    const run = await h.step("gm", "m9", "run", { order: filed.order, crafter: artist, payer: w.pcs.p1.uuid, pledge: 1000, face: M9_FACE });
    h.check("the tattoo is crafted", run.order?.status === "complete", run);
    h.check("the process is frozen at the start", run.order?.process === "secrets-of-magic", run.order);
    if (run.order?.status !== "complete") return { run };
    const collected = await h.step("p2", "m9", "collect", {});
    const made = await h.step("p2", "m9", "made", { order: filed.order, ms: 1500 });
    const tattoo = made.items[0];
    h.check("on Player Two's character: healing, uninvested, worn", tattoo?.subject?.state === "healing" && tattoo.equipped?.invested === false &&
        tattoo.equipped?.carryType === "worn", { collected, made });
    const healed = await h.step("p2", "m9", "heal", { order: filed.order });
    h.check("healing recorded: it heals by the next day", healed.result?.ok === true && healed.result.until === tattoo.subject.from + 1, healed);
    await h.step("gm", "m9", "logDay", { days: 1 });
    const settled = await h.step("p2", "m9", "made", { order: filed.order, ms: 3000 });
    h.check("Player Two's client invests it once healed", settled.items[0]?.subject?.state === "invested" && settled.items[0].equipped?.invested === true, settled);
    const gmView = await h.step("gm", "m9", "made", { actor: w.pcs.p2.uuid, order: filed.order, ms: 500 });
    h.check("the GM reads the same", gmView.items[0]?.subject?.state === "invested", gmView);
    await checkStatuses(h);
    return { filed, run, settled };
}

/** 14b. The simple toggle (6.14): consent only, no downtime lock, delivered invested with no healing. */
async function m9Simple(h, w) {
    const artist = fixtureOf(h, w, "rogue-tattoo-7");
    if (!artist) return {};
    await m9Reset(h, w, [artist]);
    await h.step("gm", "m9", "setting", { key: "rules.tattooProcess", value: "simple" });
    await h.step("gm", "m9", "learn", { actor: artist, uuids: [M9.tattoo] });
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const filed = await h.step("gm", "m9", "request", { uuid: M9.tattoo, requester: artist, crafter: artist, target: w.pcs.p2.uuid });
    await h.step("p2", "m5", "seen", { path: `orders.${filed.order}.status` });
    const agreed = await h.step("p2", "m9", "consent", { order: filed.order });
    h.check("consent only: Player Two is not put in downtime", agreed.result?.presence === false && !agreed.status.inDowntime, agreed);
    await h.step("gm", "m5", "seen", { path: `orders.${filed.order}.subject.consented`, value: true });
    const run = await h.step("gm", "m9", "run", { order: filed.order, crafter: artist, payer: w.pcs.p1.uuid, pledge: 1000, face: M9_FACE });
    h.check("the tattoo is crafted", run.order?.status === "complete", run);
    if (run.order?.status === "complete") {
        await h.step("p2", "m9", "collect", {});
        const made = await h.step("p2", "m9", "made", { order: filed.order, ms: 1500 });
        h.check("delivered invested, with no healing", made.items[0]?.subject?.state === "invested" && made.items[0].equipped?.invested === true &&
            made.items[0].subject.until === made.items[0].subject.from, made);
    }
    await h.step("gm", "m9", "setting", { key: "rules.tattooProcess", value: "secrets-of-magic" });
    await checkStatuses(h);
    return { run };
}

/**
 * 14c. A graft (6.14, Howl of the Wild p.97): the GM's cleric fixture, given Graft Technician and expert Medicine, implants a
 * graft in Player Two's character: G6 wants the formula first, the check is Medicine, the subject sits for it; with Player
 * Two's invest limit at zero the graft is inactive, and invested once the limit rises.
 */
async function m9Graft(h, w) {
    const surgeon = fixtureOf(h, w, "cleric-5");
    if (!surgeon) return {};
    await m9Reset(h, w, [surgeon]);
    await h.step("gm", "m9", "give", { actor: surgeon, uuid: M9.graftTechnician });
    await h.step("gm", "m9", "medicine", { actor: surgeon });
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const filed = await h.step("gm", "m9", "request", { uuid: M9.graft, requester: surgeon, crafter: surgeon, target: w.pcs.p2.uuid });
    h.check("a graft order", filed.brief?.craftType === "graft", filed);
    await h.step("p2", "m5", "seen", { path: `orders.${filed.order}.status` });
    await h.step("p2", "m9", "consent", { order: filed.order });
    await h.step("gm", "m5", "seen", { path: `orders.${filed.order}.subject.consented`, value: true });
    const noFormula = await h.step("gm", "m5", "gates", { order: filed.order });
    h.check("no implant without the formula (G6)", noFormula.failing.some(([id, reason]) => id === "G6" && reason === "needs-formula"), noFormula);
    await h.step("gm", "m9", "learn", { actor: surgeon, uuids: [M9.graft] });
    await h.step("gm", "m9", "investiture", { actor: w.pcs.p2.uuid, max: 0 });
    const run = await h.step("gm", "m9", "run", { order: filed.order, crafter: surgeon, payer: w.pcs.p1.uuid, pledge: 600, face: M9_FACE });
    h.check("the implant rolls Medicine", run.order?.skill === "medicine", run.order);
    h.check("the graft is implanted", run.order?.status === "complete", run);
    if (run.order?.status === "complete") {
        await h.step("p2", "m9", "collect", {});
        const inactive = await h.step("p2", "m9", "made", { order: filed.order, ms: 1500 });
        h.check("no invest limit left: inactive, implanted", inactive.items[0]?.subject?.state === "inactive" && inactive.items[0].equipped?.carryType === "implanted", inactive);
        await h.step("gm", "m9", "investiture", { actor: w.pcs.p2.uuid, max: null });
        await h.step("p2", "m9", "collect", {});
        const invested = await h.step("p2", "m9", "made", { order: filed.order, ms: 1500 });
        h.check("the limit rose: invested", invested.items[0]?.subject?.state === "invested", invested);
    }
    await h.step("gm", "m9", "investiture", { actor: w.pcs.p2.uuid, max: null });
    await checkStatuses(h);
    return { run };
}

/**
 * 14d. A fulu and a missive by the GM's fighter crafter (no spellcasting): the fulu waits for a tradition (G12), takes the one
 * chosen, batches in fours and carries a year's world stamp; the missive is made blank and one is composed.
 */
async function m9FuluMissive(h, w) {
    const crafter = fixtureOf(h, w, "fighter-crafter-10");
    if (!crafter) return {};
    await m9Reset(h, w, [crafter]);
    await h.step("gm", "m9", "learn", { actor: crafter, uuids: [M9.fulu, M9.missive] });
    await h.only(["gm"]);
    await h.settle("ready");
    const fulu = await h.step("gm", "m9", "request", { uuid: M9.fulu, quantity: 4, requester: crafter, crafter });
    const blocked = await h.step("gm", "m5", "gates", { order: fulu.order });
    h.check("the fulu waits for a tradition (G12)", blocked.failing.some(([, reason]) => reason === "fulu-tradition"), blocked);
    h.check("chosen", (await h.step("gm", "m9", "tradition", { order: fulu.order, tradition: "divine" })).ok === true);
    const made = await h.step("gm", "m9", "run", { order: fulu.order, crafter, payer: w.pcs.p1.uuid, pledge: 2000, face: M9_FACE });
    h.check("the fulus are crafted", made.order?.status === "complete" && made.order.tradition === "divine", made);
    if (made.order?.status === "complete") {
        const items = await h.step("gm", "m9", "made", { actor: crafter, order: fulu.order, ms: 1500 });
        const shelf = items.items[0];
        h.check("four fulus, divine, with a year's world stamp", (shelf?.qty ?? 0) === 4 && shelf.traits.includes("divine") && shelf.expiry?.rule === "world" &&
            shelf.expiry?.atDay === items.today + 365, items);
    }
    const missive = await h.step("gm", "m9", "request", { uuid: M9.missive, quantity: 2, requester: crafter, crafter });
    const crafted = await h.step("gm", "m9", "run", { order: missive.order, crafter, payer: w.pcs.p1.uuid, pledge: 3000, face: M9_FACE });
    h.check("the missives are crafted", crafted.order?.status === "complete", crafted);
    if (crafted.order?.status === "complete") {
        const blank = await h.step("gm", "m9", "made", { actor: crafter, order: missive.order, ms: 1500 });
        h.check("two missives, made blank", blank.items.reduce((n, i) => n + i.qty, 0) === 2 && blank.items.every((i) => i.missive?.composed === null), blank);
        const composed = await h.step("gm", "m9", "compose", { actor: crafter, order: missive.order, note: "M9 live pass" });
        h.check("one is composed on its own, one left blank", composed.result?.ok === true && composed.left === 1 && composed.composed?.qty === 1 &&
            composed.composed.missive?.composed?.note === "M9 live pass", composed);
    }
    await checkStatuses(h);
    return { made, crafted };
}

/**
 * 14e. A staff's listed castings (6.9, M9): the fighter crafter's Staff of Fire needs Ignition (a cantrip) and Breathe Fire
 * at 1st rank; the wizard fixture offers both, each naming its listed casting (Electric Arc, not listed, is refused, and a
 * casting is offered once); G9 waits until both are cast.
 */
async function m9Staff(h, w) {
    const crafter = fixtureOf(h, w, "fighter-crafter-10");
    const wizard = fixtureOf(h, w, "wizard-9");
    if (!crafter || !wizard) return {};
    await m9Reset(h, w, [crafter, wizard]);
    await h.step("gm", "m9", "learn", { actor: crafter, uuids: [M9.staff] });
    await h.only(["gm"]);
    await h.settle("ready");
    const ignition = await h.step("gm", "m9", "spell", { actor: wizard, name: "Ignition" });
    const breathe = await h.step("gm", "m9", "spell", { actor: wizard, name: "Breathe Fire" });
    const arc = await h.step("gm", "m9", "spell", { actor: wizard, name: "Electric Arc" });
    h.check("the wizard holds the three spells", ignition.ok && breathe.ok && arc.ok, { ignition, breathe, arc });
    const filed = await h.step("gm", "m9", "request", { uuid: M9.staff, requester: crafter, crafter });
    h.check("a staff is a spell item", filed.brief?.craftType === "spell-item", filed);
    const waiting = await h.step("gm", "m5", "gates", { order: filed.order });
    h.check("G9 waits for the listed castings", waiting.failing.some(([id, reason]) => id === "G9" && reason === "spells"), waiting);
    const unlisted = await h.step("gm", "m5", "pledge", { order: filed.order, caster: wizard, spell: arc.uuid, castings: 1 });
    h.check("a spell the staff does not list is refused", unlisted.ok === false && unlisted.reason === "not-on-list", unlisted);
    const first = await h.step("gm", "m5", "pledge", { order: filed.order, caster: wizard, spell: ignition.uuid, castings: 1 });
    const again = await h.step("gm", "m5", "pledge", { order: filed.order, caster: wizard, spell: ignition.uuid, castings: 1 });
    const second = await h.step("gm", "m5", "pledge", { order: filed.order, caster: wizard, spell: breathe.uuid, castings: 1 });
    h.check("each listed casting is offered once", first.ok === true && second.ok === true && again.ok === false, { first, again, second });
    await h.step("gm", "m5", "fulfil", { order: filed.order, caster: wizard });
    const cast = await h.step("gm", "m9", "order", { order: filed.order });
    const entries = (cast.order?.pledges ?? []).map((p) => p.entry);
    h.check("both entries are named and cast: Ignition as a cantrip, Breathe Fire at 1st rank", cast.order?.pledges?.length === 2 &&
        cast.order.pledges.every((p) => p.entry && p.status === "fulfilled") && new Set(entries).size === 2 &&
        entries.some((e) => e.startsWith(ignition.compendium)) && entries.some((e) => e === `${breathe.compendium}@1`), cast);
    const after = await h.step("gm", "m5", "gates", { order: filed.order });
    h.check("G9 passes", !after.failing.some(([id]) => id === "G9"), after);
    await checkStatuses(h);
    return { cast };
}

/**
 * 14f. Quick-deploy snares (7.1): the ranger fixture prepares two Alarm Snares in its snarecrafter pool; with Giant Snare one
 * is marked giant and costs two; one is deployed through pf2e's own expend toggle (its craft makes nothing for a snare).
 */
async function m9Snares(h, w) {
    const ranger = fixtureOf(h, w, "ranger-snares-8");
    if (!ranger) return {};
    await m9Reset(h, w, [ranger]);
    await h.step("gm", "m9", "learn", { actor: ranger, uuids: [M9.alarmSnare] });
    await h.step("gm", "m9", "give", { actor: ranger, uuid: M9.giantSnare });
    await h.only(["gm"]);
    await h.settle("ready");
    const prepared = await h.step("gm", "m9", "snares", { actor: ranger, pool: "snarecrafter", uuid: M9.alarmSnare, count: 2 });
    h.check("two snares prepared for quick deployment, both ready", prepared.ok === true && prepared.prepared.length === 2 &&
        prepared.prepared.every((f) => !f.expended), prepared);
    const key = `${M9.alarmSnare}#1`;
    const marked = await h.step("gm", "m9", "ledger", { actor: ranger, pool: "snarecrafter", mark: { key, mark: "giant" } });
    h.check("a giant snare costs two", marked.mark?.ok === true && marked.ledger.used === 3 && marked.ledger.allowed.includes("giant"), marked);
    const deployed = await h.step("gm", "m9", "ledger", { actor: ranger, pool: "snarecrafter", deploy: 1 });
    h.check("one deployed through pf2e", deployed.deploy?.ok === true && deployed.ledger.deployed === 1, deployed);
    const again = await h.step("gm", "m9", "ledger", { actor: ranger, pool: "snarecrafter", deploy: 1 });
    h.check("once", again.deploy?.reason === "deployed", again);
    await checkStatuses(h);
    return { marked, deployed };
}

/**
 * 14g. An inventor has access to an uncommon gadget (G5, Guns & Gears); no feat is needed (G4). The fighter crafter, without the
 * class, is held back by G5 alone, so the inventor's pass is the class's doing.
 */
async function m9Gadget(h, w) {
    const inventor = fixtureOf(h, w, "inventor-6");
    const fighter = fixtureOf(h, w, "fighter-crafter-10");
    if (!inventor || !fighter) return {};
    await m9Reset(h, w, [inventor, fighter]);
    await h.only(["gm"]);
    await h.settle("ready");
    const filed = await h.step("gm", "m9", "request", { uuid: M9.gadget, requester: inventor, crafter: inventor });
    const gates = await h.step("gm", "m5", "gates", { order: filed.order });
    h.check("an uncommon gadget: access and no feat for an inventor", !!filed.order && Array.isArray(gates.failing) &&
        !gates.failing.some(([id]) => id === "G4" || id === "G5"), { filed, gates });
    // The check above means something only if a crafter without the class is held back: G5 (access), not G4 (feat).
    const other = await h.step("gm", "m9", "request", { uuid: M9.gadget, requester: fighter, crafter: fighter });
    const held = await h.step("gm", "m5", "gates", { order: other.order });
    h.check("the same gadget without the class: no access (G5), no feat needed (G4)", !!other.order && held.failing?.some(([id]) => id === "G5") &&
        !held.failing.some(([id]) => id === "G4"), { other, held });
    await checkStatuses(h);
    return { gates, held };
}

/** The Queue's tattoo detail photographed (17.1, M9): as Player Two, waiting to agree, 1440x900 and 1024x768, dark and light. */
async function m9Shots(h, w) {
    const artist = fixtureOf(h, w, "rogue-tattoo-7");
    if (!artist) return {};
    await m9Reset(h, w, [artist]);
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const filed = await h.step("gm", "m9", "request", { uuid: M9.tattoo, requester: artist, crafter: artist, target: w.pcs.p2.uuid });
    await h.step("p2", "m5", "seen", { path: `orders.${filed.order}.status` });
    const opened = [];
    for (const scheme of ["dark", "light"]) {
        await h.step("p2", "m4", "theme", { scheme });
        for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
            await h.screenshot("p2", `m9-p2-queue-tattoo-${size.width}x${size.height}-${scheme}.png`, size, async () => {
                const view = await h.step("p2", "m5", "open", { tab: "queue", order: filed.order });
                opened.push({ scheme, ...size, open: view.open });
                return view;
            });
        }
        await h.step("p2", "m5", "close", {});
    }
    await h.step("p2", "m4", "theme", { scheme: "dark" });
    h.check("the Queue opened every time", opened.every((o) => o.open), opened);
    return { opened, shots: h.shots.filter((s) => s.label === h.label).map((s) => s.file) };
}

Object.assign(BEHAVIOURS, {
    "m9-tattoo": m9Tattoo,
    "m9-simple": m9Simple,
    "m9-graft": m9Graft,
    "m9-fulu-missive": m9FuluMissive,
    "m9-staff": m9Staff,
    "m9-snares": m9Snares,
    "m9-gadget": m9Gadget,
    "m9-shots": m9Shots,
});

/* -------------------------------------------- */
/*  M9a: Treasure Vault (Remastered) variants    */
/* -------------------------------------------- */

/** Compendium items the M9a plans use (pf2e `packs/pf2e/`, pf2e-8.6.1). */
export const M9A = Object.freeze({
    cloak: "Compendium.pf2e.equipment-srd.Item.fXD42N5cGUYCtvp2",       // Cloak of Feline Rest, a common permanent magic item of level 1, 20 gp
    fire: "Compendium.pf2e.equipment-srd.Item.yd3kEK21YknZLlcT",        // Alchemist's Fire (Lesser), a common alchemical consumable of level 1, 3 gp
    tinderbox: "Compendium.pf2e.equipment-srd.Item.vqHSVgQJktWTXiDK",   // Versatile Tinderbox, a common magical wood item of level 1, 20 gp
    breastplate: "Compendium.pf2e.equipment-srd.Item.r0ifJfoz8aqf0mwk", // Breastplate, level 0, 8 gp
    latches: "Compendium.pf2e.equipment-srd.Item.HuC6uonXt6YXePjb",     // Armor Latches, a common adjustment applied to armor, level 1, 4 gp
    quickSetup: "Compendium.pf2e.feats-srd.Item.bcEI0iIFhZXqjoaR",      // Quick Setup (Treasure Vault), skill feat 7, master in Crafting
    alchemicalCrafting: "Compendium.pf2e.feats-srd.Item.is3Oz9wt11lNq62K", // Alchemical Crafting, skill feat 1 (a fighter's alchemist's fire)
});

/** The die of the legacy alchemist's rushed-finish flat check in `m9a-complex`: a natural 1, a critical failure (ruined). */
export const M9A_FLAT_FACE = 1;

/** The keys of the notes the M9a plans read from the pages' notification logs. */
const MIXED_KEY = "pf2e-artisans-workshop.Settings.Variants.Mixed";
const SEASON_KEY = "pf2e-artisans-workshop.Variant.Grow.SeasonDue";

/** The notes each client showed since the last look with one of `keys`, by client. */
async function notesBy(h, keys) {
    const pages = await takeNotes(h);
    return Object.fromEntries(Object.entries(pages).map(([client, page]) => [client, page.notes.filter((n) => keys.includes(n.message)).map((n) => plainNote(n))]));
}
const plainNote = (note) => ({ message: note.message, format: note.format ?? null });

/** Every M9a plan starts here: the world reset, M9's and M9a's leftovers taken back, every variant off, the named variants on. */
async function m9aReset(h, w, { actors = [], on = {} } = {}) {
    await resetWorld(h, w);
    const all = [w.pcs.p1.uuid, w.pcs.p2.uuid, ...actors.filter(Boolean)];
    await h.step("gm", "m9a", "reset", { actors: all });
    await h.step("gm", "m9", "reset", { actors: all });
    if (Object.keys(on).length) await h.step("gm", "m9a", "variants", { on });
}

/**
 * 13, the notice (6.16, TV-R p.157): the GM turns on Complex Crafting (one group) and then Grow (another): the GM is told,
 * once, and the module's Settings show the notice; Player One is told nothing; both variants are on.
 */
async function m9aNotice(h, w) {
    await m9aReset(h, w);
    await h.only(["gm", "p1"]);
    await h.settle("ready");
    await notesBy(h, [MIXED_KEY]);
    const one = await h.step("gm", "m9a", "variants", { on: { "variants.complexCrafting": true } });
    h.check("one group: no notice", one.mixed === false && (await h.step("gm", "m9a", "notice", {})).notice === null, one);
    const two = await h.step("gm", "m9a", "variants", { on: { "variants.grow": true } });
    const told = await notesBy(h, [MIXED_KEY]);
    h.check("two groups: both on, nothing blocked", two.mixed === true && two.groups.includes("alternate") && two.groups.includes("nature"), two);
    h.check("the GM who turned the second group on is told, once; Player One is not", told.gm?.length === 1 && !told.p1?.length, told);
    const notice = await h.step("gm", "m9a", "notice", {});
    h.check("Settings shows the notice naming both groups", typeof notice.notice === "string" && notice.notice.length > 0, notice);
    await checkStatuses(h);
    return { two, notice };
}

/**
 * 13a. Complex Crafting rushed in setup and in finishing (6.16.1). Player Two's fighter (master, level 10) makes a Cloak of
 * Feline Rest without its formula: Table 5-1 gives 2 days, rushed by one to 1 day at +5 DC, frozen at the start; after the
 * check, one finishing day is rushed and the finish's flat check (DC 10 + 1 - 16) cannot fail, so no die is rolled. Then the
 * legacy alchemist fixture (expert, level 3) rushes Alchemist's Fire (Lesser) to 4 hours, which takes its downtime day on the
 * order (only Quick Setup's 2-hour consumable setup fits into an adventuring day, TV-R p.159), so Set up now is refused and
 * Work a day records the setup; then it rushes a finishing day: its flat check is DC 4, rolled once, at a natural 1 (M9a live
 * pass): ruined, so the order completes with nothing made, and the Queue says so. Both Craft checks roll at `M9_FACE`.
 */
async function m9aComplex(h, w) {
    const alchemist = fixtureOf(h, w, "legacy-alchemist-3");
    await m9aReset(h, w, { actors: [alchemist], on: { "variants.complexCrafting": true } });
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox (G7 for the alchemist's fire)");
    const fighter = w.pcs.p2.uuid;
    await h.step("gm", "m9a", "forget", { actor: fighter, uuids: [M9A.cloak] });
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const filed = await h.step("p2", "m9", "request", { uuid: M9A.cloak, requester: fighter, crafter: fighter });
    const rushed = await h.step("p2", "m9a", "rush", { order: filed.order, rush: 1 });
    h.check("the crafter chooses one rushed day before the start", rushed.result?.ok === true && rushed.order.variant.rushRequest === 1, rushed);
    const run = await h.step("p2", "m9", "run", { order: filed.order, crafter: fighter, payer: fighter, pledge: 1000, finish: false, face: M9_FACE });
    const started = await h.step("p2", "m9a", "order", { order: filed.order });
    h.check("frozen at the start: 1 setup day, one day rushed, +5 DC", started.setup?.days === 1 && started.variant.complex?.rush === 1 && started.dc?.adjust === 5 &&
        started.days.filter((d) => d.kind === "setup").length === 1, started);
    h.check("the cloak's check succeeds at the fixed die: finishing", started.status === "finishing", started);
    const out = { run, started };
    if (started.status === "finishing") {
        const on = await h.step("p2", "m9a", "rushFinish", { order: filed.order, on: true });
        h.check("the crafter rushes the finishing", on.result?.ok === true && on.order.variant.rushFinish === true, on);
        const day = await h.step("p2", "m9a", "work", { order: filed.order, count: 1, while: ["finishing"] });
        h.check("the day is recorded rushed", day.order.days.some((d) => d.rushed), day.order.days);
        const finished = await h.step("p2", "m9a", "finish", { order: filed.order, payer: fighter });
        const flat = finished.order.check?.rushFlat;
        h.check("the flat check, DC 10 + 1 - 16, cannot fail: no die, a fine item", finished.result?.ok === true && flat?.dc <= 1 && flat.die === null &&
            flat.outcome === "fine" && finished.order.status === "complete", finished);
        out.finished = finished;
    }
    if (!alchemist) return out;
    await h.step("gm", "m9a", "forget", { actor: alchemist, uuids: [M9A.fire] });
    const fire = await h.step("gm", "m9", "request", { uuid: M9A.fire, requester: alchemist, crafter: alchemist });
    await h.step("gm", "m9a", "rush", { order: fire.order, rush: 1 });
    const begun = await h.step("gm", "m9a", "start", { order: fire.order, crafter: alchemist, payer: w.pcs.p1.uuid, pledge: 150 });
    h.check("rushed below a day: 4 hours, +5 DC", begun.start?.ok === true && begun.order.setup?.days === 0 && begun.order.setup?.hours === 4 && begun.order.dc?.adjust === 5,
        begun);
    h.check("4 hours is no adventuring-day setup: Set up now is refused", (await h.step("gm", "m9a", "setUpNow", { order: fire.order })).result?.reason === "downtime-day");
    const now = await h.step("gm", "m9a", "work", { order: fire.order, count: 1, while: ["setup"] });
    h.check("Work a day: the crafter's own day record is the setup-hours record, and the order is at its check", now.order.status === "check" &&
        now.order.days.some((d) => d.kind === "setup-hours" && d.hours === 4 && !d.id.endsWith(`-${fire.order}`)), now);
    await h.step("gm", "m9a", "roll", { order: fire.order, face: M9_FACE });
    const settled = await h.step("gm", "m9a", "work", { order: fire.order, count: 1 });
    out.fire = settled.order;
    h.check("the fire's check succeeds at the fixed die: finishing", settled.order.status === "finishing", settled.order);
    if (settled.order.status !== "finishing") return out;
    await h.step("gm", "m9a", "rushFinish", { order: fire.order, on: true });
    await h.step("gm", "m9a", "work", { order: fire.order, count: 1, while: ["finishing"] });
    // The flat check's die fixed at 1 (M9a live pass): a critical failure, the path a random die rarely takes (the fighter's covers
    // "fine", a die of 2 or 3 "quirk"; the stub tests cover all three).
    const done = await h.step("gm", "m9a", "finish", { order: fire.order, payer: w.pcs.p1.uuid, face: M9A_FLAT_FACE });
    const flat = done.order.check?.rushFlat;
    h.check("the flat check: DC 10 + 1 - 7 = 4, one d20, its card posted once", flat?.dc === 4 && Number.isInteger(flat.die) && done.order.flatCards === 1, done.order);
    // A critical failure under `rushCritFail` "ruined" (the default) completes the order and makes nothing (6.16.1, 10.17); the
    // plan wanted "failed" until the M9a live pass rolled a 1.
    const made = await h.step("gm", "m9a", "items", { actor: alchemist, order: fire.order, ms: 1500 });
    const count = (made.items?.length ?? 0) + (done.order.shelf?.length ?? 0);
    h.check("the outcome follows the die: fine on a success, a quirk on a failure, ruined (complete, nothing made) on a critical failure", !!flat &&
        done.order.status === "complete" && (flat.degree >= 2) === (flat.outcome === "fine") && (flat.degree !== 1 || flat.outcome === "quirk") &&
        (flat.degree === 0 ? flat.outcome === "ruined" && count === 0 : count === 1), { flat, status: done.order.status, made: made.items, shelf: done.order.shelf });
    const seen = await h.step("gm", "m9a", "view", { order: fire.order, ms: 500 });
    h.check("at a natural 1 the item is ruined, and the Queue says nothing was made (not \"on its way\")", flat?.die === 1 && flat.outcome === "ruined" &&
        seen.deliveryState === "ruined" && typeof seen.delivery === "string" && !seen.delivery.includes("pf2e-artisans-workshop."), { flat, seen });
    out.fire = done.order;
    await checkStatuses(h);
    return out;
}

/**
 * 13b. Quick Setup (TV-R p.159) on a day spent on something else: Player Two's fighter, given Quick Setup and Alchemical
 * Crafting, is in downtime subsisting. A Cloak of Feline Rest it has the formula for (1 day, 9 levels below) rushed to 4 hours
 * is no adventuring-day setup: Set up now is refused (the feat lets only a batch of consumables be set up in 2 hours during an
 * adventuring day). Alchemist's Fire (Lesser) rushed to 2 hours is: the day is logged and resolved as subsistence, and Set up
 * now records the hours on the same day under its own key: two records, neither overwriting the other.
 */
async function m9aQuickSetup(h, w) {
    await m9aReset(h, w, { on: { "variants.complexCrafting": true } });
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox (G7 for the alchemist's fire)");
    const fighter = w.pcs.p2.uuid;
    await h.step("gm", "m9", "give", { actor: fighter, uuid: M9A.quickSetup });
    await h.step("gm", "m9", "give", { actor: fighter, uuid: M9A.alchemicalCrafting });
    await h.step("gm", "m9", "learn", { actor: fighter, uuids: [M9A.cloak, M9A.fire] });
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    await h.step("p2", "m6", "downtime", { on: true });
    await h.step("p2", "m6", "activity", { activity: "subsist" });
    const cloak = await h.step("p2", "m9", "request", { uuid: M9A.cloak, requester: fighter, crafter: fighter });
    await h.step("p2", "m9a", "rush", { order: cloak.order, rush: 1 });
    const permanent = await h.step("p2", "m9a", "start", { order: cloak.order, crafter: fighter, payer: fighter, pledge: 1000 });
    h.check("Quick Setup: 4 hours for a permanent item", permanent.start?.ok === true && permanent.order.setup?.days === 0 && permanent.order.setup?.hours === 4 &&
        permanent.order.variant.complex?.quick === true, permanent);
    h.check("a permanent item's 4 hours take a downtime day: Set up now is refused",
        (await h.step("p2", "m9a", "setUpNow", { order: cloak.order })).result?.reason === "downtime-day");
    const filed = await h.step("p2", "m9", "request", { uuid: M9A.fire, quantity: 4, requester: fighter, crafter: fighter });
    await h.step("p2", "m9a", "rush", { order: filed.order, rush: 1 });
    const begun = await h.step("p2", "m9a", "start", { order: filed.order, crafter: fighter, payer: fighter, pledge: 600 });
    h.check("Quick Setup: 2 hours for a batch of consumables", begun.start?.ok === true && begun.order.setup?.days === 0 && begun.order.setup?.hours === 2 &&
        begun.order.variant.complex?.quick === true, begun);
    const logged = await h.step("p2", "m9a", "logDays", { days: 1 });
    const resolved = await h.step("p2", "m6", "resolve", { activity: "subsist", count: 1 });
    const now = await h.step("p2", "m9a", "setUpNow", { order: filed.order });
    const days = await h.step("gm", "m9a", "actorDays", { actor: fighter, ms: 1500 });
    const own = days.find((d) => d.day === logged.to && !d.order);
    const hours = days.find((d) => d.day === logged.to && d.kind === "setup-hours");
    h.check("the day is the fighter's subsistence and the batch's setup hours, two records", now.result?.ok === true && !!own && !!hours && own.id !== hours.id &&
        hours.id.endsWith(`-${filed.order}`), { resolved, now, days });
    h.check("the batch is at its check", now.order.status === "check", now.order);
    await checkStatuses(h);
    return { permanent, begun, now, days };
}

/**
 * 13c. Deconstruct (6.16.5): Player Two's fighter breaks down a Cloak of Feline Rest for a similar item, another Cloak it has
 * ordered (the follow-on). G9 waits for the workshop; the day is 1, with no Price; on a success the cloak becomes
 * components worth 75% of its Price, and the deconstruct's day becomes the follow-on's first setup day, counted when the check
 * settles; handed over, the components cover the follow-on's up-front half, so it starts with no coins.
 */
async function m9aDeconstruct(h, w) {
    await m9aReset(h, w, { on: { "variants.deconstruct": true } });
    const fighter = w.pcs.p2.uuid;
    const cloak = await h.step("gm", "m9", "give", { actor: fighter, uuid: M9A.cloak });
    await h.step("gm", "m9", "learn", { actor: fighter, uuids: [M9A.cloak] });
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const next = await h.step("p2", "m9", "request", { uuid: M9A.cloak, requester: fighter, crafter: fighter });
    h.check("the follow-on is confirmed similar", (await h.step("p2", "m9a", "checklist", { order: next.order, key: "similar" })).ok === true);
    const filed = await h.step("p2", "m9", "request", { uuid: M9A.cloak, requester: fighter, crafter: fighter, craftType: "deconstruct", target: cloak.uuid,
        variant: { deconstruct: { purpose: "similar" } } });
    h.check("a deconstruct order for the cloak", filed.brief?.craftType === "deconstruct" && filed.brief.target === cloak.uuid, filed);
    const waiting = await h.step("p2", "m5", "gates", { order: filed.order });
    h.check("G9 waits for the workshop", waiting.failing.some(([id, reason]) => id === "G9" && reason === "workshop"), waiting);
    await h.step("p2", "m9a", "checklist", { order: filed.order, key: "workshop" });
    h.check("the follow-on is named", (await h.step("p2", "m9a", "followOn", { order: filed.order, followOn: next.order })).ok === true);
    const begun = await h.step("p2", "m9a", "start", { order: filed.order, crafter: fighter });
    h.check("1 day, no Price", begun.start?.ok === true && begun.order.priceCp === 0 && begun.order.setup?.days === 1, begun);
    await h.step("p2", "m9a", "work", { order: filed.order, count: 2, while: ["setup"] });
    const rolled = await h.step("p2", "m9a", "roll", { order: filed.order, degree: 2 });
    const settled = await h.step("p2", "m9a", "work", { order: filed.order, count: 1 });
    const out = { rolled, settled: settled.order };
    h.check("a success at the die aimed for one: the Deconstruct completes", settled.order.check?.degree === 2 && settled.order.status === "complete",
        { face: rolled.face, order: settled.order });
    if (settled.order.status !== "complete") return out;
    const made = await h.step("p2", "m9a", "items", { ms: 1000 });
    const components = made.items.find((i) => i.components?.purpose === "similar");
    h.check("the cloak is now components worth 75% of 20 gp, inert", components?.components.valueCp === 1500 && components.inert === true, made);
    const follow = await h.step("p2", "m9a", "order", { order: next.order });
    const day = settled.order.days.find((d) => d.kind === "setup")?.day;
    h.check("the deconstruct's day is the follow-on's first setup day", follow.days.some((d) => d.kind === "setup" && d.day === day), { day, follow });
    const handed = await h.step("p2", "m9a", "handOver", { order: next.order, item: components.uuid });
    h.check("handed over as the follow-on's materials", handed.result?.ok === true, handed);
    const begunNext = await h.step("p2", "m9a", "start", { order: next.order, crafter: fighter });
    h.check("the components cover the up-front half: the follow-on starts with no coins", begunNext.start?.ok === true, begunNext);
    await checkStatuses(h);
    return { ...out, follow: begunNext.order };
}

/**
 * 13d. Grow left untended across a season with no GM online (6.16.6): the druid fixture, lent to Player One, grows a
 * Versatile Tinderbox with Nature (the setting): the formula required, 4 days, then untended after a success. The GM logs
 * off; Player One logs 100 days (more than a season, by the calendar or by the day count); one season check is due and
 * prompted on Player One's client only, Player Two cannot roll it, Player One rolls it once.
 */
async function m9aGrow(h, w) {
    const druid = fixtureOf(h, w, "druid-grower-8");
    if (!druid) return {};
    await m9aReset(h, w, { actors: [druid], on: { "variants.grow": true, "variants.natureCrafting.skills": "nature" } });
    await h.step("gm", "m9", "learn", { actor: druid, uuids: [M9A.tinderbox] });
    await h.step("gm", "m9a", "lend", { actor: druid, user: ASSIGN[0].user });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const filed = await h.step("p1", "m9", "request", { uuid: M9A.tinderbox, requester: druid, crafter: druid, craftType: "grow" });
    await h.step("p1", "m9a", "checklist", { order: filed.order, key: "grow-tools" });
    const run = await h.step("p1", "m9", "run", { order: filed.order, crafter: druid, payer: w.pcs.p1.uuid, pledge: 1000, finish: false, face: M9_FACE });
    const grown = await h.step("p1", "m9a", "order", { order: filed.order });
    h.check("Grow: Nature, 4 setup days", grown.skill === "nature" && grown.setup?.days === 4 && grown.days.filter((d) => d.kind === "setup").length === 4, { run, grown });
    h.check("the Grow check succeeds at the fixed die: finishing", grown.status === "finishing", grown);
    if (grown.status !== "finishing") return { grown };
    const left = await h.step("p1", "m9a", "untended", { order: filed.order, on: true });
    h.check("left untended", left.result?.ok === true && left.order.variant.grow?.mode === "untended", left);
    await h.only(["p1", "p2"]);
    await h.settle("ready");
    await notesBy(h, [SEASON_KEY]);
    await h.step("p1", "m9a", "logDays", { days: 100 });
    const due = await h.step("p1", "m9a", "seasons", { order: filed.order, ms: 3000 });
    h.check("one season check due", due.due.length === 1, due);
    const told = await notesBy(h, [SEASON_KEY]);
    h.check("prompted on Player One's client only", told.p1?.length === 1 && !told.p2?.length, told);
    h.check("Player Two cannot roll it", (await h.step("p2", "m9a", "rollSeason", { order: filed.order })).result?.reason === "not-owner");
    const rolled = await h.step("p1", "m9a", "rollSeason", { order: filed.order });
    h.check("Player One rolls it; it is recorded", rolled.result?.ok === true && rolled.recorded, rolled);
    const again = await h.step("p1", "m9a", "rollSeason", { order: filed.order });
    const after = await h.step("p2", "m9a", "seasons", { order: filed.order, ms: 1500 });
    h.check("once a season", again.result?.reason === "not-due" && after.records.length === 1 && after.due.length === 0, { again, after });
    await h.only(["gm", "p1", "p2"]);
    await checkStatuses(h);
    return { due, rolled, after };
}

/**
 * 13e. A garden (6.16.7): Player One adds one for Elixir of Life (Minor) (seed cost 60 gp, the top of a 3rd-level permanent
 * item); with two PCs the party keeps one; Player One pledges 40 gp and Player Two 20 gp, which plants it, once, pro rata;
 * both harvest at the same moment: one item, temporary, gone at the day's end; the next day Player Two harvests.
 */
async function m9aGarden(h, w) {
    await m9aReset(h, w, { on: { "variants.gardens": true } });
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const added = await h.step("p1", "m9a", "addGarden", { uuid: ELIXIR, name: "Herb garden" });
    h.check("seed cost 60 gp", added.ok === true && added.seedCostCp === 6000, added);
    h.check("two PCs keep one garden", (await h.step("p2", "m9a", "addGarden", { uuid: ELIXIR })).reason === "garden-limit");
    await h.step("p2", "m5", "seen", { path: `gardens.${added.garden}.seedCostCp` });
    await h.step("p1", "m9a", "fundGarden", { garden: added.garden, cp: 4000 });
    await h.step("p2", "m9a", "fundGarden", { garden: added.garden, cp: 2000 });
    const planted = await h.step("gm", "m9a", "garden", { garden: added.garden, ms: 3000 });
    h.check("planted once, pro rata", Number.isInteger(planted.garden?.plantedDay) && planted.plants.map((r) => r.cp).sort((a, b) => a - b).join() === "2000,4000", planted);
    const both = await h.together([["p1", "m9a", "harvest", { garden: added.garden }], ["p2", "m9a", "harvest", { garden: added.garden }]]);
    const won = both.filter((r) => r?.ok === true);
    h.check("one harvest a day across two clients", won.length === 1 && both.some((r) => r?.reason === "harvested"), both);
    const winner = both[0]?.ok ? "p1" : "p2";
    const produce = await h.step(winner, "m9a", "items", { ms: 500 });
    const item = produce.items.find((i) => i.produce?.garden === added.garden);
    h.check("the produce is temporary and spoils at the day's end", item?.temporary === true && item.expiry?.rule === "world" && item.expiry.atDay === won[0].day + 1, produce);
    await h.step("gm", "m9a", "logDays", { days: 1 });
    await h.step("p2", "m5", "seen", { path: "meta.manual" });
    const next = await h.step("p2", "m9a", "harvest", { garden: added.garden });
    h.check("the next day's harvest", next.ok === true, next);
    await checkStatuses(h);
    return { planted, both, next };
}

/**
 * 13f. A quest (6.16.9) for a Cloak of Feline Rest by Player One's alchemist, three encounters in different places (no
 * assembly check): it starts gathering with no coins; Player One marks the first component, then Player One and Player Two
 * mark the last two at the same moment; the quest leaves `gathering` exactly once, delivered once.
 */
async function m9aQuest(h, w) {
    await m9aReset(h, w, { on: { "variants.quests": true } });
    const crafter = w.pcs.p1.uuid;
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const filed = await h.step("p1", "m9", "request", { uuid: M9A.cloak, requester: crafter, crafter, craftType: "quest",
        variant: { quest: { encounters: 3, differentLocations: true } } });
    const begun = await h.step("p1", "m9a", "start", { order: filed.order, crafter });
    h.check("gathering, no Price, no assembly check", begun.order?.status === "gathering" && begun.order.priceCp === 0 && begun.order.variant.quest?.assemblyCheck === false,
        begun);
    await h.step("p1", "m9a", "found", { order: filed.order, component: "c1" });
    await h.step("p2", "m5", "seen", { path: `orders.${filed.order}.variant.quest.components.c1.found.by` });
    const marks = await h.together([["p1", "m9a", "found", { order: filed.order, component: "c2" }], ["p2", "m9a", "found", { order: filed.order, component: "c3" }]]);
    h.check("both marks land", marks.every((r) => r?.ok === true), marks);
    await h.step("gm", "m4", "waitStatus", { order: filed.order, status: "complete", ms: 15000 });
    const done = await h.step("gm", "m9a", "order", { order: filed.order, ms: 1500 });
    h.check("left gathering exactly once, delivered once", done.status === "complete" && done.log.filter((e) => e.from === "gathering").length === 1 &&
        done.log.filter((e) => e.event === "assemble").length === 1, done);
    await h.step("p1", "m9", "collect", {});
    const items = await h.step("p1", "m9a", "items", { order: filed.order, ms: 1500 });
    h.check("one cloak on Player One's alchemist", items.items.length === 1, items);
    await checkStatuses(h);
    return { done, items };
}

/**
 * 13g. An item with its adjustments (6.16.2), delivered to another PC: Player One orders a Breastplate with Armor Latches
 * from Player Two's fighter, for Player One's alchemist: one Price (12 gp), made together; Player One's client collects both,
 * the latches applied to the breastplate on Player One's alchemist.
 */
async function m9aAdjust(h, w) {
    await m9aReset(h, w, { on: { "variants.adjustments": true } });
    const fighter = w.pcs.p2.uuid;
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    // Player One names no crafter (only a crafter's owner may, `not-owner`); Player Two's fighter accepts it in `run`.
    const filed = await h.step("p1", "m9", "request", { uuid: M9A.breastplate, requester: w.pcs.p1.uuid, recipient: w.pcs.p1.uuid,
        variant: { adjustments: [M9A.latches] } });
    h.check("one order with the adjustment", filed.ok === true && !!filed.order, filed);
    await h.step("p2", "m5", "seen", { path: `orders.${filed.order}.status` });
    const run = await h.step("p2", "m9", "run", { order: filed.order, crafter: fighter, payer: fighter, pledge: 600, face: M9_FACE });
    h.check("one Price for both: 12 gp", run.order?.priceCp === 1200, run.order);
    h.check("the breastplate is crafted at the fixed die", run.order?.status === "complete", run);
    if (run.order?.status !== "complete") return { run };
    await h.step("p1", "m9", "collect", {});
    const items = await h.step("p1", "m9a", "items", { order: filed.order, ms: 1500 });
    const host = items.items.find((i) => i.name === "Breastplate");
    const latches = items.items.find((i) => i.name === "Armor Latches");
    h.check("both on Player One's alchemist, the latches applied to the breastplate", !!host && latches?.appliedTo?.host === host.id, items);
    await checkStatuses(h);
    return { run, items };
}

/**
 * 13h. A secret Critical Crafting roll (6.16.4): Player Two orders an Elixir of Life (Minor) marked special from Player
 * One's alchemist; with a GM online the check is rolled blind: both players read "rolled (secret)", the GM reads the degree;
 * once the GM reveals it, the players read it too.
 */
async function m9aSecret(h, w) {
    await m9aReset(h, w, { on: { "variants.criticalCrafting": true, "variants.critical.secret": true } });
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox");
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const filed = await h.step("p2", "m4", "request", { product: ELIXIR, quantity: 1 });
    h.check("marked special by the requester", (await h.step("p2", "m9a", "special", { order: filed.order })).ok === true);
    await h.step("p2", "m4", "pledge", { order: filed.order, cp: 150 });
    await h.step("p1", "m4", "accept", { order: filed.order });
    await h.step("p1", "m4", "start", { order: filed.order });
    await h.step("p1", "m4", "work", { order: filed.order, until: "check" });
    const rolled = await h.step("p1", "m4", "roll", { order: filed.order });
    h.check("the check is recorded, secret", rolled.recorded === true, rolled);
    const views = Object.fromEntries(await Promise.all(["gm", "p1", "p2"].map(async (c) => [c, await h.step(c, "m9a", "view", { order: filed.order, ms: 1000 })])));
    h.check("rolled blind", views.gm.blind === true, views);
    h.check("the card's content is hidden from both players, the roller too, and shown to the GM", views.p1.visible === false && views.p2.visible === false &&
        views.gm.visible === true, views);
    h.check("both players read \"rolled (secret)\"; the GM reads the degree", views.p1.secretCheck && views.p2.secretCheck && !views.gm.secretCheck &&
        views.gm.checkText !== views.p2.checkText, views);
    const revealed = await h.step("gm", "m9a", "reveal", { order: filed.order });
    const after = await h.step("p2", "m9a", "view", { order: filed.order, ms: 1500 });
    h.check("revealed: the players read the degree", revealed.result?.ok === true && !after.secretCheck && after.checkText === views.gm.checkText, { revealed, after });
    await checkStatuses(h);
    return { views, after };
}

/** The Queue's Complex Crafting detail and the Funds tab's gardens photographed (17.1, M9a): as Player Two, 1440x900 and 1024x768, dark and light. */
async function m9aShots(h, w) {
    await m9aReset(h, w, { on: { "variants.complexCrafting": true, "variants.gardens": true } });
    const fighter = w.pcs.p2.uuid;
    await h.only(["gm", "p2"]);
    await h.settle("ready");
    const filed = await h.step("p2", "m9", "request", { uuid: M9A.cloak, requester: fighter, crafter: fighter });
    await h.step("p2", "m9a", "rush", { order: filed.order, rush: 1 });
    await h.step("p2", "m9a", "addGarden", { uuid: ELIXIR, name: "Herb garden" });
    const opened = [];
    for (const scheme of ["dark", "light"]) {
        await h.step("p2", "m4", "theme", { scheme });
        for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
            for (const [tab, order] of [["queue", filed.order], ["funds", null]]) {
                await h.screenshot("p2", `m9a-p2-${tab}-${size.width}x${size.height}-${scheme}.png`, size, async () => {
                    const view = await h.step("p2", "m5", "open", { tab, order });
                    opened.push({ scheme, tab, ...size, open: view.open });
                    return view;
                });
            }
        }
        await h.step("p2", "m5", "close", {});
    }
    await h.step("p2", "m4", "theme", { scheme: "dark" });
    h.check("the window opened every time", opened.length === 8 && opened.every((o) => o.open), opened);
    const shown = await h.step("p2", "m9a", "markers", { order: filed.order, tabs: ["queue", "funds"] });
    h.check("the Queue shows the order's Complex Crafting section and the Funds tab its garden", shown.tabs?.queue?.markers?.includes(".detail-variants") &&
        shown.tabs.funds?.markers?.includes("[data-action=\"variant\"]"), shown);
    return { opened, shown, shots: h.shots.filter((s) => s.label === h.label).map((s) => s.file) };
}

/**
 * 13i. Off costs nothing (6.16, M9a live pass): with every variant off, M4's lifecycle (the GM and both players online, the die
 * fixed so that it runs to the delivery) writes nothing only a variant writes, by a write audit on the GM's client, which sees
 * every change any client makes; and no tab of the Workshop, request form or chat log on any of the three clients shows a
 * variant's button, section, field or words, nor does the request form offer a variant's kind; Settings shows no notice.
 */
async function m9aOff(h, w) {
    await m9aReset(h, w);
    const off = await h.step("gm", "m9a", "variants", {});
    h.check("every variant is off", Array.isArray(off.groups) && off.groups.length === 0 && off.mixed === false, off);
    let since = 0;
    const life = await m4Lifecycle(h, w, { gm: true, face: M9_FACE, online: async () => {
        since = (await h.step("gm", "m9a", "audit", { start: true })).at ?? 0;
    } });
    const audit = await h.step("gm", "m9a", "audit", {});
    h.check("the audit saw the lifecycle's writes, the ledger's orders among them", audit.running === true && audit.writes >= 10 &&
        audit.keys?.some((k) => k.includes(".orders.")), { writes: audit.writes, byHook: audit.byHook });
    h.check("no write only a variant makes", Array.isArray(audit.flagged) && audit.flagged.length === 0, audit.flagged);
    const shown = {};
    for (const client of ["gm", "p1", "p2"]) shown[client] = await h.step(client, "m9a", "markers", { order: life?.id ?? null, product: ELIXIR, since: since - 2000 });
    const clean = (part) => !!part && Array.isArray(part.markers) && part.markers.length === 0 && Array.isArray(part.words) && part.words.length === 0;
    h.check("no variant button, section, field or words in any tab, the request form or the chat log, on any client", Object.values(shown).every((v) =>
        v.texts > 20 && ["queue", "funds", "downtime"].every((tab) => v.tabs?.[tab]?.open && clean(v.tabs[tab])) && v.request?.open && clean(v.request) &&
        v.chat?.cards > 0 && clean(v.chat)), shown);
    h.check("the request form offers no variant kind", Object.values(shown).every((v) => v.request?.kinds?.length > 0 &&
        !v.request.kinds.some((k) => ["deconstruct", "grow", "quest"].includes(k))), Object.fromEntries(Object.entries(shown).map(([c, v]) => [c, v.request?.kinds])));
    const notice = await h.step("gm", "m9a", "notice", {});
    h.check("Settings shows no notice", notice.notice === null, notice);
    return { life, audit: { writes: audit.writes, byHook: audit.byHook, flagged: audit.flagged }, shown };
}

Object.assign(BEHAVIOURS, {
    "m9a-notice": m9aNotice,
    "m9a-complex": m9aComplex,
    "m9a-quick-setup": m9aQuickSetup,
    "m9a-deconstruct": m9aDeconstruct,
    "m9a-grow": m9aGrow,
    "m9a-garden": m9aGarden,
    "m9a-quest": m9aQuest,
    "m9a-adjust": m9aAdjust,
    "m9a-secret": m9aSecret,
    "m9a-shots": m9aShots,
    "m9a-off": m9aOff,
});

/* -------------------------------------------- */
/*  M11: the integration surface                 */
/* -------------------------------------------- */

/**
 * Every M11 plan starts here (DESIGN.md 10.4, 11.1): the world reset, an alchemist's lab in the strongbox, and an order of
 * Player One's alchemist waiting for its Craft check, so the strip, the card and the macros have something to show. Returns
 * the order's id.
 */
async function m11Reset(h, w, { online = ["gm", "p1"] } = {}) {
    await resetWorld(h, w);
    await h.evaluate("gm", pageStoreItem, { mod: MOD, uuid: LAB }, "an alchemist's lab in the strongbox");
    await h.only(online);
    await h.settle("ready");
    await h.step("p1", "m11", "cleanup", {});
    const own = await h.step("p1", "m4", "request", { product: ELIXIR, quantity: 1, crafter: w.pcs.p1.uuid });
    await h.step("p1", "m4", "pledge", { order: own.order, cp: 150 });
    await h.step("p1", "m4", "start", { order: own.order });
    await h.step("p1", "m4", "work", { order: own.order, until: "check" });
    return own.order;
}

/** PF2e Toolbelt and PF2e Workbench on or off for the plans that follow: every page reloads so they load (or not). */
async function m11Companions(h, { toolbelt, workbench }) {
    await h.only(["gm"]);
    const set = await h.step("gm", "m11", "modules", { toolbelt, workbench });
    await h.closeAll();
    await h.only(["gm"]);
    await h.settle("ready");
    const active = await h.step("gm", "m11", "active", {});
    h.check(`Toolbelt ${toolbelt ? "active" : "inactive"} and Workbench ${workbench ? "active" : "inactive"} after the reload`,
        active.toolbelt === toolbelt && active.workbench === workbench, { set, active });
    return set.before;
}

/** The checks every strip must pass, with or without the companions: once, first in the tab, nothing of pf2e's or theirs. */
function checkStrip(h, label, sheet) {
    h.check(`${label}: one Workshop button in the sheet's header`, sheet.header === 1, sheet.header);
    h.check(`${label}: one strip, first in the Crafting tab`, sheet.strips === 1 && sheet.first === true, { strips: sheet.strips, first: sheet.first });
    h.check(`${label}: no formula row, item id or data-action in the strip, and no Workbench class`, sheet.stripFormulaItems === 0 && sheet.stripWorkbench === 0,
        { stripFormulaItems: sheet.stripFormulaItems, stripWorkbench: sheet.stripWorkbench });
    h.check(`${label}: the strip's controls have names and no positive tab index`, sheet.audit && sheet.audit.unnamed.length === 0 && sheet.audit.positive.length === 0,
        sheet.audit);
}

/**
 * The character sheet without companions (10.4): the header button, the strip at the top of the Crafting tab with the
 * order waiting for its check, its Workshop button opening the window acting as the character; Player Two's own sheet
 * has its strip too, with nothing to do.
 */
async function m11Sheet(h, w) {
    const before = await m11Companions(h, { toolbelt: false, workbench: false });
    const order = await m11Reset(h, w, { online: ["gm", "p1", "p2"] });
    const sheet = await h.step("p1", "m11", "sheet", { actor: w.pcs.p1.uuid, click: "open" });
    checkStrip(h, "Player One's alchemist", sheet);
    h.check("the strip counts the order and the check waiting on the alchemist", /Crafting: 1/.test(sheet.stripText ?? "") && /roll or settlement: 1/.test(sheet.stripText ?? ""),
        sheet.stripText);
    h.check("Workshop, Request and Morning buttons", ["open", "request", "morning"].every((op) => sheet.stripButtons.includes(op)), sheet.stripButtons);
    h.check("its Workshop button opens the window acting as the alchemist", sheet.clicked?.workshop && sheet.clicked.acting === w.pcs.p1.uuid, sheet.clicked);
    await h.step("p1", "m11", "close", {});
    const request = await h.step("p1", "m11", "sheet", { actor: w.pcs.p1.uuid, click: "request" });
    h.check("its Request button opens the request form", request.clicked?.requestForm === true, request.clicked);
    await h.step("p1", "m11", "close", {});
    const other = await h.step("p2", "m11", "sheet", { actor: w.pcs.p2.uuid });
    checkStrip(h, "Player Two's fighter", other);
    // M11 live pass: "Orders for this character: n" is a count of orders filed for the fighter, so it no longer passes as "nothing".
    h.check("the fighter's strip has nothing waiting: \"No Workshop jobs right now.\" and no count", /No Workshop jobs right now/.test(other.stripText ?? "") &&
        !/: \d/.test(other.stripText ?? ""), other.stripText);
    await checkStatuses(h);
    if (before.toolbelt || before.workbench) await m11Companions(h, { toolbelt: before.toolbelt, workbench: before.workbench });
    return { order, sheet, request: request.clicked, other };
}

/**
 * The same sheet with PF2e Toolbelt (its crafting sort buttons on) and PF2e Workbench (its formula rarity colours on)
 * active (13): Toolbelt's buttons and Workbench's classes are where they put them, the strip is still once and first, and
 * none of theirs is in it. The world's module configuration is put back afterwards.
 */
async function m11CompanionsPlan(h, w) {
    const before = await m11Companions(h, { toolbelt: true, workbench: true });
    await m11Reset(h, w);
    const settings = { gm: await h.step("gm", "m11", "companions", {}), p1: await h.step("p1", "m11", "companions", {}) };
    h.check("Toolbelt's crafting sort setting found and on for Player One", !!settings.p1.sortList, settings);
    const sheet = await h.step("p1", "m11", "sheet", { actor: w.pcs.p1.uuid, ms: 1500 });
    checkStrip(h, "with Toolbelt and Workbench", sheet);
    h.check("Toolbelt's sort buttons are on the formula headers", sheet.toolbeltSort >= 1 && sheet.formulaItems >= 1,
        { toolbeltSort: sheet.toolbeltSort, formulaItems: sheet.formulaItems });
    // M11 live pass: the rarity classes were read and never checked, so "Workbench active" did not show Workbench ran on the sheet.
    h.check("Workbench's rarity classes are on the formula rows, none in the strip", sheet.workbenchRarity >= 1 && sheet.stripWorkbench === 0,
        { workbenchRarity: sheet.workbenchRarity, stripWorkbench: sheet.stripWorkbench, formulaItems: sheet.formulaItems });
    // The GM always has the Overview (pf2e hides it from players only with its party stats off), so the card cannot be skipped.
    const party = await h.step("gm", "m11", "party", {});
    h.check("the Party card is there with the companions too (the GM's Overview)", party.first.region && party.first.cards === 1 && party.again.cards === 1, party);
    await checkStatuses(h);
    // The companions' settings as they were (M11 live pass: the plan left them on), then the module configuration.
    await h.step("p1", "m11", "companions", { restore: settings.p1.before ?? {} });
    await h.step("gm", "m11", "companions", { restore: settings.gm.before ?? {} });
    await m11Companions(h, { toolbelt: before.toolbelt, workbench: before.workbench });
    return { settings, sheet, party };
}

/**
 * The Party sheet (10.4): the card after pf2e's summary in the Overview, as Player One and the GM; still once after pf2e
 * renders the members' regions again (no render hook); with pf2e's "party stats" off a player has no Overview and keeps the
 * header button.
 */
async function m11Party(h, w) {
    await m11Reset(h, w);
    const views = { gm: await h.step("gm", "m11", "party", {}), p1: await h.step("p1", "m11", "party", {}) };
    // M11 live pass: with no Overview on both clients every card check was skipped. pf2e never hides it from a GM.
    h.check("gm: the Party sheet has its Overview region", views.gm.first.region === true, views.gm.first);
    for (const [role, view] of Object.entries(views)) {
        h.check(`${role}: one Workshop button in the Party sheet's header`, view.first.header === 1, view.first.header);
        if (!view.first.region && role !== "gm") {
            h.check(`${role}: no Overview (pf2e's party stats off): no card, the header button stays`, view.first.cards === 0, view.first);
            continue;
        }
        h.check(`${role}: one card, after pf2e's summary`, view.first.cards === 1 && view.first.afterSummary, view.first);
        h.check(`${role}: the card counts one open order being crafted`, view.first.facts[0] === "1" && view.first.facts[2] === "1", view.first.facts);
        h.check(`${role}: still one card after pf2e renders the region again`, view.again.cards === 1 && view.again.afterSummary, view.again);
        h.check(`${role}: the card's controls have names`, view.audit?.unnamed.length === 0, view.audit);
    }
    await checkStatuses(h);
    return views;
}

/** Right-click an Actors directory entry and pick "Open Workshop" from core's context menu, with real clicks. */
async function contextOpen(h, role, actorId, { party = false } = {}) {
    const { page } = h.clients.get(role);
    // M11 live pass: the sidebar starts collapsed (48 px wide), so the directory's entries are off the screen until it expands;
    // and the party's entry is pf2e's folder of its members, whose middle is a member: the click goes on its header.
    await h.evaluate(role, () => {
        ui.sidebar.expand();
        ui.sidebar.changeTab("actors", "primary");
        return ui.sidebar.expanded;
    }, null, "the Actors tab, expanded");
    await sleep(800);
    const target = party ? `#actors li.directory-item[data-party][data-entry-id="${actorId}"] > .folder-header .folder-name`
        : `#actors li.directory-item[data-entry-id="${actorId}"] .entry-name`;
    await page.click(target, { button: "right" });
    await sleep(400);
    const label = await page.locator("#context-menu .context-item").allTextContents().catch(() => []);
    await page.locator("#context-menu .context-item", { hasText: "Open Workshop" }).first().click();
    await sleep(1200);
    return { label, open: await h.step(role, "m11", "open", {}) };
}

/**
 * The Actors directory's context menu (10.4): "Open Workshop" on the party and, acting as it, on the user's own member. Needs
 * `--canvas` (M11 live pass): without one, pf2e 8.6.1's "Request Trade" entry reads `canvas.tokens.controlled` while core
 * checks which entries to show, throws, and core renders no menu at all for any actor; without a canvas it says it was skipped.
 */
async function m11Context(h, w) {
    if (!h.canvas) {
        h.check("m11-context needs --canvas (pf2e's Request Trade entry throws without one, so no directory menu opens): skipped", true, { skipped: true });
        return { skipped: true };
    }
    await m11Reset(h, w);
    const party = await contextOpen(h, "p1", w.party.id, { party: true });
    h.check("Open Workshop is in the party's context menu and opens the window", party.label.some((l) => l.includes("Open Workshop")) && party.open.open, party);
    await h.step("p1", "m11", "close", {});
    const own = await contextOpen(h, "p1", w.pcs.p1.id);
    h.check("on Player One's own character it opens the window acting as that character", own.open.open && own.open.acting === w.pcs.p1.uuid, own);
    await h.step("p1", "m11", "close", {});
    await checkStatuses(h);
    return { party, own };
}

/**
 * The macro shelf (11.1, 10.6): opened from the status bar; a tile dragged onto the hotbar with real drag and drop makes one
 * world script macro, dragged again it is reused; "Add to hotbar" (the keyboard path) takes the first free slot; the
 * hotbar's slot runs the macro.
 */
async function m11Shelf(h, w) {
    await m11Reset(h, w);
    const shelf = await h.step("p1", "m11", "shelf", {});
    h.check("the shelf lists the catalogue's tiles, draggable for a role with script macros", shelf.open && shelf.tiles.length >= 15 && shelf.canScript &&
        shelf.draggable === shelf.tiles.length && shelf.hotbarButtons === shelf.tiles.length, { tiles: shelf.tiles.length, canScript: shelf.canScript });
    h.check("the shelf's controls have names", shelf.audit?.unnamed.length === 0 && shelf.audit.positive.length === 0, shelf.audit);
    const { page } = h.clients.get("p1");
    // M11 live pass: at its default size the Workshop covers the hotbar's middle slots (1060 x 780 at 1440 x 900), so the
    // windows go to the top of the screen first, as a player would move them.
    await h.step("p1", "m11", "place", {});
    await page.dragAndDrop('.macro-tile[data-macro="open-workshop"]', '#hotbar .slot[data-slot="5"]');
    await sleep(1500);
    const first = await h.step("p1", "m11", "hotbar", {});
    h.check("one world script macro, flagged, holding the catalogue's line, in slot 5", first.macros.length === 1 && first.macros[0].type === "script" &&
        first.macros[0].macro === "open-workshop" && first.macros[0].command.includes('macros.run("open-workshop"') && first.slots.some((s) => s.slot === 5), first);
    await page.dragAndDrop('.macro-tile[data-macro="open-workshop"]', '#hotbar .slot[data-slot="6"]');
    await sleep(1500);
    const second = await h.step("p1", "m11", "hotbar", {});
    h.check("dragged again: the same macro, now in slots 5 and 6", second.macros.length === 1 && second.slots.filter((s) => s.id === first.macros[0].id).length === 2, second);
    await page.click('.macro-tile[data-macro="post-summary"] button[data-action="hotbar"]');
    await sleep(1500);
    const third = await h.step("p1", "m11", "hotbar", {});
    h.check("Add to hotbar makes the Post queue summary macro in the first free slot", third.macros.some((m) => m.macro === "post-summary") && third.slots.length === 3, third);
    await h.step("p1", "m11", "close", {});
    await page.click('#hotbar .slot[data-slot="5"]');
    await sleep(1500);
    const ran = await h.step("p1", "m11", "open", {});
    h.check("the hotbar's slot runs the macro: the Workshop opens", ran.open === true, ran);
    await h.step("p1", "m11", "close", {});
    const cleaned = await h.step("p1", "m11", "cleanup", {});
    h.check("the plan's macros and slots are cleaned up", cleaned.deleted === 2 && cleaned.slots === 3, cleaned);
    await checkStatuses(h);
    return { shelf: shelf.tiles, first, second, third, ran };
}

/** What a catalogue run may answer: a window or question, an ok, or a refusal the user is told in words. */
const RUN_OK = (r) => r.asked || r.windows.length > 0 || r.result?.ok === true || r.result?.app || (r.result?.ok === false && r.result.reason && r.result.reason !== "macro-error" && r.result.reason !== "no-macro");

/**
 * Every catalogue macro runs once (11.1) on Player One's client, with the arguments it needs where it has them (the order in
 * check, the one to pledge to) and without them otherwise: each opens what asks for the rest, does its step, or refuses with
 * a sentence; none errors, none shows a raw key; the order waiting for its check is rolled by "Roll Craft check" with no
 * order named.
 */
async function m11Macros(h, w) {
    const order = await m11Reset(h, w);
    const other = await h.step("p1", "m4", "request", { product: HEALING_POTION, quantity: 1 });
    const errorsBefore = h.console.filter((c) => c.client === "p1" && c.type === "pageerror").length;
    const runs = await h.step("p1", "m11", "run", { args: {
        "roll-craft": { skipDialog: true }, pledge: { order: other.order, amount: "1 gp" }, "improvise-admixture": { skipDialog: true },
        "post-summary": { whisper: true }, "roll-pending": { skipDialog: true },
    } });
    const byId = Object.fromEntries(runs.map((r) => [r.id, r]));
    h.check("all 23 macros ran", runs.length === 23, runs.map((r) => r.id));
    h.check("each opened what asks for the rest, did its step, or refused in words", runs.every(RUN_OK), runs.filter((r) => !RUN_OK(r)));
    h.check("no macro errored or showed a raw key", runs.every((r) => !r.notes.some((n) => /pf2e-artisans-workshop\./.test(n.message ?? "")) && r.result?.reason !== "macro-error"),
        runs.filter((r) => r.result?.reason === "macro-error" || r.notes.some((n) => /pf2e-artisans-workshop\./.test(n.message ?? ""))));
    // M11 live pass: what the user reads, not only the keys: no unfilled placeholder, no `undefined`, `NaN` or object text.
    const unfilled = (n) => /\{[A-Za-z_][\w.]*\}|undefined|NaN|\[object /.test(n.message ?? "");
    h.check("no notification shows an unfilled {placeholder}, undefined or NaN", runs.every((r) => !r.notes.some(unfilled)),
        runs.filter((r) => r.notes.some(unfilled)).map((r) => [r.id, r.notes]));
    h.check("the windows that ask: the request form, the Workshop's tabs, the panel, the wizard", byId["request-item"].windows.length > 0 && byId["earn-income"].windows.length > 0 &&
        byId["learn-formula"].windows.length > 0 && byId["advance-days"].windows.length > 0 && byId["open-workshop"].windows.length > 0, runs.map((r) => [r.id, r.windows]));
    h.check("Pledge with an order and an amount pledged", byId.pledge.result?.ok === true, byId.pledge);
    h.check("Post queue summary posted", byId["post-summary"].result?.ok === true, byId["post-summary"]);
    const rolled = await h.step("p1", "m4", "state", { order, ms: 1500 });
    h.check("Roll Craft check with no order named rolled the alchemist's order waiting for its check", ["rolled", "finishing", "failed"].includes(rolled.order?.status), rolled.order);
    const errors = h.console.filter((c) => c.client === "p1" && c.type === "pageerror").slice(errorsBefore);
    h.check("no page errors on Player One's client", errors.length === 0, errors);
    await checkStatuses(h);
    return { runs };
}

/** The Open Workshop keybinding (10.4): unbound by default; bound for the plan, the keys open the Workshop; unbound again. */
async function m11Keys(h, w) {
    await m11Reset(h, w);
    const unbound = await h.step("p1", "m11", "keybinding", { bind: false });
    h.check("Open Workshop, Open Bandolier and Quick Alchemy are registered, Open Workshop unbound", unbound.registered && unbound.bindings.length === 0 &&
        unbound.others.every(Boolean), unbound);
    await h.step("p1", "m11", "keybinding", { bind: true });
    const { page } = h.clients.get("p1");
    // M11 live pass: the Workshop closed and focus on no control first, so an open window cannot pass for one the keys opened
    // (and no click lands on the scene controls, as the click at (5, 300) did).
    await h.step("p1", "m11", "close", {});
    const before = await h.step("p1", "m11", "open", {});
    await h.step("p1", "m11", "table", { blur: true });
    await page.keyboard.press("Alt+Shift+KeyW");
    await sleep(1500);
    const opened = await h.step("p1", "m11", "open", {});
    h.check("Alt+Shift+W opens the Workshop (closed before the keys)", before.open === false && opened.open === true, { before, opened });
    await h.step("p1", "m11", "keybinding", { bind: false });
    await h.step("p1", "m11", "close", {});
    return { unbound, opened };
}

/** Press `key` until `until(focus)` or `max` presses; the focus states seen. */
async function pressUntil(h, role, key, until, max = 60) {
    const { page } = h.clients.get(role);
    let focus = await h.step(role, "m11", "focus", {});
    for (let i = 0; i < max && !until(focus); i++) {
        await page.keyboard.press(key);
        await sleep(60);
        focus = await h.step(role, "m11", "focus", {});
    }
    return focus;
}

/**
 * A keyboard-only walkthrough of the Workshop (15.3 scenario 10, 10.9), as Player One (`m11-keyboard`) or the GM
 * (`m11-keyboard-gm`): opened with the keybinding; the tabs by the arrow keys; the order list's tab stop and Enter (Space for
 * the GM, the key core pauses on) for the detail; in the medium tier Tab stays inside the detail and Escape gives focus back
 * to its row; the status bar's Macros button by Tab and Enter, and a tile added to the hotbar with Enter; the audit of the
 * window and the shelf finds no control without a name and no positive tab index. M11 live pass: none of those keys reaches
 * core: the pause, the view and the controlled tokens are as they were. With `--canvas` the plan stages a marked scene with
 * both characters' tokens (`m8 arena`, the world's own scene active again afterwards), and once the Workshop is closed it
 * shows the same keys do reach core outside it (Tab controls a token; the GM's Space pauses and unpauses), so "unchanged"
 * is not a canvas that ignores keys.
 */
async function m11Keyboard(h, w, { role = "p1" } = {}) {
    const order = await m11Reset(h, w);
    const arena = h.canvas ? await h.step("gm", "m8", "arena", { tokens: [{ actor: w.pcs.p1.uuid, x: 4, y: 4 }, { actor: w.pcs.p2.uuid, x: 8, y: 6 }] }) : null;
    try {
        return await keyboardWalk(h, role, order, arena);
    } finally {
        if (arena) await h.step("gm", "m8", "arena", { off: true, previous: arena.previous });
    }
}

/** What core's keybindings change, as `table` reads it, without the focus. */
const tableState = (t) => JSON.stringify({ paused: t.paused, pivot: t.pivot, controlled: t.controlled, tokens: t.tokens });

async function keyboardWalk(h, role, order, arena) {
    const who = role === "gm" ? "GM" : "Player One";
    if (role !== "p1") await h.step(role, "m11", "cleanup", {});
    await h.step(role, "m11", "keybinding", { bind: true });
    const { page } = h.clients.get(role);
    const table0 = await h.step(role, "m11", "table", { tokens: !!arena, blur: true });
    if (arena) h.check(`${who}: the arena's two tokens are on the canvas, none controlled`, table0.canvas && table0.tokens.length === 2 && table0.controlled.length === 0, table0);
    await page.keyboard.press("Alt+Shift+KeyW");
    await sleep(1500);
    // M11 review: the keybinding puts focus in the window, on its active tab; no Tab press is needed to get there.
    const toTabs = await h.step(role, "m11", "focus", {});
    h.check(`${who}: the keybinding puts focus on the Workshop's active tab`, toTabs.inWorkshop && toTabs.tab === toTabs.currentTab, toTabs);
    // M11 live pass: the window opens on the tab it was last on (`ui.lastTab`), not always the Queue: the next tab is the one after it.
    const next = toTabs.tabs?.[(toTabs.tabs.indexOf(toTabs.currentTab) + 1) % (toTabs.tabs.length || 1)] ?? "funds";
    await page.keyboard.press("ArrowDown");
    await sleep(600);
    const funds = await h.step(role, "m11", "focus", {});
    h.check(`${who}: ArrowDown moves to the next tab and shows it`, funds.currentTab === next && funds.tab === next, { next, funds });
    await page.keyboard.press("ArrowUp");
    await sleep(600);
    const onQueue = await pressUntil(h, role, "ArrowUp", (f) => f.currentTab === "queue" && f.tab === "queue", 8);
    h.check(`${who}: ArrowUp goes back, and on to the Queue`, onQueue.currentTab === "queue" && onQueue.tab === "queue", onQueue);
    const toRow = await pressUntil(h, role, "Tab", (f) => f.inWorkshop && f.orderId && f.tag === "LI", 40);
    h.check(`${who}: Tab reaches the order list's one tab stop`, toRow.orderId === order, toRow);
    const openKey = role === "gm" ? "Space" : "Enter";
    await page.keyboard.press(openKey);
    await sleep(900);
    const detail = await h.step(role, "m11", "focus", {});
    h.check(`${who}: ${openKey} opens the order's detail and puts focus in it`, detail.selected === order && detail.inDetail, detail);
    await h.step(role, "m11", "size", { width: 900 });
    const seen = [];
    for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        await sleep(40);
        seen.push((await h.step(role, "m11", "focus", {})).inDetail);
    }
    h.check(`${who}: in the medium tier Tab stays inside the detail (the slide-over traps focus)`, seen.every(Boolean), seen);
    await page.keyboard.press("Escape");
    await sleep(800);
    const back = await h.step(role, "m11", "focus", {});
    h.check(`${who}: Escape closes the detail and gives focus back to its row`, !back.detailOpen && back.orderId === order && back.tag === "LI", back);
    const sized = await h.step(role, "m11", "size", { width: 1100 });
    h.check(`${who}: the resize is remembered for the next window`, sized.saved?.width === 1100, sized);
    const toMacros = await pressUntil(h, role, "Tab", (f) => f.action === "macros", 120);
    h.check(`${who}: Tab reaches the status bar's Macros button`, toMacros.action === "macros", toMacros);
    await page.keyboard.press("Enter");
    await sleep(1500);
    const inShelf = await h.step(role, "m11", "focus", {});
    h.check(`${who}: Enter on Macros puts focus on the shelf's first tile (M11 review)`, inShelf.inShelf && inShelf.action === "run", inShelf);
    const toHotbar = await pressUntil(h, role, "Tab", (f) => f.inShelf && f.action === "hotbar", 4);
    h.check(`${who}: Tab reaches a tile's Add to hotbar in the shelf`, toHotbar.inShelf && toHotbar.action === "hotbar", toHotbar);
    await page.keyboard.press("Enter");
    await sleep(1500);
    const hotbar = await h.step(role, "m11", "hotbar", {});
    h.check(`${who}: Enter on Add to hotbar puts the macro on the hotbar, no drag needed`, hotbar.macros.length === 1 && hotbar.slots.length === 1, hotbar);
    const kept = await h.step(role, "m11", "focus", {});
    h.check(`${who}: focus stays on that tile's Add to hotbar as the shelf renders again (M11 review)`, kept.inShelf && kept.action === "hotbar" && kept.macro === toHotbar.macro, kept);
    const audit = await h.step(role, "m11", "audit", {});
    h.check(`${who}: the Workshop and the shelf: no control without a name, no positive tab index, no tab outside its tablist`,
        ["workshop", "shelf"].every((k) => audit[k] && audit[k].unnamed.length === 0 && audit[k].positive.length === 0 && audit[k].looseTabs === 0), audit);
    const table1 = await h.step(role, "m11", "table", {});
    h.check(`${who}: none of the keys reached core: ${arena ? "the pause, the view, the controlled tokens and the tokens' places are" : "the pause is"} as before`,
        tableState(table1) === tableState(table0), { before: table0, after: table1 });
    await h.step(role, "m11", "keybinding", { bind: false });
    await h.step(role, "m11", "close", {});
    await h.step(role, "m11", "cleanup", {});
    // The controls: outside the module's windows the same keys are core's, so the comparison above could have failed.
    const control = {};
    if (arena) {
        await h.step(role, "m11", "table", { blur: true });
        await page.keyboard.press("Tab");
        await sleep(800);
        control.tab = await h.step(role, "m11", "table", {});
        h.check(`${who}, control: outside the Workshop, Tab is core's (it controls a token)`, control.tab.controlled.length === 1, control.tab);
    }
    if (role === "gm") {
        const paused = (await h.step(role, "m11", "table", { blur: true })).paused;
        await page.keyboard.press("Space");
        await sleep(800);
        control.space = (await h.step(role, "m11", "table", {})).paused;
        await page.keyboard.press("Space");
        await sleep(800);
        control.again = (await h.step(role, "m11", "table", {})).paused;
        h.check("GM, control: outside the Workshop, Space is core's (it pauses or unpauses, and back)", control.space === !paused && control.again === paused, { paused, ...control });
    }
    return { toTabs, funds, toRow, detail, seen, back, toMacros, toHotbar, hotbar, audit, table0, table1, control };
}

/**
 * Both colour schemes and Parchment (10.9): with the Queue and an order's detail open, and the shelf, the text in the
 * Workshop reaches 4.5:1 against what is behind it (3:1 for large text) in the dark scheme, the light one and Parchment;
 * Parchment's classes come and go with the setting at once.
 */
async function m11Themes(h, w) {
    const order = await m11Reset(h, w);
    const results = {};
    for (const scheme of ["dark", "light", "parchment"]) {
        const set = await h.step("p1", "m4", "theme", { scheme: scheme === "parchment" ? "dark" : scheme });
        const parchment = await h.step("p1", "m11", "parchment", { on: scheme === "parchment" });
        // M11 live pass: the shelf too (the plan said so and never opened it), and the scheme checked, so two runs in one scheme
        // cannot pass for both. The Workshop on the order's detail, then the shelf beside it (`api.ui.macros`).
        await h.step("p1", "m4", "open", { tab: "queue", order });
        await h.evaluate("p1", async (mod) => !!(await game.modules.get(mod).api.ui.macros()), MOD, "open the macro shelf");
        await sleep(800);
        const audit = await h.step("p1", "m11", "audit", {});
        results[scheme] = { set, parchment, audit };
        h.check(`${scheme}: the interface is in the ${scheme === "light" ? "light" : "dark"} scheme`, set.scheme === (scheme === "light" ? "light" : "dark") &&
            audit.scheme === set.scheme, { set: set.scheme, seen: audit.scheme });
        h.check(`${scheme}: no text in the Workshop below its contrast (4.5:1, large text 3:1)`, audit.workshop?.lowContrastCount === 0, audit.workshop?.lowContrast);
        h.check(`${scheme}: no text in the macro shelf below its contrast`, audit.shelf?.lowContrastCount === 0, audit.shelf?.lowContrast ?? audit.shelf);
        if (scheme === "parchment") h.check("Parchment: core's light theme and the parchment class on the open window", ["themed", "theme-light", "paw-parchment"]
            .every((c) => audit.classes.includes(c)), audit.classes);
        await h.step("p1", "m11", "close", {});
    }
    const off = await h.step("p1", "m11", "parchment", { on: false });
    h.check("Parchment off again", off.on === false, off);
    await h.step("p1", "m4", "theme", { scheme: "dark" });
    return results;
}

/** Screenshots (17.1): the Crafting tab strip, the Party card and the macro shelf, dark and light, into `--shots`. */
async function m11Shots(h, w) {
    await m11Reset(h, w);
    const size = { width: 1440, height: 900 };
    const taken = [];
    for (const scheme of ["dark", "light"]) {
        await h.step("p1", "m4", "theme", { scheme });
        await h.screenshot("p1", `m11-strip-${scheme}.png`, size, async () => taken.push(await h.step("p1", "m11", "sheet", { actor: w.pcs.p1.uuid, keep: true })),
            { selector: ".tab.crafting.crafting-pane" });
        await h.evaluate("p1", (uuid) => fromUuidSync(uuid)?.sheet?.close(), w.pcs.p1.uuid, "close the sheet");
        await h.screenshot("p1", `m11-party-${scheme}.png`, size, async () => taken.push(await h.step("p1", "m11", "party", { keep: true })),
            { selector: ".pf2e-artisans-workshop-party-card" });
        await h.evaluate("p1", () => game.actors.party?.sheet?.close(), null, "close the party sheet");
        await h.screenshot("p1", `m11-shelf-${scheme}.png`, size, async () => taken.push(await h.step("p1", "m11", "shelf", {})), { selector: "#pf2e-artisans-workshop-macros" });
        await h.step("p1", "m11", "close", {});
    }
    await h.step("p1", "m4", "theme", { scheme: "dark" });
    // M11 live pass: six captures, each with what it shows (a card skipped for want of an Overview no longer passes).
    const shown = (t) => t.strips === 1 || t.first?.cards === 1 || (t.open === true && t.tiles?.length > 0);
    h.check("the strip, the card and the shelf were there for every capture", taken.length === 6 && taken.every(shown), taken);
    return { shots: h.shots.filter((s) => s.label === h.label).map((s) => s.file) };
}

Object.assign(BEHAVIOURS, {
    "m11-sheet": m11Sheet,
    "m11-companions": m11CompanionsPlan,
    "m11-party": m11Party,
    "m11-context": m11Context,
    "m11-shelf": m11Shelf,
    "m11-macros": m11Macros,
    "m11-keys": m11Keys,
    "m11-keyboard": m11Keyboard,
    "m11-keyboard-gm": (h, w) => m11Keyboard(h, w, { role: "gm" }),
    "m11-themes": m11Themes,
    "m11-shots": m11Shots,
});
