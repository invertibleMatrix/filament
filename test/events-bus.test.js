// @ts-check
// The event bus: synchronous delivery in publication order (a subscriber that writes a client's wire writes the same
// bytes a direct call wrote), one monotonic seq across topics, and nothing kept once delivered. And the console's
// `/api/events` over it: each event serialised once for every window, and a window that stopped reading cut off at the
// stream's backlog cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { attachEventsStream, BACKLOG_BYTES } from "../src/http/events.js";
import { createRunLog } from "../src/services/runs.js";

test("subscribers get every event of their topic, then the wildcard ones, synchronously and in order", () => {
  const bus = createEventBus();
  /** @type {string[]} */
  const seen = [];
  bus.subscribe("record", (p) => seen.push(`record:${p.n}`));
  bus.subscribe("*", (p, e) => seen.push(`*:${e.topic}:${p.n}:${e.seq}`));
  bus.subscribe("op", (p) => seen.push(`op:${p.n}`));
  bus.publish("record", { n: 1 });
  bus.publish("op", { n: 2 });
  const entry = bus.publish("record", { n: 3 });
  assert.deepEqual(seen, ["record:1", "*:record:1:1", "op:2", "*:op:2:2", "record:3", "*:record:3:3"]);
  assert.equal(entry.seq, 3);
  assert.equal(entry.topic, "record");
  assert.deepEqual(entry.payload, { n: 3 });
  assert.ok(Number.isFinite(entry.ts));
});

test("unsubscribing stops delivery", () => {
  const bus = createEventBus();
  let n = 0;
  const off = bus.subscribe("record", () => n++);
  bus.publish("record", "a");
  off();
  bus.publish("record", "b");
  assert.equal(n, 1);
});

// (fails before: yes — the second call of an unsubscribe, as /api/events makes for a window its write failed (once on
// the failure, once on the close), deleted the topic's set as it stood, a newer window's subscription with it)
test("an unsubscribe called again leaves the topic's newer subscribers hearing it", () => {
  const bus = createEventBus();
  const heard = [];
  const off = bus.subscribe("turns", () => heard.push("old"));
  off();
  bus.subscribe("turns", (/** @type {string} */ p) => heard.push(p));
  off();
  bus.publish("turns", "new");
  assert.deepEqual(heard, ["new"]);
});

// (fails before: yes — c97b98c59's bus kept a ring for each `session:<id>` topic, for a session's live view that no
// page followed, and answered `replay`, `forget` and `topics` for it)
test("the bus keeps nothing it delivered: it publishes and subscribes, and has nothing to replay", () => {
  const bus = createEventBus();
  /** @type {string[]} */
  const heard = [];
  bus.subscribe("*", (_p, e) => heard.push(`${e.topic}:${e.seq}`));
  bus.publish("record", { type: "progress" });
  bus.publish("run:r1", { type: "tool-output" });
  bus.publish("turns", { type: "turn", chainId: "s1", holder: null });
  assert.deepEqual(heard, ["record:1", "run:r1:2", "turns:3"], "every topic delivered, numbered across topics");
  assert.deepEqual(Object.keys(bus).sort(), ["publish", "subscribe"]);
});

// (fails before: yes — each open window serialised every event again for itself)
test("/api/events serialises each event once, however many windows are open, and every window gets the same bytes", () => {
  const bus = createEventBus();
  /** A window's stream, stood in: what the route writes, and its request's close. */
  const window = () => {
    const req = Object.assign(new EventEmitter(), { url: "/api/events" });
    /** @type {string[]} */
    const wrote = [];
    const res = { writableEnded: false, destroyed: false, writableNeedDrain: false, writableLength: 0, writeHead: () => res, write: (/** @type {string} */ s) => (wrote.push(s), true), destroy() {} };
    return { req, res, wrote };
  };
  const sseClients = new Set();
  const windows = [window(), window(), window()];
  for (const w of windows) attachEventsStream(/** @type {any} */ (w.req), /** @type {any} */ (w.res), { events: bus, sseClients, VERSION: "t" });
  const payload = { type: "finish", record: { id: "r1", model: "m", tokens: 42 } };
  let serialised = 0;
  const real = JSON.stringify;
  JSON.stringify = /** @type {any} */ (function (/** @type {any} */ v, /** @type {any[]} */ ...rest) {
    if (v === payload) serialised++;
    return real.call(JSON, v, ...rest);
  });
  try {
    bus.publish("record", payload);
    // The same object published again (a producer that changed it) is serialised again: the line is the publish's.
    payload.record.tokens = 43;
    bus.publish("record", payload);
  } finally {
    JSON.stringify = real;
  }
  assert.equal(serialised, 2, "once per publish, not once per window");
  for (const w of windows) assert.deepEqual(w.wrote.slice(1), [`data: ${real(payload).replace("43", "42")}\n\n`, `data: ${real(payload)}\n\n`]);
  for (const w of windows) w.req.emit("close");
  assert.equal(sseClients.size, 0);
});

