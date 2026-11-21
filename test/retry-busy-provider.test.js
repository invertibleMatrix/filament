// @ts-check
// HarnessV3-AtHome AH-F4 (2026-10-04): one 429 from a busy provider ended a turn that had worked for minutes — the
// spin's turn died on kimi-cn's "engine is overloaded". Filament's own loops now try a model call again when the
// provider was busy for a moment, as Claude Code does: up to ten tries, waiting 1 s, 2 s, 4 s … up to 32 s, or what
// the provider's Retry-After asks. The wait is the turn's state while it lasts (the page draws it beside the timer)
// and a line of the record; Stop ends it. Only a failure that reached a provider is tried again, and only while
// nothing of the round has streamed — or when its stream broke part-way on the provider's side, a 5xx or a dropped
// connection (HarnessV3-FailurePoints FP-D6): what it had streamed leaves the round, and the page closes it with a
// line. The forks that write a compaction's summary try again the same way.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { createInternalCall } from "../src/app/internal-call.js";
import { dispatch } from "../src/app/pipeline/stages/dispatch.js";
import { HealthBoard, ConcurrencyGate } from "../src/services/health.js";
import { alignEvents, turnStateWords } from "../src/ui/harness/lib/labels.js";
import { startApp, fakeUpstream, anthropicReply, parseSse, postOverHttp } from "./helpers/app.js";
import { removeDirs, until, gate } from "./helpers/wait.js";
import { houseAuth } from "../src/services/house.js";

const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null, upstream: "kimi-cn", retryAfter: null });
/**
 * A failed call as the internal call reports it: by default from kimi-cn, with no Retry-After.
 * @param {number} status @param {string} type @param {string} message @param {Record<string, any>} [more]
 */
const busy = (status, type, message, more = {}) => ({ ok: false, status, json: { type: "error", error: { type, message } }, id: null, upstream: "kimi-cn", retryAfter: null, ...more });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    ...over,
  });
const waitsIn = (/** @type {any[]} */ events) => events.filter((e) => e.type === "turn-state" && e.to === "waiting");

// (fails before: yes — the first 429 ended the turn: "the model call failed: The engine is currently overloaded")
test("a provider overloaded twice is tried again after 1 s and then 2 s, and the third try's answer ends the turn", async () => {
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const t0 = Date.now();
  const out = await runAgentTurn(args({
    call: async () => (++n <= 2 ? busy(429, "overloaded_error", "The engine is currently overloaded") : reply([{ type: "text", text: "Done." }])),
    onEvent: (e) => events.push(e),
  }));
  assert.deepEqual([out.status, n], ["done", 3]);
  assert.ok(Date.now() - t0 >= 2900, `it waited 1 s, then 2 s (${Date.now() - t0} ms)`);
  assert.deepEqual(waitsIn(events).map((e) => [e.why, e.retry]), [
    ["kimi-cn is overloaded — trying again in 1 s (try 2 of 10)", { upstream: "kimi-cn", status: 429, waitMs: 1000, next: 2, of: 10 }],
    ["kimi-cn is overloaded — trying again in 2 s (try 3 of 10)", { upstream: "kimi-cn", status: 429, waitMs: 2000, next: 3, of: 10 }],
  ]);
  assert.deepEqual(events.filter((e) => e.type === "turn-state").map((e) => e.to), ["planning", "waiting", "planning", "waiting", "planning", "done"], "each try after a wait thinks again");
  assert.deepEqual(out.notes.filter((s) => s.startsWith("agent: round 1:")), [
    "agent: round 1: kimi-cn is overloaded — trying again in 1 s (try 2 of 10)",
    "agent: round 1: kimi-cn is overloaded — trying again in 2 s (try 3 of 10)",
  ]);
  assert.deepEqual(out.final, [{ type: "text", text: "Done." }]);
});

