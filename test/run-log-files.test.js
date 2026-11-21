// @ts-check
// The run log's files, as the perf pass left them: a running run writes through the file it holds open (B1), a page of
// a run's events is found by its number and a running run's file is not parsed again for every page (A4), and the runs
// list and the run-exists check answer from an index of the run files instead of the disk (B8) — each saying exactly
// what it said before. The disk calls are counted on node:fs itself, which the log imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog, eventJson } from "../src/services/runs.js";

const fs = createRequire(import.meta.url)("node:fs");
const scratch = () => mkdtempSync(join(tmpdir(), "filament-runfiles-"));
const knobs = (over = {}) => () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 100, keepRuns: 10, ...over } } });

/**
 * Count the calls the log makes to node:fs, by name and first argument, until `restore`.
 * @param {string[]} names
 */
function countFs(names) {
  /** @type {Record<string, any>} */
  const real = {};
  /** @type {{ name: string, arg: any, out?: any }[]} */
  const calls = [];
  for (const name of names) {
    real[name] = fs[name];
    fs[name] = (/** @type {any[]} */ ...args) => {
      const call = { name, arg: args[0] };
      calls.push(call);
      const out = real[name](...args);
      Object.assign(call, { out });
      return out;
    };
  }
  syncBuiltinESMExports();
  return {
    calls,
    /** The calls of `name` on a path ending in `tail`. @param {string} name @param {string} tail */
    on: (name, tail) => calls.filter((c) => c.name === name && String(c.arg).endsWith(tail)),
    restore() {
      Object.assign(fs, real);
      syncBuiltinESMExports();
    },
  };
}

// (fails before: yes — every event was an appendFileSync: an open, a write and a close, 52 of each for this run)
test("a running run writes through the file it holds open: one open for its life, a write an event, the close at its end", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ maxPerRun: 1000 }) });
  const spy = countFs(["openSync", "writeSync", "closeSync", "appendFileSync"]);
  try {
    runs.startRun({ id: "r", kind: "agent-turn" });
    for (let i = 0; i < 50; i++) bus.publish("run:r", { type: "tool-output", round: 1, id: "c1", text: `line ${i}` });
    // Read while it is held: Node opens it shared, so a reader (and on Windows a delete) is never locked out.
    assert.equal(readFileSync(join(dir, "runs", "r.jsonl"), "utf8").trim().split("\n").length, 51);
    runs.endRun("r");
    assert.equal(spy.on("appendFileSync", "r.jsonl").length, 0, "no event of the running run opened the file again");
    const opened = spy.on("openSync", "r.jsonl");
    assert.equal(opened.length, 1, "one open for the run's life");
    const fd = opened[0].out;
    assert.equal(spy.calls.filter((c) => c.name === "writeSync" && c.arg === fd).length, 52, "a write an event: the start, fifty, the end");
    assert.equal(spy.calls.filter((c) => c.name === "closeSync" && c.arg === fd).length, 1, "closed at its end");
    // After its end, an event (a background sub-agent's, late) appends with an open and a close of its own.
    bus.publish("run:r", { type: "subagent-report", round: 1 });
    assert.equal(spy.on("appendFileSync", "r.jsonl").length, 1);
  } finally {
    spy.restore();
  }
  const lines = readFileSync(join(dir, "runs", "r.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.n), Array.from({ length: 53 }, (_, i) => i + 1), "every event on file once, in order");
  assert.deepEqual(lines, /** @type {any} */ (runs.events("r", { since: 0 })).events, "the file says what the ring says");
  // Its file let go of at the end: removed with the folder while the log still runs.
  rmSync(join(dir, "runs"), { recursive: true });
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a run's file is let go of at shutdown; a run held open is swept around and written on as before", async () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ retentionDays: 1 }) });
  runs.startRun({ id: "held", kind: "agent-turn" });
  bus.publish("run:held", { type: "round-start", round: 1 });
  runs.startRun({ id: "old", kind: "agent-turn" });
  runs.endRun("old");
  const ancient = (Date.now() - 3 * 86400_000) / 1000;
  for (const id of ["held", "old"]) utimesSync(join(dir, "runs", `${id}.jsonl`), ancient, ancient);
  assert.equal(await runs.sweep(), 1, "the ended run's file is swept, the running one's kept");
  assert.deepEqual(readdirSync(join(dir, "runs")), ["held.jsonl"]);
  bus.publish("run:held", { type: "round-text", round: 1, text: "still written" });
  assert.equal(readFileSync(join(dir, "runs", "held.jsonl"), "utf8").trim().split("\n").length, 3, "the held file is written on after the sweep");
  const spy = countFs(["closeSync"]);
  try {
    runs.close();
    assert.equal(spy.calls.length, 1, "shutdown closes the file the running run held");
  } finally {
    spy.restore();
  }
  rmSync(dir, { recursive: true });
});

