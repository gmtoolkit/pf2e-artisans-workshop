/**
 * Words for the codes the rules engine and the order lifecycle return (DESIGN.md 6.5 As built, P13): order states, gate
 * reasons, refusals, row kinds and formula routes, each mapped to its i18n key written out in full, so
 * `tools/check-source.mjs` checks that every one exists. Names of items, feats, skills and ranks come from the
 * compendium and pf2e's own strings (P9).
 */

/** Order states (4.2.2): the word and a Font Awesome icon, so a status is never colour alone (10.3). */
export const STATUS = Object.freeze({
    requested: { key: "pf2e-artisans-workshop.Status.Requested", icon: "fa-solid fa-inbox" },
    accepted: { key: "pf2e-artisans-workshop.Status.Accepted", icon: "fa-solid fa-handshake" },
    setup: { key: "pf2e-artisans-workshop.Status.Setup", icon: "fa-solid fa-screwdriver-wrench" },
    gathering: { key: "pf2e-artisans-workshop.Status.Gathering", icon: "fa-solid fa-compass" },
    check: { key: "pf2e-artisans-workshop.Status.Check", icon: "fa-solid fa-dice-d20" },
    rolled: { key: "pf2e-artisans-workshop.Status.Rolled", icon: "fa-solid fa-scale-balanced" },
    finishing: { key: "pf2e-artisans-workshop.Status.Finishing", icon: "fa-solid fa-hammer" },
    paused: { key: "pf2e-artisans-workshop.Status.Paused", icon: "fa-solid fa-pause" },
    failed: { key: "pf2e-artisans-workshop.Status.Failed", icon: "fa-solid fa-circle-xmark" },
    complete: { key: "pf2e-artisans-workshop.Status.Complete", icon: "fa-solid fa-circle-check" },
    cancelled: { key: "pf2e-artisans-workshop.Status.Cancelled", icon: "fa-solid fa-ban" },
    archived: { key: "pf2e-artisans-workshop.Status.Archived", icon: "fa-solid fa-box-archive" },
});

/** Gate reasons (6.5 As built), each a key whose placeholders the gate's `data` fills (`gateText`). */
export const GATE = Object.freeze({
    untrained: "pf2e-artisans-workshop.Gate.Untrained",
    "item-level": "pf2e-artisans-workshop.Gate.ItemLevel",
    rank: "pf2e-artisans-workshop.Gate.Rank",
    feats: "pf2e-artisans-workshop.Gate.Feats",
    "no-access": "pf2e-artisans-workshop.Gate.NoAccess",
    "needs-formula": "pf2e-artisans-workshop.Gate.NeedsFormula",
    "no-route": "pf2e-artisans-workshop.Gate.NoRoute",
    tool: "pf2e-artisans-workshop.Gate.Tool",
    underfunded: "pf2e-artisans-workshop.Gate.Underfunded",
    precious: "pf2e-artisans-workshop.Gate.Precious",
    // G8's precious-material problems (6.6, `preciousCheck`), each told with its numbers.
    "one-material": "pf2e-artisans-workshop.Gate.OneMaterial",
    "expert-needed": "pf2e-artisans-workshop.Gate.ExpertNeeded",
    "grade-rank": "pf2e-artisans-workshop.Gate.GradeRank",
    "material-level": "pf2e-artisans-workshop.Gate.MaterialLevel",
    "grade-item-level": "pf2e-artisans-workshop.Gate.GradeItemLevel",
    "invalid-for-item": "pf2e-artisans-workshop.Gate.InvalidForItem",
    "material-share": "pf2e-artisans-workshop.Gate.MaterialShare",
    "material-share-stock": "pf2e-artisans-workshop.Gate.MaterialShareStock",
    checklist: "pf2e-artisans-workshop.Gate.Checklist",
    spells: "pf2e-artisans-workshop.Gate.Spells",
    "target-not-held": "pf2e-artisans-workshop.Gate.TargetNotHeld",
    "no-consent": "pf2e-artisans-workshop.Gate.NoConsent",
    "subject-not-locked": "pf2e-artisans-workshop.Gate.SubjectNotLocked",
    locked: "pf2e-artisans-workshop.Gate.Locked",
    artifact: "pf2e-artisans-workshop.Gate.Artifact",
    "no-price": "pf2e-artisans-workshop.Gate.NoPrice",
    quantity: "pf2e-artisans-workshop.Gate.Quantity",
    // M5: formula jobs (6.8), runes and changed items (6.13).
    "invent-rarity": "pf2e-artisans-workshop.Gate.InventRarity",
    "formula-unknown": "pf2e-artisans-workshop.Gate.FormulaUnknown",
    "one-rune-at-a-time": "pf2e-artisans-workshop.Gate.OneRuneAtATime",
    "shield-reinforcing-only": "pf2e-artisans-workshop.Gate.ShieldReinforcingOnly",
    "specific-fundamental-only": "pf2e-artisans-workshop.Gate.SpecificFundamentalOnly",
    "staff-fundamental-only": "pf2e-artisans-workshop.Gate.StaffFundamentalOnly",
    "property-slots": "pf2e-artisans-workshop.Gate.PropertySlots",
    "no-target": "pf2e-artisans-workshop.Gate.NoTarget",
    "no-source": "pf2e-artisans-workshop.Gate.NoSource",
    "not-upgrade": "pf2e-artisans-workshop.Gate.NotUpgrade",
    "not-rune": "pf2e-artisans-workshop.Gate.NotRune",
    "wrong-item": "pf2e-artisans-workshop.Gate.WrongItem",
    "grade-rune-level": "pf2e-artisans-workshop.Gate.GradeRuneLevel",
    "target-stack": "pf2e-artisans-workshop.Gate.TargetStack",
    "rune-unsupported": "pf2e-artisans-workshop.Gate.RuneUnsupported",
    "not-stronger": "pf2e-artisans-workshop.Gate.NotStronger",
    "has-rune": "pf2e-artisans-workshop.Gate.HasRune",
    "not-there": "pf2e-artisans-workshop.Gate.NotThere",
    occupied: "pf2e-artisans-workshop.Gate.Occupied",
    // M9: tattoos and grafts one at a time (6.14), a fulu's tradition and formula.
    "one-at-a-time": "pf2e-artisans-workshop.Gate.OneAtATime",
    "fulu-tradition": "pf2e-artisans-workshop.Gate.FuluTradition",
    "no-reverse-engineer": "pf2e-artisans-workshop.Gate.NoReverseEngineer",
    // M9a (6.16): Deconstruct's items and workshop, Grow's tools, a quest's components, an adjustment that does not fit.
    "hard-to-destroy": "pf2e-artisans-workshop.Gate.HardToDestroy",
    consumable: "pf2e-artisans-workshop.Gate.Consumable",
    workshop: "pf2e-artisans-workshop.Gate.Workshop",
    "grow-tools": "pf2e-artisans-workshop.Gate.GrowTools",
    "quest-components": "pf2e-artisans-workshop.Gate.QuestComponents",
    "adjustment-fit": "pf2e-artisans-workshop.Gate.AdjustmentFit",
    other: "pf2e-artisans-workshop.Gate.Other",
});

