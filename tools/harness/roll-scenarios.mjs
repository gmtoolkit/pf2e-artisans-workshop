/**
 * Live-harness steps for the roll wrapper and the Earn Income roll (DESIGN.md 6.12, 6.10; milestone M3), merged into
 * the scenarios of `sync-scenarios.mjs` as scenario `m3`. The live driver's behaviour checks (`live-plans.mjs`) run
 * them: a Craft roll where an item-predicated gear bonus fires, the rarity DC, a Hero Point reroll recorded once, a
 * second first roll refused and a free reroll guarded, and an Earn Income day paid once however often it is resolved.
 *
 * Orders and jobs are written straight into the ledger here, in the state the step needs: the order lifecycle and the
 * Earn Income job form are M4 and M6. Console output only: a developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { holdingsOf, valueCp } from "../../scripts/logic/coins.mjs";
import { craftDC } from "../../scripts/logic/dc.mjs";
import { earnIncomeDC } from "../../scripts/logic/earn-income.mjs";
import { orderLink, parseLink, makeJob } from "../../scripts/logic/rolls.mjs";
import { coinStacks } from "../../scripts/foundry/coins.mjs";
import { payWage, rollCraft, rollEarnIncome } from "../../scripts/foundry/rolls.mjs";
import { shared } from "../../scripts/foundry/state.mjs";
import { newId, read, records, stampNow, write } from "../../scripts/foundry/store.mjs";

const purseCp = (actor) => valueCp(holdingsOf(coinStacks(actor)));

function actorOf(params) {
    const actor = params.actor ? fromUuidSync(params.actor) : game.user.character;
    if (!actor) throw new Error(`${MODULE_ID} | step needs params.actor or an assigned character`);
    return actor;
}

async function waitFor(test, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = await test();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
}

/** The newest chat message linked to `kind` `id` (an order or a job), or null. */
const linkedMessage = (kind, id) => game.messages.contents.filter((m) => {
    const link = parseLink(m.flags?.pf2e?.context?.options);
    return link?.kind === kind && link.id === id;
}).at(-1) ?? null;

/** What a check message says, in brief: who wrote it, its DC and outcome, its link, and the Crafting modifiers. */
function brief(message) {
    if (!message) return null;
    const context = message.flags.pf2e.context;
    return {
        id: message.id, author: message.author?.name ?? null, dc: context.dc?.value ?? null, outcome: context.outcome,
        isReroll: !!context.isReroll, link: parseLink(context.options),
        options: context.options.filter((o) => o.startsWith("action:") || o.startsWith("item:trait:") || o.startsWith("check:reroll")),
        modifiers: (message.flags.pf2e.modifiers ?? []).map((m) => ({ slug: m.slug, type: m.type, modifier: m.modifier, enabled: m.enabled })),
        total: message.rolls[0]?.total ?? null,
    };
}

/** Ledger writes under a path prefix, by user, while a step runs elsewhere. */
const watched = new Map();
let watching = null;
function onUpdate(doc, changed, _options, userId) {
    if (!watching || doc !== shared().ledger) return;
    const flat = foundry.utils.flattenObject(changed.flags?.[MODULE_ID] ?? {});
    if (Object.keys(flat).some((key) => key.startsWith(watching))) watched.set(userId, (watched.get(userId) ?? 0) + 1);
}

