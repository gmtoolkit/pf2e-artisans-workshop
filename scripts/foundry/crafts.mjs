/**
 * Tattoos, grafts, fulus, missives, specialty wands and quick-deploy snares on this client (DESIGN.md 1.1, 6.9, 6.14, 7.1,
 * M9). The rules are `scripts/logic/crafts.mjs`; the order machine (`orders.mjs`, `products.mjs`) runs tattoo and graft
 * orders, and `outputs.mjs` asks this module what a finished one makes.
 *
 * - **Consent** (6.14): the subject's owner consents to a tattoo or graft (`orders.<id>.subject`, a key only they write)
 *   and, where the process needs the subject present, puts it in downtime sitting for the order (activity `subject`,
 *   `lockedBy`), as a Communal Crafting helper joins (6.7). Withdrawing is possible before the Craft starts, or after it
 *   failed.
 * - **What a finish makes**: a tattoo or graft goes to its subject through the pickup shelf, uninvested and healing under
 *   the Secrets of Magic process, invested under the simple toggle, with its record (`flags.MOD.subject`), Legendary Tattoo
 *   Artist's mark where it applies, and, for an upgrade, the item it replaces; a fulu takes its tradition and a year's
 *   `world` expiry stamp; a missive is blank (`flags.MOD.missive`); a specialty wand names the spell cast into it.
 * - **The subject sweep** (a step of the catch-up sweep, and when the workshop day moves or a subject's items change): on
 *   the subject's responsible client (5.6), a tattoo whose healing ended, or an inactive graft, is invested if the
 *   subject's invest limit allows, else stays decorative (a tattoo) or inactive (a graft); an upgraded one removes the item
 *   it replaced. Idempotent (P5): it changes only items whose state moves.
 * - **Recording healing**, **composing a missive**, **marking a quick-deploy snare** and **deploying one** (pf2e's own
 *   `CraftingAbility#toggleFormulaExpended`) are the owner's own actions.
 */
import { MODULE_ID } from "../constants.mjs";
import { isMagical } from "../logic/core.mjs";
import {
    CONSENT_STATUSES, NOT_WORKING, TRADITIONS, composePlan, consentProblem, decorativeTraits, fuluStamp, fuluTraits, healedUntil, investitureCheck,
    isMissive, markFor, quickDeployLedger, raiseActivated, raiseResistances, settleSubject, stillMagical, subjectProcess, subjectRecord,
} from "../logic/crafts.mjs";
import { PC_VERSION, lockOf } from "../logic/downtime.mjs";
import { hashId } from "../logic/ids.mjs";
import { WITH_SUBJECT, closedAs } from "../logic/orders.mjs";
import { pledgedSpell } from "../logic/pledges.mjs";
import { crafterMarks, investitureExemptions, quickDeployMarks, testPredicate } from "../logic/registry.mjs";
import { dayWatcher, pendingOf, secondsPerDay, statusOf, today } from "./downtime.mjs";
import { heldKeysOf } from "./registry.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const traitsOf = (item) => [...(item?.traits ?? item?.system?.traits?.value ?? [])];
/** The value at a dotted path of an object (an actor's flag a registry effect names). */
const valueAt = (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object);

/** A delivered tattoo's or graft's record (`flags.MOD.subject`), or null. */
export const subjectRecordOf = (item) => item?.flags?.[MODULE_ID]?.subject ?? null;

/** Where pf2e's usage puts a tattoo (worn) and a graft (implanted): the carry type that equips it. */
const carryTypeOf = (kind) => (kind === "graft" ? "implanted" : "worn");

/* -------------------------------------------- */
/*  Consent (6.14)                               */
/* -------------------------------------------- */

