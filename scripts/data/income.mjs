/**
 * Income Earned (DESIGN.md 6.1): what a day of Earn Income pays, and what a day of Craft takes off the
 * remaining cost. Numbers only (P9).
 */

/** Row 21: the table's extra row for a critical success at level 20. */
export const INCOME_CRIT_ROW_20 = 21;

/**
 * Player Core p.228, Table 4-2, in cp. `INCOME_EARNED[row][column]`: the row is the task level 0..20 (row
 * 21 is "20 (critical success)"), and the column is [failure, trained, expert, master, legendary], so a
 * proficiency rank 1..4 indexes its own column. Row 21 has no failure entry in the book; it holds 0.
 * Matches pf2e `src/scripts/macros/earn-income.ts` `EarnIncomeDialog.REWARDS_BY_LEVEL`, which is not
 * reachable from `game.pf2e`, so the module ships its own copy (DESIGN.md 6.15 #24).
 */
export const INCOME_EARNED = Object.freeze([
    [1, 5, 5, 5, 5],                // 0
    [2, 20, 20, 20, 20],            // 1
    [4, 30, 30, 30, 30],            // 2
    [8, 50, 50, 50, 50],            // 3
    [10, 70, 80, 80, 80],           // 4
    [20, 90, 100, 100, 100],        // 5
    [30, 150, 200, 200, 200],       // 6
    [40, 200, 250, 250, 250],       // 7
    [50, 250, 300, 300, 300],       // 8
    [60, 300, 400, 400, 400],       // 9
    [70, 400, 500, 600, 600],       // 10
    [80, 500, 600, 800, 800],       // 11
    [90, 600, 800, 1000, 1000],     // 12
    [100, 700, 1000, 1500, 1500],   // 13
    [150, 800, 1500, 2000, 2000],   // 14
    [200, 1000, 2000, 2800, 2800],  // 15
    [250, 1300, 2500, 3600, 4000],  // 16
    [300, 1500, 3000, 4500, 5500],  // 17
    [400, 2000, 4500, 7000, 9000],  // 18
    [600, 3000, 6000, 10000, 13000], // 19
    [800, 4000, 7500, 15000, 20000], // 20
    [0, 5000, 9000, 17500, 30000],  // 20 (critical success)
].map((row) => Object.freeze(row)));
