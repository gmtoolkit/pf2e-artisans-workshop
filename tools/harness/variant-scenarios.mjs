/**
 * Live-harness steps for M9a (DESIGN.md 6.16, 15.3 scenario 13), merged into the scenarios of `sync-scenarios.mjs` as
 * scenario `m9a`. The live driver's behaviour checks (`live-plans.mjs`, the `m9a-*` plans) run them, with M9's steps for
 * filing and working orders (`m9`: request, run, learn, give, setting, collect, made, logDay): a Complex Crafting order rushed
 * in setup and in finishing, with its flat check; Quick Setup recorded on a day spent on something else; a Deconstruct that
 * funds a follow-on; a Grow order left untended across a season with no GM online; a garden funded by two players and
 * harvested once a day; a quest whose last two components are marked at once; a host with an adjustment delivered to another
 * PC; a secret Critical Crafting roll.
 *
 * Every step goes through the module's own functions, as the window's buttons do. `reset` turns every variant back to its
 * default (off) and takes away what the steps gave; a fixture lent to a player is given back. Console output only: a developer
 * tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { mixedGroups, variantGroupsOn } from "../../scripts/logic/variants.mjs";
import { logEntries } from "../../scripts/logic/orders.mjs";
import { handOver } from "../../scripts/foundry/custody.mjs";
import * as deconstruct from "../../scripts/foundry/deconstruct.mjs";
import * as downtime from "../../scripts/foundry/downtime.mjs";
import * as nature from "../../scripts/foundry/nature.mjs";
import * as orders from "../../scripts/foundry/orders.mjs";
import * as quests from "../../scripts/foundry/quests.mjs";
import { rollCraft } from "../../scripts/foundry/rolls.mjs";
import { RULE_SETTINGS, rulesFromSettings } from "../../scripts/foundry/settings.mjs";
import { shared } from "../../scripts/foundry/state.mjs";
import { read, records, stampNow, write } from "../../scripts/foundry/store.mjs";
import * as variants from "../../scripts/foundry/variants.mjs";
import { orderContext } from "../../scripts/ui/context.mjs";

/** Where a fixture's ownership is kept while it is lent to a player. */
const LENT = `${MODULE_ID}-m9a-lent`;

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

/** An order in brief, with its M9a fields, its day records and its transitions. */
function brief(id) {
    const order = read(`orders.${id}`);
    if (!order) return null;
    const check = order.check ?? null;
    return {
        id, status: order.status, craftType: order.craftType, attempt: order.attempt, priceCp: order.priceCp, upfrontCp: order.upfrontCp, skill: order.skill,
        setup: plain(order.setup ?? null), dc: order.dc ? { final: order.dc.final, adjust: order.dc.adjust ?? 0 } : null, variant: plain(order.variant ?? {}),
        check: check && { degree: check.degree, die: check.die ?? null, settled: !!check.settled, secret: !!check.secret, revealed: !!check.revealed,
            critical: plain(check.critical ?? null), rushFlat: plain(check.rushFlat ?? null) },
        days: records("days").filter((d) => d.order === id).map((d) => ({ id: d.id, day: d.day, kind: d.kind, actor: d.actor ?? null, rushed: !!d.rushed,
            season: d.season ?? null, attempt: d.attempt })),
        log: logEntries(order).map((e) => ({ seq: e.seq, event: e.event, from: e.from, to: e.to })),
        shelf: (shared().strongbox?.items ?? []).filter((i) => i.flags?.[MODULE_ID]?.crafted?.order === id).map((i) => i.name),
        flatCards: game.messages.contents.filter((m) => m.flags?.[MODULE_ID]?.rushFlat?.order === id).length,
    };
}

