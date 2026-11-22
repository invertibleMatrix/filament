// @ts-check
// Shared boot for end-to-end tests: a real Filament in-process, a fake upstream that records what it received and
// answers a script, and the admin calls that tests otherwise re-write by hand. Additive — older test files keep
// their own boot code on purpose (the safety net must not depend on the code it protects).
// The app runs in the test's process: what a coding agent's terminal set there is taken out first (`clean-env.js`).
import "./clean-env.js";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/server.js";
import { houseAuth } from "../../src/services/house.js";
import { removeDirs } from "./wait.js";
import { defaultConfig } from "../../src/config.js";
import { SHELL, POWERSHELL } from "../../src/adapters/tools/shell.js";
import { ENVIRONMENT_VERSION } from "../../src/app/agent/environment.js";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const FAKE_SIDECAR = join(FIXTURES, "fake-sidecar.mjs");
export const FAKE_ACP_AGENT = join(FIXTURES, "fake-acp-agent.mjs");

/**
 * @typedef {object} UpstreamCall  What the fake upstream received: one entry per HTTP request.
 * @property {number} n           1-based call number since the last reset()
 * @property {string} method
 * @property {string} path
 * @property {Record<string, string>} headers
 * @property {any} body           parsed JSON, or the raw text when it is not JSON
 * @property {"anthropic"|"openai"|"responses"|"count"|"embeddings"|"models"|"other"} kind  inferred from the path
 */

/**
 * @typedef {object} UpstreamReply  What the script answers with. Exactly one of json / sse / text / drop.
 * @property {number} [status]
 * @property {Record<string, string>} [headers]
 * @property {any} [json]
 * @property {Array<{event?: string, data: any}|string>} [sse]  events (data objects are JSON-encoded) or raw lines
 * @property {string} [text]
 * @property {boolean} [drop]  the connection closed with no answer: the caller cannot reach the provider
 */

/** @returns {UpstreamCall["kind"]} */
const kindOf = (path) =>
  /\/count_tokens$/.test(path)
    ? "count"
    : /\/messages$/.test(path)
      ? "anthropic"
      : /\/chat\/completions$/.test(path)
        ? "openai"
        : /\/responses$/.test(path)
          ? "responses"
          : /\/embeddings$/.test(path)
            ? "embeddings"
            : /\/models$/.test(path)
              ? "models"
              : "other";

/**
 * A fake provider. `script(call)` returns an UpstreamReply, or nothing for the default answer in the call's format.
 * @param {(call: UpstreamCall) => UpstreamReply | undefined | Promise<UpstreamReply | undefined>} [script]
 */
export async function fakeUpstream(script = () => undefined) {
  /** @type {UpstreamCall[]} */
  const received = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    // One decoder for the whole body: a character whose bytes two chunks split is read whole.
    req.setEncoding("utf8");
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      let body = raw;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {}
      const call = {
        n: ++n,
        method: req.method || "GET",
        path: req.url || "/",
        headers: /** @type {Record<string, string>} */ (req.headers),
        body,
        kind: kindOf((req.url || "").split("?")[0]),
      };
      received.push(call);
      let reply;
      try {
        reply = (await script(call)) || defaultReply(call);
      } catch (e) {
        reply = {
          status: 500,
          json: {
            error: { message: `fake upstream script threw: ${e instanceof Error ? e.message : String(e)}` },
          },
        };
      }
      writeReply(res, reply);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    received,
    reset() {
      received.length = 0;
      n = 0;
    },
    close: () => new Promise((r) => server.close(() => r(undefined))),
  };
}

