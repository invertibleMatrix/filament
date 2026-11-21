// @ts-check
// A .zip of a few files (HarnessV4_Artifacts_Plan AF-D13): an artifact's version with files beside its page, saved as
// one download. Written with Node's own deflate and CRC-32, so no dependency: each entry deflated where that makes it
// smaller, else stored as it is; names in UTF-8, with `/`. Read back too (Import app…, the Space Apps plan of 10-29):
// stored and deflated entries, by its central directory, within bounds — never a path out of where it is unpacked.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/** A moment as a .zip entry's date and time (two seconds a step), in this machine's time. @param {Date} d */
const dosStamp = (d) => ({
  time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
  date: (((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
});

/** Entries whose names are UTF-8 (the general-purpose flag's bit 11). */
const UTF8 = 0x0800;

/**
 * The files as one .zip.
 * @param {{ path: string, data: Buffer }[]} files @param {Date} [when]  the time each entry carries
 * @returns {Buffer}
 */
export function zipOf(files, when = new Date()) {
  const { time, date } = dosStamp(when);
  /** @type {Buffer[]} */
  const local = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, "utf8");
    const packed = deflateRawSync(f.data);
    const deflated = packed.length < f.data.length;
    const body = deflated ? packed : f.data;
    const crc = crc32(f.data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(UTF8, 6);
    head.writeUInt16LE(deflated ? 8 : 0, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(UTF8, 8);
    entry.writeUInt16LE(deflated ? 8 : 0, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(f.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(head, name, body);
    central.push(entry, name);
    offset += head.length + name.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

/**
 * A .zip's files, by their paths with `/`; its folders' own entries left out. Refused in words: no .zip, one in parts or
 * of 4 GB (zip64), an entry sealed with a password or packed some way but stored or deflated, a name that climbs out of
 * it or is absolute, a file whose bytes do not match its CRC, more than `maxFiles` files or `maxBytes` bytes unpacked.
 * @param {Buffer} buf @param {{ maxBytes: number, maxFiles?: number }} o
 * @returns {{ ok: true, files: { path: string, data: Buffer }[] } | { ok: false, error: string }}
 */
export function unzipOf(buf, { maxBytes, maxFiles = 2000 }) {
  const no = (/** @type {string} */ error) => ({ ok: /** @type {const} */ (false), error });
  // Its end record, the last of its kind in the last 64 KB and 22 bytes (a comment may follow it).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) return no("it is not a .zip");
  const count = buf.readUInt16LE(end + 10);
  const dirAt = buf.readUInt32LE(end + 16);
  if (buf.readUInt16LE(end + 4) !== 0 || count === 0xffff || dirAt === 0xffffffff) return no("it is a .zip in parts, or one over 4 GB: Filament reads one whole .zip under 4 GB");
  /** @type {{ path: string, data: Buffer }[]} */
  const files = [];
  let total = 0;
  let at = dirAt;
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return no("its list of files does not read");
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16) >>> 0;
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const raw = buf.subarray(at + 46, at + 46 + nameLen);
    const path = (flags & UTF8 ? raw.toString("utf8") : raw.toString("latin1")).replace(/\\/g, "/");
    at += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue;
    if (flags & 1) return no(`${path} is sealed with a password`);
    if (method !== 0 && method !== 8) return no(`${path} is packed in a way Filament does not read (method ${method}): zip it again, stored or deflated`);
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some((p) => p === ".." || p === "")) return no(`${JSON.stringify(path.slice(0, 120))} is no path inside it`);
    if (files.length >= maxFiles) return no(`it holds more than ${maxFiles} files`);
    total += size;
    if (total > maxBytes) return no(`it holds more than Filament takes (${Math.round(maxBytes / 1048576)} MB unpacked)`);
    if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== 0x04034b50) return no(`${path} does not read`);
    const from = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const body = buf.subarray(from, from + packed);
    let data;
    try {
      data = method === 8 ? inflateRawSync(body, { maxOutputLength: Math.max(1, size) }) : Buffer.from(body);
    } catch {
      return no(`${path} does not unpack`);
    }
    if (data.length !== size || (crc32(data) >>> 0) !== crc) return no(`${path} does not unpack as it says it is`);
    files.push({ path, data });
  }
  return { ok: true, files };
}
