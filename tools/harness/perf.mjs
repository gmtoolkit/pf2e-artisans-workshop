/**
 * Performance pass (DESIGN.md 15.3 scenario 11, OQ-36): stage a long campaign's Workshop in the running dev world, time what
 * a user waits for, profile it, and put the world back as the live harness leaves it.
 *
 *   npm run harness:perf -- [--url http://localhost:30000] [--chromium <browser binary>] [--orders 200] [--rows 2000]
 *                           [--days 60] [--seeds 5] [--runs 5] [--out <dir>] [--canvas] [--headed]
 *
 * It needs what `npm run harness:live` needs (README, Development) and runs in the dev world only: it resets the world's
 * Workshop data, as every live plan does. Stages, each measured the same way:
 *
 *   S0  the world as every plan starts it, with five members: the two players' characters and three copies of fixture actors
 *       (`EXTRA`, generic names, marked `flags.world.<MODULE_ID>-perf`), the party's members kept on the party first.
 *   S1  real data through the module's own functions on the GM's client: `--seeds` runs of the M4 seed step (six orders in
 *       several states each, with pledges, rolls, a deposit and a cancel), every member in downtime (three on Earn Income jobs,
 *       two on another activity), then one Advance days commit of `--days` days without the clock.
 *   S2  S1 cloned up to `--orders` orders and at least `--rows` rows (`cloneRecords`): each copy of an order brings its rows and
 *       work days under new ids, party-fund rows fill the rest, the strongbox gets the coins the copies hold so reconciliation
 *       still balances, and the lock pages grow in proportion to the rows that moved coins.
 *
 * Measured at each stage, with the GM and both players online (`measure`): the ledger's size; on the GM's and Player One's
 * clients the Workshop's first and later opens and each part's render (Queue, Funds, Downtime, the header, the status bar),
 * and the set of parts a store change renders (`REFRESH_PARTS`, `WorkshopApp#refresh`); reconciliation on the GM's client;
 * a ledger write and a deposit as the GM, and what they cost the players' open windows (their renders, timed in place); from
 * S1 on, a full Advance days run through the wizard's window (span, who, checks, review, commit) as the GM, and the players'
 * renders meanwhile. At S2 the GM's client is profiled (Chrome DevTools Protocol sampling) around each, and the self time is
 * summed by function and by file (`hotspots`).
 *
 * At the end, as the screenshot tool does: a reset with the module off, the party's members back and the copies and every
 * chat message of the run deleted, then a reset with it on. The results go to `<out>/results.json`. Console output only: a
 * developer tool, not module interface.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { hashId } from "../../scripts/logic/ids.mjs";
import { FIXTURE_MARK } from "./fixtures.mjs";
import { prepareWorld, resetWorld } from "./live-plans.mjs";
import { DEFAULT_CHROMIUM, Harness, MODULE_ID } from "./run-live.mjs";

/** The mark on the copies of fixture actors, and on the party (its members before the run). */
export const PERF_MARK = `${MODULE_ID}-perf`;

/** The three members added to the players' two: a copy of each fixture (`fixtures.mjs` id), with a generic name. */
export const EXTRA = Object.freeze([
    { key: "wizard", name: "Perf Wizard", fixture: "wizard-9", coins: { gp: 300 }, job: { skill: "arcana", taskLevel: 3 } },
    { key: "cleric", name: "Perf Cleric", fixture: "cleric-5", coins: { gp: 300 }, job: { skill: "religion", taskLevel: 2 } },
    { key: "chirurgeon", name: "Perf Chirurgeon", fixture: "chirurgeon-9", coins: { gp: 300 }, job: null },
]);

/** What the seed step makes orders of (pf2e `packs/pf2e/equipment/`): the M4 screenshots' four. */
export const PRODUCTS = Object.freeze([
    "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318",   // Elixir of Life (Minor)
    "Compendium.pf2e.equipment-srd.Item.2RuepCemJhrpKKao",   // Healing Potion (Minor)
    "Compendium.pf2e.equipment-srd.Item.yd3kEK21YknZLlcT",   // Alchemist's Fire (Lesser)
    "Compendium.pf2e.equipment-srd.Item.ktjFOp3U0wQD9t0Z",   // Antidote (Lesser)
]);

/** An alchemist's lab for the strongbox (G7: it counts for every crafter). */
const LAB = "Compendium.pf2e.equipment-srd.Item.k6xZkDUpF7E1Totd";

/** The parts `WorkshopApp#refresh` renders after any store change (the Morning part only while its tab is shown). */
export const REFRESH_PARTS = Object.freeze(["header", "queue", "funds", "formulas", "downtime", "status"]);

/** What DESIGN.md asks of these numbers: OQ-36's archive ages (workshop days), and the re-render budget this pass judges by. */
export const BUDGETS = Object.freeze({ renderMs: 50, archiveOrderDays: 30, archiveRowDays: 60 });

/* -------------------------------------------- */
/*  Pure parts                                   */
/* -------------------------------------------- */

/** Summary of a list of durations in ms: count, min, median, 90th percentile, max (rounded to 0.1 ms). */
export function stats(times) {
    const sorted = [...times].filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return { n: 0, min: null, median: null, p90: null, max: null };
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    const round = (ms) => Math.round(ms * 10) / 10;
    return { n: sorted.length, min: round(sorted[0]), median: round(at(0.5)), p90: round(at(0.9)), max: round(sorted.at(-1)) };
}

