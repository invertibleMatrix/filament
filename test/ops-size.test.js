// @ts-check
// The operation log's file (services/oplog.js) as the perf pass left it: the log learns the file's size once, with a
// stat, and keeps it as it appends and rotates — it is the file's one writer — so an operation's append costs no stat
// (the noisy kinds, engineop and search, are written for every engine call and every memory search). The file rotates
// at the same moment it did: the first append that finds it past 20 MB moves it to `.1`. The stats are counted on
// node:fs/promises itself, which the log imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpLog as OpLogClass } from "../src/services/oplog.js";

/** The log, its options as the server passes them (the module is not type-checked: its defaults would narrow them). */
const OpLog = /** @type {any} */ (OpLogClass);

const fsp = createRequire(import.meta.url)("node:fs/promises");

/** The stats of a path ending in `tail` until `restore`. @param {string} tail */
function countStats(tail) {
  const real = fsp.stat;
  let n = 0;
  fsp.stat = (/** @type {any[]} */ ...args) => {
    if (String(args[0]).endsWith(tail)) n++;
    return real(...args);
  };
  syncBuiltinESMExports();
  return {
    get n() {
      return n;
    },
    restore() {
      fsp.stat = real;
      syncBuiltinESMExports();
    },
  };
}

const MAX = 20 * 1024 * 1024;

// (fails before: yes — each append stat the file first: 50 stats for 50 operations)
test("fifty operations written: the file's size is learned once, not at each append", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-ops-size-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ops = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  const spy = countStats("ops.jsonl");
  try {
    for (let i = 0; i < 50; i++) ops.record("job", `job ${i} finished`, { detail: { i } });
    await ops.flush();
  } finally {
    spy.restore();
  }
  assert.equal(spy.n, 1, "one stat, for the size the file had");
  const lines = readFileSync(join(dir, "ops.jsonl"), "utf8").trim().split("\n");
  assert.deepEqual(lines.map((l) => JSON.parse(l).title), Array.from({ length: 50 }, (_, i) => `job ${i} finished`), "every operation, in order");
});

// (fails before: no — a guard: the stat at each append rotated at this same append)
test("the file rotates at the first append that finds it past 20 MB, as before: an old log at start, and one grown past it while running", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-ops-size-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ops.jsonl");
  /** A line of exactly `bytes`, newline and all. @param {number} bytes */
  const filler = (bytes) => {
    const line = (/** @type {number} */ n) => `${JSON.stringify({ id: "f", ts: new Date(0).toISOString(), kind: "job", title: "x".repeat(n) })}\n`;
    return line(bytes - line(0).length);
  };
  // Past the cap already: the first append moves it.
  writeFileSync(file, filler(MAX + 10));
  const a = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  a.record("job", "first");
  await a.flush();
  assert.equal(readFileSync(`${file}.1`, "utf8").length, MAX + 10, "the old log, moved whole");
  assert.deepEqual(readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l).title), ["first"]);
  // Just under the cap: the append that takes it past is written there, the next one moves it.
  rmSync(`${file}.1`);
  writeFileSync(file, filler(MAX - 50));
  const b = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  b.record("job", "over");
  await b.flush();
  assert.equal(existsSync(`${file}.1`), false, "not past the cap before it was written: no rotation");
  b.record("job", "after");
  await b.flush();
  assert.deepEqual(readFileSync(`${file}.1`, "utf8").trim().split("\n").slice(-1).map((l) => JSON.parse(l).title), ["over"], "the line that took it past went with it");
  assert.deepEqual(readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l).title), ["after"]);
  // A file named anew by the configuration is its own size.
  b.configure({ ops: { enabled: true, logFile: "ops2.jsonl" } });
  writeFileSync(join(dir, "ops2.jsonl"), filler(MAX + 10));
  b.record("job", "elsewhere");
  await b.flush();
  assert.equal(existsSync(join(dir, "ops2.jsonl.1")), true, "the other file, past the cap, moved");
});

// (fails before: yes — the bug hunt of 10-30, L6's sibling: the restart's read took the log's tail as whole whatever
// the read answered, so a short read left zeros where the newest operations were, and the System tab lost them)
test("a restart that reads the log a few bytes at a time still brings every operation back", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-ops-size-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lines = Array.from({ length: 20 }, (_, i) => JSON.stringify({ id: `op${i}`, ts: new Date(i * 1000).toISOString(), kind: "job", title: `job ${i}` }));
  writeFileSync(join(dir, "ops.jsonl"), lines.join("\n") + "\n");
  const fs = createRequire(import.meta.url)("node:fs");
  const real = fs.readSync;
  fs.readSync = (/** @type {number} */ fd, /** @type {Buffer} */ buffer, /** @type {number} */ offset, /** @type {number} */ length, /** @type {number} */ position) =>
    real(fd, buffer, offset, Math.min(7, length), position);
  syncBuiltinESMExports();
  /** @type {any} */
  let ops;
  try {
    ops = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  } finally {
    fs.readSync = real;
    syncBuiltinESMExports();
  }
  assert.deepEqual(ops.ops.map((/** @type {any} */ o) => o.title), Array.from({ length: 20 }, (_, i) => `job ${i}`));
});
