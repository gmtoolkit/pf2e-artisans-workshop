/**
 * The Morning tab (DESIGN.md 10.1, 7.1-7.10, M7): one character's daily preparations (own characters for a player, every
 * member for a GM).
 *
 * - **Where it stands**: the preparation cycle and whether this cycle's preparations are made (by the Workshop or from
 *   the sheet), "Make daily preparations", "Prepare for a new day" (a new cycle without a rest, 7.2), and the standing
 *   routine of a character in downtime.
 * - **Pools** (7.1): every daily crafting pool with its slots, item level and batch, its sources (which one wins), what is
 *   prepared counted by level, the plan (keep, or a loadout), a talisman pool's picker (no formula book, 7.4) and its DC
 *   stamp, and what the plan makes (each grade with its route), with problems and the diff against the last preparation.
 * - **Standing orders due** (7.6), as chips the crafter may leave out; the standing orders the character asked for or
 *   receives, with "End" and "Ask for a standing order".
 * - **Vials** (7.3), other prepared slots (snares, with their quick-deploy ledger, M9), frequencies, the gap registry entries (7.10) with their
 *   ticks, Food Preservation's designations, loadouts (save the current preparation, apply one, delete), the affix board
 *   (7.4) and what the character holds that will expire (7.7).
 *
 * The window keeps the tab's state (`app.morning`): the character, each pool's plan, the talismans picked, the standing
 * orders left out, the loadout name being typed.
 */
import { registered, sinkItems } from "../foundry/extensions.mjs";
import { familyBaseName } from "../logic/families.mjs";
import { MAX_QTY } from "../logic/morning.mjs";
import { deploySnare, setSnareMark } from "../foundry/crafts.mjs";
import { members } from "../foundry/roster.mjs";
import {
    affixBoardOf, affixOwn, applyMorning, captureLoadout, dailiesActive, deleteLoadout, endStanding, markGap, morningFacts, morningOn, placeStanding,
    planMorning, preservable, preserve, standingFor, unaffixOwn, waitingToPrepare,
} from "../foundry/morning.mjs";
import { cycleOf, expiredWhy, isInert, stampOf } from "../foundry/expiry.mjs";
import { statusOf } from "../foundry/downtime.mjs";
import { canWrite } from "../foundry/state.mjs";
import { stampNow, write } from "../foundry/store.mjs";
import { featName, nameOf, number, report } from "./format.mjs";
import { askChoice, confirm } from "./prompts.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);

/** The cycle's state in words (icon and word, 10.9). */
const STATE = Object.freeze({
    fresh: { key: "pf2e-artisans-workshop.Morning.State.Fresh", icon: "fa-solid fa-sun" },
    prepared: { key: "pf2e-artisans-workshop.Morning.State.Prepared", icon: "fa-solid fa-circle-check" },
    sheet: { key: "pf2e-artisans-workshop.Morning.State.Sheet", icon: "fa-solid fa-file-lines" },
});

/** A line's route as a badge (4.3). */
const ROUTE = Object.freeze({
    known: { key: "pf2e-artisans-workshop.Morning.Route.Known", icon: "fa-solid fa-book" },
    family: { key: "pf2e-artisans-workshop.Morning.Route.Family", icon: "fa-solid fa-sitemap" },
    virtual: { key: "pf2e-artisans-workshop.Morning.Route.Virtual", icon: "fa-solid fa-wand-sparkles" },
});

/** A plan problem in words. */
const PROBLEM = Object.freeze({
    slots: "pf2e-artisans-workshop.Morning.Problem.Slots",
    "no-grade": "pf2e-artisans-workshop.Morning.Problem.NoGrade",
    "unknown-family": "pf2e-artisans-workshop.Morning.Problem.UnknownFamily",
    "no-pool": "pf2e-artisans-workshop.Morning.Problem.NoPool",
    "no-loadout": "pf2e-artisans-workshop.Morning.Problem.NoLoadout",
    "too-many": "pf2e-artisans-workshop.Morning.Problem.TooMany",
    "not-offered": "pf2e-artisans-workshop.Morning.Problem.NotOffered",
    "standing-slots": "pf2e-artisans-workshop.Morning.Problem.StandingSlots",
});

