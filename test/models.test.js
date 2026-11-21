import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { invertRoute } from "../src/upstreams.js";
import { resolveModelDisplay } from "../src/core/routing.js";
import { fetchUpstreamModels } from "../src/adapters/providers/http.js";
import { mergeRules, shapeAnthropic, shapeOpenAI, parseModelSuffix } from "../src/rules.js";

test("invertRoute maps upstream names back to agent-facing names", () => {
  assert.equal(invertRoute({ match: "claude-*", upstreamModel: "{model}" }, "claude-opus-5"), "claude-opus-5");
  assert.equal(invertRoute({ match: "claude-*", upstreamModel: "{model}" }, "gpt-5"), null);
  assert.equal(invertRoute({ match: "claude-*", upstreamModel: "anthropic/{model}" }, "anthropic/claude-opus-5"), "claude-opus-5");
  assert.equal(invertRoute({ match: "claude-*", upstreamModel: "anthropic/{model}" }, "openai/gpt-5"), null);
  assert.equal(invertRoute({ match: "direct/claude-*", upstreamModel: "claude-{1}" }, "claude-opus-5"), "direct/claude-opus-5");
  assert.equal(invertRoute({ match: "*", upstreamModel: "{model}" }, "anything/goes"), "anything/goes");
  assert.equal(invertRoute({ match: "my-alias", upstreamModel: "vendor/real-model" }, "vendor/real-model"), "my-alias");
});

test("resolveModelDisplay names the destination upstream, with the asked-for lane in parens", () => {
  const cfg = defaultConfig();
  cfg.upstreams = [{ id: "sx", name: "SpaceX", type: "openai-compatible", baseUrl: "http://127.0.0.1:1", apiKey: "k", enabled: true }];
  cfg.routes = [{ match: "*", upstream: "sx", upstreamModel: "{model}", enabled: true }];
  assert.equal(resolveModelDisplay(cfg, "grok-4.6"), "SpaceX/grok-4.6");
  assert.equal(resolveModelDisplay(cfg, "grok-4.6-xhigh"), "SpaceX/grok-4.6 (grok-4.6-xhigh)", "the effort suffix is Filament's, not the upstream's");
  assert.equal(resolveModelDisplay(cfg, "agent/grok-4.6-xhigh"), "SpaceX/grok-4.6 (agent/grok-4.6-xhigh)", "the agent lane is who asked, not who answers");
  assert.equal(resolveModelDisplay(cfg, ""), "");
});

test("forced tool_choice is rewritten to auto only on models that reject it", () => {
  const rules = mergeRules();
  const a = shapeAnthropic({ body: { model: "claude-fable-5-1", max_tokens: 10, messages: [], tool_choice: { type: "any" } }, rules, requested: parseModelSuffix("claude-fable-5-1", rules) });
  assert.deepEqual(a.body.tool_choice, { type: "auto" });
  const b = shapeAnthropic({ body: { model: "claude-opus-5", max_tokens: 10, messages: [], tool_choice: { type: "tool", name: "x" } }, rules, requested: parseModelSuffix("claude-opus-5", rules) });
  assert.equal(b.body.tool_choice.type, "tool");
  const c = shapeOpenAI({ body: { model: "claude-fable-5-1", messages: [], tool_choice: "required" }, rules, requested: parseModelSuffix("claude-fable-5-1", rules) });
  assert.equal(c.body.tool_choice, "auto");
});

let fake, app, shimPort, dataDir, modelsDown = false;
before(async () => {
  fake = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models" && modelsDown) { res.writeHead(500); return res.end("boom"); }
    if (req.method === "GET" && req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ object: "list", data: [{ id: "anthropic/claude-opus-5" }, { id: "anthropic/claude-fable-5-1" }, { id: "openai/gpt-5" }, { id: "cu/claude-opus-5-thinking-high" }] })); }
    let buf = ""; req.on("data", (d) => (buf += d)); req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "x-ratelimit-remaining": "41", "request-id": "req_abc", "x-provider-extra": "hello", "content-encoding": "identity", "set-cookie": "nope" });
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-models-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = ""; cfg.server.advertiseEffortSuffixes = ["max"];
  cfg.upstreams = [
    { id: "router", name: "r", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s" },
    { id: "nine", name: "n", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s" },
  ];
  cfg.routes = [
    { match: "my-opus", upstream: "router", upstreamModel: "anthropic/claude-opus-5" },
    { match: "claude-*", upstream: "router", upstreamModel: "anthropic/{model}" },
    { match: "nine/claude-*", upstream: "nine", upstreamModel: "claude-{1}", discoverPrefixes: ["anthropic"] }, // 9router accepts the bare name
  ];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); shimPort = (await app.start()).port;
  // The owner's rule: a read never fetches — the dashboard's Refresh is the only discovery trigger. Every test
  // below reads discovered names, so the button is pressed once here, as he would press it once after setup.
  await (await fetch(`http://127.0.0.1:${shimPort}/api/models?refresh=1`)).json();
});
after(async () => { await app.stop(); fake.close(); rmSync(dataDir, { recursive: true, force: true }); });

