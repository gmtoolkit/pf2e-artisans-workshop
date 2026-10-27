/**
 * Live-harness driver (DESIGN.md 15.3): runs the storage-and-sync scenarios of `sync-scenarios.mjs` in a running
 * Foundry world, each user in a browser of its own, through Playwright, and writes every result to one JSON file.
 *
 *   npm run harness:live -- [--url http://localhost:30000] [--chromium <browser binary>]
 *                           [--scenarios 1,2,3,3b,3c,7,7b,9] [--runs 2] [--behaviours all|none|<id>,...]
 *                           [--out <dir>] [--headed] [--canvas] [--shots <dir>]
 *
 * The world must exist and be running with this checkout symlinked into `Data/modules`, the module's hidden `dev`
 * setting on, the fixture actors built, and users without passwords. `live-plans.mjs` prepares the rest (the
 * assistant GM user, characters, ownership, party, coins, the master switch) through the Foundry API.
 *
 * Clients. A client is named `role[@device][#tab]`, the role being `gm`, `assistant`, `p1` or `p2` (ROLE_USERS).
 * A device is a browser context of its own (own cookies, own storage, own Web Locks), logged in once with
 * `POST /join`; `p1@2` is Player One on a second device. A tab is a page in its device's context, so `gm#2` is a
 * second tab of the GM's browser: it shares the GM's Web Locks and queues for the same lease. Every page opens
 * `/game` without a canvas (`core.noCanvas`, unless `--canvas`) and counts as ready once the module's dev harness
 * is published, which happens after the module's own `ready` check (`scripts/module.mjs`). Without a canvas,
 * core's `Actor#_onUpdate` throws on a player's client when an actor's ownership changes (it calls
 * `canvas.tokens.cycleTokens`, Foundry 14.368 `client/documents/actor.mjs`), so that client never runs its
 * `updateActor` hooks for the change, as at a table where a player turned the canvas off. The module reads its
 * status from its copies of the documents, so it copes; run with `--canvas` too, for the usual case.
 *
 * Plans. A scenario plan (`live-plans.mjs`) is an async function of this harness. It says which clients are
 * online (`only`), runs steps one after the other (`step`, which calls `dev.scenarios.run(id, step, params)` on
 * that client through `page.evaluate`) or at the same moment (`together`: every step is started without waiting
 * for the others, then all are awaited with Promise.all), and records checks (`check`). `evaluate` runs other
 * code on a client (world preparation, server reads); it is recorded the same way.
 *
 * Collected per run: every step and evaluation with its params, timing and JSON result (or error), every check,
 * and from every page its console errors and warnings, the module's own console lines, its notifications
 * (message key, type and format data) and every document hook that fired with `options.dryRun` (the replay of a
 * batch the server refused, DESIGN.md 5.4). Instrumentation is added by an init script in each page; it observes
 * and changes nothing. Meanwhile the server's `/api/status` is polled, and every slow answer is recorded.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { BEHAVIOURS, SCENARIOS, finishWorld, prepareWorld } from "./live-plans.mjs";

export const MODULE_ID = "pf2e-artisans-workshop";

/** The user each role logs in as. */
export const ROLE_USERS = Object.freeze({ gm: "Gamemaster", assistant: "Assistant GM", p1: "Player One", p2: "Player Two" });

/** How long a page may take to log in and become ready, and how long a check waits for clients to agree. */
const READY_TIMEOUT_MS = 120 * 1000;
const SETTLE_TIMEOUT_MS = 30 * 1000;
const STALL_MS = 2000;
/** How long one step or evaluation may take before it is recorded as failed (a window waiting on a click, say). */
const STEP_TIMEOUT_MS = 150 * 1000;

/** Foundry refuses screens smaller than 1366 x 768 with a console error. */
const VIEWPORT = { width: 1440, height: 900 };

/* -------------------------------------------- */
/*  Page instrumentation (runs in the browser)   */
/* -------------------------------------------- */

