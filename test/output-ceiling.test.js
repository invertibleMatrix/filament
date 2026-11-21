// @ts-check
// How much a model may write is its provider's to say. A model Filament was never told about — one typed by name on
// Settings › Providers — is asked for DEFAULT_OUTPUT_TOKENS, and a provider that lets it write less refuses the call
// (Z.AI: "The max_tokens parameter is illegal.：限制数值范围[1,98304]"; found by HS-2's drive, a Ping of a typed GLM).
// The refusal states the ceiling: Filament remembers it for that model at that upstream, every later call asks within
// it, and a call of Filament's own goes again at once within it. A client's request reaches the client as refused.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, parseSse } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { lowerOutputTo, outputAsked, statedOutputCeiling } from "../src/core/tokens.js";

describe("a provider's refusal read for the most its model may write", () => {
  // (fails before: yes — no such reading existed)
  test("each provider's words give its ceiling; a refusal for the window, or a number not below the ask, gives none", () => {
    assert.equal(statedOutputCeiling("The max_tokens parameter is illegal.：限制数值范围[1,98304]", 128000), 98304);
    assert.equal(statedOutputCeiling("Invalid max_tokens value, the valid range of max_tokens is [1, 8192]", 128000), 8192);
    assert.equal(statedOutputCeiling("max_tokens is too large: 128000. This model supports at most 16384 completion tokens, whereas you provided 128000.", 128000), 16384);
    assert.equal(statedOutputCeiling("max_tokens: 128000 > 64000, which is the maximum allowed number of output tokens for claude-haiku-5", 128000), 64000);
    assert.equal(statedOutputCeiling("`max_tokens` must be less than or equal to `32768`, the maximum value for `max_tokens` is less than the `context_window` for this model", 128000), 32768);
    assert.equal(statedOutputCeiling("This model's maximum context length is 8192 tokens. However, you requested 9000 tokens.", 128000), null, "the window's refusal");
    assert.equal(statedOutputCeiling("The max_tokens parameter is illegal.：限制数值范围[1,98304]", 4096), null, "not below the ask");
    assert.equal(statedOutputCeiling("temperature must be in [0, 2]", 128000), null, "about something else");
  });

  test("a request's reply room is lowered by whichever field names it, and a thinking budget kept under it", () => {
    const a = { max_tokens: 128000, thinking: { type: "enabled", budget_tokens: 100000 } };
    assert.equal(lowerOutputTo(a, 8192), true);
    assert.deepEqual(a, { max_tokens: 8192, thinking: { type: "enabled", budget_tokens: 7168 } });
    const tight = { max_tokens: 128000, thinking: { type: "enabled", budget_tokens: 4096 } };
    lowerOutputTo(tight, 1024);
    assert.deepEqual(tight, { max_tokens: 1024 }, "no room for a budget: thinking goes off");
    const o = { max_completion_tokens: 50000 };
    assert.equal(lowerOutputTo(o, 50000), false, "already within");
    assert.equal(outputAsked({ max_output_tokens: 3000 }), 3000);
    assert.equal(outputAsked({}), 0);
  });
});

