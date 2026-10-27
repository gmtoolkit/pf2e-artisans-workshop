/**
 * Paying for a purchase from a chosen source (DESIGN.md 4.6, As built in M5 on M4.1): a formula bought, a casting
 * bought at the spellcasting-service price, a spell's cost when a casting is marked done, a formula copied from an ally.
 * The payer picks the source as "Fund this order" does: a character's purse, or the party fund's unallocated money.
 *
 * From the party fund the coins leave the strongbox with the fund's allocation (`purchaseInputs`), behind the fund
 * slot's lock page (`fundSlotLockId`), so the same unallocated money cannot also be earmarked, taken out or spent on
 * something else at the same moment. For an order (a casting, a spell's cost), the fund's money is earmarked for the
 * order and spent by it in the same move, which also takes the order's return slot (`returnSlotLockId`): a cancel or a
 * give-back planned from the same copy of the order cannot land with it. Any member may pay from the party fund, as any
 * member may earmark it (the cooperative trust model of DECISIONS.md 2026-10-25); the row's author records who.
 */
import { planPurseDebit, planStrongboxDebit } from "../logic/coins.mjs";
import { fundSlotLockId, purchaseInputs, returnSlotLockId, unallocatedCp } from "../logic/funds.mjs";
import { purseLockIds } from "../logic/lock-first.mjs";
import { freeStacks, moveCoins } from "./money.mjs";
import { members } from "./roster.mjs";
import { read, records } from "./store.mjs";

const refuse = (reason, data = {}) => ({ ok: false, reason, data });
const actorOf = (uuid) => (typeof uuid === "string" ? fromUuidSync(uuid, { strict: false }) : null);

/** Whether this user may pay from the party fund: a GM, or a member with a character of their own (`fundFromParty`). */
export const mayUseFund = () => game.user.isGM || members().some((actor) => actor.isOwner);

/** What the party fund holds unallocated now, from this client's copy of the ledger. */
export const fundAvailableCp = () => Math.max(0, unallocatedCp(records("rows")));

/**
 * Pay `cp` for a purchase keyed `idem` from `source`: `purse` (`payer`'s, a character this user owns) or `fund` (the
 * party fund's unallocated money). `order` links a purchase made for an order; `ledger` holds the keys written with the
 * rows (the formula claim, the casting record, the service the purchase pays for), so the purchase and what it pays
 * for land together or not at all. Refusals: `nothing`, `not-owner`, `purse-short`, `fund-short` (with `maxCp`),
 * `strongbox-short`, `no-order`, and those of the coin move ("taken"/"conflict": someone else's write on the same money
 * landed first; try again).
 *
 * @param {{source: "purse"|"fund", payer?: string|null, cp: number, idem: string, order?: string|null, ledger?: object}} p
 * @returns {Promise<{ok: boolean, outcome?: string, reason?: string, data?: object, rows?: object[]}>}
 */
export function payPurchase({ source, payer = null, cp, idem, order = null, ledger = {} }) {
    if (!(Number.isSafeInteger(cp) && cp > 0)) return Promise.resolve(refuse("nothing"));
    if (source === "purse") {
        const purse = actorOf(payer);
        if (!purse?.isOwner) return Promise.resolve(refuse("not-owner"));
        const inputs = purchaseInputs({ source, cp, idem, payer: purse.uuid, order });
        return moveCoins(() => {
            const stacks = freeStacks(purse);
            const plan = planPurseDebit(stacks, cp);
            if (!plan) return { refuse: "purse-short" };
            return { rows: inputs, debits: [{ target: purse.uuid, plan }], locks: purseLockIds(stacks, plan), ledger };
        }, {}, inputs.slice(0, 1));
    }
    if (source !== "fund") return Promise.resolve(refuse("other", { reason: "source" }));
    if (!mayUseFund()) return Promise.resolve(refuse("not-owner"));
    if (cp > fundAvailableCp()) return Promise.resolve(refuse("fund-short", { maxCp: fundAvailableCp() }));
    const inputs = purchaseInputs({ source, cp, idem, order });
    // A fund found short inside the mutex (another write took the money first) says what is left, as the check above does.
    const told = (result) => (result.reason === "fund-short" && !result.data ? { ...result, data: { maxCp: fundAvailableCp() } } : result);
    return moveCoins((strongbox) => {
        // Judged again inside the coin mutex, from the ledger as it is now: the fund slot names this state of the fund.
        const rows = records("rows");
        if (cp > unallocatedCp(rows)) return { refuse: "fund-short" };
        const box = planStrongboxDebit(freeStacks(strongbox), cp);
        if (!box) return { refuse: "strongbox-short" };
        const locks = [fundSlotLockId(rows)];
        if (order) {
            const stored = read(`orders.${order}`);
            if (!stored) return { refuse: "no-order" };
            locks.push(returnSlotLockId(stored, rows.filter((row) => row.order === order)));
        }
        return { rows: inputs, debits: [{ target: "strongbox", plan: box }], locks, ledger };
    }, {}, inputs.slice(0, 1)).then(told);
}
