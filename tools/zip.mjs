/**
 * A small zip writer and reader for the release package (DESIGN.md 16.2, 16.9), on Node's own zlib, so packaging needs
 * nothing installed. Entries are deflated (or stored when deflating does not help), carry a fixed timestamp
 * (1980-01-01 00:00, the format's epoch) and Unix permissions (0644 files, 0755 folders), so the same files always give
 * the same bytes, and a folder gets its own entry before its files. There is no Zip64: the package is a few hundred
 * kilobytes, and an archive past the classic format's limits (4 GiB, 65,535 entries) is refused. The reader is the
 * writer's check: it reads what `createZip` writes (and other plain zips), verifying every entry's CRC-32 and size.
 */
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01: years since 1980, month, day
const VERSION_MADE_BY = (3 << 8) | 20; // Unix, zip 2.0
const VERSION_NEEDED = 20; // deflate
const UTF8_NAMES = 0x0800;
const FILE_MODE = 0o100644;
const FOLDER_MODE = 0o040755;
const MS_DOS_FOLDER = 0x10;
const MAX = 0xffffffff;

/**
 * A zip archive of `entries`, in the order given.
 * @param {{name: string, data?: Buffer|string}[]} entries  "/"-separated names; a name ending in "/" is a folder
 * @returns {Buffer}
 */
export function createZip(entries) {
    if (entries.length >= 0xffff) throw new Error(`zip: ${entries.length} entries is more than the format holds without Zip64`);
    const parts = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
        const folder = entry.name.endsWith("/");
        if (!entry.name || entry.name.startsWith("/") || entry.name.split("/").includes("..") || entry.name.includes("\\")) {
            throw new Error(`zip: "${entry.name}" is not a relative "/"-separated path`);
        }
        const data = folder ? Buffer.alloc(0) : Buffer.from(entry.data ?? "");
        const deflated = folder ? data : deflateRawSync(data, { level: 9 });
        const method = !folder && deflated.length < data.length ? 8 : 0;
        const body = method === 8 ? deflated : data;
        const crc = crc32(data);
        if (data.length > MAX || offset > MAX) throw new Error("zip: the archive is larger than the format holds without Zip64");
        const name = Buffer.from(entry.name, "utf8");

        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL, 0);
        local.writeUInt16LE(VERSION_NEEDED, 4);
        local.writeUInt16LE(UTF8_NAMES, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);

        const record = Buffer.alloc(46);
        record.writeUInt32LE(CENTRAL, 0);
        record.writeUInt16LE(VERSION_MADE_BY, 4);
        record.writeUInt16LE(VERSION_NEEDED, 6);
        record.writeUInt16LE(UTF8_NAMES, 8);
        record.writeUInt16LE(method, 10);
        record.writeUInt16LE(DOS_TIME, 12);
        record.writeUInt16LE(DOS_DATE, 14);
        record.writeUInt32LE(crc, 16);
        record.writeUInt32LE(body.length, 20);
        record.writeUInt32LE(data.length, 24);
        record.writeUInt16LE(name.length, 28);
        // extra field, comment, disk number start, internal attributes: all 0
        record.writeUInt32LE((((folder ? FOLDER_MODE : FILE_MODE) << 16) | (folder ? MS_DOS_FOLDER : 0)) >>> 0, 38);
        record.writeUInt32LE(offset, 42);

        parts.push(local, name, body);
        central.push(record, name);
        offset += local.length + name.length + body.length;
    }
    const directory = Buffer.concat(central);
    if (offset > MAX || directory.length > MAX) throw new Error("zip: the archive is larger than the format holds without Zip64");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    // this disk and the directory's disk: 0
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, directory, end]);
}

/**
 * The entries of a zip archive, in its central directory's order. Throws on anything it cannot read or that fails its
 * CRC-32 or size.
 * @returns {{name: string, data: Buffer, folder: boolean, mode: number, method: number}[]}
 */
export function readZip(buffer) {
    let end = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
        if (buffer.readUInt32LE(i) === END) {
            end = i;
            break;
        }
    }
    if (end < 0) throw new Error("zip: no end of central directory record");
    const count = buffer.readUInt16LE(end + 10);
    let at = buffer.readUInt32LE(end + 16);
    const entries = [];
    for (let i = 0; i < count; i++) {
        if (buffer.readUInt32LE(at) !== CENTRAL) throw new Error(`zip: central directory entry ${i} is damaged`);
        const method = buffer.readUInt16LE(at + 10);
        const crc = buffer.readUInt32LE(at + 16);
        const compressedSize = buffer.readUInt32LE(at + 20);
        const size = buffer.readUInt32LE(at + 24);
        const nameLength = buffer.readUInt16LE(at + 28);
        const extraLength = buffer.readUInt16LE(at + 30);
        const commentLength = buffer.readUInt16LE(at + 32);
        const external = buffer.readUInt32LE(at + 38);
        const offset = buffer.readUInt32LE(at + 42);
        const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
        at += 46 + nameLength + extraLength + commentLength;

        if (buffer.readUInt32LE(offset) !== LOCAL) throw new Error(`zip: ${name}: local header is damaged`);
        const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
        const body = buffer.subarray(start, start + compressedSize);
        let data;
        if (method === 0) data = Buffer.from(body);
        else if (method === 8) data = inflateRawSync(body);
        else throw new Error(`zip: ${name}: compression method ${method} is not supported`);
        if (data.length !== size) throw new Error(`zip: ${name}: ${data.length} bytes, the directory says ${size}`);
        if (crc32(data) !== crc) throw new Error(`zip: ${name}: CRC-32 does not match`);
        entries.push({ name, data, folder: name.endsWith("/"), mode: external >>> 16, method });
    }
    return entries;
}
