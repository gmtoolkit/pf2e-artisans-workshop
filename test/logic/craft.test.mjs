/** Craft pricing, setup, the frozen plan and the money each order step moves (DESIGN.md 6.2). */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    cancelOrder, committedFromRows, craftCost, critFailRuinCp, expendedFromRows, finishOrder, pauseOrder, planCraft,
    recordCheck, resumeOrder, retryOrder, settleCheck, setupPlan, startOrder, swapCrafter,
} from "../../scripts/logic/craft.mjs";
import { DEGREE } from "../../scripts/logic/core.mjs";
import { craftDC } from "../../scripts/logic/dc.mjs";
import { rulesWith } from "../../scripts/logic/defaults.mjs";

const { critFail, fail, success, critSuccess } = DEGREE;

test("craftCost scales the Price to the quantity and rounds the up-front half up", () => {
    assert.deepEqual(craftCost({ unitPriceCp: 6500, quantity: 1 }), { ok: true, priceCp: 6500, upfrontCp: 3250, listPriceCp: 6500, free: false });
    assert.equal(craftCost({ unitPriceCp: 300, quantity: 4 }).priceCp, 1200);
    assert.equal(craftCost({ unitPriceCp: 5, quantity: 1 }).upfrontCp, 3);           // half of 5 cp is 3, not 2
    assert.equal(craftCost({ unitPriceCp: 1, quantity: 1 }).upfrontCp, 1);
    // Ammunition priced per 10.
    assert.equal(craftCost({ unitPriceCp: 10, per: 10, quantity: 10 }).priceCp, 10);
    assert.equal(craftCost({ unitPriceCp: 10, per: 10, quantity: 5 }).priceCp, 5);
});

test("an item without a Price cannot be crafted; free crafting pays nothing", () => {
    assert.deepEqual(craftCost({ unitPriceCp: 0, quantity: 1 }), { ok: false, reason: "no-price" });
    assert.equal(craftCost({ unitPriceCp: 1, per: 10, quantity: 1 }).ok, false);   // 0.1 cp rounds to nothing
    assert.deepEqual(craftCost({ unitPriceCp: 6500, quantity: 1, free: true }), { ok: true, priceCp: 0, upfrontCp: 0, listPriceCp: 6500, free: true });
});

test("setup: 1 day with the formula, 2 without (Player Core p.237)", () => {
    for (const route of ["known", "family", "virtual"]) assert.deepEqual(setupPlan({ route }), { days: 1, hours: 0 });
    assert.deepEqual(setupPlan({ route: "none" }), { days: 2, hours: 0 });
    assert.deepEqual(setupPlan({ route: null }), { days: 2, hours: 0 });
});

test("setup: registry overrides and the fixed setups come first", () => {
    assert.deepEqual(setupPlan({ route: "none", override: 1 }), { days: 1, hours: 0 });
    assert.deepEqual(setupPlan({ route: null, craftType: "rune-transfer" }), { days: 1, hours: 0 });
    assert.deepEqual(setupPlan({ route: "known", craftType: "grow" }), { days: 4, hours: 0 });
    assert.deepEqual(setupPlan({ route: null, craftType: "deconstruct" }), { days: 1, hours: 0 });
    // A formula job passes its own setup (6.8).
    assert.deepEqual(setupPlan({ route: null, productType: "formula", override: 2 }), { days: 2, hours: 0 });
});

test("setup: Complex Crafting only with its variant, only for an item Craft, never for the fixed setups", () => {
    const complex = { itemLevel: 3, crafterLevel: 8, consumable: false, rank: 2, rushDays: 0 };
    const on = rulesWith({ variants: { complexCrafting: true } });
    assert.deepEqual(setupPlan({ route: "none", complex }), { days: 2, hours: 0 });
    assert.deepEqual(setupPlan({ route: "none", complex }, on), { days: 2, hours: 0, complex: { rush: 0, band: 2, quick: false } });
    assert.deepEqual(setupPlan({ route: "known", complex: { ...complex, itemLevel: 8 } }, on), { days: 3, hours: 0, complex: { rush: 0, band: 0, quick: false } });
    assert.deepEqual(setupPlan({ route: "none", craftType: "grow", complex }, on), { days: 4, hours: 0 });
    assert.deepEqual(setupPlan({ route: "none", craftType: "rune-transfer", complex }, on), { days: 1, hours: 0 });
    assert.deepEqual(setupPlan({ route: null, productType: "formula", complex }, on), { days: 2, hours: 0 });
});

