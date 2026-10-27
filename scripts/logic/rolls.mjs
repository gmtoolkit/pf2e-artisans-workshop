/**
 * The pure parts of the roll wrapper (DESIGN.md 6.12) and of the Earn Income roll (6.10): the options a Craft or an
 * Earn Income check is rolled with, the link option that ties a chat message back to its order or job, and the
 * check record read from a message's `flags.pf2e.context`. `scripts/foundry/rolls.mjs` makes the rolls and writes
 * the records.
 */
import { DEGREE, DEGREE_FROM_OUTCOME, requireInteger } from "./core.mjs";
import { downtimeCheckGuard, jobAfterRoll, wagePerDay } from "./earn-income.mjs";
import { craftOptions, modifiers, rollOptions, shiftDegree } from "./registry.mjs";
import { DEFAULT_RULES } from "./defaults.mjs";

/**
 * The prefix of the link options: the module id (`scripts/constants.mjs`, which this folder may not import; a test
 * keeps the two equal). Ids are 16 lowercase letters and digits (4.1), so they never contain the separator.
 */
export const LINK_PREFIX = "pf2e-artisans-workshop";

/** The link option of an order's Craft check: `<MOD>:order:<orderId>:<attempt>` (6.12). */
export function orderLink(orderId, attempt) {
    return `${LINK_PREFIX}:order:${orderId}:${requireInteger(attempt, "attempt")}`;
}

/**
 * The link option of an Earn Income job's check: `<MOD>:job:<jobId>:<round>` (M6). `round` counts the job's rolls: a
 * resumed job rolled again after a level or rank change (6.10) is a new round, so a reroll of the earlier round's message
 * is refused as stale, as an order's earlier attempt is.
 */
export function jobLink(jobId, round = 1) {
    return `${LINK_PREFIX}:job:${jobId}:${requireInteger(round, "round")}`;
}

/** The link option of a Communal Crafting helper's check (6.7, M6): `<MOD>:help:<orderId>:<actorId>`. */
export function helpLink(orderId, actorId) {
    return `${LINK_PREFIX}:help:${orderId}:${actorId}`;
}

/** The link option of a Grow order's season check (M9a, 6.16.6): `<MOD>:season:<orderId>:<season>`. */
export function seasonLink(orderId, season) {
    return `${LINK_PREFIX}:season:${orderId}:${requireInteger(season, "season")}`;
}

/** The link option of an extension activity's run check (M10, 12.2): `<MOD>:ext:<runId>`. */
export function extLink(runId) {
    return `${LINK_PREFIX}:ext:${runId}`;
}

/**
 * The order, job or helper a check's roll options link to, or null: `{kind: "order", id, attempt}`, `{kind: "job", id,
 * round}` (round 1 for a link written before M6, which had none), `{kind: "help", id, actor}`, (M9a) `{kind: "season",
 * id, season}` or (M10) `{kind: "ext", id}`, an extension activity's run. The first link wins; a roll carries one.
 */
export function parseLink(options = []) {
    for (const option of options) {
        if (typeof option !== "string" || !option.startsWith(`${LINK_PREFIX}:`)) continue;
        const [kind, id, third] = option.slice(LINK_PREFIX.length + 1).split(":");
        if (kind === "order" && id && /^\d+$/.test(third ?? "")) return { kind, id, attempt: Number(third) };
        if (kind === "job" && id && (third === undefined || /^\d+$/.test(third))) return { kind, id, round: third === undefined ? 1 : Number(third) };
        if (kind === "help" && id && third) return { kind, id, actor: third };
        if (kind === "season" && id && /^\d+$/.test(third ?? "")) return { kind, id, season: Number(third) };
        if (kind === "ext" && id && third === undefined) return { kind, id };
    }
    return null;
}

/**
 * Options the activity itself sets, beyond `action:craft`: the actions whose own rule elements the system
 * predicates on (the inventor's Reverse Engineer bonus on `action:reverse-engineer`, Graft Technician's on
 * `action:implant-graft`).
 */
