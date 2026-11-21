// @ts-check
// The run log keeps a window in memory (services/runs.js, the owner's of 11-15 after the server ran out of memory twice
// on 11-14): a running run's ring is capped by the size of its events, an ended run keeps none once its file holds
// them all, an event too large for a line is kept whole beside the file, and a page of a long file is read from the
// index's mark before it — each read giving exactly what a fresh log reads from the same file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";

const fs = createRequire(import.meta.url)("node:fs");
const scratch = () => mkdtempSync(join(tmpdir(), "filament-runwindow-"));
const knobs = (over = {}) => () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 20000, keepRuns: 50, ...over } } });
/** A fresh log over the same folder: what the disk alone says. @param {string} dir */
const freshRead = (dir, id) => {
  const fresh = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  const all = fresh.events(id, { since: 0, limit: 50000 })?.events;
  fresh.close();
  return all;
};

// (fails before: yes — the ring kept up to 20,000 events of any size: here all 3,000, some 15 MB of them)
test("a running run keeps its newest events in memory up to ringMB, never fewer than 200, and every event still reads back", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ ringMB: 2 }) });
  runs.startRun({ id: "big", kind: "agent-turn" });
  const text = "w".repeat(5000);
  for (let i = 0; i < 3000; i++) bus.publish("run:big", { type: "round-text", round: 1, text: `${i}:${text}` });
  const held = runs.memory();
  assert.ok(held.chars <= 2e6, `under the cap: ${held.chars} characters`);
  assert.ok(held.events >= 200 && held.events < 500, `a window, not the run: ${held.events} events`);
  const all = /** @type {any} */ (runs.events("big", { since: 0, limit: 50000 }));
  assert.equal(all.gap, null);
  assert.deepEqual(all.events.map((/** @type {any} */ e) => e.n), Array.from({ length: 3001 }, (_, i) => i + 1), "every number, once, in order");
  assert.deepEqual(all.events, freshRead(dir, "big"), "what the file says");
  runs.close();
  rmSync(dir, { recursive: true, force: true });
  // The newest 200 are always in memory, however large: what is read of what a turn does now.
  const other = scratch();
  const floorBus = createEventBus();
  const floor = createRunLog({ events: floorBus, dataDir: other, config: knobs({ ringMB: 0 }) });
  floor.startRun({ id: "floor", kind: "agent-turn" });
  for (let i = 0; i < 500; i++) floorBus.publish("run:floor", { type: "tick", i, text });
  assert.equal(floor.memory().events, 200);
  assert.equal(floor.getRun("floor")?.firstAvailable, 302);
  assert.equal(floor.events("floor", { since: 0, limit: 50000 })?.events.length, 501);
  floor.close();
  rmSync(other, { recursive: true, force: true });
});

