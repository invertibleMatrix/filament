// @ts-check
// HarnessV4_Tasks E4 (HarnessV4_Overnight_Plan, batch 1, OC-18 to OC-32): a model that takes no tools is known before
// it refuses. Its row on the Upstreams page says so (`tools: false`, the Tune sheet's Tools part), else its provider's
// listing does (OpenRouter's `supported_parameters`, Mistral's `capabilities.function_calling`); nobody saying is not
// a no. Filament's own agent then runs it in words only, memory offers it none of its tools, the Assistant refuses it,
// the harness's picker says "No tools", and a client's own tools still go as the client sent them.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capsAt, modelCapsFor, withoutOperatorCaps } from "../src/core/model-caps.js";
import { buildFamilies } from "../src/core/model-families.js";
import { wireDiscoveredCaps, findUpstream } from "../src/core/routing.js";
import { fetchUpstreamModels, discoveredCaps, seedModelCache } from "../src/adapters/providers/http.js";
import { defaultsOf, RULES } from "../src/core/schema.js";
import { normalizeConfig, validateConfig } from "../src/services/config/store.js";
import { defaultConfig } from "../src/services/config/store.js";
import { systemPromptFor, PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { Assistant } from "../src/app/assistant.js";
import { familyFacts } from "../src/ui/harness/composer/model.js";
import { capChips } from "../src/ui/lib/model-caps.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const NO_TOOLS_LINE = "This model takes no tools here, so you have none: you cannot read, change or run anything.";

/** An OpenRouter-style upstream, an Anthropic one and a coding agent, with the rows given. @param {Record<string, any>} [orRows] */
const cfgWith = (orRows = {}) => ({
  rules: defaultsOf(RULES),
  upstreams: [
    { id: "or", type: "openai-compatible", enabled: true, baseUrl: "http://or", pricing: orRows },
    { id: "cur", type: "acp", enabled: true, acp: { command: "agent" }, pricing: { "gpt-6": { tools: false } } },
  ],
  routes: [
    { match: "or/*", upstream: "or", upstreamModel: "{1}" },
    { match: "cursor/*", upstream: "cur", upstreamModel: "{1}" },
  ],
});

describe("what says a model takes tools: its row, then its listing; nobody saying is not a no", () => {
  after(() => wireDiscoveredCaps(() => null));

  // (fails before: yes — the answer had no tools part at all)
  test("the row's word first (OC-23), then the listing's (OC-20), else taken to take them (OC-22); a coding agent's own tools are its own (OC-30)", () => {
    wireDiscoveredCaps((/** @type {string} */ id) => (id === "or" ? { "listed-none": { tools: false }, "listed-yes": { tools: true }, overruled: { tools: false } } : null));
    const cfg = cfgWith({ "row-none": { tools: false }, overruled: { tools: true } });
    const at = (/** @type {string} */ name) => modelCapsFor(cfg, name)?.tools;
    assert.deepEqual(at("or/row-none"), { available: false, source: "operator" });
    assert.deepEqual(at("or/listed-none"), { available: false, source: "endpoint" });
    assert.deepEqual(at("or/listed-yes"), { available: true, source: "endpoint" });
    assert.deepEqual(at("or/overruled"), { available: true, source: "operator" }, "your word wins over the listing's");
    assert.deepEqual(at("or/silent"), { available: true, source: null }, "a listing that says nothing claims nothing");
    assert.deepEqual(at("cursor/gpt-6"), { available: true, source: null }, "a row on a coding agent's upstream speaks for nothing");
    // "Use the provider's" on the Tune sheet: without the row, the listing speaks again.
    const up = findUpstream(cfg, "or");
    assert.deepEqual(capsAt(cfg, withoutOperatorCaps(up), "overruled").tools, { available: false, source: "endpoint" });
  });

  // (fails before: yes — a row's `tools` was a field nothing read, so a save took any value)
  test("a row's tools is true or false — a word a text box gives is read as one — and a save refuses anything else (OC-31)", () => {
    const row = (/** @type {any} */ v) => normalizeConfig({ ...defaultConfig(), upstreams: [{ id: "or", type: "openai-compatible", baseUrl: "http://or", pricing: { m: { tools: v } } }] });
    assert.deepEqual(validateConfig(row(false)).errors.filter((e) => /tools/.test(e)), []);
    assert.equal(row("no").upstreams[0].pricing.m.tools, false, "as every yes-or-no field of a row reads it");
    assert.ok(validateConfig(row("sometimes")).errors.includes('upstreams[0].pricing["m"].tools must be true or false'), validateConfig(row("sometimes")).errors.join("; "));
  });
});

describe("a provider's listing: what it states of tools is kept, and nothing it did not state", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  before(async () => {
    up = await fakeUpstream((call) => {
      if (call.kind !== "models") return undefined;
      return {
        json: {
          data: [
            { id: "or/chat-only", supported_parameters: ["max_tokens", "temperature", "top_p"] },
            { id: "or/tool-user", supported_parameters: ["max_tokens", "tools", "tool_choice"] },
            { id: "or/unsaid", supported_parameters: [] },
            { id: "mistral-small", capabilities: { completion_chat: true, function_calling: false } },
            { id: "mistral-large", capabilities: { completion_chat: true, function_calling: true } },
            { id: "names-only" },
          ],
        },
      };
    });
  });
  after(async () => {
    await up?.close();
  });

  // (fails before: yes — neither listing's word on tools was read)
  test("OpenRouter's supported_parameters (OC-20) and Mistral's function_calling (OC-21); an empty list and a bare name claim nothing (OC-22)", async () => {
    const r = await fetchUpstreamModels({ id: "list-or", type: "openai-compatible", baseUrl: up.url, apiKey: "k", discoverModels: true }, { force: true });
    assert.equal(r.source, "discovered");
    const caps = /** @type {any} */ (discoveredCaps("list-or"));
    assert.deepEqual(caps["or/chat-only"], { tools: false });
    assert.deepEqual(caps["or/tool-user"], { tools: true });
    assert.equal(caps["or/unsaid"], undefined);
    assert.deepEqual(caps["mistral-small"], { tools: false });
    assert.deepEqual(caps["mistral-large"], { tools: true });
    assert.equal(caps["names-only"], undefined);
  });

  // (fails before: yes — the cache dropped it)
  test("the word survives the cache's round trip; a value that is not true or false does not", () => {
    seedModelCache({ "list-c": { at: 1, names: ["m", "n"], windows: {}, caps: { m: { tools: false }, n: { tools: "no" } } } });
    assert.deepEqual(discoveredCaps("list-c"), { m: { tools: false } });
  });
});