/** A diff line's kind in words (7.5). */
const DIFF = Object.freeze({
    new: "pf2e-artisans-workshop.Morning.Diff.New",
    grade: "pf2e-artisans-workshop.Morning.Diff.Grade",
    qty: "pf2e-artisans-workshop.Morning.Diff.Qty",
    removed: "pf2e-artisans-workshop.Morning.Diff.Removed",
    same: "pf2e-artisans-workshop.Morning.Diff.Same",
});

/** An affix host's state in words. */
const HOST_STATE = Object.freeze({
    empty: "pf2e-artisans-workshop.Morning.Affix.Empty",
    active: "pf2e-artisans-workshop.Morning.Affix.Active",
    suppressed: "pf2e-artisans-workshop.Morning.Affix.Suppressed",
});

/** The characters whose Morning this user may open: their own; every member for a GM (10.1). */
export function morningChoices() {
    return members().filter((actor) => actor.isOwner);
}

/** The tab's state, with defaults. */
export function morningState(app) {
    app.morning ??= { actor: null, plans: {}, talismans: {}, skipped: [], loadoutName: "", wilderness: false };
    return app.morning;
}

/** The character the tab shows: the chosen one, else the window's acting character, else the first choice. */
export function morningActor(app) {
    const state = morningState(app);
    const choices = morningChoices();
    return choices.find((a) => a.uuid === state.actor) ?? choices.find((a) => a.uuid === app.actingActor?.()?.uuid) ?? choices[0] ?? null;
}

/** The Morning tab's badge (7.8): the user's characters a rest has left waiting to prepare. */
export function morningBadge() {
    try {
        return waitingToPrepare().length;
    } catch {
        return 0;
    }
}

/** A plan problem as a sentence. */
function problemText(problem, pools) {
    const pool = pools.find((p) => p.slug === problem.pool);
    return fmt(PROBLEM[problem.reason] ?? "pf2e-artisans-workshop.Morning.Problem.Other", {
        pool: pool?.label ?? problem.pool ?? "", used: String(problem.used ?? ""), max: String(problem.max ?? problem.maxItemLevel ?? ""),
        name: problem.name ? familyBaseName(problem.name) : "", level: String(problem.maxItemLevel ?? ""),
    });
}

/** When a stamped item expires, in words (7.7). */
function expiryText(item) {
    const stamp = stampOf(item);
    const creator = nameOf(stamp.creator);
    if (stamp.exempt) return fmt("pf2e-artisans-workshop.Morning.Expiry.Preserved", { creator });
    if (Number.isFinite(stamp.at)) {
        const hours = Math.max(0, Math.ceil((stamp.at - (game.time.worldTime ?? 0)) / 3600));
        return fmt("pf2e-artisans-workshop.Morning.Expiry.Advanced", { creator, hours: String(hours) });
    }
    return fmt("pf2e-artisans-workshop.Morning.Expiry.Prep", { creator });
}

