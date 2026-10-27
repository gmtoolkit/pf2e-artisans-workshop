/**
 * Live-harness steps for the order lifecycle, the Queue and Funds tabs and their races (DESIGN.md 4.2.3, 10, 15.3;
 * milestone M4), merged into the scenarios of `sync-scenarios.mjs` as scenario `m4`. The live driver's behaviour checks
 * (`live-plans.mjs`) run them: the lifecycle with a GM and two players, the same with no GM online and the recipient
 * offline at the finish, a cancel with refunds, the double-delivery race, the reroll-against-settlement race, and the
 * screenshots of the Workshop window.
 *
 * Every step goes through the module's own functions, as the window's buttons do. Console output only: a developer
 * tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import { holdingsOf, valueCp } from "../../scripts/logic/coins.mjs";
import { hashId, idemKey } from "../../scripts/logic/ids.mjs";
import { lockFirstBatch, recreateLockId } from "../../scripts/logic/lock-first.mjs";
import { makeRow } from "../../scripts/logic/rows.mjs";
import { toOperations, runRequest } from "../../scripts/foundry/batch.mjs";
import { coinStacks } from "../../scripts/foundry/coins.mjs";
import { sweepClaims, sweepDeliveries } from "../../scripts/foundry/claims.mjs";
import { deposit } from "../../scripts/foundry/funds.mjs";
import * as orders from "../../scripts/foundry/orders.mjs";
import { reconciliationReport } from "../../scripts/foundry/reconcile.mjs";
import { rollCraft } from "../../scripts/foundry/rolls.mjs";
import { shared, status } from "../../scripts/foundry/state.mjs";
import { newId, read, records, stampNow, write } from "../../scripts/foundry/store.mjs";
import { openWorkshop, WorkshopApp } from "../../scripts/ui/workshop.mjs";
import { parseLink } from "../../scripts/logic/rolls.mjs";
import { withDie } from "./craft-scenarios.mjs";

const purseCp = (actor) => valueCp(holdingsOf(coinStacks(actor)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(test, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = await test();
        if (value) return value;
        await sleep(200);
    }
    return null;
}

/** A step's result as plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

/** The order in brief: its state, money and rows, as this client sees it. */
function brief(id) {
    const order = read(`orders.${id}`);
    if (!order) return null;
    const rows = records("rows").filter((row) => row.order === id);
    return {
        id, status: order.status, attempt: order.attempt, crafter: order.crafter, priceCp: order.priceCp, upfrontCp: order.upfrontCp,
        dc: order.dc?.final ?? null, route: order.route, check: order.check ? { degree: order.check.degree, messageId: order.check.messageId, settled: !!order.check.settled } : null,
        conflict: order.conflict ? { degree: order.conflict.degree, messageId: order.conflict.messageId } : null,
        settlement: order.settlement ? { attempt: order.settlement.attempt, messageId: order.settlement.check?.messageId ?? null } : null,
        log: Object.values(order.log ?? {}).sort((a, b) => a.seq - b.seq).map((e) => e.event),
        rows: rows.map((row) => ({ kind: row.kind, cp: row.cp, state: row.state, actor: row.actor, reversed: !!row.reversedBy })),
        days: records("days").filter((d) => d.order === id).map((d) => ({ kind: d.kind, day: d.day, crafterCp: d.crafterCp ?? null })),
    };
}

/** The newest chat message linked to an order's check. */
const linkedMessage = (id) => game.messages.contents.filter((m) => parseLink(m.flags?.pf2e?.context?.options)?.id === id).at(-1) ?? null;