// (fails before: yes — an ended run kept its ring among the newest keepRuns: 1,001 events here)
// (the review of 11-16: and nothing of what its file holds otherwise than published — before, up to ringMB of it, keys
// and all, for each of the newest keepRuns)
test("an ended run keeps no ring once its file holds every event: read from the file, as after a restart, a key redacted", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "done", kind: "agent-turn" });
  for (let i = 0; i < 1000; i++) bus.publish("run:done", { type: "tick", i });
  bus.publish("run:done", { type: "tool-end", round: 1, name: "bash", ok: false, preview: "401: Authorization: Bearer sk-ant-api03-verysecretkeyvalue1234567890" });
  const live = /** @type {any} */ (runs.events("done", { since: 0, limit: 50000 })).events;
  assert.match(live.find((/** @type {any} */ e) => e.type === "tool-end").preview, /verysecretkeyvalue/, "the live view is the developer's own");
  runs.endRun("done");
  assert.deepEqual(runs.memory(), { runs: 1, events: 0, chars: 0, asSent: 0, indexes: 1 }, "the ring let go of, and what was kept as published");
  const after = /** @type {any} */ (runs.events("done", { since: 0, limit: 50000 }));
  assert.equal(after.gap, null);
  assert.deepEqual(after.events.slice(0, -1).filter((/** @type {any} */ e) => e.type !== "tool-end"), live.filter((/** @type {any} */ e) => e.type !== "tool-end"), "what it read while it ran, then its end");
  assert.equal(after.events.at(-1).type, "run-end");
  assert.doesNotMatch(after.events.find((/** @type {any} */ e) => e.type === "tool-end").preview, /verysecretkeyvalue/, "the key as its file holds it");
  assert.deepEqual(after.events, freshRead(dir, "done"), "as a restart reads it");
  assert.doesNotMatch(JSON.stringify(freshRead(dir, "done")), /verysecretkeyvalue/, "the key does not outlive the run on disk");
  assert.deepEqual(runs.getRun("done")?.status, "done");
  // An event after the end (a background sub-agent's report) is read from the file with the rest, once.
  bus.publish("run:done", { type: "subagent-report", round: 1, agentId: "a", description: "late", kind: "report" });
  assert.equal(runs.memory().events, 0);
  const late = /** @type {any} */ (runs.events("done", { since: 0, limit: 50000 })).events;
  assert.equal(late.length, after.events.length + 1);
  assert.equal(late.at(-1).afterEnd, true);
  // A run whose events are kept in memory alone keeps them past its end: they are its one copy.
  const mem = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false }) });
  mem.startRun({ id: "mem", kind: "agent-turn" });
  for (let i = 0; i < 10; i++) bus.publish("run:mem", { type: "tick", i });
  mem.endRun("mem");
  assert.equal(mem.memory().events, 12);
  assert.equal(mem.events("mem", { since: 0 })?.events.length, 12);
  mem.close();
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — such an event was an envelope with its size alone, on disk and in every read once the ring had
// let go of it)
test("an event too large for a line is kept whole beside the run's file: read back whole, swept with it", async () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "huge", kind: "agent-turn" });
  const graph = { goal: "g", tasks: Array.from({ length: 3000 }, (_, i) => ({ id: `t${i}`, name: "x".repeat(100) })) };
  bus.publish("run:huge", { type: "graph", round: 1, graph });
  bus.publish("run:huge", { type: "tick" });
  runs.endRun("huge");
  const lines = readFileSync(join(dir, "runs", "huge.jsonl"), "utf8").split("\n");
  assert.ok(lines.every((l) => l.length < 4096), "the line is an envelope");
  assert.match(lines[1], /"truncated":\d+.*"body":true/);
  const back = /** @type {any} */ (runs.events("huge", { since: 0 })).events;
  assert.deepEqual(back.map((/** @type {any} */ e) => e.type), ["run-start", "graph", "tick", "run-end"]);
  assert.deepEqual(back[1].graph, graph, "whole, from its body");
  assert.deepEqual(freshRead(dir, "huge"), back);
  // Its body gone, the envelope says its size, as it always did.
  const body = join(dir, "runs", "bodies", "huge", "2.json");
  assert.ok(existsSync(body));
  const kept = readFileSync(body);
  rmSync(body);
  assert.equal(/** @type {any} */ (freshRead(dir, "huge"))[1].truncated > 256 * 1024, true);
  writeFileSync(body, kept);
  // The sweep removes the bodies with the run's file.
  const ancient = (Date.now() - 30 * 86400_000) / 1000;
  utimesSync(join(dir, "runs", "huge.jsonl"), ancient, ancient);
  await runs.sweep();
  assert.equal(existsSync(join(dir, "runs", "huge.jsonl")), false);
  assert.equal(existsSync(join(dir, "runs", "bodies", "huge")), false);
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: no — the log read the file whole once and kept its parse, so its pages read nothing more; what it kept
// is what the crashes of 11-14 held. A guard that the index finds each page's stretch, on and across its marks)
test("a page of a long run's file is read from the index's mark before it, not from the file's start", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "long", kind: "agent-turn" });
  for (let i = 0; i < 6000; i++) bus.publish("run:long", { type: "tick", i, pad: "p".repeat(400) });
  runs.endRun("long");
  const size = statSync(join(dir, "runs", "long.jsonl")).size;
  const all = freshRead(dir, "long") || [];
  // A fresh log: its first read indexes the file, its pages after it read only their stretch.
  const again = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  assert.equal(again.getRun("long")?.events, 6002);
  const real = fs.readSync;
  let bytes = 0;
  fs.readSync = (/** @type {any[]} */ ...args) => {
    const got = real(...args);
    bytes += got;
    return got;
  };
  syncBuiltinESMExports();
  /** @type {any} */
  let page;
  try {
    page = again.events("long", { since: 5900, limit: 10 });
  } finally {
    fs.readSync = real;
    syncBuiltinESMExports();
  }
  assert.ok(bytes < size / 10, `a stretch of the file: ${bytes} of ${size} bytes`);
  assert.deepEqual(page.events, all.filter((/** @type {any} */ e) => e.n > 5900).slice(0, 10));
  for (const since of [0, 1, 255, 256, 257, 511, 512, 4000, 6001, 6002, 7000])
    for (const limit of [1, 300, 50000])
      assert.deepEqual(again.events("long", { since, limit })?.events, all.filter((/** @type {any} */ e) => e.n > since).slice(0, limit), `since ${since}, limit ${limit}`);
  again.close();
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — a page of a run its ring had let go of, read from a file that would not read, came back short
// with no gap, and every reader takes a short page for the run's end)
test("a file that would not read is a gap, never a short page", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "locked", kind: "agent-turn" });
  for (let i = 0; i < 50; i++) bus.publish("run:locked", { type: "tick", i });
  runs.endRun("locked");
  const real = fs.readSync;
  fs.readSync = () => {
    throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
  };
  syncBuiltinESMExports();
  /** @type {any} */
  let page;
  try {
    page = runs.events("locked", { since: 10 });
  } finally {
    fs.readSync = real;
    syncBuiltinESMExports();
  }
  assert.deepEqual(page.events, []);
  assert.deepEqual(page.gap, { requested: 10, firstAvailable: 53 }, "what could not be read is said");
  assert.equal(runs.events("locked", { since: 10 })?.events.length, 42, "and read once the disk answers");
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — every reader of a run's snapshots or questions read all of its events, then picked)
test("a reader of some events of a whole run gets those alone, from the file and the ring, its limit counting only them", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ ringMB: 0 }) });
  runs.startRun({ id: "mixed", kind: "agent-turn" });
  for (let i = 0; i < 600; i++) bus.publish("run:mixed", i % 50 ? { type: "tool-output", round: 1, id: "c", text: "o".repeat(500) } : { type: "snapshot", round: i, place: "p" });
  const all = /** @type {any} */ (runs.events("mixed", { since: 0, limit: 50000 })).events;
  const want = all.filter((/** @type {any} */ e) => e.type === "snapshot");
  assert.equal(want.length, 12);
  assert.deepEqual(runs.events("mixed", { since: 0, limit: 50000, types: ["snapshot"] })?.events, want, "the file's and the ring's");
  assert.deepEqual(runs.events("mixed", { since: 0, limit: 5, types: ["snapshot"] })?.events, want.slice(0, 5));
  runs.endRun("mixed");
  assert.deepEqual(runs.events("mixed", { since: 100, limit: 50000, types: ["snapshot", "run-end"] })?.events.map((/** @type {any} */ e) => e.type), [...want.filter((/** @type {any} */ e) => e.n > 100).map(() => "snapshot"), "run-end"]);
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — the newest 200 stayed in memory however large: here three bodies of 300 KB each)
test("an event too large for a line counts toward no floor: the ring lets it go past its cap", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ ringMB: 0.5 }) });
  runs.startRun({ id: "bodies", kind: "agent-turn" });
  for (let i = 0; i < 4; i++) bus.publish("run:bodies", { type: "graph", round: 1, graph: { i, pad: "g".repeat(300_000) } });
  for (let i = 0; i < 197; i++) bus.publish("run:bodies", { type: "tick", i });
  assert.ok(runs.memory().chars < 0.5e6, `under the cap: ${runs.memory().chars}`);
  assert.equal(runs.events("bodies", { since: 0, limit: 50000 })?.events.filter((/** @type {any} */ e) => e.type === "graph").length, 4, "each read back whole");
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// The review of 11-16 (Fable 5.2): the size check was the count check's `else`, so a run whose first `maxPerRun` events
// were small held its next `maxPerRun` whatever their size.
// (fails before: yes — 1,000 events of 4 KB held, 4 MB against a cap of 1)
test("the ring's size cap holds once its count cap is reached too", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ maxPerRun: 1000, ringMB: 1 }) });
  runs.startRun({ id: "both", kind: "agent-turn" });
  for (let i = 0; i < 1000; i++) bus.publish("run:both", { type: "tick", i });
  for (let i = 0; i < 1000; i++) bus.publish("run:both", { type: "tool-output", round: 1, id: "c", text: "o".repeat(4000) });
  assert.ok(runs.memory().chars <= 1e6, `under the cap: ${runs.memory().chars} characters`);
  assert.equal(runs.events("both", { since: 0, limit: 50000 })?.events.length, 2001, "every event reads back");
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// The review of 11-16: the floor kept its 200 newest whole, and a task graph's snapshot runs to half a megabyte — 28 of
// them in one real run's first 200 events.
// (fails before: yes — the four bodies, behind a small first event in a run of 11, held whole: 1.2 MB)
test("an event whose body is kept beside the file is held as its envelope, the floor's too: read back whole, or as its envelope where asked", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "graphs", kind: "agent-turn" });
  bus.publish("run:graphs", { type: "tick", i: 0 });
  const graphs = Array.from({ length: 4 }, (_, i) => ({ i, pad: "g".repeat(300_000) }));
  for (const graph of graphs) bus.publish("run:graphs", { type: "graph", round: 1, graph });
  for (let i = 1; i < 6; i++) bus.publish("run:graphs", { type: "tick", i });
  assert.equal(runs.memory().events, 11, "all in the ring");
  assert.ok(runs.memory().chars < 10_000, `as envelopes: ${runs.memory().chars} characters`);
  const all = /** @type {any} */ (runs.events("graphs", { since: 0 })).events;
  assert.deepEqual(all.filter((/** @type {any} */ e) => e.type === "graph").map((/** @type {any} */ e) => e.graph), graphs, "each whole, from its body");
  const bare = /** @type {any} */ (runs.events("graphs", { since: 0, bodies: false })).events.filter((/** @type {any} */ e) => e.type === "graph");
  assert.deepEqual(bare.map((/** @type {any} */ e) => [e.graph, e.body, e.truncated > 300_000]), graphs.map(() => [undefined, true, true]), "an envelope where no body is asked for");
  runs.endRun("graphs");
  assert.deepEqual(/** @type {any} */ (runs.events("graphs", { since: 0, bodies: false })).events.filter((/** @type {any} */ e) => e.type === "graph").map((/** @type {any} */ e) => e.graph), [undefined, undefined, undefined, undefined], "from the file too");
  assert.deepEqual(freshRead(dir, "graphs"), /** @type {any} */ (runs.events("graphs", { since: 0 })).events);
  // An envelope carries its call's id and tool's name: what a reader of what a turn does now reads.
  runs.startRun({ id: "calls", kind: "agent-turn" });
  bus.publish("run:calls", { type: "tool-start", round: 1, id: "c9", name: "bash", args: "x".repeat(300_000) });
  const start = /** @type {any} */ (runs.events("calls", { since: 0, bodies: false })).events.find((/** @type {any} */ e) => e.type === "tool-start");
  assert.deepEqual([start.id, start.name, start.args, start.body], ["c9", "bash", undefined, true]);
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// The review of 11-16: what the file holds otherwise than published was kept for the run's life — a command whose output
// shows a token repeats its rolling tail in each flush, each flush kept whole.
// (fails before: yes — all 400 kept)
test("what the file holds otherwise than published is kept as published up to ringMB, the newest first", () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ ringMB: 0.05 }) });
  runs.startRun({ id: "keys", kind: "agent-turn" });
  for (let i = 0; i < 400; i++) bus.publish("run:keys", { type: "tool-output", round: 1, id: "c", text: `${i} ${"x".repeat(400)} Authorization: Bearer sk-ant-api03-verysecretkeyvalue1234567890` });
  const kept = runs.memory().asSent;
  assert.ok(kept > 0 && kept < 150, `the newest: ${kept}`);
  const back = /** @type {any} */ (runs.events("keys", { since: 0, limit: 50000 })).events.filter((/** @type {any} */ e) => e.type === "tool-output");
  assert.equal(back.length, 400);
  assert.match(back.at(-1).text, /verysecretkeyvalue/, "the newest as published");
  assert.doesNotMatch(back[0].text, /verysecretkeyvalue/, "an older one as its file holds it");
  runs.endRun("keys");
  assert.equal(runs.memory().asSent, 0, "none once the run has ended");
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});

