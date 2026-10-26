/**
 * Formulas (DESIGN.md 4.13, 5.5 Formula claims, 6.8, M5): learning a formula by buying it, copying it from an NPC, a
 * schematic scanner or a feature's pick, at once; the Codex's data (the book by family with provenance, virtual lists,
 * picks owed, routes and the break-even of buying); and the formula claim that writes a formula into a book.
 *
 * Writing a formula. Only the learner's responsible client writes it (P4), appending `{uuid}` to the actor's
 * `_source.system.crafting.formulas` with `actor.update`, as pf2e's own crafting tab does (never the prepared array,
 * which rule elements extend), then the provenance record (4.13) and the `formulaAcquired` hook. Every acquisition is a
 * formula claim (5.5): the acquiring client writes it with whatever paid for it (a `purchase` row in the same lock-first
 * move, a finished order's rows, a service's close) and applies it at once when it is responsible for the learner; the
 * learner's own client applies it otherwise, at its sweep, with no GM needed. Applying is lock-first on the claim's own
 * lock page (its id), with `resolved` and the provenance written in that lock request, so two clients applying the same
 * claim write the formula once; `applied` follows the book's update, and a claim resolved but never applied (the tab
 * closed between the two) is finished by the learner's responsible client once it is past the grace time
 * (`resumeFormulaClaims`). Appending is idempotent: a formula already in the book is not added twice.
 */