/** Everything the Morning tab shows. */
export async function morningContext(app) {
    if (!morningOn()) return { morningOff: true };
    const state = morningState(app);
    const actor = morningActor(app);
    const choices = morningChoices().map((a) => ({ uuid: a.uuid, name: a.name, selected: a === actor }));
    if (!actor) return { morning: { choices, actor: null } };
    const facts = await morningFacts(actor, undefined, { wilderness: state.wilderness === true });
    const skipped = new Set(state.skipped);
    const due = planMorning(facts, { pools: {}, talismans: {}, standing: "due" }).due;
    const standing = due.filter((s) => !skipped.has(s.id)).map((s) => s.id);
    const plan = planMorning(facts, { pools: state.plans, talismans: state.talismans, standing });
    const loadouts = Object.values(facts.loadouts);
    const pools = facts.pools.map((pool) => {
        const resolved = plan.pools[pool.slug] ?? null;
        const picks = state.talismans[pool.slug] ?? [];
        const countOf = (uuid) => picks.filter((u) => u === uuid).length;
        const choice = state.plans[pool.slug]?.mode === "loadout" ? state.plans[pool.slug].id : "keep";
        return {
            slug: pool.slug, label: pool.label, talisman: pool.talisman,
            slots: pool.max === null ? null : fmt("pf2e-artisans-workshop.Morning.Slots", { used: number(pool.used), max: number(pool.max) }),
            // pf2e's own count beside the rules' when the registry corrects it (6.11 `correction`, 7.1).
            corrected: pool.corrected ? fmt("pf2e-artisans-workshop.Morning.Corrected", { system: number(pool.systemMaxSlots), max: number(pool.max) }) : null,
            maxItemLevel: number(pool.maxItemLevel), batch: number(pool.batchSize), insufficient: pool.insufficient, made: pool.made,
            sources: pool.sources.map((s) => ({ name: s.name, slots: Number.isInteger(s.correctedSlots ?? s.maxSlots) ? number(s.correctedSlots ?? s.maxSlots) : null,
                level: s.maxItemLevel === null ? null : number(s.maxItemLevel), wins: s.key === pool.merged.winners.maxSlots && pool.sources.length > 1 })),
            byLevel: pool.byLevel.map((b) => fmt("pf2e-artisans-workshop.Morning.ByLevel", { level: String(b.level), n: number(b.count) })),
            prepared: pool.prepared.map((p) => ({ name: p.name, img: p.img, level: p.level, qty: number(p.quantity), expended: p.expended })),
            plans: [
                { value: "keep", label: loc("pf2e-artisans-workshop.Morning.Keep"), selected: choice === "keep" },
                ...loadouts.filter((l) => l.pools?.[pool.slug] || l.talismans?.[pool.slug]).map((l) => ({ value: l.id, label: l.name, selected: choice === l.id })),
            ],
            // A count per talisman: two of one are two picks (7.4), at most the pool's slots.
            offered: pool.offered.map((item) => ({ uuid: item.uuid, name: item.name, img: item.img, level: item.level, count: countOf(item.uuid),
                picked: countOf(item.uuid) > 0 })),
            pickedCount: number(picks.length), pickMax: pool.max ?? "",
            dcStamp: pool.dcStamp && Number.isInteger(facts.dcs.classDc ?? facts.dcs.spellDc)
                ? fmt("pf2e-artisans-workshop.Morning.DcStamp", { dc: String(Math.max(facts.dcs.classDc ?? 0, facts.dcs.spellDc ?? 0)) }) : null,
            lines: (resolved?.lines ?? []).map((line) => ({ name: line.item.name, level: line.item.level, qty: number(line.qty),
                route: ROUTE[line.route] ?? ROUTE.known, request: line.standing.length > 0 })),
            planned: resolved ? fmt("pf2e-artisans-workshop.Morning.Planned", { batches: number(resolved.batches), max: resolved.max === null ? "—" : number(resolved.max) }) : null,
        };
    });
    const status = facts.status;
    const cycleState = STATE[facts.state] ?? STATE.fresh;
    const vials = facts.vials ? {
        text: fmt("pf2e-artisans-workshop.Morning.Vials", { value: number(facts.vials.value), max: number(facts.vials.max) }),
        level: facts.vials.level === null ? null : number(facts.vials.level), consistent: facts.vials.consistent,
        inventory: number(facts.vials.inventory), stacks: facts.vials.stacks,
        sources: facts.vialSources.map((s) => ({ name: featName(s.key), regain: s.regain })),
        buckets: facts.vials.buckets ? Object.entries(facts.vials.buckets).map(([material, n]) => ({ material, n: number(n) })) : null,
    } : null;
    const held = (facts.actor.items ?? []).filter((item) => stampOf(item));
    const board = affixBoardOf(actor);
    const gaps = facts.gaps.map((g) => ({ key: g.key, name: featName(g.key), flow: g.flow, done: facts.morning.gaps?.[g.key] === status.prepCycle,
        handled: g.handledBy === "pf2e-dailies", notAutomated: g.flow === "dailies" && !g.handledBy }));
    const placed = standingFor([actor]).filter((s) => s.requester === actor.uuid || s.recipient === actor.uuid).map((s) => ({
        id: s.id, text: fmt("pf2e-artisans-workshop.Morning.StandingPlaced", { qty: number(s.qty), item: s.name || s.family, crafter: nameOf(s.crafter), recipient: nameOf(s.recipient) }),
        active: s.active, last: s.last ? fmt("pf2e-artisans-workshop.Morning.StandingLast", { day: String(s.last.day) }) : null,
    }));
    return {
        morning: {
            choices, actor: { uuid: actor.uuid, name: actor.name, level: actor.level }, ready: canWrite(),
            state: { ...cycleState, word: loc(cycleState.key) }, cycle: number(status.prepCycle),
            lastDay: Number.isInteger(facts.morning.day) ? number(facts.morning.day) : null,
            canPrepare: facts.state === "fresh" && (facts.pools.length > 0 || !!facts.vials), canAgain: facts.state !== "fresh" && facts.pools.length > 0,
            inDowntime: status.inDowntime, routine: status.standingRoutine === true, dailies: dailiesActive(),
            wildernessAsked: facts.pools.some((p) => p.contexts?.includes("wilderness")), wilderness: state.wilderness === true,
            pools, hasPools: pools.length > 0,
            problems: plan.problems.map((p) => problemText(p, facts.pools)),
            diff: plan.diff.filter((d) => d.kind !== "same" || d.request).map((d) => fmt(DIFF[d.kind] ?? DIFF.same, { item: d.name, qty: number(d.qty), from: d.from?.name ?? "" })
                + (d.request ? ` ${loc("pf2e-artisans-workshop.Morning.Diff.Request")}` : "")),
            due: due.map((s) => ({ id: s.id, included: !skipped.has(s.id),
                text: fmt("pf2e-artisans-workshop.Morning.StandingDue", { qty: number(s.qty), item: s.name || s.family, requester: nameOf(s.requester), recipient: nameOf(s.recipient) }) })),
            placed,
            vials,
            slots: facts.slots.map((s) => ({ slug: s.slug, label: s.label, slots: s.maxSlots === null ? null : number(s.maxSlots),
                byLevel: s.byLevel.map((b) => fmt("pf2e-artisans-workshop.Morning.ByLevel", { level: String(b.level), n: number(b.count) })),
                // M9 (7.1): the quick-deploy ledger: each prepared snare ready or deployed, giant and broad ones at two slots.
                ledger: s.ledger ? ledgerView(s.ledger, actor.isOwner) : null })),
            frequencies: facts.frequencies.map((f) => ({ name: f.name, text: fmt("pf2e-artisans-workshop.Morning.Frequency", { value: number(f.value), max: number(f.max) }) })),
            gaps,
            preservable: preservable(actor).map((item) => ({ id: item.id, name: item.name, preserved: !!stampOf(item).exempt })),
            // M10 (12.2): what the extensions' consumable sinks would take of what the character holds now (not inert, not expired).
            sinks: registered("consumableSink").map((sink) => ({ sink, n: sinkItems(sink.id, actor).reduce((sum, item) => sum + (item.quantity ?? 1), 0) }))
                .filter((s) => s.n > 0).map((s) => fmt("pf2e-artisans-workshop.Morning.SinkLine", { sink: loc(s.sink.label), n: number(s.n) })),
            loadouts: loadouts.map((l) => ({ id: l.id, name: l.name, pools: Object.keys(l.pools ?? {}).concat(Object.keys(l.talismans ?? {}))
                .map((slug) => facts.pools.find((p) => p.slug === slug)?.label ?? slug).join(", ") })),
            loadoutName: state.loadoutName,
            board: board && !board.manager ? {
                hosts: board.hosts.filter((h) => h.count > 0 || board.loose.length).map((h) => ({ id: h.id, name: h.name, state: loc(HOST_STATE[h.state]), suppressed: h.state === "suppressed",
                    sage: h.sage, warn: h.warn, talismans: h.talismans.map((t) => ({ id: t.id, name: t.name, inert: t.inert })) })),
                loose: board.loose.map((t) => ({ id: t.id, name: t.name, inert: t.inert })), hostChoices: board.hosts.map((h) => ({ id: h.id, name: h.name })),
                minutes: board.loose.length ? fmt(board.minutes === 1 ? "pf2e-artisans-workshop.Morning.Affix.MinutesOne" : "pf2e-artisans-workshop.Morning.Affix.Minutes", { n: number(board.minutes) }) : null, sage: board.sage,
            } : null,
            manager: board?.manager === true,
            expiring: held.filter((item) => !isInert(item)).map((item) => ({ id: item.id, name: item.name, qty: number(item.quantity ?? 1), text: expiryText(item),
                due: !!expiredWhy(item) })),
            inert: held.filter((item) => isInert(item)).map((item) => ({ id: item.id, name: item.name })),
        },
    };
}

