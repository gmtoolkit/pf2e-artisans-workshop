/**
 * README screenshots (DESIGN.md 17.1): stage a demo party in the running dev world, capture the Workshop window cropped
 * to its frame, write the PNGs to `docs/screenshots/`, and put the world back as the live harness leaves it.
 *
 *   npm run screenshots -- [--url http://localhost:30000] [--chromium <browser binary>] [--out docs/screenshots]
 *                          [--results <dir>] [--headed]
 *
 * It needs what `npm run harness:live` needs (README, Development): the dev world running with this checkout symlinked
 * into `Data/modules`, the module's `dev` setting on, the fixture actors built, users without passwords. It drives the
 * world through `run-live.mjs` and the preparation of `live-plans.mjs`.
 *
 * The demo party (`CAST`) is four new characters with generic names, copied from fixture actors (DESIGN.md 15.4) so
 * their classes, feats and Crafting are real; they are marked `flags.world.<MODULE_ID>-demo` and never carry a fixture's
 * name or mark. While the captures are taken they are the party's members and Player One's and Player Two's characters;
 * what the party and the users had before is kept in the party's `flags.world` too, so a run that stopped half-way is
 * put right by the next one. The orders, funds, formulas and downtime are staged through the module's own functions,
 * each on the client of the user who would do it at a table (Player One plays the alchemist who crafts, Player Two the
 * fighter, the GM the other two and the world clock), so the Funds ledger names the right people. The demo's Craft and
 * Earn Income checks roll a fixed 12 on the die, so every run stages the same states: that is the only thing it changes
 * in the page, and it is put back after the rolls. Downtime moves the world clock forward (never back), as the M6 live
 * plans do, so run it in the dev world only.
 *
 * Captures (`CAPTURES`) are taken on Player One's client at 1440x900, cropped to the window's element, dark unless named
 * light. Each is checked first: no raw i18n key and no fixture or imported character's name in the window's text, nothing
 * wider than its box; then compressed with ImageMagick when it is installed (`magick`, lossless first, 256 colours if a
 * file is still above SCREENSHOT_MAX_BYTES, the asset check's limit). At the end the world is reset twice as the live
 * harness resets it: once with the module off, to take the demo actors and the chat messages of the run away and give
 * the party and the users back their own, then with it on, so the shared documents are fresh; the demo's settlement
 * profile (a world setting, not a shared document) is deleted too.
 *
 * The captures show the code the server runs: the checkout `Data/modules/<MODULE_ID>` points at, not necessarily this
 * one. Console output only: a developer tool, not module interface.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SCREENSHOT_DIR, SCREENSHOT_MAX_BYTES } from "../check-assets.mjs";
import { FIXTURE_MARK } from "./fixtures.mjs";
import { prepareWorld, resetWorld } from "./live-plans.mjs";
import { DEFAULT_CHROMIUM, Harness, MODULE_ID } from "./run-live.mjs";

/** The mark on the demo actors (and, on the party, what it and the users had before). */
export const DEMO_MARK = `${MODULE_ID}-demo`;

/**
 * The demo party: a generic name, the fixture (`fixtures.mjs` id) each is copied from, the user who plays it (none: the
 * GM's), and the coins in its purse.
 */
export const CAST = Object.freeze([
    { key: "alchemist", name: "Ilsa Marrow", fixture: "bomber-11", user: "Player One", coins: { gp: 80 } },
    { key: "fighter", name: "Doran Vell", fixture: "fighter-crafter-10", user: "Player Two", coins: { gp: 250 } },
    { key: "wizard", name: "Wren Ashdown", fixture: "wizard-9", user: null, coins: { gp: 150 } },
    { key: "druid", name: "Tamsin Reed", fixture: "druid-grower-8", user: null, coins: { gp: 60 } },
]);

/** The compendium items the demo uses (pf2e `packs/pf2e/equipment/`). */
export const ITEMS = Object.freeze({
    antidoteLesser: "Compendium.pf2e.equipment-srd.Item.ktjFOp3U0wQD9t0Z",
    antidoteModerate: "Compendium.pf2e.equipment-srd.Item.AJ1dC7EtTIfBey0M",
    elixirMinor: "Compendium.pf2e.equipment-srd.Item.hDLbR56Id2OtU318",
    elixirLesser: "Compendium.pf2e.equipment-srd.Item.TZUskLT7yvP7N2co",
    fireLesser: "Compendium.pf2e.equipment-srd.Item.yd3kEK21YknZLlcT",
    fireModerate: "Compendium.pf2e.equipment-srd.Item.gWr4q4HiyGhETA8H",
    lightningModerate: "Compendium.pf2e.equipment-srd.Item.97QyNEOAyYLdGaYc",
    healingLesser: "Compendium.pf2e.equipment-srd.Item.e0vSAQfxhHauiAoD",
    mistformModerate: "Compendium.pf2e.equipment-srd.Item.Ax8XcBd0rRd1Z7hN",
    lab: "Compendium.pf2e.equipment-srd.Item.k6xZkDUpF7E1Totd",
});

/** The Workshop window's element. */
const WORKSHOP = `#${MODULE_ID}`;

/** The element each view is cropped to: the Workshop window, the request form, the Bandolier or the Quick Alchemy panel. */
const SELECTORS = Object.freeze({
    request: `[id^="${MODULE_ID}-request-"]`,
    bandolier: `#${MODULE_ID}-bandolier`,
    "quick-alchemy": `#${MODULE_ID}-quick-alchemy`,
});

