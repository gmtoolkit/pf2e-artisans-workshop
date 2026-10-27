/**
 * What the Queue shows of M9 (DESIGN.md 6.9, 6.14, 10.3) on an order's detail: a tattoo's or graft's subject (who it is,
 * the process, whether it has agreed and sits for it; "Agree" and "Withdraw" for the subject's owner; after the finish,
 * where the tattoo is: healing until a day, invested, decorative or inactive, with "Record healing"); a fulu's tradition
 * (the crafter chooses one before the start when it is not theirs alone); a finished missive order's blank missives
 * ("Compose" for their owner); and the castings an item lists, each with whether it is offered or cast. Buttons carry
 * `data-action="craft"` and `data-op`; the handler asks what it needs and runs `scripts/foundry/crafts.mjs`.
 */
import { MODULE_ID } from "../constants.mjs";
import { CONSENT_STATUSES, TRADITIONS, selfSubject, subjectProcess } from "../logic/crafts.mjs";
import { WITH_SUBJECT } from "../logic/orders.mjs";
import { livePledges } from "../logic/pledges.mjs";
import { entryMatches } from "../logic/spell-lists.mjs";
import * as crafts from "../foundry/crafts.mjs";
import { actingChoices, viewer as currentViewer } from "../foundry/orders.mjs";
import { traditionsOf } from "../foundry/products.mjs";
import { rulesFromSettings } from "../foundry/settings.mjs";
import { read } from "../foundry/store.mjs";
import { nameOf, number, report } from "./format.mjs";
import { SUBJECT_STATE, TATTOO_PROCESS } from "./labels.mjs";
import { askChoice } from "./prompts.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);
const owns = (uuid) => actorOf(uuid)?.isOwner === true;
const statusOf = (order) => order.status;

/** A magic tradition's name, in pf2e's own words. */
const traditionName = (t) => (CONFIG.PF2E?.magicTraditions?.[t] ? loc(CONFIG.PF2E.magicTraditions[t]) : t);

/** The item a finished tattoo or graft order made, on its subject, or null (it may still wait on the shelf). */
function madeItem(order) {
    const subject = actorOf(order.target);
    return (subject?.items ?? []).find((i) => i.flags?.[MODULE_ID]?.subject?.order === order.id) ?? null;
}

/**
 * A tattoo's or graft's subject on the detail (6.14): who, the process, consent and presence, the item it replaces, and
 * after the finish the made item's state with its healing.
 */
