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
import { mixedGroups } from "../logic/variants.mjs";

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
    { key: "rules.tattooSubjectLocked", rule: "tattooSubjectLocked", name: "pf2e-artisans-workshop.Settings.TattooSubjectLocked.Name", hint: "pf2e-artisans-workshop.Settings.TattooSubjectLocked.Hint" },
    { key: "rules.tattooHealingDays", rule: "tattooHealingDays", name: "pf2e-artisans-workshop.Settings.TattooHealingDays.Name", hint: "pf2e-artisans-workshop.Settings.TattooHealingDays.Hint" },
    { key: "rules.talismanHostsExcludeBombs", rule: "talismanHostsExcludeBombs", name: "pf2e-artisans-workshop.Settings.TalismanHostsExcludeBombs.Name", hint: "pf2e-artisans-workshop.Settings.TalismanHostsExcludeBombs.Hint" },
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
    // Treasure Vault (Remastered) variants (14.4, 6.16): each off by default; M9a registers them all.
    { key: "variants.complexCrafting", rule: "variants.complexCrafting", variant: true, name: "pf2e-artisans-workshop.Settings.ComplexCrafting.Name", hint: "pf2e-artisans-workshop.Settings.ComplexCrafting.Hint" },
    { key: "variants.complex.rushCritFail", rule: "variants.complexRushCritFail", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.RushCritFail.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.RushCritFail.Hint",
        choices: { ruined: "pf2e-artisans-workshop.Settings.Variants.RushCritFail.Ruined", cursed: "pf2e-artisans-workshop.Settings.Variants.RushCritFail.Cursed" } },
    { key: "variants.adjustments", rule: "variants.adjustments", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.Adjustments.Name", hint: "pf2e-artisans-workshop.Settings.Variants.Adjustments.Hint" },
    { key: "variants.events", rule: "variants.events", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.Events.Name", hint: "pf2e-artisans-workshop.Settings.Variants.Events.Hint" },
    { key: "variants.events.firstDay", rule: "variants.eventsFirstDay", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.EventsFirstDay.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.EventsFirstDay.Hint" },
    { key: "variants.events.everyDays", rule: "variants.eventsEveryDays", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.EventsEveryDays.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.EventsEveryDays.Hint" },
    { key: "variants.events.table", rule: "variants.eventsTable", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.EventsTable.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.EventsTable.Hint" },
    { key: "variants.events.pauses", rule: "variants.eventsPauses", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.EventsPauses.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.EventsPauses.Hint" },
    { key: "variants.criticalCrafting", rule: "variants.criticalCrafting", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.Critical.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.Critical.Hint" },
    { key: "variants.critical.trigger", rule: "variants.criticalTrigger", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.CriticalTrigger.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.CriticalTrigger.Hint",
        choices: { natural: "pf2e-artisans-workshop.Settings.Variants.CriticalTrigger.Natural", any: "pf2e-artisans-workshop.Settings.Variants.CriticalTrigger.Any" } },
    { key: "variants.critical.specialOnly", rule: "variants.criticalSpecialOnly", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.CriticalSpecialOnly.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.CriticalSpecialOnly.Hint" },
    { key: "variants.critical.mode", rule: "variants.criticalMode", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.CriticalMode.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.CriticalMode.Hint",
        choices: { alongside: "pf2e-artisans-workshop.Settings.Variants.CriticalMode.Alongside", replace: "pf2e-artisans-workshop.Settings.Variants.CriticalMode.Replace" } },
    { key: "variants.critical.secret", rule: "variants.criticalSecret", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.CriticalSecret.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.CriticalSecret.Hint" },
    { key: "variants.deconstruct", rule: "variants.deconstruct", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.Deconstruct.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.Deconstruct.Hint" },
    { key: "variants.deconstruct.expiryDays", rule: "variants.deconstructExpiryDays", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.DeconstructExpiryDays.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.DeconstructExpiryDays.Hint" },
    { key: "variants.grow", rule: "variants.grow", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.Grow.Name", hint: "pf2e-artisans-workshop.Settings.Variants.Grow.Hint" },
    { key: "variants.natureCrafting.skills", rule: "variants.natureSkills", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.NatureSkills.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.NatureSkills.Hint",
        choices: { crafting: "pf2e-artisans-workshop.Settings.Variants.NatureSkills.Crafting", nature: "pf2e-artisans-workshop.Settings.Variants.NatureSkills.Nature",
            "nature-arcana": "pf2e-artisans-workshop.Settings.Variants.NatureSkills.NatureArcana" } },
    { key: "variants.natureCrafting.seasonDays", rule: "variants.seasonDays", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.SeasonDays.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.SeasonDays.Hint" },
    { key: "variants.gardens", rule: "variants.gardens", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.Gardens.Name", hint: "pf2e-artisans-workshop.Settings.Variants.Gardens.Hint" },
    { key: "variants.gifts", rule: "variants.gifts", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.Gifts.Name", hint: "pf2e-artisans-workshop.Settings.Variants.Gifts.Hint" },
    { key: "variants.quests", rule: "variants.quests", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.Quests.Name", hint: "pf2e-artisans-workshop.Settings.Variants.Quests.Hint" },
    { key: "variants.quests.critFail", rule: "variants.questsCritFail", variant: true, name: "pf2e-artisans-workshop.Settings.Variants.QuestsCritFail.Name",
        hint: "pf2e-artisans-workshop.Settings.Variants.QuestsCritFail.Hint",
        choices: { destroyed: "pf2e-artisans-workshop.Settings.Variants.QuestsCritFail.Destroyed", cursed: "pf2e-artisans-workshop.Settings.Variants.QuestsCritFail.Cursed" } },
]);

/**
 * A variant setting changed (M9a, 6.16 "One group at a time"): the user who changed it is told when variants of more than
 * one of the book's groups are now on (nothing is blocked), and every client hears `variantsChanged` so the window shows or
 * hides what the variant adds.
 */
function onVariantChange(userId) {
    if (userId === game.user.id && mixedGroups(rulesFromSettings())) {
        ui.notifications.warn("pf2e-artisans-workshop.Settings.Variants.Mixed", { localize: true });
    }
    Hooks.callAll("pf2e-artisans-workshop.variantsChanged");
}

/** The value at a dotted path of the rules object. */
const ruleDefault = (path) => path.split(".").reduce((object, key) => object[key], DEFAULT_RULES);

/** The setting type for a default value. */
function typeOf(value) {
    if (typeof value === "boolean") return Boolean;
    if (typeof value === "number") return Number;
    return String;
}

/** The world settings of 14.5 (M8a): key, default, name and hint, and choices where the value is one of a few. */
export const AFFLICTION_SETTINGS = Object.freeze([
    ["pcSaves", "prompt", "pf2e-artisans-workshop.Settings.Afflictions.PcSaves.Name", "pf2e-artisans-workshop.Settings.Afflictions.PcSaves.Hint",
        { prompt: "pf2e-artisans-workshop.Settings.Afflictions.Choice.Prompt", auto: "pf2e-artisans-workshop.Settings.Afflictions.Choice.Auto" }],
    ["npcSaves", "auto", "pf2e-artisans-workshop.Settings.Afflictions.NpcSaves.Name", "pf2e-artisans-workshop.Settings.Afflictions.NpcSaves.Hint",
        { auto: "pf2e-artisans-workshop.Settings.Afflictions.Choice.Auto", prompt: "pf2e-artisans-workshop.Settings.Afflictions.Choice.Prompt" }],
    ["gmRollsForOfflinePCs", false, "pf2e-artisans-workshop.Settings.Afflictions.GmRollsForOfflinePCs.Name",
        "pf2e-artisans-workshop.Settings.Afflictions.GmRollsForOfflinePCs.Hint", null],
    ["autoApplyDamage", false, "pf2e-artisans-workshop.Settings.Afflictions.AutoApplyDamage.Name", "pf2e-artisans-workshop.Settings.Afflictions.AutoApplyDamage.Hint", null],
    ["catchUp", "roll-each", "pf2e-artisans-workshop.Settings.Afflictions.CatchUp.Name", "pf2e-artisans-workshop.Settings.Afflictions.CatchUp.Hint",
        { "roll-each": "pf2e-artisans-workshop.Settings.Afflictions.Choice.RollEach", pause: "pf2e-artisans-workshop.Settings.Afflictions.Choice.Pause" }],
    ["catchUpLimit", 20, "pf2e-artisans-workshop.Settings.Afflictions.CatchUpLimit.Name", "pf2e-artisans-workshop.Settings.Afflictions.CatchUpLimit.Hint", null],
    ["combatAnchor", "exposure-turn", "pf2e-artisans-workshop.Settings.Afflictions.CombatAnchor.Name", "pf2e-artisans-workshop.Settings.Afflictions.CombatAnchor.Hint",
        { "exposure-turn": "pf2e-artisans-workshop.Settings.Afflictions.Choice.ExposureTurn", "victim-turn": "pf2e-artisans-workshop.Settings.Afflictions.Choice.VictimTurn" }],
    ["handOffToForge", true, "pf2e-artisans-workshop.Settings.Afflictions.HandOffToForge.Name", "pf2e-artisans-workshop.Settings.Afflictions.HandOffToForge.Hint", null],
    ["forgeWithoutGm", "workshop", "pf2e-artisans-workshop.Settings.Afflictions.ForgeWithoutGm.Name", "pf2e-artisans-workshop.Settings.Afflictions.ForgeWithoutGm.Hint",
        { workshop: "pf2e-artisans-workshop.Settings.Afflictions.Choice.Workshop", wait: "pf2e-artisans-workshop.Settings.Afflictions.Choice.Wait" }],
]);

/**
 * Render the open character and party sheets again (Application V1 in pf2e 8.6.1, in `ui.windows`), so the sheet entry
 * points (10.4) come or go with `features.sheetEntryPoints` and, after the M11 review, with the master switch: a sheet open
 * when the Workshop is switched off keeps no header button, Crafting tab strip or Party card.
 */
export function renderEntrySheets() {
    let count = 0;
    for (const app of Object.values(ui.windows ?? {})) {
        if (!["character", "party"].includes(app?.actor?.type) || !app.rendered) continue;
        app.render(false);
        count++;
    }
    return count;
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
    // M4 (DESIGN.md 14.1, 14.3): who sees the Workshop's chat cards, which order changes a user is told about, and
    // the tab the window opens on.
    game.settings.register(MODULE_ID, "chat.visibility", {
        name: "pf2e-artisans-workshop.Settings.ChatVisibility.Name",
        hint: "pf2e-artisans-workshop.Settings.ChatVisibility.Hint",
        scope: "world", config: true, type: String, default: "involved",
        choices: { involved: "pf2e-artisans-workshop.Settings.ChatVisibility.Involved", public: "pf2e-artisans-workshop.Settings.ChatVisibility.Public" },
    });
    game.settings.register(MODULE_ID, "notify.level", {
        name: "pf2e-artisans-workshop.Settings.NotifyLevel.Name",
        hint: "pf2e-artisans-workshop.Settings.NotifyLevel.Hint",
        scope: "user", config: true, type: String, default: "mine",
        choices: {
            all: "pf2e-artisans-workshop.Settings.NotifyLevel.All", mine: "pf2e-artisans-workshop.Settings.NotifyLevel.Mine",
            none: "pf2e-artisans-workshop.Settings.NotifyLevel.None",
        },
    });
    game.settings.register(MODULE_ID, "ui.lastTab", { scope: "user", config: false, type: String, default: "queue" });
    // M11 (DESIGN.md 14.1, 14.3): the sheet entry points (the character sheet's header button and Crafting tab strip, the
    // Party sheet's header button and card); the Parchment look in either colour scheme; the Workshop window's size, kept
    // per client.
    game.settings.register(MODULE_ID, "features.sheetEntryPoints", {
        name: "pf2e-artisans-workshop.Settings.FeaturesSheetEntryPoints.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesSheetEntryPoints.Hint",
        scope: "world", config: true, type: Boolean, default: true,
        // The open character and party sheets render again with or without them.
        onChange: () => renderEntrySheets(),
    });
    game.settings.register(MODULE_ID, "ui.parchment", {
        name: "pf2e-artisans-workshop.Settings.Parchment.Name",
        hint: "pf2e-artisans-workshop.Settings.Parchment.Hint",
        scope: "client", config: true, type: Boolean, default: false,
        onChange: async (value) => (await import("../ui/theme.mjs")).applyParchment(value === true),
    });
    game.settings.register(MODULE_ID, "ui.windowSize", { scope: "client", config: false, type: Object, default: {} });
    // M5 (DESIGN.md 14.1): the Formulas tab, formula jobs and services; off hides the tab and the formula routes.
    game.settings.register(MODULE_ID, "features.formulas", {
        name: "pf2e-artisans-workshop.Settings.FeaturesFormulas.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesFormulas.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    // M6 (DESIGN.md 14.1, 14.2): the Downtime tab (per-PC status, clock accrual, the day resolver and the wizard, helpers),
    // Earn Income jobs, and the settlement profiles the GM keeps (edited in the Downtime tab, so hidden here). The current
    // settlement is not a setting: players cannot write world settings, so it lives in the ledger (`meta.settlement`).
    game.settings.register(MODULE_ID, "features.downtime", {
        name: "pf2e-artisans-workshop.Settings.FeaturesDowntime.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesDowntime.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "features.income", {
        name: "pf2e-artisans-workshop.Settings.FeaturesIncome.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesIncome.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "settlements", { scope: "world", config: false, type: Object, default: {} });
    // M7 (DESIGN.md 14.1, 14.2): the Morning tab with loadouts, standing orders and the pf2e-dailies daily; party-wide
    // expiry of what daily preparations make; and what expiry does to an item (marks it inert, or deletes it).
    game.settings.register(MODULE_ID, "features.morning", {
        name: "pf2e-artisans-workshop.Settings.FeaturesMorning.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesMorning.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "features.expiry", {
        name: "pf2e-artisans-workshop.Settings.FeaturesExpiry.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesExpiry.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "expiry.action", {
        name: "pf2e-artisans-workshop.Settings.ExpiryAction.Name",
        hint: "pf2e-artisans-workshop.Settings.ExpiryAction.Hint",
        scope: "world", config: true, type: String, default: "inert",
        choices: { inert: "pf2e-artisans-workshop.Settings.ExpiryAction.Inert", delete: "pf2e-artisans-workshop.Settings.ExpiryAction.Delete" },
    });
    // M8 (DESIGN.md 8, 14.1-14.3): the combat tools (which step aside by themselves while PF2e Alchemist Remaster Duct
    // Tape is active), "Use best consumable" (which does not), vial gathering as world time passes (off: it writes to
    // actors on its own), what the end of an encounter does to Quick Alchemy items, and the Bandolier's own settings.
    game.settings.register(MODULE_ID, "features.combat", {
        name: "pf2e-artisans-workshop.Settings.FeaturesCombat.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesCombat.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "features.consumables", {
        name: "pf2e-artisans-workshop.Settings.FeaturesConsumables.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesConsumables.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "features.vialGathering", {
        name: "pf2e-artisans-workshop.Settings.FeaturesVialGathering.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesVialGathering.Hint",
        scope: "world", config: true, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, "expiry.quickAlchemyAtCombatEnd", {
        name: "pf2e-artisans-workshop.Settings.QuickAlchemyAtCombatEnd.Name",
        hint: "pf2e-artisans-workshop.Settings.QuickAlchemyAtCombatEnd.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "bandolier.autoOpen", {
        name: "pf2e-artisans-workshop.Settings.BandolierAutoOpen.Name",
        hint: "pf2e-artisans-workshop.Settings.BandolierAutoOpen.Hint",
        scope: "user", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "bandolier.position", { scope: "user", config: false, type: Object, default: {} });
    // M9 (DESIGN.md 14.1, 6.14): tattoo and graft orders with their subject, process, healing and investiture; off, a tattoo or
    // graft is crafted as a plain item.
    game.settings.register(MODULE_ID, "features.tattoos", {
        name: "pf2e-artisans-workshop.Settings.FeaturesTattoos.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesTattoos.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    // M8a (DESIGN.md 14.1, 14.5): the affliction tracker, independent of the combat features and of Duct Tape, and who rolls,
    // when, and what Affliction Forge gets.
    game.settings.register(MODULE_ID, "features.afflictions", {
        name: "pf2e-artisans-workshop.Settings.FeaturesAfflictions.Name",
        hint: "pf2e-artisans-workshop.Settings.FeaturesAfflictions.Hint",
        scope: "world", config: true, type: Boolean, default: true,
    });
    for (const [key, def, name, hint, choices] of AFFLICTION_SETTINGS) {
        game.settings.register(MODULE_ID, `afflictions.${key}`, {
            name, hint, scope: "world", config: true, type: typeof def === "boolean" ? Boolean : typeof def === "number" ? Number : String, default: def,
            ...(choices ? { choices } : {}),
        });
    }
    game.settings.register(MODULE_ID, "afflictions.notify", {
        name: "pf2e-artisans-workshop.Settings.Afflictions.Notify.Name",
        hint: "pf2e-artisans-workshop.Settings.Afflictions.Notify.Hint",
        scope: "user", config: true, type: String, default: "mine",
        choices: {
            all: "pf2e-artisans-workshop.Settings.NotifyLevel.All", mine: "pf2e-artisans-workshop.Settings.NotifyLevel.Mine",
            none: "pf2e-artisans-workshop.Settings.NotifyLevel.None",
        },
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
            ...(setting.variant ? { onChange: (_value, _options, userId) => onVariantChange(userId) } : {}),
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