function writeReply(res, reply) {
  const status = reply.status || 200;
  if (reply.drop) {
    res.socket?.destroy();
    return;
  }
  if (reply.body) {
    // A raw stream body (a scripted SSE with timing): pumped chunk by chunk so tests can stop mid-flight. The
    // reader sits inside the try: a used-up stream object must answer (an error event), never hang the request —
    // a script handing back an already-read stream is a test bug worth failing loudly, not silently wedging.
    res.writeHead(status, {
      "content-type": reply.headers?.["content-type"] || "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      ...(reply.headers || {}),
    });
    (async () => {
      /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
      let reader = null;
      // The client hung up mid-stream (a stop's cut cancels the app-side reader): stop the source too, so the
      // script's stream ends and its `cancelled` state is observable.
      res.on("close", () => {
        if (reader) reader.cancel().catch(() => {});
      });
      try {
        const rd = reply.body.getReader();
        reader = rd;
        for (;;) {
          const { value, done } = await rd.read();
          if (done) break;
          res.write(value);
        }
      } catch (e) {
        res.write(`event: error
data: ${JSON.stringify({ error: { message: `fake upstream stream failed: ${e instanceof Error ? e.message : String(e)}` } })}

`);
      }
      res.end();
    })();
    return;
  }
  if (reply.sse) {
    res.writeHead(status, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      ...(reply.headers || {}),
    });
    for (const ev of reply.sse) {
      if (typeof ev === "string") res.write(ev.endsWith("\n") ? ev : ev + "\n");
      else
        res.write(
          `${ev.event ? `event: ${ev.event}\n` : ""}data: ${typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data)}\n\n`,
        );
    }
    return res.end();
  }
  if (reply.json !== undefined) {
    res.writeHead(status, { "content-type": "application/json", ...(reply.headers || {}) });
    return res.end(JSON.stringify(reply.json));
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...(reply.headers || {}) });
  res.end(reply.text ?? "");
}

/** The reply a call gets when the script has nothing to say: a short answer in the request's own format. */
export function defaultReply(call) {
  const b = call.body || {};
  const stream = b.stream === true;
  switch (call.kind) {
    case "anthropic":
      return stream
        ? anthropicStream("MODEL ANSWER", { model: b.model })
        : anthropicReply("MODEL ANSWER", { model: b.model });
    case "openai":
      return stream
        ? openaiStream("MODEL ANSWER", { model: b.model })
        : openaiReply("MODEL ANSWER", { model: b.model });
    case "responses":
      return {
        json: {
          id: "resp_fake",
          object: "response",
          created_at: 1700000000,
          status: "completed",
          model: b.model,
          output: [
            {
              type: "message",
              id: "msg_fake",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "MODEL ANSWER", annotations: [] }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      };
    case "count":
      return { json: { input_tokens: Math.ceil(JSON.stringify(b.messages || []).length / 4) } };
    case "embeddings":
      return {
        json: {
          object: "list",
          data: (Array.isArray(b.input) ? b.input : [b.input]).map((_, i) => ({
            object: "embedding",
            index: i,
            embedding: [0.1, 0.2, 0.3],
          })),
          model: b.model,
          usage: { prompt_tokens: 4, total_tokens: 4 },
        },
      };
    case "models":
      return {
        json: {
          object: "list",
          data: [
            { id: "fake-model-a", object: "model" },
            { id: "fake-model-b", object: "model" },
          ],
        },
      };
    default:
      return {
        status: 404,
        json: { error: { message: `fake upstream: no handler for ${call.method} ${call.path}` } },
      };
  }
}

const USAGE_A = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 3,
  cache_creation_input_tokens: 2,
};
const USAGE_O = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

/**
 * A non-streaming Anthropic message. `blocks` replaces the single text block (tool_use answers, thinking, …).
 * @param {string} text
 * @param {{ model?: string, usage?: object, stop?: string, blocks?: any[] | null, status?: number }} [opts]
 */
export function anthropicReply(
  text,
  { model = "fake", usage = USAGE_A, stop = "end_turn", blocks = null, status = 200 } = {},
) {
  return {
    status,
    json: {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model,
      content: blocks || [{ type: "text", text }],
      stop_reason: stop,
      stop_sequence: null,
      usage,
    },
  };
}
/** A streaming Anthropic message: the text in two deltas, so a reader sees more than one event. */
export function anthropicStream(text, { model = "fake", usage = USAGE_A, stop = "end_turn" } = {}) {
  const half = Math.ceil(text.length / 2);
  return {
    sse: [
      {
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            id: "msg_fake",
            type: "message",
            role: "assistant",
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: usage.input_tokens,
              output_tokens: 1,
              cache_read_input_tokens: usage.cache_read_input_tokens,
              cache_creation_input_tokens: usage.cache_creation_input_tokens,
            },
          },
        },
      },
      {
        event: "content_block_start",
        data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      },
      {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: text.slice(0, half) },
        },
      },
      {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: text.slice(half) },
        },
      },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: stop, stop_sequence: null },
          usage: { output_tokens: usage.output_tokens },
        },
      },
      { event: "message_stop", data: { type: "message_stop" } },
    ],
  };
}
/**
 * A non-streaming Chat Completions answer.
 * @param {string} text
 * @param {{ model?: string, usage?: object, finish?: string, toolCalls?: any[] | null, status?: number }} [opts]
 */
