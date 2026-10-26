import js from "@eslint/js";

/**
 * ESLint flat config: the lint rules of DESIGN.md 15.1, plus the checks behind principles P6, P12 and P13.
 * The rules ESLint cannot express (Handlebars templates, i18n keys that must exist) are in
 * `tools/check-source.mjs`, which `npm run lint` runs after ESLint.
 *
 * Code that runs in Foundry may use only the globals listed here, so whatever Foundry 14 deprecates (the
 * global aliases removed in v15, Application V1, `MeasuredTemplateDocument`) and whatever P6 and P12 rule
 * out (jQuery, libWrapper, socketlib, `requestAnimationFrame`) is undefined and fails `no-undef`. The
 * rules below cover what a list of globals cannot: properties of allowed globals, syntax, and text.
 */

const readonly = (names) => Object.fromEntries(names.map((name) => [name, "readonly"]));

/** Browser globals. `requestAnimationFrame` is left out: debounce re-renders instead (DESIGN.md 10.1). */
const BROWSER_GLOBALS = [
    "window", "document", "console", "navigator", "location", "localStorage", "sessionStorage",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "structuredClone",
    "fetch", "URL", "URLSearchParams", "AbortController", "Event", "CustomEvent", "EventTarget",
    "Element", "HTMLElement", "Node", "DocumentFragment", "MutationObserver", "ResizeObserver",
    "IntersectionObserver", "getComputedStyle", "matchMedia", "crypto", "performance",
];

/**
 * Foundry globals, read from Foundry 14.368's `client/client.mjs`: the namespaces, singletons, document
 * classes and helpers it assigns to `globalThis` without a deprecation warning, plus `canvas` (assigned
 * by `Game`) and the bundled `Handlebars` and `PIXI`. Everything else it puts on `globalThis` is
 * deprecated or internal and left out on purpose. Recheck the list when a new Foundry generation is
 * targeted (DESIGN.md 3.1).
 */
const FOUNDRY_GLOBALS = [
    "foundry", "CONST", "CONFIG", "game", "ui", "canvas", "Hooks", "_del", "_loc", "_replace",
    "fromUuid", "fromUuidSync", "getDocumentClass", "Roll", "Color", "Collection", "Handlebars", "PIXI",
    "ActiveEffect", "Actor", "ActorDelta", "Adventure", "AmbientLightDocument", "AmbientSoundDocument",
    "Card", "Cards", "ChatMessage", "Combat", "Combatant", "CombatantGroup", "DrawingDocument",
    "FogExploration", "Folder", "Item", "JournalEntry", "JournalEntryCategory", "JournalEntryPage", "Level",
    "Macro", "NoteDocument", "Playlist", "PlaylistSound", "RegionBehavior", "RegionDocument", "RollTable",
    "Scene", "Setting", "TableResult", "TileDocument", "TokenDocument", "User", "WallDocument",
];

/** The arguments Foundry passes to a script macro (`client/documents/macro.mjs`). */
const MACRO_GLOBALS = ["speaker", "actor", "token", "character", "scope"];

const NODE_GLOBALS = [
    "process", "console", "Buffer", "URL", "URLSearchParams", "AbortController", "TextEncoder",
    "TextDecoder", "setTimeout", "clearTimeout", "setImmediate", "structuredClone", "queueMicrotask",
    "fetch", "performance",
];

/** Properties of allowed globals that P12 and DESIGN.md 3.1 rule out. */
const BANNED_PROPERTIES = [
    { object: "foundry", property: "appv1", message: "Application V1; use ApplicationV2 (P12)." },
    { object: "game", property: "socket", message: "socket is false (DESIGN.md 3.1); use CONFIG.queries." },
];

// The regex of DESIGN.md 15.1 (["'`.][=-]=), applied to string and template-literal contents.
const UPDATE_KEY = String.raw`/(^|\.)[-=]=/`;
const UPDATE_KEY_MESSAGE = "No -= or == update keys; use _del or _replace (Foundry v14).";
const PATCH_MESSAGE = "No monkey-patching (P6).";

const BANNED_SYNTAX = [
    {
        selector: "BinaryExpression[operator='instanceof'][right.name=/^HTML/]",
        message: "instanceof HTML* fails in detached windows; use foundry.utils.isElementInstanceOf.",
    },
    {
        selector: "BinaryExpression[operator='instanceof'][right.property.name=/^HTML/]",
        message: "instanceof HTML* fails in detached windows; use foundry.utils.isElementInstanceOf.",
    },
    { selector: `Literal[value=${UPDATE_KEY}]`, message: UPDATE_KEY_MESSAGE },
    { selector: `TemplateElement[value.raw=${UPDATE_KEY}]`, message: UPDATE_KEY_MESSAGE },
    // X.prototype.y = ..., X.prototype = ..., and Object.assign/defineProperty or Reflect.set on X.prototype.
    { selector: "AssignmentExpression[left.object.property.name='prototype']", message: PATCH_MESSAGE },
    { selector: "AssignmentExpression[left.property.name='prototype']", message: PATCH_MESSAGE },
    {
        selector: "CallExpression[callee.object.name=/^(Object|Reflect)$/][callee.property.name=/^(assign|defineProperty|defineProperties|set|setPrototypeOf)$/][arguments.0.property.name='prototype']",
        message: PATCH_MESSAGE,
    },
];

