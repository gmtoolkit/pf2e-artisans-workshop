/**
 * Live-harness steps for M8 (DESIGN.md 8.1-8.9, 15.3 scenarios 5 and 6), merged into the scenarios of
 * `sync-scenarios.mjs` as scenario `m8`. The live driver's behaviour checks (`live-plans.mjs`, the `m8-*` plans) run them:
 * Quick Alchemy through pf2e's own `craft` (and the vial gate pf2e's own path lacks), Double Brew, additives and Healing
 * Bomb; quick vials; Strikes through pf2e's own Strike; turn expiry on each holder's client and at the encounter's end;
 * vial gathering with two clients at the cap; Duct Tape's step-aside; "Use best consumable"; the Bandolier and the Quick
 * Alchemy panel driven like a user, without a canvas; the token HUD palette, with one.
 *
 * Every step goes through the module's own functions or pf2e's (its Strike, its encounter, its resource). Items and feats
 * the steps give are marked `flags.world.pf2e-artisans-workshop-m8`, as are the encounters they make; `reset` takes them
 * away with every item Quick Alchemy made, refills the vials and clears the module's combat flags. Console output only: a
 * developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import * as alchemy from "../../scripts/foundry/alchemy.mjs";
import * as combat from "../../scripts/foundry/combat.mjs";
import * as consumables from "../../scripts/foundry/consumables.mjs";
import * as expiry from "../../scripts/foundry/expiry.mjs";
import * as vials from "../../scripts/foundry/vials.mjs";
import { BandolierApp, openBandolier } from "../../scripts/ui/bandolier.mjs";
import { QuickAlchemyPanel, openQuickAlchemy } from "../../scripts/ui/alchemy-panel.mjs";

/** The mark on what the M8 steps give or make. */
export const MARK = `${MODULE_ID}-m8`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const actorOf = (p) => (p.actor ? fromUuidSync(p.actor) : game.user.character);

/**
 * A click for pf2e's Strike that skips its check dialog for this user: pf2e shows the dialog when the user's
 * `showCheckDialogs` is on and a shift-click flips that (`eventToRollParams`). Without it a step would wait on a window
 * nobody clicks (the dev world's users keep pf2e's default, dialogs on).
 */
const noDialog = () => {
    const init = { shiftKey: game.user.settings?.showCheckDialogs !== false, ctrlKey: false, metaKey: false };
    return globalThis.MouseEvent ? new globalThis.MouseEvent("click", init) : init;
};

/**
 * Delete an encounter. Without a canvas pf2e's `EncounterPF2e#_onDelete` throws on every client after the server has
 * deleted it (`game.user.clearTargets()` reads `canvas.scene.id`), so the caller's promise rejects although the encounter
 * is gone; that error is returned, not thrown.
 */
async function deleteFight(fight) {
    try {
        await fight?.delete();
        return null;
    } catch (error) {
        if (fight && game.combats.has(fight.id)) throw error;
        return error.message;
    }
}

async function waitFor(test, ms = 10000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = await test();
        if (value) return value;
        await sleep(100);
    }
    return null;
}

/** An item in brief, with what M8 wrote on it. */
export const itemBrief = (item) => ({
    id: item.id, uuid: item.uuid, name: item.name, qty: item.quantity ?? 1, sourceId: item.sourceId ?? null, temporary: !!item.system?.temporary,
    held: item.system?.equipped?.carryType === "held", traits: [...(item.system?.traits?.value ?? [])],
    expiry: plain(item.flags?.[MODULE_ID]?.expiry ?? null), quick: plain(item.flags?.[MODULE_ID]?.quick ?? null),
    inert: item.flags?.[MODULE_ID]?.inert === true, inertWhy: item.flags?.[MODULE_ID]?.inertFrom?.reason ?? null, by: item._stats?.lastModifiedBy ?? null,
});

/** A character's combat alchemy in brief: vials, Quick Alchemy items, the module's combat flags. */
export function combatBrief(actor) {
    const resource = actor.getResource?.("versatile-vials") ?? null;
    return {
        name: actor.name, uuid: actor.uuid, vials: resource ? { value: resource.value, max: resource.max } : null,
        quick: actor.items.filter((i) => i.flags?.[MODULE_ID]?.quick).map(itemBrief), combat: plain(actor.flags?.[MODULE_ID]?.combat ?? null),
        vialClock: actor.flags?.[MODULE_ID]?.vialClock ?? null, hp: actor.system?.attributes?.hp?.value ?? null,
    };
}