/** Precious material grades (6.6), as gate texts name them. */
export const GRADE = Object.freeze({
    low: "pf2e-artisans-workshop.Grade.Low",
    standard: "pf2e-artisans-workshop.Grade.Standard",
    high: "pf2e-artisans-workshop.Grade.High",
});

/** Tools a Craft needs (G7). */
export const TOOL = Object.freeze({
    "alchemists-lab": "pf2e-artisans-workshop.Tool.AlchemistsLab",
    "artisans-toolkit": "pf2e-artisans-workshop.Tool.ArtisansToolkit",
    "snare-toolkit": "pf2e-artisans-workshop.Tool.SnareToolkit",
    "repair-toolkit": "pf2e-artisans-workshop.Tool.RepairToolkit",
});

/** Refusals of the lifecycle and the coin moves, for the notice a failed action raises. */
export const REFUSAL = Object.freeze({
    "not-ready": "pf2e-artisans-workshop.Refusal.NotReady",
    "no-order": "pf2e-artisans-workshop.Refusal.NoOrder",
    "not-owner": "pf2e-artisans-workshop.Refusal.NotOwner",
    // M11: macros and the shelf (11.1).
    "no-macro": "pf2e-artisans-workshop.Refusal.NoMacro",
    "macro-off": "pf2e-artisans-workshop.Refusal.MacroOff",
    "macro-error": "pf2e-artisans-workshop.Refusal.MacroError",
    "no-script": "pf2e-artisans-workshop.Refusal.NoScript",
    "hotbar-full": "pf2e-artisans-workshop.Refusal.HotbarFull",
    "no-card": "pf2e-artisans-workshop.Refusal.NoCard",
    // M11 review: Roll Craft check and Finish order without an order, when the actor has none waiting (`data.actor`, a name).
    "no-check-order": "pf2e-artisans-workshop.Refusal.NoCheckOrder",
    "nothing-to-finish": "pf2e-artisans-workshop.Refusal.NothingToFinish",
    state: "pf2e-artisans-workshop.Refusal.State",
    gates: "pf2e-artisans-workshop.Refusal.Gates",
    quantity: "pf2e-artisans-workshop.Refusal.Quantity",
    "no-product": "pf2e-artisans-workshop.Refusal.NoProduct",
    "no-price": "pf2e-artisans-workshop.Refusal.NoPrice",
    underfunded: "pf2e-artisans-workshop.Refusal.Underfunded",
    "too-much": "pf2e-artisans-workshop.Refusal.TooMuch",
    "strongbox-short": "pf2e-artisans-workshop.Refusal.StrongboxShort",
    "purse-short": "pf2e-artisans-workshop.Refusal.PurseShort",
    nothing: "pf2e-artisans-workshop.Refusal.Nothing",
    unsettled: "pf2e-artisans-workshop.Refusal.Unsettled",
    "moved-on": "pf2e-artisans-workshop.Refusal.MovedOn",
    "not-yours": "pf2e-artisans-workshop.Refusal.NotYours",
    "not-undoable": "pf2e-artisans-workshop.Refusal.NotUndoable",
    conflict: "pf2e-artisans-workshop.Refusal.Conflict",
    stopped: "pf2e-artisans-workshop.Refusal.Stopped",
    unknown: "pf2e-artisans-workshop.Refusal.Unknown",
    cancelled: "pf2e-artisans-workshop.Refusal.DialogClosed",
    "no-skill": "pf2e-artisans-workshop.Refusal.NoSkill",
    settled: "pf2e-artisans-workshop.Refusal.Settled",
    nothingToTake: "pf2e-artisans-workshop.Refusal.NothingToTake",
    "not-reversible": "pf2e-artisans-workshop.Refusal.NotReversible",
    "in-flight": "pf2e-artisans-workshop.Refusal.InFlight",
    "fund-short": "pf2e-artisans-workshop.Refusal.FundShort",
    "no-actor": "pf2e-artisans-workshop.Refusal.NoCharacter",
    resumable: "pf2e-artisans-workshop.Refusal.Resumable",
    // M5: formulas, pledges, custody and services.
    known: "pf2e-artisans-workshop.Refusal.Known",
    pending: "pf2e-artisans-workshop.Refusal.Pending",
    "no-route": "pf2e-artisans-workshop.Refusal.NoRoute",
    needs: "pf2e-artisans-workshop.Refusal.NeedsSeller",
    "no-pick": "pf2e-artisans-workshop.Refusal.NoPick",
    "no-recipient": "pf2e-artisans-workshop.Refusal.NoRecipient",
    "not-spell-item": "pf2e-artisans-workshop.Refusal.NotSpellItem",
    "no-spell": "pf2e-artisans-workshop.Refusal.NoSpell",
    unscribable: "pf2e-artisans-workshop.Refusal.Unscribable",
    "spell-rank": "pf2e-artisans-workshop.Refusal.SpellRank",
    "same-spell": "pf2e-artisans-workshop.Refusal.SameSpell",
    "one-casting": "pf2e-artisans-workshop.Refusal.OneCasting",
    "scroll-castings": "pf2e-artisans-workshop.Refusal.ScrollCastings",
    castings: "pf2e-artisans-workshop.Refusal.Castings",
    "no-pledge": "pf2e-artisans-workshop.Refusal.NoPledge",
    "no-casting-service": "pf2e-artisans-workshop.Refusal.NoCastingService",
    "cantrip-service": "pf2e-artisans-workshop.Refusal.CantripService",
    "no-item": "pf2e-artisans-workshop.Refusal.NoItem",
    "in-strongbox": "pf2e-artisans-workshop.Refusal.InStrongbox",
    "not-stock": "pf2e-artisans-workshop.Refusal.NotStock",
    stack: "pf2e-artisans-workshop.Refusal.Stack",
    "no-line": "pf2e-artisans-workshop.Refusal.NoLine",
    gone: "pf2e-artisans-workshop.Refusal.Gone",
    "no-service": "pf2e-artisans-workshop.Refusal.NoService",
    "bad-service": "pf2e-artisans-workshop.Refusal.BadService",
    tool: "pf2e-artisans-workshop.Refusal.Tool",
    destroyed: "pf2e-artisans-workshop.Refusal.Destroyed",
    undamaged: "pf2e-artisans-workshop.Refusal.Undamaged",
    "no-hp": "pf2e-artisans-workshop.Refusal.NoHp",
    "talisman-manager": "pf2e-artisans-workshop.Refusal.TalismanManager",
    "not-talisman": "pf2e-artisans-workshop.Refusal.NotTalisman",
    "not-together": "pf2e-artisans-workshop.Refusal.NotTogether",
    "not-host": "pf2e-artisans-workshop.Refusal.NotHost",
    "wrong-host": "pf2e-artisans-workshop.Refusal.WrongHost",
    "host-taken": "pf2e-artisans-workshop.Refusal.HostTaken",
    "formula-unknown": "pf2e-artisans-workshop.Refusal.FormulaUnknown",
    "no-action": "pf2e-artisans-workshop.Refusal.NoAction",
    "no-outcome": "pf2e-artisans-workshop.Refusal.NoOutcome",
    "no-target": "pf2e-artisans-workshop.Gate.NoTarget",
    "no-source": "pf2e-artisans-workshop.Gate.NoSource",
    "not-upgrade": "pf2e-artisans-workshop.Gate.NotUpgrade",
    "not-rune": "pf2e-artisans-workshop.Gate.NotRune",
    "wrong-item": "pf2e-artisans-workshop.Gate.WrongItem",
    "grade-rune-level": "pf2e-artisans-workshop.Gate.GradeRuneLevel",
    "target-stack": "pf2e-artisans-workshop.Gate.TargetStack",
    "rune-unsupported": "pf2e-artisans-workshop.Gate.RuneUnsupported",
    "not-stronger": "pf2e-artisans-workshop.Gate.NotStronger",
    "has-rune": "pf2e-artisans-workshop.Gate.HasRune",
    "not-there": "pf2e-artisans-workshop.Gate.NotThere",
    occupied: "pf2e-artisans-workshop.Gate.Occupied",
    taken: "pf2e-artisans-workshop.Refusal.Conflict",
    // M6: downtime days, Communal Crafting helpers, Earn Income jobs and settlements.
    "days-pending": "pf2e-artisans-workshop.Refusal.DaysPending",
    "no-activity": "pf2e-artisans-workshop.Refusal.NoActivity",
    "no-days": "pf2e-artisans-workshop.Refusal.NoDays",
    "paid-off": "pf2e-artisans-workshop.Refusal.PaidOff",
    "helper-locked": "pf2e-artisans-workshop.Refusal.Locked",
    helping: "pf2e-artisans-workshop.Refusal.Helping",
    "job-days-pending": "pf2e-artisans-workshop.Refusal.JobDaysPending",
    "job-moved-on": "pf2e-artisans-workshop.Refusal.JobMovedOn",
    moved: "pf2e-artisans-workshop.Refusal.Moved",
    "not-eligible": "pf2e-artisans-workshop.Refusal.NotEligible",
    "not-helping": "pf2e-artisans-workshop.Refusal.NotHelping",
    already: "pf2e-artisans-workshop.Refusal.Already",
    left: "pf2e-artisans-workshop.Refusal.Left",
    crafter: "pf2e-artisans-workshop.Refusal.Crafter",
    untrained: "pf2e-artisans-workshop.Refusal.Untrained",
    "task-level-range": "pf2e-artisans-workshop.Refusal.TaskLevelRange",
    "task-level-cap": "pf2e-artisans-workshop.Refusal.TaskLevelCap",
    "no-profile": "pf2e-artisans-workshop.Refusal.NoProfile",
    "bad-profile": "pf2e-artisans-workshop.Refusal.BadProfile",
    "not-gm": "pf2e-artisans-workshop.Refusal.NotGm",
    same: "pf2e-artisans-workshop.Refusal.Same",
    "no-job": "pf2e-artisans-workshop.Refusal.NoJob",
    "stale-round": "pf2e-artisans-workshop.Refusal.StaleRound",
    rolled: "pf2e-artisans-workshop.Roll.AlreadyRolled",
    unrolled: "pf2e-artisans-workshop.Refusal.Unrolled",
    "no-earner": "pf2e-artisans-workshop.Refusal.NoCharacter",
    // M7 (7.1-7.7): daily preparations, loadouts, standing orders, Food Preservation.
    prepared: "pf2e-artisans-workshop.Refusal.Prepared",
    sheet: "pf2e-artisans-workshop.Refusal.Sheet",
    plan: "pf2e-artisans-workshop.Refusal.Plan",
    busy: "pf2e-artisans-workshop.Refusal.Busy",
    off: "pf2e-artisans-workshop.Refusal.Off",
    "no-loadout": "pf2e-artisans-workshop.Refusal.NoLoadout",
    "bad-loadout": "pf2e-artisans-workshop.Refusal.BadLoadout",
    "nothing-prepared": "pf2e-artisans-workshop.Refusal.NothingPrepared",
    "no-crafter": "pf2e-artisans-workshop.Refusal.NoCrafter",
    "bad-standing": "pf2e-artisans-workshop.Refusal.BadStanding",
    "no-standing": "pf2e-artisans-workshop.Refusal.NoStanding",
    "not-preservable": "pf2e-artisans-workshop.Refusal.NotPreservable",
    "too-many": "pf2e-artisans-workshop.Refusal.TooMany",
    system: "pf2e-artisans-workshop.Refusal.System",
    // M8 (8.1-8.9): combat alchemy, vials and "Use best consumable".
    "duct-tape": "pf2e-artisans-workshop.Combat.Off.DuctTape",
    "combat-off": "pf2e-artisans-workshop.Refusal.CombatOff",
    "consumables-off": "pf2e-artisans-workshop.Refusal.ConsumablesOff",
    "alchemy-busy": "pf2e-artisans-workshop.Refusal.AlchemyBusy",
    "craft-failed": "pf2e-artisans-workshop.Refusal.CraftFailed",
    "not-chosen": "pf2e-artisans-workshop.Refusal.NotChosen",
    "no-quick-alchemy": "pf2e-artisans-workshop.Refusal.NoQuickAlchemy",
    "cannot-make": "pf2e-artisans-workshop.Refusal.CannotMake",
    "nothing-picked": "pf2e-artisans-workshop.Refusal.NothingPicked",
    "double-brew": "pf2e-artisans-workshop.Refusal.DoubleBrew",
    "additive-unknown": "pf2e-artisans-workshop.Refusal.AdditiveUnknown",
    "additive-fit": "pf2e-artisans-workshop.Refusal.AdditiveFit",
    "additive-round": "pf2e-artisans-workshop.Refusal.AdditiveRound",
    "combine-pick": "pf2e-artisans-workshop.Refusal.CombinePick",
    "combine-fit": "pf2e-artisans-workshop.Refusal.CombineFit",
    "no-vials": "pf2e-artisans-workshop.Refusal.NoVials",
    vials: "pf2e-artisans-workshop.Refusal.Vials",
    "no-vial-item": "pf2e-artisans-workshop.Refusal.NoVialItem",
    "no-vials-resource": "pf2e-artisans-workshop.Refusal.NoVialItem",
    "bad-choice": "pf2e-artisans-workshop.Refusal.BadChoice",
    "no-feat": "pf2e-artisans-workshop.Refusal.NoFeat",
    "not-in-combat": "pf2e-artisans-workshop.Refusal.NotInCombat",
    quickened: "pf2e-artisans-workshop.Refusal.Quickened",
    none: "pf2e-artisans-workshop.Refusal.NoneHeld",
    "item-gone": "pf2e-artisans-workshop.Refusal.ItemGone",
    "not-healing-bomb": "pf2e-artisans-workshop.Refusal.NotHealingBomb",
    inert: "pf2e-artisans-workshop.Refusal.Inert",
    "no-creature": "pf2e-artisans-workshop.Refusal.NoCreature",
    "no-token": "pf2e-artisans-workshop.Refusal.NoToken",
    "apply-failed": "pf2e-artisans-workshop.Refusal.ApplyFailed",
    range: "pf2e-artisans-workshop.Refusal.Range",
    "no-strike": "pf2e-artisans-workshop.Refusal.NoStrike",
    "no-regain": "pf2e-artisans-workshop.Refusal.NoRegain",
    "in-combat": "pf2e-artisans-workshop.Refusal.InCombat",
    full: "pf2e-artisans-workshop.Refusal.Full",
    minutes: "pf2e-artisans-workshop.Refusal.Minutes",
    frequency: "pf2e-artisans-workshop.Refusal.Frequency",
    // M8a (8.10): the affliction tracker.
    "afflictions-off": "pf2e-artisans-workshop.Refusal.AfflictionsOff",
    "no-definition": "pf2e-artisans-workshop.Refusal.NoDefinition",
    "no-dc": "pf2e-artisans-workshop.Refusal.NoDc",
    "no-targets": "pf2e-artisans-workshop.Refusal.NoTargets",
    "no-save": "pf2e-artisans-workshop.Refusal.NoSave",
    "no-voluntary": "pf2e-artisans-workshop.Refusal.NoVoluntary",
    "no-statistic": "pf2e-artisans-workshop.Refusal.NoStatistic",
    "no-affliction": "pf2e-artisans-workshop.Refusal.NoAffliction",
    "not-poison": "pf2e-artisans-workshop.Refusal.NotPoison",
    "bad-host": "pf2e-artisans-workshop.Refusal.BadHost",
    "forge-coats": "pf2e-artisans-workshop.Refusal.ForgeCoats",
    coated: "pf2e-artisans-workshop.Refusal.Coated",
    "double-ammo": "pf2e-artisans-workshop.Refusal.DoubleAmmo",
    "double-two": "pf2e-artisans-workshop.Refusal.DoubleTwo",
    "double-same": "pf2e-artisans-workshop.Refusal.DoubleSame",
    "double-infused": "pf2e-artisans-workshop.Refusal.DoubleInfused",
    "double-level": "pf2e-artisans-workshop.Refusal.DoubleLevel",
    "no-coating": "pf2e-artisans-workshop.Refusal.NoCoating",
    spent: "pf2e-artisans-workshop.Refusal.Spent",
    "bad-definition": "pf2e-artisans-workshop.Refusal.BadDefinition",
    "cloud-gone": "pf2e-artisans-workshop.Refusal.CloudGone",
    "forge-off": "pf2e-artisans-workshop.Refusal.ForgeOff",
    "forge-refused": "pf2e-artisans-workshop.Refusal.ForgeRefused",
    // M9: subjects (6.14), listed castings (6.9), fulus, missives and snares.
    subject: "pf2e-artisans-workshop.Refusal.Subject",
    "not-subject": "pf2e-artisans-workshop.Refusal.NotSubject",
    "subject-recipient": "pf2e-artisans-workshop.Refusal.SubjectRecipient",
    "no-consent": "pf2e-artisans-workshop.Gate.NoConsent",
    "subject-locked": "pf2e-artisans-workshop.Refusal.SubjectLocked",
    "not-on-list": "pf2e-artisans-workshop.Refusal.NotOnList",
    covered: "pf2e-artisans-workshop.Refusal.Covered",
    "any-castings": "pf2e-artisans-workshop.Refusal.AnyCastings",
    tradition: "pf2e-artisans-workshop.Refusal.Tradition",
    "not-missive": "pf2e-artisans-workshop.Refusal.NotMissive",
    composed: "pf2e-artisans-workshop.Refusal.Composed",
    "no-pool": "pf2e-artisans-workshop.Refusal.NoPool",
    mark: "pf2e-artisans-workshop.Refusal.Mark",
    deployed: "pf2e-artisans-workshop.Refusal.Deployed",
    "not-deployed": "pf2e-artisans-workshop.Refusal.NotDeployed",
    // M9a (6.16): the variants.
    "variant-off": "pf2e-artisans-workshop.Refusal.VariantOff",
    moneyless: "pf2e-artisans-workshop.Refusal.Moneyless",
    rush: "pf2e-artisans-workshop.Refusal.Rush",
    "no-hours": "pf2e-artisans-workshop.Refusal.NoHours",
    "setup-days": "pf2e-artisans-workshop.Refusal.SetupDays",
    "downtime-day": "pf2e-artisans-workshop.Refusal.DowntimeDay",
    hours: "pf2e-artisans-workshop.Refusal.SetupHoursFull",
    rank: "pf2e-artisans-workshop.Refusal.Rank",
    "no-event": "pf2e-artisans-workshop.Refusal.NoEvent",
    "not-member": "pf2e-artisans-workshop.Refusal.NotMember",
    "no-critical": "pf2e-artisans-workshop.Refusal.NoCritical",
    made: "pf2e-artisans-workshop.Refusal.Made",
    cursed: "pf2e-artisans-workshop.Refusal.Cursed",
    "no-check": "pf2e-artisans-workshop.Refusal.NoCheck",
    gifted: "pf2e-artisans-workshop.Refusal.Gifted",
    dormant: "pf2e-artisans-workshop.Refusal.Dormant",
    damaged: "pf2e-artisans-workshop.Refusal.Damaged",
    raw: "pf2e-artisans-workshop.Refusal.Raw",
    "not-similar": "pf2e-artisans-workshop.Refusal.NotSimilar",
    purpose: "pf2e-artisans-workshop.Refusal.Purpose",
    key: "pf2e-artisans-workshop.Refusal.Key",
    expired: "pf2e-artisans-workshop.Refusal.Expired",
    "one-components": "pf2e-artisans-workshop.Refusal.OneComponents",
    "no-garden": "pf2e-artisans-workshop.Refusal.NoGarden",
    planted: "pf2e-artisans-workshop.Refusal.Planted",
    "not-planted": "pf2e-artisans-workshop.Refusal.NotPlanted",
    harvested: "pf2e-artisans-workshop.Refusal.Harvested",
    "garden-limit": "pf2e-artisans-workshop.Refusal.GardenLimit",
    "not-consumable": "pf2e-artisans-workshop.Refusal.NotConsumable",
    funded: "pf2e-artisans-workshop.Refusal.Funded",
    "over-seed": "pf2e-artisans-workshop.Refusal.OverSeed",
    encounters: "pf2e-artisans-workshop.Refusal.Encounters",
    "no-component": "pf2e-artisans-workshop.Refusal.NoComponent",
    found: "pf2e-artisans-workshop.Refusal.Found",
    missing: "pf2e-artisans-workshop.Refusal.Missing",
    "not-due": "pf2e-artisans-workshop.Refusal.NotDue",
    "adjustment-fit": "pf2e-artisans-workshop.Refusal.AdjustmentFit",
    // M10 (12): the extension API.
    "ext-unknown": "pf2e-artisans-workshop.Refusal.ExtUnknown",
    "ext-no-check": "pf2e-artisans-workshop.Refusal.ExtNoCheck",
    "no-income-source": "pf2e-artisans-workshop.Refusal.ExtNoSource",
    resolved: "pf2e-artisans-workshop.Refusal.ExtResolved",
    "no-run": "pf2e-artisans-workshop.Refusal.ExtNoRun",
    "unknown-extension": "pf2e-artisans-workshop.Refusal.ExtUnknownModule",
    "bad-kind": "pf2e-artisans-workshop.Refusal.ExtBadRow",
    "bad-amount": "pf2e-artisans-workshop.Refusal.ExtBadRow",
    "bad-key": "pf2e-artisans-workshop.Refusal.ExtBadRow",
    "bad-source": "pf2e-artisans-workshop.Refusal.ExtBadRow",
    "bad-via": "pf2e-artisans-workshop.Refusal.ExtBadRow",
    "bad-day": "pf2e-artisans-workshop.Refusal.ExtBadRow",
    "bad-note": "pf2e-artisans-workshop.Refusal.ExtBadRow",
    "bad-result": "pf2e-artisans-workshop.Refusal.ExtBadResult",
    "no-sink": "pf2e-artisans-workshop.Refusal.ExtNoSink",
    "not-accepted": "pf2e-artisans-workshop.Refusal.ExtNotAccepted",
    "sink-error": "pf2e-artisans-workshop.Refusal.ExtSinkError",
    other: "pf2e-artisans-workshop.Refusal.Other",
});

