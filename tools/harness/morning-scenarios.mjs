/**
 * Live-harness steps for M7 (DESIGN.md 4.11, 7.1-7.10, 10.1 Morning tab, 15.3 scenario 4), merged into the scenarios of
 * `sync-scenarios.mjs` as scenario `m7`. The live driver's behaviour checks (`live-plans.mjs`, the `m7-*` plans) run them:
 * a preparation through pf2e's own methods with a loadout by family and virtual talismans; party-wide expiry of an infused
 * item handed to an ally, at a rest and after 24 hours; Rest for the Night with and without pf2e-dailies (one Morning
 * prompt per character, on the right client; the pf2e-dailies custom daily and its choice applied afterwards); standing
 * orders delivered through the pickup shelf with no GM; affixing with Talismanic Sage; and the Morning tab, photographed.
 *
 * Every step goes through the module's own functions or pf2e's (Rest for the Night, the pf2e-dailies interface driven by
 * clicks). Items the steps give characters are marked `flags.world.pf2e-artisans-workshop-m7`; `reset` takes them away
 * with everything the Morning stamped, puts each daily pool's prepared list and the formula book back as they were before
 * the first M7 step, and clears the Morning's own flags. Console output only: a developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { sweepClaims } from "../../scripts/foundry/claims.mjs";
import * as downtime from "../../scripts/foundry/downtime.mjs";
import * as expiry from "../../scripts/foundry/expiry.mjs";
import * as morning from "../../scripts/foundry/morning.mjs";
import { shared } from "../../scripts/foundry/state.mjs";
import { read, records } from "../../scripts/foundry/store.mjs";
import { openWorkshop, WorkshopApp } from "../../scripts/ui/workshop.mjs";

/** The mark on items the M7 steps give, and where a character's prepared lists and book are kept for `reset`. */
const MARK = `${MODULE_ID}-m7`;
const SAVED = `${MODULE_ID}-m7-saved`;

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

/** An item in brief, with what the Morning wrote on it. */
const itemBrief = (item) => ({
    id: item.id, uuid: item.uuid, name: item.name, qty: item.quantity ?? 1, temporary: !!item.system?.temporary,
    traits: [...(item.system?.traits?.value ?? [])], expiry: plain(item.flags?.[MODULE_ID]?.expiry ?? null), inert: item.flags?.[MODULE_ID]?.inert === true,
    dcStamp: plain(item.flags?.[MODULE_ID]?.dcStamp ?? null), shelf: plain(item.flags?.[MODULE_ID]?.shelf ?? null), affix: plain(item.flags?.[MODULE_ID]?.affix ?? null),
    description: item.system?.description?.value?.slice(0, 400) ?? "",
});

/** A character's Morning in brief: its cycle, record, stamped items and book. */
function morningBrief(actor) {
    const status = downtime.statusOf(actor);
    return {
        name: actor.name, uuid: actor.uuid, prepCycle: status.prepCycle, cycleKey: status.cycleKey ?? null, routine: !!status.standingRoutine,
        morning: plain(morning.morningOf(actor)), loadouts: plain(Object.values(morning.loadoutsOf(actor))),
        dailyCraftingComplete: actor.flags?.pf2e?.dailyCraftingComplete === true, dailiesRested: actor.flags?.["pf2e-dailies"]?.rested ?? null,
        stamped: actor.items.filter((i) => i.flags?.[MODULE_ID]?.expiry).map(itemBrief),
        book: (actor.system.crafting?.formulas ?? []).map((f) => f.uuid),
        provenance: Object.values(read(`formulas.${actor.id}`) ?? {}).map((p) => ({ uuid: p.uuid, route: p.route })),
    };
}

/** The daily pools of an actor as pf2e has them, in brief. */
async function poolsBrief(actor) {
    const facts = await morning.morningFacts(actor);
    return {
        state: facts.state, cycle: facts.status.prepCycle,
        pools: facts.pools.map((p) => ({ slug: p.slug, maxSlots: p.maxSlots, maxItemLevel: p.maxItemLevel, used: p.used, byLevel: p.byLevel,
            sources: p.sources.map((s) => ({ name: s.name, maxSlots: s.maxSlots })), offered: p.offered.map((i) => ({ uuid: i.uuid, name: i.name, level: i.level, usage: i.usage })),
            prepared: p.prepared.map((x) => ({ uuid: x.uuid, name: x.name, qty: x.quantity, expended: x.expended })) })),
        slots: facts.slots.map((s) => s.slug), vials: plain(facts.vials), gaps: plain(facts.gaps), dcs: plain(facts.dcs),
    };
}

/** The pf2e daily pools' prepared lists, to put back at `reset`. */
const preparedLists = (actor) => Object.fromEntries([...(actor.crafting?.abilities ?? [])].filter((a) => a.isDailyPrep)
    .map((a) => [a.slug, foundry.utils.deepClone(a.preparedFormulaData ?? [])]));

