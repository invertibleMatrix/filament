import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { HealthBoard } from "../src/resilience.js";
import { postOverHttp } from "./helpers/app.js";

test("HealthBoard: exponential cooldown on retryable failures, reset on success, non-retryable ignored", () => {
  const b = new HealthBoard({ cooldownBaseMs: 1000, cooldownMaxMs: 5000 });
  assert.equal(b.recordFailure("u", { status: 400 }).cooledDown, false);
  assert.equal(b.available("u"), true);
  assert.equal(b.recordFailure("u", { status: 503 }).waitMs, 1000);
  assert.equal(b.recordFailure("u", { status: 429 }).waitMs, 2000);
  assert.equal(b.recordFailure("u", { message: "unreachable" }).waitMs, 4000);
  assert.equal(b.recordFailure("u", { status: 502 }).waitMs, 5000, "capped");
  assert.equal(b.available("u"), false); assert.ok(b.cooldownLeftMs("u") > 4000);
  b.recordSuccess("u", { ttftMs: 800 }); assert.equal(b.available("u"), true); assert.equal(b.state.get("u").failures, 0); assert.equal(b.state.get("u").ttftEma, 800);
  b.recordMeta("u", { "anthropic-ratelimit-requests-remaining": "1", "anthropic-ratelimit-requests-limit": "50" }); assert.equal(b.snapshot().u.rateLimitedSoon, true);
  b.recordMeta("u", { "retry-after": "9" }); assert.equal(b.state.get("u").retryAfter, 9);
  b.recordSuccess("u"); assert.equal(b.state.get("u").retryAfter, null, "a later success clears a stale Retry-After");
});

test("HealthBoard.order applies strategies and parks cooled-down or exhausted upstreams last", () => {
  const b = new HealthBoard({ cooldownBaseMs: 60_000 });
  const cands = [{ upstream: "a", upstreamModel: "claude-opus-5" }, { upstream: "b", upstreamModel: "claude-haiku-4-5" }, { upstream: "c", upstreamModel: "claude-sonnet-5" }];
  assert.deepEqual(b.order(cands).ordered.map((c) => c.upstream), ["a", "b", "c"]);
  b.recordSuccess("a", { ttftMs: 3000 }); b.recordSuccess("b", { ttftMs: 500 }); b.recordSuccess("c", { ttftMs: 1500 });
  assert.deepEqual(b.order(cands, { strategy: "least_latency" }).ordered.map((c) => c.upstream), ["b", "c", "a"]);
  const cfg = { upstreams: [{ id: "a", pricing: { "claude-opus-5": { input: 5, output: 25 } } }, { id: "b", pricing: { "claude-haiku-4-5": { input: 1, output: 5 } } }, { id: "c", pricing: { "claude-sonnet-5": { input: 2, output: 10 } } }] };
  assert.deepEqual(b.order(cands, { strategy: "least_cost", cfg }).ordered.map((c) => c.upstream), ["b", "c", "a"]);
  const r1 = b.order(cands, { strategy: "round_robin", routeKey: "x" }).ordered[0].upstream, r2 = b.order(cands, { strategy: "round_robin", routeKey: "x" }).ordered[0].upstream; assert.notEqual(r1, r2);
  b.recordFailure("b", { status: 503 });
  const o = b.order(cands, { strategy: "least_latency" }); assert.equal(o.ordered.at(-1).upstream, "b"); assert.deepEqual(o.parked, ["b"]);
  b.recordQuota("c", { exceeded: true }); const q = b.order(cands, { strategy: "quota_aware" }); assert.equal(q.ordered[0].upstream, "a"); assert.deepEqual([...q.parked].sort(), ["b", "c"]);
});

let flaky, pause, app, port, dataDir, flakyCalls = 0;
/** One Anthropic stream event. @param {any} data */
const ev = (data) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
before(async () => {
  flaky = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { flakyCalls++; if (req.headers["x-fail"] === "1" || flakyCalls <= 2) { res.writeHead(503, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })); } res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "ok from flaky" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } })); }); });
  // Half its answer, then 1.5 s of nothing, then the rest.
  pause = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(ev({ type: "message_start", message: { id: "h", type: "message", role: "assistant", model: "x", content: [], usage: { input_tokens: 1, output_tokens: 0 } } }) + ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) + ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }));
      const rest = setTimeout(() => res.end(ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " and the rest" } }) + ev({ type: "content_block_stop", index: 0 }) + ev({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }) + ev({ type: "message_stop" })), 1500);
      res.on("close", () => clearTimeout(rest));
    });
  });
  await new Promise((r) => flaky.listen(0, "127.0.0.1", r)); await new Promise((r) => pause.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-res-"));
  // `stallTimeoutSeconds: 1`: the cut a stream quiet that long met until no clock cut a call (HarnessV3-FailurePoints
  // FP-D1), kept as the condition the pause's test below failed under; nothing reads it now.
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = ""; cfg.rules.resilience = { failover: true, cooldownBaseSeconds: 30, cooldownMaxSeconds: 300, stallTimeoutSeconds: 1 }; // failover is off until switched on (the owner's of 11-09)
  cfg.upstreams = [{ id: "flaky", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${flaky.address().port}`, apiKey: "k" }, { id: "pause", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${pause.address().port}`, apiKey: "k" }];
  cfg.routes = [{ match: "pool-*", upstream: "flaky", upstreamModel: "{model}", strategy: "least_latency", fallbacks: [{ upstream: "pause", upstreamModel: "{model}" }] }, { match: "pause-*", upstream: "pause", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); flaky.close(); pause.closeAllConnections?.(); pause.close(); rmSync(dataDir, { recursive: true, force: true }); });