// (fails before: yes — every window heard every topic, a coding agent's 140 KB finish included)
test("/api/events?only= sends those topics alone: another machine's desk hears holders, writers and asks, never a record", () => {
  const bus = createEventBus();
  const sseClients = new Set();
  /** @param {string} url */
  const window = (url) => {
    const req = Object.assign(new EventEmitter(), { url });
    /** @type {string[]} */
    const wrote = [];
    const res = { writableEnded: false, destroyed: false, writableNeedDrain: false, writableLength: 0, writeHead: () => res, write: (/** @type {string} */ s) => (wrote.push(s), true), destroy() {} };
    attachEventsStream(/** @type {any} */ (req), /** @type {any} */ (res), { events: bus, sseClients, VERSION: "t" });
    return { req, types: () => wrote.slice(1).map((l) => JSON.parse(l.slice(6)).type) };
  };
  const desk = window("/api/events?tab=desk-1&only=turns,%20writers");
  const page = window("/api/events?tab=page-1");
  bus.publish("record", { type: "finish", record: { id: "r1" } });
  bus.publish("turns", { type: "turn", chainId: "c1", holder: null });
  bus.publish("writers", { type: "writer", chainId: "c1", tab: "t", where: null });
  bus.publish("graph", { type: "graph-changed", sessionId: "c1" });
  bus.publish("turns", { type: "ask", chainId: "c1", id: "r1.q1", open: true });
  assert.deepEqual(desk.types(), ["turn", "writer", "ask"], "the desk's window: its topics alone, in order");
  assert.deepEqual(page.types(), ["finish", "turn", "writer", "graph-changed", "ask"], "a window that names none hears every topic");
  desk.req.emit("close");
  page.req.emit("close");
  assert.equal(sseClients.size, 0);
});

// (fails before: yes — a coding agent's question reached another machine's desk only at its next look)
test("a coding agent's question that waits is said on `turns` by its chat and the ask's id, opened and settled; a lead's or one that does not wait is not", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "llmshim-ask-events-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const bus = createEventBus();
  /** @type {any[]} */
  const said = [];
  bus.subscribe("turns", (p) => said.push(p));
  const runs = createRunLog({ events: bus, dataDir, config: () => ({ observability: { runEvents: { persist: false, retentionDays: 7, maxPerRun: 5000, keepRuns: 50, toolPreviewChars: 2000 } } }) });
  runs.startRun({ id: "r1", kind: "coding-agent", meta: { chain: "c1" } });
  runs.startRun({ id: "r2", kind: "agent-turn", meta: { chain: "c2" } });
  runs.startRun({ id: "r3", kind: "coding-agent", meta: {} });
  bus.publish("run:r1", { type: "ask", id: "q1", waits: true, kind: "question", question: "which way?" });
  bus.publish("run:r1", { type: "ask", id: "q2", waits: true, kind: "lead" });
  bus.publish("run:r1", { type: "ask", id: "q3", waits: false, kind: "question" });
  bus.publish("run:r2", { type: "ask", id: "q1", waits: true, kind: "question" });
  bus.publish("run:r3", { type: "ask", id: "q1", waits: true, kind: "question" });
  bus.publish("run:r1", { type: "ask-end", id: "q1" });
  assert.deepEqual(said, [
    { type: "ask", chainId: "c1", id: "r1.q1", open: true },
    { type: "ask", chainId: "c1", id: "r1.q1", open: false },
  ]);
  assert.ok(!JSON.stringify(said).includes("which way"), "its words stay in the run");
  runs.endRun("r1", { status: "done" });
  runs.endRun("r2", { status: "done" });
  runs.endRun("r3", { status: "done" });
});

