import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { DEFAULT_OUTPUT_TOKENS } from "../src/core/tokens.js";
import { openaiToAnthropicRequest, anthropicToOpenaiRequest, anthropicToOpenaiResponse, openaiToAnthropicResponse, createAnthropicToOpenaiStream, createOpenaiToAnthropicStream } from "../src/translate.js";
import { sseToJson } from "../src/core/wire/sse.js";

test("OpenAI request -> Anthropic: system, tools, tool loop, images, effort, max_tokens default", () => {
  const { body, notes } = openaiToAnthropicRequest({
    model: "claude-opus-5", reasoning_effort: "high", tool_choice: "required",
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: [{ type: "text", text: "weather?" }, { type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "sunny" },
      { role: "user", content: "thanks" },
    ],
    tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }],
  });
  assert.equal(body.system, "be brief");
  assert.equal(body.messages.length, 3);
  assert.deepEqual(body.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } });
  assert.deepEqual(body.messages[1].content[0], { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } });
  assert.equal(body.messages[2].content[0].type, "tool_result"); assert.equal(body.messages[2].content[0].tool_use_id, "call_1"); assert.equal(body.messages[2].content[1].text, "thanks");
  assert.equal(body.tools[0].input_schema.properties.city.type, "string");
  assert.deepEqual(body.tool_choice, { type: "any" });
  assert.deepEqual(body.thinking, { type: "adaptive" }); assert.equal(body.output_config.effort, "high");
  // (fails before: yes — 16,384 was imposed on a client that sent none: HarnessV3-FailurePoints §13)
  assert.equal(body.max_tokens, DEFAULT_OUTPUT_TOKENS); assert.ok(notes.some((n) => n.includes("max_tokens defaulted")));
});

test("OpenAI request -> Anthropic repairs interrupted tool loops and leading assistant turns", () => {
  const { body, notes } = openaiToAnthropicRequest({ model: "m", messages: [
    { role: "assistant", content: "Welcome!" },
    { role: "user", content: "go" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }, { id: "c2", type: "function", function: { name: "g", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "done" },
    { role: "user", content: "and now?" },
    { role: "tool", tool_call_id: "ghost", content: "orphan" },
  ] });
  assert.equal(body.messages[0].role, "user"); assert.ok(body.system.includes("Welcome!"));
  const results = body.messages[2].content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id).sort(); assert.deepEqual(results, ["c1", "c2"]);
  assert.ok(body.messages[2].content.find((b) => b.tool_use_id === "c2").is_error);
  assert.ok(!body.messages.some((m) => m.content.some((b) => b.type === "tool_result" && b.tool_use_id === "ghost")), "orphan result becomes text");
  assert.ok(notes.some((n) => n.includes("placeholder result")) && notes.some((n) => n.includes("orphan")) && notes.some((n) => n.includes("folded")));
});

