// Integration: the first-event failover gate. An upstream that answers HTTP 200 but opens its SSE with an
// error (the OpenAI-compat convention — quota walls arrive this way) is a failed candidate, not a reply:
// the client must be served by the fallback in the same request, the failed upstream must cool down, and a
// healthy stream whose first chunks are neutral (role-only) must pass through byte-for-byte.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { gateSseFirstEvent, reattachSseBody, createSseScanner } from "../src/proxy.js";
import { createFailoverTrail } from "../src/app/pipeline/dispatch/attempt.js";

// (fails before: yes — HarnessV4_Tasks B10: an entry kept the first 160 characters of what a provider answered)
test("a failover trail's entry keeps its headline, and all the provider or the agent said where that is more", () => {
  /** @type {any} */
  const rec = {};
  const trail = createFailoverTrail(rec);
  const long = `{"error":{"message":"${"quota ".repeat(60)}resets at 14:00"}}`;
  trail.note("a", 429, long);
  trail.note("b", null, "ECONNREFUSED");
  trail.note("c", null, "Agent exited with code 2 while it started", "boom\n");
  trail.note("d", 500, "x".repeat(5000));
  const [a, b, c, d] = trail.failed;
  assert.deepEqual([a.reason, a.detail], [long.slice(0, 160), long], "cut for the headline, whole under it");
  assert.deepEqual(b, { upstream: "b", status: null, reason: "ECONNREFUSED" }, "nothing more said, nothing more kept");
  assert.deepEqual(c, { upstream: "c", status: null, reason: "Agent exited with code 2 while it started", detail: "boom" });
  assert.equal(d.detail, `${"x".repeat(4000)}… (1000 more characters)`, "a page of an answer is cut, and says by how much");
  trail.servedBy("e", 4);
  assert.deepEqual([rec.failover.servedBy, rec.failover.trail.length], ["e", 4]);
});

let dead, alive, neutral, late, pausing, app, port, dataDir;
const hits = { dead: 0, alive: 0, neutral: 0, late: 0, pausing: 0 };
const sse = (res, events) => { res.writeHead(200, { "content-type": "text/event-stream" }); for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`); res.write("data: [DONE]\n\n"); res.end(); };
/** Longer than the gate waits for a first event (verdict.js's 1.5 s). */
const PAST_GATE_MS = 1800;

before(async () => {
  dead = http.createServer((req, res) => { hits.dead++; sse(res, [{ error: { message: "Your personal Credits have been exhausted", type: "insufficient_quota", code: 112 } }]); });
  alive = http.createServer((req, res) => { hits.alive++; sse(res, [{ id: "c1", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }, { id: "c1", choices: [{ index: 0, delta: { content: "hello from the backup" }, finish_reason: null }] }, { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4 } }]); });
  neutral = http.createServer((req, res) => { hits.neutral++; sse(res, [{ id: "c2", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }, { id: "c2", choices: [{ index: 0, delta: { content: "primary speaks fine" }, finish_reason: null }] }, { id: "c2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]); });
  // A primary whose head comes at once and whose first event only after the gate's wait (a long prompt's prefill)
  late = http.createServer((req, res) => {
    hits.late++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    setTimeout(() => { for (const e of [{ id: "c3", choices: [{ index: 0, delta: { role: "assistant", content: "late but whole" }, finish_reason: null }] }, { id: "c3", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]) res.write(`data: ${JSON.stringify(e)}\n\n`); res.end("data: [DONE]\n\n"); }, PAST_GATE_MS);
  });
  // A primary that opens neutrally, then thinks past the gate's wait before its words
  pausing = http.createServer((req, res) => {
    hits.pausing++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "c4", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);
    setTimeout(() => { for (const e of [{ id: "c4", choices: [{ index: 0, delta: { content: "words after a pause" }, finish_reason: null }] }, { id: "c4", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]) res.write(`data: ${JSON.stringify(e)}\n\n`); res.end("data: [DONE]\n\n"); }, PAST_GATE_MS);
  });
  await Promise.all([dead, alive, neutral, late, pausing].map((s) => new Promise((r) => s.listen(0, "127.0.0.1", r))));
  dataDir = mkdtempSync(join(tmpdir(), "filament-gate-"));
  const cfg = defaultConfig();
  cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.rules.resilience.failover = true; // the backups below are tried: off until switched on (the owner's of 11-09)
  cfg.upstreams = [
    { id: "dead", name: "quota-walled", type: "openai-compatible", baseUrl: `http://127.0.0.1:${dead.address().port}`, apiKey: "x", enabled: true },
    { id: "alive", name: "backup", type: "openai-compatible", baseUrl: `http://127.0.0.1:${alive.address().port}`, apiKey: "x", enabled: true },
    { id: "neutral", name: "healthy primary", type: "openai-compatible", baseUrl: `http://127.0.0.1:${neutral.address().port}`, apiKey: "x", enabled: true },
    { id: "late", name: "slow to start", type: "openai-compatible", baseUrl: `http://127.0.0.1:${late.address().port}`, apiKey: "x", enabled: true },
    { id: "pausing", name: "pauses after its start", type: "openai-compatible", baseUrl: `http://127.0.0.1:${pausing.address().port}`, apiKey: "x", enabled: true },
  ];
  cfg.routes = [
    { match: "g/*", upstream: "dead", upstreamModel: "{1}", fallbacks: [{ upstream: "alive" }], enabled: true },
    { match: "n/*", upstream: "neutral", upstreamModel: "{1}", fallbacks: [{ upstream: "alive" }], enabled: true },
    { match: "l/*", upstream: "late", upstreamModel: "{1}", fallbacks: [{ upstream: "alive" }], enabled: true },
    { match: "p/*", upstream: "pausing", upstreamModel: "{1}", fallbacks: [{ upstream: "alive" }], enabled: true },
  ];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); [dead, alive, neutral, late, pausing].forEach((s) => s.close()); rmSync(dataDir, { recursive: true, force: true }); });

