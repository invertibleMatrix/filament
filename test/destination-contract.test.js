// @ts-check
// The `Destination` port (core/ports.js), one contract run over all five implementations against the fakes the
// suite already has: the fake upstream server (HTTP provider), a fake `fetch` (Qoder), the fake ACP agent (ACP), the
// fake app-server (Codex), the fake Cursor SDK (Cursor SDK). What every destination promises: its identity, exactly
// one of the two capabilities, a model list, a connection test; what an answerer promises on top: a response with a
// body and a cleanup for a shaped request, and a sentence plus a retry rule for a connection failure.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { httpDestination } from "../src/adapters/providers/http.js";
import { qoderDestination } from "../src/adapters/providers/qoder.js";
import { acpDestination, codexDestination, cursorDestination } from "../src/adapters/agents/destinations.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { fakeUpstream, FAKE_ACP_AGENT, FIXTURES } from "./helpers/app.js";

/** @typedef {import("../src/core/ports.js").Destination} Destination */

const FAKE_SDK = join(FIXTURES, "fake-cursor-sdk.mjs");
const FAKE_CODEX = join(FIXTURES, "fake-codex-app-server.mjs");
const quiet = () => {};

/** The assertions every destination has to pass. */
async function contract(/** @type {Destination} */ dest, /** @type {{ id: string, type: string }} */ expect) {
  assert.equal(dest.id, expect.id);
  assert.equal(dest.type, expect.type);
  assert.ok(typeof dest.label === "string" && dest.label, "a label a sentence can use");
  assert.ok(dest.transport === null || typeof dest.transport === "string");
  assert.ok((dest.agent && !dest.answers) || (!dest.agent && dest.answers), "exactly one capability");
  const models = await dest.listModels({ force: true });
  assert.ok(Array.isArray(models.names) && models.names.every((n) => typeof n === "string"));
  assert.ok(typeof models.source === "string" && models.source);
  const t = await dest.test();
  assert.equal(typeof t.ok, "boolean");
  assert.ok(t.ok, `test() failed: ${t.error}`);
  assert.equal(t.status, 200);
  assert.equal(typeof t.ms, "number");
  return { models, t };
}

/** What a destination that answers requests promises beyond the shared contract. */
async function answererContract(/** @type {Destination} */ dest, /** @type {any} */ req) {
  const answers = dest.answers;
  assert.ok(answers);
  const opened = await answers.open(req);
  assert.equal(typeof opened.cleanup, "function");
  assert.equal(opened.res.status, 200);
  assert.ok(opened.res.body, "a body to read");
  const text = await opened.res.text();
  assert.ok(text.length > 0);
  opened.cleanup();
  const failure = answers.unreachable(
    Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
  );
  assert.ok(typeof failure.message === "string" && failure.message.length > 0);
  assert.equal(typeof failure.retryable, "boolean");
  return { failure, text };
}

/** What a destination that runs turns promises: the bridge surface the application calls. */
function agentContract(/** @type {Destination} */ dest) {
  const bridge = dest.agent;
  assert.ok(bridge);
  for (const m of [
    "run",
    "turnForRequest",
    "resume",
    "interrupt",
    "drain",
    "detach",
    "attach",
    "peekByRequest",
    "forgetByRequest",
    "listSessions",
    "listModels",
    "offer",
    "processInfo",
    "test",
  ])
    assert.equal(typeof (/** @type {any} */ (bridge)[m]), "function", `agent bridge has ${m}()`);
  assert.ok(dest.transport, "an agent destination names its transport for the record");
}

describe("Destination contract: the HTTP provider", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let fake;
  before(async () => {
    fake = await fakeUpstream();
  });
  after(() => fake.close());

  test("identity, one capability, models, test, open, unreachable", async () => {
    const upstream = {
      id: "prov",
      type: "anthropic",
      baseUrl: fake.url,
      apiKey: "sk-test",
      models: ["manual-m"],
    };
    const dest = httpDestination(upstream);
    const { models } = await contract(dest, { id: "prov", type: "anthropic" });
    assert.deepEqual(models.names, ["fake-model-a", "fake-model-b", "manual-m"]);
    assert.equal(models.source, "discovered");
    assert.equal(dest.transport, null);
    const { failure } = await answererContract(dest, {
      url: `${fake.url}/v1/messages`,
      headers: { "content-type": "application/json" },
      bodyString: JSON.stringify({ model: "fake-model-a", messages: [{ role: "user", content: "hi" }] }),
      body: { model: "fake-model-a", messages: [{ role: "user", content: "hi" }] },
      modelId: "fake-model-a",
    });
    assert.equal(failure.message, "upstream prov unreachable: ECONNREFUSED");
    assert.equal(failure.retryable, true);
  });
});