export const ORDER_SCENARIOS = {
    m4: {
        about: "M4: the order lifecycle, the Queue and Funds tabs and their races.",
        request: { about: "any client: file a request for params.product × params.quantity (default 1) from the user's character", run: async (p) => {
            const requester = game.user.character;
            const result = await orders.requestOrder({ uuid: p.product, quantity: p.quantity ?? 1, requester: requester.uuid,
                recipient: p.strongbox ? { kind: "strongbox" } : { kind: "actor", uuid: p.recipient ?? requester.uuid }, crafter: p.crafter ?? null, note: p.note ?? "" });
            return plain({ ...result, order: result.orders?.[0] ?? null });
        } },
        pledge: { about: "any client: pledge params.cp from the user's character to params.order", run: async (p) => plain(await orders.pledgeTo(p.order, game.user.character.uuid, p.cp)) },
        deposit: { about: "any client: deposit params.cp into the party fund", run: async (p) => plain(await deposit(game.user.character.uuid, p.cp)) },
        accept: { about: "the crafter's owner: accept params.order as the user's character", run: async (p) => plain(await orders.accept(p.order, game.user.character.uuid)) },
        start: { about: "the crafter's owner: start params.order", run: async (p) => plain(await orders.start(p.order)) },
        work: { about: "the crafter's owner: work days on params.order until its state is params.until (or once)", run: async (p) => {
            const results = [];
            for (let i = 0; i < (p.max ?? 6); i++) {
                results.push(plain(await orders.workDay(p.order)));
                if (!p.until || read(`orders.${p.order}.status`) === p.until || !results.at(-1).ok) break;
            }
            return { results, order: brief(p.order) };
        } },
        roll: { about: "the crafter's owner: roll params.order's Craft check (no dialog; the die at params.face when given); wait until it is recorded",
            run: async (p) => {
                const result = await withDie(p.face, () => rollCraft(p.order, { skipDialog: true }));
                const recorded = await waitFor(() => read(`orders.${p.order}.status`) === "rolled");
                return { result: plain(result), recorded: !!recorded, order: brief(p.order) };
            } },
        reroll: { about: "the message's author or a GM: reroll params.order's last check message with a Hero Point (params.resource)", run: async (p) => {
            const message = linkedMessage(p.order);
            await game.pf2e.Check.rerollFromMessage(message, p.resource === "none" ? { keep: "new" } : { resource: p.resource ?? "hero-points" });
            await sleep(p.ms ?? 1500);
            return { first: message?.id ?? null, order: brief(p.order) };
        } },
        settle: { about: "the crafter's owner: settle params.order", run: async (p) => ({ result: plain(await orders.settle(p.order)), order: brief(p.order) }) },
        finish: { about: "the crafter's owner: finish params.order", run: async (p) => ({ result: plain(await orders.finish(p.order)), order: brief(p.order) }) },
        cancel: { about: "the requester's or crafter's owner: cancel params.order", run: async (p) => ({ result: plain(await orders.cancel(p.order)), order: brief(p.order) }) },
        undo: { about: "the maker of the last step, an owner or a GM: undo params.order's last step", run: async (p) => ({ result: plain(await orders.undo(p.order)), order: brief(p.order) }) },
        take: { about: "any client: collect what waits for the user's characters (claims and shelf items)", run: async () => ({ taken: await sweepClaims({ force: true }) }) },
        state: { about: "any client, after params.ms: params.order in brief, purses, the strongbox and reconciliation", run: async (p) => {
            await sleep(p.ms ?? 0);
            const report = reconciliationReport();
            return {
                status: status(), order: p.order ? brief(p.order) : null,
                purse: game.user.character ? purseCp(game.user.character) : null,
                strongbox: shared().strongbox ? purseCp(shared().strongbox) : null,
                shelf: shared().strongbox?.items.filter((i) => i.flags?.[MODULE_ID]?.shelf).map((i) => ({ id: i.id, for: i.flags[MODULE_ID].shelf.for })) ?? [],
                delivered: game.user.character?.items.filter((i) => i.flags?.[MODULE_ID]?.delivered).map((i) => ({ name: i.name, qty: i.quantity, row: i.flags[MODULE_ID].delivered.row })) ?? [],
                reconcile: { expected: report.expectedCp, actual: report.actualCp, pending: report.pending.length },
                cards: p.order ? game.messages.contents.filter((m) => m.flags?.[MODULE_ID]?.card?.order === p.order).map((m) => m.flags[MODULE_ID].card.kind) : [],
                claims: records("claims").filter((c) => !p.order || c.order === p.order).map((c) => ({ kind: c.kind, cp: c.cp, actor: c.actor, resolved: !!c.resolved })),
            };
        } },
        waitStatus: { about: "any client: wait until params.order is params.status (params.ms)", run: async (p) => ({
            reached: !!(await waitFor(() => read(`orders.${p.order}.status`) === p.status, p.ms ?? 15000)), order: brief(p.order) }) },
        waitDelivered: { about: "the recipient's client: wait until params.name arrives on the user's character", run: async (p) => {
            const item = await waitFor(() => game.user.character.items.find((i) => i.name === p.name && i.flags?.[MODULE_ID]?.delivered), p.ms ?? 20000);
            return { delivered: !!item, count: game.user.character.items.filter((i) => i.name === p.name && i.flags?.[MODULE_ID]?.delivered).length };
        } },
        // The double-delivery race (5.11): a delivery whose lock request lands and whose apply request is held back; the
        // recipient's client re-creates it once the row is past the grace time; then the held apply request reaches the
        // server, past this client's own checks, and must be refused at the lock the re-creation took.
        strandDelivery: { about: "the recipient's owner: shelve params.product for the user's character, then send only its delivery's lock request", run: async (p) => {
            const actor = game.user.character;
            const box = shared().strongbox;
            const source = (await fromUuid(p.product)).toObject();
            delete source._id;
            const key = idemKey("deliver", "race", newId());
            foundry.utils.setProperty(source, `flags.${MODULE_ID}.shelf`, { for: actor.uuid, from: actor.uuid, order: null, claimKey: key, at: stampNow().at });
            const [item] = await box.createEmbeddedDocuments("Item", [source]);
            const current = box.items.get(item.id);
            const delivered = current.toObject();
            delete delivered._id;
            delete delivered.flags[MODULE_ID].shelf;
            delivered.flags[MODULE_ID].delivered = { row: hashId(key) };
            const row = makeRow({ kind: "delivered", idem: key, cp: 0, actor: actor.uuid, items: [{ uuid: null, name: current.name, qty: current.quantity, source: delivered }] }, stampNow());
            const batch = lockFirstBatch({ rowIds: [row.id], lockIds: [row.id, current.id], ledger: { set: { [`rows.${row.id}`]: row } },
                debits: [{ target: "strongbox", plan: { deletes: [current.id] } }], items: [{ target: actor.uuid, data: [delivered] }], mark: recreateLockId(row.id) });
            const locked = await runRequest(batch.lock);
            globalThis.__m4HeldApply = batch.apply;
            return { row: row.id, item: item.id, locked: plain(locked), mark: batch.apply[0]?.ids?.[0] ?? null };
        } },
        recreate: { about: "the recipient's owner: run the delivery sweep now (a row past the grace time is re-created)", run: async () => ({ finished: await sweepDeliveries() }) },
        sendHeldApply: { about: "the client that stranded the delivery: send its held apply request straight to the server", run: async () => {
            const apply = globalThis.__m4HeldApply;
            if (!apply) return { sent: false };
            delete globalThis.__m4HeldApply;
            let error = null;
            let results = null;
            const dryRun = [];
            const watch = (doc, ...rest) => { if (rest.some((arg) => arg?.dryRun)) dryRun.push(doc?.documentName ?? null); };
            const hooks = ["createItem", "createJournalEntryPage", "updateJournalEntry"].map((name) => [name, Hooks.on(name, watch)]);
            try {
                results = await foundry.documents.modifyBatch(toOperations(apply, shared()));
            } catch (e) {
                error = e.message;
            } finally {
                for (const [name, id] of hooks) Hooks.off(name, id);
            }
            await sleep(1000);
            // A request the server refuses at its dry run still returns the replayed results of its world-level operations
            // (DESIGN.md 5.4, Dry-run replay), marked dryRun on their hooks; the server's own copy is what counts.
            return { sent: true, results: Array.isArray(results) ? results.length : null, dryRun, error };
        } },
        // The reroll-against-settlement race (6.12): the state a reroll's write leaves when it lands after the settlement,
        // written by any client; the crafter's responsible client must repair it by itself, once.
        lateReroll: { about: "any client: overwrite params.order's settled check with an unsettled reroll, as a late write would", run: async (p) => {
            const order = read(`orders.${p.order}`);
            const reroll = { ...order.check, degree: p.degree ?? 0, messageId: p.messageId ?? "late-reroll", rerolled: true, settled: false };
            await write({ replace: { [`orders.${p.order}.check`]: reroll } });
            return { wrote: reroll.messageId };
        } },
        // Screenshots: orders in every state the Queue shows, then the window opened on a tab in a colour scheme.
        seed: { about: "GM: orders in several states for the screenshots (params.products: uuids), with pledges and a deposit", run: async (p) => seedOrders(p) },
        theme: { about: "any client: the colour scheme of applications and interface (params.scheme: dark or light)", run: async (p) => {
            const current = game.settings.get("core", "uiConfig");
            const config = foundry.utils.deepClone(current?.toObject?.() ?? current);
            config.colorScheme = { applications: p.scheme, interface: p.scheme };
            await game.settings.set("core", "uiConfig", config);
            await sleep(300);
            return { scheme: document.body.classList.contains(`theme-${p.scheme}`) ? p.scheme : null };
        } },
        open: { about: "any client: open the Workshop on params.tab (and params.order's detail), at its default size", run: async (p) => {
            await WorkshopApp.instance?.close({ animate: false });
            await waitFor(() => !WorkshopApp.instance, 3000);
            const app = await openWorkshop({ tab: p.tab ?? "queue", order: p.order ?? null });
            app.setPosition({ left: 12, top: 12 });
            await sleep(p.ms ?? 1200);
            const el = app.element;
            return { open: !!el?.isConnected, width: el?.offsetWidth ?? null, height: el?.offsetHeight ?? null,
                rows: el?.querySelectorAll(".order-row").length ?? 0, tab: app.tabGroups.primary, hasStyles: getComputedStyle(el).containerType === "inline-size" };
        } },
        close: { about: "any client: close the Workshop", run: async () => {
            await WorkshopApp.instance?.close();
            return { closed: true };
        } },
    },
};