/** Ledger row kinds (4.6). */
export const ROW_KIND = Object.freeze({
    pledge: "pf2e-artisans-workshop.Row.Pledge",
    deposit: "pf2e-artisans-workshop.Row.Deposit",
    allocate: "pf2e-artisans-workshop.Row.Allocate",
    withdraw: "pf2e-artisans-workshop.Row.Withdraw",
    commit: "pf2e-artisans-workshop.Row.Commit",
    expend: "pf2e-artisans-workshop.Row.Expend",
    release: "pf2e-artisans-workshop.Row.Release",
    ruin: "pf2e-artisans-workshop.Row.Ruin",
    remainder: "pf2e-artisans-workshop.Row.Remainder",
    refund: "pf2e-artisans-workshop.Row.Refund",
    "material-in": "pf2e-artisans-workshop.Row.MaterialIn",
    "material-out": "pf2e-artisans-workshop.Row.MaterialOut",
    purchase: "pf2e-artisans-workshop.Row.Purchase",
    wage: "pf2e-artisans-workshop.Row.Wage",
    income: "pf2e-artisans-workshop.Row.Income",
    expense: "pf2e-artisans-workshop.Row.Expense",
    plant: "pf2e-artisans-workshop.Row.Plant",
    delivered: "pf2e-artisans-workshop.Row.Delivered",
    shelved: "pf2e-artisans-workshop.Row.Shelved",
    "custody-in": "pf2e-artisans-workshop.Row.CustodyIn",
    "custody-out": "pf2e-artisans-workshop.Row.CustodyOut",
    carry: "pf2e-artisans-workshop.Row.Carry",
    adjust: "pf2e-artisans-workshop.Row.Adjust",
    reversal: "pf2e-artisans-workshop.Row.Reversal",
    // How the ledger names an allocation by its direction, and an order's item kept in the strongbox (`rowLabel`, M4.1).
    earmark: "pf2e-artisans-workshop.Row.Earmark",
    unearmark: "pf2e-artisans-workshop.Row.Unearmark",
    kept: "pf2e-artisans-workshop.Row.Kept",
    // An item an order changed where it was, in its recipient's inventory (`rowLabel`, M5 on M4.1).
    "in-place": "pf2e-artisans-workshop.Row.InPlace",
});