/**
 * The subject's owner consents to a tattoo or graft (6.14). Where the process needs the subject present (the Secrets of
 * Magic tattoo process with `rules.tattooSubjectLocked`, every graft), the subject goes into downtime (from the day after
 * today, if it was not) sitting for the order, and is locked to it. Refused: `not-ready`, `not-owner`, `no-order`, `state`,
 * `not-subject`, `subject-locked` (the subject is locked to another order as a helper or a subject), `days-pending` (with
 * the count: where it will sit for the order, a subject in downtime resolves the days it has not yet resolved first, as it
 * would before leaving downtime, since the lock has no start day and every unresolved day would be spent sitting).
 */
export async function consent(orderId, actorUuid) {
    if (!canWrite()) return refuse("not-ready");
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const order = read(`orders.${orderId}`);
    if (!order || !WITH_SUBJECT.includes(order.craftType)) return refuse("no-order");
    if (closedAs(order)) return refuse("state", { status: closedAs(order) });
    const problem = consentProblem(order, actor.uuid, lockOf(records("orders"), actor.id, actor.uuid));
    if (problem) return problem;
    const process = subjectProcess(order.craftType, rulesFromSettings(), order.variant?.process ?? null);
    const stamp = stampNow();
    const replace = { [`orders.${orderId}.subject`]: { actor: actor.uuid, consented: true, presence: process.presence, process: process.process, ...stamp } };
    const set = {};
    if (process.presence && order.crafter !== actor.uuid) {
        const status = statusOf(actor);
        const sitting = status.activity?.kind === "subject" && status.activity.ref === orderId;
        const pending = sitting ? null : pendingOf(actor);
        if (pending?.count > 0) return refuse("days-pending", { count: pending.count });
        replace[`pcs.${actor.id}.activity`] = { kind: "subject", ref: orderId };
        Object.assign(set, { [`pcs.${actor.id}.id`]: actor.id, [`pcs.${actor.id}.v`]: PC_VERSION, [`pcs.${actor.id}.lockedBy`]: orderId });
        if (!status.inDowntime) Object.assign(set, { [`pcs.${actor.id}.inDowntime`]: true, [`pcs.${actor.id}.since`]: today().day });
    }
    await write({ set, replace });
    return { ok: true, presence: process.presence };
}

/**
 * The subject's owner (or a GM) withdraws consent before the Craft starts, or after it failed (6.14): the subject is free
 * again, its activity cleared if it was this order. Refused: `not-ready`, `not-owner`, `no-order`, `state`, `not-subject`.
 */
export async function withdrawConsent(orderId, actorUuid) {
    if (!canWrite()) return refuse("not-ready");
    const actor = actorOf(actorUuid);
    if (!actor || !(actor.isOwner || game.user.isGM)) return refuse("not-owner");
    const order = read(`orders.${orderId}`);
    if (!order || !WITH_SUBJECT.includes(order.craftType)) return refuse("no-order");
    if (order.target !== actor.uuid) return refuse("not-subject");
    if (!CONSENT_STATUSES.includes(closedAs(order) ?? order.status)) return refuse("state", { status: closedAs(order) ?? order.status });
    if (!order.subject?.consented) return { ok: true, outcome: "already" };
    const status = statusOf(actor);
    const set = { [`orders.${orderId}.subject.consented`]: false };
    if (status.lockedBy === orderId) set[`pcs.${actor.id}.lockedBy`] = null;
    if (status.activity?.kind === "subject" && status.activity.ref === orderId) set[`pcs.${actor.id}.activity`] = null;
    await write({ set });
    return { ok: true, outcome: "ok" };
}

/**
 * The crafter's owner chooses a fulu's tradition (Secrets of Magic p.158: its creator's), before the Craft starts. Refused:
 * `not-ready`, `no-order`, `not-owner`, `state`, `tradition` (not one of the four).
 */
export async function chooseTradition(orderId, tradition) {
    if (!canWrite()) return refuse("not-ready");
    const order = read(`orders.${orderId}`);
    if (!order) return refuse("no-order");
    if (!actorOf(order.crafter)?.isOwner) return refuse("not-owner");
    if (!["requested", "accepted", "failed"].includes(closedAs(order) ?? order.status)) return refuse("state", { status: order.status });
    if (!TRADITIONS.includes(tradition)) return refuse("tradition");
    await write({ set: { [`orders.${orderId}.variant.tradition`]: tradition } });
    return { ok: true };
}

