// @ts-check
// What a translated stream's record bills: what its provider said, in the provider's own words — its cache writes, an
// hour's writes among them, its thinking count, the charge it stated — while its client is shown the usage its own format
// says (dispatch/reply-stream.js). An untranslated stream's record keeps what its provider said as it always did.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fakeUpstream, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { ResponseStore } from "../src/services/response-store.js";

/** What an Anthropic provider says a reply cost: a prompt written to the cache, an hour's writes among it, and thinking. */
const ANTHROPIC_START = { input_tokens: 10, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 400 }, cache_read_input_tokens: 200, output_tokens: 1 };
const ANTHROPIC_END = { output_tokens: 50, output_tokens_details: { thinking_tokens: 30 } };
/** The same, as the record keeps it. */
const ANTHROPIC_SAID = { input: 10, output: 50, cacheRead: 200, cacheWrite: 1000, cacheWrite1h: 400, thinking: 30 };
/** What a Chat Completions provider says a reply cost — xAI's way, the charge stated in ticks of 1e-10 USD — and thinking. */
const OPENAI_USAGE = { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280, prompt_tokens_details: { cached_tokens: 1000 }, completion_tokens_details: { reasoning_tokens: 60 }, cost_in_usd_ticks: 123450000 };
/** The same said by a Responses provider. */
const RESPONSES_USAGE = { input_tokens: 1200, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 60 }, total_tokens: 1280, cost_in_usd_ticks: 123450000 };
/** Either, as the record keeps it: the charge as the request's cost. */
const OPENAI_SAID = { input: 200, output: 80, cacheRead: 1000, thinking: 60 };
const STATED = 0.012345;

const ev = (/** @type {string} */ type, /** @type {any} */ data) => ({ event: type, data: { type, ...data } });
const anthropicSse = () => ({
  sse: [
    ev("message_start", { message: { id: "msg_t", type: "message", role: "assistant", model: "a-1", content: [], stop_reason: null, stop_sequence: null, usage: ANTHROPIC_START } }),
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "cached" } }),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: ANTHROPIC_END }),
    ev("message_stop", {}),
  ],
});
const chunk = (/** @type {any} */ extra) => ({ data: { id: "chatcmpl-t", object: "chat.completion.chunk", created: 1, model: "o-1", ...extra } });
const openaiSse = () => ({
  sse: [
    chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "cached" }, finish_reason: null }] }),
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    chunk({ choices: [], usage: OPENAI_USAGE }),
    "data: [DONE]\n",
  ],
});
const responsesSse = () => {
  const final = { id: "resp_t", object: "response", created_at: 1, model: "r-1", status: "completed", output: [{ id: "msg_t", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "cached", annotations: [] }] }], usage: RESPONSES_USAGE };
  return {
    sse: [
      ev("response.created", { response: { ...final, status: "in_progress", output: [], usage: null } }),
      ev("response.output_item.added", { output_index: 0, item: { id: "msg_t", type: "message", role: "assistant", content: [] } }),
      ev("response.output_text.delta", { item_id: "msg_t", output_index: 0, content_index: 0, delta: "cached" }),
      ev("response.completed", { response: final }),
    ],
  };
};