/**
 * Each requirement (gate, 6.5) by a short name, so the order detail says what it is in plain words (As built in M4.1);
 * the failing ones add the sentence of their reason (`GATE`).
 */
export const REQUIREMENT = Object.freeze({
    G1: "pf2e-artisans-workshop.Requirement.G1",
    G2: "pf2e-artisans-workshop.Requirement.G2",
    G3: "pf2e-artisans-workshop.Requirement.G3",
    G4: "pf2e-artisans-workshop.Requirement.G4",
    G5: "pf2e-artisans-workshop.Requirement.G5",
    G6: "pf2e-artisans-workshop.Requirement.G6",
    G7: "pf2e-artisans-workshop.Requirement.G7",
    G8: "pf2e-artisans-workshop.Requirement.G8",
    G9: "pf2e-artisans-workshop.Requirement.G9",
    G10: "pf2e-artisans-workshop.Requirement.G10",
    G11: "pf2e-artisans-workshop.Requirement.G11",
    G12: "pf2e-artisans-workshop.Requirement.G12",
    // The name a requirement goes by for the order's kind (`requirementVariant`, M5 on M4.1).
    "G9.spells": "pf2e-artisans-workshop.Requirement.G9Spells",
    "G10.target": "pf2e-artisans-workshop.Requirement.G10Target",
    "G10.possession": "pf2e-artisans-workshop.Requirement.G10Possession",
    "G12.rune": "pf2e-artisans-workshop.Requirement.G12Rune",
    "G12.upgrade": "pf2e-artisans-workshop.Requirement.G12Upgrade",
    // M9: a tattoo's or graft's subject (6.14).
    "G10.subject": "pf2e-artisans-workshop.Requirement.G10Subject",
    "G11.subject": "pf2e-artisans-workshop.Requirement.G11Subject",
    batch: "pf2e-artisans-workshop.Requirement.Batch",
    other: "pf2e-artisans-workshop.Requirement.Other",
});