/**
 * Init script for every page: record notifications and dry-run hooks in `window.__live`. Foundry's globals appear
 * while the page loads, so it polls for `Hooks` and `ui.notifications` and hooks into each once.
 */
function instrumentPage() {
    const live = { notes: [], dryRun: [], hooked: false };
    window.__live = live;
    const DOCS = ["JournalEntry", "JournalEntryPage", "Actor", "Item"];
    const WRAPPED = Symbol("live-harness");
    setInterval(() => {
        if (globalThis.Hooks && !live.hooked) {
            live.hooked = true;
            for (const name of DOCS) {
                for (const kind of ["create", "update", "delete"]) {
                    globalThis.Hooks.on(`${kind}${name}`, (...args) => {
                        const options = kind === "update" ? args[2] : args[1];
                        const userId = kind === "update" ? args[3] : args[2];
                        if (!options?.dryRun) return;
                        live.dryRun.push({ hook: `${kind}${name}`, id: args[0]?.id ?? null, parent: args[0]?.parent?.id ?? null, userId, at: Date.now() });
                    });
                }
            }
        }
        // Foundry may replace `ui.notifications` while it starts, so every new instance is wrapped once.
        const notifications = globalThis.ui?.notifications;
        if (notifications && !notifications[WRAPPED]) {
            notifications[WRAPPED] = true;
            const notify = notifications.notify.bind(notifications);
            notifications.notify = (message, type, options) => {
                live.notes.push({ type: type ?? "info", message: String(message?.message ?? message), format: options?.format ?? null, at: Date.now() });
                return notify(message, type, options);
            };
        }
    }, 20);
}

/**
 * In the page (or over `doc`): whether a style sheet whose URL contains `href` is loaded, as a `<link>` or as an `@import`
 * of another sheet (Foundry 14.368 imports system and module styles in a `<style>` element).
 */
export function styleLoaded(href, doc = globalThis.document) {
    const imports = (sheet) => {
        try {
            return [...(sheet.cssRules ?? [])].filter((rule) => rule.styleSheet);
        } catch {
            return [];   // a sheet of another origin keeps its rules
        }
    };
    const matches = (sheet, depth = 0) => (sheet?.href ?? "").includes(href) || (depth < 3 && imports(sheet).some((rule) => (rule.href ?? "").includes(href)
        || matches(rule.styleSheet, depth + 1)));
    return [...(doc.styleSheets ?? [])].some((sheet) => matches(sheet));
}

/** In the page: ready once the game is and the module has published its dev harness. */
const harnessReady = (mod) => globalThis.game?.ready === true && !!globalThis.game.modules.get(mod)?.dev?.scenarios;

/** In the page: run one scenario step and return its result as plain JSON. */
async function runScenarioStep({ mod, id, step, params }) {
    const result = await game.modules.get(mod).dev.scenarios.run(id, step, params);
    return JSON.parse(JSON.stringify(result ?? null));
}

/* -------------------------------------------- */
/*  The harness                                  */
/* -------------------------------------------- */