test("hiddenModels keeps names out of the advertised list but they stay routable", async () => {
  const st = await (await fetch(`http://127.0.0.1:${shimPort}/api/state`)).json(); const cfg = st.config; const up = cfg.upstreams.find((u) => u.id === "router");
  up.hiddenModels = ["anthropic/claude-fable-5-1"];
  const put = await fetch(`http://127.0.0.1:${shimPort}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) }); assert.equal(put.status, 200);
  const j = await (await fetch(`http://127.0.0.1:${shimPort}/v1/models`, { headers: { authorization: "Bearer k" } })).json(); const ids = j.data.map((m) => m.id);
  assert.ok(ids.includes("claude-opus-5") && !ids.includes("claude-fable-5-1"), ids.join(","));
  const dry = await (await fetch(`http://127.0.0.1:${shimPort}/api/dry-run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "anthropic", body: { model: "claude-fable-5-1", max_tokens: 5, messages: [{ role: "user", content: "hi" }] } }) })).json(); assert.equal(dry.ok, true, "hidden name still routes");
  up.hiddenModels = []; await fetch(`http://127.0.0.1:${shimPort}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) });
});

test("/v1/models lists route names plus discovered names mapped through routes, plus effort variants", async () => {
  const j = await (await fetch(`http://127.0.0.1:${shimPort}/v1/models`, { headers: { authorization: "Bearer k" } })).json();
  const ids = j.data.map((m) => m.id);
  assert.ok(ids.includes("my-opus"));
  assert.ok(ids.includes("claude-opus-5") && ids.includes("claude-fable-5-1"), ids.join(","));
  assert.ok(!ids.includes("gpt-5") && !ids.some((i) => i.startsWith("openai/")));
  assert.ok(ids.includes("claude-opus-5-max"));
  const opus = j.data.find((m) => m.id === "claude-opus-5"); assert.ok(opus.upstream && opus.owned_by === opus.upstream, "OpenAI list names the upstream"); assert.equal(opus.upstream_model, "anthropic/claude-opus-5");
  const ja = await (await fetch(`http://127.0.0.1:${shimPort}/v1/models`, { headers: { authorization: "Bearer k", "anthropic-version": "2023-06-01" } })).json();
  const opusA = ja.data.find((m) => m.id === "claude-opus-5"); assert.equal(opusA.type, "model"); assert.equal(opusA.upstream, opus.upstream); assert.equal(opusA.upstream_model, "anthropic/claude-opus-5");
  assert.ok(ids.includes("nine/claude-opus-5") && ids.includes("nine/claude-fable-5-1"), "router bare-name inversion: " + ids.join(","));
  assert.ok(!ids.includes("nine/gpt-5"));
  assert.ok(!ids.includes("nine/claude-opus-5-thinking-high"), "cursor-prefixed ids must not be advertised by bare name: " + ids.join(","));
  const cached = await (await fetch(`http://127.0.0.1:${shimPort}/api/models`)).json();
  assert.equal(cached.upstreams.router.source, "cache");
  const admin = await (await fetch(`http://127.0.0.1:${shimPort}/api/models?refresh=1`)).json();
  assert.equal(admin.upstreams.router.source, "discovered");
  assert.equal(admin.models.find((m) => m.id === "claude-fable-5-1").source, "discovered");
});

test("safe response headers reach the agent; hop-by-hop, cookies and encoding do not; provider meta is recorded", async () => {
  const r = await fetch(`http://127.0.0.1:${shimPort}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer k" }, body: JSON.stringify({ model: "claude-opus-5", max_tokens: 5, messages: [{ role: "user", content: "hi" }] }) });
  await r.json();
  assert.equal(r.headers.get("x-ratelimit-remaining"), "41"); assert.equal(r.headers.get("request-id"), "req_abc"); assert.equal(r.headers.get("x-provider-extra"), "hello");
  assert.equal(r.headers.get("set-cookie"), null); assert.equal(r.headers.get("content-encoding"), null);
  const rec = app.usage.list(1)[0];
  assert.equal(rec.providerMeta["x-ratelimit-remaining"], "41"); assert.equal(rec.providerMeta["request-id"], "req_abc");
});

test("a failed model refresh keeps the last discovered names instead of blanking every picker", async () => {
  await fetch(`http://127.0.0.1:${shimPort}/api/models?refresh=1`);
  modelsDown = true;
  try {
    const j = await (await fetch(`http://127.0.0.1:${shimPort}/api/models?refresh=1`)).json();
    assert.equal(j.upstreams.router.source, "stale"); assert.ok(j.upstreams.router.error, "the error is still reported");
    assert.ok(j.models.some((m) => m.id === "claude-opus-5"), "names survive the outage: " + j.models.map((m) => m.id).join(","));
    const v = await (await fetch(`http://127.0.0.1:${shimPort}/v1/models`, { headers: { authorization: "Bearer k" } })).json();
    assert.ok(v.data.some((m) => m.id === "claude-opus-5"));
  } finally { modelsDown = false; }
});

test("model lists are read from disk: a read never fetches; a forced refresh fetches once and never deletes saved names", async () => {
  let hits = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      hits++;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "found-a" }] }));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const up = { id: "nofetch", type: "anthropic-compatible", baseUrl: `http://127.0.0.1:${srv.address().port}`, apiKey: "s", models: ["saved-keep"] };
    const cold = await fetchUpstreamModels(up);
    assert.equal(hits, 0, "a cold read must not call the provider");
    assert.deepEqual(cold.names, ["saved-keep"], "the on-disk list alone is served");
    const forced = await fetchUpstreamModels(up, { force: true });
    assert.equal(hits, 1, "the forced refresh fetches");
    assert.deepEqual([...forced.names].sort(), ["found-a", "saved-keep"], "the refresh merges — a name saved on disk is never deleted by what came back");
    const warm = await fetchUpstreamModels(up);
    assert.equal(hits, 1, "a warm read fetches nothing");
    assert.ok(warm.names.includes("found-a") && warm.names.includes("saved-keep"), warm.names.join(","));
  } finally { srv.close(); }
});

