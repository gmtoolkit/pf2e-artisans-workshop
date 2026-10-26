/**
 * The public API (DESIGN.md 11.2), as far as M4 builds it: opening the window, the order lifecycle and the funds. It is
 * published at `game.modules.get("pf2e-artisans-workshop").api` in `ready`, and the `pf2e-artisans-workshop.ready` hook
 * fires right after with the same object. Later milestones add their namespaces; M11 completes the macros of 11.1.
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
import { read, records } from "./store.mjs";
import { status } from "./state.mjs";

/** The integer that changes only when an extension interface or hook payload changes incompatibly (11.3). */
export const API_VERSION = 1;

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

/** The API object. */
export function buildApi() {
    return {
        version: game.modules.get(MODULE_ID).version,
        apiVersion: API_VERSION,
        isReady: () => status() === "ready",
        ui: {
            open: (options = {}) => openWorkshop(options),
            openOrder: (id) => openWorkshop({ tab: "queue", order: id }),
            requestForm: (uuidOrItem = null, options = {}) => openRequestForm({
                uuid: typeof uuidOrItem === "string" ? uuidOrItem : uuidOrItem?.uuid ?? null, requester: resolveActor(options.actor)?.uuid ?? null,
            }),
        },
        orders: {
            list: (filter = {}) => records("orders").filter((o) => !filter.status || o.status === filter.status),
            get: (id) => read(`orders.${id}`) ?? null,
            request: ({ uuid, quantity = 1, recipient = null, crafter = null, note = "", actor = null } = {}) => {
                const requester = resolveActor(actor);
                if (!requester) return Promise.resolve(noActor());
                if (!uuid) return openRequestForm({ requester: requester.uuid });
                const target = recipient === "strongbox" ? { kind: "strongbox" } : { kind: "actor", uuid: recipient ?? requester.uuid };
                return orders.requestOrder({ uuid, quantity, requester: requester.uuid, recipient: target, crafter, note });
            },
            accept: (id, { crafter = null } = {}) => {
                const actor = resolveActor(crafter);
                return actor ? orders.accept(id, actor.uuid) : Promise.resolve(noActor());
            },
            release: (id) => orders.release(id),
            start: (id) => orders.start(id),
            workDay: (id) => orders.workDay(id),
            rollCheck: ({ order, skipDialog } = {}) => orders.roll(order, { skipDialog }),
            settle: (id) => orders.settle(id),
            pause: (id) => orders.pause(id),
            resume: (id) => orders.resume(id),
            retry: (id) => orders.retry(id),
            finish: ({ order } = {}) => orders.finish(order),
            cancel: (id) => orders.cancel(id),
            undo: (id) => orders.undo(id),
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
            rows: (filter = {}) => records("rows").filter((r) => (!filter.order || r.order === filter.order) && (!filter.actor || r.actor === filter.actor)),
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
             * `craft-copy` (for `for`, another member) file a formula job with `actor` as the crafter.
             */
            acquire: ({ uuid, route, actor = null, from = null, for: learner = null, source = null, pickLevel = null, seller = false } = {}) => {
                const who = resolveActor(actor);
                if (!who) return Promise.resolve(noActor());
                if (route === "copy-ally") return services.requestService({ kind: "formula-copy", requester: who.uuid, performer: resolveActor(from)?.uuid ?? null, uuid });
                if (FORMULA_ORDER_ROUTES.includes(route)) {
                    const target = route === "craft-copy" ? resolveActor(learner)?.uuid ?? null : who.uuid;
                    if (!target) return Promise.resolve(noActor());
                    return orders.requestOrder({ uuid, requester: who.uuid, recipient: { kind: "actor", uuid: target }, crafter: who.uuid, productType: "formula", route });
                }
                return formulas.acquire({ learner: who.uuid, uuid, route, payer: who.uuid, source, pickLevel, confirm: seller ? ["seller"] : [] });
            },
        },
        pledges: {
            pledge: (order, { caster = null, spell, castings = 1 } = {}) => pledges.pledgeCasting(order, { caster: resolveActor(caster)?.uuid ?? null, spell, castings }),
            fulfil: (order, pledge, { cost = 0 } = {}) => pledges.fulfilPledge(order, pledge, { costCp: amountCp(cost) ?? 0 }),
            withdraw: (order, pledge) => pledges.withdrawPledge(order, pledge),
            buy: (order, { spell, castings = 1, from = null } = {}) => pledges.buyCasting(order, { payer: resolveActor(from)?.uuid ?? null, spell, castings }),
        },
        custody: {
            handOver: (opts) => handOver(opts),
        },
        services: {
            list: (filter = {}) => records("services").filter((s) => !filter.status || s.status === filter.status),
            get: (id) => read(`services.${id}`) ?? null,
            request: ({ kind, actor = null, performer = null, target = null, host = null, uuid = null, note = "" } = {}) => {
                const who = resolveActor(actor);
                return who ? services.requestService({ kind, requester: who.uuid, performer: resolveActor(performer)?.uuid ?? null, target, host, uuid, note })
                    : Promise.resolve(noActor());
            },
            offer: (id, { actor = null } = {}) => {
                const who = resolveActor(actor);
                return who ? services.offer(id, who.uuid) : Promise.resolve(noActor());
            },
            perform: (id, options = {}) => services.perform(id, options),
            cancel: (id) => services.cancel(id),
        },
    };
}

/** Publish the API, at `ready`, and announce it. */
export function publishApi() {
    const api = buildApi();
    game.modules.get(MODULE_ID).api = api;
    Hooks.callAll("pf2e-artisans-workshop.ready", api);
    return api;
}
