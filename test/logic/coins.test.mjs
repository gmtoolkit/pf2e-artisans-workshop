/**
 * The coin planner (DESIGN.md 5.4, 15.1): change-making as pf2e does it, the "remove 1 cp from 1 gp" case,
 * purse plans and create-only strongbox plans, and debits across contributors.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    holdingsOf, mintCoins, planPayout, planPledge, planPurseCredit, planPurseDebit, planRemoval, planSpend,
    planStrongboxCredit, planStrongboxDebit, valueCp,
} from "../../scripts/logic/coins.mjs";

const coins = (fields = {}) => ({ pp: 0, gp: 0, sp: 0, cp: 0, ...fields });

/**
 * pf2e 8.6.1 `ActorInventory#removeCurrency` phases 1-4 (src/module/actor/inventory/index.ts), transcribed
 * line for line for the four coins, as the oracle the planner must agree with.
 */
function pf2eRemoval(holdings, request) {
    const rates = { cp: 1, sp: 10, gp: 100, pp: 1000 };
    const actorCoins = { ...holdings };
    const totalValueToRemove = valueCp(request);
    if (totalValueToRemove > valueCp(actorCoins)) return null;
    const removeResult = coins();
    const addResult = coins();
    for (const type of ["pp", "gp", "sp", "cp"]) {
        const toRemove = Math.min(request[type] ?? 0, actorCoins[type]);
        removeResult[type] = toRemove;
        actorCoins[type] -= toRemove;
    }
    let valueToRemove = totalValueToRemove - valueCp(removeResult);
    if (valueToRemove) {
        for (const type of ["pp", "gp", "sp", "cp"]) {
            const rate = rates[type];
            const toRemove = Math.min(actorCoins[type], Math.floor(valueToRemove / rate));
            if (!toRemove) continue;
            removeResult[type] += toRemove;
            actorCoins[type] -= toRemove;
            valueToRemove -= toRemove * rate;
        }
        for (const type of ["cp", "sp", "gp"]) {
            const rate = rates[type];
            if ((valueToRemove / rate) % 10 > actorCoins[type]) {
                const toRemove = (valueToRemove / rate) % 10;
                valueToRemove += (10 - toRemove) * rate;
                addResult[type] += 10;
                removeResult[type] += toRemove;
            } else {
                const toRemove = (valueToRemove / rate) % 10;
                valueToRemove -= toRemove * rate;
                const newValue = actorCoins[type] - toRemove;
                const extraCoins = Math.min(valueToRemove / rate, Math.trunc(newValue / 10)) * 10;
                removeResult[type] += toRemove + extraCoins;
                valueToRemove -= extraCoins * rate;
            }
        }
        removeResult.pp += valueToRemove / 1000;
        for (const type of ["pp", "gp", "sp", "cp"]) {
            const min = Math.min(addResult[type], removeResult[type]);
            addResult[type] -= min;
            removeResult[type] -= min;
        }
    }
    return { remove: removeResult, add: addResult };
}