function activityOptions({ craftType, route }) {
    // M9a (6.16): Deconstruct is its own action, not a Craft; Grow is a variant of the Craft activity; a quest's assembly
    // check is no Craft at all (TV-R pp.162, 165, 172).
    if (craftType === "deconstruct") return ["action:deconstruct"];
    if (craftType === "quest") return [];
    const options = craftType === "grow" ? ["action:craft", "action:grow"] : ["action:craft"];
    if (route === "reverse-engineer") options.push("action:reverse-engineer");
    if (craftType === "graft") options.push("action:implant-graft");
    return options;
}

/**
 * What an order's Craft check is rolled with (6.12): `options` for `extraRollOptions` (`action:craft` and the
 * activity's own actions, the product's roll options, the registry's options, the link) and the registry's
 * `modifiers` where no rule element exists.
 *
 * @param {object} p
 * @param {Iterable<string>} p.item        the product's roll options (an unsaved copy owned by the crafter)
 * @param {string[]} p.held                the crafter's registry keys
 * @param {Record<string, number>} p.ranks the crafter's ranks by skill
 * @param {{id: string, attempt: number, craftType?: string, route?: string|null, specialty?: string|null,
 *   material?: string|null}} p.order
 */
export function craftRollPlan({ item, held, ranks = {}, order }, rules = DEFAULT_RULES) {
    const craftType = order.craftType ?? "item";
    const context = craftOptions({ item, held, craftType, route: order.route ?? null, specialty: order.specialty ?? null, material: order.material ?? null });
    const options = [...new Set([
        ...activityOptions({ craftType, route: order.route }),
        ...item,
        ...rollOptions(held, context, rules),
        orderLink(order.id, order.attempt),
    ])];
    return { options, modifiers: modifiers(held, context, ranks, rules) };
}

/** What an Earn Income check is rolled with (6.10): `action:earn-income`, so the items' and feats' rules fire, and the link. */
export function earnIncomeRollPlan(jobId, round = 1) {
    return { options: ["action:earn-income", jobLink(jobId, round)] };
}

/**
 * The degree of a check before any adjustment, as pf2e's `DegreeOfSuccess` computes it: by 10 over or under the DC,
 * then one step up for a natural 20 and down for a natural 1. A reroll's message keeps the first roll's
 * `unadjustedOutcome` (pf2e `Check.rerollFromMessage` updates only `outcome`), so the module computes it.
 */
export function unadjustedDegree({ total, dc, die }) {
    const base = total - dc >= 10 ? DEGREE.critSuccess : dc - total >= 10 ? DEGREE.critFail : total >= dc ? DEGREE.success : DEGREE.fail;
    const step = die === 20 ? 1 : die === 1 ? -1 : 0;
    return Math.min(DEGREE.critSuccess, Math.max(DEGREE.critFail, base + step));
}

/**
 * The check a chat message records (6.12), from its `flags.pf2e.context` and its first roll, or a refusal:
 * `no-outcome` when the outcome does not map to a degree (never recorded, so it can never settle as a critical
 * failure), `no-dc` without a DC. `fortune` marks any reroll and a keep-higher roll, which GM Core p.46 keeps out of
 * downtime checks (the guardrail of 6.10): a Hero Point reroll, but also pf2e's free "Reroll and keep the new / the
 * higher / the lower result" chat menu entries, which spend nothing and leave no trace in the message but
 * `isReroll` and `check:reroll` (the kept result is not recorded, so a keep-lower reroll is marked too).
 *
 * @param {object} context  `flags.pf2e.context`
 * @param {{total: number, die: number|null}} roll  the kept roll's total and its d20
 * @returns {{ok: true, check: {degree, unadjusted, total, rerolled, fortune}} | {ok: false, reason: string}}
 */