export function subjectView(order) {
    if (!WITH_SUBJECT.includes(order.craftType)) return null;
    const viewer = currentViewer();
    const process = subjectProcess(order.craftType, rulesFromSettings(), order.variant?.process ?? null);
    const consent = order.subject ?? null;
    const self = selfSubject(order);
    const consented = self || !!consent?.consented;
    // Where the process needs the subject present, a subject who agreed but no longer sits for it (another activity, out
    // of downtime) agrees again.
    const subjectActor = actorOf(order.target);
    const status = subjectActor ? read(`pcs.${subjectActor.id}`) : null;
    const sitting = !process.presence || (!!status?.inDowntime && status.activity?.kind === "subject" && status.activity.ref === order.id);
    const open = CONSENT_STATUSES.includes(statusOf(order));
    const name = nameOf(order.target);
    const roster = read(`roster.${subjectActor?.id}`)?.investiture ?? null;
    const item = order.status === "complete" ? madeItem(order) : null;
    const record = item?.flags?.[MODULE_ID]?.subject ?? null;
    const state = record ? SUBJECT_STATE[record.state] ?? null : null;
    const healing = order.healing ?? null;
    return {
        name, process: loc(TATTOO_PROCESS[process.process] ?? TATTOO_PROCESS["secrets-of-magic"]),
        text: self ? fmt("pf2e-artisans-workshop.Subject.Self", { name })
            : !consented ? fmt("pf2e-artisans-workshop.Subject.Waiting", { name })
                : process.presence ? fmt("pf2e-artisans-workshop.Subject.Sitting", { name }) : fmt("pf2e-artisans-workshop.Subject.Agreed", { name }),
        consented, waiting: !consented,
        canConsent: !self && (!consented || !sitting) && open && owns(order.target),
        canWithdraw: !self && consented && open && (owns(order.target) || viewer.isGM === true),
        replaces: order.variant?.replaces ? fmt("pf2e-artisans-workshop.Subject.Replaces", { item: nameOf(order.variant.replaces) }) : null,
        investiture: roster && Number.isInteger(roster.max) ? fmt("pf2e-artisans-workshop.Subject.Investiture", { name, value: number(roster.value ?? 0), max: number(roster.max) }) : null,
        oneAtATime: process.oneAtATime ? loc("pf2e-artisans-workshop.Subject.OneAtATime") : null,
        made: record ? {
            uuid: item.uuid, name: item.name, state: state ? loc(state.key) : record.state, icon: state?.icon ?? null, stateKey: record.state,
            until: record.state === "healing" ? fmt("pf2e-artisans-workshop.Subject.HealingUntil", { day: number(record.until) }) : null,
            healed: healing ? fmt("pf2e-artisans-workshop.Subject.Healed", { day: number(healing.day) }) : null,
            mark: item.flags?.[MODULE_ID]?.mark ? fmt("pf2e-artisans-workshop.Subject.Mark", { n: number(item.flags[MODULE_ID].mark.by) }) : null,
            canHeal: record.state === "healing" && item.isOwner,
        } : null,
    };
}

/** A fulu's tradition on the detail (Secrets of Magic p.158): the one chosen or the crafter's own, and who may choose. */
export function traditionView(order, product) {
    if (!product?.traits?.includes("fulu")) return null;
    const crafter = actorOf(order.crafter);
    const own = crafter ? traditionsOf(crafter) : [];
    const chosen = order.variant?.tradition ?? (own.length === 1 ? own[0] : null);
    return {
        text: chosen ? fmt("pf2e-artisans-workshop.Fulu.Tradition", { tradition: traditionName(chosen) }) : loc("pf2e-artisans-workshop.Fulu.NoTradition"),
        canChoose: !!crafter?.isOwner && ["requested", "accepted", "failed"].includes(statusOf(order)),
        lasts: loc("pf2e-artisans-workshop.Fulu.Lasts"),
    };
}

/** A finished missive order's blank missives this user may compose (Treasure Vault (Remastered) p.84). */
export function missiveView(order, product) {
    if (!product?.traits?.includes("missive") || order.status !== "complete" || order.recipient?.kind !== "actor") return null;
    const holder = actorOf(order.recipient.uuid);
    const blank = crafts.blankMissives(holder).filter((i) => i.flags?.[MODULE_ID]?.crafted?.order === order.id);
    return { blank: blank.map((i) => ({ uuid: i.uuid, name: i.name, qty: number(i.quantity ?? 1), canCompose: i.isOwner })),
        hint: loc("pf2e-artisans-workshop.Missive.Hint") };
}

/** The castings an item lists (6.9, M9), each with the spell, its rank and whether it is offered or cast. */
export function entriesView(order, supply) {
    if (!supply?.entries?.length) return [];
    const pledges = livePledges(order);
    return supply.entries.map((entry) => {
        const pledge = pledges.find((p) => p.entry === entry.key);
        const spell = fromUuidSync(entry.uuid, { strict: false })?.name ?? entry.uuid.split(".").pop();
        return {
            key: entry.key, spell,
            rank: entry.cantrip ? loc("pf2e-artisans-workshop.Pledge.Cantrip") : entry.rank === null ? loc("pf2e-artisans-workshop.Pledge.OwnRank")
                : fmt("pf2e-artisans-workshop.Pledge.Rank", { rank: number(entry.rank) }),
            state: pledge ? pledge.status : "open",
            stateText: loc(pledge?.status === "fulfilled" ? "pf2e-artisans-workshop.Pledge.Status.Fulfilled"
                : pledge ? "pf2e-artisans-workshop.Pledge.Status.Offered" : "pf2e-artisans-workshop.Pledge.Open"),
        };
    });
}