test("planCraft refuses a quantity outside one batch and passes the plan through", () => {
    const setup = setupPlan({ route: "known" });
    const dc = craftDC({ level: 4 });
    const item = { priceCp: 6500 };
    assert.deepEqual(planCraft({ item, quantity: 2, batchMax: 1, setup, dc }), { ok: false, reason: "quantity", data: { max: 1 } });
    assert.deepEqual(planCraft({ item, quantity: 0, batchMax: 1, setup, dc }).reason, "quantity");
    assert.deepEqual(planCraft({ item: { priceCp: 0 }, quantity: 1, batchMax: 1, setup, dc }), { ok: false, reason: "no-price" });
    const plan = planCraft({ item, quantity: 1, batchMax: 1, setup, dc });
    assert.equal(plan.ok, true);
    assert.equal(plan.upfrontCp, 3250);
    assert.equal(plan.dc.final, 19);
    assert.deepEqual(plan.setup, { days: 1, hours: 0 });
    // Without a batch size every quantity would fit, so it is required.
    assert.throws(() => planCraft({ item: { priceCp: 300 }, quantity: 99, setup, dc }), TypeError);
});

/** An order in a given state, with the plan of the crafting example. */
const order = (fields = {}) => ({ id: "o1", status: "accepted", attempt: 0, priceCp: 6500, upfrontCp: 3250, ...fields });

test("start freezes the plan, opens attempt 1 and commits the up-front half", () => {
    const plan = planCraft({ item: { priceCp: 6500 }, quantity: 1, batchMax: 1, setup: setupPlan({ route: "known" }), dc: craftDC({ level: 4 }) });
    const started = startOrder(order({ priceCp: undefined, upfrontCp: undefined }), plan);
    assert.equal(started.ok, true);
    assert.deepEqual(started.patch, {
        priceCp: 6500, upfrontCp: 3250, dc: plan.dc, setup: { days: 1, hours: 0 }, attempt: 1, check: null, status: "setup",
    });
    assert.deepEqual(started.rows, [{ kind: "commit", cp: 3250 }]);
    assert.equal(startOrder(order({ status: "requested" }), plan).reason, "state");
});

test("start refuses a plan planCraft refused, and throws on a plan without whole-copper amounts", () => {
    const refused = { ok: false, reason: "no-price", setup: { days: 1, hours: 0 } };
    assert.deepEqual(startOrder(order(), refused), { ok: false, reason: "no-price", data: {} });
    assert.deepEqual(startOrder(order(), { ok: false, reason: "quantity", data: { max: 1 } }), { ok: false, reason: "quantity", data: { max: 1 } });
    const plan = { priceCp: 6500, upfrontCp: 3250, setup: { days: 1, hours: 0 }, dc: craftDC({ level: 4 }) };
    assert.throws(() => startOrder(order(), { ...plan, upfrontCp: undefined }), RangeError);
    assert.throws(() => startOrder(order(), { ...plan, priceCp: 1.5 }), RangeError);
});

test("start freezes a Complex Crafting setup into variant.complex", () => {
    const setup = setupPlan({ route: "none", complex: { itemLevel: 1, crafterLevel: 5, consumable: true, rank: 2, rushDays: 1 } },
        rulesWith({ variants: { complexCrafting: true } }));
    const plan = { priceCp: 1200, upfrontCp: 600, setup, dc: craftDC({ level: 1, rush: setup.complex.rush }) };
    const { patch } = startOrder(order({ variant: { special: true } }), plan);
    assert.deepEqual(patch.setup, { days: 0, hours: 4 });
    assert.deepEqual(patch.variant, { special: true, complex: { rush: 1, band: 2, quick: false } });
    assert.equal(patch.dc.adjust, 5);
});

test("free crafting moves no money", () => {
    const plan = { priceCp: 0, upfrontCp: 0, setup: { days: 1, hours: 0 }, dc: craftDC({ level: 1 }) };
    assert.deepEqual(startOrder(order(), plan).rows, []);
    const rolled = order({ status: "rolled", upfrontCp: 0, check: { degree: critFail } });
    assert.deepEqual(settleCheck(rolled, { committedCp: 0 }).rows, []);
});

test("recording a check moves no money, a reroll replaces it, and a check after settlement is a conflict", () => {
    const check = { degree: success, level: 5, rank: 2, attempt: 1, messageId: "m1" };
    const first = recordCheck(order({ status: "check", attempt: 1 }), check);
    assert.deepEqual(first, { ok: true, patch: { check: { ...check, settled: false }, status: "rolled" }, rows: [] });
    const reroll = recordCheck(order({ status: "rolled", attempt: 1, check: first.patch.check }), { ...check, degree: critSuccess, rerolled: true });
    assert.equal(reroll.patch.check.degree, critSuccess);
    assert.deepEqual(recordCheck(order({ status: "finishing", attempt: 1, check: { degree: success, settled: true } }), check), { ok: false, reason: "settled", data: {} });
    assert.equal(recordCheck(order({ status: "setup", attempt: 1 }), check).reason, "state");
});