export function openaiReply(
  text,
  { model = "fake", usage = USAGE_O, finish = "stop", toolCalls = null, status = 200 } = {},
) {
  const message = toolCalls
    ? { role: "assistant", content: text || null, tool_calls: toolCalls }
    : { role: "assistant", content: text };
  return {
    status,
    json: {
      id: "chatcmpl-fake",
      object: "chat.completion",
      created: 1700000000,
      model,
      choices: [{ index: 0, message, finish_reason: finish }],
      usage,
    },
  };
}
/** A streaming Chat Completions answer: role chunk, two content chunks, a finish chunk with usage, [DONE]. */
export function openaiStream(text, { model = "fake", usage = USAGE_O, finish = "stop" } = {}) {
  const half = Math.ceil(text.length / 2);
  /** @param {object} delta @param {string | null} [finish_reason] @param {object} [extra] */
  const chunk = (delta, finish_reason = null, extra = {}) => ({
    data: {
      id: "chatcmpl-fake",
      object: "chat.completion.chunk",
      created: 1700000000,
      model,
      choices: [{ index: 0, delta, finish_reason }],
      ...extra,
    },
  });
  return {
    sse: [
      chunk({ role: "assistant", content: "" }),
      chunk({ content: text.slice(0, half) }),
      chunk({ content: text.slice(half) }),
      chunk({}, finish, { usage }),
      "data: [DONE]\n",
    ],
  };
}

/**
 * The Environment section's facts for a folder, the same on every machine and at every minute (HarnessV3-SystemPrompt
 * SP-D7): the loop's prompt — and every golden that holds its bytes — must not depend on the clock, the PATH or the
 * folder's git state. The real capture is tested on its own (environment.test.js).
 * @param {string} root
 * @returns {Promise<import("../../src/app/agent/environment.js").EnvironmentFacts>}
 */
export const TEST_ENVIRONMENT = async (root) => ({
  v: ENVIRONMENT_VERSION,
  root: String(root || ""),
  clock: { weekday: "Monday", date: "2026-01-05", time: "09:30", zone: "Europe/London", offset: "UTC+00:00" },
  system: { name: "Test OS 1", kernel: "1.0.0", arch: "x64", locale: "en-GB" },
  shell: { kind: SHELL.kind, name: SHELL.name, file: SHELL.file, flavor: null },
  powershell: POWERSHELL ? { ...POWERSHELL } : null,
  path: { on: ["git", "node", "npm"], unixOn: [], unixOff: ["grep", "ls"], wslBash: false, platform: process.platform },
  harness: { command: "node bin/filament.js", listen: null },
  git: { repo: null, error: null },
  project: null,
});

/**
 * A running Filament in a temp data dir. `configure(cfg, { dataDir })` edits the default config before it is written;
 * pass `memory: true` for the archive + the fake engine (no real model, no network); without it memory is off. `dataDir` reuses a dir an
 * earlier instance left behind (a restart test); `keep` makes `stop()` leave the dir for that next instance.
 * `environment` is the capture the loop and the New Task board use: the fixed TEST_ENVIRONMENT by default, null for
 * the machine's real one. `overrides`: more of the app's own (a fake SDK's loader, say); an agent's sign-in is read by
 * a stand-in that can't tell (`signInOf`) unless a test hands in its own, so no agent's real CLI runs; Antigravity's
 * Google sign-in by one that finds none (`agyQuota`), so neither the machine's sign-in nor Google is reached; no Chrome is found
 * on the machine (`findChrome`), so the agent's browser is the app's a test links in, or none. `onShutdown`
 * replaces the process exit a stop asked for over the API ends with (`POST /api/shutdown`): the app has stopped itself
 * by then.
 * `supervisor`: what starts Filament again after a stop, as the tray tells the CLI ("tray"); none by default.
 * @param {{ configure?: (cfg: any, ctx: { dataDir: string }) => void, memory?: boolean, summarizer?: string, key?: string,
 *   dataDir?: string, keep?: boolean, environment?: ((root: string) => Promise<any>) | null,
 *   overrides?: Record<string, unknown>, onShutdown?: () => void, supervisor?: string | null }} [opts]
 */