const live = (collection) => Object.values(collection ?? {}).filter((r) => r && typeof r === "object" && typeof r.id === "string" && Number.isInteger(r.v));

/** Every occurrence of a key of `map` in `text` replaced by its value (record ids: 16 letters and digits, or day record ids). */
function remap(text, map) {
    if (!map.size) return text;
    const pattern = new RegExp([...map.keys()].sort((a, b) => b.length - a.length).map((k) => RegExp.escape(k)).join("|"), "g");
    return text.replace(pattern, (m) => map.get(m));
}

/**
 * Copies of a ledger's records, to stage a long campaign from a short one (S2). Orders are copied in turn until there are
 * `orders`; each copy gets a new id (`newId`), and its rows (applied ones) and work-day records come with it, under new ids,
 * every reference to the old ids replaced: a row's idempotency key gets `:perf:<n>` and its id is the key's hash, as the module
 * makes them (`hashId`); a work day's id gets `-p<n>`, so it stays out of the PC's own day records (`isDayRecord`). Then
 * applied rows with no order (deposits, wages) are copied until there are at least `rows`. Lock pages (`pages`, page sources) are
 * copied for the copied rows, as many per row as the ledger had per applied row that moved coins, with ids and lock names
 * mapped the same way.
 * @param {{orders?: object, rows?: object, days?: object}} flags  the ledger's module flags
 * @param {{orders: number, rows: number, pages?: object[], newId: () => string, hashId: (key: string) => string}} options
 * @returns {{set: object, pages: object[], boxCp: number, counts: {orders: number, rows: number, days: number, pages: number}}}
 */
export function cloneRecords(flags, { orders: wantOrders, rows: wantRows, pages = [], newId, hashId: hash }) {
    const seedOrders = live(flags.orders).sort((a, b) => (a.created?.real ?? 0) - (b.created?.real ?? 0) || (a.id < b.id ? -1 : 1));
    const rows = live(flags.rows);
    const days = live(flags.days);
    const applied = rows.filter((r) => r.state === "applied");
    const set = {};
    const outPages = [];
    let boxCp = 0;
    let orderCount = seedOrders.length;
    let rowCount = rows.length;
    let dayCount = days.length;
    const moved = applied.filter((r) => (r.box ?? 0) !== 0 || (r.purse ?? 0) !== 0);
    const pagesPerRow = moved.length ? pages.length / moved.length : 0;
    const pageById = new Map(pages.map((p) => [p._id, p]));
    let owedPages = 0;
    const copyPages = (rowMap, orderMap, copied, n) => {
        owedPages += copied.filter((r) => (r.box ?? 0) !== 0 || (r.purse ?? 0) !== 0).length * pagesPerRow;
        const map = new Map([...orderMap, ...rowMap]);
        // A row's own lock page first (its id is the row's), then any other page in turn.
        for (const [oldId, newRowId] of rowMap) {
            if (owedPages < 1) break;
            const page = pageById.get(oldId);
            if (!page) continue;
            const copy = JSON.parse(remap(JSON.stringify(page), map));
            copy._id = newRowId;
            copy.name = `${page.name ?? "lock"}:perf:${n}`;
            outPages.push(copy);
            owedPages -= 1;
        }
    };
    const copyRows = (list, orderMap, n) => {
        const rowMap = new Map();
        const idems = new Map();
        for (const row of list) {
            const idem = `${remap(row.idem, orderMap)}:perf:${n}`;
            idems.set(row.id, idem);
            rowMap.set(row.id, hash(idem));
        }
        return { rowMap, idems };
    };
    let k = 0;
    while (orderCount < wantOrders && seedOrders.length) {
        const seed = seedOrders[k % seedOrders.length];
        const n = Math.floor(k / seedOrders.length) + 1;
        k += 1;
        const orderMap = new Map([[seed.id, newId()]]);
        const ownRows = applied.filter((r) => r.order === seed.id);
        const ownDays = days.filter((d) => d.order === seed.id);
        const { rowMap, idems } = copyRows(ownRows, orderMap, n);
        const dayMap = new Map(ownDays.map((d) => [d.id, `${d.id}-p${n}`]));
        const map = new Map([...orderMap, ...rowMap, ...dayMap]);
        const order = JSON.parse(remap(JSON.stringify(seed), map));
        set[`orders.${order.id}`] = order;
        orderCount += 1;
        for (const row of ownRows) {
            const copy = JSON.parse(remap(JSON.stringify(row), map));
            copy.idem = idems.get(row.id);
            copy.id = rowMap.get(row.id);
            set[`rows.${copy.id}`] = copy;
            boxCp += copy.box ?? 0;
            rowCount += 1;
        }
        for (const day of ownDays) {
            const copy = JSON.parse(remap(JSON.stringify(day), map));
            set[`days.${copy.id}`] = copy;
            dayCount += 1;
        }
        copyPages(rowMap, orderMap, ownRows, n);
    }
    const fillers = applied.filter((r) => !r.order && !r.reverses && !r.reversedBy);
    let f = 0;
    while (rowCount < wantRows && fillers.length) {
        const row = fillers[f % fillers.length];
        const n = Math.floor(f / fillers.length) + 1;
        f += 1;
        const { rowMap, idems } = copyRows([row], new Map(), n);
        const copy = JSON.parse(remap(JSON.stringify(row), rowMap));
        copy.idem = idems.get(row.id);
        copy.id = rowMap.get(row.id);
        set[`rows.${copy.id}`] = copy;
        boxCp += copy.box ?? 0;
        rowCount += 1;
        copyPages(rowMap, new Map(), [row], n);
    }
    return { set, pages: outPages, boxCp, counts: { orders: orderCount, rows: rowCount, days: dayCount, pages: pages.length + outPages.length } };
}

