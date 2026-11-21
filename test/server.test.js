// Integration: real Filament server in front of a fake upstream that records what it receives.
import { test as t0 } from "node:test";
import { UsageStore, localDay, rateNow, addWriting, writingRate } from "../src/usage.js";
t0("pricing keys may be spelled like the model name; the longest prefix wins", async () => {
  const { estimateCost } = await import("../src/usage.js");
  const table = { "grok-4.6": { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 }, "grok-4": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } };
  assert.equal(estimateCost("grok-4.6", { input: 1_000_000, output: 0 }, table), 2, "dot spelling in the key matches the model");
  assert.equal(estimateCost("xai/grok-4.6-high", { input: 0, output: 1_000_000, cacheRead: 1_000_000 }, table), 6.5, "provider prefix and effort suffix are ignored; cache read priced");
  assert.equal(estimateCost("grok-4.3", { input: 1_000_000, output: 0 }, table), 1, "falls back to the shorter prefix");
  assert.equal(estimateCost("claude-opus-5-20260101", { input: 1_000_000, output: 0 }, table), 5);
  assert.equal(estimateCost("unknown-model", { input: 10 }, table), null);
  // an upstream's own table wins when it has a match; otherwise the built-in rates apply
  const own = { "grok-4.6": { input: 1, output: 3, cacheRead: 0.25, cacheWrite: 0 } };
  assert.equal(estimateCost("grok-4.6", { input: 1_000_000, output: 1_000_000 }, own), 4, "the upstream's price");
  assert.equal(estimateCost("claude-opus-5", { input: 1_000_000 }, own), 5, "no match in the upstream table: the built-in rate");
  // In-place value edits must be seen without a key-set change (the prefix index caches keys, not prices).
  table["grok-4.6"].input = 9;
  assert.equal(estimateCost("grok-4.6", { input: 1_000_000, output: 0 }, table), 9, "editing a price in place is not stuck on the old value");
  delete table["grok-4.6"];
  assert.equal(estimateCost("grok-4.6", { input: 1_000_000, output: 0 }, table), 1, "removing a longer prefix falls back");
  table["grok-4.6"] = { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 };
  assert.equal(estimateCost("grok-4.6", { input: 1_000_000, output: 0 }, table), 2, "re-adding a key rebuilds the index");
  const { normalizeConfig, validateConfig } = await import("../src/config.js");
  const cfg = normalizeConfig({ upstreams: [{ id: "x", name: "x", type: "openai-compatible", baseUrl: "http://h", pricing: { "grok-4.6": { input: "1", output: "3", cacheRead: "0.25", cacheWrite: "0" } } }], routes: [] });
  assert.deepEqual(cfg.upstreams[0].pricing, { "grok-4.6": { input: 1, output: 3, cacheRead: 0.25, cacheWrite: 0 } }, "typed strings become numbers"); assert.ok(validateConfig(cfg).ok);
  const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 5 } });
  const r = u.start({ format: "openai", model: "grok-4.6", upstream: "x", upstreamModel: "grok-4.6" }); u.finish(r, { status: "ok", httpStatus: 200, tokens: { input: 1_000_000, output: 0 } }, own);
  assert.equal(r.cost, 1, "finish() takes the upstream table");
});