// (fails before: yes — one try, and the failure said nothing of tries)
test("the provider's Retry-After is the wait, 0 tries again at once, and after ten tries the turn fails saying so", async () => {
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const out = await runAgentTurn(args({ call: async () => (++n, busy(529, "overloaded_error", "Overloaded", { retryAfter: 0 })), onEvent: (e) => events.push(e) }));
  assert.deepEqual([n, out.status, out.error], [10, "failed", "round 1's model call to m at kimi-cn failed after 10 tries: Overloaded (HTTP 529)."]);
  const waits = waitsIn(events);
  assert.equal(waits.length, 9);
  assert.deepEqual([waits[0].why, waits[8].why], ["kimi-cn is overloaded — trying again now (try 2 of 10)", "kimi-cn is overloaded — trying again now (try 10 of 10)"]);
  assert.ok(out.notes.includes("agent: round 1 failed after 10 tries (Overloaded)"), out.notes.join("\n"));

  /** @type {any[]} */
  const limited = [];
  let m = 0;
  const t0 = Date.now();
  const ok = await runAgentTurn(args({
    call: async () => (++m === 1 ? busy(429, "rate_limit_error", "Rate limit reached", { retryAfter: 1 }) : reply([{ type: "text", text: "Done." }])),
    onEvent: (e) => limited.push(e),
  }));
  assert.deepEqual([ok.status, m], ["done", 2]);
  assert.ok(Date.now() - t0 >= 950, "the provider asked for a second");
  assert.deepEqual(waitsIn(limited).map((e) => e.why), ["kimi-cn is limiting the rate of calls — trying again in 1 s (try 2 of 10)"]);
});

// (fails before: yes — the owner's plan of 11-05: an agent with another row of its list to go on to waited out a 429 on
// its first call through ten tries)
test("an agent with another row to go on to takes a 429 on its first call as its answer: untried again, so it goes on down its rows", async () => {
  let n = 0;
  const out = await runAgentTurn(args({ rateMovesOn: true, call: async () => (++n, busy(429, "rate_limit_error", "Rate limit reached", { retryAfter: 0 })) }));
  assert.deepEqual([n, out.status], [1, "failed"]);
  let m = 0;
  const busier = await runAgentTurn(args({ rateMovesOn: true, call: async () => (++m === 1 ? busy(529, "overloaded_error", "Overloaded", { retryAfter: 0 }) : reply([{ type: "text", text: "Done." }])) }));
  assert.deepEqual([busier.status, m], ["done", 2], "a busy provider's 5xx is tried again as ever");
});

// (fails before: yes — a provider Filament could not reach ended the turn at once)
test("a provider that could not be reached is tried again", async () => {
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const out = await runAgentTurn(args({
    call: async () => (++n === 1 ? busy(502, "api_error", "upstream kimi-cn unreachable: ECONNREFUSED", { retryAfter: 0 }) : reply([{ type: "text", text: "Done." }])),
    onEvent: (e) => events.push(e),
  }));
  assert.deepEqual([out.status, n], ["done", 2]);
  assert.deepEqual(waitsIn(events).map((e) => e.why), ["kimi-cn could not be reached — trying again now (try 2 of 10)"]);
});

// (fails before: yes — nothing waited, so the turn ended at once on the 429 rather than on the stop)
test("a stop during the wait ends it at once, and the turn stops; the client hanging up ends it too", async () => {
  const stop = new AbortController();
  let n = 0;
  const t0 = Date.now();
  const out = await runAgentTurn(args({
    call: async () => {
      ++n;
      setTimeout(() => stop.abort(), 200);
      return busy(429, "overloaded_error", "Overloaded", { retryAfter: 30 });
    },
    mailbox: { read: () => (stop.signal.aborted ? [{ kind: "stop", text: "" }] : []), stopSignal: stop.signal },
  }));
  assert.deepEqual([out.status, n], ["stopped", 1]);
  assert.ok(Date.now() - t0 < 5000, `the 30 s wait ended with the stop (${Date.now() - t0} ms)`);

  const gone = new AbortController();
  let m = 0;
  const hungUp = await runAgentTurn(args({
    call: async () => {
      ++m;
      setTimeout(() => gone.abort(), 200);
      return busy(429, "overloaded_error", "Overloaded", { retryAfter: 30 });
    },
    signal: gone.signal,
  }));
  assert.deepEqual([hungUp.status, m], ["aborted", 1]);
});

