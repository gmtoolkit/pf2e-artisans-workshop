/**
 * What the Workshop shows of the Treasure Vault (Remastered) variants (DESIGN.md 6.16, 10.1-10.5, M9a), and only while each
 * is on: on an order's detail, Complex Crafting (the rush chosen before the start, "Set up now" for a setup of hours,
 * rushing the finishing, the flat check's result), crafting events (rolled, resolved), Critical Crafting (the special flag,
 * the panel of a critical, the curse, a GM's reveal), Deconstruct (its purpose, the workshop, the follow-on, damage), a later
 * order's components and its "similar" confirmation, Grow (its tools, untended growth, season checks), a quest (its
 * components, cost against treasure and assembly), an item's adjustments, a bestowed gift and a note on a quirk or a curse;
 * in the Funds tab the gardens and the bestowed gifts with their Price; in the Downtime tab today's harvests. Buttons carry
 * `data-action="variant"` and `data-op`; the handler asks what it needs and runs the Foundry side
 * (`scripts/foundry/variants.mjs`, `deconstruct.mjs`, `nature.mjs`, `quests.mjs`).
 *
 * Every view returns null while its variant is off, so a table that never turns one on sees nothing of them (P10).
 */
import { isConsumableForBatch } from "../logic/batches.mjs";
import { isComplexCraftSetup, rushOptions } from "../logic/complex.mjs";
import { DEGREE } from "../logic/core.mjs";
import { unallocatedCp } from "../logic/funds.mjs";
import { materialLines } from "../logic/materials.mjs";
import { CLOSED } from "../logic/orders.mjs";
import { setupDaysDone } from "../logic/progress.mjs";
import { holds } from "../logic/registry.mjs";
import {
    CRITICAL_CATEGORIES, anyVariantOn, canRushFinish, checkHidden, criticalOf, eventResult, eventSlot, eventsOf, gardenLimit, questBudget, questComponents,
    questCost,
} from "../logic/variants.mjs";
import { QUEST_THREATS, VARIANT_UUIDS } from "../data/variants.mjs";
import { handOver } from "../foundry/custody.mjs";
import * as deconstruct from "../foundry/deconstruct.mjs";
import { today } from "../foundry/downtime.mjs";
import * as nature from "../foundry/nature.mjs";
import { actingChoices, retry, viewer as currentViewer } from "../foundry/orders.mjs";
import { crafterFacts, routeFor, skillFor, targetOf } from "../foundry/products.mjs";
import * as quests from "../foundry/quests.mjs";
import { members } from "../foundry/roster.mjs";
import { rulesFromSettings } from "../foundry/settings.mjs";
import { read, records } from "../foundry/store.mjs";
import * as variants from "../foundry/variants.mjs";
import { money, nameOf, number, report, skillName } from "./format.mjs";
import { CRITICAL_CATEGORY, ITEM_OUTCOME, THREAT } from "./labels.mjs";
import { askChoice, askMoney, confirm } from "./prompts.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const owns = (uuid) => actorOf(uuid)?.isOwner === true;

/** The variant switches now; `any` while at least one is on. */
function switches() {
    const v = rulesFromSettings().variants;
    return { v, any: anyVariantOn(rulesFromSettings()) };
}

/** Orders a crafter is working on (its days count toward its events). */
const WORKING = Object.freeze(["setup", "check", "rolled", "finishing", "paused"]);
/** Orders not started yet. */
const BEFORE_START = Object.freeze(["requested", "accepted"]);

/* -------------------------------------------- */
/*  An order's detail                            */
/* -------------------------------------------- */

/**
 * What an order's detail shows of the variants that are on (6.16), or null when none applies.
 * @param {object} order
 * @param {object|null} product  the product's facts (`productFacts`)
 */