export const ROLL_SCENARIOS = {
    m3: {
        about: "M3: the roll wrapper and the Earn Income roll recording into the ledger.",
        order: { about: "any client: an order in `check` for params.actor (default: own PC) crafting params.product at its frozen Craft DC", run: async (p) => {
            const actor = actorOf(p);
            const product = await fromUuid(p.product);
            const level = product.system.level.value;
            const rarity = product.system.traits.rarity;
            const dc = craftDC({ level, rarity, pwol: game.pf2e.settings.variants.pwol.enabled });
            const id = p.id ?? newId();
            const order = {
                id, v: 1, party: null, requester: actor.uuid, recipient: { kind: "actor", uuid: actor.uuid },
                product: { type: "item", uuid: p.product, snapshot: { name: product.name, level, rarity, traits: [...product.system.traits.value] } },
                craftType: "item", attempt: 1, quantity: 1, crafter: actor.uuid, skill: "crafting", route: "known",
                priceCp: 0, upfrontCp: 0, dc, setup: { days: 1, hours: 0 }, check: null, status: "check", specialty: p.specialty ?? null,
                ...stampNow(),
            };
            await write({ set: { [`orders.${id}`]: order } });
            return { id, dc, level, rarity };
        } },
        roll: { about: "the crafter's owner: roll the order's Craft check through the wrapper; wait until it is recorded", run: async (p) => {
            const result = await rollCraft(p.order, { skipDialog: true });
            const recorded = await waitFor(() => read(`orders.${p.order}.status`) === "rolled");
            return { result, recorded: !!recorded, message: brief(linkedMessage("order", p.order)), check: read(`orders.${p.order}.check`) };
        } },
        systemRoll: { about: "the crafter's owner: the same check as the system Craft macro rolls it (action:craft only, level DC, no item options)", run: async (p) => {
            const actor = actorOf(p);
            const roll = await actor.skills.crafting.roll({ extraRollOptions: ["action:craft"], dc: { value: p.dc }, skipDialog: true });
            const message = game.messages.contents.at(-1);   // pf2e creates it before the roll resolves
            const modifiers = (message?.flags?.pf2e?.modifiers ?? []).map((m) => ({ slug: m.slug, type: m.type, modifier: m.modifier, enabled: m.enabled }));
            return { total: roll?.total ?? null, linked: !!parseLink(message?.flags?.pf2e?.context?.options), modifiers };
        } },
        again: { about: "the crafter's owner: a second first roll for the order's attempt, as a second check dialog makes it (the link, not a reroll); then the order's check", run: async (p) => {
            const order = read(`orders.${p.order}`);
            const actor = fromUuidSync(order.crafter);
            await actor.skills[order.skill ?? "crafting"].roll({
                extraRollOptions: ["action:craft", orderLink(order.id, order.attempt)], dc: { value: order.dc.final }, skipDialog: true, createMessage: true,
            });
            await new Promise((resolve) => setTimeout(resolve, p.ms ?? 3000));
            return { message: brief(linkedMessage("order", p.order)), check: read(`orders.${p.order}.check`), status: read(`orders.${p.order}.status`) };
        } },
        reroll: { about: "the crafter's owner: reroll params.message (default: the order's last check message) with a Hero Point, or with params.resource \"none\" by pf2e's free keep-new reroll; wait until the order records it", run: async (p) => {
            const message = p.message ? game.messages.get(p.message) : linkedMessage("order", p.order);
            await game.pf2e.Check.rerollFromMessage(message, p.resource === "none" ? { keep: "new" } : { resource: p.resource ?? "hero-points" });
            const replaced = await waitFor(() => {
                const id = read(`orders.${p.order}.check.messageId`);
                return id && id !== message.id ? id : null;
            });
            return { first: message.id, replaced: replaced ?? null, message: brief(game.messages.get(replaced) ?? null), check: read(`orders.${p.order}.check`) };
        } },
        watch: { about: "any client: start counting ledger writes to params.path", run: (p) => {
            watched.clear();
            watching = p.path;
            Hooks.on("updateJournalEntry", onUpdate);
            return { watching };
        } },
        count: { about: "the watching client, after params.ms (default 3 s): writers and their counts", run: async (p) => {
            await new Promise((resolve) => setTimeout(resolve, p.ms ?? 3000));
            Hooks.off("updateJournalEntry", onUpdate);
            watching = null;
            return { writers: Object.fromEntries([...watched].map(([userId, n]) => [game.users.get(userId)?.name ?? userId, n])) };
        } },
        job: { about: "any client: an open Earn Income job for params.actor in params.skill at params.taskLevel", run: async (p) => {
            const actor = actorOf(p);
            const skill = p.skill ?? "crafting";
            const dc = earnIncomeDC({ taskLevel: p.taskLevel ?? 0, skill, pwol: game.pf2e.settings.variants.pwol.enabled });
            const job = makeJob({ id: p.id ?? newId(), actor: actor.uuid, skill, taskLevel: p.taskLevel ?? 0, dc }, stampNow());
            await write({ set: { [`jobs.${job.id}`]: job } });
            return { id: job.id, dc };
        } },
        earn: { about: "the earner's owner: roll the job's Earn Income check; wait until it is recorded", run: async (p) => {
            const result = await rollEarnIncome(p.job, { skipDialog: true });
            const recorded = await waitFor(() => read(`jobs.${p.job}.check`));
            return { result, recorded: !!recorded, message: brief(linkedMessage("job", p.job)), job: read(`jobs.${p.job}`) };
        } },
        pay: { about: "any client: resolve day params.day of the job (pay its wage, or claim it for the earner)", run: async (p) => {
            const result = await payWage(p.job, p.day ?? 1);
            return { outcome: result.outcome ?? null, reason: result.reason ?? null };
        } },
        wages: { about: "any client, after the sweeps: the job's live wage rows and the earner's purse", run: async (p) => {
            await new Promise((resolve) => setTimeout(resolve, p.ms ?? 3000));
            const job = read(`jobs.${p.job}`);
            const rows = records("rows").filter((row) => row.kind === "wage" && row.job === p.job);
            const claims = records("claims").filter((claim) => claim.job === p.job);
            return {
                perDayCp: job?.perDayCp ?? null, rows: rows.map((row) => ({ day: row.day, cp: row.cp, state: row.state, author: game.users.get(row.author)?.name })),
                claims: claims.map((claim) => ({ day: claim.day, resolved: !!claim.resolved })), purse: purseCp(fromUuidSync(job.actor)),
            };
        } },
    },
};
