/**
 * A small fake of the Foundry globals the storage-and-sync code touches, for `node --test`.
 *
 * It models what M2 relies on (DESIGN.md 5, verified against Foundry 14.368):
 * - documents with flags, ownership and `update`/`delete`, embedded items and journal pages;
 * - key-path updates into flags with `_del` (delete the key) and `_replace` (no merge), merged otherwise; a dotted
 *   key anywhere inside stored data, arrays included, is expanded into nested objects, as core's
 *   `ObjectField#_cleanType` does to flags on every create and update (14.368 `common/data/fields.mjs`);
 * - pre-hooks that cancel a deletion, and all-client hooks after each change;
 * - `foundry.documents.modifyBatch` as the 14.368 client and server run it. The client first runs each
 *   operation as a dry run through its document class: pf2e's `ItemPF2e.deleteDocuments` drops the ids of items
 *   the actor no longer holds, core throws for an update (or another deletion) of a document it does not have,
 *   and operations left empty are not sent. The server then dry-runs every operation and refuses the whole batch
 *   if one fails, otherwise it applies the operations in order, stopping at the first error and returning one
 *   result per operation applied. Of a refused batch the client, like 14.368's, replays the dry-run results that
 *   passed: a world-level operation fires its hook with `options.dryRun` (changing nothing, as an update dry run
 *   commits nothing) and returns its documents; an embedded one fails on the client with core's "A parent Document
 *   provided to the database operation must be a Document instance" (the server's dry-run result keeps a parent the
 *   client cannot use), shown as an error, with no hook and no result. A page or item id that exists already, or an item to delete or
 *   update that does not, is an error. `world.client.beforeSend(operations)` lands a change on this client
 *   before its dry run, `world.server.beforeDryRun(operations)` one on the server before its dry run, and
 *   `world.server.beforeApply(index, operation)` one between the server's operations.
 * - item and journal updates bump `_stats.modifiedTime`, as the server does on every write.
 * - time as 14.368 gives it: `game.world.lastPlayed` is when the server launched the world (`world.launch`, to the
 *   second, as `Date#toString` writes it), and `game.time.serverTime` counts the milliseconds since; a test moves
 *   to another launch by setting `world.launch`. `serverStamp(agoMs)` is the `at` of a stamp written `agoMs` ago.
 *   `controlClock(t)` hands a test the server's clock and this client's skew from it: `Date.now()` is the client's
 *   clock, while `serverTime` follows the server's, as core's `GameTime#serverTime` does (the server time at the last
 *   sync plus the client's elapsed time, `client/helpers/time.mjs`), so a client whose clock is wrong still has it.
 * - `game.socket`, connected; `world.disconnect()` drops the connection for a moment, as socket.io reports it.
 * - two clients at once: `interleave` lets another client's work (`asUser`) reach the server ahead of a request.
 *
 * `installFoundry()` sets the globals once per test file; `resetWorld()` empties the world before each test.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";

export const MOD = MODULE_ID;
export const OWNER = 3;
export const LIMITED = 1;

/** The `_del` operator and the `_replace` wrapper, as markers the fake update understands. */
export const DELETION = Object.freeze({ deletion: true });
const REPLACED = Symbol("replaced");
export const replaced = (value) => ({ [REPLACED]: value });

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && v !== DELETION && !(REPLACED in v);
const clone = (v) => (v === undefined ? v : structuredClone(v));

/** Dotted keys expanded at every depth, arrays included, as core cleans the flags it stores. */
function expandDeep(value) {
    if (Array.isArray(value)) return value.map(expandDeep);
    if (!isPlain(value)) return value;
    const out = {};
    for (const [key, v] of Object.entries(value)) {
        const path = key.split(".");
        let target = out;
        for (const segment of path.slice(0, -1)) target = isPlain(target[segment]) ? target[segment] : (target[segment] = {});
        const last = path.at(-1);
        const inner = expandDeep(v);
        target[last] = isPlain(target[last]) && isPlain(inner) ? { ...target[last], ...inner } : inner;
    }
    return out;
}

