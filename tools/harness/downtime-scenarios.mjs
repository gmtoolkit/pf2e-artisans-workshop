/**
 * Live-harness steps for M6 (DESIGN.md 4.8, 6.7, 6.10, 9, 10.1 Downtime tab, 15.3), merged into the scenarios of
 * `sync-scenarios.mjs` as scenario `m6`. The live driver's behaviour checks (`live-plans.mjs`, the `m6-*` plans) run
 * them: a PC in downtime accruing days as the clock moves, with the one prompt to its owner; the Advance days wizard
 * driven step by step in its window, with a GM moving the clock and with players only; Communal Crafting with a helper
 * joining, rolling and leaving; an Earn Income job paid once per day across repeated advances and two devices; and a
 * settlement profile capping task levels.
 *
 * Every step goes through the module's own functions, as the window's buttons do; the wizard is driven by clicks in its
 * own window. Console output only: a developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { holdingsOf, valueCp } from "../../scripts/logic/coins.mjs";
import { liveRows } from "../../scripts/logic/core.mjs";
import { parseActivity } from "../../scripts/logic/downtime.mjs";
import { reductionCp, remainingCp } from "../../scripts/logic/progress.mjs";
import { coinStacks } from "../../scripts/foundry/coins.mjs";
import * as communal from "../../scripts/foundry/communal.mjs";
import * as downtime from "../../scripts/foundry/downtime.mjs";
import * as jobs from "../../scripts/foundry/jobs.mjs";
import * as orders from "../../scripts/foundry/orders.mjs";
import { rollCraft } from "../../scripts/foundry/rolls.mjs";
import { rulesFromSettings } from "../../scripts/foundry/settings.mjs";
import { read, records } from "../../scripts/foundry/store.mjs";
import { openAdvance } from "../../scripts/ui/advance.mjs";
import { openWorkshop, WorkshopApp } from "../../scripts/ui/workshop.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const purseCp = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const actorOf = (p) => (p.actor ? fromUuidSync(p.actor) : game.user.character);

async function waitFor(test, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = await test();
        if (value) return value;
        await sleep(200);
    }
    return null;
}

/** A PC's downtime in brief. */
function pcBrief(actor) {
    const status = downtime.statusOf(actor);
    return {
        name: actor.name, inDowntime: status.inDowntime, since: status.since, activity: plain(status.activity), pending: downtime.pendingOf(actor).count,
        resolved: downtime.resolvedOf(actor), today: plain(downtime.today()),
        days: records("days").filter((d) => d.actor === actor.id).map((d) => ({ day: d.day, toDay: d.toDay, kind: d.kind ?? null, activity: d.activity?.kind ?? null,
            wageCp: d.wageCp ?? null, helpers: plain(d.helpers ?? null), result: d.result ?? null })).sort((a, b) => a.day - b.day),
    };
}

/** A resolution or a wizard run in brief: per PC, what was written, where it stopped, and how each wage went. */
const resultBrief = (r) => ({
    actor: r.actor?.name ?? null, ok: r.ok !== false, reason: r.reason ?? null, records: (r.records ?? []).map((d) => d.day),
    stop: plain(r.stop ?? null), wages: (r.wages ?? []).map((w) => ({ day: w.day, cp: w.cp, outcome: w.result?.outcome ?? w.result?.reason ?? null })),
});

/** An order with its helpers and work in brief. */
function orderBrief(id) {
    const order = read(`orders.${id}`);
    if (!order) return null;
    const days = records("days");
    const rules = rulesFromSettings();
    return {
        id, status: order.status, priceCp: order.priceCp, upfrontCp: order.upfrontCp, dc: order.dc?.final ?? null,
        helpers: Object.fromEntries(Object.entries(order.helpers ?? {}).map(([actorId, h]) => [actorId, plain(h)])),
        extra: days.filter((d) => d.order === id && d.kind === "extra").map((d) => ({ day: d.day, crafterCp: d.crafterCp, helpers: plain(d.helpers) })),
        reductionCp: reductionCp(order, days, rules), remainingCp: order.priceCp === null ? null : remainingCp(order, days, rules),
    };
}

/** A job with its wages and claims in brief. */
function jobBrief(id) {
    const job = read(`jobs.${id}`);
    const live = liveRows(records("rows"));
    return {
        job: plain(job), purse: job ? purseCp(fromUuidSync(job.actor)) : null,
        wages: live.filter((r) => r.kind === "wage" && r.job === id).map((r) => ({ day: r.day, cp: r.cp, state: r.state })).sort((a, b) => a.day - b.day),
        claims: records("claims").filter((c) => c.kind === "wage" && c.job === id).map((c) => ({ day: c.day, cp: c.cp, resolved: !!c.resolved })),
    };
}

/** The craft step's request: params.quantity (default 1) of params.uuid, crafted by and for `me`, delivered to the strongbox. */
export const craftRequest = (p, me) => ({ uuid: p.uuid, quantity: p.quantity ?? 1, requester: me.uuid, crafter: me.uuid, recipient: { kind: "strongbox" } });

