/**
 * Live-harness steps for M8a (DESIGN.md 8.10, 15.3 scenario 12), merged into the scenarios of `sync-scenarios.mjs` as
 * scenario `m8a`. The live driver's behaviour checks (`live-plans.mjs`, the `m8a-*` plans) run them: poisons given and
 * coated, Strikes through pf2e's own Strike, exposures, saves rolled and rerolled through pf2e, the trackers and their
 * conditions read back, world time and logged days, encounters, the effects panel's own calls, Affliction Forge's stand-in
 * and the Afflictions window.
 *
 * Every step goes through the module's own functions or pf2e's. What the steps give is marked
 * `flags.world.pf2e-artisans-workshop-m8a`; `reset` takes it away with every tracker, coating, exposure claim and condition a
 * tracker granted. Console output only: a developer tool, not module interface.
 */
import { MODULE_ID } from "../../scripts/constants.mjs";
import * as afflictions from "../../scripts/foundry/afflictions.mjs";
import { backend, definitionOf } from "../../scripts/foundry/affliction-defs.mjs";
import * as coatings from "../../scripts/foundry/coatings.mjs";
import { FORGE } from "../../scripts/foundry/forge.mjs";
import { AfflictionsApp, openAfflictions } from "../../scripts/ui/afflictions.mjs";

/** The mark on what the M8a steps give or make. */
export const MARK = `${MODULE_ID}-m8a`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const actorOf = (p) => (p.actor ? fromUuidSync(p.actor) : game.user.character);

/** Wait until `test()` gives something, at most `ms`. */
async function waitFor(test, ms = 10000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const value = await test();
        if (value) return value;
        await sleep(100);
    }
    return null;
}

/** A creature's afflictions in brief: its trackers with their run state and badge, its conditions, its pending saves. */
export function afflictionBrief(actor) {
    return {
        name: actor.name, uuid: actor.uuid,
        trackers: afflictions.trackersOf(actor).map((t) => {
            const run = afflictions.runOf(t);
            return { id: t.id, uuid: t.uuid, type: t.type, name: t.name, badge: plain(t.system?.badge ?? null), stage: run.stage, phase: run.phase, streak: run.streak ?? 0,
                pending: plain(run.pending), nextDueAt: run.nextDueAt, maxEndsAt: run.maxEndsAt, dc: plain(run.dc), saves: plain(run.saves), manual: plain(run.manual ?? {}),
                by: t._stats?.lastModifiedBy ?? null, unidentified: !!t.system?.unidentified };
        }),
        conditions: actor.items.filter((i) => i.type === "condition").map((c) => ({ slug: c.slug, value: c.system?.value?.value ?? null,
            grantedBy: plain(c.flags?.pf2e?.grantedBy ?? null) })),
        pending: afflictions.pendingOf(actor).map((p) => ({ kind: p.kind, runId: p.runId, seq: p.seq, claim: p.claim?.id ?? null })),
        ended: Object.keys(actor.flags?.[MODULE_ID]?.afflictionEnded ?? {}),
    };
}

/** The newest chat messages since `since` (ms), in brief. */
function messagesSince(since) {
    return game.messages.filter((m) => m.timestamp >= since).map((m) => ({
        id: m.id, author: m.author?.id ?? null, type: m.flags?.pf2e?.context?.type ?? null, outcome: m.flags?.pf2e?.context?.outcome ?? null,
        options: m.flags?.pf2e?.context?.options ?? [], card: plain(m.flags?.[MODULE_ID]?.card ?? null), affliction: plain(m.flags?.[MODULE_ID]?.affliction ?? null),
        whisper: [...(m.whisper ?? [])],
        // What the card says, as the chat log shows it (the module's cards only): a check reads its numbers, or a raw key.
        ...(m.flags?.[MODULE_ID]?.card ? { text: m.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) } : {}),
    }));
}

/** The exposure claims in the ledger, in brief. */
function exposureClaims() {
    const ledger = game.journal.find((j) => j.flags?.[MODULE_ID]?.role === "ledger");
    return Object.values(ledger?.flags?.[MODULE_ID]?.claims ?? {}).filter((c) => c?.kind === "exposure" || c?.kind === "coating-spend").map((c) => ({
        id: c.id, kind: c.kind, actor: c.actor, idem: c.idem, pending: plain(c.pending ?? null), resolved: !!c.resolved, outcome: c.outcome ?? null, dc: plain(c.dc ?? null),
        forge: plain(c.forge ?? null), by: c.by,
    }));
}

