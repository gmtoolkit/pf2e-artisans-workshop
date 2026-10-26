/**
 * Settings registered in M2 (DESIGN.md 14): the master switch and the ids of the shared documents, the
 * roster's member list, auto-claim, and the rules-gap and interpretation settings the rules engine reads,
 * whose defaults come from `DEFAULT_RULES` (`scripts/logic/defaults.mjs`) so they live in one place. Feature
 * toggles and the other settings of 14.1 and 14.3-14.5 arrive with the milestones that read them.
 *
 * World settings need `SETTINGS_MODIFY` (GM and assistant GM by default); `onChange` of a world setting runs
 * on every client, with the id of the user who changed it.
 */
import { MODULE_ID } from "../constants.mjs";
import { DEFAULT_RULES, rulesWith } from "../logic/defaults.mjs";

/**
 * The rule settings: the setting key, the path in `DEFAULT_RULES`, the i18n keys, and choices where the value
 * is one of a few. `config: false` hides a setting that has a single value so far.
 */
export const RULE_SETTINGS = Object.freeze([
    { key: "rules.legendaryItemLevel", rule: "legendaryItemLevel", name: "pf2e-artisans-workshop.Settings.LegendaryItemLevel.Name", hint: "pf2e-artisans-workshop.Settings.LegendaryItemLevel.Hint",
        choices: { 17: "pf2e-artisans-workshop.Settings.LegendaryItemLevel.Choice17", 16: "pf2e-artisans-workshop.Settings.LegendaryItemLevel.Choice16" } },
    { key: "rules.uncommonNeedsFormula", rule: "uncommonNeedsFormula", name: "pf2e-artisans-workshop.Settings.UncommonNeedsFormula.Name", hint: "pf2e-artisans-workshop.Settings.UncommonNeedsFormula.Hint" },
    { key: "rules.easyDcForRepeat", rule: "easyDcForRepeat", name: "pf2e-artisans-workshop.Settings.EasyDcForRepeat.Name", hint: "pf2e-artisans-workshop.Settings.EasyDcForRepeat.Hint" },
    { key: "rules.setupInterruptionPersists", rule: "setupInterruptionPersists", name: "pf2e-artisans-workshop.Settings.SetupInterruptionPersists.Name", hint: "pf2e-artisans-workshop.Settings.SetupInterruptionPersists.Hint" },
    { key: "rules.recomputeRateOnLevelUp", rule: "recomputeRateOnLevelUp", name: "pf2e-artisans-workshop.Settings.RecomputeRateOnLevelUp.Name", hint: "pf2e-artisans-workshop.Settings.RecomputeRateOnLevelUp.Hint" },
    { key: "rules.crafterSwapRestarts", rule: "crafterSwapRestarts", name: "pf2e-artisans-workshop.Settings.CrafterSwapRestarts.Name", hint: "pf2e-artisans-workshop.Settings.CrafterSwapRestarts.Hint" },
    { key: "rules.familyCoversLowerGrades", rule: "familyCoversLowerGrades", name: "pf2e-artisans-workshop.Settings.FamilyCoversLowerGrades.Name", hint: "pf2e-artisans-workshop.Settings.FamilyCoversLowerGrades.Hint" },
    { key: "rules.allyCopyCostCp", rule: "allyCopyCostCp", name: "pf2e-artisans-workshop.Settings.AllyCopyCostCp.Name", hint: "pf2e-artisans-workshop.Settings.AllyCopyCostCp.Hint" },
    { key: "rules.formulaSurchargeUncommon", rule: "formulaSurchargeUncommon", name: "pf2e-artisans-workshop.Settings.FormulaSurchargeUncommon.Name", hint: "pf2e-artisans-workshop.Settings.FormulaSurchargeUncommon.Hint" },
    { key: "rules.formulaSurchargeRare", rule: "formulaSurchargeRare", name: "pf2e-artisans-workshop.Settings.FormulaSurchargeRare.Name", hint: "pf2e-artisans-workshop.Settings.FormulaSurchargeRare.Hint" },
    { key: "rules.inventorRarity", rule: "inventorRarity", name: "pf2e-artisans-workshop.Settings.InventorRarity.Name", hint: "pf2e-artisans-workshop.Settings.InventorRarity.Hint" },
    { key: "rules.inventorSetupDays", rule: "inventorSetupDays", name: "pf2e-artisans-workshop.Settings.InventorSetupDays.Name", hint: "pf2e-artisans-workshop.Settings.InventorSetupDays.Hint" },
    { key: "rules.preciousCoinForCommon", rule: "preciousCoinForCommon", name: "pf2e-artisans-workshop.Settings.PreciousCoinForCommon.Name", hint: "pf2e-artisans-workshop.Settings.PreciousCoinForCommon.Hint" },
    { key: "rules.snareDowntimeBatch", rule: "snareDowntimeBatch", name: "pf2e-artisans-workshop.Settings.SnareDowntimeBatch.Name", hint: "pf2e-artisans-workshop.Settings.SnareDowntimeBatch.Hint" },
    { key: "rules.magicalSnaresNeedMagicalCrafting", rule: "magicalSnaresNeedMagicalCrafting", name: "pf2e-artisans-workshop.Settings.MagicalSnaresNeedMagicalCrafting.Name", hint: "pf2e-artisans-workshop.Settings.MagicalSnaresNeedMagicalCrafting.Hint" },
    { key: "rules.snareToolkitIsArtisans", rule: "snareToolkitIsArtisans", name: "pf2e-artisans-workshop.Settings.SnareToolkitIsArtisans.Name", hint: "pf2e-artisans-workshop.Settings.SnareToolkitIsArtisans.Hint" },
    { key: "rules.tattooProcess", rule: "tattooProcess", name: "pf2e-artisans-workshop.Settings.TattooProcess.Name", hint: "pf2e-artisans-workshop.Settings.TattooProcess.Hint",
        choices: { "secrets-of-magic": "pf2e-artisans-workshop.Settings.TattooProcess.SecretsOfMagic", simple: "pf2e-artisans-workshop.Settings.TattooProcess.Simple" } },
    { key: "rules.earnIncomeOtherSkillDc", rule: "earnIncomeOtherSkillDc", name: "pf2e-artisans-workshop.Settings.EarnIncomeOtherSkillDc.Name", hint: "pf2e-artisans-workshop.Settings.EarnIncomeOtherSkillDc.Hint" },
    { key: "rules.downtimeRerolls", rule: "downtimeRerolls", name: "pf2e-artisans-workshop.Settings.DowntimeRerolls.Name", hint: "pf2e-artisans-workshop.Settings.DowntimeRerolls.Hint",
        choices: { warn: "pf2e-artisans-workshop.Settings.DowntimeRerolls.Warn", block: "pf2e-artisans-workshop.Settings.DowntimeRerolls.Block" } },
    { key: "rules.costOfLiving", rule: "costOfLiving", name: "pf2e-artisans-workshop.Settings.CostOfLiving.Name", hint: "pf2e-artisans-workshop.Settings.CostOfLiving.Hint" },
    { key: "rules.communal.helperDc", rule: "communal.helperDc", config: false },
    { key: "rules.communal.helperCritUsesNextRow", rule: "communal.helperCritUsesNextRow", name: "pf2e-artisans-workshop.Settings.HelperCritUsesNextRow.Name", hint: "pf2e-artisans-workshop.Settings.HelperCritUsesNextRow.Hint" },
    { key: "rules.communal.helperFailUsesFailColumn", rule: "communal.helperFailUsesFailColumn", name: "pf2e-artisans-workshop.Settings.HelperFailUsesFailColumn.Name", hint: "pf2e-artisans-workshop.Settings.HelperFailUsesFailColumn.Hint" },
    { key: "rules.communal.helperLeaveRetroactive", rule: "communal.helperLeaveRetroactive", name: "pf2e-artisans-workshop.Settings.HelperLeaveRetroactive.Name", hint: "pf2e-artisans-workshop.Settings.HelperLeaveRetroactive.Hint" },
    { key: "rules.communal.helperCap", rule: "communal.helperCap", name: "pf2e-artisans-workshop.Settings.HelperCap.Name", hint: "pf2e-artisans-workshop.Settings.HelperCap.Hint" },
    { key: "rules.communal.countHelpersWithoutFeat", rule: "communal.countHelpersWithoutFeat", name: "pf2e-artisans-workshop.Settings.CountHelpersWithoutFeat.Name", hint: "pf2e-artisans-workshop.Settings.CountHelpersWithoutFeat.Hint" },
    { key: "variants.complexCrafting", rule: "variants.complexCrafting", name: "pf2e-artisans-workshop.Settings.ComplexCrafting.Name", hint: "pf2e-artisans-workshop.Settings.ComplexCrafting.Hint" },
]);

