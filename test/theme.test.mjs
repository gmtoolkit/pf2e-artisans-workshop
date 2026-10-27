/**
 * The theming and contrast pass (DESIGN.md 10.9, M11), read from `styles/workshop.css`: the module's own text colours reach
 * 4.5:1 and its non-text colours (the focus ring, the progress bar's segments) 3:1 against the panels they sit on, in the
 * light scheme (the panel and a dark parchment) and the dark one; a card in a light-themed interface takes the light tokens
 * even when the body is dark; the sheet entries keep the light tokens; Parchment lays pf2e's sheet background.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "./helpers.mjs";

const css = readFileSync(join(ROOT, "styles/workshop.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The rule blocks whose selector list contains `selector`, as `{selectors, body}`. */
function blocks(selector) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({ selectors: selectors.split(",").map((s) => s.trim()), body }))
        .filter((b) => b.selectors.includes(selector));
}

/** The `--paw-*` tokens of a block that are colours: a hex, or a `var(--x, #hex)` fallback. */
function tokens(body) {
    const out = {};
    for (const [, name, value] of body.matchAll(/--paw-([a-z-]+):\s*([^;]+);/g)) {
        const hex = /#[0-9a-f]{6}\b/i.exec(value)?.[0];
        if (hex) out[name] = hex.toLowerCase();
    }
    return out;
}

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const LIGHT = tokens(blocks(".pf2e-artisans-workshop")[0].body);
const DARK = tokens(blocks("body.theme-dark .pf2e-artisans-workshop:not(.themed)")[0].body);
/** Text colours (`color:` in the stylesheet) and colours that are not text but must be seen (a focus ring, bar segments). */
const TEXT = ["crit-success", "success", "failure", "crit-failure", "warning", "paid"];
const NON_TEXT = ["focus", "earned", "escrow", "paid"];

test("light scheme: text colours reach 4.5:1 and the focus ring and bar segments 3:1, on the panel and on dark parchment", () => {
    for (const ground of [LIGHT.panel, "#d9cfb4"]) {
        for (const name of TEXT) assert.ok(contrast(LIGHT[name], ground) >= 4.5, `${name} ${LIGHT[name]} on ${ground}: ${contrast(LIGHT[name], ground).toFixed(2)}`);
        for (const name of NON_TEXT) assert.ok(contrast(LIGHT[name], ground) >= 3, `${name} ${LIGHT[name]} on ${ground}: ${contrast(LIGHT[name], ground).toFixed(2)}`);
    }
    assert.ok(contrast(LIGHT["accent-text"] ?? "#ffffff", "#5e0000") >= 4.5, "a primary button's word on its ground");
});

test("dark scheme: the same, on the dark panel and a lighter dark ground", () => {
    for (const ground of [DARK.panel, "#2a2730"]) {
        for (const name of TEXT) assert.ok(contrast(DARK[name], ground) >= 4.5, `${name} ${DARK[name]} on ${ground}: ${contrast(DARK[name], ground).toFixed(2)}`);
        for (const name of NON_TEXT) assert.ok(contrast(DARK[name], ground) >= 3, `${name} ${DARK[name]} on ${ground}: ${contrast(DARK[name], ground).toFixed(2)}`);
    }
});

test("the light focus ring is the module's own, darker than core's highlight, which fails 3:1 on the light panel", () => {
    assert.ok(contrast("#ff6400", LIGHT.panel) < 3, "core's highlight on the light panel");
    assert.notEqual(LIGHT.focus, "#ff6400");
});

test("a card takes the scheme of its nearest themed ancestor: light inside a light interface even when the body is dark", () => {
    const light = blocks(".themed.theme-light .pf2e-artisans-workshop-card");
    assert.equal(light.length, 1, "the light tokens also apply under a light-themed interface");
    assert.deepEqual(light[0], blocks(".pf2e-artisans-workshop")[0], "in the same block as the light defaults");
    // `.themed.theme-light X` (0,3,0) outranks the dark block's `.theme-dark X` (0,2,0), and both blocks name every token.
    assert.ok(blocks(".theme-dark .pf2e-artisans-workshop-card").length === 1 && blocks(".themed.theme-dark .pf2e-artisans-workshop-card").length === 1);
    assert.deepEqual(Object.keys(DARK).filter((k) => !(k in LIGHT)), [], "every dark token has a light value to go back to");
});

test("the sheet entries keep the light tokens in either scheme; Parchment lays pf2e's sheet background", () => {
    assert.ok(blocks(".pf2e-artisans-workshop-entry").some((b) => b.body.includes("--paw-accent")), "light tokens for the entries");
    assert.ok(!blocks("body.theme-dark .pf2e-artisans-workshop:not(.themed)")[0].selectors.some((s) => s.includes("-entry")));
    const parchment = blocks(".pf2e-artisans-workshop.paw-parchment .window-content");
    assert.match(parchment[0]?.body ?? "", /url\("\.\.\/\.\.\/\.\.\/systems\/pf2e\/assets\/sheet\/background\.webp"\)/);
});

test("labels set no text shadow (the light scheme's smudge, from the first captures)", () => {
    assert.ok(blocks(".pf2e-artisans-workshop dt").some((b) => /text-shadow:\s*none/.test(b.body)));
});

test("the shelf's call line wraps inside its tile: core's `code` never wraps (M11 live pass)", () => {
    const [call] = blocks(".macro-tile .tile-call");
    assert.ok(call, "the call line has its rule");
    assert.match(call.body, /white-space:\s*(normal|pre-wrap|break-spaces)\s*;/, "a white-space that wraps, over core's nowrap");
    assert.match(call.body, /overflow-wrap:\s*anywhere\s*;/, "a long token breaks anywhere");
    assert.match(call.body, /display:\s*block\s*;/, "a block in the tile's text column, not core's inline block");
});