/** A prepared snare pool's quick-deploy ledger as the tab shows it (7.1, M9). */
function ledgerView(ledger, owner) {
    const markOptions = (current) => [null, ...ledger.allowed].map((mark) => ({ value: mark ?? "", selected: (current ?? null) === mark,
        label: loc(mark === "giant" ? "pf2e-artisans-workshop.Morning.Snare.Mark.Giant" : mark === "broad" ? "pf2e-artisans-workshop.Morning.Snare.Mark.Broad"
            : "pf2e-artisans-workshop.Morning.Snare.Mark.Plain") }));
    return {
        used: fmt("pf2e-artisans-workshop.Morning.Snare.Used", { used: number(ledger.used), max: ledger.max === null ? "-" : number(ledger.max) }),
        over: ledger.over ? fmt("pf2e-artisans-workshop.Morning.Snare.Over", { n: number(ledger.over) }) : null,
        deployed: fmt("pf2e-artisans-workshop.Morning.Snare.Deployed", { deployed: number(ledger.deployed), ready: number(ledger.ready) }),
        canMark: owner && ledger.allowed.length > 0,
        entries: ledger.entries.map((e) => ({ key: e.key, index: e.index, name: e.name ?? "", deployed: e.deployed, cost: e.cost > 1 ? fmt("pf2e-artisans-workshop.Morning.Snare.Cost", { n: number(e.cost) }) : null,
            state: loc(e.deployed ? "pf2e-artisans-workshop.Morning.Snare.IsDeployed" : "pf2e-artisans-workshop.Morning.Snare.Ready"),
            marks: markOptions(e.mark), canDeploy: owner && !e.deployed })),
    };
}