/**
 * What is captured, in this order, as Player One: the file under SCREENSHOT_DIR (`docs/screenshots/`, where the asset
 * check allows images, 16.5), the colour scheme, what is open (a tab; on the Queue, the detail of the staged order named
 * by `order`; the request form opened from the Queue) and the README's caption (draft text, 17.1).
 */
export const CAPTURES = Object.freeze([
    { file: "queue.png", scheme: "dark", view: "queue", order: "finishing",
        caption: "The Queue: every order with its state and progress, and the detail of one in its last days of work." },
    { file: "request-form.png", scheme: "dark", view: "request",
        caption: "The request form: who in the party can make the item, how, and what it needs up front." },
    { file: "funds.png", scheme: "dark", view: "funds",
        caption: "Funds: the strongbox as the party fund, unallocated and earmarked per order, with each member's share." },
    { file: "formulas.png", scheme: "dark", view: "formulas",
        caption: "Formulas: a character's book by family, where each formula came from, and the ways to learn another." },
    { file: "downtime.png", scheme: "dark", view: "downtime",
        caption: "Downtime: the workshop day, a character's days and what they go to, the party's settlement, and an Earn Income job with its pay." },
    { file: "morning.png", scheme: "dark", view: "morning",
        caption: "Morning: a character's daily crafting by pool, a loadout's plan with an ally's standing order, and the talismans it can make today." },
    { file: "bandolier.png", scheme: "dark", view: "bandolier",
        caption: "The Bandolier in an encounter: the vials, Quick Alchemy and quick vials, and what is ready, with how long it stays potent and pf2e's Strike buttons." },
    { file: "quick-alchemy.png", scheme: "dark", view: "quick-alchemy",
        caption: "Quick Alchemy: what the alchemist can make now, by formula or family, picked from the keyboard, with what it costs in vials." },
    { file: "queue-light.png", scheme: "light", view: "queue", order: "complete",
        caption: "The Queue in the light theme, with a finished order's cost summary." },
]);

/**
 * Captures taken and written beside `CAPTURES` but not yet linked from the README (17.1 "refreshed whenever a milestone adds
 * a tab"): a new tab's capture goes here first. After a run, check the file by eye, move its entry into `CAPTURES` and add
 * its caption to the README's Screenshots section, which `test/screenshots.test.mjs` then holds to it. Empty since the M7
 * live pass linked `morning.png`.
 */
export const NEXT_CAPTURES = Object.freeze([]);

/** Names that must never appear in a capture: the fixture actors' labels and the character imported into the dev world. */
export const BANNED_NAMES = Object.freeze(["Fixture"]);

/** The viewport of every capture (17.1). */
const SIZE = { width: 1440, height: 900 };

/**
 * What is wrong with a capture's text: raw i18n keys (this module's, or any `Word.Word` key such as pf2e's
 * `PF2E.TraitCommon`) and banned names. Pure, so the test can hold it to the cases the captures must not show.
 * @param {string} text  the window's text as the user sees it
 * @returns {string[]}
 */
export function textProblems(text, banned = BANNED_NAMES) {
    const problems = [];
    const ours = new RegExp(`${RegExp.escape(MODULE_ID)}\\.[\\w.-]+`, "g");
    for (const match of text.matchAll(ours)) problems.push(`raw key ${match[0]}`);
    for (const match of text.replace(ours, " ").matchAll(/\b[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)+\b/g)) problems.push(`raw key ${match[0]}`);
    for (const name of banned) if (text.includes(name)) problems.push(`name ${name}`);
    return [...new Set(problems)];
}

/** The images the README links under SCREENSHOT_DIR, in its order. */
export const readmeShots = (root) => [...readFileSync(join(root, "README.md"), "utf8").matchAll(/\]\((docs\/screenshots\/[^)\s]+)\)/g)].map((m) => m[1]);

/* -------------------------------------------- */
/*  In the page                                  */
/* -------------------------------------------- */

/**
 * GM: put back what an earlier run of this script changed, from what it kept on the party: the party's members and the
 * users' characters; then delete the demo actors and, given `messages` (ids from before the run), every chat message
 * since. Run with the module off, so it writes nothing while actors come and go.
 */
async function pageUncast({ mark, messages = null }) {
    const party = game.actors.party;
    const saved = party?.flags?.world?.[mark] ?? null;
    if (saved) {
        await party.update({ "system.details.members": saved.members });
        for (const [id, character] of Object.entries(saved.characters)) {
            const user = game.users.get(id);
            if (user && (user.character?.id ?? null) !== character) await user.update({ character: game.actors.has(character) ? character : null });
        }
        await party.unsetFlag("world", mark);
    }
    const demo = game.actors.filter((a) => a.flags?.world?.[mark]).map((a) => a.id);
    if (demo.length) await Actor.implementation.deleteDocuments(demo);
    let deleted = 0;
    if (messages) {
        const before = new Set(messages);
        const ids = game.messages.filter((m) => !before.has(m.id)).map((m) => m.id);
        if (ids.length) await ChatMessage.implementation.deleteDocuments(ids);
        deleted = ids.length;
    }
    return { restored: !!saved, members: party?.members.map((m) => m.name) ?? [], demoDeleted: demo.length, messagesDeleted: deleted };
}

