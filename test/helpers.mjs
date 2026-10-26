import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The repository root. */
export const ROOT = join(import.meta.dirname, "..");

/**
 * Write `files` (path to string, Buffer or JSON-able object) into a fresh temporary directory, removed
 * when the test ends.
 */
export function tempDir(t, files = {}) {
    const dir = mkdtempSync(join(tmpdir(), "artisans-workshop-test-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFiles(dir, files);
    return dir;
}

export function writeFiles(dir, files) {
    for (const [path, content] of Object.entries(files)) {
        const full = join(dir, path);
        mkdirSync(dirname(full), { recursive: true });
        const data = typeof content === "string" || Buffer.isBuffer(content) ? content : `${JSON.stringify(content, null, 2)}\n`;
        writeFileSync(full, data);
    }
}

/** Collects the lines a tool logs. */
export function logger() {
    const lines = [];
    const log = (line) => lines.push(line);
    log.lines = lines;
    log.text = () => lines.join("\n");
    return log;
}