test("a check without a valid degree, level, rank or attempt throws instead of settling as a critical failure", () => {
    const check = { degree: success, level: 5, rank: 2, attempt: 1 };
    const inCheck = order({ status: "check", attempt: 1 });
    // DEGREE_FROM_OUTCOME[undefined], from a message whose outcome did not map (6.12).
    assert.throws(() => recordCheck(inCheck, { ...check, degree: undefined }), RangeError);
    assert.throws(() => recordCheck(inCheck, { ...check, degree: 4 }), RangeError);
    assert.throws(() => recordCheck(inCheck, { ...check, level: undefined }), TypeError);
    assert.throws(() => recordCheck(inCheck, { ...check, rank: undefined }), TypeError);
    assert.throws(() => recordCheck(inCheck, { ...check, attempt: undefined }), TypeError);
    // A stored check with no degree (written before this guard) is not settled as a critical failure either.
    assert.throws(() => settleCheck(order({ status: "rolled", check: {} }), { committedCp: 3250 }), RangeError);
});

test("a roll made for an earlier attempt is refused, even after a retry or swap brought the order back to check", () => {
    const stale = recordCheck(order({ status: "check", attempt: 2 }), { degree: critSuccess, level: 5, rank: 2, attempt: 1, messageId: "from-attempt-1" });
    assert.deepEqual(stale, { ok: false, reason: "stale-attempt", data: { attempt: 1, current: 2 } });
    // Also after the newer attempt settled: it is not that attempt's reroll conflict.
    const settled = order({ status: "finishing", attempt: 2, check: { degree: success, settled: true } });
    assert.equal(recordCheck(settled, { degree: fail, level: 5, rank: 2, attempt: 1 }).reason, "stale-attempt");
});

test("settle: a success expends the committed half and moves to finishing", () => {
    for (const degree of [success, critSuccess]) {
        const settled = settleCheck(order({ status: "rolled", check: { degree, level: 5, rank: 2, settled: false } }), { committedCp: 3250 });
        assert.equal(settled.patch.status, "finishing");
        assert.equal(settled.patch.check.settled, true);
        assert.deepEqual(settled.rows, [{ kind: "expend", cp: 3250 }]);
    }
});

test("settle: a failure releases everything; a critical failure ruins 10%, rounded up", () => {
    const committed = { committedCp: 3250 };
    const failed = settleCheck(order({ status: "rolled", check: { degree: fail } }), committed);
    assert.equal(failed.patch.status, "failed");
    assert.deepEqual(failed.rows, [{ kind: "release", cp: 3250 }]);
    const crit = settleCheck(order({ status: "rolled", check: { degree: critFail } }), committed);
    assert.deepEqual(crit.rows, [{ kind: "ruin", cp: 325 }, { kind: "release", cp: 2925 }]);
    assert.deepEqual(crit.notices, []);
    const odd = settleCheck(order({ status: "rolled", upfrontCp: 3251, check: { degree: critFail } }), { committedCp: 3251, alchemical: true });
    assert.deepEqual(odd.rows, [{ kind: "ruin", cp: 326 }, { kind: "release", cp: 2925 }]);
    assert.deepEqual(odd.notices, ["alchemical-crit-fail"]);
    assert.equal(critFailRuinCp(1), 1);
    assert.equal(critFailRuinCp(0), 0);
    assert.equal(settleCheck(order({ status: "rolled", check: { degree: fail, settled: true } }), committed).reason, "settled");
    assert.equal(settleCheck(order({ status: "setup" }), committed).reason, "state");
});

test("settle and cancel need the committed amount: no default can charge twice or leave a commit open", () => {
    const rolled = order({ status: "rolled", check: { degree: success } });
    assert.throws(() => settleCheck(rolled), RangeError);
    assert.throws(() => settleCheck(rolled, { committedCp: 1.5 }), RangeError);
    assert.throws(() => cancelOrder(order({ status: "setup" }), { allocations: [] }), RangeError);
    assert.throws(() => cancelOrder(order({ status: "setup" }), { committedCp: 0 }), TypeError);
});

/**
 * Run an order through a list of steps the way the caller will (M2): each step's patch applied to the order,
 * its rows added to the order's rows, and every money input derived from those rows.
 */