/**
 * GM: the demo party. Each member is a copy of a fixture actor (found by its mark) with a generic name, no fixture mark,
 * no coins but its own, no items an earlier plan gave or delivered, an empty formula book, and its player as owner. The
 * party's members become the demo's and the players' characters theirs; what they were is kept on the party first.
 * Returns the demo's actors by key and the ids of the chat messages there were.
 */
async function pageCast({ mod, mark, fixtureMark, cast }) {
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const party = game.actors.party;
    const players = game.users.filter((u) => !u.isGM);
    await party.setFlag("world", mark, {
        members: foundry.utils.deepClone(party._source.system.details.members),
        characters: Object.fromEntries(players.map((u) => [u.id, u.character?.id ?? null])),
    });
    const messages = game.messages.map((m) => m.id);
    const made = {};
    for (const member of cast) {
        const fixture = game.actors.find((a) => a.flags?.world?.[fixtureMark] === member.fixture);
        if (!fixture) throw new Error(`no fixture ${member.fixture} in this world (build the fixtures first)`);
        const user = member.user ? game.users.getName(member.user) : null;
        if (member.user && !user) throw new Error(`no user ${member.user}`);
        const source = fixture.toObject();
        delete source._id;
        source.name = member.name;
        source.prototypeToken.name = member.name;
        source.folder = null;
        source.flags = { ...(source.flags?.pf2e ? { pf2e: source.flags.pf2e } : {}), world: { [mark]: member.key } };
        source.ownership = { default: 0, ...(user ? { [user.id]: OWNER } : {}) };
        source.items = source.items.filter((i) => !(i.type === "treasure" && i.system?.category === "coin")
            && !Object.keys(i.flags?.world ?? {}).length && !i.flags?.[mod]);
        source.system.crafting = { ...(source.system.crafting ?? {}), formulas: [] };
        const actor = await Actor.implementation.create(source);
        await actor.inventory.addCurrency(member.coins);
        made[member.key] = { id: actor.id, uuid: actor.uuid, name: actor.name };
    }
    await party.update({ "system.details.members": cast.map((member) => ({ uuid: made[member.key].uuid })) });
    for (const member of cast) {
        if (member.user) await game.users.getName(member.user).update({ character: made[member.key].id });
    }
    const prompts = [...foundry.applications.instances.values()].filter((app) => /choice/i.test(app.constructor.name)).map((app) => app.constructor.name);
    return { made, messages, members: party.members.map((m) => m.name), prompts };
}

/** Any owner: put an item in the strongbox (the party's alchemist's lab, which counts for every crafter, G7). */
async function pageStore({ mod, uuid }) {
    const box = game.actors.find((a) => a.flags?.[mod]?.role === "strongbox");
    const source = (await fromUuid(uuid)).toObject();
    delete source._id;
    const [item] = await box.createEmbeddedDocuments("Item", [source]);
    return { id: item.id, name: item.name };
}

/**
 * One staging action on this client, through the module's own functions (the files the page already loaded), as the
 * window's buttons call them. `op` names it, `p` holds its arguments; the result is plain JSON. `roll` fixes the die at
 * 12 for its one check (`CONFIG.Dice.randomUniform`, core `client/dice/terms/dice.mjs` `mapRandomFace`) and puts the
 * random source back after it.
 */
async function pageAct({ mod, op, p }) {
    const at = `/modules/${mod}/scripts`;
    const [orders, funds, formulas, products, rolls, store, codex, fundLogic, jobs] = await Promise.all([
        import(`${at}/foundry/orders.mjs`), import(`${at}/foundry/funds.mjs`), import(`${at}/foundry/formulas.mjs`),
        import(`${at}/foundry/products.mjs`), import(`${at}/foundry/rolls.mjs`), import(`${at}/foundry/store.mjs`), import(`${at}/logic/codex.mjs`),
        import(`${at}/logic/funds.mjs`), import(`${at}/foundry/jobs.mjs`),
    ]);
    /** Run `fn` with the die fixed at 12 (`CONFIG.Dice.randomUniform`), and put the random source back after it. */
    const fixedDie = async (fn) => {
        const random = CONFIG.Dice.randomUniform;
        CONFIG.Dice.randomUniform = () => 0.42;
        try {
            return await fn();
        } finally {
            CONFIG.Dice.randomUniform = random;
        }
    };
    const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (test, ms = 15000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            if (await test()) return true;
            await sleep(150);
        }
        return false;
    };
    const status = (id) => store.read(`orders.${id}.status`);
    switch (op) {
        case "seen": return { ok: await waitFor(() => (p.value === undefined ? store.read(p.path) != null : store.read(p.path) === p.value), p.ms ?? 15000) };
        case "fundSeen": return { ok: await waitFor(() => fundLogic.unallocatedCp(store.records("rows")) >= p.cp, p.ms ?? 15000) };
        case "deposit": return plain(await funds.deposit(p.actor, p.cp));
        case "request": {
            const result = await orders.requestOrder({ uuid: p.uuid, quantity: p.quantity ?? 1, requester: p.actor,
                recipient: p.strongbox ? { kind: "strongbox" } : { kind: "actor", uuid: p.recipient ?? p.actor }, crafter: p.crafter ?? null, note: p.note ?? "" });
            return { ...plain(result), order: result.orders?.[0] ?? null };
        }
        case "fund": return plain(await funds.fundOrder(p.order, { source: p.source, actor: p.actor ?? null, cp: p.cp }));
        case "accept": return plain(await orders.accept(p.order, p.actor));
        case "start": return plain(await orders.start(p.order));
        case "work": {
            const results = [];
            for (let i = 0; i < (p.max ?? 6); i++) {
                results.push(plain(await orders.workDay(p.order)));
                if (!results.at(-1).ok || (p.until ? status(p.order) === p.until : i + 1 >= (p.times ?? 1))) break;
            }
            return { results, status: status(p.order) };
        }
        case "roll": {
            await fixedDie(() => rolls.rollCraft(p.order, { skipDialog: true }));
            return { recorded: await waitFor(() => status(p.order) === "rolled", 15000), status: status(p.order) };
        }
        case "settle": {
            // The profile is a world setting the GM saved: wait until this client has it.
            await waitFor(() => jobs.profiles().some((profile) => profile.id === p.profile), p.ms ?? 15000);
            return plain(await jobs.setSettlement(p.profile));
        }
        case "job": {
            const started = await jobs.startJob({ actor: p.actor, skill: p.skill, taskLevel: p.taskLevel });
            if (!started.ok) return plain(started);
            await fixedDie(() => jobs.rollJob(started.job, { skipDialog: true }));
            const rolled = await waitFor(() => store.read(`jobs.${started.job}.check`), 15000);
            return { ok: !!rolled, job: started.job, perDayCp: store.read(`jobs.${started.job}.perDayCp`) ?? null };
        }
        case "finish": return { result: plain(await funds.finishOrder(p.order, { draw: p.draw ?? null })), status: status(p.order) };
        case "learn": {
            let source = null;
            let pickLevel = null;
            if (p.route === "grant") {
                const product = await products.productFacts(p.uuid);
                const pick = formulas.owedPicks(fromUuidSync(p.actor)).entries.find((e) => e.owed > 0 && codex.pickFits(e, product));
                if (!pick) return { ok: false, reason: "no-pick" };
                source = pick.key;
                pickLevel = pick.level;
            }
            return plain(await formulas.acquire({ learner: p.actor, uuid: p.uuid, route: p.route, payer: p.actor, paidFrom: p.paidFrom ?? "purse", source, pickLevel }));
        }
        case "statuses": return Object.fromEntries(store.records("orders").map((o) => [o.id, o.status]));
        default: throw new Error(`no staging action ${op}`);
    }
}

