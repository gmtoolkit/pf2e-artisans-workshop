/**
 * Coin denominations (DESIGN.md 5.4). Numbers only (P9).
 */

/** Value of one coin in cp. Player Core p.10 (Currency); pf2e `src/module/item/physical/values.ts`. */
export const COIN_RATE = Object.freeze({ pp: 1000, gp: 100, sp: 10, cp: 1 });

/** The four coin denominations, largest first. */
export const DENOMINATIONS = Object.freeze(["pp", "gp", "sp", "cp"]);

/**
 * The denominations new coins are minted in, largest first. pf2e's `Coins.normalized()` expresses a value
 * in gp, sp and cp and never in pp, so the module does the same for wages, change and strongbox lots.
 */
export const MINT_DENOMINATIONS = Object.freeze(["gp", "sp", "cp"]);