describe("a model's output ceiling learned from its provider's refusal", () => {
  const CEILING = 8192;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let s;
  before(async () => {
    up = await fakeUpstream((call) => {
      const asked = Number(call.body?.max_tokens ?? call.body?.max_completion_tokens ?? 0);
      if (call.kind === "openai" && asked > CEILING) return { status: 400, json: { error: { code: "1210", message: `The max_tokens parameter is illegal.：限制数值范围[1,${CEILING}]` } } };
      return undefined;
    });
    s = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: up.url, apiKey: "k", models: ["typed-x", "typed-y"] }];
        cfg.routes = [{ match: "zai/*", upstream: "zai", upstreamModel: "{1}" }];
      },
    });
  });
  after(async () => {
    await s?.stop();
    await up?.close();
  });
  const asks = () => up.received.filter((c) => c.kind === "openai").map((c) => Number(c.body?.max_tokens ?? c.body?.max_completion_tokens));
  /** @param {string} model */
  const ping = async (model) => (await s.post("/api/models/ping", { model })).json();

  // (fails before: yes — the Ping answered the provider's 400, and every later call met it again)
  test("a Ping of a typed model goes again within the ceiling its provider stated, and the next asks within it", async () => {
    up.reset();
    const r = await ping("zai/typed-x");
    assert.equal(r.ok, true, JSON.stringify(r));
    const [first, second] = asks();
    assert.ok(first > CEILING, `asked ${first} first`);
    assert.ok(second <= CEILING, `then ${second}`);
    const rec = (await s.records(5)).find((/** @type {any} */ x) => x.upstreamModel === "typed-x");
    const changes = (await s.record(rec.id)).changes || [];
    assert.ok(changes.some((/** @type {string} */ c) => /^output: typed-x at zai writes at most 8,192 tokens/.test(c)), changes.join("\n"));
    assert.ok(changes.some((/** @type {string} */ c) => /^output: Filament's own call went again .* and zai answered$/.test(c)), changes.join("\n"));
    up.reset();
    assert.equal((await ping("zai/typed-x")).ok, true);
    assert.equal(asks().length, 1, "no refusal the second time");
    assert.ok(asks()[0] <= CEILING);
  });

  test("a client's request is refused as sent, and what its provider said is remembered for Filament's own calls", async () => {
    up.reset();
    const res = await s.post("/v1/chat/completions", { model: "zai/typed-y", max_tokens: 20000, messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /max_tokens parameter is illegal/);
    assert.deepEqual(asks(), [20000], "sent once, as the client asked");
    up.reset();
    assert.equal((await ping("zai/typed-y")).ok, true);
    assert.equal(asks().length, 1);
    assert.ok(asks()[0] <= CEILING);
  });

  test("the ceiling is written with the model lists (models-cache.json), and forgotten when the provider's listing changes", async () => {
    await new Promise((r) => setTimeout(r, 700)); // the cache's save waits half a second
    const kept = JSON.parse(readFileSync(join(s.dataDir, "models-cache.json"), "utf8")).outputCeilings;
    assert.deepEqual(kept?.zai, { "typed-x": CEILING, "typed-y": CEILING });
    const ch = await s.api("/api/upstreams/zai", { method: "PATCH", body: { modelsPath: "/v1/models" } });
    assert.equal(ch.status, 200, await ch.text());
    up.reset();
    assert.equal((await ping("zai/typed-x")).ok, true);
    assert.equal(asks().length, 2, "asked for more again, then learned again");
  });
});

// (fails before: yes — the chat's turn ended on the provider's 400.) The agent loop is off here, so the turn goes to the
// model itself, as the page composed it; on the loop its rounds are Filament's own calls, as a Ping is.
test("a harness chat's turn on such a model goes again within the ceiling: Filament chose its reply room", async () => {
  const CEILING = 8192;
  const up = await fakeUpstream((call) => {
    const asked = Number(call.body?.max_tokens ?? call.body?.max_completion_tokens ?? 0);
    if (call.kind === "openai" && asked > CEILING) return { status: 400, json: { error: { message: `Invalid max_tokens value, the valid range of max_tokens is [1, ${CEILING}]` } } };
    return undefined;
  });
  const root = mkdtempSync(join(tmpdir(), "filament-output-ceiling-"));
  const projDir = join(root, "project");
  mkdirSync(projDir);
  const s = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [{ id: "ds", name: "DeepSeek", type: "openai-compatible", baseUrl: up.url, apiKey: "k", models: ["typed-z"] }];
      cfg.routes = [{ match: "ds/*", upstream: "ds", upstreamModel: "{1}" }];
      cfg.agentLoop = { ...(cfg.agentLoop || {}), enabled: false, roots: [root] };
    },
  });
  try {
    const made = await s.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ds/typed-z", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const res = await s.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: true } });
    assert.equal(res.status, 200);
    let said = "";
    for (const { data } of parseSse(await res.text())) if (data?.type === "content_block_delta") said += data.delta?.text ?? "";
    assert.equal(said, "MODEL ANSWER");
    const asks = up.received.filter((c) => c.kind === "openai").map((c) => Number(c.body?.max_tokens ?? c.body?.max_completion_tokens));
    assert.equal(asks.length, 2, String(asks));
    assert.ok(asks[0] > CEILING && asks[1] <= CEILING, String(asks));
  } finally {
    await s.stop();
    await up.close();
    await removeDirs(root);
  }
});

// (fails before: yes — the planner handed the parsed name's object, not the model's name, so no route was found and
// every such request asked DEFAULT_OUTPUT_TOKENS, whatever the model's own ceiling)
test("an OpenAI-shaped request without max_tokens, sent on in Anthropic's shape, asks the most its model may write", async () => {
  const up = await fakeUpstream();
  const s = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [{ id: "ant", name: "ant", type: "anthropic-compatible", baseUrl: up.url, apiKey: "k", pricing: { "small-model": { maxOutputTokens: 4096 } } }];
      cfg.routes = [{ match: "small-model", upstream: "ant", upstreamModel: "{model}" }];
    },
  });
  try {
    const res = await s.post("/v1/chat/completions", { model: "small-model", messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.status, 200, await res.text());
    const sent = up.received.find((c) => c.kind === "anthropic");
    assert.equal(sent?.body.max_tokens, 4096);
  } finally {
    await s.stop();
    await up.close();
  }
});
