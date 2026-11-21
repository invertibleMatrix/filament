// Four invariants, each one paid for with a production incident and without a direct test until now. They pin the
// behaviour so a structural change cannot silently reopen these paths:
//   1. The memory follow-up releases its lane slot before re-acquiring (W7 P1): with maxConcurrency 1 the
//      follow-up used to queue behind itself for 120 s on every memory-tool round.
//   2. A client that hangs up mid-stream while the upstream keeps sending must not crash the server or leave an
//      unhandled rejection, must not cool the upstream down, and its record finishes `aborted`. This is the
//      observable side of the writableEnded guards: writes after res.end() vanish without throwing (Node drops
//      the bytes), which is how buffered flushes on timers were lost after a response had already ended.
//   3. Hand-run shells never see Filament's secrets: safeEnv() hands a model-run command an environment with the
//      API keys, inbound keys and Filament's own variables dropped, keeping only what a shell needs.
//   4. Repaired tool-call ids are deterministic (FNV-1a over name+arguments / result content): a random id made a
//      failover resend different bytes for the same history, which split tool_use/tool_result pairs and broke
//      the provider's cached prefix.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fakeUpstream, startApp, parseSse, openaiReply } from "./helpers/app.js";
import { runHand, safeEnv } from "../src/hands.js";
import { openaiToAnthropicRequest, openaiToAnthropicResponse } from "../src/translate.js";

/** Set `vars` into process.env for the duration of `fn`, restoring exactly what was there before. */
async function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((k) => [
    k,
    Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : null,
  ]);
  try {
    Object.assign(process.env, vars);
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Reject if `p` does not settle within `ms`, aborting `ctrl` so nothing stays queued or in flight. */
function bounded(p, ms, ctrl, what) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ctrl?.abort();
      reject(new Error(`${what} did not settle within ${ms} ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Invariant 1: the memory follow-up releases its lane slot before re-acquiring (W7 P1)
// ---------------------------------------------------------------------------
const MEM_MODEL = "mem-slot";
const MEM_ROUND1_TEXT = "Let me check what I remember.";
const MEM_FINAL_TEXT = "Found it: you write TypeScript with tabs and no semicolons.";

let memUp, memShim;
const chunkOf = (delta, finish = null, extra = {}) => ({
  data: {
    id: "c1",
    object: "chat.completion.chunk",
    model: MEM_MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  },
});
// A well-formed terminal: the blank line terminates the event, so the interceptor forwards it during push().
const memStream = (events) => ({ sse: [...events, "data: [DONE]\n\n"] });

before(async () => {
  memUp = await fakeUpstream((call) => {
    if (call.body?.model !== MEM_MODEL) return undefined;
    const followedUp = (call.body.messages || []).some((m) => m.role === "tool");
    if (followedUp) {
      return call.body.stream === true
        ? memStream([
            chunkOf({ role: "assistant", content: "" }),
            chunkOf({ content: MEM_FINAL_TEXT }),
            chunkOf({}, "stop"),
            chunkOf({}, null, { usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }),
          ])
        : openaiReply(MEM_FINAL_TEXT, { model: MEM_MODEL });
    }
    const toolCall = {
      id: "call_1",
      type: "function",
      function: { name: "filament_memory_search", arguments: JSON.stringify({ query: "code formatting" }) },
    };
    return call.body.stream === true
      ? memStream([
          chunkOf({ role: "assistant", content: "" }),
          chunkOf({
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: toolCall.function.name, arguments: "" },
              },
            ],
          }),
          chunkOf({ tool_calls: [{ index: 0, function: { arguments: toolCall.function.arguments } }] }),
          chunkOf({}, "tool_calls"),
          chunkOf({}, null, { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
        ])
      : openaiReply(MEM_ROUND1_TEXT, { model: MEM_MODEL, finish: "tool_calls", toolCalls: [toolCall] });
  });
  memShim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [
        {
          id: "fake",
          name: "fake",
          type: "openai-compatible",
          baseUrl: memUp.url,
          apiKey: "x",
          enabled: true,
        },
      ];
      cfg.routes = [{ match: "mem-*", upstream: "fake", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: true, tools: true, toolIterations: 4, cue: false };
    },
  });
  // The lane the incident jammed: this model runs at most one request at a time, as a 429 with two in flight teaches it
  // (the only cap a call holds to since 11-05).
  memShim.app.health.note429("fake", MEM_MODEL, 2);
});
after(async () => {
  try {
    if (memShim) await memShim.stop();
  } catch {}
  try {
    if (memUp) await memUp.close();
  } catch {}
});

const memRequest = (extraBody, ctrl) =>
  fetch(`${memShim.url}/v1/chat/completions`, {
    method: "POST",
    headers: memShim.headers,
    signal: ctrl.signal,
    body: JSON.stringify({
      model: MEM_MODEL,
      messages: [{ role: "user", content: "how do I like my code formatted?" }],
      ...extraBody,
    }),
  });

test("with maxConcurrency 1 a memory tool round's follow-up re-acquires the lane instead of queueing behind itself (non-streaming client)", async () => {
  memUp.reset();
  const ctrl = new AbortController();
  // W7 P1: holding the round's slot while re-acquiring deadlocked a maxConcurrency=1 lane for 120 s. The race
  // turns that hang into a test failure long before the gate's own timeout would.
  const r = await bounded(memRequest({}, ctrl), 15000, ctrl, "the memory tool round trip");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(
    j.choices[0].message.content.endsWith(MEM_FINAL_TEXT),
    `the client sees the follow-up's answer: ${JSON.stringify(j.choices[0].message.content)}`,
  );
  assert.ok(!JSON.stringify(j).includes("filament_memory"), "the tool call never reached the client");
  assert.equal(memUp.received.length, 2, "the upstream saw the first ask and the follow-up");
  assert.ok(
    memUp.received[1].body.messages.some((m) => m.role === "tool" && m.tool_call_id === "call_1"),
    "the follow-up carried the tool results",
  );
  const rec = (await memShim.records()).find((x) => x.model === MEM_MODEL);
  assert.equal(rec.status, "ok");
});