// (fails before: yes — the bug hunt of 10-30, WIRE-3: a tool message's images and files were dropped on the way to
// Anthropic, its words alone kept, and nothing said so)
test("OpenAI request -> Anthropic: a tool message's images and files ride in its tool_result", () => {
  const { body, notes } = openaiToAnthropicRequest({ model: "claude-opus-5", messages: [
    { role: "user", content: "show me the page" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_s", type: "function", function: { name: "screenshot", arguments: "{}" } }, { id: "call_t", type: "function", function: { name: "title", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_s", content: [
      { type: "text", text: "the page:" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } },
      { type: "image_url", image_url: { url: "https://example.com/p.png" } },
      { type: "file", file: { filename: "r.pdf", file_data: "data:application/pdf;base64,JVBERg==" } },
    ] },
    { role: "tool", tool_call_id: "call_t", content: [{ type: "text", text: "Home" }] },
    { role: "assistant", content: null, tool_calls: [{ id: "call_k", type: "function", function: { name: "snap", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "ghost", content: [{ type: "text", text: "lost" }, { type: "image_url", image_url: { url: "data:image/png;base64,Z2g=" } }] },
  ] });
  const [shot, title] = body.messages[2].content;
  assert.deepEqual(shot, { type: "tool_result", tool_use_id: "call_s", content: [
    { type: "text", text: "the page:" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
    { type: "image", source: { type: "url", url: "https://example.com/p.png" } },
    { type: "document", title: "r.pdf", source: { type: "base64", media_type: "application/pdf", data: "JVBERg==" } },
  ] });
  assert.ok(notes.includes('file part "r.pdf" converted to an Anthropic document'), notes.join(" | "));
  assert.deepEqual(title, { type: "tool_result", tool_use_id: "call_t", content: "Home" }, "words alone stay the string they were");
  // A result that answers no call is said as words, and what it showed goes beside them.
  const orphan = body.messages[4].content.filter((b) => b.type !== "tool_result");
  assert.deepEqual(orphan, [{ type: "text", text: "[tool result for ghost]: lost" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "Z2g=" } }]);
});

test("Anthropic request -> OpenAI: system, tool results to tool messages, thinking dropped, stop sequences, effort", () => {
  const { body, notes } = anthropicToOpenaiRequest({
    model: "glm-5", max_tokens: 500, stream: true, stop_sequences: ["END"], output_config: { effort: "xhigh" }, tool_choice: { type: "tool", name: "read" },
    system: [{ type: "text", text: "sys" }],
    messages: [
      { role: "user", content: "read a" },
      { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "s" }, { type: "text", text: "ok" }, { type: "tool_use", id: "t1", name: "read", input: { path: "a" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "contents" }] }, { type: "text", text: "summarize" }] },
    ],
    tools: [{ name: "read", description: "read file", input_schema: { type: "object", properties: { path: { type: "string" } } } }, { type: "web_search_20260209", name: "web_search" }],
  });
  assert.equal(body.messages[0].role, "system"); assert.equal(body.messages[0].content, "sys");
  assert.equal(body.messages[2].role, "assistant"); assert.equal(body.messages[2].content, "ok"); assert.equal(body.messages[2].tool_calls[0].function.name, "read"); assert.equal(body.messages[2].tool_calls[0].function.arguments, "{\"path\":\"a\"}");
  assert.equal(body.messages[3].role, "tool"); assert.equal(body.messages[3].tool_call_id, "t1"); assert.equal(body.messages[3].content, "contents");
  assert.equal(body.messages[4].role, "user"); assert.equal(body.messages[4].content, "summarize");
  assert.equal(body.tools.length, 1); assert.equal(body.tools[0].function.name, "read"); assert.ok(notes.some((n) => n.includes("server tools")));
  assert.deepEqual(body.tool_choice, { type: "function", function: { name: "read" } });
  assert.deepEqual(body.stop, ["END"]); assert.equal(body.max_tokens, 500); assert.equal(body.reasoning_effort, "xhigh"); assert.deepEqual(body.stream_options, { include_usage: true });
  assert.ok(notes.some((n) => n.includes("thinking blocks dropped")));
});

test("JSON responses translate both ways with tool calls, finish reasons and usage", () => {
  const o = anthropicToOpenaiResponse({ id: "msg_1", model: "claude-opus-5", content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "hi" }, { type: "tool_use", id: "tu", name: "f", input: { a: 1 } }], stop_reason: "tool_use", usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } }, { model: "x" });
  assert.equal(o.choices[0].finish_reason, "tool_calls"); assert.equal(o.choices[0].message.content, "hi"); assert.equal(o.choices[0].message.reasoning_content, "t");
  assert.equal(o.choices[0].message.tool_calls[0].function.arguments, "{\"a\":1}"); assert.equal(o.usage.prompt_tokens, 100); assert.equal(o.usage.prompt_tokens_details.cached_tokens, 90);
  const a = openaiToAnthropicResponse({ id: "chatcmpl-9", choices: [{ message: { role: "assistant", content: "yo", reasoning_content: "r", tool_calls: [{ id: "c1", function: { name: "g", arguments: "{\"b\":2}" } }] }, finish_reason: "length" }], usage: { prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 40 } } }, { model: "m" });
  assert.equal(a.stop_reason, "max_tokens"); assert.deepEqual(a.content.map((b) => b.type), ["thinking", "text", "tool_use"]); assert.deepEqual(a.content[2].input, { b: 2 });
  assert.equal(a.usage.input_tokens, 60); assert.equal(a.usage.cache_read_input_tokens, 40); assert.equal(a.id, "msg_9");
});