/** A script URL as a short label: the Workshop's, pf2e's or Foundry's file, else the URL's path. */
export function shortUrl(url = "") {
    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0];
    if (!path) return "(native)";
    if (path.startsWith(`/modules/${MODULE_ID}/`)) return `workshop:${path.slice(MODULE_ID.length + 10)}`;
    if (path.startsWith("/systems/pf2e/")) return `pf2e:${path.slice(14)}`;
    if (path.startsWith("/modules/")) return `module:${path.slice(9)}`;
    if (path.startsWith("/scripts/")) return `foundry:${path.slice(9)}`;
    return path;
}

/**
 * Where a CPU profile (Chrome DevTools Protocol `Profiler.stop`) spent its time: self time summed by function (name, file,
 * line) and by file group, idle left out, largest first, in ms.
 * @returns {{totalMs: number, functions: object[], files: object[]}}
 */
export function hotspots(profile, top = 15) {
    const nodes = new Map((profile?.nodes ?? []).map((node) => [node.id, node]));
    const self = new Map();
    const samples = profile?.samples ?? [];
    const deltas = profile?.timeDeltas ?? [];
    // timeDeltas[i] is the time before sample i: the time a sample stands for is the next delta.
    for (let i = 0; i < samples.length; i++) self.set(samples[i], (self.get(samples[i]) ?? 0) + (deltas[i + 1] ?? 0));
    const byFn = new Map();
    const byFile = new Map();
    let total = 0;
    for (const [id, us] of self) {
        const frame = nodes.get(id)?.callFrame ?? {};
        const name = frame.functionName || "(anonymous)";
        if (name === "(idle)") continue;
        total += us;
        const file = shortUrl(frame.url);
        const key = `${name} ${file}:${(frame.lineNumber ?? -1) + 1}`;
        byFn.set(key, (byFn.get(key) ?? 0) + us);
        const group = file.split(":")[0] === file ? file : `${file.split(":")[0]}:${file.split(":")[1].split("/").slice(0, 2).join("/")}`;
        byFile.set(group, (byFile.get(group) ?? 0) + us);
    }
    const ms = (us) => Math.round(us / 100) / 10;
    const list = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, us]) => ({ name, ms: ms(us), pct: total ? Math.round((us / total) * 1000) / 10 : 0 }));
    return { totalMs: ms(total), functions: list(byFn), files: list(byFile) };
}

/* -------------------------------------------- */
/*  In the page                                  */
/* -------------------------------------------- */

/**
 * GM: the three extra members, copies of fixture actors as the screenshot tool makes its demo party (no coins but their own,
 * no items a plan gave, an empty formula book), added to the party; the party's members before are kept on the party.
 * Returns the copies and the ids of the chat messages there were.
 */
async function pageCast({ mod, mark, fixtureMark, extra }) {
    const party = game.actors.party;
    if (!party.flags?.world?.[mark]) await party.setFlag("world", mark, { members: foundry.utils.deepClone(party._source.system.details.members) });
    const messages = game.messages.map((m) => m.id);
    const made = {};
    for (const member of extra) {
        const fixture = game.actors.find((a) => a.flags?.world?.[fixtureMark] === member.fixture);
        if (!fixture) throw new Error(`no fixture ${member.fixture} in this world (build the fixtures first)`);
        const source = fixture.toObject();
        delete source._id;
        source.name = member.name;
        source.prototypeToken.name = member.name;
        source.folder = null;
        source.flags = { ...(source.flags?.pf2e ? { pf2e: source.flags.pf2e } : {}), world: { [mark]: member.key } };
        source.ownership = { default: 0 };
        source.items = source.items.filter((i) => !(i.type === "treasure" && i.system?.category === "coin") && !Object.keys(i.flags?.world ?? {}).length && !i.flags?.[mod]);
        source.system.crafting = { ...(source.system.crafting ?? {}), formulas: [] };
        const actor = await Actor.implementation.create(source);
        await actor.inventory.addCurrency(member.coins);
        made[member.key] = { id: actor.id, uuid: actor.uuid, name: actor.name };
    }
    await party.addMembers(...Object.values(made).map((m) => game.actors.get(m.id)));
    return { made, messages, members: party.members.map((m) => m.name) };
}

