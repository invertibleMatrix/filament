// @ts-check
// A reader that falls behind loses nothing (the perf pass's A5). `writeSse` skipped a write while the socket needed
// draining and still answered true, so its caller took the line for sent: the run events stream's replay wrote its
// first event straight after the words frame, and when that frame had filled the socket the event was gone — the
// follow's number had moved past it, so no reconnect asked for it again. A write the socket cannot take yet now waits
// in the stream's queue, and a stream is closed only past its byte cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { createLiveWords } from "../src/services/live-words.js";
import { writeSse } from "../src/http/events.js";
import { runRoutes } from "../src/http/admin/runs.js";

/** The stream's `data:` frames, parsed. @param {string} text @returns {any[]} */
const framesOf = (text) =>
  text
    .split("\n\n")
    .map((block) => /^data: (.*)$/m.exec(block)?.[1])
    .filter((d) => d !== undefined)
    .map((d) => JSON.parse(String(d)));

/**
 * A response whose reader is away until `resume`: the first write is in flight, every later one waits in the stream's
 * own buffer, and past `highWaterMark` bytes the stream asks for a drain — as a socket whose page reads nothing does.
 * @param {number} highWaterMark
 */
function awayReader(highWaterMark) {
  /** @type {string[]} */
  const chunks = [];
  let away = true;
  /** @type {(() => void)[]} */
  const held = [];
  const res = new Writable({
    highWaterMark,
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      if (away) held.push(cb);
      else setImmediate(cb);
    },
  });
  Object.assign(res, { writeHead: () => res });
  return {
    res,
    chunks,
    resume: () => {
      away = false;
      for (const cb of held.splice(0)) setImmediate(cb);
    },
  };
}

// (fails before: yes — the line was skipped and `true` came back)
test("a line written to a stream that needs draining waits for the reader, and is said sent only when it will be", async () => {
  const { res, chunks, resume } = awayReader(64);
  const clients = new Set([res]);
  assert.equal(writeSse(clients, /** @type {any} */ (res), `data: ${"x".repeat(100)}\n\n`), true);
  assert.equal(res.writableNeedDrain, true, "the stream is full");
  assert.equal(writeSse(clients, /** @type {any} */ (res), "data: the second line\n\n"), true);
  resume();
  await new Promise((r) => res.once("drain", r));
  assert.deepEqual(chunks.map((c) => c.slice(0, 12)), ["data: xxxxxx", "data: the se"], "the second line reached the reader");
  assert.ok(clients.has(res));
});

// (fails before: yes — the run events stream lost event 1: the 200 KB words frame filled the socket, and the replay's
// first write was skipped and counted as sent)
test("the run events stream: the replay's first event after a words frame that filled the socket reaches the reader", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-backlog-"));
  const bus = createEventBus();
  const runs = createRunLog({ events: bus, dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }) });
  const liveWords = createLiveWords();
  const req = Object.assign(new EventEmitter(), { headers: {} });
  try {
    runs.startRun({ id: "r1", kind: "agent-turn" });
    bus.publish("run:r1", { type: "round-start", round: 1 });
    bus.publish("run:r1", { type: "round-text", round: 1, text: "Reading the file." });
    liveWords.start("r1");
    liveWords.piece("r1", "text", "w".repeat(200_000));
    const route = runRoutes({ runs, sseClients: new Set(), liveWords }).find(([m, p]) => m === "GET" && p === "/runs/:id/events");
    assert.ok(route);
    const { res, chunks, resume } = awayReader(16 * 1024);
    const served = route[2]({ req, res, url: new URL("http://x/api/runs/r1/events?since=0&stream=1&words=1"), params: { id: "r1" } });
    resume();
    await served;
    // Everything written has reached the reader.
    while (res.writableLength) await new Promise((r) => setImmediate(r));
    const frames = framesOf(chunks.join(""));
    assert.deepEqual(frames.map((f) => f.type), ["hello", "words", "run-start", "round-start", "round-text"]);
    assert.deepEqual(frames.filter((f) => f.n).map((f) => f.n), [1, 2, 3], "every event, the first one too");
    assert.equal(frames[1].blocks[0].text.length, 200_000, "the words whole");
  } finally {
    req.emit("close");
    runs.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