test("Anthropic SSE -> OpenAI chunks: text, thinking, tool call arguments, finish, usage, [DONE]", () => {
  const tr = createAnthropicToOpenaiStream({ model: "m" });
  const events = [
    ["message_start", { message: { id: "msg_a", usage: { input_tokens: 3 } } }],
    ["content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } }],
    ["content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "why" } }],
    ["content_block_stop", { index: 0 }],
    ["content_block_start", { index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { index: 1, delta: { type: "text_delta", text: "Hel" } }],
    ["content_block_delta", { index: 1, delta: { type: "text_delta", text: "lo" } }],
    ["content_block_stop", { index: 1 }],
    ["content_block_start", { index: 2, content_block: { type: "tool_use", id: "tu1", name: "f", input: {} } }],
    ["content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: "{\"a\":" } }],
    ["content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: "1}" } }],
    ["content_block_stop", { index: 2 }],
    ["message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } }],
    ["message_stop", {}],
  ];
  let out = ""; for (const [type, data] of events) out += tr.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`); out += tr.end();
  const chunks = out.split("\n\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter((d) => d !== "[DONE]").map((d) => JSON.parse(d));
  assert.equal(chunks[0].choices[0].delta.role, "assistant");
  assert.equal(chunks.filter((c) => c.choices[0]?.delta?.reasoning_content).map((c) => c.choices[0].delta.reasoning_content).join(""), "why");
  assert.equal(chunks.filter((c) => c.choices[0]?.delta?.content).map((c) => c.choices[0].delta.content).join(""), "Hello");
  const tcs = chunks.filter((c) => c.choices[0]?.delta?.tool_calls).map((c) => c.choices[0].delta.tool_calls[0]);
  assert.equal(tcs[0].id, "tu1"); assert.equal(tcs[0].function.name, "f"); assert.equal(tcs.slice(1).map((t) => t.function.arguments).join(""), "{\"a\":1}");
  assert.ok(chunks.some((c) => c.choices[0]?.finish_reason === "tool_calls")); assert.equal(chunks.at(-1).usage.completion_tokens, 9); assert.ok(out.trim().endsWith("data: [DONE]"));
  assert.equal(tr.state.stopReason, "tool_use"); assert.equal(tr.state.usage.output, 9); assert.equal(tr.state.thinkingChars, 3);
});

test("OpenAI chunks -> Anthropic SSE: reasoning to thinking block, text block, tool_use with input_json_delta, message_delta usage", () => {
  const tr = createOpenaiToAnthropicStream({ model: "m" });
  const mk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id: "chatcmpl-z", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  let out = "";
  out += tr.push(mk({ role: "assistant", content: "" }));
  out += tr.push(mk({ reasoning_content: "think" }));
  out += tr.push(mk({ content: "Hi " }) + mk({ content: "there" }));
  out += tr.push(mk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "f", arguments: "" } }] }));
  out += tr.push(mk({ tool_calls: [{ index: 0, function: { arguments: "{\"x\":true}" } }] }));
  out += tr.push(mk({}, "tool_calls"));
  out += tr.push(`data: ${JSON.stringify({ id: "chatcmpl-z", choices: [], usage: { prompt_tokens: 50, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 20 } } })}\n\ndata: [DONE]\n\n`);
  out += tr.end();
  const evs = out.split("\n\n").filter(Boolean).map((b) => JSON.parse(b.split("\n").find((l) => l.startsWith("data:")).slice(5)));
  assert.equal(evs[0].type, "message_start"); assert.equal(evs[0].message.id, "msg_z");
  const starts = evs.filter((e) => e.type === "content_block_start").map((e) => e.content_block.type); assert.deepEqual(starts, ["thinking", "text", "tool_use"]);
  assert.equal(evs.filter((e) => e.type === "content_block_delta" && e.delta.type === "text_delta").map((e) => e.delta.text).join(""), "Hi there");
  assert.equal(evs.find((e) => e.type === "content_block_delta" && e.delta.type === "input_json_delta").delta.partial_json, "{\"x\":true}");
  const md = evs.find((e) => e.type === "message_delta"); assert.equal(md.delta.stop_reason, "tool_use"); assert.equal(md.usage.input_tokens, 30); assert.equal(md.usage.cache_read_input_tokens, 20); assert.equal(md.usage.output_tokens, 4);
  assert.equal(evs.at(-1).type, "message_stop"); assert.equal(evs.filter((e) => e.type === "content_block_stop").length, 3);
});

// (fails before: yes — the bug hunt of 10-30, WIRE-1: a stream the upstream broke off mid-reply was ended for the
// client as a finished one: `finish_reason: "stop"` and [DONE], or end_turn and message_stop)
test("a stream the upstream broke off mid-reply ends as an error in the client's format, never as a finished reply", () => {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const opened = ev("message_start", { message: { id: "msg_c", usage: { input_tokens: 3 } } }) + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "half a rep" } });
  const chunksOf = (out) => out.split("\n\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  const a = createAnthropicToOpenaiStream({ model: "m" });
  const cut = a.push(opened) + a.end();
  const said = chunksOf(cut);
  assert.ok(cut.includes('"content":"half a rep"'), cut);
  assert.ok(!said.some((d) => d !== "[DONE]" && JSON.parse(d).choices?.[0]?.finish_reason), "no finish the upstream never sent");
  assert.deepEqual(said.slice(-2), [JSON.stringify({ error: { message: "incomplete upstream stream", type: "api_error" } }), "[DONE]"]);
  assert.equal(a.state.error, "incomplete upstream stream");
  // A reply whose finish came and only its message_stop is missing is whole: its finish, then the [DONE] for it.
  const b = createAnthropicToOpenaiStream({ model: "m" });
  const whole = chunksOf(b.push(opened + ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } })) + b.end());
  assert.equal(whole.at(-1), "[DONE]");
  assert.ok(whole.some((d) => d !== "[DONE]" && JSON.parse(d).choices?.[0]?.finish_reason === "stop"));
  assert.equal(b.state.error, null);

  const mk = (delta, finish = null) => `data: ${JSON.stringify({ id: "chatcmpl-c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const o = createOpenaiToAnthropicStream({ model: "m" });
  const cutA = o.push(mk({ role: "assistant", content: "" }) + mk({ content: "half a rep" })) + o.end();
  const evs = cutA.split("\n\n").filter(Boolean).map((blk) => JSON.parse(blk.split("\n").find((l) => l.startsWith("data:")).slice(5)));
  assert.ok(evs.some((e) => e.type === "content_block_delta" && e.delta.text === "half a rep"));
  assert.ok(!evs.some((e) => e.type === "message_delta" || e.type === "message_stop"), "no end_turn the upstream never sent");
  assert.deepEqual(evs.at(-1), { type: "error", error: { type: "api_error", message: "incomplete upstream stream" } });
  assert.equal(o.state.error, "incomplete upstream stream");
  assert.deepEqual(sseToJson("anthropic", cutA), sseToJson("anthropic", opened), "folded, it is what an Anthropic stream cut at the same place folds to");
  // A stream that said its [DONE] without a finish, or its finish without [DONE], ended where its server ended it.
  for (const ending of [mk({ content: "!" }) + "data: [DONE]\n\n", mk({}, "stop")]) {
    const p = createOpenaiToAnthropicStream({ model: "m" });
    const done = p.push(mk({ role: "assistant", content: "" }) + ending) + p.end();
    assert.match(done, /"stop_reason":"end_turn"/);
    assert.ok(done.trim().endsWith(`data: ${JSON.stringify({ type: "message_stop" })}`), done);
    assert.equal(p.state.error, null);
  }
});

// Integration: fake Anthropic upstream (streams SSE) and fake OpenAI upstream (streams chunks), both reached cross-format.
let fakeA, fakeO, app, port, dataDir, lastAnthropicBody, lastOpenaiBody;
before(async () => {
  fakeA = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    lastAnthropicBody = JSON.parse(b);
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    // Breaks off mid-reply: its response ends as a whole one would, the reply in it unfinished.
    if (lastAnthropicBody.model === "claude-cut") { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(ev("message_start", { message: { id: "msg_c", type: "message", role: "assistant", model: "claude-cut", content: [], usage: { input_tokens: 12 } } }) + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "half a rep" } })); return; }
    if (lastAnthropicBody.stream) { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(ev("message_start", { message: { id: "msg_f", type: "message", role: "assistant", model: "claude-opus-5", content: [], usage: { input_tokens: 12, cache_read_input_tokens: 0 } } }) + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "from anthropic" } }) + ev("content_block_stop", { index: 0 }) + ev("content_block_start", { index: 1, content_block: { type: "tool_use", id: "tu9", name: "get_weather", input: {} } }) + ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "{\"city\":\"Rome\"}" } }) + ev("content_block_stop", { index: 1 }) + ev("message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 6 } }) + ev("message_stop", {})); }
    else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "msg_j", type: "message", role: "assistant", model: "claude-opus-5", content: [{ type: "text", text: "json from anthropic" }], stop_reason: "end_turn", usage: { input_tokens: 4, output_tokens: 2 } })); }
  }); });
  fakeO = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    lastOpenaiBody = JSON.parse(b);
    const mk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id: "chatcmpl-o", object: "chat.completion.chunk", model: "glm-5", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
    if (lastOpenaiBody.model === "glm-cut") { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(mk({ role: "assistant", content: "" }) + mk({ content: "half a rep" })); return; }
    if (lastOpenaiBody.stream) { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(mk({ role: "assistant", content: "" }) + mk({ reasoning_content: "pondering" }) + mk({ content: "from openai" }) + mk({}, "stop") + `data: ${JSON.stringify({ id: "chatcmpl-o", choices: [], usage: { prompt_tokens: 20, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`); }
    else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "chatcmpl-j", object: "chat.completion", model: "glm-5", choices: [{ index: 0, message: { role: "assistant", content: "json from openai" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } })); }
  }); });
  await new Promise((r) => fakeA.listen(0, "127.0.0.1", r)); await new Promise((r) => fakeO.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-xlat-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "anth", name: "a", type: "anthropic", baseUrl: `http://127.0.0.1:${fakeA.address().port}`, apiKey: "s" }, { id: "oai", name: "o", type: "openai-compatible", baseUrl: `http://127.0.0.1:${fakeO.address().port}`, apiKey: "s" }];
  cfg.routes = [{ match: "claude-*", upstream: "anth", upstreamModel: "{model}" }, { match: "glm-*", upstream: "oai", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); fakeA.close(); fakeO.close(); rmSync(dataDir, { recursive: true, force: true }); });
