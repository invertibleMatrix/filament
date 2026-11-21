// @ts-check
// The request log keeps several rotated generations (BUG-22, 2026-09-30). At 50 MB the log was renamed over its one
// `.1`, destroying the generation before — with agent records around 500 KB each that kept ~10 minutes of history,
// and the turn under investigation 20 minutes earlier (BUG-19) was already gone from disk. Now `.1` (newest) … `.N`
// (oldest) are kept, and the log's reach (how far back it goes) reads every generation, oldest first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, truncateSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageStore, rotateLog, MAX_LOG_BYTES, LOG_GENERATIONS, logGenerationFiles } from "../src/services/records.js";

const scratch = () => mkdtempSync(join(tmpdir(), "filament-logrot-"));
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
/** Every file in a folder, by name, with its text. @param {string} dir */
const files = (dir) => Object.fromEntries(readdirSync(dir).sort().map((n) => [n, readFileSync(join(dir, n), "utf8")]));

test("a rotation shifts every generation down one and drops only the oldest", async () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(path, "current\n");
    for (let i = 1; i <= LOG_GENERATIONS; i++) writeFileSync(`${path}.${i}`, `gen${i}\n`);
    await rotateLog(path);
    assert.equal(existsSync(path), false, "the current file became the newest generation");
    assert.equal(readFileSync(`${path}.1`, "utf8"), "current\n");
    for (let i = 2; i <= LOG_GENERATIONS; i++) assert.equal(readFileSync(`${path}.${i}`, "utf8"), `gen${i - 1}\n`, `.${i} holds what .${i - 1} held`);
    assert.equal(existsSync(`${path}.${LOG_GENERATIONS + 1}`), false, "nothing beyond the kept generations");
    // A gap (a generation never written yet) moves nothing into place and loses nothing.
    rmSync(`${path}.2`);
    writeFileSync(path, "newer\n");
    await rotateLog(path);
    assert.equal(readFileSync(`${path}.1`, "utf8"), "newer\n");
    assert.equal(readFileSync(`${path}.2`, "utf8"), "current\n");
    assert.equal(existsSync(`${path}.3`), false, "the gap moved down with the rest");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the bug hunt of 10-30, beside the operation log's generations: the generations moved down before
// the current file did, so a current file another program held open left `.1` empty and the oldest gone, and every
// append after moved them down again until none was left)
test("a current file another program holds open moves nothing: each generation stays where it was, and a later rotation moves them all once", async () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(path, "current\n");
    for (let i = 1; i <= LOG_GENERATIONS; i++) writeFileSync(`${path}.${i}`, `gen${i}\n`);
    const before = files(dir);
    const letGo = holding([path]);
    /** @type {any[]} */
    const moved = [];
    try {
      for (let i = 0; i < 3; i++) moved.push(await rotateLog(path));
    } finally {
      letGo();
    }
    assert.deepEqual(files(dir), before, "every file where it was, nothing set aside left behind");
    assert.deepEqual(moved, [false, false, false], "each rotation said it did not happen");
    assert.equal(await rotateLog(path), true, "let go, the next one does");
    assert.equal(readFileSync(`${path}.1`, "utf8"), "current\n");
    for (let i = 2; i <= LOG_GENERATIONS; i++) assert.equal(readFileSync(`${path}.${i}`, "utf8"), `gen${i - 1}\n`, `.${i} holds what .${i - 1} held`);
    assert.deepEqual(readdirSync(dir).sort(), Array.from({ length: LOG_GENERATIONS }, (_, i) => `requests.jsonl.${i + 1}`), "the oldest went, and nothing else is there");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — as above: a generation held open stayed, the one below it was renamed over it where Windows let
// it, and the current file over `.1`, so two generations were lost in one rotation)
test("a generation another program holds open stops the rotation whole: nothing moves, nothing is lost", async () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(path, "current\n");
    for (let i = 1; i <= LOG_GENERATIONS; i++) writeFileSync(`${path}.${i}`, `gen${i}\n`);
    const before = files(dir);
    const letGo = holding([`${path}.2`]);
    let moved;
    try {
      moved = await rotateLog(path);
    } finally {
      letGo();
    }
    assert.deepEqual(files(dir), before, "every move it made was undone");
    assert.equal(moved, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the log's files are listed oldest first: .N … .1, then the current one, gaps skipped", () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    assert.deepEqual(logGenerationFiles(path), [], "no log yet");
    writeFileSync(`${path}.3`, "a\n");
    writeFileSync(`${path}.1`, "b\n");
    writeFileSync(path, "c\n");
    assert.deepEqual(logGenerationFiles(path), [`${path}.3`, `${path}.1`, path]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The owner's other agent undid the rotation call in the request log's writer and every test above still passed: they
// test rotateLog alone. This one goes through the writer itself.
test("the request log's writer rotates a full log before it appends: the full one becomes .1, the older ones move down", async () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(path, "");
    truncateSync(path, MAX_LOG_BYTES + 1); // past the limit without writing 50 MB
    writeFileSync(`${path}.1`, "older\n");
    const store = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false } });
    store.persist({ id: "r-new", ts: new Date().toISOString(), status: "ok" });
    await store.flush();
    assert.equal(statSync(`${path}.1`).size, MAX_LOG_BYTES + 1, "the full log is the newest generation now");
    assert.equal(readFileSync(`${path}.2`, "utf8"), "older\n", "the one before moved down, not overwritten");
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 1, "the new record starts a fresh log");
    assert.equal(JSON.parse(lines[0]).id, "r-new");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — as the held file above, through the writer: each append past the limit moved the generations
// down again while the full log stayed where it was)
test("the request log's writer, its full log held open: the records go on into it, the generations stay, and it rotates at the first append once let go", async () => {
  const dir = scratch();
  try {
    const path = join(dir, "requests.jsonl");
    writeFileSync(path, "");
    truncateSync(path, MAX_LOG_BYTES + 1);
    writeFileSync(`${path}.1`, "older\n");
    const store = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false } });
    const letGo = holding([path]);
    try {
      for (const id of ["r-1", "r-2"]) store.persist({ id, ts: new Date().toISOString(), status: "ok" });
      await store.flush();
    } finally {
      letGo();
    }
    assert.equal(existsSync(`${path}.1`) ? readFileSync(`${path}.1`, "utf8") : null, "older\n", ".1 is where it was");
    assert.equal(existsSync(`${path}.2`), false, "and nothing moved below it");
    assert.ok(statSync(path).size > MAX_LOG_BYTES + 1, "the held log took the records");
    store.persist({ id: "r-3", ts: new Date().toISOString(), status: "ok" });
    await store.flush();
    assert.ok(statSync(`${path}.1`).size > MAX_LOG_BYTES, "the full log is the newest generation");
    assert.equal(readFileSync(`${path}.2`, "utf8"), "older\n");
    assert.deepEqual(readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id), ["r-3"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
