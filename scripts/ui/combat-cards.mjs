/**
 * The combat chat cards (DESIGN.md 10.5, 8.3, 8.5-8.7, M8), posted by the client that did the thing (12.3: the hook fires
 * there) and whispered to the character's owners and GMs (or public by `chat.visibility`):
 *
 * - **Quick Alchemy** (and quick vial): what was made, how long it stays potent, the additive, the splash numbers of a
 *   bomb (numbers only, OQ-29), and a Strike button per multiple attack penalty variant for each bomb (pf2e's own Strike;
 *   a Healing Bomb's elixir gets Throw instead). The module's panel makes the items itself, so there is no system Quick
 *   Alchemy card for it to sit under.
 * - **Healing Bomb**: the target, and the living creatures adjacent to it, each with an Apply button for the Hit Points it
 *   regains (each creature's owner, or a GM, applies it, once), and "Apply to my selected tokens" for a table without a
 *   canvas.
 * - **Vials**: vials regained (gathering reagents, Improvise Admixture, the haversack, the clock), with the new count.
 *
 * The card's content is the author's summary; its buttons carry `data-pf2e-artisans-workshop-op`, never `data-action`
 * (pf2e binds every `data-action` button in every message), and are wired on each client in `renderChatMessageHTML`,
 * hidden for a user who may not use them. Nobody edits another user's message.
 */
import { MODULE_ID } from "../constants.mjs";
import { applyHealingBomb, readyFacts, splashOf, throwHealingBomb } from "../foundry/alchemy.mjs";
import { strikeWith } from "../foundry/combat.mjs";
import { setting } from "../foundry/settings.mjs";
import { potencyText, splashText, strikeButtons } from "./bandolier.mjs";
import { featName, number, report } from "./format.mjs";

const TEMPLATE = "modules/pf2e-artisans-workshop/templates/chat/alchemy.hbs";
const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);

/** The card kinds this module posts for combat (`flags.MOD.card.kind`). */
export const COMBAT_CARDS = Object.freeze(["quick-alchemy", "quick-vial", "healing-bomb", "vials"]);