const H = { "content-type": "application/json", authorization: "Bearer k" };

test("OpenAI-format client reaches the Anthropic upstream: streamed tool call comes back as OpenAI chunks", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "claude-opus-5", stream: true, messages: [{ role: "system", content: "s" }, { role: "user", content: "weather in Rome" }], tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }] }) });
  assert.equal(r.status, 200); assert.ok(r.headers.get("content-type").includes("text/event-stream"));
  const text = await r.text();
  assert.ok(text.includes('"content":"from anthropic"') && text.includes('"name":"get_weather"') && text.includes('"finish_reason":"tool_calls"') && text.trim().endsWith("data: [DONE]"), text);
  assert.equal(lastAnthropicBody.system, "s"); assert.equal(lastAnthropicBody.tools[0].name, "get_weather");
  assert.equal(lastAnthropicBody.max_tokens, DEFAULT_OUTPUT_TOKENS, "a client that sent no max_tokens: all the model can write (no ceiling stated here), never 16,384");
  const rec = app.usage.list(1)[0]; assert.equal(rec.translatedFormats, "openai -> anthropic"); assert.equal(rec.tokens.output, 6); assert.ok(rec.changes.some((c) => c.includes("translated OpenAI -> Anthropic")));
});

test("Anthropic-format client reaches the OpenAI upstream: chunks come back as Anthropic SSE with a thinking block", async () => {
  const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "glm-5", max_tokens: 100, stream: true, system: "sys", output_config: { effort: "high" }, messages: [{ role: "user", content: "hi" }] }) });
  assert.equal(r.status, 200); const text = await r.text();
  assert.ok(text.includes("event: message_start") && text.includes('"thinking_delta","thinking":"pondering"') && text.includes('"text_delta","text":"from openai"') && text.includes("event: message_stop"), text);
  assert.equal(lastOpenaiBody.messages[0].role, "system"); assert.equal(lastOpenaiBody.reasoning_effort, "high"); assert.equal(lastOpenaiBody.max_tokens, 100); assert.deepEqual(lastOpenaiBody.stream_options, { include_usage: true });
  const rec = app.usage.list(1)[0]; assert.equal(rec.translatedFormats, "anthropic -> openai"); assert.equal(rec.tokens.input, 20);
});

