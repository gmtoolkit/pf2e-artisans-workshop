/**
 * Live-harness steps for M9 (DESIGN.md 6.9, 6.14, 7.1, 15.3), merged into the scenarios of `sync-scenarios.mjs` as scenario
 * `m9`. The live driver's behaviour checks (`live-plans.mjs`, the `m9-*` plans) run them: a tattoo filed for a player's
 * character, consented to by that player and sat for in downtime, crafted by the tattoo-artist fixture, collected, healed
 * and invested by the subject's own client; the simple toggle; a graft with Medicine; a fulu's tradition and year; a missive
 * composed; a staff's listed castings; quick-deploy snares; an inventor's uncommon gadget; and the Queue photographed.
 *
 * Every step goes through the module's own functions, as the window's buttons do. Items the steps give are marked
 * `flags.world.pf2e-artisans-workshop-m9`, so `reset` takes them away again with everything an M9 order made (a subject's
 * tattoos and grafts, fulus, missives); each character's formula book is put back as it was before the first M9 step. Console
 * output only: a developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { sweepClaims } from "../../scripts/foundry/claims.mjs";
import * as crafts from "../../scripts/foundry/crafts.mjs";
import * as downtime from "../../scripts/foundry/downtime.mjs";
import * as orders from "../../scripts/foundry/orders.mjs";
import { rollCraft } from "../../scripts/foundry/rolls.mjs";
import { read, records, stampNow, write } from "../../scripts/foundry/store.mjs";

/** The mark on items the M9 steps give, and where a character's original formula book is kept. */
const MARK = `${MODULE_ID}-m9`;
const BOOK = `${MODULE_ID}-m9-book`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
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

/** An order in brief, with its M9 fields. */
function brief(id) {
    const order = read(`orders.${id}`);
    if (!order) return null;
    return {
        id, status: order.status, craftType: order.craftType, target: order.target, recipient: plain(order.recipient), crafter: order.crafter,
        subject: plain(order.subject), process: order.variant?.process ?? null, tradition: order.variant?.tradition ?? null, skill: order.skill,
        priceCp: order.priceCp, dc: order.dc?.final ?? null, healing: plain(order.healing ?? null),
        pledges: Object.values(order.pledges ?? {}).map((p) => ({ status: p.status, entry: p.entry ?? null, rank: p.rank, service: !!p.service })),
    };
}

/** What an M9 order made, on an actor: the subject record, the mark, the expiry stamp, a missive's state. */
const madeBrief = (item) => ({
    id: item.id, uuid: item.uuid, name: item.name, qty: item.quantity ?? 1, traits: [...(item.system?.traits?.value ?? [])],
    equipped: plain(item.system?.equipped ?? null), subject: plain(item.flags?.[MODULE_ID]?.subject ?? null), mark: plain(item.flags?.[MODULE_ID]?.mark ?? null),
    expiry: plain(item.flags?.[MODULE_ID]?.expiry ?? null), missive: plain(item.flags?.[MODULE_ID]?.missive ?? null), description: item.system?.description?.value?.slice(0, 600) ?? "",
});

/** Whether an M9 order made the item (`flags.MOD.crafted`) or a step gave it. */
const isM9 = (item) => item.flags?.world?.[MARK] || item.flags?.[MODULE_ID]?.subject || item.flags?.[MODULE_ID]?.crafted || item.flags?.[MODULE_ID]?.delivered;

/**
 * Run `fn` with the d20 fixed at `face` (`CONFIG.Dice.randomUniform`; core's face is `ceil((1 - u) * 20)`, Foundry 14.368
 * `client/dice/terms/dice.mjs` `mapRandomFace`), then put the random source back; as it rolls when `face` is not a whole
 * number. A plan fixes the die so that the path it checks is the one taken (M9 live pass): a failed check would otherwise
 * skip every check after the finish.
 */
export async function withDie(face, fn) {
    if (!Number.isInteger(face)) return fn();
    const random = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 1 - (face - 0.5) / 20;
    try {
        return await fn();
    } finally {
        CONFIG.Dice.randomUniform = random;
    }
}