export async function startApp({
  configure = () => {},
  memory = false,
  summarizer = "",
  key = "test-key",
  dataDir: reuse = undefined,
  keep = false,
  environment = TEST_ENVIRONMENT,
  overrides = {},
  onShutdown = undefined,
  supervisor = null,
} = {}) {
  const dataDir = reuse || mkdtempSync(join(tmpdir(), "filament-e2e-"));
  const cfg = defaultConfig();
  cfg.server.port = 0;
  cfg.server.inboundKeys = [key];
  cfg.observability.logFile = "";
  if (memory) {
    const stateFile = join(dataDir, "fake-engine-state.json");
    if (!reuse) writeFileSync(stateFile, JSON.stringify({ memories: [], canonical: [], seq: 1 }));
    process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({
      command: process.execPath,
      args: [FAKE_SIDECAR],
      env: { FAKE_SIDECAR_STATE: stateFile },
    });
    cfg.memory = {
      enabled: true,
      folder: join(dataDir, "mem"),
      models: { summarizer },
      autopilot: { enabled: false },
      capture: { turns: true, learn: false },
      commands: { enabled: true, prefix: "@mem" },
      privacy: { encryptArchive: false },
    };
  } else {
    // A fresh config has memory on (HarnessV3-AtHome AH-D1); a test that is not about memory runs with it off, as a
    // config that saved it off does.
    cfg.memory.enabled = false;
  }
  // Cursor's SDK runs where a test configures it, as before its Experimental switch (the owner's of 11-10): a test of
  // the switch turns it off itself.
  cfg.experimental.cursorSdk = true;
  // Teams run where a test sends one, their Experimental switch on (core/teams-on.js): a test of the switch turns it off.
  cfg.experimental.teams = true;
  configure(cfg, { dataDir });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  // A sub-agent that changes files starts at its launch, as before the card that holds it while Parallelize tasks is off
  // (the owner's of 11-14): a test of the card passes `overrides: { holdWriters: true }`.
  const app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0, signInOf: async () => ({ signedIn: null, identity: null }), findChrome: () => "", holdWriters: false, ...(environment ? { environment } : {}), ...overrides, agyQuota: { signIn: async () => null, .../** @type {any} */ (overrides.agyQuota) } }, ...(onShutdown ? { onShutdown } : {}), supervisor }));
  const started = await app.start();
  const { port } = started;
  const url = `http://127.0.0.1:${port}`;
  const H = { "content-type": "application/json", "x-api-key": key, authorization: `Bearer ${key}` };
  /**
   * A request with the inbound key: a string body goes as it is (malformed on purpose, say), anything else as JSON.
   * @param {string} path
   * @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [opts]
   */
  const api = (path, { method = "GET", body = undefined, headers = {} } = {}) =>
    fetch(url + path, {
      method,
      headers: { ...H, ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  return {
    app,
    /** What `app.start()` resolved: the address, the config file, and how many models can answer. */
    started,
    dataDir,
    port,
    url,
    key,
    headers: H,
    api,
    /** POST a JSON body to a model path (`/v1/messages`, `/v1/chat/completions`, …). */
    post: (path, body, headers = {}) => api(path, { method: "POST", body, headers }),
    /**
     * POST a JSON body to a model path as one of Filament's own calls (the house key), as its sub-agents and memory call
     * it: `agent/<model>` is Filament's own name — an outside client's is no model.
     */
    house: (path, body, headers = {}) =>
      fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...headers, ...houseAuth() }, body: JSON.stringify(body) }),
    records: async (limit = 50) => (await (await api(`/api/requests?limit=${limit}`)).json()).requests,
    record: async (id) => (await api(`/api/requests/${id}`)).json(),
    async stop() {
      await app.stop();
      if (memory) delete process.env.FILAMENT_MEMORY_SIDECAR;
      if (keep) return;
      // A dir that will not go throws (an archive handle the test left open is the usual cause): never a silent leak.
      await removeDirs(dataDir);
    },
  };
}

/** Parse an SSE body into `[{ event, data }]`; `data` is parsed as JSON when it is JSON. Comment lines (heartbeats) are dropped. */
/**
 * A POST over node:http, which waits as long as the reply takes: a test's own request that must outlive the short
 * wait it gives Node's fetch.
 * @param {string} url @param {any} body @param {Record<string, string>} headers
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, text: string }>}
 */
export function postOverHttp(url, body, headers) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = http.request(url, { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(raw)) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, text }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(raw);
  });
}

export function parseSse(text) {
  const out = [];
  for (const block of String(text).split(/\r?\n\r?\n/)) {
    let event = null;
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) continue;
    const joined = data.join("\n");
    /** @type {any} */
    let parsed = joined;
    try {
      parsed = JSON.parse(joined);
    } catch {}
    out.push(event ? { event, data: parsed } : { data: parsed });
  }
  return out;
}
