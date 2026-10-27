/**
 * The roll wrapper (DESIGN.md 6.12) and the Earn Income roll (6.10): orders and jobs roll their own checks through
 * the system's Statistic, and the chat message the roll creates is what records them.
 *
 * Rolling. A Craft check goes through `actor.skills[skill].roll` with an explicit DC (the system macro drops the
 * rarity adjustment), `action:craft`, the product's roll options from an unsaved copy of the product owned by the
 * crafter (so gear and feats predicated on the item fire), the registry's options and modifiers, and the order's
 * link option `<MOD>:order:<id>:<attempt>`. An Earn Income check adds `action:earn-income` (so Experienced
 * Professional, the Tradecraft Tattoo and the Earn Income gear fire) and `<MOD>:job:<id>:<round>` (M6). A Communal
 * Crafting helper's check (M6) is linked as `<MOD>:help:<orderId>:<actorId>`. The pure parts are in
 * `scripts/logic/rolls.mjs`.
 *
 * Recording. `createChatMessage` fires on every client; the message's author records it, in the tab that holds that
 * user's lease (5.6), first rolls and rerolls alike: pf2e lets the author or a GM reroll, and a reroll's new message
 * belongs to the rerolling user and keeps only `flags.pf2e`, where the link option survives. A Craft check goes
 * through M1's `recordCheck` (a reroll before settlement replaces the check; one after it is kept as a conflict for
 * the card; one for an earlier attempt is refused as stale), an Earn Income check through `jobCheckPatch`, a helper's
 * through `helperCheckPatch`.
 *
 * Settling a Craft check posts its money rows through M2's coin moves (`settleOrder`), and an Earn Income day is paid
 * once however often it is resolved (`payWage`): the earner's responsible client mints the wage, anyone else files a
 * wage claim, and both share the row's lock.
 */
import { MODULE_ID } from "../constants.mjs";
import { helperCheckPatch } from "../logic/communal.mjs";
import { liveRows } from "../logic/core.mjs";
import { committedFromRows, hasSettlementRows, recordCheck, settleCheck } from "../logic/craft.mjs";
import { DEGREE } from "../logic/core.mjs";
import { lineValueCp, materialLines } from "../logic/materials.mjs";
import { componentsRuinCp, criticalRecord, moneyDegree, secretRoll } from "../logic/variants.mjs";
import { wageDaysOf } from "../logic/downtime.mjs";
import { wageKey, wageSeq } from "../logic/earn-income.mjs";
import { returnSlotLockId } from "../logic/funds.mjs";
import { hashId } from "../logic/ids.mjs";
import { earnIncomeFlags } from "../logic/registry.mjs";
import {
    checkFromContext, craftDegree, craftRollPlan, earnIncomeRollPlan, guardCheck, helpLink, jobCheckPatch, parseLink,
} from "../logic/rolls.mjs";
import { closedAs, settlementRecord, transitionChange } from "../logic/orders.mjs";
import { makeRow, seqFor } from "../logic/rows.mjs";
import { allocationsByContributor, splitProRata } from "../logic/split.mjs";
import { createClaims } from "./claims.mjs";
import { holdsLease } from "./lease.mjs";
import { lockedWrite, mint, spend } from "./money.mjs";
import { rememberReroll } from "./orders.mjs";
import { featKeysOf, heldKeysOf, ranksOf } from "./registry.mjs";
import { isResponsibleFor } from "./responsible.mjs";
import { rulesFromSettings } from "./settings.mjs";
import { canWrite } from "./state.mjs";
import { settleDeconstruct } from "./deconstruct.mjs";
import { recordSeasonCheck } from "./nature.mjs";
import { settleQuest } from "./quests.mjs";
import { liftCurse } from "./variants.mjs";
import { exists, read, records, stampNow, write } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });

/** The ledger rows of one order (`order`) or job (`job`). */
const rowsOf = (field, id) => records("rows").filter((row) => row[field] === id);