/** The value at a dotted path of the rules object. */
const ruleDefault = (path) => path.split(".").reduce((object, key) => object[key], DEFAULT_RULES);

/** The setting type for a default value. */
function typeOf(value) {
    if (typeof value === "boolean") return Boolean;
    if (typeof value === "number") return Number;
    return String;
}

/**
 * Register every M2 setting. `handlers` are the sync's reactions: `enabled(value, userId)` when the master
 * switch changes and `docs()` when the shared documents' ids change.
 */
export function registerSettings(handlers) {
    game.settings.register(MODULE_ID, "enabled", {
        name: "pf2e-artisans-workshop.Settings.Enabled.Name",
        hint: "pf2e-artisans-workshop.Settings.Enabled.Hint",
        scope: "world", config: true, type: Boolean, default: false,
        onChange: (value, _options, userId) => handlers.enabled(value, userId),
    });
    game.settings.register(MODULE_ID, "docs", {
        scope: "world", config: false, type: Object, default: {},
        onChange: () => handlers.docs(),
    });
    game.settings.register(MODULE_ID, "members", {
        name: "pf2e-artisans-workshop.Settings.Members.Name",
        hint: "pf2e-artisans-workshop.Settings.Members.Hint",
        scope: "world", config: true, type: String, default: "party",
        choices: { party: "pf2e-artisans-workshop.Settings.Members.Party", all: "pf2e-artisans-workshop.Settings.Members.All" },
    });
    game.settings.register(MODULE_ID, "claims.auto", {
        name: "pf2e-artisans-workshop.Settings.AutoClaim.Name",
        hint: "pf2e-artisans-workshop.Settings.AutoClaim.Hint",
        scope: "user", config: true, type: Boolean, default: true,
    });
    for (const setting of RULE_SETTINGS) {
        const value = ruleDefault(setting.rule);
        game.settings.register(MODULE_ID, setting.key, {
            name: setting.name, hint: setting.hint, scope: "world", config: setting.config ?? true,
            type: typeOf(value), default: value, ...(setting.choices ? { choices: setting.choices } : {}),
        });
    }
}

/** A setting's value. */
export function setting(key) {
    return game.settings.get(MODULE_ID, key);
}

/** Whether the master switch is on. */
export const isEnabled = () => setting("enabled") === true;

/** The rules object the engine reads, from the current settings (14.2, 14.4). */
export function rulesFromSettings() {
    const overrides = { communal: {}, variants: {} };
    for (const { key, rule } of RULE_SETTINGS) {
        const path = rule.split(".");
        const target = path.length === 2 ? overrides[path[0]] : overrides;
        target[path.at(-1)] = setting(key);
    }
    return rulesWith(overrides);
}
