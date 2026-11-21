// @ts-check
// The operation log keeps rotated generations, as the request log does (records.js, BUG-22): at 20 MB the log becomes
// `.1`, the generations before it move down one, and only the oldest kept one goes. A restart reads back across them:
// the ring the System tab, a session's settings history and the Compactions tab read fills from the current file, then
// `.1`, `.2`, … until it is full — and reads no further.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpLog as OpLogClass } from "../src/services/oplog.js";

/** The log, its options as the server passes them (the module is not type-checked: its defaults would narrow them). */
const OpLog = /** @type {any} */ (OpLogClass);
const MAX = 20 * 1024 * 1024;
/** The rotated generations the log keeps, as many as the request log keeps. */
const GENERATIONS = 5;
/** One operation's line, written `at` seconds into 1970. @param {string} title @param {number} at */
const line = (title, at) => `${JSON.stringify({ id: title, ts: new Date(at * 1000).toISOString(), kind: "job", title })}\n`;
/** `n` operations named `name-0` … in order, from `at` on. @param {string} name @param {number} n @param {number} at */
const lines = (name, n, at) => Array.from({ length: n }, (_, i) => line(`${name}-${i}`, at + i)).join("");
/** The titles a file holds, in order. @param {string} file */
const titles = (file) => readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l).title);
const scratch = () => mkdtempSync(join(tmpdir(), "filament-ops-rot-"));
const fsp = createRequire(import.meta.url)("node:fs/promises");
/**
 * Another program holding files open: a move of one, or onto one, fails as Windows fails it, until the hold is let go.
 * @param {string[]} held @returns {() => void}  let go
 */
const holding = (held) => {
  const real = fsp.rename;
  fsp.rename = (/** @type {string} */ from, /** @type {string} */ to) =>
    held.includes(String(from)) || held.includes(String(to))
      ? Promise.reject(Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}' -> '${to}'`), { code: "EBUSY" }))
      : real(from, to);
  syncBuiltinESMExports();
  return () => {
    fsp.rename = real;
    syncBuiltinESMExports();
  };
};

// (fails before: yes — the bug hunt of 10-30: the log was renamed over its one `.1`, which nothing read, so the
// generation before it was lost and one 20 MB generation of history was all that survived)
test("a full operation log becomes .1 and the generations before it move down one: only the oldest kept one goes", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ops.jsonl");
  writeFileSync(file, "");
  truncateSync(file, MAX + 1); // past the limit without writing 20 MB
  for (let i = 1; i <= GENERATIONS; i++) writeFileSync(`${file}.${i}`, line(`gen${i}`, 100 - i));
  const ops = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  ops.record("job", "the first after");
  await ops.flush();
  assert.equal(statSync(`${file}.1`).size, MAX + 1, "the full log is the newest generation");
  for (let i = 2; i <= GENERATIONS; i++) assert.deepEqual(titles(`${file}.${i}`), [`gen${i - 1}`], `.${i} holds what .${i - 1} held`);
  assert.equal(existsSync(`${file}.${GENERATIONS + 1}`), false, "nothing past the kept generations");
  assert.deepEqual(titles(file), ["the first after"], "the operation starts a fresh log");
});

// (fails before: yes — the generations moved down before the log did, so a log another program held open left `.1`
// empty and moved them down again at every operation after, until none was left)
test("a log another program holds open takes the operations, every generation stays where it was, and it rotates at the first one once let go", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ops.jsonl");
  writeFileSync(file, "");
  truncateSync(file, MAX + 1);
  for (let i = 1; i <= GENERATIONS; i++) writeFileSync(`${file}.${i}`, line(`gen${i}`, 100 - i));
  const ops = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  const letGo = holding([file]);
  try {
    for (let i = 0; i < 3; i++) ops.record("job", `held ${i}`);
    await ops.flush();
  } finally {
    letGo();
  }
  for (let i = 1; i <= GENERATIONS; i++) assert.deepEqual(existsSync(`${file}.${i}`) ? titles(`${file}.${i}`) : null, [`gen${i}`], `.${i} is where it was`);
  assert.ok(statSync(file).size > MAX + 1, "the held log took the operations");
  ops.record("job", "let go");
  await ops.flush();
  assert.ok(statSync(`${file}.1`).size > MAX, "the full log is the newest generation");
  for (let i = 2; i <= GENERATIONS; i++) assert.deepEqual(titles(`${file}.${i}`), [`gen${i - 1}`], `.${i} holds what .${i - 1} held`);
  assert.deepEqual(titles(file), ["let go"], "the operation starts a fresh log");
});

// (fails before: yes — a restart read the current file alone, so one just after a rotation brought back next to
// nothing, and every reader of the log reads that ring)
test("a restart fills the ring from the current file, then each rotated generation, newest first, up to keepLast", (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ops.jsonl");
  writeFileSync(`${file}.2`, lines("two", 5, 0));
  writeFileSync(`${file}.1`, lines("one", 4, 10));
  writeFileSync(file, lines("now", 3, 20));
  const ops = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl", keepLast: 10 } } });
  assert.deepEqual(
    ops.ops.map((/** @type {any} */ o) => o.title),
    ["two-2", "two-3", "two-4", "one-0", "one-1", "one-2", "one-3", "now-0", "now-1", "now-2"],
    "the newest ten, oldest first",
  );
  assert.deepEqual(ops.list({ limit: 4 }).map((/** @type {any} */ o) => o.title), ["now-2", "now-1", "now-0", "one-3"], "and the list reads them newest first, across the files");
  assert.equal(ops.byId.get("one-0")?.title, "one-0", "each one by its id");
});

// (fails before: no — a guard: a ring the current file fills opens no rotated generation, so a start never reads the
// 100 MB behind it for operations it would not keep)
test("a ring the current file fills reads no rotated generation", (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ops.jsonl");
  writeFileSync(`${file}.1`, lines("one", 4, 0));
  writeFileSync(file, lines("now", 12, 10));
  const fs = createRequire(import.meta.url)("node:fs");
  const real = fs.openSync;
  /** @type {string[]} */
  const opened = [];
  fs.openSync = (/** @type {any[]} */ ...args) => {
    opened.push(String(args[0]));
    return real(...args);
  };
  syncBuiltinESMExports();
  /** @type {any} */
  let ops;
  try {
    ops = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl", keepLast: 10 } } });
  } finally {
    fs.openSync = real;
    syncBuiltinESMExports();
  }
  assert.deepEqual(ops.ops.map((/** @type {any} */ o) => o.title), Array.from({ length: 10 }, (_, i) => `now-${i + 2}`));
  assert.deepEqual(opened.filter((p) => p.startsWith(file)), [file], "the current file alone");
});
