/**
 * Day records in words (DESIGN.md 4.8, 9, 10.5, M6): what a PC's days amounted to ("2 setup days on Elixir of Life",
 * "3 days of work on it: 3 gp off"), and why a plan stopped, with what to do next. The day card, the wizard and the
 * Downtime tab share them. Every sentence is one key, with a key of its own for one day.
 */
import { daysSummary } from "../logic/downtime.mjs";
import { read } from "../foundry/store.mjs";
import { money, number, skillName } from "./format.mjs";
import { ACTIVITY, DAY_STOP, STATUS } from "./labels.mjs";

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
/** The key for one, or for several. */
const plural = (n, key) => (n === 1 ? `${key}One` : key);

/** An order's item as a member may see it: a gift's product stays hidden (4.2.1). */
export function orderName(id) {
    const order = id ? read(`orders.${id}`) : null;
    if (!order) return loc("pf2e-artisans-workshop.Common.Unknown");
    return order.visibility === "gift" ? loc("pf2e-artisans-workshop.Queue.Gift") : order.product?.snapshot?.name ?? "";
}

/** A job by its skill and task level. */
export function jobName(id) {
    const job = id ? read(`jobs.${id}`) : null;
    if (!job) return loc("pf2e-artisans-workshop.Common.Unknown");
    return fmt("pf2e-artisans-workshop.Job.Name", { skill: skillName(job.skill), level: String(job.taskLevel) });
}

/** An activity in words: "Crafting Elixir of Life", "Earn Income (Crafting, task level 3)", "Subsist". */
export function activityText(activity) {
    if (!activity) return loc(ACTIVITY.none);
    const key = ACTIVITY[activity.kind] ?? ACTIVITY.other;
    if (activity.kind === "craft" || activity.kind === "help" || activity.kind === "subject") return fmt(key, { item: orderName(activity.ref) });
    if (activity.kind === "earn") return fmt(key, { job: jobName(activity.ref) });
    return loc(key);
}

/** The days a set of records covers: "3 days (days 4 to 6)", or "1 day (day 4)". */
export function spanText(records) {
    const { days, from, to } = daysSummary(records);
    if (!days) return "";
    return days === 1 ? fmt("pf2e-artisans-workshop.Days.SpanOne", { day: number(from) })
        : fmt("pf2e-artisans-workshop.Days.Span", { n: number(days), from: number(from), to: number(to) });
}

/** One line per activity and order or job the records cover. */
export function dayLines(records) {
    return daysSummary(records).parts.map((p) => {
        const n = number(p.n);
        switch (p.kind) {
            case "setup": return fmt(plural(p.n, "pf2e-artisans-workshop.Days.Setup"), { n, item: orderName(p.ref) });
            case "extra": return fmt(plural(p.n, "pf2e-artisans-workshop.Days.Extra"), { n, item: orderName(p.ref), amount: money(p.cp) });
            case "help": return fmt(plural(p.n, "pf2e-artisans-workshop.Days.Help"), { n, item: orderName(p.ref) });
            case "earn": return fmt(plural(p.n, "pf2e-artisans-workshop.Days.Earn"), { n, job: jobName(p.ref), amount: money(p.cp) });
            case "not-downtime": return fmt(plural(p.n, "pf2e-artisans-workshop.Days.NotDowntime"), { n });
            default: return fmt(plural(p.n, "pf2e-artisans-workshop.Days.Other"), { n, activity: loc(ACTIVITY[p.kind] ?? ACTIVITY.other) });
        }
    });
}

/** Why a plan stopped, and what to do: "Day 5: Elixir of Life needs its Craft check. Roll it, then resolve the rest." */
export function stopText(stop) {
    if (!stop) return null;
    const ref = stop.ref ?? null;
    const job = ref && read(`jobs.${ref}`);
    return fmt(DAY_STOP[stop.reason] ?? DAY_STOP.other, {
        day: number(stop.day), item: job ? jobName(ref) : orderName(ref), reason: stop.reason,
        status: STATUS[stop.status] ? loc(STATUS[stop.status].key) : "",
    });
}
