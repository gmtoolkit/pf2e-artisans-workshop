/**
 * Archiving (DESIGN.md 5.3.3, As built in M12b): what an archive run moves out of the live ledger into the Crafting Log, and
 * the summaries it leaves behind. Pure: the ledger's flags in, one run's plan out; `scripts/foundry/housekeeping.mjs` sends it.
 *
 * What moves, once past OQ-36's ages (`ARCHIVE_THRESHOLDS`: 30 workshop days for orders and jobs, 60 for rows and day records,
 * and never anything written less than a real day ago, since logged days can run far ahead of the clock):
 * - a closed order (complete or cancelled, its log agreeing) that holds nothing: every row applied, every contributor's
 *   allocation back to nothing, no claim open, nothing of it in the strongbox (shelf, earmarked or handed-over items), with its
 *   rows, its claims and its day records;
 * - an ended Earn Income job whose every day is paid and whose claims are resolved, with its rows, claims and day records;
 * - the party fund's own rows (no order, garden, job or extension source), applied, a reversal only with the row it reverses,
 *   none an open order's log names (its undo reverses them), nor a live service's payment (its cancel refunds it);
 * - day records of nothing still live, and resolved claims of nothing still live, past the row age.
 * What stays: every PC's latest day record (`resolvedThrough` is derived from them, 4.8), extension runs and rows (their day
 * records say what they owe, 12.6), gardens, services and everything else.
 *
 * What the live ledger keeps instead is one `carry` row per actor (and one for the party fund, `actor` null): the sums of the
 * archived rows' `box`, `purse` and `alloc`, so the expected strongbox coins, the unallocated fund and the Funds tab's identity
 * do not move; `share`, each member's net deposits among them, so their share of the fund (`memberBalances`) does not either;
 * and `fundDebits`, the fund rows that took money out, so the fund slot's number never goes back (`fundDebitCount`). Each run
 * folds the carry rows already there into its own, so there is one per actor however many runs there were.
 *
 * A run is one request (`scripts/foundry/housekeeping.mjs`), in this order: its lock pages, the Crafting Log's pages (the run's
 * own page first, `archiveRunPageId`), then the ledger update that writes the carry rows and deletes the archived records, then
 * the deletion of the archived rows' lock pages. Its lock pages are the run's slot (`archive:<runs>`, `meta.archive.runs`
 * before it), so of two runs planned from the same copy only one lands; the next log slot of every order and job it archives,
 * so an undo or any other transition planned from a copy that still had them open cannot land with it (an order reopened by
 * undo is not archived; one archived is not reopened); and the row id of the reversal of every fund row it moves that could
 * still be reversed (`reversal:<row>`), so a Funds-tab reversal and the run cannot both land. A run that stops after its lock
 * leaves the records live and its slot taken; the slot is an "age" lock page, so the pruner frees it (5.4) and the next run
 * repeats the work. The run's own page in the Crafting Log is never pruned: a run planned again from a stale copy is refused.
 */
import { compareRows, liveRows, stampTime } from "./core.mjs";
import { isDayRecord } from "./downtime.mjs";
import { isFundRow } from "./funds.mjs";
import { compareIds, hashId, idemKey } from "./ids.mjs";
import { jobLog, jobLogLockId } from "./jobs.mjs";
import { isPlainObject, liveRecords } from "./keypath.mjs";
import { lockIdOf } from "./locks.mjs";
import { lastEntry, logLockId } from "./orders.mjs";
import { makeRow } from "./rows.mjs";
import { REVERSIBLE_KINDS } from "./views.mjs";

/** OQ-36's archive ages, in workshop days, and the real age nothing younger than is archived (ms, on the server's clock). */
export const ARCHIVE_THRESHOLDS = Object.freeze({ orderDays: 30, rowDays: 60, minRealMs: 24 * 60 * 60 * 1000 });

/** The most records one run moves; the rest wait for the next run, so no request grows without bound. */
export const ARCHIVE_RUN_LIMIT = 3000;

/** The collections a run archives from, and the Crafting Log's pages hold. */
export const ARCHIVED = Object.freeze(["orders", "rows", "days", "claims", "jobs"]);

/** The version of an archive page's shape. */
export const ARCHIVE_PAGE_VERSION = 1;

/** The Crafting Log's page of a world year (5.3.3: one page per world year). Not a lock page: it lives in the log. */
export const archivePageId = (year) => hashId(idemKey("archive-year", year));

