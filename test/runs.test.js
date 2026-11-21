// @ts-check
// The run log (services/runs.js): per-run numbering, honest gaps, persistence across a reconstructed log, live
// subscription after replay, idempotent ends, the retention sweep, and content-free operations — then the three
// admin rows against a real app.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, utimesSync, readdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog, RUN_EVENT_FIELDS, RUN_EVENT_TYPE_LIST } from "../src/services/runs.js";
import { startApp, parseSse } from "./helpers/app.js";

const scratch = () => mkdtempSync(join(tmpdir(), "filament-runs-"));
const knobs = (over = {}) => () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 100, keepRuns: 50, ...over } } });
/** @type {any[]} */
const recorded = [];
const fakeOps = { record: (kind, title, opts) => recorded.push({ kind, title, ...(opts || {}) }) };

describe("run log: numbering and gaps", () => {
  test("events on a run:<id> topic are numbered per run from 1, whichever order the bus interleaves them", () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs(), ops: fakeOps });
    bus.publish("run:a", { type: "round-start", round: 1 });
    bus.publish("run:b", { type: "round-start", round: 1 });
    bus.publish("record", { unrelated: true });
    bus.publish("run:a", { type: "round-text", text: "hi" });
    const a = runs.events("a");
    const b = runs.events("b");
    assert.ok(a && b);
    assert.deepEqual(
      a.events.map((e) => [e.n, e.type]),
      [
        [1, "round-start"],
        [2, "round-text"],
      ],
    );
    assert.deepEqual(b.events.map((e) => e.n), [1]);
    assert.ok(a.events[1].seq > a.events[0].seq, "the bus seq rides along");
    assert.equal(a.events[0].runId, "a");
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a ring that dropped older events reports the first number it can still serve instead of skipping silently", () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false, maxPerRun: 100 }), ops: fakeOps });
    for (let i = 0; i < 150; i++) bus.publish("run:r", { type: "tick", i });
    const page = runs.events("r", { since: 0 });
    assert.ok(page);
    assert.equal(page.firstAvailable, 51);
    assert.deepEqual(page.gap, { requested: 0, firstAvailable: 51 });
    assert.equal(page.events[0].n, 51);
    assert.equal(page.run.events, 150);
    // Asking from inside the ring is not a gap.
    const inside = runs.events("r", { since: 60 });
    assert.ok(inside);
    assert.equal(inside.gap, null);
    assert.equal(inside.events[0].n, 61);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("run log: persistence", () => {
  test("a run written to runs/<id>.jsonl is read back by a fresh log — meta from its start and end, events by number", () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs(), ops: fakeOps });
    runs.startRun({ id: "p1", kind: "agent-turn", title: "fix the tests", parentId: null, meta: { model: "brain-model" } });
    bus.publish("run:p1", { type: "round-start", round: 1 });
    bus.publish("run:p1", { type: "tool-start", round: 1, name: "read" });
    runs.endRun("p1", { status: "done", summary: { rounds: 1 } });
    runs.close();
    const file = join(dir, "runs", "p1.jsonl");
    assert.ok(existsSync(file));
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(
      lines.map((l) => l.type),
      ["run-start", "round-start", "tool-start", "run-end"],
    );
    const again = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    const run = again.getRun("p1");
    assert.ok(run);
    assert.equal(run.kind, "agent-turn");
    assert.equal(run.title, "fix the tests");
    assert.equal(run.status, "done");
    assert.deepEqual(run.summary, { rounds: 1 });
    assert.equal(run.events, 4);
    const page = again.events("p1", { since: 2 });
    assert.ok(page);
    assert.deepEqual(page.events.map((e) => e.n), [3, 4]);
    assert.equal(page.gap, null);
    assert.ok(again.listRuns().some((r) => r.id === "p1"));
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — the bug hunt of 10-30, L3: a run file the disk listed but would not stat as the log started —
  // a scan or another process holding it — was indexed as empty, so its turn read as having no run until the next start)
  test("a run file that would not stat as the log started is asked again: once the disk answers, its run is there", () => {
    const dir = scratch();
    const first = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    first.startRun({ id: "held1", kind: "agent-turn", title: "held at the start", parentId: null, meta: {} });
    first.endRun("held1", { status: "done" });
    first.close();
    const held = join(dir, "runs", "held1.jsonl");
    /** The module's own object, its functions replaced for the test (`syncBuiltinESMExports` carries them to the imports). @type {any} */
    const nodeFs = fs;
    const real = nodeFs.statSync;
    // The disk refuses this one file while the next log reads its directory (EBUSY, as a scan holding it answers).
    nodeFs.statSync = (/** @type {any} */ p, /** @type {any[]} */ ...rest) => {
      if (String(p) === held) throw Object.assign(new Error(`EBUSY: resource busy or locked, stat '${held}'`), { code: "EBUSY" });
      return real(p, ...rest);
    };
    syncBuiltinESMExports();
    /** @type {ReturnType<typeof createRunLog>} */
    let again;
    try {
      again = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
      assert.equal(again.hasRun("held1"), false, "while the disk refuses, nothing says it holds a run");
    } finally {
      nodeFs.statSync = real;
      syncBuiltinESMExports();
    }
    assert.equal(again.hasRun("held1"), true, "the disk answers: its run is there");
    const listed = again.listRuns().find((r) => r.id === "held1");
    assert.ok(listed && listed.startedAt > 0, "and listed by its file's time");
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the file fills what the ring dropped, so a viewer asking from 0 gets everything and no gap", () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ maxPerRun: 100 }), ops: fakeOps });
    for (let i = 0; i < 150; i++) bus.publish("run:big", { type: "tick", i });
    const page = runs.events("big", { since: 0, limit: 1000 });
    assert.ok(page);
    assert.equal(page.gap, null);
    assert.equal(page.events.length, 150);
    assert.equal(page.events[0].n, 1);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("with persistence off nothing is written and a dropped prefix is an announced gap", () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    bus.publish("run:m", { type: "tick" });
    assert.equal(existsSync(join(dir, "runs", "m.jsonl")), false);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("run log: subscription, ends, sweep, operations", () => {
  test("subscribe after a replay goes live from the number the replay stopped at", () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    bus.publish("run:s", { type: "a" });
    bus.publish("run:s", { type: "b" });
    const replay = runs.events("s", { since: 0 });
    assert.ok(replay);
    /** @type {number[]} */
    const seen = [];
    let last = replay.events[replay.events.length - 1].n;
    const off = runs.subscribe("s", (e) => {
      if (e.n > last) {
        last = e.n;
        seen.push(e.n);
      }
    });
    bus.publish("run:s", { type: "c" });
    bus.publish("run:s", { type: "d" });
    off();
    bus.publish("run:s", { type: "e" });
    assert.deepEqual(seen, [3, 4]);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("endRun is idempotent and a start after events keeps the numbering", () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    bus.publish("run:e", { type: "early" });
    const meta = runs.startRun({ id: "e", kind: "agent-turn" });
    assert.equal(meta.kind, "agent-turn");
    const first = runs.endRun("e", { status: "error", summary: { why: "x" } });
    const second = runs.endRun("e", { status: "done" });
    assert.ok(first && second);
    assert.equal(second.status, "error");
    assert.equal(second.endedAt, first.endedAt);
    const page = runs.events("e");
    assert.ok(page);
    assert.deepEqual(
      page.events.map((e) => [e.n, e.type]),
      [
        [1, "early"],
        [2, "run-start"],
        [3, "run-end"],
      ],
    );
    assert.equal(runs.endRun("nope"), null);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the sweep removes files past retention and leaves a running run alone", async () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ retentionDays: 1 }), ops: fakeOps });
    runs.startRun({ id: "old", kind: "agent-turn" });
    runs.endRun("old");
    runs.startRun({ id: "live", kind: "agent-turn" });
    bus.publish("run:live", { type: "tick" });
    const ancient = (Date.now() - 3 * 86400_000) / 1000;
    for (const id of ["old", "live"]) utimesSync(join(dir, "runs", `${id}.jsonl`), ancient, ancient);
    const removed = await runs.sweep();
    assert.equal(removed, 1);
    assert.deepEqual(readdirSync(join(dir, "runs")), ["live.jsonl"]);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("operations carry counts and ids only — never a payload", () => {
    recorded.length = 0;
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    runs.startRun({ id: "o", kind: "agent-turn", title: "SECRET TITLE" });
    bus.publish("run:o", { type: "round-text", text: "SECRET BODY" });
    runs.endRun("o", { status: "done", summary: { text: "SECRET SUMMARY" } });
    const ours = recorded.filter((r) => r.kind === "run");
    assert.equal(ours.length, 2);
    const blob = JSON.stringify(ours);
    assert.ok(!blob.includes("SECRET"), `an op leaked content: ${blob}`);
    assert.equal(ours[1].detail.events, 3);
    assert.equal(ours[1].ref.requestId, "o");
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("run log: the edges the viewer will hit", () => {
  test("opening an ended run from disk does not make it look running, and the sweep can still remove it", async () => {
    const dir = scratch();
    const first = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs({ retentionDays: 1 }), ops: fakeOps });
    first.startRun({ id: "old", kind: "agent-turn" });
    first.endRun("old", { status: "done" });
    first.close();
    const again = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs({ retentionDays: 1 }), ops: fakeOps });
    const off = again.subscribe("old", () => {});
    const listed = again.listRuns().find((r) => r.id === "old");
    assert.ok(listed);
    assert.equal(listed.status, "done", "a subscription to a past run does not resurrect it");
    assert.equal(listed.kind, "agent-turn");
    const page = again.events("old", { since: 0 });
    assert.ok(page);
    assert.deepEqual(page.events.map((e) => e.type), ["run-start", "run-end"], "the page comes from the file, not an empty ring");
    off();
    const ancient = (Date.now() - 3 * 86400_000) / 1000;
    utimesSync(join(dir, "runs", "old.jsonl"), ancient, ancient);
    assert.equal(await again.sweep(), 1, "an ended run's file is swept even after someone looked at it");
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a producer that reuses an id after a restart continues the numbering instead of overlapping the file", () => {
    const dir = scratch();
    const first = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    first.startRun({ id: "again", kind: "agent-turn" });
    first.endRun("again");
    first.close();
    const bus = createEventBus();
    const second = createRunLog({ events: bus, dataDir: dir, config: knobs(), ops: fakeOps });
    second.startRun({ id: "again", kind: "agent-turn" });
    bus.publish("run:again", { type: "tick" });
    const page = second.events("again", { since: 0, limit: 100 });
    assert.ok(page);
    assert.deepEqual(page.events.map((e) => e.n), [1, 2, 3, 4], "one sequence across both processes");
    assert.equal(page.run.status, "running", "the new start makes the run live again");
    assert.equal(page.gap, null);
    second.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a malformed or truncated line in the file is skipped; the rest is served", () => {
    const dir = scratch();
    const first = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    first.startRun({ id: "torn", kind: "agent-turn" });
    first.endRun("torn");
    first.close();
    const file = join(dir, "runs", "torn.jsonl");
    writeFileSync(file, readFileSync(file, "utf8") + 'not json at all\n{"n":9,"type":"cut-mid-wr');
    const again = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    const page = again.events("torn", { since: 0 });
    assert.ok(page);
    assert.deepEqual(page.events.map((e) => e.type), ["run-start", "run-end"]);
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — the 10-29 speed pass: a run's file was parsed whole at every read once it grew, so a long
  // turn whose ring no longer held its first event had its megabytes parsed again at each ask. Since 11-15 the log keeps
  // a file's index, not its parse, and the index of a file that grew reads its new lines alone)
  test("a file that grew has its new lines indexed alone; a last line cut short is read once whole, and counted once", () => {
    const dir = scratch();
    const first = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    first.startRun({ id: "long", kind: "agent-turn" });
    first.endRun("long");
    first.close();
    const file = join(dir, "runs", "long.jsonl");
    const again = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    const types = () => again.events("long", { since: 0 })?.events.map((e) => [e.n, e.type]);
    assert.deepEqual(types(), [[1, "run-start"], [2, "run-end"]]);
    const size = readFileSync(file).length;
    writeFileSync(file, `${readFileSync(file, "utf8")}{"n":3,"type":"note"}\n{"n":4,"type":"no`);
    /** The module's own object, its `readSync` watched for where each read starts. @type {any} */
    const nodeFs = fs;
    const real = nodeFs.readSync;
    /** @type {number[]} */
    const from = [];
    nodeFs.readSync = (/** @type {any[]} */ ...args) => {
      from.push(Number(args[4]));
      return real(...args);
    };
    syncBuiltinESMExports();
    try {
      assert.equal(again.getRun("long")?.events, 3, "the cut line not yet");
    } finally {
      nodeFs.readSync = real;
      syncBuiltinESMExports();
    }
    assert.ok(from.length && from.every((p) => p >= size), `what was indexed stands; the new lines alone are read: ${from}`);
    assert.deepEqual(types(), [[1, "run-start"], [2, "run-end"], [3, "note"]], "the cut line not yet");
    writeFileSync(file, `${readFileSync(file, "utf8")}te"}\n`);
    assert.deepEqual(types(), [[1, "run-start"], [2, "run-end"], [3, "note"], [4, "note"]], "the cut line once whole, once");
    assert.equal(again.getRun("long")?.events, 4);
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a failing append or a throwing op recorder never reaches the producer's publish", () => {
    const dir = scratch();
    const bus = createEventBus();
    // A file where the runs directory should be: every append fails.
    writeFileSync(join(dir, "runs"), "not a directory");
    const angry = {
      record: () => {
        throw new Error("ops down");
      },
    };
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs(), ops: angry });
    assert.doesNotThrow(() => runs.startRun({ id: "x", kind: "agent-turn" }));
    assert.doesNotThrow(() => {
      for (let i = 0; i < 5; i++) bus.publish("run:x", { type: "tick", i });
    });
    assert.doesNotThrow(() => runs.endRun("x"));
    const page = runs.events("x", { since: 0 });
    assert.ok(page);
    assert.equal(page.events.length, 7, "the run lives on in memory");
    assert.equal(page.run.persisted, false);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the mailbox: a waiting decision window wakes on the first message, an empty one elapses to []", async () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    runs.startRun({ id: "m", kind: "agent-turn" });
    const box = runs.mailbox("m");
    const t0 = Date.now();
    const elapsed = await box.wait(30);
    assert.deepEqual(elapsed, []);
    assert.ok(Date.now() - t0 >= 25, "the window ran its course");
    const waiting = box.wait(10_000);
    setTimeout(() => runs.steer("m", { kind: "veto", text: "not that file" }), 10);
    const heard = await waiting;
    assert.equal(heard.length, 1);
    assert.equal(heard[0].kind, "veto");
    assert.ok(Date.now() - t0 < 5000, "the window closed on the message, not on the clock");
    assert.equal(box.size(), 0);
    assert.equal(runs.steer("m", { kind: "stop" }).ok, true, "a stop needs no text");
    const refused = runs.steer("m", { kind: "note", text: "" });
    assert.ok(!refused.ok && /text is required/.test(refused.error));
    const types = (runs.events("m", { since: 0 })?.events || []).map((e) => e.type);
    assert.deepEqual(types, ["run-start", "steer", "steer-read", "steer"]);
    // (fails before: yes — B3: the words were cut at 4,000 characters on their way into the mailbox)
    const long = runs.steer("m", { kind: "note", text: `${"a long note ".repeat(1000)}END` });
    assert.deepEqual([long.ok && long.message.text.length, long.ok && long.message.text.endsWith("END")], [12_003, true], "a note goes whole");
    assert.equal(/** @type {any} */ ((runs.events("m", { since: 0 })?.events || []).at(-1)).text.length, 12_003, "and the run's log has all of it");
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — the mailbox took words only: a picture sent while a turn ran had nowhere to go, so the page
  // queued the whole message for the turn's end)
  test("the mailbox: a run that reads pictures takes them with a note or a veto, its log names them without their bytes, and another run refuses them in words", () => {
    const dir = scratch();
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    try {
      runs.startRun({ id: "p", kind: "agent-turn", meta: { steerImages: true } });
      runs.startRun({ id: "w", kind: "subagent", meta: {} });
      const PNG = "iVBORw0KGgo=";
      const pic = { name: "shot.png", mediaType: "image/png", data: PNG };
      const out = runs.steer("p", { kind: "note", text: "look at this", images: [pic] });
      /** A picture as the log names it, its ref aside (the test below has the refs). @param {any[]} list */
      const named = (list) => list.map(({ ref, ...p }) => p);
      assert.deepEqual([out.ok, out.ok && named(/** @type {any} */ (out.message).images)], [true, [{ name: "shot.png", mediaType: "image/png", bytes: 8 }]], "the answer names the picture, with its size");
      assert.equal(runs.steer("p", { kind: "veto", text: "", images: [pic, { mediaType: "image/jpeg", data: PNG }] }).ok, true, "a picture needs no words, and rides a veto too");
      const steers = /** @type {any[]} */ ((runs.events("p", { since: 0 })?.events || []).filter((e) => e.type === "steer"));
      assert.deepEqual(steers.map((e) => named(e.images)), [[{ name: "shot.png", mediaType: "image/png", bytes: 8 }], [{ name: "shot.png", mediaType: "image/png", bytes: 8 }, { name: "picture 2", mediaType: "image/jpeg", bytes: 8 }]]);
      assert.ok(!JSON.stringify(runs.events("p", { since: 0 })).includes(PNG) && !JSON.stringify(out).includes(PNG), "neither the log nor the answer carries a picture's bytes");
      // The loop reads them whole.
      assert.deepEqual(runs.mailbox("p").read().map((m) => m.images), [[pic], [pic, { name: "picture 2", mediaType: "image/jpeg", data: PNG }]]);
      // What is refused, in words, and never queued.
      assert.deepEqual(runs.steer("w", { kind: "note", text: "x", images: [pic] }), { ok: false, error: "this run takes words only while it runs; a picture goes with the next message" });
      assert.equal(runs.steer("w", { kind: "note", text: "x", images: [] }).ok, true, "words alone go as they did");
      assert.deepEqual(runs.steer("p", { kind: "stop", images: [pic] }), { ok: false, error: "a stop carries no picture" });
      for (const [images, why] of /** @type {[any, RegExp][]} */ ([
        [[{ mediaType: "text/plain", data: PNG }], /^image 1 is no picture/],
        [[pic, { mediaType: "image/png", data: "not base64!" }], /^image 2 carries no base64 data$/],
        [[{ mediaType: "image/png" }], /^image 1 carries no base64 data$/],
        ["shot.png", /^images must be a list/],
      ])) {
        const r = runs.steer("p", { kind: "note", text: "x", images });
        assert.ok(!r.ok && why.test(r.error), JSON.stringify(r));
      }
      assert.equal(runs.mailbox("p").size(), 0, "a refused message is not queued");
    } finally {
      runs.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — HarnessV4_Tasks V4-D303: a picture sent into a running turn was named in the run's log and kept
  // nowhere, so its bubble showed its file's name and nothing more, live and after a reload)
  test("the mailbox: a picture a message carries is kept beside the run's log, as a call's are, and the steer names it by its ref", () => {
    const dir = scratch();
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs(), ops: fakeOps });
    const none = createRunLog({ events: createEventBus(), dataDir: scratch(), config: knobs({ imagesMaxMB: 0 }), ops: fakeOps });
    try {
      runs.startRun({ id: "p", kind: "agent-turn", meta: { steerImages: true } });
      const PNG = "iVBORw0KGgo=";
      const out = runs.steer("p", { kind: "note", text: "look", images: [{ name: "shot.png", mediaType: "image/png", data: PNG }, { name: "words.png", mediaType: "image/png", data: "aGVsbG8=" }] });
      assert.ok(out.ok);
      const [kept, notAPicture] = /** @type {any} */ (out.message).images;
      assert.match(kept.ref, /^[0-9a-f]{32}\.png$/);
      assert.equal(notAPicture.ref, undefined, "bytes that are no picture are named, never kept");
      const file = runs.imageFile(kept.ref);
      assert.ok(file && readFileSync(file).equals(Buffer.from(PNG, "base64")), "kept as it was sent");
      const steer = /** @type {any} */ ((runs.events("p", { since: 0 })?.events || []).find((e) => e.type === "steer"));
      assert.equal(steer.images[0].ref, kept.ref, "the run's log names it by its ref");
      assert.ok(!JSON.stringify(runs.events("p", { since: 0 })).includes(PNG), "and never carries its bytes");
      assert.deepEqual((runs.mailbox("p").read()[0].images || []).map((/** @type {any} */ p) => Object.keys(p).sort()), [["data", "mediaType", "name"], ["data", "mediaType", "name"]], "the loop reads the pictures as sent, nothing added");
      // Pictures not kept (imagesMaxMB 0): named, as before.
      none.startRun({ id: "q", kind: "agent-turn", meta: { steerImages: true } });
      const plain = none.steer("q", { kind: "note", text: "x", images: [{ name: "shot.png", mediaType: "image/png", data: PNG }] });
      assert.deepEqual(plain.ok && /** @type {any} */ (plain.message).images, [{ name: "shot.png", mediaType: "image/png", bytes: 8 }]);
    } finally {
      runs.close();
      none.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the mailbox is bounded, and a message the loop never read is marked unread when the run ends — never left 'queued'", async () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    runs.startRun({ id: "u", kind: "agent-turn" });
    for (let i = 0; i < 50; i++) assert.equal(runs.steer("u", { kind: "note", text: `n${i}` }).ok, true);
    const full = runs.steer("u", { kind: "note", text: "one more" });
    assert.ok(!full.ok && /holds 50 unread/.test(full.error), "the 51st is refused with the reason");
    const box = runs.mailbox("u");
    box.read();
    const woken = box.wait(10_000);
    runs.steer("u", { kind: "note", text: "during the last round" });
    assert.equal((await woken)[0]?.text, "during the last round", "a live window wakes on the message");
    // A waiter parked on an empty window is released by the end, with [], not left hanging for its 10 s.
    const parked = box.wait(10_000);
    const t0 = Date.now();
    const meta = runs.endRun("u", { status: "done", summary: { rounds: 2 } });
    assert.deepEqual(await parked, []);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(meta?.summary.unreadSteer, undefined, "nothing was unread");
    assert.equal(meta?.summary.rounds, 2);
    runs.close();
    // A message that lands after the loop's last read and before the end: drained, marked, counted.
    const late = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    late.startRun({ id: "v", kind: "agent-turn" });
    late.mailbox("v").read();
    late.steer("v", { kind: "veto", text: "arrived after the loop's last read" });
    const ended = late.endRun("v", { status: "done", summary: { rounds: 1 } });
    assert.equal(ended?.summary.unreadSteer, 1, "the summary counts what nobody read");
    assert.equal(ended?.summary.rounds, 1, "the loop's own summary survives");
    const evts = late.events("v", { since: 0 })?.events || [];
    const unread = /** @type {any} */ (evts.find((e) => e.type === "steer-unread"));
    assert.ok(unread, "the timeline says the message was never read");
    assert.deepEqual(unread.kinds, ["veto"]);
    assert.ok(evts.findIndex((e) => e.type === "steer-unread") < evts.findIndex((e) => e.type === "run-end"), "before run-end");
    assert.equal(late.mailbox("v").size(), 0);
    late.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: no — a guard the mutation pass asked for: no message another kind's stood before the one a pick
  // takes, and none was taken twice or after the loop read it)
  test("peek leaves the first message its pick takes queued; took reads it once, and only while it is queued (AC3-1)", () => {
    const dir = scratch();
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    runs.startRun({ id: "p", kind: "agent-turn" });
    runs.steer("p", { kind: "veto", text: "not that file" });
    runs.steer("p", { kind: "note", text: "use the other one" });
    const box = runs.mailbox("p");
    const note = box.peek((m) => m.kind === "note");
    assert.equal(note?.text, "use the other one", "the first message the pick takes, past one it doesn't");
    assert.equal(box.size(), 2, "peeked, still queued");
    assert.equal(box.peek((m) => m.kind === "stop"), null);
    assert.equal(box.took(/** @type {any} */ (note)), true);
    assert.equal(box.took(/** @type {any} */ (note)), false, "taken once");
    const veto = box.peek((m) => m.kind === "veto");
    box.read();
    assert.equal(box.took(/** @type {any} */ (veto)), false, "one the loop read meanwhile is not taken");
    assert.equal(box.size(), 0);
    const reads = (runs.events("p", { since: 0 })?.events || []).filter((e) => e.type === "steer-read").map((e) => /** @type {any} */ (e).kinds);
    assert.deepEqual(reads, [["note"], ["veto"]], "one read for the note taken, one for the loop's");
    // (fails before: yes — HarnessV4_Tasks U1: a queued note the agent ran as its next prompt, its turn over, was
    // read on the run like one taken into the turn; the page could not say "runs next")
    runs.steer("p", { kind: "note", text: "and then the tests" });
    runs.steer("p", { kind: "note", text: "and the docs" });
    const [first, second] = [box.peek((m) => m.text === "and then the tests"), box.peek((m) => m.text === "and the docs")];
    box.took(/** @type {any} */ (first), { after: true });
    box.took(/** @type {any} */ (second));
    const how = (runs.events("p", { since: 0 })?.events || []).filter((e) => e.type === "steer-read").slice(2).map((e) => /** @type {any} */ (e).after);
    assert.deepEqual(how, [true, undefined], "the event says the one that ran next, and nothing of one taken into the turn");
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — `next` took no pick: any message ended the wait, and at once while any stood queued, so a
  // coding agent's turn waiting past a command it holds spun on it)
  test("next with a pick: only a message it picks ends the wait, at once when one is queued; the run's end ends it too (AC3-1)", async () => {
    const dir = scratch();
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    runs.startRun({ id: "n", kind: "agent-turn" });
    const box = runs.mailbox("n");
    runs.steer("n", { kind: "note", text: "/review the diff" });
    const words = (/** @type {any} */ m) => m.kind === "note" && !m.text.startsWith("/");
    let woken = false;
    const waiting = box.next(words).then(() => (woken = true));
    runs.steer("n", { kind: "veto", text: "not that file" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(woken, false, "neither the command queued before it nor a message it doesn't pick ends the wait");
    runs.steer("n", { kind: "note", text: "and the docs" });
    await waiting;
    assert.equal(box.size(), 3, "it reads nothing");
    let again = false;
    await box.next(words).then(() => (again = true));
    assert.equal(again, true, "at once while one it picks is queued");
    box.read();
    let ended = 0;
    for (const parked of [box.next(words), box.next()]) void parked.then(() => ended++);
    runs.endRun("n", { status: "done" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ended, 2, "the run's end ends a wait, with a pick or without");
    await box.next(words);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — a message, once sent, was the loop's: nothing changed it or took it back while it waited)
  test("a message that still waits can be changed or taken back by the one who typed it, until the loop reads it or a coding agent's turn hands it over (HarnessV4_Tasks C34)", () => {
    const dir = scratch();
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    runs.startRun({ id: "e", kind: "agent-turn" });
    const gone = (/** @type {string} */ error) => ({ ok: false, error, gone: true });
    const a = runs.steer("e", { kind: "note", text: "look at a" });
    const b = runs.steer("e", { kind: "veto", text: "not that file" });
    const stop = runs.steer("e", { kind: "compact" });
    const lead = runs.steer("e", { kind: "note", text: "from the lead", from: "lead" });
    if (!a.ok || !b.ok || !stop.ok || !lead.ok) throw new Error("not queued");
    const edited = runs.editSteer("e", a.message.id, { text: "  look at c instead  " });
    assert.deepEqual(edited.ok && edited.message.text, "look at c instead", "trimmed, as a message is");
    assert.deepEqual(runs.editSteer("e", b.message.id, { text: "not that one" }).ok, true, "a veto's reason too");
    assert.deepEqual(runs.editSteer("e", a.message.id, { text: " " }), { ok: false, error: "a message needs words: Delete takes it back" });
    assert.deepEqual(runs.editSteer("e", stop.message.id, { text: "x" }), { ok: false, error: "a compact has no words to change" });
    assert.deepEqual(runs.dropSteer("e", lead.message.id), { ok: false, error: "only a message you typed can be changed or taken back" });
    assert.deepEqual(runs.dropSteer("e", b.message.id), { ok: true });
    assert.deepEqual(runs.dropSteer("e", b.message.id), gone("that message no longer waits: the agent has it, or it was taken back"));
    const box = runs.mailbox("e");
    assert.deepEqual(box.read().map((m) => m.text), ["look at c instead", "", "from the lead"], "the loop reads the new words, and nothing of the one taken back");
    assert.deepEqual(runs.editSteer("e", a.message.id, { text: "too late" }), gone("that message no longer waits: the agent has it, or it was taken back"));
    // A coding agent's turn hands a note to its agent: from then it is the agent's.
    runs.startRun({ id: "c", kind: "coding-agent", meta: { steer: "queued", agent: "Claude Code" } });
    const n = runs.steer("c", { kind: "note", text: "and the docs" });
    if (!n.ok) throw new Error("not queued");
    const cbox = runs.mailbox("c");
    const m = /** @type {any} */ (cbox.peek((x) => x.id === n.message.id));
    assert.equal(cbox.handing(m), true);
    assert.equal(cbox.handing(m), true, "handed again, said once");
    assert.deepEqual(runs.editSteer("c", n.message.id, { text: "x" }), gone("Claude Code has it already: it goes in at its next step"));
    assert.deepEqual(runs.dropSteer("c", n.message.id), gone("Claude Code has it already: it goes in at its next step"));
    runs.endRun("c", { status: "done" });
    assert.deepEqual(runs.editSteer("c", n.message.id, { text: "x" }), gone("the run has ended (done); nothing waits on it any more"));
    const said = (/** @type {string} */ id) => (runs.events(id, { since: 0 })?.events || []).filter((e) => ["steer-edit", "steer-drop", "steer-sent"].includes(e.type)).map((e) => [e.type, /** @type {any} */ (e).text ?? /** @type {any} */ (e).ids]);
    assert.deepEqual(said("e"), [["steer-edit", "look at c instead"], ["steer-edit", "not that one"], ["steer-drop", [b.message.id]]]);
    assert.deepEqual(said("c"), [["steer-sent", [n.message.id]]]);
    assert.equal(runs.editSteer("nobody", "x", { text: "y" }).ok, false);
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a question the run waits on: settled once by an answer that fits it, by its signal, or by the run's end (AC2-4)", async () => {
    const dir = scratch();
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs({ persist: false }), ops: fakeOps });
    runs.startRun({ id: "q", kind: "agent-turn" });
    const gone = (error) => ({ ok: false, error, gone: true });
    const waiting = runs.awaitAnswer("q", "q1", { check: (a) => (a?.outcome === "answered" ? "" : "the answer to a question is answered or skipped") });
    assert.deepEqual(runs.answer("q", "q1", { outcome: "maybe" }), { ok: false, error: "the answer to a question is answered or skipped" }, "refused, and still waiting");
    assert.deepEqual(runs.answer("q", "q1", { outcome: "answered" }), { ok: true });
    assert.deepEqual(await waiting, { outcome: "answered" });
    assert.deepEqual(runs.answer("q", "q1", { outcome: "answered" }), gone("that question is no longer waiting for an answer"));
    const stop = new AbortController();
    const stopped = runs.awaitAnswer("q", "q2", { signal: stop.signal });
    stop.abort();
    assert.equal(await stopped, null);
    assert.deepEqual(runs.answer("q", "q2", { outcome: "answered" }), gone("that question is no longer waiting for an answer"));
    assert.equal(await runs.awaitAnswer("q", "q3", { signal: AbortSignal.abort() }), null, "a signal already aborted waits on nothing");
    const open = runs.awaitAnswer("q", "q4");
    runs.endRun("q", { status: "stopped" });
    assert.equal(await open, null, "the run's end settles what it still waits on");
    assert.deepEqual(runs.answer("q", "q4", { outcome: "answered" }), gone("the run has ended (stopped); its questions were settled"));
    assert.equal(await runs.awaitAnswer("q", "q5"), null, "an ended run waits on nothing");
    assert.equal(await runs.awaitAnswer("nope", "q1"), null);
    assert.deepEqual(runs.answer("nope", "q1", {}), gone("no loop is running under that id"));
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the persisted line is redacted like ops.jsonl; the live ring keeps the bytes as published while the run runs", () => {
    const dir = scratch();
    const bus = createEventBus();
    const runs = createRunLog({ events: bus, dataDir: dir, config: knobs(), ops: fakeOps });
    runs.startRun({ id: "r", kind: "agent-turn" });
    bus.publish("run:r", { type: "tool-end", round: 1, name: "bash", ok: false, preview: "401 from gateway: Authorization: Bearer sk-ant-api03-verysecretkeyvalue1234567890" });
    const live = /** @type {any} */ (runs.events("r", { since: 0 })?.events.find((e) => e.type === "tool-end"));
    assert.ok(/verysecretkeyvalue/.test(live.preview), "the live view is the developer's own");
    runs.endRun("r");
    // An ended run reads as its file holds it, as after a restart (services/runs.js `endRun`, the review of 11-16).
    const ended = /** @type {any} */ (runs.events("r", { since: 0 })?.events.find((e) => e.type === "tool-end"));
    assert.ok(!/verysecretkeyvalue/.test(ended.preview), "an ended run's, as its file holds it");
    const file = readFileSync(join(dir, "runs", "r.jsonl"), "utf8");
    assert.ok(!/verysecretkeyvalue/.test(file), "the key does not outlive the turn on disk");
    assert.ok(/tool-end/.test(file), "the event itself is there");
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("run log: the event registry", () => {
  // (fails before: no — a guard the mutation pass asked for: nothing checked that each event the registry describes is
  // in one of its groups)
  test("every event the registry describes is in one of its groups, once, and every one listed is described", () => {
    const listed = [...RUN_EVENT_TYPE_LIST];
    assert.deepEqual([...listed].sort(), Object.keys(RUN_EVENT_FIELDS).sort());
    assert.equal(new Set(listed).size, listed.length, "none twice");
  });
});

describe("run log: the admin rows", () => {
  test("GET /api/runs, /api/runs/:id and /api/runs/:id/events answer, as JSON and as a stream that replays then ends", async () => {
    const t = await startApp();
    try {
      const { app, api } = t;
      const runs = /** @type {any} */ (app).runs;
      runs.startRun({ id: "req_1", kind: "agent-turn", title: "t" });
      app.events.publish("run:req_1", { type: "round-start", round: 1 });
      app.events.publish("run:req_1", { type: "round-text", round: 1, text: "thinking aloud" });
      const list = await (await api("/api/runs")).json();
      assert.ok(list.runs.some((r) => r.id === "req_1" && r.status === "running"));
      const one = await (await api("/api/runs/req_1")).json();
      assert.equal(one.run.kind, "agent-turn");
      assert.equal(one.run.events, 3);
      assert.equal((await api("/api/runs/nope")).status, 404);
      const page = await (await api("/api/runs/req_1/events?since=1")).json();
      assert.deepEqual(page.events.map((e) => e.type), ["round-start", "round-text"]);
      assert.equal(page.gap, null);
      runs.endRun("req_1", { status: "done" });
      // The stream form: hello, the replay, then — for an ended run — an `ended` marker and a clean close.
      const res = await api("/api/runs/req_1/events?since=0&stream=1");
      assert.equal(res.headers.get("content-type"), "text/event-stream");
      const text = await res.text();
      const frames = parseSse(text).map((f) => f.data);
      assert.equal(frames[0].type, "hello");
      assert.equal(frames[0].run.status, "done");
      assert.deepEqual(
        frames.slice(1, -1).map((f) => f.type),
        ["run-start", "round-start", "round-text", "run-end"],
      );
      assert.equal(frames[frames.length - 1].type, "ended");
      assert.ok(/^id: 1$/m.test(text), "the SSE id carries the event number");
    } finally {
      await t.stop();
    }
  });

  test("a live stream follows a running run, replays past the page size without a hole, and steering lands on the timeline", async () => {
    const t = await startApp();
    try {
      const { app, api, url, headers } = t;
      const runs = /** @type {any} */ (app).runs;
      runs.startRun({ id: "live_1", kind: "agent-turn", title: "t" });
      for (let i = 0; i < 5200; i++) app.events.publish("run:live_1", { type: "tick", i });
      // Open the stream, read frames as they come; the run is still running so the stream stays open.
      const ctl = new AbortController();
      const res = await fetch(`${url}/api/runs/live_1/events?since=0&stream=1`, { headers, signal: ctl.signal });
      const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
      let buf = "";
      const readUntil = async (pred) => {
        for (;;) {
          if (pred(buf)) return;
          const { value, done } = await reader.read();
          if (done) throw new Error("stream ended early");
          buf += new TextDecoder().decode(value);
        }
      };
      await readUntil((b) => (b.match(/"type":"tick"/g) || []).length >= 5200);
      // Now a live event, and a steering message through the admin row.
      app.events.publish("run:live_1", { type: "round-start", round: 1 });
      const steer = await api("/api/runs/live_1/steer", { method: "POST", body: { kind: "note", text: "hold the merge", from: "chat" } });
      assert.equal(steer.status, 200);
      const sj = await steer.json();
      assert.equal(sj.queued, 1);
      await readUntil((b) => b.includes('"type":"steer"'));
      const frames = parseSse(buf).map((f) => f.data);
      const ticks = frames.filter((f) => f.type === "tick");
      assert.equal(ticks.length, 5200, "every tick arrived");
      assert.equal(new Set(frames.filter((f) => f.n).map((f) => f.n)).size, frames.filter((f) => f.n).length, "no event was sent twice");
      const ns = frames.filter((f) => f.n).map((f) => f.n);
      assert.ok(ns.every((n, i) => i === 0 || n === ns[i - 1] + 1), "numbers are contiguous across the page boundary and into live");
      const steerEvt = frames.find((f) => f.type === "steer");
      assert.equal(steerEvt.state, "queued");
      assert.equal(steerEvt.text, "hold the merge");
      // The loop reads its mailbox: the message is drained and marked read on the timeline.
      const box = runs.mailbox("live_1");
      const got = box.read();
      assert.equal(got.length, 1);
      assert.equal(got[0].kind, "note");
      await readUntil((b) => b.includes('"type":"steer-read"'));
      // Steering an ended or unknown run is refused with a 409, a bad kind with a 400.
      assert.equal((await api("/api/runs/nope/steer", { method: "POST", body: { text: "x" } })).status, 409);
      assert.equal((await api("/api/runs/live_1/steer", { method: "POST", body: { kind: "shout", text: "x" } })).status, 400);
      runs.endRun("live_1", { status: "done" });
      assert.equal((await api("/api/runs/live_1/steer", { method: "POST", body: { text: "too late" } })).status, 409);
      ctl.abort();
      // `?follow=1` keeps an ended run's stream open (no `ended` frame), for a viewer that wants the heartbeat.
      const ctl2 = new AbortController();
      const res2 = await fetch(`${url}/api/runs/live_1/events?since=5200&stream=1&follow=1`, { headers, signal: ctl2.signal });
      const reader2 = /** @type {ReadableStream<Uint8Array>} */ (res2.body).getReader();
      let buf2 = "";
      for (;;) {
        const { value, done } = await reader2.read();
        if (done) throw new Error("the followed stream ended");
        buf2 += new TextDecoder().decode(value);
        if (buf2.includes('"type":"run-end"')) break;
      }
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(!buf2.includes('"type":"ended"'), "no ended frame while following");
      assert.equal(res2.status, 200);
      ctl2.abort();
      // A bad percent-encoding in the path is a 400 in words, not a stack trace.
      assert.equal((await api("/api/runs/%zz/events")).status, 400);
    } finally {
      await t.stop();
    }
  });

  // HarnessV3-Responsiveness R1 (2026-10-01): a stream opened on a RUNNING run got its run-end and then only pings,
  // although the client's contract (followRun) is that the server closes it at run-end. The browser allows six
  // connections to one host, and every followed turn kept one: the page's own turn for 30 s (its safety stop), a turn
  // watched from another window until a reload — measured, the page held 5 of 6 during a turn.
  // (fails before: the reader never saw the end)
  test("a stream opened on a running run ends after its run-end, with the ended frame", async () => {
    const t = await startApp();
    /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
    let reader = null;
    try {
      const { app, url, headers } = t;
      const runs = /** @type {any} */ (app).runs;
      runs.startRun({ id: "live_2", kind: "agent-turn", title: "t" });
      app.events.publish("run:live_2", { type: "round-start", round: 1 });
      const res = await fetch(`${url}/api/runs/live_2/events?since=0&stream=1`, { headers });
      const r0 = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
      reader = r0;
      let buf = "";
      let done = false;
      const pump = (async () => {
        for (;;) {
          const r = await r0.read();
          if (r.done) return void (done = true);
          buf += new TextDecoder().decode(r.value);
        }
      })();
      for (let i = 0; i < 100 && !buf.includes('"type":"round-start"'); i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(buf.includes('"type":"round-start"'), "the stream is live before the run ends");
      runs.endRun("live_2", { status: "stopped" });
      await Promise.race([pump, new Promise((r) => setTimeout(r, 3000))]);
      assert.ok(done, "the server closed the stream after run-end");
      const frames = parseSse(buf).map((f) => f.data);
      assert.deepEqual(frames.slice(-2).map((f) => f.type), ["run-end", "ended"]);
      assert.equal(frames.at(-1).status, "stopped");
    } finally {
      // A stream the server failed to close is closed here, so the failure is the assertion's, not a hung stop.
      try { await reader?.cancel(); } catch {}
      await t.stop();
    }
  });
});

describe("the SSE data reader (core/wire/sse.js)", () => {
  test("lines split across chunks, [DONE], and a final line without a newline all arrive whole and in order", async () => {
    const { createSseDataReader } = await import("../src/core/wire/sse.js");
    /** @type {string[]} */
    const got = [];
    const r = createSseDataReader((d) => got.push(d));
    r.feed('event: content_block_delta\ndata: {"a":');
    r.feed('1}\n\ndata: {"b":2}\n\nda');
    r.feed('ta: [DONE]\n\ndata: {"c":3}');
    r.end();
    assert.deepEqual(got, ['{"a":1}', '{"b":2}', "[DONE]", '{"c":3}']);
  });
});
