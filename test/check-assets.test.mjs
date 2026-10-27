import assert from "node:assert/strict";
import { test } from "node:test";
import { SCREENSHOT_MAX_BYTES, checkAssets, isScreenshotPath, listFiles, run } from "../tools/check-assets.mjs";
import { ROOT, logger, tempDir } from "./helpers.mjs";

/** File content from strings (as Latin-1 bytes) and byte arrays. */
const bytes = (...parts) => Buffer.concat(parts.map((part) => Buffer.from(part, typeof part === "string" ? "latin1" : undefined)));
const PNG_BYTES = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("a clean tree passes", (t) => {
    const dir = tempDir(t, {
        "scripts/module.mjs": "export {};\n",
        "styles/a.css": ".a { color: red; }\n",
        // Text that happens to start like a media header is still text.
        "lang/notes.txt": "BMX notes\n",
        "docs/formulas.md": "FORMULAS\n",
    });
    assert.deepEqual(checkAssets(dir), []);
});

test("media files fail by extension, whatever the folder", (t) => {
    const names = [
        "icons/tool.svg", "icons/tool.svgz", "assets/a.webp", "assets/a.jxl", "assets/a.heif", "fonts/f.woff2",
        "sound.ogg", "sound.aif", "sound.aiff", "clip.avi", "clip.mpg", "clip.mpeg",
    ];
    const dir = tempDir(t, Object.fromEntries(names.map((name) => [name, "x"])));
    assert.equal(checkAssets(dir).length, names.length);
});

test("media under another name fails by its leading bytes", (t) => {
    const cases = {
        "lang/notes.txt": [PNG_BYTES, /PNG image/],
        "probe/clip.dat": [bytes([0, 0, 0, 0x20], "ftypisom"), /ISO media file/],
        "probe/pic.bin": [bytes([0, 0, 0, 0x1c], "ftypavif"), /ISO media file/],
        "probe/pic.dat": [bytes("BM", [0x36, 0x10, 0, 0, 0, 0, 0, 0, 0x36, 0]), /BMP image/],
        "probe/le.dat": [bytes("II*", [0, 8, 0]), /TIFF image/],
        "probe/be.dat": [bytes("MM", [0], "*", [0, 0]), /TIFF image/],
        "probe/art.dat": [bytes("8BPS", [0, 1]), /Photoshop image/],
        "probe/x.dat": [bytes([0xff, 0x0a, 0xfa]), /JPEG XL image/],
        "probe/aiff.dat": [bytes("FORM", [0, 0, 0x10, 0], "AIFF"), /AIFF audio/],
        "probe/icon.dat": [bytes([0x1f, 0x8b, 0x08, 0]), /gzip file/],
        "probe/other.dat": [bytes([0x01, 0x02, 0x00, 0x03]), /binary content/],
        "probe/latin1.txt": [bytes("caf", [0xe9]), /binary content/],
    };
    const dir = tempDir(t, Object.fromEntries(Object.entries(cases).map(([path, [content]]) => [path, content])));
    const problems = checkAssets(dir);
    assert.equal(problems.length, Object.keys(cases).length, problems.join("\n"));
    for (const [path, [, message]] of Object.entries(cases)) {
        const problem = problems.find((line) => line.startsWith(`${path}:`));
        assert.match(problem ?? "", message, path);
    }
});

test("shipped and published files may not embed media", (t) => {
    const files = {
        "styles/a.css": '.a { background: url("data:image/png;base64,AAAA"); }\n',
        "styles/font.css": "@font-face { src: url(data:application/font-woff2;base64,d09GMgABAAAA); }\n",
        "lang/x.json": '{ "a": "data:application/octet-stream;base64,iVBORw0KGgo=" }\n',
        "templates/a.hbs": "<div><svg viewBox='0 0 1 1'></svg></div>\n",
        "templates/b.hbs": "<SVG/>\n",
        "lang/icon.txt": "<svg xmlns='http://www.w3.org/2000/svg'></svg>\n",
        "macros/open.js": "// <svg>\n",
        "README.md": "# Title\n\n<svg viewBox='0 0 1 1'></svg>\n",
        "docs/package-description.md": "![icon](data:image/svg+xml;utf8,x)\n",
    };
    const dir = tempDir(t, files);
    assert.deepEqual(checkAssets(dir).sort(), Object.keys(files).map((file) => `${file}: embeds media (a data: URI or inline SVG)`).sort());
});

