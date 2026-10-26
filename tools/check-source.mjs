/**
 * The lint rules ESLint cannot express (DESIGN.md 15.1, P13). `npm run lint` runs this after ESLint.
 *
 * - Templates (`.hbs` files under `templates/`) contain no literal text: every word a user sees comes from
 *   `{{localize}}` or from data, including the title, alt, placeholder, aria-* and tooltip attributes.
 * - Chat templates (`templates/chat/`) have no `data-action` attributes: chat cards outlive the
 *   application that rendered them, so their buttons are wired by delegated listeners instead.
 * - Every i18n key the code, macros or templates name exists in `lang/en.json`. A key is a quoted
 *   `pf2e-artisans-workshop.Xxx` string: keys are written out in full (ESLint rejects one built from
 *   `MODULE_ID`), and their first segment is capitalised (`tools/check-strings.mjs` rejects any other),
 *   which tells them apart from hook and query names such as `pf2e-artisans-workshop.ready`.
 *
 *   node tools/check-source.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MODULE_ID } from "../scripts/constants.mjs";

/** Attributes whose value a user reads or hears. */
const TEXT_ATTRIBUTES = new Set([
    "title", "alt", "placeholder", "label", "data-tooltip", "aria-label", "aria-description",
    "aria-placeholder", "aria-roledescription", "aria-valuetext",
]);

/** A quoted key under the module namespace whose next segment starts with a capital letter. */
const KEY_REFERENCE = new RegExp(`["'\`](${RegExp.escape(MODULE_ID)}\\.[A-Z](?:[\\w.-]*\\w)?)["'\`]`, "g");

/** Replace each match with spaces (keeping newlines), so offsets and line numbers stay valid. */
function blank(text, pattern) {
    return text.replace(pattern, (match) => match.replace(/[^\n]/g, " "));
}

function lineOf(text, index) {
    return text.slice(0, index).split("\n").length;
}

/**
 * Problems in one Handlebars template.
 * @param {string} text   the template source
 * @param {object} [options]
 * @param {boolean} [options.chat]  whether this is a chat-card template
 * @returns {{line: number, message: string}[]}
 */
export function checkTemplate(text, { chat = false } = {}) {
    const problems = [];
    const report = (index, message) => problems.push({ line: lineOf(text, index), message });

    // Comments may say anything.
    const source = blank(text, /\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}|<!--[\s\S]*?-->/g);

    // Hash arguments of expressions, such as {{> card title="..."}}. A key never contains a space, so a
    // value with one is prose.
    for (const expression of source.matchAll(/\{\{[\s\S]*?\}\}/g)) {
        for (const arg of expression[0].matchAll(/([\w-]+)=(["'])(.*?)\2/gs)) {
            if (TEXT_ATTRIBUTES.has(arg[1].toLowerCase()) && /\p{L}/u.test(arg[3]) && /\s/.test(arg[3])) {
                report(expression.index + arg.index, `literal text in the ${arg[1]} argument`);
            }
        }
    }

    // HTML attributes, with expressions blanked: title="{{localize "KEY"}}" leaves nothing behind.
    const markup = blank(source, /\{\{[\s\S]*?\}\}/g);
    for (const attribute of markup.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)) {
        const name = attribute[1].toLowerCase();
        if (TEXT_ATTRIBUTES.has(name) && /\p{L}/u.test(attribute[3])) {
            report(attribute.index, `literal text in the ${name} attribute`);
        }
        if (chat && name === "data-action") report(attribute.index, "data-action in a chat template");
    }

    // What is left after removing tags and entities is text a user would see.
    const rest = blank(blank(markup, /<[^>]*>/g), /&(?:#\d+|#x[\da-f]+|[a-z]+);/gi);
    for (const match of rest.matchAll(/\p{L}[^\n]*/gu)) {
        report(match.index, `literal text "${match[0].trim()}"`);
    }
    return problems;
}

/** Keys referenced in `text` that `lang` does not define. */
export function missingKeys(text, lang) {
    return [...text.matchAll(KEY_REFERENCE)].map((match) => match[1]).filter((key) => !(key in lang));
}

/** Files under `dir` (relative to `root`) whose name ends with one of `extensions`. */
function filesIn(root, dir, extensions) {
    const start = join(root, dir);
    if (!existsSync(start)) return [];
    const found = [];
    for (const entry of readdirSync(start, { withFileTypes: true, recursive: true })) {
        if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
            found.push(relative(root, join(entry.parentPath, entry.name)).split("\\").join("/"));
        }
    }
    return found.sort();
}

/** @returns {string[]} one line per problem, as `file:line: message` */
export function checkSource(root) {
    const problems = [];
    const lang = readLang(root, problems);
    if (!lang) return problems;

    for (const file of filesIn(root, "templates", [".hbs"])) {
        const text = readFileSync(join(root, file), "utf8");
        for (const { line, message } of checkTemplate(text, { chat: file.startsWith("templates/chat/") })) {
            problems.push(`${file}:${line}: ${message}`);
        }
    }

    const named = [
        ...filesIn(root, "scripts", [".mjs", ".js"]),
        ...filesIn(root, "macros", [".js"]),
        ...filesIn(root, "templates", [".hbs"]),
    ];
    for (const file of named) {
        for (const key of missingKeys(readFileSync(join(root, file), "utf8"), lang)) {
            problems.push(`${file}: i18n key "${key}" is not in lang/en.json`);
        }
    }
    return problems;
}

/** `lang/en.json` as an object of key to string, or null after adding a problem. */
function readLang(root, problems) {
    let lang;
    try {
        lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
    } catch (error) {
        problems.push(`lang/en.json: ${error.message}`);
        return null;
    }
    if (lang === null || typeof lang !== "object" || Array.isArray(lang)) {
        problems.push("lang/en.json: must be an object of key to string");
        return null;
    }
    return lang;
}

/** Run the check and return the exit code. `log` receives each output line. */
export function run(root, log = console.log) {
    const problems = checkSource(root);
    for (const problem of problems) log(`error: ${problem}`);
    log(problems.length ? `Source check failed: ${problems.length} problem(s).` : "Source check passed.");
    return problems.length ? 1 : 0;
}

if (import.meta.main) {
    process.exitCode = run(join(import.meta.dirname, ".."));
}
