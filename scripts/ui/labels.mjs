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
    checklist: "pf2e-artisans-workshop.Gate.Checklist",
    spells: "pf2e-artisans-workshop.Gate.Spells",
    "target-not-held": "pf2e-artisans-workshop.Gate.TargetNotHeld",
    "no-consent": "pf2e-artisans-workshop.Gate.NoConsent",
    "subject-not-locked": "pf2e-artisans-workshop.Gate.SubjectNotLocked",
    locked: "pf2e-artisans-workshop.Gate.Locked",
    artifact: "pf2e-artisans-workshop.Gate.Artifact",
    "no-price": "pf2e-artisans-workshop.Gate.NoPrice",
    quantity: "pf2e-artisans-workshop.Gate.Quantity",
    other: "pf2e-artisans-workshop.Gate.Other",
});

/** Tools a Craft needs (G7). */
export const TOOL = Object.freeze({
    "alchemists-lab": "pf2e-artisans-workshop.Tool.AlchemistsLab",
    "artisans-toolkit": "pf2e-artisans-workshop.Tool.ArtisansToolkit",
    "snare-toolkit": "pf2e-artisans-workshop.Tool.SnareToolkit",
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
    taken: "pf2e-artisans-workshop.Refusal.Conflict",
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
    carry: "pf2e-artisans-workshop.Row.Carry",
    adjust: "pf2e-artisans-workshop.Row.Adjust",
    reversal: "pf2e-artisans-workshop.Row.Reversal",
    // How the ledger names an allocation by its direction, and an order's item kept in the strongbox (`rowLabel`, M4.1).
    earmark: "pf2e-artisans-workshop.Row.Earmark",
    unearmark: "pf2e-artisans-workshop.Row.Unearmark",
    kept: "pf2e-artisans-workshop.Row.Kept",
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
});

/** Formula routes (4.3). */
export const ROUTE = Object.freeze({
    known: "pf2e-artisans-workshop.Route.Known",
    family: "pf2e-artisans-workshop.Route.Family",
    virtual: "pf2e-artisans-workshop.Route.Virtual",
    none: "pf2e-artisans-workshop.Route.None",
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
