// @ts-check
// Memory's model calls have no clock (HarnessV3-FailurePoints §4 A): every call streams, and only the provider's
// answer or failure, or its caller's signal, ends it. A summary that took its time used to be cut at a total deadline
// in the middle of its answer (a learning pass, a digest, a compaction's summary at the line); then a call someone
// waited on was given up after two minutes without a byte (the filament-agent plan's D3). Background work (learning,
// digests, the curator) names itself, so its slot comes after the person's work; learning and the curator are asked
// again while their provider is busy for a moment, as Filament's own loops are (core/retry.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "../src/memory-service.js";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { textOpen, textDelta, textClose } from "./helpers/sse.js";

const cfgWith = (/** @type {any} */ memory = {}) => ({
  memory: { enabled: false, ...memory },
  rules: defaultsOf(RULES),
  upstreams: [
    { id: "x", type: "openai-compatible", enabled: true, baseUrl: "http://x", pricing: { "gpt-cheap": {} } },
    { id: "a", type: "anthropic", enabled: true, pricing: {} },
  ],
  routes: [
    { match: "gpt-*", upstream: "x", upstreamModel: "{model}" },
    { match: "*-model", upstream: "a", upstreamModel: "{model}" },
  ],
});

/**
 * Filament's front door as memory reaches it, answered by `answer` (model, the request's headers, the response).
 * @param {(model: string, headers: import("node:http").IncomingHttpHeaders, res: import("node:http").ServerResponse) => void} answer
 */
async function door(answer) {
  /** @type {{ model: string, stream: boolean, background: string | null }[]} */
  const seen = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body);
      seen.push({ model: b.model, stream: b.stream === true, background: /** @type {string | undefined} */ (req.headers["x-filament-background"]) ?? null });
      answer(b.model, req.headers, res);
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(null)));
  const port = /** @type {any} */ (srv.address()).port;
  const dir = mkdtempSync(join(tmpdir(), "filament-clocks-"));
  return {
    seen,
    port,
    /** @param {any} cfg */
    memory: (cfg) => new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => `http://127.0.0.1:${port}` }),
    close: () => {
      srv.closeAllConnections();
      srv.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
/** A whole reply on the wire at once. @param {import("node:http").ServerResponse} res @param {string} text */
const answerWith = (res, text) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end([...textOpen(), textDelta(text), ...textClose()].join(""));
};

/** Real time passing, a few event-loop turns at a time: the sockets' work, while the test's clock is mocked. @param {number} ms */
const breathe = async (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end) await new Promise((r) => setImmediate(r));
};

