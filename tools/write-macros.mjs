/**
 * Write the copy-paste macros (DESIGN.md 11.1): one `macros/<id>.js` per entry of the catalogue
 * (`scripts/logic/macros.mjs`), holding the same line a hotbar macro made from the shelf holds. Run it after changing the
 * catalogue (`npm run macros`); `test/macros.test.mjs` fails while a file and the catalogue disagree, and on a file no
 * entry names. With `--check` it only reports, and exits non-zero on a difference.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MACROS, macroFile } from "../scripts/logic/macros.mjs";
import { MODULE_ID } from "../scripts/constants.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "macros");

/** What `macros/` should hold: file name to content. */
export function expectedFiles() {
    return Object.fromEntries(MACROS.map((entry) => [`${entry.id}.js`, macroFile(entry, MODULE_ID)]));
}

/** The differences between `macros/` and the catalogue: files missing, stale, or named by no entry. */
export function differences() {
    const want = expectedFiles();
    const have = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".js")) : [];
    return [
        ...Object.keys(want).filter((f) => !have.includes(f)).map((f) => ({ file: f, problem: "missing" })),
        ...have.filter((f) => want[f] !== undefined && readFileSync(join(DIR, f), "utf8") !== want[f]).map((f) => ({ file: f, problem: "stale" })),
        ...have.filter((f) => want[f] === undefined).map((f) => ({ file: f, problem: "unknown" })),
    ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const check = process.argv.includes("--check");
    const diff = differences();
    if (check) {
        for (const d of diff) console.log(`${d.problem}: macros/${d.file}`);
        process.exit(diff.length ? 1 : 0);
    }
    mkdirSync(DIR, { recursive: true });
    for (const d of diff.filter((x) => x.problem === "unknown")) rmSync(join(DIR, d.file));
    for (const [file, content] of Object.entries(expectedFiles())) writeFileSync(join(DIR, file), content);
    console.log(`Wrote ${MACROS.length} macros to macros/.`);
}
