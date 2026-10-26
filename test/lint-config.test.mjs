/**
 * The ESLint rules of DESIGN.md 15.1 do what they claim: each banned pattern is reported in module
 * code, and the allowed forms pass.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";
import { ROOT } from "./helpers.mjs";

const eslint = new ESLint({ cwd: ROOT });

/** Messages ESLint reports for `code` as if it were at `file` in the repository. */
async function lint(code, file = "scripts/example.mjs") {
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
    return result.messages.map((message) => `${message.ruleId}: ${message.message}`);
}

const reports = async (code, pattern, file) => {
    const messages = await lint(code, file);
    assert.ok(messages.some((message) => pattern.test(message)), `${code}\n  got: ${messages.join("\n  ")}`);
};

test("allowed module code passes", async () => {
    const code = [
        'import { MODULE_ID } from "./constants.mjs";',
        'const actor = game.actors.get("a");',
        'const html = await foundry.applications.handlebars.renderTemplate("modules/x/a.hbs", {});',
        'ui.notifications.info(game.i18n.localize("pf2e-artisans-workshop.Queue.Started"));',
        'ui.notifications.warn("pf2e-artisans-workshop.Queue.Blocked", { localize: true });',
        'ui.notifications.info("PF2E.UI.Example", { format: { name: actor.name } });',
        'ui.notifications.notify(_loc("pf2e-artisans-workshop.Queue.Started"), "warning");',
        'game.settings.register(MODULE_ID, "x", { name: "pf2e-artisans-workshop.Settings.X.Name", hint: "", type: Boolean });',
        'const field = { name: "quantity", label: "PF2E.TraitFire", tooltip: "COMMON.Cancel" };',
        'Hooks.callAll(`${MODULE_ID}.ready`, field);',
        'await actor.update({ [`flags.${MODULE_ID}.orders.abc`]: _del });',
        "if (foundry.utils.isElementInstanceOf(html, \"HTMLElement\")) console.log(html.ownerDocument.defaultView);",
        "const later = foundry.utils.debounce(() => {}, 50);",
        "later();",
    ].join("\n");
    assert.deepEqual(await lint(code), []);
});

test("deprecated Foundry globals, jQuery, libWrapper and socketlib are undefined", async () => {
    const names = [
        "renderTemplate", "loadTemplates", "getTemplate", "ActorSheet", "ItemSheet", "FilePicker", "ContextMenu",
        "DragDrop", "TextEditor", "Dialog", "Application", "FormApplication", "DocumentSheet",
        "MeasuredTemplateDocument", "duplicate", "$", "jQuery", "libWrapper", "socketlib", "requestAnimationFrame",
    ];
    for (const file of ["scripts/example.mjs", "tools/harness/example.mjs", "macros/example.js"]) {
        for (const name of names) await reports(`${name}();`, new RegExp(`no-undef: '${RegExp.escape(name)}' is not defined`), file);
    }
    await reports("foundry.appv1.api.Application;", /no-restricted-properties: .*Application V1/);
});

test("the game socket is out of reach, however it is written; only watching the connection is allowed", async () => {
    const banned = [
        'game.socket.emit("x");',
        'game.socket.on("module.pf2e-artisans-workshop", () => {});',
        "game.socket.on(event, () => {});",
        'game.socket.off("module.pf2e-artisans-workshop");',
        "const socket = game.socket;",
        "send(game.socket);",
        'game.socket?.timeout(5).emit("x");',
        'game?.socket.emit("x");',
        'game.socket["emit"]("x");',
        'game.socket.io.engine.close();',
        "const on = game.socket.on;",
        "game.socket.connected = false;",
        'const { socket } = game;\nsocket.emit("x");',
        'const { socket: s } = game;\ns.emit("x");',
        'const { ["socket"]: s } = game;\ns.emit("x");',
        'let s;\n({ socket: s } = game);\ns.emit("x");',
        'function send({ socket } = game) { socket.emit("x"); }\nsend();',
        'game["socket"].emit("x");',
        'game["socket"].on("disconnect", () => {});',
        'game[`socket`].emit("x");',
        'Reflect.get(game, "socket").emit("x");',
        'Object.getOwnPropertyDescriptor(game, "socket").value.emit("x");',
        // `on` and `off` return the socket: watching the connection is allowed only as a statement of its own.
        'game.socket.on("disconnect", () => {}).emit("x");',
        'game.socket?.on("disconnect", () => {})?.emit("x");',
        'const s = game.socket.on("disconnect", () => {});\ns.emit("x");',
        'game.socket.off("disconnect", () => {}).emit("x");',
        'send(game.socket.off("disconnect", () => {}));',
        // The emitter calls a listener with `this` bound to the socket: only an arrow function is a listener that
        // cannot reach it. And `off` without a listener removes every disconnect listener, core's included.
        'game.socket.on("disconnect", function () { this.emit("x"); });',
        'function f() { this.emit("x"); }\ngame.socket.on("disconnect", f);',
        'const f = function () { this.emit("x"); };\ngame.socket.on("disconnect", f);',
        'let f = () => {};\nf = function () { this.emit("x"); };\ngame.socket.on("disconnect", f);',
        'const { f } = handlers;\ngame.socket.on("disconnect", f);',
        'function watch(f) { game.socket.on("disconnect", f); }\nwatch(function () { this.emit("x"); });',
        'import { f } from "./x.mjs";\ngame.socket.on("disconnect", f);',
        'game.socket.on("disconnect", f.bind(null));',
        'game.socket.off("disconnect");',
        'game.socket?.off("disconnect");',
        'game.socket.off("disconnect", ...listeners);',
        'game.socket.on("disconnect", () => {}, extra);',
    ];
    for (const file of ["scripts/example.mjs", "macros/example.js", "tools/harness/example.mjs"]) {
        for (const code of banned) await reports(code, /workshop\/no-game-socket: .*CONFIG\.queries/, file);
    }
    await reports('globalThis.game.socket.emit("x");', /workshop\/no-game-socket/, "tools/harness/example.mjs");
    await reports('window.game["socket"].emit("x");', /workshop\/no-game-socket/, "tools/harness/example.mjs");
    assert.deepEqual(await lint('const f = () => {};\ngame.socket?.on("disconnect", f);\ngame.socket?.off("disconnect", f);\ngame.socket.on("disconnect", f);\nconsole.log(game.socket.connected, game.socket?.connected);'), [],
        "watching the connection is allowed");
    assert.deepEqual(await lint([
        "export function wait() {",
        "    let onDisconnect;",
        "    const lost = new Promise((resolve) => {",
        "        onDisconnect = () => resolve(false);",
        '        game.socket?.on("disconnect", onDisconnect);',
        "    });",
        "    return lost.finally(() => {",
        '        game.socket?.off("disconnect", onDisconnect);',
        "    });",
        "}",
        'game.socket.on("disconnect", (reason) => console.log(reason));',
    ].join("\n")), [], "an arrow listener, written in place or held in a variable only ever given arrows (as batch.mjs does)");
    assert.deepEqual(await lint('const socket = new URL("x");\nconsole.log(game.settings, socket, game.user.socket);'), [], "other things named socket are not the game's");
    // The live driver's page functions are not part of the module; one drops a page's connection on purpose.
    assert.deepEqual(await lint('game.socket.io.engine.close();', "tools/harness/live-plans.mjs"), []);
});

