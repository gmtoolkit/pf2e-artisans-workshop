/**
 * The coin planner (DESIGN.md 5.4): which coin items to update, delete and create to move an amount of
 * copper, so a whole movement fits in one `modifyBatch` (pf2e's `addCurrency` and `removeCurrency` each
 * write on their own and cannot). It makes change the way pf2e's `ActorInventory#removeCurrency` does.
 *
 * Coin stacks are `{id, denomination: "pp"|"gp"|"sp"|"cp", quantity}`, in the actor's item order, wherever
 * they are: like pf2e, the planner does not care whether a stack is inside a container. A plan is
 * `{updates: [{id, quantity}], deletes: [id], creates: [{denomination, quantity}]}`; M2 turns creates into the
 * pf2e coin items (and strongbox lots into items flagged with their row).
 *
 * - On a purse (an actor only its owner's clients write) a plan updates quantities, as pf2e does.
 * - The strongbox is create-only, because every member writes it: a plan never updates a strongbox coin
 *   stack. Spending deletes whole stacks and creates any change as new stacks; receiving creates new stacks.
 */
import { COIN_RATE, DENOMINATIONS, MINT_DENOMINATIONS } from "../data/coins.mjs";
import { requireCp } from "./core.mjs";
import { splitProRata } from "./split.mjs";

const SMALLEST_FIRST = [...DENOMINATIONS].reverse();

const noCoins = () => ({ pp: 0, gp: 0, sp: 0, cp: 0 });
const emptyPlan = () => ({ updates: [], deletes: [], creates: [] });

/** The value of `{pp, gp, sp, cp}` in cp. */
export function valueCp(coins) {
    return DENOMINATIONS.reduce((sum, d) => sum + (coins[d] ?? 0) * COIN_RATE[d], 0);
}

/** An amount as coins in gp, sp and cp, as pf2e's `Coins.normalized()` writes it: 1,234 cp is 12 gp 3 sp 4 cp. */
export function mintCoins(amountCp) {
    let rest = requireCp(amountCp, "amountCp");
    const coins = noCoins();
    for (const d of MINT_DENOMINATIONS) {
        coins[d] = Math.floor(rest / COIN_RATE[d]);
        rest -= coins[d] * COIN_RATE[d];
    }
    return coins;
}

/** Coins held, by denomination, summed over every stack however the sheet groups them. */
export function holdingsOf(stacks) {
    const coins = noCoins();
    for (const stack of stacks) coins[stack.denomination] += stack.quantity;
    return coins;
}

/** `{pp, gp, sp, cp}` as create operations, largest first, without zeros. */
function createsOf(coins) {
    return DENOMINATIONS.filter((d) => coins[d] > 0).map((d) => ({ denomination: d, quantity: coins[d] }));
}

/**
 * The coins to remove, and to add back as change, to take `amountCp` from `holdings`; null when the
 * holdings are worth less. The same four steps as pf2e's `removeCurrency` (by value):
 * 1. remove the amount's own denominations (its gp, sp and cp) where held;
 * 2. remove what is still owed by value, largest coins first, without breaking any;
 * 3. if anything is still owed, break the smallest coin left and take the difference back as change;
 * 4. net out a denomination that is both removed and added.
 * After step 2 every coin left is worth more than what is still owed (a denomination step 2 did not empty
 * left less than one of its coins owed), so in step 3 one coin always covers it. pf2e's step 3 carries
 * digit by digit, which gives the same coins.
 *
 * @returns {{remove: object, add: object} | null}
 */
export function planRemoval(holdings, amountCp) {
    requireCp(amountCp, "amountCp");
    if (valueCp(holdings) < amountCp) return null;
    const left = { ...noCoins(), ...holdings };
    const remove = noCoins();
    const add = noCoins();
    let owed = amountCp;
    const take = (d, n) => {
        remove[d] += n;
        left[d] -= n;
        owed -= n * COIN_RATE[d];
    };

    const wanted = mintCoins(amountCp);
    for (const d of DENOMINATIONS) take(d, Math.min(wanted[d], left[d]));                       // 1
    for (const d of DENOMINATIONS) take(d, Math.min(left[d], Math.floor(owed / COIN_RATE[d]))); // 2
    if (owed > 0) {                                                                             // 3
        const broken = SMALLEST_FIRST.find((d) => left[d] > 0);
        const change = mintCoins(COIN_RATE[broken] - owed);
        take(broken, 1);
        for (const d of MINT_DENOMINATIONS) add[d] += change[d];
    }
    for (const d of DENOMINATIONS) {                                                            // 4
        const both = Math.min(remove[d], add[d]);
        remove[d] -= both;
        add[d] -= both;
    }
    return { remove, add };
}