test("with maxConcurrency 1 a memory tool round's follow-up re-acquires the lane instead of queueing behind itself (streaming client)", async () => {
  memUp.reset();
  const ctrl = new AbortController();
  // The streaming path asks the upstream again from inside reply-stream's stage loop; its slot release lives in
  // the memory loop's followUp, a different code path from the JSON reply's.
  const r = await bounded(
    memRequest({ stream: true }, ctrl),
    15000,
    ctrl,
    "the streaming memory tool round trip",
  );
  assert.equal(r.status, 200);
  const text = await r.text();
  const events = parseSse(text);
  assert.equal(events.filter((e) => e.data === "[DONE]").length, 1, "exactly one [DONE]");
  assert.ok(!text.includes("filament_memory"), "the tool call never reached the client");
  assert.ok(
    events.some((e) => e.data !== "[DONE]" && e.data?.choices?.[0]?.delta?.content === MEM_FINAL_TEXT),
    "the follow-up's text reached the client",
  );
  assert.ok(events.some((e) => e.data !== "[DONE]" && e.data?.choices?.[0]?.finish_reason === "stop"));
  assert.equal(memUp.received.length, 2, "the upstream saw the first ask and the follow-up");
  const rec = (await memShim.records()).find((x) => x.model === MEM_MODEL);
  assert.equal(rec.status, "ok");
});

// ---------------------------------------------------------------------------
// Invariant 2: a mid-stream client hang-up while the upstream keeps sending
// ---------------------------------------------------------------------------
let tickUp, tickShim;
const tickTimers = new Set();

before(async () => {
  // An upstream that keeps SSE events coming on a timer for a couple of seconds. fakeUpstream's script API answers
  // a request in one shot; the incident happened in exactly the window this fake reproduces — the client is gone
  // while the upstream's stream is still alive and Filament still has bytes (and timers) in flight.
  tickUp = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {}
      // Filament aborts this socket when its own client leaves; a write into it must not take the fake down.
      res.on("error", () => {});
      if (body.stream !== true) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "c",
            object: "chat.completion",
            model: body.model,
            choices: [
              { index: 0, message: { role: "assistant", content: "STILL SERVING" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      let n = 0;
      const timer = setInterval(() => {
        n++;
        try {
          res.write(
            `data: ${JSON.stringify({
              id: "c",
              object: "chat.completion.chunk",
              model: "tick-1",
              choices: [{ index: 0, delta: { content: `tick ${n}` }, finish_reason: null }],
            })}\n\n`,
          );
        } catch {}
        if (n >= 60) {
          clearInterval(timer);
          tickTimers.delete(timer);
          try {
            res.write(
              `data: ${JSON.stringify({
                id: "c",
                object: "chat.completion.chunk",
                model: "tick-1",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              })}\n\ndata: [DONE]\n\n`,
            );
            res.end();
          } catch {}
        }
      }, 40);
      timer.unref?.();
      tickTimers.add(timer);
    });
  });
  await new Promise((r) => tickUp.listen(0, "127.0.0.1", () => r(undefined)));
  tickShim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [
        {
          id: "tick",
          name: "tick",
          type: "openai-compatible",
          baseUrl: `http://127.0.0.1:${tickUp.address().port}`,
          apiKey: "x",
          enabled: true,
        },
      ];
      cfg.routes = [{ match: "tick-*", upstream: "tick", upstreamModel: "{model}", enabled: true }];
    },
  });
});
after(async () => {
  for (const t of tickTimers) clearInterval(t);
  try {
    if (tickShim) await tickShim.stop();
  } catch {}
  try {
    if (tickUp) await new Promise((r) => tickUp.close(r));
  } catch {}
});