t0("usage store: daily and timeline buckets, tok/s, live view", () => {
  const u = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 50 } });
  const r = u.start({ format: "anthropic", model: "m", upstream: "u1" });
  const l0 = u.live()[0]; assert.equal(l0.phase, "pending", "no byte of the reply yet"); assert.equal(l0.liveTpsNow, null); assert.equal(l0.waitMs, l0.elapsedMs); assert.equal(l0.sinceOutputMs, null);
  u.firstByte(r); u.progress(r, { outChars: 400, thinkChars: 100, stage: "answering" });
  const l1 = u.live()[0]; assert.equal(l1.liveOutTokens, 100); assert.equal(l1.phase, "streaming"); assert.equal(l1.liveThinkTokens, 25); assert.equal(l1.stage, "answering"); assert.equal(l1.stalled, false);
  assert.ok(l1.liveTpsNow >= 0 && l1.liveTpsNow <= 100, `speed over the last second is a rate, not a total: ${l1.liveTpsNow}`); assert.equal(l1.waitMs, r.ttftMs);
  assert.equal(l1.liveTpsWriting, null, "one growth is no writing time yet");
  // (fails before: yes — HarnessV4_Tasks B10: the live thinking count read the streamed words alone, so Claude's thinking,
  // which may stream none, counted as nothing while its own estimate ran)
  u.progress(r, { outChars: 400, thinkChars: 100, thinkTokens: 2000, stage: "thinking" });
  const l2 = u.live()[0]; assert.deepEqual([l2.liveThinkTokens, l2.liveOutTokens, l2.stage], [2000, 2075, "thinking"], "the agent's own count, where it is more than its words come to; the output's figure counts it once");
  u.progress(r, { outChars: 400, thinkChars: 100, thinkTokens: 10, stage: "answering" });
  assert.deepEqual([u.live()[0].liveThinkTokens, u.live()[0].liveOutTokens], [25, 100], "its words, where they come to more");
  assert.ok(!Object.keys(u.publicRecord(r)).some((k) => k[0] === "_"), "working fields never leave the process");
  u.finish(r, { status: "ok", httpStatus: 200, tokens: { input: 10, output: 200 } }, {});
  assert.equal(u.publicRecord(r).phase, undefined); assert.equal(r._samples, undefined); assert.equal(r._writing, undefined);
  // the speed over the last second, on synthetic samples [time, chars]
  assert.equal(rateNow([[0, 0], [500, 200], [1000, 400]], 1000), 100, "400 characters = 100 tokens over one second");
  assert.equal(rateNow([[0, 0], [500, 200]], 3000), 0, "nothing in the last second");
  assert.equal(rateNow([[0, 0], [1500, 400], [2000, 600], [2400, 800]], 2500), 100, "measured from the newest sample at least a second old");
  // the speed while writing, as the composer's gauge counts it: a gap past 1.5 s is a pause, and neither its time nor
  // the output that ends it is writing
  let w = addWriting({ ms: 0, chars: 0 }, null, 0, 0, 40); // the first words: nothing to measure from
  w = addWriting(w, 0, 40, 500, 440); // 400 characters in half a second
  w = addWriting(w, 500, 440, 5500, 2440); // after a five-second tool run: the output that ends the pause
  w = addWriting(w, 5500, 2440, 6000, 2840); // 400 more in half a second
  assert.deepEqual(w, { ms: 1000, chars: 800 });
  assert.equal(writingRate(w), 200, "800 characters = 200 tokens over the second it was writing");
  assert.equal(writingRate({ ms: 100, chars: 400 }), null, "too little writing to say a speed");
  // (fails before: yes — a gap past 1.5 s was a pause, so GLM 5.3's bursts some two seconds apart were never writing
  // and the tray had no speed between them; HarnessV4_Artifacts_Plan AFC-158)
  let b = addWriting({ ms: 0, chars: 0 }, null, 0, 0, 380);
  for (let i = 1; i < 5; i++) b = addWriting(b, (i - 1) * 2200, 380 * i, i * 2200, 380 * (i + 1));
  assert.equal(writingRate(b), 43.2, "95 tokens every 2.2 seconds");
  // An agent's stage that writes nothing stops the writing: the time to its next words is none of it.
  const ua = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 5 } });
  const ra = ua.start({ format: "anthropic", model: "m", upstream: "u1" });
  ua.firstByte(ra);
  ua.progress(ra, { outChars: 400, stage: "answering" });
  ua.progress(ra, { outChars: 800, stage: "answering" });
  const wrote = ra._writing.ms;
  ua.progress(ra, { outChars: 800, stage: "using tools" });
  ua.progress(ra, { outChars: 1200, stage: "answering" });
  assert.deepEqual([ra._writing.ms, ra._writing.chars], [wrote, 400], "the words after the tool start a stretch of their own");
  ua.finish(ra, { status: "ok", httpStatus: 200, tokens: { input: 1, output: 1 } }, {});
  assert.equal(ra._writeFrom, undefined);
  // the first byte is announced once, so the dashboard flips pending → in flight without waiting for progress
  const u2 = new UsageStore({ dataDir: ".", options: { logFile: "", keepLastRequests: 5 } }); const evs = []; u2.on("event", (e) => evs.push(e.type));
  const r2 = u2.start({ model: "m" }); u2.firstByte(r2); u2.firstByte(r2); u2.progress(r2, { outChars: 8 }); u2.finish(r2, { status: "ok", httpStatus: 200, tokens: { input: 1, output: 2 } }, {});
  assert.deepEqual(evs, ["start", "first-byte", "progress", "finish"]);
  const d = u.daily(3); assert.equal(d.length, 3); assert.equal(d.at(-1).requests, 1); assert.equal(d.at(-1).day, localDay(new Date()), "days are labelled in local time"); assert.equal(d.at(-1).output, 200); assert.equal(d.at(-1).byModel[0].model, "m");
  const tl = u.timeline(5); assert.equal(tl.length, 5); assert.equal(tl.at(-1).requests, 1);
  const st = u.upstreamStats(); assert.equal(st.u1.requests, 1); assert.equal(st.u1.output, 200);
  // who spent it and where: by client (user-agent prefix) and by project (memory's situate field)
  const u3 = new UsageStore({ dataDir: ".", options: { logFile: "", broadcast: false, keepLastRequests: 5 } });
  const r3 = u3.start({ format: "openai", model: "m", upstream: "u1", ua: "OpenCode/1.4.0" }); r3.memory = { project: "abc123def456" }; u3.finish(r3, { status: "ok", httpStatus: 200, tokens: { input: 10, output: 5 } }, {});
  const r4 = u3.start({ format: "openai", model: "m", upstream: "u1", ua: "claude-cli/2.1 (external, cli)" }); u3.finish(r4, { status: "error", httpStatus: 500 }, {});
  const s24 = u3.summary(24 * 3600 * 1000);
  assert.equal(s24.byClient.OpenCode.requests, 1); assert.equal(s24.byClient["claude-cli"].errors, 1);
  assert.equal(Object.keys(s24.byProject).length, 1, "records without a project do not create a bucket"); assert.equal(s24.byProject.abc123def456.requests, 1);
  assert.ok(r.tps == null || r.tps > 0);
  // per-model leaderboard data: errors, pricing coverage and timing means ride on byModel
  const r5 = u3.start({ format: "openai", model: "fasty", upstream: "u1", ua: "OpenCode/1.4.0" });
  u3.firstByte(r5); u3.finish(r5, { status: "ok", httpStatus: 200, tokens: { input: 10, output: 5 } }, {});
  r5.tps = 42.5; r5.ttftMs = 250; r5.cost = 0.001; // timing and cost land on the record (finish computes them from samples/prices; the summary folds what is there)
  const s2 = u3.summary(24 * 3600 * 1000);
  const bm = s2.byModel.fasty;
  assert.ok(bm, "model bucket exists"); assert.equal(bm.requests, 1); assert.equal(bm.errors, 0);
  assert.equal(bm.costN, 1, "priced requests counted"); assert.equal(bm.avgTtftMs, 250); assert.equal(bm.avgTps, 42.5);
  assert.equal(s2.byModel.m.errors, 1, "errors per model");
});
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { watchDispatches } from "./helpers/dispatch.js";
import { anthropicStream, fakeUpstream, parseSse, startApp } from "./helpers/app.js";