/**
 * In shipped code these globals break detached windows (DESIGN.md 10.1), and reaching a global through
 * `window` or `globalThis` would step around the list of allowed globals.
 */
const MAIN_WINDOW_GLOBALS = [
    { name: "document", message: "Use element.ownerDocument so detached windows work (DESIGN.md 10.1)." },
    { name: "window", message: "Use element.ownerDocument.defaultView, or the global itself (DESIGN.md 10.1, P12)." },
    { name: "globalThis", message: "Use the global itself, so the list of allowed globals applies (P12)." },
];

/**
 * An i18n key: this module's (written out in full), or one under an upper-case namespace, such as pf2e's
 * `PF2E.` or core's `COMMON.`. Anything else in a user-facing place is literal text.
 */
const KEY = String.raw`(pf2e-artisans-workshop|[A-Z][A-Z0-9_]*)\.\S+`;
const NOTIFICATION = "CallExpression[callee.object.property.name='notifications']";
const TEXT_PROPERTIES = "/^(hint|label|title|placeholder|content|tooltip)$/";
const property = (names) => `Property:matches([key.name=${names}], [key.value=${names}])`;

/** User-facing text must come from lang/en.json (P13). Applies to shipped code and macros. */
const BANNED_UI_TEXT = [
    // Notifications: only the message (the first argument) is text. Foundry 14 localizes a key itself
    // when the options set `localize: true` or `format`.
    {
        selector: `${NOTIFICATION}[arguments.0.type=/^(TemplateLiteral|BinaryExpression)$/]`,
        message: "Notification text must be localized: pass a key with { localize: true } or { format } (P13).",
    },
    {
        selector: `${NOTIFICATION}[arguments.0.type='Literal'][arguments.0.value=/^(?!${KEY}$)/]`,
        message: "Notification text must be localized: pass a key with { localize: true } or { format } (P13).",
    },
    {
        selector: `${NOTIFICATION}[arguments.0.value=/^${KEY}$/]:not(:has(Property[key.name=/^(localize|format)$/]))`,
        message: "A key passed to a notification needs { localize: true } or { format }, or it is shown as is.",
    },
    // Properties that are always shown to users hold a key, never text.
    {
        selector: `${property(TEXT_PROPERTIES)}[value.type='Literal'][value.value=/^(?!${KEY}$)./]`,
        message: "User-facing text belongs in lang/en.json; use an i18n key here (P13).",
    },
    {
        selector: `${property(TEXT_PROPERTIES)}[value.type='TemplateLiteral']`,
        message: "User-facing text belongs in lang/en.json; use an i18n key here (P13).",
    },
    // `name` also names form fields ("quantity"), so there only a capitalised value or one with a space
    // counts as text.
    {
        selector: `${property("/^name$/")}[value.type='Literal'][value.value=/^(?!${KEY}$)([A-Z]|.*\\s)/]`,
        message: "User-facing text belongs in lang/en.json; use an i18n key here (P13).",
    },
    // `${MODULE_ID}.Queue.Title` hides the key from tools/check-source.mjs, which checks that it exists.
    {
        selector: "TemplateLiteral[quasis.0.value.raw=''][expressions.0.name='MODULE_ID'][quasis.1.value.raw=/^\\.[A-Z]/]",
        message: "Write i18n keys out in full (\"pf2e-artisans-workshop.Queue.Title\") so their existence is checked (P13).",
    },
];

/**
 * Code that runs inside Foundry; the part of it users get (the module, and the copy-paste macros of
 * DESIGN.md 11.1); and the pure-logic part of the module.
 */
const FOUNDRY_CODE = ["scripts/**/*.mjs", "macros/**/*.js", "tools/harness/**/*.mjs"];
const SHIPPED_CODE = ["scripts/**/*.mjs", "macros/**/*.js"];
const PURE_CODE = ["scripts/logic/**/*.mjs", "scripts/data/**/*.mjs"];

export default [
    { ignores: ["node_modules/", "dist/"] },
    js.configs.recommended,
    {
        languageOptions: { ecmaVersion: "latest", sourceType: "module" },
        rules: {
            "no-var": "error",
            "prefer-const": "error",
            "eqeqeq": ["error", "smart"],
        },
    },
    {
        files: FOUNDRY_CODE,
        ignores: PURE_CODE,
        languageOptions: { globals: readonly([...BROWSER_GLOBALS, ...FOUNDRY_GLOBALS]) },
        rules: {
            "no-restricted-properties": ["error", ...BANNED_PROPERTIES],
            "no-restricted-syntax": ["error", ...BANNED_SYNTAX],
        },
    },
    {
        // Macros are parsed as modules, so top-level await works; Foundry runs them as an async function.
        files: ["macros/**/*.js"],
        languageOptions: { globals: readonly(MACRO_GLOBALS) },
    },
    {
        // Pure logic and data (DESIGN.md 6, 15.1): no Foundry and no browser globals.
        files: PURE_CODE,
        languageOptions: { globals: readonly(["console"]) },
    },
    {
        files: SHIPPED_CODE,
        rules: {
            "no-restricted-globals": ["error", ...MAIN_WINDOW_GLOBALS],
            "no-restricted-syntax": ["error", ...BANNED_SYNTAX, ...BANNED_UI_TEXT],
        },
    },
    {
        // Node tooling, tests and this config.
        files: ["tools/*.mjs", "test/**/*.mjs", "eslint.config.mjs"],
        languageOptions: { globals: readonly(NODE_GLOBALS) },
    },
];