/** Merge `value` into `target[key]`, applying the operators. */
function mergeInto(target, key, value) {
    if (value === DELETION) delete target[key];
    else if (value && typeof value === "object" && REPLACED in value) target[key] = clone(value[REPLACED]);
    else if (isPlain(value)) {
        if (!isPlain(target[key])) target[key] = {};
        for (const [k, v] of Object.entries(value)) mergeInto(target[key], k, v);
    } else target[key] = clone(value);
}

/** A flat update (`{"a.b.c": value}`) as a nested object, as Foundry's `expandObject` makes it. */
export function expand(update) {
    const out = {};
    for (const [key, value] of Object.entries(update)) {
        if (key === "_id") continue;
        const path = key.split(".");
        let target = out;
        for (const segment of path.slice(0, -1)) target = isPlain(target[segment]) ? target[segment] : (target[segment] = {});
        target[path.at(-1)] = value;
    }
    return out;
}

/** A Foundry-like Collection: a Map that iterates its values. */
export class FakeCollection extends Map {
    [Symbol.iterator]() { return this.values(); }
    get contents() { return [...this.values()]; }
    filter(fn) { return this.contents.filter(fn); }
    map(fn) { return this.contents.map(fn); }
    find(fn) { return this.contents.find(fn); }
    some(fn) { return this.contents.some(fn); }
}

export const world = {};
let nextId = 0;
const newDocId = () => `doc${String(nextId++).padStart(13, "0")}`;

class FakeDocument {
    constructor(documentName, data, parent = null) {
        Object.assign(this, { flags: {}, ownership: { default: 0 }, ...clone(data) });
        this.flags = expandDeep(this.flags);
        this.documentName = documentName;
        this.id = this._id ?? newDocId();
        delete this._id;
        this.parent = parent;
        this._stats ??= { createdTime: nextId, modifiedTime: nextId };
        this._source = { folder: this.folder ?? null };
        world.uuids.set(this.uuid, this);
    }
    get uuid() { return this.parent ? `${this.parent.uuid}.${this.documentName}.${this.id}` : `${this.documentName}.${this.id}`; }
    get collection() { return this.parent ? this.parent.embedded(this.documentName) : world.collections[this.documentName]; }
    testUserPermission(user, level) {
        const owner = this.parent ?? this;
        const levels = { OWNER, LIMITED, OBSERVER: 2 };
        return user.isGM || (owner.ownership[user.id] ?? owner.ownership.default) >= (levels[level] ?? level);
    }
    get isOwner() { return this.testUserPermission(game.user, "OWNER"); }
    /** Apply an update now and fire the update hook, as the client does when the server's answer arrives. */
    applyUpdate(update, options = {}) {
        for (const [key, value] of Object.entries(expand(update))) mergeInto(this, key, expandDeep(value));
        this._stats.modifiedTime = (this._stats.modifiedTime ?? 0) + 1;
        if (update["ownership.default"] !== undefined) this.ownership.default = update["ownership.default"];
        Hooks.callAll(`update${this.documentName}`, this, expand(update), options, game.user.id);
        return this;
    }
    async update(update, options = {}) {
        world.calls.push(["update", this.documentName, this.id, update, options]);
        return this.applyUpdate(update, options);
    }
    async delete(options = {}) {
        if (Hooks.call(`preDelete${this.documentName}`, this, options, game.user.id) === false) return undefined;
        world.calls.push(["delete", this.documentName, this.id]);
        this.collection.delete(this.id);
        Hooks.callAll(`delete${this.documentName}`, this, options, game.user.id);
        return this;
    }
    toObject() {
        const source = { ...this, _id: this.id };
        for (const key of ["documentName", "parent", "id", "items", "pages", "query"]) delete source[key];
        return clone(source);
    }
}

