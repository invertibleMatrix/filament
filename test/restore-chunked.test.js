// W3.2: restore reads the JSONL log backwards in chunks and stops once keepLastRequests records parse.
// The previous path allocated min(size, 66 MB) in one Buffer even when the last 500 rows were a few hundred KB.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastJsonlRecords, UsageStore } from "../src/usage.js";

const rec = (id, extra = {}) => JSON.stringify({ id, ts: `2026-09-18T00:00:${String(id).padStart(2, "0")}.000Z`, status: "ok", model: "m", ...extra });

test("readLastJsonlRecords: newest keep records, oldest first, pending restored as aborted", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-restore-"));
  const path = join(dir, "requests.jsonl");
  try {
    const lines = [];
    for (let i = 1; i <= 20; i++) lines.push(rec(i, i === 20 ? { status: "pending" } : {}));
    writeFileSync(path, lines.join("\n") + "\n");
    const { records, bytesRead } = readLastJsonlRecords(path, { keep: 5, chunkBytes: 64 });
    assert.equal(records.length, 5);
    assert.deepEqual(records.map((r) => r.id), [16, 17, 18, 19, 20]);
    assert.equal(records[4].status, "aborted", "an in-flight row at shutdown is aborted, not left pending forever");
    assert.ok(bytesRead > 0 && bytesRead < 2000, `stopped well before reading a whole file of 20 tiny rows (read ${bytesRead})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readLastJsonlRecords: a line split across the first chunk boundary still parses", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-restore-"));
  const path = join(dir, "requests.jsonl");
  try {
    const big = rec("big", { note: "x".repeat(80) });
    writeFileSync(path, `${rec(1)}\n${big}\n${rec(3)}\n`);
    const { records } = readLastJsonlRecords(path, { keep: 2, chunkBytes: 40 });
    assert.equal(records.length, 2);
    assert.equal(records[0].id, "big", "the straddling line was stitched, not dropped");
    assert.equal(records[1].id, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readLastJsonlRecords: a leading partial line from a truncated file is skipped, not thrown", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-restore-"));
  const path = join(dir, "requests.jsonl");
  try {
    writeFileSync(path, `{"id":"half","ts":"2026-0\n` + rec(2) + "\n" + rec(3) + "\n");
    const { records } = readLastJsonlRecords(path, { keep: 10, chunkBytes: 32 });
    assert.deepEqual(records.map((r) => r.id), [2, 3]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// (fails before: yes — the bug hunt of 10-30, L6: the tail read took each piece as whole whatever the read answered,
// so a short read left bytes of the piece unread and the records across them were dropped without a word)
test("readLastJsonlRecords: a read that answers fewer bytes than asked is read on, and no record is lost", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-restore-"));
  const path = join(dir, "requests.jsonl");
  const real = fs.readSync;
  /** Reads answered as a file system that gives at most seven bytes a read, or none below `floor`. @param {number} floor */
  const shortReads = (floor) => {
    fs.readSync = /** @type {any} */ ((/** @type {number} */ fd, /** @type {Buffer} */ buffer, /** @type {number} */ offset, /** @type {number} */ length, /** @type {number} */ position) =>
      position < floor ? 0 : real(fd, buffer, offset, Math.min(7, length), position));
    syncBuiltinESMExports();
  };
  try {
    // Twenty records of about 450 bytes: three of the scan's pieces (4 KB at the least).
    const lines = [];
    for (let i = 1; i <= 20; i++) lines.push(rec(i, { note: "x".repeat(400) }));
    writeFileSync(path, lines.join("\n") + "\n");
    const all = Array.from({ length: 20 }, (_, i) => i + 1);
    shortReads(0);
    assert.deepEqual(readLastJsonlRecords(path, { keep: 20, chunkBytes: 4096 }).records.map((r) => r.id), all, "every record, read a few bytes at a time");
    // A file shorter than when it was measured (the reads below the middle answer nothing): the scan ends on the
    // records it read whole, the newest, in order.
    shortReads(Math.floor(Buffer.byteLength(lines.join("\n")) / 2));
    const kept = readLastJsonlRecords(path, { keep: 20, chunkBytes: 4096 }).records.map((r) => r.id);
    assert.ok(kept.length > 0 && kept.length < 20, `some, not all: ${kept}`);
    assert.deepEqual(kept, all.slice(20 - kept.length), "the newest, whole and in order");
  } finally {
    fs.readSync = real;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the bug hunt of 10-30, beside the operation log's restart: a restart read the current log alone,
// so one just after a rotation brought back next to nothing of Traffic, the newest records being in `.1`)
test("UsageStore restore reads back across the log's rotated generations, newest first, up to keepLastRequests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-restore-"));
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(`${path}.2`, [rec(1), rec(2), rec(3)].join("\n") + "\n");
    writeFileSync(`${path}.1`, [rec(4), rec(5)].join("\n") + "\n");
    writeFileSync(path, [rec(6), rec(7)].join("\n") + "\n");
    const u = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false, keepLastRequests: 6 } });
    assert.deepEqual(u.records.map((r) => r.id), [2, 3, 4, 5, 6, 7], "the newest six, oldest first, from three files");
    assert.ok(u.records.every((r) => r.restored));
    assert.equal(u.byId.get(4)?.id, 4, "each one by its id");
    await u.flush();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// (fails before: no — a guard: a current log that fills the ring opens no generation behind it, so a start never reads
// the 250 MB behind it for records it would not keep)
test("UsageStore restore opens no rotated generation when the current log fills the ring", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-restore-"));
  const real = fs.openSync;
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(`${path}.1`, [rec(1), rec(2)].join("\n") + "\n");
    writeFileSync(path, [rec(3), rec(4), rec(5), rec(6)].join("\n") + "\n");
    /** @type {string[]} */
    const opened = [];
    fs.openSync = /** @type {any} */ ((/** @type {any[]} */ ...args) => {
      opened.push(String(args[0]));
      return /** @type {any} */ (real)(...args);
    });
    syncBuiltinESMExports();
    /** @type {any} */
    let u;
    try {
      u = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false, keepLastRequests: 3 } });
    } finally {
      fs.openSync = real;
      syncBuiltinESMExports();
    }
    assert.deepEqual(u.records.map((/** @type {any} */ r) => r.id), [4, 5, 6]);
    assert.deepEqual(opened.filter((p) => p.startsWith(path)), [path], "the current log alone");
    await u.flush();
  } finally {
    fs.openSync = real;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("UsageStore restore loads only keepLastRequests from a log with junk in front", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-restore-"));
  try {
    const path = join(dir, "requests.jsonl");
    const junk = Buffer.alloc(64 * 1024, 0x61); // 64 KB of 'a', no newlines — would dominate a whole-file read
    const tail = [rec("a"), rec("b"), rec("c")].join("\n") + "\n";
    writeFileSync(path, Buffer.concat([junk, Buffer.from("\n" + tail)]));
    const u = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false, keepLastRequests: 2 } });
    assert.equal(u.records.length, 2);
    assert.deepEqual(u.records.map((r) => r.id), ["b", "c"]);
    assert.ok(u.records.every((r) => r.restored), "restored rows are tagged so the UI can say they survived a restart");
    await u.flush();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