/**
 * The GM seeds orders for the screenshots through the module's own functions, acting for each character as its owner
 * would: a request, one accepted and blocked, one in setup, one rolled, one finishing, one complete, one cancelled.
 */
async function seedOrders({ products, crafter, requester, other }) {
    const as = (uuid) => fromUuidSync(uuid);
    const out = {};
    const file = async (product, quantity, by, extra = {}) => (await orders.requestOrder({ uuid: product, quantity, requester: by, ...extra })).orders?.[0];
    const [a, b, c, d] = products;
    out.requested = await file(a, 2, requester);
    await orders.pledgeTo(out.requested, requester, 150);
    out.blocked = await file(b, 1, other);
    await orders.accept(out.blocked, crafter);
    out.setup = await file(a, 2, requester);
    await orders.pledgeTo(out.setup, requester, 300);
    await orders.accept(out.setup, crafter);
    out.setupStart = plain(await orders.start(out.setup));
    out.finishing = await file(c, 1, other);
    const finishingPrice = read(`orders.${out.finishing}.product.snapshot.priceCp`) ?? 0;
    await orders.pledgeTo(out.finishing, other, Math.ceil(finishingPrice / 2) + 100);
    await orders.accept(out.finishing, crafter);
    out.finishingStart = plain(await orders.start(out.finishing));
    for (let i = 0; i < 3 && read(`orders.${out.finishing}.status`) === "setup"; i++) await orders.workDay(out.finishing);
    out.finishingRoll = plain(await rollCraft(out.finishing, { skipDialog: true }));
    await waitFor(() => read(`orders.${out.finishing}.status`) === "rolled", 10000);
    for (let i = 0; i < 2; i++) await orders.workDay(out.finishing);
    out.complete = await file(d ?? a, 1, requester);
    const completePrice = read(`orders.${out.complete}.product.snapshot.priceCp`) ?? 0;
    await orders.pledgeTo(out.complete, requester, completePrice);
    await orders.accept(out.complete, crafter);
    await orders.start(out.complete);
    for (let i = 0; i < 3 && read(`orders.${out.complete}.status`) === "setup"; i++) await orders.workDay(out.complete);
    await rollCraft(out.complete, { skipDialog: true });
    await waitFor(() => read(`orders.${out.complete}.status`) === "rolled", 10000);
    await orders.settle(out.complete);
    if (read(`orders.${out.complete}.status`) === "finishing") out.completeFinish = plain(await orders.finish(out.complete));
    out.cancelled = await file(b, 1, requester);
    await orders.cancel(out.cancelled);
    await deposit(other, 500);
    out.states = Object.fromEntries(records("orders").map((o) => [o.id, o.status]));
    out.crafter = as(crafter)?.name ?? null;
    return plain(out);
}
