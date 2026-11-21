// @ts-check
// The payload Filament's anonymous telemetry sends (the owner's launch decisions, 11-10): only values picked from a
// fixed list or of a strict form go out. An upstream is its provider's kind or "custom", a coding agent the catalogue's
// or "other-agent", a model a key of the built-in price table, a public model's name where its maker alone names
// models, or "custom"; DO_NOT_TRACK and FILAMENT_TELEMETRY turn it
// off. The leak tests hand the builder a day full of what must never leave the machine — custom upstream ids and names,
// their addresses and hosts, fine-tune names, the model names as asked, unknown agents' commands, titles in fields
// nothing names — and find none of it in what it builds.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  TELEMETRY_EVENTS,
  PROVIDER_KINDS,
  AGENT_KINDS,
  ENGINE_KINDS,
  MODEL_KEYS,
  MODEL_FORM,
  OS_KINDS,
  ARCH_KINDS,
  INSTALL_KINDS,
  FEATURE_SWITCHES,
  FEATURE_COUNTS,
  offByEnv,
  whyOff,
  agentKind,
  upstreamKind,
  modelKey,
  publicModel,
  contextOf,
  appOpened,
  dailySummary,
} from "../src/core/telemetry-payload.js";

const ENV = { version: "0.9.71", platform: "win32", arch: "x64", install: "desktop", locale: "en-US", timeZone: "Asia/Karachi" };
const hours = (/** @type {Record<number, number>} */ at) => Array.from({ length: 24 }, (_, h) => at[h] || 0);
/** A usage row as services/daily-usage.js `list()` gives one: its sums, derived numbers and what was asked. */
const row = (/** @type {Record<string, any>} */ o) => ({
  requests: 0, ok: 0, errors: 0, aborted: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0,
  cost: 0, costN: 0, listCost: 0, listCostN: 0, planListCost: 0, tpsSum: 0, tpsN: 0, ttftSum: 0, ttftN: 0, msSum: 0, estimated: 0,
  cacheHitRate: 0, avgTps: null, avgTtftMs: null, avgMs: null, totalTokens: 0, asked: [],
  ...o,
});

describe("telemetry: off by the environment or the setting", () => {
  test("DO_NOT_TRACK set to anything but an off word, or FILAMENT_TELEMETRY set to one, turns it off", () => {
    assert.equal(offByEnv({}), null);
    assert.equal(offByEnv(null), null);
    for (const v of ["1", "true", "yes", " 1 "]) assert.equal(offByEnv({ DO_NOT_TRACK: v }), "DO_NOT_TRACK", `DO_NOT_TRACK=${v}`);
    for (const v of ["", "0", "false", "off", "no"]) assert.equal(offByEnv({ DO_NOT_TRACK: v }), null, `DO_NOT_TRACK=${v}`);
    for (const v of ["0", "false", "FALSE", "off", "no"]) assert.equal(offByEnv({ FILAMENT_TELEMETRY: v }), "FILAMENT_TELEMETRY", `FILAMENT_TELEMETRY=${v}`);
    for (const v of ["", "1", "true", "on"]) assert.equal(offByEnv({ FILAMENT_TELEMETRY: v }), null, `FILAMENT_TELEMETRY=${v}`);
    assert.equal(offByEnv({ DO_NOT_TRACK: "1", FILAMENT_TELEMETRY: "0" }), "DO_NOT_TRACK", "DO_NOT_TRACK is named first");
  });
  test("on by default; the setting's off stands, and the environment cannot turn it back on", () => {
    assert.equal(whyOff({}, {}), null);
    assert.equal(whyOff({ telemetry: { enabled: true } }, {}), null);
    assert.equal(whyOff({ telemetry: { enabled: false } }, {}), "setting");
    assert.equal(whyOff({ telemetry: { enabled: false } }, { FILAMENT_TELEMETRY: "1" }), "setting");
    assert.equal(whyOff({ telemetry: { enabled: true } }, { DO_NOT_TRACK: "1" }), "DO_NOT_TRACK");
    assert.equal(whyOff({ telemetry: { enabled: false } }, { FILAMENT_TELEMETRY: "off" }), "FILAMENT_TELEMETRY");
  });
});