/**
 * The pledge dialog's options for an item that lists its castings: each open entry a caster of this user can supply, as
 * `<spell item UUID>|<entry key>`.
 */
export function listedPledgeOptions(order, supply) {
    const taken = new Set(livePledges(order).map((p) => p.entry).filter(Boolean));
    const out = [];
    for (const actor of actingChoices()) {
        for (const spell of actor.items.filter((i) => i.type === "spell")) {
            const facts = { uuid: spell.uuid, source: spell.sourceId ?? spell._stats?.compendiumSource ?? null, name: spell.name };
            for (const entry of supply.entries.filter((e) => !taken.has(e.key) && entryMatches(e, facts))) {
                const rank = entry.cantrip ? loc("pf2e-artisans-workshop.Pledge.Cantrip") : entry.rank === null ? loc("pf2e-artisans-workshop.Pledge.OwnRank")
                    : fmt("pf2e-artisans-workshop.Pledge.Rank", { rank: number(entry.rank) });
                out.push({ value: `${spell.uuid}|${entry.key}`, caster: actor.uuid,
                    name: fmt("pf2e-artisans-workshop.Pledge.CasterSpellRank", { caster: actor.name, spell: spell.name, rank }) });
            }
        }
    }
    return out;
}

/** The buy dialog's options for an item that lists its castings: each open entry, as `<spell UUID>|<entry key>`. */
export function listedBuyOptions(order, supply) {
    const taken = new Set(livePledges(order).map((p) => p.entry).filter(Boolean));
    return supply.entries.filter((e) => !taken.has(e.key) && !e.cantrip).map((entry) => ({
        value: `${entry.uuid}|${entry.key}`,
        name: fmt("pf2e-artisans-workshop.Pledge.SpellRank", { spell: fromUuidSync(entry.uuid, { strict: false })?.name ?? entry.uuid.split(".").pop(),
            rank: entry.rank === null ? loc("pf2e-artisans-workshop.Pledge.OwnRank") : fmt("pf2e-artisans-workshop.Pledge.Rank", { rank: number(entry.rank) }) }),
    }));
}

/* -------------------------------------------- */
/*  Actions                                      */
/* -------------------------------------------- */

const orderOf = (target) => target.closest("[data-order-id]")?.dataset.orderId ?? null;

/** M9 buttons (`data-action="craft"`): agree, withdraw, choose a tradition, record healing, compose a missive. */
export async function onCraftOp(app, target) {
    const id = orderOf(target);
    const order = id ? read(`orders.${id}`) : null;
    const { op, item } = target.closest("[data-op]")?.dataset ?? {};
    switch (op) {
        case "consent":
            return order ? report(await crafts.consent(id, order.target)) : null;
        case "withdraw-consent":
            return order ? report(await crafts.withdrawConsent(id, order.target)) : null;
        case "tradition": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Fulu.Choose", label: "pf2e-artisans-workshop.Fulu.TraditionLabel",
                options: TRADITIONS.map((t) => ({ value: t, name: traditionName(t) })), button: "pf2e-artisans-workshop.Fulu.Choose", icon: "fa-solid fa-scroll", app });
            return answer?.value ? report(await crafts.chooseTradition(id, answer.value)) : null;
        }
        case "heal":
            return report(await crafts.recordHealing(item));
        case "compose": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Missive.Compose", text: { label: "pf2e-artisans-workshop.Missive.Note" },
                hint: "pf2e-artisans-workshop.Missive.ComposeHint", button: "pf2e-artisans-workshop.Missive.Compose", icon: "fa-solid fa-feather", app });
            return answer ? report(await crafts.composeMissive(item, { note: answer.text ?? "" })) : null;
        }
        default: return null;
    }
}