test("a client that hangs up mid-stream while the upstream keeps sending leaves no crash behind, and its record finishes aborted with the upstream untouched", async () => {
  // A crash here would otherwise be invisible: the bytes of a write after res.end() are dropped by Node without
  // throwing, and an async failure would only surface as an unhandled rejection.
  const crashes = [];
  const onUncaught = (e) => crashes.push(["uncaughtException", String(e?.stack || e)]);
  const onRejection = (e) => crashes.push(["unhandledRejection", String(e?.stack || e)]);
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onRejection);
  try {
    const ctrl = new AbortController();
    const r = await fetch(`${tickShim.url}/v1/chat/completions`, {
      method: "POST",
      headers: tickShim.headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "tick-1",
        stream: true,
        messages: [{ role: "user", content: "stream for a while" }],
      }),
    });
    assert.equal(r.status, 200);
    const reader = r.body.getReader();
    await reader.read(); // at least one event is on the wire
    ctrl.abort(); // the client is gone; the upstream keeps ticking for another couple of seconds
    await reader.cancel().catch(() => {});
    let rec = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r2) => setTimeout(r2, 50));
      rec = (await tickShim.records()).find((x) => x.model === "tick-1");
      if (rec && rec.status !== "pending") break;
    }
    assert.ok(rec, "the hung-up request is in the ring");
    assert.equal(
      rec.status,
      "aborted",
      `a client hang-up is recorded as an abort, not as an upstream error: ${JSON.stringify({ status: rec.status, error: rec.error })}`,
    );
    // The next request on the same app must succeed: nothing crashed, nothing wedged.
    const after = await fetch(`${tickShim.url}/v1/chat/completions`, {
      method: "POST",
      headers: tickShim.headers,
      body: JSON.stringify({ model: "tick-1", messages: [{ role: "user", content: "are you still there" }] }),
    });
    assert.equal(after.status, 200);
    const j = await after.json();
    assert.equal(j.choices[0].message.content, "STILL SERVING");
    // The upstream was not penalised: W8 D1 cooled a healthy provider because a hang-up read as a retryable 502.
    const health = (await (await tickShim.api("/api/usage/upstreams")).json()).health;
    assert.ok(
      !health.tick?.coolingDown && !(health.tick?.failures > 0),
      `the abort must not cool the upstream down: ${JSON.stringify(health.tick)}`,
    );
    const { ops } = await (await tickShim.api("/api/ops?kinds=health&limit=50")).json();
    assert.ok(
      !ops.some((o) => o.sub === "cooldown"),
      `no cooldown operation for a client hang-up: ${JSON.stringify(ops.map((o) => o.title))}`,
    );
  } finally {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onRejection);
  }
  assert.deepEqual(
    crashes,
    [],
    "the mid-stream hang-up must not crash the server or leave an unhandled rejection",
  );
});

// ---------------------------------------------------------------------------
// Invariant 3: hand-run shells never see Filament's secrets
// ---------------------------------------------------------------------------
/** An environment's key for `name`: on Windows names are case-insensitive — cmd.exe/PowerShell export `Path` (BUG-18 —
 *  these assertions used the exact key `PATH` and failed on every Windows run while the shell had its PATH), and Git
 *  Bash hands what it runs `SYSTEMROOT` for the `SystemRoot` it was given.
 *  @param {Record<string, any>} env @param {string} name */
const envKey = (env, name) => Object.keys(env).find((k) => (process.platform === "win32" ? k.toUpperCase() === name.toUpperCase() : k === name));
/** @param {Record<string, any>} env */
const pathKey = (env) => envKey(env, "PATH");
const SHELL_KEEPERS = [
  "PATH",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOME",
  "SystemRoot",
  "COMSPEC",
  "windir",
  "APPDATA",
  "LOCALAPPDATA",
  "LANG",
];

