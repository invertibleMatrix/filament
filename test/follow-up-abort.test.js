// @ts-check
// A memory follow-up — Filament asking its upstream again with memory's results (dispatch/memory-loop.js `followUp`) —
// whose client is gone while it is asked or its reply read (it hung up, or a stop ended its request) is Filament's own
// end of the request, never a follow-up that failed: the record closes aborted, "client disconnected", with what its
// rounds cost so far; no provider cools down for it; nothing more goes to the provider once the request's signal has
// ended; its turn is left open, unanswered, for the client's retry, as a hang-up the upstream's read hears leaves it
// (reply.js); and what its rounds' calls returned rides the session's next request, so an Esc mid-follow-up never has
// the next turn's model run a writer of memory's again. A follow-up that fails, its client still there, ends the stream on its error and leaves the turn
// unanswered in either format, no compaction summary written; one the provider refuses goes through a first attempt's
// verdict — its ceilings, its walls, its cooldowns — and is judged by the status it refused with, as a first attempt
// refused so is — and a JSON client, shown nothing yet, is answered as the
// provider refused it, as a first attempt refused so answers it. A JSON request whose follow-up cannot reach its provider,
// or whose follow-up's reply is an error, is answered as a first attempt failing that way, never with the rounds' words
// merged, its provider judged as for that attempt, its turn left unanswered and no compaction summary archived; its
// round's calls ran once, what they returned riding the session's next request, a writer never run twice. A stream
// memory leaves out, carried straight through, whose client hangs up or is stopped while it streams is aborted with the
// tokens the stream said so far, and so is a JSON request whose client goes while its streamed reply is read. Memory's
// results deferred to the session's next request say why on the trace. On the live app with the upstream scripted; no fixed sleeps: the follow-up is held at
// the upstream, its reply's body held once begun, and memory's tool held in its run, until the test has hung up or
// stopped.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until, gate, removeDirs, fedStream } from "./helpers/wait.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";
import { forwardRequest } from "../src/adapters/providers/http.js";
import { ConcurrencyGate } from "../src/services/health.js";

/** What the first round costs: the tokens a record of it closes with. */
const USAGE = { input_tokens: 30, output_tokens: 9 };
const ASKED = "what did we decide about the cache";
const WORDS = { type: "text", text: "Let me look." };
const SEARCH = { type: "tool_use", id: "toolu_m1", name: "filament_memory_search", input: { query: "the cache" } };
/** A call of memory's that writes: run twice, it is stored twice. */
const REMEMBER = { type: "tool_use", id: "toolu_m2", name: "filament_memory_remember", input: { text: "The cache is keyed by the session id.", kind: "decision" } };
/** The words a follow-up's reply begins with. */
const FOUND = "Found it in the notes";
/** A client's ask that its model summarise the conversation: a compaction request (memory's `signalsOf`). */
const COMPACT_ASK = "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests.";
/** The provider's answer to a follow-up it failed: a 500, which cools it as it would cool it for a first attempt. */
const FELL_OVER = () => ({ status: 500, json: { error: { message: "the provider fell over" } } });
/** An event as the text of a provider's stream. @param {{ event?: string, data: any } | string} e */
const frame = (e) => (typeof e === "string" ? `${e}\n` : `${e.event ? `event: ${e.event}\n` : ""}data: ${JSON.stringify(e.data)}\n\n`);

/** The follow-up Filament sends with memory's results: its last message answers memory's call. @param {any} call */
const isFollowUp = (call) => {
  const last = call.body?.messages?.at(-1);
  return last?.role === "tool" || (Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result"));
};

/** An Anthropic stream of these blocks, as a provider sends one. @param {any[]} blocks @param {string} stop */
function anthropicSse(blocks, stop) {
  const ev = (/** @type {string} */ event, /** @type {any} */ data) => ({ event, data: { type: event, ...data } });
  const out = [ev("message_start", { message: { id: "msg_gone", type: "message", role: "assistant", model: "m-1", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: USAGE.input_tokens, output_tokens: 1 } } })];
  blocks.forEach((b, index) => {
    if (b.type === "tool_use") {
      out.push(ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }));
      out.push(ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }));
    } else if (b.type === "thinking") {
      out.push(ev("content_block_start", { index, content_block: { type: "thinking", thinking: "" } }));
      out.push(ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } }));
      out.push(ev("content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } }));
    } else {
      out.push(ev("content_block_start", { index, content_block: { type: "text", text: "" } }));
      out.push(ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } }));
    }
    out.push(ev("content_block_stop", { index }));
  });
  out.push(ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: USAGE.output_tokens } }));
  out.push(ev("message_stop", {}));
  return { sse: out };
}

/** A Chat Completions chunk, as a provider streams one. @param {any} delta @param {string | null} [finish_reason] @param {object} [extra] */
const chunk = (delta, finish_reason = null, extra = {}) => ({
  data: { id: "chatcmpl-gone", object: "chat.completion.chunk", created: 1, model: "o-1", choices: [{ index: 0, delta, finish_reason }], ...extra },
});

/** A Chat Completions stream: words, then a call of memory's, under `tool_calls`. */
function openaiSse() {
  return {
    sse: [
      chunk({ role: "assistant", content: WORDS.text }),
      chunk({ tool_calls: [{ index: 0, id: "call_m1", type: "function", function: { name: SEARCH.name, arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(SEARCH.input) } }] }),
      chunk({}, "tool_calls", { usage: { prompt_tokens: USAGE.input_tokens, completion_tokens: USAGE.output_tokens, total_tokens: USAGE.input_tokens + USAGE.output_tokens } }),
      "data: [DONE]\n",
    ],
  };
}

