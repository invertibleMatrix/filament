// @ts-check
// The dispatch loop's failure paths, through a real Filament with scripted fakes: a memory tool round whose
// follow-up dies mid-stream, the round limit, the wire-API detour whose second attempt fails too, a Qoder
// upstream that cannot be reached, a stream the upstream cut mid-reply, and the locally answered requests (title ping,
// /status).
// Each test pins what the client, the request record and the ops log get, so a structural change cannot
// silently alter how a half-finished request ends.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, fakeUpstream, parseSse } from "./helpers/app.js";
import { QODER } from "../src/qoder.js";

/** A port with nothing listening: connection refused, instantly, with no network. */
async function deadPort() {
  const holder = http.createServer();
  await new Promise((r) => holder.listen(0, "127.0.0.1", () => r(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (holder.address()).port;
  await new Promise((r) => holder.close(() => r(undefined)));
  return port;
}

const COMPACT_PROMPT =
  "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.";

// An OpenAI stream whose only content is a memory tool call: what the model sends when it wants Filament to
// search its memory before answering.
function openaiToolCallStream(model, id, args) {
  /** @type {(delta: object, finish?: string | null, extra?: object) => { data: any }} */
  const chunk = (delta, finish = null, extra = {}) => ({
    data: {
      id: "c1",
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...extra,
    },
  });
  return {
    sse: [
      chunk({ role: "assistant", content: "" }),
      chunk({
        tool_calls: [
          { index: 0, id, type: "function", function: { name: "filament_memory_search", arguments: "" } },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
      chunk({}, "tool_calls"),
      chunk({}, null, { usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }),
      "data: [DONE]\n",
    ],
  };
}

// A small anthropic conversation: n completed turns plus a live user message.
const turn = (i) => [
  { role: "user", content: `work turn ${i}: please fix file${i}.js and run the tests` },
  { role: "assistant", content: `Fixed file${i}.js: the off-by-one on line 12 is gone and the tests pass.` },
];
const convo = (n) =>
  [...Array(n)].flatMap((_, i) => turn(i)).concat([{ role: "user", content: "work: now what is left?" }]);

// ---------------------------------------------------------------------------------------------------------------
// Memory tool loop, streaming: the follow-up fails, or the model never stops asking
// ---------------------------------------------------------------------------------------------------------------
describe("memory tool loop over a stream, when it breaks", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;

  before(async () => {
    up = await fakeUpstream((call) => {
      const msgs = Array.isArray(call.body?.messages) ? call.body.messages : [];
      const followUp = msgs.some((m) => m.role === "tool");
      if (call.body?.model === "mem-fail-1")
        return followUp
          ? { status: 500, json: { error: { message: "follow-up refused" } } }
          : openaiToolCallStream("mem-fail-1", "call_1", { query: "tabs" });
      if (call.body?.model === "mem-loop-1")
        return openaiToolCallStream(call.body.model, `call_${call.n}`, { query: "tabs" });
      return undefined;
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        // toolIterations 1 keeps the round-limit test to two upstream calls; the follow-up failure test
        // never gets that far anyway.
        cfg.memory.autopilot = {
          enabled: true,
          mode: "conservative",
          briefingTokens: 1200,
          turnTokens: 300,
          minScore: 0.2,
          tools: true,
          toolIterations: 1,
          cue: false,
        };
        cfg.upstreams = [{ id: "oai", name: "oai", type: "openai-compatible", baseUrl: up.url, apiKey: "x" }];
        cfg.routes = [{ match: "mem-*", upstream: "oai", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  test("a streamed memory tool call whose follow-up gets a 5xx ends the client's stream with an error event, the tool call never shown, and the record says error", async () => {
    const r = await shim.post(
      "/v1/chat/completions",
      {
        model: "mem-fail-1",
        stream: true,
        messages: [{ role: "user", content: "how do I like my code formatted?" }],
      },
      { "x-session-id": "pipe-fail-1" },
    );
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(!text.includes("filament_memory"), "the tool call never reached the client");
    assert.ok(!text.includes("[DONE]"), "the stream does not end cleanly: it ends on the error event");
    const events = parseSse(text);
    assert.ok(!text.includes("[DONE]"), "the stream does not end cleanly: it ends on the error frame");
    assert.equal(events.at(-1)?.data.error.message, "memory follow-up failed; the reply ends here");

    const rec = (await shim.records()).find((x) => x.model === "mem-fail-1");
    assert.ok(rec, "the request was recorded");
    assert.equal(rec.status, "error");
    assert.equal(rec.httpStatus, 200, "the head was already on the wire, so the wire status stays 200");
    assert.equal(rec.error, "memory follow-up failed; the reply ends here");

    // The loop ran: the upstream was asked twice, and the follow-up carried the tool result Filament produced.
    const calls = up.received.filter((c) => c.body?.model === "mem-fail-1");
    assert.equal(calls.length, 2);
    const toolMsg = calls[1].body.messages.at(-1);
    assert.equal(toolMsg.role, "tool");
    assert.equal(toolMsg.tool_call_id, "call_1");

    const { ops } = await (await shim.api("/api/ops?kinds=log&limit=100")).json();
    assert.ok(
      ops.some(
        (o) =>
          o.level === "warn" && o.title.includes(rec.id) && o.title.includes("memory follow-up got HTTP 500"),
      ),
      `a warn operation names the failed follow-up: ${JSON.stringify(ops.map((o) => o.title))}`,
    );
  });

  test("the model keeps calling memory tools past the round limit: the last calls run after the reply, the client gets one clean stream, and the record says the results ride along", async () => {
    const r = await shim.post(
      "/v1/chat/completions",
      {
        model: "mem-loop-1",
        stream: true,
        messages: [{ role: "user", content: "how do I like my code formatted?" }],
      },
      { "x-session-id": "pipe-round-1" },
    );
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(!text.includes("filament_memory"), "the withheld tool calls never reached the client");
    const events = parseSse(text);
    assert.equal(events.filter((e) => e.data === "[DONE]").length, 1, "exactly one [DONE]");
    assert.ok(
      events.some((e) => e.data?.choices?.[0]?.finish_reason === "stop"),
      "one clean terminal",
    );

    // One round ran against the upstream; the round the limit cut off did not go back upstream again.
    const calls = up.received.filter((c) => c.body?.model === "mem-loop-1");
    assert.equal(calls.length, 2, "the first round and its follow-up, then the limit stops the loop");

    const rec = (await shim.records()).find((x) => x.model === "mem-loop-1");
    assert.ok(rec);
    assert.equal(rec.status, "ok");
    assert.equal(rec.memory.toolRounds, 1);
    assert.ok(
      rec.changes.some(
        (c) =>
          c.includes("memory tool round limit (1) reached") &&
          c.includes("ride along with the client's next request"),
      ),
      rec.changes.join(" | "),
    );
    assert.ok(
      rec.changes.some((c) => /used memory tools \(search\) in 1 extra round/.test(c)),
      rec.changes.join(" | "),
    );

    // The deferred results really do ride along: the session's next request carries them on its newest message.
    const mark = up.received.length;
    await shim.post(
      "/v1/chat/completions",
      {
        model: "mem-loop-1",
        stream: true,
        messages: [{ role: "user", content: "and now the actual question" }],
      },
      { "x-session-id": "pipe-round-1" },
    );
    const next = up.received.slice(mark).at(-1);
    assert.ok(next, "the next request of the session went upstream");
    const lastUser = next.body.messages.filter((m) => m.role === "user").at(-1);
    assert.ok(
      JSON.stringify(lastUser).includes("Results of the memory tools the model called in its previous reply"),
      JSON.stringify(lastUser).slice(0, 400),
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The dispatch loop's failover paths: the wire-API detour and an unreachable Qoder upstream
// ---------------------------------------------------------------------------------------------------------------
describe("the dispatch loop's failover paths", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let detour, backup, wrong;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let savedChatBase = "";

  before(async () => {
    // Qoder's endpoints are compiled in; the tests re-point the two chat hosts at a dead local port, so the
    // upstream really cannot be reached and the failure is a connection refusal, not a logged-out error.
    savedChatBase = QODER.chatBase;
    QODER.chatBase = `http://127.0.0.1:${await deadPort()}`;
    QODER.chatBaseJob = QODER.chatBase;
    detour = await fakeUpstream((call) => {
      if (call.path === "/v1/chat/completions")
        return { status: 404, json: { error: { message: "no chat completions here" } } };
      if (call.path === "/v1/responses")
        return { status: 500, json: { error: { message: "responses endpoint exploded" } } };
      return undefined;
    });
    backup = await fakeUpstream();
    // A wrong base URL (BUG-02's GLM case): every path answers 404, Chat Completions and Responses alike.
    wrong = await fakeUpstream(() => ({ status: 404, json: { error: { message: "Not Found" } } }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.rules.resilience.failover = true; // the backups below are tried: off until switched on (the owner's of 11-09)
        cfg.upstreams = [
          {
            id: "detour",
            name: "detour",
            type: "openai-compatible",
            baseUrl: detour.url,
            apiKey: "x",
            enabled: true,
          },
          {
            id: "backup",
            name: "backup",
            type: "openai-compatible",
            baseUrl: backup.url,
            apiKey: "x",
            enabled: true,
          },
          {
            id: "wrong",
            name: "wrong",
            type: "openai-compatible",
            baseUrl: wrong.url,
            apiKey: "x",
            enabled: true,
          },
          {
            id: "q",
            name: "q",
            type: "qoder",
            apiKey: "",
            enabled: true,
            qoder: { accessToken: "dt-unreachable", userId: "user-1" },
          },
        ];
        cfg.routes = [
          {
            match: "detour-*",
            upstream: "detour",
            upstreamModel: "{model}",
            enabled: true,
            fallbacks: [{ upstream: "backup", upstreamModel: "{model}" }],
          },
          {
            match: "qf-*",
            upstream: "q",
            upstreamModel: "{model}",
            enabled: true,
            fallbacks: [{ upstream: "backup", upstreamModel: "{model}" }],
          },
          { match: "qonly-*", upstream: "q", upstreamModel: "{model}", enabled: true },
          { match: "wrong-*", upstream: "wrong", upstreamModel: "{model}", enabled: true },
        ];
      },
    });
  });
  after(async () => {
    QODER.chatBase = savedChatBase;
    await shim.stop();
    await detour.close();
    await backup.close();
    await wrong.close();
  });

  // (fails before: the failed detour latched the upstream as responses-only, so the second request went straight to
  // /v1/responses — the GLM incident, where a wrong base URL kept every later request on /responses until a restart)
  test("BUG-02: after a detour whose Responses attempt failed too, the next request tries Chat Completions again", async () => {
    const first = await shim.post("/v1/chat/completions", { model: "wrong-1", messages: [{ role: "user", content: "hi" }] });
    assert.equal(first.status, 404, "a wrong path is the client's to see");
    await first.text();
    const rec = (await shim.records()).find((x) => x.model === "wrong-1");
    assert.ok(rec?.priorChanges?.some((c) => c.includes("HTTP 404 on Responses too") && c.includes("nothing was remembered")), (rec?.priorChanges || []).join(" | "));
    wrong.reset();
    const again = await shim.post("/v1/chat/completions", { model: "wrong-1", messages: [{ role: "user", content: "again" }] });
    assert.equal(again.status, 404);
    await again.text();
    assert.deepEqual(wrong.received.map((c) => c.path), ["/v1/chat/completions", "/v1/responses"], `Chat Completions first again: nothing was latched (saw ${JSON.stringify(wrong.received.map((c) => c.path))})`);
  });

  test("a 404 on /v1/chat/completions sends the request again to /v1/responses; when that fails too, the next candidate serves and the record carries both the detour and the failover", async () => {
    const r = await shim.post("/v1/chat/completions", {
      model: "detour-1",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "MODEL ANSWER");

    assert.deepEqual(
      detour.received.map((c) => c.path),
      ["/v1/chat/completions", "/v1/responses"],
      "the same request hit both wire APIs",
    );
    assert.equal(
      backup.received.filter((c) => c.body?.model === "detour-1").length,
      1,
      "the backup was asked once, in its own shape",
    );

    const rec = (await shim.records()).find((x) => x.model === "detour-1");
    assert.ok(rec);
    assert.equal(rec.status, "ok");
    assert.equal(rec.upstream, "backup");
    assert.ok(
      rec.priorChanges.some((c) => c.includes("wire API: detour answered HTTP 404 on Chat Completions") && c.includes("the same request was sent to Responses")),
      rec.priorChanges.join(" | "),
    );
    // BUG-02: a detour whose Responses attempt fails proves nothing about the server — nothing is remembered.
    assert.ok(
      rec.priorChanges.some((c) => c.includes("HTTP 500 on Responses too") && c.includes("nothing was remembered")),
      rec.priorChanges.join(" | "),
    );
    assert.ok(!rec.priorChanges.some((c) => c.includes("remembers that")), "a failed detour latches nothing");
    assert.deepEqual(rec.failover.trail, [
      { upstream: "detour", status: 500, reason: '{"error":{"message":"responses endpoint exploded"}}' },
    ]);
    assert.equal(rec.failover.servedBy, "backup");
    assert.equal(rec.failover.attempt, 2);
    assert.ok(
      rec.changes.some(
        (c) => c === "failover: served by backup (#2 in order) after detour failed with HTTP 500",
      ),
      rec.changes.join(" | "),
    );
  });

  test("a Qoder upstream that cannot be reached fails over to the healthy backup, and the record's trail names Qoder", async () => {
    const r = await shim.post("/v1/chat/completions", {
      model: "qf-1",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).choices[0].message.content, "MODEL ANSWER");

    const rec = (await shim.records()).find((x) => x.model === "qf-1");
    assert.ok(rec);
    assert.equal(rec.status, "ok");
    assert.equal(rec.upstream, "backup");
    assert.deepEqual(rec.failover.trail, [{ upstream: "q", status: null, reason: "ECONNREFUSED" }]);
    assert.equal(rec.failover.servedBy, "backup");
    assert.ok(
      rec.changes.some((c) => c === "failover: served by backup (#2 in order) after q failed"),
      rec.changes.join(" | "),
    );
    assert.ok(
      rec.priorChanges.some((c) => /health: q cooling down \d+ s \(unreachable\)/.test(c)),
      rec.priorChanges.join(" | "),
    );
  });

  test("an unreachable Qoder upstream as the last candidate: the client gets a 502 whose message names Qoder", async () => {
    const r = await shim.post("/v1/chat/completions", {
      model: "qonly-1",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(r.status, 502);
    const j = await r.json();
    assert.equal(j.error.message, "Qoder: fetch failed");

    const rec = (await shim.records()).find((x) => x.model === "qonly-1");
    assert.ok(rec);
    assert.equal(rec.status, "error");
    assert.equal(rec.httpStatus, 502);
    assert.equal(rec.error, "Qoder: fetch failed");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Requests answered without an upstream: /status with no session, a body that busts the size cap
// ---------------------------------------------------------------------------------------------------------------
describe("requests answered without an upstream", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;

  before(async () => {
    up = await fakeUpstream();
    shim = await startApp({
      configure: (cfg) => {
        cfg.server.maxBodyBytes = 4096;
        cfg.upstreams = [
          {
            id: "anthropic-up",
            name: "anthropic-up",
            type: "anthropic-compatible",
            baseUrl: up.url,
            apiKey: "x",
            enabled: true,
          },
        ];
        cfg.routes = [
          { match: "claude-*", upstream: "anthropic-up", upstreamModel: "{model}", enabled: true },
        ];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  // (fails before: yes — the owner's rules of 10-31: an outside client's chat is a plain proxy with memory, but its
  // /status was answered by Filament, from the last 24 hours' records)
  test("an outside client's /status, with no session id and memory off, goes to its model as typed", async () => {
    const callsBefore = up.received.length;
    const r = await shim.post("/v1/messages", {
      model: "claude-1",
      max_tokens: 100,
      messages: [{ role: "user", content: "/status" }],
    });
    assert.equal(r.status, 200);
    const text = (await r.json()).content[0].text;
    assert.ok(!text.startsWith("**Filament status for this chat**"), text.slice(0, 80));
    assert.equal(up.received.length, callsBefore + 1, "the model was called");
    assert.ok(JSON.stringify(up.received.at(-1)?.body?.messages?.at(-1)).includes("/status"), "with the words as typed");
    assert.ok(!(await shim.records()).some((x) => x.changes?.some((c) => c === "chat command /status answered by Filament, upstream not called")), "no command record");
  });

  test("a request body over server.maxBodyBytes gets a 413 in the client's format; no record, no upstream call, and the server keeps serving", async () => {
    // The socket used to be destroyed the moment the limit tripped, while the 413 was still being formatted, so
    // the client saw a connection reset and never learned why. The reply must reach it: the rest of the body is
    // drained instead of the connection being torn down.
    const recsBefore = (await shim.records()).length;
    const callsBefore = up.received.length;
    const big = (model) => ({
      model,
      max_tokens: 10,
      messages: [{ role: "user", content: "x".repeat(9000) }],
    });
    const a = await shim.post("/v1/messages", big("claude-1"));
    assert.equal(a.status, 413);
    assert.deepEqual(await a.json(), {
      type: "error",
      error: { type: "request_too_large", message: "request body too large" },
    });
    const o = await shim.post("/v1/chat/completions", big("gpt-1"));
    assert.equal(o.status, 413);
    // (fails before: yes — the bug hunt of 10-30: the HTTP status went in `error.code`, which OpenAI's error shape keeps
    // for a code's name or null, and a client that reads it as a string could not read the error at all)
    assert.deepEqual(await o.json(), {
      error: { message: "request body too large", type: "invalid_request_error", code: null },
    });
    assert.equal(
      (await shim.records()).length,
      recsBefore,
      "no record is opened for a body that never parsed",
    );
    assert.equal(up.received.length, callsBefore, "the upstream is never called");
    const ok = await shim.post("/v1/messages", {
      model: "claude-1",
      max_tokens: 10,
      messages: [{ role: "user", content: "still here" }],
    });
    assert.equal(ok.status, 200, "the server survived the oversized bodies");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A stream the upstream broke off mid-reply: what its record says, wherever it went
// ---------------------------------------------------------------------------------------------------------------
describe("a stream the upstream cut mid-reply", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let plain;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let remembering;
  const startA = { event: "message_start", data: { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } } } };
  const blockA = { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } };
  const deltaA = { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "half a rep" } } };
  const chunkO = (/** @type {any} */ delta, /** @type {string | null} */ finish = null) => ({ data: { id: "chatcmpl-x", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] } });
  /** What the upstream streams for each model: cut where its name says, or ended with no last marker. @type {Record<string, any>} */
  const replies = {
    "a-cut": { sse: [startA, blockA, deltaA] },
    "a-said": { sse: [startA, blockA, deltaA, { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } }, { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } } }] },
    "o-cut": { sse: [chunkO({ role: "assistant", content: "half a rep" })] },
    "o-said": { sse: [chunkO({ role: "assistant", content: "half a rep" }), chunkO({}, "stop")] },
    "r-cut": { sse: [{ event: "response.created", data: { type: "response.created", response: { id: "r1", object: "response", status: "in_progress", output: [] } } }, { event: "response.output_text.delta", data: { type: "response.output_text.delta", item_id: "m1", output_index: 0, content_index: 0, delta: "half a rep" } }] },
  };
  before(async () => {
    up = await fakeUpstream((call) => replies[String(call.body?.model)]);
    const configure = (/** @type {any} */ cfg) => {
      cfg.upstreams = [
        { id: "a", name: "a", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        { id: "o", name: "o", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true },
        { id: "r", name: "r", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true, wireApi: "responses" },
      ];
      cfg.routes = ["a", "o", "r"].map((id) => ({ match: `${id}-*`, upstream: id, upstreamModel: "{model}", enabled: true }));
    };
    plain = await startApp({ configure });
    remembering = await startApp({ memory: true, configure });
  });
  after(async () => {
    await plain?.stop();
    await remembering?.stop();
    await up?.close();
  });
  const said = [{ role: "user", content: "hi" }];
  /** @param {Awaited<ReturnType<typeof startApp>>} app */
  const lastRecord = async (app) => app.record((await app.records(1))[0].id);

  // (fails before: yes — the bug hunt of 10-30: wherever no translation stood between the two ends — the client's own
  // wire straight through, with memory's stages or without — a stream the upstream broke off was recorded "ok", the one
  // a translation ended as an error beside it; Traffic and the request's Details drew a cut reply as a finished one)
  test("its record says it was cut, on every wire and path; a stream that said its end with its last marker missing is finished", async () => {
    /** @type {[Awaited<ReturnType<typeof startApp>>, string, any, string][]} */
    const paths = [
      [plain, "/v1/messages", { model: "a-cut", max_tokens: 50, messages: said }, "Anthropic, straight through"],
      [plain, "/v1/chat/completions", { model: "o-cut", messages: said }, "Chat Completions, straight through"],
      [plain, "/v1/responses", { model: "r-cut", input: "hi" }, "Responses, passed through"],
      [remembering, "/v1/messages", { model: "a-cut", max_tokens: 50, messages: [{ role: "user", content: "hi, with memory on" }] }, "Anthropic, through memory's stages"],
      [plain, "/v1/chat/completions", { model: "a-cut", messages: said }, "Anthropic translated to Chat Completions"],
    ];
    for (const [app, path, body, words] of paths) {
      const r = await app.post(path, { ...body, stream: true });
      assert.equal(r.status, 200, words);
      const text = await r.text();
      const rec = await lastRecord(app);
      assert.deepEqual([rec.status, rec.error, rec.httpStatus], ["error", "incomplete upstream stream", 200], `${words}: the record says the reply was cut`);
      if (words.endsWith("straight through")) assert.ok(text.includes("half a rep") && !/incomplete upstream stream|finish_reason":"stop|message_stop/.test(text), `${words}: the client has the upstream's own bytes, nothing added`);
    }
    for (const [path, model, stop] of [["/v1/messages", "a-said", "end_turn"], ["/v1/chat/completions", "o-said", "stop"]]) {
      const r = await plain.post(path, { model, max_tokens: 50, messages: said, stream: true });
      await r.text();
      const rec = await lastRecord(plain);
      assert.deepEqual([rec.status, rec.error ?? null, rec.stopReason], ["ok", null, stop], `${model}: the reply said its end`);
    }
  });
});
