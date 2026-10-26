/**
 * Defaults of the rules-gap and interpretation settings the rules engine reads (DESIGN.md 14.2, 14.4).
 *
 * The keys drop the `rules.` prefix of the world setting: `rules.legendaryItemLevel` is
 * `legendaryItemLevel` here, `rules.communal.helperCap` is `communal.helperCap`, and the variant switches
 * of 14.4 sit under `variants`. Settings registration (M2) reads its defaults from this object, so the
 * defaults live in one place. Pure functions take a `rules` argument that defaults to these.
 */

export const DEFAULT_RULES = Object.freeze({
    // Craft gates and DC (6.5, 6.2.1).
    legendaryItemLevel: 17,              // Player Core p.237; 16 is the setting's other value
    uncommonNeedsFormula: false,         // OQ-37
    easyDcForRepeat: false,              // GM Core p.53, optional
    // Interpretation settings (6.2.5); author decisions of 2026-10-25.
    setupInterruptionPersists: true,
    recomputeRateOnLevelUp: true,
    crafterSwapRestarts: true,
    // Formulas (6.4, 6.8).
    familyCoversLowerGrades: true,
    allyCopyCostCp: 0,
    formulaSurchargeUncommon: 0,         // percent; GM Core p.48 suggests 10-100
    formulaSurchargeRare: 0,             // percent; GM Core p.48 suggests 25-500
    inventorRarity: false,
    inventorSetupDays: 2,
    // Precious materials (6.6).
    preciousCoinForCommon: true,
    // Snares (OQ-14).
    snareDowntimeBatch: 4,
    magicalSnaresNeedMagicalCrafting: true,
    snareToolkitIsArtisans: true,
    // Tattoos (6.14): "secrets-of-magic" or "simple".
    tattooProcess: "secrets-of-magic",
    // Talismans (7.4): bombs are no hosts, since they are consumed (design choice).
    talismanHostsExcludeBombs: true,
    // Earn Income (6.10).
    earnIncomeOtherSkillDc: 5,
    downtimeRerolls: "warn",             // or "block"
    costOfLiving: false,
    // Communal Crafting (6.7); author decisions of 2026-10-25.
    communal: Object.freeze({
        helperDc: "item",                // helpers roll against the item's Craft DC
        helperCritUsesNextRow: true,     // a helper's critical success uses (level - 1) + 1
        helperFailUsesFailColumn: true,  // a helper's failure pays the failure column
        helperLeaveRetroactive: true,    // a helper who leaves forfeits everything they contributed
        helperCap: 0,                    // 0: no cap
        countHelpersWithoutFeat: false,  // GM Core p.46 Cooperation
    }),
    // Treasure Vault (Remastered) variants (14.4); only the ones the M1 rules read.
    variants: Object.freeze({
        complexCrafting: false,
    }),
});

/**
 * The defaults with `overrides` applied, one level deep for `communal` and `variants`, so a caller (or a
 * test) can change one setting without restating the rest.
 */
export function rulesWith(overrides = {}) {
    return {
        ...DEFAULT_RULES,
        ...overrides,
        communal: { ...DEFAULT_RULES.communal, ...overrides.communal },
        variants: { ...DEFAULT_RULES.variants, ...overrides.variants },
    };
}