let fake, fakePort, app, shimPort, dataDir, seen = [];
let fakeMode = "stream"; // "stream" | "json" | "fail-once" | "error"
let failOnce = true;

const anthropicSse = (usage) => [
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-fable-5-1", content: [], usage: { input_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 } } })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think about it carefully." } })}\n\n`,
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } })}\n\n`,
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 1 })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42, output_tokens_details: { thinking_tokens: 30 }, ...usage } })}\n\n`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
];

before(async () => {
  failOnce = true;
  fake = http.createServer((req, res) => {
    let buf = ""; req.on("data", (d) => (buf += d));
    req.on("end", () => {
      const rec = { url: req.url, headers: req.headers, body: JSON.parse(buf || "{}") }; seen.push(rec);
      if (fakeMode === "fail-once" && failOnce) { failOnce = false; res.writeHead(529, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })); }
      if (fakeMode === "error") { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } })); }
      if (fakeMode === "no-model-once" && failOnce) { failOnce = false; res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: claude-x not found" } })); }
      if (fakeMode === "slow") { res.writeHead(200, { "content-type": "text/event-stream" }); const evs = anthropicSse(); let i = 0; const t = setInterval(() => { if (i < evs.length) res.write(evs[i++]); else { clearInterval(t); res.end(); } }, 120); return; }
      if (req.url.startsWith("/v1/embeddings")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }], model: rec.body.model, usage: { prompt_tokens: 7, total_tokens: 7 } })); }
      if (req.url.startsWith("/v1/chat/completions")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } })}\n\n`);
        return res.end("data: [DONE]\n\n");
      }
      if (fakeMode === "json" || rec.body.stream === false) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ id: "m2", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "json reply" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } })); }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const ev of anthropicSse()) res.write(ev);
      res.end();
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r)); fakePort = fake.address().port;

  dataDir = mkdtempSync(join(tmpdir(), "filament-test-"));
  const cfg = defaultConfig();
  cfg.server.port = 0; cfg.server.inboundKeys = ["test-key"]; cfg.observability.logFile = ""; cfg.observability.storeBodies = "full";
  cfg.upstreams = [
    { id: "fake", name: "fake", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fakePort}`, apiKey: "up-secret", authStyle: "x-api-key", rules: { headers: { identity: "claude-code" } } },
    { id: "fake2", name: "fake2", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fakePort}`, apiKey: "up-secret-2" },
    { id: "oai", name: "oai", type: "openai-compatible", baseUrl: `http://127.0.0.1:${fakePort}`, apiKey: "oai-secret" },
  ];
  cfg.routes = [
    { match: "claude-*", upstream: "fake", upstreamModel: "anthropic/{model}", fallbacks: [{ upstream: "fake2", upstreamModel: "{model}" }] },
    { match: "glm-*", upstream: "oai", upstreamModel: "{model}", format: "openai" },
  ];
  // The backups above are tried: failover is off until switched on (the owner's of 11-09).
  cfg.rules.resilience.failover = true;
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } });
  const info = await app.start(); shimPort = info.port;
});
after(async () => { await app.stop(); fake.close(); rmSync(dataDir, { recursive: true, force: true }); });

const call = (path, body, headers = {}) => fetch(`http://127.0.0.1:${shimPort}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-key", ...headers }, body: JSON.stringify(body) });
const agentBody = { model: "claude-fable-5-1-xhigh", max_tokens: 500, stream: true, thinking: { type: "enabled", budget_tokens: 32000 }, messages: [{ role: "user", content: "hi" }] };

test("rejects missing inbound key", async () => {
  const r = await fetch(`http://127.0.0.1:${shimPort}/v1/messages`, { method: "POST", body: "{}" });
  assert.equal(r.status, 401);
});

test("a hole in messages (null where a message should be) is a 400 in words, not a stack trace", async () => {
  const r = await call("/v1/messages", { ...agentBody, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }, null] });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.error?.message, "messages[2] must be a message object, got null");
});

test("shapes and streams an anthropic request, records usage", async () => {
  seen = []; fakeMode = "stream";
  const r = await call("/v1/messages", agentBody, { "anthropic-beta": "redact-thinking-2026-02-12,effort-2025-11-24", "user-agent": "OpenCode/unknown" });
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /event-stream/);
  const text = await r.text();
  assert.match(text, /thinking_delta/); assert.match(text, /message_stop/);
  const up = seen[0];
  assert.equal(up.url, "/v1/messages");
  assert.equal(up.body.model, "anthropic/claude-fable-5-1");
  assert.deepEqual(up.body.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(up.body.output_config.effort, "xhigh");
  assert.equal(up.headers["x-api-key"], "up-secret"); assert.equal(up.headers["authorization"], undefined);
  assert.equal(up.headers["anthropic-beta"], "effort-2025-11-24"); assert.equal(up.headers["x-app"], "cli");
  const rec = app.usage.list(1)[0];
  assert.equal(rec.status, "ok"); assert.equal(rec.tokens.cacheRead, 500); assert.equal(rec.tokens.output, 42); assert.equal(rec.tokens.thinking, 30);
  assert.ok(rec.changes.length >= 2); assert.ok(rec.cost > 0);
  const detail = app.usage.detail(rec.id); assert.ok(detail.shapedBody.includes("summarized")); assert.ok(!detail.shapedHeaders["x-api-key"].includes("secret"));
  assert.equal(detail.translation.received.thinking.type, "enabled"); assert.equal(detail.translation.sent.thinking.display, "summarized");
  assert.equal(detail.translation.sent.effort, "xhigh"); assert.equal(detail.translation.sent.messages, 1); assert.ok(detail.translation.sent.bytes > 0);
  assert.equal(rec.hasTranslation, true); assert.equal(rec.translation, undefined);
});