/** Who a card goes to: the actor's owners and GMs, or everyone (`chat.visibility`). */
function whisperFor(actor) {
    if (setting("chat.visibility") === "public") return [];
    const owners = game.users.filter((u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER")).map((u) => u.id);
    return [...new Set([...game.users.filter((u) => u.isGM).map((u) => u.id), ...owners, game.user.id])];
}

/** Post a card. Never throws: a card is a courtesy. */
async function post(actor, kind, data, flags = {}) {
    try {
        const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, { kind, ...data });
        return await ChatMessage.implementation.create({
            content, speaker: ChatMessage.implementation.getSpeaker({ actor }), whisper: whisperFor(actor),
            flags: { [MODULE_ID]: { card: { kind, order: null }, combat: flags } },
        });
    } catch (error) {
        console.warn(`${MODULE_ID} | could not post a ${kind} card`, error);
        return null;
    }
}

/** The Quick Alchemy card (10.5): the items made, their potency, additive and splash, and their Strike or Throw buttons. */
export async function postQuickAlchemyCard({ actor, items, additive = null, kind = "quick-alchemy" }) {
    const facts = readyFacts(actor);
    const lines = [];
    const buttons = [];
    for (const made of items) {
        const item = actor.items.get(made.id);
        if (!item) continue;
        const ready = facts?.ready.find((r) => r.id === item.id) ?? null;
        lines.push({ icon: "fa-solid fa-flask", text: fmt("pf2e-artisans-workshop.Card.QuickMade", { item: item.name, potency: potencyText(ready?.potency) ?? "" }) });
        const splash = ready?.bomb ? splashText(splashOf(actor, item, facts.features)) : null;
        if (splash) lines.push({ icon: "fa-solid fa-burst", text: splash });
        if (ready?.healingBomb) {
            buttons.push({ op: "throw", actor: actor.uuid, item: item.id, map: 0, icon: "fa-solid fa-hand-holding-medical", label: loc("pf2e-artisans-workshop.Bandolier.Throw") });
        } else if (ready?.bomb) {
            for (const strike of strikeButtons(actor, item)) {
                buttons.push({ op: "strike", actor: actor.uuid, item: item.id, map: strike.map, icon: "fa-solid fa-bomb",
                    label: fmt("pf2e-artisans-workshop.Card.Strike", { item: item.name, variant: strike.label }) });
            }
        }
    }
    if (additive) lines.push({ icon: "fa-solid fa-droplet", text: fmt("pf2e-artisans-workshop.Bandolier.Additive", { additive: featName(additive) }) });
    return post(actor, kind, {
        heading: loc(kind === "quick-vial" ? "pf2e-artisans-workshop.Card.QuickVial" : "pf2e-artisans-workshop.Card.QuickAlchemy"), img: actor.img ?? null,
        summary: fmt("pf2e-artisans-workshop.Card.Summary.QuickAlchemy", { actor: actor.name, n: number(items.length) }), lines, buttons,
    });
}

/** The Healing Bomb card (10.5, 8.6): the target, and an Apply button for each adjacent living creature. */
export async function postHealingBombCard({ actor, card }) {
    const buttons = card.adjacent.map((a) => ({ op: "heal", actor: a.actor, token: a.token, map: 0, icon: "fa-solid fa-heart",
        label: fmt("pf2e-artisans-workshop.Card.HealOne", { name: a.name, hp: number(card.hp) }) }));
    buttons.push({ op: "heal-selected", map: 0, icon: "fa-solid fa-heart-circle-plus", label: fmt("pf2e-artisans-workshop.Card.HealSelected", { hp: number(card.hp) }) });
    const lines = [{ icon: "fa-solid fa-bullseye", text: fmt("pf2e-artisans-workshop.Card.HealingTarget", { target: card.target.name, item: card.item }) },
        { icon: "fa-solid fa-heart", text: fmt(card.adjacent.length ? "pf2e-artisans-workshop.Card.HealingAdjacent" : "pf2e-artisans-workshop.Card.HealingNoneKnown",
            { hp: number(card.hp), n: number(card.adjacent.length) }) }];
    return post(actor, "healing-bomb", {
        heading: loc("pf2e-artisans-workshop.Card.HealingBomb"), img: actor.img ?? null,
        summary: fmt("pf2e-artisans-workshop.Card.Summary.HealingBomb", { actor: actor.name, target: card.target.name }), lines, buttons,
    }, { hp: card.hp, target: card.target.actor });
}

/** Why vials came back, in words (8.7). */
const VIAL_WHY = Object.freeze({
    gather: "pf2e-artisans-workshop.Card.VialsWhy.Gather",
    admixture: "pf2e-artisans-workshop.Card.VialsWhy.Admixture",
    haversack: "pf2e-artisans-workshop.Card.VialsWhy.Haversack",
    clock: "pf2e-artisans-workshop.Card.VialsWhy.Clock",
});

/** The Vials card (10.5, 8.7): +n vials, the new count. */
export async function postVialsCard({ actor, gained, to, why }) {
    const max = actor.getResource?.("versatile-vials")?.max ?? to;
    return post(actor, "vials", {
        heading: loc("pf2e-artisans-workshop.Card.Vials"), img: actor.img ?? null,
        summary: fmt("pf2e-artisans-workshop.Card.Summary.Vials", { actor: actor.name, n: number(gained), value: number(to), max: number(max) }),
        lines: [{ icon: "fa-solid fa-leaf", text: loc(VIAL_WHY[why] ?? VIAL_WHY.gather) }], buttons: [],
    });
}

/* -------------------------------------------- */
/*  Buttons                                      */
/* -------------------------------------------- */

/** Whether this user may use a card button: the character's owner (a GM owns all). */
function mayUse(button) {
    const op = button.dataset.pf2eArtisansWorkshopOp;
    if (op === "heal-selected") return true;
    return !!actorOf(button.dataset.actor)?.isOwner;
}

/** One button. */
async function run(message, button, event) {
    const op = button.dataset.pf2eArtisansWorkshopOp;
    const actor = actorOf(button.dataset.actor);
    const hp = message.flags?.[MODULE_ID]?.combat?.hp ?? 0;
    switch (op) {
        case "strike": {
            const item = actor?.items.get(button.dataset.item);
            return item ? strikeWith(actor, item, { map: Number(button.dataset.map) || 0, event }) : { ok: false, reason: "item-gone" };
        }
        case "throw": return actor ? throwHealingBomb(actor, button.dataset.item) : null;
        case "heal": return applyHealingBomb(message.id, { actor: button.dataset.actor, token: button.dataset.token ?? null, hp });
        case "heal-selected": {
            const tokens = (canvas?.tokens?.controlled ?? []).filter((t) => t.actor?.isOwner);
            if (!tokens.length) return { ok: false, reason: "no-creature" };
            let last = null;
            for (const token of tokens) last = await applyHealingBomb(message.id, { actor: token.actor, token: token.document?.uuid ?? null, hp });
            return last;
        }
        default: return null;
    }
}

/** Wire a combat card's buttons on this client: hide the ones this user may not use; one click at a time. */
export function renderCombatCard(message, html) {
    const card = message.flags?.[MODULE_ID]?.card;
    if (!card || !COMBAT_CARDS.includes(card.kind) || !foundry.utils.isElementInstanceOf(html, HTMLElement)) return false;
    for (const button of html.querySelectorAll("button[data-pf2e-artisans-workshop-op]")) {
        if (!mayUse(button)) {
            button.hidden = true;
            continue;
        }
        if (button.dataset.pf2eArtisansWorkshopOp === "heal" && actorOf(button.dataset.actor)?.flags?.[MODULE_ID]?.healed?.[message.id]) button.disabled = true;
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            if (button.disabled) return;
            button.disabled = true;
            try {
                const result = await run(message, button, event);
                report(result);
                if (!(result?.ok && button.dataset.pf2eArtisansWorkshopOp === "heal")) button.disabled = false;
            } catch (error) {
                button.disabled = false;
                throw error;
            }
        });
    }
    return true;
}

/** Hooks at `init`: the cards, from the client that did the thing, and their buttons on every client. */
export function registerCombatCards() {
    Hooks.on(`${MODULE_ID}.quickAlchemy`, (payload) => postQuickAlchemyCard(payload));
    Hooks.on(`${MODULE_ID}.healingBomb`, (payload) => postHealingBombCard(payload));
    Hooks.on(`${MODULE_ID}.vialsRegained`, (payload) => {
        if (payload.gained > 0) postVialsCard(payload);
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        try {
            renderCombatCard(message, html);
        } catch (error) {
            console.warn(`${MODULE_ID} | could not render a combat card`, error);
        }
    });
}