/** The Advance days window as it is now: its step, the step's words, whether it offers the clock. */
function wizardSnap(app) {
    const el = app?.element;
    return {
        step: app?.wizard?.step ?? null, text: el?.querySelector(".wizard-body")?.innerText ?? "",
        clockOption: !!el?.querySelector("input[name='advanceClock']"), buttons: [...(el?.querySelectorAll("footer button") ?? [])].map((b) => b.dataset.action),
    };
}

export const DOWNTIME_SCENARIOS = {
    m6: {
        about: "M6: downtime days and the clock's prompt, the day resolver and the Advance days wizard, Communal Crafting helpers, Earn Income jobs and settlements",
        reset: { about: "GM: no settlement profiles; returns the workshop day", run: async () => {
            await game.settings.set(MODULE_ID, "settlements", {});
            return plain(downtime.today());
        } },
        today: { about: "any client: the workshop day as this client sees it", run: () => plain(downtime.today()) },
        status: { about: "any client: a PC's downtime (params.actor, else the user's character), after params.ms", run: async (p) => {
            await sleep(p.ms ?? 0);
            return pcBrief(actorOf(p));
        } },
        downtime: { about: "the owner: put a PC in downtime (params.on) or take it out (params.notDowntime)", run: async (p) => {
            const actor = actorOf(p);
            return { result: plain(await downtime.setDowntime(actor.uuid, p.on !== false, { notDowntime: !!p.notDowntime })), pc: pcBrief(actor) };
        } },
        activity: { about: "the owner: set a PC's activity (params.activity as a key: craft:<id>, earn:<id>, subsist)", run: async (p) => {
            const actor = actorOf(p);
            return { result: plain(await downtime.setActivity(actor.uuid, parseActivity(p.activity))), pc: pcBrief(actor) };
        } },
        clock: { about: "GM: move the world clock params.days days (params.seconds more), then wait params.ms", run: async (p) => {
            await game.time.advance((p.days ?? 0) * downtime.secondsPerDay() + (p.seconds ?? 0));
            await sleep(p.ms ?? 1500);
            return plain(downtime.today());
        } },
        resolve: { about: "any client: resolve a PC's days (params.actor, params.activity key, params.count)", run: async (p) => {
            const actor = actorOf(p);
            const activity = p.activity === undefined ? undefined : p.activity === "not-downtime" ? "not-downtime" : parseActivity(p.activity);
            return { result: resultBrief({ actor, ...(await downtime.resolveDays({ actor, activity, count: p.count ?? null })) }), pc: pcBrief(actor) };
        } },
        advance: { about: "any client: the wizard's commit without its window (params.days, params.since, params.advanceClock)", run: async (p) => {
            const run = await downtime.advanceDays({ kind: p.since ? "since" : "days", count: p.days ?? 1, advanceClock: !!p.advanceClock });
            return { ok: run.ok, toDay: run.toDay ?? null, clock: run.clock ?? null, results: (run.results ?? []).map(resultBrief), today: plain(downtime.today()) };
        } },
        match: { about: "GM: move the clock to match the logged days", run: async () => ({ result: plain(await downtime.advanceClockToMatch()), today: plain(downtime.today()) }) },
        wizard: {
            about: "any client: open the wizard (params.mode, params.actor) and drive it by params.script ({field, value} or {click}); each step's words",
            run: async (p) => {
                const app = await openAdvance({ mode: p.mode ?? "advance", actor: p.actor ?? null });
                await waitFor(() => app.rendered, 8000);
                await sleep(500);
                const seen = [wizardSnap(app)];
                for (const action of p.script ?? []) {
                    if (action.field) {
                        const selector = action.radio ? `[name='${action.field}'][value='${action.value}']` : `[name='${action.field}']${action.actor ? `[data-actor='${action.actor}']` : ""}`;
                        const input = app.element.querySelector(selector);
                        if (input?.type === "checkbox" || input?.type === "radio") input.checked = action.radio ? true : !!action.value;
                        else if (input) input.value = String(action.value);
                        input?.dispatchEvent(new Event("change", { bubbles: true }));
                    } else {
                        app.element.querySelector(`[data-action='${action.click}']`)?.click();
                    }
                    await sleep(action.ms ?? 1000);
                    seen.push({ ...wizardSnap(app), after: action });
                }
                const result = app.wizard.result;
                const out = { seen, result: result ? { ok: result.ok, toDay: result.toDay ?? null, clock: result.clock ?? null, results: (result.results ?? []).map(resultBrief) } : null };
                if (p.close !== false) await app.close();
                return out;
            },
        },
        tab: { about: "any client: open the Workshop on the Downtime tab; what it shows (rows, badge, the day, Move the calendar)", run: async (p) => {
            await WorkshopApp.instance?.close({ animate: false });
            await waitFor(() => !WorkshopApp.instance, 3000);
            const app = await openWorkshop({ tab: "downtime" });
            await sleep(p.ms ?? 1500);
            const el = app.element;
            const out = {
                rows: [...el.querySelectorAll(".downtime-pc")].map((li) => ({ name: li.querySelector(".pc-name")?.textContent.trim(), pending: li.querySelector(".pc-pending")?.textContent.trim() ?? null })),
                badge: el.querySelector(".workshop-tab[data-tab='downtime'] .tab-badge")?.textContent.trim() ?? null,
                day: el.querySelector(".downtime-day .day")?.textContent.trim() ?? null, ahead: el.querySelector(".downtime-day .ahead")?.textContent.trim() ?? null,
                match: !!el.querySelector("[data-op='match']"), jobs: el.querySelectorAll(".job-row").length,
            };
            if (p.click) {
                el.querySelector(p.click)?.click();
                await sleep(p.ms ?? 1500);
                out.clicked = p.click;
                out.after = plain(downtime.today());
            }
            if (p.close !== false) await app.close();
            return out;
        } },
        order: { about: "any client: an order with its helpers and work (params.order), after params.ms", run: async (p) => {
            await sleep(p.ms ?? 0);
            return orderBrief(p.order);
        } },
        craft: { about: "the crafter's owner: request params.quantity (1) of params.uuid crafted by the user's character, pledge params.pledge, start, setup days, roll and settle", run: async (p) => {
            const me = game.user.character;
            const filed = await orders.requestOrder(craftRequest(p, me));
            const id = filed.orders?.[0];
            if (!id) return { filed: plain(filed) };
            if (p.pledge) await orders.pledgeTo(id, me.uuid, p.pledge);
            const started = await orders.start(id);
            for (let i = 0; i < 4 && read(`orders.${id}.status`) === "setup"; i++) await orders.workDay(id);
            if (read(`orders.${id}.status`) === "check") {
                await rollCraft(id, { skipDialog: true });
                await waitFor(() => read(`orders.${id}.status`) === "rolled", 10000);
            }
            if (read(`orders.${id}.status`) === "rolled") await orders.settle(id);
            return { order: id, started: plain(started), brief: orderBrief(id) };
        } },
        work: { about: "the crafter's owner: params.count work days on params.order", run: async (p) => {
            const out = [];
            for (let i = 0; i < (p.count ?? 1); i++) out.push(plain(await orders.workDay(p.order)));
            return { results: out, brief: orderBrief(p.order) };
        } },
        join: { about: "the helper's owner: join params.order with params.skill and roll the helper check without the dialog", run: async (p) => {
            const actor = actorOf(p);
            const joined = await communal.joinOrder(p.order, actor.uuid, p.skill ?? "crafting");
            let rolled = null;
            if (joined.ok && p.roll !== false) {
                rolled = await communal.rollHelp(p.order, actor.uuid, { skipDialog: true });
                await waitFor(() => Number.isInteger(read(`orders.${p.order}.helpers.${actor.id}.degree`)), 10000);
            }
            return { joined: plain(joined), rolled: plain(rolled), brief: orderBrief(p.order), pc: pcBrief(actor) };
        } },
        leave: { about: "the helper's owner: leave params.order", run: async (p) => {
            const actor = actorOf(p);
            return { result: plain(await communal.leaveOrder(p.order, actor.uuid)), brief: orderBrief(p.order), pc: pcBrief(actor) };
        } },
        job: { about: "the earner's owner: start a job (params.skill, params.taskLevel) and roll it without the dialog unless params.roll is false", run: async (p) => {
            const actor = actorOf(p);
            const started = await jobs.startJob({ actor: actor.uuid, skill: p.skill ?? "crafting", taskLevel: p.taskLevel ?? 0 });
            if (started.ok && p.roll !== false) {
                await jobs.rollJob(started.job, { skipDialog: true });
                await waitFor(() => read(`jobs.${started.job}.check`), 10000);
            }
            return { started: plain(started), brief: started.job ? jobBrief(started.job) : null };
        } },
        jobState: { about: "any client: a job, its wages and claims (params.job), after params.ms", run: async (p) => {
            await sleep(p.ms ?? 0);
            return jobBrief(p.job);
        } },
        profile: { about: "GM: save a settlement profile (params.name, size, level, caps)", run: async (p) => plain(await jobs.saveProfile(p)) },
        settle: { about: "any member: set the party's settlement (params.profile, null for none)", run: async (p) => ({
            result: plain(await jobs.setSettlement(p.profile ?? null)), current: plain(jobs.settlement()), record: plain(jobs.settlementRecord()),
        }) },
        close: { about: "any client: close the Workshop and the wizard", run: async () => {
            await WorkshopApp.instance?.close();
            const { AdvanceDaysApp } = await import("../../scripts/ui/advance.mjs");
            await AdvanceDaysApp.instance?.close();
            return { closed: true };
        } },
    },
};