/** `role[@device][#tab]` as its parts. */
export function parseClient(name) {
    const match = /^([a-z]+\d?)(?:@(\d+))?(?:#(\d+))?$/.exec(name);
    if (!match || !ROLE_USERS[match[1]]) throw new Error(`bad client name ${name}`);
    return { role: match[1], device: `${match[1]}@${match[2] ?? "1"}`, tab: Number(match[3] ?? 1) };
}

export class Harness {
    constructor({ url, executablePath, headed = false, canvas = false }) {
        this.url = url.replace(/\/$/, "");
        this.executablePath = executablePath;
        this.headed = headed;
        this.canvas = canvas;
        this.devices = new Map();   // device key -> BrowserContext
        this.clients = new Map();   // client name -> {page, role, device}
        this.userIds = {};          // role -> user id
        this.label = "setup";       // the run in progress, stamped on everything collected
        this.records = [];          // steps and evaluations
        this.checks = [];
        this.console = [];          // console lines and page errors of every page
        this.pageLog = [];          // notifications and dry-run hooks, taken from the pages
        this.stalls = [];           // moments the server took more than STALL_MS to answer /api/status
        this.shots = [];            // screenshots taken (`screenshot`)
        this.styleAdded = new Set(); // clients whose page the harness gave the module's stylesheet (`ensureStyles`)
        this.shotsDir = join(tmpdir(), `${MODULE_ID}-shots`);
    }

    /**
     * Ask the server for `/api/status` every half second while plans run and record every answer slower than
     * STALL_MS: a server that stops answering explains a request that timed out on a client.
     */
    watchServer() {
        let stopped = false;
        const poll = async () => {
            while (!stopped) {
                const t0 = Date.now();
                const ok = await fetch(`${this.url}/api/status`).then(() => true, () => false);
                const ms = Date.now() - t0;
                if (ms > STALL_MS || !ok) this.stalls.push({ label: this.label, at: new Date(t0).toISOString(), ms, ok });
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        };
        poll();
        return () => { stopped = true; };
    }

    async start() {
        await this.launch();
        await this.refreshUserIds();
    }

    /** Launch the browser; if it goes away (a crash), the next plan launches a new one (`ensureBrowser`). */
    async launch() {
        this.browser = await chromium.launch({ executablePath: this.executablePath, headless: !this.headed });
        this.devices.clear();
        this.clients.clear();
    }

    async ensureBrowser() {
        if (this.browser?.isConnected()) return false;
        await this.launch();
        return true;
    }

    async stop() {
        await this.browser?.close();
    }

    /** Read the world's user ids by name from the join page (users can be created by `prepareWorld`). */
    async refreshUserIds() {
        const context = await this.browser.newContext({ viewport: VIEWPORT });
        try {
            const page = await context.newPage();
            await page.goto(`${this.url}/join`);
            await page.waitForFunction(() => Array.isArray(globalThis.game?.data?.users), null, { timeout: READY_TIMEOUT_MS });
            const users = await page.evaluate(() => game.data.users.map((u) => ({ id: u._id, name: u.name })));
            for (const [role, name] of Object.entries(ROLE_USERS)) this.userIds[role] = users.find((u) => u.name === name)?.id ?? null;
        } finally {
            await context.close();
        }
        return this.userIds;
    }

    /** A device's browser context, logged in as its role's user. */
    async device(key, role) {
        if (this.devices.has(key)) return this.devices.get(key);
        const userId = this.userIds[role];
        if (!userId) throw new Error(`no user "${ROLE_USERS[role]}" in this world (run the prepare step first)`);
        const context = await this.browser.newContext({ viewport: VIEWPORT });
        await context.addInitScript(instrumentPage);
        const page = await context.newPage();
        await page.goto(`${this.url}/join`);
        const answer = await page.evaluate(async (body) => {
            const response = await fetch("/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            return response.json();
        }, { action: "join", username: ROLE_USERS[role], userId, password: "" });
        if (answer.status !== "success") throw new Error(`login as ${ROLE_USERS[role]} failed: ${JSON.stringify(answer)}`);
        await page.evaluate((noCanvas) => localStorage.setItem("core.noCanvas", noCanvas), String(!this.canvas));
        await page.close();
        this.devices.set(key, context);
        return context;
    }

    /** Open a client (logging its device in first if needed) and wait until it is ready. */
    async open(name) {
        if (this.clients.has(name)) return this.clients.get(name);
        const { role, device } = parseClient(name);
        const context = await this.device(device, role);
        const page = await context.newPage();
        const client = { name, role, device, page };
        page.on("console", (message) => this.onConsole(client, message));
        page.on("pageerror", (error) => this.console.push({ label: this.label, client: name, type: "pageerror", text: error.message, at: Date.now() }));
        page.on("response", (response) => {
            if (response.status() >= 400) this.console.push({ label: this.label, client: name, type: "http", text: `${response.status()} ${response.url()}`, at: Date.now() });
        });
        const started = Date.now();
        await page.goto(`${this.url}/game`);
        await page.waitForFunction(harnessReady, MODULE_ID, { timeout: READY_TIMEOUT_MS, polling: 100 });
        client.readyMs = Date.now() - started;
        client.styleAdded = await this.ensureStyles(page);
        if (client.styleAdded) this.styleAdded.add(name);
        this.clients.set(name, client);
        return client;
    }

    /**
     * The module's stylesheet, added to the page if the server did not load it. Foundry loads a module's `styles` from
     * the manifest it read when the world was launched (`global.game.world.modules`, `dist/server/views/view.mjs`), so a
     * world launched before `module.json` named the stylesheet serves pages without it until it is launched again. The
     * harness adds the same file the manifest names, so the window looks as it will; the run's results say whether it
     * had to (`styleAdded` on each client, and a check in the screenshot plan). Foundry 14.368 loads module styles as
     * `@import` rules in a `<style>` element (`templates/views/layouts/main.hbs`), not as `<link>`s, so the test is the
     * page's style sheets and their imports (`styleLoaded`); a test of links alone added every module stylesheet a second
     * time (M11 live pass).
     * @returns {Promise<boolean>} whether it was added
     */
    async ensureStyles(page) {
        const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../module.json"), "utf8"));
        let added = false;
        for (const style of manifest.styles ?? []) {
            const path = `modules/${MODULE_ID}/${typeof style === "string" ? style : style.src}`;
            const linked = await page.evaluate(styleLoaded, path);
            if (!linked) {
                await page.addStyleTag({ url: `${this.url}/${path}` });
                added = true;
            }
        }
        return added;
    }

    /**
     * A screenshot of a client's page at a viewport size, saved as `<shotsDir>/<file>`; the viewport goes back to the
     * harness's own size afterwards. `prepare` runs once the page has the new size (to open the window at it). With
     * `selector`, the screenshot is cropped to the first element it matches (a window's frame, `screenshots.mjs`).
     */
    async screenshot(name, file, { width, height }, prepare = null, { selector = null } = {}) {
        const client = this.clients.get(name) ?? await this.open(name);
        mkdirSync(this.shotsDir, { recursive: true });
        await client.page.setViewportSize({ width, height });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const prepared = prepare ? await prepare() : null;
        const path = join(this.shotsDir, file);
        if (selector) await client.page.locator(selector).first().screenshot({ path, animations: "disabled", caret: "hide" });
        else await client.page.screenshot({ path });
        this.shots.push({ label: this.label, client: name, file: path, width, height, selector, prepared });
        await client.page.setViewportSize(VIEWPORT);
        return path;
    }

    /** Close a client's tab, and its device once it has no tab left (that user's socket goes away). */
    async close(name) {
        const client = this.clients.get(name);
        if (!client) return;
        this.clients.delete(name);
        await this.drain(client).catch(() => {});
        await client.page.close();
        const context = this.devices.get(client.device);
        if (context && ![...this.clients.values()].some((c) => c.device === client.device)) {
            this.devices.delete(client.device);
            await context.close();
        }
    }

    /**
     * Exactly these clients online, opened in the order given; then wait until every open page sees the same
     * connected users (Foundry tells the others when a socket comes or goes).
     */
    async only(names) {
        for (const name of [...this.clients.keys()]) if (!names.includes(name)) await this.close(name);
        for (const name of names) await this.open(name);
        const expected = JSON.stringify([...new Set(names.map((name) => this.userIds[parseClient(name).role]))].sort());
        await this.waitAll(() => game.users.filter((u) => u.active).map((u) => u.id).sort(), (ids) => JSON.stringify(ids) === expected);
        return names;
    }

    /** Wait until `read()`, run in every open page, satisfies `test` (run here) on all of them. */
    async waitAll(read, test, timeout = SETTLE_TIMEOUT_MS) {
        const end = Date.now() + timeout;
        let last = {};
        while (Date.now() < end) {
            last = {};
            for (const [name, client] of this.clients) last[name] = await client.page.evaluate(read);
            if (Object.values(last).every(test)) return last;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(`clients did not agree in time: ${JSON.stringify(last)}`);
    }

    /** Wait until every named client (default: all open) reports `status` from the module's snapshot. */
    async settle(status = "ready", names = [...this.clients.keys()], timeout = SETTLE_TIMEOUT_MS) {
        const end = Date.now() + timeout;
        let seen = {};
        while (Date.now() < end) {
            seen = {};
            for (const name of names) seen[name] = await this.clients.get(name).page.evaluate((mod) => game.modules.get(mod).dev.scenarios.snapshot().status, MODULE_ID);
            if (Object.values(seen).every((s) => s === status)) return seen;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        this.check(`clients settle at "${status}"`, false, seen);
        return seen;
    }

    /** Run `fn(arg)` in a client's page and record it. */
    async evaluate(name, fn, arg = null, what = fn.name || "evaluate") {
        const client = this.clients.get(name) ?? await this.open(name);
        const record = { label: this.label, client: name, call: what, params: arg, started: new Date().toISOString() };
        const t0 = Date.now();
        let timer = null;
        try {
            // A step that never answers (pf2e's roll dialog open on the page, say) fails the step instead of the whole run.
            const late = new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`no answer in ${STEP_TIMEOUT_MS / 1000} s`)), STEP_TIMEOUT_MS);
            });
            record.result = await Promise.race([client.page.evaluate(fn, arg), late]);
        } catch (error) {
            record.error = error.message.split("\n")[0];
        } finally {
            clearTimeout(timer);
        }
        record.ms = Date.now() - t0;
        this.records.push(record);
        if (record.error) console.log(`  ! ${name} ${what}: ${record.error}`);
        return record.result ?? { error: record.error };
    }

    /** Run one scenario step on a client: `dev.scenarios.run(id, step, params)`. */
    step(name, id, step, params = {}) {
        return this.evaluate(name, runScenarioStep, { mod: MODULE_ID, id, step, params }, `${id}/${step}`);
    }

    /**
     * Steps that happen at the same moment: each is started without waiting for the others, then all are awaited.
     * @param {[string, string, string, object?][]} steps  `[client, scenario, step, params]`
     */
    together(steps) {
        return Promise.all(steps.map(([name, id, step, params]) => this.step(name, id, step, params)));
    }

    /** Record a check: `ok` is true or false, `detail` is what was seen. */
    check(name, ok, detail = null) {
        this.checks.push({ label: this.label, name, ok: !!ok, detail });
        console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
        return !!ok;
    }

    /** Take what one page recorded (notifications, dry-run hooks) since the last time, into `pageLog`. */
    async drain(client) {
        const taken = await client.page.evaluate(() => {
            const live = window.__live ?? { notes: [], dryRun: [] };
            return { notes: live.notes.splice(0), dryRun: live.dryRun.splice(0) };
        });
        this.pageLog.push({ label: this.label, client: client.name, ...taken });
        return taken;
    }

    /** What every open page recorded since the last time, by client (also kept in `pageLog`). */
    async collectPages() {
        const out = {};
        for (const [name, client] of this.clients) out[name] = await this.drain(client);
        return out;
    }

    onConsole(client, message) {
        const type = message.type();
        const text = message.text();
        if (type === "error" || type === "warning" || text.includes(MODULE_ID)) {
            this.console.push({ label: this.label, client: client.name, type, text: text.slice(0, 2000), at: Date.now() });
        }
    }

    /** Close every client. */
    async closeAll() {
        for (const name of [...this.clients.keys()]) await this.close(name);
    }
}