/** Where a finished order's item went (`deliveryOf`, M4.1): a sentence naming the recipient. */
export const DELIVERY = Object.freeze({
    delivered: "pf2e-artisans-workshop.Delivery.Delivered",
    arriving: "pf2e-artisans-workshop.Delivery.Arriving",
    shelf: "pf2e-artisans-workshop.Delivery.Shelf",
    /** The shelf, said to a user who can collect it, next to the Collect button. */
    shelfYours: "pf2e-artisans-workshop.Delivery.ShelfYours",
    strongbox: "pf2e-artisans-workshop.Delivery.Strongbox",
    // M5 on M4.1: a formula job's formula goes into a book, and an item changed where it was never goes anywhere.
    book: "pf2e-artisans-workshop.Delivery.Book",
    "in-place": "pf2e-artisans-workshop.Delivery.InPlace",
    // M9a (6.16.1): a rushed finish that ruined the item made nothing.
    ruined: "pf2e-artisans-workshop.Delivery.Ruined",
});

/** Formula routes (4.3). */
export const ROUTE = Object.freeze({
    known: "pf2e-artisans-workshop.Route.Known",
    family: "pf2e-artisans-workshop.Route.Family",
    virtual: "pf2e-artisans-workshop.Route.Virtual",
    none: "pf2e-artisans-workshop.Route.None",
    invent: "pf2e-artisans-workshop.Route.Invent",
    "reverse-engineer": "pf2e-artisans-workshop.Route.ReverseEngineer",
    "craft-copy": "pf2e-artisans-workshop.Route.CraftCopy",
});