export async function variantDetail(order, product) {
    const { v, any } = switches();
    if (!any) return null;
    const viewer = currentViewer();
    const crafterOwned = !!order.crafter && owns(order.crafter);
    const rules = rulesFromSettings();
    const out = {
        complex: v.complexCrafting ? await complexView(order, product, crafterOwned, rules) : null,
        events: v.events ? eventsView(order, viewer, crafterOwned) : null,
        critical: v.criticalCrafting ? criticalView(order, viewer, crafterOwned, rules) : null,
        deconstruct: v.deconstruct && order.craftType === "deconstruct" ? deconstructView(order, viewer, crafterOwned) : null,
        components: v.deconstruct && order.craftType !== "deconstruct" ? componentsView(order, crafterOwned) : null,
        grow: v.grow && order.craftType === "grow" ? growView(order, crafterOwned, rules) : null,
        quest: v.quests && order.craftType === "quest" ? questView(order, product, viewer, crafterOwned) : null,
        adjustments: v.adjustments && order.variant?.adjustments?.length
            ? order.variant.adjustments.map((uuid) => fromUuidSync(uuid, { strict: false })?.name ?? uuid.split(".").pop()) : null,
        bestow: v.gifts && order.variant?.bestow ? fmt("pf2e-artisans-workshop.Variant.Gift.Bestowed", { giver: order.variant.bestow.giver || loc("pf2e-artisans-workshop.Variant.Gift.Unnamed") }) : null,
        note: noteView(order, viewer, crafterOwned),
    };
    return Object.values(out).some(Boolean) ? out : null;
}

/** Complex Crafting on the detail (6.16.1). */
async function complexView(order, product, crafterOwned, rules) {
    if (order.product?.type !== "item" || !isComplexCraftSetup(order.craftType ?? "item") || !product) return null;
    const out = { lines: [], rush: null, setUpNow: false, rushFinish: null, flat: null };
    const crafter = actorOf(order.crafter);
    if (BEFORE_START.includes(order.status) && crafter) {
        const facts = crafterFacts(crafter);
        const route = await routeFor(facts, product, rules);
        const options = rushOptions({ itemLevel: product.level, crafterLevel: facts.level, consumable: isConsumableForBatch(product), route,
            rank: facts.ranks?.[skillFor(order, rules)] ?? 0, quickSetup: holds(facts.held, "quick-setup", rules) });
        const chosen = options.find((o) => o.rush === (order.variant?.rushRequest ?? 0)) ?? options[0];
        out.lines.push(setupText(chosen));
        out.rush = { can: crafterOwned && options.length > 1 };
    } else if (order.setup) {
        const frozen = order.variant?.complex ?? { rush: 0 };
        out.lines.push(setupText({ days: order.setup.days, hours: order.setup.hours ?? 0, rush: frozen.rush ?? 0, dcAdd: 5 * (frozen.rush ?? 0), quick: !!frozen.quick }));
    }
    if (order.status === "setup" && (order.setup?.hours ?? 0) > 0 && crafterOwned) {
        const days = records("days").filter((d) => d.order === order.id);
        out.setUpNow = setupDaysDone(order, days) >= order.setup.days;
    }
    const rank = crafter?.skills?.[order.skill ?? "crafting"]?.rank ?? 0;
    if (WORKING.includes(order.status) && (canRushFinish(rank, rules) || order.variant?.rushFinish)) {
        out.rushFinish = { on: order.variant?.rushFinish === true, can: crafterOwned };
    }
    const flat = order.check?.rushFlat;
    if (flat) {
        out.flat = fmt("pf2e-artisans-workshop.Variant.Rush.Result", { dc: number(flat.dc), die: flat.die === null ? "-" : number(flat.die),
            outcome: loc(ITEM_OUTCOME[flat.outcome] ?? ITEM_OUTCOME.fine) });
    }
    return out;
}

/** A Complex Crafting setup in words: days or hours, and the rush with the DC it adds. */
function setupText({ days, hours, rush, dcAdd, quick }) {
    const time = hours > 0 ? fmt(quick ? "pf2e-artisans-workshop.Variant.Rush.Hours.Quick" : "pf2e-artisans-workshop.Variant.Rush.Hours.Plain", { hours: number(hours) })
        : fmt(days === 1 ? "pf2e-artisans-workshop.Variant.Rush.Days.One" : "pf2e-artisans-workshop.Variant.Rush.Days.Many", { days: number(days) });
    if (rush <= 0) return time;
    return fmt(rush === 1 ? "pf2e-artisans-workshop.Variant.Rush.RushedOne" : "pf2e-artisans-workshop.Variant.Rush.Rushed", { time, rush: number(rush), dc: number(dcAdd) });
}