describe("a client gone during a memory follow-up", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The follow-up the upstream holds while a test scripts it: `arrived` once it came, answered on `released`. @type {{ arrived: ReturnType<typeof gate>, released: ReturnType<typeof gate> } | null} */
  let held = null;
  /** What the follow-up is answered where a test scripts it; the default answer in its format otherwise. @type {(() => any) | null} */
  let answer = null;
  /** What a request's first round is answered where a test scripts it; words and a call of memory's otherwise. @type {((call: any) => any) | null} */
  let opening = null;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-follow-up-"));
    up = await fakeUpstream(async (call) => {
      if (isFollowUp(call)) {
        const h = held;
        if (h) {
          h.arrived.open(call);
          await h.released.promise;
        }
        return answer?.();
      }
      if (opening && (call.kind === "anthropic" || call.kind === "openai")) return opening(call);
      if (call.kind === "openai") return openaiSse();
      const blocks = [WORDS, SEARCH];
      return call.body?.stream ? anthropicSse(blocks, "tool_use") : anthropicReply("", { model: "m-1", stop: "tool_use", blocks, usage: USAGE });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.rules.resilience.failover = true; // the backups below are tried: off until switched on (the owner's of 11-09)
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "o", name: "o", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true },
          { id: "down", name: "down", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
        ];
        cfg.routes = [
          { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "o-*", upstream: "o", upstreamModel: "{model}", enabled: true },
          { match: "s-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          // f-1 goes to down first, as down-f-1, and to m after it.
          { match: "f-*", upstream: "down", upstreamModel: "down-{model}", enabled: true, fallbacks: [{ upstream: "m", upstreamModel: "{model}" }] },
        ];
        // Memory's tools ride a client's requests.
        cfg.memory.autopilot = { ...cfg.memory.autopilot, enabled: true, tools: true, briefingTokens: 400, turnTokens: 0, cue: false };
      },
    });
  });
  after(async () => {
    held?.released.open();
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  const archive = () => /** @type {any} */ (shim.app.memory).archive;
  /** @param {string} sid */
  const chainOf = (sid) => archive().chainIdForKey(chainKeyForConversationId(sid));
  /** The calls of a model that reached the upstream, memory's follow-ups among them. */
  const modelCalls = () => up.received.filter((c) => c.kind === "anthropic" || c.kind === "openai").length;
  /**
   * A client's request over node:http, its reply read as it comes: the request, to hang up (`destroy`), the end of its
   * reply, and what came of it so far (`got`): its request's id, as its head named it, its status, its head, and its text.
   * @param {string} path @param {any} body @param {string} sid
   */
  const open = (path, body, sid) => {
    /** @type {() => void} */
    let ended = () => {};
    const done = new Promise((resolve) => (ended = () => resolve(undefined)));
    const got = { id: "", status: 0, head: /** @type {import("node:http").IncomingHttpHeaders} */ ({}), text: "" };
    const req = http.request(
      `${shim.url}${path}`,
      { method: "POST", headers: { "content-type": "application/json", "x-api-key": shim.key, "x-session-id": sid, "x-filament-cwd": root, "user-agent": "opencode/1.2" } },
      (res) => {
        got.id = String(res.headers["x-filament-request-id"] || "");
        got.status = res.statusCode || 0;
        got.head = res.headers;
        res.setEncoding("utf8");
        res.on("data", (/** @type {string} */ t) => (got.text += t));
        res.on("end", ended);
        res.on("close", ended);
      },
    );
    req.on("error", ended);
    req.end(JSON.stringify(body));
    return { req, done, got };
  };
  /** The record of the request in flight for a chat, as the store holds it. @param {string} sid @returns {any} */
  const pending = (sid) => /** @type {any[]} */ (/** @type {any} */ (shim.app.usage).records).find((r) => r.status === "pending" && r.clientSession === sid) ?? null;
  /** The id of the request in flight for a chat. @param {string} sid @returns {string | null} */
  const inFlight = (sid) => pending(sid)?.id ?? null;
  /** A request's record once it closed. @param {string} id */
  const closed = (id) =>
    until(async () => {
      const r = await shim.record(id);
      return r?.totalMs != null ? r : null;
    }, `${id}'s record closed`);
  /** The health board's line for an upstream: as fresh as a reset leaves it until something is said of it. @param {string} id */
  const healthOf = async (id) => (await (await shim.api("/api/usage/upstreams")).json()).health[id] || { failures: 0, coolingDown: false };
  /** The upstream as healthy as new: a test before it may have cooled it. @param {string} id */
  const reset = async (id) => assert.equal((await shim.api(`/api/health/${id}/reset`, { method: "POST", body: {} })).status, 200);
  /** The chat's one turn, as the archive holds it. @param {string} sid */
  const turnOf = (sid) => {
    const turns = archive().getTurns(chainOf(sid));
    assert.equal(turns.length, 1, "the request's turn is on record");
    return turns[0];
  };

  for (const [kind, path, model, upstream] of /** @type {const} */ ([
    ["an Anthropic", "/v1/messages", "m-1", "m"],
    ["a Chat Completions", "/v1/chat/completions", "o-1", "o"],
  ])) {
    // (fails before: yes — the follow-up's abort read as a follow-up that failed: an error event said "memory follow-up
    // failed", the record closed "error" at HTTP 200 and the provider cooled down for a hang-up; a Chat Completions
    // client's turn was archived as answered by the words before the error, which also ended its fold)
    test(`${kind} stream whose client hangs up while its memory follow-up is asked is aborted, with what its round cost: no provider cooled, its turn left open`, async () => {
      const sid = `gone-stream-${upstream}`;
      await reset(upstream);
      const h = (held = { arrived: gate(), released: gate() });
      try {
        const messages = upstream === "m" ? [{ role: "user", content: [{ type: "text", text: ASKED }] }] : [{ role: "user", content: ASKED }];
        const client = open(path, { model, max_tokens: 100, stream: true, messages }, sid);
        await h.arrived.promise;
        const id = inFlight(sid);
        assert.ok(id, "the request is in flight, its follow-up at the upstream");
        client.req.destroy();
        const rec = await closed(id);
        assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
        assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, USAGE.output_tokens], "it closes with what its first round cost");
        const health = await healthOf(upstream);
        assert.deepEqual([health.coolingDown, health.failures], [false, 0], `the provider is not cooled down for a hang-up: ${JSON.stringify(health)}`);
        assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered: the client's retry goes on with it");
      } finally {
        h.released.open();
        held = null;
      }
    });
  }

  // (fails before: yes — a non-streaming client gone during its follow-up was answered as if the follow-up had failed: the
  // record closed "ok", a finished reply, and its turn was archived as answered by words its client never got)
  test("a JSON request whose client hangs up while its memory follow-up is asked is aborted, with what its round cost: its turn left open", async () => {
    const sid = "gone-json";
    await reset("m");
    const h = (held = { arrived: gate(), released: gate() });
    try {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
      await h.arrived.promise;
      const id = inFlight(sid);
      assert.ok(id, "the request is in flight, its follow-up at the upstream");
      client.req.destroy();
      const rec = await closed(id);
      assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
      assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, USAGE.output_tokens], "it closes with what its first round cost");
      const health = await healthOf("m");
      assert.deepEqual([health.coolingDown, health.failures], [false, 0], `the provider is not cooled down for a hang-up: ${JSON.stringify(health)}`);
      assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered: the client's retry goes on with it");
    } finally {
      h.released.open();
      held = null;
    }
  });

  // (fails before: yes — a follow-up whose request's signal had already ended went to the provider all the same: the gate
  // handed it a free slot and forwardRequest only listened for an abort to come; the reply went on to the client, and the
  // stopped request closed "ok")
  test("a request stopped while memory's tool runs sends its follow-up nowhere, and is aborted", async () => {
    const sid = "gone-stopped";
    await reset("m");
    const memory = /** @type {any} */ (shim.app.memory);
    const search = memory.brain.search;
    const entered = gate();
    const go = gate();
    memory.brain.search = async (/** @type {any[]} */ ...args) => {
      entered.open();
      await go.promise;
      return search.apply(memory.brain, args);
    };
    const before = modelCalls();
    /** @type {ReturnType<typeof open> | null} */
    let client = null;
    try {
      client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream: true, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
      await entered.promise;
      const id = inFlight(sid);
      assert.ok(id, "the request is in flight, memory's tool running");
      const stopped = await shim.api(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
      assert.equal(stopped.status, 200, await stopped.clone().text());
      go.open();
      const rec = await closed(id);
      await client.done;
      assert.equal(modelCalls() - before, 1, "the first round alone went to the provider");
      assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
      const health = await healthOf("m");
      assert.deepEqual([health.coolingDown, health.failures], [false, 0], `the provider is not cooled down for a stop: ${JSON.stringify(health)}`);
      assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered");
    } finally {
      memory.brain.search = search;
      go.open();
      client?.req.destroy();
    }
  });

  for (const [kind, path, model, upstream, begun, spent] of /** @type {const} */ ([
    // The follow-up's message_start said its prompt: what the rounds cost so far is the first round's and that.
    ["an Anthropic", "/v1/messages", "m-1", "m", () => anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3), [USAGE.input_tokens * 2, USAGE.output_tokens + 1]],
    // A Chat Completions stream says its usage at its end alone: the first round's is what the rounds cost so far.
    ["a Chat Completions", "/v1/chat/completions", "o-1", "o", () => [chunk({ role: "assistant", content: FOUND })], [USAGE.input_tokens, USAGE.output_tokens]],
  ])) {
    // (fails before: yes — the review of 07033b682: a client that hung up once its follow-up's reply had begun, the reply's
    // body still streaming, was closed aborted with no tokens: the follow-up's read, aborted with the request, threw past
    // the stream into reply.js, which closed the record without what the rounds had cost)
    test(`${kind} stream whose client hangs up while its memory follow-up's reply streams is aborted, with what its rounds cost so far: no provider cooled, its turn left open`, async () => {
      const sid = `gone-reading-${upstream}`;
      await reset(upstream);
      const fed = fedStream(begun().map(frame));
      answer = () => fed;
      try {
        const messages = upstream === "m" ? [{ role: "user", content: [{ type: "text", text: ASKED }] }] : [{ role: "user", content: ASKED }];
        const client = open(path, { model, max_tokens: 100, stream: true, messages }, sid);
        await until(() => client.got.text.includes(FOUND), "the follow-up's first words at the client");
        const id = inFlight(sid);
        assert.ok(id, "the request is in flight, its follow-up's reply streaming");
        client.req.destroy();
        const rec = await closed(id);
        assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
        assert.deepEqual([rec.tokens?.input, rec.tokens?.output], spent, "it closes with what its rounds cost so far");
        const health = await healthOf(upstream);
        assert.deepEqual([health.coolingDown, health.failures], [false, 0], `the provider is not cooled down for a hang-up: ${JSON.stringify(health)}`);
        assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered: the client's retry goes on with it");
      } finally {
        answer = null;
        fed.end();
      }
    });
  }

  // (fails before: yes — the review of 07033b682: a stop while the follow-up's reply streamed, its client still there,
  // closed the request aborted with no tokens, as a hang-up then did)
  test("a stream stopped while its memory follow-up's reply streams is aborted, with what its rounds cost so far, and says nothing more", async () => {
    const sid = "stopped-reading";
    await reset("m");
    const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
    answer = () => fed;
    try {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream: true, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
      await until(() => client.got.text.includes(FOUND), "the follow-up's first words at the client");
      const id = inFlight(sid);
      assert.ok(id, "the request is in flight, its follow-up's reply streaming");
      const stopped = await shim.api(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
      assert.equal(stopped.status, 200, await stopped.clone().text());
      const rec = await closed(id);
      await client.done;
      assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
      assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens * 2, USAGE.output_tokens + 1], "it closes with what its rounds cost so far");
      const after = client.got.text.slice(client.got.text.indexOf(FOUND) + FOUND.length);
      assert.doesNotMatch(after, /event: error|message_stop/, "its stream ends with no error and no end of a reply");
      const steps = (rec.memoryTrace?.steps || []).map((/** @type {any} */ s) => String(s.name));
      assert.ok(steps.includes("upstream asked again with the results"), `the follow-up's reply had begun: ${steps.join(" · ")}`);
      assert.ok(!steps.some((s) => /^memory exchange/.test(s)), `a round cut short is no exchange to put back: ${steps.join(" · ")}`);
      const health = await healthOf("m");
      assert.deepEqual([health.coolingDown, health.failures], [false, 0], `the provider is not cooled down for a stop: ${JSON.stringify(health)}`);
      assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered");
    } finally {
      answer = null;
      fed.end();
    }
  });

  for (const how of /** @type {const} */ (["hangs up", "is stopped"])) {
    // (fails before: yes — the review of 07033b682: a non-streaming client gone once its follow-up's reply had begun was
    // closed aborted with no tokens; then, its read's throw caught, with its first round's alone: [30, 9] where the
    // follow-up's stream had said its prompt and the output it counts from too, [60, 10], for a hang-up and a stop alike)
    test(`a JSON request whose client ${how} while its memory follow-up's reply is read is aborted, with what its rounds and that reply's stream said so far: its turn left open`, async () => {
      const sid = `gone-reading-json-${how.length}`;
      await reset("m");
      // The follow-up's reply streams, as a provider may answer a request that asked for none: Filament reads it whole.
      const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
      answer = () => fed;
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
        const rec0 = await until(() => (Number(pending(sid)?.liveOutChars) > 0 ? pending(sid) : null), "the follow-up's first words read");
        const id = rec0.id;
        if (how === "hangs up") client.req.destroy();
        else {
          const stopped = await shim.api(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
          assert.equal(stopped.status, 200, await stopped.clone().text());
        }
        const rec = await closed(id);
        assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
        assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens * 2, USAGE.output_tokens + 1], "it closes with its first round's tokens and what the follow-up's stream said so far");
        const health = await healthOf("m");
        assert.deepEqual([health.coolingDown, health.failures], [false, 0], `the provider is not cooled down for it: ${JSON.stringify(health)}`);
        assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered: the client's retry goes on with it");
      } finally {
        answer = null;
        fed.end();
      }
    });
  }

  // (fails before: yes — the review of 14b90e384: a client gone during the follow-up had nothing deferred, its round's
  // writer stored and told to no one — the next turn's model would run remember again — 0 deferrals where 1 was due, on a
  // stream and a JSON reply, gone while the follow-up was asked or while its reply streamed)
  test("a client gone during a memory follow-up has what its rounds' calls returned ride the session's next request — a writer that ran is told, never run again — gone while the follow-up was asked or while its reply streamed — on a stream and a JSON reply", async () => {
    const brain = /** @type {any} */ (shim.app.memory).brain;
    const { remember, setDeferred } = brain;
    for (const stream of [true, false]) {
      for (const when of /** @type {const} */ (["asked", "streaming"])) {
        const what = `${stream ? "a stream" : "a JSON reply"}, gone while its follow-up ${when === "asked" ? "was asked" : "streamed"}`;
        const sid = `gone-defers-${stream}-${when}`;
        await reset("m");
        let wrote = 0;
        /** @type {string[]} */
        const deferred = [];
        brain.remember = async (/** @type {any[]} */ ...args) => {
          wrote++;
          return remember.apply(brain, args);
        };
        brain.setDeferred = (/** @type {any[]} */ ...args) => {
          deferred.push(String(args[1]));
          return setDeferred.apply(brain, args);
        };
        // Round one remembers; its follow-up is held, or its reply begins and is held.
        opening = () => (stream ? anthropicSse([WORDS, REMEMBER], "tool_use") : anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [WORDS, REMEMBER], usage: USAGE }));
        const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
        const h = when === "asked" ? (held = { arrived: gate(), released: gate() }) : null;
        if (!h) answer = () => fed;
        try {
          const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
          if (h) await h.arrived.promise;
          else if (stream) await until(() => client.got.text.includes(FOUND), `${what}: the follow-up's first words at the client`);
          else await until(() => (Number(pending(sid)?.liveOutChars) > 0 ? pending(sid) : null), `${what}: the follow-up's first words read`);
          const id = inFlight(sid);
          assert.ok(id, `${what}: in flight`);
          client.req.destroy();
          const rec = await closed(id);
          assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"], what);
          assert.equal(wrote, 1, `${what}: the writer ran once, in its round`);
          assert.equal(deferred.length, 1, `${what}: what the round's calls returned rides the session's next request: ${JSON.stringify(deferred)}`);
          assert.match(deferred[0], /^Result of filament_memory_remember\(.*\):\n\{"stored":true/, `${what}: as its round got it`);
        } finally {
          h?.released.open();
          held = null;
          answer = null;
          opening = null;
          fed.end();
          brain.remember = remember;
          brain.setDeferred = setDeferred;
        }
      }
    }
  });

  for (const how of /** @type {const} */ (["hangs up", "is stopped"])) {
    // (fails before: yes — the read, aborted with the request, threw past the JSON reply into reply.js, which closed the
    // record aborted with none of what the stream had said: tokens [0, 0] where its start had said [30, 1], for a hang-up
    // and for a stop alike)
    test(`a JSON request whose client ${how} while its streamed reply is read is aborted, with what the stream said so far: its turn left open`, async () => {
      const sid = `gone-first-read-${how.length}`;
      await reset("m");
      // The reply streams, as a provider may answer a request that asked for none: its start said its prompt and the
      // output it counts from, and its body is held once its first words are out.
      const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
      opening = () => fed;
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
        const rec0 = await until(() => (Number(pending(sid)?.liveOutChars) > 0 ? pending(sid) : null), "the reply's first words read");
        if (how === "hangs up") client.req.destroy();
        else {
          const stopped = await shim.api(`/api/requests/${encodeURIComponent(rec0.id)}/cancel`, { method: "POST", body: {} });
          assert.equal(stopped.status, 200, await stopped.clone().text());
        }
        const rec = await closed(rec0.id);
        assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
        assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, 1], "it closes with what its stream said so far: its prompt, and the output its start counted");
        const health = await healthOf("m");
        assert.deepEqual([health.coolingDown, health.failures], [false, 0], `the provider is not cooled down for it: ${JSON.stringify(health)}`);
        assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered: the client's retry goes on with it");
      } finally {
        opening = null;
        fed.end();
      }
    });
  }

  for (const [kind, path, model, upstream] of /** @type {const} */ ([
    ["an Anthropic", "/v1/messages", "m-1", "m"],
    ["a Chat Completions", "/v1/chat/completions", "o-1", "o"],
  ])) {
    // (fails before: yes, for Chat Completions — the review of 07033b682: a follow-up that failed, its client still there,
    // ended the stream on an error event that memory's fold of a Chat Completions reply read as the reply's end, and the
    // turn was archived as answered by the words of the round before it; an Anthropic stream's fold read the error as the
    // failure it is)
    test(`${kind} stream whose memory follow-up fails ends on its error, its turn left unanswered`, async () => {
      const sid = `failed-follow-up-${upstream}`;
      await reset(upstream);
      answer = FELL_OVER;
      try {
        const messages = upstream === "m" ? [{ role: "user", content: [{ type: "text", text: ASKED }] }] : [{ role: "user", content: ASKED }];
        const client = open(path, { model, max_tokens: 100, stream: true, messages }, sid);
        await client.done;
        const rec = await closed(client.got.id);
        assert.match(client.got.text, /memory follow-up failed; the reply ends here/, "its stream ends on the follow-up's failure");
        assert.match(client.got.text, /Let me look\./, "after the words of the round before it");
        assert.equal(rec.status, "error");
        assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered: no reply ended it");
      } finally {
        answer = null;
      }
    });
  }

  // (fails before: yes — the review of 07033b682: the words of the round before a failed follow-up were archived as a
  // Chat Completions compaction's summary, the session's history from then on standing on "Let me look.")
  test("a Chat Completions compaction whose memory follow-up fails archives no summary", async () => {
    const sid = "failed-follow-up-compaction";
    await reset("o");
    const first = [{ role: "user", content: ASKED }];
    // A turn of the session, its follow-up answered: the compaction would stand for it.
    const one = open("/v1/chat/completions", { model: "o-1", max_tokens: 100, stream: true, messages: first }, sid);
    await one.done;
    assert.equal((await closed(one.got.id)).status, "ok");
    answer = FELL_OVER;
    try {
      const messages = [...first, { role: "assistant", content: `${WORDS.text}\n\nMODEL ANSWER` }, { role: "user", content: COMPACT_ASK }];
      const two = open("/v1/chat/completions", { model: "o-1", max_tokens: 100, stream: true, messages }, sid);
      await two.done;
      const rec = await closed(two.got.id);
      assert.equal(rec.memory?.position, "compaction", "the request is the session's compaction");
      assert.match(two.got.text, /memory follow-up failed; the reply ends here/, "its memory follow-up failed");
      assert.equal(rec.status, "error");
      assert.deepEqual(archive().getCompactions(chainOf(sid)), [], "no summary is archived for it");
    } finally {
      answer = null;
    }
  });

  // (fails before: yes — the round's calls, run in their round, ran again once its follow-up failed, to ride the session's
  // next request: the writer ran twice, 2 !== 1, and a remember was stored twice)
  test("a JSON request whose memory follow-up cannot reach its provider runs its round's calls once: a writer writes once, what it returned riding the session's next request", async () => {
    const sid = "failed-follow-up-writer";
    await reset("m");
    const brain = /** @type {any} */ (shim.app.memory).brain;
    const { remember, setDeferred } = brain;
    let wrote = 0;
    /** @type {string[]} */
    const deferred = [];
    brain.remember = async (/** @type {any[]} */ ...args) => {
      wrote++;
      return remember.apply(brain, args);
    };
    brain.setDeferred = (/** @type {any[]} */ ...args) => {
      deferred.push(String(args[1]));
      return setDeferred.apply(brain, args);
    };
    opening = () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [WORDS, REMEMBER], usage: USAGE });
    answer = () => ({ drop: true });
    try {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
      await client.done;
      const rec = await closed(client.got.id);
      assert.deepEqual([rec.status, rec.httpStatus], ["error", 502], "its client is answered as a first attempt that cannot reach its provider");
      assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered");
      assert.equal(wrote, 1, "the writer ran once, in its round");
      assert.equal(deferred.length, 1, `what the round's calls returned rides the session's next request: ${JSON.stringify(deferred)}`);
      assert.match(deferred[0], /^Result of filament_memory_remember\(.*\):\n\{"stored":true/, "the writer's result, as its round got it");
    } finally {
      brain.remember = remember;
      brain.setDeferred = setDeferred;
      opening = null;
      answer = null;
    }
  });

  for (const [how, failure] of /** @type {const} */ ([
    ["the provider refuses", FELL_OVER],
    ["cannot reach its provider", () => ({ drop: true })],
  ])) {
    // (fails before: yes — a stream's failed follow-up deferred nothing, refused or out of reach: no result rode the
    // session's next request, 0 !== 1, so the client's retry could run the writer again)
    test(`a stream whose memory follow-up ${how} rides what its round's calls returned on the session's next request, as the round got them: a writer runs once`, async () => {
      const sid = `failed-stream-writer-${how.length}`;
      await reset("m");
      const brain = /** @type {any} */ (shim.app.memory).brain;
      const { remember, setDeferred } = brain;
      let wrote = 0;
      /** @type {string[]} */
      const deferred = [];
      brain.remember = async (/** @type {any[]} */ ...args) => {
        wrote++;
        return remember.apply(brain, args);
      };
      brain.setDeferred = (/** @type {any[]} */ ...args) => {
        deferred.push(String(args[1]));
        return setDeferred.apply(brain, args);
      };
      opening = () => anthropicSse([WORDS, REMEMBER], "tool_use");
      answer = failure;
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream: true, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
        await client.done;
        const rec = await closed(client.got.id);
        assert.match(client.got.text, /memory follow-up failed; the reply ends here/, "its stream ends on the follow-up's failure");
        assert.equal(rec.status, "error");
        assert.equal(wrote, 1, "the writer ran once, in its round");
        assert.equal(deferred.length, 1, `what the round's calls returned rides the session's next request: ${JSON.stringify(deferred)}`);
        assert.match(deferred[0], /^Result of filament_memory_remember\(.*\):\n\{"stored":true/, "the writer's result, as its round got it");
        assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered");
      } finally {
        brain.remember = remember;
        brain.setDeferred = setDeferred;
        opening = null;
        answer = null;
      }
    });
  }

  // (fails before: yes — reply.js answered 502 with no head of a failure: no x-filament-request-id, nor the provider its
  // failure was, so Filament's own loops read a provider's broken reply as Filament's refusal and never tried it again)
  test("a JSON reply that fails on its way is answered 502 in the head a failure says: its request named, and the provider it met where the failure was the provider's", async () => {
    const usage = /** @type {any} */ (shim.app.usage);
    const progress = usage.progress;
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    // Filament's own record store fails while the reply is read: Filament's failure, which names no provider.
    await reset("m");
    opening = () => anthropicSse([{ type: "text", text: FOUND }], "end_turn");
    usage.progress = () => {
      usage.progress = progress;
      throw new Error("the record store failed");
    };
    try {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages }, "own-throw-head");
      await client.done;
      assert.equal(client.got.status, 502);
      assert.ok(client.got.head["x-filament-request-id"], `its request is named: ${JSON.stringify(client.got.head)}`);
      assert.equal(client.got.head["x-filament-upstream"], undefined, "Filament's own failure names no provider");
      const rec = await closed(client.got.id);
      assert.deepEqual([rec.status, rec.httpStatus, rec.error], ["error", 502, "the record store failed"]);
    } finally {
      usage.progress = progress;
      opening = null;
    }
    // The provider falls silent mid-reply: the provider's failure, named.
    await reset("m");
    const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
    opening = () => fed;
    process.env.FILAMENT_SILENT_REPLY_MS = "300";
    try {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages }, "silent-head");
      await client.done;
      assert.equal(client.got.status, 502);
      assert.ok(client.got.head["x-filament-request-id"], `its request is named: ${JSON.stringify(client.got.head)}`);
      assert.equal(client.got.head["x-filament-upstream"], "m", "the provider it met is named");
      const rec = await closed(client.got.id);
      assert.deepEqual([rec.status, rec.httpStatus], ["error", 502]);
    } finally {
      delete process.env.FILAMENT_SILENT_REPLY_MS;
      opening = null;
      fed.end();
    }
  });

  // (fails before: yes — the review of b1f4c556b: the failed read threw past the reply into reply.js, which closed the
  // record with none of what the streams said — tokens [0, 0] where [30, 1] was said, or [60, 10] with a follow-up's
  // round — on a stream and a JSON reply alike; a follow-up's so failing noted no memory round and deferred nothing,
  // though its round's writer had run)
  test("a reply whose read fails mid-reply, its client still there, keeps what its streams said on its record; a follow-up's so failing is a follow-up that failed — on a stream and a JSON reply", async () => {
    const brain = /** @type {any} */ (shim.app.memory).brain;
    const { remember, setDeferred } = brain;
    const SILENT = "it sent nothing for 0.3 s mid-reply";
    for (const stream of [true, false]) {
      for (const where of /** @type {const} */ (["first reply", "follow-up's reply"])) {
        const what = `${stream ? "a stream" : "a JSON reply"}, its ${where}`;
        const sid = `broken-read-${stream}-${where.length}`;
        await reset("m");
        let wrote = 0;
        /** @type {string[]} */
        const deferred = [];
        brain.remember = async (/** @type {any[]} */ ...args) => {
          wrote++;
          return remember.apply(brain, args);
        };
        brain.setDeferred = (/** @type {any[]} */ ...args) => {
          deferred.push(String(args[1]));
          return setDeferred.apply(brain, args);
        };
        // The broken reply says its prompt and the output it counts from, then nothing more until the silence cuts it.
        const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
        if (where === "first reply") opening = () => fed;
        else {
          opening = () => (stream ? anthropicSse([WORDS, REMEMBER], "tool_use") : anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [WORDS, REMEMBER], usage: USAGE }));
          answer = () => fed;
        }
        process.env.FILAMENT_SILENT_REPLY_MS = "300";
        try {
          const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
          await client.done;
          if (stream) assert.match(client.got.text, /it sent nothing for 0\.3 s mid-reply/, `${what}: its stream ends on the failure's words`);
          else {
            assert.equal(client.got.status, 502, `${what}: answered 502`);
            assert.deepEqual([JSON.parse(client.got.text).error.message, client.got.head["x-filament-upstream"]], [`stream failure: ${SILENT}`, "m"], `${what}: as a reply whose read failed is`);
          }
          const rec = await closed(client.got.id);
          assert.deepEqual([rec.status, rec.httpStatus, rec.error], ["error", stream ? 200 : 502, SILENT], `${what}: its record closes on the failure`);
          const spent = where === "first reply" ? [USAGE.input_tokens, 1] : [USAGE.input_tokens * 2, USAGE.output_tokens + 1];
          assert.deepEqual([rec.tokens?.input, rec.tokens?.output], spent, `${what}: with what its streams said so far`);
          const health = await healthOf("m");
          assert.deepEqual([health.coolingDown, health.failures], [true, 1], `${what}: the provider is judged as by a stream that broke off: ${JSON.stringify(health)}`);
          assert.equal(turnOf(sid).final_hash ?? null, null, `${what}: its turn is left unanswered`);
          if (where === "follow-up's reply") {
            assert.equal(rec.memory?.toolRounds, 1, `${what}: its memory round is on the record`);
            assert.equal(wrote, 1, `${what}: the writer ran once, in its round`);
            assert.equal(deferred.length, 1, `${what}: what the round's calls returned rides the session's next request: ${JSON.stringify(deferred)}`);
            assert.match(deferred[0], /^Result of filament_memory_remember\(.*\):\n\{"stored":true/, `${what}: as its round got it`);
          }
        } finally {
          delete process.env.FILAMENT_SILENT_REPLY_MS;
          brain.remember = remember;
          brain.setDeferred = setDeferred;
          opening = null;
          answer = null;
          fed.end();
        }
      }
    }
  });

  // (fails before: yes — reply.js closed Filament's own throw with no status, which finish.js read as a stream that broke
  // off: the record store's failure cooled the provider down, 1 failure, on a stream and a JSON reply alike; the silence's
  // cases held then as now)
  test("a throw of Filament's own while a reply is delivered judges no provider, its record the failure in its words; a provider's reply cut by its silence still judges it — on a stream and a JSON reply", async () => {
    const usage = /** @type {any} */ (shim.app.usage);
    const progress = usage.progress;
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    /** A chat's one request once it closed, found by its chat: a reply that failed before its head names no request. @param {string} sid */
    const closedFor = (sid) => until(() => /** @type {any[]} */ (usage.records).find((r) => r.clientSession === sid && r.totalMs != null) ?? null, `${sid}'s record closed`);
    for (const stream of [true, false]) {
      // Filament's own record store fails while the reply streams in.
      await reset("m");
      opening = () => anthropicSse([{ type: "text", text: FOUND }], "end_turn");
      usage.progress = () => {
        usage.progress = progress;
        throw new Error("the record store failed");
      };
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, `own-throw-${stream}`);
        await client.done;
        const rec = await closedFor(`own-throw-${stream}`);
        assert.deepEqual([rec.status, rec.error], ["error", "the record store failed"], `${stream ? "a stream" : "a JSON reply"}: the failure in its words`);
        const health = await healthOf("m");
        assert.deepEqual([health.coolingDown, health.failures], [false, 0], `${stream ? "a stream" : "a JSON reply"}: no provider judged for Filament's own throw: ${JSON.stringify(health)}`);
      } finally {
        usage.progress = progress;
        opening = null;
      }
      // The provider falls silent mid-reply, and the read fails with the silence's error: the provider's failure.
      await reset("m");
      const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
      opening = () => fed;
      process.env.FILAMENT_SILENT_REPLY_MS = "300";
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, `silent-${stream}`);
        await client.done;
        const rec = await closedFor(`silent-${stream}`);
        assert.deepEqual([rec.status, rec.error], ["error", "it sent nothing for 0.3 s mid-reply"], `${stream ? "a stream" : "a JSON reply"}: the silence's words`);
        const health = await healthOf("m");
        assert.deepEqual([health.coolingDown, health.failures], [true, 1], `${stream ? "a stream" : "a JSON reply"}: the provider is judged for its silence: ${JSON.stringify(health)}`);
      } finally {
        delete process.env.FILAMENT_SILENT_REPLY_MS;
        opening = null;
        fed.end();
      }
    }
  });

  // (fails before: yes — the review of 14b90e384: reply.js closed the record on Filament's own throw with none of what the
  // reply had cost: tokens [0, 0] where the provider had said [30, 1] — and [60, 10] where a memory round was paid before
  // the follow-up's stream met the throw — on a stream and a JSON reply alike)
  test("a throw of Filament's own mid-reply closes the record with what the reply cost so far — its first round's stream, or the rounds paid before the follow-up's — on a stream and a JSON reply", async () => {
    const usage = /** @type {any} */ (shim.app.usage);
    const progress = usage.progress;
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    for (const stream of [true, false]) {
      for (const where of /** @type {const} */ (["first reply", "follow-up's reply"])) {
        const what = `${stream ? "a stream" : "a JSON reply"}, its ${where}`;
        const sid = `own-throw-spent-${stream}-${where.length}`;
        await reset("m");
        // The reply that meets the throw says its prompt and the output it counts from, then is held.
        const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
        let reached = where === "first reply";
        if (where === "first reply") opening = () => fed;
        else {
          opening = () => (stream ? anthropicSse([WORDS, SEARCH], "tool_use") : anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [WORDS, SEARCH], usage: USAGE }));
          answer = () => {
            reached = true;
            return fed;
          };
        }
        // Filament's own record store fails as that reply streams in.
        usage.progress = (/** @type {any} */ rec, /** @type {any} */ p) => {
          if (rec?.clientSession !== sid || !reached) return progress.call(usage, rec, p);
          usage.progress = progress;
          throw new Error("the record store failed");
        };
        try {
          const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, sid);
          await client.done;
          const rec = await until(() => /** @type {any[]} */ (usage.records).find((r) => r.clientSession === sid && r.totalMs != null) ?? null, `${sid}'s record closed`);
          assert.deepEqual([rec.status, rec.error], ["error", "the record store failed"], `${what}: the failure in its words`);
          const spent = where === "first reply" ? [USAGE.input_tokens, 1] : [USAGE.input_tokens * 2, USAGE.output_tokens + 1];
          assert.deepEqual([rec.tokens?.input, rec.tokens?.output], spent, `${what}: with what the reply cost so far`);
        } finally {
          usage.progress = progress;
          opening = null;
          answer = null;
          fed.end();
        }
      }
    }
  });

  // (fails before: yes — the review of a9afebe80: reply.js wrote the failure's error event after the reply's end, and the
  // response emitted ERR_STREAM_WRITE_AFTER_END as an error event no one listened for — an uncaught exception, which ends
  // the process, on a stream and a JSON reply alike)
  test("a throw of Filament's own once the reply went out whole — its record's persist failing — writes nothing after the reply's end: no error escapes to the process — on a stream and a JSON reply", async () => {
    const usage = /** @type {any} */ (shim.app.usage);
    const persist = usage.persist;
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    /** What escaped to the process while the replies went out. @type {any[]} */
    const escaped = [];
    const onEscape = (/** @type {any} */ e) => escaped.push(e);
    process.on("uncaughtException", onEscape);
    try {
      for (const stream of [true, false]) {
        const what = stream ? "a stream" : "a JSON reply";
        const sid = `persist-throw-${stream}`;
        await reset("m");
        opening = () => anthropicSse([{ type: "text", text: FOUND }], "end_turn");
        // The record store fails to write the request's record as it closes, once its reply has gone out.
        usage.persist = (/** @type {any} */ rec) => {
          if (rec.clientSession !== sid) return persist.call(usage, rec);
          usage.persist = persist;
          throw new Error("the record store could not write the record");
        };
        try {
          const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, sid);
          await client.done;
          assert.equal(client.got.status, 200, `${what}: answered 200`);
          if (stream) assert.match(client.got.text, /event: message_stop/, `${what}: its stream went out whole`);
          else assert.equal(JSON.parse(client.got.text).content?.[0]?.text, FOUND, `${what}: its reply went out whole`);
          const rec = await closed(client.got.id);
          assert.deepEqual([rec.status, rec.httpStatus], ["ok", 200], `${what}: its record closed as the reply went out`);
          await new Promise((r) => setTimeout(r, 20));
          assert.deepEqual(escaped.map((e) => e?.code || String(e?.message || e)), [], `${what}: nothing was written after the reply's end`);
        } finally {
          usage.persist = persist;
          opening = null;
        }
      }
    } finally {
      process.off("uncaughtException", onEscape);
    }
  });

  // (fails before: yes — the review of faa5dc08a: the failure was logged as a stream that failed, at an error's level —
  // "stream failure: the record store could not write the record", level error — though the reply had gone out whole)
  test("a throw of Filament's own after the reply went out whole is logged as what it is — Filament's own failure after the reply ended — at a warning's level, never as a stream that failed — on a stream and a JSON reply", async () => {
    const usage = /** @type {any} */ (shim.app.usage);
    const ops = /** @type {any} */ (shim.app.ops);
    const persist = usage.persist;
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    try {
      for (const stream of [true, false]) {
        const what = stream ? "a stream" : "a JSON reply";
        const sid = `after-end-log-${stream}`;
        await reset("m");
        opening = () => anthropicSse([{ type: "text", text: FOUND }], "end_turn");
        usage.persist = (/** @type {any} */ rec) => {
          if (rec.clientSession !== sid) return persist.call(usage, rec);
          usage.persist = persist;
          throw new Error("the record store could not write the record");
        };
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, sid);
        await client.done;
        assert.equal(client.got.status, 200, `${what}: answered 200`);
        await closed(client.got.id);
        const said = /** @type {any[]} */ (ops.list({ kinds: "log", limit: 50 })).filter((o) => String(o.title).startsWith(`${client.got.id} `));
        assert.deepEqual(
          said.map((o) => [o.level, o.title]),
          [["warn", `${client.got.id} Filament's own failure after the reply ended: the record store could not write the record`]],
          `${what}: the log says what it was`,
        );
        usage.persist = persist;
      }
    } finally {
      usage.persist = persist;
      opening = null;
    }
  });

  // (fails before: yes — finish ran again for the record the reply path's catch closed again, its ledgers with it: the
  // turn's facts took the request in twice — 2 requests and 60 tokens of input where it was 1 and 30 — on a stream and a
  // JSON reply alike)
  test("a record's close happens once: a ledger that throws after the turn's facts took the request in — its running mark's — takes it in no second time when the reply path closes the record again — on a stream and a JSON reply", async () => {
    const memory = /** @type {any} */ (shim.app.memory);
    const turnStopped = memory.turnStopped;
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    try {
      for (const stream of [true, false]) {
        const what = stream ? "a stream" : "a JSON reply";
        const sid = `close-once-${stream}`;
        await reset("m");
        opening = () => anthropicSse([{ type: "text", text: FOUND }], "end_turn");
        // The turn's running mark cannot be cleared the first time the request's record closes.
        let threw = 0;
        memory.turnStopped = function (/** @type {any} */ rec) {
          if (rec?.clientSession === sid && threw === 0) {
            threw++;
            throw new Error("the turn's running mark could not be cleared");
          }
          return turnStopped.call(this, rec);
        };
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, sid);
        await client.done;
        assert.equal(client.got.status, 200, `${what}: answered 200`);
        await closed(client.got.id);
        assert.equal(threw, 1, `${what}: the ledger threw`);
        const facts = turnOf(sid).meta?.facts;
        assert.deepEqual([facts?.requests, facts?.tokens?.input], [1, USAGE.input_tokens], `${what}: the request is on its turn's facts once: ${JSON.stringify(facts)}`);
        memory.turnStopped = turnStopped;
      }
    } finally {
      memory.turnStopped = turnStopped;
      opening = null;
    }
  });

  // (fails before: no — a guard of the close's parts: a close that ended at its first throw, the record closing once,
  // would leave a record whose store's write failed off its turn's facts and its turn running)
  test("a record whose store fails to write it still has the rest of its close: its turn's facts take it in once, and its turn runs no more — on a stream and a JSON reply", async () => {
    const usage = /** @type {any} */ (shim.app.usage);
    const persist = usage.persist;
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    try {
      for (const stream of [true, false]) {
        const what = stream ? "a stream" : "a JSON reply";
        const sid = `store-throws-${stream}`;
        await reset("m");
        opening = () => anthropicSse([{ type: "text", text: FOUND }], "end_turn");
        usage.persist = (/** @type {any} */ rec) => {
          if (rec.clientSession !== sid) return persist.call(usage, rec);
          usage.persist = persist;
          throw new Error("the record store could not write the record");
        };
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, sid);
        await client.done;
        assert.equal(client.got.status, 200, `${what}: answered 200`);
        await closed(client.got.id);
        const turn = turnOf(sid);
        assert.deepEqual([turn.meta?.facts?.requests, turn.meta?.running ?? null], [1, null], `${what}: on its turn's facts once, its turn no longer running: ${JSON.stringify(turn.meta)}`);
        usage.persist = persist;
      }
    } finally {
      usage.persist = persist;
      opening = null;
    }
  });

  // (fails before: yes — the review of a9afebe80: memory's follow-up opened the record's changes again with the notes
  // gathered so far, the failover's line not among them: the record of a reply its backup served said nothing of the
  // failover once memory's round ran, 0 !== 1, on a stream and a JSON reply alike)
  test("a reply its backup served keeps the failover's line on its record when memory's round runs — on a stream and a JSON reply", async () => {
    const SERVED = "failover: served by m (#2 in order) after down failed with HTTP 500";
    try {
      for (const stream of [true, false]) {
        const what = stream ? "a stream" : "a JSON reply";
        await reset("down");
        await reset("m");
        // down falls over; m answers with words and a call of memory's, and its follow-up as it answers by default.
        opening = (call) =>
          call.body?.model === "down-f-1"
            ? FELL_OVER()
            : call.body?.stream
              ? anthropicSse([WORDS, SEARCH], "tool_use")
              : anthropicReply("", { model: "f-1", stop: "tool_use", blocks: [WORDS, SEARCH], usage: USAGE });
        try {
          const client = open("/v1/messages", { model: "f-1", max_tokens: 100, stream, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, `served-by-${stream}`);
          await client.done;
          assert.equal(client.got.status, 200, `${what}: answered 200`);
          const rec = await closed(client.got.id);
          assert.deepEqual([rec.status, rec.upstream, rec.failover?.servedBy, rec.memory?.toolRounds], ["ok", "m", "m", 1], `${what}: its backup served it, memory's round run`);
          assert.equal(rec.changes.filter((/** @type {string} */ c) => c === SERVED).length, 1, `${what}: the failover's line is on its record once: ${rec.changes.join(" | ")}`);
        } finally {
          opening = null;
        }
      }
    } finally {
      await reset("down");
    }
  });

  for (const [how, cutAt] of /** @type {const} */ ([
    ["says an error mid-reply", true],
    ["is cut before its end", false],
  ])) {
    // (fails before: yes — the follow-up's broken reply was taken for the round's end: its exchange was put back as finished,
    // "memory exchange recorded" with the broken words as its final, and nothing was deferred, 0 !== 1, for an error said
    // and a stream cut alike)
    test(`a stream whose memory follow-up's reply ${how} is a follow-up that failed: its round's results ride the session's next request, the exchange put back ending before that round`, async () => {
      const sid = `broken-follow-up-${how.length}`;
      // Signed thinking, which the exchange put back is found by.
      const think = (/** @type {number} */ n) => ({ type: "thinking", thinking: `Round ${n}.`, signature: `SIG_${n}_${sid}` });
      // The follow-up's reply: its thinking and its first words, then an error event or nothing more.
      const begun = anthropicSse([think(2), { type: "text", text: FOUND }], "end_turn").sse.slice(0, 7);
      const broken = () => ({ sse: cutAt ? [...begun, { event: "error", data: { type: "error", error: { type: "api_error", message: "the provider fell over mid-reply" } } }] : begun });
      await reset("m");
      const brain = /** @type {any} */ (shim.app.memory).brain;
      const { remember, setDeferred } = brain;
      let wrote = 0;
      /** @type {string[]} */
      const deferred = [];
      brain.remember = async (/** @type {any[]} */ ...args) => {
        wrote++;
        return remember.apply(brain, args);
      };
      brain.setDeferred = (/** @type {any[]} */ ...args) => {
        deferred.push(String(args[1]));
        return setDeferred.apply(brain, args);
      };
      opening = () => anthropicSse([think(1), WORDS, REMEMBER], "tool_use");
      answer = broken;
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 2048, stream: true, thinking: { type: "enabled", budget_tokens: 1024 }, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
        await client.done;
        const rec = await closed(client.got.id);
        assert.equal(rec.status, "error", "its record closes on the broken reply");
        assert.equal(wrote, 1, "the writer ran once, in its round");
        assert.equal(deferred.length, 1, `what the round's calls returned rides the session's next request: ${JSON.stringify(deferred)}`);
        assert.match(deferred[0], /^Result of filament_memory_remember\(.*\):\n\{"stored":true/, "as its round got it");
        const steps = (rec.memoryTrace?.steps || []).map((/** @type {any} */ s) => String(s.name));
        assert.ok(!steps.includes("memory exchange recorded"), `the exchange put back ends before the round its reply never answered: ${steps.join(" · ")}`);
        assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered");
      } finally {
        brain.remember = remember;
        brain.setDeferred = setDeferred;
        opening = null;
        answer = null;
      }
    });
  }

  // (fails before: yes — the review of b1f4c556b: only the newest round's results rode the session's next request, the
  // second round's search; the first round's remember, stored, was told to no one)
  test("a follow-up that fails after rounds before it rides every round's results on the session's next request, as each round got them — on a stream and a JSON reply", async () => {
    const brain = /** @type {any} */ (shim.app.memory).brain;
    const { setDeferred } = brain;
    for (const stream of [true, false]) {
      const sid = `every-round-${stream}`;
      await reset("m");
      /** @type {string[]} */
      const deferred = [];
      brain.setDeferred = (/** @type {any[]} */ ...args) => {
        deferred.push(String(args[1]));
        return setDeferred.apply(brain, args);
      };
      // Round one remembers; its follow-up's round searches; that round's follow-up the provider refuses.
      const searchAgain = { ...SEARCH, id: `toolu_again_${stream}` };
      opening = () => (stream ? anthropicSse([WORDS, REMEMBER], "tool_use") : anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [WORDS, REMEMBER], usage: USAGE }));
      let asks = 0;
      answer = () => (++asks === 1 ? (stream ? anthropicSse([{ type: "text", text: "One more look." }, searchAgain], "tool_use") : anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "text", text: "One more look." }, searchAgain], usage: USAGE })) : FELL_OVER());
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
        await client.done;
        await closed(client.got.id);
        assert.equal(asks, 2, `${stream ? "a stream" : "a JSON reply"}: two follow-ups went, the second refused`);
        assert.equal(deferred.length, 1, `${stream ? "a stream" : "a JSON reply"}: one deferral: ${JSON.stringify(deferred)}`);
        assert.match(deferred[0], /Result of filament_memory_remember\(/, `${stream ? "a stream" : "a JSON reply"}: the first round's writer's result rides it`);
        assert.match(deferred[0], /Result of filament_memory_search\(/, `${stream ? "a stream" : "a JSON reply"}: and the second round's`);
      } finally {
        brain.setDeferred = setDeferred;
        opening = null;
        answer = null;
      }
    }
  });

  // (fails before: yes — the review of b1f4c556b: the round ran for a client already gone, its writer storing a memory,
  // 1 !== 0, before the follow-up found the client gone)
  test("a JSON request whose client is gone once its reply said its end runs no further memory round: a writer never runs for it", async () => {
    const sid = "gone-before-round";
    await reset("m");
    const brain = /** @type {any} */ (shim.app.memory).brain;
    const { remember } = brain;
    let wrote = 0;
    brain.remember = async (/** @type {any[]} */ ...args) => {
      wrote++;
      return remember.apply(brain, args);
    };
    // The whole reply, its end said, in one piece — its connection held open after it: the read waits on, with nothing left to say.
    const fed = fedStream([anthropicSse([WORDS, REMEMBER], "tool_use").sse.map(frame).join("")]);
    opening = () => fed;
    try {
      open("/v1/messages", { model: "m-1", max_tokens: 100, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
      const rec0 = await until(() => (Number(pending(sid)?.liveOutChars) >= WORDS.text.length ? pending(sid) : null), "the whole reply read");
      const stopped = await shim.api(`/api/requests/${encodeURIComponent(rec0.id)}/cancel`, { method: "POST", body: {} });
      assert.equal(stopped.status, 200, await stopped.clone().text());
      const rec = await closed(rec0.id);
      assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
      assert.equal(wrote, 0, "the round its client did not wait for never ran: no memory was written for it");
      assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, USAGE.output_tokens], "it closes with what its reply cost");
    } finally {
      brain.remember = remember;
      opening = null;
      fed.end();
    }
  });

  // (fails before: yes — the review of b1f4c556b: the follow-up read its client's signal alone, so a call aborted on its
  // way was a provider out of reach: the stream ended on "memory follow-up failed" and the JSON reply on "upstream m
  // unreachable: This operation was aborted", each closed "error" with its provider cooled down, where a first attempt so
  // aborted closed "aborted", "client disconnected", its provider judged nothing)
  test("a memory follow-up whose call is aborted, the client's signal standing or not, ends as a first attempt so aborted does — on a stream and a JSON reply", async () => {
    const usage = /** @type {any} */ (shim.app.usage);
    const realFetch = globalThis.fetch;
    /** Which calls to the provider abort, as a request aborted on its way: by their body. */
    let aborts = (/** @type {any} */ _body) => false;
    globalThis.fetch = /** @type {any} */ ((/** @type {any} */ url, /** @type {any} */ init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (String(url).startsWith(up.url) && aborts(body)) return Promise.reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      return realFetch(url, init);
    });
    /** A chat's one request once it closed, found by its chat: a reply aborted names no request. @param {string} sid */
    const closedFor = (sid) => until(() => /** @type {any[]} */ (usage.records).find((r) => r.clientSession === sid && r.totalMs != null) ?? null, `${sid}'s record closed`);
    /** How the request closed and how its provider is judged. @param {string} sid @param {boolean} stream */
    const outcome = async (sid, stream) => {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
      await client.done;
      const rec = await closedFor(sid);
      const health = await healthOf("m");
      return { closed: [rec.status, rec.error], judged: [health.coolingDown, health.failures], said: /memory follow-up failed/.test(client.got.text) };
    };
    try {
      for (const stream of [true, false]) {
        await reset("m");
        aborts = () => true;
        const first = await outcome(`aborted-first-${stream}`, stream);
        await reset("m");
        aborts = (body) => isFollowUp({ body });
        const followed = await outcome(`aborted-follow-up-${stream}`, stream);
        assert.deepEqual([followed.closed, followed.judged, followed.said], [first.closed, first.judged, false], `${stream ? "a stream" : "a JSON reply"}: as the first attempt so aborted (${JSON.stringify(first)}): ${JSON.stringify(followed)}`);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // (fails before: yes — the review of b1f4c556b: the follow-up's error went out in the first round's head, request-id
  // req_first where its own said req_follow, and the record kept the first round's provider metadata)
  test("a JSON request answered with its memory follow-up's error goes out in that reply's own head, its record keeping what that head said of the provider", async () => {
    const sid = "follow-up-head";
    await reset("m");
    opening = () => ({ ...anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [WORDS, SEARCH], usage: USAGE }), headers: { "request-id": "req_first" } });
    answer = () => ({ json: { type: "error", error: { type: "api_error", message: "the provider fell over mid-reply" } }, headers: { "request-id": "req_follow" } });
    try {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
      await client.done;
      assert.equal(client.got.status, 502, client.got.text);
      assert.equal(client.got.head["request-id"], "req_follow", "the reply the client is answered with names its own request at the provider");
      const rec = await closed(client.got.id);
      assert.equal(rec.providerMeta?.["request-id"], "req_follow", `the record keeps what that reply's head said: ${JSON.stringify(rec.providerMeta)}`);
    } finally {
      opening = null;
      answer = null;
    }
  });

  // (fails before: yes — the merged rounds went out in the first round's head, request-id req_first and 41 requests left
  // where the reply they end on said req_follow and 40, and the record kept the first round's provider metadata)
  test("a JSON request's merged memory rounds go out in the head of the reply they end on, its record keeping what that head said of the provider", async () => {
    const sid = "merged-head";
    await reset("m");
    opening = () => ({ ...anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [WORDS, SEARCH], usage: USAGE }), headers: { "request-id": "req_first", "anthropic-ratelimit-requests-remaining": "41" } });
    answer = () => ({ ...anthropicReply(FOUND, { model: "m-1", usage: USAGE }), headers: { "request-id": "req_follow", "anthropic-ratelimit-requests-remaining": "40" } });
    try {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages: [{ role: "user", content: [{ type: "text", text: ASKED }] }] }, sid);
      await client.done;
      assert.equal(client.got.status, 200, client.got.text);
      assert.ok(JSON.parse(client.got.text).content.some((/** @type {any} */ b) => b.text === FOUND), `the rounds merged: ${client.got.text}`);
      assert.deepEqual(
        [client.got.head["request-id"], client.got.head["anthropic-ratelimit-requests-remaining"], client.got.head["x-filament-upstream"]],
        ["req_follow", "40", "m"],
        "the reply goes out in the head of the reply it ends on: its request at the provider, its limits as they stand",
      );
      const rec = await closed(client.got.id);
      assert.equal(rec.memory?.toolRounds, 1, "memory's round ran");
      assert.deepEqual([rec.providerMeta?.["request-id"], rec.providerMeta?.["anthropic-ratelimit-requests-remaining"]], ["req_follow", "40"], `the record keeps what that head said: ${JSON.stringify(rec.providerMeta)}`);
    } finally {
      opening = null;
      answer = null;
    }
  });

  // (fails before: yes — the review of a9afebe80: a finish_reason of "error" said the round's end, so the memory call the
  // broken reply had begun ran with its cut input and another follow-up was asked after the client had the error, round
  // after round to the round limit: 4 follow-ups where 1 went)
  test("a Chat Completions follow-up whose stream says an error and its end is a follow-up that failed: no memory call it began runs, and its round's results ride the session's next request", async () => {
    const sid = "error-and-end";
    await reset("o");
    const brain = /** @type {any} */ (shim.app.memory).brain;
    const { remember, setDeferred } = brain;
    let wrote = 0;
    /** @type {string[]} */
    const deferred = [];
    brain.remember = async (/** @type {any[]} */ ...args) => {
      wrote++;
      return remember.apply(brain, args);
    };
    brain.setDeferred = (/** @type {any[]} */ ...args) => {
      deferred.push(String(args[1]));
      return setDeferred.apply(brain, args);
    };
    opening = () => ({
      sse: [
        chunk({ role: "assistant", content: WORDS.text }),
        chunk({ tool_calls: [{ index: 0, id: "call_r1", type: "function", function: { name: REMEMBER.name, arguments: JSON.stringify(REMEMBER.input) } }] }),
        chunk({}, "tool_calls", { usage: { prompt_tokens: USAGE.input_tokens, completion_tokens: USAGE.output_tokens, total_tokens: USAGE.input_tokens + USAGE.output_tokens } }),
        "data: [DONE]\n",
      ],
    });
    // The follow-up's reply begins words and a call of memory's, then says an error with its end, as OpenRouter's does.
    let asks = 0;
    answer = () => {
      asks++;
      return {
        sse: [
          chunk({ role: "assistant", content: FOUND }),
          chunk({ tool_calls: [{ index: 0, id: `call_s${asks}`, type: "function", function: { name: SEARCH.name, arguments: '{"query": "the ca' } }] }),
          { data: { id: "chatcmpl-gone", object: "chat.completion.chunk", created: 1, model: "o-1", error: { message: "the provider fell over mid-reply", code: 502 }, choices: [{ index: 0, delta: {}, finish_reason: "error" }] } },
          "data: [DONE]\n",
        ],
      };
    };
    try {
      const client = open("/v1/chat/completions", { model: "o-1", max_tokens: 100, stream: true, messages: [{ role: "user", content: ASKED }] }, sid);
      await client.done;
      const rec = await closed(client.got.id);
      assert.equal(asks, 1, "one follow-up: the memory call its broken reply began never ran, and nothing more was asked");
      assert.equal(rec.status, "error");
      assert.equal(wrote, 1, "the first round's writer ran once");
      assert.equal(deferred.length, 1, `what the round's calls returned rides the session's next request: ${JSON.stringify(deferred)}`);
      assert.match(deferred[0], /^Result of filament_memory_remember\(/, "the first round's result, as its round got it");
      assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered");
    } finally {
      brain.remember = remember;
      brain.setDeferred = setDeferred;
      opening = null;
      answer = null;
    }
  });

  // (fails before: yes — the review of a9afebe80: with the merged message kept, the first round's exchange was put back
  // and its search's result rode the deferral too, told twice)
  test("each of a failed follow-up's results reaches the model once on the session's next request: what the exchange put back carries rides no deferral — and a retry that puts nothing back is told every round's", async () => {
    for (const keeps of [true, false]) {
      const sid = `told-once-${keeps}`;
      await reset("m");
      const think = (/** @type {number} */ n) => ({ type: "thinking", thinking: `Round ${n}.`, signature: `SIG_${n}_${sid}` });
      const searchFirst = { ...SEARCH, id: `toolu_s_${keeps}` };
      const rememberThen = { ...REMEMBER, id: `toolu_r_${keeps}` };
      // Round one searches; its follow-up's round remembers; that round's follow-up the provider refuses.
      opening = () => anthropicSse([think(1), WORDS, searchFirst], "tool_use");
      let asks = 0;
      answer = () => (++asks === 1 ? anthropicSse([think(2), { type: "text", text: "One more look." }, rememberThen], "tool_use") : FELL_OVER());
      const asked = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
      const thinking = { type: "enabled", budget_tokens: 1024 };
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 2048, stream: true, thinking, messages: asked }, sid);
        await client.done;
        await closed(client.got.id);
        answer = null;
        opening = null;
        // The client's next request: the merged message it was shown, kept, and its next words — or the same request again.
        const shown = { role: "assistant", content: [think(1), WORDS, think(2), { type: "text", text: "One more look." }] };
        const messages = keeps ? [...asked, shown, { role: "user", content: [{ type: "text", text: "go on" }] }] : asked;
        const mark = up.received.length;
        const next = open("/v1/messages", { model: "m-1", max_tokens: 2048, stream: true, thinking, messages }, sid);
        await next.done;
        await closed(next.got.id);
        const sent = JSON.stringify(up.received.slice(mark)[0].body.messages);
        const putBack = sent.includes(`"tool_use_id":"${searchFirst.id}"`);
        assert.equal(putBack, keeps, keeps ? "the first round's exchange is put back" : "nothing is put back for a request the client sent again");
        assert.match(sent, /Result of filament_memory_remember\(/, "the refused round's results ride the request");
        assert.equal(/Result of filament_memory_search\(/.test(sent), !keeps, keeps ? "the first round's results, which the exchange put back carries, ride no deferral" : "the first round's ride it too: nothing put back carries them");
      } finally {
        opening = null;
        answer = null;
      }
    }
  });

  // (fails before: yes — the review of 14b90e384: the results were told apart by their calls' ids alone: with the merged
  // message kept, the put-back's id took the second round's result out with the first's, and it reached the model nowhere;
  // on a retry that put nothing back, the second round's result rode labelled with the first round's input)
  test("a provider that names each reply's calls afresh — the same id in every round — has each round's result reach the model once, labelled with its own call", async () => {
    for (const keeps of [true, false]) {
      const sid = `same-ids-${keeps}`;
      await reset("m");
      const think = (/** @type {number} */ n) => ({ type: "thinking", thinking: `Round ${n}.`, signature: `SIG_${n}_${sid}` });
      // Each reply names its first call `toolu_0`.
      const searchFirst = { ...SEARCH, id: "toolu_0" };
      const rememberThen = { ...REMEMBER, id: "toolu_0" };
      opening = () => anthropicSse([think(1), WORDS, searchFirst], "tool_use");
      let asks = 0;
      answer = () => (++asks === 1 ? anthropicSse([think(2), { type: "text", text: "One more look." }, rememberThen], "tool_use") : FELL_OVER());
      const asked = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
      const thinking = { type: "enabled", budget_tokens: 1024 };
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 2048, stream: true, thinking, messages: asked }, sid);
        await client.done;
        await closed(client.got.id);
        answer = null;
        opening = null;
        const shown = { role: "assistant", content: [think(1), WORDS, think(2), { type: "text", text: "One more look." }] };
        const messages = keeps ? [...asked, shown, { role: "user", content: [{ type: "text", text: "go on" }] }] : asked;
        const mark = up.received.length;
        const next = open("/v1/messages", { model: "m-1", max_tokens: 2048, stream: true, thinking, messages }, sid);
        await next.done;
        await closed(next.got.id);
        const sentMessages = /** @type {any[]} */ (up.received.slice(mark)[0].body.messages);
        const words = sentMessages.flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text))).join("\n");
        assert.equal(JSON.stringify(sentMessages).includes('"tool_use_id":"toolu_0"'), keeps, keeps ? "the first round's exchange is put back" : "nothing is put back");
        assert.match(words, /Result of filament_memory_remember\(\{"text":"The cache is keyed by the session id\.","kind":"decision"\}\)/, `${keeps ? "kept" : "a retry"}: the second round's result reaches the model, labelled with its own call: ${words.slice(-600)}`);
        assert.equal(/Result of filament_memory_search\(\{"query":"the cache"\}\)/.test(words), !keeps, keeps ? "the first round's, which the put-back carries, rides no deferral" : "the first round's rides it too, labelled with its own call");
      } finally {
        opening = null;
        answer = null;
      }
    }
  });

  /** A JSON request of a chat, answered: what its client got, and its request's id. @param {string} sid @param {any[]} messages */
  const askJson = async (sid, messages) => {
    const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages }, sid);
    await client.done;
    const { status, head, text } = client.got;
    return { id: client.got.id, got: { status, upstream: head["x-filament-upstream"], retry: head["x-should-retry"], body: JSON.parse(text) } };
  };

  // (fails before: yes — the review of main: a compaction whose follow-up's connection dropped answered its client 200
  // with the round's "Let me look." under end_turn where a first attempt out of reach gets 502 "upstream m unreachable:
  // UND_ERR_SOCKET"; the record closed "ok", its provider recorded as a success, and "Let me look." was archived as the
  // session's compaction summary)
  test("a JSON request whose memory follow-up cannot reach its provider is answered as a first attempt that cannot reach it, its provider judged so: a compaction archives no summary from the round's words", async () => {
    const sid = "unreached-follow-up-compaction";
    const asked = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    // A first attempt that cannot reach its provider: what its client gets, and how its provider is judged.
    await reset("m");
    opening = () => ({ drop: true });
    /** @type {Awaited<ReturnType<typeof askJson>>["got"]} */
    let first;
    try {
      const r = await askJson("unreached-first", asked);
      first = r.got;
      assert.deepEqual([(await closed(r.id)).status, first.status], ["error", 502], "the first attempt fails at 502");
    } finally {
      opening = null;
    }
    const judged = await healthOf("m");
    assert.deepEqual([judged.coolingDown, judged.failures], [true, 1], `a provider out of reach is a failure: ${JSON.stringify(judged)}`);
    await reset("m");
    // A turn of the session, its follow-up answered: the compaction would stand for it.
    assert.equal((await askJson(sid, asked)).got.status, 200);
    answer = () => ({ drop: true });
    try {
      const messages = [...asked, { role: "assistant", content: [{ type: "text", text: `${WORDS.text}\n\nMODEL ANSWER` }] }, { role: "user", content: [{ type: "text", text: COMPACT_ASK }] }];
      const r = await askJson(sid, messages);
      assert.deepEqual(r.got, first, "its client is answered as the first attempt's was");
      const rec = await closed(r.id);
      assert.equal(rec.memory?.position, "compaction", "the request is the session's compaction");
      assert.deepEqual([rec.status, rec.httpStatus, rec.error], ["error", 502, first.body.error.message], "its record closes on that failure");
      assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, USAGE.output_tokens], "with what its round cost");
      const health = await healthOf("m");
      assert.deepEqual(
        [health.coolingDown, health.failures, health.lastError?.message],
        [judged.coolingDown, judged.failures, judged.lastError?.message],
        `its provider is judged as for the first attempt (${JSON.stringify(judged)}): ${JSON.stringify(health)}`,
      );
      assert.deepEqual(archive().getCompactions(chainOf(sid)), [], "no summary is archived from the round's words");
    } finally {
      answer = null;
    }
  });

  // (fails before: yes — a request's memory follow-up opened its record's changes again with the notes gathered before
  // its first attempt: the wait for s-1's one slot, said by that attempt alone, was gone from the record)
  test("a request that waited for a slot says so on its record though its memory follow-up took a slot of its own", async () => {
    const asked = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    await reset("m");
    // s-1 runs one call at a time at m, as a 429 with two in flight teaches it: a second call waits for the first's slot.
    shim.app.health.note429("m", "s-1", 2);
    // The holder's reply streams and holds s-1's one slot until the test lets it end.
    const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
    let firsts = 0;
    opening = () => (++firsts === 1 ? fed : anthropicReply("", { model: "s-1", stop: "tool_use", blocks: [WORDS, SEARCH], usage: USAGE }));
    try {
      const holder = open("/v1/messages", { model: "s-1", max_tokens: 100, stream: true, messages: asked }, "slot-holder");
      await until(() => holder.got.text.includes(FOUND), "the holder's first words at its client");
      const waiter = open("/v1/messages", { model: "s-1", max_tokens: 100, messages: asked }, "slot-waiter");
      // Planned for m, its attempt asks for the slot the holder has.
      await until(() => pending("slot-waiter")?.upstream === "m", "the waiter at the slot's gate");
      fed.end(...anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(3).map(frame));
      await holder.done;
      await waiter.done;
      assert.equal(waiter.got.status, 200, waiter.got.text);
      const rec = await closed(waiter.got.id);
      assert.ok(up.received.some((c) => c.body?.model === "s-1" && isFollowUp(c)), "the waiter's memory follow-up went");
      assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^concurrency: waited .+ for a slot: /.test(c)), `its wait is said on its record: ${JSON.stringify(rec.changes)}`);
    } finally {
      opening = null;
      fed.end();
    }
  });

  // (fails before: yes — the cooldown went into the notes a next candidate's attempt opens with alone: the last candidate's
  // record never said it, 0 !== 1)
  test("a request whose provider cannot be reached says on its record that the provider cools down, its last candidate too", async () => {
    await reset("m");
    opening = () => ({ drop: true });
    try {
      const r = await askJson("unreached-note", [{ role: "user", content: [{ type: "text", text: ASKED }] }]);
      const rec = await closed(r.id);
      assert.deepEqual([rec.status, rec.httpStatus], ["error", 502]);
      const said = (rec.changes || []).filter((/** @type {string} */ c) => /^health: m cooling down \d+ s \(unreachable\)$/.test(c));
      assert.equal(said.length, 1, `the cooldown is said on the record, once: ${JSON.stringify(rec.changes)}`);
    } finally {
      opening = null;
    }
  });

  // (fails before: yes — a second follow-up whose 200 said an error answered its client 200 with the rounds' "Let me look."
  // and "One more look." merged, where a first attempt's such reply gets 502 and the error; the record closed "ok", its
  // provider recorded as a success, and its turn archived as answered by the merged words)
  test("a JSON request whose memory follow-up's reply says an error, after a round before it, is answered as that error, as a first attempt's such reply is: its turn left unanswered", async () => {
    const sid = "erred-follow-up";
    const asked = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    /** A 200 whose body is the provider's error. */
    const erred = () => ({ json: { type: "error", error: { type: "api_error", message: "the provider fell over mid-reply" } } });
    await reset("m");
    opening = erred;
    /** @type {Awaited<ReturnType<typeof askJson>>["got"]} */
    let first;
    try {
      const r = await askJson("erred-first", asked);
      first = r.got;
      assert.equal(first.status, 502, "the first attempt's error is answered at 502");
    } finally {
      opening = null;
    }
    const judged = await healthOf("m");
    await reset("m");
    // The first follow-up asks memory again; the second's reply is the error.
    let asks = 0;
    answer = () => (++asks === 1 ? anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "text", text: "One more look." }, { ...SEARCH, id: "toolu_m3" }], usage: USAGE }) : erred());
    try {
      const r = await askJson(sid, asked);
      assert.deepEqual(r.got, first, "its client is answered as the first attempt's was, never the rounds' words merged");
      const rec = await closed(r.id);
      assert.deepEqual([rec.status, rec.httpStatus], ["error", 502]);
      assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens * 2, USAGE.output_tokens * 2], "with what its two rounds cost");
      const health = await healthOf("m");
      assert.deepEqual([health.coolingDown, health.failures], [judged.coolingDown, judged.failures], `its provider is judged as for the first attempt (${JSON.stringify(judged)}): ${JSON.stringify(health)}`);
      assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered: no reply ended it");
    } finally {
      answer = null;
    }
  });

  // (fails before: yes — the review of 07033b682: a memory follow-up the provider refused closed its stream's request
  // "error" at HTTP 200, which finish.js read as a stream that broke off — the provider's fault — so a 400, 401 or 404
  // cooled the provider down where the same status on a first attempt cools nothing)
  test("a stream whose memory follow-up the provider refuses has its provider judged by the status it refused with, as for a first attempt refused so", async () => {
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    /** The provider's refusal, in a status. @param {number} status */
    const refusal = (status) => () => ({ status, json: { type: "error", error: { type: status === 503 ? "overloaded_error" : "invalid_request_error", message: `refused with ${status}` } } });
    for (const status of [400, 401, 404, 503]) {
      // A first attempt refused so: how its provider is judged.
      await reset("m");
      opening = refusal(status);
      try {
        const first = open("/v1/messages", { model: "m-1", max_tokens: 100, stream: true, messages }, `refused-first-${status}`);
        await first.done;
        assert.equal((await closed(first.got.id)).httpStatus, status, "the first attempt closes with its status");
      } finally {
        opening = null;
      }
      const judged = await healthOf("m");
      await reset("m");
      answer = refusal(status);
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream: true, messages }, `refused-follow-up-${status}`);
        await client.done;
        const rec = await closed(client.got.id);
        assert.match(client.got.text, /memory follow-up failed; the reply ends here/, "its stream ends on the follow-up's failure");
        const health = await healthOf("m");
        assert.deepEqual(
          [health.coolingDown, health.failures, health.lastError?.status],
          [judged.coolingDown, judged.failures, status],
          `HTTP ${status}: its provider is judged by that status, as for a first attempt refused so (${JSON.stringify(judged)}): ${JSON.stringify(health)}`,
        );
        assert.equal(judged.lastError?.status, status, "as the first attempt's refusal named it");
        assert.deepEqual([rec.status, rec.httpStatus], ["error", 200], "its head was on the wire before the refusal: the status the client got stays 200");
      } finally {
        answer = null;
      }
    }
  });

  // (fails before: yes — a follow-up refused with 400 or 503 answered its client 200 with the round's "Let me look." under
  // end_turn, no retry-after, where the first attempt refused so got the status, the provider's words and its wait; the
  // record closed "ok" at 200, its provider recorded as a success)
  test("a JSON request whose memory follow-up the provider refuses is answered as the provider refused it, its provider judged as for a first attempt refused so", async () => {
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    /** The provider's refusal, in a status, with the wait it asks for. @param {number} status */
    const refusal = (status) => () => ({ status, headers: { "retry-after": "7" }, json: { type: "error", error: { type: status === 503 ? "overloaded_error" : "invalid_request_error", message: `refused with ${status}` } } });
    /** A JSON request of the chat, answered: what its client got, and its request's id. @param {string} sid */
    const ask = async (sid) => {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, messages }, sid);
      await client.done;
      const { status, head, text } = client.got;
      return { id: client.got.id, got: { status, retryAfter: head["retry-after"], upstream: head["x-filament-upstream"], body: JSON.parse(text) } };
    };
    for (const status of [400, 503]) {
      // A first attempt refused so: what its client gets, and how its provider is judged.
      await reset("m");
      opening = refusal(status);
      /** @type {Awaited<ReturnType<typeof ask>>["got"]} */
      let first;
      try {
        const r = await ask(`json-refused-first-${status}`);
        first = r.got;
        assert.equal((await closed(r.id)).httpStatus, status, "the first attempt closes with its status");
      } finally {
        opening = null;
      }
      const judged = await healthOf("m");
      await reset("m");
      answer = refusal(status);
      try {
        const sid = `json-refused-follow-up-${status}`;
        const r = await ask(sid);
        assert.deepEqual(r.got, first, `HTTP ${status}: its client is answered as the first attempt's was`);
        const rec = await closed(r.id);
        assert.deepEqual([rec.status, rec.httpStatus], ["error", status], "its record closes on the status the provider refused with");
        assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, USAGE.output_tokens], "with what its first round cost");
        const health = await healthOf("m");
        assert.deepEqual(
          [health.coolingDown, health.failures, health.lastError?.status, health.retryAfter],
          [judged.coolingDown, judged.failures, status, 7],
          `HTTP ${status}: its provider is judged as for a first attempt refused so (${JSON.stringify(judged)}): ${JSON.stringify(health)}`,
        );
        assert.deepEqual([judged.lastError?.status, judged.retryAfter], [status, 7], "as the first attempt's refusal was");
        assert.equal(turnOf(sid).final_hash ?? null, null, "its turn is left unanswered: the client's retry asks again");
      } finally {
        answer = null;
      }
    }
  });

  // (fails before: yes — a refused follow-up was judged by its status alone, on a stream and a JSON reply alike: its 429
  // for the account's rate taught no ceiling ([] where a first attempt's teaches m-1:1), its 401 held no wall (null where
  // "account"), and its 429 refusing the model cooled the provider down (cooling, 1 failure, where a first attempt's
  // cools nothing))
  test("a memory follow-up the provider refuses goes through a first attempt's verdict: a 429 for the account's rate teaches the model's ceiling, a refused key holds the wall, a 429 refusing the model cools nothing — on a stream and a JSON reply", async () => {
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    const refusals = /** @type {const} */ ([
      ["a rate limit", 429, { type: "error", error: { type: "rate_limit_error", message: "Number of concurrent connections has exceeded your rate limit." } }],
      ["a refused key", 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }],
      ["a model this account may not use", 429, { type: "error", error: { type: "rate_limit_error", message: "You do not have access to the model m-1." } }],
    ]);
    /** What the health board says of the provider: its cooldown, its failures, its last status, its wall, its ceilings. */
    const board = async () => {
      const h = await healthOf("m");
      return [h.coolingDown, h.failures, h.lastError?.status ?? null, h.wall?.kind ?? null, (h.ceilings || []).map((/** @type {any} */ c) => `${c.model}:${c.cap}`)];
    };
    /** A request of the chat, answered and its record closed. @param {string} sid @param {boolean} stream */
    const ask = async (sid, stream) => {
      const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, sid);
      await client.done;
      await closed(client.got.id);
    };
    for (const stream of [true, false]) {
      for (const [what, status, json] of refusals) {
        // A first attempt refused so: how its provider is judged.
        await reset("m");
        opening = () => ({ status, json });
        try {
          await ask(`verdict-first-${status}-${what.length}-${stream}`, stream);
        } finally {
          opening = null;
        }
        const judged = await board();
        await reset("m");
        answer = () => ({ status, json });
        try {
          await ask(`verdict-follow-up-${status}-${what.length}-${stream}`, stream);
        } finally {
          answer = null;
        }
        assert.deepEqual(await board(), judged, `${stream ? "a stream" : "a JSON reply"}, ${what}: its provider is judged as for a first attempt refused so`);
      }
    }
  });

  // (fails before: yes — every deferral's trace note said "the reply also called the client's tools", at the round limit
  // on a JSON reply and a stream, and after a JSON reply's failed follow-up, where no client tool was called)
  test("memory's results deferred to the session's next request say why on the trace: the client's tools beside them, the round limit, or a follow-up that failed", async () => {
    const messages = [{ role: "user", content: [{ type: "text", text: ASKED }] }];
    /** A call of the client's own tools. */
    const READ = { type: "tool_use", id: "toolu_c1", name: "Read", input: { path: "notes.md" } };
    const WHY = {
      mixed: /^the reply also called the client's tools\b/,
      limit: /^the memory tool round limit was reached\b/,
      failed: /^the follow-up that took them to the model failed\b/,
    };
    let n = 0;
    /** A round that asks memory again, as a JSON reply or a stream. @param {boolean} stream */
    const again = (stream) => {
      const blocks = [{ type: "text", text: "One more look." }, { ...SEARCH, id: `toolu_again_${++n}` }];
      return stream ? anthropicSse(blocks, "tool_use") : anthropicReply("", { model: "m-1", stop: "tool_use", blocks, usage: USAGE });
    };
    /** @type {[string, boolean, keyof typeof WHY, (() => any) | null, (() => any) | null][]} */
    const cases = [
      ["a JSON reply beside the client's tools", false, "mixed", () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [WORDS, READ, SEARCH], usage: USAGE }), null],
      ["a stream beside the client's tools", true, "mixed", () => anthropicSse([WORDS, READ, SEARCH], "tool_use"), null],
      ["a JSON reply at the round limit", false, "limit", null, () => again(false)],
      ["a stream at the round limit", true, "limit", null, () => again(true)],
      ["a JSON reply whose follow-up failed", false, "failed", null, () => ({ drop: true })],
    ];
    for (const [what, stream, why, first, follow] of cases) {
      await reset("m");
      opening = first;
      answer = follow;
      try {
        const client = open("/v1/messages", { model: "m-1", max_tokens: 100, stream, messages }, `deferred-${why}-${stream}`);
        await client.done;
        const rec = await closed(client.got.id);
        const notes = (rec.memoryTrace?.steps || []).filter((/** @type {any} */ s) => s.name === "memory results deferred").map((/** @type {any} */ s) => String(s.note));
        assert.equal(notes.length, 1, `${what}: its results are deferred once: ${JSON.stringify(notes)}`);
        assert.match(notes[0], WHY[why], `${what}: the trace says why`);
      } finally {
        opening = null;
        answer = null;
      }
    }
  });
});