function play(start, steps) {
    let o = { ...start };
    const rows = [];
    for (const step of steps) {
        const result = step(o, rows);
        assert.equal(result.ok, true, `${step} refused: ${result.reason}`);
        o = { ...o, ...result.patch };
        rows.push(...result.rows);
    }
    return { order: o, rows };
}
const plan = { priceCp: 6500, upfrontCp: 3250, setup: { days: 1, hours: 0 }, dc: craftDC({ level: 4 }) };
const start = (o) => startOrder(o, plan);
const toCheck = () => ({ ok: true, patch: { status: "check" }, rows: [] });      // setup days done (4.2.3)
const roll = (degree) => (o) => recordCheck(o, { degree, level: 5, rank: 2, attempt: o.attempt });
const settle = (o, rows) => settleCheck(o, { committedCp: committedFromRows(rows) });
const swap = (o) => swapCrafter(o, "B");
const retry = (o, rows) => retryOrder(o, { expendedCp: expendedFromRows(rows) });

test("start, success, swap, success: the materials are expended once", () => {
    const { order: done, rows } = play(order({ crafter: "A" }), [start, toCheck, roll(success), settle, swap, toCheck, roll(success), settle]);
    assert.equal(done.status, "finishing");
    assert.equal(done.attempt, 2);
    assert.deepEqual(rows, [{ kind: "commit", cp: 3250 }, { kind: "expend", cp: 3250 }]);
});

test("start, success, swap, failure, retry, success: the retry commits nothing, so nothing is expended twice", () => {
    const { order: done, rows } = play(order({ crafter: "A" }),
        [start, toCheck, roll(success), settle, swap, toCheck, roll(fail), settle, retry, toCheck, roll(success), settle]);
    assert.equal(done.status, "finishing");
    assert.equal(done.attempt, 3);
    assert.equal(expendedFromRows(rows), 3250);
    assert.deepEqual(rows, [{ kind: "commit", cp: 3250 }, { kind: "expend", cp: 3250 }]);
});

test("retry after a critical failure commits the full half again; the escrow makes up the ruined 10%", () => {
    const { order: done, rows } = play(order(), [start, toCheck, roll(critFail), settle, retry]);
    assert.deepEqual(done, { ...done, attempt: 2, check: null, status: "setup" });
    assert.deepEqual(rows.slice(1), [{ kind: "ruin", cp: 325 }, { kind: "release", cp: 2925 }, { kind: "commit", cp: 3250 }]);
    assert.equal(committedFromRows(rows), 3250);
    assert.throws(() => retryOrder(done), RangeError);                        // the expended amount is required
    assert.equal(retryOrder(order({ status: "finishing" }), { expendedCp: 0 }).reason, "state");
});

test("finish pays the remainder", () => {
    assert.deepEqual(finishOrder(order({ status: "finishing" }), 1950), { ok: true, patch: { status: "complete" }, rows: [{ kind: "remainder", cp: 1950 }] });
    assert.deepEqual(finishOrder(order({ status: "finishing" }), 0).rows, []);
    assert.equal(finishOrder(order({ status: "rolled" }), 0).reason, "state");
});

test("cancel releases what is committed and refunds every remaining allocation", () => {
    const cancelled = cancelOrder(order({ status: "setup" }), {
        committedCp: 3250,
        allocations: [{ actor: "a", cp: 2000 }, { actor: "b", cp: 1250 }, { actor: "c", cp: 0 }],
    });
    assert.deepEqual(cancelled.rows, [{ kind: "release", cp: 3250 }]);
    assert.deepEqual(cancelled.refunds, [{ actor: "a", cp: 2000 }, { actor: "b", cp: 1250 }]);
    assert.deepEqual(cancelOrder(order({ status: "requested" }), { committedCp: 0, allocations: [] }).refunds, []);
    assert.equal(cancelOrder(order({ status: "complete" }), { committedCp: 0, allocations: [] }).reason, "state");
});

test("a recorded but unsettled check cannot be cancelled or swapped away; settled first, a critical failure still ruins 10%", () => {
    const rolled = order({ status: "rolled", attempt: 1, crafter: "A", check: { degree: critFail, level: 5, rank: 2, attempt: 1, settled: false } });
    const allocations = [{ actor: "A", cp: 3250 }];
    assert.deepEqual(cancelOrder(rolled, { committedCp: 3250, allocations }), { ok: false, reason: "unsettled", data: {} });
    assert.deepEqual(swapCrafter(rolled, "B"), { ok: false, reason: "unsettled", data: {} });
    assert.equal(swapCrafter(rolled, "B", rulesWith({ crafterSwapRestarts: false })).reason, "unsettled");
    // The path that is left: settle, then cancel from failed.
    const rows = [{ kind: "commit", cp: 3250 }];
    const settled = settleCheck(rolled, { committedCp: committedFromRows(rows) });
    rows.push(...settled.rows);
    const cancelled = cancelOrder({ ...rolled, ...settled.patch }, { committedCp: committedFromRows(rows), allocations: [{ actor: "A", cp: 2925 }] });
    assert.deepEqual(rows, [{ kind: "commit", cp: 3250 }, { kind: "ruin", cp: 325 }, { kind: "release", cp: 2925 }]);
    assert.deepEqual(cancelled.rows, []);
    assert.deepEqual(cancelled.refunds, [{ actor: "A", cp: 2925 }]);
});