class FakeItem extends FakeDocument {
    constructor(data, parent) { super("Item", { system: {}, ...data }, parent); }
    get isCoinage() { return this.type === "treasure" && this.system.category === "coin"; }
    get unit() { return this.system.unit ?? null; }
    get quantity() { return this.system.quantity ?? 1; }
    get slug() { return this.system.slug ?? null; }
}

class FakeActor extends FakeDocument {
    constructor(data) {
        super("Actor", { type: "character", system: {}, ...data, items: undefined });
        this.items = new FakeCollection();
        for (const item of data.items ?? []) this.addItem(item);
    }
    embedded(name) { return name === "Item" ? this.items : null; }
    addItem(data) {
        const item = new FakeItem(data, this);
        this.items.set(item.id, item);
        return item;
    }
    get itemTypes() {
        return { treasure: this.items.filter((i) => i.type === "treasure"), feat: this.items.filter((i) => i.type === "feat") };
    }
    async createEmbeddedDocuments(_name, data) { return data.map((d) => this.addItem(d)); }
    async updateEmbeddedDocuments(_name, updates) {
        world.calls.push(["updateEmbedded", this.id, updates]);
        return updates.map((u) => this.items.get(u._id).applyUpdate(u));
    }
}

class FakeJournal extends FakeDocument {
    constructor(data) {
        super("JournalEntry", { ...data, pages: undefined });
        this.pages = new FakeCollection();
    }
    embedded(name) { return name === "JournalEntryPage" ? this.pages : null; }
    async createEmbeddedDocuments(_name, data, { keepId = false } = {}) {
        if (keepId && data.some((d) => this.pages.has(d._id))) throw new Error("The _id already exists within the parent collection");
        return data.map((d) => {
            const page = new FakeDocument("JournalEntryPage", d, this);
            this.pages.set(page.id, page);
            return page;
        });
    }
    async updateEmbeddedDocuments(_name, updates) { return updates.map((u) => this.pages.get(u._id).applyUpdate(u)); }
}

const CLASSES = { Actor: FakeActor, JournalEntry: FakeJournal };

/** Create a world document of a kind, registered in its collection. */
export function addDocument(kind, data) {
    const doc = CLASSES[kind] ? new CLASSES[kind](data) : new FakeDocument(kind, data);
    world.collections[kind].set(doc.id, doc);
    return doc;
}

/** A coin stack's item data. */
export const coin = (unit, quantity, extra = {}) => ({ type: "treasure", name: unit, system: { category: "coin", unit, quantity }, ...extra });

/* -------------------------------------------- */
/*  The batch server                             */
/* -------------------------------------------- */

function payloadOf(op) {
    return op.data ?? op.updates ?? op.ids ?? [];
}

function collectionOf(op) {
    if (op.documentName === "JournalEntry") return world.collections.JournalEntry;
    return op.parent.embedded(op.documentName);
}

/** The error an operation would raise against the current state, or null. */
function problem(op) {
    const collection = collectionOf(op);
    const ids = op.action === "create" ? op.data.map((d) => d._id).filter(Boolean) : op.action === "update" ? op.updates.map((u) => u._id) : op.ids;
    if (op.action === "create") return op.keepId && ids.some((id) => collection.has(id)) ? "The _id already exists within the parent collection" : null;
    return ids.some((id) => !collection.has(id)) ? "does not exist" : null;
}

function apply(op) {
    const collection = collectionOf(op);
    if (op.action === "update") return op.updates.map((u) => collection.get(u._id).applyUpdate(u, op));
    if (op.action === "delete") {
        return op.ids.map((id) => {
            const doc = collection.get(id);
            collection.delete(id);
            Hooks.callAll(`delete${op.documentName}`, doc, op, game.user.id);
            return doc;
        });
    }
    if (op.documentName === "JournalEntryPage") {
        return op.data.map((d) => {
            const page = new FakeDocument("JournalEntryPage", d, op.parent);
            collection.set(page.id, page);
            return page;
        });
    }
    return op.data.map((d) => {
        const item = op.parent.addItem(d);
        Hooks.callAll("createItem", item, op, game.user.id);
        return item;
    });
}