/** A character's statistic for a skill slug: Crafting, a registry substitute, or a Lore (`cooking-lore`). */
const statisticOf = (actor, slug) => actor?.skills?.[slug] ?? null;

/** Registry modifiers as pf2e modifiers, each labelled with the name of the compendium item it comes from. */
function pf2eModifiers(list) {
    return Promise.all(list.map(async (m) => new game.pf2e.Modifier({
        slug: m.slug, label: (await fromUuid(m.uuid))?.name ?? m.slug, modifier: m.value, type: m.type,
    })));
}

/* -------------------------------------------- */
/*  Rolling                                      */
/* -------------------------------------------- */

/**
 * Roll the Craft check of an order in `check` for its crafter (6.12). The roll records itself when its message is
 * created. Refused: `no-order`, `state`, `not-owner` (this user may not roll for the crafter), `no-skill`,
 * `no-product`, `cancelled` (the dialog was closed). Without `skipDialog`, pf2e shows its check dialog as the user's
 * own "show check dialogs" setting says.
 * @returns {Promise<{ok: boolean, reason?: string, total?: number}>}
 */
export async function rollCraft(orderId, { skipDialog } = {}) {
    const order = read(`orders.${orderId}`);
    if (!order) return refuse("no-order");
    const status = closedAs(order) ?? order.status;
    if (status !== "check") return refuse("state", { status });
    const crafter = fromUuidSync(order.crafter);
    if (!crafter?.isOwner) return refuse("not-owner");
    const statistic = statisticOf(crafter, order.skill ?? "crafting");
    if (!statistic) return refuse("no-skill", { skill: order.skill });
    const product = await fromUuid(order.product?.uuid);
    if (!product) return refuse("no-product");
    // An unsaved copy owned by the crafter, so its roll options are those of the item in the crafter's hands (OQ-2).
    // It is not passed as `item`: a bomb passed that way becomes the context item for weapon targeting.
    const item = new CONFIG.Item.documentClass(product.toObject(), { parent: crafter });
    const rules = rulesFromSettings();
    const plan = craftRollPlan({ item: item.getRollOptions("item"), held: heldKeysOf(crafter), ranks: ranksOf(crafter), order }, rules);
    // M9a (6.16.4): Critical Crafting's secret checks are rolled blind while a GM is connected to see them (P2).
    const secret = secretRoll(order, rules, !!game.users.activeGM);
    const roll = await statistic.roll({
        ...(secret ? { rollMode: "blindroll" } : {}),
        dc: { value: order.dc.final, label: game.i18n.localize("pf2e-artisans-workshop.Roll.CraftDC") },
        extraRollOptions: plan.options,
        modifiers: await pf2eModifiers(plan.modifiers),
        traits: ["downtime", "manipulate"],
        label: game.i18n.format("pf2e-artisans-workshop.Roll.Craft", { item: item.name }),
        skipDialog,
        createMessage: true,
    });
    return roll ? { ok: true, total: roll.total } : refuse("cancelled");
}

/**
 * Roll the Earn Income check of an open job that has none yet (6.10). Refused: `no-job`, `state`, `rolled`,
 * `not-owner`, `no-skill`, `cancelled`.
 */
export async function rollEarnIncome(jobId, { skipDialog } = {}) {
    const job = read(`jobs.${jobId}`);
    if (!job) return refuse("no-job");
    if (job.status !== "open") return refuse("state", { status: job.status });
    if (job.check) return refuse("rolled");
    const earner = fromUuidSync(job.actor);
    if (!earner?.isOwner) return refuse("not-owner");
    const statistic = statisticOf(earner, job.skill);
    if (!statistic) return refuse("no-skill", { skill: job.skill });
    const roll = await statistic.roll({
        dc: { value: job.dc, label: game.i18n.localize("pf2e-artisans-workshop.Roll.EarnIncomeDC") },
        extraRollOptions: earnIncomeRollPlan(job.id, job.round ?? 1).options,
        traits: ["downtime"],
        label: game.i18n.format("pf2e-artisans-workshop.Roll.EarnIncome", { skill: statistic.label }),
        skipDialog,
        createMessage: true,
    });
    return roll ? { ok: true, total: roll.total } : refuse("cancelled");
}

