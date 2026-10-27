/**
 * Nature crafting on this client (DESIGN.md 6.16.6-6.16.7, Treasure Vault (Remastered) pp.164-169, M9a): Grow orders left
 * untended and their season checks, and gardens of wonder (added by any member, funded like an order, planted once their
 * seed cost is in, harvested once a day). The pure parts are `scripts/logic/variants.mjs`.
 *
 * Who writes what (4.2.4, P2, P4): the crafter's owner leaves a Grow order untended and rolls its season checks, which the
 * crafter's responsible client prompts for once each season ends; any member adds a garden, funds it and harvests it for
 * a character of theirs; planting is derived, written by the client responsible for the change that completed the seed
 * cost (or the elected client's catch-up), in one lock-first move keyed `plant:<gardenId>`, so two pledges that complete it
 * together plant it once; a day's harvest is created behind the lock page `harvest:<gardenId>:<day>`, so two members
 * harvesting at once make one item.
 */
import { MODULE_ID } from "../constants.mjs";
import { earmarkInputs, fundSlotLockId, unallocatedCp } from "../logic/funds.mjs";
import { hashId } from "../logic/ids.mjs";
import { closedAs } from "../logic/orders.mjs";
import { seasonLink } from "../logic/rolls.mjs";
import { allocationsByContributor } from "../logic/split.mjs";
import {
    gardenRoom, harvestKey, makeGarden, plantKey, produceStamp, seasonIndexOf, seasonKey, seasonRecord, seasonsDue,
} from "../logic/variants.mjs";
import { runRequest } from "./batch.mjs";
import { dayOffset, secondsPerDay, today } from "./downtime.mjs";
import { lockedWrite, pledge, spend } from "./money.mjs";
import { productFacts } from "./products.mjs";
import { isElected, isResponsibleFor, isResponsibleForShared } from "./responsible.mjs";
import { members } from "./roster.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite, shared } from "./state.mjs";
import { exists, newId, read, records, stampNow, write } from "./store.mjs";
import { registerVariantSweep, variantOn, whisperTo } from "./variants.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);

/* -------------------------------------------- */
/*  Grow: untended growth and seasons (6.16.6)   */
/* -------------------------------------------- */

/**
 * Leave a Grow order untended, or tend it again (6.16.6, TV-R p.165): after a success the order no longer needs the
 * crafter's downtime; at the end of each season in which the crafter spent at least one downtime day growing it, a season
 * check is due. The crafter's owner. Refused: `variant-off`, `not-owner`, `state` (not finishing after a success).
 */
export async function setUntended(orderId, on) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("grow")) return refuse("variant-off");
    const order = read(`orders.${orderId}`);
    if (!order || order.craftType !== "grow") return refuse("no-order");
    if (!actorOf(order.crafter)?.isOwner) return refuse("not-owner");
    if (closedAs(order) || order.status !== "finishing") return refuse("state", { status: closedAs(order) ?? order.status });
    const value = on ? { mode: "untended", since: today().day, startDay: order.variant?.grow?.startDay ?? null }
        : { mode: "tended", since: null, startDay: order.variant?.grow?.startDay ?? null };
    await write({ replace: { [`orders.${orderId}.variant.grow`]: value } });
    return { ok: true, mode: value.mode };
}

/**
 * The season of a workshop day (6.16.6): by the world calendar's seasons when it defines them (each change of the
 * calendar's season, counted from `startDay`), otherwise every `seasonDays` days from `startDay`. Returns a function of
 * the day giving the season's index.
 */
export function seasonOfFor(startDay) {
    const seasonDays = rulesFromSettings().variants.seasonDays;
    const calendar = game.time?.calendar;
    if (!calendar?.seasons?.values?.length || typeof calendar.timeToComponents !== "function") {
        return (day) => seasonIndexOf(day, { startDay, seasonDays });
    }
    const spd = secondsPerDay();
    const offset = dayOffset();
    const seasonAt = (day) => {
        try {
            return calendar.timeToComponents(day * spd - offset + Math.floor(spd / 2))?.season ?? null;
        } catch {
            return null;
        }
    };
    const cache = new Map();
    return (day) => {
        if (cache.has(day)) return cache.get(day);
        let index = 0;
        let last = seasonAt(startDay);
        for (let d = startDay + 1; d <= day; d++) {
            const s = seasonAt(d);
            if (s !== last) index += 1;
            last = s;
        }
        cache.set(day, index);
        return index;
    };
}

/** The season checks a Grow order has due now (6.16.6), on this client's copies. */
export function seasonChecksDue(order) {
    if (!variantOn("grow") || order?.craftType !== "grow") return [];
    const start = order.variant?.grow?.startDay ?? 0;
    return seasonsDue({ order, days: records("days").filter((d) => d.order === order.id), today: today().day, seasonOf: seasonOfFor(start) });
}