test("safeEnv drops Filament's own variables, key-shaped variables and secret-shaped wildcards, and keeps what a shell needs", async () => {
  const scrubbed = await withEnv(
    {
      FILAMENT_SHIMTEST_SIDECAR: "subprocess spec",
      SHIMTEST_LLM_API_KEY: "sk-secret-1",
      SHIMTEST_INBOUND_KEY: "test-key",
      CLAUDECODE: "1",
      GIT_SHIMTEST_TOKEN: "ghp_secret",
      npm_config_shimtest_auth: "basic dXNlcjpwYXNz",
      GIT_SHIMTEST_TRACE: "1",
      npm_config_shimtest_registry: "https://registry.example.com",
      LC_SHIMTEST_ALL: "C",
    },
    safeEnv,
  );
  assert.equal(
    scrubbed.FILAMENT_SHIMTEST_SIDECAR,
    undefined,
    "Filament's own variables never reach a hand-run shell",
  );
  assert.equal(scrubbed.SHIMTEST_LLM_API_KEY, undefined, "an API key in the process environment is dropped");
  assert.equal(scrubbed.SHIMTEST_INBOUND_KEY, undefined, "an inbound key is dropped");
  assert.equal(scrubbed.CLAUDECODE, undefined, "the embedding agent's marker is dropped");
  assert.equal(
    scrubbed.GIT_SHIMTEST_TOKEN,
    undefined,
    "a GIT_-prefixed name is still dropped when it is secret-shaped",
  );
  assert.equal(
    scrubbed.npm_config_shimtest_auth,
    undefined,
    "an npm_config_ name is still dropped when it is secret-shaped",
  );
  assert.equal(scrubbed.GIT_SHIMTEST_TRACE, "1", "a non-secret GIT_ setting survives");
  assert.equal(
    scrubbed.npm_config_shimtest_registry,
    "https://registry.example.com",
    "a non-secret npm_config_ setting survives",
  );
  assert.equal(scrubbed.LC_SHIMTEST_ALL, "C", "a non-secret LC_ setting survives");
  assert.ok(pathKey(scrubbed), "a shell without PATH cannot run anything");
  assert.equal(scrubbed[/** @type {string} */ (pathKey(scrubbed))], process.env[/** @type {string} */ (pathKey(process.env))], "PATH survives unchanged");
  // Keeper names are matched exactly, as the code implements them; assert the ones this machine exports verbatim.
  for (const k of SHELL_KEEPERS) {
    if (Object.keys(process.env).includes(k))
      assert.equal(scrubbed[k], process.env[k], `${k} must survive unchanged`);
  }
});

// (fails before: yes — the bug hunt of 10-30: git's config by environment reached the shell without the keys safeEnv
// drops by their name, so a token in GIT_CONFIG_VALUE_0 was the model's to read, and git refused every command:
// "missing config key GIT_CONFIG_KEY_0")
test("safeEnv drops git's config by environment whole, its count and values with its keys, and the shell's git runs", async () => {
  const scrubbed = await withEnv(
    { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic eDpnaHBfc2VjcmV0", GIT_SHIMTEST_TRACE: "1" },
    safeEnv,
  );
  assert.deepEqual(["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"].filter((k) => k in scrubbed), []);
  assert.equal(scrubbed.GIT_SHIMTEST_TRACE, "1", "a git setting of another name survives");
  const git = spawnSync("git", ["config", "--get", "filament.nothing"], { env: scrubbed, encoding: "utf8" });
  if (git.error) return; // no git on this machine
  assert.doesNotMatch(git.stderr, /missing config key|unable to parse/);
  assert.equal(git.status, 1, "git ran, and found no such setting");
});

test(
  "on Windows a kept variable survives whatever casing the parent shell exported it in",
  { skip: process.platform !== "win32" || "TMPDIR" in process.env },
  () => {
    // Windows environment names are case-insensitive, and Git Bash exports SYSTEMROOT where cmd.exe writes
    // SystemRoot; an exact-case keep list dropped the variable and `%SystemRoot%`-reading tools lost it.
    process.env.TmpDir = "case-test";
    try {
      assert.equal(safeEnv().TmpDir, "case-test");
    } finally {
      delete process.env.TmpDir;
    }
  },
);

test("a bash hand's child process runs with the scrubbed environment: keys set in Filament's own process never reach the shell", async () => {
  // The probe avoids a quoted executable path and lets the child's inherited PATH resolve node, and double-quotes its
  // script, which every shell the hand may run reads alike (Git Bash, cmd.exe, sh); the JSON it prints is the
  // environment Filament actually handed over.
  const out = await withEnv(
    { SHIMTEST_LLM_KEY: "sk-live-2", FILAMENT_SHIMTEST_INBOUND: "test-key", CLAUDECODE: "1" },
    () =>
      runHand("bash", { command: 'node -e "console.log(JSON.stringify(process.env))"' }, { root: tmpdir() }),
  );
  const childEnv = JSON.parse(out.trim());
  assert.ok(!("SHIMTEST_LLM_KEY" in childEnv), "the API key stayed behind");
  assert.ok(!("FILAMENT_SHIMTEST_INBOUND" in childEnv), "Filament's own variables never reach the child");
  assert.ok(!("CLAUDECODE" in childEnv), "the embedding agent's marker never reaches the child");
  const childPath = pathKey(childEnv);
  assert.ok(childPath && childEnv[childPath], "the child still has PATH");
  for (const k of SHELL_KEEPERS) {
    if (k !== "PATH" && Object.keys(process.env).includes(k))
      assert.equal(childEnv[/** @type {string} */ (envKey(childEnv, k))], process.env[k], `${k} must reach the child unchanged`);
  }
});

// ---------------------------------------------------------------------------
// Invariant 4: repaired tool-call ids are deterministic
// ---------------------------------------------------------------------------
/** The repaired ids a translated body carries: the call's id, and the result-side id (visible in the text the
 * orphan result degrades to when its pairing cannot be proven). */
const repairedIds = (body) => {
  const t = openaiToAnthropicRequest(body).body;
  const callId = t.messages.flatMap((m) => m.content).find((b) => b.type === "tool_use")?.id;
  const resultId = /\[tool result for (call_unknown_[^\]]+)\]/.exec(JSON.stringify(t.messages))?.[1] || null;
  return { callId, resultId };
};