/** The newest chat messages since `since` (ms), in brief: pf2e's origin and context, the module's card. */
function messagesSince(since) {
    return game.messages.filter((m) => m.timestamp >= since).map((m) => ({
        id: m.id, author: m.author?.id ?? null, type: m.flags?.pf2e?.context?.type ?? null, origin: m.flags?.pf2e?.origin?.uuid ?? null,
        options: m.flags?.pf2e?.context?.options ?? [], outcome: m.flags?.pf2e?.context?.outcome ?? null, card: plain(m.flags?.[MODULE_ID]?.card ?? null),
        combat: plain(m.flags?.[MODULE_ID]?.combat ?? null),
    }));
}

/** The Bandolier as it shows now, read from its element. */
function bandolierView() {
    const el = BandolierApp.instance?.element;
    if (!el) return { open: false };
    const buttons = (op) => [...el.querySelectorAll(`button[data-bandolier="${op}"]`)].map((b) => ({ item: b.dataset.item ?? null, map: b.dataset.map ?? null,
        disabled: b.disabled }));
    return {
        open: el.isConnected, pips: el.querySelectorAll(".vial-pip").length, full: el.querySelectorAll(".vial-pip.full").length,
        ready: [...el.querySelectorAll(".ready-item .ready-name")].map((n) => n.textContent.trim()), strikes: buttons("strike"), quickVial: buttons("quick-vial"),
        panel: buttons("panel"), off: el.querySelector(".bandolier-off")?.textContent?.trim() ?? null,
        position: { left: BandolierApp.instance.position.left, top: BandolierApp.instance.position.top },
        hasStyles: getComputedStyle(el).position === "absolute" || getComputedStyle(el).position === "fixed",
    };
}