/** Seasons this client has already prompted about this session (`<orderId>:<season>`). */
const prompted = new Set();

/**
 * Prompt for due season checks (6.16.6) on the crafter's responsible client: one notification per order and season.
 * Returns the prompts given. Nothing while Grow is off.
 */
export function seasonSweep() {
    if (!canWrite() || !variantOn("grow")) return [];
    const out = [];
    for (const order of records("orders")) {
        if (order.craftType !== "grow" || order.variant?.grow?.mode !== "untended") continue;
        const crafter = actorOf(order.crafter);
        if (!crafter || !isResponsibleFor(crafter)) continue;
        for (const due of seasonChecksDue(order)) {
            const key = `${order.id}:${due.season}`;
            if (prompted.has(key)) continue;
            prompted.add(key);
            out.push({ order: order.id, ...due });
            ui.notifications.info("pf2e-artisans-workshop.Variant.Grow.SeasonDue", { format: { actor: crafter.name, item: order.product?.snapshot?.name ?? "" } });
        }
    }
    return out;
}

/**
 * Roll a Grow order's season check (6.16.6): the order's skill against its DC, linked `<MOD>:season:<orderId>:<n>`, which
 * the roll wrapper records as a `season` variant record (`recordSeasonCheck`). The crafter's owner. Refused: `variant-off`,
 * `not-owner`, `not-due`, `no-skill`, `cancelled`.
 */
export async function rollSeason(orderId, season = null, { skipDialog } = {}) {
    if (!variantOn("grow")) return refuse("variant-off");
    const order = read(`orders.${orderId}`);
    const crafter = actorOf(order?.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    const due = seasonChecksDue(order).find((d) => season === null || d.season === season);
    if (!due) return refuse("not-due");
    const statistic = crafter.skills?.[order.skill ?? "crafting"];
    if (!statistic) return refuse("no-skill", { skill: order.skill });
    const roll = await statistic.roll({
        dc: { value: order.dc.final, label: game.i18n.localize("pf2e-artisans-workshop.Roll.CraftDC") },
        extraRollOptions: ["action:craft", "action:grow", seasonLink(orderId, due.season)], traits: ["downtime"],
        label: game.i18n.format("pf2e-artisans-workshop.Variant.Grow.SeasonRoll", { item: order.product?.snapshot?.name ?? "" }),
        skipDialog, createMessage: true,
    });
    return roll ? { ok: true, total: roll.total, season: due.season } : refuse("cancelled");
}

/**
 * Record a season check from its message (6.16.6): a `season` variant record keyed `days.<actorId>-<endDay>-<orderId>`, so it
 * never overwrites the crafter's own day record for the downtime they spent on something else, once per season (a lock page
 * `season:<orderId>:<n>`). Its reduction is one day of Income at the degree. A reroll of the same message replaces it.
 */
export async function recordSeasonCheck({ id: orderId, season }, check, actor) {
    const order = read(`orders.${orderId}`);
    if (!order || closedAs(order)) return refuse("no-order");
    const crafter = actor ?? actorOf(order.crafter);
    if (!crafter) return refuse("no-crafter");
    const due = seasonChecksDue(order).find((d) => d.season === season);
    const existing = records("days").find((d) => d.order === orderId && d.attempt === order.attempt && d.kind === "season" && d.season === season);
    if (!due && !(existing && check.rerolled)) return refuse("not-due");
    const endDay = due?.endDay ?? existing.day;
    const record = seasonRecord({ actorId: crafter.id, order, season, endDay, degree: check.degree, level: crafter.level ?? 0,
        rank: crafter.skills?.[order.skill ?? "crafting"]?.rank ?? 0, messageId: check.messageId ?? null }, stampNow());
    if (existing) {
        await write({ replace: { [`days.${record.id}`]: record } });
        return { ok: true, record };
    }
    const written = await lockedWrite([hashId(seasonKey(orderId, season))], [], { replace: { [`days.${record.id}`]: record } });
    return written.ok ? { ok: true, record } : written;
}

/* -------------------------------------------- */
/*  Gardens of Wonder (6.16.7)                   */
/* -------------------------------------------- */

/** The party's gardens (6.16.7). */
export function gardensOf(party = game.actors?.party?.id ?? null) {
    return records("gardens").filter((g) => party === null || g.party === party || g.party === null);
}

/** What a garden holds toward its seed cost: every contributor's remaining allocation. */
export function gardenFunds(gardenId) {
    const rows = records("rows").filter((row) => row.garden === gardenId);
    const allocations = allocationsByContributor(rows);
    return { allocations, heldCp: allocations.reduce((sum, a) => sum + a.cp, 0) };
}

/**
 * Add a garden (6.16.7): its name, kind (free text: an orchard, a bakery, an ooze farm) and the consumable it makes, at
 * the seed cost of GM Core p.133. Any member with a character. At most half the party's PCs (rounded down) in gardens:
 * refused as `garden-limit` when the party is at it (a rule, not a GM gate). Refused also: `off`, `not-member`,
 * `no-product`, `not-consumable`.
 */
export async function addGarden({ name = "", kind = "", uuid }) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("gardens")) return refuse("variant-off");
    const pcs = members();
    if (!game.user.isGM && !pcs.some((a) => a.isOwner)) return refuse("not-member");
    const product = await productFacts(uuid);
    if (!product) return refuse("no-product");
    if (!product.traits.includes("consumable")) return refuse("not-consumable");
    const party = game.actors?.party?.id ?? null;
    const room = gardenRoom(gardensOf(party), pcs.length, party);
    if (!room.ok) return room;
    const garden = makeGarden({ id: newId(), party, name: name || product.name, kind, product: { uuid, level: product.level, name: product.name, img: product.img } },
        stampNow());
    await write({ set: { [`gardens.${garden.id}`]: garden } });
    return { ok: true, garden: garden.id, seedCostCp: garden.seedCostCp };
}