/** Every route to a formula (4.3, 6.8), as the Formulas tab names them. */
export const ACQUIRE_ROUTE = Object.freeze({
    ...ROUTE,
    buy: "pf2e-artisans-workshop.Route.Buy",
    "copy-npc": "pf2e-artisans-workshop.Route.CopyNpc",
    "copy-ally": "pf2e-artisans-workshop.Route.CopyAlly",
    scanner: "pf2e-artisans-workshop.Route.Scanner",
});

/** Provenance badges (4.13): a word and an icon each, never colour alone (10.9). */
export const PROVENANCE = Object.freeze({
    granted: { key: "pf2e-artisans-workshop.Provenance.Granted", icon: "fa-solid fa-gift" },
    bought: { key: "pf2e-artisans-workshop.Provenance.Bought", icon: "fa-solid fa-coins" },
    "copied-npc": { key: "pf2e-artisans-workshop.Provenance.CopiedNpc", icon: "fa-solid fa-store" },
    "copied-ally": { key: "pf2e-artisans-workshop.Provenance.CopiedAlly", icon: "fa-solid fa-people-arrows" },
    invented: { key: "pf2e-artisans-workshop.Provenance.Invented", icon: "fa-solid fa-lightbulb" },
    "reverse-engineered": { key: "pf2e-artisans-workshop.Provenance.ReverseEngineered", icon: "fa-solid fa-magnifying-glass" },
    looted: { key: "pf2e-artisans-workshop.Provenance.Looted", icon: "fa-solid fa-sack-xmark" },
    family: { key: "pf2e-artisans-workshop.Provenance.Family", icon: "fa-solid fa-sitemap" },
    virtual: { key: "pf2e-artisans-workshop.Provenance.Virtual", icon: "fa-solid fa-wand-sparkles" },
    unrecorded: { key: "pf2e-artisans-workshop.Provenance.Unrecorded", icon: "fa-solid fa-book" },
});

/** Kinds of order (4.2.1 `craftType`, M5). */
export const CRAFT_TYPE = Object.freeze({
    item: "pf2e-artisans-workshop.CraftType.Item",
    upgrade: "pf2e-artisans-workshop.CraftType.Upgrade",
    "rune-etch": "pf2e-artisans-workshop.CraftType.RuneEtch",
    "rune-transfer": "pf2e-artisans-workshop.CraftType.RuneTransfer",
    "spell-item": "pf2e-artisans-workshop.CraftType.SpellItem",
    formula: "pf2e-artisans-workshop.CraftType.Formula",
    // M9 (6.14).
    tattoo: "pf2e-artisans-workshop.CraftType.Tattoo",
    graft: "pf2e-artisans-workshop.CraftType.Graft",
    // M9a (6.16), while their variants are on.
    deconstruct: "pf2e-artisans-workshop.CraftType.Deconstruct",
    grow: "pf2e-artisans-workshop.CraftType.Grow",
    quest: "pf2e-artisans-workshop.CraftType.Quest",
});