// (fails before: yes — each append dropped the run's kept parse, so every page of a long running run read its whole
// file again: three reads here. Since 11-15 no parse is kept at all, only the file's index, which its appends keep:
// each page opens the file once and reads from the index's mark before it)
test("a long running run's file is never read whole while it runs, however many pages are asked of it — and every page is what a fresh read gives", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ maxPerRun: 100 }) });
  runs.startRun({ id: "long", kind: "agent-turn" });
  for (let i = 0; i < 150; i++) bus.publish("run:long", { type: "tick", i });
  const spy = countFs(["readFileSync", "openSync"]);
  /** @type {any[][]} */
  const pages = [];
  try {
    // The ring holds the newest hundred: a page from the start is read from the file.
    pages.push(/** @type {any} */ (runs.events("long", { since: 0, limit: 1000 })).events);
    for (let i = 0; i < 10; i++) bus.publish("run:long", { type: "tick", i: 150 + i });
    pages.push(/** @type {any} */ (runs.events("long", { since: 0, limit: 1000 })).events);
    bus.publish("run:long", { type: "tick", i: 160 });
    pages.push(/** @type {any} */ (runs.events("long", { since: 20, limit: 7 })).events);
    assert.equal(spy.on("readFileSync", "long.jsonl").length, 0, "the file is never read whole");
    assert.equal(spy.on("openSync", "long.jsonl").length, 3, "a read a page, and none to index it: its appends did");
  } finally {
    spy.restore();
  }
  assert.deepEqual(pages.map((p) => p.length), [151, 161, 7]);
  // What a fresh log reads from the same file is what these pages said, page for page.
  const fresh = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs({ maxPerRun: 100 }) });
  const all = /** @type {any} */ (fresh.events("long", { since: 0, limit: 50000 })).events;
  assert.deepEqual(pages[1], all.slice(0, 161));
  assert.deepEqual(pages[2], all.filter((/** @type {any} */ e) => e.n > 20).slice(0, 7));
  // Every page by number, from the ring, the file, or both, is the filter it replaced.
  runs.endRun("long");
  // Let go of at its end, with its ring, the file is not read whole: what its appends wrote is in its index already,
  // and a page reads from the mark before it.
  const after = countFs(["readFileSync"]);
  /** @type {any[]} */
  let total;
  try {
    total = /** @type {any} */ (runs.events("long", { since: 0, limit: 50000 })).events;
    assert.equal(after.on("readFileSync", "long.jsonl").length, 0, "no whole read once the run let go of its file");
  } finally {
    after.restore();
  }
  assert.deepEqual(fresh.events("long", { since: 0, limit: 50000 })?.events, total, "the run's end read afresh from the file, as a fresh log reads it");
  for (const since of [0, 1, 50, 61, 62, 99, 100, 150, 161, 162, 163, 999])
    for (const limit of [1, 7, 1000]) {
      const page = /** @type {any} */ (runs.events("long", { since, limit }));
      assert.deepEqual(page.events, total.filter((/** @type {any} */ e) => e.n > since).slice(0, limit), `since ${since}, limit ${limit}`);
      assert.equal(page.gap, null);
    }
  // A late event (a background sub-agent's report) appends after the end: the next read has it once, as a fresh read.
  bus.publish("run:long", { type: "subagent-report", round: 1 });
  const late = /** @type {any} */ (runs.events("long", { since: 0, limit: 50000 })).events;
  assert.equal(late.length, total.length + 1);
  assert.deepEqual(late, fresh.events("long", { since: 0, limit: 50000 })?.events);
  fresh.close();
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — the log serialised each event for its file, and each viewer again for its client)
test("a live event is serialised once — for its file and every viewer that writes it as it is delivered — and its bytes are the event's", () => {
  for (const persist of [true, false]) {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist }) });
    runs.startRun({ id: "v", kind: "agent-turn" });
    /** @type {string[]} */
    const written = [];
    for (let i = 0; i < 3; i++) runs.subscribe("v", (e) => written.push(eventJson(e)));
    let serialised = 0;
    const real = JSON.stringify;
    JSON.stringify = /** @type {any} */ (function (/** @type {any} */ v, /** @type {any[]} */ ...rest) {
      if (v?.runId === "v" && v?.type === "tool-end") serialised++;
      return real.call(JSON, v, ...rest);
    });
    try {
      bus.publish("run:v", { type: "tool-end", round: 1, name: "bash", ok: false, preview: "Authorization: Bearer sk-ant-api03-verysecretkeyvalue1234567890" });
    } finally {
      JSON.stringify = real;
    }
    assert.equal(serialised, 1, `once, persist ${persist}`);
    const evt = /** @type {any} */ (runs.events("v", { since: 1 })).events[0];
    assert.deepEqual(written, [real(evt), real(evt), real(evt)], "each viewer writes the event as published, its key and all");
    if (persist) assert.ok(!/verysecretkeyvalue/.test(readFileSync(join(dir, "runs", "v.jsonl"), "utf8")), "the file's line is redacted from the same string");
    // An event read back (a replay) is not the one being delivered: it is serialised as it is asked for.
    assert.equal(eventJson(evt), real(evt));
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the list read the directory and stat each disk-only file, every 750 ms the page polled it, and
// the run-exists check stat a file per turn of the transcript)
test("the runs list and the run-exists check read nothing from the disk, and say what the directory says", async () => {
  const dir = scratch();
  // An earlier process's runs: two ended, one left open, and an empty file.
  const first = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  for (const id of ["past-a", "past-b", "past-open"]) first.startRun({ id, kind: "agent-turn" });
  first.endRun("past-a");
  first.endRun("past-b");
  first.close();
  writeFileSync(join(dir, "runs", "empty.jsonl"), "");
  const bus = createEventBus();
  // A clock that moves a millisecond a look, so no two runs start at once and the order is the list's to say.
  let clock = Date.now();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs(), now: () => clock++ });
  // This process's: twelve ended and one running (ten are kept in memory, the running one among them: the three
  // oldest leave), and one never written.
  for (let i = 0; i < 12; i++) {
    runs.startRun({ id: `done-${i}`, kind: i % 2 ? "subagent" : "agent-turn" });
    runs.endRun(`done-${i}`);
  }
  runs.startRun({ id: "running", kind: "agent-turn" });
  bus.publish("run:running", { type: "round-start", round: 1 });
  mkdirSync(join(dir, "elsewhere"), { recursive: true });
  const spy = countFs(["readdirSync", "statSync", "readFileSync", "openSync"]);
  /** @type {any[]} */
  let listed = [];
  /** @type {any[]} */
  let subagents = [];
  /** @type {Record<string, boolean>} */
  const exists = {};
  try {
    listed = runs.listRuns({ limit: 500 });
    subagents = runs.listRuns({ kind: "subagent", limit: 3 });
    for (const id of ["running", "done-0", "done-11", "past-a", "past-open", "empty", "never"]) exists[id] = runs.hasRun(id);
    assert.deepEqual(spy.calls.map((c) => c.name), [], "no look at the disk");
  } finally {
    spy.restore();
  }
  assert.deepEqual(exists, { running: true, "done-0": true, "done-11": true, "past-a": true, "past-open": true, empty: false, never: false });
  // What the list said before: every run in memory by its meta, every other file by its time, running first, newest first.
  const inMemory = new Set(listed.filter((m) => m.kind !== "unknown").map((m) => m.id));
  const onDisk = readdirSync(join(dir, "runs")).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6));
  assert.deepEqual(new Set(listed.map((m) => m.id)), new Set([...inMemory, ...onDisk]));
  for (const m of listed.filter((x) => !inMemory.has(x.id))) {
    const t = statSync(join(dir, "runs", `${m.id}.jsonl`)).mtimeMs;
    assert.deepEqual(m, { id: m.id, kind: "unknown", title: null, parentId: null, startedAt: t, endedAt: t, status: "ended", summary: null, meta: null, events: 0, firstAvailable: 0, persisted: true }, `${m.id}: as its file says`);
  }
  assert.deepEqual(new Set(listed.filter((m) => !inMemory.has(m.id)).map((m) => m.id)), new Set(["past-a", "past-b", "past-open", "empty", "done-0", "done-1", "done-2"]), "the earlier process's files, and the three runs that left memory");
  assert.equal(listed[0].id, "running");
  const order = listed.slice(1).map((m) => m.startedAt);
  assert.deepEqual(order, [...order].sort((a, b) => b - a), "newest first");
  assert.deepEqual(subagents.map((m) => m.id), ["done-11", "done-9", "done-7"], "the kind and the limit");
  // A file the sweep removes leaves the list with it; a new run's file joins it.
  const ancient = (Date.now() - 30 * 86400_000) / 1000;
  utimesSync(join(dir, "runs", "past-b.jsonl"), ancient, ancient);
  assert.equal(await runs.sweep(), 1);
  bus.publish("run:fresh", { type: "tick" });
  const after = runs.listRuns({ limit: 500 }).map((m) => m.id);
  assert.ok(!after.includes("past-b") && after.includes("fresh"));
  assert.deepEqual([runs.hasRun("past-b"), runs.hasRun("fresh")], [false, true]);
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});