test("shipped code reaches no global through window or globalThis, and not the main document", async () => {
    await reports('document.querySelector(".x");', /ownerDocument/);
    for (const code of ['globalThis.renderTemplate("x");', "window.Dialog;", "globalThis.document.body;", "window.document.body;"]) {
        await reports(code, /no-restricted-globals/);
    }
    await reports("self.renderTemplate();", /no-undef: 'self'/);
});

test("instanceof HTML* and monkey-patching are banned", async () => {
    await reports("if (el instanceof HTMLElement) el.remove();", /isElementInstanceOf/);
    await reports("if (el instanceof el.ownerDocument.defaultView.HTMLInputElement) el.remove();", /isElementInstanceOf/);
    for (const code of [
        "Actor.prototype.craft = function () {};",
        "Actor.prototype = {};",
        'Object.defineProperty(Actor.prototype, "craft", {});',
        "Object.assign(Actor.prototype, { craft() {} });",
        'Reflect.set(Actor.prototype, "craft", null);',
    ]) {
        await reports(code, /monkey-patching/);
        await reports(code, /monkey-patching/, "tools/harness/example.mjs");
    }
    assert.deepEqual(await lint("console.log(Object.keys(Actor.prototype));"), []);
});

test("-= and == update keys are banned in strings and template literals", async () => {
    await reports('actor.update({ "system.-=old": null });', /update keys/);
    await reports('actor.update({ "==flags": {} });', /update keys/);
    await reports("actor.update({ [`flags.x.-=${id}`]: null });", /update keys/);
});

test("notification text must be a key that Foundry or the code localizes", async () => {
    await reports('ui.notifications.warn("Something happened");', /must be localized/);
    await reports('ui.notifications.warn("Crafting");', /must be localized/);
    await reports("ui.notifications.warn(`Order ${id} done`);", /must be localized/);
    await reports('ui.notifications.info("Done: " + name);', /must be localized/);
    await reports('ui.notifications.notify("Plain text", "warning");', /must be localized/);
    await reports('ui.notifications.warn("pf2e-artisans-workshop.Queue.Blocked");', /needs \{ localize: true \}/);
    assert.equal((await lint('ui.notifications.notify("Plain text", "warning");')).length, 1, "the type argument is not text");
    // The harness is developer tooling and may log or label in plain text.
    assert.deepEqual(await lint('ui.notifications.info("Fixtures built");', "tools/harness/example.mjs"), []);
});

test("user-facing properties hold keys, however they are written", async () => {
    for (const code of [
        '({ name: "Spend a drop" });',
        '({ name: "Hello" });',
        '({ title: "Workshop" });',
        '({ "label": "Craft item" });',
        '({ ["hint"]: "Craft this" });',
        "({ placeholder: `Some hint ${n}` });",
        '({ content: "<p>Done</p>" });',
    ]) {
        await reports(code, /lang\/en\.json/);
    }
});

test("i18n keys are written out in full, not built from MODULE_ID", async () => {
    await reports('import { MODULE_ID } from "./constants.mjs"; game.i18n.localize(`${MODULE_ID}.Queue.Title`);', /out in full/);
});

test("macros are linted as shipped code, with the macro arguments defined", async () => {
    await reports('ui.notifications.warn("Literal macro text");', /must be localized/, "macros/example.js");
    await reports('document.querySelector("x");', /ownerDocument/, "macros/example.js");
    assert.deepEqual(await lint('await game.modules.get("pf2e-artisans-workshop").api.ui.open({ actor, token });', "macros/example.js"), []);
});

test("pure logic has no Foundry or browser globals", async () => {
    const messages = await lint("export const dc = () => game.settings.get('x', 'y') + window.innerWidth + globalThis.ui;", "scripts/logic/example.mjs");
    assert.ok(messages.includes("no-undef: 'game' is not defined."), messages.join("\n"));
    assert.ok(messages.includes("no-undef: 'window' is not defined."), messages.join("\n"));
    assert.ok(messages.some((message) => message.startsWith("no-restricted-globals: Unexpected use of 'globalThis'")), messages.join("\n"));
});