describe("where it is said: the harness's picker and the upstream card's chips", () => {
  // (fails before: yes — a family carried no word on tools, and the picker said nothing)
  test("a family whose model takes none carries who said so, and the picker says No tools with it (OC-19)", () => {
    const cfg = cfgWith({ "row-none": { tools: false } });
    const fams = buildFamilies(cfg, [
      { id: "or/row-none", upstream: "or", upstreamModel: "row-none", source: "discovered" },
      { id: "or/plain", upstream: "or", upstreamModel: "plain", source: "discovered" },
    ]);
    const none = /** @type {any} */ (fams.find((f) => f.id === "or/row-none"));
    const plain = /** @type {any} */ (fams.find((f) => f.id === "or/plain"));
    assert.equal(none.noTools, "operator");
    assert.equal(plain.noTools, undefined);
    const fact = familyFacts(none).find((f) => f.text === "No tools");
    assert.ok(fact, JSON.stringify(familyFacts(none)));
    assert.match(String(fact.title), /your Tune sheet on the Upstreams page says so/);
    assert.ok(!familyFacts(plain).some((f) => f.text === "No tools"));
    assert.match(String(familyFacts({ ...none, noTools: "endpoint" }).find((f) => f.text === "No tools")?.title), /its provider's model list says so/);
  });

  // (fails before: yes — the card showed nothing)
  test("the upstream card's row shows a no-tools chip in the colour of who said it", () => {
    const h = (/** @type {string} */ tag, /** @type {any} */ attrs = {}, /** @type {any[]} */ ...kids) => ({ tag, attrs, kids: kids.flat().filter((k) => k != null && k !== false) });
    const entry = {
      caps: { wire: "openai", effort: { levels: null, source: null }, fast: { available: false, declared: false, source: null, multiplier: null }, thinking: { available: false, source: null }, window: { standard: null, options: [], source: null }, maxOutput: { tokens: null, source: null }, tools: { available: false, source: "endpoint" } },
      offer: { kind: "plain" },
      policy: { effortAllowed: null, speedMode: "client", speedSuffix: true },
    };
    const chips = /** @type {any[]} */ (capChips(h, entry));
    const chip = chips.find((c) => c.kids.join("") === "no tools");
    assert.ok(chip);
    assert.match(chip.attrs.class, /src-endpoint/);
    assert.equal(capChips(h, { ...entry, caps: { ...entry.caps, tools: { available: true, source: null } } }).length, 0);
  });
});

describe("the prompt of a model that takes none", () => {
  // (fails before: yes — such a model was told of hands it did not have)
  test("its tools section is one line, and the graph's section, which works through a tool, goes; every other prompt is version 30's (OC-24)", () => {
    assert.equal(PROMPT_VERSION, 129);
    const base = { root: "R", delegateRead: false, graph: true };
    const none = systemPromptFor({ ...base, noTools: true });
    const tools = none.split("\n\n").find((b) => b.startsWith("# Your tools"));
    assert.equal(tools, `# Your tools\n${NO_TOOLS_LINE} Answer in words from what this conversation holds, and say plainly what you would need to read or run to be sure.`);
    const graphHead = systemPromptFor(base).split("\n\n").find((b) => /^# .*graph/i.test(b))?.split("\n")[0];
    assert.ok(graphHead, "a model that takes tools has the graph's section");
    assert.ok(!none.includes(graphHead), "a model that takes none does not");
    assert.equal(systemPromptFor({ ...base, noTools: false }), systemPromptFor(base), "a model that takes tools: the same bytes");
  });
});

describe("the Assistant", () => {
  // (fails before: yes — it sent its tools, and the provider refused the turn)
  test("refuses a model that takes none before anything is sent (OC-29)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-notools-asst-"));
    try {
      const cfg = defaultConfig();
      cfg.upstreams = [{ id: "or", name: "or", type: "openai-compatible", baseUrl: "http://or", apiKey: "k", enabled: true, pricing: { "chat-only": { tools: false } } }];
      cfg.routes = [{ match: "chat-only", upstream: "or", upstreamModel: "{model}", enabled: true }];
      /** @type {any[]} */
      const asks = [];
      const a = new Assistant(/** @type {any} */ ({ getConfig: () => cfg, listModels: async () => ({ models: [] }), describeDiff: () => [], dataDir: dir, callModel: async (/** @type {any} */ b) => (asks.push(b), { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }) }));
      await assert.rejects(a.turn({ sessionId: "s1", message: "add a route", model: "chat-only" }), /chat-only takes no tools \(its row on the Upstreams page says so\), and the assistant works only through its tools/);
      assert.equal(asks.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Filament's own agent on a model that takes none", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {any[]} */
  let bodies = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-notools-loop-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      bodies.push(call.body);
      return anthropicReply("", { model: call.body.model, stop: "end_turn", blocks: [{ type: "text", text: "In words." }], usage: { input_tokens: 30, output_tokens: 4 } });
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-none": { tools: false } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true, tools: true, cue: false, rewrite: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    for (const dir of [shim?.dataDir, root]) {
      try {
        if (dir) rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  /** One turn on a fresh session. @param {string} model */
  const turnOn = async (model) => {
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings: {} } })).json();
    bodies = [];
    const r = await shim.api(`/api/sessions/${encodeURIComponent(created.id)}/turns`, { method: "POST", body: { content: "what does main.js do?", stream: false } });
    assert.equal(r.status, 200);
    await r.json();
    return { rec: /** @type {any} */ (await shim.record(r.headers.get("x-filament-request-id"))), id: created.id };
  };
  /** @param {any} b */
  const systemOf = (b) => (Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x.text).join("") : String(b.system || ""));

  // (fails before: yes — the turn carried every tool, and a provider that takes none refused it; and its tick's record
  // said only memory's tools were offered, beside the line that said none were)
  test("the turn goes with no tools field at all — memory's none either — its prompt says why, and the record says who said so (OC-24, OC-27)", async () => {
    const { rec } = await turnOn("agent/brain-none");
    assert.ok(bodies.length >= 1);
    for (const b of bodies) assert.equal(b.tools, undefined, JSON.stringify(Object.keys(b)));
    assert.ok(systemOf(bodies[0]).includes(NO_TOOLS_LINE));
    assert.ok(rec.changes.some((/** @type {string} */ c) => c === "agent: brain-none takes no tools (its row on the Upstreams page says so): the turn runs in words only — no tools offered, and its prompt says why"), rec.changes.join("\n"));
    const ticks = /** @type {any[]} */ (shim.app.usage.list(10)).filter((/** @type {any} */ r) => (r.changes || []).some((/** @type {string} */ c) => c.startsWith("memory: a loop's own tick")));
    assert.ok(ticks.length >= 1);
    for (const t of ticks) {
      assert.ok(t.changes.includes("memory: tools not offered — brain-none at m takes no tools (its row on the Upstreams page says so)"), t.changes.join("\n"));
      assert.ok(t.changes.includes("memory: a loop's own tick — the developer's request already did memory's work; nothing of memory's own is added or recorded"), t.changes.join("\n"));
    }
  });

  // (fails before: no — a model that takes tools was always given them; this guards that it still is)
  test("a model that takes them, in the next session, has its tools again (OC-26)", async () => {
    await turnOn("agent/brain-ok");
    assert.ok(Array.isArray(bodies[0].tools) && bodies[0].tools.some((/** @type {any} */ t) => t.name === "read"));
    assert.ok(!systemOf(bodies[0]).includes(NO_TOOLS_LINE));
  });

  // (fails before: yes — the owner's of 11-09, D6: the head after a summary told a model that takes no tools to call
  // filament_recall, which it is never offered)
  test("after a summary, the turns' recall is said to a model that takes tools, never to one that takes none", async () => {
    /** The first request of the turn after a summary of two turns, on a fresh session. @param {string} model */
    const afterSummary = async (model) => {
      const { id } = await turnOn(model);
      const path = `/api/sessions/${encodeURIComponent(id)}`;
      const second = await shim.api(`${path}/turns`, { method: "POST", body: { content: `Then ${"the words around them ".repeat(400)}`, stream: false } });
      assert.equal(second.status, 200, await second.clone().text());
      const made = await shim.api(`${path}/compact`, { method: "POST", body: { method: "summary" } });
      assert.equal(made.status, 200, await made.clone().text());
      // The preview of the next request says what it will send.
      const pv = await (await shim.api(`${path}/compose?dry=1&prompt=1&text=next`)).json();
      const previewed = JSON.stringify(pv.current.prompt.messages[0]);
      bodies = [];
      const r = await shim.api(`${path}/turns`, { method: "POST", body: { content: "After the summary", stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      return { sent: JSON.stringify(bodies[0].messages[0]), previewed };
    };
    const none = await afterSummary("agent/brain-none");
    assert.match(none.sent, /compacted turns 1–2 into the summary below/, none.sent.slice(0, 400));
    assert.doesNotMatch(none.sent, /filament_recall/);
    assert.match(none.previewed, /compacted turns 1–2 into the summary below/);
    assert.doesNotMatch(none.previewed, /filament_recall/, "the preview as the turn sends it");
    const ok = await afterSummary("agent/brain-ok");
    for (const said of [ok.sent, ok.previewed]) assert.match(said, /Any of turns 1–2 comes back word for word with filament_recall\(\{ turn: n \}\)/);
  });
});

describe("a client's request through Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let s;
  before(async () => {
    up = await fakeUpstream(() => undefined);
    s = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.memory.autopilot = { enabled: true, tools: true, cue: false, rewrite: false };
        cfg.upstreams = [{ id: "local", name: "local", type: "openai-compatible", baseUrl: up.url, apiKey: "x", wireApi: "chat-completions", pricing: { "chat-only": { tools: false } } }];
        cfg.routes = [{ match: "*", upstream: "local", upstreamModel: "{model}" }];
      },
    });
  });
  after(async () => {
    await s?.stop();
    await up?.close();
  });
  const sent = () => up.received.filter((c) => c.kind === "openai").map((c) => c.body);
  const lastRecord = () => /** @type {any} */ (s.app.usage.list(1)[0]);
  const memoryTools = (/** @type {any} */ b) => (b?.tools || []).filter((/** @type {any} */ t) => /^filament_memory_/.test(t.function?.name || t.name || ""));

  // (fails before: yes — memory's tools went on, and a model that takes none refused the request for them)
  test("with no tools of its own: memory offers none, and says who said the model takes none (OC-27)", async () => {
    up.reset();
    const r = await s.post("/v1/chat/completions", { model: "chat-only", messages: [{ role: "user", content: "hello there" }] });
    assert.equal(r.status, 200);
    assert.deepEqual(memoryTools(sent()[0]), []);
    const rec = lastRecord();
    assert.ok(rec.changes.some((/** @type {string} */ c) => c === "memory: tools not offered — chat-only at local takes no tools (its row on the Upstreams page says so)"), rec.changes.join("\n"));
  });

  // (fails before: yes — the record said nothing, so the refusal that followed was unexplained)
  test("with tools of its own: they go as the client sent them, and the record says the model is marked (OC-28)", async () => {
    up.reset();
    const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }];
    const r = await s.post("/v1/chat/completions", { model: "chat-only", messages: [{ role: "user", content: "look it up" }], tools });
    assert.equal(r.status, 200);
    assert.deepEqual(sent()[0].tools?.map((/** @type {any} */ t) => t.function?.name), ["lookup"]);
    const rec = lastRecord();
    assert.ok(rec.changes.some((/** @type {string} */ c) => c === "tools: chat-only at local takes no tools (its row on the Upstreams page says so); the client's own tools are sent as it sent them"), rec.changes.join("\n"));
  });
});