export function checkFromContext(context, roll) {
    const degree = DEGREE_FROM_OUTCOME[context?.outcome];
    if (degree === undefined) return { ok: false, reason: "no-outcome" };
    const dc = context.dc?.value;
    if (!Number.isFinite(dc)) return { ok: false, reason: "no-dc" };
    const options = context.options ?? [];
    const unadjusted = Number.isFinite(roll.total) && Number.isInteger(roll.die)
        ? unadjustedDegree({ total: roll.total, dc, die: roll.die })
        : DEGREE_FROM_OUTCOME[context.unadjustedOutcome] ?? degree;
    const fortune = context.isReroll === true || options.includes("check:reroll") || context.rollTwice === "keep-higher";
    // M9a (6.16.4): the d20 is kept, so Critical Crafting can tell a natural 20 or 1.
    return { ok: true, check: { degree, unadjusted, total: roll.total ?? null, die: Number.isInteger(roll.die) ? roll.die : null, rerolled: !!context.isReroll,
        fortune } };
}

/**
 * The guardrail of 6.10 on one recorded check: "block" refuses a fortune check (`fortune-blocked`) under
 * `downtimeRerolls: "block"`; otherwise the check is kept and, under "warn", marked for the card.
 */
export function guardCheck(check, rules = DEFAULT_RULES) {
    const guard = downtimeCheckGuard({ fortune: check.fortune }, rules);
    if (guard === "block") return { ok: false, reason: "fortune-blocked" };
    return { ok: true, check: { ...check, warn: guard === "warn" } };
}

/**
 * The degree an order records: the system's degree after the registry's degree shifts that the roll's options select
 * (Impeccable Crafting turns a success into a critical success for the crafter's specialty, 6.15 gap 22).
 */
export function craftDegree(held, rollOptionList, degree, rules = DEFAULT_RULES) {
    return shiftDegree(held, new Set(rollOptionList), degree, rules);
}

/* -------------------------------------------- */
/*  Earn Income jobs                             */
/* -------------------------------------------- */

/**
 * A new Earn Income job record (4.9). `dc` comes from `earnIncomeDC` and `settlement` is the profile id it was taken
 * in (null when no profile is set, OQ-17).
 */
export function makeJob({ id, actor, skill, taskLevel, dc, settlement = null, startDay = null, party = null, unconfirmed = false }, stamp) {
    requireInteger(taskLevel, "taskLevel");
    requireInteger(dc, "dc");
    return { id, v: 1, party, actor, skill, taskLevel, settlement, unconfirmed, dc, startDay, lengthDays: null, round: 1, check: null, perDayCp: 0,
        status: "open", log: {}, ...stamp };
}

/**
 * The job fields a recorded Earn Income check writes (6.10): the check, the pay per day, and the status after the
 * roll (fired on a critical failure). Refused: a job that has ended (`state`); a roll for another round than the job's
 * (`stale-round`, M6: a reroll of the message rolled before the job was rolled again, `rerollJob`); a second roll that is
 * not a reroll (`rolled`); a reroll once a wage has been paid or claimed at the earlier rate (`paid`: the earner undoes
 * those wages first, as for a settled Craft check).
 *
 * @param {object} job
 * @param {{degree, unadjusted, total, rerolled, fortune, messageId}} check
 * @param {{level: number, rank: number, experiencedProfessional?: boolean}} earner  at the roll
 * @param {number} paidDays  days the job has paid or been promised by a wage claim (`wageDaysOf`)
 * @param {number} [round]   the round the roll's link names
 */
export function jobCheckPatch(job, check, earner, paidDays = 0, round = 1) {
    if (job.status === "ended") return { ok: false, reason: "state", data: { status: job.status } };
    if (round !== (job.round ?? 1)) return { ok: false, reason: "stale-round", data: { round, current: job.round ?? 1 } };
    if (job.check && !check.rerolled) return { ok: false, reason: "rolled" };
    if (job.check && paidDays > 0) return { ok: false, reason: "paid", data: { days: paidDays } };
    requireInteger(earner.level, "earner.level");
    requireInteger(earner.rank, "earner.rank");
    const perDayCp = wagePerDay({
        taskLevel: job.taskLevel, rank: earner.rank, degree: check.degree, unadjusted: check.unadjusted,
        skill: job.skill, experiencedProfessional: !!earner.experiencedProfessional,
    });
    const after = jobAfterRoll(check.degree);
    return {
        ok: true,
        patch: { check: { ...check, level: earner.level, rank: earner.rank }, perDayCp, status: after.status, shortened: after.shortened },
    };
}