import { MODULE_ID } from "../constants.mjs";
import { makeClaim } from "../logic/claims.mjs";
import {
    breakEven, codexEntries, familiesOf, makeProvenance, partyFamilies, pickFits, picksOwed, picksSchedule, provenancePath, virtualLists,
    withPending,
} from "../logic/codex.mjs";
import { planPurseDebit } from "../logic/coins.mjs";
import { stampTime } from "../logic/core.mjs";
import { craftCopyRoute, formulaRoutes, instantPlan } from "../logic/formula-jobs.mjs";
import { hashId, idemKey } from "../logic/ids.mjs";
import { purseLockIds } from "../logic/lock-first.mjs";
import { PENDING_GRACE_MS } from "../logic/reconcile.mjs";
import { heldKeys, routeInputs, craftOptions } from "../logic/registry.mjs";
import { runRequest } from "./batch.mjs";
import { catalogue } from "./catalogue.mjs";
import { registerClaimKind } from "./claims.mjs";
import { withCoinMutex } from "./lease.mjs";
import { freeStacks, moveCoins } from "./money.mjs";
import { crafterFacts, productFacts, routeFor } from "./products.mjs";
import { heldKeysOf, ranksOf } from "./registry.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { members } from "./roster.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { exists, newId, read, records, serverNow, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (value) => (typeof value === "string" ? fromUuidSync(value, { strict: false }) : value ?? null);

/** The UUIDs in an actor's formula book. */
export const bookOf = (actor) => (actor?.system?.crafting?.formulas ?? []).map((formula) => formula.uuid);

/** An actor's provenance records (4.13), as stored. */
export const provenanceOf = (actor) => (actor ? read(`formulas.${actor.id}`) ?? {} : {});

/**
 * The learner's formula claims not applied yet (5.5): formulas on their way to the book, which only the learner's own
 * client writes. Acquiring treats them as known, and the picks owed count them (`withPending`).
 */
export const pendingFormulas = (actor) => records("claims").filter((claim) => claim.kind === "formula" && claim.actor === actor?.uuid && !claim.applied);

/** Whether a formula is in the actor's book or on its way to it: "known", "pending", or null. */
export function knownState(actor, uuid) {
    if (bookOf(actor).includes(uuid)) return "known";
    return pendingFormulas(actor).some((claim) => claim.uuid === uuid) ? "pending" : null;
}

/** Whether the actor carries an item made from a compendium UUID (6.8: reverse-engineering needs the item). */
export const holdsItem = (actor, uuid) => (actor?.items ?? []).some((item) => (item.sourceId ?? item._stats?.compendiumSource) === uuid);

/**
 * The claim input that writes a formula into a learner's book (5.5). Its key names what caused it (`ref`: an order, a
 * service, or the nonce of an acquisition), the learner and the formula, so the same cause never writes it twice.
 */
export function formulaClaimInput({ learner, uuid, route, source = null, pickLevel = null, order = null, service = null, row = null, ref, parties = [] }) {
    return { kind: "formula", idem: idemKey("formula", ref, learner, uuid), actor: learner, uuid, route, source, pickLevel, order, service, row,
        parties: [...parties] };
}

/** Append a formula to the book as pf2e's crafting tab does, from the actor's source. False when it is there already. */
async function appendToBook(actor, uuid) {
    const source = foundry.utils.deepClone(actor._source?.system?.crafting?.formulas ?? actor.system?.crafting?.formulas ?? []);
    if (source.some((formula) => formula.uuid === uuid)) return false;
    source.push({ uuid });
    await actor.update({ "system.crafting.formulas": source });
    return true;
}

/** The provenance a claim writes. */
const provenanceFor = (claim, stamp) => makeProvenance({
    uuid: claim.uuid, route: claim.route, source: claim.source ?? null, pickLevel: claim.pickLevel ?? null, row: claim.row ?? null,
    order: claim.order ?? null, service: claim.service ?? null,
}, stamp);

/** Finish an applied claim: the book, then `applied`, then the hook and the card. */
async function finishFormulaClaim(claim, actor) {
    if (claim.applied) return { ok: true, outcome: "already" };
    const added = await appendToBook(actor, claim.uuid);
    await write({ set: { [`claims.${claim.id}.applied`]: stampNow() } });
    const provenance = read(provenancePath(actor.id, claim.uuid)) ?? null;
    // 12.3: once per event, on the client that wrote it; the Workshop's own "Formula learned" card listens too (chat.mjs).
    Hooks.callAll(`${MODULE_ID}.formulaAcquired`, Object.freeze({ actor, uuid: claim.uuid, route: claim.route, provenance, added }));
    return { ok: true, outcome: "ok", added };
}

/**
 * Apply a formula claim to its learner, on the learner's responsible client (`registerClaimKind`, 5.5): lock the claim,
 * write `resolved` and the provenance with the lock, then the book. "conflict" when another client holds the lock.
 */
export function applyFormulaClaim(claim, actor) {
    return withCoinMutex(game.user.id, async () => {
        if (!canWrite()) return refuse("not-ready");
        const current = read(`claims.${claim.id}`) ?? claim;
        if (current.resolved) return finishFormulaClaim(current, actor);
        const stamp = stampNow();
        const set = { [`claims.${claim.id}.resolved`]: stamp };
        const path = provenancePath(actor.id, claim.uuid);
        if (!exists(path)) set[path] = provenanceFor(claim, stamp);
        const locked = await runRequest([{ op: "lock", ids: [claim.id] }, { op: "ledger", change: { set } }]);
        if (locked.outcome === "refused") return { ok: false, outcome: "conflict", reason: "taken" };
        if (locked.outcome !== "ok") return { ok: false, outcome: locked.outcome, reason: locked.reason };
        return finishFormulaClaim({ ...current, resolved: stamp }, actor);
    });
}

/**
 * Finish formula claims whose application stopped between its two writes (part of the sweep): resolved but not applied,
 * or locked but not resolved, past the grace time, on the learner's responsible client. Appending is idempotent.
 */
export async function resumeFormulaClaims() {
    if (!canWrite()) return 0;
    let finished = 0;
    const now = serverNow();
    for (const claim of records("claims").filter((c) => c.kind === "formula" && !c.applied)) {
        const actor = actorOf(claim.actor);
        if (!actor || !isResponsibleFor(actor)) continue;
        const page = shared().ledger?.pages?.get(claim.id);
        const since = claim.resolved ? stampTime(claim.resolved.at) : page ? stampTime(page.flags?.[MODULE_ID]?.lock?.at) : null;
        if (since === null || now - since < PENDING_GRACE_MS) continue;
        if (!claim.resolved) {
            const stamp = stampNow();
            const path = provenancePath(actor.id, claim.uuid);
            await write({ set: { [`claims.${claim.id}.resolved`]: stamp, ...(exists(path) ? {} : { [path]: provenanceFor(claim, stamp) }) } });
        }
        if ((await finishFormulaClaim(read(`claims.${claim.id}`), actor)).ok) finished += 1;
    }
    return finished;
}

/** Register the formula claim's applier with the claims sweep (5.5), at `init`. */
export function registerFormulaClaims() {
    registerClaimKind("formula", (claim, actor) => applyFormulaClaim(claim, actor));
}

/** Write a formula claim's record (unless it exists) and apply it now when this tab is responsible for the learner. */
export async function claimFormula(input, ledger = null) {
    const claim = makeClaim(input, stampNow());
    if (!exists(`claims.${claim.id}`)) await write({ ...(ledger ?? {}), set: { ...(ledger?.set ?? {}), [`claims.${claim.id}`]: claim } });
    return applyIfResponsible(claim);
}

/** Apply a claim now when this tab is responsible for its learner; otherwise the learner's own client will. */
export async function applyIfResponsible(claim) {
    const learner = actorOf(claim.actor);
    if (learner && isResponsibleFor(learner)) return { ...(await applyFormulaClaim(claim, learner)), claim: claim.id };
    return { ok: true, outcome: "claimed", claim: claim.id };
}

/* -------------------------------------------- */
/*  Acquiring at once (6.8)                      */
/* -------------------------------------------- */

/** The level each registry key was gained at: a feat's level taken, a feature's level; for picks owed (6.8). */
export function gainedAtOf(actor) {
    const out = {};
    for (const item of actor?.items ?? []) {
        if (item.type !== "feat") continue;
        const [key] = heldKeys([{ sourceId: item.sourceId ?? null, slug: item.slug ?? null, selections: {} }]);
        if (!key) continue;
        const level = item.system?.level?.taken ?? item.system?.level?.value ?? 1;
        out[key] = Math.min(out[key] ?? Infinity, Number.isInteger(level) ? level : 1);
    }
    return out;
}

/** The picks a character is owed now (6.8): `picksOwed` over its schedule. */
export function owedPicks(actor, rules = rulesFromSettings()) {
    const schedule = picksSchedule(heldKeysOf(actor), { level: actor.level ?? 1, gainedAt: gainedAtOf(actor), ranks: ranksOf(actor) }, rules);
    return picksOwed(schedule, withPending(provenanceOf(actor), pendingFormulas(actor)));
}

/**
 * Learn a formula at once (6.8): buy it (`buy`, its Price plus the rarity surcharge), copy it from an NPC (`copy-npc`),
 * scan it (`scanner`: the learner holds a schematic scanner and the item) or take it for an owed pick (`grant`, with the
 * pick's `source` key and `pickLevel`). A cost is a `purchase` row from `payer`'s purse (a character this user owns),
 * written with the formula claim in one lock-first move; the claim is applied now when this tab is responsible for the
 * learner. `confirm` holds the checklist confirmations an uncommon or rarer formula needs ("seller").
 * Refusals: `not-ready`, `no-actor`, `no-product`, `known`, `pending` (on its way to the book already), `no-route`,
 * `needs`, `no-pick`, `not-owner`, `purse-short`.
 */
export async function acquire({ learner, uuid, route, payer = null, source = null, pickLevel = null, confirm = [], nonce = newId() }) {
    if (!canWrite()) return refuse("not-ready");
    const actor = actorOf(learner);
    if (!actor) return refuse("no-actor");
    const product = await productFacts(uuid);
    if (!product) return refuse("no-product");
    // A formula on its way (a claim another tab filed, which the learner's client has not applied yet) counts as known,
    // so a second buy or a second grant is refused rather than charged or taken again.
    const already = knownState(actor, uuid);
    if (already) return refuse(already);
    const rules = rulesFromSettings();
    const crafter = crafterFacts(actor);
    let plan;
    let pick = null;
    if (route === "grant") {
        pick = owedPicks(actor, rules).entries.find((e) => e.owed > 0 && e.key === source && (pickLevel === null || e.level === pickLevel) &&
            pickFits(e, product));
        if (!pick) return refuse("no-pick");
        plan = instantPlan("grant", {}, [], rules);
    } else {
        plan = instantPlan(route, { item: product, feats: crafter.held, possessesItem: holdsItem(actor, uuid),
            hasScanner: crafter.toolKeys.includes("schematic-scanner") }, confirm, rules);
        if (!plan.ok) return plan;
    }
    const purse = plan.costCp > 0 ? actorOf(payer ?? actor.uuid) : null;
    if (plan.costCp > 0 && !purse?.isOwner) return refuse("not-owner");
    const rowIdem = plan.costCp > 0 ? idemKey("purchase", "formula", purse.uuid, nonce) : null;
    const claim = makeClaim(formulaClaimInput({
        learner: actor.uuid, uuid, route: plan.provenance, source: route === "grant" ? source : null, pickLevel: pick?.level ?? null,
        row: rowIdem ? hashId(rowIdem) : null, ref: nonce, parties: [purse?.uuid ?? actor.uuid],
    }), stampNow());
    if (plan.costCp > 0) {
        const row = { kind: "purchase", how: { via: "purse" }, idem: rowIdem, cp: plan.costCp, actor: purse.uuid, note: null };
        const moved = await moveCoins(() => {
            const stacks = freeStacks(purse);
            const debit = planPurseDebit(stacks, plan.costCp);
            if (!debit) return { refuse: "purse-short" };
            return { rows: [row], debits: [{ target: purse.uuid, plan: debit }], locks: purseLockIds(stacks, debit),
                ledger: { set: { [`claims.${claim.id}`]: claim } } };
        }, {}, [row]);
        if (!moved.ok) return moved;
    } else if (!exists(`claims.${claim.id}`)) {
        await write({ set: { [`claims.${claim.id}`]: claim } });
    }
    return applyIfResponsible(claim);
}

/* -------------------------------------------- */
/*  The Codex's data (10.1 Formulas tab)         */
/* -------------------------------------------- */

/** Members other than `actor` whose roster snapshot lists the formula (6.8, copy from an ally). */
export function alliesKnowing(actor, uuid) {
    return records("roster").filter((snapshot) => snapshot.id !== actor?.id && (snapshot.formulas ?? []).includes(uuid))
        .map((snapshot) => ({ id: snapshot.id, name: snapshot.name, uuid: game.actors?.get(snapshot.id)?.uuid ?? `Actor.${snapshot.id}` }));
}

/**
 * The routes a character has to a formula (4.3, 6.8) with what each costs, and the break-even of buying it: `{product,
 * route, routes, allies, breakEven, copy}`. `copy` is the craft-a-copy route when the character knows the formula and
 * could put it in another's book.
 */
export async function routesFor(actor, uuid, rules = rulesFromSettings()) {
    const product = await productFacts(uuid);
    if (!product || !actor) return null;
    const crafter = crafterFacts(actor);
    const route = await routeFor(crafter, product, rules);
    const options = craftOptions({ item: product.options, held: crafter.held });
    const inputs = routeInputs(crafter.held, product, options, crafter.level, rules);
    const allies = alliesKnowing(actor, uuid);
    const routes = formulaRoutes({
        item: product, feats: crafter.held, possessesItem: holdsItem(actor, uuid), allyHasFormula: allies.length > 0,
        hasScanner: crafter.toolKeys.includes("schematic-scanner"), known: route === "known", family: route === "family",
        virtual: route === "virtual", accessGrant: inputs.accessGrant,
    }, rules);
    const withFormula = ["known", "family", "virtual"].includes(route);
    return {
        product, route, routes, allies,
        breakEven: withFormula ? null : breakEven(product, { level: crafter.level, rank: crafter.ranks.crafting ?? 0 }, route),
        copy: route === "known" ? craftCopyRoute(product) : null,
    };
}

/**
 * Everything the Codex shows for one character (10.1): the book grouped by family with provenance and the grades each
 * family covers, the virtual lists, the picks owed, and the party's families from the roster snapshots.
 */
export async function codexData(actor, rules = rulesFromSettings()) {
    const items = await catalogue();
    const byUuid = new Map(items.map((facts) => [facts.uuid, facts]));
    const book = bookOf(actor);
    for (const uuid of book) {
        if (byUuid.has(uuid)) continue;
        const facts = await productFacts(uuid);
        if (facts) byUuid.set(uuid, facts);
    }
    const entries = codexEntries(book, provenanceOf(actor), byUuid);
    const held = heldKeysOf(actor);
    const virtual = virtualLists(held, items, actor.level ?? 1, rules).filter((list) => list.items.length);
    const owed = owedPicks(actor, rules);
    const roster = records("roster").filter((snapshot) => members().some((member) => member.id === snapshot.id));
    return { entries, families: familiesOf(entries, items, rules), virtual, owed, party: partyFamilies(roster, byUuid), catalogueSize: items.length,
        pending: pendingFormulas(actor).map((claim) => claim.uuid) };
}