/** The lock page of an archive run's slot: the number of runs before it (`meta.archive.runs`). */
export const archiveSlotId = (runs) => lockIdOf("archive", runs);

/**
 * The Crafting Log's page that records one archive run (5.3.3, As built in M12b: a run planned from a stale copy). The run's
 * request creates it, with its id kept, before the ledger update, so the server refuses at its dry run any later request that
 * names it. The run's slot in the ledger (`archiveSlotId`) is an "age" lock page the pruner deletes after `PRUNE_AGE_MS`; this
 * page is never deleted, so a run planned again from a copy that missed it is refused however late it comes, and none of it
 * costs a ledger write anything. `attempt`: a run that stopped after this page and before its ledger update left
 * `meta.archive.runs` where it was, so the next try at the same run takes the next attempt's page (`archiveRunAttempt`).
 */
export const archiveRunPageId = (runs, attempt) => hashId(idemKey("archive-run", runs, attempt));

/** The first attempt at run `runs` whose page `has` (a copy of the Crafting Log's pages) does not find. */
export function archiveRunAttempt(runs, has) {
    let attempt = 0;
    while (has(archiveRunPageId(runs, attempt))) attempt += 1;
    return attempt;
}

/**
 * A run's page in the Crafting Log (`archiveRunPageId`): which run, which attempt, what it moved. Hidden from players (the
 * year pages hold the records; ownership NONE over the journal's OBSERVER).
 */
export function archiveRunPageData(runs, attempt, { name, counts, stamp }) {
    return {
        _id: archiveRunPageId(runs, attempt), name, type: "text", ownership: { default: 0 },
        flags: { "pf2e-artisans-workshop": { role: "archive-run", v: ARCHIVE_PAGE_VERSION, run: runs, attempt, counts, by: stamp.by, at: stamp.at } },
    };
}

/** Fund rows that change a member's claim on the fund (as `memberBalances` counts them). */
const FUND_SHARE_KINDS = Object.freeze(["deposit", "withdraw", "refund"]);

/** States an order is archived in. */
const ARCHIVABLE_STATES = Object.freeze(["complete", "cancelled"]);

/** Job states that are over. */
const ENDED_JOBS = Object.freeze(["ended", "fired"]);

/** Whether an order still holds an item line in the strongbox (6.6, M5 custody): not given back, not used. */
const holdsItems = (order) => [...Object.values(order.custody ?? {}), ...Object.values(order.materials ?? {})]
    .some((line) => isPlainObject(line) && line.kind !== "coin" && !line.returned && !line.used);

/** Whether a claim still waits for its owner's client: unresolved, or a formula claim not yet in the book. */
export const claimOpen = (claim) => !claim.resolved || (claim.kind === "formula" && !claim.applied);

/** The world year a workshop day falls in. */
export const yearOf = (day, daysPerYear = 365) => Math.floor((Number.isInteger(day) ? day : 0) / daysPerYear);

/**
 * One archive run's plan.
 *
 * @param {object} p
 * @param {object} p.flags       the ledger's module flags (orders, rows, days, claims, jobs, meta)
 * @param {number} p.today       the workshop day (4.8)
 * @param {number} p.now         the moment on the server's clock (`serverNow`)
 * @param {(at: object) => number|null} p.dayOf  the workshop day of a stamp: its clock day (rows carry no day of their own)
 * @param {Set<string>} [p.held] ids of orders whose items are still in the strongbox (shelf, earmarked, handed over)
 * @param {{by: string, at: object}} p.stamp  the archiving user's stamp, for the carry rows and the run record
 * @param {object} [p.thresholds]
 * @param {number} [p.daysPerYear]
 * @param {number} [p.limit]     the most records the run moves
 * @returns {{empty: boolean, runs: number, slot: string, locks: string[], keys: object, orders: string[], jobs: string[],
 *            rows: string[], days: string[], claims: string[], stubs: string[], carries: object[], folded: string[],
 *            years: Map<number, object>, change: {set: object, replace: object, del: string[]}, lockPages: string[]}}
 *          `locks`: the run's lock pages (its slot, the log slots, then the reversal row ids of the fund rows it moves that could
 *          still be reversed, whose keys are in `keys`); `lockPages`: the lock pages of the archived rows and claims (their own,
 *          apply marks, re-creation locks) to delete if they exist; `years`: each world year's records
 */