/** An item in brief, with what M9a puts on it. */
const itemBrief = (item) => ({
    id: item.id, uuid: item.uuid, name: item.name, qty: item.quantity ?? 1, temporary: !!item.system?.temporary,
    components: plain(item.flags?.[MODULE_ID]?.components ?? null), inert: !!item.flags?.[MODULE_ID]?.inert, appliedTo: plain(item.flags?.[MODULE_ID]?.appliedTo ?? null),
    produce: plain(item.flags?.[MODULE_ID]?.produce ?? null), expiry: plain(item.flags?.[MODULE_ID]?.expiry ?? null), crafted: plain(item.flags?.[MODULE_ID]?.crafted ?? null),
});

/** Whether a step gave the item or an M9a order changed it. */
const isM9a = (item) => item.flags?.world?.[`${MODULE_ID}-m9a`] || item.flags?.[MODULE_ID]?.components || item.flags?.[MODULE_ID]?.produce || item.flags?.[MODULE_ID]?.curse;

export const VARIANT_SCENARIOS = {
    m9a: {
        about: "M9a: the Treasure Vault (Remastered) variants: Complex Crafting, Deconstruct, Grow, gardens, quests, adjustments, Critical Crafting.",
        reset: { about: "GM: every variant setting back to its default (off); components, produce and curses taken off params.actors; lent fixtures given back",
            run: async (p) => {
                for (const entry of RULE_SETTINGS.filter((s) => s.variant)) {
                    const config = game.settings.settings.get(`${MODULE_ID}.${entry.key}`);
                    if (config && game.settings.get(MODULE_ID, entry.key) !== config.default) await game.settings.set(MODULE_ID, entry.key, config.default);
                }
                const out = {};
                for (const uuid of p.actors ?? []) {
                    const actor = fromUuidSync(uuid);
                    const doomed = actor.items.filter(isM9a).map((i) => i.id);
                    if (doomed.length) await actor.deleteEmbeddedDocuments("Item", doomed);
                    const lent = actor.flags?.world?.[LENT];
                    if (lent) {
                        const ownership = Object.fromEntries(Object.keys(actor._source.ownership).map((id) => [`ownership.${id}`, id in lent ? lent[id] : _del]));
                        await actor.update({ ...ownership, [`flags.world.${LENT}`]: _del });
                    }
                    out[actor.name] = { removed: doomed.length, returned: !!lent };
                }
                return out;
            } },
        variants: { about: "GM: set variant settings (params.on: {settingKey: value}); the groups now on and whether they mix", run: async (p) => {
            for (const [key, value] of Object.entries(p.on ?? {})) await game.settings.set(MODULE_ID, key, value);
            const rules = rulesFromSettings();
            return { groups: variantGroupsOn(rules), mixed: mixedGroups(rules) };
        } },
        notice: { about: "GM: open Settings on the module's tab; whether the one-group-at-a-time notice shows", run: async () => {
            const app = new foundry.applications.settings.SettingsConfig();
            await app.render({ force: true });
            await sleep(500);
            const category = app.element?.querySelector(`[data-category="${MODULE_ID}"]`);
            const notice = category?.querySelector("p.notification.warning")?.textContent?.trim() ?? null;
            await app.close();
            return { notice };
        } },
        lend: { about: "GM: make the user named params.user an owner of params.actor for the run (given back by reset)", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const user = game.users.getName(p.user);
            if (!actor.flags?.world?.[LENT]) await actor.update({ [`flags.world.${LENT}`]: foundry.utils.deepClone(actor._source.ownership) });
            await actor.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
            return { owner: actor.testUserPermission(user, "OWNER") };
        } },
        forget: { about: "GM: take params.uuids out of params.actor's formula book (put back by m9's reset)", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const book = (actor._source.system.crafting?.formulas ?? []).filter((f) => !p.uuids.includes(f.uuid));
            await actor.update({ "system.crafting.formulas": book });
            return { book: book.map((f) => f.uuid) };
        } },
        order: { about: "any client, after params.ms: params.order in brief (variant, check, days, transitions, shelf)", run: async (p) => {
            await sleep(p.ms ?? 0);
            return brief(p.order);
        } },
        rush: { about: "the crafter's owner: choose params.rush days of rushed setup for params.order", run: async (p) => ({ result: plain(await variants.chooseRush(p.order, p.rush)),
            order: brief(p.order) }) },
        start: { about: "the crafter's owner: accept params.order as params.crafter if it is requested, pledge params.pledge from params.payer, start it", run: async (p) => {
            const out = {};
            if (read(`orders.${p.order}.status`) === "requested") out.accept = plain(await orders.accept(p.order, p.crafter));
            if (p.pledge) out.pledge = plain(await orders.pledgeTo(p.order, p.payer, p.pledge));
            out.start = plain(await orders.start(p.order));
            return { ...out, order: brief(p.order) };
        } },
        setUpNow: { about: "the crafter's owner: Set up now on params.order (a setup of hours)", run: async (p) => ({ result: plain(await variants.setUpNow(p.order)),
            order: brief(p.order) }) },
        work: { about: "the crafter's owner: params.count work days on params.order (stops when it leaves params.while, if given)", run: async (p) => {
            const out = [];
            for (let i = 0; i < (p.count ?? 1); i++) {
                if (p.while && !p.while.includes(read(`orders.${p.order}.status`))) break;
                out.push(plain(await orders.workDay(p.order)));
            }
            return { results: out, order: brief(p.order) };
        } },
        roll: { about: "the crafter's owner: roll params.order's check without the dialog; wait until it is recorded", run: async (p) => {
            const result = plain(await rollCraft(p.order, { skipDialog: true }));
            await waitFor(() => read(`orders.${p.order}.status`) === "rolled", 10000);
            return { result, order: brief(p.order) };
        } },
        rushFinish: { about: "the crafter's owner: rush params.order's finishing (params.on)", run: async (p) => ({ result: plain(await variants.setRushFinish(p.order, p.on !== false)),
            order: brief(p.order) }) },
        finish: { about: "the crafter's owner: pledge what is left of params.order from params.payer, then finish it", run: async (p) => {
            const order = read(`orders.${p.order}`);
            const escrow = records("rows").filter((r) => r.order === p.order).reduce((s, r) => s + (r.alloc ?? 0), 0);
            const left = Math.max(0, order.priceCp - order.upfrontCp - escrow);
            const pledge = left > 0 ? plain(await orders.pledgeTo(p.order, p.payer, left)) : null;
            return { pledge, result: plain(await orders.finish(p.order)), order: brief(p.order) };
        } },
        special: { about: "the requester's or crafter's owner: mark params.order special (params.on)", run: async (p) => plain(await variants.setSpecial(p.order, p.on !== false)) },
        view: { about: "any client, after params.ms: params.order's check as this user's Queue shows it, and its last check card", run: async (p) => {
            await sleep(p.ms ?? 0);
            const order = read(`orders.${p.order}`);
            const context = order ? await orderContext(order) : null;
            const link = `:order:${p.order}:`;
            const message = game.messages.contents.filter((m) => m.flags?.pf2e?.context?.options?.some?.((o) => typeof o === "string" && o.includes(link))).at(-1) ?? null;
            return { checkText: context?.checkText ?? null, secretCheck: !!context?.secretCheck, blind: message?.blind ?? null,
                visible: message ? message.isContentVisible : null, user: game.user.name };
        } },
        reveal: { about: "GM: reveal params.order's secret check", run: async (p) => ({ result: plain(await variants.revealCheck(p.order)), order: brief(p.order) }) },
        checklist: { about: "the crafter's owner: confirm params.key (workshop, grow-tools, similar) on params.order", run: async (p) =>
            plain(await deconstruct.confirmChecklist(p.order, p.key, p.on !== false)) },
        followOn: { about: "the crafter's owner: name params.followOn as the order params.order's components fund", run: async (p) =>
            plain(await deconstruct.chooseFollowOn(p.order, p.followOn)) },
        handOver: { about: "the item's owner: hand params.item over as material for params.order", run: async (p) => ({
            result: plain(await handOver({ order: p.order, item: p.item, purpose: "material" })), order: brief(p.order) }) },
        items: { about: "any client, after params.ms: params.actor's items made or changed by M9a (params.order: only that order's)", run: async (p) => {
            await sleep(p.ms ?? 0);
            const actor = actorOf(p);
            const mine = actor.items.filter((i) => isM9a(i) || i.flags?.[MODULE_ID]?.crafted)
                .filter((i) => !p.order || i.flags?.[MODULE_ID]?.crafted?.order === p.order || i.flags?.[MODULE_ID]?.components?.order === p.order);
            return { items: mine.map(itemBrief), today: downtime.today().day };
        } },
        actorDays: { about: "any client, after params.ms: every day record of params.actor (or the user's character)", run: async (p) => {
            await sleep(p.ms ?? 0);
            const actor = actorOf(p);
            return records("days").filter((d) => d.actor === actor.id).map((d) => ({ id: d.id, day: d.day, kind: d.kind ?? null, order: d.order ?? null,
                activity: plain(d.activity ?? null), result: d.result ?? null }));
        } },
        untended: { about: "the crafter's owner: leave the Grow order params.order untended (params.on)", run: async (p) => ({
            result: plain(await nature.setUntended(p.order, p.on !== false)), order: brief(p.order) }) },
        logDays: { about: "any client: log params.days days ahead of the clock in the ledger (the wizard's manual days); no GM needed", run: async (p) => {
            const now = downtime.today();
            const id = `m9a${Date.now().toString(36)}`;
            await write({ set: { [`meta.manual.${id}`]: { fromDay: now.day + 1, toDay: now.day + (p.days ?? 1), ...stampNow() } } });
            return { from: now.day, to: downtime.today().day };
        } },
        seasons: { about: "any client, after params.ms: the season checks params.order has due, and its season records", run: async (p) => {
            await sleep(p.ms ?? 0);
            const order = read(`orders.${p.order}`);
            return { due: plain(nature.seasonChecksDue(order)), records: brief(p.order)?.days.filter((d) => d.kind === "season") ?? [], today: downtime.today().day };
        } },
        rollSeason: { about: "the crafter's owner: roll params.order's due season check without the dialog; wait until it is recorded", run: async (p) => {
            const result = plain(await nature.rollSeason(p.order, null, { skipDialog: true }));
            const recorded = await waitFor(() => records("days").some((d) => d.order === p.order && d.kind === "season"), 10000);
            return { result, recorded: !!recorded, order: brief(p.order) };
        } },
        addGarden: { about: "any member: add a garden of params.uuid (params.name)", run: async (p) => plain(await nature.addGarden({ name: p.name ?? "", uuid: p.uuid })) },
        fundGarden: { about: "any member: pledge params.cp from the user's character's purse to garden params.garden", run: async (p) =>
            plain(await nature.fundGarden(p.garden, { source: "purse", actor: actorOf(p).uuid, cp: p.cp })) },
        garden: { about: "any client, after params.ms: garden params.garden, its plant rows and its harvests", run: async (p) => {
            await sleep(p.ms ?? 0);
            const garden = read(`gardens.${p.garden}`);
            return { garden: plain(garden), plants: records("rows").filter((r) => r.kind === "plant" && r.garden === p.garden).map((r) => ({ cp: r.cp, actor: r.actor ?? null })),
                today: downtime.today().day };
        } },
        harvest: { about: "any member: harvest garden params.garden onto the user's character", run: async (p) => plain(await nature.harvest(p.garden, actorOf(p).uuid)) },
        found: { about: "any member: mark component params.component of quest params.order found by the user's character", run: async (p) =>
            plain(await quests.markFound(p.order, p.component, { actor: game.user.character?.uuid ?? null })) },
    },
};