/** A small deterministic generator (mulberry32), so the random cases are the same on every run. */
function random(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test("mintCoins writes a value in gp, sp and cp, never pp", () => {
    assert.deepEqual(mintCoins(1234), coins({ gp: 12, sp: 3, cp: 4 }));
    assert.deepEqual(mintCoins(350000), coins({ gp: 3500 }));
    assert.deepEqual(mintCoins(0), coins());
    assert.equal(valueCp(coins({ pp: 1, gp: 2, sp: 3, cp: 4 })), 1234);
    assert.throws(() => mintCoins(-1), RangeError);
    assert.throws(() => mintCoins(1.5), RangeError);
});

test("removing 1 cp from 1 gp breaks the gold piece into 9 sp and 9 cp", () => {
    assert.deepEqual(planRemoval(coins({ gp: 1 }), 1), { remove: coins({ gp: 1 }), add: coins({ sp: 9, cp: 9 }) });
});

test("exact coins first, then by value without breaking, then break the smallest coin", () => {
    // 32 gp 5 sp from 40 gp: 32 gp exactly, then one more gold piece broken for 5 sp change.
    assert.deepEqual(planRemoval(coins({ gp: 40 }), 3250), { remove: coins({ gp: 33 }), add: coins({ sp: 5 }) });
    // 20 gp from 3 pp 5 gp: the 5 gp, a platinum piece by value, then a second one broken for the last 5 gp;
    // its change is the 5 gp taken first, so the net is two platinum pieces.
    assert.deepEqual(planRemoval(coins({ pp: 3, gp: 5 }), 2000), { remove: coins({ pp: 2 }), add: coins() });
    assert.deepEqual(planRemoval(coins({ pp: 3, gp: 5 }), 1500), { remove: coins({ pp: 1, gp: 5 }), add: coins() });
    assert.deepEqual(planRemoval(coins({ pp: 2 }), 7), { remove: coins({ pp: 1 }), add: coins({ gp: 9, sp: 9, cp: 3 }) });
    // A denomination both removed and added is netted out.
    assert.deepEqual(planRemoval(coins({ sp: 3, gp: 1 }), 35), { remove: coins({ gp: 1 }), add: coins({ sp: 6, cp: 5 }) });
    assert.deepEqual(planRemoval(coins({ gp: 1 }), 0), { remove: coins(), add: coins() });
});

test("not enough coins is null, whatever the denominations", () => {
    assert.equal(planRemoval(coins({ sp: 9, cp: 9 }), 100), null);
    assert.equal(planPurseDebit([], 1), null);
    assert.equal(planStrongboxDebit([{ id: "a", denomination: "cp", quantity: 3 }], 4), null);
});

test("the planner agrees with pf2e's removeCurrency on 5,000 random purses", () => {
    const next = random(20261025);
    const int = (max) => Math.floor(next() * (max + 1));
    for (let i = 0; i < 5000; i++) {
        const holdings = coins({ pp: int(3), gp: int(25), sp: int(25), cp: int(25) });
        const amount = int(valueCp(holdings) + 50);
        const expected = pf2eRemoval(holdings, mintCoins(amount));
        assert.deepEqual(planRemoval(holdings, amount), expected, `${JSON.stringify(holdings)} - ${amount}`);
        if (!expected) continue;
        for (const d of ["pp", "gp", "sp", "cp"]) assert.ok(expected.remove[d] <= holdings[d]);
        assert.equal(valueCp(expected.remove) - valueCp(expected.add), amount);
    }
});

/** Apply a plan to stacks, for checking what is left. */
function apply(stacks, plan) {
    const byId = new Map(stacks.map((s) => [s.id, { ...s }]));
    for (const { id, quantity } of plan.updates) byId.get(id).quantity = quantity;
    for (const id of plan.deletes) byId.delete(id);
    let n = 0;
    for (const create of plan.creates) byId.set(`new${n++}`, { id: `new${n}`, ...create });
    return [...byId.values()];
}

test("purse debit: quantities updated in item order, change added to the first stack of that coin", () => {
    // `inContainer` is not part of a stack: the planner, like pf2e, ignores it, and these stacks are in a
    // container to show that coins still go onto them.
    const purse = [
        { id: "g1", denomination: "gp", quantity: 3, inContainer: true },
        { id: "g2", denomination: "gp", quantity: 5 },
        { id: "s1", denomination: "sp", quantity: 2, inContainer: true },
    ];
    // 3 gp 5 sp: 3 gp and the 2 sp exactly, then a fourth gold piece broken for the last 3 sp, leaving 7 sp
    // of change; netted against the 2 sp, that is 4 gp out and 5 sp in. The gold comes from g1 first, and
    // the silver goes onto s1, the first silver stack, as pf2e's addCurrency puts it there.
    const plan = planPurseDebit(purse, 350);
    assert.deepEqual(plan, {
        updates: [{ id: "s1", quantity: 7 }, { id: "g2", quantity: 4 }],
        deletes: ["g1"],
        creates: [],
    });
    assert.equal(valueCp(holdingsOf(apply(purse, plan))), valueCp(holdingsOf(purse)) - 350);
    // Change in a coin the purse has no stack of becomes a new stack.
    assert.deepEqual(planPurseDebit([{ id: "g", denomination: "gp", quantity: 1 }], 1), {
        updates: [], deletes: ["g"], creates: [{ denomination: "sp", quantity: 9 }, { denomination: "cp", quantity: 9 }],
    });
});

test("purse credit mints gp, sp and cp onto existing stacks or new ones", () => {
    const purse = [{ id: "g", denomination: "gp", quantity: 2 }, { id: "c", denomination: "cp", quantity: 1, inContainer: true }];
    assert.deepEqual(planPurseCredit(purse, 1234), {
        updates: [{ id: "g", quantity: 14 }, { id: "c", quantity: 5 }],
        deletes: [],
        creates: [{ denomination: "sp", quantity: 3 }],
    });
    // pf2e's addCurrency takes the first stack of the coin in item order, a container's included.
    const bagFirst = [{ id: "bag", denomination: "gp", quantity: 5, inContainer: true }, { id: "loose", denomination: "gp", quantity: 3 }];
    assert.deepEqual(planPurseCredit(bagFirst, 100), { updates: [{ id: "bag", quantity: 6 }], deletes: [], creates: [] });
    assert.deepEqual(planPurseCredit(purse, 0), { updates: [], deletes: [], creates: [] });
});

test("strongbox debit never updates a stack: whole stacks go, smallest first, and the rest comes back new", () => {
    const box = [
        { id: "b", denomination: "gp", quantity: 3 },
        { id: "a", denomination: "gp", quantity: 5 },
        { id: "z", denomination: "gp", quantity: 3 },
        { id: "s", denomination: "sp", quantity: 2 },
    ];
    const plan = planStrongboxDebit(box, 620);           // 6 gp 2 sp
    assert.deepEqual(plan, { updates: [], deletes: ["b", "z", "s"], creates: [] });
    const change = planStrongboxDebit(box, 450);         // 4 gp 5 sp: break a gold piece too
    assert.deepEqual(change.updates, []);
    assert.equal(valueCp(holdingsOf(apply(box, change))), valueCp(holdingsOf(box)) - 450);
    assert.deepEqual(planStrongboxDebit([{ id: "g", denomination: "gp", quantity: 1 }], 1), {
        updates: [], deletes: ["g"], creates: [{ denomination: "sp", quantity: 9 }, { denomination: "cp", quantity: 9 }],
    });
});

test("strongbox plans conserve value on random boxes and never update a stack", () => {
    const next = random(7);
    const int = (max) => Math.floor(next() * (max + 1));
    const denominations = ["pp", "gp", "sp", "cp"];
    for (let i = 0; i < 1000; i++) {
        const box = Array.from({ length: int(8) }, (_, n) => ({ id: `s${n}`, denomination: denominations[int(3)], quantity: 1 + int(12) }));
        const amount = int(valueCp(holdingsOf(box)));
        const plan = planStrongboxDebit(box, amount);
        assert.deepEqual(plan.updates, []);
        assert.equal(valueCp(holdingsOf(apply(box, plan))), valueCp(holdingsOf(box)) - amount);
    }
});

test("pledges move coins from a purse into new strongbox lots; payouts the other way", () => {
    const purse = [{ id: "g", denomination: "gp", quantity: 40 }];
    assert.deepEqual(planPledge(purse, 3250), {
        purse: { updates: [{ id: "g", quantity: 7 }], deletes: [], creates: [{ denomination: "sp", quantity: 5 }] },
        strongbox: { updates: [], deletes: [], creates: [{ denomination: "gp", quantity: 32 }, { denomination: "sp", quantity: 5 }] },
    });
    assert.equal(planPledge(purse, 4001), null);
    assert.deepEqual(planStrongboxCredit(0).creates, []);
    const payout = planPayout([{ id: "lot", denomination: "gp", quantity: 32 }], [], 1500);
    assert.deepEqual(payout, {
        strongbox: { updates: [], deletes: ["lot"], creates: [{ denomination: "gp", quantity: 17 }] },
        purse: { updates: [], deletes: [], creates: [{ denomination: "gp", quantity: 15 }] },
    });
    assert.equal(planPayout([], [], 1), null);
});

test("spending debits the strongbox once and splits the amount over the contributors", () => {
    const box = [{ id: "a", denomination: "gp", quantity: 20 }, { id: "b", denomination: "gp", quantity: 12 }, { id: "c", denomination: "sp", quantity: 5 }];
    const allocations = [{ actor: "A", cp: 2000 }, { actor: "B", cp: 1250 }];
    const spend = planSpend(box, allocations, 3250);
    assert.deepEqual(spend.shares, [{ actor: "A", cp: 2000 }, { actor: "B", cp: 1250 }]);
    assert.deepEqual(spend.strongbox.updates, []);
    const ruin = planSpend(box, allocations, 325);       // a critical failure's 10%
    assert.deepEqual(ruin.shares, [{ actor: "A", cp: 200 }, { actor: "B", cp: 125 }]);
    assert.equal(planSpend([], allocations, 1), null);
});