// (fails before: yes — the bug hunt of 10-30, WIRE-1: the client was handed a finished reply and the record said ok)
test("an upstream that breaks off mid-reply: the translated stream ends as an error for the client, and the record says so", async () => {
  const o = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "claude-cut", stream: true, messages: [{ role: "user", content: "hi" }] }) });
  assert.equal(o.status, 200);
  const ot = await o.text();
  assert.ok(ot.includes('"content":"half a rep"'), ot);
  assert.doesNotMatch(ot, /"finish_reason":"/, "no finish the upstream never sent");
  assert.ok(ot.includes(`data: ${JSON.stringify({ error: { message: "incomplete upstream stream", type: "api_error" } })}`) && ot.trim().endsWith("data: [DONE]"), ot);
  const r1 = app.usage.list(1)[0];
  assert.deepEqual([r1.model, r1.status, r1.error], ["claude-cut", "error", "incomplete upstream stream"]);
  const a = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "glm-cut", max_tokens: 50, stream: true, messages: [{ role: "user", content: "hi" }] }) });
  assert.equal(a.status, 200);
  const at = await a.text();
  assert.ok(at.includes('"text_delta","text":"half a rep"'), at);
  assert.ok(!at.includes("message_stop") && !at.includes("end_turn"), at);
  assert.deepEqual(sseToJson("anthropic", at), { type: "error", error: { type: "api_error", message: "incomplete upstream stream" } }, "Filament's own loop reads it as a stream that broke off");
  const r2 = app.usage.list(1)[0];
  assert.deepEqual([r2.model, r2.status, r2.error], ["glm-cut", "error", "incomplete upstream stream"]);
});