/** Crafting events on the detail (6.16.3). */
function eventsView(order, viewer, crafterOwned) {
    const list = eventsOf(order).map((e) => {
        const result = eventResult(e.roll);
        return {
            slot: eventSlot(e.attempt, e.k), k: number(e.k), day: number(e.day), roll: number(e.roll), gmCore: !e.tableResult && result.gmCore,
            link: VARIANT_UUIDS.downtimeEvents,
            text: e.tableResult ? fmt("pf2e-artisans-workshop.Variant.Event.Table", { result: e.tableResult })
                : result.gmCore ? loc("pf2e-artisans-workshop.Variant.Event.GmCoreShort") : fmt("pf2e-artisans-workshop.Variant.Event.RowShort", { row: number(result.row) }),
            open: e.status === "open", note: e.note || null, canResolve: e.status === "open" && (viewer.isGM || viewer.hasCharacter),
        };
    });
    const canRoll = crafterOwned && WORKING.includes(order.status);
    return list.length || canRoll ? { list, canRoll, pauses: rulesFromSettings().variants.eventsPauses === true } : null;
}

/** Critical Crafting on the detail (6.16.4). */
function criticalView(order, viewer, crafterOwned, rules) {
    const out = { special: null, pending: null, record: null, secret: null };
    if (BEFORE_START.includes(order.status)) {
        out.special = { on: order.variant?.special === true, can: viewer.isGM || owns(order.requester) || crafterOwned };
    } else if (order.variant?.special) out.special = { on: true, can: false };
    const check = order.check;
    if (check && checkHidden(check, viewer)) out.secret = { text: loc("pf2e-artisans-workshop.Variant.Critical.Secret") };
    if (check?.secret && !check.settled && !check.revealed && viewer.isGM) out.secret = { text: loc("pf2e-artisans-workshop.Variant.Critical.SecretGm"), canReveal: true };
    if (check && !check.settled && !checkHidden(check, viewer) && criticalOf(check, order, rules)) out.pending = loc("pf2e-artisans-workshop.Variant.Critical.Pending");
    const critical = check?.critical;
    if (critical) {
        const categories = CRITICAL_CATEGORIES[critical.kind] ?? [];
        out.record = {
            kind: critical.kind, kindText: loc(critical.kind === "success" ? "pf2e-artisans-workshop.Variant.Critical.Success" : "pf2e-artisans-workshop.Variant.Critical.Failure"),
            natural: critical.natural ? loc("pf2e-artisans-workshop.Variant.Critical.Natural") : null,
            mode: loc(critical.mode === "replace" ? "pf2e-artisans-workshop.Settings.Variants.CriticalMode.Replace" : "pf2e-artisans-workshop.Settings.Variants.CriticalMode.Alongside"),
            category: critical.category ? loc(CRITICAL_CATEGORY[`${critical.kind}.${critical.category}`] ?? CRITICAL_CATEGORY[`${critical.kind}.other`]) : null,
            note: critical.note || null, canRecord: crafterOwned || viewer.isGM, categories,
            curse: critical.curse ? fmt("pf2e-artisans-workshop.Variant.Critical.Cursed", { n: number(critical.curse.size) }) : null,
            canCurse: critical.kind === "failure" && crafterOwned && !critical.curse,
        };
    }
    return out.special || out.pending || out.record || out.secret ? out : null;
}

/** Deconstruct on the detail (6.16.5). */
function deconstructView(order, viewer, crafterOwned) {
    const d = order.variant?.deconstruct ?? {};
    const before = BEFORE_START.includes(order.status);
    const followOn = d.followOn ? read(`orders.${d.followOn}`) : null;
    const item = targetOf(order);
    const components = item ? deconstruct.componentsOf(item) : null;
    return {
        uuid: VARIANT_UUIDS.deconstruct,
        purpose: loc(d.purpose === "similar" ? "pf2e-artisans-workshop.Variant.Deconstruct.Similar" : "pf2e-artisans-workshop.Variant.Deconstruct.Raw"),
        similarNote: d.similarTo?.note || null,
        canPurpose: before && (viewer.isGM || owns(order.requester) || crafterOwned),
        workshop: { on: !!order.checklist?.workshop, can: crafterOwned && (before || order.status === "failed") },
        followOn: d.purpose === "similar" ? { name: followOn?.product?.snapshot?.name ?? null, can: crafterOwned && [...BEFORE_START, "setup", "check", "rolled"].includes(order.status) } : null,
        damaged: d.damaged ? loc("pf2e-artisans-workshop.Variant.Deconstruct.Damaged") : null,
        canRetryLoss: !!d.damaged && order.status === "failed" && crafterOwned,
        loss: d.lossPct > 0 ? fmt("pf2e-artisans-workshop.Variant.Deconstruct.Loss", { pct: number(d.lossPct) }) : null,
        result: order.status === "complete" && components
            ? fmt("pf2e-artisans-workshop.Variant.Deconstruct.Result", { credit: money(components.valueCp), raw: money(components.rawCp),
                expires: Number.isInteger(components.expiresDay) ? fmt("pf2e-artisans-workshop.Variant.Deconstruct.Expires", { day: number(components.expiresDay) }) : "" })
            : null,
    };
}