// ---- context windows: endpoint discovery, tiered resolution, the fit verdict ----
import { contextWindowWithSource } from "../src/core/pricing.js";
import { fitVerdict } from "../src/core/autofit.js";
import { discoveredWindows, dumpModelCache } from "../src/adapters/providers/http.js";

test("window resolution: the operator's word, then the endpoint's, then the built-ins", () => {
  // built-in estimate for a well-known name, when nobody else said anything
  const builtin = contextWindowWithSource("claude-opus-5-1", null, null);
  assert.equal(builtin.source, "builtin");
  assert.ok(builtin.tokens >= 100_000, "a real estimate, not a guess of zero");
  // the endpoint's own listing beats the built-ins...
  assert.deepEqual(contextWindowWithSource("k3-256k", null, { "k3-256k": 262144 }), { tokens: 262144, source: "endpoint" });
  // ...but never the operator's table
  assert.deepEqual(
    contextWindowWithSource("k3-256k", { k3: { contextTokens: 100_000 } }, { "k3-256k": 262144 }),
    { tokens: 100_000, source: "operator" },
  );
  // exact spelling beats a longer-shared prefix; a claim outside sane bounds is not trusted
  assert.equal(contextWindowWithSource("k3-256k-xhigh", null, { "k3-256k": 262144, k3: 128000 }).tokens, 262144);
  assert.equal(contextWindowWithSource("router-m", null, { "router-m": 7 }).source, null, "a sub-1000 claim is not a context window");
  // effort suffix and date stamps normalize away on both sides
  assert.equal(contextWindowWithSource("router-m-high", null, { "router-m": 65_536 }).tokens, 65_536);
  assert.equal(contextWindowWithSource("unknown-everything", null, null).source, null);
});

test("model discovery captures the windows a listing states (and only the sane ones)", async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [
      { id: "disc/llama-4", context_length: 1_048_576 },
      { id: "disc/gemma-3", max_context_length: 131_072 },
      { id: "disc/odd-one", context_length: 3 }, // below sane bounds: captured as a name, not as a window
      { id: "disc/plain-one" }, // states nothing
    ] }));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const up = { id: `disc-win-${Math.random().toString(36).slice(2, 8)}`, type: "openai-compatible", baseUrl: `http://127.0.0.1:${srv.address().port}`, apiKey: "s" };
  try {
    const r = await fetchUpstreamModels(up, { force: true });
    assert.equal(r.source, "discovered");
    assert.ok(r.names.includes("disc/odd-one"), "the name is still discovered");
    const w = discoveredWindows(up.id);
    assert.equal(w["disc/llama-4"], 1_048_576, "context_length captured");
    assert.equal(w["disc/gemma-3"], 131_072, "max_context_length captured");
    assert.equal(w["disc/odd-one"], undefined, "an insane claim is not trusted");
    assert.equal(w["disc/plain-one"], undefined, "a listing that states nothing captures nothing");
    // the cache round-trip keeps them for the next start
    const dumped = JSON.parse(JSON.stringify(dumpModelCache()))[up.id];
    assert.equal(dumped.windows["disc/llama-4"], 1_048_576);
  } finally { srv.close(); }
});

test("fitVerdict: the one word every surface reads", () => {
  assert.equal(fitVerdict({}), "unknown");
  assert.equal(fitVerdict({ window: 0, usable: 0, estimate: 1000 }), "unknown", "no window, no verdict but unknown");
  assert.equal(fitVerdict({ window: 200_000, usable: 155_000, estimate: 100 }), "fits");
  assert.equal(fitVerdict({ window: 200_000, usable: 155_000, estimate: 145_000 }), "tight", "within 10% of the edge");
  assert.equal(fitVerdict({ window: 200_000, usable: 155_000, estimate: 160_000 }), "edge", "compaction territory");
  assert.equal(fitVerdict({ window: 200_000, usable: 155_000, estimate: 201_000 }), "over", "past the window itself");
  assert.equal(fitVerdict({ window: 200_000, estimate: 201_000 }), "over", "over is over even without a usable figure");
});
