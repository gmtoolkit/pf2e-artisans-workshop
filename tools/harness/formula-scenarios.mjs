/**
 * Live-harness steps for M5 (DESIGN.md 4.5, 4.13, 5.5, 6.6, 6.8, 6.9, 6.13, 10.1 Formulas tab, 15.3), merged into the
 * scenarios of `sync-scenarios.mjs` as scenario `m5`. The live driver's behaviour checks (`live-plans.mjs`, the `m5-*`
 * plans) run them: learning a formula at once, from an ally, for a pick; the formula jobs on the order machine; runes
 * etched, transferred and items upgraded with custody; precious stock; casting pledges and a scroll; Repair, affixing and
 * Identify Alchemy as services; and the Formulas tab, driven and photographed.
 *
 * Every step goes through the module's own functions, as the window's buttons do. Items the steps give characters are
 * marked `flags.world.pf2e-artisans-workshop-m5`, so `reset` takes them away again, and each character's formula book is
 * put back as it was before the first M5 step touched it. Console output only: a developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { provenancePath } from "../../scripts/logic/codex.mjs";
import { holdingsOf, valueCp } from "../../scripts/logic/coins.mjs";
import { coinStacks } from "../../scripts/foundry/coins.mjs";
import { sweepClaims } from "../../scripts/foundry/claims.mjs";
import { handOver } from "../../scripts/foundry/custody.mjs";
import * as formulas from "../../scripts/foundry/formulas.mjs";
import * as orders from "../../scripts/foundry/orders.mjs";
import * as pledges from "../../scripts/foundry/pledges.mjs";
import { rollCraft } from "../../scripts/foundry/rolls.mjs";
import * as services from "../../scripts/foundry/services.mjs";
import { shared } from "../../scripts/foundry/state.mjs";
import { read, records } from "../../scripts/foundry/store.mjs";
import { openWorkshop, WorkshopApp } from "../../scripts/ui/workshop.mjs";

/** The mark on items the M5 steps create, and where a character's original formula book is kept. */
const MARK = `${MODULE_ID}-m5`;
const BOOK = `${MODULE_ID}-m5-book`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const purseCp = (actor) => valueCp(holdingsOf(coinStacks(actor)));
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

/** An order in brief, with its M5 fields. */
function brief(id) {
    const order = read(`orders.${id}`);
    if (!order) return null;
    return {
        id, status: order.status, craftType: order.craftType, productType: order.product?.type, route: order.route, priceCp: order.priceCp,
        upfrontCp: order.upfrontCp, dc: order.dc?.final ?? null, setup: order.setup, attempt: order.attempt,
        custody: Object.values(order.custody ?? {}).map((l) => ({ purpose: l.purpose, name: l.name, returned: !!l.returned })),
        materials: Object.values(order.materials ?? {}).map((l) => ({ material: l.material, valueCp: l.valueCp, used: !!l.used, returned: !!l.returned })),
        pledges: Object.values(order.pledges ?? {}).map((p) => ({ status: p.status, castings: p.castings, service: !!p.service, spell: p.spell?.name ?? null })),
        rows: records("rows").filter((row) => row.order === id).map((row) => ({ kind: row.kind, cp: row.cp, state: row.state })),
        log: Object.values(order.log ?? {}).sort((a, b) => a.seq - b.seq).map((e) => e.event),
    };
}

/** A character's book and provenance, as this client sees them. */
function bookBrief(actor) {
    return {
        book: formulas.bookOf(actor),
        provenance: Object.values(read(`formulas.${actor.id}`) ?? {}).filter((r) => r?.uuid).map((r) => ({ uuid: r.uuid, route: r.route, source: r.source })),
    };
}

/** Work an order through its lifecycle as its crafter's owner: pledge, start, setup days, roll, settle, pledge the rest, finish. */
async function runOrder(p) {
    const id = p.order;
    const steps = [];
    const me = game.user.character;
    const fund = async (cp) => (cp > 0 ? steps.push(["pledge", plain(await orders.pledgeTo(id, me.uuid, cp))]) : null);
    const before = read(`orders.${id}`);
    if (before.status === "requested") steps.push(["accept", plain(await orders.accept(id, me.uuid))]);
    if (["requested", "accepted"].includes(read(`orders.${id}.status`))) {
        if (p.pledge) await fund(p.pledge);
        steps.push(["start", plain(await orders.start(id))]);
    }
    for (let i = 0; i < 6 && read(`orders.${id}.status`) === "setup"; i++) steps.push(["work", plain(await orders.workDay(id))]);
    if (read(`orders.${id}.status`) === "check") {
        steps.push(["roll", plain(await rollCraft(id, { skipDialog: true }))]);
        await waitFor(() => read(`orders.${id}.status`) === "rolled", 10000);
    }
    if (read(`orders.${id}.status`) === "rolled") steps.push(["work", plain(await orders.workDay(id))]);
    if (read(`orders.${id}.status`) === "finishing" && p.finish !== false) {
        const order = read(`orders.${id}`);
        const days = records("days").filter((d) => d.order === id && d.attempt === order.attempt && d.kind === "extra");
        const earned = days.reduce((s, d) => s + (d.crafterCp ?? 0), 0);
        const escrow = records("rows").filter((r) => r.order === id).reduce((s, r) => s + (r.alloc ?? 0), 0);
        await fund(Math.max(0, order.priceCp - order.upfrontCp - earned - escrow));
        steps.push(["finish", plain(await orders.finish(id))]);
    }
    return { steps, order: brief(id) };
}