export const MORNING_SCENARIOS = {
    m7: {
        about: "M7: daily preparations, loadouts, standing orders, expiry, rest ordering, pf2e-dailies and the Morning tab.",
        reset: { about: "GM: take away the items earlier M7 steps gave or stamped on params.actors, put their pools and books back, clear the Morning's flags",
            run: async (p) => {
                const out = {};
                for (const uuid of p.actors) {
                    const actor = fromUuidSync(uuid);
                    const doomed = actor.items.filter((i) => i.flags?.world?.[MARK] || i.flags?.[MODULE_ID]?.expiry || i.flags?.[MODULE_ID]?.delivered).map((i) => i.id);
                    if (doomed.length) await actor.deleteEmbeddedDocuments("Item", doomed);
                    const saved = actor.flags?.world?.[SAVED];
                    if (saved) {
                        await actor.update({ "system.crafting.formulas": saved.book });
                        for (const ability of [...(actor.crafting?.abilities ?? [])].filter((a) => a.isDailyPrep)) {
                            if (saved.pools?.[ability.slug]) await ability.updateFormulas(saved.pools[ability.slug]);
                        }
                    } else {
                        await actor.update({ [`flags.world.${SAVED}`]: { book: foundry.utils.deepClone(actor._source.system.crafting?.formulas ?? []), pools: preparedLists(actor) } });
                    }
                    await actor.update({ [`flags.${MODULE_ID}.morning`]: _del, [`flags.${MODULE_ID}.loadouts`]: _del, [`flags.${MODULE_ID}.sageToken`]: _del,
                        "flags.pf2e.dailyCraftingComplete": false });
                    out[actor.name] = { removed: doomed.length, book: (actor.system.crafting?.formulas ?? []).length };
                }
                return out;
            } },
        modules: { about: "GM: turn pf2e-dailies (and lib-wrapper) on or off (params.dailies); the pages must reload to load it", run: async (p) => {
            const config = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
            const before = { dailies: !!config["pf2e-dailies"], libWrapper: !!config["lib-wrapper"] };
            config["pf2e-dailies"] = !!p.dailies;
            if (p.dailies) config["lib-wrapper"] = true;
            await game.settings.set("core", "moduleConfiguration", config);
            return { before, after: { dailies: !!p.dailies } };
        } },
        active: { about: "any client: whether pf2e-dailies is active here, and whether its API took the Workshop's daily", run: async () => ({
            dailies: game.modules.get("pf2e-dailies")?.active === true, api: typeof game.dailies?.api?.registerCustomDailies === "function",
        }) },
        give: { about: "GM: give params.actor an item from params.uuid with params.system merged, marked for reset", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const source = game.items.fromCompendium(await fromUuid(p.uuid), { keepId: false });
            foundry.utils.mergeObject(source, { system: p.system ?? {}, flags: { world: { [MARK]: true } } });
            const [item] = await actor.createEmbeddedDocuments("Item", [source]);
            return { uuid: item.uuid, id: item.id, name: item.name };
        } },
        learn: { about: "GM: add params.uuids to params.actor's formula book (put back by reset)", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const book = foundry.utils.deepClone(actor._source.system.crafting?.formulas ?? []);
            for (const uuid of p.uuids) if (!book.some((f) => f.uuid === uuid)) book.push({ uuid });
            await actor.update({ "system.crafting.formulas": book });
            return { book: book.map((f) => f.uuid) };
        } },
        facts: { about: "any client: params.actor's daily sources as the Morning reads them", run: async (p) => poolsBrief(actorOf(p)) },
        state: { about: "any client: params.actors' Morning in brief (cycle, record, stamped items), after params.ms", run: async (p) => {
            await sleep(p.ms ?? 0);
            return { actors: (p.actors ?? [game.user.character.uuid]).map((uuid) => morningBrief(fromUuidSync(uuid))),
                strongbox: (shared().strongbox?.items ?? []).filter((i) => i.flags?.[MODULE_ID]?.expiry).map(itemBrief),
                claims: records("claims").filter((c) => c.kind === "expiry").map((c) => ({ actor: c.actor, cycle: c.cycle, resolved: !!c.resolved })),
                standing: records("standing").map((s) => ({ id: s.id, active: s.active, last: plain(s.last) })), today: plain(downtime.today()) };
        } },
        loadout: { about: "owner: save a loadout on params.actor (params.name, params.pools, params.talismans), or capture the current one (params.capture)",
            run: async (p) => plain(p.capture ? await morning.captureLoadout(actorOf(p), p.name) : await morning.saveLoadout(actorOf(p), { name: p.name, pools: p.pools ?? {}, talismans: p.talismans ?? {} })) },
        prepare: { about: "owner: make params.actor's daily preparations (params.pools, params.talismans, params.standing, params.again)", run: async (p) => {
            const actor = actorOf(p);
            const result = await morning.applyMorning(actor, { pools: p.pools ?? {}, talismans: p.talismans ?? {}, standing: p.standing ?? "due", again: !!p.again });
            await sleep(p.ms ?? 1000);
            return { result: plain(result), brief: morningBrief(actor) };
        } },
        standing: { about: "requester's owner: place a standing order (params.requester, params.crafter, params.uuid, params.qty, params.pool)", run: async (p) => plain(
            await morning.placeStanding({ requester: p.requester ?? game.user.character.uuid, crafter: p.crafter, uuid: p.uuid, qty: p.qty ?? 1, pool: p.pool ?? "advanced-alchemy" })) },
        rest: { about: "this client: pf2e's Rest for the Night for params.actors, without its dialog (as from the party sheet when several)", run: async (p) => {
            const actors = p.actors.map((uuid) => fromUuidSync(uuid));
            const messages = await game.pf2e.actions.restForTheNight({ actors, skipDialog: true });
            await sleep(p.ms ?? 0);
            return { messages: (messages ?? []).map((m) => m.id) };
        } },
        dailies: { about: "owner: open pf2e-dailies' interface for params.actor, choose params.choices in the Workshop's rows, accept, then wait params.ms",
            run: async (p) => {
                const actor = actorOf(p);
                await game.dailies.api.openDailiesInterface(actor);
                const root = await waitFor(() => document.getElementById(`pf2e-dailies-interface-${actor.uuid}`), 10000);
                if (!root) return { opened: false };
                const rows = [...root.querySelectorAll("[data-daily]")].filter((el) => el.dataset.daily.endsWith("pf2e-artisans-workshop.morning"));
                for (const [slug, value] of Object.entries(p.choices ?? {})) {
                    const select = rows.find((el) => el.dataset.row === slug);
                    if (select) {
                        select.value = value;
                        select.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                }
                root.querySelector('[data-action="accept"]')?.click();
                await sleep(p.ms ?? 4000);
                return { opened: true, rows: rows.map((el) => ({ row: el.dataset.row, value: el.value })), brief: morningBrief(actor) };
            } },
        move: { about: "GM: move params.qty of params.item (a UUID) to params.to (an actor UUID), flags and all, as a trade would", run: async (p) => {
            const item = fromUuidSync(p.item);
            const to = fromUuidSync(p.to);
            const qty = Math.min(p.qty ?? 1, item.quantity);
            const source = item.toObject();
            delete source._id;
            source.system.quantity = qty;
            const [moved] = await to.createEmbeddedDocuments("Item", [source]);
            if (item.quantity > qty) await item.update({ "system.quantity": item.quantity - qty });
            else await item.delete();
            return { moved: moved.uuid, name: moved.name };
        } },
        clock: { about: "GM: advance world time by params.seconds", run: async (p) => {
            await game.time.advance(p.seconds);
            await sleep(p.ms ?? 2000);
            return { worldTime: game.time.worldTime };
        } },
        sweep: { about: "any client: run the expiry sweep and collect what waits for the user's characters", run: async () => ({
            expired: plain(await expiry.expirySweep()), taken: await sweepClaims({ force: true }),
        }) },
        affix: { about: "owner: affix params.talisman to params.host (item ids) on params.actor, or take it off (params.off); returns the board",
            run: async (p) => {
                const actor = actorOf(p);
                const result = p.off ? await morning.unaffixOwn(actor, p.talisman) : await morning.affixOwn(actor, p.talisman, p.host);
                return { result: plain(result), board: plain(morning.affixBoardOf(actor)) };
            } },
        open: { about: "any client: open the Workshop on the Morning tab for params.actor with params.talismans picked; returns what it shows", run: async (p) => {
            await WorkshopApp.instance?.close({ animate: false });
            await waitFor(() => !WorkshopApp.instance, 3000);
            const shown = await openWorkshop({ tab: "morning", actor: p.actor ?? null });
            shown.morning = { actor: p.actor ?? null, plans: p.plans ?? {}, talismans: p.talismans ?? {}, skipped: [], loadoutName: "" };
            await shown.render({ parts: ["morning", "nav"] });
            shown.setPosition({ left: 12, top: 12 });
            await sleep(p.ms ?? 1500);
            const el = shown.element;
            return { open: !!el?.isConnected, tab: shown.tabGroups.primary, pools: el?.querySelectorAll(".morning-pool").length ?? 0,
                offered: el?.querySelectorAll(".talisman-picker li").length ?? 0, lines: el?.querySelectorAll(".pool-lines li").length ?? 0,
                badge: el?.querySelector('[data-tab="morning"] .tab-badge')?.textContent ?? null, hasStyles: getComputedStyle(el).containerType === "inline-size" };
        } },
        close: { about: "any client: close the Workshop", run: async () => {
            await WorkshopApp.instance?.close();
            return { closed: true };
        } },
    },
};
