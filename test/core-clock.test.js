// @ts-check
// The wire translators and the response store read the clock through an injected `now` (core/ports.js Clock): with a
// fixed one, every id and `created` stamp they invent is deterministic and the store's expiry is decided by the value
// handed in, not by waiting.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anthropicToOpenaiResponse,
  openaiToAnthropicResponse,
  createAnthropicToOpenaiStream,
  createOpenaiToAnthropicStream,
} from "../src/core/wire/translate.js";
import { newResponseId, responseToChat, createResponsesToChatStream } from "../src/core/wire/responses.js";
import { ResponseStore } from "../src/services/response-store.js";

const T = 1_700_000_000_000;
const now = () => T;

test("JSON translations stamp ids and `created` from the injected clock", () => {
  const oai = anthropicToOpenaiResponse(
    { role: "assistant", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: {} },
    { model: "m", now },
  );
  assert.equal(oai.id, `chatcmpl-${T}`);
  assert.equal(oai.created, 1_700_000_000);
  const ant = openaiToAnthropicResponse(
    { choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage: {} },
    { model: "m", now },
  );
  assert.equal(ant.id, `msg_${T}`);
  const chat = responseToChat({ object: "response", output: [], status: "completed" }, { model: "m", now });
  assert.equal(chat.id, `chatcmpl-${T.toString(36)}`);
  assert.equal(chat.created, 1_700_000_000);
  assert.match(newResponseId(now), new RegExp(`^resp_${T.toString(36)}[0-9a-f]{12}$`));
});

test("stream translators invent their ids from the injected clock", () => {
  const a2o = createAnthropicToOpenaiStream({ model: "m", now });
  const out = a2o.push(
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: {} } })}\n\n` +
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n` +
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } })}\n\n`,
  );
  assert.ok(out.includes(`"created":${1_700_000_000}`), out);
  assert.ok(out.includes(`"id":"chatcmpl-${T}"`), out);
  const o2a = createOpenaiToAnthropicStream({ model: "m", now });
  const out2 = o2a.push(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "hi" } }] })}\n\n`,
  );
  assert.ok(out2.includes(`"id":"msg_${T}"`), out2);
  // A tool call the upstream sent without an id gets one from the clock too.
  const out2b = o2a.push(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "f", arguments: "" } }] } }] })}

`,
  );
  assert.ok(out2b.includes(`"id":"call_0_${T}"`), out2b);
  const r2c = createResponsesToChatStream({ model: "m", now });
  const out3 = r2c.push(
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "hi" })}\n\n`,
  );
  assert.ok(out3.includes(`"id":"chatcmpl-${T.toString(36)}"`), out3);
});

test("ResponseStore expires by the injected clock, not by waiting", () => {
  let t = T;
  const s = new ResponseStore({ ttlMs: 1000, max: 10, now: () => t });
  s.put("a", { items: [1] });
  t += 999;
  assert.deepEqual(s.get("a")?.items, [1], "still inside the TTL");
  t += 2;
  assert.equal(s.get("a"), null, "one millisecond past the TTL");
});