// (fails before: yes — a round that had streamed was never tried again: the provider's broken stream failed the turn)
test("a round whose stream broke on the provider's side is asked again: what it had streamed is dropped, and the page closes it with a line", async () => {
  /** @type {any[]} */
  const events = [];
  const page = { ...sink, blocks: 0, written: /** @type {string[]} */ ([]), text(/** @type {string} */ t) { this.written.push(t); } };
  let n = 0;
  const out = await runAgentTurn(args({
    sink: page,
    onEvent: (e) => events.push(e),
    call: async ({ onDelta }) => {
      if (++n > 1) return reply([{ type: "text", text: "Whole." }]);
      onDelta?.({ kind: "thinking", text: "Let me" });
      onDelta?.({ kind: "text", text: "Partial" });
      return busy(500, "api_error", "stream failure: terminated", { retryAfter: 0, inStream: true });
    },
  }));
  assert.deepEqual([n, out.status], [2, "done"]);
  assert.deepEqual(out.final, [{ type: "text", text: "Whole." }], "the next try's answer, nothing of the broken one");
  assert.deepEqual(waitsIn(events).map((e) => e.why), ["kimi-cn's stream broke off (stream failure: terminated) — trying again now (try 2 of 10); what it had streamed (6 characters of thinking and 7 characters of text) is dropped"]);
  assert.deepEqual(page.written, ["Partial", "(Filament: the provider's stream broke off here; the round is asked again.)", "Whole."], "the page keeps what it saw, closed by the line, then the next try's words");
});