/**
 * Roll a Communal Crafting helper's check (6.7, M6): the skill the helper joined with, against the item's Craft DC (the
 * order's frozen DC, `rules.communal.helperDc` "item"), as a downtime check linked to the helper's entry. It records
 * itself when its message is created. Refused: `no-order`, `not-helping`, `state` (the order has no DC yet: it has not
 * started), `not-owner`, `no-skill`, `cancelled`.
 */
export async function rollHelper(orderId, actorUuid, { skipDialog } = {}) {
    const order = read(`orders.${orderId}`);
    if (!order) return refuse("no-order");
    const actor = fromUuidSync(actorUuid);
    const helper = actor ? order.helpers?.[actor.id] : null;
    if (!helper || helper.leftDay != null) return refuse("not-helping");
    if (closedAs(order) || !order.dc?.final) return refuse("state", { status: closedAs(order) ?? order.status });
    if (!actor.isOwner) return refuse("not-owner");
    const statistic = statisticOf(actor, helper.skill);
    if (!statistic) return refuse("no-skill", { skill: helper.skill });
    const roll = await statistic.roll({
        dc: { value: order.dc.final, label: game.i18n.localize("pf2e-artisans-workshop.Roll.HelperDC") },
        extraRollOptions: [helpLink(orderId, actor.id)],
        traits: ["downtime"],
        label: game.i18n.format("pf2e-artisans-workshop.Roll.Helper", { item: order.product?.snapshot?.name ?? "" }),
        skipDialog,
        createMessage: true,
    });
    return roll ? { ok: true, total: roll.total } : refuse("cancelled");
}

/* -------------------------------------------- */
/*  Recording                                    */
/* -------------------------------------------- */

/** `createChatMessage`, on every client. */
export function registerRollHooks() {
    Hooks.on("createChatMessage", (message) => {
        onCheckMessage(message).catch((error) => console.error(`${MODULE_ID} | could not record a check`, error));
    });
}

/**
 * Record the check of a chat message that links to an order or a job, if this tab is the one to do it: the message's
 * author's tab that holds the lease. Returns null for a message that is not this tab's to record.
 */
export async function onCheckMessage(message) {
    const context = message.flags?.pf2e?.context;
    const link = parseLink(context?.options);
    if (!link || message.author?.id !== game.user.id || !holdsLease()) return null;
    if (!canWrite()) return refuse("not-ready");
    const roll = message.rolls?.[0];
    const die = roll?.dice?.find((term) => term.faces === 20)?.total ?? null;
    const parsed = checkFromContext(context, { total: roll?.total, die });
    if (!parsed.ok) {
        console.warn(`${MODULE_ID} | a check for ${link.kind} ${link.id} was not recorded: ${parsed.reason}`);
        return parsed;
    }
    const guarded = guardCheck(parsed.check, rulesFromSettings());
    if (!guarded.ok) {
        ui.notifications.warn("pf2e-artisans-workshop.Roll.FortuneBlocked", { localize: true });
        return guarded;
    }
    // M9a (6.16.4): a blind roll is a secret check, hidden from players until it settles.
    const check = { ...guarded.check, messageId: message.id, ...(message.blind === true ? { secret: true } : {}) };
    if (link.kind === "order") return recordOrderCheck(link, check, message.actor, context.options ?? []);
    if (link.kind === "help") return recordHelperCheck(link, check, message.actor);
    if (link.kind === "season") return recordSeasonCheck(link, check, message.actor);
    return recordJobCheck(link, check, message.actor);
}

/**
 * Record a Communal Crafting helper's check on their entry (6.7, M6): the degree, and the level and rank at the roll,
 * which their rate uses; a reroll replaces it (`helperCheckPatch`). Each helper writes only their own entry (4.2.4).
 */