/**
 * The client's dry run of a batch before sending it: pf2e drops item ids the actor no longer holds; core throws
 * for any other operation on a document it does not have. Returns the operations it would send.
 */
function clientPreRun(operations) {
    for (const op of operations) {
        if (op.action === "create") continue;
        const collection = collectionOf(op);
        if (op.action === "delete" && op.documentName === "Item") {
            op.ids = op.ids.filter((id) => collection.has(id));
            continue;
        }
        const missing = (op.ids ?? op.updates.map((u) => u._id)).find((id) => !collection.has(id));
        if (missing) throw new Error(`${op.documentName} "${missing}" does not exist`);
    }
    return operations.filter((op) => payloadOf(op).length > 0);
}

/** What the client and the batch server do; the `world.client` and `world.server` hooks land changes in between. */
export async function modifyBatch(operations) {
    world.client.beforeSend?.(operations);
    const ops = clientPreRun(operations);
    if (!ops.length) return [];
    world.batches.push(ops);
    world.server.beforeDryRun?.(ops);
    const dryRun = ops.map(problem);
    if (dryRun.some(Boolean)) {
        const results = [];
        ops.forEach((op, i) => {
            if (dryRun[i]) {
                ui.notifications.error(dryRun[i]);
                return;
            }
            if (op.parent) {
                ui.notifications.error("A parent Document provided to the database operation must be a Document instance");
                return;
            }
            const doc = collectionOf(op).get(op.updates?.[0]?._id);
            Hooks.callAll(`${op.action}${op.documentName}`, doc, ...(op.action === "update" ? [{}] : []), { dryRun: true }, game.user.id);
            results.push([doc]);
        });
        return results;
    }
    const results = [];
    for (let i = 0; i < ops.length; i++) {
        world.server.beforeApply?.(i, ops[i]);
        const error = problem(ops[i]);
        if (error) {
            ui.notifications.error(error);
            break;
        }
        results.push(apply(ops[i]));
    }
    return results;
}

/* -------------------------------------------- */
/*  Globals                                      */
/* -------------------------------------------- */

/** Users: `{id, name, isGM, active, role, character}`; the first is the current user unless `current` is given. */
export function setUsers(users, current = users[0].id) {
    world.collections.User.clear();
    for (const { character = null, ...u } of users) {
        const user = addDocument("User", { role: u.isGM ? 4 : 1, active: true, ...u, _id: u.id });
        user.character = character;
        user.query = (...args) => world.queries.push([user.id, ...args]) && world.queryAnswer?.(user, ...args);
    }
    world.currentUser = current;
    for (const user of world.collections.User) Object.defineProperty(user, "isSelf", { get: () => user.id === world.currentUser, configurable: true });
}

function users() {
    const collection = world.collections.User;
    Object.defineProperty(collection, "activeGM", {
        configurable: true,
        get: () => collection.filter((u) => u.active && u.isGM).sort((a, b) => b.role - a.role || (a.id < b.id ? -1 : 1))[0] ?? null,
    });
    return collection;
}

/** A launch an hour before `now`, on a whole second (`game.world.lastPlayed` keeps no milliseconds). */
const launchBefore = (now) => Math.floor(now / 1000) * 1000 - 60 * 60 * 1000;

/** The `at` of a stamp written `agoMs` ago in the current launch, as `stampNow` writes it (DESIGN.md 4.1). */
export function serverStamp(agoMs = 0) {
    const now = Date.now();
    return { world: 1000, real: now - agoMs, server: now - world.launch - agoMs, launch: world.launch };
}

/**
 * Put the clocks in the test's hands until it ends: `clock.server` is the server's clock (ms), `clock.skew` how far
 * this client's clock (`Date.now()`) runs ahead of it. `game.time.serverTime` follows the server's clock.
 * @returns {{server: number, skew: number}}
 */
