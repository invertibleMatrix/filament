// W8.6 P2: a truncated Anthropic SSE (message_start + deltas, no message_stop) must not reassemble as success.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sseToJson } from "../src/proxy.js";
import { jsonToSse } from "../src/core/wire/sse.js";
import { INCOMPLETE_STREAM, streamError } from "../src/core/wire/errors.js";

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

test("sseToJson anthropic: incomplete stream is an error, not a successful partial message", () => {
  const partial = ev("message_start", { message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 10 } } })
    + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
    + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "half a summary" } });
  const j = sseToJson("anthropic", partial);
  assert.equal(j.type, "error");
  assert.match(String(j.error?.message || ""), /incomplete/i);
});

test("sseToJson anthropic: a complete stream still yields the text", () => {
  const full = ev("message_start", { message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 10 } } })
    + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
    + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "whole" } })
    + ev("content_block_stop", { index: 0 })
    + ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })
    + ev("message_stop", {});
  const j = sseToJson("anthropic", full);
  assert.notEqual(j.type, "error");
  assert.equal(j.content?.[0]?.text, "whole");
  assert.ok(!("_complete" in j), "internal complete flag is not leaked onto the message");
});

// (fails before: yes — the bug hunt of 10-30, its second pass: a stream that said its stop reason and lost only its
// message_stop folded to "incomplete upstream stream", where the translators, the usage scanner and memory's stream
// stage read it as a finished reply)
test("sseToJson anthropic: a stream that said its stop reason is finished, its message_stop or not; one that said none is cut", () => {
  const body = ev("message_start", { message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 10 } } })
    + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
    + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "whole" } })
    + ev("content_block_stop", { index: 0 });
  const said = sseToJson("anthropic", body + ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }));
  assert.notEqual(said.type, "error");
  assert.deepEqual([said.content?.[0]?.text, said.stop_reason], ["whole", "end_turn"]);
  assert.ok(!("_complete" in said), "internal complete flag is not leaked onto the message");
  const none = sseToJson("anthropic", body + ev("message_delta", { delta: {}, usage: { output_tokens: 1 } }));
  assert.equal(none.error?.message, INCOMPLETE_STREAM, "a delta that says no stop reason ends nothing");
});

const chunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

// (fails before: yes — the bug hunt of 10-30, WIRE-1: a Chat Completions stream cut mid-reply folded into a finished
// completion, so a client that asked for no stream was answered the cut reply as a whole one)
test("sseToJson openai: a stream with neither a finish_reason nor its [DONE] is an error; either one ends it", () => {
  const cut = sseToJson("openai", chunk({ role: "assistant", content: "half a" }) + chunk({ content: " summary" }));
  assert.equal(cut.error?.message, INCOMPLETE_STREAM);
  assert.equal(cut.choices, undefined);
  const finished = sseToJson("openai", chunk({ content: "whole" }) + chunk({}, "stop"));
  assert.equal(finished.choices[0].message.content, "whole");
  assert.equal(finished.choices[0].finish_reason, "stop");
  const done = sseToJson("openai", chunk({ content: "whole" }) + "data: [DONE]\n\n");
  assert.equal(done.choices[0].message.content, "whole");
  // An error the stream said is no cut: it is the stream's own failure, in the words the reader of the stream names it with.
  const said = sseToJson("openai", chunk({ content: "a" }) + `data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`);
  assert.notEqual(said.error?.message, INCOMPLETE_STREAM);
});

// (fails before: yes — the review of 07033b682: a Chat Completions stream that said an error folded into a finished
// completion of the words before it, which memory archived as the turn's answer, and as a compaction's summary, where an
// Anthropic stream's error event folds to that error)
test("sseToJson openai: a stream that said an error is that error, the words before it no reply and nothing after it counted, as an Anthropic one's is", () => {
  const error = `data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`;
  const said = sseToJson("openai", chunk({ role: "assistant", content: "Let me look." }) + error + "data: [DONE]\n\n");
  assert.deepEqual(said, { error: { message: "overloaded", type: "server_error" } }, "the error, in the words the usage scanner names it with");
  assert.deepEqual(sseToJson("openai", chunk({ content: "a" }) + error + chunk({ content: "b" }, "stop")), said, "what came after it counts for nothing");
  const opened = ev("message_start", { message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 10 } } })
    + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })
    + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Let me look." } });
  assert.deepEqual(sseToJson("anthropic", opened + ev("error", { error: { type: "overloaded_error", message: "overloaded" } })), { type: "error", error: { type: "overloaded_error", message: "overloaded" } }, "as an Anthropic stream's error event folds");
});

// (fails before: yes — the bug hunt of 10-30, WIRE P3: thinking spelled `reasoning` (OpenRouter, Ollama) was dropped when
// a stream was folded into a reply, and when a reply was streamed to a client)
test("sseToJson / jsonToSse openai: a reasoning-spelled thinking is kept under its own name both ways", () => {
  const j = sseToJson("openai", chunk({ reasoning: "Think" }) + chunk({ reasoning: "ing." }) + chunk({ content: "Hi" }) + chunk({}, "stop"));
  assert.equal(j.choices[0].message.reasoning, "Thinking.");
  assert.equal(j.choices[0].message.reasoning_content, undefined);
  const back = jsonToSse("openai", j);
  assert.equal(sseToJson("openai", back).choices[0].message.reasoning, "Thinking.");
});

// (fails before: yes — the bug hunt of 10-30, WIRE-1: a stream that failed after its first byte ended with Anthropic's
// error event whatever the client spoke)
test("streamError: the error a failed stream ends with is said in the client's format", () => {
  const data = (t) => t.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  const a = streamError("anthropic", "stream failure: terminated");
  assert.match(a, /^event: error\n/);
  assert.deepEqual(JSON.parse(data(a)[0]), { type: "error", error: { type: "api_error", message: "stream failure: terminated" } });
  const o = streamError("openai", "stream failure: terminated");
  assert.doesNotMatch(o, /^event:/m);
  assert.deepEqual(JSON.parse(data(o)[0]), { error: { message: "stream failure: terminated", type: "server_error", code: null } });
  assert.equal(data(o)[1], "[DONE]");
  const r = streamError("responses", "stream failure: terminated");
  assert.match(r, /^event: error\n/);
  assert.deepEqual(JSON.parse(data(r)[0]), { type: "error", code: "server_error", message: "stream failure: terminated", param: null });
});