export function planArchive({ flags, today, now, dayOf, held = new Set(), stamp, thresholds = ARCHIVE_THRESHOLDS, daysPerYear = 365, limit = ARCHIVE_RUN_LIMIT }) {
    const t = { ...ARCHIVE_THRESHOLDS, ...thresholds };
    const live = Object.fromEntries(ARCHIVED.map((c) => [c, liveRecords(flags?.[c])]));
    const rowsById = new Map(live.rows.map((r) => [r.id, r]));
    const claimsById = new Map(live.claims.map((c) => [c.id, c]));
    const byLink = (list, key) => Map.groupBy(list.filter((r) => typeof r[key] === "string"), (r) => r[key]);
    const rowsByOrder = byLink(live.rows, "order");
    const rowsByJob = byLink(live.rows, "job");
    const daysByOrder = byLink(live.days, "order");
    const daysByJob = byLink(live.days, "job");
    const claimsByOrder = byLink(live.claims, "order");
    const claimsByJob = byLink(live.claims, "job");
    const dayOfAt = (at) => {
        const day = at ? dayOf(at) : null;
        return Number.isInteger(day) ? day : null;
    };
    const rowDay = (row) => (Number.isInteger(row.day) ? row.day : dayOfAt(row.at));
    const maxOf = (values) => values.filter(Number.isInteger).reduce((max, v) => (max === null ? v : Math.max(max, v)), null);
    const oldEnough = (day, at, ageDays) => Number.isInteger(day) && day <= today - ageDays && now - stampTime(at ?? {}) >= t.minRealMs;
    const applied = (rows) => rows.every((r) => r.state === "applied");
    const runs = Number.isInteger(flags?.meta?.archive?.runs) ? flags.meta.archive.runs : 0;

    // Orders: closed, settled, holding nothing, old enough.
    const orders = [];
    const orderDay = new Map();
    for (const order of [...live.orders].sort(compareRows)) {
        const last = lastEntry(order);
        if (!ARCHIVABLE_STATES.includes(order.status) || !last || last.to !== order.status) continue;
        const own = rowsByOrder.get(order.id) ?? [];
        if (!applied(own)) continue;
        const perActor = new Map();
        for (const row of own) perActor.set(row.actor ?? null, (perActor.get(row.actor ?? null) ?? 0) + (row.alloc ?? 0));
        if ([...perActor.values()].some((cp) => cp !== 0)) continue;
        if ((claimsByOrder.get(order.id) ?? []).some(claimOpen) || held.has(order.id) || holdsItems(order)) continue;
        const closed = maxOf([dayOfAt(last.at), ...own.map(rowDay), ...(daysByOrder.get(order.id) ?? []).map((d) => d.toDay ?? d.day)]);
        if (!oldEnough(closed, last.at, t.orderDays)) continue;
        orders.push(order);
        orderDay.set(order.id, closed);
    }

    // Jobs: ended, every day paid, nothing open, old enough.
    const jobs = [];
    const jobDay = new Map();
    for (const job of [...live.jobs].sort(compareRows)) {
        if (!ENDED_JOBS.includes(job.status)) continue;
        const own = rowsByJob.get(job.id) ?? [];
        if (!applied(own) || (claimsByJob.get(job.id) ?? []).some(claimOpen)) continue;
        const paid = new Set(liveRows(own).filter((r) => r.kind === "wage").map((r) => r.day));
        const days = daysByJob.get(job.id) ?? [];
        if (days.some((d) => d.wageCp > 0 && !paid.has(d.day))) continue;
        const last = jobLog(job).at(-1) ?? null;
        const lastDay = maxOf([dayOfAt(last?.at ?? job.at), ...own.map(rowDay), ...days.map((d) => d.toDay ?? d.day)]);
        if (!oldEnough(lastDay, last?.at ?? job.at, t.orderDays)) continue;
        jobs.push(job);
        jobDay.set(job.id, lastDay);
    }

    // The run's size: whole orders and jobs first, as long as they fit.
    let budget = limit;
    const take = (list, sizeOf) => list.filter((item) => {
        const size = sizeOf(item);
        if (size > budget && budget < limit) return false;
        budget -= size;
        return true;
    });
    const sizeOfOrder = (o) => 1 + (rowsByOrder.get(o.id)?.length ?? 0) + (daysByOrder.get(o.id)?.length ?? 0) + (claimsByOrder.get(o.id)?.length ?? 0);
    const sizeOfJob = (j) => 1 + (rowsByJob.get(j.id)?.length ?? 0) + (daysByJob.get(j.id)?.length ?? 0) + (claimsByJob.get(j.id)?.length ?? 0);
    const keptOrders = take(orders, sizeOfOrder);
    const keptJobs = take(jobs, sizeOfJob);
    const archivedOrders = new Set(keptOrders.map((o) => o.id));
    const archivedJobs = new Set(keptJobs.map((j) => j.id));
    const liveOrderIds = new Set(live.orders.map((o) => o.id));
    const liveJobIds = new Set(live.jobs.map((j) => j.id));
    const staysOrder = (id) => typeof id === "string" && liveOrderIds.has(id) && !archivedOrders.has(id);
    const staysJob = (id) => typeof id === "string" && liveJobIds.has(id) && !archivedJobs.has(id);

    // Rows an order that stays names in its log (an undo reverses them), and a service's payment (a cancel refunds it,
    // `refundPayment`, which reads the live row; services are never archived).
    const named = new Set();
    for (const order of live.orders) {
        if (archivedOrders.has(order.id)) continue;
        for (const entry of Object.values(order.log ?? {})) for (const id of isPlainObject(entry) ? entry.rows ?? [] : []) named.add(id);
    }
    for (const service of liveRecords(flags?.services)) if (typeof service.payment?.row === "string") named.add(service.payment.row);

    // The party fund's own rows, a reversal only with the row it reverses.
    const reversalOf = new Map(live.rows.filter((r) => r.kind === "reversal" && r.reverses).map((r) => [r.reverses, r.id]));
    const fundRow = (r) => isFundRow(r) && !r.job && !r.source && r.kind !== "carry" && r.state === "applied" &&
        oldEnough(rowDay(r), r.at, t.rowDays) && !(claimsById.get(r.id) && claimOpen(claimsById.get(r.id))) && !named.has(r.id);
    const fund = new Set(live.rows.filter(fundRow).map((r) => r.id));
    for (let changed = true; changed;) {
        changed = false;
        for (const id of [...fund]) {
            const row = rowsById.get(id);
            const partners = [row.reversedBy, row.reverses, reversalOf.get(id)].filter((p) => typeof p === "string" && rowsById.has(p));
            if (partners.some((p) => !fund.has(p))) {
                fund.delete(id);
                changed = true;
            }
        }
    }
    const groups = [];
    const grouped = new Set();
    for (const row of [...fund].map((id) => rowsById.get(id)).sort(compareRows)) {
        if (grouped.has(row.id)) continue;
        const group = [row.id, ...[row.reversedBy, row.reverses, reversalOf.get(row.id)].filter((p) => typeof p === "string" && fund.has(p) && !grouped.has(p))];
        for (const id of group) grouped.add(id);
        groups.push([...new Set(group)]);
    }
    const fundIds = new Set(take(groups, (group) => group.length).flat());

    const rows = [
        ...live.rows.filter((r) => archivedOrders.has(r.order) || archivedJobs.has(r.job)),
        ...live.rows.filter((r) => fundIds.has(r.id) && !archivedOrders.has(r.order) && !archivedJobs.has(r.job)),
    ];
    const rowIds = new Set(rows.map((r) => r.id));

    // Day records: an archived order's or job's, and any other past the row age that names nothing still live; never a PC's
    // latest, nor an extension run's.
    const latest = new Map();
    for (const d of live.days) {
        if (!isDayRecord(d)) continue;
        const to = Number.isInteger(d.toDay) ? d.toDay : d.day;
        const best = latest.get(d.actor);
        if (!best || to > best.to) latest.set(d.actor, { id: d.id, to });
    }
    const latestIds = new Set([...latest.values()].map((l) => l.id));
    const dayMoves = (d) => !latestIds.has(d.id) && !d.ext && !d.extRows && !staysOrder(d.order) && !staysJob(d.job);
    const withOwner = (d) => archivedOrders.has(d.order) || archivedJobs.has(d.job);
    const days = [
        ...live.days.filter((d) => dayMoves(d) && withOwner(d)),
        ...take(live.days.filter((d) => dayMoves(d) && !withOwner(d) && oldEnough(Number.isInteger(d.toDay) ? d.toDay : d.day, d.at, t.rowDays)), () => 1),
    ];
    const dayIds = new Set(days.map((d) => d.id));

    // Claims: an archived order's or job's, and any other resolved one past the row age whose row and links do not stay.
    const claimMoves = (c) => !claimOpen(c) && !staysOrder(c.order) && !staysJob(c.job) && !(rowsById.has(c.id) && !rowIds.has(c.id));
    const claimOwned = (c) => archivedOrders.has(c.order) || archivedJobs.has(c.job);
    const claimAge = (c) => oldEnough(dayOfAt(c.resolved?.at ?? c.at), c.resolved?.at ?? c.at, t.rowDays);
    const claims = [
        ...live.claims.filter((c) => claimMoves(c) && claimOwned(c)),
        ...take(live.claims.filter((c) => claimMoves(c) && !claimOwned(c) && claimAge(c)), () => 1),
    ];

    // Stubs: records a late key-path write re-created after they left (5.3.3), deleted with the run.
    const stubs = ARCHIVED.flatMap((c) => Object.entries(flags?.[c] ?? {})
        .filter(([, record]) => !liveRecords({ x: record }).length).map(([id]) => `${c}.${id}`));

    const empty = !keptOrders.length && !keptJobs.length && !rows.length && !days.length && !claims.length;
    // The carry rows: every carry row already there folded into one per actor with what this run archives.
    const folded = live.rows.filter((r) => r.kind === "carry");
    const carries = empty ? [] : carryRows([...folded, ...rows], { runs, today, stamp });
    const foldedIds = folded.map((r) => r.id).filter((id) => !carries.some((c) => c.id === id));

    // Each record into the page of its world year: an order's and a job's with them.
    const years = new Map();
    const put = (year, collection, record) => {
        if (!years.has(year)) years.set(year, Object.fromEntries(ARCHIVED.map((c) => [c, {}])));
        years.get(year)[collection][record.id] = record;
    };
    const yearOfOrder = (id) => yearOf(orderDay.get(id), daysPerYear);
    const yearOfJob = (id) => yearOf(jobDay.get(id), daysPerYear);
    const yearFor = (record, day) => (archivedOrders.has(record.order) ? yearOfOrder(record.order)
        : archivedJobs.has(record.job) ? yearOfJob(record.job) : yearOf(day ?? today, daysPerYear));
    for (const order of keptOrders) put(yearOfOrder(order.id), "orders", order);
    for (const job of keptJobs) put(yearOfJob(job.id), "jobs", job);
    for (const row of rows) put(yearFor(row, rowDay(row)), "rows", row);
    for (const row of folded.filter((r) => foldedIds.includes(r.id))) put(yearOf(today, daysPerYear), "rows", row);
    for (const d of days) put(yearFor(d, Number.isInteger(d.toDay) ? d.toDay : d.day), "days", d);
    for (const c of claims) put(yearFor(c, dayOfAt(c.resolved?.at ?? c.at)), "claims", c);

    const slot = archiveSlotId(runs);
    // The fund's rows a Funds-tab reversal could still take back (`canReverse`): the run takes each one's reversal row id, which
    // the reversal's own lock request takes too, so of the two only the first lands. Otherwise a reversal landing after the run
    // would leave the row it reverses counted in a carry row's `share`, and the member's balance with it.
    const keys = {};
    for (const row of rows) {
        if (!fundIds.has(row.id) || !REVERSIBLE_KINDS.includes(row.kind) || row.reversedBy || reversalOf.has(row.id)) continue;
        const key = `reversal:${row.id}`;   // `reversalRow`'s idempotency key, whose hash is the reversal's row id
        keys[hashId(key)] = key;
    }
    const locks = [slot, ...keptOrders.map((o) => logLockId(o.id, (lastEntry(o)?.seq ?? 0) + 1)),
        ...keptJobs.map((j) => jobLogLockId(j.id, (jobLog(j).at(-1)?.seq ?? 0) + 1)), ...Object.keys(keys)];
    const del = [
        ...keptOrders.map((o) => `orders.${o.id}`), ...keptJobs.map((j) => `jobs.${j.id}`), ...rows.map((r) => `rows.${r.id}`),
        ...foldedIds.map((id) => `rows.${id}`), ...days.map((d) => `days.${d.id}`), ...claims.map((c) => `claims.${c.id}`), ...stubs,
    ];
    const counts = { orders: keptOrders.length, jobs: keptJobs.length, rows: rows.length, days: days.length, claims: claims.length };
    const change = {
        set: Object.fromEntries(carries.map((c) => [`rows.${c.id}`, c])),
        replace: empty ? {} : { "meta.archive": { runs: runs + 1, through: today, counts, ...stamp } },
        del: empty ? [] : del,
    };
    const lockPages = [...new Set([
        ...rows.flatMap((r) => [r.id, hashId(idemKey("apply", r.id)), hashId(idemKey("recreate", r.id))]),
        ...claims.map((c) => c.id),
    ])];
    return {
        empty, runs, slot, locks, keys, orders: keptOrders.map((o) => o.id), jobs: keptJobs.map((j) => j.id), rows: [...rowIds],
        days: [...dayIds], claims: claims.map((c) => c.id), stubs, carries, folded: foldedIds, years, change, lockPages, counts,
        more: keptOrders.length < orders.length || keptJobs.length < jobs.length || budget <= 0,
    };
}