describe("telemetry: kinds from fixed lists", () => {
  test("an upstream is its catalogue provider by its address, else custom; an agent, a machine, Qoder's cloud or a gone one by kind", () => {
    assert.equal(upstreamKind({ id: "my-glm", type: "openai-compatible", baseUrl: "https://api.z.ai/api/coding/paas/v4/" }), "zai");
    assert.equal(upstreamKind({ id: "x", type: "openai-compatible", baseUrl: "https://ws-12ab.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" }), "dashscope");
    assert.equal(upstreamKind({ id: "anthropic", type: "anthropic", baseUrl: "" }), "anthropic", "its type's own address where it names none");
    assert.equal(upstreamKind({ id: "openai", type: "openai" }), "openai");
    assert.equal(upstreamKind({ id: "ollama", type: "openai-compatible", baseUrl: "http://localhost:11434/v1" }), "ollama");
    assert.equal(upstreamKind({ id: "gw", type: "openai-compatible", baseUrl: "https://llm.corp.example/v1" }), "custom");
    assert.equal(upstreamKind({ id: "gw", type: "anthropic", baseUrl: "https://proxy.corp.example" }), "custom", "a known type at an address the catalogue does not know");
    assert.equal(upstreamKind({ id: "gw", type: "openai-compatible" }), "custom");
    assert.equal(upstreamKind({ id: "gw", type: "something-new", baseUrl: "https://api.openai.com" }), "custom");
    assert.equal(upstreamKind({ id: "claude-code", type: "acp", acp: { command: "claude-agent-acp" } }), "agent");
    assert.equal(upstreamKind({ id: "codex", type: "codex" }), "agent");
    assert.equal(upstreamKind({ id: "laptop", type: "filament" }), "machine");
    assert.equal(upstreamKind({ id: "qoder-cloud-1", type: "qoder" }), "qoder-cloud");
    assert.equal(upstreamKind(null), "unknown");
    for (const u of [{ type: "openai-compatible", baseUrl: "https://api.x.ai/v1" }, { type: "acp" }, { type: "filament" }, null])
      assert.ok(PROVIDER_KINDS.includes(upstreamKind(u)));
  });
  test("a coding agent is the catalogue's by its id or command, else other-agent; an API upstream is none", () => {
    assert.equal(agentKind({ id: "claude-code", type: "acp", acp: { command: "claude-agent-acp" } }), "claude-code");
    assert.equal(agentKind({ id: "claude-work", type: "acp", acp: { command: "C:\\Users\\x\\AppData\\Roaming\\npm\\claude-agent-acp.cmd" } }), "claude-code", "a second login of a known agent");
    assert.equal(agentKind({ id: "codex-2", type: "codex", acp: { command: "codex" } }), "codex");
    assert.equal(agentKind({ id: "cursor-sdk", type: "cursor-sdk" }), "cursor-sdk", "Cursor's SDK apart from its CLI");
    assert.equal(agentKind({ id: "cursor", type: "acp", acp: { command: "agent" } }), "cursor");
    assert.equal(agentKind({ id: "qoder-cn", type: "acp", acp: { command: "qodercli" } }), "qoder-cn");
    assert.equal(agentKind({ id: "mine", type: "acp", acp: { command: "/opt/tools/my-own-agent" } }), "other-agent");
    assert.equal(agentKind({ id: "mine", type: "acp" }), "cursor", "no command runs `agent`, Cursor's CLI, as agentKey reads it");
    assert.equal(agentKind({ id: "openai", type: "openai" }), null);
    assert.equal(agentKind(null), null);
    assert.deepEqual([...AGENT_KINDS].sort(), ["antigravity-acp", "claude-code", "codex", "cursor", "cursor-sdk", "other-agent", "qoder", "qoder-cn"]);
  });
  test("a model is a built-in price-table key by the longest prefix, else custom", () => {
    assert.equal(modelKey("claude-opus-4-8"), "claude-opus-4-8");
    assert.equal(modelKey("claude-opus-4-8-20260115"), "claude-opus-4-8", "a dated name");
    assert.equal(modelKey("anthropic/claude-opus-5-5"), "claude-opus-5-5", "the longer key over claude-opus-5");
    assert.equal(modelKey("claude-opus-5"), "claude-opus-5");
    assert.equal(modelKey("Grok-4.6-fast"), "grok-4.6", "a key spelled with a dot, matched as pricing normalises it");
    assert.equal(modelKey("ft:gpt-4o-2024-08-06:some-org:proj:abc123"), "custom");
    assert.equal(modelKey("ft:claude-opus-4-8:some-org"), "custom");
    assert.equal(modelKey("llama3.1:8b"), "custom");
    assert.equal(modelKey("opus[1m]"), "custom");
    assert.equal(modelKey(""), "custom");
    assert.equal(modelKey(null), "custom");
    assert.equal(modelKey("?"), "custom");
    for (const m of ["claude-sonnet-5-preview", "grok-build-2", "gpt-5"]) assert.ok(MODEL_KEYS.includes(modelKey(m)));
  });
  // (fails before: yes — every model but the price table's 16, GPT's, Gemini's and Kimi's among them, went out as custom)
  test("a public model is named where its maker alone names models: a catalogue provider's or a known coding agent's", () => {
    assert.equal(modelKey("gpt-5.1", { provider: "openai" }), "gpt-5.1");
    assert.equal(modelKey("gpt-5.1-2025-11-13", { provider: "openai" }), "gpt-5.1", "its date taken off");
    assert.equal(modelKey("o4-mini", { provider: "openai" }), "o4-mini");
    assert.equal(modelKey("models/gemini-3-pro-preview", { provider: "gemini" }), "gemini-3-pro-preview", "Gemini's listing spells models/…");
    assert.equal(modelKey("kimi-k3", { provider: "kimi" }), "kimi-k3");
    assert.equal(modelKey("deepseek-chat", { provider: "deepseek" }), "deepseek-chat");
    assert.equal(modelKey("glm-5", { provider: "zai" }), "glm-5");
    assert.equal(modelKey("llama-3.3-70b-versatile", { provider: "groq" }), "llama-3.3-70b-versatile");
    assert.equal(modelKey("openai/gpt-5.1", { provider: "openrouter" }), "gpt-5.1", "under a vendor an aggregator names");
    assert.equal(modelKey("accounts/fireworks/models/qwen3-coder-480b", { provider: "fireworks" }), "qwen3-coder-480b");
    assert.equal(modelKey("gpt-5.1-codex-max", { provider: "agent", agent: "codex" }), "gpt-5.1-codex-max");
    assert.equal(modelKey("opus[1m]", { provider: "agent", agent: "claude-code" }), "opus", "Claude Code's alias, its window taken off");
    assert.equal(modelKey("claude-opus-5-5", { provider: "custom" }), "claude-opus-5-5", "a price-table key goes as it did, wherever it ran");
  });
  test("a model's own name never goes out where a person may have named it", () => {
    for (const provider of ["custom", "machine", "unknown", "ollama", "lmstudio", "qoder-cloud", null])
      for (const m of ["gpt-5.1", "kimi-k3", "llama3.1"]) assert.equal(modelKey(m, { provider }), "custom", `${m} on ${provider}`);
    assert.equal(modelKey("gpt-5.1", { provider: "agent", agent: "other-agent" }), "custom", "an agent Filament does not know");
    assert.equal(modelKey("gpt-5.1"), "custom", "nothing said of where it ran");
    const on = { provider: "openai" };
    assert.equal(modelKey("ft:gpt-4o-2024-08-06:some-org:proj:abc123", on), "custom", "a fine-tune");
    assert.equal(modelKey("acme-corp/gpt-5-legal", { provider: "openrouter" }), "custom", "under someone's own name");
    assert.equal(modelKey("accounts/acme/models/llama-v3-acme", { provider: "fireworks" }), "custom", "a Fireworks account's own");
    assert.equal(modelKey("tunedModels/zeta-support", { provider: "gemini" }), "custom");
    assert.equal(modelKey("qwen3:8b", { provider: "dashscope" }), "custom", "a tag");
    assert.equal(modelKey("default", { provider: "agent", agent: "claude-code" }), "custom", "no family");
    assert.equal(modelKey("my-own-model", on), "custom");
    assert.equal(modelKey(`gpt-${"5".repeat(60)}`, on), "custom", "too long");
    assert.equal(modelKey("gpt-5 turbo", on), "custom", "not of its form");
    assert.equal(publicModel("GPT-5.1"), "gpt-5.1");
    assert.ok(MODEL_FORM.test(publicModel("deepseek/deepseek-v4")));
  });
  test("the machine and the build: known values pass, anything else is other", () => {
    assert.deepEqual(contextOf(ENV), { version: "0.9.71", os: "win32", arch: "x64", install: "desktop", language: "en-US", timezone: "Asia/Karachi" });
    assert.deepEqual(contextOf({ version: "1.2.3-beta.1", platform: "darwin", arch: "arm64", install: "server", locale: "pt-BR-u-ca-gregory", timeZone: "America/Argentina/Buenos_Aires" }), {
      version: "1.2.3-beta.1", os: "darwin", arch: "arm64", install: "server", language: "pt-BR", timezone: "America/Argentina/Buenos_Aires",
    });
    assert.deepEqual(contextOf({ version: "0.9.71 build on host-7", platform: "freebsd", arch: "ia32", install: "systemd", locale: "someone", timeZone: "/usr/share/zoneinfo/Asia/Karachi" }), {
      version: "other", os: "other", arch: "other", install: "other", language: "other", timezone: "other",
    });
    assert.deepEqual(contextOf(null), { version: "other", os: "other", arch: "other", install: "other", language: "other", timezone: "other" });
    assert.equal(contextOf({ locale: "de" }).language, "de");
    assert.equal(contextOf({ locale: "en-x-private" }).language, "en", "a private-use tag is dropped");
    assert.equal(contextOf({ timeZone: "UTC" }).timezone, "UTC");
    assert.equal(contextOf({ timeZone: "Not/AZone" }).timezone, "other", "a name the clock does not know");
  });
});