/**
 * Work an order to its end as the crafter's owner (`params.crafter`, else the user's character): accept, fund, start, work,
 * roll (the die at `params.face` when given), settle, finish.
 */
async function runOrder(p) {
    const id = p.order;
    const steps = [];
    const crafter = p.crafter ? fromUuidSync(p.crafter) : game.user.character;
    const payer = p.payer ? fromUuidSync(p.payer) : crafter;
    const fund = async (cp) => (cp > 0 ? steps.push(["pledge", plain(await orders.pledgeTo(id, payer.uuid, cp))]) : null);
    if (read(`orders.${id}.status`) === "requested") steps.push(["accept", plain(await orders.accept(id, crafter.uuid))]);
    if (["requested", "accepted"].includes(read(`orders.${id}.status`))) {
        if (p.pledge) await fund(p.pledge);
        steps.push(["start", plain(await orders.start(id))]);
    }
    for (let i = 0; i < 6 && read(`orders.${id}.status`) === "setup"; i++) steps.push(["work", plain(await orders.workDay(id))]);
    if (read(`orders.${id}.status`) === "check") {
        steps.push(["roll", plain(await withDie(p.face, () => rollCraft(id, { skipDialog: true })))]);
        await waitFor(() => read(`orders.${id}.status`) === "rolled", 10000);
    }
    if (read(`orders.${id}.status`) === "rolled") steps.push(["work", plain(await orders.workDay(id))]);
    if (read(`orders.${id}.status`) === "finishing" && p.finish !== false) {
        const order = read(`orders.${id}`);
        const escrow = records("rows").filter((r) => r.order === id).reduce((s, r) => s + (r.alloc ?? 0), 0);
        await fund(Math.max(0, order.priceCp - order.upfrontCp - escrow));
        steps.push(["finish", plain(await orders.finish(id))]);
    }
    return { steps, order: brief(id) };
}

