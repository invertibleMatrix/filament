// @ts-check
// The run files' sweep and the pictures kept beside them (services/runs.js, services/run-images.js) as the perf pass
// left them. The sweep lists the run files and reads their times off the event loop, a batch at a time, and does on it
// only what a removal needs: a data folder holds thousands of run files, and the sweep read them all in one blocking
// pass at the start and every six hours. The pictures are kept in an index the store keeps as it writes, so a picture
// kept at the cap no longer reads the whole folder (some 40 ms for 2,000 pictures, at every picture). Which files go
// and which stay is as before. The disk calls are counted on node:fs itself, which both import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { createRunImages } from "../src/services/run-images.js";

const fs = createRequire(import.meta.url)("node:fs");
const knobs = (/** @type {any} */ over = {}) => () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 100, keepRuns: 10, ...over } } });
const DAY = 86400_000;

/**
 * The synchronous calls to node:fs named, on paths under `under`, until `restore`.
 * @param {string[]} names @param {string} under
 */
function countSync(names, under) {
  /** @type {Record<string, any>} */
  const real = {};
  /** @type {Record<string, number>} */
  const n = Object.fromEntries(names.map((x) => [x, 0]));
  for (const name of names) {
    real[name] = fs[name];
    fs[name] = (/** @type {any[]} */ ...args) => {
      if (String(args[0]).startsWith(under)) n[name]++;
      return real[name](...args);
    };
  }
  syncBuiltinESMExports();
  return {
    n,
    restore() {
      Object.assign(fs, real);
      syncBuiltinESMExports();
    },
  };
}

/** A PNG of `size` bytes, one of its own by `seed`. @param {number} size @param {number} seed */
const png = (size, seed) => {
  const b = Buffer.alloc(size, seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(seed, 8);
  return b;
};

// (fails before: yes — the sweep listed the folders and stat every run file on the event loop: 3 readdirSync (the run
// files', the pictures' twice) and 300 statSync for 300 files, 5 of them past the retention)
test("the sweep reads the run files' times off the event loop: on it, only a look at each file it removes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sweep-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runsDir = join(dir, "runs");
  mkdirSync(runsDir, { recursive: true });
  const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  t.after(() => runs.close());
  // Written as the log runs (a start's sweep would take the old ones before this one is asked).
  const ancient = (Date.now() - 30 * DAY) / 1000;
  for (let i = 0; i < 300; i++) {
    const f = join(runsDir, `r${i}.jsonl`);
    writeFileSync(f, `${JSON.stringify({ n: 1, ts: 1, runId: `r${i}`, type: "run-start", kind: "agent-turn" })}\n`);
    if (i % 60 === 0) utimesSync(f, ancient, ancient);
  }
  const spy = countSync(["readdirSync", "statSync", "rmSync"], runsDir);
  let removed;
  try {
    removed = await runs.sweep();
  } finally {
    spy.restore();
  }
  assert.equal(removed, 5, "the five past the retention");
  assert.deepEqual(spy.n, { readdirSync: 0, statSync: 5, rmSync: 5 }, "on the event loop: a look at each file it removes, and its removal");
  assert.equal(readdirSync(runsDir).length, 295);
  for (const i of [0, 60, 120, 180, 240]) assert.equal(existsSync(join(runsDir, `r${i}.jsonl`)), false, `r${i} went`);
});

// (fails before: yes — the sweep ran whole as it was called, before the run started again: it removed back's file too
// (2), and the run's start began a file anew; now the start lands while the sweep reads, as had it come just before it)
test("what happens while the sweep reads is as it would be before or after it: a run that starts keeps its file, a second sweep removes nothing", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sweep-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ retentionDays: 1 }) });
  t.after(() => runs.close());
  for (const id of ["gone", "back", "live"]) {
    runs.startRun({ id, kind: "agent-turn" });
    if (id !== "live") runs.endRun(id);
  }
  const ancient = (Date.now() - 3 * DAY) / 1000;
  for (const id of ["gone", "back", "live"]) utimesSync(join(dir, "runs", `${id}.jsonl`), ancient, ancient);
  const first = runs.sweep();
  const second = runs.sweep();
  // While the first reads: a run of an old id starts again, and writes its file.
  runs.startRun({ id: "back", kind: "agent-turn" });
  assert.deepEqual([await first, await second], [1, 0], "one removed, by the first; the second, asked while it ran, removed nothing");
  assert.deepEqual(readdirSync(join(dir, "runs")).sort(), ["back.jsonl", "live.jsonl"], "the running run's file stays, and the one written again");
  assert.deepEqual(runs.events("back", { since: 0 })?.events.map((e) => e.type), ["run-start", "run-end", "run-start"], "written on, whole");
  assert.equal(await runs.sweep(), 0, "and a sweep after has nothing left past the retention");
});

// (fails before: yes — every picture kept past the cap read the folder whole, a readdirSync and a statSync of each
// picture: 10 readdirSync for 10 pictures)
test("a picture kept at the cap reads no folder: the store's index has every picture's size and last use", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-pics-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const k = { persist: true, retentionDays: 7, imagesMaxMB: (5 * 1000 + 10) / 1048576 };
  const s = createRunImages({ dir, knobs: () => k });
  /** @type {string[]} */
  const refs = [];
  for (let i = 1; i <= 5; i++) refs.push(s.keep([{ data: png(1000, i).toString("base64") }]).images[0].ref);
  const spy = countSync(["readdirSync", "statSync"], dir);
  try {
    for (let i = 6; i <= 15; i++) refs.push(s.keep([{ data: png(1000, i).toString("base64") }]).images[0].ref);
  } finally {
    spy.restore();
  }
  assert.equal(spy.n.readdirSync, 0, "no read of the folder");
  assert.ok(spy.n.statSync <= 30, `a look at the picture kept and each it removes, no more (${spy.n.statSync})`);
  assert.deepEqual(readdirSync(dir).sort(), refs.slice(-5).sort(), "the five newest stay, as the cap holds five");
});

// (fails before: yes — the sweep ran whole as it was called, before the picture was used again: it removed it too (2),
// and the use wrote it anew; now the use lands while the sweep reads, as had it come just before it)
test("a picture used again while the sweep reads the folder stays; one past its retention goes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-pics-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const k = { persist: true, retentionDays: 7, imagesMaxMB: 500 };
  const s = createRunImages({ dir, knobs: () => k });
  const [old, used, fresh] = [1, 2, 3].map((i) => s.keep([{ data: png(500, i).toString("base64") }]).images[0].ref);
  const t8 = (Date.now() - 8 * DAY) / 1000;
  for (const r of [old, used]) utimesSync(join(dir, r), t8, t8);
  const sweeping = s.sweep();
  s.keep([{ data: png(500, 2).toString("base64") }]);
  assert.equal(await sweeping, 1, "one past seven days");
  assert.deepEqual([s.fileOf(old), !!s.fileOf(used), !!s.fileOf(fresh)], [null, true, true], "used again as the sweep read: it stays");
});