// The review of 11-16: a page of the replay after the first with a gap in it (a file that would not read) ended the
// replay, and the follow went live past a hole it said nothing of.
// (fails before: yes — the replay went on past the hole and told nothing of it)
test("a follow's replay tells a gap in a later page, and goes on past it", async () => {
  const { followRunEvents } = await import("../src/services/runs.js");
  const ev = (/** @type {number} */ n) => /** @type {any} */ ({ n, type: "tick", ts: n, runId: "x" });
  // A full first page of two; the next: events 3 and 4 would not read, the ring's 5 and 6 follow; then nothing more.
  const fake = /** @type {any} */ ({
    subscribe: () => () => {},
    getRun: () => ({ endedAt: null }),
    events: (/** @type {string} */ _id, /** @type {any} */ o) => (o.since === 2 ? { events: [ev(5), ev(6)], gap: { requested: 2, firstAvailable: 5 } } : { events: [], gap: null }),
  });
  /** @type {number[]} */
  const sent = [];
  /** @type {any[]} */
  const gaps = [];
  const f = followRunEvents(fake, "x", { events: [ev(1), ev(2)], run: /** @type {any} */ ({}) }, { pageSize: 2, send: (e) => (sent.push(e.n), true), onGap: (g) => gaps.push(g) });
  await f.live;
  assert.deepEqual(gaps, [{ requested: 2, firstAvailable: 5 }], "told");
  assert.deepEqual(sent, [1, 2, 5, 6], "and what follows it sent");
  f.stop();
});