// (fails before: no — guards FP-D6's other side: a 4xx is the request's own fault, so words already read are not taken
// back for it)
test("a round whose stream ended in a 4xx is not asked again", async () => {
  let n = 0;
  const out = await runAgentTurn(args({
    call: async ({ onDelta }) => {
      ++n;
      onDelta?.({ kind: "text", text: "Partial" });
      return busy(429, "rate_limit_error", "Rate limit reached", { retryAfter: 0, inStream: true });
    },
  }));
  assert.deepEqual([n, out.status], [1, "failed"]);
  assert.match(String(out.error), /^round 1's model call to m at kimi-cn failed: .*It had streamed about 2 tokens of text\.$/);
});

// (fails before: no — guards what is not tried again: Filament's own refusal names no provider, a 400 is the request's
// fault, and a failure the dispatch says not to try again — an adapter's own judgment — is not)
test("Filament's own refusal, a provider's permanent error and a failure marked not to try again end the turn at once", async () => {
  for (const r of [
    busy(503, "api_error", "Filament is restarting; try again in a few seconds", { upstream: null, retryAfter: 5 }),
    busy(400, "invalid_request_error", "messages: field required"),
    busy(502, "api_error", "Qoder: the token was refused", { shouldRetry: false }),
  ]) {
    let n = 0;
    const out = await runAgentTurn(args({ call: async () => (++n, r) }));
    assert.deepEqual([n, out.status, out.error], [1, "failed", `round 1's model call to m${r.upstream ? ` at ${r.upstream}` : ""} failed: ${r.json.error.message} (HTTP ${r.status}).`]);
  }
});

// (fails before: yes — the turn failed with the provider's words alone, nothing of when to come back) — since
// HarnessV3-TaskGraph-v2 TG2-D54 (2026-10-14) a 429 that asks for more than ten minutes says this account is served
// again only then: an out, not tried again, said as one with its reset (test/provider-walls.test.js); a busy provider
// that asks as long keeps these words.
test("a Retry-After over ten minutes is not waited out: the turn ends saying when the provider takes calls again", async () => {
  let n = 0;
  const out = await runAgentTurn(args({ call: async () => (++n, busy(429, "rate_limit_error", "Rate limit reached", { retryAfter: 3600 })) }));
  assert.deepEqual([n, out.status], [1, "failed"]);
  assert.equal(out.error, "round 1's model call to m at kimi-cn failed: Rate limit reached (HTTP 429). Not tried again: kimi-cn says this account's allowance is used up, until it resets in 60 min.");
  let m = 0;
  const busier = await runAgentTurn(args({ call: async () => (++m, busy(529, "overloaded_error", "Overloaded", { retryAfter: 3600 })) }));
  assert.deepEqual([m, busier.status], [1, "failed"]);
  assert.equal(busier.error, "round 1's model call to m at kimi-cn failed: kimi-cn is overloaded and asks to be called again in 60 min — Overloaded (HTTP 529).");
});

// (fails before: yes — a waiting state read as "waiting for its sub-agents")
test("the page draws a wait between tries in the fold's live words", () => {
  const e = { type: "turn-state", from: "planning", to: "waiting", why: "kimi-cn is overloaded — trying again in 8 s (try 4 of 10)", retry: { upstream: "kimi-cn", status: 529, waitMs: 8000, next: 4, of: 10 } };
  assert.equal(turnStateWords(e), "kimi-cn is overloaded — trying again in 8 s (try 4 of 10)");
  assert.equal(turnStateWords(alignEvents([{ n: 1, ...e }]).turnState), "kimi-cn is overloaded — trying again in 8 s (try 4 of 10)");
  assert.equal(turnStateWords({ to: "waiting", why: "the turn's background sub-agents are running" }), "waiting for its agents", "a wait for its agents keeps its words");
});

// (fails before: yes — the result named no provider and no Retry-After, and an error inside a 200 stream was a 502
// whatever it said)
test("the internal call says which provider failed, what its Retry-After asks, and an error inside a stream by its type", async () => {
  /** @type {(req: http.IncomingMessage, res: http.ServerResponse) => void} */
  let answer = () => {};
  const door = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => answer(req, res));
  });
  await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (door.address()).port;
  const call = createInternalCall({ config: () => ({ server: { port } }), log: () => {} });
  const error = (/** @type {string} */ type, /** @type {string} */ message) => JSON.stringify({ type: "error", error: { type, message } });
  try {
    answer = (_q, res) => {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "7", "x-filament-upstream": "kimi-cn", "x-filament-request-id": "req-1" });
      res.end(error("overloaded_error", "Overloaded"));
    };
    const r = await call({ body: { model: "x", messages: [] } });
    assert.deepEqual([r.ok, r.status, r.id, r.upstream, r.retryAfter, r.shouldRetry], [false, 429, "req-1", "kimi-cn", 7, null]);

    answer = (_q, res) => {
      res.writeHead(503, { "content-type": "application/json", "retry-after": new Date(Date.now() + 30_000).toUTCString(), "x-filament-upstream": "kimi-cn" });
      res.end(error("api_error", "busy"));
    };
    const dated = await call({ body: { model: "x", messages: [] } });
    assert.ok(Number(dated.retryAfter) > 27 && Number(dated.retryAfter) <= 30, `an HTTP date, in seconds from now: ${dated.retryAfter}`);

    answer = (_q, res) => {
      res.writeHead(429, { "content-type": "application/json", "retry-after-ms": "1500", "retry-after": "9", "x-should-retry": "false" });
      res.end(error("rate_limit_error", "slow down"));
    };
    const ms = await call({ body: { model: "x", messages: [] } });
    assert.deepEqual([ms.retryAfter, ms.shouldRetry, ms.upstream], [1.5, false, null], "retry-after-ms wins; no provider named, as for Filament's own refusals");

    answer = (_q, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "x-filament-upstream": "kimi-cn" });
      res.end(`event: error\ndata: ${error("overloaded_error", "Overloaded")}\n\n`);
    };
    const streamed = await call({ body: { model: "x", messages: [] }, onDelta: () => {} });
    assert.deepEqual([streamed.ok, streamed.status, streamed.upstream], [false, 529, "kimi-cn"], "an overloaded error inside a 200 stream is an overloaded failure");
    answer = (_q, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "x-filament-upstream": "kimi-cn" });
      res.end(`event: error\ndata: ${error("invalid_request_error", "bad image")}\n\n`);
    };
    assert.equal((await call({ body: { model: "x", messages: [] }, onDelta: () => {} })).status, 400, "and a refused request inside one is the request's fault");
  } finally {
    await new Promise((r) => door.close(() => r(undefined)));
  }
});

