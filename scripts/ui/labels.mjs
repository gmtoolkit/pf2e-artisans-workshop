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
    resumable: "pf2e-artisans-workshop.Refusal.Resumable",
    // M5: formulas, pledges, custody and services.
    known: "pf2e-artisans-workshop.Refusal.Known",
    pending: "pf2e-artisans-workshop.Refusal.Pending",
    "no-route": "pf2e-artisans-workshop.Refusal.NoRoute",
    needs: "pf2e-artisans-workshop.Refusal.NeedsSeller",
    "no-pick": "pf2e-artisans-workshop.Refusal.NoPick",
    "no-actor": "pf2e-artisans-workshop.Refusal.NoActor",
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
    other: "pf2e-artisans-workshop.Event.Other",
});