const H = { "content-type": "application/json", authorization: "Bearer k" };
const ask = async (model) => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: "hi" }] }), signal: AbortSignal.timeout(20000) });
  return { status: r.status, text: await r.text() };
};

test("a 200 stream that opens with an error fails over in the same request; the client never sees it", async () => {
  const { status, text } = await ask("g/lite");
  assert.equal(status, 200);
  assert.ok(text.includes("hello from the backup"), `the backup's content must reach the client: ${text.slice(0, 200)}`);
  assert.ok(!text.includes("exhausted"), "the smuggled error must not reach the client");
  assert.equal(hits.dead, 1, "the quota-walled upstream was tried once");
  assert.equal(hits.alive, 1, "the backup served the request");
  const recs = await (await fetch(`http://127.0.0.1:${port}/api/requests`)).json();
  const rec = recs.requests.find((x) => x.model === "g/lite");
  assert.ok(rec, "the request was recorded");
  assert.equal(rec.upstream, "alive", "the record names who actually served");
  assert.ok(rec.failover?.trail?.some((t) => t.upstream === "dead"), "the trail names the failed candidate");
  assert.ok((rec.changes || []).some((c) => /cooling down/.test(c)), "the cooldown note is on the record");
});

test("while the failed upstream cools down, the next request skips it entirely", async () => {
  const { status, text } = await ask("g/lite");
  assert.equal(status, 200);
  assert.ok(text.includes("hello from the backup"));
  assert.equal(hits.dead, 1, "no second probe of the cooling-down upstream");
  assert.equal(hits.alive, 2);
});

test("a healthy stream whose first chunk is neutral (role-only) passes the gate untouched", async () => {
  const { status, text } = await ask("n/lite");
  assert.equal(status, 200);
  assert.ok(text.includes("primary speaks fine"), "the primary served it");
  assert.equal(hits.neutral, 1);
  assert.equal(hits.alive, 2, "the fallback was never touched");
});

test("the gate is pure plumbing: buffered chunks + reader reassemble byte-for-byte", async () => {
  const events = [{ id: "c", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }, { id: "c", choices: [{ index: 0, delta: { content: "kept whole" }, finish_reason: null }] }];
  const body = new ReadableStream({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`)); c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); c.close(); } });
  const gate = await gateSseFirstEvent(body, "openai");
  assert.equal(gate.verdict, "live");
  const reattached = new Response(reattachSseBody(gate));
  const text = await reattached.text();
  assert.ok(text.includes("role") && text.includes("kept whole") && text.includes("[DONE]"), `nothing lost: ${text}`);
  const err = await gateSseFirstEvent(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: { message: "boom" } })}\n\n`)); c.close(); } }), "openai");
  assert.equal(err.verdict, "error"); assert.match(err.error, /boom/);
});