describe("a record bills what its provider said, its reply translated or not", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;

  before(async () => {
    up = await fakeUpstream((call) => (call.kind === "anthropic" ? anthropicSse() : call.kind === "openai" ? openaiSse() : call.kind === "responses" ? responsesSse() : undefined));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "a", name: "a", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "o", name: "o", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true },
          { id: "r", name: "r", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "s", enabled: true, wireApi: "responses" },
        ];
        cfg.routes = [
          { match: "a-*", upstream: "a", upstreamModel: "{model}", enabled: true },
          { match: "o-*", upstream: "o", upstreamModel: "{model}", enabled: true },
          { match: "r-*", upstream: "r", upstreamModel: "{model}", enabled: true },
        ];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  /**
   * A stream asked of a model, read whole: its events' data, and its record once it closed.
   * @param {string} path @param {string} model
   */
  const streamed = async (path, model) => {
    const r = await shim.post(path, { model, max_tokens: 100, stream: true, messages: [{ role: "user", content: "what is cached" }] });
    assert.equal(r.status, 200);
    const data = (await r.text())
      .split("\n")
      .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)));
    const id = String(r.headers.get("x-filament-request-id"));
    const rec = await until(async () => {
      const x = await shim.record(id);
      return x?.totalMs != null ? x : null;
    }, `${id}'s record closed`);
    return { data, rec };
  };
  /** The record's tokens, the fields `want` names. @param {any} rec @param {Record<string, number>} want */
  const tokensOf = (rec, want) => Object.fromEntries(Object.keys(want).map((k) => [k, rec.tokens?.[k]]));

  // (fails before: yes — the record billed the usage the client was shown: input 1010 and cacheWrite 0 where the provider
  // said 10 and 1000 — its cache writes billed as plain input — no hour's writes (undefined where it said 400), and
  // thinking 0 where it said 30)
  test("an Anthropic provider's stream translated for a Chat Completions client bills its cache writes, an hour's among them, and its thinking as the provider said them; the client is shown its own format's usage", async () => {
    const { data, rec } = await streamed("/v1/chat/completions", "a-1");
    assert.equal(rec.translatedFormats, "openai -> anthropic");
    assert.deepEqual(tokensOf(rec, ANTHROPIC_SAID), ANTHROPIC_SAID, `the record keeps what the provider said: ${JSON.stringify(rec.tokens)}`);
    assert.deepEqual(data.find((d) => d.usage)?.usage, { prompt_tokens: 1210, completion_tokens: 50, total_tokens: 1260, prompt_tokens_details: { cached_tokens: 200 } }, "the client is shown Chat Completions' usage");
  });

  // (fails before: yes — the record billed the usage the client was shown: thinking 0 where the provider said 60, and no
  // cost (null, the model unpriced) where it stated 0.012345)
  test("a Chat Completions provider's stream translated for an Anthropic client bills its thinking and the charge it stated as the provider said them; the client is shown its own format's usage", async () => {
    const { data, rec } = await streamed("/v1/messages", "o-1");
    assert.equal(rec.translatedFormats, "anthropic -> openai");
    assert.deepEqual(tokensOf(rec, OPENAI_SAID), OPENAI_SAID, `the record keeps what the provider said: ${JSON.stringify(rec.tokens)}`);
    assert.deepEqual([rec.cost, rec.costSource], [STATED, "provider"], "the charge the provider stated is the request's cost");
    assert.deepEqual(data.find((d) => d.type === "message_delta")?.usage, { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }, "the client is shown Anthropic's usage");
  });

  // (fails before: yes — the record billed the usage the Anthropic client was shown, two translations on: thinking 0 where
  // the provider said 60, and no cost (null) where it stated 0.012345)
  test("a Responses provider's stream translated for an Anthropic client bills its thinking and the charge it stated as the provider said them; the client is shown its own format's usage", async () => {
    const { data, rec } = await streamed("/v1/messages", "r-1");
    assert.deepEqual(tokensOf(rec, OPENAI_SAID), OPENAI_SAID, `the record keeps what the provider said: ${JSON.stringify(rec.tokens)}`);
    assert.deepEqual([rec.cost, rec.costSource], [STATED, "provider"], "the charge the provider stated is the request's cost");
    assert.deepEqual(data.find((d) => d.type === "message_delta")?.usage, { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }, "the client is shown Anthropic's usage");
  });

  // (fails before: no — a guard: a JSON reply's record is read off the provider's own reply before it is translated)
  test("a translated JSON reply's record bills what its provider said too — the client's reply in its own format", async () => {
    /** @param {string} path @param {string} model */
    const answered = async (path, model) => {
      const r = await shim.post(path, { model, max_tokens: 100, messages: [{ role: "user", content: "what is cached" }] });
      assert.equal(r.status, 200);
      const j = await r.json();
      const id = String(r.headers.get("x-filament-request-id"));
      const rec = await until(async () => {
        const x = await shim.record(id);
        return x?.totalMs != null ? x : null;
      }, `${id}'s record closed`);
      return { j, rec };
    };
    const a = await answered("/v1/chat/completions", "a-1");
    assert.deepEqual(tokensOf(a.rec, ANTHROPIC_SAID), ANTHROPIC_SAID, `an Anthropic provider's, for a Chat Completions client: ${JSON.stringify(a.rec.tokens)}`);
    assert.equal(a.j.usage?.prompt_tokens, 1210, "the client's reply says Chat Completions' usage");
    for (const model of ["o-1", "r-1"]) {
      const o = await answered("/v1/messages", model);
      assert.deepEqual(tokensOf(o.rec, OPENAI_SAID), OPENAI_SAID, `${model}'s provider's, for an Anthropic client: ${JSON.stringify(o.rec.tokens)}`);
      assert.deepEqual([o.rec.cost, o.rec.costSource], [STATED, "provider"], `${model}: the charge the provider stated`);
      assert.equal(o.j.usage?.input_tokens, 200, `${model}: the client's reply says Anthropic's usage`);
    }
  });

  // (fails before: yes — the review of 14b90e384: remembering the reply threw, after the stream's end and before the JSON
  // reply went out, and reply.js closed the record as an error with none of the reply's usage — status error, tokens
  // [0, 0], no cost — the stream's client having had its reply whole, the JSON client answered 502)
  test("a Responses reply keeps its record whole when remembering it for previous_response_id throws — the stream's client and the JSON client have their replies — on a stream and a JSON reply", async () => {
    const put = ResponseStore.prototype.put;
    for (const stream of [true, false]) {
      const what = stream ? "a stream" : "a JSON reply";
      ResponseStore.prototype.put = function () {
        ResponseStore.prototype.put = put;
        throw new Error("the response store failed");
      };
      try {
        const r = await shim.post("/v1/responses", { model: "r-1", input: "what is cached", stream });
        assert.equal(r.status, 200, `${what}: answered 200`);
        assert.match(await r.text(), stream ? /response\.completed/ : /"object":"response"/, `${what}: its reply went out whole`);
        const id = String(r.headers.get("x-filament-request-id"));
        const rec = await until(async () => {
          const x = await shim.record(id);
          return x?.totalMs != null ? x : null;
        }, `${id}'s record closed`);
        assert.deepEqual([rec.status, rec.tokens?.input, rec.tokens?.output, rec.cost], ["ok", OPENAI_SAID.input, OPENAI_SAID.output, STATED], `${what}: its record is the reply's`);
      } finally {
        ResponseStore.prototype.put = put;
      }
    }
  });

  // (fails before: no — a guard: an untranslated stream's record was the provider's words already, and stays them)
  test("an untranslated stream's record keeps what its provider said — Anthropic's cache writes and thinking, a Chat Completions provider's thinking and stated charge", async () => {
    const a = await streamed("/v1/messages", "a-1");
    assert.equal(a.rec.translatedFormats, undefined);
    assert.deepEqual(tokensOf(a.rec, ANTHROPIC_SAID), ANTHROPIC_SAID, `Anthropic's: ${JSON.stringify(a.rec.tokens)}`);
    const o = await streamed("/v1/chat/completions", "o-1");
    assert.equal(o.rec.translatedFormats, undefined);
    assert.deepEqual(tokensOf(o.rec, OPENAI_SAID), OPENAI_SAID, `a Chat Completions provider's: ${JSON.stringify(o.rec.tokens)}`);
    assert.deepEqual([o.rec.cost, o.rec.costSource], [STATED, "provider"]);
  });
});