/**
 * The carry rows (4.6 `carry`) that stand for `rows`: one per actor (UUID, or null for the party fund), with the sums of their
 * signed `box`, `purse` and `alloc`, the member's net deposits among them (`share`, the fund rows `memberBalances` counts, a
 * reversed pair counting nothing), the fund rows that took money out (`fundDebits`, carried rows' own counts included) and how
 * many rows they stand for (`count`). Keyed `carry:<actor or fund>:<run>`. An actor whose sums are all nothing gets none.
 */
export function carryRows(rows, { runs, today, stamp }) {
    const sums = new Map();
    const of = (actor) => {
        if (!sums.has(actor)) sums.set(actor, { box: 0, purse: 0, alloc: 0, share: 0, fundDebits: 0, count: 0 });
        return sums.get(actor);
    };
    for (const row of rows) {
        const s = of(row.actor ?? null);
        s.box += row.box ?? 0;
        s.purse += row.purse ?? 0;
        s.alloc += row.alloc ?? 0;
        if (row.kind === "carry") {
            s.share += row.share ?? 0;
            s.fundDebits += row.fundDebits ?? 0;
            s.count += row.count ?? 0;
        } else {
            s.count += 1;
            if (isFundRow(row) && (row.alloc ?? 0) < 0) s.fundDebits += 1;
        }
    }
    for (const row of liveRows(rows.filter((r) => r.kind !== "carry"))) {
        if (isFundRow(row) && row.actor && FUND_SHARE_KINDS.includes(row.kind)) of(row.actor).share += row.alloc ?? 0;
    }
    const out = [];
    for (const [actor, s] of [...sums].sort(([a], [b]) => compareIds(a ?? "", b ?? ""))) {
        if (!s.box && !s.purse && !s.alloc && !s.share && !s.fundDebits) continue;
        // `cp`, the row's unsigned amount, is the coins it stands for in the strongbox: what the Funds tab shows beside it.
        const row = makeRow({ kind: "carry", idem: idemKey("carry", actor ?? "fund", runs), cp: Math.abs(s.box), signed: { box: s.box, purse: s.purse, alloc: s.alloc },
            actor, day: today }, stamp);
        out.push({ ...row, state: "applied", share: s.share, fundDebits: s.fundDebits, count: s.count });
    }
    return out;
}