export const CRAFT_SCENARIOS = {
    m9: {
        about: "M9: tattoos and grafts with their subject, fulus, missives, a staff's castings, quick-deploy snares, gadgets.",
        reset: { about: "GM: take away the items M9 steps gave or M9 orders made on params.actors, put their books back, clear their snare marks",
            run: async (p) => {
                const out = {};
                for (const uuid of p.actors) {
                    const actor = fromUuidSync(uuid);
                    const doomed = actor.items.filter(isM9).map((i) => i.id);
                    if (doomed.length) await actor.deleteEmbeddedDocuments("Item", doomed);
                    const saved = actor.flags?.world?.[BOOK];
                    if (saved) await actor.update({ "system.crafting.formulas": saved });
                    else await actor.update({ [`flags.world.${BOOK}`]: foundry.utils.deepClone(actor._source.system.crafting?.formulas ?? []) });
                    if (actor.flags?.[MODULE_ID]?.quickDeploy) await actor.update({ [`flags.${MODULE_ID}.quickDeploy`]: _del });
                    out[actor.name] = { removed: doomed.length };
                }
                await game.settings.set(MODULE_ID, "rules.tattooProcess", "secrets-of-magic");
                await game.settings.set(MODULE_ID, "features.tattoos", true);
                return out;
            } },
        give: { about: "GM: give params.actor the compendium item params.uuid (params.system merged), marked for reset", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const source = game.items.fromCompendium(await fromUuid(p.uuid), { keepId: false });
            foundry.utils.mergeObject(source, { system: p.system ?? {}, flags: { world: { [MARK]: true } } });
            const [item] = await actor.createEmbeddedDocuments("Item", [source]);
            return { uuid: item.uuid, id: item.id, name: item.name };
        } },
        spell: { about: "GM: give params.actor the spell named params.name from pf2e's spells pack, marked for reset; returns its UUID", run: async (p) => {
            const entry = (await game.packs.get("pf2e.spells-srd").getIndex()).find((e) => e.name === p.name);
            if (!entry) return { ok: false, reason: "no-spell" };
            const actor = fromUuidSync(p.actor);
            const source = game.items.fromCompendium(await fromUuid(entry.uuid), { keepId: false });
            foundry.utils.setProperty(source, `flags.world.${MARK}`, true);
            const [item] = await actor.createEmbeddedDocuments("Item", [source]);
            return { ok: true, uuid: item.uuid, compendium: entry.uuid };
        } },
        order: { about: "any client: params.order in brief, with its pledges' entries", run: async (p) => ({ order: brief(p.order) }) },
        medicine: { about: "GM: make params.actor expert in Medicine for the run (an effect, marked for reset)", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const [effect] = await actor.createEmbeddedDocuments("Item", [{ type: "effect", name: "M9 Medicine", img: "icons/svg/aura.svg",
                system: { rules: [{ key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.medicine.rank", value: 2 }] }, flags: { world: { [MARK]: true } } }]);
            return { id: effect.id, rank: actor.skills?.medicine?.rank ?? null };
        } },
        learn: { about: "GM: add params.uuids to params.actor's formula book (put back by reset)", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const book = foundry.utils.deepClone(actor._source.system.crafting?.formulas ?? []);
            for (const uuid of p.uuids) if (!book.some((f) => f.uuid === uuid)) book.push({ uuid });
            await actor.update({ "system.crafting.formulas": book });
            return { book: book.map((f) => f.uuid) };
        } },
        investiture: { about: "GM: set params.actor's investiture maximum for the run (params.max, null to clear)", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const doomed = actor.items.filter((i) => i.flags?.world?.[`${MARK}-invest`]).map((i) => i.id);
            if (doomed.length) await actor.deleteEmbeddedDocuments("Item", doomed);
            if (Number.isInteger(p.max)) {
                await actor.createEmbeddedDocuments("Item", [{ type: "effect", name: "M9 Investiture", img: "icons/svg/aura.svg",
                    system: { rules: [{ key: "ActiveEffectLike", mode: "override", path: "system.resources.investiture.max", value: p.max }] },
                    flags: { world: { [MARK]: true, [`${MARK}-invest`]: true } } }]);
            }
            return { max: actor.system?.resources?.investiture?.max ?? null };
        } },
        setting: { about: "GM: set a world setting of the module (params.key, params.value)", run: async (p) => ({ value: await game.settings.set(MODULE_ID, p.key, p.value) }) },
        request: { about: "requester's owner: file an order (params: uuid, quantity, requester, target, crafter, recipient, variant, craftType)", run: async (p) => {
            const requester = p.requester ? fromUuidSync(p.requester) : game.user.character;
            const result = await orders.requestOrder({ uuid: p.uuid, quantity: p.quantity ?? 1, requester: requester.uuid,
                recipient: p.recipient ? { kind: "actor", uuid: p.recipient } : null, crafter: p.crafter ?? null, target: p.target ?? null,
                variant: p.variant ?? {}, craftType: p.craftType ?? null });
            return { ...plain(result), order: result.orders?.[0] ?? null, brief: result.orders?.[0] ? brief(result.orders[0]) : null };
        } },
        consent: { about: "the subject's owner: agree to params.order for params.actor (or the user's character), or withdraw (params.withdraw)", run: async (p) => {
            const actor = actorOf(p);
            const result = p.withdraw ? await crafts.withdrawConsent(p.order, actor.uuid) : await crafts.consent(p.order, actor.uuid);
            return { result: plain(result), order: brief(p.order), status: plain(downtime.statusOf(actor)) };
        } },
        leave: { about: "the PC's owner: try to take params.actor (or the user's character) out of downtime", run: async (p) => plain(await downtime.setDowntime(actorOf(p).uuid, false)) },
        run: { about: "the crafter's owner: work params.order to its end as params.crafter (params.pledge first, params.payer, the die at params.face)",
            run: async (p) => runOrder(p) },
        tradition: { about: "the crafter's owner: choose params.tradition for the fulu of params.order", run: async (p) => plain(await crafts.chooseTradition(p.order, p.tradition)) },
        collect: { about: "any client: collect what waits for the user's characters, then settle their tattoos and grafts", run: async () => ({
            taken: await sweepClaims({ force: true }), settled: plain(await crafts.subjectSweep()) }) },
        made: { about: "any client, after params.ms: what params.order made, on params.actor (or the user's character) and on the shelf", run: async (p) => {
            await sleep(p.ms ?? 0);
            const actor = actorOf(p);
            const mine = actor.items.filter((i) => i.flags?.[MODULE_ID]?.crafted?.order === p.order || i.flags?.[MODULE_ID]?.subject?.order === p.order);
            return { order: brief(p.order), items: mine.map(madeBrief), today: downtime.today().day };
        } },
        heal: { about: "the subject's owner: record healing on what params.order made on the user's character", run: async (p) => {
            const item = p.order ? game.user.character.items.find((i) => i.flags?.[MODULE_ID]?.subject?.order === p.order) : null;
            return item ? { result: plain(await crafts.recordHealing(item.uuid)), item: madeBrief(item) } : { result: { ok: false, reason: "no-item" } };
        } },
        logDay: { about: "GM: log params.days days ahead of the clock (as the Advance days wizard does without moving it)", run: async (p) => {
            const now = downtime.today();
            const id = `m9${Date.now().toString(36)}`;
            await write({ set: { [`meta.manual.${id}`]: { fromDay: now.day + 1, toDay: now.day + (p.days ?? 1), ...stampNow() } } });
            return { from: now.day, to: downtime.today().day };
        } },
        compose: { about: "the owner: compose one missive params.order made on params.actor (or the user's character; params.note)", run: async (p) => {
            const actor = actorOf(p);
            const mine = () => crafts.blankMissives(actor).filter((i) => i.flags?.[MODULE_ID]?.crafted?.order === p.order);
            const item = mine()[0];
            if (!item) return { result: { ok: false, reason: "no-item" } };
            const result = plain(await crafts.composeMissive(item.uuid, { note: p.note ?? "" }));
            const composed = result.item ? fromUuidSync(result.item) : null;
            return { result, left: mine().reduce((n, i) => n + (i.quantity ?? 1), 0), composed: composed ? madeBrief(composed) : null };
        } },
        snares: { about: "GM: prepare params.uuid params.count times, all ready, in params.actor's snare pool params.pool for quick deployment",
            run: async (p) => {
                const actor = fromUuidSync(p.actor);
                // Read again after each write: pf2e's ability holds the pool's prepared list as it was when the actor was prepared.
                const pool = () => [...(actor.crafting?.abilities ?? [])].find((a) => a.slug === p.pool);
                if (!pool()) return { ok: false, reason: "no-pool", pools: [...(actor.crafting?.abilities ?? [])].map((a) => a.slug) };
                // Taken out first, so a slot an earlier run deployed (pf2e keeps `expended` on the entry) is not prepared again spent.
                await pool().unprepareFormula(p.uuid);
                await pool().setFormulaQuantity(p.uuid, p.count ?? 2);
                const prepared = await pool().getPreparedCraftingFormulas();
                return { ok: true, prepared: prepared.map((f) => ({ uuid: f.uuid, expended: !!f.expended })) };
            } },
        ledger: { about: "any client: params.actor's quick-deploy ledger for params.pool, after params.mark (key, mark) and params.deploy (index)", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const out = {};
            if (p.mark) out.mark = plain(await crafts.setSnareMark(actor.uuid, p.pool, p.mark.key, p.mark.mark));
            if (Number.isInteger(p.deploy)) out.deploy = plain(await crafts.deploySnare(actor.uuid, p.pool, p.deploy));
            const ability = [...(actor.crafting?.abilities ?? [])].find((a) => a.slug === p.pool);
            const prepared = (await ability.getPreparedCraftingFormulas()).map((f) => ({ uuid: f.uuid, name: f.item?.name, expended: !!f.expended }));
            out.ledger = plain(crafts.snareLedger(actor, { slug: p.pool, maxSlots: ability.maxSlots, prepared }));
            return out;
        } },
    },
};