describe("telemetry: the events", () => {
  test("app opened carries the machine and the build alone", () => {
    assert.deepEqual(appOpened(ENV), { event: TELEMETRY_EVENTS.opened, properties: contextOf(ENV) });
    assert.equal(TELEMETRY_EVENTS.opened, "app opened");
  });
  test("the daily summary: totals, hours, rows added by kind and model, runs by engine, accounts by kind, features", () => {
    const upstreams = [
      { id: "anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com", enabled: true },
      { id: "gw-a", type: "openai-compatible", baseUrl: "https://a.corp.example/v1", enabled: true },
      { id: "gw-b", type: "anthropic-compatible", baseUrl: "https://b.corp.example", enabled: true },
      { id: "claude-code", type: "acp", acp: { command: "claude-agent-acp" }, enabled: true },
      { id: "old", type: "openai", enabled: false },
    ];
    const usage = {
      day: "2026-11-09", requests: 9, ok: 7, errors: 1, aborted: 1, input: 900, cacheRead: 90, cacheWrite: 9, output: 450, thinking: 45,
      cost: 1.5, listCost: 3.25, planListCost: 1.75, tpsSum: 120, tpsN: 3, ttftSum: 1500, ttftN: 3,
      hours: hours({ 9: 4, 14: 5 }),
      rows: [
        row({ upstream: "anthropic", model: "claude-opus-4-8", requests: 3, ok: 3, input: 300, output: 150, cost: 1.5, listCost: 1.5, tpsSum: 90, tpsN: 2, ttftSum: 1000, ttftN: 2 }),
        row({ upstream: "gw-a", model: "some-local-model", requests: 2, ok: 1, errors: 1, input: 200, output: 100 }),
        row({ upstream: "gw-b", model: "another-local-model", requests: 1, ok: 1, input: 100, output: 50 }),
        row({ upstream: "claude-code", model: "opus[1m]", requests: 2, ok: 1, aborted: 1, input: 200, output: 100, listCost: 1.75, planListCost: 1.75, tpsSum: 30, tpsN: 1 }),
        row({ upstream: "deleted", model: "claude-haiku-4-5", requests: 1, ok: 1, input: 100, output: 50 }),
      ],
    };
    const runs = [{ upstream: null, n: 4 }, { upstream: "anthropic", sub: true, n: 2 }, { upstream: "claude-code", n: 3 }, { upstream: "claude-code", sub: true }, { upstream: "deleted", n: 1 }];
    const features = { memory: true, lan: false, tailscale: "yes", graphChats: 2, artifacts: 5.4, spaces: -1, machines: 1, devices: "3" };
    const { event, properties: p } = dailySummary({ day: "2026-11-09", usage, upstreams, runs, features }, ENV);
    assert.equal(event, "daily summary");
    assert.equal(p.day, "2026-11-09");
    assert.equal(p.version, "0.9.71");
    assert.deepEqual(p.totals, {
      requests: 9, ok: 7, errors: 1, aborted: 1, input: 900, cacheRead: 90, cacheWrite: 9, output: 450, thinking: 45,
      cost: 1.5, listCost: 3.25, planListCost: 1.75, tps: 40, ttftMs: 500,
    });
    assert.deepEqual(p.hours, hours({ 9: 4, 14: 5 }));
    const zero = { cacheRead: 0, cacheWrite: 0, thinking: 0, cost: 0, listCost: 0, planListCost: 0 };
    assert.deepEqual(p.rows, [
      { provider: "anthropic", model: "claude-opus-4-8", requests: 3, ok: 3, errors: 0, aborted: 0, input: 300, output: 150, ...zero, cost: 1.5, listCost: 1.5, tps: 45, ttftMs: 500 },
      { provider: "custom", model: "custom", requests: 3, ok: 2, errors: 1, aborted: 0, input: 300, output: 150, ...zero, tps: null, ttftMs: null },
      // Claude Code's alias by its name, its window taken off (publicModel)
      { provider: "agent", agent: "claude-code", model: "opus", requests: 2, ok: 1, errors: 0, aborted: 1, input: 200, output: 100, ...zero, listCost: 1.75, planListCost: 1.75, tps: 30, ttftMs: null },
      { provider: "unknown", model: "claude-haiku-4-5", requests: 1, ok: 1, errors: 0, aborted: 0, input: 100, output: 50, ...zero, tps: null, ttftMs: null },
    ], "two custom gateways' rows come to one, the most requests first");
    assert.deepEqual(p.runs, { filament: 6, "claude-code": 4, unknown: 1 }, "a run on an API upstream is Filament's loop; one with no n counts one");
    assert.deepEqual(p.accounts, { providers: { anthropic: 1, custom: 2 }, agents: { "claude-code": 1 } }, "a switched-off upstream is no account");
    assert.deepEqual(p.features, { memory: true, lan: false, graphChats: 2, artifacts: 5, spaces: 0, machines: 1, devices: 3, subagents: 3 });
  });
  test("a day with no usage, no upstreams and nothing else still says what it is, in zeros", () => {
    const { properties: p } = dailySummary({ day: "not a day" }, ENV);
    assert.equal(p.day, null);
    assert.deepEqual(p.hours, new Array(24).fill(0));
    assert.deepEqual(p.rows, []);
    assert.deepEqual(p.runs, {});
    assert.deepEqual(p.accounts, { providers: {}, agents: {} });
    assert.deepEqual(p.features, { subagents: 0 });
    assert.equal(p.totals.requests, 0);
    assert.equal(p.totals.tps, null);
  });
  test("a number that is no count is 0, never what was written", () => {
    const usage = { requests: "12 from host-7", input: -5, output: Infinity, cost: "NaN", hours: ["x", -1, 3.6, ...new Array(21).fill(0)], rows: [row({ upstream: "a", model: "m", requests: "lots", cost: -2 })] };
    const { properties: p } = dailySummary({ day: "2026-11-09", usage, upstreams: [{ id: "a", type: "openai" }] }, ENV);
    assert.equal(p.totals.requests, 0);
    assert.equal(p.totals.input, 0);
    assert.equal(p.totals.output, 0);
    assert.equal(p.totals.cost, 0);
    assert.deepEqual(p.hours.slice(0, 3), [0, 0, 4]);
    assert.equal(p.rows[0].requests, 0);
    assert.equal(p.rows[0].cost, 0);
  });
});