test("files that never ship may name the patterns", (t) => {
    const dir = tempDir(t, {
        "DESIGN.md": "Media embedded as a data:image/png;base64, URI or as inline <svg> fails.\n",
        "test/a.test.mjs": "const svg = \"<svg viewBox='0 0 1 1'></svg>\";\n",
        "tools/x.mjs": "// data:font/woff2;base64,AAAA\n",
        "styles/a.css": ".a { color: red; } /* data:text/plain,hello is not base64 */\n",
    });
    assert.deepEqual(checkAssets(dir), []);
});

test("the README's screenshots: PNG files directly in docs/screenshots/ pass, up to the size limit", (t) => {
    const dir = tempDir(t, {
        "docs/screenshots/queue.png": PNG_BYTES,
        "docs/screenshots/Funds.PNG": Buffer.concat([PNG_BYTES, Buffer.alloc(SCREENSHOT_MAX_BYTES - PNG_BYTES.length)]),
        "docs/screenshots/notes.md": "# Captions\n",
    });
    assert.deepEqual(checkAssets(dir), []);
});

test("images anywhere else, other media in docs/screenshots/, and a screenshot that is not a small PNG fail", (t) => {
    const cases = {
        "docs/queue.png": [PNG_BYTES, /media file \(\.png\)/],
        "docs/screenshots/old/queue.png": [PNG_BYTES, /media file \(\.png\)/],
        "styles/queue.png": [PNG_BYTES, /media file \(\.png\)/],
        "docs/screenshots/queue.svg": ["<svg></svg>", /media file \(\.svg\)/],
        "docs/screenshots/queue.webp": ["x", /media file \(\.webp\)/],
        "docs/screenshots/tour.mp4": ["x", /media file \(\.mp4\)/],
        "docs/screenshots/font.bin": [bytes("wOF2", [0, 1]), /WOFF2 font/],
        "docs/screenshots/riff.png": [bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "), /a screenshot must be a PNG image/],
        "docs/screenshots/huge.png": [Buffer.concat([PNG_BYTES, Buffer.alloc(SCREENSHOT_MAX_BYTES)]), /screenshot is \d+ KiB, more than 400 KiB/],
    };
    const dir = tempDir(t, Object.fromEntries(Object.entries(cases).map(([path, [content]]) => [path, content])));
    const problems = checkAssets(dir);
    assert.equal(problems.length, Object.keys(cases).length, problems.join("\n"));
    for (const [path, [, message]] of Object.entries(cases)) {
        assert.match(problems.find((line) => line.startsWith(`${path}:`)) ?? "", message, path);
    }
});

test("a screenshot's place is a .png directly in docs/screenshots/", () => {
    assert.equal(isScreenshotPath("docs/screenshots/queue.png"), true);
    for (const path of ["docs/queue.png", "docs/screenshots/a/queue.png", "docs/screenshots/queue.jpg", "docs/screenshotsX/queue.png", "x/docs/screenshots/a.png"]) {
        assert.equal(isScreenshotPath(path), false, path);
    }
});

test("an allowlisted path passes", (t) => {
    const dir = tempDir(t, { "a.png": PNG_BYTES });
    assert.deepEqual(checkAssets(dir, { allowlist: ["a.png"] }), []);
});

test("outside git, node_modules and .git are skipped", (t) => {
    const dir = tempDir(t, { "node_modules/x/logo.png": PNG_BYTES, ".git/x.png": PNG_BYTES, "a.mjs": "" });
    assert.deepEqual(listFiles(dir), ["a.mjs"]);
});

test("the repository passes", () => {
    const log = logger();
    assert.equal(run(ROOT, log), 0, log.text());
});