test("stored bodies: redaction is bounded to what is kept, and a secret straddling the cap is still removed", async () => {
  // The stored body is capped at maxStoredBodyBytes, but the secret regex used to run over the WHOLE incoming body
  // before truncation — measured 3.5 ms per request at a 2 MB body, 13.9 ms at 8 MB and 53.5 ms at 32 MB, all of it
  // blocking the event loop of a proxy, on every request, whenever storeBodies is on. It now scans only the window
  // that can survive the cut, plus a margin.
  //
  // The margin is the whole reason that is safe rather than merely fast: the patterns match COMPLETE tokens, so a key
  // cut in half by the boundary would not be recognised as one and its raw prefix would be stored. Any secret that
  // overlaps the kept region and is shorter than the margin lies entirely inside the window and is redacted as before.
  const cfg = app.config;
  const wasCap = cfg.observability.maxStoredBodyBytes;
  const cap = 1200;
  cfg.observability.maxStoredBodyBytes = cap;
  const secret = "sk-live-abcdef0123456789";
  const tail = "abcdef0123456789"; // what the redactor removes; the `sk-live` prefix is kept by design
  try {
    // Aim for a secret that starts a few characters BEFORE the cap. That is the case the margin exists for: without it
    // the scanned window holds a partial key — too short for the pattern to recognise (it needs `sk-` + 4 + 8 more),
    // long enough to be a real fragment of a credential sitting in the log. With the margin the whole key is inside the
    // window and is redacted to the documented `sk-live…` shape.
    // The key stands as a word of its own, as a pasted key does: one glued to the letters before it is a word's tail
    // ("task-graph-runner"), which the redactor leaves alone.
    const mk = (n) => JSON.stringify({ model: "claude-x", max_tokens: 10, messages: [{ role: "user", content: "y".repeat(n) + " " + secret }] });
    let filler = 900;
    while (mk(filler).indexOf(secret) < cap - 12) filler += 1;
    const at = mk(filler).indexOf(secret);
    const inside = cap - at;
    assert.ok(at < cap && at + secret.length > cap, `the secret straddles the ${cap}-byte cap (starts at ${at})`);
    assert.ok(inside >= 5 && inside <= 14, `and ${inside} chars of it are inside the cap — enough to leak, too few to match`);
    await call("/v1/messages", JSON.parse(mk(filler)));
    const stored = app.usage.detail(app.usage.list(1)[0].id).inboundBody;
    assert.ok(stored, "the body was stored");
    assert.ok(stored.includes("[truncated"), `and capped: …${stored.slice(-50)}`);
    assert.ok(!stored.includes(secret), "the whole secret is gone");
    assert.ok(!stored.includes(tail), "and so is its identifying tail");
    // THE assertion that pins the margin: without it the stored text ends in a raw `sk-live-ab…` fragment and this fails.
    assert.ok(stored.includes("sk-live…"), `the straddling key was still recognised and redacted, not stored as a raw fragment: ${JSON.stringify(stored.slice(Math.max(0, at - 8), at + 26))}`);

    // A body under the cap takes the original path: stored whole, still redacted, no truncation marker.
    await call("/v1/messages", { model: "claude-x", max_tokens: 10, messages: [{ role: "user", content: `key ${secret} here` }] });
    const small = app.usage.detail(app.usage.list(1)[0].id).inboundBody;
    assert.ok(!small.includes("[truncated"), "a body under the cap is stored whole");
    assert.ok(!small.includes(tail), "and is still redacted");
    assert.ok(small.includes("sk-live…"), `redacted to the documented shape: ${small.slice(small.indexOf("sk-live"), small.indexOf("sk-live") + 12)}`);
  } finally { cfg.observability.maxStoredBodyBytes = wasCap; }
});

test("stored bodies: a quoted secret LONGER than the redaction margin is not stored raw", async () => {
  // The one pattern in redactSecrets that needs a TERMINATOR rather than a minimum prefix: `"api_key": "…"`. Every
  // other pattern matches on a prefix length, so it still fires on a token cut mid-way. This one cannot fire without
  // its closing quote, so a credential longer than the scan window would be stored raw — and a bigger margin only
  // moves the hole deeper, which is why it is closed explicitly rather than by picking a larger number.
  const cfg = app.config;
  const wasCap = cfg.observability.maxStoredBodyBytes;
  cfg.observability.maxStoredBodyBytes = 1200;
  try {
    const token = "T".repeat(20000); // far longer than any plausible margin
    await call("/v1/messages", { model: "claude-x", max_tokens: 10, messages: [{ role: "user", content: "y".repeat(1000) }], api_key: token });
    const stored = app.usage.detail(app.usage.list(1)[0].id).inboundBody;
    assert.ok(stored.includes("[truncated"), "the body was capped");
    const at = stored.indexOf("api_key");
    assert.ok(at >= 0, `the key is inside the kept window: ${stored.slice(-80)}`);
    assert.match(stored.slice(at), /^api_key"\s*:\s*"\[redacted\]/, `the unterminated value was sealed rather than stored: ${JSON.stringify(stored.slice(at, at + 48))}`);
    assert.ok(!/T{20,}/.test(stored), "and no raw run of the credential survives anywhere in the stored body");
    assert.ok(!stored.includes(token), "the credential itself is nowhere in it");
  } finally { cfg.observability.maxStoredBodyBytes = wasCap; }
});