/* -------------------------------------------- */
/*  What a finish makes                          */
/* -------------------------------------------- */

/**
 * A tattoo's or graft's item source for its subject (6.14): equipped as its usage needs, invested only under the simple
 * toggle, its record, and Legendary Tattoo Artist's +1 (the crafter's registry `crafterMark`) on a magical tattoo far enough
 * below the crafter's level: every inline check DC and plain "DC N" of its activated abilities, and every numeric
 * resistance. Changes `source` in place and returns it.
 *
 * @param {object} source    the compendium item's source, with the order's flags
 * @param {object} order
 * @param {{options: string[], level: number}} product
 */
export function subjectSource(source, order, product, rules = rulesFromSettings()) {
    const kind = order.craftType;
    const process = subjectProcess(kind, rules, order.variant?.process ?? null);
    const traits = source.system?.traits?.value ?? [];
    const magical = isMagical({ traits });
    const old = order.variant?.replaces ? actorOf(order.variant.replaces) : null;
    const record = subjectRecord({ kind, order: order.id, subject: order.target, crafter: order.crafter, process, magical, day: today().day,
        replaces: old?.parent?.uuid === order.target ? old.id : null });
    foundry.utils.setProperty(source, "system.equipped", { ...(source.system?.equipped ?? {}), carryType: carryTypeOf(kind), handsHeld: 0,
        invested: record.state === "invested" });
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.subject`, record);
    const crafter = actorOf(order.crafter);
    const mark = crafter ? markFor(crafterMarks(heldKeysOf(crafter), new Set(product.options ?? [])), { crafterLevel: crafter.level ?? 0,
        item: { traits, level: product.level ?? 0 } }) : null;
    if (mark) {
        const description = raiseActivated(source.system?.description?.value ?? "", mark.by);
        const resistances = raiseResistances(source.system?.rules ?? [], mark.by);
        foundry.utils.setProperty(source, "system.description.value", description.html);
        foundry.utils.setProperty(source, "system.rules", resistances.rules);
        foundry.utils.setProperty(source, `flags.${MODULE_ID}.mark`, { key: mark.key, mark: mark.mark, by: mark.by, raised: description.raised + resistances.raised });
    }
    return source;
}

/**
 * A fulu's item source (Secrets of Magic p.158): the order's tradition (frozen at start) as its trait, and a `world` expiry
 * stamp a year from now (4.12), which party-wide expiry reads like any other. Changes `source` in place and returns it.
 */
export function fuluSource(source, order) {
    const tradition = order.variant?.tradition ?? null;
    foundry.utils.setProperty(source, "system.traits.value", fuluTraits(source.system?.traits?.value ?? [], tradition));
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.expiry`, fuluStamp({ creator: order.crafter, worldTime: game.time?.worldTime ?? 0,
        day: today().day, secondsPerDay: secondsPerDay() }));
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.fulu`, { tradition });
    return source;
}

/** A missive's item source: blank, waiting to be composed (Treasure Vault (Remastered) p.84). */
export function missiveSource(source) {
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.missive`, { composed: null });
    return source;
}

/**
 * A specialty wand's item source (6.9, M9): the spell cast into it, linked before its description and recorded
 * (`flags.MOD.spell`); a consumable wand that holds no spell of its own takes it as pf2e's wands do (`system.spell`, at the
 * wand's rank). Unchanged when no pledge names a spell.
 */