/** GM, with the module off: the party's members as they were, the copies and every chat message since `messages` deleted. */
async function pageUncast({ mark, messages = null }) {
    const party = game.actors.party;
    const saved = party?.flags?.world?.[mark] ?? null;
    if (saved) {
        await party.update({ "system.details.members": saved.members });
        await party.unsetFlag("world", mark);
    }
    const copies = game.actors.filter((a) => a.flags?.world?.[mark]).map((a) => a.id);
    if (copies.length) await Actor.implementation.deleteDocuments(copies);
    let deleted = 0;
    if (messages) {
        const before = new Set(messages);
        const ids = game.messages.filter((m) => !before.has(m.id)).map((m) => m.id);
        if (ids.length) await ChatMessage.implementation.deleteDocuments(ids);
        deleted = ids.length;
    }
    return { restored: !!saved, members: party?.members.map((m) => m.name) ?? [], copiesDeleted: copies.length, messagesDeleted: deleted };
}

/** GM: an item in the strongbox. */
async function pageStore({ mod, uuid }) {
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const source = (await fromUuid(uuid)).toObject();
    delete source._id;
    const [item] = await box.createEmbeddedDocuments("Item", [source]);
    return { id: item.id, name: item.name };
}

/**
 * GM: every member in downtime; the ones with a `job` start it and roll it (the die at 12), the others take "other"; then one
 * Advance days commit of `days` days without the clock, timed.
 */
async function pageDowntime({ mod, members, days }) {
    const at = `/modules/${mod}/scripts`;
    const [downtime, jobs, store] = await Promise.all([import(`${at}/foundry/downtime.mjs`), import(`${at}/foundry/jobs.mjs`), import(`${at}/foundry/store.mjs`)]);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
    const out = { members: [] };
    for (const member of members) {
        const entry = { name: fromUuidSync(member.uuid)?.name, on: plain(await downtime.setDowntime(member.uuid, true)) };
        if (member.job) {
            const started = await jobs.startJob({ actor: member.uuid, ...member.job });
            entry.job = plain(started);
            if (started.ok) {
                const random = CONFIG.Dice.randomUniform;
                CONFIG.Dice.randomUniform = () => 1 - (12 - 0.5) / 20;
                try {
                    await jobs.rollJob(started.job, { skipDialog: true });
                } finally {
                    CONFIG.Dice.randomUniform = random;
                }
                for (let i = 0; i < 100 && !store.read(`jobs.${started.job}.check`); i++) await sleep(100);
                entry.perDayCp = store.read(`jobs.${started.job}.perDayCp`) ?? null;
            }
        } else {
            entry.activity = plain(await downtime.setActivity(member.uuid, { kind: "other" }));
        }
        out.members.push(entry);
    }
    const t0 = performance.now();
    const run = await downtime.advanceDays({ kind: "days", count: days, advanceClock: false });
    out.advanceMs = Math.round(performance.now() - t0);
    out.advance = { ok: run.ok, reason: run.reason ?? null, toDay: run.toDay ?? null, results: (run.results ?? []).map((r) => ({ actor: r.actor?.name ?? null, ok: r.ok,
        records: r.records?.length ?? null, stop: r.stop ?? null })) };
    out.today = plain(downtime.today());
    return out;
}

/** GM: the ledger's module flags and pages, and its size as JSON (what the server stores and sends). */
async function pageLedger({ mod, flags = false }) {
    const ledger = game.journal.find((j) => j.flags?.[mod]?.role === "ledger");
    const source = ledger.toObject();
    const f = source.flags[mod] ?? {};
    const count = (c) => Object.values(f[c] ?? {}).filter((r) => r && r.id && Number.isInteger(r.v)).length;
    const size = {
        bytes: JSON.stringify(source).length, flagBytes: JSON.stringify(f).length, pages: source.pages.length,
        orders: count("orders"), rows: count("rows"), days: count("days"), claims: count("claims"), jobs: count("jobs"),
        byKey: Object.fromEntries(Object.keys(f).map((k) => [k, JSON.stringify(f[k]).length])),
    };
    return flags ? { size, flags: { orders: f.orders, rows: f.rows, days: f.days }, pages: source.pages } : { size };
}

/** GM: write the copies in chunks of `chunk` keys, create their lock pages, and put the coins they hold in the strongbox. */
async function pageWriteClones({ mod, set, pages, boxCp, chunk }) {
    const { write } = await import(`/modules/${mod}/scripts/foundry/store.mjs`);
    const ledger = game.journal.find((j) => j.flags?.[mod]?.role === "ledger");
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const keys = Object.keys(set);
    const writes = [];
    for (let i = 0; i < keys.length; i += chunk) {
        const t0 = performance.now();
        const ok = await write({ set: Object.fromEntries(keys.slice(i, i + chunk).map((k) => [k, set[k]])) });
        writes.push({ keys: Math.min(chunk, keys.length - i), ms: Math.round(performance.now() - t0), ok });
    }
    const pageWrites = [];
    for (let i = 0; i < pages.length; i += 200) {
        const t0 = performance.now();
        await ledger.createEmbeddedDocuments("JournalEntryPage", pages.slice(i, i + 200), { keepId: true });
        pageWrites.push({ pages: Math.min(200, pages.length - i), ms: Math.round(performance.now() - t0) });
    }
    if (boxCp > 0) {
        const gp = Math.floor(boxCp / 100);
        await box.inventory.addCurrency({ gp, sp: Math.floor((boxCp % 100) / 10), cp: boxCp % 10 });
    }
    return { writes, pageWrites, boxCp };
}