// What must never leave the machine, each in the place the service would hand it over.
const SECRET = {
  upstreamIds: ["zeta-internal-gw", "kestrel-proxy", "laptop-of-someone", "gone-upstream-77"],
  upstreamNames: ["Zeta Internal Gateway", "Kestrel Proxy"],
  baseUrls: ["https://llm.zeta-internal.example/v1", "http://10.20.30.40:8080/v1", "https://kestrel.corp.example"],
  hostnames: ["llm.zeta-internal.example", "10.20.30.40", "kestrel.corp.example"],
  ftModels: ["ft:gpt-4o-2024-08-06:zeta-corp:payments:9xYz", "ft:claude-opus-4-8:zeta-corp"],
  models: ["qwen-zeta-private-70b"],
  asked: ["zeta/route-alias", "kestrel-best", "claude-opus-4-8-but-secretly-mine"],
  agentCommands: ["C:\\Users\\someone\\tools\\falcon-agent.exe", "/home/someone/bin/osprey-agent"],
  agentNames: ["Falcon (my agent)", "Osprey"],
  typed: ["Fix the zeta login bug", "zeta/payments", "C:\\work\\zeta", "sk-ant-api03-SECRET"],
};
function leakyDay() {
  const upstreams = [
    { id: "zeta-internal-gw", name: "Zeta Internal Gateway", type: "openai-compatible", baseUrl: SECRET.baseUrls[0], apiKey: "sk-ant-api03-SECRET", enabled: true },
    { id: "kestrel-proxy", name: "Kestrel Proxy", type: "anthropic", baseUrl: SECRET.baseUrls[2], enabled: true },
    { id: "lan-box", type: "openai-compatible", baseUrl: SECRET.baseUrls[1], enabled: true },
    { id: "falcon", name: "Falcon (my agent)", type: "acp", acp: { command: SECRET.agentCommands[0], args: ["--repo", "C:\\work\\zeta"] }, enabled: true },
    { id: "osprey", name: "Osprey", type: "acp", acp: { command: SECRET.agentCommands[1] }, enabled: true },
    { id: "laptop-of-someone", type: "filament", machine: "laptop-of-someone", enabled: true },
  ];
  const usage = {
    requests: 7, hours: hours({ 3: 7 }), title: "Fix the zeta login bug",
    rows: [
      row({ upstream: "zeta-internal-gw", model: SECRET.ftModels[0], requests: 2, asked: [{ name: "zeta/route-alias", n: 2 }] }),
      row({ upstream: "kestrel-proxy", model: SECRET.ftModels[1], requests: 1, asked: [{ name: "kestrel-best", n: 1 }] }),
      row({ upstream: "lan-box", model: "qwen-zeta-private-70b", requests: 1, purpose: "zeta/payments", asked: [{ name: "qwen-zeta-private-70b", n: 1 }] }),
      row({ upstream: "falcon", model: "claude-opus-4-8", requests: 1, asked: [{ name: "claude-opus-4-8-but-secretly-mine", n: 1 }] }),
      row({ upstream: "gone-upstream-77", model: "kestrel-best", requests: 1, error: "connect ECONNREFUSED 10.20.30.40:8080 (llm.zeta-internal.example)" }),
      row({ upstream: "laptop-of-someone", model: "Osprey", requests: 1 }),
    ],
  };
  const runs = [
    { upstream: "falcon", n: 2, title: "Fix the zeta login bug" },
    { upstream: "osprey", sub: true, n: 1, root: "C:\\work\\zeta" },
    { upstream: "gone-upstream-77", n: 1 },
    { upstream: "zeta-internal-gw", n: 1 },
  ];
  const features = { memory: true, chatTitle: "Fix the zeta login bug", repo: "zeta/payments", folder: "C:\\work\\zeta", artifacts: 1 };
  return { day: "2026-11-09", usage, upstreams, runs, features, apiKey: "sk-ant-api03-SECRET" };
}
const LEAKY_ENV = { version: "0.9.71 on llm.zeta-internal.example", platform: "win32", arch: "x64", install: "desktop", locale: "en-US-x-someone", timeZone: "C:\\work\\zeta" };