// A request memory leaves out — here its model, excluded in Memory settings — needs no stage: its stream is carried to
// the client as it comes (dispatch/reply-stream.js, `pipeStream`).
describe("a client gone from a stream carried straight through: a model memory leaves out", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** What the upstream streams while a test scripts it. @type {(() => any) | null} */
  let answer = null;

  before(async () => {
    up = await fakeUpstream(() => answer?.());
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { ...cfg.memory.autopilot, enabled: true, tools: true };
        cfg.memory.capture = { ...cfg.memory.capture, excludeModels: ["m-*"] };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  // (fails before: yes — the failed read threw past `pipeStream` into reply.js, which closed the record with none of what
  // the stream had said: tokens [0, 0] where [30, 1] was said)
  test("a stream whose provider falls silent mid-reply ends on the failure's words, its record keeping what the stream said so far, the provider judged", async () => {
    const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
    answer = () => fed;
    process.env.FILAMENT_SILENT_REPLY_MS = "300";
    try {
      const got = { id: "", text: "" };
      await new Promise((resolve) => {
        const req = http.request(`${shim.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": shim.key } }, (res) => {
          got.id = String(res.headers["x-filament-request-id"] || "");
          res.setEncoding("utf8");
          res.on("data", (/** @type {string} */ t) => (got.text += t));
          res.on("close", () => resolve(undefined));
        });
        req.on("error", () => resolve(undefined));
        req.end(JSON.stringify({ model: "m-1", max_tokens: 100, stream: true, messages: [{ role: "user", content: ASKED }] }));
      });
      const rec = await until(async () => {
        const r = await shim.record(got.id);
        return r?.totalMs != null ? r : null;
      }, `${got.id}'s record closed`);
      assert.equal(rec.memory?.chain, undefined, "memory left the request out: its stream went through no stage");
      assert.match(got.text, /it sent nothing for 0\.3 s mid-reply/, "its stream ends on the failure's words");
      assert.deepEqual([rec.status, rec.httpStatus, rec.error], ["error", 200, "it sent nothing for 0.3 s mid-reply"]);
      assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, 1], "it closes with what its stream said so far");
      const health = (await (await shim.api("/api/usage/upstreams")).json()).health.m || {};
      assert.deepEqual([health.coolingDown, health.failures], [true, 1], `the provider is judged as by a stream that broke off: ${JSON.stringify(health)}`);
    } finally {
      delete process.env.FILAMENT_SILENT_REPLY_MS;
      answer = null;
      fed.end();
      // The tests after it start from a provider as healthy as new.
      await shim.api("/api/health/m/reset", { method: "POST", body: {} });
    }
  });

  // (fails before: yes — the record kept the client's stream's usage alone, which a Chat Completions stream says at its end:
  // tokens [0, 0] where the provider's message_start had said [30, 1], for a silence and a hang-up alike)
  test("a translated stream that ends before its end — its provider silent, or its client gone — keeps on its record what the provider said so far, which the client's stream says only at its end", async () => {
    for (const how of /** @type {const} */ (["its provider falls silent", "its client hangs up"])) {
      // The provider's start says its prompt and the output it counts from; an OpenAI client's stream says its usage last.
      const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
      answer = () => fed;
      if (how === "its provider falls silent") process.env.FILAMENT_SILENT_REPLY_MS = "300";
      /** @type {import("node:http").ClientRequest | null} */
      let req = null;
      try {
        const got = { id: "", text: "" };
        const done = new Promise((resolve) => {
          req = http.request(`${shim.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": shim.key } }, (res) => {
            got.id = String(res.headers["x-filament-request-id"] || "");
            res.setEncoding("utf8");
            res.on("data", (/** @type {string} */ t) => (got.text += t));
            res.on("close", () => resolve(undefined));
          });
          req.on("error", () => resolve(undefined));
          req.end(JSON.stringify({ model: "m-1", max_tokens: 100, stream: true, messages: [{ role: "user", content: ASKED }] }));
        });
        await until(() => got.text.includes(FOUND), `${how}: the reply's first words at the client`);
        if (how === "its client hangs up") /** @type {any} */ (req).destroy();
        await done;
        const rec = await until(async () => {
          const r = await shim.record(got.id);
          return r?.totalMs != null ? r : null;
        }, `${got.id}'s record closed`);
        assert.deepEqual([rec.translatedFormats, rec.memory?.chain], ["openai -> anthropic", undefined], `${how}: translated, memory leaving it out`);
        assert.equal(rec.status, how === "its client hangs up" ? "aborted" : "error", `${how}: ${rec.error}`);
        assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, 1], `${how}: it closes with what the provider said so far`);
      } finally {
        delete process.env.FILAMENT_SILENT_REPLY_MS;
        answer = null;
        fed.end();
        /** @type {any} */ (req)?.destroy();
        await shim.api("/api/health/m/reset", { method: "POST", body: {} });
      }
    }
  });

  for (const how of /** @type {const} */ (["hangs up", "is stopped"])) {
    // (fails before: yes — the read, aborted with the request, threw past `pipeStream` into reply.js, which closed the
    // record aborted with none of what the stream had said: tokens [0, 0] where its start had said [30, 1], for a hang-up
    // and for a stop alike)
    test(`a stream whose client ${how} while its reply streams is aborted, with the tokens the stream said so far: no provider cooled`, async () => {
      // The reply's start said its prompt and the output it counts from; its body is held once its first words are out.
      const fed = fedStream(anthropicSse([{ type: "text", text: FOUND }], "end_turn").sse.slice(0, 3).map(frame));
      answer = () => fed;
      /** @type {import("node:http").ClientRequest | null} */
      let req = null;
      try {
        const got = { id: "", text: "" };
        const done = new Promise((resolve) => {
          req = http.request(`${shim.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": shim.key } }, (res) => {
            got.id = String(res.headers["x-filament-request-id"] || "");
            res.setEncoding("utf8");
            res.on("data", (/** @type {string} */ t) => (got.text += t));
            res.on("close", () => resolve(undefined));
          });
          req.on("error", () => resolve(undefined));
          req.end(JSON.stringify({ model: "m-1", max_tokens: 100, stream: true, messages: [{ role: "user", content: ASKED }] }));
        });
        await until(() => got.text.includes(FOUND), "the reply's first words at the client");
        if (how === "hangs up") /** @type {any} */ (req).destroy();
        else {
          const stopped = await shim.api(`/api/requests/${encodeURIComponent(got.id)}/cancel`, { method: "POST", body: {} });
          assert.equal(stopped.status, 200, await stopped.clone().text());
          await done;
          const after = got.text.slice(got.text.indexOf(FOUND) + FOUND.length);
          assert.doesNotMatch(after, /event: error|message_stop/, "its stream ends with no error and no end of a reply");
        }
        const rec = await until(async () => {
          const r = await shim.record(got.id);
          return r?.totalMs != null ? r : null;
        }, `${got.id}'s record closed`);
        assert.equal(rec.memory?.chain, undefined, "memory left the request out: its stream went through no stage");
        assert.deepEqual([rec.status, rec.error], ["aborted", "client disconnected"]);
        assert.deepEqual([rec.tokens?.input, rec.tokens?.output], [USAGE.input_tokens, 1], "it closes with what its stream said so far: its prompt, and the output its start counted");
        const health = (await (await shim.api("/api/usage/upstreams")).json()).health.m || { failures: 0, coolingDown: false };
        assert.deepEqual([health.coolingDown, health.failures], [false, 0], `the provider is not cooled down for it: ${JSON.stringify(health)}`);
      } finally {
        answer = null;
        fed.end();
        /** @type {any} */ (req)?.destroy();
      }
    });
  }
});

describe("a request whose signal has already ended", () => {
  // (fails before: yes — forwardRequest only listened for an abort to come, which an ended signal never sends: the
  // request went to the provider and was answered)
  test("forwardRequest sends the provider nothing", async (t) => {
    let heard = 0;
    const server = http.createServer((req, res) => {
      heard++;
      req.resume();
      req.on("end", () => res.end("{}"));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/`;
    const stop = new AbortController();
    stop.abort();
    await assert.rejects(forwardRequest({ url, headers: {}, bodyString: "{}", signal: stop.signal }), { name: "AbortError" });
    const next = await forwardRequest({ url, headers: {}, bodyString: "{}", signal: undefined });
    assert.equal(await next.res.text(), "{}");
    next.cleanup();
    assert.equal(heard, 1, "the provider heard the request after it, alone");
  });

  // (fails before: yes — a lane with room handed its slot to a call whose signal had already ended: only a call that
  // waited heard its abort)
  test("the gate hands it no slot, its lane free or full", async () => {
    const g = new ConcurrencyGate();
    const stop = new AbortController();
    stop.abort();
    const free = () => ({ cap: null, liftsAt: null });
    const one = () => ({ cap: 1, liftsAt: null });
    await assert.rejects(async () => g.acquire("u", "m-1", free, { signal: stop.signal }), { name: "AbortError" });
    assert.equal(g.inflightAt("u", "m-1"), 0, "no slot was taken");
    const holder = await g.acquire("u", "m-1", one);
    await assert.rejects(async () => g.acquire("u", "m-1", one, { signal: stop.signal }), { name: "AbortError" });
    assert.equal(g.inflightAt("u", "m-1"), 1, "the holder's alone");
    holder.release();
  });
});