/**
 * This client: the Workshop's opens and renders, timed with `performance.now()` around the awaited call (an
 * ApplicationV2 render resolves once its parts are in the page). The first open is the page's first (templates loaded and
 * compiled); `runs` more follow. Then each part alone, and the set a store change renders, `runs` times each, on the tab the
 * part belongs to. The window is left open on the Queue, and the remembered tab put back.
 */
async function pageWindowTimes({ mod, runs, parts, refresh }) {
    const { openWorkshop, WorkshopApp } = await import(`/modules/${mod}/scripts/ui/workshop.mjs`);
    const lastTab = game.settings.get(mod, "ui.lastTab");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const close = async () => {
        await WorkshopApp.instance?.close({ animate: false });
        for (let i = 0; i < 50 && WorkshopApp.instance; i++) await sleep(20);
    };
    const time = async (fn) => {
        const t0 = performance.now();
        await fn();
        return performance.now() - t0;
    };
    const out = { open: [], parts: {}, refresh: [] };
    const first = !window.__perfOpened;
    window.__perfOpened = true;
    await close();
    for (let i = 0; i <= runs; i++) {
        out.open.push(await time(() => openWorkshop({ tab: "queue" })));
        await sleep(100);
        if (i < runs) await close();
    }
    out.firstInPage = first;
    const app = WorkshopApp.instance;
    for (const [part, tab] of parts) {
        if (tab && app.tabGroups.primary !== tab) app.changeTab(tab, "primary");
        await sleep(200);
        out.parts[part] = [];
        for (let i = 0; i < runs; i++) out.parts[part].push(await time(() => app.render({ parts: [part] })));
    }
    if (app.tabGroups.primary !== "queue") app.changeTab("queue", "primary");
    await sleep(200);
    for (let i = 0; i < runs; i++) out.refresh.push(await time(() => app.render({ parts: refresh })));
    out.dom = { orderRows: app.element.querySelectorAll(".order-row").length, ledgerRows: app.element.querySelectorAll(".workshop-funds tbody tr").length,
        elements: app.element.querySelectorAll("*").length };
    if (game.settings.get(mod, "ui.lastTab") !== lastTab) await game.settings.set(mod, "ui.lastTab", lastTab);
    return out;
}

/** This client: time each render of the open Workshop from now on (`pageRenderLog` reads them), opening it on the Queue if needed. */
async function pageWatchRenders({ mod }) {
    const { openWorkshop, WorkshopApp } = await import(`/modules/${mod}/scripts/ui/workshop.mjs`);
    const app = WorkshopApp.instance ?? await openWorkshop({ tab: "queue" });
    window.__perfRenders = [];
    if (!app.__perfWrapped) {
        const render = app.render.bind(app);
        app.render = async (...args) => {
            const t0 = performance.now();
            try {
                return await render(...args);
            } finally {
                window.__perfRenders?.push({ parts: args[0]?.parts ?? "all", ms: Math.round((performance.now() - t0) * 10) / 10, at: Date.now() });
            }
        };
        app.__perfWrapped = true;
    }
    return { open: app.rendered };
}

/** This client: the Workshop renders timed since `pageWatchRenders`, and a fresh log. */
function pageRenderLog() {
    const log = window.__perfRenders ?? [];
    window.__perfRenders = [];
    return log;
}

/** GM: reconciliation over this client's copies (`reconciliationReport`), `runs` times. */
async function pageReconcile({ mod, runs }) {
    const { reconciliationReport } = await import(`/modules/${mod}/scripts/foundry/reconcile.mjs`);
    const times = [];
    let report = null;
    for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        report = reconciliationReport();
        times.push(performance.now() - t0);
    }
    return { times, expectedCp: report.expectedCp, actualCp: report.actualCp, differenceCp: report.differenceCp, pending: report.pending.length };
}

/** GM: `runs` plain ledger writes (one `meta` key) and `deposits` deposits of 1 cp from `actor`, each timed to its answer. */
async function pageWrites({ mod, runs, deposits, actor }) {
    const at = `/modules/${mod}/scripts`;
    const [{ write }, { deposit }] = await Promise.all([import(`${at}/foundry/store.mjs`), import(`${at}/foundry/funds.mjs`)]);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const out = { write: [], deposit: [] };
    for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        await write({ set: { "meta.perfProbe": i } });
        out.write.push(performance.now() - t0);
        await sleep(400);
    }
    for (let i = 0; i < deposits; i++) {
        const t0 = performance.now();
        const result = await deposit(actor, 1);
        out.deposit.push(performance.now() - t0);
        out.depositOk = (out.depositOk ?? true) && result.ok === true;
        await sleep(400);
    }
    return out;
}

/**
 * GM: a full Advance days run through the wizard's window: open it for `count` days, Next until the review, then commit;
 * each step timed from its click to the window showing the next step (the commit to "done").
 */