async function recordHelperCheck({ id, actor: actorId }, check, actor) {
    const order = read(`orders.${id}`);
    if (!order) return refuse("no-order");
    if (closedAs(order)) return refuse("state", { status: closedAs(order) });
    const helperActor = actor?.id === actorId ? actor : game.actors.get(actorId);
    const skill = order.helpers?.[actorId]?.skill ?? "crafting";
    const result = helperCheckPatch(order, actorId, check, { level: helperActor?.level ?? 0, rank: statisticOf(helperActor, skill)?.rank ?? 0 });
    if (!result.ok) {
        if (result.reason === "rolled") ui.notifications.warn("pf2e-artisans-workshop.Roll.AlreadyRolled", { localize: true });
        return result;
    }
    const base = `orders.${id}.helpers.${actorId}`;
    await write({ replace: { [`${base}.check`]: result.patch.check },
        set: { [`${base}.degree`]: result.patch.degree, [`${base}.level`]: result.patch.level, [`${base}.rank`]: result.patch.rank } });
    return { ok: true, check: result.patch.check };
}

/**
 * Record a Craft check on its order (6.12, 4.2.3): the degree after the registry's shifts that the roll selected
 * (Impeccable Crafting), the crafter's level and rank now, the attempt the roll was made for. A check refused as
 * `settled` is kept on the order as `conflict` for the card (the crafter undoes the settlement to use it); an attempt
 * whose settlement rows exist counts as settled even if a late write cleared its `settled` flag. A second
 * roll that is not a reroll (`rolled`) is kept nowhere, since nothing may use it, and the roller is told.
 */
async function recordOrderCheck({ id, attempt }, check, actor, options) {
    const order = read(`orders.${id}`);
    if (!order) return refuse("no-order");
    // A closed order records nothing, whatever a late write left in its status (`closedAs`, As built in M4).
    if (closedAs(order)) return refuse("state", { status: closedAs(order) });
    const crafter = actor ?? fromUuidSync(order.crafter);
    if (!crafter) return refuse("no-crafter");
    const degree = craftDegree(heldKeysOf(crafter), options, check.degree, rulesFromSettings());
    const full = {
        ...check, degree, shifted: degree !== check.degree, attempt,
        level: crafter.level, rank: statisticOf(crafter, order.skill ?? "crafting")?.rank ?? 0,
    };
    // A settlement record for this attempt (As built in M4) counts as settled too, whatever the check's flag says now.
    const settledRows = hasSettlementRows(rowsOf("order", id), id, attempt) || order.settlement?.attempt === attempt;
    const result = recordCheck(order, full, { settledRows });
    if (!result.ok) {
        if (result.reason === "settled") await write({ replace: { [`orders.${id}.conflict`]: { ...full, ...stampNow() } } });
        if (result.reason === "rolled") ui.notifications.warn("pf2e-artisans-workshop.Roll.AlreadyRolled", { localize: true });
        return result;
    }
    // A reroll writes the check alone: the order is in `rolled` already, and a status written from a copy that has not
    // seen a settlement yet would undo the settlement's state. The check it may overwrite is repaired from the
    // settlement record (`rememberReroll`, `scripts/foundry/orders.mjs`).
    const reroll = !!order.check;
    await write({ replace: { [`orders.${id}.check`]: result.patch.check }, set: reroll ? {} : { [`orders.${id}.status`]: result.patch.status } });
    if (reroll) await rememberReroll(id, result.patch.check);
    // M9a (6.16.4): a critical success at a Craft check lifts the crafter's curse.
    if (degree === DEGREE.critSuccess && order.craftType !== "deconstruct" && order.craftType !== "quest") await liftCurse(crafter);
    return { ok: true, check: result.patch.check };
}

/**
 * Record an Earn Income check on its job (6.10): the check, the pay per day and the status after the roll. A reroll
 * refused because a wage was already paid (or a wage claim filed, M6) at the earlier rate is kept on the job as
 * `conflict`, as for an order; a roll for an earlier round of the job (`rerollJob`, M6) is refused as stale.
 */
