/**
 * The macro catalogue (DESIGN.md 11.1, M11) and what the sheet entries show (10.4): pure, from plain records. The catalogue
 * holds every macro of 11.1 once, in order, each with its API call and arguments; its one line of script parses and calls
 * `macros.run`; a run's arguments and what it lacks; the shelf's groups without a feature that is off; and every key it
 * names is in `lang/en.json`. The Crafting tab strip and the Party card count what they say, a gift hidden from its
 * recipient included.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../helpers.mjs";
import {
    GROUP_KEY, MACROS, MACRO_GROUPS, WHO_KEY, apiCallText, macroArgs, macroById, macroCommand, macroFile, missingArgs, shelfGroups,
} from "../../scripts/logic/macros.mjs";
import { finishableOrders, nextCheckOrder, partyCardView, stripView, summaryLines } from "../../scripts/logic/entry.mjs";

const MOD = "pf2e-artisans-workshop";
const lang = JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"));

/** 11.1's table: number, the API member it calls, and the arguments it marks required. */
const DESIGN = [
    [1, "ui.open", []], [2, "orders.request", ["uuid"]], [3, "funds.pledge", ["order", "amount"]], [4, "orders.rollCheck", []],
    [5, "orders.finish", ["order"]], [6, "funds.claimAll", []], [7, "prep.open", []], [8, "downtime.resolve", []], [9, "downtime.advance", []],
    [10, "income.start", ["skill"]], [11, "formulas.acquire", ["uuid", "route"]], [12, "alchemy.quickAlchemy", []], [13, "alchemy.quickBomb", ["family"]],
    [14, "alchemy.quickVial", []], [15, "alchemy.healingBomb", []], [16, "alchemy.gatherReagents", []], [17, "alchemy.improviseAdmixture", []],
    [18, "prep.affixBoard", []], [19, "orders.postSummary", []], [20, "consumables.useBest", ["family"]], [21, "afflictions.applyPoison", ["poison", "weapon"]],
    [22, "afflictions.expose", ["item"]], [23, "afflictions.rollPending", []],
];

test("the catalogue holds the 23 macros of 11.1 once each, in order, with their calls and required arguments", () => {
    assert.equal(MACROS.length, 23);
    assert.deepEqual(MACROS.map((m) => [m.no, m.call, m.required]), DESIGN);
    assert.equal(new Set(MACROS.map((m) => m.id)).size, 23, "ids are unique");
    for (const m of MACROS) {
        assert.match(m.id, /^[a-z]+(-[a-z]+)*$/, m.id);
        assert.ok(MACRO_GROUPS.includes(m.group), m.id);
        assert.ok(WHO_KEY[m.who], m.id);
        for (const key of m.required) assert.ok(key in m.args, `${m.id} names its required ${key} among its arguments`);
        assert.match(m.icon, /^fa-solid fa-[a-z0-9-]+$/, m.id);
        assert.match(m.img, /^icons\/svg\/[a-z0-9-]+\.svg$/, `${m.id}: a Foundry core icon (P14)`);
    }
    assert.equal(macroById("pledge").no, 3);
    assert.equal(macroById("nope"), null);
});

test("every name, hint, group and who of the catalogue is a key of lang/en.json", () => {
    const keys = [...MACROS.flatMap((m) => [m.nameKey, m.hintKey]), ...Object.values(GROUP_KEY), ...Object.values(WHO_KEY)];
    assert.deepEqual(keys.filter((key) => !(key in lang)), []);
});

test("a macro is one line that calls macros.run with its id and arguments, and stops quietly without the module", () => {
    const pledge = macroById("pledge");
    const line = macroCommand(pledge, MOD);
    assert.equal(line, `game.modules.get("${MOD}")?.api?.macros.run("pledge", { order: null, amount: null, from: null });`);
    assert.ok(!line.includes("\n"));
    assert.equal(macroCommand(pledge, MOD, { order: "o1", amount: "20 gp" }), `game.modules.get("${MOD}")?.api?.macros.run("pledge", { order: "o1", amount: "20 gp" });`);
    assert.equal(apiCallText(macroById("open-workshop")), "api.ui.open({ tab: \"queue\", actor: null, filter: null })");
    // Each line is valid JavaScript, and with no module (or no API yet) it does nothing and throws nothing.
    for (const m of MACROS) {
        const run = new Function("game", macroCommand(m, MOD));
        assert.doesNotThrow(() => run({ modules: new Map() }), m.id);
        assert.doesNotThrow(() => run({ modules: new Map([[MOD, {}]]) }), `${m.id} before ready`);
        const calls = [];
        run({ modules: new Map([[MOD, { api: { macros: { run: (...args) => calls.push(args) } } }]]) });
        assert.deepEqual(calls, [[m.id, m.args]], m.id);
    }
});

test("a run's arguments are the catalogue's defaults under the given ones; what it lacks is what it asks for", () => {
    const pledge = macroById("pledge");
    assert.deepEqual(macroArgs(pledge, { order: "o1", skipDialog: true }), { order: "o1", amount: null, from: null, skipDialog: true });
    assert.deepEqual(macroArgs(pledge, { order: undefined }), pledge.args, "undefined is not given");
    assert.deepEqual(missingArgs(pledge, macroArgs(pledge)), ["order", "amount"]);
    assert.deepEqual(missingArgs(pledge, { order: "o1", amount: "" }), ["amount"], "an empty string is not given");
    assert.deepEqual(missingArgs(pledge, { order: "o1", amount: 0 }), [], "zero is given (the API refuses it)");
    assert.deepEqual(missingArgs(macroById("open-workshop"), {}), []);
});