test("non-stream client gets JSON aggregated from an upstream stream when forceStream is on", async () => {
  seen = []; fakeMode = "stream";
  const cfg = app.config; cfg.rules.params.forceStream = "on";
  const r = await call("/v1/messages", { ...agentBody, stream: false });
  cfg.rules.params.forceStream = "client";
  assert.equal(r.status, 200); const j = await r.json();
  assert.equal(seen[0].body.stream, true);
  assert.equal(j.content[0].type, "thinking"); assert.equal(j.content[1].text, "Hello"); assert.equal(j.usage.output_tokens, 42);
});

test("stream client gets SSE synthesized from an upstream JSON reply", async () => {
  seen = []; fakeMode = "json";
  const r = await call("/v1/messages", agentBody);
  const text = await r.text(); fakeMode = "stream";
  assert.match(r.headers.get("content-type"), /event-stream/); assert.match(text, /json reply/); assert.match(text, /message_stop/);
});

test("falls back to the next upstream on 529 before streaming", async () => {
  seen = []; fakeMode = "fail-once";
  const r = await call("/v1/messages", agentBody); await r.text(); fakeMode = "stream";
  assert.equal(r.status, 200); assert.equal(seen.length, 2);
  assert.equal(seen[1].headers["x-api-key"], "up-secret-2"); assert.equal(seen[1].body.model, "claude-fable-5-1");
  assert.equal(app.usage.list(1)[0].attempt, 2);
});