/**
 * Fund a garden (6.16.7) as an order is funded (M4.1): from a character's purse (a `pledge` with `garden` set, the coins
 * into the strongbox) or from the party fund (an `allocate` pair, no coins move, behind the fund slot). Earn Income wages
 * are pledged like any other coins. Refused: `variant-off`, `no-garden`, `planted`, `nothing`, `fund-short`, the coin move's.
 */
export async function fundGarden(gardenId, { source, actor = null, cp }) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("gardens")) return refuse("variant-off");
    const garden = read(`gardens.${gardenId}`);
    if (!garden) return refuse("no-garden");
    if (Number.isInteger(garden.plantedDay)) return refuse("planted");
    if (!(Number.isSafeInteger(cp) && cp > 0)) return refuse("nothing");
    if (source === "purse") {
        const who = actorOf(actor);
        if (!who?.isOwner) return refuse("not-owner");
        return pledge({ actor: who, cp, garden: gardenId, nonce: newId() });
    }
    if (source !== "fund") return refuse("other");
    const rows = records("rows");
    const available = unallocatedCp(rows);
    if (cp > available) return refuse("fund-short", { maxCp: Math.max(0, available) });
    const inputs = earmarkInputs({ orderId: gardenId, cp, nonce: newId() }).map((row) => (row.order ? { ...row, order: null, garden: gardenId } : row));
    return lockedWrite([fundSlotLockId(rows)], inputs);
}

/**
 * Plant a garden whose allocation reached its seed cost (6.16.7): one lock-first move (5.4) with the lock page of
 * `plant:<gardenId>`, the `plant` rows (pro rata per contributor) and the strongbox coins they spend, and `plantedDay`. Two
 * pledges that complete the cost together may both call this; the second stops at the lock. Refused: `variant-off`, `no-garden`,
 * `planted`, `underfunded`.
 */
export async function plantGarden(gardenId) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("gardens")) return refuse("variant-off");
    const garden = read(`gardens.${gardenId}`);
    if (!garden) return refuse("no-garden");
    if (Number.isInteger(garden.plantedDay)) return { ok: true, outcome: "already" };
    const { allocations, heldCp } = gardenFunds(gardenId);
    if (heldCp < garden.seedCostCp) return refuse("underfunded", { shortCp: garden.seedCostCp - heldCp });
    const key = plantKey(gardenId);
    if (exists(`rows.${hashId(`${key}:${allocations[0]?.actor ?? "fund"}`)}`)) return { ok: true, outcome: "already" };
    const day = today().day;
    return spend({ kind: "plant", stem: key, cp: garden.seedCostCp, allocations, link: { garden: gardenId, day },
        ledger: { set: { [`gardens.${gardenId}.plantedDay`]: day, [`gardens.${gardenId}.planted`]: stampNow() } }, locks: [hashId(key)] });
}

/**
 * Plant every funded garden this client is responsible for (6.16.7): the shared writes caused by `userId`'s change (the
 * responsible client for that change, 5.6), or with no user named the elected client's catch-up.
 */
export async function plantFunded(userId = null) {
    if (!canWrite() || !variantOn("gardens")) return 0;
    if (userId ? !isResponsibleForShared(userId) : !isElected()) return 0;
    let planted = 0;
    for (const garden of records("gardens")) {
        if (Number.isInteger(garden.plantedDay)) continue;
        if (gardenFunds(garden.id).heldCp < garden.seedCostCp) continue;
        const result = await plantGarden(garden.id);
        if (result.ok && result.outcome === "ok") planted += 1;
    }
    return planted;
}