export function controlClock(t, server = Date.now()) {
    const clock = { server, skew: 0 };
    t.mock.method(Date, "now", () => clock.server + clock.skew);
    world.clock = clock;
    return clock;
}

/** `action` run as `user` (another client), to the end, then back to the user who was current. */
export const asUser = (user, action) => async () => {
    const me = world.currentUser;
    world.currentUser = user;
    try {
        return await action();
    } finally {
        world.currentUser = me;
    }
};

/**
 * Two clients racing to the server: hold the first request `match` picks out at the server's door, run `first`
 * (another client's work, e.g. `asUser`) to the end, then let the request through, so `first` gets there first.
 * Every client then has a coin mutex of its own, as two devices do. Returns a function that puts the server back.
 */
export function interleave(match, first) {
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_name, task) => task() } }, configurable: true });
    const real = globalThis.foundry.documents.modifyBatch;
    let held = false;
    globalThis.foundry.documents.modifyBatch = (operations) => {
        if (held || !match(operations)) return real(operations);
        held = true;
        return first().then(() => real(operations));
    };
    return () => { globalThis.foundry.documents.modifyBatch = real; };
}

/** Drop the connection for a moment: socket.io's "disconnect", which clears every acknowledgement in flight. */
export function disconnect() {
    for (const fn of [...(world.socketHandlers.get("disconnect") ?? [])]) fn("transport close");
}

/** Empty the world: documents, settings, hooks, notifications and recorded calls. */
export function resetWorld() {
    nextId = 0;
    Object.assign(world, {
        collections: { Actor: new FakeCollection(), JournalEntry: new FakeCollection(), Item: new FakeCollection(),
            User: new FakeCollection(), Folder: new FakeCollection(), ChatMessage: new FakeCollection() },
        uuids: new Map(), calls: [], batches: [], notes: [], queries: [], server: {}, client: {}, settings: new Map(),
        dialog: null, queryAnswer: null, hooks: new Map(), currentUser: null, launch: launchBefore(Date.now()),
        socketHandlers: new Map(), clock: null,
    });
    setUsers([{ id: "gm00000000000000", name: "GM", isGM: true }]);
}