/**
 * The Crafting Log's page of one world year, as created (`records` a year's collections), or the key-path update that adds
 * them to the page there already.
 */
export function archivePageData(year, records, { name, stamp }) {
    return {
        _id: archivePageId(year), name, type: "text",
        flags: { "pf2e-artisans-workshop": { role: "archive-page", v: ARCHIVE_PAGE_VERSION, year, ...records, by: stamp.by, at: stamp.at } },
    };
}

/** The update that adds a year's `records` to its page (`flags.<module>.<collection>.<id>`), one key per record. */
export function archivePageUpdate(year, records, { stamp }) {
    const update = { _id: archivePageId(year) };
    for (const collection of ARCHIVED) {
        for (const [id, record] of Object.entries(records[collection] ?? {})) update[`flags.pf2e-artisans-workshop.${collection}.${id}`] = record;
    }
    update["flags.pf2e-artisans-workshop.by"] = stamp.by;
    update["flags.pf2e-artisans-workshop.at"] = stamp.at;
    return update;
}

/**
 * The archived records of a collection across the Crafting Log's pages (5.3.3: the Funds tab's history), live records only,
 * newest first.
 * @param {{flags?: object}[]} pages  the pages' module flags
 */
export function archivedRecords(pages, collection) {
    const out = new Map();
    for (const page of pages) for (const record of liveRecords(page?.[collection])) out.set(record.id, record);
    return [...out.values()].sort((a, b) => compareRows(b, a));
}