async function pageWizard({ mod, count }) {
    const { openAdvance } = await import(`/modules/${mod}/scripts/ui/advance.mjs`);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const out = { steps: [] };
    let t0 = performance.now();
    const app = await openAdvance({ mode: "advance", count });
    out.openMs = performance.now() - t0;
    // The step the window shows: the stepper's current entry, which a render replaces (the state changes before it renders).
    const shown = () => [...(app.element?.querySelectorAll(".wizard-steps li") ?? [])].findIndex((li) => li.classList.contains("current"));
    const waitStep = async (step) => {
        for (let i = 0; i < 12000; i++) {
            if (app.wizard.step !== step && !app.wizard.busy && shown() === app.steps.indexOf(app.wizard.step)) return true;
            await sleep(5);
        }
        return false;
    };
    for (let i = 0; i < 6 && !["review", "done"].includes(app.wizard.step); i++) {
        const step = app.wizard.step;
        const next = app.element.querySelector("[data-action='next']");
        if (!next || next.disabled) {
            out.blockedAt = step;
            break;
        }
        t0 = performance.now();
        next.click();
        const moved = await waitStep(step);
        out.steps.push({ from: step, to: app.wizard.step, ms: performance.now() - t0, moved });
    }
    if (app.wizard.step === "review") {
        t0 = performance.now();
        app.element.querySelector("[data-action='commit']")?.click();
        const moved = await waitStep("review");
        out.commitMs = performance.now() - t0;
        out.committed = moved && app.wizard.step === "done";
        const result = app.wizard.result;
        out.result = result ? { ok: result.ok, toDay: result.toDay ?? null, results: (result.results ?? []).map((r) => ({ actor: r.actor?.name ?? null, ok: r.ok,
            records: r.records?.length ?? null, stop: r.stop?.reason ?? null })) } : null;
    }
    await app.close({ animate: false });
    return out;
}

/* -------------------------------------------- */
/*  The run                                      */
/* -------------------------------------------- */

const round = (ms) => Math.round(ms * 10) / 10;

/**
 * Profile `fn(arg)` run on client `name`, sampling client `watch` (by default the same one): the CPU profile's hotspots and
 * the call's result. Watching another client shows what one user's action costs the others.
 */
async function profiled(h, name, label, fn, arg, watch = name) {
    const client = h.clients.get(watch);
    const cdp = await client.page.context().newCDPSession(client.page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
    await cdp.send("Profiler.start");
    const result = await h.evaluate(name, fn, arg, label);
    if (watch !== name) await new Promise((resolve) => setTimeout(resolve, 1500));
    const { profile } = await cdp.send("Profiler.stop");
    await cdp.detach().catch(() => {});
    return { result, hotspots: hotspots(profile) };
}

/** In the page: render the open Workshop's `parts` `runs` times (for a profile). */
async function pageRenderParts({ mod, parts, runs, tab = null }) {
    const { openWorkshop, WorkshopApp } = await import(`/modules/${mod}/scripts/ui/workshop.mjs`);
    const app = WorkshopApp.instance ?? await openWorkshop({ tab: "queue" });
    if (tab && app.tabGroups.primary !== tab) app.changeTab(tab, "primary");
    const times = [];
    for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        await app.render({ parts });
        times.push(performance.now() - t0);
    }
    if (app.tabGroups.primary !== "queue") app.changeTab("queue", "primary");
    return times;
}

/** In the page: close the Workshop, then open it `runs` times (for a profile). */
async function pageOpens({ mod, runs }) {
    const { openWorkshop, WorkshopApp } = await import(`/modules/${mod}/scripts/ui/workshop.mjs`);
    const times = [];
    for (let i = 0; i < runs; i++) {
        await WorkshopApp.instance?.close({ animate: false });
        const t0 = performance.now();
        await openWorkshop({ tab: "queue" });
        times.push(performance.now() - t0);
    }
    return times;
}

/** The parts timed alone, each on its own tab (null: shown on every tab). */
const PARTS = Object.freeze([["queue", "queue"], ["funds", "funds"], ["downtime", "downtime"], ["header", null], ["status", null]]);