async function recordJobCheck({ id: jobId, round }, check, actor) {
    const job = read(`jobs.${jobId}`);
    if (!job) return refuse("no-job");
    const earner = actor ?? fromUuidSync(job.actor);
    if (!earner) return refuse("no-earner");
    const earnerAtRoll = {
        level: earner.level, rank: statisticOf(earner, job.skill)?.rank ?? 0,
        experiencedProfessional: earnIncomeFlags(featKeysOf(earner)).experiencedProfessional,
    };
    const promised = wageDaysOf(liveRows(rowsOf("job", jobId)), records("claims"), jobId).size;
    const result = jobCheckPatch(job, check, earnerAtRoll, promised, round ?? 1);
    if (!result.ok) {
        if (result.reason === "paid") await write({ replace: { [`jobs.${jobId}.conflict`]: { ...check, ...stampNow() } } });
        const second = result.reason === "rolled" && job.check?.messageId !== check.messageId;
        if (second) ui.notifications.warn("pf2e-artisans-workshop.Roll.AlreadyRolled", { localize: true });
        return result;
    }
    const { check: stored, ...fields } = result.patch;
    await write({
        replace: { [`jobs.${jobId}.check`]: stored },
        set: Object.fromEntries(Object.entries(fields).map(([key, value]) => [`jobs.${jobId}.${key}`, value])),
    });
    return { ok: true, check: stored, perDayCp: fields.perDayCp };
}

/* -------------------------------------------- */
/*  Settling and paying                          */
/* -------------------------------------------- */

/**
 * Settle an order's recorded check (4.2.3, 6.2.3) and post its money rows in the same request as the order's new
 * state: on a success the committed materials are spent out of the strongbox (`expend`, pro rata by contributor);
 * a failure releases them (`release`, bookkeeping); a critical failure spends 10% (`ruin`) and releases the rest.
 * Row keys carry the attempt and a correction sequence (`<kind>:<orderId>:<attempt>:<seq>`), so settling twice
 * posts nothing twice. The same request writes the transition log entry (undo reverses its rows) and the settlement
 * record (`orders.<id>.settlement`, As built in M4), which a reroll never writes, and takes the order's log slot like
 * every transition. Refusals come from `settleCheck`, a closed order ("state"), an escrow smaller than the spend
 * ("underfunded") or the coin move ("conflict" when another transition took the slot first).
 */