// (fails before: yes — a call someone waits on was given up after two minutes without a byte: "timed out after 2 min
// waiting for slow-model", and a stream quiet as long "went silent for 2 min mid-answer")
test("a memory call has no clock: a head slow to come and a stream that pauses are waited for; its caller's signal ends it", async (t) => {
  /** @type {import("node:http").ServerResponse[]} */
  const held = [];
  /** @type {(() => void) | null} */
  let heard = null;
  const next = () => new Promise((r) => (heard = () => r(undefined)));
  const d = await door((_model, _h, res) => {
    held.push(res);
    heard?.();
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const m = d.memory(cfgWith());
    let came = next();
    let settled = false;
    const slow = m.callModel({ system: "s", user: "u", model: "slow-model" }).finally(() => (settled = true));
    await came;
    t.mock.timers.tick(10 * 60_000); // ten minutes with no head
    await breathe(50);
    assert.equal(settled, false, "a head slow to come is waited for");
    held[0].writeHead(200, { "content-type": "text/event-stream" });
    held[0].write([...textOpen(), textDelta("first half, ")].join(""));
    await breathe(100);
    t.mock.timers.tick(10 * 60_000); // ten minutes quiet mid-answer
    await breathe(50);
    assert.equal(settled, false, "a stream that pauses is waited for");
    held[0].end([textDelta("second half"), ...textClose()].join(""));
    assert.equal(await slow, "first half, second half");
    const stop = new AbortController();
    came = next();
    const stopped = m.callModel({ system: "s", user: "u", model: "held-model", signal: stop.signal });
    await came;
    stop.abort(new Error("the turn was stopped"));
    await assert.rejects(stopped, /the turn was stopped/);
    assert.ok(d.seen.every((s) => s.stream), "every call streams");
    assert.ok(d.seen.every((s) => s.background === null), "a call someone waits on is no background work");
  } finally {
    for (const res of held) if (!res.writableEnded) res.end();
    d.close();
  }
});

// (fails before: yes — background work went as anyone's call, its slot beside the person's work)
test("background work names itself, so its slot comes after the person's work; a call someone waits on does not", async () => {
  const d = await door((model, _h, res) => answerWith(res, `answered by ${model}`));
  try {
    const m = d.memory(cfgWith());
    for (const purpose of ["learn", "curate", "recall"]) {
      assert.equal(await m.callModel({ system: "s", user: "u", model: "gpt-cheap", purpose }), "answered by gpt-cheap");
    }
    assert.deepEqual(d.seen.map((s) => [s.model, s.stream, s.background]), [
      ["gpt-cheap", true, "1"],
      ["gpt-cheap", true, "1"],
      ["gpt-cheap", true, null],
    ]);
  } finally {
    d.close();
  }
});

/**
 * A provider's failure as the front door passes it on: its status, the provider named, what its Retry-After asks.
 * @param {import("node:http").ServerResponse} res @param {number} status @param {string} type @param {string} message @param {string} [wait]
 */
const failWith = (res, status, type, message, wait = "0") => {
  res.writeHead(status, { "content-type": "application/json", "x-filament-upstream": "x", "retry-after": wait });
  res.end(JSON.stringify({ type: "error", error: { type, message } }));
};

// (fails before: yes - one rate limit failed a learning run, "memory's model answered HTTP 429", and the session's turns
// waited for a boundary a finished session never has: the task eval's runs met it, the memory plan's g1)
test("learning and the curator are asked again while their provider is busy for a moment; a call someone waits on, a chat's name, a wall and memory closing are not", async () => {
  let busy = 0;
  let streamBusy = 0;
  const d = await door((model, _h, res) => {
    if (streamBusy-- > 0) {
      res.writeHead(200, { "content-type": "text/event-stream", "x-filament-upstream": "x" });
      return res.end(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Rate limit reached for requests" } })}\n\n`);
    }
    if (model === "gpt-spent") return failWith(res, 429, "insufficient_quota", "You exceeded your current quota, please check your plan and billing details");
    if (model === "gpt-held") return failWith(res, 429, "rate_limit_error", "Rate limit reached for requests", "30");
    if (busy-- > 0) return failWith(res, 429, "rate_limit_error", "Rate limit reached for requests");
    answerWith(res, `answered by ${model}`);
  });
  try {
    const m = d.memory(cfgWith());
    for (const purpose of ["learn", "curate"]) {
      busy = 2;
      const before = d.seen.length;
      assert.equal(await m.callModel({ system: "s", user: "u", model: "gpt-cheap", purpose }), "answered by gpt-cheap", purpose);
      assert.equal(d.seen.length - before, 3, `${purpose}: asked again twice`);
    }
    let before = d.seen.length;
    // A call someone waits on fails at once, and so does a chat's name, which its namer tries again on a later turn.
    for (const purpose of ["recall", "title"]) {
      busy = 1;
      before = d.seen.length;
      await assert.rejects(m.callModel({ system: "s", user: "u", model: "gpt-cheap", purpose }), /HTTP 429: .*Rate limit reached/);
      assert.equal(d.seen.length - before, 1, `${purpose}: fails at once`);
    }
    // An error inside a 200 stream, the provider's limit said after its head, is asked again as one before it.
    busy = 0;
    streamBusy = 1;
    before = d.seen.length;
    assert.equal(await m.callModel({ system: "s", user: "u", model: "gpt-cheap", purpose: "learn" }), "answered by gpt-cheap");
    assert.equal(d.seen.length - before, 2, "an error inside a 200 stream asked again");
    busy = 0;
    before = d.seen.length;
    await assert.rejects(m.callModel({ system: "s", user: "u", model: "gpt-spent", purpose: "learn" }), /HTTP 429: .*quota/);
    assert.equal(d.seen.length - before, 1, "a spent allowance is a wall: no try passes it");
    const closing = new AbortController();
    before = d.seen.length;
    const t0 = Date.now();
    const held = m.callModel({ system: "s", user: "u", model: "gpt-held", purpose: "learn", signal: closing.signal });
    while (d.seen.length === before) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 200)); // its answer read: the 30 s its Retry-After asks begin
    closing.abort(new Error("memory closed"));
    await assert.rejects(held, /HTTP 429|memory closed/);
    assert.ok(Date.now() - t0 < 10_000, "memory closing ends the wait");
    assert.equal(d.seen.length - before, 1);
  } finally {
    d.close();
  }
});