test("failover order: an unknown model on the primary moves to the next entry without a cooldown; the record names who served it", async () => {
  await fetch(`http://127.0.0.1:${shimPort}/api/health/fake/reset`, { method: "POST" });
  fakeMode = "no-model-once"; failOnce = true; seen = [];
  const r = await call("/v1/messages", { ...agentBody, stream: false });
  assert.equal(r.status, 200, await r.text()); assert.equal(seen.length, 2, "primary answered 404, the backup served");
  const rec = app.usage.list(1)[0]; assert.equal(rec.upstream, "fake2"); assert.equal(rec.attempt, 2);
  assert.deepEqual(rec.failover.trail.map((t) => [t.upstream, t.status]), [["fake", 404]]); assert.equal(rec.failover.servedBy, "fake2");
  assert.ok(rec.changes.some((x) => /failover: served by fake2 \(#2 in order\) after fake failed with HTTP 404/.test(x)), rec.changes.join("; "));
  assert.ok(rec.changes.some((x) => /cannot serve this entry \(no such model here/.test(x)));
  const health = await (await fetch(`http://127.0.0.1:${shimPort}/api/health`)).json(); const fakeState = health.fake || health.upstreams?.fake || health?.snapshot?.fake; if (fakeState) assert.ok(!(fakeState.cooldownUntil > Date.now()), "a missing model is not a health failure");
  fakeMode = "stream"; failOnce = true;
});

test("failover switch: off means backups are ignored and the primary's failure reaches the client", async () => {
  const r0 = await fetch(`http://127.0.0.1:${shimPort}/api/failover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) }); assert.equal((await r0.json()).enabled, false);
  await fetch(`http://127.0.0.1:${shimPort}/api/health/fake/reset`, { method: "POST" });
  fakeMode = "fail-once"; failOnce = true; seen = [];
  const r = await call("/v1/messages", { ...agentBody, stream: false });
  assert.equal(r.status, 529, "no fallback when failover is off"); assert.equal(seen.length, 1);
  const rec = app.usage.list(1)[0]; assert.ok(rec.changes.some((x) => /failover is off/.test(x)), rec.changes.join("; "));
  const r1 = await fetch(`http://127.0.0.1:${shimPort}/api/failover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) }); const j1 = await r1.json(); assert.equal(j1.enabled, true); assert.ok(j1.routesWithBackups.some((x) => x.match === "claude-*" && x.chain.join(",") === "fake,fake2"));
  await fetch(`http://127.0.0.1:${shimPort}/api/health/fake/reset`, { method: "POST" }); fakeMode = "stream";
});

test("relays upstream error status and body", async () => {
  fakeMode = "error"; const r = await call("/v1/messages", { ...agentBody, model: "claude-opus-5" }); const j = await r.json(); fakeMode = "stream";
  assert.equal(r.status, 400); assert.equal(j.error.type, "invalid_request_error");
});

test("openai route: suffix effort, include_usage, usage recorded from final chunk", async () => {
  seen = [];
  const r = await call("/v1/chat/completions", { model: "glm-5.3-max", stream: true, messages: [{ role: "user", content: "hi" }] });
  await r.text();
  assert.equal(seen[0].url, "/v1/chat/completions"); assert.equal(seen[0].body.model, "glm-5.3"); assert.equal(seen[0].body.reasoning_effort, "max"); assert.equal(seen[0].body.stream_options.include_usage, true);
  assert.equal(seen[0].headers["authorization"], "Bearer oai-secret");
  const rec = app.usage.list(1)[0]; assert.equal(rec.tokens.cacheRead, 4); assert.equal(rec.tokens.input, 6);
});

test("embeddings passthrough routes by model to an OpenAI-compatible upstream and refuses others", async () => {
  seen = [];
  /** @type {any} */
  let r;
  // The call to the provider asks Node's fetch for no limit on its head or body (HarnessV3-FailurePoints §4 A).
  // (fails before: no — a guard the mutation pass asked for: nothing showed an embedding's call went without them)
  const sent = await watchDispatches(async () => {
    r = await call("/v1/embeddings", { model: "glm-embed", input: ["a", "b"] });
    await r.clone().text();
  });
  assert.deepEqual(sent.filter((s) => s.path === "/v1/embeddings" && s.origin !== `http://127.0.0.1:${shimPort}`).map((s) => [s.headersTimeout, s.bodyTimeout]), [[0, 0]]);
  assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.data[0].embedding.length, 2);
  assert.equal(seen[0].url, "/v1/embeddings"); assert.equal(seen[0].body.model, "glm-embed"); assert.equal(seen[0].headers["authorization"], "Bearer oai-secret");
  const rec = app.usage.list(1)[0]; assert.equal(rec.format, "embeddings"); assert.equal(rec.tokens.input, 7); assert.equal(rec.status, "ok");
  const bad = await call("/v1/embeddings", { model: "claude-x", input: "a" }); assert.equal(bad.status, 502); assert.match((await bad.json()).error.message, /no embeddings endpoint/);
  const none = await call("/v1/embeddings", { model: "nothing-here", input: "a" }); assert.equal(none.status, 404);
});

test("admin: /api/models/ping sends a tiny real request and reports timing, upstream and failure reasons", async () => {
  fakeMode = "json"; seen = [];
  await fetch(`http://127.0.0.1:${shimPort}/api/health/fake/reset`, { method: "POST" }); // an earlier test made "fake" fail once, so it may still be cooling down
  const ok = await (await fetch(`http://127.0.0.1:${shimPort}/api/models/ping`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-opus-5" }) })).json();
  assert.equal(ok.ok, true); assert.equal(ok.upstream, "fake"); assert.equal(ok.upstreamModel, "anthropic/claude-opus-5"); assert.equal(ok.text, "json reply"); assert.ok(ok.ms >= 0); assert.ok(ok.requestId);
  // (fails before: yes — the ping asked for 32 tokens, all a reasoning model's thinking: HarnessV3-FailurePoints §13)
  assert.ok(seen[0].body.max_tokens >= 32_000, `the ping asks for the most the model can write (got ${seen[0].body.max_tokens})`);
  const missing = await (await fetch(`http://127.0.0.1:${shimPort}/api/models/ping`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "no-such-model" }) })).json();
  assert.equal(missing.ok, false); assert.equal(missing.status, 404); assert.match(missing.error, /no route/);
  fakeMode = "";
});

// (fails before: yes — the owner's rules of 10-31: an outside client's chat is a plain proxy with memory, but Filament
// answered its /status, /cost and /help)
test("an outside client's /status, /cost and /help go to its model as typed", async () => {
  seen = []; fakeMode = "json";
  try {
    for (const words of ["/status", "/cost", "/help"]) {
      const n = seen.length;
      const j = await call("/v1/messages", { model: "claude-opus-5", max_tokens: 20, messages: [{ role: "user", content: "real" }, { role: "assistant", content: "ok" }, { role: "user", content: words }] }, { "x-session-id": "api-chat-1" }).then((r) => r.json());
      assert.equal(j.content[0].text, "json reply", `${words}: the model's answer`);
      assert.equal(seen.length, n + 1, `${words}: the model was called`);
      assert.ok(JSON.stringify(seen.at(-1).body.messages.at(-1)).includes(words), `${words}: as typed`);
    }
  } finally {
    fakeMode = "stream";
  }
});

test("unknown model yields a routed 404 in the caller's format", async () => {
  const r = await call("/v1/messages", { ...agentBody, model: "nope" }); const j = await r.json();
  assert.equal(r.status, 404); assert.equal(j.type, "error");
});

test("admin: dry-run explains the decision; templates preview and apply; config save keeps secrets", async () => {
  const dry = await (await fetch(`http://127.0.0.1:${shimPort}/api/dry-run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "anthropic", body: agentBody }) })).json();
  assert.equal(dry.ok, true); assert.equal(dry.upstream, "fake"); assert.equal(dry.body.output_config.effort, "xhigh"); assert.equal(dry.headers["x-api-key"], "[redacted]");
  const prev = await (await fetch(`http://127.0.0.1:${shimPort}/api/templates/cost-guard/preview`, { method: "POST" })).json();
  assert.ok(prev.changes.some((c) => c.path === "rules.params.maxTokensMax"));
  const state = await (await fetch(`http://127.0.0.1:${shimPort}/api/state`)).json();
  assert.equal(state.config.upstreams[0].apiKey, "__SECRET__");
  const put = await fetch(`http://127.0.0.1:${shimPort}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...state.config, rules: { ...state.config.rules, effort: { ...state.config.rules.effort, default: "high" } } }) });
  assert.equal(put.status, 200);
  assert.equal(app.config.upstreams[0].apiKey, "up-secret"); assert.equal(app.config.rules.effort.default, "high");
  const models = await (await fetch(`http://127.0.0.1:${shimPort}/v1/models`, { headers: { authorization: "Bearer test-key" } })).json();
  assert.ok(Array.isArray(models.data));
});

// (fails before: no — first written when the upstream's timeout guarded the headers only; with no clock on a call
// (HarnessV3-FailurePoints FP-D1) it guards a slow stream's whole delivery)
test("a stream that takes its time completes whole", async () => {
  fakeMode = "slow";
  try {
    const r = await call("/v1/messages", { model: "claude-fable-5-1", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] });
    const text = await r.text();
    assert.ok(text.includes("Hello") && text.includes("message_stop"), text.slice(-300));
    const rec = app.usage.list(1)[0]; assert.equal(rec.status, "ok"); assert.ok(rec.totalMs > 900, `took ${rec.totalMs} ms`);
  } finally { fakeMode = "stream"; }
});

test("durable daily usage: today's totals per upstream and model, CSV export, bad dates rejected", async () => {
  fakeMode = "stream";
  await (await call("/v1/messages", { model: "claude-fable-5-1", max_tokens: 10, stream: true, messages: [{ role: "user", content: "hi" }] })).text();
  const j = await (await fetch(`http://127.0.0.1:${shimPort}/api/usage/days`)).json();
  assert.ok(j.today && j.days.length >= 1); const t = j.days.find((d) => d.day === j.today); assert.ok(t, "today is on record");
  const row = t.rows.find((r) => r.upstream === "fake" && r.model === "anthropic/claude-fable-5-1"); assert.ok(row, JSON.stringify(t.rows.map((r) => [r.upstream, r.model])));
  assert.ok(row.requests >= 1 && row.output >= 42 && row.cacheRead >= 500, JSON.stringify(row));
  assert.ok(row.asked.some((a) => a.name === "claude-fable-5-1"));
  assert.equal(j.total.requests, j.days.reduce((a, d) => a + d.requests, 0));
  assert.equal(j.file, null, "no log file configured: kept in memory only");
  const csv = await fetch(`http://127.0.0.1:${shimPort}/api/usage/days.csv?from=${j.today}&to=${j.today}`);
  assert.equal(csv.status, 200); assert.ok(csv.headers.get("content-type").includes("text/csv")); assert.ok((await csv.text()).includes("anthropic/claude-fable-5-1"));
  assert.equal((await fetch(`http://127.0.0.1:${shimPort}/api/usage/days?from=yesterday`)).status, 400);
});

test("POST /api/shutdown stops gracefully: refuses new model requests, then exits through the supervisor hook", async () => {
  let exited = false; const dir = mkdtempSync(join(tmpdir(), "filament-shut-"));
  const c = defaultConfig(); c.server.port = 0; c.server.inboundKeys = ["k"]; c.observability.logFile = ""; writeFileSync(join(dir, "config.json"), JSON.stringify(c));
  const app2 = createApp({ dataDir: dir, overrides: { port: 0 }, onShutdown: () => { exited = true; } }); const { port } = await app2.start();
  const r = await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.ok, true); assert.equal(j.inflight, 0);
  for (let i = 0; i < 40 && !exited; i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(exited, true, "the supervisor hook ran");
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — a stop asked for a moment after a turn began cut that turn 20 s later: the caller's own check
// that nothing ran and its call were two steps; and a session turn sent while Filament stopped was started, then cut.
// On faa022089 the client's request also counted as a turn running in its chat: the turn gate's lock)
test("POST /api/shutdown { ifIdle } stops only while nothing is in flight; a stop under way takes no new session turn", async (t) => {
  let exited = false; const dir = mkdtempSync(join(tmpdir(), "filament-shut-"));
  /** @type {(() => void) | null} */
  let release = null;
  const slow = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      release = () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "m1", type: "message", role: "assistant", model: "slow-1", content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } })); };
    });
  });
  await new Promise((res) => slow.listen(0, "127.0.0.1", () => res(undefined)));
  const c = defaultConfig(); c.server.port = 0; c.server.inboundKeys = ["k"]; c.observability.logFile = ""; c.memory.enabled = false;
  c.upstreams = [{ id: "s", name: "s", type: "anthropic", baseUrl: `http://127.0.0.1:${/** @type {any} */ (slow.address()).port}`, apiKey: "x", enabled: true }];
  c.routes = [{ match: "slow-*", upstream: "s", upstreamModel: "{model}", enabled: true }];
  writeFileSync(join(dir, "config.json"), JSON.stringify(c));
  const app2 = createApp({ dataDir: dir, overrides: { port: 0 }, onShutdown: () => { exited = true; } }); const { port } = await app2.start();
  const H = { "content-type": "application/json", "x-api-key": "k" };
  const base = `http://127.0.0.1:${port}`;
  // A failed check still lets go of the held request and stops Filament, so the file ends instead of waiting on them.
  t.after(async () => {
    if (!exited) {
      /** @type {any} */ (release)?.();
      await app2.stop().catch(() => {});
    }
    slow.closeAllConnections();
    await new Promise((res) => slow.close(() => res(undefined)));
    rmSync(dir, { recursive: true, force: true });
  });
  const flowing = fetch(`${base}/v1/messages`, { method: "POST", headers: { ...H, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "slow-1", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }) });
  for (let i = 0; i < 100 && !release; i++) await new Promise((res) => setTimeout(res, 20));
  assert.ok(release, "the request reached its upstream and waits there");
  const held = await fetch(`${base}/api/shutdown`, { method: "POST", headers: H, body: JSON.stringify({ ifIdle: true }) });
  assert.equal(held.status, 409);
  // An outside client's request is a request in flight: it holds no turn of its chat.
  assert.deepEqual(await held.json(), { ok: false, inflight: 1, turns: 0, chats: [], compacting: 0, subagents: 0, agentTasks: 0, note: "not stopped: 1 request in flight" });
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(exited, false, "Filament goes on");
  assert.equal((await fetch(`${base}/api/state`, { headers: H })).status, 200);
  // The plain stop: it waits for the request in flight, and from its answer on a session's turn is refused at once.
  const stop = await fetch(`${base}/api/shutdown`, { method: "POST", headers: H, body: "{}" });
  assert.equal(stop.status, 200); assert.equal((await stop.json()).inflight, 1);
  const turn = await fetch(`${base}/api/sessions/any/turns`, { method: "POST", headers: H, body: JSON.stringify({ content: "hello" }) });
  assert.equal(turn.status, 503);
  assert.deepEqual(await turn.json(), { error: "Filament is restarting; send again in a few seconds", restarting: true });
  assert.equal(turn.headers.get("retry-after"), "5");
  /** @type {any} */ (release)();
  const done = await flowing;
  assert.equal(done.status, 200, "the request in flight finished");
  for (let i = 0; i < 60 && !exited; i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(exited, true, "then Filament stopped");
});