/** A later order's components (6.16.5): the line, and the crafter's "similar" confirmation. */
function componentsView(order, crafterOwned) {
    const lines = materialLines(order, { includeUsed: true }).filter((l) => l.components).map((l) => ({
        name: l.name, credit: money(l.valueCp),
        purpose: loc(l.components.purpose === "similar" ? "pf2e-artisans-workshop.Variant.Deconstruct.Similar" : "pf2e-artisans-workshop.Variant.Deconstruct.Raw"),
    }));
    const open = ["requested", "accepted", "failed"].includes(order.status);
    const canHandOver = open && !lines.length && deconstruct.componentsChoices(actingChoices()).length > 0;
    if (!lines.length && !canHandOver) return null;
    return { lines, canHandOver, similar: { on: !!order.checklist?.similar, can: crafterOwned && !CLOSED.includes(order.status) } };
}

/** Grow on the detail (6.16.6). */
function growView(order, crafterOwned, rules) {
    const before = BEFORE_START.includes(order.status) || order.status === "failed";
    const grow = order.variant?.grow ?? {};
    const succeeded = order.check?.settled && order.check.degree >= DEGREE.success;
    const due = nature.seasonChecksDue(order);
    const seasons = records("days").filter((d) => d.order === order.id && d.attempt === order.attempt && d.kind === "season")
        .map((d) => fmt("pf2e-artisans-workshop.Variant.Grow.SeasonLine", { n: number(d.season + 1), day: number(d.day), amount: money(d.crafterCp ?? 0) }));
    return {
        uuid: VARIANT_UUIDS.grow, skill: fmt("pf2e-artisans-workshop.Variant.Grow.Skill", { skill: skillName(skillFor(order, rules)) }),
        tools: { on: !!order.checklist?.["grow-tools"], can: crafterOwned && before },
        untended: order.status === "finishing" && succeeded ? { on: grow.mode === "untended", can: crafterOwned } : null,
        due: due.map((d) => ({ season: d.season, text: fmt("pf2e-artisans-workshop.Variant.Grow.Due", { n: number(d.season + 1), day: number(d.endDay) }), can: crafterOwned })),
        seasons,
    };
}

