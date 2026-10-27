/**
 * The macro catalogue (DESIGN.md 11.1, M11). Pure: each macro's id, its number in 11.1, the API member it calls and its
 * arguments with their defaults, which arguments it needs, the feature it belongs to, and its icons; and the one line of
 * script a macro holds (`macroCommand`), which is the same line in a hotbar macro made from the shelf and in the copy-paste
 * file `macros/<id>.js`.
 *
 * Every macro is one call, `api.macros.run(id, args)`: it calls the API member the catalogue names with the arguments, and
 * reports a refusal (or "already done") to the user, which a bare API call leaves to its caller. A macro run without an
 * argument it needs does what its 11.1 row says it does then: it opens the form, the tab or the question that asks for it
 * (`interactive`), rather than refusing. Names, hints and who may use each are i18n keys (`nameKey`, `hintKey`,
 * `whoKey`), written out in full so the key check can see them.
 */

/** The groups of the shelf, in order. */
export const MACRO_GROUPS = Object.freeze(["workshop", "funds", "downtime", "morning", "combat", "afflictions"]);

/** The heading of each group. */
export const GROUP_KEY = Object.freeze({
    workshop: "pf2e-artisans-workshop.Macro.Group.Workshop",
    funds: "pf2e-artisans-workshop.Macro.Group.Funds",
    downtime: "pf2e-artisans-workshop.Macro.Group.Downtime",
    morning: "pf2e-artisans-workshop.Macro.Group.Morning",
    combat: "pf2e-artisans-workshop.Macro.Group.Combat",
    afflictions: "pf2e-artisans-workshop.Macro.Group.Afflictions",
});

/** Who a macro is for (11.1's "Who" column). */
export const WHO_KEY = Object.freeze({
    anyone: "pf2e-artisans-workshop.Macro.Who.Anyone",
    crafter: "pf2e-artisans-workshop.Macro.Who.Crafter",
    owner: "pf2e-artisans-workshop.Macro.Who.Owner",
    alchemist: "pf2e-artisans-workshop.Macro.Who.Alchemist",
});

/**
 * The 23 macros of 11.1. `call` is the API member (`namespace.member`); `args` the arguments a macro passes, with their
 * defaults (null: not given); `required` the arguments without which the macro asks instead (`interactive`); `feature` the
 * world setting that hides it from the shelf while off (null: always shown); `icon` a Font Awesome class for the shelf's
 * tile and `img` a Foundry core icon for the hotbar macro (P14).
 */