/* -------------------------------------------- */
/*  Changes and actions                          */
/* -------------------------------------------- */

/** A select, checkbox or text field of the tab changed; returns whether the tab should render again. */
export function onMorningChange(app, target) {
    const state = morningState(app);
    const field = target.dataset?.morning;
    if (!field) return false;
    if (field === "actor") {
        Object.assign(state, { actor: target.value, plans: {}, talismans: {}, skipped: [], wilderness: false });
        return true;
    }
    if (field === "plan") {
        const pool = target.dataset.pool;
        state.plans = { ...state.plans, [pool]: target.value === "keep" ? { mode: "keep" } : { mode: "loadout", id: target.value } };
        return true;
    }
    if (field === "talisman") {
        // A count per talisman (a number field; a checkbox counts one): the picks keep one UUID per talisman.
        const { pool, uuid } = target.dataset;
        const wanted = target.type === "checkbox" || target.value === undefined ? (target.checked ? 1 : 0) : Math.trunc(Number(target.value));
        const count = Number.isFinite(wanted) ? Math.max(0, Math.min(wanted, MAX_QTY)) : 0;
        const others = (state.talismans[pool] ?? []).filter((u) => u !== uuid);
        state.talismans = { ...state.talismans, [pool]: [...others, ...Array(count).fill(uuid)] };
        return true;
    }
    if (field === "wilderness") {
        state.wilderness = target.checked === true;
        return true;
    }
    if (field === "standing") {
        const skipped = new Set(state.skipped);
        if (target.checked) skipped.delete(target.dataset.standing);
        else skipped.add(target.dataset.standing);
        state.skipped = [...skipped];
        return true;
    }
    if (field === "loadoutName") {
        state.loadoutName = target.value;
        return false;
    }
    if (field === "snareMark") {
        // M9 (7.1): a giant or broad quick-deploy snare costs two slots; the mark is the owner's own flag.
        const actor = morningActor(app);
        if (actor) setSnareMark(actor.uuid, target.dataset.pool, target.dataset.key, target.value || null).then(report);
        return false;
    }
    return false;
}

/** Typing in the loadout's name keeps it across live renders. */
export function onMorningInput(app, target) {
    if (target.dataset?.morning !== "loadoutName") return false;
    morningState(app).loadoutName = target.value;
    return true;
}

