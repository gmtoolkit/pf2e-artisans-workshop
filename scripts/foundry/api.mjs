/**
 * The public API (DESIGN.md 11.2), as far as M4-M8 build it: opening the window, the order lifecycle, the funds, formulas
 * (M5), downtime, Earn Income jobs and Communal Crafting helpers (M6), daily preparations (M7, `prep`), and combat
 * alchemy and "Use best consumable" (M8, `alchemy`, `consumables`), the affliction tracker (M8a, `afflictions`, `rules.afflictionStep`), M9's
 * crafts and M9a's Treasure Vault (Remastered) variants (`variants`). It is
 * published at `game.modules.get("pf2e-artisans-workshop").api` in `ready`, and the `pf2e-artisans-workshop.ready` hook
 * fires right after with the same object. Later milestones add their namespaces; M11 completes the macros of 11.1 (`macros`,
 * `ui.macros`, `orders.postSummary`, and `orders.rollCheck` without an order).
 *
 * The API resolves an actor as 11.1 says: an explicit `actor` (document or UUID), the single controlled token's actor,
 * the user's assigned character; otherwise it returns `{ok: false, reason: "no-actor"}`.
 */
import { MODULE_ID } from "../constants.mjs";
import { openWorkshop } from "../ui/workshop.mjs";
import { openRequestForm } from "../ui/request.mjs";
import { claimRowInput, openClaims } from "../logic/claims.mjs";
import { memberBalances } from "../logic/reconcile.mjs";
import { parseMoney } from "../ui/format.mjs";
import { familyKey } from "../logic/families.mjs";
import { FORMULA_ORDER_ROUTES } from "../logic/formula-jobs.mjs";
import * as formulas from "./formulas.mjs";
import * as funds from "./funds.mjs";
import * as orders from "./orders.mjs";
import * as pledges from "./pledges.mjs";
import { productFacts } from "./products.mjs";
import * as services from "./services.mjs";
import { handOver } from "./custody.mjs";
import * as communal from "./communal.mjs";
import * as crafts from "./crafts.mjs";
import * as deconstruct from "./deconstruct.mjs";
import * as nature from "./nature.mjs";
import * as quests from "./quests.mjs";
import * as variants from "./variants.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { variantGroupsOn } from "../logic/variants.mjs";
import * as downtime from "./downtime.mjs";
import * as jobs from "./jobs.mjs";
import * as morning from "./morning.mjs";
import * as alchemy from "./alchemy.mjs";
import * as consumables from "./consumables.mjs";
import * as vials from "./vials.mjs";
import { strikeWith } from "./combat.mjs";
import { openBandolier } from "../ui/bandolier.mjs";
import { openQuickAlchemy } from "../ui/alchemy-panel.mjs";
import { beginCycle, expirySweep } from "./expiry.mjs";
import * as afflictions from "./afflictions.mjs";
import { backend as afflictionBackend, definitionOf, defineWorld } from "./affliction-defs.mjs";
import * as coatings from "./coatings.mjs";
import { applyDegree } from "../logic/affliction.mjs";
import { openAfflictions } from "../ui/afflictions.mjs";
import { parseActivity } from "../logic/downtime.mjs";
import { read, records } from "./store.mjs";
import { status } from "./state.mjs";
import * as ext from "./extensions.mjs";
import { API_VERSION } from "../logic/extensions.mjs";
import { levelDC } from "../logic/dc.mjs";
import { MACROS, macroById, macroCommand } from "../logic/macros.mjs";
import { nextCheckOrder } from "../logic/entry.mjs";
import { queueOrder } from "../logic/views.mjs";
import { addToHotbar, openShelf, runMacro } from "../ui/macros.mjs";
import { postQueueSummary } from "../ui/chat.mjs";

/** The integer that changes only when an extension interface or hook payload changes incompatibly (11.3, 12). */
export { API_VERSION };

/** The actor the call is about (11.1). */
function resolveActor(actor) {
    if (actor) return typeof actor === "string" ? fromUuidSync(actor) : actor;
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length === 1) return controlled[0].actor;
    return game.user.character ?? null;
}

/** An amount given as copper, "20 gp", or `{gp: 20}`. */
function amountCp(amount) {
    if (Number.isSafeInteger(amount)) return amount;
    if (typeof amount === "string") return parseMoney(amount);
    if (amount && typeof amount === "object") {
        const rates = { pp: 1000, gp: 100, sp: 10, cp: 1 };
        return Object.entries(amount).reduce((sum, [unit, n]) => sum + (rates[unit] ?? 0) * Number(n || 0), 0);
    }
    return null;
}

const noActor = () => ({ ok: false, reason: "no-actor" });