/** Whether a garden was harvested on a workshop day. */
export const harvestedOn = (garden, day) => !!garden?.harvests?.[day];

/**
 * Harvest a garden for a character (6.16.7): one item a workshop day per garden, created on the harvester's own character
 * by their own client, temporary, with a `world` expiry stamp ending that day (no preservation applies: TV-R p.167), behind
 * the lock page `harvest:<gardenId>:<day>`, so a day's produce is created once even when two members harvest at the same
 * moment. Refused: `variant-off`, `no-garden`, `not-planted`, `not-owner`, `harvested`, `no-product`, `taken`.
 */
export async function harvest(gardenId, actorUuid) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("gardens")) return refuse("variant-off");
    const garden = read(`gardens.${gardenId}`);
    if (!garden) return refuse("no-garden");
    if (!Number.isInteger(garden.plantedDay)) return refuse("not-planted");
    const actor = actorOf(actorUuid);
    if (!actor?.isOwner) return refuse("not-owner");
    const day = today().day;
    if (day < garden.plantedDay) return refuse("not-planted");
    if (harvestedOn(garden, day)) return refuse("harvested");
    const doc = await fromUuid(garden.product.uuid);
    if (!doc) return refuse("no-product");
    const source = doc.toObject();
    delete source._id;
    source.system = { ...source.system, quantity: 1, temporary: true };
    foundry.utils.setProperty(source, "_stats.compendiumSource", garden.product.uuid);
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.expiry`, produceStamp({ creator: actor.uuid, day, secondsPerDay: secondsPerDay(), offset: dayOffset(),
        garden: gardenId }));
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.produce`, { garden: gardenId, day });
    const result = await runRequest([
        { op: "lock", ids: [hashId(harvestKey(gardenId, day))] },
        { op: "createItems", target: actor.uuid, data: [source] },
        { op: "ledger", change: { set: { [`gardens.${gardenId}.harvests.${day}`]: { actor: actor.uuid, ...stampNow() } } } },
    ]);
    if (result.outcome === "refused") return refuse("harvested");
    if (result.outcome !== "ok") return refuse(result.reason ?? "error", { outcome: result.outcome });
    await postHarvest(garden, actor);
    return { ok: true, day };
}

/** The garden harvest card (10.5). */
async function postHarvest(garden, actor) {
    try {
        const content = await foundry.applications.handlebars.renderTemplate("modules/pf2e-artisans-workshop/templates/chat/morning.hbs", {
            kind: "harvest", heading: game.i18n.localize("pf2e-artisans-workshop.Variant.Garden.Card.Heading"), img: garden.product?.img ?? null,
            summary: game.i18n.format("pf2e-artisans-workshop.Variant.Garden.Card.Summary", { actor: actor.name, item: garden.product?.name ?? "", garden: garden.name }),
            lines: [], notes: [],
        });
        await ChatMessage.implementation.create({ content, whisper: whisperTo([actor.uuid]), speaker: ChatMessage.implementation.getSpeaker({ actor }),
            flags: { [MODULE_ID]: { card: { kind: "harvest", order: null } } } });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post a harvest card`, error);
    }
}

/**
 * Remove a garden (6.16.7) that is not planted and holds nothing: any member, or a GM. Refused: `variant-off`, `no-garden`,
 * `planted`, `funded` (give the money back first).
 */
export async function removeGarden(gardenId) {
    if (!canWrite()) return refuse("not-ready");
    if (!variantOn("gardens")) return refuse("variant-off");
    const garden = read(`gardens.${gardenId}`);
    if (!garden) return refuse("no-garden");
    if (Number.isInteger(garden.plantedDay)) return refuse("planted");
    if (gardenFunds(gardenId).heldCp > 0) return refuse("funded");
    await write({ del: [`gardens.${gardenId}`] });
    return { ok: true };
}

/**
 * The nature hooks, at `init`: a ledger change that adds garden rows plants a garden it funded fully, on the client
 * responsible for that change. Grow's season prompts and the elected client's plantings run in the variants' catch-up.
 */
export function registerNatureHooks() {
    Hooks.on("updateJournalEntry", (doc, changed, _options, userId) => {
        if (doc !== shared().ledger || !variantOn("gardens")) return;
        const rows = changed.flags?.[MODULE_ID]?.rows;
        if (!rows || !Object.values(rows).some((row) => row && typeof row === "object" && row.garden)) return;
        plantFunded(userId).catch((error) => console.warn(`${MODULE_ID} | could not plant a garden`, error));
    });
    registerVariantSweep("seasons", () => seasonSweep().length);
    registerVariantSweep("gardens", () => plantFunded());
}

/** For tests only. */
export function resetNature() {
    prompted.clear();
}