/** A delivered tattoo's or graft's state (6.14, M9): a word and an icon each. */
export const SUBJECT_STATE = Object.freeze({
    healing: { key: "pf2e-artisans-workshop.Subject.State.Healing", icon: "fa-solid fa-bandage" },
    invested: { key: "pf2e-artisans-workshop.Subject.State.Invested", icon: "fa-solid fa-circle-check" },
    decorative: { key: "pf2e-artisans-workshop.Subject.State.Decorative", icon: "fa-solid fa-palette" },
    inactive: { key: "pf2e-artisans-workshop.Subject.State.Inactive", icon: "fa-solid fa-circle-pause" },
    mundane: { key: "pf2e-artisans-workshop.Subject.State.Mundane", icon: "fa-solid fa-pen-nib" },
});

/** The tattoo processes (6.14), as the Queue names them. */
export const TATTOO_PROCESS = Object.freeze({
    "secrets-of-magic": "pf2e-artisans-workshop.Settings.TattooProcess.SecretsOfMagic",
    simple: "pf2e-artisans-workshop.Settings.TattooProcess.Simple",
    graft: "pf2e-artisans-workshop.CraftType.Graft",
});

/** Service kinds and states (4.5). */
export const SERVICE = Object.freeze({
    repair: "pf2e-artisans-workshop.Service.Kind.Repair",
    affix: "pf2e-artisans-workshop.Service.Kind.Affix",
    unaffix: "pf2e-artisans-workshop.Service.Kind.Unaffix",
    "identify-alchemy": "pf2e-artisans-workshop.Service.Kind.IdentifyAlchemy",
    "formula-copy": "pf2e-artisans-workshop.Service.Kind.FormulaCopy",
});
export const SERVICE_STATUS = Object.freeze({
    open: { key: "pf2e-artisans-workshop.Service.Status.Open", icon: "fa-solid fa-inbox" },
    done: { key: "pf2e-artisans-workshop.Service.Status.Done", icon: "fa-solid fa-circle-check" },
    failed: { key: "pf2e-artisans-workshop.Service.Status.Failed", icon: "fa-solid fa-circle-xmark" },
    cancelled: { key: "pf2e-artisans-workshop.Service.Status.Cancelled", icon: "fa-solid fa-ban" },
});

/** Casting pledge states (6.9). */
export const PLEDGE_STATUS = Object.freeze({
    offered: "pf2e-artisans-workshop.Pledge.Status.Offered",
    fulfilled: "pf2e-artisans-workshop.Pledge.Status.Fulfilled",
    withdrawn: "pf2e-artisans-workshop.Pledge.Status.Withdrawn",
});

/** What an item was handed over for (custody, M5). */
export const PURPOSE = Object.freeze({
    target: "pf2e-artisans-workshop.Custody.Purpose.Target",
    source: "pf2e-artisans-workshop.Custody.Purpose.Source",
    possession: "pf2e-artisans-workshop.Custody.Purpose.Possession",
    material: "pf2e-artisans-workshop.Custody.Purpose.Material",
    service: "pf2e-artisans-workshop.Custody.Purpose.Service",
});

/** pf2e's own words for degrees of success, 0 to 3. */
export const DEGREE_KEY = Object.freeze([
    "PF2E.Check.Result.Degree.Check.criticalFailure",
    "PF2E.Check.Result.Degree.Check.failure",
    "PF2E.Check.Result.Degree.Check.success",
    "PF2E.Check.Result.Degree.Check.criticalSuccess",
]);

/** CSS class of each degree, for the colours of 10.9. */
export const DEGREE_CLASS = Object.freeze(["critical-failure", "failure", "success", "critical-success"]);

/** pf2e's words for proficiency ranks, 0 to 4. */
export const RANK_KEY = Object.freeze([
    "PF2E.ProficiencyLevel0", "PF2E.ProficiencyLevel1", "PF2E.ProficiencyLevel2", "PF2E.ProficiencyLevel3", "PF2E.ProficiencyLevel4",
]);

/** Transitions in an order's history (4.2.3), and what the status bar says after each. */
export const EVENT = Object.freeze({
    accept: "pf2e-artisans-workshop.Event.Accept",
    release: "pf2e-artisans-workshop.Event.Release",
    start: "pf2e-artisans-workshop.Event.Start",
    settle: "pf2e-artisans-workshop.Event.Settle",
    pause: "pf2e-artisans-workshop.Event.Pause",
    resume: "pf2e-artisans-workshop.Event.Resume",
    retry: "pf2e-artisans-workshop.Event.Retry",
    finish: "pf2e-artisans-workshop.Event.Finish",
    cancel: "pf2e-artisans-workshop.Event.Cancel",
    undo: "pf2e-artisans-workshop.Event.Undo",
    // M9a (6.16): a Deconstruct that made components, a quest assembled or delivered.
    deconstruct: "pf2e-artisans-workshop.Event.Deconstruct",
    assemble: "pf2e-artisans-workshop.Event.Assemble",
    // M9a (6.16.4): a critical failure whose item is made anyway (review fix of M9a).
    made: "pf2e-artisans-workshop.Event.Made",
    other: "pf2e-artisans-workshop.Event.Other",
});

/* -------------------------------------------- */
/*  Downtime (M6)                                */
/* -------------------------------------------- */