/* -------------------------------------------- */
/*  Command line                                 */
/* -------------------------------------------- */

const ALL_SCENARIOS = Object.keys(SCENARIOS);

/**
 * The browser binary. Arch's `/usr/bin/chromium` is a launcher that adds the user's `chromium-flags.conf` (desktop
 * flags, extensions) to every start; the binary behind it runs without them.
 */
export const DEFAULT_CHROMIUM = existsSync("/usr/lib/chromium/chromium") ? "/usr/lib/chromium/chromium" : "/usr/bin/chromium";

async function main() {
    const { values } = parseArgs({
        options: {
            url: { type: "string", default: "http://localhost:30000" },
            chromium: { type: "string", default: DEFAULT_CHROMIUM },
            scenarios: { type: "string", default: ALL_SCENARIOS.join(",") },
            runs: { type: "string", default: "2" },
            behaviours: { type: "string", default: "all" },
            out: { type: "string", default: join(tmpdir(), `${MODULE_ID}-live-${new Date().toISOString().replace(/[:.]/g, "-")}`) },
            headed: { type: "boolean", default: false },
            canvas: { type: "boolean", default: false },
            shots: { type: "string", default: "" },
        },
    });
    const scenarios = values.scenarios === "none" ? [] : values.scenarios.split(",");
    const behaviours = values.behaviours === "none" ? [] : values.behaviours === "all" ? Object.keys(BEHAVIOURS) : values.behaviours.split(",");
    for (const id of scenarios) if (!SCENARIOS[id]) throw new Error(`no scenario plan ${id} (have ${ALL_SCENARIOS.join(", ")})`);
    for (const id of behaviours) if (!BEHAVIOURS[id]) throw new Error(`no behaviour check ${id} (have ${Object.keys(BEHAVIOURS).join(", ")})`);

    const h = new Harness({ url: values.url, executablePath: values.chromium, headed: values.headed, canvas: values.canvas });
    h.shotsDir = values.shots || join(values.out, "shots");
    const report = { url: values.url, started: new Date().toISOString(), runs: [] };
    mkdirSync(values.out, { recursive: true });
    const file = join(values.out, "results.json");
    const save = () => writeFileSync(file, JSON.stringify({ ...report, records: h.records, checks: h.checks, console: h.console, pages: h.pageLog, stalls: h.stalls,
        shots: h.shots, styleAdded: [...h.styleAdded] }, null, 2));

    await h.start();
    const stopWatch = h.watchServer();
    try {
        h.label = "prepare";
        report.world = await prepareWorld(h);
        const queue = [
            ...Array.from({ length: Number(values.runs) }, (_, i) => scenarios.map((id) => ({ kind: "scenario", id, run: i + 1 }))).flat(),
            ...behaviours.map((id) => ({ kind: "behaviour", id, run: 1 })),
        ];
        for (const { kind, id, run } of queue) {
            h.label = `${kind} ${id} #${run}`;
            console.log(`\n== ${h.label}`);
            if (await h.ensureBrowser()) h.check("the browser had gone away and was launched again", true);
            const t0 = Date.now();
            let error = null;
            let detail = null;
            try {
                detail = await (kind === "scenario" ? SCENARIOS[id] : BEHAVIOURS[id])(h, report.world);
            } catch (e) {
                error = e.message;
                h.check("plan ran to the end", false, e.message);
            }
            await h.collectPages().catch(() => ({}));
            const checks = h.checks.filter((c) => c.label === h.label);
            report.runs.push({ label: h.label, kind, id, run, ms: Date.now() - t0, pass: !error && checks.every((c) => c.ok),
                error, detail, checks: checks.length, failed: checks.filter((c) => !c.ok).map((c) => c.name) });
            save();
            await h.closeAll().catch(() => {});
        }
        h.label = "finish";
        await h.ensureBrowser();
        report.finish = await finishWorld(h, report.world);
    } finally {
        stopWatch();
        report.finished = new Date().toISOString();
        save();
        await h.stop();
    }
    console.log(`\n${report.runs.map((r) => `${r.pass ? "PASS" : "FAIL"} ${r.label}${r.failed.length ? `: ${r.failed.join("; ")}` : ""}`).join("\n")}`);
    console.log(`\nresults: ${file}`);
    if (report.runs.some((r) => !r.pass)) process.exitCode = 1;
}

if (import.meta.main) await main();