// The owner's of 11-16: "what about the case when filament crashes mid way or restarts". A process that dies mid-write
// leaves half a line at its file's end; the next start writes the run's end after it, and found its end glued to the
// half line.
// (fails before: yes — the end, glued to the half line, read as none: the start after found the run open again, its
// status "unknown"; the same on 0cd3297d7, before the window)
test("a run a crash cut mid-write gets its end on a line of its own: every event read back, the start after finds it ended", async () => {
  const dir = scratch();
  const bus = createEventBus();
  const first = createRunLog({ events: bus, dataDir: dir, config: knobs({ ringMB: 0.2 }) });
  first.startRun({ id: "cut", kind: "coding-agent", meta: { chain: "c1" } });
  for (let i = 0; i < 300; i++) bus.publish("run:cut", { type: "tool-output", round: 1, id: "c", text: `${i} ${"o".repeat(2000)}` });
  bus.publish("run:cut", { type: "graph", round: 1, graph: { pad: "g".repeat(300_000) } });
  first.close();
  appendFileSync(join(dir, "runs", "cut.jsonl"), '{"n":303,"seq":99,"type":"tool-outp');
  const second = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  assert.deepEqual((await second.openOnDisk("coding-agent")).map((o) => o.id), ["cut"], "found cut off");
  const read = /** @type {any} */ (second.events("cut", { since: 0, limit: 50000 }));
  assert.deepEqual([read.gap, read.events.length, read.events.at(-1).graph?.pad.length], [null, 302, 300_000], "every whole event, the graph's body too");
  assert.equal(second.closeOnDisk("cut", { status: "aborted", summary: { error: "left open" } }), true);
  second.close();
  const third = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  assert.deepEqual(await third.openOnDisk("coding-agent"), [], "ended");
  assert.deepEqual([third.getRun("cut")?.status, third.events("cut", { since: 300 })?.events.map((/** @type {any} */ e) => [e.n, e.type])], ["aborted", [[301, "tool-output"], [302, "graph"], [303, "run-end"]]]);
  third.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — its first line was an envelope that names no kind: never found left open)
test("a run whose start is too large for a line is found left open by its kind, its meta from its body", async () => {
  const dir = scratch();
  const bus = createEventBus();
  const first = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  first.startRun({ id: "big-start", kind: "agent-turn", meta: { chain: "c1", seed: "s".repeat(300_000) } });
  bus.publish("run:big-start", { type: "round-start", round: 1 });
  first.close();
  const second = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs() });
  const open = await second.openOnDisk("agent-turn");
  assert.deepEqual(open.map((o) => [o.id, o.meta?.chain]), [["big-start", "c1"]]);
  second.close();
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — an ended run still in memory kept its ring past its file's removal; once it keeps none, it would
// read as empty while its meta counted its events)
test("an ended run still in memory leaves with its file when the sweep removes it", async () => {
  const dir = scratch();
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: knobs() });
  runs.startRun({ id: "old", kind: "agent-turn" });
  bus.publish("run:old", { type: "tick" });
  runs.endRun("old");
  const ancient = (Date.now() - 30 * 86400_000) / 1000;
  utimesSync(join(dir, "runs", "old.jsonl"), ancient, ancient);
  assert.equal(await runs.sweep(), 1);
  assert.deepEqual([runs.getRun("old"), runs.events("old", { since: 0 }), runs.hasRun("old"), runs.memory().runs], [null, null, false, 0]);
  runs.close();
  rmSync(dir, { recursive: true, force: true });
});