export const MACROS = Object.freeze([
    { id: "open-workshop", no: 1, group: "workshop", who: "anyone", feature: null, call: "ui.open",
        args: { tab: "queue", actor: null, filter: null }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.OpenWorkshop.Name", hintKey: "pf2e-artisans-workshop.Macro.OpenWorkshop.Hint",
        icon: "fa-solid fa-hammer", img: "icons/svg/house.svg" },
    { id: "request-item", no: 2, group: "workshop", who: "anyone", feature: null, call: "orders.request",
        args: { uuid: null, quantity: 1, recipient: null, crafter: null, note: "" }, required: ["uuid"],
        nameKey: "pf2e-artisans-workshop.Macro.RequestItem.Name", hintKey: "pf2e-artisans-workshop.Macro.RequestItem.Hint",
        icon: "fa-solid fa-plus", img: "icons/svg/item-bag.svg" },
    { id: "pledge", no: 3, group: "funds", who: "anyone", feature: null, call: "funds.pledge",
        args: { order: null, amount: null, from: null }, required: ["order", "amount"],
        nameKey: "pf2e-artisans-workshop.Macro.Pledge.Name", hintKey: "pf2e-artisans-workshop.Macro.Pledge.Hint",
        icon: "fa-solid fa-coins", img: "icons/svg/coins.svg" },
    { id: "roll-craft", no: 4, group: "workshop", who: "crafter", feature: null, call: "orders.rollCheck",
        args: { order: null, actor: null }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.RollCraft.Name", hintKey: "pf2e-artisans-workshop.Macro.RollCraft.Hint",
        icon: "fa-solid fa-dice-d20", img: "icons/svg/d20.svg" },
    { id: "finish-order", no: 5, group: "workshop", who: "crafter", feature: null, call: "orders.finish",
        args: { order: null }, required: ["order"],
        nameKey: "pf2e-artisans-workshop.Macro.FinishOrder.Name", hintKey: "pf2e-artisans-workshop.Macro.FinishOrder.Hint",
        icon: "fa-solid fa-flag-checkered", img: "icons/svg/upgrade.svg" },
    { id: "take-deliveries", no: 6, group: "funds", who: "anyone", feature: null, call: "funds.claimAll",
        args: { actor: null }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.TakeDeliveries.Name", hintKey: "pf2e-artisans-workshop.Macro.TakeDeliveries.Hint",
        icon: "fa-solid fa-hand-holding", img: "icons/svg/chest.svg" },
    { id: "morning", no: 7, group: "morning", who: "owner", feature: "features.morning", call: "prep.open",
        args: { actor: null, loadout: null, apply: false }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.Morning.Name", hintKey: "pf2e-artisans-workshop.Macro.Morning.Hint",
        icon: "fa-solid fa-sun", img: "icons/svg/sun.svg" },
    { id: "resolve-downtime", no: 8, group: "downtime", who: "owner", feature: "features.downtime", call: "downtime.resolve",
        args: { actor: null }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.ResolveDowntime.Name", hintKey: "pf2e-artisans-workshop.Macro.ResolveDowntime.Hint",
        icon: "fa-solid fa-calendar-check", img: "icons/svg/clockwork.svg" },
    { id: "advance-days", no: 9, group: "downtime", who: "anyone", feature: "features.downtime", call: "downtime.advance",
        args: { days: 1, advanceClock: false }, required: [], wizard: true,
        nameKey: "pf2e-artisans-workshop.Macro.AdvanceDays.Name", hintKey: "pf2e-artisans-workshop.Macro.AdvanceDays.Hint",
        icon: "fa-solid fa-forward-fast", img: "icons/svg/wingfoot.svg" },
    { id: "earn-income", no: 10, group: "downtime", who: "owner", feature: "features.income", call: "income.start",
        args: { actor: null, skill: null, taskLevel: null }, required: ["skill"],
        nameKey: "pf2e-artisans-workshop.Macro.EarnIncome.Name", hintKey: "pf2e-artisans-workshop.Macro.EarnIncome.Hint",
        icon: "fa-solid fa-sack-dollar", img: "icons/svg/tankard.svg" },
    { id: "learn-formula", no: 11, group: "workshop", who: "owner", feature: "features.formulas", call: "formulas.acquire",
        args: { uuid: null, route: null, actor: null, from: null }, required: ["uuid", "route"],
        nameKey: "pf2e-artisans-workshop.Macro.LearnFormula.Name", hintKey: "pf2e-artisans-workshop.Macro.LearnFormula.Hint",
        icon: "fa-solid fa-book-open", img: "icons/svg/book.svg" },
    { id: "quick-alchemy", no: 12, group: "combat", who: "alchemist", feature: "features.combat", call: "alchemy.quickAlchemy",
        args: { actor: null, uuid: null, second: null, additive: null, then: "hand" }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.QuickAlchemy.Name", hintKey: "pf2e-artisans-workshop.Macro.QuickAlchemy.Hint",
        icon: "fa-solid fa-flask", img: "icons/svg/acid.svg" },
    { id: "quick-bomb", no: 13, group: "combat", who: "alchemist", feature: "features.combat", call: "alchemy.quickBomb",
        args: { actor: null, family: null, damageType: null, createIfNone: true }, required: ["family"],
        nameKey: "pf2e-artisans-workshop.Macro.QuickBomb.Name", hintKey: "pf2e-artisans-workshop.Macro.QuickBomb.Hint",
        icon: "fa-solid fa-bomb", img: "icons/svg/explosion.svg" },
    { id: "quick-vial", no: 14, group: "combat", who: "alchemist", feature: "features.combat", call: "alchemy.quickVial",
        args: { actor: null, damageType: null, material: null }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.QuickVial.Name", hintKey: "pf2e-artisans-workshop.Macro.QuickVial.Hint",
        icon: "fa-solid fa-vial", img: "icons/svg/fire.svg" },
    { id: "healing-bomb", no: 15, group: "combat", who: "alchemist", feature: "features.combat", call: "alchemy.healingBomb",
        args: { actor: null, grade: "best", target: null }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.HealingBomb.Name", hintKey: "pf2e-artisans-workshop.Macro.HealingBomb.Hint",
        icon: "fa-solid fa-heart-pulse", img: "icons/svg/heal.svg" },
    { id: "gather-reagents", no: 16, group: "combat", who: "alchemist", feature: "features.combat", call: "alchemy.gatherReagents",
        args: { actor: null, minutes: 10 }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.GatherReagents.Name", hintKey: "pf2e-artisans-workshop.Macro.GatherReagents.Hint",
        icon: "fa-solid fa-leaf", img: "icons/svg/oak.svg" },
    { id: "improvise-admixture", no: 17, group: "combat", who: "alchemist", feature: "features.combat", call: "alchemy.improviseAdmixture",
        args: { actor: null }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.ImproviseAdmixture.Name", hintKey: "pf2e-artisans-workshop.Macro.ImproviseAdmixture.Hint",
        icon: "fa-solid fa-mortar-pestle", img: "icons/svg/pill.svg" },
    { id: "affix-talismans", no: 18, group: "morning", who: "owner", feature: "features.morning", call: "prep.affixBoard",
        args: { actor: null }, required: [], opens: "morning",
        nameKey: "pf2e-artisans-workshop.Macro.AffixTalismans.Name", hintKey: "pf2e-artisans-workshop.Macro.AffixTalismans.Hint",
        icon: "fa-solid fa-gem", img: "icons/svg/holy-shield.svg" },
    { id: "post-summary", no: 19, group: "workshop", who: "anyone", feature: null, call: "orders.postSummary",
        args: { whisper: true }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.PostSummary.Name", hintKey: "pf2e-artisans-workshop.Macro.PostSummary.Hint",
        icon: "fa-solid fa-scroll", img: "icons/svg/hanging-sign.svg" },
    { id: "use-best", no: 20, group: "combat", who: "anyone", feature: "features.consumables", call: "consumables.useBest",
        args: { family: null, actor: null, partyWide: false }, required: ["family"],
        nameKey: "pf2e-artisans-workshop.Macro.UseBest.Name", hintKey: "pf2e-artisans-workshop.Macro.UseBest.Hint",
        icon: "fa-solid fa-hand-sparkles", img: "icons/svg/regen.svg" },
    { id: "apply-poison", no: 21, group: "afflictions", who: "owner", feature: "features.afflictions", call: "afflictions.applyPoison",
        args: { poison: null, weapon: null, actor: null }, required: ["poison", "weapon"],
        nameKey: "pf2e-artisans-workshop.Macro.ApplyPoison.Name", hintKey: "pf2e-artisans-workshop.Macro.ApplyPoison.Hint",
        icon: "fa-solid fa-droplet", img: "icons/svg/poison.svg" },
    { id: "expose", no: 22, group: "afflictions", who: "anyone", feature: "features.afflictions", call: "afflictions.expose",
        args: { item: null, targets: "targeted", delivery: null, dc: null }, required: ["item"],
        nameKey: "pf2e-artisans-workshop.Macro.Expose.Name", hintKey: "pf2e-artisans-workshop.Macro.Expose.Hint",
        icon: "fa-solid fa-skull-crossbones", img: "icons/svg/biohazard.svg" },
    { id: "roll-pending", no: 23, group: "afflictions", who: "owner", feature: "features.afflictions", call: "afflictions.rollPending",
        args: { actor: null }, required: [],
        nameKey: "pf2e-artisans-workshop.Macro.RollPending.Name", hintKey: "pf2e-artisans-workshop.Macro.RollPending.Hint",
        icon: "fa-solid fa-dice", img: "icons/svg/d20-grey.svg" },
]);