/** Dispatch a key on an element of a window (a real `KeyboardEvent` of the element's own window, bubbling, as a user's key). */
function key(el, name) {
    const { KeyboardEvent } = el.ownerDocument.defaultView;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

export const COMBAT_SCENARIOS = {
    m8: {
        about: "M8: Quick Alchemy, quick vials, Healing Bomb, Strikes, turn expiry, vial gathering, Duct Tape, Use best consumable, the Bandolier, the panel and the HUD.",
        reset: { about: "GM: take away what the M8 steps gave or Quick Alchemy made on params.actors, refill their vials, clear the combat flags, delete M8 encounters",
            run: async (p) => {
                for (const fight of game.combats.filter((c) => c.flags?.world?.[MARK])) await deleteFight(fight);
                const out = {};
                for (const uuid of p.actors) {
                    const actor = fromUuidSync(uuid);
                    const doomed = actor.items.filter((i) => i.flags?.world?.[MARK] || i.flags?.[MODULE_ID]?.quick).map((i) => i.id);
                    if (doomed.length) await actor.deleteEmbeddedDocuments("Item", doomed);
                    await actor.update({ [`flags.${MODULE_ID}.combat`]: _del, [`flags.${MODULE_ID}.vialClock`]: _del, [`flags.${MODULE_ID}.healed`]: _del });
                    const resource = actor.getResource?.("versatile-vials");
                    if (resource) await actor.updateResource("versatile-vials", resource.max);
                    out[actor.name] = { removed: doomed.length, vials: actor.getResource?.("versatile-vials")?.value ?? null };
                }
                for (const [key, value] of [["features.combat", true], ["features.consumables", true], ["features.vialGathering", false],
                    ["expiry.quickAlchemyAtCombatEnd", true]]) {
                    if (game.settings.get(MODULE_ID, key) !== value) await game.settings.set(MODULE_ID, key, value);
                }
                return out;
            } },
        give: { about: "GM: give params.actor an item or feat from params.uuid with params.system merged, marked for reset", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const source = game.items.fromCompendium(await fromUuid(p.uuid), { keepId: false });
            foundry.utils.mergeObject(source, { system: p.system ?? {}, flags: { world: { [MARK]: true }, ...(p.flags ?? {}) } });
            const [item] = await actor.createEmbeddedDocuments("Item", [source]);
            return { uuid: item.uuid, id: item.id, name: item.name };
        } },
        setting: { about: "GM: set the module's world setting params.key to params.value", run: async (p) => {
            await game.settings.set(MODULE_ID, p.key, p.value);
            return { [p.key]: game.settings.get(MODULE_ID, p.key) };
        } },
        vials: { about: "owner or GM: set params.actor's versatile vials to params.value through pf2e's resource", run: async (p) => {
            const actor = actorOf(p);
            await actor.updateResource("versatile-vials", p.value);
            await sleep(p.ms ?? 300);
            return combatBrief(actor);
        } },
        hp: { about: "GM: set params.actor's Hit Points to params.value", run: async (p) => {
            const actor = actorOf(p);
            await actor.update({ "system.attributes.hp.value": p.value });
            return { hp: actor.system.attributes.hp.value, max: actor.system.attributes.hp.max };
        } },
        facts: { about: "any client: params.actor's combat alchemy as the module reads it (choices, vials, features, ready items, encounter)", run: async (p) => {
            const facts = await alchemy.alchemyFacts(actorOf(p));
            return {
                canQuick: facts.canQuick, vials: plain(facts.vials), combat: plain(facts.combat), additiveSpent: facts.additiveSpent,
                features: { brew: facts.features.brew, additives: facts.features.additives.map((a) => a.key), quickBomber: facts.features.quickBomber,
                    healingBomb: facts.features.healingBomb, splash: plain(facts.features.splash) },
                choices: facts.choices.map((c) => ({ uuid: c.uuid, name: c.name, level: c.level, route: c.route, bomb: c.bomb })),
                ready: facts.ready.map((r) => ({ id: r.id, name: r.name, bomb: r.bomb, potency: plain(r.potency), splash: plain(r.splash), healingBomb: r.healingBomb })),
                off: combat.combatOffReason(),
            };
        } },
        quick: { about: "owner: Quick Alchemy for params.actor (params.uuid, params.second, params.additive, params.combine, params.then, params.map)", run: async (p) => {
            const actor = actorOf(p);
            const since = Date.now();
            const result = await alchemy.quickAlchemy(actor, { uuid: p.uuid, second: p.second ?? null, additive: p.additive ?? null, combine: p.combine ?? null,
                then: p.then ?? "hand", map: p.map ?? 0, event: noDialog() });
            await sleep(p.ms ?? 800);
            return { result: plain(result), brief: combatBrief(actor), messages: messagesSince(since) };
        } },
        vial: { about: "owner: a quick vial for params.actor (params.damageType, params.material, params.quickened, params.then)", run: async (p) => {
            const actor = actorOf(p);
            const since = Date.now();
            const result = await alchemy.quickVial(actor, { damageType: p.damageType ?? null, material: p.material ?? null, quickened: !!p.quickened, then: p.then ?? "hand",
                event: noDialog() });
            await sleep(p.ms ?? 800);
            return { result: plain(result), brief: combatBrief(actor), messages: messagesSince(since) };
        } },
        bomb: { about: "owner: Quick Bomber for params.actor (params.family or params.uuid, params.map)", run: async (p) => {
            const actor = actorOf(p);
            const since = Date.now();
            const result = await alchemy.quickBomb(actor, { family: p.family ?? null, uuid: p.uuid ?? null, map: p.map ?? 0, event: noDialog() });
            await sleep(p.ms ?? 1200);
            return { result: plain(result), brief: combatBrief(actor), messages: messagesSince(since) };
        } },
        strike: { about: "owner: pf2e's Strike with params.item (an item id of params.actor), variant params.map, field vial params.damageType", run: async (p) => {
            const actor = actorOf(p);
            const since = Date.now();
            const result = await combat.strikeWith(actor, actor.items.get(p.item), { map: p.map ?? 0, damageType: p.damageType ?? null, material: p.material ?? null,
                event: noDialog() });
            await sleep(p.ms ?? 1200);
            return { result: plain(result), messages: messagesSince(since), options: plain(actor.rollOptions?.all ?? {}) };
        } },
        healing: { about: "owner: Healing Bomb for params.actor, thrown at params.target (an actor UUID); returns the card", run: async (p) => {
            const actor = actorOf(p);
            const since = Date.now();
            const made = await alchemy.healingBomb(actor);
            if (!made.ok) return { made: plain(made) };
            const thrown = await alchemy.throwHealingBomb(actor, made.items[0].id, { target: p.target });
            await sleep(p.ms ?? 1500);
            return { made: plain(made), thrown: plain(thrown), messages: messagesSince(since), brief: combatBrief(actor) };
        } },
        heal: { about: "a creature's owner: apply the Healing Bomb card params.message's HP to params.actor", run: async (p) => {
            const message = game.messages.get(p.message);
            const hp = message?.flags?.[MODULE_ID]?.combat?.hp ?? 0;
            const result = await alchemy.applyHealingBomb(p.message, { actor: p.actor, hp });
            await sleep(p.ms ?? 800);
            return { result: plain(result), hp: fromUuidSync(p.actor)?.system?.attributes?.hp?.value ?? null };
        } },
        seen: { about: "this client: whether chat message params.message is in its log (whispered to this user, or public)", run: async (p) => {
            await sleep(p.ms ?? 300);
            const message = game.messages.get(p.message);
            return { seen: !!message, whisper: plain(message?.whisper ?? null) };
        } },
        encounter: { about: "GM: an encounter of params.actors (token-less combatants) in that initiative order, started; marked", run: async (p) => {
            const fight = await Combat.implementation.create({ scene: null, active: true, flags: { world: { [MARK]: true } } });
            const actors = p.actors.map((uuid) => fromUuidSync(uuid));
            // Through the Combatant class: pf2e's `EncounterPF2e#createEmbeddedDocuments` reads `canvas.tokens.placeables`, which
            // throws without a canvas (the table's case these plans run in).
            await Combatant.implementation.createDocuments(actors.map((a) => ({ actorId: a.id, sceneId: null, tokenId: null })), { parent: fight });
            // Initiative by actor, not by the order the created combatants come back in.
            for (const [i, actor] of actors.entries()) await fight.setInitiative(fight.combatants.find((c) => c.actorId === actor.id).id, 30 - i);
            await fight.startCombat();
            await sleep(p.ms ?? 800);
            return { id: fight.id, round: fight.round, turn: fight.turn, order: fight.turns.map((c) => c.actor?.name ?? null), initiative: fight.turns.map((c) => c.initiative) };
        } },
        next: { about: "GM: the next turn of params.combat (params.times times)", run: async (p) => {
            const fight = game.combats.get(p.combat);
            for (let i = 0; i < (p.times ?? 1); i++) await fight.nextTurn();
            await sleep(p.ms ?? 1500);
            return { round: fight.round, turn: fight.turn, current: fight.combatant?.actor?.name ?? null };
        } },
        end: { about: "GM: end params.combat (deleted, as core's End does after its question)", run: async (p) => {
            const thrown = await deleteFight(game.combats.get(p.combat));
            await sleep(p.ms ?? 1500);
            return { ended: !game.combats.has(p.combat), thrown };
        } },
        state: { about: "any client: params.actors' combat alchemy in brief, after params.ms", run: async (p) => {
            await sleep(p.ms ?? 0);
            return { actors: (p.actors ?? [game.user.character.uuid]).map((uuid) => combatBrief(fromUuidSync(uuid))), off: combat.combatOffReason() };
        } },
        sweep: { about: "any client: run the expiry sweep now", run: async () => ({ expired: plain(await expiry.expirySweep()) }) },
        gather: { about: "owner: gather reagents for params.actor (params.minutes)", run: async (p) => plain(await vials.gatherReagents(actorOf(p), { minutes: p.minutes ?? 10 })) },
        admixture: { about: "owner: Improvise Admixture for params.actor, without pf2e's dialog", run: async (p) => {
            const since = Date.now();
            const result = await vials.improviseAdmixture(actorOf(p), { skipDialog: true });
            await sleep(p.ms ?? 800);
            return { result: plain(result), messages: messagesSince(since) };
        } },
        clock: { about: "GM: advance world time by params.seconds", run: async (p) => {
            await game.time.advance(p.seconds);
            await sleep(p.ms ?? 2500);
            return { worldTime: game.time.worldTime };
        } },
        ductTape: { about: "any client: Duct Tape active (params.on) on this client only: a stand-in package entry when it is not installed", run: async (p) => {
            const installed = game.modules.get(combat.DUCT_TAPE);
            if (installed && !installed.standIn) return { installed: true, active: installed.active, off: combat.combatOffReason() };
            if (p.on) game.modules.set(combat.DUCT_TAPE, { id: combat.DUCT_TAPE, active: true, standIn: true });
            else game.modules.delete(combat.DUCT_TAPE);
            return { installed: false, active: !!p.on, off: combat.combatOffReason() };
        } },
        useBest: { about: "owner: use the best consumable of params.family for params.actor", run: async (p) => {
            const since = Date.now();
            const result = await consumables.useBest({ family: p.family, actor: actorOf(p), partyWide: !!p.partyWide, choose: async (ties) => ties[0] });
            await sleep(p.ms ?? 800);
            return { result: plain(result), messages: messagesSince(since), holders: plain(consumables.holders(p.family)) };
        } },
        bandolier: { about: "any client: open the Bandolier for params.actor; click params.click (a data-bandolier op, params.item, params.map); move it to params.move", run: async (p) => {
            const actor = actorOf(p);
            const opened = await openBandolier({ actor });
            if (!opened?.ok) return { opened: plain(opened) };
            await sleep(600);
            if (p.move) {
                BandolierApp.instance.setPosition(p.move);
                await sleep(900);
            }
            const since = Date.now();
            if (p.click) {
                const selector = `button[data-bandolier="${p.click}"]${p.item ? `[data-item="${p.item}"]` : ""}${p.map !== undefined ? `[data-map="${p.map}"]` : ""}`;
                BandolierApp.instance.element.querySelector(selector)?.click();
                await sleep(p.ms ?? 1500);
            }
            return { view: bandolierView(), brief: combatBrief(actor), messages: messagesSince(since) };
        } },
        closeBandolier: { about: "any client: close the Bandolier", run: async () => {
            await BandolierApp.instance?.close();
            await waitFor(() => !BandolierApp.instance, 3000);
            return { closed: !BandolierApp.instance, saved: plain(game.settings.get(MODULE_ID, "bandolier.position")) };
        } },
        panel: { about: "any client: open the Quick Alchemy panel for params.actor and drive it with keys: type params.query, ArrowDown, Space, then Enter (params.create)",
            run: async (p) => {
                const actor = actorOf(p);
                const before = actor.items.filter((i) => i.flags?.[MODULE_ID]?.quick).length;
                const opened = await openQuickAlchemy({ actor, bombs: !!p.bombs });
                if (!opened?.ok) return { opened: plain(opened) };
                const app = opened.app;
                await sleep(500);
                const search = app.element.querySelector("[data-quick='search']");
                const focusedSearch = app.element.ownerDocument.activeElement === search;
                search.value = p.query ?? "";
                search.dispatchEvent(new Event("input", { bubbles: true }));
                await sleep(500);
                const stillFocused = app.element.ownerDocument.activeElement === search;
                key(search, "ArrowDown");
                await sleep(400);
                const active = app.element.ownerDocument.activeElement;
                const onOption = active?.dataset?.quick === "option";
                if (onOption) key(active, " ");
                await sleep(400);
                const picks = [...app.picks];
                const shown = app.visible.map((c) => c.name);
                // Read before Enter: a closed ApplicationV2 has no element.
                const hasStyles = !!app.element.querySelector(".qa-list");
                if (p.create) {
                    key(app.element.ownerDocument.activeElement ?? search, "Enter");
                    await sleep(p.ms ?? 1500);
                }
                const after = actor.items.filter((i) => i.flags?.[MODULE_ID]?.quick).length;
                const closed = !QuickAlchemyPanel.instance;
                if (!closed && p.close !== false) key(QuickAlchemyPanel.instance.element.querySelector("[data-quick='search']"), "Escape");
                return { focusedSearch, stillFocused, onOption, picks, shown, made: after - before, closed, hasStyles };
            } },
        hud: { about: "any client with a canvas: bind the token HUD to params.actor's token, open the alchemy palette, use params.entry; then move the token with the palette open",
            run: async (p) => {
                if (!canvas?.ready) return { canvas: false };
                const actor = actorOf(p);
                const token = actor.getActiveTokens(true, false)[0];
                if (!token) return { canvas: true, token: false };
                token.control({ releaseOthers: true });
                await canvas.tokens.hud.bind(token);
                await sleep(500);
                const hudEl = canvas.tokens.hud.element;
                const button = hudEl?.querySelector(".col.left .pf2e-artisans-workshop-hud");
                const view = { canvas: true, token: true, button: !!button, entries: [...(hudEl?.querySelectorAll(".pf2e-artisans-workshop-palette .palette-list-entry") ?? [])]
                    .map((e) => e.dataset.pf2eArtisansWorkshopHud) };
                button?.click();
                await sleep(300);
                view.paletteOpen = hudEl?.querySelector(".pf2e-artisans-workshop-palette")?.classList.contains("active") ?? false;
                // The token moves with the palette open: core renders the HUD again and reopens the palette after the hook.
                const errors = [];
                const onError = (event) => errors.push(String(event.message ?? event));
                window.addEventListener("error", onError);
                await token.document.update({ x: token.document.x + canvas.grid.size });
                await sleep(800);
                await token.document.update({ x: token.document.x - canvas.grid.size });
                await sleep(800);
                window.removeEventListener("error", onError);
                const again = canvas.tokens.hud.element;
                view.afterMove = { buttons: again?.querySelectorAll(".pf2e-artisans-workshop-hud").length ?? 0,
                    paletteOpen: again?.querySelector(".pf2e-artisans-workshop-palette")?.classList.contains("active") ?? false, errors };
                if (p.entry) {
                    const clicked = Date.now();
                    again?.querySelector(`[data-pf2e-artisans-workshop-hud="${p.entry}"]`)?.click();
                    // The panel renders once the catalogue is read: the first time on a client that takes a moment.
                    const opened = p.entry === "quick-alchemy" ? await waitFor(() => QuickAlchemyPanel.instance?.rendered, p.ms ?? 10000) : await sleep(p.ms ?? 1200);
                    view.used = { panel: !!QuickAlchemyPanel.instance, bandolier: !!BandolierApp.instance, brief: combatBrief(actor), ms: opened ? Date.now() - clicked : null };
                }
                return view;
            } },
        arena: { about: "GM: a marked scene with tokens of params.tokens ([{actor, x, y}] in grid squares), activated; with params.off, the scene params.previous active again and the marked scenes deleted",
            run: async (p) => {
                const marked = () => game.scenes.filter((s) => s.flags?.world?.[MARK]);
                if (p.off) {
                    const back = p.previous ? game.scenes.get(p.previous) : null;
                    if (back && !back.active) await back.activate();
                    for (const scene of marked()) await scene.delete();
                    return { active: game.scenes.active?.id ?? null, left: marked().length };
                }
                const previous = game.scenes.active?.id ?? null;
                for (const scene of marked()) await scene.delete();
                const size = 100;
                const scene = await Scene.implementation.create({ name: "Workshop M8 arena", width: 1600, height: 1200, padding: 0, grid: { size },
                    tokenVision: false, fog: { exploration: false }, flags: { world: { [MARK]: true } } });
                const tokens = [];
                for (const { actor: uuid, x, y } of p.tokens) {
                    const actor = fromUuidSync(uuid);
                    const token = await actor.getTokenDocument({ x: x * size, y: y * size, hidden: false });
                    tokens.push(token.toObject());
                }
                await scene.createEmbeddedDocuments("Token", tokens);
                await scene.activate();
                await sleep(p.ms ?? 1500);
                return { id: scene.id, previous, tokens: scene.tokens.map((t) => ({ id: t.id, uuid: t.uuid, name: t.name, actor: t.actor?.uuid ?? null, x: t.x, y: t.y })) };
            } },
        close: { about: "any client: close the Bandolier and the panel", run: async () => {
            await BandolierApp.instance?.close();
            await QuickAlchemyPanel.instance?.close();
            return { closed: true };
        } },
    },
};