/**
 * Add coins to a purse as pf2e's `addCurrency` does: onto its first stack of that coin in item order, even one
 * inside a container (pf2e names the list `topLevelCoins` but does not filter it), or a new stack.
 */
function addToPurse(stacks, coins, plan) {
    for (const d of DENOMINATIONS) {
        if (!coins[d]) continue;
        const stack = stacks.find((s) => s.denomination === d);
        if (stack) plan.updates.push({ id: stack.id, quantity: stack.quantity + coins[d] });
        else plan.creates.push({ denomination: d, quantity: coins[d] });
    }
}

/** Pay `amountCp` from a purse: quantity updates and deletes in item order, change added; null if short. */
export function planPurseDebit(stacks, amountCp) {
    const removal = planRemoval(holdingsOf(stacks), amountCp);
    if (!removal) return null;
    const plan = emptyPlan();
    addToPurse(stacks, removal.add, plan);
    for (const d of DENOMINATIONS) {
        let owed = removal.remove[d];
        for (const stack of stacks.filter((s) => s.denomination === d)) {
            if (owed === 0) break;
            if (stack.quantity > owed) {
                plan.updates.push({ id: stack.id, quantity: stack.quantity - owed });
                owed = 0;
            } else {
                plan.deletes.push(stack.id);
                owed -= stack.quantity;
            }
        }
    }
    return plan;
}

/** Mint `amountCp` into a purse (a wage, a refund) in gp, sp and cp. */
export function planPurseCredit(stacks, amountCp) {
    const plan = emptyPlan();
    addToPurse(stacks, mintCoins(amountCp), plan);
    return plan;
}

/** Stacks of one denomination, smallest first, then by id, so small lots are used up first. */
const bySize = (a, b) => a.quantity - b.quantity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Take `amountCp` out of the strongbox without updating any stack: work out the coins as for a purse, then
 * delete whole stacks of each denomination, smallest first, until enough are deleted; the excess of the
 * last stack and any change come back as new stacks. Null if the strongbox holds too little.
 */
export function planStrongboxDebit(stacks, amountCp) {
    const removal = planRemoval(holdingsOf(stacks), amountCp);
    if (!removal) return null;
    const plan = emptyPlan();
    const back = { ...removal.add };
    for (const d of DENOMINATIONS) {
        let owed = removal.remove[d];
        for (const stack of stacks.filter((s) => s.denomination === d).sort(bySize)) {
            if (owed <= 0) break;
            plan.deletes.push(stack.id);
            owed -= stack.quantity;
        }
        if (owed < 0) back[d] += -owed;
    }
    plan.creates = createsOf(back);
    return plan;
}

/** Put `amountCp` into the strongbox as new stacks, in gp, sp and cp (a pledge or deposit lot). */
export function planStrongboxCredit(amountCp) {
    return { ...emptyPlan(), creates: createsOf(mintCoins(amountCp)) };
}

/** A pledge or deposit (4.6): from a purse into the strongbox. Null if the purse is short. */
export function planPledge(purseStacks, amountCp) {
    const purse = planPurseDebit(purseStacks, amountCp);
    return purse && { purse, strongbox: planStrongboxCredit(amountCp) };
}

/** A withdrawal or refund (4.6): from the strongbox into a purse. Null if the strongbox is short. */
export function planPayout(strongboxStacks, purseStacks, amountCp) {
    const strongbox = planStrongboxDebit(strongboxStacks, amountCp);
    return strongbox && { strongbox, purse: planPurseCredit(purseStacks, amountCp) };
}

/**
 * Money an order or garden spends out of the strongbox (expend, ruin, remainder, plant), debited across its
 * contributors (4.6): the coin plan for the whole amount, and one share per contributor in proportion to
 * their remaining allocation (`allocationsByContributor`). Null if the strongbox is short.
 */
export function planSpend(strongboxStacks, allocations, amountCp) {
    const strongbox = planStrongboxDebit(strongboxStacks, amountCp);
    if (!strongbox) return null;
    const shares = splitProRata(amountCp, allocations.map((a) => ({ key: a.actor, cp: a.cp })));
    return { strongbox, shares: shares.map(({ key, cp }) => ({ actor: key, cp })) };
}