/** A crafting quest on the detail (6.16.9). */
function questView(order, product, viewer, crafterOwned) {
    const quest = order.variant?.quest;
    if (!quest) return null;
    const priceCp = Math.round(((product?.priceCp ?? order.product?.snapshot?.priceCp ?? 0) * (order.quantity ?? 1)) / Math.max(1, product?.per ?? 1));
    const list = questComponents(quest);
    const cost = questCost(priceCp, list.length);
    const level = actorOf(order.recipient?.uuid)?.level ?? actorOf(order.crafter)?.level ?? product?.level ?? 1;
    const budget = new Map(questBudget(quest, { priceCp, level: Math.max(1, level) }).map((b) => [b.id, b]));
    const gathering = order.status === "gathering";
    const member = viewer.isGM || viewer.hasCharacter;
    return {
        cost: fmt("pf2e-artisans-workshop.Variant.Quest.Cost", { price: money(priceCp), equivalent: money(cost.equivalentCp), share: money(cost.perEncounterCp),
            n: number(list.length) }),
        assembly: quest.assemblyCheck ? fmt("pf2e-artisans-workshop.Variant.Quest.Assembly", { skill: skillName(quest.assemblySkill ?? "crafting") })
            : loc("pf2e-artisans-workshop.Variant.Quest.NoAssembly"),
        components: list.map((c) => {
            const b = budget.get(c.id);
            return {
                id: c.id, label: c.label || fmt("pf2e-artisans-workshop.Variant.Quest.Component", { n: number(c.n) }), threat: loc(THREAT[c.threat] ?? THREAT.moderate),
                found: c.found ? fmt("pf2e-artisans-workshop.Variant.Quest.Found", { day: number(c.found.day ?? 0), by: game.users.get(c.found.by)?.name ?? "" }) : null,
                over: b?.over ? fmt("pf2e-artisans-workshop.Variant.Quest.Over", { share: money(b.shareCp), budget: money(b.budgetCp) }) : null,
                canMark: gathering && !c.found && member, canUnmark: gathering && !!c.found && (viewer.isGM || c.found.by === game.user.id),
                canEdit: BEFORE_START.includes(order.status) && (crafterOwned || (!order.crafter && owns(order.requester)) || viewer.isGM),
            };
        }),
        canConfigure: BEFORE_START.includes(order.status) && (crafterOwned || (!order.crafter && owns(order.requester)) || viewer.isGM),
        outcome: order.check?.outcome ? loc(ITEM_OUTCOME[order.check.outcome] ?? ITEM_OUTCOME.fine) : null,
        hint: product && !product.traits?.includes("consumable") ? null : loc("pf2e-artisans-workshop.Variant.Quest.ConsumableHint"),
    };
}

/** A note on a quirk, a curse or a critical, which the crafter writes (6.16.1, 6.16.4, 6.16.9). */
function noteView(order, viewer, crafterOwned) {
    const outcome = order.check?.rushFlat?.outcome ?? order.check?.outcome ?? null;
    const needs = ["quirk", "cursed"].includes(outcome) || !!order.check?.critical;
    if (!needs && !order.variantNote) return null;
    return { text: order.variantNote?.text || null, can: needs && (crafterOwned || viewer.isGM),
        ask: ["quirk", "cursed"].includes(outcome) ? loc(ITEM_OUTCOME[outcome]) : null };
}

/* -------------------------------------------- */
/*  The Funds tab: gardens and gifts             */
/* -------------------------------------------- */

/** The Funds tab's gardens (6.16.7) and bestowed gifts (6.16.8), or null while both are off. */
export function fundsVariants() {
    const { v } = switches();
    if (!v.gardens && !v.gifts) return null;
    return { gardens: v.gardens ? gardensView() : null, gifts: v.gifts ? giftsView() : null };
}

/** The party's gardens, each with its seed cost and what it holds toward it. */
export function gardensView() {
    const pcs = members().length;
    const list = nature.gardensOf();
    const member = game.user.isGM || actingChoices().length > 0;
    return {
        list: list.map((g) => {
            const held = nature.gardenFunds(g.id).heldCp;
            const planted = Number.isInteger(g.plantedDay);
            return {
                id: g.id, name: g.name, kind: g.kind || null, product: g.product?.name ?? "", img: g.product?.img ?? null,
                seed: money(g.seedCostCp), held: money(held), planted: planted ? fmt("pf2e-artisans-workshop.Variant.Garden.PlantedOn", { day: number(g.plantedDay) }) : null,
                canFund: !planted && member, canRemove: !planted && held === 0 && member,
            };
        }),
        limit: fmt("pf2e-artisans-workshop.Variant.Garden.Limit", { n: number(list.length), max: number(gardenLimit(pcs)) }),
        canAdd: member && list.length < gardenLimit(pcs),
    };
}

/** The bestowed gifts the members hold, each with its Price, for counting against party treasure (TV-R p.166). */
export function giftsView() {
    const gifts = variants.partyGifts();
    const own = new Set(actingChoices().map((a) => a.uuid));
    return {
        list: gifts.map(({ item, holder, gift, dormant, priceCp }) => ({
            uuid: item.uuid, name: item.name, holder: holder.name, bound: nameOf(gift.bound), heirs: (gift.heirs ?? []).map(nameOf).join(", ") || null,
            giver: gift.giver || null, dormant, price: money(priceCp), canHeir: own.has(holder.uuid) && !dormant,
        })),
        total: money(gifts.reduce((sum, g) => sum + g.priceCp, 0)),
        canBestow: actingChoices().some((a) => (a.items ?? []).some((i) => i.isOfType?.("physical") && !variants.giftOf(i))),
    };
}