test("pause and resume: setup days persist by default, or restart as a new attempt by setting", () => {
    const paused = pauseOrder(order({ status: "setup", attempt: 1 }));
    assert.deepEqual(paused.patch, { status: "paused", resumeTo: "setup" });
    const inSetup = order({ status: "paused", resumeTo: "setup", attempt: 1 });
    assert.deepEqual(resumeOrder(inSetup).patch, { status: "setup", resumeTo: null });
    assert.deepEqual(resumeOrder(inSetup, rulesWith({ setupInterruptionPersists: false })).patch, { status: "setup", resumeTo: null, attempt: 2 });
    // Extra days always continue where they stopped.
    const finishing = order({ status: "paused", resumeTo: "finishing", attempt: 1 });
    assert.deepEqual(resumeOrder(finishing, rulesWith({ setupInterruptionPersists: false })).patch, { status: "finishing", resumeTo: null });
    assert.equal(pauseOrder(order({ status: "rolled" })).reason, "state");
    assert.equal(resumeOrder(order({ status: "setup" })).reason, "state");
});

test("a crafter swap restarts setup and the check by default; materials carry over", () => {
    const active = order({ status: "finishing", attempt: 1, crafter: "A", check: { degree: success, settled: true } });
    const swapped = swapCrafter(active, "B");
    assert.deepEqual(swapped.patch, { crafter: "B", attempt: 2, check: null, status: "setup", resumeTo: null });
    assert.deepEqual(swapped.rows, []);
    assert.deepEqual(swapCrafter(active, "B", rulesWith({ crafterSwapRestarts: false })).patch, { crafter: "B" });
    assert.equal(swapCrafter(order({ status: "accepted" }), "B").reason, "state");
});

test("committedFromRows: commits less expends, releases and ruins", () => {
    assert.equal(committedFromRows([{ kind: "commit", cp: 3250 }]), 3250);
    assert.equal(committedFromRows([{ kind: "commit", cp: 3250 }, { kind: "expend", cp: 3250 }]), 0);
    assert.equal(committedFromRows([{ kind: "commit", cp: 3250 }, { kind: "ruin", cp: 325 }, { kind: "release", cp: 2925 }, { kind: "commit", cp: 3250 }]), 3250);
    assert.equal(committedFromRows([{ kind: "pledge", cp: 9000 }]), 0);
});

test("an undone settlement brings the committed amount back, whichever mark the reversal leaves (4.6)", () => {
    const commit = { id: "c", kind: "commit", cp: 3250 };
    // The reversal row points at the original...
    assert.equal(committedFromRows([commit, { id: "e", kind: "expend", cp: 3250 }, { id: "r", kind: "reversal", cp: 3250, reverses: "e" }]), 3250);
    // ...and the original is marked; either is enough.
    assert.equal(committedFromRows([commit, { id: "e", kind: "expend", cp: 3250, reversedBy: "r" }, { id: "r", kind: "reversal", cp: 3250 }]), 3250);
    assert.equal(committedFromRows([commit, { id: "e", kind: "expend", cp: 3250, reversedBy: "r" }, { id: "r", kind: "reversal", cp: 3250, reverses: "e" }]), 3250);
    // A critical failure undone and settled again as a failure: the ruin is not charged.
    const ruinUndone = [commit, { id: "u", kind: "ruin", cp: 325, reversedBy: "r1" }, { id: "l", kind: "release", cp: 2925, reversedBy: "r2" },
        { id: "r1", kind: "reversal", cp: 325, reverses: "u" }, { id: "r2", kind: "reversal", cp: 2925, reverses: "l" }];
    assert.equal(committedFromRows(ruinUndone), 3250);
    assert.equal(expendedFromRows([commit, { id: "e", kind: "expend", cp: 3250, reversedBy: "r" }]), 0);
    assert.equal(expendedFromRows([commit, { id: "e", kind: "expend", cp: 3250 }, { id: "e2", kind: "expend", cp: 100 }]), 3350);
});