// (fails before: yes — the gate's verdict on its timeout left its own read out, and the chunk that read brought joined the
// kept ones after the reattached stream had taken them: the reply came to the client without it)
test("a gate that timed out with its read out: the chunk that read brings is the next in the reattached body", async () => {
  const enc = new TextEncoder();
  const pieces = [`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant" } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "LATE" } }] })}\n\n`, "data: [DONE]\n\n"];
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let source;
  const body = new ReadableStream({ start(c) { source = c; } });
  source.enqueue(enc.encode(pieces[0]));
  setTimeout(() => source.enqueue(enc.encode(pieces[1])), 150);
  setTimeout(() => { source.enqueue(enc.encode(pieces[2])); source.close(); }, 200);
  const gate = await gateSseFirstEvent(body, "openai", { firstEventMs: 50 });
  assert.equal(gate.reason, "timeout");
  assert.equal(await new Response(reattachSseBody(gate)).text(), pieces.join(""), "byte for byte, nothing lost");
});

// (fails before: yes — the bug hunt of 10-30, WIRE P3: reasoning spelled `reasoning` — OpenRouter's, Ollama's — was
// nothing the scanner counted: the gate held such a reply for its whole wait, and the record had none of its thinking)
test("a reply that opens with its reasoning spelled `reasoning` passes the gate at once, its thinking counted once", async () => {
  const enc = new TextEncoder();
  const chunk = (/** @type {any} */ delta) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  let source;
  const body = new ReadableStream({ start(c) { source = c; } });
  source.enqueue(enc.encode(chunk({ role: "assistant", reasoning: "weighing it" })));
  const gate = await gateSseFirstEvent(body, "openai", { firstEventMs: 300 });
  assert.equal(gate.reason, "content");
  gate.cancel();
  const s = createSseScanner("openai");
  s.feed(chunk({ reasoning: "weighing it" }) + chunk({ reasoning_content: "both", reasoning: "both" }) + chunk({ content: "ok" }));
  assert.deepEqual([s.state.thinkingChars, s.state.textChars], [15, 2], "one delta that spells it both ways counts once");
});

// (fails before: yes — the reattached body pumped the whole reply in as it came, whatever its reader asked)
test("the reattached body reads the provider only as its own reader asks", async () => {
  const enc = new TextEncoder();
  let pulls = 0;
  const body = new ReadableStream({
    pull(c) {
      pulls++;
      if (pulls > 200) return c.close();
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `piece ${pulls} ` } }] })}\n\n`));
    },
  }, { highWaterMark: 0 });
  const gate = await gateSseFirstEvent(body, "openai");
  assert.equal(gate.reason, "content");
  const held = pulls;
  const reattached = reattachSseBody(gate);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(pulls <= held + 2, `nobody read it, so the provider was not read either (${pulls - held} more pulls)`);
  const text = await new Response(reattached).text();
  assert.equal(text.match(/piece \d+ /g)?.length, 200, "and read, it is the whole reply");
});

// (fails before: yes — a verdict that came before any byte left the reply's body locked by the gate with nothing kept,
// and the reply was read from it all the same: "Body is unusable")
test("a primary that starts after the gate's wait still serves the reply, whole", async () => {
  const { status, text } = await ask("l/lite");
  assert.equal(status, 200);
  assert.ok(text.includes("late but whole"), `the primary's words reach the client: ${text.slice(0, 300)}`);
  assert.equal(hits.late, 1);
});

// (fails before: yes — the words came on the gate's read still out at its timeout, and were dropped)
test("a primary that pauses past the gate's wait after its first chunk: its words reach the client", async () => {
  const { status, text } = await ask("p/lite");
  assert.equal(status, 200);
  assert.ok(text.includes("words after a pause"), `nothing lost: ${text.slice(0, 300)}`);
  assert.equal(hits.pausing, 1);
});