export const FORMULA_SCENARIOS = {
    m5: {
        about: "M5: formulas, formula jobs, runes, materials, pledges, services and the Formulas tab.",
        reset: { about: "GM: take away the items earlier M5 steps gave params.actors and put their formula books back", run: async (p) => {
            const out = {};
            for (const uuid of p.actors) {
                const actor = fromUuidSync(uuid);
                const marked = actor.items.filter((i) => i.flags?.world?.[MARK] || i.flags?.[MODULE_ID]?.earmark || i.flags?.[MODULE_ID]?.delivered).map((i) => i.id);
                if (marked.length) await actor.deleteEmbeddedDocuments("Item", marked);
                const saved = actor.flags?.world?.[BOOK];
                if (saved) await actor.update({ "system.crafting.formulas": saved });
                else await actor.update({ [`flags.world.${BOOK}`]: foundry.utils.deepClone(actor._source.system.crafting?.formulas ?? []) });
                out[actor.name] = { removed: marked.length, book: (actor.system.crafting?.formulas ?? []).length };
            }
            return out;
        } },
        give: { about: "GM: give params.actor an item from params.uuid with params.system merged, marked for reset; returns its UUID", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const source = game.items.fromCompendium(await fromUuid(p.uuid), { keepId: false });
            foundry.utils.mergeObject(source, { system: p.system ?? {}, flags: { world: { [MARK]: true } } });
            if (p.equip) source.system.equipped = { carryType: "worn", inSlot: true, invested: true, handsHeld: p.hands ?? 0 };
            const [item] = await actor.createEmbeddedDocuments("Item", [source]);
            return { uuid: item.uuid, id: item.id, name: item.name };
        } },
        spell: { about: "GM: give params.actor the spell named params.name from pf2e's spells pack, marked; returns its UUID", run: async (p) => {
            const index = await game.packs.get("pf2e.spells-srd").getIndex();
            const entry = index.find((e) => e.name === p.name);
            const actor = fromUuidSync(p.actor);
            const source = game.items.fromCompendium(await fromUuid(entry.uuid), { keepId: false });
            foundry.utils.setProperty(source, `flags.world.${MARK}`, true);
            const [item] = await actor.createEmbeddedDocuments("Item", [source]);
            return { uuid: item.uuid, compendium: entry.uuid };
        } },
        setting: { about: "GM: set a world setting of the module (params.key, params.value)", run: async (p) => ({ value: await game.settings.set(MODULE_ID, p.key, p.value) }) },
        acquire: { about: "player: learn params.uuid at once by params.route for the user's character (params.source, params.seller, params.paidFrom)", run: async (p) => {
            const actor = actorOf(p);
            const before = purseCp(actor);
            const result = await formulas.acquire({ learner: actor.uuid, uuid: p.uuid, route: p.route, payer: actor.uuid, paidFrom: p.paidFrom ?? "purse",
                source: p.source ?? null, pickLevel: p.pickLevel ?? null, confirm: p.seller ? ["seller"] : [] });
            return { result: plain(result), paid: before - purseCp(actor), ...bookBrief(actor) };
        } },
        book: { about: "any client, after params.ms: the formula book and provenance of params.actor (or the user's character)", run: async (p) => {
            await sleep(p.ms ?? 0);
            const actor = actorOf(p);
            return { ...bookBrief(actor), claims: records("claims").filter((c) => c.kind === "formula" && c.actor === actor.uuid)
                .map((c) => ({ resolved: !!c.resolved, applied: !!c.applied, route: c.route })) };
        } },
        waitFormula: { about: "the learner's client: wait until params.uuid is in the user's character's book", run: async (p) => {
            const actor = game.user.character;
            const ok = !!(await waitFor(() => formulas.bookOf(actor).includes(p.uuid), p.ms ?? 20000));
            return { ok, ...bookBrief(actor), provenance: read(provenancePath(actor.id, p.uuid)) };
        } },
        owed: { about: "any client: the picks the user's character is owed, and the first catalogue item that fits the first of params.key", run: async (p) => {
            const actor = game.user.character;
            const owed = formulas.owedPicks(actor);
            const pick = owed.entries.find((e) => e.owed > 0 && (!p.key || e.key === p.key));
            const { pickFits } = await import(`/modules/${MODULE_ID}/scripts/logic/codex.mjs`);
            const { catalogue } = await import(`/modules/${MODULE_ID}/scripts/foundry/catalogue.mjs`);
            const book = formulas.bookOf(actor);
            const fit = pick ? (await catalogue()).find((item) => pickFits(pick, item) && !book.includes(item.uuid)) : null;
            return { owed: owed.owed, pick: pick ? { key: pick.key, level: pick.level, owed: pick.owed, maxLevel: pick.maxLevel } : null, fit: fit ? { uuid: fit.uuid, name: fit.name } : null };
        } },
        request: { about: "player: file an M5 request (params: uuid, quantity, recipient, crafter, productType, route, craftType, target, variant)", run: async (p) => {
            const me = game.user.character;
            const result = await orders.requestOrder({ uuid: p.uuid, quantity: p.quantity ?? 1, requester: me.uuid,
                recipient: p.strongbox ? { kind: "strongbox" } : { kind: "actor", uuid: p.recipient ?? me.uuid }, crafter: p.crafter ?? null,
                productType: p.productType ?? "item", route: p.route ?? null, craftType: p.craftType ?? null, target: p.target ?? null, variant: p.variant ?? {} });
            return { ...plain(result), order: result.orders?.[0] ?? null, brief: result.orders?.[0] ? brief(result.orders[0]) : null };
        } },
        run: { about: "the crafter's owner: work params.order to its end (params.pledge first, params.finish false to stop in finishing)", run: async (p) => runOrder(p) },
        gates: { about: "any client: the gates of params.order for its crafter, as the window shows them", run: async (p) => {
            const { crafterFacts, gatesFor, productFacts } = await import(`/modules/${MODULE_ID}/scripts/foundry/products.mjs`);
            const { rulesFromSettings } = await import(`/modules/${MODULE_ID}/scripts/foundry/settings.mjs`);
            const order = read(`orders.${p.order}`);
            const { gates, plan } = await gatesFor(order, crafterFacts(fromUuidSync(order.crafter)), await productFacts(order.product.uuid),
                records("rows").filter((r) => r.order === p.order), rulesFromSettings());
            return { failing: gates.filter((g) => !g.ok).map((g) => [g.id, g.reason]), plan: plain({ ok: plan.ok, reason: plan.reason, priceCp: plan.priceCp, dc: plan.dc?.final }) };
        } },
        handOver: { about: "the item's owner: hand params.item over for params.order or params.service (params.purpose, params.quantity)", run: async (p) =>
            plain(await handOver({ order: p.order ?? null, service: p.service ?? null, item: p.item, purpose: p.purpose, quantity: p.quantity ?? null })) },
        state: { about: "any client, after params.ms: params.order in brief, the strongbox's M5 items, the user's character's items of params.names", run: async (p) => {
            await sleep(p.ms ?? 0);
            const box = shared().strongbox;
            const me = game.user.character;
            return {
                order: p.order ? brief(p.order) : null,
                strongbox: box?.items.filter((i) => i.flags?.[MODULE_ID]?.earmark || i.flags?.[MODULE_ID]?.shelf).map((i) => ({ name: i.name,
                    earmark: plain(i.flags[MODULE_ID].earmark ?? null), shelf: i.flags[MODULE_ID].shelf?.for ?? null, runes: plain(i.system.runes ?? null), hp: i.system.hp?.value ?? null })) ?? [],
                mine: me?.items.filter((i) => !p.names || p.names.includes(i.name)).map((i) => ({ name: i.name, runes: plain(i.system.runes ?? null), hp: i.system.hp?.value ?? null,
                    affix: plain(i.flags?.[MODULE_ID]?.affix ?? null), uuid: i.uuid })) ?? [],
                purse: me ? purseCp(me) : null,
            };
        } },
        pledge: { about: "the caster's owner: pledge params.castings of params.spell (a spell item's UUID) from params.caster to params.order", run: async (p) =>
            plain(await pledges.pledgeCasting(p.order, { caster: p.caster, spell: p.spell, castings: p.castings ?? 1 })) },
        fulfil: { about: "the caster's owner: mark params.order's pledges by params.caster cast (params.costCp from params.paidFrom)", run: async (p) => {
            const out = [];
            for (const pledge of Object.values(read(`orders.${p.order}.pledges`) ?? {})) {
                if (pledge.caster === p.caster && pledge.status === "offered") {
                    out.push(plain(await pledges.fulfilPledge(p.order, pledge.id, { costCp: p.costCp ?? 0, paidFrom: p.paidFrom ?? "purse" })));
                }
            }
            return { results: out, order: brief(p.order) };
        } },
        buyCasting: { about: "player: buy params.castings castings of the spell named params.name for params.order (params.paidFrom)", run: async (p) => {
            const index = await game.packs.get("pf2e.spells-srd").getIndex();
            const spell = index.find((e) => e.name === p.name)?.uuid;
            return plain(await pledges.buyCasting(p.order, { payer: game.user.character.uuid, paidFrom: p.paidFrom ?? "purse", spell, castings: p.castings ?? 1 }));
        } },
        service: { about: "player: ask for a service (params.kind, performer, target, host, uuid, paidFrom)", run: async (p) => plain(await services.requestService({
            kind: p.kind, requester: game.user.character.uuid, performer: p.performer ?? null, target: p.target ?? null, host: p.host ?? null, uuid: p.uuid ?? null,
            paidFrom: p.paidFrom ?? "purse" })) },
        offer: { about: "player: offer to perform params.service as the user's character", run: async (p) => plain(await services.offer(p.service, game.user.character.uuid)) },
        perform: { about: "the performer's owner: perform params.service without the check dialog", run: async (p) => {
            const result = plain(await services.perform(p.service, { skipDialog: true }));
            return { result, service: plain(read(`services.${p.service}`)) };
        } },
        sweep: { about: "any client: collect what waits for the user's characters", run: async () => ({ taken: await sweepClaims({ force: true }) }) },
        open: { about: "any client: open the Workshop on params.tab with the Formulas tab showing params.actor, params.uuid, params.pick", run: async (p) => {
            await WorkshopApp.instance?.close({ animate: false });
            await waitFor(() => !WorkshopApp.instance, 3000);
            const shown = await openWorkshop({ tab: p.tab ?? "formulas", order: p.order ?? null });
            shown.codex = { actor: p.actor ?? null, search: p.search ?? "", uuid: p.uuid ?? null, pick: p.pick ?? null, seller: false, recipient: null };
            await shown.render({ parts: ["formulas", "queue"] });
            shown.setPosition({ left: 12, top: 12 });
            await sleep(p.ms ?? 1500);
            const el = shown.element;
            return { open: !!el?.isConnected, tab: shown.tabGroups.primary, families: el?.querySelectorAll(".codex-family").length ?? 0,
                routes: el?.querySelectorAll(".learn-routes tbody tr").length ?? 0, picks: el?.querySelectorAll(".codex-picks tbody tr").length ?? 0,
                services: el?.querySelectorAll(".service-row").length ?? 0, hasStyles: getComputedStyle(el).containerType === "inline-size" };
        } },
        click: { about: "any client: click the Workshop's first button matching params.selector, then wait params.ms", run: async (p) => {
            const button = WorkshopApp.instance?.element?.querySelector(p.selector);
            button?.click();
            await sleep(p.ms ?? 1500);
            return { clicked: !!button };
        } },
        payDialog: { about: "any client: in the open money dialog (M5 on M4.1), choose params.source ('fund' or 'purse') and confirm, then wait params.ms",
            run: async (p) => {
                const box = await waitFor(() => document.querySelector(".pf2e-artisans-workshop-amount"), p.wait ?? 5000);
                if (!box) return { found: false };
                const root = box.closest(".application") ?? box.closest("dialog") ?? document;
                const seen = { found: true, fixed: box.querySelector(".amount-fixed")?.textContent.trim() ?? null,
                    sources: [...box.querySelectorAll("input[name='source']")].map((input) => ({ value: input.value, checked: input.checked, disabled: input.disabled })) };
                const radio = p.source ? box.querySelector(`input[name='source'][value='${p.source}']`) : null;
                if (radio && !radio.disabled) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event("change", { bubbles: true }));
                }
                const ok = root.querySelector("button[data-action='ok']");
                seen.enabled = !!ok && !ok.disabled;
                ok?.click();
                await sleep(p.ms ?? 1500);
                return seen;
            } },
        close: { about: "any client: close the Workshop", run: async () => {
            await WorkshopApp.instance?.close();
            return { closed: true };
        } },
    },
};