/* -------------------------------------------- */
/*  The Downtime tab: harvests                   */
/* -------------------------------------------- */

/** Today's harvests (6.16.7): every planted garden, harvested today or not, for the character this user acts as. */
export function harvestView(acting) {
    if (!switches().v.gardens) return null;
    const day = today().day;
    const list = nature.gardensOf().filter((g) => Number.isInteger(g.plantedDay)).map((g) => {
        const done = g.harvests?.[day] ?? null;
        return { id: g.id, name: g.name, product: g.product?.name ?? "", img: g.product?.img ?? null,
            done: done ? fmt("pf2e-artisans-workshop.Variant.Garden.Harvested", { actor: nameOf(done.actor) }) : null,
            canHarvest: !done && !!acting && day >= g.plantedDay };
    });
    return list.length ? { list, day: number(day), acting: acting?.name ?? null } : null;
}

/* -------------------------------------------- */
/*  Actions                                      */
/* -------------------------------------------- */

/** The rush choices before the start, as dialog options (6.16.1). */
async function rushChoices(order) {
    const crafter = actorOf(order.crafter);
    const { productFacts } = await import("../foundry/products.mjs");
    const product = await productFacts(order.product?.uuid);
    if (!crafter || !product) return [];
    const rules = rulesFromSettings();
    const facts = crafterFacts(crafter);
    const route = await routeFor(facts, product, rules);
    return rushOptions({ itemLevel: product.level, crafterLevel: facts.level, consumable: isConsumableForBatch(product), route,
        rank: facts.ranks?.[skillFor(order, rules)] ?? 0, quickSetup: holds(facts.held, "quick-setup", rules) })
        .map((o) => ({ value: String(o.rush), name: setupText(o) }));
}