/** Set a character's standing routine (7.2), as its owner: a downtime day's rest then starts a new cycle. */
async function setRoutine(actor, on) {
    if (!canWrite() || !actor?.isOwner) return { ok: false, reason: "not-owner" };
    const stamp = stampNow();
    await write({ set: { [`pcs.${actor.id}.id`]: actor.id, [`pcs.${actor.id}.v`]: 1, [`pcs.${actor.id}.by`]: stamp.by, [`pcs.${actor.id}.at`]: stamp.at,
        [`pcs.${actor.id}.standingRoutine`]: on } });
    return { ok: true };
}

/** The standing orders a character may ask for: an item a member's daily pool prepares now, as `crafter|pool|uuid`. */
function standingOptions() {
    const out = [];
    for (const crafter of members()) {
        for (const ability of [...(crafter.crafting?.abilities ?? [])].filter((a) => a.isDailyPrep)) {
            for (const data of ability.preparedFormulaData ?? []) {
                const item = fromUuidSync(data.uuid, { strict: false });
                if (!item) continue;
                out.push({ value: `${crafter.uuid}|${ability.slug}|${data.uuid}`, name: fmt("pf2e-artisans-workshop.Morning.StandingOption", { crafter: crafter.name, item: item.name }) });
            }
        }
    }
    return out;
}

/** A Morning tab button (`data-op`). */
export async function onMorningOp(app, target) {
    const state = morningState(app);
    const actor = morningActor(app);
    const op = target.dataset.op;
    if (!actor) return null;
    const skipped = new Set(state.skipped);
    const plan = { pools: state.plans, talismans: state.talismans, wilderness: state.wilderness === true };
    switch (op) {
        case "prepare":
        case "again": {
            if (op === "again" && !(await confirm({ title: "pf2e-artisans-workshop.Prompt.Again.Title", content: "pf2e-artisans-workshop.Prompt.Again.Content", app }))) return null;
            const facts = await morningFacts(actor, undefined, { wilderness: plan.wilderness });
            const due = planMorning(facts, { standing: "due" }).due.filter((s) => !skipped.has(s.id)).map((s) => s.id);
            const result = report(await applyMorning(actor, { ...plan, standing: due, again: op === "again" }));
            if (result?.ok) state.talismans = {};
            return result;
        }
        case "routine": return report(await setRoutine(actor, !statusOf(actor).standingRoutine));
        case "capture": {
            const name = state.loadoutName?.trim() || fmt("pf2e-artisans-workshop.Morning.LoadoutDefault", { cycle: String(cycleOf(actor.uuid) ?? 0) });
            const result = report(await captureLoadout(actor, name));
            if (result?.ok) state.loadoutName = "";
            return result;
        }
        case "deleteLoadout": return report(await deleteLoadout(actor, target.dataset.loadout));
        case "endStanding": return report(await endStanding(target.dataset.standing));
        case "askStanding": {
            const answer = await askChoice({ title: "pf2e-artisans-workshop.Morning.AskStanding", label: "pf2e-artisans-workshop.Morning.StandingWhat", options: standingOptions(),
                number: { label: "pf2e-artisans-workshop.Morning.StandingQty", min: 1, value: 1 }, button: "pf2e-artisans-workshop.Morning.AskStanding", app });
            if (!answer?.value) return null;
            const [crafter, pool, uuid] = answer.value.split("|");
            return report(await placeStanding({ requester: actor.uuid, crafter, pool, uuid, qty: answer.number ?? 1 }));
        }
        case "gap": return report(await markGap(actor, target.dataset.gap, target.dataset.done !== "true"));
        case "preserve": return report(await preserve(actor, [target.dataset.item]));
        case "affix": {
            // The button carries `data-talisman` itself: the host's select is in the talisman's list item.
            const host = target.closest("li")?.querySelector("select[data-morning='host']")?.value;
            return report(await affixOwn(actor, target.dataset.talisman, host));
        }
        case "unaffix": return report(await unaffixOwn(actor, target.dataset.talisman));
        case "deploy": return report(await deploySnare(actor.uuid, target.dataset.pool, Number(target.dataset.index)));
        default: return null;
    }
}