/** Every string in a value, its keys too, with where it stands. @param {unknown} v @param {string} at @returns {[string, string][]} */
function strings(v, at = "") {
  if (typeof v === "string") return [[at, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${at}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [[`${at}{key}`, k], ...strings(x, `${at}.${k}`)]);
  return [];
}

describe("telemetry: nothing typed on this machine goes out", () => {
  for (const [what, words] of Object.entries(SECRET))
    test(`no ${what} in either event`, () => {
      const text = JSON.stringify([dailySummary(leakyDay(), LEAKY_ENV), appOpened(LEAKY_ENV)]).toLowerCase();
      for (const w of words) assert.ok(!text.includes(w.toLowerCase()), `${JSON.stringify(w)} is in the payload`);
      // the words they are made of, as well as the whole
      for (const part of ["zeta", "kestrel", "falcon", "osprey", "someone", "10.20.30.40", "example", "ft:", "secret", "\\\\"])
        assert.ok(!text.includes(part), `${JSON.stringify(part)} is in the payload`);
    });

  test("every key and every string value of both events is one the builder knows", () => {
    const keys = new Set([
      "event", "properties", "version", "os", "arch", "install", "language", "timezone", "day", "totals", "hours", "rows", "runs",
      "accounts", "providers", "agents", "features", "provider", "agent", "model", "requests", "ok", "errors", "aborted", "input",
      "cacheRead", "cacheWrite", "output", "thinking", "cost", "listCost", "planListCost", "tps", "ttftMs", "subagents",
      ...FEATURE_SWITCHES, ...FEATURE_COUNTS, ...ENGINE_KINDS, ...PROVIDER_KINDS, ...AGENT_KINDS,
    ]);
    const values = new Set([
      ...Object.values(TELEMETRY_EVENTS), ...PROVIDER_KINDS, ...AGENT_KINDS, ...ENGINE_KINDS, ...MODEL_KEYS, ...OS_KINDS, ...ARCH_KINDS, ...INSTALL_KINDS,
    ]);
    // the four values of a form rather than a list
    /** @type {Record<string, (s: string) => boolean>} */
    const FORMS = {
      ".properties.day": (s) => /^\d{4}-\d{2}-\d{2}$/.test(s),
      ".properties.version": (s) => s === "other" || /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(s),
      ".properties.language": (s) => s === "other" || /^[a-z]{2,3}(?:-(?:[A-Z]{2}|\d{3}))?$/.test(s),
      ".properties.timezone": (s) => s === "other" || s === "UTC" || Intl.supportedValuesOf("timeZone").includes(s),
    };
    const built = dailySummary(leakyDay(), LEAKY_ENV);
    for (const env of [LEAKY_ENV, ENV]) {
      const found = [...strings(dailySummary(leakyDay(), env)), ...strings(appOpened(env))];
      assert.ok(found.length > 40, "the events are read whole");
      for (const [at, s] of found) {
        if (at.endsWith("{key}")) assert.ok(keys.has(s), `an unknown key ${JSON.stringify(s)} at ${at}`);
        else if (FORMS[at]) assert.ok(FORMS[at](s), `${JSON.stringify(s)} at ${at} is not of its form`);
        // a model: a key of the list, or a public model's name, of its form
        else if (/^\.properties\.rows\[\d+\]\.model$/.test(at)) assert.ok(MODEL_KEYS.includes(s) || MODEL_FORM.test(s), `${JSON.stringify(s)} at ${at} is no model's`);
        else assert.ok(values.has(s), `an unknown value ${JSON.stringify(s)} at ${at}`);
      }
    }
    // the leaky day's own: its gateways are custom, its agents other-agent, its models custom or a built-in key
    const p = built.properties;
    assert.equal(p.version, "other");
    assert.equal(p.language, "en-US");
    assert.equal(p.timezone, "other");
    assert.deepEqual(p.accounts, { providers: { custom: 3, machine: 1 }, agents: { "other-agent": 2 } });
    assert.deepEqual(p.runs, { "other-agent": 3, unknown: 1, filament: 1 });
    assert.deepEqual(p.features, { memory: true, artifacts: 1, subagents: 1 });
    assert.deepEqual(new Set(p.rows.map((/** @type {any} */ r) => r.model)), new Set(["custom", "claude-opus-4-8"]));
  });
});
