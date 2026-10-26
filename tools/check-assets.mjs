/**
 * Asset policy check (DESIGN.md 16.5, P14).
 *
 * The repository holds no images, audio, video or fonts: icons are Font Awesome classes, Foundry core
 * icons or pf2e system icon paths, and item images come from the compendium. Every file git would track
 * fails the check if
 *
 * - its extension is a media type;
 * - its leading bytes are a media format, or it is not UTF-8 text at all (media under another name); or
 * - it ships or is published (`SHIPPED`) and embeds media: a data: URI of a media type, any base64
 *   data: URI, or inline SVG. Files that never ship (the design notes, tests, tools) may name these
 *   patterns in prose.
 *
 *   node tools/check-assets.mjs
 */
import { isUtf8 } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

/** Paths allowed to be media files. Empty by policy; adding one needs an entry in DECISIONS.md. */
export const ALLOWLIST = [];

const MEDIA_EXTENSIONS = new Set([
    // images
    ".apng", ".avif", ".bmp", ".gif", ".heic", ".heif", ".ico", ".jpeg", ".jpg", ".jxl", ".png", ".psd",
    ".svg", ".svgz", ".tif", ".tiff", ".webp",
    // audio and video
    ".aac", ".aif", ".aiff", ".avi", ".flac", ".m4a", ".m4v", ".mid", ".midi", ".mkv", ".mov", ".mp3",
    ".mp4", ".mpeg", ".mpg", ".oga", ".ogg", ".opus", ".wav", ".weba", ".webm",
    // fonts
    ".eot", ".otf", ".ttf", ".woff", ".woff2",
]);

/** Leading bytes of media formats, to name a media file under another name. `null` matches any byte. */
const SIGNATURES = [
    ["a PNG image", [0x89, 0x50, 0x4e, 0x47]],
    ["a JPEG image", [0xff, 0xd8, 0xff]],
    ["a JPEG XL image", [0xff, 0x0a]],
    ["a JPEG XL image", [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20]],
    ["a GIF image", [0x47, 0x49, 0x46, 0x38]],
    ["a BMP image", [0x42, 0x4d, null, null, null, null, 0x00, 0x00, 0x00, 0x00]], // "BM", size, reserved zeros
    ["a TIFF image", [0x49, 0x49, 0x2a, 0x00]], // "II*\0"
    ["a TIFF image", [0x4d, 0x4d, 0x00, 0x2a]], // "MM\0*"
    ["a Photoshop image", [0x38, 0x42, 0x50, 0x53]], // "8BPS"
    ["an ICO image", [0x00, 0x00, 0x01, 0x00]],
    ["an ISO media file (MP4, MOV, M4A, AVIF, HEIC)", [null, null, null, null, 0x66, 0x74, 0x79, 0x70]], // "ftyp"
    ["a RIFF media file (WebP, WAV, AVI)", [0x52, 0x49, 0x46, 0x46]],
    ["an AIFF audio file", [0x46, 0x4f, 0x52, 0x4d, null, null, null, null, 0x41, 0x49, 0x46]], // "FORM", size, "AIF"
    ["an MPEG video", [0x00, 0x00, 0x01, 0xba]],
    ["an MPEG video", [0x00, 0x00, 0x01, 0xb3]],
    ["an Ogg media file", [0x4f, 0x67, 0x67, 0x53]],
    ["a FLAC audio file", [0x66, 0x4c, 0x61, 0x43]],
    ["an MP3 audio file", [0x49, 0x44, 0x33]],
    ["a Matroska or WebM media file", [0x1a, 0x45, 0xdf, 0xa3]],
    ["a WOFF font", [0x77, 0x4f, 0x46, 0x46]],
    ["a WOFF2 font", [0x77, 0x4f, 0x46, 0x32]],
    ["an OpenType font", [0x4f, 0x54, 0x54, 0x4f]],
    ["a TrueType font", [0x00, 0x01, 0x00, 0x00]],
    ["a gzip file (SVGZ is gzipped SVG)", [0x1f, 0x8b]],
];

/** What the release zip contains (DESIGN.md 16.2), plus the published listing text and macros. */
const SHIPPED = [
    "module.json", "LICENSE", "README.md", "CHANGELOG.md", "docs/package-description.md",
    "scripts/", "templates/", "styles/", "lang/", "macros/",
];

const EMBEDDED_MEDIA = /data:(?:image|audio|video|font)\/|data:[\w.+-]+\/[\w.+-]+(?:;[\w.+-]+=[^;,]*)*;base64,|<svg[\s/>]/i;

/**
 * Every file in the working tree that git would track (tracked or untracked, not ignored), or every
 * file outside .git and node_modules when `root` is not a git checkout.
 */
export function listFiles(root) {
    try {
        const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return output.split("\0").filter((file) => file && existsSync(join(root, file)));
    } catch {
        return walk(root, root);
    }
}

function walk(root, dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walk(root, path));
        else if (entry.isFile()) files.push(relative(root, path).split("\\").join("/"));
    }
    return files;
}

const ships = (file) => SHIPPED.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path));

/** @returns {string[]} one line per violation */
export function checkAssets(root, { files = listFiles(root), allowlist = ALLOWLIST } = {}) {
    const problems = [];
    for (const file of files) {
        if (allowlist.includes(file)) continue;
        const ext = extname(file).toLowerCase();
        if (MEDIA_EXTENSIONS.has(ext)) {
            problems.push(`${file}: media file (${ext})`);
            continue;
        }
        const bytes = readFileSync(join(root, file));
        const signature = SIGNATURES.find(([, magic]) =>
            bytes.length >= magic.length && magic.every((byte, i) => byte === null || bytes[i] === byte));
        if (signature) {
            problems.push(`${file}: content is ${signature[0]}`);
        } else if (bytes.includes(0) || !isUtf8(bytes)) {
            problems.push(`${file}: binary content, not UTF-8 text (media under another name?)`);
        } else if (ships(file) && EMBEDDED_MEDIA.test(bytes.toString("utf8"))) {
            problems.push(`${file}: embeds media (a data: URI or inline SVG)`);
        }
    }
    return problems;
}

/** Run the check and return the exit code. `log` receives each output line. */
export function run(root, log = console.log) {
    const problems = checkAssets(root);
    for (const problem of problems) log(`error: ${problem}`);
    log(problems.length ? `Asset check failed: ${problems.length} problem(s).` : "Asset check passed: no media files.");
    return problems.length ? 1 : 0;
}

if (import.meta.main) {
    process.exitCode = run(join(import.meta.dirname, ".."));
}