/** Consumables the members know formulas for (a garden's product), by name. */
function gardenProducts() {
    const out = new Map();
    for (const actor of members()) {
        for (const formula of actor.system?.crafting?.formulas ?? []) {
            const entry = fromUuidSync(formula.uuid, { strict: false });
            const traits = entry?.system?.traits?.value ?? [...(entry?.traits ?? [])];
            if (entry?.name && traits.includes("consumable")) out.set(formula.uuid, entry.name);
        }
    }
    return [...out].map(([value, name]) => ({ value, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The variant buttons (`data-action="variant"`). */
export async function onVariantOp(app, target) {
    const data = target.closest("[data-op]")?.dataset ?? {};
    const id = target.closest("[data-order-id]")?.dataset.orderId ?? null;
    const order = id ? read(`orders.${id}`) : null;
    const acting = app?.actingActor?.() ?? null;
    switch (data.op) {
        case "rush": {
            const options = order ? await rushChoices(order) : [];
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Rush.Choose", label: "pf2e-artisans-workshop.Variant.Rush.Label", options,
                hint: "pf2e-artisans-workshop.Variant.Rush.Hint", button: "pf2e-artisans-workshop.Variant.Rush.Choose", icon: "fa-solid fa-gauge-high", app });
            return answer?.value != null ? report(await variants.chooseRush(id, Number(answer.value))) : null;
        }
        case "setup-now": return report(await variants.setUpNow(id));
        case "rush-finish": return report(await variants.setRushFinish(id, order?.variant?.rushFinish !== true));
        case "roll-event": return report(await variants.rollEvent(id));
        case "resolve-event": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Event.Resolve", text: { label: "pf2e-artisans-workshop.Variant.Note" },
                button: "pf2e-artisans-workshop.Variant.Event.Resolve", icon: "fa-solid fa-check", app });
            return answer ? report(await variants.resolveEvent(id, data.slot, { note: answer.text ?? "" })) : null;
        }
        case "special": return report(await variants.setSpecial(id, order?.variant?.special !== true));
        case "critical": {
            const kind = order?.check?.critical?.kind ?? "success";
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Critical.Record", label: "pf2e-artisans-workshop.Variant.Critical.CategoryLabel",
                options: (CRITICAL_CATEGORIES[kind] ?? []).map((c) => ({ value: c, name: loc(CRITICAL_CATEGORY[`${kind}.${c}`]) })),
                text: { label: "pf2e-artisans-workshop.Variant.Note" }, button: "pf2e-artisans-workshop.Variant.Critical.Record", icon: "fa-solid fa-star", app });
            return answer ? report(await variants.recordCritical(id, { category: answer.value, note: answer.text ?? "" })) : null;
        }
        case "curse": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Critical.Curse", number: { label: "pf2e-artisans-workshop.Variant.Critical.CurseSize", min: 1, value: 1 },
                hint: "pf2e-artisans-workshop.Variant.Critical.CurseHint", button: "pf2e-artisans-workshop.Variant.Critical.Curse", icon: "fa-solid fa-skull", app });
            return answer ? report(await variants.curseCrafter(id, answer.number ?? 1)) : null;
        }
        case "reveal": return report(await variants.revealCheck(id));
        case "note": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.NoteTitle", text: { label: "pf2e-artisans-workshop.Variant.Note" },
                button: "pf2e-artisans-workshop.Variant.NoteSave", icon: "fa-solid fa-pen", app });
            return answer ? report(await variants.recordNote(id, answer.text ?? "")) : null;
        }
        case "purpose": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Deconstruct.PurposeTitle", label: "pf2e-artisans-workshop.Variant.Deconstruct.PurposeLabel",
                options: [{ value: "similar", name: loc("pf2e-artisans-workshop.Variant.Deconstruct.Similar") }, { value: "raw", name: loc("pf2e-artisans-workshop.Variant.Deconstruct.Raw") }],
                text: { label: "pf2e-artisans-workshop.Variant.Deconstruct.SimilarLabel" }, button: "pf2e-artisans-workshop.Variant.Deconstruct.PurposeTitle",
                icon: "fa-solid fa-hammer", app });
            return answer ? report(await deconstruct.setPurpose(id, answer.value, { note: answer.text ?? "" })) : null;
        }
        case "checklist": return report(await deconstruct.confirmChecklist(id, data.key, !order?.checklist?.[data.key]));
        case "follow-on": {
            const options = [{ value: "", name: loc("pf2e-artisans-workshop.Variant.Deconstruct.NoFollowOn") },
                ...records("orders").filter((o) => o.id !== id && o.crafter === order?.crafter && o.checklist?.similar && !CLOSED.includes(o.status))
                    .map((o) => ({ value: o.id, name: o.product?.snapshot?.name ?? o.id }))];
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Deconstruct.FollowOnTitle", label: "pf2e-artisans-workshop.Variant.Deconstruct.FollowOnLabel",
                options, hint: "pf2e-artisans-workshop.Variant.Deconstruct.FollowOnHint", button: "pf2e-artisans-workshop.Variant.Deconstruct.FollowOnTitle",
                icon: "fa-solid fa-link", app });
            return answer ? report(await deconstruct.chooseFollowOn(id, answer.value || null)) : null;
        }
        case "retry-loss": {
            const ok = await confirm({ title: "pf2e-artisans-workshop.Variant.Deconstruct.RetryLoss", content: "pf2e-artisans-workshop.Variant.Deconstruct.RetryLossContent", app });
            return ok ? report(await retry(id, { acceptLoss: true })) : null;
        }
        case "components": {
            const options = deconstruct.componentsChoices(actingChoices()).map((c) => ({ value: c.uuid,
                name: fmt("pf2e-artisans-workshop.Variant.Deconstruct.ComponentsOption", { name: c.name, holder: c.holder, credit: money(c.components.rawCp) }) }));
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Deconstruct.UseComponents", label: "pf2e-artisans-workshop.Variant.Deconstruct.ComponentsLabel",
                options, hint: "pf2e-artisans-workshop.Variant.Deconstruct.ComponentsHint", button: "pf2e-artisans-workshop.Variant.Deconstruct.UseComponents",
                icon: "fa-solid fa-cubes", app });
            return answer?.value ? report(await handOver({ order: id, item: answer.value, purpose: "material" })) : null;
        }
        case "untended": return report(await nature.setUntended(id, order?.variant?.grow?.mode !== "untended"));
        case "season": return report(await nature.rollSeason(id, Number(data.season)));
        case "quest-config": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Quest.Configure", label: "pf2e-artisans-workshop.Variant.Quest.Locations",
                options: [{ value: "different", name: loc("pf2e-artisans-workshop.Variant.Quest.Different") }, { value: "same", name: loc("pf2e-artisans-workshop.Variant.Quest.Same") }],
                number: { label: "pf2e-artisans-workshop.Variant.Quest.Encounters", min: 1, value: Object.keys(order?.variant?.quest?.components ?? {}).length || 3 },
                hint: "pf2e-artisans-workshop.Variant.Quest.ConfigureHint", button: "pf2e-artisans-workshop.Variant.Quest.Configure", icon: "fa-solid fa-compass", app });
            return answer ? report(await quests.configureQuest(id, { encounters: answer.number ?? 1, differentLocations: answer.value !== "same",
                threats: questComponents(order?.variant?.quest).map((c) => c.threat), labels: questComponents(order?.variant?.quest).map((c) => c.label) })) : null;
        }
        case "component": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Quest.EditComponent", label: "pf2e-artisans-workshop.Variant.Quest.ThreatLabel",
                options: QUEST_THREATS.map((t) => ({ value: t, name: loc(THREAT[t]) })), text: { label: "pf2e-artisans-workshop.Variant.Quest.LabelLabel" },
                button: "pf2e-artisans-workshop.Variant.Quest.EditComponent", icon: "fa-solid fa-pen", app });
            return answer ? report(await quests.setComponent(id, data.component, { threat: answer.value, label: answer.text ?? "" })) : null;
        }
        case "found": return report(await quests.markFound(id, data.component, { actor: acting?.uuid ?? null }));
        case "unfound": return report(await quests.unmarkFound(id, data.component));
        case "garden-add": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Garden.Add", label: "pf2e-artisans-workshop.Variant.Garden.ProductLabel",
                options: gardenProducts(), text: { label: "pf2e-artisans-workshop.Variant.Garden.NameLabel" }, hint: "pf2e-artisans-workshop.Variant.Garden.AddHint",
                button: "pf2e-artisans-workshop.Variant.Garden.Add", icon: "fa-solid fa-seedling", app });
            return answer?.value ? report(await nature.addGarden({ name: answer.text ?? "", uuid: answer.value })) : null;
        }
        case "garden-fund": {
            const answer = await askMoney({ kind: "fund", actors: actingChoices(), actor: acting?.uuid ?? null, sources: { fundCp: unallocatedCp(records("rows")) }, app });
            return answer ? report(await nature.fundGarden(data.garden, answer)) : null;
        }
        case "garden-remove": return report(await nature.removeGarden(data.garden));
        case "harvest": return acting ? report(await nature.harvest(data.garden, acting.uuid)) : null;
        case "bestow": {
            const options = actingChoices().flatMap((a) => (a.items ?? []).filter((i) => i.isOfType?.("physical") && !variants.giftOf(i))
                .map((i) => ({ value: i.uuid, name: fmt("pf2e-artisans-workshop.Variant.Gift.ItemOption", { item: i.name, holder: a.name }) })));
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Gift.Record", label: "pf2e-artisans-workshop.Variant.Gift.ItemLabel", options,
                text: { label: "pf2e-artisans-workshop.Variant.Gift.GiverLabel" }, button: "pf2e-artisans-workshop.Variant.Gift.Record", icon: "fa-solid fa-gift", app });
            return answer?.value ? report(await variants.bestow(answer.value, { giver: answer.text ?? "" })) : null;
        }
        case "heir": {
            const item = fromUuidSync(data.item, { strict: false });
            const options = members().filter((a) => a !== item?.parent).map((a) => ({ value: a.uuid, name: a.name }));
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Variant.Gift.Heir", label: "pf2e-artisans-workshop.Variant.Gift.HeirLabel", options,
                hint: "pf2e-artisans-workshop.Variant.Gift.HeirHint", button: "pf2e-artisans-workshop.Variant.Gift.Heir", icon: "fa-solid fa-people-arrows", app });
            return answer?.value ? report(await variants.nameHeir(data.item, answer.value)) : null;
        }
        default: return null;
    }
}

/** Whether a check is hidden from this viewer (6.16.4), for the Queue's and the card's degree. */
export const hiddenCheck = (check) => checkHidden(check, currentViewer());