describe("Destination contract: the Qoder cloud", () => {
  const models = {
    chat: [
      { key: "lite", display_name: "Lite", max_input_tokens: 128000, enable: true },
      { key: "off", enable: false },
    ],
  };
  const wrap = (/** @type {any} */ inner) =>
    `data: ${JSON.stringify({ statusCodeValue: 200, body: JSON.stringify(inner) })}\n\n`;
  const sse =
    wrap({
      id: "c1",
      choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }],
    }) +
    wrap({
      id: "c1",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    }) +
    "data: [DONE]\n\n";
  const json = (/** @type {any} */ obj) =>
    new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
  /** @type {string[]} */ const paths = [];
  const fetchImpl = /** @type {typeof fetch} */ (
    async (/** @type {any} */ url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === "/algo/api/v2/model/list") return json(models);
      if (path === "/api/v2/quota/usage") return json({ userQuota: { total: 100, used: 40, remaining: 60 } });
      if (path.endsWith("/agent_chat_generation"))
        return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
      return new Response("not found", { status: 404 });
    }
  );
  const upstream = {
    id: "qc",
    type: "qoder",
    apiKey: "",
    qoder: { authMethod: "device", accessToken: "dt-1", userId: "u1", machineId: "m1", email: "me@x" },
  };

  test("identity, one capability, models, test, open, unreachable", async () => {
    const dest = qoderDestination(upstream, { log: quiet, fetchImpl });
    const { models: m } = await contract(dest, { id: "qc", type: "qoder" });
    assert.deepEqual(m.names, ["lite"], "disabled models are not offered");
    assert.equal(dest.transport, null);
    const body = { model: "lite", messages: [{ role: "user", content: "hi" }], stream: true };
    const { failure, text } = await answererContract(dest, {
      url: "",
      headers: {},
      bodyString: JSON.stringify(body),
      body,
      modelId: "lite",
    });
    assert.ok(text.includes('"content":"hello"'), "the inner OpenAI chunk reaches the reader");
    assert.ok(!text.includes("statusCodeValue"), "Qoder's envelope does not");
    assert.equal(failure.message, "Qoder: fetch failed");
    assert.equal(failure.retryable, true, "a transport failure may be retried on the next candidate");
    assert.equal(
      dest.answers?.unreachable(new Error("Qoder is not logged in")).retryable,
      false,
      "a refused login is not",
    );
    assert.ok(
      paths.some((p) => p.endsWith("/agent_chat_generation")),
      "open() reached the chat endpoint",
    );
  });
});

describe("Destination contract: an ACP agent", () => {
  /** @type {string} */ let dir;
  /** @type {AcpBridge} */ let bridge;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-dest-acp-"));
    bridge = new AcpBridge({ log: quiet });
  });
  after(() => {
    bridge.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  test("identity, one capability, models from the agent, test, the bridge surface", async () => {
    const upstream = {
      id: "fakeacp",
      type: "acp",
      acp: {
        command: process.execPath,
        args: [FAKE_ACP_AGENT],
        env: {},
        cwdDefault: dir,
        permissions: "allow-all",
      },
    };
    const dest = acpDestination(/** @type {any} */ (bridge), upstream);
    const { models } = await contract(dest, { id: "fakeacp", type: "acp" });
    assert.deepEqual(models.names, ["fake-a", "fake-b"], "the models the fake agent offers in session/new");
    assert.equal(dest.label, "ACP agent");
    assert.equal(dest.transport, `acp://${process.execPath}`);
    agentContract(dest);
  });
});

describe("Destination contract: Codex", () => {
  /** @type {string} */ let dir;
  /** @type {CodexBridge} */ let bridge;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-dest-codex-"));
    bridge = new CodexBridge({ log: quiet });
  });
  after(() => {
    bridge.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  test("identity, one capability, models from Codex, test, the bridge surface", async () => {
    const upstream = {
      id: "fakecodex",
      type: "codex",
      acp: { command: process.execPath, args: [FAKE_CODEX], env: {}, cwdDefault: dir, permissions: "allow-all" },
    };
    const dest = codexDestination(/** @type {any} */ (bridge), upstream);
    const { models } = await contract(dest, { id: "fakecodex", type: "codex" });
    assert.deepEqual(models.names.slice(0, 2), ["gpt-6-astra", "gpt-6-astra-low"], "Codex's models, each with its efforts");
    assert.equal(dest.label, "Codex");
    assert.equal(dest.transport, `codex://${process.execPath}`);
    agentContract(dest);
  });
});

describe("Destination contract: the Cursor SDK", () => {
  /** @type {CursorSdkBridge} */ let bridge;
  before(() => {
    // The bridge types its `loader` from the `null` default; the fake SDK is loaded through it.
    bridge = new CursorSdkBridge(
      /** @type {any} */ ({ log: quiet, loader: () => import(pathToFileURL(FAKE_SDK).href) }),
    );
  });
  after(() => bridge.shutdown());

  test("identity, one capability, models from the SDK, test, the bridge surface", async () => {
    const upstream = { id: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: {} };
    const dest = cursorDestination(/** @type {any} */ (bridge), upstream);
    const { models } = await contract(dest, { id: "csdk", type: "cursor-sdk" });
    assert.ok(models.names.length > 0, "the fake SDK lists models");
    assert.equal(dest.label, "Cursor SDK upstream");
    assert.equal(dest.transport, "sdk://cursor");
    agentContract(dest);
  });
});