/** A catalogue entry by id, or null. */
export const macroById = (id) => MACROS.find((m) => m.id === id) ?? null;

/** Whether `value` counts as given: not null, not undefined, not an empty string. */
const given = (value) => value !== null && value !== undefined && value !== "";

/**
 * The arguments a run uses: the catalogue's defaults with the given ones over them. Keys the catalogue does not name are
 * kept too (an API member may take more than the macro shows, `skipDialog` for one).
 */
export function macroArgs(entry, args = {}) {
    return { ...entry.args, ...Object.fromEntries(Object.entries(args ?? {}).filter(([, v]) => v !== undefined)) };
}

/** The required arguments a run lacks: the macro then asks for them (`interactive`) instead of calling the API. */
export function missingArgs(entry, args = {}) {
    return entry.required.filter((key) => !given(args?.[key]));
}

/** An identifier a key can be written as without quotes. */
const BARE = /^[A-Za-z_$][\w$]*$/;

/** A value as JavaScript source: JSON for strings, numbers, booleans and null; an object's keys bare where they can be. */
function source(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const parts = Object.entries(value).map(([k, v]) => `${BARE.test(k) ? k : JSON.stringify(k)}: ${source(v)}`);
        return parts.length ? `{ ${parts.join(", ")} }` : "{}";
    }
    return JSON.stringify(value ?? null);
}

/**
 * The one line of script a macro holds: `macros.run` with its id and arguments. Optional chaining stops the whole line
 * when the module is not active or its API is not published yet, so a hotbar slot never throws. The module id is a
 * parameter so the line stays pure.
 */
export function macroCommand(entry, moduleId, args = entry.args) {
    return `game.modules.get(${JSON.stringify(moduleId)})?.api?.macros.run(${JSON.stringify(entry.id)}, ${source(args)});`;
}

/** The documented API call a macro stands for, as shown on its tile and in 11.1: `api.funds.pledge({ order: null, ... })`. */
export function apiCallText(entry, args = entry.args) {
    return `api.${entry.call}(${source(args)})`;
}

/**
 * The copy-paste file of a macro (`macros/<id>.js`): a comment naming it and its arguments, then the line a hotbar macro
 * holds. The comment is for the reader of the file, not the interface, so it is plain English like the code's.
 */
export function macroFile(entry, moduleId) {
    const needs = entry.required.length ? ` Without ${entry.required.join(" and ")} it asks for ${entry.required.length > 1 ? "them" : "it"}.` : "";
    return [
        `// Artisan's Workshop macro ${entry.no}: ${entry.id} (DESIGN.md 11.1). Runs ${apiCallText(entry)}.${needs}`,
        "// Change the arguments below; null means not given. Paste into a script macro, or drag the tile from the Workshop's macro shelf.",
        macroCommand(entry, moduleId),
        "",
    ].join("\n");
}

/** The catalogue grouped for the shelf: `[{group, macros}]`, without the macros whose feature `isOn` says is off. */
export function shelfGroups(isOn = () => true) {
    return MACRO_GROUPS.map((group) => ({ group, macros: MACROS.filter((m) => m.group === group && (!m.feature || isOn(m.feature))) }))
        .filter((g) => g.macros.length > 0);
}