/**
 * Bytes written on a raw socket, and what came back before the socket closed or the wait ran out.
 * @param {number} port @param {string} text @param {number} [waitMs]
 * @returns {Promise<{ got: string, closed: boolean }>}
 */
const rawExchange = (port, text, waitMs = 3000) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let got = "";
    let over = false;
    const done = (/** @type {boolean} */ closed) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      s.destroy();
      resolve({ got, closed });
    };
    const timer = setTimeout(() => done(false), waitMs);
    s.on("data", (d) => (got += d));
    s.on("close", () => done(true));
    s.on("error", () => {});
    s.write(text);
  });

// (fails before: yes — the bug hunt of 10-30, HTTP-8: an odd request-target threw in the front door's parse of it,
// before its try, and the request waited unanswered; on an upgrade the throw left its listener and the socket open)
test("a request-target no address reads is answered 400, on a request and on an upgrade; the next request is served", async () => {
  const plain = await rawExchange(shimPort, "GET http://x:999999/ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
  assert.match(plain.got, /^HTTP\/1\.1 400 /, plain.got);
  assert.match(plain.got, /the request's target is no address/);
  const up = await rawExchange(shimPort, "GET http://x:999999/api/runs/socket HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
  assert.match(up.got, /^HTTP\/1\.1 400 Bad Request/, up.got);
  assert.equal(up.closed, true, "the upgrade's socket is closed");
  assert.equal((await fetch(`http://127.0.0.1:${shimPort}/health`)).status, 200);
});

// (fails before: yes — the bug hunt of 10-30, HTTP-3: server.requestTimeout was 0 and the body reader had no clock, so a
// client that sent its headers and part of a body held its socket and the handler's read for ever)
test("a request that has not arrived whole by its deadline is cut; a reply that streams on past it, an event stream and the run socket are not", async () => {
  /** An answer whose events come one every 400 ms: three seconds of stream, past the deadline. */
  const trickle = () => {
    const events = /** @type {any[]} */ (anthropicStream("SLOW ANSWER").sse);
    let i = 0;
    return new ReadableStream({
      async pull(c) {
        if (i >= events.length) return c.close();
        await new Promise((r) => setTimeout(r, 400));
        const ev = events[i++];
        c.enqueue(new TextEncoder().encode(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`));
      },
    });
  };
  const up = await fakeUpstream((call) => (call.kind === "anthropic" ? { body: trickle() } : undefined));
  const t = await startApp({
    overrides: { requestMs: 1000 },
    configure: (cfg) => {
      cfg.upstreams = [{ id: "up", name: "up", type: "anthropic-compatible", baseUrl: up.url, apiKey: "x", enabled: true }];
      cfg.routes = [{ match: "slow-*", upstream: "up", upstreamModel: "{model}", enabled: true }];
    },
  });
  try {
    const events = await fetch(`${t.url}/api/events`);
    const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (events.body?.getReader());
    const socket = new WebSocket(`ws://127.0.0.1:${t.port}/api/runs/socket`);
    await new Promise((r, j) => ((socket.onopen = r), (socket.onerror = j)));
    const [slow, reply] = await Promise.all([
      rawExchange(t.port, `POST /api/dry-run HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"format":`, 6000),
      t.post("/v1/messages", { model: "slow-1", max_tokens: 16, stream: true, messages: [{ role: "user", content: "take your time" }] }).then((r) => r.text()),
    ]);
    assert.equal(slow.closed, true, "the request that never arrived whole is cut");
    assert.match(slow.got, /^HTTP\/1\.1 408 /, slow.got);
    assert.equal(parseSse(reply).filter((e) => e.event === "content_block_delta").map((e) => e.data.delta.text).join(""), "SLOW ANSWER", "the reply streamed on past the deadline, whole");
    const read = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: false }), 300))]);
    assert.equal(/** @type {any} */ (read).done, false, "the event stream is open");
    assert.equal(socket.readyState, WebSocket.OPEN, "the run socket is open");
    const heard = new Promise((r) => (socket.onmessage = (m) => r(JSON.parse(String(m.data)))));
    socket.send(JSON.stringify({ op: "follow", key: "k1", run: "no-such-run" }));
    assert.deepEqual(await heard, { key: "k1", missing: true }, "and it answers");
    await reader.cancel();
    socket.close();
  } finally {
    await t.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, HTTP-4: an agent's MCP door read a POST's whole body before it looked at
// its token, answered a body past the cap 500, and took a page of another site's request as any other)
test("an agent's MCP door: a page of another site is refused; a token that names no session is answered before its body is read; a body past the cap is a 413", async () => {
  const t = await startApp({ configure: (cfg) => void (cfg.server.maxBodyBytes = 2000) });
  const mcp = /** @type {any} */ (t.app).mcp;
  const known = mcp.contextFor;
  mcp.contextFor = (/** @type {string} */ token) => (token === "feedface" ? {} : known(token));
  try {
    /** @param {string} token @param {string} body @param {Record<string, string>} [headers] */
    const post = (token, body, headers = {}) => fetch(`${t.url}/mcp/${token}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(5000) } });
    const page = await post("feedface", ping, { Origin: "http://evil.example" });
    assert.equal(page.status, 403);
    const gone = await post("0123abcd", big);
    assert.equal(gone.status, 404, "its token is looked at first");
    assert.deepEqual((await gone.json()).error, { code: -32001, message: "unknown Filament MCP token (the conversation is gone)" });
    const over = await post("feedface", big);
    assert.deepEqual([over.status, (await over.json()).error], [413, "request body too large"]);
    const ok = await post("feedface", ping);
    assert.deepEqual([ok.status, await ok.json()], [200, { jsonrpc: "2.0", id: 1, result: {} }], "an agent's call is answered as before");
  } finally {
    mcp.contextFor = known;
    await t.stop();
  }
});

