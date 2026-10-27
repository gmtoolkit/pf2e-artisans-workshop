import assert from "node:assert/strict";
import { test } from "node:test";
import { MODULE_ID } from "../scripts/constants.mjs";
import { checkSource, checkTemplate, missingKeys, nestingConflicts, run } from "../tools/check-source.mjs";
import { ROOT, logger, tempDir } from "./helpers.mjs";

const KEY = `${MODULE_ID}.Queue.Title`;
const messages = (text, options) => checkTemplate(text, options).map(({ line, message }) => `${line}: ${message}`);

test("localized templates pass", () => {
    const template = [
        "{{!-- Comments may say anything. --}}",
        `<section class="queue" data-tooltip="{{localize "${KEY}"}}">`,
        `  <h2>{{localize "${KEY}"}}</h2>`,
        "  <span>{{order.name}} &middot; {{order.days}} / {{order.total}}</span>",
        `  <input type="text" name="search" placeholder="{{localize '${KEY}'}}">`,
        `  {{> "modules/x/card.hbs" title="${KEY}"}}`,
        "</section>",
    ].join("\n");
    assert.deepEqual(messages(template), []);
});

test("literal text in a template is reported with its line", () => {
    const template = ["<section>", "  <h2>Crafting queue</h2>", "  <p>{{count}} orders</p>", "</section>"].join("\n");
    assert.deepEqual(messages(template), ['2: literal text "Crafting queue"', '3: literal text "orders"']);
});

test("literal text in user-facing attributes and partial arguments is reported", () => {
    const template = [
        '<button type="button" title="Start crafting" data-action="start"></button>',
        '<img alt="An image" src="{{img}}">',
        '<i class="fa-solid fa-hammer" aria-label="Hammer {{name}}"></i>',
        '{{> "modules/x/card.hbs" title="Free text here"}}',
    ].join("\n");
    assert.deepEqual(messages(template), [
        "4: literal text in the title argument",
        "1: literal text in the title attribute",
        "2: literal text in the alt attribute",
        "3: literal text in the aria-label attribute",
    ]);
});

test("data-action is reported only in chat templates", () => {
    const template = `<button type="button" data-action="claim">{{localize "${KEY}"}}</button>`;
    assert.deepEqual(messages(template), []);
    assert.deepEqual(messages(template, { chat: true }), ["1: data-action in a chat template"]);
});

test("i18n keys named in code must exist", () => {
    const code = [
        `game.i18n.localize("${KEY}");`,
        `game.i18n.format('${MODULE_ID}.Queue.Missing', { n });`,
        `Hooks.callAll("${MODULE_ID}.ready", api); // hooks are lower-case, not keys`,
    ].join("\n");
    assert.deepEqual(missingKeys(code, { [KEY]: "x" }), [`${MODULE_ID}.Queue.Missing`]);
});

test("checkSource walks scripts, macros and templates", (t) => {
    const dir = tempDir(t, {
        "lang/en.json": { [KEY]: "Queue" },
        "scripts/module.mjs": `game.i18n.localize("${MODULE_ID}.Nope");\n`,
        "macros/open.js": `ui.notifications.warn("${MODULE_ID}.Macro.Missing", { localize: true });\n`,
        "templates/chat/card.hbs": '<button type="button" data-action="x"></button>\n',
        "templates/queue.hbs": "<p>Hello</p>\n",
    });
    assert.deepEqual(checkSource(dir), [
        "templates/chat/card.hbs:1: data-action in a chat template",
        'templates/queue.hbs:1: literal text "Hello"',
        `scripts/module.mjs: i18n key "${MODULE_ID}.Nope" is not in lang/en.json`,
        `macros/open.js: i18n key "${MODULE_ID}.Macro.Missing" is not in lang/en.json`,
    ]);
});

test("a key that is both a string and the group of another is reported: Foundry would drop the whole file (M6 live pass)", (t) => {
    const lang = { [`${MODULE_ID}.Settlement.Size`]: "Size", [`${MODULE_ID}.Settlement.Size.Village`]: "Village",
        [`${MODULE_ID}.Settlement.Size.Town`]: "Town", [`${MODULE_ID}.Settlement.Sizes`]: "not under Size" };
    assert.deepEqual(nestingConflicts(lang), [`"${MODULE_ID}.Settlement.Size" is a string and also holds "${MODULE_ID}.Settlement.Size.Village"`]);
    assert.deepEqual(nestingConflicts({ [`${MODULE_ID}.Size.Label`]: "Size", [`${MODULE_ID}.Size.Village`]: "Village" }), []);
    const log = logger();
    assert.equal(run(tempDir(t, { "lang/en.json": lang }), log), 1);
    assert.match(log.text(), /lang\/en\.json: ".*Settlement\.Size" is a string and also holds .* \(Foundry would drop the whole file\)/);
});

test("a malformed or non-object lang/en.json is reported, not thrown", (t) => {
    for (const [content, message] of [["{ not json", /^error: lang\/en\.json: .*JSON/m], ["null", /must be an object/], ["[]", /must be an object/]]) {
        const log = logger();
        assert.equal(run(tempDir(t, { "lang/en.json": content }), log), 1);
        assert.match(log.text(), message);
    }
});

test("the repository passes", () => {
    const log = logger();
    assert.equal(run(ROOT, log), 0, log.text());
});