/** One stage's measurements (see the file's comment). */
async function measure(h, world, { runs, wizard, profile }) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await h.only(["gm", "p1", "p2"]);
    await h.settle("ready");
    const out = { ledger: (await h.evaluate("gm", pageLedger, { mod: MODULE_ID }, "ledger size")).size };
    const windowTimes = async (name) => {
        const raw = await h.evaluate(name, pageWindowTimes, { mod: MODULE_ID, runs, parts: PARTS, refresh: REFRESH_PARTS }, "window times");
        if (raw.error) return raw;
        return { firstOpen: round(raw.open[0]), firstInPage: raw.firstInPage, open: stats(raw.open.slice(1)),
            parts: Object.fromEntries(Object.entries(raw.parts).map(([part, times]) => [part, stats(times)])), refresh: stats(raw.refresh), dom: raw.dom };
    };
    out.gm = await windowTimes("gm");
    out.p1 = await windowTimes("p1");
    const recon = await h.evaluate("gm", pageReconcile, { mod: MODULE_ID, runs }, "reconcile");
    out.reconcile = { ...stats(recon.times ?? []), expectedCp: recon.expectedCp, actualCp: recon.actualCp, differenceCp: recon.differenceCp, pending: recon.pending };
    for (const name of ["gm", "p1", "p2"]) await h.evaluate(name, pageWatchRenders, { mod: MODULE_ID }, "watch renders");
    for (const name of ["gm", "p1", "p2"]) await h.evaluate(name, pageRenderLog, null, "render log");
    const writes = await h.evaluate("gm", pageWrites, { mod: MODULE_ID, runs, deposits: 3, actor: world.pcs.p2.uuid }, "writes");
    await sleep(1500);
    out.writes = { write: stats(writes.write ?? []), deposit: stats(writes.deposit ?? []), depositOk: writes.depositOk ?? null };
    out.liveRenders = {};
    for (const name of ["gm", "p1", "p2"]) {
        const log = await h.evaluate(name, pageRenderLog, null, "render log");
        out.liveRenders[name] = { count: log.length ?? 0, ...stats((log ?? []).map((r) => r.ms)) };
    }
    if (wizard) {
        const run = await h.evaluate("gm", pageWizard, { mod: MODULE_ID, count: 7 }, "wizard");
        await sleep(2500);
        out.wizard = { ...run, openMs: round(run.openMs ?? NaN), commitMs: round(run.commitMs ?? NaN), steps: (run.steps ?? []).map((s) => ({ ...s, ms: round(s.ms) })) };
        out.wizardRenders = {};
        for (const name of ["gm", "p1", "p2"]) {
            const log = await h.evaluate(name, pageRenderLog, null, "render log");
            out.wizardRenders[name] = { count: log.length ?? 0, totalMs: round((log ?? []).reduce((s, r) => s + r.ms, 0)), ...stats((log ?? []).map((r) => r.ms)) };
        }
        out.ledgerAfterWizard = (await h.evaluate("gm", pageLedger, { mod: MODULE_ID }, "ledger size")).size;
    }
    if (profile) {
        out.profiles = {};
        const timesOf = (result) => (Array.isArray(result) ? stats(result) : Array.isArray(result?.deposit) ? stats(result.deposit)
            : Array.isArray(result?.times) ? stats(result.times) : Number.isFinite(result?.commitMs) ? { commitMs: round(result.commitMs) } : null);
        const p = (label, fn, arg) => profiled(h, "gm", label, fn, arg).then((r) => ({ times: timesOf(r.result), ...r.hotspots }));
        out.profiles.open = await p("profile open", pageOpens, { mod: MODULE_ID, runs });
        out.profiles.queue = await p("profile queue", pageRenderParts, { mod: MODULE_ID, parts: ["queue"], runs, tab: "queue" });
        out.profiles.funds = await p("profile funds", pageRenderParts, { mod: MODULE_ID, parts: ["funds"], runs, tab: "funds" });
        out.profiles.downtime = await p("profile downtime", pageRenderParts, { mod: MODULE_ID, parts: ["downtime"], runs, tab: "downtime" });
        out.profiles.refresh = await p("profile refresh", pageRenderParts, { mod: MODULE_ID, parts: [...REFRESH_PARTS], runs });
        out.profiles.reconcile = await p("profile reconcile", pageReconcile, { mod: MODULE_ID, runs: runs * 4 });
        const deposits = { mod: MODULE_ID, runs: 0, deposits: 3, actor: world.pcs.p2.uuid };
        out.profiles.deposit = await p("profile deposit", pageWrites, deposits);
        out.profiles.depositSeenByP1 = await profiled(h, "gm", "profile deposit on p1", pageWrites, deposits, "p1").then((r) => r.hotspots);
        if (wizard) out.profiles.wizard = await p("profile wizard", pageWizard, { mod: MODULE_ID, count: 7 });
    }
    await h.closeAll();
    return out;
}

/** Put the world back: a reset with the module off, the members back and the copies and messages gone, then a reset with it on. */
async function restore(h, world, messages) {
    h.label = "restore";
    await h.ensureBrowser();
    await resetWorld(h, world, { enable: false });
    const uncast = await h.evaluate("gm", pageUncast, { mark: PERF_MARK, messages }, "uncast");
    await resetWorld(h, world);
    await h.closeAll();
    return uncast;
}

/** One line per stage for the console. */
function summary(stages) {
    const lines = [];
    for (const [stage, s] of Object.entries(stages)) {
        if (!s?.ledger) continue;
        const l = s.ledger;
        lines.push(`${stage}: ${l.orders} orders, ${l.rows} rows, ${l.days} day records, ${l.pages} pages, ${(l.bytes / 1024).toFixed(0)} KiB`);
        for (const who of ["gm", "p1"]) {
            const w = s[who];
            if (!w?.open) continue;
            lines.push(`  ${who}: first open ${w.firstOpen} ms, open ${w.open.median} ms, queue ${w.parts.queue.median}, funds ${w.parts.funds.median}, ` +
                `downtime ${w.parts.downtime.median}, refresh ${w.refresh.median} ms (medians)`);
        }
        lines.push(`  reconcile ${s.reconcile.median} ms; write ${s.writes.write.median} ms; deposit ${s.writes.deposit.median} ms; ` +
            `player renders per write ${s.liveRenders.p1.median} ms`);
        if (s.wizard) lines.push(`  wizard: open ${s.wizard.openMs} ms, steps ${s.wizard.steps.map((x) => x.ms).join("/")} ms, commit ${s.wizard.commitMs} ms`);
    }
    return lines.join("\n");
}