// (fails before: no — a guard the mutation pass asked for: no test met a provider whose adapter judged another try
// pointless, so nothing read the header that says so)
test("the front door's final error names its provider, and says not to try again when the provider's adapter judged another try pointless", async () => {
  /** @param {boolean} retryable */
  const failOnce = async (retryable) => {
    /** @type {{ status: number, headers: Record<string, any>, body: string }} */
    const sent = { status: 0, headers: {}, body: "" };
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead(/** @type {number} */ status, /** @type {Record<string, any>} */ headers) {
        Object.assign(sent, { status, headers });
        this.headersSent = true;
      },
      end(/** @type {string} */ b) {
        sent.body = String(b || "");
        this.writableEnded = true;
      },
    };
    const upstream = { id: "q", type: "qoder" };
    const ctx = /** @type {any} */ ({ res, format: "anthropic", body: { model: "q1", messages: [] }, raw: "{}", pre: null, headers: {}, requested: { base: "q1" }, route: { match: "q1" }, rec: { id: "rq_q" }, house: false, client: { abort: new AbortController() }, flags: { bodiesAllowed: false }, memory: {}, candidates: [{ upstream: "q" }], failover: true, t0: performance.now() });
    const deps = /** @type {any} */ ({
      config: () => ({ upstreams: [upstream], observability: { storeBodies: "none", maxStoredBodyBytes: 0 } }),
      log: () => {},
      health: new HealthBoard(),
      concurrency: new ConcurrencyGate(),
      plan: () => ({ upstream, shaped: { body: { model: "q1" }, changes: [] }, headers: {}, url: "http://q.invalid/v1/messages" }),
      destination: () => ({
        answers: {
          open: async () => {
            throw new Error("the token was refused");
          },
          unreachable: (/** @type {any} */ e) => ({ message: `Qoder: ${e.message}`, retryable }),
        },
      }),
      wireApiFor: () => null,
      finish: () => {},
    });
    assert.equal(await dispatch({ turn: async () => undefined })(ctx, deps), "replied");
    return sent;
  };
  const pointless = await failOnce(false);
  assert.equal(pointless.status, 502);
  assert.deepEqual([pointless.headers["x-filament-upstream"], pointless.headers["x-should-retry"]], ["q", "false"]);
  assert.match(pointless.body, /Qoder: the token was refused/);
  const worthIt = await failOnce(true);
  assert.deepEqual([worthIt.headers["x-filament-upstream"], worthIt.headers["x-should-retry"]], ["q", undefined], "a failure worth another try leaves the header out");
});

