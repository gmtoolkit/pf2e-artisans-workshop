/**
 * One day of income or of cost reduction from the Income Earned table (DESIGN.md 6.2.1). Craft, Communal
 * Crafting helpers and Earn Income all read the table through this function.
 */
import { INCOME_CRIT_ROW_20, INCOME_EARNED } from "../data/income.mjs";
import { DEGREE, RANK, clamp, requireInteger } from "./core.mjs";

const FAILURE_COLUMN = 0;

/**
 * cp for one day at `level` (a task level, or the crafter's own level for Craft) and proficiency `rank`
 * 0..4, by degree of success:
 * - critical success: the row for level + 1 (at level 20, the table's extra critical-success row);
 * - success: the row for the level;
 * - failure: the failure column of that row;
 * - critical failure, or untrained: nothing.
 * Levels outside 0..20 use the nearest end of the table.
 */
export function incomePerDay(level, rank, degree) {
    requireInteger(level, "level");
    requireInteger(rank, "rank");
    if (rank < RANK.trained) return 0;
    const row = clamp(level, 0, INCOME_CRIT_ROW_20 - 1);
    const column = clamp(rank, RANK.trained, RANK.legendary);
    if (degree === DEGREE.critSuccess) return INCOME_EARNED[row + 1][column];
    if (degree === DEGREE.success) return INCOME_EARNED[row][column];
    if (degree === DEGREE.fail) return INCOME_EARNED[row][FAILURE_COLUMN];
    return 0;
}