test("a tool call without an id and a tool result without a tool_call_id repair to the same ids on every translation, and different content repairs to different ids", () => {
  const body = (args, result) => ({
    model: "m",
    messages: [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ type: "function", function: { name: "get_weather", arguments: args } }],
      },
      { role: "tool", content: result },
    ],
  });
  const first = openaiToAnthropicRequest(body('{"city":"Paris"}', "sunny, 22C"));
  const second = openaiToAnthropicRequest(body('{"city":"Paris"}', "sunny, 22C"));
  assert.deepEqual(
    first.body,
    second.body,
    "the same history translates to the same bytes: a failover resend must not differ",
  );
  const paris = repairedIds(body('{"city":"Paris"}', "sunny, 22C"));
  const parisRain = repairedIds(body('{"city":"Paris"}', "rainy, 9C"));
  const rome = repairedIds(body('{"city":"Rome"}', "sunny, 22C"));
  assert.ok(
    paris.callId && paris.resultId,
    `both ids were repaired: ${JSON.stringify([paris.callId, paris.resultId])}`,
  );
  assert.equal(
    paris.callId,
    second.body.messages[1].content[0].id,
    "the call's repaired id matches the byte-stable translation",
  );
  assert.notEqual(rome.callId, paris.callId, "different arguments must not share a repaired call id");
  assert.equal(
    parisRain.callId,
    paris.callId,
    "the same arguments repair to the same call id whatever the result says",
  );
  assert.notEqual(
    parisRain.resultId,
    paris.resultId,
    "the result-side repair is seeded from the result's content",
  );
});

test("a repaired tool_use id pairs with the placeholder result the repair mints for it", () => {
  // A call whose result never arrived cannot borrow a random id: the placeholder the repair inserts must carry the
  // SAME deterministic id, or the pair splits on a failover resend and the provider's cached prefix breaks.
  const t = openaiToAnthropicRequest({
    model: "m",
    messages: [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }],
      },
      { role: "user", content: "go on" },
    ],
  }).body;
  const call = t.messages[1].content[0];
  const placeholder = t.messages[2].content.find((b) => b.type === "tool_result");
  assert.equal(call.type, "tool_use");
  assert.equal(placeholder.tool_use_id, call.id, "the placeholder result answers the call's repaired id");
  assert.equal(placeholder.is_error, true);
});

test("an upstream tool call without an id repairs to the same id in the response translator too, so the client's next request replays byte-identically", () => {
  const reply = (args) => ({
    id: "chatcmpl-1",
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ type: "function", function: { name: "get_weather", arguments: args } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  });
  const a = openaiToAnthropicResponse(reply('{"city":"Paris"}'), { model: "m" });
  const b = openaiToAnthropicResponse(reply('{"city":"Paris"}'), { model: "m" });
  assert.equal(a.content[0].id, b.content[0].id, "the same reply repairs to the same id every time");
  const rome = openaiToAnthropicResponse(reply('{"city":"Rome"}'), { model: "m" });
  assert.notEqual(rome.content[0].id, a.content[0].id, "different arguments must not share a repaired id");
});