describe("through the front door", () => {
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  let gonePort = 0;
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const sysOf = (/** @type {any} */ b) => (Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b.system || ""));
  const lastText = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => c.text).join("\n"));
  /** A reply that read and wrote the provider's cache, so the loop's own conversation is warm to fork. @param {any[]} blocks @param {string} [stop] */
  const answer = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } });
  const overloaded = (retryAfter = "0") => ({ status: 429, json: { type: "error", error: { type: "overloaded_error", message: "The engine is currently overloaded, please try again later" } }, headers: { "retry-after": retryAfter } });
  const isFork = (/** @type {any} */ b) => /^\[Filament: (this turn has reached the compaction line|the developer asked to compact this turn now)\./.test(lastText(b.messages?.at(-1)));
  const isTranscriptSummary = (/** @type {any} */ b) => sysOf(b).includes("compaction summaries");

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-retry-busy-"));
    for (const f of ["a", "b", "c"]) writeFileSync(join(root, `${f}.txt`), `MARKER-${f.toUpperCase()} ${"words ".repeat(800)}`);
    up = await fakeUpstream(async (call) => brain(call));
    const closed = http.createServer();
    await new Promise((r) => closed.listen(0, "127.0.0.1", () => r(undefined)));
    gonePort = /** @type {import("node:net").AddressInfo} */ (closed.address()).port;
    await new Promise((r) => closed.close(() => r(undefined)));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } },
          { id: "gone", name: "gone", type: "anthropic", baseUrl: `http://127.0.0.1:${gonePort}`, apiKey: "s", enabled: true },
        ];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "gone-*", upstream: "gone", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  const H = () => ({ "x-filament-cwd": root, "x-session-id": `retry-${Math.random().toString(36).slice(2, 8)}` });

  // (fails before: yes — the client got the provider's 429 as the turn's failure)
  test("a turn's round meets the provider's overloaded 429 twice, waits as its Retry-After says, and the third try answers", async () => {
    let n = 0;
    brain = () => (++n <= 2 ? overloaded() : anthropicReply("All done.", { model: "brain-model" }));
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "go" }] }, H());
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.content.map((/** @type {any} */ b) => b.text).join(""), "All done.");
    assert.equal(n, 3);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    const waits = (rec.changes || []).filter((/** @type {string} */ c) => c.startsWith("agent: round 1: "));
    assert.deepEqual(waits, ["agent: round 1: m is overloaded — trying again now (try 2 of 10)", "agent: round 1: m is overloaded — trying again now (try 3 of 10)"]);
  });

  // (fails before: yes — the failure named no provider, so a loop could not tell it from Filament's own refusal)
  test("a provider that cannot be reached names itself on the failure", async () => {
    const r = await shim.post("/v1/messages", { model: "gone-model", max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
    await r.text();
    assert.equal(r.status, 502);
    assert.equal(r.headers.get("x-filament-upstream"), "gone");
    assert.ok(r.headers.get("x-filament-request-id"), "and the record it is");
  });

  // (fails before: yes — run 4 of the G2 drive, 2026-10-05: a sub-agent's model call went unanswered for 305 s and
  // died "fetch failed" at Node fetch's own 300 s wait for a reply's head; then the front door's call met that wait
  // still, and its provider's late answer was thrown away for another try — HarnessV3-FailurePoints §4 A)
  test("a call its provider is slow to answer is waited for, however short Node's fetch's own wait is set", async () => {
    // Node's fetch waits 300 s for a reply's head and then fails, whatever its caller asked; here 1.5 s, for every fetch
    // in this process. Neither the front door's call to the provider nor the loop's own call to the front door meets
    // it: the provider answers after 2.5 s, and that answer is the turn's.
    const slot = Symbol.for("undici.globalDispatcher.1");
    await (await shim.api("/api/requests?limit=1")).text();
    const g = /** @type {any} */ (globalThis);
    const own = g[slot];
    assert.ok(own, "Node's fetch keeps its dispatcher where undici does");
    const short = new own.constructor({ headersTimeout: 1500 });
    const hold = gate();
    let n = 0;
    brain = () => (++n === 1 ? hold.promise.then(() => anthropicReply("Late but whole.", { model: "brain-model" })) : anthropicReply("Asked again.", { model: "brain-model" }));
    g[slot] = short;
    const late = setTimeout(() => hold.open(), 2500);
    /** @type {{ status: number, headers: http.IncomingHttpHeaders, text: string }} */
    let got;
    try {
      got = await postOverHttp(`${shim.url}/v1/messages`, { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "go" }] }, { "content-type": "application/json", ...H(), ...houseAuth() });
    } finally {
      clearTimeout(late);
      g[slot] = own;
      hold.open();
      await short.close();
    }
    assert.equal(got.status, 200, got.text);
    assert.equal(JSON.parse(got.text).content.map((/** @type {any} */ b) => b.text).join(""), "Late but whole.");
    assert.equal(n, 1, "the provider was asked once, and waited for");
    const rec = await shim.record(String(got.headers["x-filament-request-id"]));
    assert.deepEqual((rec.changes || []).filter((/** @type {string} */ c) => c.startsWith("agent: round 1: ")), []);
  });

  /**
   * A turn that reads a, b and c; the developer presses Compact while round 3 is decided, so round 4 begins with a
   * fold that forks the loop's own conversation from its warm cache. `fork(n, runId)` answers the fork's n-th call.
   * @param {(n: number, runId: string) => any} fork
   */
  const compactingTurn = async (fork) => {
    let rounds = 0;
    let forks = 0;
    let transcripts = 0;
    let runId = "";
    const hold = gate();
    brain = async (/** @type {any} */ call) => {
      const b = call.body || {};
      if (isFork(b)) return fork(++forks, runId);
      if (isTranscriptSummary(b)) {
        transcripts++;
        return answer([{ type: "text", text: "<summary>\nFROM THE TRANSCRIPT\n</summary>" }]);
      }
      rounds++;
      if (rounds === 1) return answer([toolUse("r1", "read", { path: "a.txt" })], "tool_use");
      if (rounds === 2) return answer([toolUse("r2", "read", { path: "b.txt" })], "tool_use");
      if (rounds === 3) {
        await hold.promise; // the developer presses Compact while round 3 is being decided
        return answer([toolUse("r3", "read", { path: "c.txt" })], "tool_use");
      }
      return answer([{ type: "text", text: "Done." }]);
    };
    const res = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: true, messages: [{ role: "user", content: "read a, b and c" }] }, H());
    assert.equal(res.status, 200);
    runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(() => rounds === 3, "round 3's model call to be in flight");
    const s = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
    assert.equal(s.status, 200, await s.text());
    hold.open();
    const raw = await body;
    const text = parseSse(raw).map((f) => f.data).filter((d) => d?.delta?.type === "text_delta").map((d) => d.delta.text).join("");
    const rec = await shim.record(runId);
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=500`)).json()).events;
    return { text, rec, events, runId, counts: () => ({ rounds, forks, transcripts }) };
  };

  // (fails before: yes — the fork's one failure sent the summary to the transcript path)
  test("the fork that writes a compaction's summary is tried again too", async () => {
    const t = await compactingTurn((n) => (n === 1 ? overloaded() : answer([{ type: "text", text: "<summary>\nFROM THE FORK\n</summary>" }])));
    assert.match(t.text, /Done\./);
    assert.deepEqual(t.counts(), { rounds: 4, forks: 2, transcripts: 0 });
    const changes = t.rec.changes || [];
    assert.ok(changes.includes("agent: compacting rounds 1–2: m is overloaded — trying again now (try 2 of 10)"), changes.join("\n"));
    assert.ok(changes.some((/** @type {string} */ c) => /compacted rounds 1–2 of this turn on the developer's request, summarized by brain-model, from its warm cache/.test(c)), changes.join("\n"));
  });

  // (fails before: yes — the fork's failure went straight to the transcript path, which wrote the summary while the
  // stop waited)
  test("a stop while the fork waits to try again ends the wait and the turn, and nothing else is called", async () => {
    const t0 = Date.now();
    /** @type {Promise<unknown> | null} */
    let stopSent = null;
    const t = await compactingTurn((n, runId) => {
      if (n === 1) stopSent = new Promise((r) => setTimeout(r, 200)).then(() => shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "stop", text: "", from: "harness" } }));
      return overloaded("30");
    });
    await stopSent;
    assert.ok(Date.now() - t0 < 15_000, `the 30 s wait ended with the stop (${Date.now() - t0} ms)`);
    assert.deepEqual(t.counts(), { rounds: 3, forks: 1, transcripts: 0 });
    assert.equal(t.events.at(-1)?.status, "stopped");
    const changes = t.rec.changes || [];
    assert.ok(!changes.some((/** @type {string} */ c) => /came back empty|compacted rounds/.test(c)), changes.join("\n"));
  });
});