/** Player One: the request form opened from the Workshop, with an item and a quantity, placed over the window. */
async function pageRequestForm({ mod, uuid, quantity }) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const { openRequestForm } = await import(`/modules/${mod}/scripts/ui/request.mjs`);
    const { WorkshopApp } = await import(`/modules/${mod}/scripts/ui/workshop.mjs`);
    await openRequestForm({ uuid, parent: WorkshopApp.instance });
    const find = () => [...foundry.applications.instances.values()].find((app) => app.id.startsWith(`${mod}-request-`) && app.rendered);
    for (let i = 0; i < 40 && !find(); i++) await sleep(100);
    const form = find();
    form.draft.quantity = quantity;
    await form.render();
    form.setPosition({ left: 120, top: 40 });
    await sleep(1500);
    return { id: form.id, candidates: form.element.querySelectorAll(".request-candidates tbody tr").length, height: form.element.offsetHeight };
}

/** Close the request forms and dialogs. */
async function pageCloseForms({ mod }) {
    for (const app of [...foundry.applications.instances.values()]) {
        if (app.id.startsWith(`${mod}-request-`) || app instanceof foundry.applications.api.DialogV2) await app.close({ animate: false });
    }
    return true;
}

/**
 * Leave only the captured window to be seen: notifications go, and everything beside the window and beside each of its
 * ancestors is hidden (`visibility`), so neither Foundry's interface nor the Workshop behind the request form shows
 * through a translucent frame or lies over it. `pageShowAll` undoes it.
 */