/**
 * A window's `/api/events` stream on a socket: one that takes what it is written (`reading`), or one whose reader
 * stopped — nothing it is written ever leaves, so its queue only grows.
 * @param {{ reading: boolean }} o
 */
function socketWindow({ reading }) {
  /** @type {string[]} */
  const got = [];
  const res = /** @type {any} */ (
    new Writable({
      highWaterMark: 16 * 1024,
      write(chunk, _enc, cb) {
        got.push(String(chunk));
        if (reading) cb();
      },
    })
  );
  res.writeHead = () => res;
  const req = Object.assign(new EventEmitter(), { url: "/api/events" });
  return { res, req, got, close: () => req.emit("close") };
}

// (fails before: no — a guard: every event the feed writes goes through `writeSse`, and so through `writeHeld`'s cap)
test("/api/events closes a window that stopped reading once its queue would pass the backlog cap; one that reads gets every line in order", (t) => {
  const bus = createEventBus();
  const sseClients = new Set();
  const stuck = socketWindow({ reading: false });
  const keeps = socketWindow({ reading: true });
  t.after(() => {
    stuck.close();
    keeps.close();
  });
  for (const w of [stuck, keeps]) attachEventsStream(/** @type {any} */ (w.req), w.res, { events: bus, sseClients, VERSION: "t" });
  const big = "x".repeat(1024 * 1024);
  for (let n = 1; n <= 12; n++) bus.publish("record", { type: "finish", text: big, n });
  assert.equal(stuck.res.destroyed, true, "the stopped window's stream is closed, so its EventSource connects again");
  assert.ok(stuck.res.writableLength <= BACKLOG_BYTES, `its queue stayed within the cap (${stuck.res.writableLength} bytes)`);
  assert.ok(!sseClients.has(stuck.res), "and it is out of the open streams");
  assert.equal(keeps.res.destroyed, false, "a window that reads stays open");
  assert.equal(keeps.got.length, 1 + 12, "the hello and the twelve events");
  assert.deepEqual(
    keeps.got.slice(1).map((l) => JSON.parse(l.slice(6)).n),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    "in order",
  );
});

test("the dashboard's /api/events carries records and ops, never a run's events", async () => {
  const { startApp } = await import("./helpers/app.js");
  const t = await startApp();
  try {
    const ac = new AbortController();
    const res = await fetch(`${t.url}/api/events`, { headers: { "x-filament-ui": "1" }, signal: ac.signal });
    assert.equal(res.status, 200);
    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    let text = "";
    const readUntil = async (/** @type {string} */ needle) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    };
    await readUntil('"hello"');
    t.app.events.publish("run:abc", { type: "round-text", text: "the loop's words" });
    t.app.events.publish("record", { record: { id: "r1" } });
    t.app.events.publish("op", { op: { title: "an op" } });
    await readUntil('"an op"');
    const payloads = text
      .split("\n\n")
      .filter((b) => b.startsWith("data: "))
      .map((b) => JSON.parse(b.slice(6)));
    assert.deepEqual(payloads.slice(1), [{ record: { id: "r1" } }, { op: { title: "an op" } }]);
    assert.ok(!text.includes("the loop's words"), "a run's events stay with the client that owns the run");
    ac.abort();
  } finally {
    await t.stop();
  }
});

test("a configuration save reaches the stream as config-changed, with the op log off too (the harness re-reads its catalogue)", async () => {
  const { startApp } = await import("./helpers/app.js");
  const t = await startApp({ configure: (cfg) => { cfg.observability.ops = { ...(cfg.observability.ops || {}), enabled: false }; } });
  try {
    const ac = new AbortController();
    const res = await fetch(`${t.url}/api/events`, { headers: { "x-filament-ui": "1" }, signal: ac.signal });
    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    let text = "";
    const readUntil = async (/** @type {string} */ needle) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    };
    await readUntil('"hello"');
    const st = await (await t.api("/api/state")).json();
    const put = await t.api("/api/config", { method: "PUT", body: st.config });
    assert.equal(put.status, 200, await put.clone().text());
    await readUntil('"config-changed"');
    // It says the version the save made, so an open dashboard knows whether its draft is the newest (HS-D3).
    assert.ok(text.includes(`{"type":"config-changed","version":${(await put.json()).version}}`), text.slice(-300));
    assert.ok(!text.includes('"kind":"config"'), "the op log is off: no op came, the stream said it anyway");
    ac.abort();
  } finally {
    await t.stop();
  }
});