/** The Afflictions window as it shows now, read from its element. */
function windowView() {
    const el = AfflictionsApp.instance?.element;
    if (!el) return { open: false };
    return {
        open: el.isConnected, actors: [...el.querySelectorAll(".affliction-actor h3")].map((h) => h.textContent.trim()),
        trackers: [...el.querySelectorAll(".affliction-tracker .affliction-head strong")].map((n) => n.textContent.trim()),
        stages: [...el.querySelectorAll(".affliction-tracker .affliction-stage")].map((n) => n.textContent.trim()),
        buttons: [...el.querySelectorAll("button[data-affliction]")].map((b) => b.dataset.affliction),
    };
}

export const AFFLICTION_SCENARIOS = {
    m8a: {
        about: "M8a: afflictions: coatings and Strikes, exposure and saves, rerolls, timing, logged days, the effects panel, Affliction Forge, the window.",
        reset: { about: "GM: take away M8a's items, every tracker and what it granted, coatings, exposure claims; afflictions settings to their defaults", run: async (p) => {
            const out = {};
            for (const uuid of p.actors) {
                const actor = fromUuidSync(uuid);
                if (!actor) continue;
                const trackers = actor.items.filter((i) => afflictions.isTracker(i)).map((i) => i.id);
                const granted = actor.items.filter((i) => i.flags?.[MODULE_ID]?.affliction?.granted).map((i) => i.id);
                const marked = actor.items.filter((i) => i.flags?.world?.[MARK]).map((i) => i.id);
                const doomed = [...new Set([...trackers, ...granted, ...marked])];
                if (doomed.length) await actor.deleteEmbeddedDocuments("Item", doomed, afflictions.ownWrite());
                const coated = actor.items.filter((i) => i.flags?.[MODULE_ID]?.coating).map((i) => ({ _id: i.id, [`flags.${MODULE_ID}.coating`]: _del }));
                if (coated.length) await actor.updateEmbeddedDocuments("Item", coated);
                await actor.update({ [`flags.${MODULE_ID}.afflictionEnded`]: _del });
                out[actor.name] = { removed: doomed.length, coatings: coated.length };
            }
            const defaults = [["features.afflictions", true], ["afflictions.pcSaves", "prompt"], ["afflictions.npcSaves", "auto"], ["afflictions.gmRollsForOfflinePCs", false],
                ["afflictions.autoApplyDamage", false], ["afflictions.catchUp", "roll-each"], ["afflictions.catchUpLimit", 20], ["afflictions.combatAnchor", "exposure-turn"],
                ["afflictions.handOffToForge", true], ["afflictions.forgeWithoutGm", "workshop"]];
            for (const [key, value] of defaults) if (game.settings.get(MODULE_ID, key) !== value) await game.settings.set(MODULE_ID, key, value);
            return out;
        } },
        npc: { about: "any client: the fixture NPC named params.name (17a ordinary, 17b immune to poison, 17c 9th level)", run: async (p) => {
            // The fixture builder names an NPC after its fixture and the creature: "Fixture 17a: ordinary NPC (Goblin Warrior)".
            const actor = game.actors.find((a) => a.name === p.name || a.name.startsWith(`${p.name} (`)) ?? null;
            return actor ? { uuid: actor.uuid, id: actor.id, name: actor.name, level: actor.level } : { missing: p.name };
        } },
        give: { about: "GM: give params.actor params.qty of params.uuid (an item or feat) with params.system merged, marked for reset", run: async (p) => {
            const actor = fromUuidSync(p.actor);
            const source = game.items.fromCompendium(await fromUuid(p.uuid), { keepId: false });
            foundry.utils.mergeObject(source, { system: { ...(p.qty ? { quantity: p.qty } : {}), ...(p.system ?? {}) }, flags: { world: { [MARK]: true }, ...(p.flags ?? {}) } });
            const [item] = await actor.createEmbeddedDocuments("Item", [source]);
            return { uuid: item.uuid, id: item.id, name: item.name };
        } },
        setting: { about: "GM: set the module's world setting params.key to params.value", run: async (p) => {
            await game.settings.set(MODULE_ID, p.key, p.value);
            return { [p.key]: game.settings.get(MODULE_ID, p.key) };
        } },
        definition: { about: "any client: the affliction definition of params.uuid as this client reads it (parse, override, world)", run: async (p) => {
            const def = await definitionOf(p.uuid);
            return { origin: def?.origin ?? null, confidence: def?.confidence ?? null, stages: def?.stages?.length ?? 0, save: plain(def?.save ?? null),
                reExposure: def?.reExposure ?? null, problems: plain(def?.problems ?? []), backend: backend() };
        } },
        coat: { about: "owner: apply params.poison (an item id) to params.weapon (an item id) of params.actor (params.replace, params.double)", run: async (p) => {
            const actor = actorOf(p);
            const since = Date.now();
            const result = await coatings.applyPoison({ poison: actor.items.get(p.poison), weapon: actor.items.get(p.weapon), actor, replace: !!p.replace, double: !!p.double });
            await sleep(p.ms ?? 600);
            const host = actor.items.find((i) => i.flags?.[MODULE_ID]?.coating && (i.id === p.weapon || i.id === result.host));
            return { result: plain(result), coating: plain(host?.flags?.[MODULE_ID]?.coating ?? null), messages: messagesSince(since) };
        } },
        strike: { about: "owner: pf2e's Strike with params.weapon of params.actor at params.target (targeted), then its damage when it hits (params.damage)", run: async (p) => {
            const actor = actorOf(p);
            const since = Date.now();
            const weapon = actor.items.get(p.weapon);
            const strike = actor.system.actions.find((a) => a.item?.id === weapon?.id && a.type === "strike");
            const target = p.target ? fromUuidSync(p.target) : null;
            // The placeable (not the document): `Token#setTarget` targets it for this user.
            const token = target?.getActiveTokens?.(true)?.[0] ?? null;
            if (token) token.setTarget(true, { releaseOthers: true });
            // pf2e's Strike reads its dialog from the event, not `skipDialog` (`CheckPF2e.roll`, `eventToRollParams`): a click that
            // skips it for this user, as M8's steps do, or the step waits on a dialog nobody clicks.
            const click = (dialogs) => new globalThis.MouseEvent("click", { shiftKey: game.user.settings?.[dialogs] !== false });
            const attack = await strike?.variants?.[p.map ?? 0]?.roll({ event: click("showCheckDialogs") });
            let damage = null;
            if (p.damage && attack) damage = await strike.damage({ event: click("showDamageDialogs") });
            await sleep(p.ms ?? 1800);
            const host = actor.items.get(p.weapon);
            return { attack: attack ? attack.total ?? null : null, damage: !!damage, coating: plain(host?.flags?.[MODULE_ID]?.coating ?? null), messages: messagesSince(since),
                claims: exposureClaims() };
        } },
        expose: { about: "any client: expose params.targets to params.item (an item UUID) with params.delivery, params.dc, params.key", run: async (p) => {
            const since = Date.now();
            const result = await afflictions.expose({ item: p.item, targets: p.targets.map((u) => fromUuidSync(u)), delivery: p.delivery ?? null, dc: p.dc ?? null,
                key: p.key ?? null, deliverer: p.deliverer ? fromUuidSync(p.deliverer) : null });
            await sleep(p.ms ?? 1500);
            return { result: plain(result), claims: exposureClaims(), messages: messagesSince(since) };
        } },
        unleash: { about: "owner: unleash params.poison (an inhaled poison's item id) of params.actor at params.targets", run: async (p) => {
            const actor = actorOf(p);
            const since = Date.now();
            const result = await coatings.unleash({ poison: actor.items.get(p.poison), actor, targets: (p.targets ?? []).map((u) => fromUuidSync(u)) });
            await sleep(p.ms ?? 1500);
            return { result: plain(result), claims: exposureClaims(), messages: messagesSince(since) };
        } },
        touch: { about: "owner: params.actor touches (or eats) params.host (an item UUID) coated with a contact or ingested poison", run: async (p) => {
            const result = await coatings.touchCoating({ host: p.host, toucher: actorOf(p) });
            await sleep(p.ms ?? 1500);
            return { result: plain(result), claims: exposureClaims() };
        } },
        roll: { about: "owner or GM: roll params.actor's first pending save (or params.runId/params.seq) through pf2e, without its dialog; wait for the record", run: async (p) => {
            const actor = actorOf(p);
            const pending = p.runId ? { runId: p.runId, seq: p.seq } : afflictions.pendingOf(actor)[0] ?? null;
            if (!pending) return { none: true, brief: afflictionBrief(actor) };
            // An exposure is listed as soon as its claim is written, but its save can be rolled only once the target's
            // responsible client has applied the claim (the claims sweep, which may be busy with an earlier run): wait for that.
            await waitFor(() => afflictions.pendingSave(actor, pending), p.applyMs ?? 8000);
            const since = Date.now();
            const result = await afflictions.rollSave(actor, { runId: pending.runId, seq: pending.seq }, { skipDialog: true, voluntaryFail: !!p.voluntaryFail });
            await waitFor(() => !afflictions.pendingOf(actor).some((x) => x.runId === pending.runId && x.seq === pending.seq), p.ms ?? 6000);
            return { result: plain(result), pending: plain({ runId: pending.runId, seq: pending.seq }), messages: messagesSince(since), brief: afflictionBrief(actor) };
        } },
        reroll: { about: "owner: reroll the newest affliction save message of params.actor with a Hero Point (pf2e's own reroll)", run: async (p) => {
            const actor = actorOf(p);
            const message = game.messages.contents.findLast((m) => m.actor === actor && (m.flags?.pf2e?.context?.options ?? []).some((o) => o.startsWith(`${MODULE_ID}:affliction:`)));
            if (!message) return { none: true };
            const since = Date.now();
            await game.pf2e.Check.rerollFromMessage(message, { resource: "hero-points" });
            await sleep(p.ms ?? 2500);
            return { messages: messagesSince(since), brief: afflictionBrief(actor) };
        } },
        brief: { about: "any client: params.actors' afflictions in brief, after params.ms", run: async (p) => {
            await sleep(p.ms ?? 0);
            return { actors: p.actors.map((uuid) => afflictionBrief(fromUuidSync(uuid))), claims: exposureClaims() };
        } },
        process: { about: "any client: process the trackers this client is responsible for now", run: async () => plain(await afflictions.processAfflictions()) },
        clock: { about: "GM: advance world time by params.seconds", run: async (p) => {
            await game.time.advance(p.seconds);
            await sleep(p.ms ?? 3000);
            return { worldTime: game.time.worldTime, clock: afflictions.clockNow() };
        } },
        logDays: { about: "any client: log params.days days with the Advance days wizard's commit (no PC activity), moving the affliction clock", run: async (p) => {
            const downtime = await import("../../scripts/foundry/downtime.mjs");
            const result = await downtime.advanceDays({ kind: "days", count: p.days ?? 1, assignments: {} });
            await sleep(p.ms ?? 2500);
            return { result: plain(result), clock: afflictions.clockNow(), worldTime: game.time.worldTime };
        } },
        clockToMatch: { about: "GM: advance the clock to match the logged days", run: async (p) => {
            const downtime = await import("../../scripts/foundry/downtime.mjs");
            const result = await downtime.advanceClockToMatch();
            await sleep(p.ms ?? 3000);
            return { result: plain(result), clock: afflictions.clockNow(), worldTime: game.time.worldTime };
        } },
        panel: { about: "owner: what pf2e's effects panel does on a click of params.actor's tracker params.tracker: increase() on the left, decrease() on the right", run: async (p) => {
            const actor = actorOf(p);
            const tracker = actor.items.get(p.tracker);
            if (!tracker) return { gone: true };
            if (p.button === "right") await tracker.decrease?.();
            else await tracker.increase?.();
            await sleep(p.ms ?? 1500);
            return { brief: afflictionBrief(actor) };
        } },
        adjust: { about: "owner: a manual change to params.tracker of params.actor (params.stage, params.end, params.undo)", run: async (p) => {
            const actor = actorOf(p);
            const result = await afflictions.adjust(actor.items.get(p.tracker), { stage: p.stage ?? null, end: !!p.end, undo: !!p.undo, endOnset: !!p.endOnset });
            await sleep(p.ms ?? 1000);
            return { result: plain(result), brief: afflictionBrief(actor) };
        } },
        forge: { about: "any client: Affliction Forge active (params.on) on this client only: a stand-in package entry that records its calls when it is not installed", run: async (p) => {
            const installed = game.modules.get(FORGE);
            if (installed && !installed.standIn) return { installed: true, active: installed.active };
            if (p.on) {
                const calls = [];
                game.modules.set(FORGE, { id: FORGE, active: true, standIn: true, calls, api: {
                    application: { apply: async (args) => {
                        if (!game.user.isGM) throw new Error("Affliction Forge stand-in: not on a GM client");
                        calls.push(plain({ templateUuid: args.templateUuid, context: args.context, user: game.user.id }));
                    } },
                    instances: { listForActor: async () => [] }, templates: { list: async () => [] },
                } });
            } else game.modules.delete(FORGE);
            return { installed: false, active: !!p.on };
        } },
        forgeCalls: { about: "any client: what the Affliction Forge stand-in on this client was asked to apply", run: async () => ({ calls: plain(game.modules.get(FORGE)?.calls ?? []) }) },
        link: { about: "GM: link params.uuid (an item UUID) to the Forge template params.template (an Affliction Forge reference on the item)", run: async (p) => {
            const item = fromUuidSync(p.uuid);
            await item.update({ [`flags.${FORGE}.afflictionReferences`]: [{ schemaVersion: 1, id: "m8a", templateUuid: p.template, trigger: "on-hit", application: "manual", enabled: true }] });
            return { linked: true };
        } },
        identify: { about: "GM: params.item (an item UUID) identified (params.on) or unidentified, as pf2e's identification sets it", run: async (p) => {
            const item = fromUuidSync(p.item);
            if (p.on) await item.setIdentificationStatus?.("identified");
            else await item.setIdentificationStatus?.("unidentified");
            return { identified: item.isIdentified !== false };
        } },
        window: { about: "any client: open the Afflictions window and read it", run: async (p) => {
            await openAfflictions();
            await sleep(p.ms ?? 800);
            return windowView();
        } },
        close: { about: "any client: close the Afflictions window", run: async () => {
            await AfflictionsApp.instance?.close();
            return { closed: !AfflictionsApp.instance };
        } },
    },
};