/** A funding source as the funds functions take it, or null when a purse has no actor to resolve. */
function drawOf({ source = "purse", from = null, amount = null } = {}) {
    const cp = amount === null || amount === undefined ? undefined : amountCp(amount);
    if (source === "fund") return { source, cp };
    const actor = resolveActor(from);
    return actor ? { source: "purse", actor: actor.uuid, cp } : null;
}

/**
 * Where a purchase is paid from (As built in M5 on M4.1), as the formula, casting and service functions take it:
 * `{source: "fund"}` for the party fund, or `{source: "purse", from}` for a character's purse (`fallback`, the acting
 * character, when `from` is not given). Null when a purse has no actor to resolve.
 */
function payOf(pay = null, fallback = null) {
    if (pay?.source === "fund") return { paidFrom: "fund", payer: null };
    const actor = pay?.from ? resolveActor(pay.from) : fallback;
    return actor ? { paidFrom: "purse", payer: actor.uuid } : null;
}

/** The API object. */
export function buildApi() {
    const api = {
        version: game.modules.get(MODULE_ID).version,
        apiVersion: API_VERSION,
        isReady: () => status() === "ready",
        ui: {
            open: (options = {}) => openWorkshop(options),
            openOrder: (id) => openWorkshop({ tab: "queue", order: id }),
            requestForm: (uuidOrItem = null, options = {}) => openRequestForm({
                uuid: typeof uuidOrItem === "string" ? uuidOrItem : uuidOrItem?.uuid ?? null, requester: resolveActor(options.actor)?.uuid ?? null,
            }),
            // M11 (11.1, 10.2): the macro shelf.
            macros: () => openShelf(),
        },
        orders: {
            list: (filter = {}) => records("orders").filter((o) => !filter.status || o.status === filter.status),
            get: (id) => read(`orders.${id}`) ?? null,
            // M9: a tattoo or graft is made on `subject` (else the recipient, else the requester), upgrading `replaces`.
            request: ({ uuid, quantity = 1, recipient = null, crafter = null, note = "", actor = null, subject = null, replaces = null } = {}) => {
                const requester = resolveActor(actor);
                if (!requester) return Promise.resolve(noActor());
                if (!uuid) return openRequestForm({ requester: requester.uuid });
                const on = subject ? resolveActor(subject)?.uuid ?? null : null;
                const target = recipient === "strongbox" ? { kind: "strongbox" } : { kind: "actor", uuid: on ?? recipient ?? requester.uuid };
                return orders.requestOrder({ uuid, quantity, requester: requester.uuid, recipient: target, crafter, note, target: on,
                    variant: replaces ? { replaces } : {} });
            },
            accept: (id, { crafter = null } = {}) => {
                const actor = resolveActor(crafter);
                return actor ? orders.accept(id, actor.uuid) : Promise.resolve(noActor());
            },
            release: (id) => orders.release(id),
            start: (id) => orders.start(id),
            workDay: (id) => orders.workDay(id),
            // M11 (11.1 macro 4): without `order`, the actor's oldest order waiting for its check.
            rollCheck: ({ order = null, actor = null, skipDialog } = {}) => {
                if (order) return orders.roll(order, { skipDialog });
                const who = resolveActor(actor);
                if (!who) return Promise.resolve(noActor());
                const next = nextCheckOrder(queueOrder(records("orders")), who.uuid);
                return next ? orders.roll(next.id, { skipDialog }) : Promise.resolve({ ok: false, reason: "no-order" });
            },
            settle: (id) => orders.settle(id),
            pause: (id) => orders.pause(id),
            resume: (id) => orders.resume(id),
            retry: (id) => orders.retry(id),
            // With `draw` ({source: "fund"|"purse", from, amount}), a shortfall is drawn from that source first (M4.1).
            finish: ({ order, draw = null } = {}) => {
                if (!draw) return orders.finish(order);
                const source = drawOf(draw);
                return source ? funds.finishOrder(order, { draw: source }) : Promise.resolve(noActor());
            },
            cancel: (id) => orders.cancel(id),
            undo: (id) => orders.undo(id),
            // M11 (11.1 macro 19): the open orders as a chat card, whispered to the poster unless `whisper` is false.
            postSummary: ({ whisper = true } = {}) => postQueueSummary({ whisper }),
        },
        funds: {
            balance: ({ actor = null } = {}) => {
                const balances = memberBalances(records("rows"));
                const who = resolveActor(actor);
                return who ? balances.byActor.find((b) => b.actor === who.uuid)?.cp ?? 0 : balances;
            },
            pledge: ({ order, amount, from = null } = {}) => {
                const actor = resolveActor(from);
                const cp = amountCp(amount);
                return actor ? orders.pledgeTo(order, actor.uuid, cp) : Promise.resolve(noActor());
            },
            // "Fund this order" (M4.1): `source` "fund" earmarks unallocated party-fund money, "purse" pledges from `from`.
            fund: ({ order, amount, source = "purse", from = null } = {}) => {
                const draw = drawOf({ source, from, amount });
                return draw ? funds.fundOrder(order, draw) : Promise.resolve(noActor());
            },
            returnToFund: ({ order, amount } = {}) => funds.returnToParty(order, amountCp(amount)),
            deposit: ({ amount, from = null } = {}) => {
                const actor = resolveActor(from);
                return actor ? funds.deposit(actor.uuid, amountCp(amount)) : Promise.resolve(noActor());
            },
            withdraw: ({ amount, order = null, to = null } = {}) => {
                const actor = resolveActor(to);
                if (!actor) return Promise.resolve(noActor());
                return order ? orders.withdrawFrom(order, actor.uuid, amountCp(amount)) : funds.withdrawFund(actor.uuid, amountCp(amount));
            },
            reverse: (rowId) => funds.reverse(rowId),
            // M10 (12.4): an extension's own `income` or `expense` row, `{kind, cp | amount, key, source: "<moduleId>:<slug>", via, actor, note, day}`.
            post: (row = {}) => ext.postExtRow({ ...row, cp: row.cp ?? (row.amount === undefined ? undefined : amountCp(row.amount)),
                actor: row.actor ? resolveActor(row.actor)?.uuid ?? row.actor : null }),
            rows: (filter = {}) => records("rows").filter((r) => (!filter.order || r.order === filter.order) && (!filter.actor || r.actor === filter.actor)),
            // M10 review: an extension's row by its key, and whether it was reversed (`{id, kind, cp, state, reversed}` or null).
            posted: ({ source, key } = {}) => ext.postedRow({ source, key }),
            claims: (actor = null) => openClaims(read("claims"), resolveActor(actor)?.uuid ?? null).map((claim) => ({ ...claim, row: claimRowInput(claim) })),
            claimAll: () => funds.takeAll(),
        },
        // M5 (11.2): formulas, casting pledges, custody and service orders.
        formulas: {
            knows: (actor, uuid) => formulas.bookOf(resolveActor(actor)).includes(uuid),
            routes: (actor, uuid) => formulas.routesFor(resolveActor(actor), uuid),
            family: async (uuid) => {
                const facts = await productFacts(uuid);
                return facts ? familyKey(facts) : null;
            },
            provenance: (actor = null) => formulas.provenanceOf(resolveActor(actor)),
            codex: (actor = null) => formulas.codexData(resolveActor(actor)),
            /**
             * Learn a formula (11.1 macro 11): `buy`, `copy-npc`, `scanner` and `grant` (with `source` and `pickLevel`) at
             * once; `copy-ally` asks the ally (`from`) for a formula-copy service; `invent`, `reverse-engineer` and
             * `craft-copy` (for `for`, another member) file a formula job with `actor` as the crafter. A cost is paid as
             * `pay` says (M5 on M4.1): `{source: "fund"}`, or `{source: "purse", from}` (`actor`'s purse by default).
             */
            acquire: ({ uuid, route, actor = null, from = null, for: learner = null, source = null, pickLevel = null, seller = false, pay = null } = {}) => {
                const who = resolveActor(actor);
                if (!who) return Promise.resolve(noActor());
                const paying = payOf(pay, who);
                if (!paying) return Promise.resolve(noActor());
                if (route === "copy-ally") {
                    return services.requestService({ kind: "formula-copy", requester: who.uuid, performer: resolveActor(from)?.uuid ?? null, uuid, ...paying });
                }
                if (FORMULA_ORDER_ROUTES.includes(route)) {
                    const target = route === "craft-copy" ? resolveActor(learner)?.uuid ?? null : who.uuid;
                    if (!target) return Promise.resolve(noActor());
                    return orders.requestOrder({ uuid, requester: who.uuid, recipient: { kind: "actor", uuid: target }, crafter: who.uuid, productType: "formula", route });
                }
                return formulas.acquire({ learner: who.uuid, uuid, route, ...paying, source, pickLevel, confirm: seller ? ["seller"] : [] });
            },
        },
        // Casting pledges (6.9). A spell's cost and a bought casting are paid as `pay` says (M5 on M4.1): `{source:
        // "fund"}`, or `{source: "purse", from}`; `buy`'s `from` alone still names the purse.
        pledges: {
            // M9: `entry` names the listed casting (a staff's, a spellheart's) the pledge supplies.
            pledge: (order, { caster = null, spell, castings = 1, entry = null } = {}) => pledges.pledgeCasting(order, { caster: resolveActor(caster)?.uuid ?? null, spell,
                castings, entry }),
            fulfil: (order, pledge, { cost = 0, pay = null } = {}) => {
                const paying = pay ? payOf(pay) : {};
                return paying ? pledges.fulfilPledge(order, pledge, { costCp: amountCp(cost) ?? 0, ...paying }) : Promise.resolve(noActor());
            },
            withdraw: (order, pledge) => pledges.withdrawPledge(order, pledge),
            buy: (order, { spell, castings = 1, from = null, pay = null, entry = null } = {}) => {
                const paying = payOf(pay ?? { source: "purse", from }, resolveActor(from));
                return paying ? pledges.buyCasting(order, { ...paying, spell, castings, entry }) : Promise.resolve(noActor());
            },
        },
        custody: {
            handOver: (opts) => handOver(opts),
        },
        services: {
            list: (filter = {}) => records("services").filter((s) => !filter.status || s.status === filter.status),
            get: (id) => read(`services.${id}`) ?? null,
            request: ({ kind, actor = null, performer = null, target = null, host = null, uuid = null, note = "", pay = null } = {}) => {
                const who = resolveActor(actor);
                const paying = who ? payOf(pay, who) : null;
                return paying ? services.requestService({ kind, requester: who.uuid, performer: resolveActor(performer)?.uuid ?? null, target, host, uuid, note, ...paying })
                    : Promise.resolve(noActor());
            },
            offer: (id, { actor = null } = {}) => {
                const who = resolveActor(actor);
                return who ? services.offer(id, who.uuid) : Promise.resolve(noActor());
            },
            perform: (id, options = {}) => services.perform(id, options),
            cancel: (id) => services.cancel(id),
        },
        // M6 (11.2): downtime (4.8, 9), Earn Income jobs (6.10) and Communal Crafting helpers (6.7). An activity is
        // `{kind, ref}` or its key (`"craft:<orderId>"`, `"earn:<jobId>"`, `"subsist"`).
        downtime: {
            today: () => downtime.today(),
            status: (actor = null) => {
                const who = resolveActor(actor);
                return who ? { ...downtime.statusOf(who), pending: downtime.pendingOf(who), resolvedThrough: downtime.resolvedOf(who) } : null;
            },
            pending: (actor = null) => {
                const who = resolveActor(actor);
                return who ? downtime.pendingOf(who) : null;
            },
            setDowntime: (on, { actor = null, notDowntime = false } = {}) => {
                const who = resolveActor(actor);
                return who ? downtime.setDowntime(who.uuid, on, { notDowntime }) : Promise.resolve(noActor());
            },
            setActivity: (actor, activity) => {
                const who = resolveActor(actor);
                return who ? downtime.setActivity(who.uuid, typeof activity === "string" ? parseActivity(activity) : activity) : Promise.resolve(noActor());
            },
            resolve: ({ actor = null, activity = undefined, count = null } = {}) => {
                const who = resolveActor(actor);
                const chosen = typeof activity === "string" && activity !== "not-downtime" ? parseActivity(activity) : activity;
                return who ? downtime.resolveDays({ actor: who, activity: chosen, count }) : Promise.resolve(noActor());
            },
            advance: ({ days = 1, since = false, assignments = {}, advanceClock = false } = {}) => downtime.advanceDays({
                kind: since ? "since" : "days", count: days, advanceClock,
                assignments: Object.fromEntries(Object.entries(assignments).map(([id, a]) => [id, typeof a === "string" && !["skip", "not-downtime"].includes(a) ? parseActivity(a) : a])),
            }),
            advanceClockToMatch: () => downtime.advanceClockToMatch(),
            setSettlement: (profileId) => jobs.setSettlement(profileId),
            settlement: () => jobs.settlement(),
            profiles: () => jobs.profiles(),
        },
        income: {
            list: (filter = {}) => records("jobs").filter((j) => (!filter.status || j.status === filter.status) && (!filter.actor || j.actor === filter.actor)),
            start: ({ actor = null, skill, taskLevel } = {}) => {
                const who = resolveActor(actor);
                return who ? jobs.startJob({ actor: who.uuid, skill, taskLevel }) : Promise.resolve(noActor());
            },
            roll: (jobId, options = {}) => jobs.rollJob(jobId, options),
            reroll: (jobId) => jobs.rerollJob(jobId),
            end: (jobId) => jobs.endJob(jobId),
            undo: (jobId) => jobs.undoJob(jobId),
        },
        // M7 (11.2, macros 7 and 18): daily preparations, loadouts, standing orders, the affix board, expiry.
        prep: {
            open: ({ actor = null, loadout = null, apply = false } = {}) => {
                const who = resolveActor(actor);
                if (apply && who) {
                    const pools = loadout ? Object.fromEntries(Object.keys(morning.loadoutsOf(who)[loadout]?.pools ?? {}).map((slug) => [slug, { mode: "loadout", id: loadout }])) : {};
                    return morning.applyMorning(who, { pools });
                }
                return openWorkshop({ tab: "morning", actor: who ?? null });
            },
            sources: async (actor = null) => {
                const who = resolveActor(actor);
                if (!who) return null;
                const facts = await morning.morningFacts(who);
                return { state: facts.state, cycle: facts.status.prepCycle, vials: facts.vials, gaps: facts.gaps,
                    pools: facts.pools.map((p) => ({ slug: p.slug, label: p.label, maxSlots: p.maxSlots, maxItemLevel: p.maxItemLevel, used: p.used, byLevel: p.byLevel,
                        sources: p.sources, offered: p.offered.map((i) => i.uuid) })) };
            },
            plan: async (actor = null, plan = {}) => {
                const who = resolveActor(actor);
                return who ? morning.planMorning(await morning.morningFacts(who), plan) : null;
            },
            apply: (actor = null, plan = {}) => {
                const who = resolveActor(actor);
                return who ? morning.applyMorning(who, plan) : Promise.resolve(noActor());
            },
            loadouts: (actor = null) => {
                const who = resolveActor(actor);
                return who ? Object.values(morning.loadoutsOf(who)) : [];
            },
            saveLoadout: (actor, loadout) => {
                const who = resolveActor(actor);
                return who ? morning.saveLoadout(who, loadout) : Promise.resolve(noActor());
            },
            captureLoadout: (actor, name) => {
                const who = resolveActor(actor);
                return who ? morning.captureLoadout(who, name) : Promise.resolve(noActor());
            },
            deleteLoadout: (actor, id) => {
                const who = resolveActor(actor);
                return who ? morning.deleteLoadout(who, id) : Promise.resolve(noActor());
            },
            applyLoadout: (actor, id) => {
                const who = resolveActor(actor);
                if (!who) return Promise.resolve(noActor());
                const loadout = morning.loadoutsOf(who)[id];
                if (!loadout) return Promise.resolve({ ok: false, reason: "no-loadout" });
                const slugs = new Set([...Object.keys(loadout.pools ?? {}), ...Object.keys(loadout.talismans ?? {})]);
                return morning.applyMorning(who, { pools: Object.fromEntries([...slugs].map((slug) => [slug, { mode: "loadout", id }])) });
            },
            standing: {
                list: (actor = null) => morning.standingFor(actor ? [resolveActor(actor)].filter(Boolean) : undefined),
                place: ({ actor = null, crafter, pool = "advanced-alchemy", uuid, qty = 1, recipient = null, fromDay = null, untilDay = null } = {}) => {
                    const who = resolveActor(actor);
                    const maker = resolveActor(crafter);
                    return who && maker ? morning.placeStanding({ requester: who.uuid, crafter: maker.uuid, pool, uuid, qty, recipient: resolveActor(recipient)?.uuid ?? null,
                        fromDay, untilDay }) : Promise.resolve(noActor());
                },
                end: (id) => morning.endStanding(id),
            },
            affixBoard: ({ actor = null } = {}) => {
                const who = resolveActor(actor);
                return who ? morning.affixBoardOf(who) : null;
            },
            affix: ({ actor = null, talisman, host } = {}) => {
                const who = resolveActor(actor);
                return who ? morning.affixOwn(who, talisman, host) : Promise.resolve(noActor());
            },
            unaffix: ({ actor = null, talisman } = {}) => {
                const who = resolveActor(actor);
                return who ? morning.unaffixOwn(who, talisman) : Promise.resolve(noActor());
            },
            preserve: ({ actor = null, items: ids = [] } = {}) => {
                const who = resolveActor(actor);
                return who ? morning.preserve(who, ids) : Promise.resolve(noActor());
            },
        },
        expiry: {
            sweep: () => expirySweep(),
            beginCycle: (actor = null) => {
                const who = resolveActor(actor);
                return who ? beginCycle(who, { reason: "api" }) : Promise.resolve(noActor());
            },
        },
        // M8 (11.1 macros 12-17 and 20, 11.2): combat alchemy (8.1-8.8) and "Use best consumable" (8.9).
        alchemy: {
            facts: (actor = null) => {
                const who = resolveActor(actor);
                return who ? alchemy.alchemyFacts(who) : Promise.resolve(null);
            },
            quickAlchemy: ({ actor = null, uuid, second = null, additive = null, combine = null, then = "hand", map = 0 } = {}) => {
                const who = resolveActor(actor);
                if (!who) return Promise.resolve(noActor());
                if (!uuid) return openQuickAlchemy({ actor: who });
                return alchemy.quickAlchemy(who, { uuid, second, additive, combine, then, map });
            },
            quickBomb: ({ actor = null, family = null, uuid = null, damageType = null, material = null, createIfNone = true, map = 0 } = {}) => {
                const who = resolveActor(actor);
                return who ? alchemy.quickBomb(who, { family, uuid, damageType, material, createIfNone, map }) : Promise.resolve(noActor());
            },
            quickVial: ({ actor = null, damageType = null, material = null, quickened = false, then = "hand" } = {}) => {
                const who = resolveActor(actor);
                return who ? alchemy.quickVial(who, { damageType, material, quickened, then }) : Promise.resolve(noActor());
            },
            healingBomb: ({ actor = null, grade = "best", target = null } = {}) => {
                const who = resolveActor(actor);
                if (!who) return Promise.resolve(noActor());
                return alchemy.healingBomb(who, { grade }).then((made) => (made.ok && target ? alchemy.throwHealingBomb(who, made.items[0].id, { target }) : made));
            },
            throwHealingBomb: ({ actor = null, item, target = null } = {}) => {
                const who = resolveActor(actor);
                return who ? alchemy.throwHealingBomb(who, item, { target }) : Promise.resolve(noActor());
            },
            strike: ({ actor = null, item, map = 0, damageType = null, material = null } = {}) => {
                const who = resolveActor(actor);
                const thing = who?.items.get(item) ?? null;
                return who ? strikeWith(who, thing, { map, damageType, material }) : Promise.resolve(noActor());
            },
            gatherReagents: ({ actor = null, minutes = 10 } = {}) => {
                const who = resolveActor(actor);
                return who ? vials.gatherReagents(who, { minutes }) : Promise.resolve(noActor());
            },
            improviseAdmixture: ({ actor = null, skipDialog } = {}) => {
                const who = resolveActor(actor);
                return who ? vials.improviseAdmixture(who, { skipDialog }) : Promise.resolve(noActor());
            },
            haversackVial: ({ actor = null } = {}) => {
                const who = resolveActor(actor);
                return who ? vials.haversackVial(who) : Promise.resolve(noActor());
            },
            openBandolier: ({ actor = null } = {}) => openBandolier({ actor: resolveActor(actor) }),
            openPanel: ({ actor = null, bombs = false } = {}) => openQuickAlchemy({ actor: resolveActor(actor), bombs }),
        },
        // M8a (11.1 macros 21-23, 11.2): the affliction tracker (8.10).
        afflictions: {
            definition: (uuidOrItem) => definitionOf(uuidOrItem),
            define: (uuid, def) => defineWorld(uuid, def),
            expose: ({ item, targets = "targeted", delivery = null, dc = null, actor = null } = {}) => {
                const list = targets === "targeted" ? [...(game.user.targets ?? [])].map((t) => t.actor).filter(Boolean)
                    : (Array.isArray(targets) ? targets : [targets]).map((t) => (typeof t === "string" ? fromUuidSync(t) : t?.actor ?? t)).filter(Boolean);
                return afflictions.expose({ item, targets: list, delivery, dc, deliverer: resolveActor(actor) });
            },
            applyPoison: ({ poison, weapon, actor = null, replace = false, double = false, saveType = null } = {}) =>
                coatings.applyPoison({ poison, weapon, actor: resolveActor(actor), replace, double, saveType }),
            unleash: ({ poison, actor = null, targets = [] } = {}) => coatings.unleash({ poison, actor: resolveActor(actor), targets }),
            touch: ({ host, actor = null } = {}) => coatings.touchCoating({ host, toucher: resolveActor(actor) }),
            active: (actor = null) => {
                const who = resolveActor(actor);
                return who ? afflictions.trackersOf(who).map((t) => ({ id: t.id, uuid: t.uuid, name: t.name, run: afflictions.runOf(t) })) : [];
            },
            pending: (actor = null) => {
                const who = resolveActor(actor);
                return who ? afflictions.pendingOf(who).map((p) => ({ kind: p.kind, runId: p.runId, seq: p.seq, claim: p.claim?.id ?? null, source: p.source?.name ?? null })) : [];
            },
            rollPending: ({ actor = null, skipDialog } = {}) => afflictions.rollPending(resolveActor(actor), { skipDialog }),
            roll: ({ actor = null, runId, seq, skipDialog, voluntaryFail = false } = {}) => afflictions.rollSave(resolveActor(actor), { runId, seq }, { skipDialog, voluntaryFail }),
            adjust: (itemOrUuid, { stage = null, end = false, endOnset = false, undo = false } = {}) => afflictions.adjust(itemOrUuid, { stage, end, endOnset, undo }),
            repair: (itemOrUuid) => afflictions.repair(itemOrUuid),
            process: () => afflictions.processAfflictions(),
            backend: () => afflictionBackend(),
            open: () => openAfflictions(),
        },
        rules: {
            afflictionStep: (run, def, degree, kind, now, ctx = {}) => applyDegree(run, def, degree, kind, now, ctx),
            // M10: the level-based DC (GM Core p.53), under Proficiency without Level when pf2e's variant is on.
            levelDC: (level) => levelDC(level, { pwol: game.pf2e?.settings?.variants?.pwol?.enabled === true }),
        },
        // M10 (12): what extensions registered, their stores, and what they ask the Workshop to do. The lists are the registered
        // objects as normalised (frozen); `apiVersion` is the root's.
        ext: {
            apiVersion: API_VERSION,
            activities: () => ext.registered("downtimeActivity"),
            incomeSources: () => ext.registered("incomeSource"),
            sinks: () => ext.registered("consumableSink"),
            modifierSources: () => ext.registered("checkModifierSource"),
            modules: () => ext.extensionModules(),
            store: (moduleId) => ext.extStore(moduleId),
            partyLevel: () => ext.partyLevel(),
            // An activity's check (or an Aid's) for the run starting on `from`; the day planner names the run where it stops.
            roll: ({ actor = null, activity, from, aid = null, skipDialog } = {}) => ext.rollActivity({ actor: resolveActor(actor), activity, from, aid, skipDialog }),
            runs: (filter = {}) => records("extRuns").filter((r) => (!filter.activity || r.activity === filter.activity) && (!filter.actor || r.actor === filter.actor)),
            run: (id) => ext.runOf(id),
            openAids: ({ actor = null, activity } = {}) => {
                const who = resolveActor(actor);
                return who ? ext.openAids(who, activity) : [];
            },
            income: (sourceId, { key, actor = null, day = null, data = {}, recipients = null, note = null } = {}) =>
                ext.postIncome(sourceId, { key, actor: actor ? resolveActor(actor) : null, day, data, recipients, note }),
            // Whether the payment with `key` is made: recorded, its rows in the ledger or claimed (M10 review).
            incomePaid: (sourceId, key) => ext.incomePaid(sourceId, key),
            spend: (sinkId, { actor = null, item, key = null, data = {} } = {}) => ext.spendItem(sinkId, { actor: resolveActor(actor), item, key, data }),
            sinkItems: (sinkId, actor = null) => ext.sinkItems(sinkId, resolveActor(actor)),
            spends: (filter = {}) => ext.spends(filter),
            // The registered sources' modifiers for an extension's own roll of `statistic`, as pf2e modifiers (`data: true`: plain data).
            modifiers: async ({ actor = null, statistic, rollOptions = [], data = false, extra = {} } = {}) => {
                const list = await ext.modifierData({ actor: resolveActor(actor), statistic, kind: "extension", rollOptions, extra });
                return data ? list : ext.pf2eModifiers(list);
            },
        },
        consumables: {
            useBest: ({ family, actor = null, partyWide = false, map = 0 } = {}) => consumables.useBest({ family, actor: resolveActor(actor), partyWide, map }),
            holders: (family) => consumables.holders(family),
            candidates: ({ family, actor = null } = {}) => {
                const who = resolveActor(actor);
                return who ? consumables.candidatesOf(who, family).map((c) => ({ id: c.id, name: c.item.name, carry: c.carry, qty: c.item.quantity ?? 1, infused: c.infused })) : [];
            },
        },
        // M9 (11.2): tattoos and grafts (6.14), fulus' traditions, missives and quick-deploy snares (7.1).
        crafts: {
            consent: (order, { actor = null } = {}) => {
                const who = resolveActor(actor);
                return who ? crafts.consent(order, who.uuid) : Promise.resolve(noActor());
            },
            withdrawConsent: (order, { actor = null } = {}) => {
                const who = resolveActor(actor);
                return who ? crafts.withdrawConsent(order, who.uuid) : Promise.resolve(noActor());
            },
            tradition: (order, tradition) => crafts.chooseTradition(order, tradition),
            recordHealing: (itemUuid) => crafts.recordHealing(itemUuid),
            compose: (itemUuid, { note = "" } = {}) => crafts.composeMissive(itemUuid, { note }),
            sweep: () => crafts.subjectSweep(),
            snareMark: ({ actor = null, pool, key, mark = null } = {}) => {
                const who = resolveActor(actor);
                return who ? crafts.setSnareMark(who.uuid, pool, key, mark) : Promise.resolve(noActor());
            },
            deploy: ({ actor = null, pool, index } = {}) => {
                const who = resolveActor(actor);
                return who ? crafts.deploySnare(who.uuid, pool, index) : Promise.resolve(noActor());
            },
        },
        // M9a (11.2): the Treasure Vault (Remastered) variants (6.16); each call is refused as `variant-off` while its setting is off.
        variants: {
            groups: () => variantGroupsOn(rulesFromSettings()),
            sweep: () => variants.variantSweep(),
            complex: {
                rush: (order, rush) => variants.chooseRush(order, rush),
                rushFinish: (order, on = true) => variants.setRushFinish(order, on),
                setUpNow: (order) => variants.setUpNow(order),
            },
            events: {
                roll: (order) => variants.rollEvent(order),
                resolve: (order, slot, { note = "" } = {}) => variants.resolveEvent(order, slot, { note }),
            },
            critical: {
                special: (order, on = true) => variants.setSpecial(order, on),
                record: (order, { category = null, note = "" } = {}) => variants.recordCritical(order, { category, note }),
                curse: (order, size = 1) => variants.curseCrafter(order, size),
                reveal: (order) => variants.revealCheck(order),
            },
            note: (order, text) => variants.recordNote(order, text),
            deconstruct: {
                request: ({ item, purpose = "raw", crafter = null, actor = null, note = "" } = {}) => {
                    const requester = resolveActor(actor);
                    const source = fromUuidSync(item ?? "", { strict: false });
                    if (!requester) return Promise.resolve(noActor());
                    return orders.requestOrder({ uuid: source?._stats?.compendiumSource ?? source?.sourceId ?? item, quantity: 1, requester: requester.uuid, crafter,
                        note, craftType: "deconstruct", target: item, variant: { deconstruct: { purpose } } });
                },
                purpose: (order, purpose, { note = "" } = {}) => deconstruct.setPurpose(order, purpose, { note }),
                confirm: (order, key, on = true) => deconstruct.confirmChecklist(order, key, on),
                followOn: (order, followOn) => deconstruct.chooseFollowOn(order, followOn),
                retry: (order, { acceptLoss = false } = {}) => orders.retry(order, { acceptLoss }),
                start: (order, { acceptLoss = false } = {}) => orders.start(order, { acceptLoss }),
                useComponents: (order, item) => handOver({ order, item, purpose: "material" }),
            },
            grow: {
                untended: (order, on = true) => nature.setUntended(order, on),
                due: (order) => nature.seasonChecksDue(read(`orders.${order}`)),
                rollSeason: (order, season = null, { skipDialog } = {}) => nature.rollSeason(order, season, { skipDialog }),
            },
            gardens: {
                list: () => nature.gardensOf(),
                add: ({ name = "", kind = "", uuid } = {}) => nature.addGarden({ name, kind, uuid }),
                fund: (garden, { source = "purse", actor = null, cp } = {}) => nature.fundGarden(garden, { source, actor: actor ?? resolveActor(null)?.uuid ?? null, cp }),
                withdraw: (garden, { source = "purse", actor = null, cp } = {}) => nature.withdrawGarden(garden, { source, actor: actor ?? resolveActor(null)?.uuid ?? null, cp }),
                plant: (garden) => nature.plantGarden(garden),
                harvest: (garden, { actor = null } = {}) => {
                    const who = resolveActor(actor);
                    return who ? nature.harvest(garden, who.uuid) : Promise.resolve(noActor());
                },
                remove: (garden) => nature.removeGarden(garden),
            },
            gifts: {
                list: () => variants.partyGifts().map(({ item, holder, gift, dormant, priceCp }) => ({ item: item.uuid, holder: holder.uuid, gift, dormant, priceCp })),
                bestow: (item, { giver = "" } = {}) => variants.bestow(item, { giver }),
                heir: (item, heir) => variants.nameHeir(item, heir),
            },
            quests: {
                configure: (order, options = {}) => quests.configureQuest(order, options),
                component: (order, component, options = {}) => quests.setComponent(order, component, options),
                found: (order, component, { actor = null } = {}) => quests.markFound(order, component, { actor: resolveActor(actor)?.uuid ?? null }),
                unfound: (order, component) => quests.unmarkFound(order, component),
                advance: (order) => quests.advanceQuest(order),
            },
        },
        communal: {
            join: (order, { actor = null, skill = "crafting" } = {}) => {
                const who = resolveActor(actor);
                return who ? communal.joinOrder(order, who.uuid, skill) : Promise.resolve(noActor());
            },
            leave: (order, { actor = null } = {}) => {
                const who = resolveActor(actor);
                return who ? communal.leaveOrder(order, who.uuid) : Promise.resolve(noActor());
            },
            roll: (order, { actor = null, skipDialog } = {}) => {
                const who = resolveActor(actor);
                return who ? communal.rollHelp(order, who.uuid, { skipDialog }) : Promise.resolve(noActor());
            },
            accept: (order, helper) => {
                const who = resolveActor(helper);
                return who ? communal.acceptHelper(order, who.id) : Promise.resolve(noActor());
            },
        },
    };
    // M11 (11.1): the macro catalogue. `run` is what every macro holds: the catalogue's API call with its arguments,
    // reported to the user, asking for a required argument that is missing.
    api.macros = {
        list: () => MACROS.map((m) => ({ id: m.id, no: m.no, call: m.call, args: { ...m.args }, required: [...m.required], feature: m.feature })),
        command: (id, args) => {
            const entry = macroById(id);
            return entry ? macroCommand(entry, MODULE_ID, args ?? entry.args) : null;
        },
        run: (id, args = {}) => runMacro(api, id, args),
        toHotbar: (id, slot = null) => addToHotbar(id, slot),
        open: () => openShelf(),
    };
    return api;
}

/** Publish the API, at `ready`, and announce it. */
export function publishApi() {
    const api = buildApi();
    game.modules.get(MODULE_ID).api = api;
    Hooks.callAll("pf2e-artisans-workshop.ready", api);
    return api;
}