export async function chosenSpellSource(source, order, supply) {
    const pledged = pledgedSpell(order);
    const spell = pledged ? (await fromUuid(pledged.source ?? pledged.uuid).catch(() => null)) ?? (await fromUuid(pledged.uuid).catch(() => null)) : null;
    if (!spell) return source;
    const sourceId = spell.sourceId ?? spell._stats?.compendiumSource ?? spell.uuid;
    const rank = supply.rank ?? pledged.rank ?? null;
    foundry.utils.setProperty(source, "system.description.value", `<p>@UUID[${sourceId}]{${spell.name}}</p><hr>${source.system?.description?.value ?? ""}`);
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.spell`, { uuid: sourceId, name: spell.name, rank });
    if (source.type === "consumable" && !source.system?.spell) {
        source.system.spell = foundry.utils.mergeObject(spell.toObject(), { _id: foundry.utils.randomID(), system: { location: { value: null, heightenedLevel: rank } } },
            { inplace: false });
    }
    return source;
}

/* -------------------------------------------- */
/*  Investiture and healing (6.14)               */
/* -------------------------------------------- */

/** Whether an item is a magical tattoo or a graft that is invested now (`overrides`: ids decided this pass). */
function investedNow(item, overrides) {
    if (overrides.has(item.id)) return overrides.get(item.id);
    return item.system?.equipped?.invested === true && subjectRecordOf(item)?.state !== "decorative";
}

/**
 * The facts `investitureCheck` reads for a new tattoo or graft on `actor` (6.14): the investiture maximum, the magical
 * tattoos and grafts that work besides `item`, Tattooed Historian's exemptions (the registry's `investitureExempt`), and the
 * other items it invests. `overrides` holds items whose investment this pass already decided.
 */
export function investitureOf(actor, item, kind, overrides = new Map()) {
    const others = (actor.items ?? []).filter((i) => i.id !== item?.id && i.isOfType?.("physical") && traitsOf(i).includes("invested"));
    const has = (i, trait) => traitsOf(i).includes(trait);
    const tattoos = others.filter((i) => has(i, "tattoo") && isMagical({ traits: traitsOf(i) }) && investedNow(i, overrides)).length;
    const grafts = others.filter((i) => has(i, "graft") && investedNow(i, overrides)).length;
    const otherInvested = others.filter((i) => !has(i, "tattoo") && !has(i, "graft") && investedNow(i, overrides)).length;
    const options = new Set(traitsOf(item).map((t) => `item:trait:${t}`));
    const exempt = investitureExemptions(heldKeysOf(actor)).filter((e) => testPredicate(e.when, options))
        .reduce((sum, e) => sum + Math.floor(Math.max(0, Number(valueAt(actor, e.count)) || 0) / Math.max(1, e.per)), 0);
    const max = actor.system?.resources?.investiture?.max ?? 10;
    return { kind, max: Number.isInteger(max) ? max : 10, tattoos, grafts, exempt, otherInvested };
}

/** An item's own traits (its source's, before pf2e prepares derived ones). */
const ownTraits = (item) => [...(item?._source?.system?.traits?.value ?? item?.system?.traits?.value ?? [])];

/**
 * What makes a tattoo decorative on the item (6.14): no `magical`, `invested` or tradition trait and no rule elements, so
 * pf2e's sheet offers no investment and applies nothing.
 */
const decorativeData = (item) => ({ "system.traits.value": decorativeTraits(ownTraits(item)), "system.rules": [] });

/**
 * Settle the tattoos and grafts one actor holds (6.14): an upgrade removes the item it replaced; one whose healing ended,
 * and an inactive graft, is invested if the invest limit allows, else stays decorative (a tattoo, which then loses its
 * magic: `decorativeData`) or inactive (a graft). One at a time, so two healed on the same day are counted against each
 * other. One that does not work (`NOT_WORKING`: still healing, decorative or inactive) but was invested on pf2e's sheet is
 * uninvested again, and its owner told. Returns what changed.
 */
export async function settleActor(actor, day = today().day) {
    const items = (actor.items ?? []).filter((i) => subjectRecordOf(i));
    if (!items.length) return [];
    const at = stampNow().at;
    const deletes = [];
    const updates = new Map();
    const update = (item, data) => updates.set(item.id, { ...(updates.get(item.id) ?? { _id: item.id }), ...data });
    for (const item of items) {
        const record = subjectRecordOf(item);
        if (record.replaces && !record.replaced && actor.items.get(record.replaces)) {
            deletes.push(record.replaces);
            update(item, { [`flags.${MODULE_ID}.subject.replaced`]: { day, at } });
        }
    }
    const overrides = new Map(deletes.map((id) => [id, false]));
    const changed = [];
    for (const item of items.filter((i) => !deletes.includes(i.id))) {
        const record = subjectRecordOf(item);
        let over = false;
        const patch = settleSubject(record, { day, check: () => {
            const result = investitureCheck(investitureOf(actor, item, record.kind, overrides));
            over = result.over;
            return result;
        } });
        if (!patch) {
            const invested = NOT_WORKING.includes(record.state) && item.system?.equipped?.invested === true;
            const magical = record.state === "decorative" && stillMagical(ownTraits(item));
            if (!invested && !magical) continue;
            overrides.set(item.id, false);
            update(item, { "system.equipped.invested": false, ...(magical ? decorativeData(item) : {}) });
            if (invested) changed.push({ id: item.id, name: item.name, state: record.state, uninvested: true, over: false });
            continue;
        }
        overrides.set(item.id, patch.invested);
        update(item, { [`flags.${MODULE_ID}.subject.state`]: patch.state, [`flags.${MODULE_ID}.subject.settled`]: { day, at },
            "system.equipped.carryType": carryTypeOf(record.kind), "system.equipped.invested": patch.invested,
            ...(patch.state === "decorative" ? decorativeData(item) : {}) });
        changed.push({ id: item.id, name: item.name, state: patch.state, over: patch.invested && over });
    }
    if (deletes.length) await actor.deleteEmbeddedDocuments("Item", deletes);
    if (updates.size) await actor.updateEmbeddedDocuments("Item", [...updates.values()]);
    // Told on this client, the subject's responsible one (P4): what each tattoo or graft became, and an invest limit now passed.
    for (const c of changed) {
        if (c.uninvested) {
            ui.notifications.warn(UNINVESTED[c.state], { format: { item: c.name, name: actor.name } });
            continue;
        }
        ui.notifications.info(SETTLED[c.state] ?? SETTLED.invested, { format: { item: c.name, name: actor.name } });
        if (c.over) ui.notifications.warn("pf2e-artisans-workshop.Subject.Over", { format: { name: actor.name } });
    }
    return changed;
}

/** What the subject is told when a tattoo or graft settles (6.14). */
const SETTLED = Object.freeze({
    invested: "pf2e-artisans-workshop.Subject.Settled.Invested",
    decorative: "pf2e-artisans-workshop.Subject.Settled.Decorative",
    inactive: "pf2e-artisans-workshop.Subject.Settled.Inactive",
});

/** What the subject is told when a tattoo or graft that does not work was invested by hand and is uninvested again. */
const UNINVESTED = Object.freeze({
    healing: "pf2e-artisans-workshop.Subject.Uninvested.Healing",
    decorative: "pf2e-artisans-workshop.Subject.Uninvested.Decorative",
    inactive: "pf2e-artisans-workshop.Subject.Uninvested.Inactive",
});

let sweeping = null;

/** One pass of the subject sweep. */
async function sweepSubjects() {
    if (!canWrite()) return [];
    const day = today().day;
    const box = shared().strongbox;
    const out = [];
    for (const actor of game.actors ?? []) {
        if (actor === box || !(actor.items ?? []).some((i) => subjectRecordOf(i)) || !isResponsibleFor(actor)) continue;
        const changed = await settleActor(actor, day);
        if (changed.length) out.push({ actor: actor.uuid, changed });
    }
    return out;
}

/**
 * The subject sweep (a step of the catch-up sweep, P5): every actor this tab is responsible for (5.6) settles its tattoos
 * and grafts (`settleActor`). Single-flight on this client: a sweep asked for while one runs gets that one.
 */
export function subjectSweep() {
    if (sweeping) return sweeping;
    sweeping = sweepSubjects().finally(() => {
        sweeping = null;
    });
    return sweeping;
}

/**
 * Record magical or alchemical healing on a tattoo that is healing (6.14), as its owner: its healing ends today, but never
 * before the day after it was finished; the order notes it for everyone (`orders.<id>.healing`, a key of its own). The
 * tattoo is then settled at once. Refused: `not-ready`, `no-item`, `not-owner`, `state` (it is not healing).
 */
export async function recordHealing(itemUuid) {
    if (!canWrite()) return refuse("not-ready");
    const item = actorOf(itemUuid);
    const record = subjectRecordOf(item);
    if (!item || !record) return refuse("no-item");
    if (!item.isOwner) return refuse("not-owner");
    if (record.state !== "healing") return refuse("state", { status: record.state });
    const day = today().day;
    const until = healedUntil(record, day);
    const stamp = stampNow();
    await item.update({ [`flags.${MODULE_ID}.subject.until`]: until, [`flags.${MODULE_ID}.subject.healed`]: { day, ...stamp } });
    if (read(`orders.${record.order}`)) await write({ replace: { [`orders.${record.order}.healing`]: { day, until, item: item.uuid, ...stamp } } });
    const changed = item.parent && isResponsibleFor(item.parent) ? await settleActor(item.parent, day) : [];
    return { ok: true, until, changed };
}

/* -------------------------------------------- */
/*  Missives                                     */
/* -------------------------------------------- */

/**
 * Compose a missive (Compose Missive, 10 minutes; Treasure Vault (Remastered) p.84), as its owner: one of a stack is split
 * off and composed (each missive is composed on its own), its name marked, the composer and an optional note recorded
 * (`flags.MOD.missive.composed`). Refused: `not-ready`, `no-item`, `not-owner`, `not-missive`, `composed`.
 */
export async function composeMissive(itemUuid, { note = "" } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const item = actorOf(itemUuid);
    if (!item?.parent) return refuse("no-item");
    if (!item.isOwner) return refuse("not-owner");
    const plan = composePlan({ traits: traitsOf(item), composed: !!item.flags?.[MODULE_ID]?.missive?.composed },
        { actor: item.parent.uuid, by: game.user.id, at: stampNow().at, note });
    if (!plan.ok) return plan;
    const name = game.i18n.format("pf2e-artisans-workshop.Missive.ComposedName", { name: item.name });
    const qty = item.quantity ?? item.system?.quantity ?? 1;
    if (qty > 1) {
        const source = item.toObject();
        delete source._id;
        source.name = name;
        source.system.quantity = 1;
        foundry.utils.setProperty(source, `flags.${MODULE_ID}.missive`, { composed: plan.record });
        const [made] = await item.parent.createEmbeddedDocuments("Item", [source]);
        await item.update({ "system.quantity": qty - 1 });
        return { ok: true, item: made?.uuid ?? null };
    }
    await item.update({ name, [`flags.${MODULE_ID}.missive.composed`]: plan.record });
    return { ok: true, item: item.uuid };
}

/** The missives an actor holds that are not composed yet. */
export const blankMissives = (actor) => (actor?.items ?? []).filter((i) => isMissive({ traits: traitsOf(i) }) && !i.flags?.[MODULE_ID]?.missive?.composed);

/* -------------------------------------------- */
/*  Quick-deploy snares (7.1)                    */
/* -------------------------------------------- */

/** pf2e's crafting abilities of an actor that prepare snares for quick deployment (prepared, not daily). */
const snareAbilities = (actor) => [...(actor?.crafting?.abilities ?? [])].filter((a) => a.isPrepared && !a.isDailyPrep);

/** The quick-deploy marks a character set on its prepared snares, by pool: `{<slug>: {<entry key>: mark}}`. */
export function snareMarksOf(actor) {
    const out = {};
    for (const [slug, marks] of Object.entries(actor?.flags?.[MODULE_ID]?.quickDeploy ?? {})) {
        out[slug] = Object.fromEntries(Object.values(marks ?? {}).filter((m) => m?.key && m.mark).map((m) => [m.key, m.mark]));
    }
    return out;
}

/**
 * A prepared snare pool's quick-deploy ledger (7.1, M9; `quickDeployLedger`): the pool as the Morning tab reads it
 * (`{slug, maxSlots, prepared}`), the character's marks, and the marks its feats allow.
 */
export function snareLedger(actor, pool) {
    const allowed = quickDeployMarks(heldKeysOf(actor));
    return { ...quickDeployLedger(pool, snareMarksOf(actor)[pool.slug] ?? {}, allowed), allowed };
}

/**
 * Mark a prepared snare giant or broad (or plain: `mark` null), as its owner (Giant Snare, Broad Snare: it costs two of the
 * quick-deployment snares). Refused: `not-owner`, `no-pool`, `mark` (a mark the character's feats do not allow).
 */
export async function setSnareMark(actorUuid, slug, key, mark) {
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    if (!snareAbilities(actor).some((a) => a.slug === slug)) return refuse("no-pool");
    if (mark && !quickDeployMarks(heldKeysOf(actor)).includes(mark)) return refuse("mark");
    const path = `flags.${MODULE_ID}.quickDeploy.${slug}`;
    const id = hashId(`snare:${key}`);
    await actor.update({ [`${path}.${id}`]: mark ? { key, mark } : _del });
    return { ok: true };
}

/**
 * Deploy a prepared snare, as its owner: pf2e's own `CraftingAbility#toggleFormulaExpended(index, true)`, the call its
 * sheet's expend toggle makes (P6). pf2e's `craft` expends the slot and then makes nothing for a snare ("Snares operate under
 * entirely different rules"), and placing it on the map is a non-goal (1.2), so no item is made. Refused: `not-owner`,
 * `no-pool`, `deployed` (already expended), `not-deployed` (pf2e's list still shows the slot ready afterwards).
 */
export async function deploySnare(actorUuid, slug, index) {
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const ability = snareAbilities(actor).find((a) => a.slug === slug);
    if (!ability) return refuse("no-pool");
    const prepared = await ability.getPreparedCraftingFormulas?.() ?? [];
    if (!prepared[index]) return refuse("no-pool");
    if (prepared[index].expended) return refuse("deployed");
    await ability.toggleFormulaExpended(index, true);
    const after = await ability.getPreparedCraftingFormulas?.() ?? [];
    return after[index]?.expended ? { ok: true, item: null } : refuse("not-deployed");
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

let timer = null;
/** Run the subject sweep once changes stop for a moment. */
export function scheduleSubjects(ms = 500) {
    clearTimeout(timer);
    timer = setTimeout(() => {
        subjectSweep().catch((error) => console.error(`${MODULE_ID} | subject sweep failed`, error));
    }, ms);
}

/**
 * Hooks at `init` (M9): a delivered tattoo or graft, a change to what a subject invests, the workshop day moving (the clock's
 * day, or days logged ahead of it) run the subject sweep; each actor is settled on its responsible client only (P4).
 */
export function registerCraftHooks() {
    const dayMoved = dayWatcher();
    Hooks.on("updateWorldTime", () => {
        if (dayMoved()) scheduleSubjects();
    });
    Hooks.on("createItem", (item) => {
        if (subjectRecordOf(item)) scheduleSubjects();
    });
    Hooks.on("updateItem", (item, changed) => {
        if (changed?.system?.equipped && (item.parent?.items ?? []).some((i) => NOT_WORKING.includes(subjectRecordOf(i)?.state))) scheduleSubjects();
    });
    Hooks.on("updateJournalEntry", (doc, changed) => {
        if (doc !== shared().ledger) return;
        if ("manual" in (changed.flags?.[MODULE_ID]?.meta ?? {})) scheduleSubjects();
    });
}

/** For tests only. */
export function resetCrafts() {
    clearTimeout(timer);
    timer = null;
    sweeping = null;
}