const H = { "content-type": "application/json", authorization: "Bearer k" };

test("a 503 puts the upstream in cooldown, the request falls through, and the next request tries the healthy one first", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "pool-a", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
  // flaky's first call: 503 -> fallback to pause, which answers after its pause
  const text = await r.text();
  const rec = app.usage.list(1)[0];
  assert.ok(rec.changes.some((c) => c.includes("flaky cooling down")), rec.changes.join(" | "));
  const hs = await (await fetch(`http://127.0.0.1:${port}/api/usage/upstreams`)).json();
  assert.equal(hs.health.flaky.coolingDown, true); assert.ok(hs.health.flaky.cooldownLeftMs > 20000);
  // second request: flaky is parked last, so pause goes first; the record notes the parking
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "pool-b", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] }) });
  await r2.text();
  const rec2 = app.usage.list(1)[0];
  assert.ok(rec2.changes.some((c) => c.startsWith("routing:") && c.includes("flaky") && /moved last|cooling down or out of quota/.test(c)), rec2.changes.join(" | "));
  await fetch(`http://127.0.0.1:${port}/api/health/flaky/reset`, { method: "POST" });
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/usage/upstreams`)).json()).health.flaky.coolingDown, false);
});

// (fails before: no — a guard the mutation pass asked for: nothing showed the start's word on a Node whose fetch keeps
// its dispatcher out of Filament's reach, nor that a Node that lifts its limits hears none)
test("the start says once that Node's fetch keeps its limits when its dispatcher is out of reach, and nothing where they are lifted", async () => {
  const said = (/** @type {any} */ a) => a.ops.list({ q: "fetch's dispatcher out of Filament's reach" }).length;
  assert.equal(said(app), 0, "lifted, nothing is said");
  const slot = Symbol.for("undici.globalDispatcher.1");
  const g = /** @type {any} */ (globalThis);
  const own = g[slot];
  const dir = mkdtempSync(join(tmpdir(), "filament-res-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = ""; cfg.memory.enabled = false;
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
  /** @type {any} */
  let other = null;
  // A Node that keeps its fetch's dispatcher somewhere else: what Filament reaches for is no dispatcher.
  g[slot] = {};
  try {
    other = createApp({ dataDir: dir, overrides: { port: 0 } });
  } finally {
    g[slot] = own;
  }
  try {
    await other.start();
    assert.equal(said(other), 1, "said once, at start");
  } finally {
    await other.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the stream quiet for stallTimeoutSeconds (1 s) was cut mid-answer: an error, the upstream cooled;
// and Node's fetch's own wait between two chunks, 1 s here as it is 300 s in life, cut it as well)
test("a stream that pauses mid-answer is waited for and delivered whole, however short Node's fetch's wait between chunks is set", async () => {
  // Node's fetch waits 300 s between two chunks of a body and then fails, whatever its caller asked; here 1 s, for every
  // fetch in this process. The call to the provider asks for no such wait; the test's own request goes over node:http.
  const slot = Symbol.for("undici.globalDispatcher.1");
  const g = /** @type {any} */ (globalThis);
  const own = g[slot];
  assert.ok(own, "Node's fetch keeps its dispatcher where undici does");
  const short = new own.constructor({ bodyTimeout: 1000 });
  g[slot] = short;
  let text = "";
  try {
    text = (await postOverHttp(`http://127.0.0.1:${port}/v1/messages`, { model: "pause-x", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] }, H)).text;
  } finally {
    g[slot] = own;
    await short.close();
  }
  assert.ok(text.includes("partial") && text.includes(" and the rest") && text.includes("message_stop"), text.slice(-400));
  const rec = app.usage.list(1)[0]; assert.equal(rec.status, "ok", rec.error);
  const hs = await (await fetch(`http://127.0.0.1:${port}/api/usage/upstreams`)).json(); assert.equal(hs.health.pause.coolingDown, false);
});

test("a failed request counts once against the upstream's health, not once per code path", async () => {
  const solo = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } })); }); });
  await new Promise((r) => solo.listen(0, "127.0.0.1", r));
  try {
    const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json(); const cfg = st.config;
    cfg.upstreams.push({ id: "solo", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${solo.address().port}`, apiKey: "k" });
    cfg.routes.push({ match: "solo-*", upstream: "solo", upstreamModel: "{model}" });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) })).status, 200);
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "solo-x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) });
    assert.ok(r.status >= 500, `status ${r.status}`); await r.text();
    const hs = await (await fetch(`http://127.0.0.1:${port}/api/usage/upstreams`)).json();
    assert.equal(hs.health.solo.failures, 1, "one failure, one count"); assert.equal(hs.health.solo.coolingDown, true);
    const rec = app.usage.list(1)[0]; assert.equal(rec.changes.filter((c) => c.startsWith("health:")).length, 1, rec.changes.join(" | "));
  } finally { solo.close(); }
});