export async function settleOrder(orderId) {
    if (!canWrite()) return refuse("not-ready");
    const stored = read(`orders.${orderId}`);
    if (!stored) return refuse("no-order");
    if (closedAs(stored)) return refuse("state", { status: closedAs(stored) });
    // M9a (6.16.5, 6.16.9): a Deconstruct and a quest settle through their own rows of 4.2.3, with no money.
    if (stored.craftType === "deconstruct") return settleDeconstruct(stored);
    if (stored.craftType === "quest") return settleQuest(stored);
    // M9a (6.16.4): a check that triggers Critical Crafting is stamped with its record (and the mode the setting has now),
    // which decides the money effect from here on.
    const rules = rulesFromSettings();
    const critical = stored.status === "rolled" && stored.check && !stored.check.settled ? criticalRecord(stored.check, stored, rules, stampNow()) : null;
    const order = critical ? { ...stored, check: { ...stored.check, critical } } : stored;
    const rows = rowsOf("order", orderId);
    const alchemical = (order.product?.snapshot?.traits ?? []).includes("alchemical");
    const result = settleCheck(order, { committedCp: committedFromRows(rows), alchemical });
    if (!result.ok) return result;
    const { check, ...fields } = result.patch;
    const stem = (kind) => `${kind}:${orderId}:${order.attempt}`;
    const keyed = (kind) => `${stem(kind)}:${seqFor(rows, stem(kind))}`;
    const stamp = stampNow();
    const releases = result.rows.filter((row) => row.kind === "release")
        .map((row) => ({ ...makeRow({ kind: "release", idem: keyed("release"), cp: row.cp, order: orderId }, stamp), state: "applied" }));
    const spent = result.rows.find((row) => row.kind === "expend" || row.kind === "ruin");
    const allocations = allocationsByContributor(rows);
    const held = allocations.reduce((sum, a) => sum + a.cp, 0);
    if (spent && spent.cp > held) return refuse("underfunded", { shortCp: spent.cp - held });
    // The ids of the spend's rows follow from the allocations, as `spend` splits them, so the record can name them.
    const spendIds = spent
        ? splitProRata(spent.cp, allocations.map((a) => ({ key: a.actor, cp: a.cp }))).filter((share) => share.cp > 0)
            .map((share) => hashId(`${keyed(spent.kind)}:${share.key ?? "fund"}`))
        : [];
    const rowIds = [...spendIds, ...releases.map((row) => row.id)];
    // The settlement record (As built in M4) freezes what was settled, so a reroll that lands later cannot change it.
    const settlement = settlementRecord(order, result.patch, rowIds, stamp);
    const change = transitionChange(order, "settle", { check, status: fields.status, settlement }, { rows: rowIds }, stamp);
    const ledger = { replace: change.replace, set: { ...change.set, ...Object.fromEntries(releases.map((row) => [`rows.${row.id}`, row])) } };
    // M9a (6.16.5): a critical failure ruins 10% of a components line too, with the rest of the materials (unless Critical
    // Crafting's `replace` took the money effect's place).
    if (fields.status === "failed" && moneyDegree(check) === DEGREE.critFail) {
        for (const line of materialLines(order).filter((l) => l.components)) {
            ledger.set[`orders.${orderId}.materials.${line.id}.ruinedCp`] = (order.materials?.[line.id]?.ruinedCp ?? 0) + componentsRuinCp(lineValueCp(line, order));
        }
    }
    // The log slot, and the return slot: a give-back or take-back planned from the same copy would change the shares.
    const locks = [change.lock, returnSlotLockId(order, rows)];
    if (!spent) {
        const written = await lockedWrite(locks, [], ledger);
        return written.ok ? { ok: true, outcome: "ok", status: fields.status, notices: result.notices } : written;
    }
    const moved = await spend({ kind: spent.kind, stem: keyed(spent.kind), cp: spent.cp, allocations, link: { order: orderId }, ledger, locks });
    return { ...moved, status: fields.status, notices: result.notices };
}

/**
 * Pay one day of an Earn Income job (4.9, 6.10), once however often the day is resolved: a `wage` row keyed
 * `wage:<jobId>:<day>:<seq>`. The earner's responsible client mints it into the purse; any other client files a
 * wage claim with the same key, which that client applies; both take the row's lock, so a day resolved twice, or by
 * two clients at once, pays once. `cp` is the day's wage as its day record has it (M6), the job's pay per day by
 * default. Refused: `not-ready`, `no-job`, `unrolled`, `nothing` (the day pays nothing), `no-earner`.
 * @returns {Promise<{ok: boolean, outcome?: string, reason?: string}>}  outcome "ok", "already" or "claimed"
 */
export async function payWage(jobId, day, { cp = null } = {}) {
    if (!canWrite()) return refuse("not-ready");
    const job = read(`jobs.${jobId}`);
    if (!job) return refuse("no-job");
    if (!job.check) return refuse("unrolled");
    const pay = cp ?? job.perDayCp;
    if (!(pay > 0)) return refuse("nothing");
    const earner = fromUuidSync(job.actor);
    if (!earner) return refuse("no-earner");
    const idem = wageKey(jobId, day, wageSeq(rowsOf("job", jobId), jobId, day));
    if (exists(`rows.${hashId(idem)}`)) return { ok: true, outcome: "already" };
    const row = { kind: "wage", idem, cp: pay, actor: job.actor, job: jobId, day };
    if (isResponsibleFor(earner)) return mint({ actor: earner, row });
    const created = await createClaims([{ kind: "wage", idem, actor: job.actor, cp: pay, job: jobId, day, parties: [job.actor] }]);
    return { ok: true, outcome: created.length ? "claimed" : "already" };
}