test("the copy-paste file names the macro and its call, then holds the hotbar's line", () => {
    const file = macroFile(macroById("apply-poison"), MOD);
    const lines = file.split("\n");
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^\/\/ Artisan's Workshop macro 21: apply-poison \(DESIGN\.md 11\.1\)\. Runs api\.afflictions\.applyPoison\(/);
    assert.match(lines[0], /Without poison and weapon it asks for them\.$/);
    assert.equal(lines[2], macroCommand(macroById("apply-poison"), MOD));
    assert.equal(lines[3], "");
    assert.doesNotMatch(macroFile(macroById("open-workshop"), MOD), /Without/);
});

test("the shelf's groups follow the catalogue's order and leave out a feature that is off", () => {
    const all = shelfGroups();
    assert.deepEqual(all.map((g) => g.group), MACRO_GROUPS);
    assert.equal(all.flatMap((g) => g.macros).length, 23);
    const noCombat = shelfGroups((feature) => feature !== "features.combat");
    assert.equal(noCombat.flatMap((g) => g.macros).filter((m) => m.feature === "features.combat").length, 0);
    assert.ok(noCombat.find((g) => g.group === "combat").macros.some((m) => m.id === "use-best"), "Use best is its own feature, not combat's");
    const none = shelfGroups((feature) => feature === null);
    assert.deepEqual(none.map((g) => g.group), ["workshop", "funds"], "a group with nothing left is left out");
});

/* -------------------------------------------- */
/*  The sheet entries                            */
/* -------------------------------------------- */

const order = (id, fields) => ({ id, status: "requested", quantity: 1, crafter: null, recipient: { kind: "actor", uuid: "Actor.b" }, visibility: "public",
    product: { snapshot: { name: `Item ${id}` } }, ...fields });

test("the strip counts the character's work, what waits on it, what was filed for it (no gift it must not see), and the rest", () => {
    const orders = [
        order("o1", { crafter: "Actor.a", status: "setup" }),
        order("o2", { crafter: "Actor.a", status: "check" }),
        order("o3", { crafter: "Actor.a", status: "rolled" }),
        order("o4", { crafter: "Actor.a", status: "complete" }),
        order("o5", { crafter: "Actor.a", status: "accepted" }),
        order("o6", { recipient: { kind: "actor", uuid: "Actor.a" } }),
        order("o7", { recipient: { kind: "actor", uuid: "Actor.a" }, visibility: "gift" }),
        order("o8", { recipient: { kind: "actor", uuid: "Actor.a" }, status: "cancelled" }),
        order("o9", { crafter: "Actor.b", status: "check" }),
    ];
    assert.deepEqual(stripView(orders, "Actor.a", { shelf: 2, pendingDays: 3, morningWaiting: true }),
        { crafting: 4, due: 2, forYou: 1, shelf: 2, pendingDays: 3, morningWaiting: true, empty: false });
    assert.equal(stripView([], "Actor.a").empty, true);
    assert.equal(stripView(orders, "Actor.c").empty, true);
});

test("the Party card counts open orders, those with no crafter, those being crafted and the finished ones", () => {
    const orders = [order("o1"), order("o2", { crafter: "Actor.a" }), order("o3", { crafter: "Actor.a", status: "finishing" }),
        order("o4", { status: "complete" }), order("o5", { status: "archived" }), order("o6", { status: "accepted", crafter: "Actor.a" })];
    assert.deepEqual(partyCardView(orders, { shelf: 1 }), { open: 4, unclaimed: 1, working: 1, complete: 1, shelf: 1 });
});

test("the queue summary lists open orders in filing order, a gift's name only for those who may see it", () => {
    const numbered = [{ order: order("o1"), no: 1 }, { order: order("o2", { visibility: "gift", crafter: "Actor.c" }), no: 2 },
        { order: order("o3", { status: "complete" }), no: 3 }, { order: order("o4", { recipient: { kind: "strongbox" }, quantity: 4 }), no: 4 }];
    const lines = summaryLines(numbered);
    assert.deepEqual(lines.map((l) => [l.no, l.name, l.quantity, l.toStrongbox]), [[1, "Item o1", 1, false], [2, null, 1, false], [4, "Item o4", 4, true]]);
    assert.equal(summaryLines(numbered, () => true)[1].name, "Item o2");
});

test("Roll Craft check and Finish order find the crafter's order when none is named", () => {
    const numbered = [order("o1", { crafter: "Actor.b", status: "check" }), order("o2", { crafter: "Actor.a", status: "setup" }),
        order("o3", { crafter: "Actor.a", status: "check" }), order("o4", { crafter: "Actor.a", status: "check" }),
        order("o5", { crafter: "Actor.a", status: "rolled" }), order("o6", { crafter: "Actor.a", status: "finishing" })].map((o, i) => ({ order: o, no: i + 1 }));
    assert.equal(nextCheckOrder(numbered, "Actor.a").id, "o3", "the oldest waiting for its check");
    assert.equal(nextCheckOrder(numbered, "Actor.z"), null);
    assert.deepEqual(finishableOrders(numbered, "Actor.a").map((o) => o.id), ["o5", "o6"]);
});