function pageIsolate({ selector }) {
    ui.notifications?.clear?.();
    for (const el of document.querySelectorAll("#notifications > *, .locked-tooltip")) el.remove();
    document.activeElement?.blur?.();
    const hidden = [];
    for (let node = document.querySelector(selector); node && node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
            if (sibling === node || ["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName) || sibling.style.visibility === "hidden") continue;
            hidden.push(sibling);
            sibling.style.visibility = "hidden";
        }
    }
    window.__workshopHidden = hidden;
    return hidden.length;
}

/** Show again what `pageIsolate` hid. */
function pageShowAll() {
    for (const el of window.__workshopHidden ?? []) el.style.visibility = "";
    window.__workshopHidden = [];
    return true;
}

/**
 * The window's text as a user sees it (its visible text, the values of its selects and the placeholders of its fields)
 * and what overflows: any element in the window wider than its box that does not scroll. The text goes through
 * `textProblems` in Node.
 */
function pageInspect({ selector }) {
    const root = document.querySelector(selector);
    if (!root) return { found: false };
    const fields = [...root.querySelectorAll("select")].map((s) => s.selectedOptions[0]?.textContent ?? "")
        .concat([...root.querySelectorAll("input[placeholder], textarea[placeholder]")].map((i) => i.placeholder));
    const scrolls = (el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX);
    // A visually hidden label (`sr-only`: a 1px box with its text clipped) is meant to overflow.
    const overflow = [...root.querySelectorAll("*")].filter((el) => el.offsetParent !== null && !scrolls(el) && el.scrollWidth > el.clientWidth + 1
        && el.clientWidth > 2 && getComputedStyle(el).overflowX !== "visible" && getComputedStyle(el).textOverflow !== "ellipsis")
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${el.scrollWidth}>${el.clientWidth}`).slice(0, 10);
    const box = root.getBoundingClientRect();
    // A closed select shows its chosen option only; `innerText` would list every option (the Bandolier's character select
    // offers each alchemist the user owns, the dev world's fixtures among them).
    let text = root.innerText;
    for (const option of root.querySelectorAll("select option:not(:checked)")) text = text.replace(option.textContent, "");
    return { found: true, text: `${text}\n${fields.join("\n")}`, overflow, wider: root.scrollWidth > root.clientWidth + 1,
        box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } };
}

/* -------------------------------------------- */
/*  Staging                                      */
/* -------------------------------------------- */

/** Run a staging action on a client and fail loudly when the module refuses it. */
async function act(h, client, op, p, { allow = [] } = {}) {
    const result = await h.evaluate(client, pageAct, { mod: MODULE_ID, op, p }, `demo/${op}`);
    const refused = result?.error || result?.ok === false || result?.result?.ok === false;
    const reason = result?.error ?? result?.reason ?? result?.result?.reason ?? null;
    if (refused && !allow.includes(reason)) throw new Error(`${client} ${op} ${JSON.stringify(p)}: ${JSON.stringify(result)}`);
    return result;
}

/** Wait until every open client's copy has an order (or any path), so the next client acts on what it can see. */
async function seenEverywhere(h, path) {
    for (const name of h.clients.keys()) {
        const seen = await act(h, name, "seen", { path });
        if (!seen.ok) throw new Error(`${name} never saw ${path}`);
    }
}

/**
 * The demo, with the GM, Player One and Player Two online: money into the party fund, three formulas for the alchemist
 * (bought from the fund, taken for an owed pick, copied from an NPC), and five orders: one requested and unfunded, one
 * accepted and partly funded, one in its setup days, one finishing after its check with two days of work on the rest,
 * and one complete and delivered. Returns the orders by state.
 */
async function stage(h, demo) {
    const { alchemist: ilsa, fighter: doran, wizard: wren, druid: tamsin } = demo;
    await act(h, "p2", "deposit", { actor: doran.uuid, cp: 6000 });
    await act(h, "gm", "deposit", { actor: wren.uuid, cp: 4000 });
    if (!(await act(h, "p1", "fundSeen", { cp: 10000 })).ok) throw new Error("Player One never saw the deposits");
    await act(h, "p1", "learn", { actor: ilsa.uuid, uuid: ITEMS.antidoteLesser, route: "buy", paidFrom: "fund" });
    await act(h, "p1", "learn", { actor: ilsa.uuid, uuid: ITEMS.elixirMinor, route: "grant" });
    await act(h, "p1", "learn", { actor: ilsa.uuid, uuid: ITEMS.fireLesser, route: "copy-npc", paidFrom: "purse" });

    const requested = (await act(h, "gm", "request", { actor: tamsin.uuid, uuid: ITEMS.healingLesser, quantity: 2 })).order;
    const funding = (await act(h, "p2", "request", { actor: doran.uuid, uuid: ITEMS.fireModerate, quantity: 4 })).order;
    await act(h, "p2", "fund", { order: funding, source: "purse", actor: doran.uuid, cp: 800 });
    const complete = (await act(h, "p2", "request", { actor: doran.uuid, uuid: ITEMS.elixirLesser, quantity: 2 })).order;
    await act(h, "p2", "fund", { order: complete, source: "purse", actor: doran.uuid, cp: 3000 });
    const finishing = (await act(h, "gm", "request", { actor: wren.uuid, uuid: ITEMS.antidoteModerate, quantity: 2 })).order;
    await act(h, "gm", "fund", { order: finishing, source: "purse", actor: wren.uuid, cp: 2000 });
    for (const id of [requested, funding, complete, finishing]) await seenEverywhere(h, `orders.${id}`);

    const setup = (await act(h, "p1", "request", { actor: ilsa.uuid, uuid: ITEMS.lightningModerate, quantity: 4, strongbox: true, crafter: ilsa.uuid })).order;
    await act(h, "p1", "fund", { order: setup, source: "fund", cp: 2000 });
    await act(h, "p1", "start", { order: setup });
    await act(h, "p1", "work", { order: setup, times: 1 });

    await act(h, "p1", "accept", { order: funding, actor: ilsa.uuid });
    await act(h, "p1", "fund", { order: funding, source: "fund", cp: 500 });

    await act(h, "p1", "accept", { order: finishing, actor: ilsa.uuid });
    await act(h, "p1", "fund", { order: finishing, source: "fund", cp: 1500 });
    await act(h, "p1", "start", { order: finishing });
    await act(h, "p1", "work", { order: finishing, until: "check" });
    await act(h, "p1", "roll", { order: finishing });
    await act(h, "p1", "work", { order: finishing, times: 2 });

    await act(h, "p1", "accept", { order: complete, actor: ilsa.uuid });
    await act(h, "p1", "start", { order: complete });
    await act(h, "p1", "work", { order: complete, until: "check" });
    await act(h, "p1", "roll", { order: complete });
    await act(h, "p1", "work", { order: complete, times: 1 });
    await act(h, "p1", "finish", { order: complete, draw: { source: "fund" } });
    await seenEverywhere(h, `orders.${complete}`);
    const delivered = await h.step("p2", "m4", "waitDelivered", { name: "Elixir of Life (Lesser)", ms: 30000 });

    const statuses = await act(h, "p1", "statuses", {});
    const orders = { requested, funding, setup, finishing, complete };
    const want = { requested: "requested", funding: "accepted", setup: "setup", finishing: "finishing", complete: "complete" };
    h.check("the demo orders are in the states the captures show", Object.entries(want).every(([key, state]) => statuses[orders[key]] === state),
        Object.fromEntries(Object.entries(orders).map(([key, id]) => [key, statuses[id]])));
    h.check("the complete order's item reached its recipient", delivered.delivered === true, delivered);
    return orders;
}

/** The demo's settlement: a town whose Earn Income tasks go up to level 4, Crafting up to 6. */
export const SETTLEMENT = Object.freeze({ name: "Millbrook", size: "town", level: 4, caps: { crafting: 6 }, notes: "" });

/**
 * Downtime (M6), with the GM and Player One online: the GM keeps the town's settlement profile and moves the world clock;
 * Player One puts the party in the town, Ilsa in downtime, takes an Earn Income job at Crafting 6 (the check a fixed 12)
 * and resolves two days of it (two wages into Ilsa's purse) once the clock has passed the days her order work already
 * took; then makes the finishing order Ilsa's activity, and the clock moves a day, which Ilsa has still to resolve.
 * Returns the job.
 */
async function stageDowntime(h, demo, orders) {
    const ilsa = demo.alchemist;
    const profile = await h.step("gm", "m6", "profile", SETTLEMENT);
    if (!profile?.ok) throw new Error(`the settlement profile was refused: ${JSON.stringify(profile)}`);
    await act(h, "p1", "settle", { profile: profile.id });
    await h.step("p1", "m6", "downtime", { actor: ilsa.uuid, on: true });
    const job = await act(h, "p1", "job", { actor: ilsa.uuid, skill: "crafting", taskLevel: 6 });
    await h.step("p1", "m6", "activity", { actor: ilsa.uuid, activity: `earn:${job.job}` });
    // Ilsa's work days on the orders are already logged on her own days, ahead of the workshop day (an order's "Work a
    // day" takes the day after her last record, 9.1): the clock first catches up with them, then gives her two days.
    const before = await h.step("p1", "m6", "status", { actor: ilsa.uuid });
    const ahead = Math.max(0, (before.resolved ?? before.today.day) - before.today.day);
    await h.step("gm", "m6", "clock", { days: ahead + 2, ms: 2500 });
    const earned = await h.step("p1", "m6", "resolve", { actor: ilsa.uuid });
    await h.step("p1", "m6", "activity", { actor: ilsa.uuid, activity: `craft:${orders.finishing}` });
    await h.step("gm", "m6", "clock", { days: 1, ms: 2500 });
    const pc = await h.step("p1", "m6", "status", { actor: ilsa.uuid, ms: 1000 });
    const paid = await h.step("p1", "m6", "jobState", { job: job.job, ms: 2000 });
    h.check("the demo's downtime: two days of Earn Income paid, then the finishing order with one day to resolve",
        earned.result?.records?.length === 2 && paid.wages.length === 2 && paid.wages.every((w) => w.state === "applied")
        && pc.inDowntime && pc.activity?.kind === "craft" && pc.pending === 1, { earned: earned.result, wages: paid.wages, pc });
    return { job: job.job, perDayCp: job.perDayCp, profile: profile.id };
}

/** Player One: a loadout saved through the public API (the window has no loadout editor), each entry by its item's family. */
async function pageLoadout({ mod, actor, name, pool, entries }) {
    const api = game.modules.get(mod).api;
    const families = [];
    for (const [uuid, qty] of entries) families.push({ family: await api.formulas.family(uuid), qty });
    return JSON.parse(JSON.stringify(await api.prep.saveLoadout(actor, { name, pools: { [pool]: families } })));
}

/**
 * The Morning (M7), with Player One and Player Two online: Ilsa's "Field kit" loadout for Advanced Alchemy by family (two
 * elixirs of life, three alchemist's fires and an antidote, each at the best grade the pool makes from the formulas staged
 * above), saved as a player would through the API, and Doran's standing order for an elixir of life each morning, placed
 * on Player Two's client. Returns the loadout's id, which the capture picks in the pool's plan.
 */
async function stageMorning(h, demo) {
    const saved = await h.evaluate("p1", pageLoadout, { mod: MODULE_ID, actor: demo.alchemist.uuid, name: "Field kit", pool: "advanced-alchemy",
        entries: [[ITEMS.elixirMinor, 2], [ITEMS.fireLesser, 3], [ITEMS.antidoteLesser, 1]] }, "the Field kit loadout");
    const standing = await h.step("p2", "m7", "standing", { requester: demo.fighter.uuid, crafter: demo.alchemist.uuid, uuid: ITEMS.elixirMinor, qty: 1 });
    h.check("the demo's Morning: Ilsa's loadout by family and Doran's standing order", saved?.ok === true && saved.loadout?.pools?.["advanced-alchemy"]?.length === 3
        && standing?.ok === true, { saved, standing });
    if (standing?.id) await seenEverywhere(h, `standing.${standing.id}`);
    return { loadout: saved?.id ?? null, standing: standing?.id ?? null };
}

/**
 * Combat (M8), with the GM and Player One online: Ilsa's vials full, the GM starts an encounter of Ilsa then Doran (token-less combatants,
 * `combat-scenarios.mjs`), and on Ilsa's turn Player One uses Quick Alchemy with Double Brew, an Alchemist's Fire
 * (Moderate) by family and an Elixir of Life (Minor), then makes a quick vial. Returns the encounter's id; `restore` ends it.
 */
async function stageCombat(h, demo) {
    const ilsa = demo.alchemist.uuid;
    // Her vials full first: the copy carries the fixture's count, whatever the last run left it at.
    await h.step("p1", "m8", "vials", { actor: ilsa, value: 99 });
    const fight = await h.step("gm", "m8", "encounter", { actors: [ilsa, demo.fighter.uuid] });
    const brew = await h.step("p1", "m8", "quick", { actor: ilsa, uuid: ITEMS.fireModerate, second: ITEMS.elixirMinor });
    const vial = await h.step("p1", "m8", "vial", { actor: ilsa });
    h.check("the demo's encounter: Ilsa's turn, two items of Quick Alchemy and a quick vial", fight.order?.[0] === demo.alchemist.name
        && brew.result?.ok === true && brew.result.items.length === 2 && vial.result?.ok === true, { fight, brew: brew.result, vial: vial.result });
    return { combat: fight.id ?? null };
}

/* -------------------------------------------- */
/*  Captures                                     */
/* -------------------------------------------- */

/** Open what a capture shows on Player One's client. */
async function show(h, capture, orders, demo, morning = {}) {
    await h.evaluate("p1", pageCloseForms, { mod: MODULE_ID });
    await h.step("p1", "m8", "close", {});
    if (capture.view === "formulas") {
        return h.step("p1", "m5", "open", { tab: "formulas", actor: demo.alchemist.uuid, uuid: ITEMS.lightningModerate, ms: 2000 });
    }
    if (capture.view === "downtime") return h.step("p1", "m4", "open", { tab: "downtime", ms: 2000 });
    if (capture.view === "morning") {
        // The alchemist's Morning with the staged loadout as Advanced Alchemy's plan and two talismans of the Dabbler's
        // picker chosen (M7, `morning-scenarios.mjs`); Doran's standing order shows as due.
        const facts = await h.step("p1", "m7", "facts", { actor: demo.alchemist.uuid });
        const picks = (facts.pools.find((p) => p.slug === "talisman-dabbler")?.offered ?? []).slice(0, 2).map((t) => t.uuid);
        const plans = morning.loadout ? { "advanced-alchemy": { mode: "loadout", id: morning.loadout } } : {};
        return h.step("p1", "m7", "open", { actor: demo.alchemist.uuid, plans, talismans: { "talisman-dabbler": picks }, ms: 2000 });
    }
    // The Bandolier of Ilsa's turn (M8), and the Quick Alchemy panel beside it with an elixir picked from the keyboard.
    if (capture.view === "bandolier") return h.step("p1", "m8", "bandolier", { actor: demo.alchemist.uuid });
    if (capture.view === "quick-alchemy") return h.step("p1", "m8", "panel", { actor: demo.alchemist.uuid, query: "elixir", close: false });
    const tab = capture.view === "funds" ? "funds" : "queue";
    const opened = await h.step("p1", "m4", "open", { tab, order: capture.order ? orders[capture.order] : null, ms: 1500 });
    if (capture.view === "request") return { ...opened, form: await h.evaluate("p1", pageRequestForm, { mod: MODULE_ID, uuid: ITEMS.mistformModerate, quantity: 2 }) };
    return opened;
}

/**
 * Compress a PNG in place with ImageMagick when it is installed: re-encoded losslessly, kept if smaller; then, if it is
 * still above `limit`, reduced to 256 colours (the light theme's parchment texture does not fit losslessly). Returns the
 * sizes and what was done.
 */
export function compress(path, limit = SCREENSHOT_MAX_BYTES) {
    const before = statSync(path).size;
    const trial = `${path}.tmp.png`;
    const magick = (args) => execFileSync("magick", args, { stdio: ["ignore", "ignore", "pipe"] });
    let how = "as captured";
    try {
        magick([path, "-strip", "-define", "png:compression-level=9", "-define", "png:compression-filter=5", trial]);
    } catch {
        return { before, after: before, how: "as captured (magick not found)" };
    }
    if (statSync(trial).size < statSync(path).size) {
        renameSync(trial, path);
        how = "lossless";
    }
    if (statSync(path).size > limit) {
        magick([path, "-strip", "-dither", "None", "-colors", "256", `PNG8:${trial}`]);
        renameSync(trial, path);
        how = "256 colours";
    }
    rmSync(trial, { force: true });
    return { before, after: statSync(path).size, how };
}

/** Take every capture, check it, compress it. */
async function captureAll(h, orders, demo, outDir, morning = {}) {
    const results = [];
    let scheme = null;
    for (const capture of [...CAPTURES, ...NEXT_CAPTURES]) {
        if (capture.scheme !== scheme) {
            await h.step("p1", "m4", "theme", { scheme: capture.scheme });
            scheme = capture.scheme;
        }
        const selector = SELECTORS[capture.view] ?? WORKSHOP;
        let inspected = null;
        let opened = null;
        const path = await h.screenshot("p1", capture.file, SIZE, async () => {
            opened = await show(h, capture, orders, demo, morning);
            const { page } = h.clients.get("p1");
            await page.mouse.move(SIZE.width - 4, SIZE.height - 4);
            await h.evaluate("p1", pageIsolate, { selector }, "isolate the window");
            inspected = await h.evaluate("p1", pageInspect, { selector }, "inspect");
            return opened;
        }, { selector });
        await h.evaluate("p1", pageShowAll, null, "show all");
        const problems = inspected?.found ? textProblems(inspected.text) : ["window not found"];
        h.check(`${capture.file}: no raw i18n key or banned name`, problems.length === 0, problems);
        h.check(`${capture.file}: nothing overflows its box`, inspected?.found && !inspected.wider && inspected.overflow.length === 0, inspected?.overflow);
        const size = compress(path);
        h.check(`${capture.file}: at most ${SCREENSHOT_MAX_BYTES / 1024} KiB`, size.after <= SCREENSHOT_MAX_BYTES, size);
        results.push({ ...capture, path, box: inspected?.box ?? null, opened, size });
    }
    await h.step("p1", "m4", "theme", { scheme: "dark" });
    await h.evaluate("p1", pageCloseForms, { mod: MODULE_ID });
    await h.step("p1", "m4", "close", {});
    return results.map((r) => ({ ...r, path: join(outDir, r.file) }));
}

/* -------------------------------------------- */
/*  Command line                                 */
/* -------------------------------------------- */

/** Take the demo away and leave the world as the live harness does: reset with the module off, uncast, reset again. */
async function restore(h, world, messages) {
    h.label = "restore";
    await h.ensureBrowser();
    await resetWorld(h, world, { enable: false });
    // The demo's encounter (M8): deleted with every encounter the M8 steps marked.
    await h.evaluate("gm", async (mark) => {
        for (const fight of game.combats.filter((c) => c.flags?.world?.[mark])) await fight.delete().catch(() => null);
    }, `${MODULE_ID}-m8`, "end the demo's encounter");
    const uncast = await h.evaluate("gm", pageUncast, { mark: DEMO_MARK, messages }, "uncast");
    h.check("the party and the users have their own characters again, and the demo actors are gone", uncast.restored === true && !uncast.error, uncast);
    await resetWorld(h, world);
    await h.step("gm", "m6", "reset");
    await h.closeAll();
    return uncast;
}

async function main() {
    const root = join(import.meta.dirname, "../..");
    const { values } = parseArgs({
        options: {
            url: { type: "string", default: "http://localhost:30000" },
            chromium: { type: "string", default: DEFAULT_CHROMIUM },
            out: { type: "string", default: join(root, SCREENSHOT_DIR) },
            results: { type: "string", default: join(tmpdir(), `${MODULE_ID}-screenshots-${new Date().toISOString().replace(/[:.]/g, "-")}`) },
            headed: { type: "boolean", default: false },
        },
    });
    const h = new Harness({ url: values.url, executablePath: values.chromium, headed: values.headed });
    h.shotsDir = values.out;
    mkdirSync(values.out, { recursive: true });
    mkdirSync(values.results, { recursive: true });
    const report = { url: values.url, started: new Date().toISOString() };
    const file = join(values.results, "results.json");
    const save = () => writeFileSync(file, JSON.stringify({ ...report, records: h.records, checks: h.checks, console: h.console, pages: h.pageLog,
        shots: h.shots, styleAdded: [...h.styleAdded] }, null, 2));

    await h.start();
    let world = null;
    let messages = null;
    try {
        h.label = "prepare";
        world = await prepareWorld(h);
        await resetWorld(h, world, { enable: false });
        report.leftover = await h.evaluate("gm", pageUncast, { mark: DEMO_MARK }, "leftovers of an earlier run");
        h.label = "cast";
        const cast = await h.evaluate("gm", pageCast, { mod: MODULE_ID, mark: DEMO_MARK, fixtureMark: FIXTURE_MARK, cast: CAST }, "cast");
        if (cast.error) throw new Error(`cast failed: ${cast.error}`);
        messages = cast.messages;
        report.cast = { made: cast.made, members: cast.members, prompts: cast.prompts };
        h.check("the demo party is cast: four members with generic names, no choice prompt", cast.members.length === CAST.length && cast.prompts.length === 0
            && textProblems(cast.members.join("\n")).length === 0, report.cast);
        await resetWorld(h, world);
        await h.evaluate("gm", pageStore, { mod: MODULE_ID, uuid: ITEMS.lab }, "an alchemist's lab in the strongbox");
        h.label = "stage";
        await h.only(["gm", "p1", "p2"]);
        await h.settle("ready");
        report.orders = await stage(h, cast.made);
        report.downtime = await stageDowntime(h, cast.made, report.orders);
        report.morning = await stageMorning(h, cast.made);
        report.combat = await stageCombat(h, cast.made);
        h.label = "capture";
        await h.only(["p1"]);
        await h.settle("ready", ["p1"]);
        report.captures = await captureAll(h, report.orders, cast.made, values.out, report.morning);
    } catch (error) {
        report.error = error.message;
        h.check("the screenshots ran to the end", false, error.message);
    } finally {
        save();
        if (world) report.restore = await restore(h, world, messages).catch((error) => ({ error: error.message }));
        report.finished = new Date().toISOString();
        save();
        await h.stop();
    }
    for (const capture of report.captures ?? []) console.log(`${capture.file}: ${Math.round(capture.size.after / 1024)} KiB (${capture.size.how}), ${capture.box?.width}x${capture.box?.height}`);
    console.log(`\nresults: ${file}`);
    if (report.error || report.restore?.error || h.checks.some((c) => !c.ok)) process.exitCode = 1;
}

if (import.meta.main) await main();