/** Why a day plan stopped (`planDays`): what the day resolver, the wizard and the day card say, with what to do next. */
export const DAY_STOP = Object.freeze({
    locked: "pf2e-artisans-workshop.DayStop.Locked",
    sitting: "pf2e-artisans-workshop.DayStop.Sitting",
    "no-order": "pf2e-artisans-workshop.DayStop.NoOrder",
    "order-state": "pf2e-artisans-workshop.DayStop.OrderState",
    check: "pf2e-artisans-workshop.DayStop.Check",
    settle: "pf2e-artisans-workshop.DayStop.Settle",
    "paid-off": "pf2e-artisans-workshop.DayStop.PaidOff",
    "not-helping": "pf2e-artisans-workshop.DayStop.NotHelping",
    "not-subject": "pf2e-artisans-workshop.DayStop.NotSubject",
    "no-job": "pf2e-artisans-workshop.DayStop.NoJob",
    "job-ended": "pf2e-artisans-workshop.DayStop.JobEnded",
    "income-check": "pf2e-artisans-workshop.DayStop.IncomeCheck",
    // M9a (6.16.1, 6.16.3).
    event: "pf2e-artisans-workshop.DayStop.Event",
    "event-due": "pf2e-artisans-workshop.DayStop.EventDue",
    "setup-hours": "pf2e-artisans-workshop.DayStop.SetupHours",
    // M10 (12.2): an extension's downtime activity.
    "ext-unknown": "pf2e-artisans-workshop.DayStop.ExtUnknown",
    "ext-ineligible": "pf2e-artisans-workshop.DayStop.ExtIneligible",
    "ext-check": "pf2e-artisans-workshop.DayStop.ExtCheck",
    "ext-aid-check": "pf2e-artisans-workshop.DayStop.ExtAidCheck",
    other: "pf2e-artisans-workshop.DayStop.Other",
});

/** Activities (4.8) as the Downtime tab and the wizard name them; craft, help and earn name their order or job. */
export const ACTIVITY = Object.freeze({
    craft: "pf2e-artisans-workshop.Activity.Craft",
    help: "pf2e-artisans-workshop.Activity.Help",
    earn: "pf2e-artisans-workshop.Activity.Earn",
    subject: "pf2e-artisans-workshop.Activity.Subject",
    subsist: "pf2e-artisans-workshop.Activity.Subsist",
    retrain: "pf2e-artisans-workshop.Activity.Retrain",
    other: "pf2e-artisans-workshop.Activity.Other",
    formula: "pf2e-artisans-workshop.Activity.Other",
    "prep-only": "pf2e-artisans-workshop.Activity.Other",
    ext: "pf2e-artisans-workshop.Activity.Other",
    none: "pf2e-artisans-workshop.Activity.None",
    "not-downtime": "pf2e-artisans-workshop.Activity.NotDowntime",
    skip: "pf2e-artisans-workshop.Activity.Skip",
});

/** Why a PC may not help on an order (6.7 `helperEligibility`). */
export const HELPER_REASON = Object.freeze({
    "no-feat": "pf2e-artisans-workshop.Helper.Reason.NoFeat",
    "not-pc": "pf2e-artisans-workshop.Helper.Reason.NotPc",
    untrained: "pf2e-artisans-workshop.Helper.Reason.Untrained",
    "irrelevant-skill": "pf2e-artisans-workshop.Helper.Reason.IrrelevantSkill",
    locked: "pf2e-artisans-workshop.Helper.Reason.Locked",
    cap: "pf2e-artisans-workshop.Helper.Reason.Cap",
});

/** Earn Income job states (4.9): a word and an icon each. */
export const JOB_STATUS = Object.freeze({
    open: { key: "pf2e-artisans-workshop.Job.Status.Open", icon: "fa-solid fa-briefcase" },
    ended: { key: "pf2e-artisans-workshop.Job.Status.Ended", icon: "fa-solid fa-flag-checkered" },
    fired: { key: "pf2e-artisans-workshop.Job.Status.Fired", icon: "fa-solid fa-door-open" },
});

/** Settlement sizes (GM Core p.53). */
export const SETTLEMENT_SIZE = Object.freeze({
    village: "pf2e-artisans-workshop.Settlement.Size.Village",
    town: "pf2e-artisans-workshop.Settlement.Size.Town",
    city: "pf2e-artisans-workshop.Settlement.Size.City",
    metropolis: "pf2e-artisans-workshop.Settlement.Size.Metropolis",
});

/** Quest threats (6.16.9, TV-R p.172). */
export const THREAT = Object.freeze({
    low: "pf2e-artisans-workshop.Variant.Quest.Threat.Low",
    moderate: "pf2e-artisans-workshop.Variant.Quest.Threat.Moderate",
    severe: "pf2e-artisans-workshop.Variant.Quest.Threat.Severe",
});

/** Critical Crafting's categories (6.16.4): the author's own words, no book text. */
export const CRITICAL_CATEGORY = Object.freeze({
    "success.intelligent": "pf2e-artisans-workshop.Variant.Critical.Category.Intelligent",
    "success.beyond-level": "pf2e-artisans-workshop.Variant.Critical.Category.BeyondLevel",
    "success.minor-ability": "pf2e-artisans-workshop.Variant.Critical.Category.MinorAbility",
    "success.durable": "pf2e-artisans-workshop.Variant.Critical.Category.Durable",
    "success.beautiful": "pf2e-artisans-workshop.Variant.Critical.Category.Beautiful",
    "success.distracting": "pf2e-artisans-workshop.Variant.Critical.Category.Distracting",
    "success.relic": "pf2e-artisans-workshop.Variant.Critical.Category.Relic",
    "success.other": "pf2e-artisans-workshop.Variant.Critical.Category.Other",
    "failure.secret-curse": "pf2e-artisans-workshop.Variant.Critical.Category.SecretCurse",
    "failure.life-drain": "pf2e-artisans-workshop.Variant.Critical.Category.LifeDrain",
    "failure.lasting-harm": "pf2e-artisans-workshop.Variant.Critical.Category.LastingHarm",
    "failure.malevolent": "pf2e-artisans-workshop.Variant.Critical.Category.Malevolent",
    "failure.fails-in-use": "pf2e-artisans-workshop.Variant.Critical.Category.FailsInUse",
    "failure.crafter-cursed": "pf2e-artisans-workshop.Variant.Critical.Category.CrafterCursed",
    "failure.pollution": "pf2e-artisans-workshop.Variant.Critical.Category.Pollution",
    "failure.other": "pf2e-artisans-workshop.Variant.Critical.Category.Other",
});

/** What a rushed finish's flat check or a quest's assembly did to the item (6.16.1, 6.16.9). */
export const ITEM_OUTCOME = Object.freeze({
    fine: "pf2e-artisans-workshop.Variant.Outcome.Fine",
    deliver: "pf2e-artisans-workshop.Variant.Outcome.Fine",
    quirk: "pf2e-artisans-workshop.Variant.Outcome.Quirk",
    ruined: "pf2e-artisans-workshop.Variant.Outcome.Ruined",
    cursed: "pf2e-artisans-workshop.Variant.Outcome.Cursed",
    destroyed: "pf2e-artisans-workshop.Variant.Outcome.Destroyed",
});