async function main() {
    const { values } = parseArgs({
        options: {
            url: { type: "string", default: "http://localhost:30000" },
            chromium: { type: "string", default: DEFAULT_CHROMIUM },
            orders: { type: "string", default: "200" },
            rows: { type: "string", default: "2000" },
            days: { type: "string", default: "60" },
            seeds: { type: "string", default: "5" },
            runs: { type: "string", default: "5" },
            out: { type: "string", default: join(tmpdir(), `${MODULE_ID}-perf-${new Date().toISOString().replace(/[:.]/g, "-")}`) },
            headed: { type: "boolean", default: false },
            canvas: { type: "boolean", default: false },
        },
    });
    const n = (key) => Number(values[key]);
    const runs = n("runs");
    const h = new Harness({ url: values.url, executablePath: values.chromium, headed: values.headed, canvas: values.canvas });
    mkdirSync(values.out, { recursive: true });
    const file = join(values.out, "results.json");
    const report = { url: values.url, started: new Date().toISOString(), options: { orders: n("orders"), rows: n("rows"), days: n("days"), seeds: n("seeds"), runs,
        canvas: values.canvas }, budgets: BUDGETS, stages: {} };
    const save = () => writeFileSync(file, JSON.stringify({ ...report, records: h.records, checks: h.checks, console: h.console, stalls: h.stalls }, null, 2));
    await h.start();
    const stopWatch = h.watchServer();
    let world = null;
    let cast = null;
    try {
        h.label = "prepare";
        world = await prepareWorld(h);
        await resetWorld(h, world);
        cast = await h.evaluate("gm", pageCast, { mod: MODULE_ID, mark: PERF_MARK, fixtureMark: FIXTURE_MARK, extra: EXTRA }, "cast");
        if (cast.error) throw new Error(`cast failed: ${cast.error}`);
        report.cast = cast.members;
        const members = [
            { uuid: world.pcs.p1.uuid, job: null }, { uuid: world.pcs.p2.uuid, job: { skill: "crafting", taskLevel: 4 } },
            ...EXTRA.map((e) => ({ uuid: cast.made[e.key].uuid, job: e.job })),
        ];
        h.label = "S0";
        report.stages.S0 = await measure(h, world, { runs, wizard: false, profile: false });
        save();

        h.label = "seed";
        await h.only(["gm"]);
        await h.settle("ready");
        await h.evaluate("gm", pageStore, { mod: MODULE_ID, uuid: LAB }, "lab");
        report.seeds = [];
        for (let i = 0; i < n("seeds"); i++) {
            const seeded = await h.step("gm", "m4", "seed", { products: PRODUCTS, crafter: world.pcs.p1.uuid,
                requester: members[(i + 1) % members.length].uuid, other: members[(i + 2) % members.length].uuid });
            report.seeds.push(seeded.states ? Object.values(seeded.states).length : seeded);
        }
        const t0 = Date.now();
        report.downtime = await h.evaluate("gm", pageDowntime, { mod: MODULE_ID, members, days: n("days") }, "downtime");
        report.downtime.wallMs = Date.now() - t0;
        h.check(`${n("days")} days advanced for every member`, report.downtime.advance?.ok === true, report.downtime.advance);
        h.label = "S1";
        report.stages.S1 = await measure(h, world, { runs, wizard: true, profile: true });
        save();

        h.label = "clone";
        await h.only(["gm"]);
        await h.settle("ready");
        const ledger = await h.evaluate("gm", pageLedger, { mod: MODULE_ID, flags: true }, "ledger");
        const lockPages = (ledger.pages ?? []).filter((p) => p.flags?.[MODULE_ID]?.lock);
        const plan = cloneRecords(ledger.flags, { orders: n("orders"), rows: n("rows"), pages: lockPages,
            newId: () => hashId(`perf:${Math.random()}:${Date.now()}`), hashId });
        report.clone = { counts: plan.counts, boxCp: plan.boxCp, keys: Object.keys(plan.set).length, lockPagesBefore: lockPages.length };
        report.clone.writes = await h.evaluate("gm", pageWriteClones, { mod: MODULE_ID, set: plan.set, pages: plan.pages, boxCp: plan.boxCp, chunk: 150 }, "write copies");
        h.label = "S2";
        report.stages.S2 = await measure(h, world, { runs, wizard: true, profile: true });
        h.check("S2 reached the orders and rows asked for", report.stages.S2.ledger.orders >= n("orders") && report.stages.S2.ledger.rows >= n("rows"), report.stages.S2.ledger);
        h.check("S2 still reconciles", report.stages.S2.reconcile.differenceCp === 0 && report.stages.S2.reconcile.pending === 0, report.stages.S2.reconcile);
    } catch (error) {
        report.error = error.stack ?? error.message;
        console.log(`! ${error.message}`);
    } finally {
        if (world) report.restore = await restore(h, world, cast?.messages ?? null).catch((error) => ({ error: error.message }));
        stopWatch();
        report.finished = new Date().toISOString();
        save();
        await h.stop();
    }
    console.log(`\n${summary(report.stages)}\n\nresults: ${file}`);
    if (report.error || report.restore?.error || h.checks.some((c) => !c.ok)) process.exitCode = 1;
}

if (import.meta.main) await main();