test("non-streaming translated responses in both directions", async () => {
  const j1 = await (await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] }) })).json();
  assert.equal(j1.object, "chat.completion"); assert.equal(j1.choices[0].message.content, "json from anthropic"); assert.equal(j1.usage.prompt_tokens, 4);
  const j2 = await (await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "glm-5", max_tokens: 50, messages: [{ role: "user", content: "hi" }] }) })).json();
  assert.equal(j2.type, "message"); assert.equal(j2.content[0].text, "json from openai"); assert.equal(j2.usage.input_tokens, 5);
});

test("translate.mode = never refuses cross-format requests with a clear error", async () => {
  app.config.rules.translate.mode = "never";
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] }) });
  assert.equal(r.status, 502); const j = await r.json(); assert.ok(j.error.message.includes("never"), JSON.stringify(j));
  app.config.rules.translate.mode = "auto";
});

test("SSE with CRLF line endings is parsed like LF", () => {
  const tr = createAnthropicToOpenaiStream({ model: "m" });
  const ev = (t, d) => `event: ${t}\r\ndata: ${JSON.stringify({ type: t, ...d })}\r\n\r\n`;
  const out = tr.push(ev("message_start", { message: { id: "msg_a", usage: { input_tokens: 3 } } }) + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hello" } }));
  assert.ok(out.includes('"content":"Hello"'), out);
  // (fails before: yes — the bug hunt of 10-30, WIRE-5's kin: a piece that ended between the CR and the LF of a blank
  // line ran two events into one, which parsed as neither, and both were lost)
  const cut = createAnthropicToOpenaiStream({ model: "m" });
  const first = ev("message_start", { message: { id: "msg_b", usage: { input_tokens: 3 } } }) + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hel" } });
  const o2 = cut.push(first.slice(0, -1)) + cut.push(first.slice(-1) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "lo" } }));
  assert.ok(o2.includes('"content":"Hel"') && o2.includes('"content":"lo"'), o2);
});