export function installFoundry() {
    globalThis._del = DELETION;
    globalThis._replace = replaced;
    globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED, OBSERVER: 2, OWNER } };
    globalThis.CONFIG = { queries: {} };
    globalThis.Hooks = {
        on(name, fn) { (world.hooks.get(name) ?? world.hooks.set(name, []).get(name)).push(fn); return fn; },
        once(name, fn) { return this.on(name, fn); },
        off(name, fn) { const list = world.hooks.get(name) ?? []; if (list.includes(fn)) list.splice(list.indexOf(fn), 1); },
        call(name, ...args) { return (world.hooks.get(name) ?? []).every((fn) => fn(...args) !== false); },
        callAll(name, ...args) { for (const fn of [...(world.hooks.get(name) ?? [])]) fn(...args); return true; },
    };
    globalThis.ui = { notifications: Object.fromEntries(["info", "warn", "error"].map((level) => [level, (message, options) => world.notes.push([level, message, options])])) };
    globalThis.fromUuid = async (uuid) => world.uuids.get(uuid) ?? world.compendium?.[uuid] ?? null;
    globalThis.fromUuidSync = (uuid) => world.uuids.get(uuid) ?? null;
    const documentClass = (kind) => ({ implementation: {
        create: async (data) => {
            const doc = addDocument(kind, data);
            if (kind === "Actor" && data.type === "loot") doc.ownership = { ...doc.ownership, default: LIMITED };   // pf2e's override
            world.calls.push(["create", kind, doc.id]);
            return doc;
        },
        updateDocuments: async (updates, options) => updates.map((u) => world.collections[kind].get(u._id).applyUpdate(u, options)),
    } });
    for (const kind of ["Actor", "JournalEntry", "Item", "User", "Folder", "ChatMessage"]) globalThis[kind] = documentClass(kind);
    globalThis.foundry = {
        utils: {
            deepClone: clone,
            setProperty: (object, path, value) => { const keys = path.split("."); const last = keys.pop(); let t = object; for (const k of keys) t = t[k] ??= {}; t[last] = value; },
            escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
            debounce: (fn) => fn,
            mergeObject: (a, b) => ({ ...a, ...b }),
            isElementInstanceOf: () => true,
            flattenObject: (o, prefix = "") => Object.entries(o).reduce((flat, [k, v]) => (isPlain(v) ? Object.assign(flat, globalThis.foundry.utils.flattenObject(v, `${prefix}${k}.`)) : Object.assign(flat, { [`${prefix}${k}`]: v })), {}),
        },
        documents: { modifyBatch: (operations) => modifyBatch(operations) },
        applications: {
            api: {
                ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {},
                DialogV2: { wait: async (config) => world.dialog?.(config) ?? null },
            },
            handlebars: { renderTemplate: async (path, data) => world.render?.(path, data) ?? "", loadTemplates: async () => [] },
            ux: { FormDataExtended: class { constructor(form) { this.object = form.values; } } },
        },
    };
    globalThis.game = {
        get user() { return world.collections.User.get(world.currentUser); },
        get users() { return users(); },
        get actors() { return world.collections.Actor; },
        get journal() { return world.collections.JournalEntry; },
        get items() { return world.collections.Item; },
        get folders() { return world.collections.Folder; },
        get messages() { return world.collections.ChatMessage; },
        time: { worldTime: 1000, get serverTime() { return (world.clock ? world.clock.server : Date.now()) - world.launch; } },
        world: { title: "Test World", get lastPlayed() { return new Date(world.launch).toString(); } },
        socket: {
            get connected() { return true; },
            on(event, fn) { (world.socketHandlers.get(event) ?? world.socketHandlers.set(event, []).get(event)).push(fn); },
            off(event, fn) { const list = world.socketHandlers.get(event) ?? []; if (list.includes(fn)) list.splice(list.indexOf(fn), 1); },
        },
        i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}` },
        modules: new Map([[MODULE_ID, { id: MODULE_ID, version: "0.0.0" }]]),
        settings: {
            get settings() { return world.settingConfigs; },
            register(namespace, key, config) {
                world.settingConfigs.set(`${namespace}.${key}`, { ...config, namespace, key });
            },
            registerMenu(namespace, key, config) { world.menus.set(`${namespace}.${key}`, config); },
            get(namespace, key) {
                const id = `${namespace}.${key}`;
                return world.settings.has(id) ? world.settings.get(id) : world.settingConfigs.get(id)?.default;
            },
            async set(namespace, key, value) {
                const id = `${namespace}.${key}`;
                world.settings.set(id, value);
                world.calls.push(["setting", id, value]);
                await world.settingConfigs.get(id)?.onChange?.(value, {}, game.user.id);
                return value;
            },
        },
    };
    world.settingConfigs = new Map();
    world.menus = new Map();
    resetWorld();
}

/**
 * A ready world for the sync code: master switch on, a ledger and a strongbox owned by everyone, the coin
 * templates loaded, and the shared state set to ready. Returns the documents.
 */
export function sharedWorld({ ledgerFlags = {}, strongboxItems = [] } = {}) {
    const ledger = addDocument("JournalEntry", { name: "Ledger", ownership: { default: OWNER }, flags: { [MOD]: { role: "ledger", schema: 1, ...ledgerFlags } } });
    const strongbox = addDocument("Actor", { name: "Strongbox", type: "loot", ownership: { default: OWNER }, flags: { [MOD]: { role: "strongbox", schema: 1 } }, items: strongboxItems });
    return { ledger, strongbox };
}

/** The module's flags on a document. */
export const flagsOf = (doc) => doc.flags[MOD] ?? {};
